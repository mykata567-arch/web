// wx-server-sdk 文档接口；真实数据库事务只在服务端运行。
function createCloudStore(database) {
  function adapter(source) {
    return {
      async get(table, id) {
        if (typeof id !== 'string' || !id || id.length > 128) return null;
        const result = await source.collection(table).doc(id).get();
        return result.data || null;
      },
      async put(table, id, value) {
        const data = { ...value };
        delete data._id;
        await source.collection(table).doc(id).set({ data });
      },
      async query(table, filter, options) {
        let query = source.collection(table).where(filter).orderBy(options.orderBy, options.direction);
        if (options.orderBy !== 'id') query = query.orderBy('id', options.direction);
        const result = await query.skip(options.offset).limit(options.limit).get();
        return result.data;
      }
    };
  }
  const store = adapter(database);
  store.transaction = async work => {
    let value;
    await database.runTransaction(async transaction => {
      value = await work(adapter(transaction));
      return value;
    });
    return value;
  };
  return store;
}
module.exports = { createCloudStore };
