const RULES = require('./rules');
const { validDate } = require('./date');
const { fail, normalizeSelections, phraseOK, addMistake, applyReview, dueWords, summarize } = require('./model');

// 身份来自云函数，不接受客户端传入的 openid / userId。
function createEngine(db, options) {
  const { hash, today, now, seed, randomCode } = options;
  const rules = options.rules || RULES;
  async function all(table, filter) {
    const result = [];
    for (let offset = 0; ; offset += 100) {
      const page = await db.query(table, filter, { offset, limit: 100, orderBy: 'id', direction: 'asc' });
      result.push(...page);
      if (page.length < 100) return result;
    }
  }
  return async function invoke(area, payload, identity) {
    if (!identity || typeof identity.openid !== 'string' || !identity.openid || !identity.appid) fail('UNAUTHENTICATED', '请通过微信小程序登录');
    const event = payload || {};
    const userId = 'u_' + hash(identity.appid + ':' + identity.openid);
    const day = today();
    const timestamp = now();
    if (!validDate(day)) fail('INVALID_DATE', '学习日期无效');
    async function user(tx) {
      const record = await tx.get('users', userId);
      if (!record) fail('LOGIN_REQUIRED', '请重新打开小程序');
      return record;
    }
    async function scope(tx) {
      const account = await user(tx);
      if (!account.familyId) fail('FAMILY_REQUIRED', '请先创建家庭或填写邀请码加入');
      const family = await tx.get('families', account.familyId);
      if (!family || !family.members.some(member => member.userId === userId)) fail('FORBIDDEN', '你没有这个家庭的访问权限');
      const child = await tx.get('children', family.childId);
      if (!child || child.familyId !== family.id) fail('FORBIDDEN', '字本归属错误');
      if ((event.familyId && event.familyId !== family.id) || (event.childId && event.childId !== child.id)) fail('FORBIDDEN', '无法访问其他家庭的字本');
      return { account, family, child, filter: { familyId: family.id, childId: child.id } };
    }
    function own(record, context, includeDeleted) {
      if (!record || record.familyId !== context.family.id || record.childId !== context.child.id || (!includeDeleted && record.deleted)) fail('NOT_FOUND', '记录不存在或无权访问');
      return record;
    }
    function publicFamily(family) {
      return { id: family.id, name: family.name, childId: family.childId, canInvite: family.createdBy === userId,
        members: family.members.map(member => ({ key: member.userId, name: member.name, creator: member.userId === family.createdBy })),
        inviteCode: family.createdBy === userId ? family.inviteCode : '', inviteExpiresAt: family.inviteExpiresAt };
    }
    function receiptInfo(kind, data) {
      if (typeof event.requestId !== 'string' || !/^[A-Za-z0-9_-]{12,100}$/.test(event.requestId)) fail('INVALID_INPUT', '操作标识无效，请刷新后重试');
      return { id: 'o_' + hash(userId + ':' + event.requestId), fingerprint: hash(JSON.stringify({ kind, data })) };
    }
    async function mutation(kind, data, work, needsFamily) {
      const info = receiptInfo(kind, data);
      return db.transaction(async tx => {
        const account = await user(tx);
        const context = needsFamily === false ? { account } : await scope(tx);
        const receipt = await tx.get('operations', info.id);
        if (receipt) {
          if (receipt.userId !== userId || receipt.fingerprint !== info.fingerprint) fail('REQUEST_CONFLICT', '操作标识已被使用');
          return receipt.result;
        }
        const result = await work(tx, context);
        await tx.put('operations', info.id, { id: info.id, userId, fingerprint: info.fingerprint, result, createdAt: timestamp });
        return result;
      });
    }
    function checkedName(value) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (!text || text.length > 20 || /[\r\n\t<>]/.test(text)) fail('INVALID_INPUT', '名称请填写1～20个字');
      return text;
    }
    function invitation(code, familyId) {
      const id = 'i_' + hash(code);
      const expiresAt = new Date(Date.parse(timestamp) + 7 * 86400000).toISOString();
      return { id, familyId, expiresAt, createdAt: timestamp };
    }
    if (area === 'initUser') {
      if (event.action === 'bootstrap') {
        await db.transaction(async tx => {
          if (!await tx.get('users', userId)) await tx.put('users', userId, { id: userId, familyId: null, createdAt: timestamp, failedJoins: 0, joinWindowStart: timestamp });
        });
        const account = await user(db);
        if (!account.familyId) return { accountId: userId, family: null, child: null, today: day, rules };
        const context = await scope(db);
        return { accountId: userId, family: publicFamily(context.family), child: context.child, today: day, rules };
      }
      if (event.action === 'createFamily') {
        const familyName = checkedName(event.name);
        const memberName = checkedName(event.memberName);
        const code = randomCode();
        return mutation('createFamily', { familyName, memberName }, async (tx, context) => {
          if (context.account.familyId) fail('ALREADY_IN_FAMILY', '你已经加入家庭，请返回字本');
          const id = 'f_' + hash(userId + ':' + event.requestId);
          const childId = 'c_' + hash(id + ':child');
          const invite = invitation(code, id);
          const family = { id, name: familyName, childId, createdBy: userId, members: [{ userId, name: memberName }], inviteCode: code, activeInviteId: invite.id, inviteExpiresAt: invite.expiresAt, createdAt: timestamp };
          const child = { id: childId, familyId: id, name: familyName, wordCount: 0, sampleImported: false, version: 1, createdAt: timestamp, updatedAt: timestamp };
          await tx.put('families', id, family);
          await tx.put('children', childId, child);
          await tx.put('invites', invite.id, invite);
          await tx.put('users', userId, { ...context.account, familyId: id });
          return { family: publicFamily(family), child };
        }, false);
      }
      if (event.action === 'joinFamily') {
        const memberName = checkedName(event.memberName);
        const code = typeof event.code === 'string' ? event.code.replace(/[\s-]/g, '').toUpperCase() : '';
        const info = receiptInfo('joinFamily', { code, memberName });
        // 失败尝试需要提交计数，不能抛错回滚掉限流记录。
        const result = await db.transaction(async tx => {
          const account = await user(tx);
          const receipt = await tx.get('operations', info.id);
          if (receipt) {
            if (receipt.fingerprint !== info.fingerprint || receipt.userId !== userId) fail('REQUEST_CONFLICT', '操作标识已被使用');
            return receipt.result;
          }
          if (account.familyId) fail('ALREADY_IN_FAMILY', '你已经加入家庭，请返回字本');
          const inWindow = Date.parse(timestamp) - Date.parse(account.joinWindowStart) < 10 * 60000;
          const failures = inWindow ? account.failedJoins : 0;
          if (failures >= 10) return { error: 'TOO_MANY_ATTEMPTS' };
          const invite = /^[A-F0-9]{16}$/.test(code) ? await tx.get('invites', 'i_' + hash(code)) : null;
          const family = invite ? await tx.get('families', invite.familyId) : null;
          if (!invite || !family || family.activeInviteId !== invite.id || invite.expiresAt <= timestamp || family.members.length >= 6) {
            await tx.put('users', userId, { ...account, failedJoins: failures + 1, joinWindowStart: inWindow ? account.joinWindowStart : timestamp });
            return { error: 'INVITE_INVALID' };
          }
          const updatedFamily = { ...family, members: family.members.concat({ userId, name: memberName }) };
          await tx.put('families', family.id, updatedFamily);
          await tx.put('users', userId, { ...account, familyId: family.id, failedJoins: 0 });
          const data = { family: publicFamily(updatedFamily), child: await tx.get('children', family.childId) };
          await tx.put('operations', info.id, { id: info.id, userId, fingerprint: info.fingerprint, result: data, createdAt: timestamp });
          return data;
        });
        if (result.error) fail(result.error, result.error === 'TOO_MANY_ATTEMPTS' ? '尝试较多，请10分钟后再试' : '邀请码无效、已过期或家庭已满，请联系创建者');
        return result;
      }
      if (event.action === 'rotateInvite') {
        const code = randomCode();
        return mutation('rotateInvite', {}, async (tx, context) => {
          if (context.family.createdBy !== userId) fail('FORBIDDEN', '只有家庭创建者可以更新邀请码');
          const invite = invitation(code, context.family.id);
          const updated = { ...context.family, inviteCode: code, activeInviteId: invite.id, inviteExpiresAt: invite.expiresAt };
          await tx.put('invites', invite.id, invite);
          await tx.put('families', updated.id, updated);
          return { family: publicFamily(updated) };
        });
      }
      fail('INVALID_ACTION', '不支持的家庭操作');
    }
    const context = await scope(db);
    const activeWords = async () => (await all('words', context.filter)).filter(word => !word.deleted);
    if (area === 'wordRecords') {
      if (event.action === 'list') {
        const words = await activeWords();
        return { words, today: day, dueCount: dueWords(words, day).length, family: publicFamily(context.family) };
      }
      if (event.action === 'get') return { word: own(await db.get('words', event.wordId), context), today: day };
      if (event.action === 'add' || event.action === 'seed') {
        const importing = event.action === 'seed';
        if (importing && event.confirm !== true) fail('CONFIRM_REQUIRED', '请主动确认导入25字样本');
        const entries = normalizeSelections(importing ? seed.items : event.items);
        const recordedDate = importing ? seed.recordedDate : day;
        if (!validDate(recordedDate)) fail('INVALID_INPUT', '样本日期无效');
        return mutation(importing ? 'seed' : 'add', { entries }, async (tx, current) => {
          if (importing && (current.child.wordCount !== 0 || current.child.sampleImported)) fail('SEED_NOT_EMPTY', '只能向空字本导入一次样本');
          let added = 0;
          for (const entry of entries) {
            const id = 'w_' + hash(current.family.id + ':' + current.child.id + ':' + entry.character);
            const previous = await tx.get('words', id);
            if (previous) own(previous, current, true);
            if (!previous || previous.deleted) added += 1;
            const word = { ...addMistake(previous, entry, recordedDate, timestamp, rules), id, ...current.filter, deleted: false, createdBy: previous ? previous.createdBy : userId, updatedBy: userId };
            await tx.put('words', id, word);
            const historyId = 'h_' + hash(userId + ':' + event.requestId + ':' + id);
            await tx.put('reviews', historyId, { id: historyId, ...current.filter, wordId: id, character: entry.character, userId,
              type: importing ? 'seed' : 'mistake', date: recordedDate, correct: null, occurrences: entry.occurrences,
              beforeStreak: previous ? previous.streak : 0, afterStreak: 0, beforeMastered: previous ? previous.mastered : false, afterMastered: false, nextReviewDate: word.nextReviewDate, createdAt: timestamp });
          }
          await tx.put('children', current.child.id, { ...current.child, wordCount: current.child.wordCount + added, sampleImported: current.child.sampleImported || importing, version: current.child.version + 1, updatedAt: timestamp });
          return { added, updated: entries.length - added, count: entries.length };
        });
      }
      if (event.action === 'edit' || event.action === 'delete') {
        const editing = event.action === 'edit';
        if (editing && (!Array.isArray(event.phrases) || !event.phrases.length || event.phrases.length > 20)) fail('INVALID_INPUT', '请保留1～20个提示词语');
        const phrases = editing ? Array.from(new Set(event.phrases)) : [];
        return mutation(event.action, { wordId: event.wordId, phrases, version: event.version }, async (tx, current) => {
          const word = own(await tx.get('words', event.wordId), current);
          if (word.version !== event.version) fail('STALE_WORD', '这个字已被家人更新，请刷新后重试');
          if (editing && phrases.some(phrase => !phraseOK(phrase) || !phrase.includes(word.character))) fail('INVALID_INPUT', '每个词语都要包含目标字，且最多12个汉字');
          const updated = { ...word, phrases: editing ? phrases : word.phrases, deleted: !editing, version: word.version + 1, updatedAt: timestamp, updatedBy: userId };
          await tx.put('words', word.id, updated);
          if (!editing) await tx.put('children', current.child.id, { ...current.child, wordCount: current.child.wordCount - 1, version: current.child.version + 1, updatedAt: timestamp });
          return { word: updated };
        });
      }
      fail('INVALID_ACTION', '不支持的字本操作');
    }
    if (area === 'reviewRecords') {
      if (event.action === 'due') return { words: dueWords(await activeWords(), day), today: day, sessionSize: rules.sessionSize };
      if (event.action === 'stats') {
        const words = await activeWords();
        const reviews = await all('reviews', { ...context.filter, date: day, type: 'review' });
        return { ...summarize(words, reviews, day), today: day };
      }
      if (event.action === 'history') {
        own(await db.get('words', event.wordId), context);
        const offset = Number.isInteger(event.offset) && event.offset >= 0 ? event.offset : 0;
        const records = await db.query('reviews', { ...context.filter, wordId: event.wordId }, { offset, limit: 20, orderBy: 'createdAt', direction: 'desc' });
        return { records, hasMore: records.length === 20 };
      }
      if (event.action === 'submit') {
        return mutation('review', { wordId: event.wordId, version: event.version, correct: event.correct }, async (tx, current) => {
          const word = own(await tx.get('words', event.wordId), current);
          if (word.version !== event.version) fail('STALE_WORD', '家人已更新这个字，请刷新复习任务');
          const updated = { ...applyReview(word, event.correct, day, timestamp, rules), updatedBy: userId };
          const id = 'h_' + hash(userId + ':' + event.requestId + ':' + word.id);
          await tx.put('words', word.id, updated);
          const record = { id, ...current.filter, wordId: word.id, character: word.character, userId, type: 'review', date: day, correct: event.correct,
            beforeStreak: word.streak, afterStreak: updated.streak, beforeMastered: word.mastered, afterMastered: updated.mastered, nextReviewDate: updated.nextReviewDate, createdAt: timestamp };
          await tx.put('reviews', id, record);
          return { word: updated, review: record };
        });
      }
      fail('INVALID_ACTION', '不支持的复习操作');
    }
    fail('INVALID_ACTION', '不支持的功能');
  };
}
module.exports = { createEngine };
