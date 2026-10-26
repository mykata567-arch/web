const { presentWord, requestId, showError } = require('../../utils/ui');

Page({
  data: { loading: true, error: '', query: '', filter: 'all', words: [], shown: [], total: 0, due: 0, needsFamily: false, family: {}, importing: false },
  onShow() { this.load(); },
  async onPullDownRefresh() { try { await this.load(); } finally { wx.stopPullDownRefresh(); } },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const profile = await getApp().api.profile();
      if (!profile.family) { this.setData({ needsFamily: true }); return; }
      const result = await getApp().api.call('wordRecords', { action: 'list' });
      this.setData({ needsFamily: false, words: result.words.map(word => presentWord(word, result.today)), total: result.words.length, due: result.dueCount, family: result.family });
      this.applyFilter();
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  search(event) { this.setData({ query: event.detail.value.trim() }); this.applyFilter(); },
  chooseFilter(event) { this.setData({ filter: event.currentTarget.dataset.filter }); this.applyFilter(); },
  applyFilter() {
    const { words, filter, query } = this.data;
    const shown = words.filter(word => (filter === 'all' || (filter === 'due' && word.due) || (filter === 'mastered' && word.mastered)) && (!query || word.character.includes(query) || word.phraseText.includes(query)))
      .sort((a, b) => Number(b.due) - Number(a.due) || b.updatedAt.localeCompare(a.updatedAt));
    this.setData({ shown });
  },
  add() { wx.navigateTo({ url: '/pages/add/add' }); },
  review() { wx.navigateTo({ url: '/pages/review/review' }); },
  family() { wx.navigateTo({ url: '/pages/family/family' }); },
  importSample() {
    wx.showModal({ title: '导入25个易错字？', content: '导入2026年10月25日记录的匿名听写样本；“顶”计2次错误，其他字各1次。家人会共享这些记录。仅可向空字本导入一次。', success: result => { if (result.confirm) this.doImport(); } });
  },
  async doImport() {
    if (this.data.importing) return;
    this.setData({ importing: true });
    try {
      if (!this.importRequest) this.importRequest = { action: 'seed', confirm: true, requestId: requestId() };
      await getApp().api.call('wordRecords', this.importRequest);
      this.importRequest = null;
      await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ importing: false }); }
  },
  openWord(event) { wx.navigateTo({ url: '/pages/detail/detail?id=' + encodeURIComponent(event.detail.id) }); }
});
