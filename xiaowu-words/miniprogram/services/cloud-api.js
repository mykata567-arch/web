const PENDING_KEY = 'xiaowu-words-pending-v1';

// 本地仅暂存尚未确认的操作标识；字本和复习结果始终以云数据库为准。
function createApi(platform, config) {
  let ready;
  let queue = Promise.resolve();
  let pendingKey = PENDING_KEY;
  let configured = false;
  if (platform.cloud && config.mode === 'cloud' && config.cloudEnv && config.cloudEnv !== 'YOUR_CLOUD_ENV_ID') {
    platform.cloud.init({ env: config.cloudEnv, traceUser: false });
    configured = true;
  }
  async function execute(name, data) {
    if (!configured) throw new Error('请先按README填写小程序AppID和云环境ID，并部署云函数。家庭共享需要真实微信云开发环境。');
    let response;
    try { response = await platform.cloud.callFunction({ name, data }); }
    catch (_) { const error = new Error('连接暂时中断。请联网后重试，系统会先确认刚才的操作，避免重复记录。'); error.code = 'NETWORK'; throw error; }
    const result = response.result;
    if (!result || result.ok !== true) {
      const error = new Error(result && result.message ? result.message : '云端返回异常，请稍后重试');
      error.code = result && result.code ? result.code : 'INTERNAL_ERROR';
      throw error;
    }
    return result.data;
  }
  async function sendPending(pending) {
    try {
      const result = await execute(pending.area, pending.event);
      platform.removeStorageSync(pendingKey);
      return result;
    } catch (error) {
      if (!['NETWORK', 'INTERNAL_ERROR'].includes(error.code)) platform.removeStorageSync(pendingKey);
      throw error;
    }
  }
  async function recover() {
    const pending = platform.getStorageSync(pendingKey);
    if (pending) await sendPending(pending);
  }
  const api = {
    bootstrap() {
      if (!ready) ready = (async () => {
        const login = await execute('initUser', { action: 'bootstrap' });
        if (!login.accountId) throw new Error('云端身份返回异常，请更新云函数后重试');
        pendingKey = PENDING_KEY + ':' + login.accountId;
        await recover();
      })().catch(error => { ready = null; throw error; });
      return ready;
    },
    async call(area, event) {
      await api.bootstrap();
      const work = queue.then(async () => {
        await recover();
        if (!event.requestId) return execute(area, event);
        const pending = { area, event };
        platform.setStorageSync(pendingKey, pending);
        return sendPending(pending);
      });
      queue = work.catch(() => {});
      return work;
    },
    async profile() { return api.call('initUser', { action: 'bootstrap' }); }
  };
  return api;
}

module.exports = { createApi, PENDING_KEY };
