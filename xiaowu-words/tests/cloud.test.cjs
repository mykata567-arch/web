const test = require('node:test');
const assert = require('node:assert/strict');
const { createApi, PENDING_KEY } = require('../miniprogram/services/cloud-api');
const { createCloudStore } = require('../cloudfunctions/_shared/cloud-store');
const { fixture } = require('./helpers/fixture.cjs');

function platformWith(callFunction) {
  const storage = new Map();
  const platform = { cloud: { init() {}, callFunction }, getStorageSync: key => storage.get(key), setStorageSync: (key, value) => storage.set(key, structuredClone(value)), removeStorageSync: key => storage.delete(key) };
  return { platform, storage };
}

test('云端已提交但响应丢失：重开应用恢复原请求，不会多记一次错误', async () => {
  const f = fixture();
  await f.family();
  let loseResponse = true;
  const { platform, storage } = platformWith(async ({ name, data }) => {
    const result = await f.call('father', name, data.action, data);
    if (data.action === 'add' && loseResponse) { loseResponse = false; throw new Error('connection lost after commit'); }
    return { result: { ok: true, data: result } };
  });
  let api = createApi(platform, { mode: 'cloud', cloudEnv: 'test-env' });
  const event = { action: 'add', items: [{ phrase: '山顶', characters: ['顶'] }], requestId: f.id() };
  await assert.rejects(api.call('wordRecords', event), { code: 'NETWORK' });
  assert.ok(Array.from(storage.keys()).some(key => key.startsWith(PENDING_KEY + ':')));
  api = createApi(platform, { mode: 'cloud', cloudEnv: 'test-env' });
  const list = await api.call('wordRecords', { action: 'list' });
  assert.equal(list.words.length, 1);
  assert.equal(list.words[0].errorCount, 1);
  assert.equal(storage.size, 0);
});

test('业务拒绝后移除待确认操作，断网后不生成任何本地字本', async () => {
  let offline = false;
  const { platform, storage } = platformWith(async ({ data }) => {
    if (offline) throw new Error('offline');
    if (data.action === 'bootstrap') return { result: { ok: true, data: { accountId: 'test-user' } } };
    return { result: { ok: false, code: 'STALE_WORD', message: '家人已更新' } };
  });
  const api = createApi(platform, { mode: 'cloud', cloudEnv: 'test-env' });
  await assert.rejects(api.call('reviewRecords', { action: 'submit', requestId: 'request_000000000001' }), { code: 'STALE_WORD' });
  assert.equal(storage.size, 0);
  offline = true;
  await assert.rejects(api.call('wordRecords', { action: 'list' }), { code: 'NETWORK' });
  assert.equal(storage.size, 0);
});

test('缺少真实云配置时明确阻止访问，不切换本地模式', async () => {
  const { platform, storage } = platformWith(async () => { assert.fail('不应调用未配置环境'); });
  const api = createApi(platform, { mode: 'cloud', cloudEnv: 'YOUR_CLOUD_ENV_ID' });
  await assert.rejects(api.profile(), /真实微信云开发环境/);
  assert.equal(storage.size, 0);
});

test('云适配器使用SDK事务和文档接口，写入剔除保留字段，异常不会吞掉', async () => {
  const calls = [];
  const sdk = { collection(table) { return {
    doc(id) { return { async get() { calls.push(['get', table, id]); return { data: id === 'absent' ? null : { id } }; },
      async set({ data }) { calls.push(['set', table, id, data]); } }; }
  }; }, async runTransaction(work) { calls.push(['start']); const value = await work(this); calls.push(['commit']); return { result: value }; } };
  const db = createCloudStore(sdk);
  assert.equal(await db.get('words', 'absent'), null);
  const result = await db.transaction(async tx => { await tx.put('words', 'id', { id: 'id', _id: 'reserved' }); return 7; });
  assert.equal(result, 7);
  assert.deepEqual(calls.find(item => item[0] === 'set'), ['set', 'words', 'id', { id: 'id' }]);
  assert.deepEqual(calls.slice(-1)[0], ['commit']);
  await assert.rejects(db.transaction(async () => { throw new Error('rollback'); }), /rollback/);
});

test('三个实际云函数入口共享同一业务包，拒绝非微信来源与身份伪造', async () => {
  const { createHandler } = require('../cloudfunctions/initUser/_shared/handler');
  let current = { SOURCE: 'http', OPENID: 'someone', APPID: 'test' };
  const cloud = { DYNAMIC_CURRENT_ENV: 'current', init() {}, database() { return {}; }, getWXContext() { return current; } };
  const handler = createHandler('initUser', cloud);
  assert.equal((await handler({ action: 'bootstrap', OPENID: 'father' })).code, 'UNAUTHENTICATED');
  current = { SOURCE: 'wx_client', APPID: 'test' };
  assert.equal((await handler({ action: 'bootstrap', openid: 'father' })).code, 'UNAUTHENTICATED');
});
