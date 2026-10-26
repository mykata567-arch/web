const { requestId, showError } = require('../../utils/ui');

Page({
  data: { loading: true, error: '', current: null, index: 0, total: 0, maskedPhrase: '', revealed: false, saving: false, pending: false, pendingLabel: '', feedback: '', finished: false, correctCount: 0, wrongCount: 0, remaining: 0, conflict: false },
  onLoad() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '', conflict: false });
    try {
      const result = await getApp().api.call('reviewRecords', { action: 'due' });
      this.words = result.words.slice(0, result.sessionSize);
      this.position = 0;
      this.pendingRequest = null;
      this.setData({ total: this.words.length, correctCount: 0, wrongCount: 0, remaining: result.words.length - this.words.length, finished: !this.words.length });
      this.showCurrent();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  showCurrent() {
    const current = this.words[this.position] || null;
    const phrase = current ? current.phrases[0] : '';
    this.setData({ current, index: this.position + 1, maskedPhrase: current ? Array.from(phrase).map(char => char === current.character ? '（　）' : char).join('') : '', revealed: false, pending: false, pendingLabel: '', feedback: '', conflict: false });
  },
  reveal() { this.setData({ revealed: true }); },
  yes() { this.answer(true); },
  no() { this.answer(false); },
  retry() { if (this.pendingRequest) this.answer(this.pendingRequest.correct); },
  async answer(correct) {
    if (!this.data.revealed || this.data.saving || this.data.feedback || this.data.conflict) return;
    if (!this.pendingRequest) this.pendingRequest = { action: 'submit', wordId: this.data.current.id, version: this.data.current.version, correct, requestId: requestId() };
    this.setData({ saving: true, pending: true, pendingLabel: this.pendingRequest.correct ? '会了' : '还不会' });
    try {
      const result = await getApp().api.call('reviewRecords', this.pendingRequest);
      const accepted = this.pendingRequest.correct;
      this.pendingRequest = null;
      this.setData({ pending: false, correctCount: this.data.correctCount + (accepted ? 1 : 0), wrongCount: this.data.wrongCount + (accepted ? 0 : 1),
        feedback: result.word.mastered ? '已经阶段性掌握这个字啦！' : accepted ? '记下了，下次复习：' + result.word.nextReviewDate : '没关系，明天再来试试。' });
    } catch (error) {
      if (['STALE_WORD', 'NOT_FOUND', 'NOT_DUE', 'ALREADY_REVIEWED'].includes(error.code)) {
        this.pendingRequest = null;
        this.setData({ pending: false, conflict: true });
      } else showError(error);
    } finally { this.setData({ saving: false }); }
  },
  async next() {
    if (!this.data.feedback) return;
    this.position += 1;
    if (this.position >= this.words.length) {
      this.setData({ current: null, finished: true });
      try { const result = await getApp().api.call('reviewRecords', { action: 'due' }); this.setData({ remaining: result.words.length }); }
      catch (_) { this.setData({ remaining: -1 }); }
    } else this.showCurrent();
  },
  back() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/words/words' }) }); }
});
