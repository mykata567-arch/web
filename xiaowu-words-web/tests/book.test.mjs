import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { createBookService } from '../lib/book-service.mjs';
import { addDays, today } from '../lib/shared/date.mjs';
let sequence = 0;
const rid = () => 'request_' + String(++sequence).padStart(18,'0');
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const db = { prepare(sql) { return { bind(...args) { return { async first() { return sqlite.prepare(sql).get(...args)||null; }, async run() { const r=sqlite.prepare(sql).run(...args); return {meta:{changes:Number(r.changes)}}; } }; } }; } };
  let now=Date.parse('2026-10-26T04:00:00Z');
  const service=createBookService(db,{now:()=>now});
  const act=(event,token='',ownerId)=>service.action({requestId:rid(),...event},token,ownerId,'test-client');
  async function family(ownerId='father',importSample=true) { return (await act({action:'create',name:'测试字本',memberName:'爸爸',importSample},'',ownerId)).authToken; }
  return {service,act,family,db,setDate:date=>{now=Date.parse(date+'T04:00:00Z');},book:async token=>(await service.session(token)).book};
}

test('初始25字、顶2次、无小五山，匿名请求不能创建或读取字本',async()=>{
 const f=setup();
 await assert.rejects(f.act({action:'create',name:'字本',memberName:'爸爸'}),{code:'SIGN_IN_REQUIRED'});
 const token=await f.family();const book=await f.book(token);
 assert.equal(book.words.length,25);assert.equal(book.words.find(w=>w.character==='顶').errorCount,2);
 assert.equal(book.words.filter(w=>['小','五','山'].includes(w.character)).length,0);
 assert.equal(book.dueCount,25);assert.ok(book.words.every(w=>w.firstRecordedDate==='2026-10-25'));
 assert.equal((await f.service.session('',null)).book,null);
 await assert.rejects(f.book(token.slice(0,-4)+'fake'),{code:'UNAUTHORIZED'});
});
test('三个独立家庭凭证：爸爸添加，妈妈次日读取，外婆复习，父母看到更新',async()=>{
 const f=setup();const father=await f.family('father',false);const initial=await f.book(father);
 const mother=(await f.act({action:'join',code:initial.inviteCode,memberName:'妈妈'})).authToken;
 const grandma=(await f.act({action:'join',code:initial.inviteCode,memberName:'外婆'})).authToken;
 assert.equal((await f.book(mother)).inviteCode,'');
 await f.act({action:'add',items:[{phrase:'山顶',characters:['顶']}]},father);
 assert.equal((await f.book(mother)).dueCount,0);f.setDate('2026-10-27');
 const word=(await f.book(grandma)).words[0];
 await f.act({action:'review',wordId:word.id,version:word.version,correct:true},grandma);
 for(const token of [father,mother]) {const book=await f.book(token);assert.equal(book.words[0].streak,1);assert.equal(book.words[0].nextReviewDate,'2026-10-30');assert.equal(book.reviews.filter(r=>r.type==='review').length,1);}
 assert.equal((await f.book(father)).members.length,3);
});
test('SQL乐观并发：同字同时复习只有一个成功，重试原请求只计一次',async()=>{
 const f=setup();const father=await f.family();const book=await f.book(father);
 const mother=(await f.act({action:'join',code:book.inviteCode,memberName:'妈妈'})).authToken;
 const word=book.words[0];const request={action:'review',wordId:word.id,version:word.version,correct:true,requestId:rid()};
 const result=await Promise.allSettled([f.act(request,father),f.act({...request,requestId:rid(),correct:false},mother)]);
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.code,'STALE_WORD');
 await f.act(request,father);const updated=(await f.book(father)).words.find(w=>w.id===word.id);assert.equal(updated.reviewCount,1);assert.equal(updated.streak,1);
});
test('并发添加合并，丢失响应后同一请求重放不多算，跨词计数正确',async()=>{
 const f=setup();const token=await f.family('father',false);
 const first={action:'add',items:[{phrase:'山顶',characters:['顶']}],requestId:rid()};
 await f.act(first,token);await f.act(first,token);
 await Promise.all([f.act({action:'add',items:[{phrase:'顶楼',characters:['顶','楼']}]},token),f.act({action:'add',items:[{phrase:'山顶',characters:['顶']}]},token)]);
 const words=(await f.book(token)).words;assert.equal(words.length,2);assert.equal(words.find(w=>w.character==='顶').errorCount,3);
 await assert.rejects(f.act({...first,items:[{phrase:'枝叶',characters:['枝']}]},token),{code:'REQUEST_CONFLICT'});
});
test('编辑、删除与重新录入保持共享和历史，跨家庭ID无法越权',async()=>{
 const f=setup();const token=await f.family();const other=await f.family('another',false);
 let word=(await f.book(token)).words.find(w=>w.character==='顶');
 await assert.rejects(f.act({action:'delete',wordId:word.id,version:word.version},other),{code:'NOT_FOUND'});
 await f.act({action:'edit',wordId:word.id,version:word.version,phrases:['头顶']},token);
 word=(await f.book(token)).words.find(w=>w.id===word.id);assert.deepEqual(word.phrases,['头顶']);
 await f.act({action:'delete',wordId:word.id,version:word.version},token);assert.equal((await f.book(token)).words.length,24);
 await f.act({action:'add',items:[{phrase:'山顶',characters:['顶']}]},token);
 const restored=(await f.book(token)).words.find(w=>w.id===word.id);assert.equal(restored.errorCount,3);assert.equal(restored.firstRecordedDate,'2026-10-25');
});
test('复习按次日/3/7/14天推进，第四次掌握，出错重新激活',async()=>{
 const f=setup();const token=await f.family('father',false);await f.act({action:'add',items:[{phrase:'形状',characters:['形']}]},token);
 let word=(await f.book(token)).words[0];assert.equal(word.nextReviewDate,'2026-10-27');
 for(const date of ['2026-10-27','2026-10-30','2026-11-06','2026-11-20']) {f.setDate(date);await f.act({action:'review',wordId:word.id,version:word.version,correct:true},token);word=(await f.book(token)).words[0];}
 assert.equal(word.mastered,true);assert.equal(word.streak,4);assert.equal(word.nextReviewDate,null);
 await f.act({action:'add',items:[{phrase:'形状',characters:['形']}]},token);word=(await f.book(token)).words[0];assert.equal(word.mastered,false);assert.equal(word.nextReviewDate,'2026-11-21');
 f.setDate('2026-11-21');await f.act({action:'review',wordId:word.id,version:word.version,correct:false},token);word=(await f.book(token)).words[0];assert.equal(word.streak,0);assert.equal(word.nextReviewDate,'2026-11-22');
});
test('邀请码更新、过期、成员权限与创建者找回',async()=>{
 const f=setup();const token=await f.family();const book=await f.book(token);
 const join={action:'join',code:book.inviteCode,memberName:'妈妈',requestId:rid()};
 const first=await f.act(join);assert.equal((await f.act(join)).authToken,first.authToken);
 await assert.rejects(f.act({action:'rotateInvite'},first.authToken),{code:'FORBIDDEN'});
 await f.act({action:'rotateInvite'},token);await assert.rejects(f.act({action:'join',code:book.inviteCode,memberName:'外婆'}),{code:'INVITE_INVALID'});
 const fresh=(await f.book(token)).inviteCode;f.setDate('2026-11-03');await assert.rejects(f.act({action:'join',code:fresh,memberName:'外婆'}),{code:'INVITE_INVALID'});
 const resumed=(await f.act({action:'resume'},'','father')).authToken;assert.equal((await f.book(resumed)).id,book.id);
 await assert.rejects(f.act({action:'resume'},'','outsider'),{code:'NOT_FOUND'});
});
test('北京时间换日，闰年与月末不受设备时区影响',()=>{
 assert.equal(today(Date.parse('2026-10-25T15:59:59Z')),'2026-10-25');assert.equal(today(Date.parse('2026-10-25T16:00:00Z')),'2026-10-26');assert.equal(addDays('2028-02-28',1),'2028-02-29');
});
