// A narrow bridge for the existing domain service, not a general SQL executor.
// The browser never receives this API key or talks to the database directly.
export const RATE_SQL = 'INSERT INTO access_attempts (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN access_attempts.window = excluded.window THEN access_attempts.count + 1 ELSE 1 END, window = excluded.window RETURNING count';

export function createCloudbaseDb({ envId, apiKey, fetch: fetcher = globalThis.fetch }) {
  if (!/^[a-z0-9][a-z0-9-]{2,99}$/.test(envId || '') || !apiKey || apiKey.includes('YOUR_')) {
    const error = new Error('请先在云函数中配置云环境ID与服务端 API Key');
    error.code = 'CONFIG_REQUIRED'; throw error;
  }
  const base = `https://${envId}.api.tcloudbasegateway.com/v1/rdb/rest/`;
  async function call(path, method = 'GET', body, query = {}) {
    const url = new URL(path, base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetcher(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: {
          Authorization: `Bearer ${apiKey}`, Accept: 'application/json',
          'Content-Type': 'application/json',
          Prefer: 'return=representation' + (method === 'POST' && path === 'xw_wordbooks' ? ',resolution=ignore-duplicates' : ''),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      const error = new Error('云数据库暂时无法连接，请稍后重试这次操作');
      error.code = 'INTERNAL_ERROR'; throw error;
    }
    if (!response.ok) {
      // Never return upstream bodies, URLs, keys, or internal SQL to visitors.
      const error = new Error([401, 403, 404].includes(response.status)
        ? '云数据库配置尚未完成，请检查数据库初始化与服务端 API Key'
        : '云数据库暂时没有完成操作，请稍后重试');
      error.code = 'INTERNAL_ERROR'; throw error;
    }
    try { return await response.json(); }
    catch { const error = new Error('云数据库未返回保存结果，请重试确认'); error.code = 'INTERNAL_ERROR'; throw error; }
  }
  return {
    async health() { await call('xw_wordbooks', 'GET', undefined, { select: 'id', limit: 1 }); },
    prepare(sql) {
      return { bind(...args) {
        return {
          async first() {
            const match = /^SELECT \* FROM wordbooks WHERE (id|owner_id|invite_hash) = \?$/.exec(sql);
            if (match) {
              const rows = await call('xw_wordbooks', 'GET', undefined, { select: '*', [match[1]]: 'eq.' + args[0], limit: 1 });
              if (!Array.isArray(rows)) throw new Error('Unexpected database response');
              return rows[0] || null;
            }
            if (sql === RATE_SQL) {
              const result = await call('rpc/xw_bump_attempt', 'POST', { p_key: args[0], p_window: args[1] });
              const count = typeof result === 'number' ? result : result?.[0]?.count;
              if (!Number.isInteger(count)) throw new Error('Unexpected rate-limit result');
              return { count };
            }
            throw new Error('Unsupported database read');
          },
          async run() {
            let rows;
            if (sql === 'UPDATE wordbooks SET state = ?, revision = revision + 1, invite_hash = ? WHERE id = ? AND revision = ?') {
              const [state, invite_hash, id, revision] = args;
              rows = await call('xw_wordbooks', 'PATCH', { state, invite_hash, revision: revision + 1 }, { id: 'eq.' + id, revision: 'eq.' + revision });
            } else if (sql === 'INSERT INTO wordbooks (id, owner_id, state, revision, invite_hash, created_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(owner_id) DO NOTHING') {
              const [id, owner_id, state, invite_hash, created_at] = args;
              rows = await call('xw_wordbooks', 'POST', { id, owner_id, state, revision: 1, invite_hash, created_at }, { on_conflict: 'owner_id' });
            } else throw new Error('Unsupported database write');
            if (!Array.isArray(rows)) throw new Error('Unexpected database write result');
            return { meta: { changes: rows.length } };
          },
        };
      } };
    },
  };
}
