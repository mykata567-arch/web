const { splitPhrases } = require('../../domain/model');
const { requestId, presentWord, showError, historyText } = require('../../utils/ui');

Page({
  data: { loading: true, error: '', word: null, history: [], hasMore: false, loadingMore: false, editing: false, phrases: '', saving: false },
  onLoad(options) { this.wordId = options.id; },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '', editing: false });
    try {
      const api = getApp().api;
      const [result, history] = await Promise.all([api.call('wordRecords', { action: 'get', wordId: this.wordId }), api.call('reviewRecords', { action: 'history', wordId: this.wordId, offset: 0 })]);
      this.setData({ word: presentWord(result.word, result.today), history: history.records.map(record => ({ ...record, label: historyText(record) })), hasMore: history.hasMore });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  edit() { this.pendingEdit = null; this.setData({ editing: true, phrases: this.data.word.phrases.join('、') }); },
  cancelEdit() { if (!this.data.saving) this.setData({ editing: false }); },
  input(event) { this.pendingEdit = null; this.setData({ phrases: event.detail.value }); },
  async save() {
    if (this.data.saving) return;
    this.setData({ saving: true });
    try {
      if (!this.pendingEdit) this.pendingEdit = { action: 'edit', wordId: this.wordId, phrases: splitPhrases(this.data.phrases), version: this.data.word.version, requestId: requestId() };
      await getApp().api.call('wordRecords', this.pendingEdit);
      this.pendingEdit = null;
      this.setData({ editing: false });
      await this.load();
    } catch (error) { showError(error); if (error.code === 'STALE_WORD') { this.pendingEdit = null; await this.load(); } }
    finally { this.setData({ saving: false }); }
  },
  async more() {
    if (this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    try {
      const result = await getApp().api.call('reviewRecords', { action: 'history', wordId: this.wordId, offset: this.data.history.length });
      this.setData({ history: this.data.history.concat(result.records.map(record => ({ ...record, label: historyText(record) }))), hasMore: result.hasMore });
    } catch (error) { showError(error); }
    finally { this.setData({ loadingMore: false }); }
  },
  remove() {
    if (this.data.saving) return;
    wx.showModal({ title: '删除“' + this.data.word.character + '”？', content: '这个字将从家庭字本和待复习任务中移除，家人的页面刷新后也会更新。重新录入时保留既往学习历史。', confirmText: '删除', confirmColor: '#A04C37', success: result => { if (result.confirm) this.doRemove(); } });
  },
  async doRemove() {
    this.setData({ saving: true });
    try {
      if (!this.deleteRequest) this.deleteRequest = { action: 'delete', wordId: this.wordId, version: this.data.word.version, requestId: requestId() };
      await getApp().api.call('wordRecords', this.deleteRequest);
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/words/words' }) });
    } catch (error) { showError(error); if (error.code === 'STALE_WORD') { this.deleteRequest = null; await this.load(); } }
    finally { this.setData({ saving: false }); }
  }
});
