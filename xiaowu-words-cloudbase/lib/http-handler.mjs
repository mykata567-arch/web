import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createBookService } from './book-service.mjs';
import { RATE_SQL } from './cloudbase-db.mjs';

const hash = value => createHash('sha256').update(value).digest();
const codes = {
  INVALID_INPUT: 400, INVALID_ACTION: 400, UNAUTHORIZED: 401, SIGN_IN_REQUIRED: 401,
  FORBIDDEN: 403, NOT_FOUND: 404, STALE_WORD: 409, REQUEST_CONFLICT: 409,
  NOT_DUE: 409, ALREADY_REVIEWED: 409, ALREADY_EXISTS: 409,
  INVITE_INVALID: 400, FAMILY_FULL: 409, SEED_NOT_EMPTY: 409, RATE_LIMIT: 429, BUSY: 503,
  CONFIG_REQUIRED: 503, TOO_LARGE: 413,
};
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const header = (req, key) => typeof req.headers[key] === 'string' ? req.headers[key] : '';
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store, private' });
  res.end(JSON.stringify(body));
}
async function bodyOf(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk); size += bytes.length;
    if (size > 16000) fail('TOO_LARGE', '本次内容较多，请分批录入');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { fail('INVALID_INPUT', '提交格式无效，请刷新重试'); }
}
export function createHandler({ db, setupCode, publicDirectory, origin = '', now = () => Date.now(), configError = false }) {
  const service = db && createBookService(db, { now });
  function configured() {
    if (configError || !db || typeof setupCode !== 'string' || setupCode.length < 32 || setupCode.includes('YOUR_')) {
      fail('CONFIG_REQUIRED', '云端配置尚未完成，请联系字本创建者');
    }
  }
  return async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (path === '/api/health') {
        if (req.method !== 'GET') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        configured(); await db.health(); return send(res, 200, { ok: true, version: '0.1.1' });
      }
      if (path === '/api/book') {
        configured();
        // Application tokens use a separate header: a CloudBase gateway must not
        // mistake these for its own Authorization bearer tokens.
        const token = header(req, 'x-family-token');
        if (req.method === 'GET') return send(res, 200, await service.session(token, null));
        if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        if (header(req, 'x-xiaowu-request') !== '1' || !/^application\/json(?:;|$)/i.test(header(req, 'content-type'))) {
          fail('FORBIDDEN', '请从家庭字本页面提交操作');
        }
        if (header(req, 'sec-fetch-site') === 'cross-site' || (origin && header(req, 'origin') && header(req, 'origin') !== origin)) {
          fail('FORBIDDEN', '请在家庭字本原页面操作');
        }
        const parsed = await bodyOf(req);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') fail('INVALID_INPUT', '操作内容无效');
        const { setupCode: submittedCode, ...event } = parsed;
        // Client-supplied owner IDs and platform identity fields are never trusted.
        let ownerId;
        const clientKey = req.socket?.remoteAddress || 'gateway';
        if (event.action === 'create' || event.action === 'resume') {
          const attempt = await db.prepare(RATE_SQL).bind(hash('setup:' + clientKey).toString('hex'), Math.floor(now() / 600000)).first();
          if (attempt.count > 10) fail('RATE_LIMIT', '尝试较多，请10分钟后再试');
          if (typeof submittedCode !== 'string' || !timingSafeEqual(hash(submittedCode), hash(setupCode))) {
            fail('UNAUTHORIZED', '家庭管理码不正确，请核对后重试');
          }
          ownerId = 'single-family-owner';
        }
        return send(res, 200, await service.action(event, token, ownerId, clientKey));
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      const allowed = path === '/' || path === '/index.html' || path === '/favicon.svg' || /^\/assets\/[A-Za-z0-9_.-]+$/.test(path);
      if (!allowed) return send(res, 404, { error: 'NOT_FOUND' });
      const file = resolve(publicDirectory, path === '/' ? 'index.html' : path.slice(1));
      const content = await readFile(file).catch(() => null);
      if (!content) return send(res, 404, { error: 'NOT_FOUND' });
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const expected = Object.hasOwn(codes, error.code);
      send(res, expected ? codes[error.code] : 503, {
        error: expected ? error.code : 'INTERNAL_ERROR',
        message: expected ? error.message : '暂时没有收到保存结果，请稍后重试确认',
      });
    }
  };
}
