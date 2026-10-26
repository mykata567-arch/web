import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createCloudbaseDb } from '../lib/cloudbase-db.mjs';
import { createHandler } from '../lib/http-handler.mjs';

const pg = new PGlite();
const migration = await readFile(new URL('../sql/001-initialize.sql', import.meta.url), 'utf8');
const setupCode = 'local-test-only-family-admin-code-123456789';
const key = 'not-a-real-cloudbase-api-key';
let sequence = 0;
const rid = () => 'transport_request_' + String(++sequence).padStart(12, '0');
before(async () => {
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(migration);
});
after(async () => { await pg.close(); });

// Protocol harness: executes the production migration and each PostgREST
// operation against a real embedded PostgreSQL engine, without any cloud calls.
async function rest(url, init) {
  assert.equal(init.headers.Authorization, 'Bearer ' + key);
  assert.equal(url.hostname, 'local-test-env.api.tcloudbasegateway.com');
  const resource = url.pathname.replace('/v1/rdb/rest/', '');
  const body = init.body ? JSON.parse(init.body) : {};
  try {
    if (resource === 'rpc/xw_bump_attempt') {
      const result = await pg.query('SELECT public.xw_bump_attempt($1, $2) AS count', [body.p_key, body.p_window]);
      return Response.json(result.rows[0].count);
    }
    assert.equal(resource, 'xw_wordbooks');
    let result;
    if (init.method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'owner_id');
      assert.match(init.headers.Prefer, /resolution=ignore-duplicates/);
      result = await pg.query('INSERT INTO public.xw_wordbooks(id,owner_id,state,revision,invite_hash,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id) DO NOTHING RETURNING *', [body.id,body.owner_id,body.state,body.revision,body.invite_hash,body.created_at]);
    } else if (init.method === 'PATCH') {
      const id = url.searchParams.get('id'), rev = url.searchParams.get('revision');
      assert.match(id, /^eq\./); assert.match(rev, /^eq\./);
      result = await pg.query('UPDATE public.xw_wordbooks SET state=$1,revision=$2,invite_hash=$3 WHERE id=$4 AND revision=$5 RETURNING *', [body.state,body.revision,body.invite_hash,id.slice(3),Number(rev.slice(3))]);
    } else {
      assert.equal(init.method, 'GET');
      const clauses = [], values = [];
      for (const field of ['id','owner_id','invite_hash']) {
        const value = url.searchParams.get(field);
        if (value !== null) { assert.match(value,/^eq\./); values.push(value.slice(3)); clauses.push(`${field}=$${values.length}`); }
      }
      const select = url.searchParams.get('select'); assert.ok(['*','id'].includes(select));
      result = await pg.query(`SELECT ${select} FROM public.xw_wordbooks${clauses.length?' WHERE '+clauses.join(' AND '):''} LIMIT 1`,values);
    }
    return Response.json(result.rows);
  } catch (error) { return Response.json({ message: error.message }, { status: 400 }); }
}
async function fixture() {
  await pg.exec('TRUNCATE public.xw_wordbooks, public.xw_access_attempts');
  let now = Date.parse('2026-10-26T04:00:00Z');
  const db = createCloudbaseDb({ envId: 'local-test-env', apiKey: key, fetch: rest });
  const handler = createHandler({ db, setupCode, now: () => now, origin: 'https://family.example.cn',
    publicDirectory: fileURLToPath(new URL('../public/', import.meta.url)) });
  async function call(event, token = '', options = {}) {
    const method = event ? 'POST' : 'GET';
    const req = Readable.from(event ? [Buffer.from(JSON.stringify({ requestId: rid(), ...event }))] : []);
    Object.assign(req,{ method, url: options.url || '/api/book', socket: {remoteAddress:'127.0.0.1'}, headers:{
      'content-type':'application/json', 'x-xiaowu-request':'1', 'x-family-token':token,
      origin:'https://family.example.cn', ...options.headers,
    }});
    let status, result; const headers = {};
    const res = { setHeader(k,v){headers[k.toLowerCase()]=v;}, writeHead(s,h={}){status=s;for(const [k,v] of Object.entries(h))headers[k.toLowerCase()]=v;},end(data){result=data===undefined?'':String(data);} };
    await handler(req,res);
    let body; try {body=JSON.parse(result);} catch {body=result;}
    return {status,body,headers};
  }
  const create = async(importSample=true) => {
    const r = await call({action:'create',name:'测试字本',memberName:'爸爸',importSample,setupCode});
    assert.equal(r.status,200,JSON.stringify(r.body));return r.body.authToken;
  };
  return {db,call,create,book:async(token)=>(await call(null,token)).body.book,setDate:date=>{now=Date.parse(date+'T04:00:00Z');}};
}

test('真实 PostgreSQL 初始化可重复执行，匿名和普通角色不能直读或改家庭表/RPC',async()=>{
  await pg.exec(migration);
  for(const role of ['anon','authenticated']) {
    await pg.exec('SET ROLE '+role);
    try {
      await assert.rejects(pg.query('SELECT * FROM public.xw_wordbooks'),/permission denied/);
      await assert.rejects(pg.query("SELECT public.xw_bump_attempt('outside',1)"),/permission denied/);
    } finally {await pg.exec('RESET ROLE');}
  }
  const result=await pg.query("SELECT relrowsecurity FROM pg_class WHERE relname='xw_wordbooks'");
  assert.equal(result.rows[0].relrowsecurity,true);
});
test('HTTP 不信任伪造身份；管理码创建/找回，响应与数据库不保存管理码',async()=>{
  const f=await fixture();
  assert.equal((await f.call(null)).body.book,null);
  const rejected=await f.call({action:'create',name:'x',memberName:'爸爸',nativeId:'single-family-owner',setupCode:'wrong'});
  assert.equal(rejected.status,401);
  const token=await f.create();const book=await f.book(token);
  assert.equal(book.words.length,25);assert.equal(book.words.find(w=>w.character==='顶').errorCount,2);
  const raw=(await pg.query('SELECT state FROM public.xw_wordbooks')).rows[0].state;
  assert.equal(raw.includes(setupCode),false);
  assert.equal(JSON.stringify(book).includes('initialToken'),false);
  assert.equal(JSON.stringify(book).includes('keys'),false);
  const resumed=await f.call({action:'resume',setupCode});
  assert.equal(resumed.status,200);assert.equal((await f.book(resumed.body.authToken)).id,book.id);
  await pg.exec(migration);
  assert.equal((await f.book(token)).words.length,25);
});
test('CloudBase REST + PostgreSQL：父亲添加、妈妈次日看到、外婆复习后全家看到同一状态',async()=>{
  const f=await fixture(),father=await f.create(false);const initial=await f.book(father);
  const mother=(await f.call({action:'join',code:initial.inviteCode,memberName:'妈妈'})).body.authToken;
  const grandma=(await f.call({action:'join',code:initial.inviteCode,memberName:'外婆'})).body.authToken;
  assert.equal((await f.call({action:'add',items:[{phrase:'山顶',characters:['顶']}]},father)).status,200);
  f.setDate('2026-10-27');const word=(await f.book(grandma)).words[0];
  const event={action:'review',wordId:word.id,version:word.version,correct:true,requestId:rid()};
  assert.equal((await f.call(event,grandma)).status,200);
  assert.equal((await f.call(event,grandma)).status,200);
  for(const token of [father,mother,grandma]) {const b=await f.book(token);assert.equal(b.words[0].reviewCount,1);assert.equal(b.words[0].nextReviewDate,'2026-10-30');}
});
test('PostgreSQL compare-and-swap：同一版本并发复习仅成功一次，重复创建只产生一个字本',async()=>{
  const f=await fixture(),token=await f.create();const book=await f.book(token),word=book.words[0];
  const results=await Promise.all([true,false].map(correct=>f.call({action:'review',wordId:word.id,version:word.version,correct},token)));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.book(token)).words[0].reviewCount,1);
  const existing=await f.call({action:'create',name:'第二本',memberName:'爸爸',setupCode});assert.equal(existing.status,409);
  assert.equal((await pg.query('SELECT count(*) AS n FROM public.xw_wordbooks')).rows[0].n,1);
});
test('REST 条件更新失败不会覆盖赢家；持久计数器按窗口重置',async()=>{
  const f=await fixture(),token=await f.create(false);
  const book=await f.book(token);
  const before=(await pg.query('SELECT * FROM public.xw_wordbooks')).rows[0];
  const stale=await f.db.prepare('UPDATE wordbooks SET state = ?, revision = revision + 1, invite_hash = ? WHERE id = ? AND revision = ?')
    .bind('{"bad":true}',before.invite_hash,book.id,before.revision+1).run();
  assert.equal(stale.meta.changes,0);assert.equal((await f.book(token)).name,'测试字本');
  assert.equal((await pg.query("SELECT public.xw_bump_attempt('limit-test',1) AS n")).rows[0].n,1);
  assert.equal((await pg.query("SELECT public.xw_bump_attempt('limit-test',1) AS n")).rows[0].n,2);
  assert.equal((await pg.query("SELECT public.xw_bump_attempt('limit-test',2) AS n")).rows[0].n,1);
});
test('入口拦截跨域/简单表单；自定义家庭令牌不会被当成 CloudBase 登录令牌',async()=>{
  const f=await fixture(),token=await f.create(false);
  assert.equal((await f.call({action:'rotateInvite'},token,{headers:{origin:'https://outside.example'}})).status,403);
  assert.equal((await f.call({action:'rotateInvite'},token,{headers:{'x-xiaowu-request':''}})).status,403);
  assert.equal((await f.call(null,'',{headers:{authorization:'Bearer '+token}})).body.book,null);
  assert.equal((await f.call(null,token)).status,200);
  assert.equal((await f.call(null,token,{url:'/lib/book-service.mjs'})).status,404);
  assert.equal((await f.call(null,token,{url:'/.env'})).status,404);
  const favicon=await f.call(null,'',{url:'/favicon.svg'});assert.equal(favicon.status,200);
  assert.equal(favicon.headers['content-type'],'image/svg+xml');
});
test('错误信息不泄露服务端密钥；管理码错误过多会被持久限流',async()=>{
  const f=await fixture();
  for(let i=0;i<10;i++) assert.equal((await f.call({action:'resume',setupCode:'wrong'})).status,401);
  assert.equal((await f.call({action:'resume',setupCode})).status,429);
  const broken=createCloudbaseDb({envId:'local-test-env',apiKey:key,fetch:async()=>{throw new Error('secret '+key);}});
  await assert.rejects(broken.health(),error=>!error.message.includes(key)&&error.code==='INTERNAL_ERROR');
});
