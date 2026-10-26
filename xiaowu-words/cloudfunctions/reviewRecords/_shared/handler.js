const crypto = require('node:crypto');
const { createEngine } = require('./domain/engine');
const { today } = require('./domain/date');
const { createCloudStore } = require('./cloud-store');
const seed = require('./data/xiaowu-25.json');

const BUSINESS_ERRORS = new Set([
  'UNAUTHENTICATED', 'INVALID_INPUT', 'INVALID_ACTION', 'INVALID_DATE', 'LOGIN_REQUIRED', 'FAMILY_REQUIRED',
  'FORBIDDEN', 'NOT_FOUND', 'REQUEST_CONFLICT', 'ALREADY_IN_FAMILY', 'TOO_MANY_ATTEMPTS', 'INVITE_INVALID',
  'CONFIRM_REQUIRED', 'SEED_NOT_EMPTY', 'STALE_WORD', 'NOT_DUE', 'ALREADY_REVIEWED'
]);

function createHandler(area, cloud) {
  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  const database = cloud.database({ throwOnNotFound: false });
  const db = createCloudStore(database);
  return async event => {
    try {
      // 这些函数只能配置为小程序调用：不开放 HTTP / Web / 匿名入口。
      // 不在全局缓存用户身份，避免热启动复用别人的身份。
      const context = cloud.getWXContext();
      if (!['wx_client', 'wx_devtools'].includes(context.SOURCE) || !context.OPENID || !context.APPID) {
        return { ok: false, code: 'UNAUTHENTICATED', message: '请从微信小程序访问家庭字本' };
      }
      const instant = Date.now();
      const invoke = createEngine(db, {
        hash: text => crypto.createHash('sha256').update(text).digest('hex'),
        randomCode: () => crypto.randomBytes(8).toString('hex').toUpperCase(),
        today: () => today(instant), now: () => new Date(instant).toISOString(), seed
      });
      const data = await invoke(area, event, { openid: context.OPENID, appid: context.APPID });
      return { ok: true, data };
    } catch (error) {
      if (BUSINESS_ERRORS.has(error.code)) return { ok: false, code: error.code, message: error.message };
      console.error('Cloud request failed', error.code || error.errCode || 'UNKNOWN');
      return { ok: false, code: 'INTERNAL_ERROR', message: '云端暂未完成操作。请检查数据库集合、索引和云函数日志后重试。' };
    }
  };
}
module.exports = { createHandler };
