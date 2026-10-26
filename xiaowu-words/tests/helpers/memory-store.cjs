const STORAGE_KEY = 'xiaowu-words-local-v1';
const clone = value => JSON.parse(JSON.stringify(value));

// 单次 mutation 在内存副本中完成后，一次性落盘；失败时不修改原状态。
function createLocalStore(storage) {
  let queue = Promise.resolve();
  function load() {
    const value = storage.get(STORAGE_KEY);
    if (value && value.schemaVersion !== 1) throw new Error('本地数据版本暂不支持，请先保留原数据');
    return value || { schemaVersion: 1, tables: {} };
  }
  function api(state) {
    return {
      async get(table, id) { return clone((state.tables[table] || {})[id] || null); },
      async put(table, id, record) {
        if (!state.tables[table]) state.tables[table] = {};
        state.tables[table][id] = clone(record);
      },
      async query(table, filter, options) {
        const params = options || { offset: 0, limit: 100, orderBy: 'id', direction: 'asc' };
        const records = Object.values(state.tables[table] || {}).filter(record => Object.keys(filter).every(key => record[key] === filter[key]));
        const sign = params.direction === 'desc' ? -1 : 1;
        records.sort((a, b) => sign * (String(a[params.orderBy]).localeCompare(String(b[params.orderBy])) || a.id.localeCompare(b.id)));
        return clone(records.slice(params.offset, params.offset + params.limit));
      }
    };
  }
  return {
    async get(table, id) { await queue; return api(load()).get(table, id); },
    async query(table, filter, options) { await queue; return api(load()).query(table, filter, options); },
    transaction(work) {
      const pending = queue.then(async () => {
        const state = clone(load());
        const result = await work(api(state));
        storage.set(STORAGE_KEY, state);
        return result;
      });
      queue = pending.catch(() => {});
      return pending;
    }
  };
}

module.exports = { createLocalStore, STORAGE_KEY };
