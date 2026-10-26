const { addDays } = require('./date');
const RULES = require('./rules');

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function characterOK(value) {
  return typeof value === 'string' && /^[\u3400-\u4dbf\u4e00-\u9fff]$/.test(value);
}

function phraseOK(value) {
  return typeof value === 'string' && /^[\u3400-\u4dbf\u4e00-\u9fff]{1,12}$/.test(value);
}

function splitPhrases(value) {
  return Array.from(new Set(String(value || '').split(/[\s,，、;；\n]+/).map(v => v.trim()).filter(Boolean)));
}

function normalizeSelections(items) {
  if (!Array.isArray(items) || !items.length || items.length > 30) fail('INVALID_INPUT', '每次请录入1～30个词语');
  const byChar = new Map();
  const selected = new Set();
  items.forEach(item => {
    if (!item || !phraseOK(item.phrase) || !Array.isArray(item.characters) || !item.characters.length || item.characters.length > 12) {
      fail('INVALID_INPUT', '词语需为1～12个汉字，并至少选择一个不会写的字');
    }
    item.characters.forEach(character => {
      if (!characterOK(character) || !item.phrase.includes(character)) fail('INVALID_INPUT', '所选汉字必须属于对应词语');
      const key = item.phrase + ':' + character;
      if (selected.has(key)) return;
      selected.add(key);
      if (!byChar.has(character)) byChar.set(character, { character, phrases: [], occurrences: 0 });
      const entry = byChar.get(character);
      entry.phrases.push(item.phrase);
      entry.occurrences += 1;
    });
  });
  if (byChar.size > 40) fail('INVALID_INPUT', '一次最多记录40个不同的字');
  return Array.from(byChar.values());
}

function stageLabel(word, rules) {
  const config = rules || RULES;
  if (word.mastered) return '阶段性掌握';
  if (!word.streak) return '待首次答对';
  return '连续答对' + word.streak + '次 · ' + config.correctIntervalsDays[word.streak - 1] + '天间隔';
}

function addMistake(previous, entry, day, timestamp, rules) {
  const config = rules || RULES;
  return Object.assign({}, previous || {}, {
    character: entry.character,
    phrases: Array.from(new Set([].concat(previous ? previous.phrases : [], entry.phrases))),
    firstRecordedDate: previous ? previous.firstRecordedDate : day,
    lastErrorDate: day,
    errorCount: (previous ? previous.errorCount : 0) + entry.occurrences,
    reviewErrorCount: previous ? previous.reviewErrorCount : 0,
    reviewCount: previous ? previous.reviewCount : 0,
    lastReviewDate: previous ? previous.lastReviewDate : null,
    streak: 0,
    mastered: false,
    masteredDate: null,
    nextReviewDate: addDays(day, config.firstDelayDays),
    version: (previous ? previous.version : 0) + 1,
    createdAt: previous ? previous.createdAt : timestamp,
    updatedAt: timestamp
  });
}

function applyReview(word, correct, day, timestamp, rules) {
  const config = rules || RULES;
  if (typeof correct !== 'boolean') fail('INVALID_INPUT', '请明确选择正确或错误');
  if (word.mastered || !word.nextReviewDate || word.nextReviewDate > day) fail('NOT_DUE', '这个字还没到复习时间');
  if (word.lastReviewDate === day) fail('ALREADY_REVIEWED', '这个字今天已经复习过了');
  const streak = correct ? word.streak + 1 : 0;
  const mastered = correct && streak > config.correctIntervalsDays.length;
  return Object.assign({}, word, {
    streak,
    mastered,
    masteredDate: mastered ? day : null,
    nextReviewDate: mastered ? null : addDays(day, correct ? config.correctIntervalsDays[streak - 1] : config.firstDelayDays),
    lastReviewDate: day,
    lastErrorDate: correct ? word.lastErrorDate : day,
    errorCount: word.errorCount + (correct ? 0 : 1),
    reviewErrorCount: word.reviewErrorCount + (correct ? 0 : 1),
    reviewCount: word.reviewCount + 1,
    version: word.version + 1,
    updatedAt: timestamp
  });
}

function dueWords(words, day) {
  return words.filter(word => !word.mastered && word.nextReviewDate && word.nextReviewDate <= day)
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate) || b.errorCount - a.errorCount || a.id.localeCompare(b.id));
}

function summarize(words, reviews, day) {
  const todayReviews = reviews.filter(review => review.date === day && review.type === 'review');
  return {
    total: words.length,
    due: dueWords(words, day).length,
    mastered: words.filter(word => word.mastered).length,
    completedToday: new Set(todayReviews.map(review => review.wordId)).size,
    correctToday: todayReviews.filter(review => review.correct).length,
    repeated: words.filter(word => word.errorCount > 1).sort((a, b) => b.errorCount - a.errorCount).slice(0, 8)
  };
}

module.exports = { fail, characterOK, phraseOK, splitPhrases, normalizeSelections, stageLabel, addMistake, applyReview, dueWords, summarize };
