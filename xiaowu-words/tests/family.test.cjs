const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/fixture.cjs');

test('新账号无家庭无默认数据，主动导入25字且顶计2次', async () => {
  const f = fixture();
  assert.equal((await f.call('father', 'initUser', 'bootstrap')).family, null);
  await f.family();
  assert.equal((await f.call('father', 'wordRecords', 'list')).words.length, 0);
  await f.mutate('father', 'wordRecords', 'seed', { confirm: true });
  const words = (await f.call('father', 'wordRecords', 'list')).words;
  assert.equal(words.length, 25);
  assert.equal(new Set(words.map(word => word.character)).size, 25);
  assert.equal(words.find(word => word.character === '顶').errorCount, 2);
  assert.deepEqual(words.find(word => word.character === '顶').phrases, ['山顶', '顶楼']);
  assert.equal(words.filter(word => ['小', '五', '山'].includes(word.character)).length, 0);
  assert.ok(words.every(word => word.firstRecordedDate === '2026-10-25' && word.nextReviewDate === '2026-10-26'));
  await assert.rejects(f.mutate('father', 'wordRecords', 'seed', { confirm: true }), { code: 'SEED_NOT_EMPTY' });
});

test('三种独立身份：爸爸添加，妈妈次日看到，外婆复习，父母看到更新', async () => {
  const f = fixture();
  const family = await f.family();
  await f.join('mother', family.family.inviteCode);
  await f.join('grandmother', family.family.inviteCode);
  await f.mutate('father', 'wordRecords', 'add', { items: [{ phrase: '山顶', characters: ['顶'] }] });
  f.setDate('2026-10-27');
  const word = (await f.call('mother', 'wordRecords', 'list')).words[0];
  assert.equal(word.character, '顶');
  assert.equal((await f.call('grandmother', 'reviewRecords', 'due')).words.length, 1);
  await f.mutate('grandmother', 'reviewRecords', 'submit', { wordId: word.id, version: word.version, correct: true });
  for (const actor of ['father', 'mother']) {
    const updated = (await f.call(actor, 'wordRecords', 'get', { wordId: word.id })).word;
    assert.equal(updated.streak, 1);
    assert.equal(updated.nextReviewDate, '2026-10-30');
    assert.equal((await f.call(actor, 'reviewRecords', 'due')).words.length, 0);
    const records = (await f.call(actor, 'reviewRecords', 'history', { wordId: word.id })).records;
    assert.equal(records.filter(record => record.type === 'review').length, 1);
  }
});

test('两个家长同时判断只计一次，重试同一请求不会重复推进', async () => {
  const f = fixture();
  const family = await f.family();
  await f.join('mother', family.family.inviteCode);
  await f.mutate('father', 'wordRecords', 'seed', { confirm: true });
  const word = (await f.call('father', 'reviewRecords', 'due')).words[0];
  const request = { wordId: word.id, version: word.version, correct: true, requestId: f.id() };
  const attempts = await Promise.allSettled([
    f.call('father', 'reviewRecords', 'submit', request),
    f.mutate('mother', 'reviewRecords', 'submit', { wordId: word.id, version: word.version, correct: false })
  ]);
  assert.equal(attempts.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal(attempts.find(value => value.status === 'rejected').reason.code, 'STALE_WORD');
  await f.call('father', 'reviewRecords', 'submit', request);
  const updated = (await f.call('mother', 'wordRecords', 'get', { wordId: word.id })).word;
  assert.equal(updated.reviewCount, 1);
  assert.equal(updated.streak, 1);
  const records = (await f.call('mother', 'reviewRecords', 'history', { wordId: word.id })).records;
  assert.equal(records.filter(record => record.type === 'review').length, 1);
});

test('重复录入和并发录入合并同一字；网络重试只累计一次', async () => {
  const f = fixture();
  const family = await f.family();
  await f.join('mother', family.family.inviteCode);
  const request = { items: [{ phrase: '山顶', characters: ['顶'] }], requestId: f.id() };
  await f.call('father', 'wordRecords', 'add', request);
  await f.call('father', 'wordRecords', 'add', request);
  await Promise.all([
    f.mutate('father', 'wordRecords', 'add', { items: [{ phrase: '顶楼', characters: ['顶', '楼'] }] }),
    f.mutate('mother', 'wordRecords', 'add', { items: [{ phrase: '山顶', characters: ['顶'] }] })
  ]);
  const words = (await f.call('mother', 'wordRecords', 'list')).words;
  assert.equal(words.length, 2);
  assert.equal(words.find(word => word.character === '顶').errorCount, 3);
  assert.equal((await f.call('father', 'initUser', 'bootstrap')).child.wordCount, 2);
});

test('妈妈修改、外婆删除，爸爸看到同步；旧版本复习失败，重录恢复历史', async () => {
  const f = fixture();
  const family = await f.family();
  await f.join('mother', family.family.inviteCode);
  await f.join('grandmother', family.family.inviteCode);
  await f.mutate('father', 'wordRecords', 'seed', { confirm: true });
  let word = (await f.call('father', 'wordRecords', 'list')).words.find(value => value.character === '顶');
  const oldVersion = word.version;
  await f.mutate('mother', 'wordRecords', 'edit', { wordId: word.id, version: word.version, phrases: ['头顶'] });
  word = (await f.call('father', 'wordRecords', 'get', { wordId: word.id })).word;
  assert.deepEqual(word.phrases, ['头顶']);
  await assert.rejects(f.mutate('father', 'reviewRecords', 'submit', { wordId: word.id, version: oldVersion, correct: true }), { code: 'STALE_WORD' });
  await f.mutate('grandmother', 'wordRecords', 'delete', { wordId: word.id, version: word.version });
  assert.equal((await f.call('father', 'wordRecords', 'list')).words.length, 24);
  await assert.rejects(f.call('mother', 'wordRecords', 'get', { wordId: word.id }), { code: 'NOT_FOUND' });
  await f.mutate('father', 'wordRecords', 'add', { items: [{ phrase: '顶楼', characters: ['顶'] }] });
  const restored = (await f.call('grandmother', 'wordRecords', 'get', { wordId: word.id })).word;
  assert.equal(restored.errorCount, 3);
  assert.equal(restored.firstRecordedDate, '2026-10-25');
  assert.equal((await f.call('father', 'initUser', 'bootstrap')).child.wordCount, 25);
});

test('另一个家庭无法读取、编辑、删除或复习其他家庭的字，也不能伪造身份', async () => {
  const f = fixture();
  const family = await f.family();
  await f.mutate('father', 'wordRecords', 'seed', { confirm: true });
  const word = (await f.call('father', 'wordRecords', 'list')).words[0];
  await f.family('stranger');
  assert.equal((await f.call('stranger', 'wordRecords', 'list', { openid: 'father' })).words.length, 0);
  await assert.rejects(f.call('stranger', 'wordRecords', 'get', { wordId: word.id }), { code: 'NOT_FOUND' });
  for (const action of ['edit', 'delete']) await assert.rejects(f.mutate('stranger', 'wordRecords', action, { wordId: word.id, version: word.version, phrases: word.phrases }), { code: 'NOT_FOUND' });
  await assert.rejects(f.mutate('stranger', 'reviewRecords', 'submit', { wordId: word.id, version: word.version, correct: true }), { code: 'NOT_FOUND' });
  await assert.rejects(f.call('stranger', 'wordRecords', 'list', { familyId: family.family.id }), { code: 'FORBIDDEN' });
  await assert.rejects(f.call('stranger', 'wordRecords', 'list', { childId: family.child.id }), { code: 'FORBIDDEN' });
  await assert.rejects(f.engine('wordRecords', { action: 'list', openid: 'father' }, {}), { code: 'UNAUTHENTICATED' });
});

test('邀请码过期、更新失效、非创建者更新与错误尝试限流', async () => {
  const f = fixture();
  const created = await f.family();
  await f.join('mother', created.family.inviteCode);
  await assert.rejects(f.mutate('mother', 'initUser', 'rotateInvite'), { code: 'FORBIDDEN' });
  const rotated = await f.mutate('father', 'initUser', 'rotateInvite');
  await assert.rejects(f.join('outsider', created.family.inviteCode), { code: 'INVITE_INVALID' });
  f.setDate('2026-11-03');
  await assert.rejects(f.join('outsider', rotated.family.inviteCode), { code: 'INVITE_INVALID' });
  for (let i = 0; i < 8; i++) await assert.rejects(f.mutate('outsider', 'initUser', 'joinFamily', { code: 'wrong', memberName: '其他人' }), { code: 'INVITE_INVALID' });
  await assert.rejects(f.mutate('outsider', 'initUser', 'joinFamily', { code: 'wrong', memberName: '其他人' }), { code: 'INVITE_INVALID' });
  await assert.rejects(f.mutate('outsider', 'initUser', 'joinFamily', { code: 'wrong', memberName: '其他人' }), { code: 'TOO_MANY_ATTEMPTS' });
});

test('更改同一请求内容会被拒绝，所有阶段和历史不会被覆盖', async () => {
  const f = fixture();
  await f.family();
  const requestId = f.id();
  await f.mutate('father', 'wordRecords', 'add', { items: [{ phrase: '山顶', characters: ['顶'] }], requestId });
  await assert.rejects(f.mutate('father', 'wordRecords', 'add', { items: [{ phrase: '顶楼', characters: ['楼'] }], requestId }), { code: 'REQUEST_CONFLICT' });
  const word = (await f.call('father', 'wordRecords', 'list')).words[0];
  f.setDate('2026-10-27');
  await f.mutate('father', 'reviewRecords', 'submit', { wordId: word.id, version: word.version, correct: false });
  const records = (await f.call('father', 'reviewRecords', 'history', { wordId: word.id })).records;
  assert.equal(records.length, 2);
  assert.equal(records[0].correct, false);
  assert.equal(records[0].nextReviewDate, '2026-10-28');
});
