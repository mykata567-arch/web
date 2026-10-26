import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addMistake, applyReview, normalizeSelections, phraseOK, dueWords, fail } from './shared/model.mjs';
import { today } from './shared/date.mjs';
import RULES from './shared/rules.mjs';
import SEED from './shared/seed.json' with { type: 'json' };
const hash = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(24).toString('hex');
const code = () => randomBytes(8).toString('hex').toUpperCase();
const checkedName = value => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 20 || /[\n\r<>]/.test(value)) fail('INVALID_INPUT', '名称请填写1～20个字');
  return value.trim();
};
export function createBookService(db, options = {}) {
  const instant = options.now || (() => Date.now());
  const stamp = () => new Date(instant()).toISOString();
  async function row(id) { return db.prepare('SELECT * FROM wordbooks WHERE id = ?').bind(id).first(); }
  async function owner(id) { return db.prepare('SELECT * FROM wordbooks WHERE owner_id = ?').bind(id).first(); }
  function authenticate(record, token) {
    if (!record || typeof token !== 'string') fail('UNAUTHORIZED', '请先创建或加入家庭字本');
    const parts = token.split('.');
    const state = JSON.parse(record.state);
    const member = state.members.find(m => m.id === parts[1] && m.keys.includes(hash(parts[2] || '')));
    if (parts.length !== 3 || parts[0] !== record.id || !member) fail('UNAUTHORIZED', '家庭入口已失效，请使用邀请码重新加入');
    return { state, member };
  }
  async function authorized(token) {
    if (typeof token !== 'string' || token.length > 200) fail('UNAUTHORIZED', '请先加入家庭');
    const record = await row(token.split('.')[0]);
    return { record, ...authenticate(record, token) };
  }
  async function modify(id, work) {
    for (let attempt = 0; attempt < 7; attempt++) {
      const record = await row(id);
      if (!record) fail('NOT_FOUND', '家庭字本不存在');
      const state = JSON.parse(record.state);
      const result = await work(state, record);
      if (result.readOnly) return result.value;
      const saved = await db.prepare('UPDATE wordbooks SET state = ?, revision = revision + 1, invite_hash = ? WHERE id = ? AND revision = ?')
        .bind(JSON.stringify(state), hash(state.inviteCode), id, record.revision).run();
      if (saved.meta.changes === 1) return result.value;
    }
    fail('BUSY', '家人正在更新字本，请稍后重试这次操作');
  }
  async function limit(key, maximum = 20) {
    const window = Math.floor(instant() / 600000);
    const saved = await db.prepare('INSERT INTO access_attempts (key, window, count) VALUES (?, ?, 1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN access_attempts.window = excluded.window THEN access_attempts.count + 1 ELSE 1 END, window = excluded.window RETURNING count')
      .bind(hash(key), window).first();
    if (saved.count > maximum) fail('RATE_LIMIT', '尝试较多，请10分钟后再试');
  }
  function publicBook(record, state, member) {
    const words = Object.values(state.words).filter(w => !w.deleted);
    const date = today(instant());
    return { id: record.id, name: state.name, today: date, revision: record.revision, rules: RULES,
      member: { id: member.id, name: member.name, creator: member.creator },
      members: state.members.map(m => ({ id: m.id, name: m.name, creator: m.creator })),
      inviteCode: member.creator ? state.inviteCode : '', inviteExpiresAt: state.inviteExpiresAt,
      words, reviews: state.reviews, dueCount: dueWords(words, date).length };
  }
  return {
    async session(token, nativeId) {
      if (token) { const { record, state, member } = await authorized(token); return { book: publicBook(record, state, member), signedIn: !!nativeId }; }
      return { book: null, signedIn: !!nativeId, canResume: !!(nativeId && await owner(nativeId)) };
    },
    async action(event, token, nativeId, clientKey = 'unknown') {
      if (!event || !/^[A-Za-z0-9_-]{12,100}$/.test(event.requestId || '')) fail('INVALID_INPUT', '操作标识无效，请刷新重试');
      const { requestId, ...input } = event;
      const fingerprint = hash(JSON.stringify(input));
      const now = stamp();
      const day = today(instant());
      if (event.action === 'create') {
        if (!nativeId) fail('SIGN_IN_REQUIRED', '创建字本需要先登录；收到家庭邀请码的家人可以直接加入');
        await limit('create:' + nativeId, 10);
        const existing = await owner(nativeId);
        if (existing) {
          const state = JSON.parse(existing.state);
          if (state.initialRequest === requestId && state.initialFingerprint === fingerprint) return { authToken: state.initialToken };
          fail('ALREADY_EXISTS', '你已经有一个家庭字本，请选择“找回我的字本”');
        }
        const name = checkedName(event.name);
        const memberName = checkedName(event.memberName);
        const id = randomUUID(); const memberId = randomUUID(); const key = secret();
        const authToken = id + '.' + memberId + '.' + key;
        const state = { schemaVersion: 1, id, name, initialRequest: requestId, initialFingerprint: fingerprint, initialToken: authToken,
          members: [{ id: memberId, name: memberName, creator: true, keys: [hash(key)] }],
          inviteCode: code(), inviteExpiresAt: new Date(instant() + 7 * 86400000).toISOString(), words: {}, reviews: [], receipts: {}, sampleImported: false };
        if (event.importSample === true) {
          for (const entry of normalizeSelections(SEED.items)) {
            const wordId = randomUUID(); state.words[wordId] = { ...addMistake(null, entry, SEED.recordedDate, now), id: wordId, familyId: id, deleted: false };
            state.reviews.push({ id: randomUUID(), wordId, type: 'seed', date: SEED.recordedDate, occurrences: entry.occurrences, createdAt: now, by: memberName });
          }
          state.sampleImported = true;
        }
        const inserted = await db.prepare('INSERT INTO wordbooks (id, owner_id, state, revision, invite_hash, created_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(owner_id) DO NOTHING')
          .bind(id, nativeId, JSON.stringify(state), hash(state.inviteCode), now).run();
        if (inserted.meta.changes !== 1) {
          const winner = JSON.parse((await owner(nativeId)).state);
          if (winner.initialRequest === requestId && winner.initialFingerprint === fingerprint) return { authToken: winner.initialToken };
          fail('ALREADY_EXISTS', '家庭字本已经创建，请选择找回');
        }
        return { authToken };
      }
      if (event.action === 'resume') {
        if (!nativeId) fail('SIGN_IN_REQUIRED', '请登录创建字本时使用的ChatGPT账号');
        const record = await owner(nativeId);
        if (!record) fail('NOT_FOUND', '这个账号还没有创建过字本');
        return modify(record.id, state => {
          const receipt = state.receipts['resume:' + requestId];
          if (receipt) return { readOnly: true, value: receipt.result };
          const member = state.members.find(m => m.creator); const key = secret();
          member.keys.push(hash(key));
          const result = { authToken: record.id + '.' + member.id + '.' + key };
          state.receipts['resume:' + requestId] = { fingerprint, result };
          return { value: result };
        });
      }
      if (event.action === 'join') {
        await limit('join:' + clientKey);
        const invite = typeof event.code === 'string' ? event.code.replace(/[\s-]/g, '').toUpperCase() : '';
        const record = /^[A-F0-9]{16}$/.test(invite) ? await db.prepare('SELECT * FROM wordbooks WHERE invite_hash = ?').bind(hash(invite)).first() : null;
        if (!record) fail('INVITE_INVALID', '邀请码无效或已更新，请联系家人');
        const name = checkedName(event.memberName);
        return modify(record.id, state => {
          const receipt = state.receipts['join:' + requestId];
          if (receipt) {
            if (receipt.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', '这次操作内容已改变，请重新填写');
            return { readOnly: true, value: receipt.result };
          }
          if (state.inviteCode !== invite || state.inviteExpiresAt <= now) fail('INVITE_INVALID', '邀请码已过期，请创建者更新后再加入');
          let member = state.members.find(m => m.name === name && !m.creator);
          if (!member) {
            if (state.members.length >= 6) fail('FAMILY_FULL', '家庭成员已满，请联系创建者');
            member = { id: randomUUID(), name, creator: false, keys: [] }; state.members.push(member);
          }
          const key = secret(); member.keys.push(hash(key));
          const result = { authToken: record.id + '.' + member.id + '.' + key };
          state.receipts['join:' + requestId] = { fingerprint, result };
          return { value: result };
        });
      }
      const access = await authorized(token);
      return modify(access.record.id, (state, record) => {
        const { member } = authenticate({ ...record, state: JSON.stringify(state) }, token);
        const receiptKey = member.id + ':' + requestId;
        const receipt = state.receipts[receiptKey];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', '这次操作内容已改变，请重新提交');
          return { readOnly: true, value: receipt.result };
        }
        let result = {};
        const own = id => { const word = state.words[id]; if (!word || word.deleted) fail('NOT_FOUND', '这个字已删除或不存在'); return word; };
        const history = record => state.reviews.push({ id: randomUUID(), createdAt: now, date: day, by: member.name, ...record });
        if (event.action === 'add' || event.action === 'seed') {
          const seed = event.action === 'seed';
          if (seed && (state.sampleImported || Object.values(state.words).some(w => !w.deleted))) fail('SEED_NOT_EMPTY', '只能向空字本导入一次25字样本');
          const entries = normalizeSelections(seed ? SEED.items : event.items);
          let added = 0;
          for (const entry of entries) {
            const previous = Object.values(state.words).find(w => w.character === entry.character);
            const id = previous?.id || randomUUID();
            if (!previous || previous.deleted) added++;
            const word = { ...addMistake(previous, entry, seed ? SEED.recordedDate : day, now), id, familyId: state.id, deleted: false };
            state.words[id] = word;
            history({ wordId: id, type: seed ? 'seed' : 'mistake', date: seed ? SEED.recordedDate : day, occurrences: entry.occurrences, beforeStreak: previous?.streak || 0, afterStreak: 0, nextReviewDate: word.nextReviewDate });
          }
          state.sampleImported ||= seed;
          result = { added, updated: entries.length - added };
        } else if (['edit', 'delete', 'review'].includes(event.action)) {
          const word = own(event.wordId);
          if (word.version !== event.version) fail('STALE_WORD', '家人已更新这个字，已为你刷新字本，请重新查看');
          if (event.action === 'edit') {
            if (!Array.isArray(event.phrases) || !event.phrases.length || event.phrases.length > 20 || event.phrases.some(p => !phraseOK(p) || !p.includes(word.character))) fail('INVALID_INPUT', '请保留1～20个包含目标字的词语，每词最多12字');
            state.words[word.id] = { ...word, phrases: [...new Set(event.phrases)], version: word.version + 1, updatedAt: now };
          } else if (event.action === 'delete') {
            state.words[word.id] = { ...word, deleted: true, version: word.version + 1, updatedAt: now };
          } else {
            const updated = applyReview(word, event.correct, day, now);
            state.words[word.id] = updated;
            history({ wordId: word.id, type: 'review', correct: event.correct, beforeStreak: word.streak, afterStreak: updated.streak, beforeMastered: word.mastered, afterMastered: updated.mastered, nextReviewDate: updated.nextReviewDate });
            result = { word: updated };
          }
        } else if (event.action === 'rotateInvite') {
          if (!member.creator) fail('FORBIDDEN', '只有创建者可以更新邀请码');
          state.inviteCode = code(); state.inviteExpiresAt = new Date(instant() + 7 * 86400000).toISOString();
        } else fail('INVALID_ACTION', '暂不支持这项操作');
        state.receipts[receiptKey] = { fingerprint, result };
        return { value: result };
      });
    },
  };
}
