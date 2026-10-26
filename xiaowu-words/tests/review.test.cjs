const test = require('node:test');
const assert = require('node:assert/strict');
const { today, addDays, validDate } = require('../miniprogram/domain/date');
const { addMistake, applyReview, normalizeSelections } = require('../miniprogram/domain/model');

test('按北京时间跨日，日期运算覆盖月末与闰年', () => {
  assert.equal(today(Date.parse('2026-10-25T15:59:59Z')), '2026-10-25');
  assert.equal(today(Date.parse('2026-10-25T16:00:00Z')), '2026-10-26');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(validDate('2026-02-29'), false);
});

test('次日首次复习，依次3、7、14天，第四次连续答对才掌握', () => {
  let word = addMistake(null, { character: '顶', phrases: ['山顶'], occurrences: 1 }, '2026-10-25', 'timestamp');
  assert.equal(word.nextReviewDate, '2026-10-26');
  const cases = [['2026-10-26', '2026-10-29'], ['2026-10-29', '2026-11-05'], ['2026-11-05', '2026-11-19'], ['2026-11-19', null]];
  cases.forEach(([day, next], index) => {
    word = applyReview(word, true, day, 'timestamp');
    assert.equal(word.nextReviewDate, next);
    assert.equal(word.streak, index + 1);
    assert.equal(word.mastered, index === 3);
  });
});

test('答错归零、次日再复习，掌握后再出错重新激活', () => {
  const entry = { character: '形', phrases: ['形状'], occurrences: 1 };
  let word = addMistake(null, entry, '2026-10-25', 'timestamp');
  word = applyReview(word, true, '2026-10-26', 'timestamp');
  word = applyReview(word, false, '2026-10-30', 'timestamp');
  assert.equal(word.streak, 0);
  assert.equal(word.errorCount, 2);
  assert.equal(word.nextReviewDate, '2026-10-31');
  word = { ...word, mastered: true, streak: 4, nextReviewDate: null };
  const reset = addMistake(word, entry, '2026-11-20', 'new-time');
  assert.equal(reset.mastered, false);
  assert.equal(reset.nextReviewDate, '2026-11-21');
  assert.equal(reset.firstRecordedDate, '2026-10-25');
  assert.equal(reset.errorCount, 3);
});

test('逾期按实际复习日安排，未到期与同日重复判断被拒绝', () => {
  let word = addMistake(null, { character: '些', phrases: ['那些'], occurrences: 1 }, '2026-10-25', 'timestamp');
  assert.throws(() => applyReview(word, true, '2026-10-25', 'timestamp'), { code: 'NOT_DUE' });
  word = applyReview(word, true, '2026-10-28', 'timestamp');
  assert.equal(word.nextReviewDate, '2026-10-31');
  assert.throws(() => applyReview({ ...word, nextReviewDate: '2026-10-28' }, false, '2026-10-28', 'timestamp'), { code: 'ALREADY_REVIEWED' });
});

test('词语去重与同字跨词累计，拒绝不属于词语的字', () => {
  const entries = normalizeSelections([{ phrase: '山顶', characters: ['顶', '顶'] }, { phrase: '山顶', characters: ['顶'] }, { phrase: '顶楼', characters: ['顶', '楼'] }]);
  assert.equal(entries.length, 2);
  assert.equal(entries.find(row => row.character === '顶').occurrences, 2);
  assert.throws(() => normalizeSelections([{ phrase: '山顶', characters: ['小'] }]), { code: 'INVALID_INPUT' });
});
