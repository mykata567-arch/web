'use client';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Plus, Search, Users, ArrowRight, RefreshCw, Check, X, ChevronLeft, ChevronRight, Leaf, CalendarDays, Pencil, Trash2, Copy, CheckCircle2, Cloud, Sprout, ArrowUpRight, LogIn } from 'lucide-react';
import { splitPhrases, phraseOK, normalizeSelections, stageLabel } from '../lib/shared/model.mjs';
const TOKEN = 'xiaowu-family-access-v1', PENDING = 'xiaowu-family-pending-v1';
const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
const prettyDate = (value: string) => value ? value.replaceAll('-', '.') : '—';
const due = (word: any, date: string) => !word.mastered && word.nextReviewDate && word.nextReviewDate <= date;
const sortDue = (words: any[], date: string) => words.filter(w => due(w, date)).sort((a,b) => a.nextReviewDate.localeCompare(b.nextReviewDate) || b.errorCount - a.errorCount);
const historyLabel = (record: any) => record.type === 'seed' ? '导入初始错字' : record.type === 'mistake' ? `听写出错 · ${record.occurrences}次` : record.correct ? record.afterMastered ? '会了 · 阶段性掌握' : `会了 · 连续${record.afterStreak}次` : '还不会 · 明天再练';

export default function Wordbook({ signInPath }: { signInPath: string }) {
  const [book, setBook] = useState<any>(null), [profile, setProfile] = useState<any>({}), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [toast, setToast] = useState(''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [view, setView] = useState('book'), [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [modal, setModal] = useState(''), [name, setName] = useState('小五的错字本'), [memberName, setMemberName] = useState('爸爸'), [invite, setInvite] = useState(''), [withSeed, setWithSeed] = useState(true);
  const [input, setInput] = useState(''), [rows, setRows] = useState<any[]>([]), [detailId, setDetailId] = useState(''), [editing, setEditing] = useState(false), [phrases, setPhrases] = useState(''), [confirmDelete, setConfirmDelete] = useState(false), [copied, setCopied] = useState(false);
  const [session, setSession] = useState<any>(null), [revealed, setRevealed] = useState(false), [feedback, setFeedback] = useState(''), [synced, setSynced] = useState('');
  const tokenRef = useRef(''), lock = useRef(false), modalRef = useRef<HTMLDivElement>(null);
  const word = book?.words.find((w: any) => w.id === detailId);
  const current = session?.words[session.index];

  async function request(method = 'GET', event?: any, token = tokenRef.current) {
    let response;
    try { response = await fetch('/api/book', { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, ...(event ? { body: JSON.stringify(event) } : {}), cache: 'no-store' }); }
    catch { const e: any = new Error('网络暂时连接不上，请联网后重试。'); e.code = 'NETWORK'; throw e; }
    let result: any;
    try { result = await response.json(); } catch { const e: any = new Error('暂时没有收到保存结果，请重试确认。'); e.code = 'NETWORK'; throw e; }
    if (!response.ok) { const e: any = new Error(result.message || '这次操作没有完成，请重试'); e.code = result.error || 'INTERNAL_ERROR'; throw e; }
    return result;
  }
  function remember(token: string) { tokenRef.current = token; localStorage.setItem(TOKEN, token); }
  async function sendPending(pending: any) {
    try {
      const result = await request('POST', pending.event, pending.token);
      if (result.authToken) remember(result.authToken);
      localStorage.removeItem(PENDING); setUncertain(false);
      return result;
    } catch (e: any) {
      if (!['NETWORK','INTERNAL_ERROR','BUSY'].includes(e.code)) { localStorage.removeItem(PENDING); setUncertain(false); }
      else setUncertain(true);
      throw e;
    }
  }
  async function recover() { const pending = localStorage.getItem(PENDING); if (pending) return sendPending(JSON.parse(pending)); }
  async function fetchBook() {
    const data = await request(); setProfile(data); setBook(data.book); setSynced(new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})); return data.book;
  }
  async function sync() {
    if (lock.current) return; lock.current = true; setBusy(true); setError('');
    try { await recover(); await fetchBook(); } catch (e: any) {
      setError(e.message);
      if (e.code === 'UNAUTHORIZED') { tokenRef.current = ''; localStorage.removeItem(TOKEN); setBook(null); }
    } finally { lock.current = false; setBusy(false); setLoading(false); }
  }
  async function mutate(action: string, data: any = {}) {
    if (lock.current) return null;
    lock.current = true; setBusy(true); setError('');
    try {
      await recover();
      const pending = { token: tokenRef.current, event: { action, ...data, requestId: uid() } };
      localStorage.setItem(PENDING, JSON.stringify(pending));
      const result = await sendPending(pending);
      try { await fetchBook(); } catch { setError('本次操作已保存，刷新暂时失败，请稍后刷新字本。'); }
      return result;
    } catch (e: any) {
      setError(e.message);
      if (['STALE_WORD','NOT_FOUND','NOT_DUE','ALREADY_REVIEWED'].includes(e.code)) { await fetchBook().catch(()=>{}); setSession(null); setView('book'); }
      return null;
    } finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { tokenRef.current = localStorage.getItem(TOKEN) || ''; sync(); }, []);
  useEffect(() => { if (!toast) return; const timer = setTimeout(()=>setToast(''),3500); return ()=>clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const timer = setTimeout(()=>modalRef.current?.querySelector<HTMLElement>('input,textarea,button')?.focus(),50);
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !lock.current) setModal('');
      if (event.key === 'Tab') {
        const targets = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea,a[href]') || []);
        if (!targets.length) return;
        if (event.shiftKey && document.activeElement === targets[0]) { event.preventDefault(); targets.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === targets.at(-1)) { event.preventDefault(); targets[0].focus(); }
      }
    }; document.addEventListener('keydown',handle);
    return ()=>{clearTimeout(timer);document.body.style.overflow=old;document.removeEventListener('keydown',handle);previous?.focus();};
  }, [modal]);
  function open(type: string) { setError('');setCopied(false);setConfirmDelete(false);setEditing(false);setModal(type); }
  function openWord(w: any) { setDetailId(w.id); setPhrases(w.phrases.join('、')); open('detail'); }
  function parse() {
    try {
      const list = splitPhrases(input);
      if (!list.length || list.length > 30 || list.some((p: string)=>!phraseOK(p))) throw new Error('请输入1～30个词语，用逗号或换行分隔，每词最多12个汉字。');
      setRows(list.map((phrase: string)=>({ phrase, chars: Array.from(new Set(Array.from(phrase))).map(character=>({ character, selected:false })) })));
    } catch (e: any) { setError(e.message); }
  }
  const selected = new Set(rows.flatMap(r=>r.chars.filter((c:any)=>c.selected).map((c:any)=>c.character)));
  async function saveWords() {
    const items = rows.map(r=>({phrase:r.phrase,characters:r.chars.filter((c:any)=>c.selected).map((c:any)=>c.character)})).filter(r=>r.characters.length);
    try { normalizeSelections(items); } catch(e:any) {setError(e.message);return;}
    const result = await mutate('add',{items});
    if (result) { setModal('');setRows([]);setInput('');setToast(`已记好：新增${result.added}字，更新${result.updated}字。明天再来复习。`); }
  }
  async function startReview() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      await recover();
      const latest = await fetchBook();
      const tasks = sortDue(latest.words,latest.today).slice(0,latest.rules.sessionSize);
      setSession({words:tasks,index:0,correct:0,wrong:0});setRevealed(false);setFeedback('');setView('review');
    } catch(e:any) {setError(e.message);} finally {lock.current=false;setBusy(false);}
  }
  async function answer(correct: boolean) {
    const result = await mutate('review',{wordId:current.id,version:current.version,correct});
    if (!result) return;
    setSession((s:any)=>({...s,correct:s.correct+(correct?1:0),wrong:s.wrong+(correct?0:1)}));
    setFeedback(result.word.mastered ? '这个字已经阶段性掌握啦！' : correct ? `记下了！下次复习：${prettyDate(result.word.nextReviewDate)}` : '没关系，明天再来试试。');
  }
  function next() {setSession((s:any)=>({...s,index:s.index+1}));setRevealed(false);setFeedback('');}
  async function createFamily() {
    const result = await mutate('create',{name,memberName,importSample:withSeed});
    if(result){setModal('');setToast('家庭字本已经准备好啦');}
  }
  async function joinFamily() {
    const result = await mutate('join',{code:invite,memberName});
    if(result){setModal('');setToast('已经加入家人的字本');}
  }
  async function copyInvite() {
    try { await navigator.clipboard.writeText(book.inviteCode);setCopied(true); } catch { setError('请长按邀请码，选择复制。'); }
  }
  const words = book?.words || [], dueWords = book ? sortDue(words,book.today) : [];
  const mastered = words.filter((w:any)=>w.mastered).length;
  const todayReviews = book?.reviews.filter((r:any)=>r.type==='review'&&r.date===book.today) || [];
  const shown = words.filter((w:any)=>(filter==='all'||filter==='due'&&due(w,book.today)||filter==='mastered'&&w.mastered)&&(!search||w.character.includes(search)||w.phrases.some((p:string)=>p.includes(search)))).sort((a:any,b:any)=>Number(due(b,book.today))-Number(due(a,book.today))||b.updatedAt.localeCompare(a.updatedAt));
  const modalTitle:any = {add:'今天，哪些字不会写？',detail:word?`“${word.character}”的成长记录`:'字的成长记录',family:'一家人，共用一本字',create:'创建家庭字本',join:'加入家人的字本'};

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="小五易错字首页"><span className="brand-mark"><BookOpen size={23}/></span><span>小五易错字<small>一家人，一本字</small></span></a>
      <nav className="desktop-nav" aria-label="主导航"><button className={view==='book'?'active':''} onClick={()=>setView('book')}><BookOpen size={17}/>错字本</button><button className={view==='review'?'active':''} onClick={()=>{setView('review');}}><Pencil size={17}/>听写复习</button></nav>
      <button className="family-button" onClick={()=>book?open('family'):open('join')}><Users size={18}/><span>{book?'我的家庭':'加入家庭'}</span></button></header>
    <main className="main-wrap">
      {error && !modal && <div className="alert" role="alert"><span>{error}</span><button onClick={()=>uncertain?sync().then(()=>{setSession(null);setView('book');}):setError('')}>{uncertain?'重试确认':'知道了'}</button></div>}
      {loading ? <div className="loading-state"><Sprout className="loading-leaf" size={32}/><p>正在打开家庭字本…</p></div> : !book ? <section className="welcome">
        <div className="welcome-copy"><span className="eyebrow"><span/> 每天一点点，慢慢记牢</span><h1>不会的字，<br/>一起慢慢<span>学会。</span></h1><p>把听写里的小小卡点记下来，<br/>让每次复习，都刚好在需要的时候。</p><div className="welcome-actions"><button className="btn primary" onClick={()=>open('create')}>创建家庭字本<ArrowRight size={18}/></button><button className="text-button" onClick={()=>{setMemberName('');open('join');}}>我有家人的邀请码<ArrowUpRight size={17}/></button></div><div className="welcome-meta"><Cloud size={15}/>云端保存<em/>全家共用<em/>自动安排复习</div></div>
        <div className="welcome-art" aria-hidden="true"><div className="paper-note"><span className="note-label">小五的第一本易错字</span><div className="art-grid"><span>形</span><span>状</span><span>山</span><span className="circle-word">顶</span></div><div className="note-line"><span className="tiny-dot"/>今天记下，明天再试试</div><div className="paper-rule"/><div className="paper-rule short"/></div><span className="art-stamp">一点点<br/>也算数</span><Sprout className="art-leaf" size={70} strokeWidth={1.2}/><span className="handwritten">和家人一起进步</span></div>
        <div className="welcome-bottom"><span>01 记下不会的字</span><span>02 每天写一写</span><span>03 一起看见进步</span></div>
        {profile.canResume && <button className="resume-button" disabled={busy} onClick={async()=>{const r=await mutate('resume');if(r)setToast('已经找回你的字本');}}>已经创建过？找回我的字本<ArrowRight size={16}/></button>}
      </section> : view==='book' ? <>
        <section className="page-heading"><div><span className="eyebrow">FAMILY WORDBOOK / 家庭易错字本</span><h1>{book.name}</h1><p>不着急，一次学会一个字就很好。</p></div><div className="sync-group"><span><span className="online-dot"/>云端已同步 · {synced}</span><button className="icon-button" aria-label="刷新家庭字本" onClick={sync} disabled={busy}><RefreshCw size={18} className={busy?'spin':''}/></button></div></section>
        <div className="dashboard-grid"><aside className="today-panel"><div className="date-tag"><CalendarDays size={16}/>{prettyDate(book.today)}</div><h2>今天，写一点。</h2><p className="today-copy">准备好纸和笔，<br/>让记忆再深一点点。</p><div className="due-number">{dueWords.length}<span>个字等你复习</span></div><button className="btn primary full" disabled={busy||!dueWords.length} onClick={startReview}>{dueWords.length?'开始今日听写':'今天的任务已完成'}<ArrowRight size={18}/></button><div className="panel-foot">每轮最多10字，累了就休息一下。</div><div className="panel-decoration" aria-hidden="true"><Leaf size={65} strokeWidth={.8}/></div></aside>
        <section className="book-content"><div className="stat-row"><div className="stat-block"><span>字本里的小挑战</span><strong>{words.length}<small>个字</small></strong></div><div className="stat-block"><span>已阶段性掌握</span><strong>{mastered}<small>个字</small></strong></div><div className="stat-block"><span>今天已经练习</span><strong>{todayReviews.length}<small>个字</small></strong></div></div>
          <div className="list-top"><h2>我的错字本<span>{words.length}</span></h2><button className="btn primary compact" onClick={()=>{setInput('');setRows([]);open('add');}}><Plus size={17}/>添加错字</button></div>
          <div className="list-controls"><div className="filter-tabs" role="group" aria-label="筛选错字"><button className={filter==='all'?'selected':''} onClick={()=>setFilter('all')}>全部</button><button className={filter==='due'?'selected':''} onClick={()=>setFilter('due')}>待复习<span>{dueWords.length}</span></button><button className={filter==='mastered'?'selected':''} onClick={()=>setFilter('mastered')}>已掌握</button></div><label className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="找一个字或词语" aria-label="搜索汉字或词语"/></label></div>
          {shown.length ? <div className="word-grid">{shown.map((w:any)=><button className="word-card" key={w.id} onClick={()=>openWord(w)}><span className="tianzi">{w.character}</span><span className="word-info"><strong>{w.phrases.join('、')}</strong><span className={w.mastered?'word-status mastered':due(w,book.today)?'word-status is-due':'word-status'}>{w.mastered?<><CheckCircle2 size={12}/>阶段性掌握</>:due(w,book.today)?<><span className="status-dot"/>今天待复习</>:<><CalendarDays size={12}/>{prettyDate(w.nextReviewDate)}复习</>}</span></span><span className="word-count">{w.errorCount}<small>次出错</small></span><ChevronRight size={15} className="word-chevron"/></button>)}</div>:<div className="empty-state"><Sprout size={35} strokeWidth={1.2}/><h3>{words.length?'这里暂时没有字':'从第一个字开始'}</h3><p>{words.length?'换个筛选条件或关键词试试。':'记录听写里的易错字，明天就会安排复习。'}</p>{!words.length&&<button className="btn secondary" disabled={busy} onClick={async()=>{const r=await mutate('seed');if(r)setToast('25个初始易错字已导入');}}>导入现有的25个易错字</button>}</div>}
          <div className="list-hint"><Leaf size={13}/>点击一个字，看看它的成长记录。</div>
        </section></div>
      </> : <section className="review-page"><button className="back-link" onClick={()=>setView('book')}><ChevronLeft size={17}/>回到错字本</button><div className="review-heading"><span className="eyebrow">一点练习，一点进步</span><h1>今日听写</h1><p>把答案写在纸上，再请家长帮忙核对。</p></div>
        {!session ? <div className="review-start card"><div className="tianzi large"><Pencil size={37} strokeWidth={1.4}/></div><h2>{dueWords.length?`今天有${dueWords.length}个字等你复习`:'今天没有待复习的字啦'}</h2><p>每轮最多10个字，按自己的节奏慢慢来。</p><button className="btn primary" onClick={startReview} disabled={busy||!dueWords.length}>开始这一轮<ArrowRight size={17}/></button></div>:!current?<div className="review-finished card"><span className="success-flower"><Check size={37}/></span><h2>{session.words.length?'这一轮，完成啦！':'今天暂时没有待复习的字'}</h2><p>每一次认真练习，都在让记忆更清楚。</p><div className="result-counts"><div><strong>{session.correct}</strong><span>会了</span></div><div><strong>{session.wrong}</strong><span>明天再试</span></div></div><p className="muted">结果已保存到家庭字本。{dueWords.length?`今天还有${dueWords.length}个待复习的字。`:'今天的任务已经完成，去休息一下吧。'}</p><div className="finish-buttons">{dueWords.length>0&&<button className="btn primary" disabled={busy} onClick={startReview}>继续下一轮<ArrowRight size={17}/></button>}<button className="btn secondary" onClick={()=>{setView('book');setSession(null);}}>回到错字本</button></div></div>:<>
          <div className="review-progress"><span>第 <b>{session.index+1}</b> / {session.words.length} 个字</span><span>家长陪伴练习</span><div className="progress-track"><span style={{width:((session.index+(feedback?1:0))/session.words.length*100)+'%'}}/></div></div>
          <div className="dictation-card"><span className="prompt-label">请写出括号里缺少的字</span><div className="cloze">{Array.from(current.phrases[0]).map((c:any,i:number)=>c===current.character?<span className="blank-char" key={i}>{revealed?<span>{c}</span>:<i/>}</span>:<span key={i}>{c}</span>)}</div>{revealed?<div className="answer-label">正确答案：<b>{current.character}</b><span> · {current.phrases[0]}</span></div>:<button className="btn reveal-button" onClick={()=>setRevealed(true)}>写好了，查看答案<ChevronRight size={16}/></button>}<div className="dictation-note">{revealed?'请家长核对纸上的答案，再判断是否会写。':'先试着写一写，不着急看答案。'}</div></div>
          {feedback?<div className="feedback-box" role="status"><CheckCircle2 size={19}/><span>{feedback}</span><button className="btn primary" onClick={next}>{session.index+1===session.words.length?'查看本轮结果':'下一个字'}<ArrowRight size={16}/></button></div>:revealed?<div className="answer-actions"><button className="btn secondary" disabled={busy||uncertain} onClick={()=>answer(false)}>还不会，明天再试</button><button className="btn primary" disabled={busy||uncertain} onClick={()=>answer(true)}><Check size={18}/>会了</button></div>:null}
        </>}
      </section>}
      <footer className="page-footer"><Sprout size={15}/><span>每一个学会的字，都值得被看见。</span><small>小五易错字 · V0.1</small></footer>
    </main>
    {book&&<nav className="mobile-nav" aria-label="手机主导航"><button className={view==='book'?'active':''} onClick={()=>setView('book')}><BookOpen size={21}/>错字本</button><button className={view==='review'?'active':''} onClick={()=>setView('review')}><Pencil size={21}/>听写复习</button></nav>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/>{toast}</div>}
    {modal&&<div className="modal-backdrop" onClick={()=>!busy&&setModal('')}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={modalRef} onClick={e=>e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">小五易错字</span><h2 id="modal-title">{modalTitle[modal]}</h2></div><button className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={()=>setModal('')}><X size={21}/></button></div>
      {error&&<div className="alert" role="alert"><span>{error}</span>{uncertain&&<button onClick={()=>sync()}>重试确认</button>}</div>}
      {modal==='create'&&<><p className="modal-intro">给孩子一本字本，也给家人一个共同陪伴的地方。</p><label className="field">字本名称<input value={name} onChange={e=>setName(e.target.value)} maxLength={20}/></label><label className="field">家人怎么称呼你<input value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="例如：爸爸" maxLength={20}/></label><label className="checkbox-row"><input type="checkbox" checked={withSeed} onChange={e=>setWithSeed(e.target.checked)}/><span>导入现有的25个易错字<small>2026.10.25记录 · 顶计2次，其余各1次</small></span></label>{profile.signedIn?<button className="btn primary full" disabled={busy||!name.trim()||!memberName.trim()} onClick={createFamily}>{busy?'正在准备…':'创建并打开字本'}<ArrowRight size={17}/></button>:<><a className="btn primary full" href={signInPath} target="_top"><LogIn size={18}/>登录ChatGPT，创建字本</a><p className="fine-print">创建者登录一次便于换设备找回。妈妈和外婆凭家庭邀请码就能加入。</p></>}{profile.canResume&&<button className="text-button centered" disabled={busy} onClick={async()=>{if(await mutate('resume'))setModal('');}}>找回我已经创建的字本</button>}</>}
      {modal==='join'&&<><p className="modal-intro">填写家人发来的邀请码，就能一起记录、一起复习。</p><label className="field">家庭邀请码<input className="code-input" value={invite} onChange={e=>setInvite(e.target.value)} placeholder="粘贴16位邀请码" autoComplete="off" maxLength={30}/></label><label className="field">家人怎么称呼你<input value={memberName} onChange={e=>setMemberName(e.target.value)} placeholder="例如：妈妈、外婆" maxLength={20}/></label><button className="btn primary full" disabled={busy||!invite.trim()||!memberName.trim()} onClick={joinFamily}>{busy?'正在加入…':'加入家庭字本'}<ArrowRight size={17}/></button><p className="fine-print">加入后可查看和修改这本字本。请只使用家人私下发给你的邀请码。</p></>}
      {modal==='add'&&<><p className="modal-intro">先输入听写词语，再点亮具体不会写的字。</p><label className="field">输入词语，用逗号或换行分开<textarea value={input} onChange={e=>{setInput(e.target.value);setRows([]);}} placeholder="例如：形状、山顶、弯曲" rows={3} maxLength={500} disabled={busy}/></label><button className="btn secondary full" disabled={!input.trim()||busy} onClick={parse}>拆成汉字，开始选择</button>{rows.length>0&&<><div className="selection-list">{rows.map((r,i)=><div className="selection-row" key={r.phrase}><span>{r.phrase}</span><div>{r.chars.map((c:any,j:number)=><button aria-pressed={c.selected} disabled={busy} className={'select-char '+(c.selected?'chosen':'')} key={c.character} onClick={()=>setRows(rows.map((row,ri)=>ri!==i?row:{...row,chars:row.chars.map((char:any,ci:number)=>ci!==j?char:{...char,selected:!char.selected})}))}>{c.character}</button>)}</div></div>)}</div><p className="fine-print">已选{selected.size}个不同的字。同一字在不同词语里出错，会分别累计次数。</p><button className="btn primary full" disabled={!selected.size||busy||uncertain} onClick={saveWords}>{busy?'正在保存…':`保存${selected.size}个易错字`}<Check size={17}/></button></>}</>}
      {modal==='detail'&&word&&<><div className="detail-hero"><span className="tianzi large">{word.character}</span><div><h3>{word.phrases.join('、')}</h3><span className="stage-badge">{stageLabel(word)}</span></div></div><dl className="detail-facts"><div><dt>首次记录</dt><dd>{prettyDate(word.firstRecordedDate)}</dd></div><div><dt>最近出错</dt><dd>{prettyDate(word.lastErrorDate)}</dd></div><div><dt>累计出错</dt><dd>{word.errorCount}次</dd></div><div><dt>复习次数</dt><dd>{word.reviewCount}次</dd></div><div className="wide"><dt>下次复习</dt><dd>{word.mastered?'已阶段性掌握':prettyDate(word.nextReviewDate)}</dd></div></dl>{editing?<div className="edit-area"><label className="field">修改对应词语<textarea rows={2} value={phrases} onChange={e=>setPhrases(e.target.value)}/></label><p className="fine-print">用顿号分隔，每个词语都应包含“{word.character}”。汉字填错时，请删除后重新添加。</p><button className="btn primary full" disabled={busy} onClick={async()=>{if(await mutate('edit',{wordId:word.id,version:word.version,phrases:splitPhrases(phrases)}))setEditing(false);}}>保存词语</button></div>:<div className="detail-tools"><button className="text-button" onClick={()=>setEditing(true)}><Pencil size={15}/>编辑词语</button><button className="text-button danger" onClick={()=>setConfirmDelete(true)}><Trash2 size={15}/>删除错字</button></div>}{confirmDelete&&<div className="delete-confirm"><p>删除“{word.character}”后，家人的字本和待复习也会移除这个字。重新录入仍保留历史。</p><div><button className="btn secondary" disabled={busy} onClick={()=>setConfirmDelete(false)}>取消</button><button className="btn danger-btn" disabled={busy} onClick={async()=>{if(await mutate('delete',{wordId:word.id,version:word.version}))setModal('');}}>确认删除</button></div></div>}<h3 className="section-label">每次练习，都留在这里</h3><div className="history-list">{[...book.reviews].filter((r:any)=>r.wordId===word.id).sort((a:any,b:any)=>b.createdAt.localeCompare(a.createdAt)).map((r:any)=><div className="history-item" key={r.id}><span className={'history-dot '+(r.correct?'green':'')}/><div><strong>{historyLabel(r)}</strong><small>{prettyDate(r.date)} · {r.by||'家人'}{r.nextReviewDate?' · 下次'+prettyDate(r.nextReviewDate):''}</small></div></div>)}</div></>}
      {modal==='family'&&book&&<><div className="family-title"><Users size={24}/><div><strong>{book.name}</strong><small>{book.members.length}位家人，一起陪孩子</small></div></div><div className="member-list">{book.members.map((m:any)=><div key={m.id}><span className="member-avatar">{m.name.slice(0,1)}</span><strong>{m.name}</strong><span>{m.creator?'创建者':m.id===book.member.id?'我':'家人'}</span></div>)}</div>{book.member.creator?<div className="invite-panel"><h3>邀请另一位家人</h3><p>把网站链接和邀请码私下发给家人。</p><div className="invite-code">{book.inviteCode}</div><small>有效至{prettyDate(book.inviteExpiresAt.slice(0,10))} · 加入后可共同维护字本</small><div className="invite-actions"><button className="btn primary" onClick={copyInvite}>{copied?<Check size={16}/>:<Copy size={16}/>} {copied?'已经复制':'复制邀请码'}</button><button className="text-button" disabled={busy} onClick={async()=>{if(await mutate('rotateInvite')){setCopied(false);setToast('邀请码已更新，旧码立即失效');}}}>更新邀请码</button></div></div>:<div className="soft-note"><Cloud size={18}/>你可以添加、修改、删除错字，也可以陪孩子完成听写。邀请更多家人，请联系创建者。</div>}<p className="fine-print">当前设备已记住家庭入口。清除浏览器数据后，创建者可登录找回，其他家人可再次使用邀请码加入。</p><button className="text-button muted centered" disabled={busy} onClick={()=>{tokenRef.current='';localStorage.removeItem(TOKEN);setBook(null);setProfile({});setSession(null);setModal('');setView('book');sync();}}>这台设备改用其他家庭入口</button></>}
    </div></div>}
  </div>;
}
