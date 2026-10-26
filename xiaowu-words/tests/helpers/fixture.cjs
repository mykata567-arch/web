const crypto = require('node:crypto');
const { createLocalStore } = require('./memory-store.cjs');
const { createEngine } = require('../../miniprogram/domain/engine');
const seed = require('../../seed/xiaowu-25.json');

// 仅测试使用的内存事务存储；应用运行时没有本地字本实现。
function fixture() {
  let state;
  let instant = '2026-10-26T04:00:00.000Z';
  let sequence = 0;
  const db = createLocalStore({ get: () => state, set: (_, value) => { state = structuredClone(value); } });
  const engine = createEngine(db, { hash: text => crypto.createHash('sha256').update(text).digest('hex'),
    randomCode: () => (++sequence).toString(16).toUpperCase().padStart(16, '0'),
    now: () => instant, today: () => instant.slice(0, 10), seed });
  const call = (actor, area, action, data = {}) => engine(area, { action, ...data }, { openid: actor, appid: 'test-app' });
  const id = () => 'request_' + (++sequence).toString().padStart(12, '0');
  const mutate = (actor, area, action, data = {}) => call(actor, area, action, { requestId: id(), ...data });
  async function family(actor = 'father') {
    await call(actor, 'initUser', 'bootstrap');
    return mutate(actor, 'initUser', 'createFamily', { name: '测试家庭字本', memberName: actor });
  }
  async function join(actor, code) {
    await call(actor, 'initUser', 'bootstrap');
    return mutate(actor, 'initUser', 'joinFamily', { code, memberName: actor });
  }
  return { db, engine, call, mutate, family, join, id, setDate: date => { instant = date + 'T04:00:00.000Z'; }, setTime: time => { instant = time; } };
}
module.exports = { fixture };
