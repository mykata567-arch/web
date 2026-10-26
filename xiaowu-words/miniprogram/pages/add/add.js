const { splitPhrases, phraseOK, normalizeSelections } = require('../../domain/model');
const { requestId, showError } = require('../../utils/ui');

Page({
  data: { text: '', rows: [], selectedCount: 0, saving: false, pending: false, saved: null },
  onInput(event) { if (!this.data.pending) this.setData({ text: event.detail.value, rows: [], selectedCount: 0, saved: null }); },
  parse() {
    try {
      const phrases = splitPhrases(this.data.text);
      if (!phrases.length || phrases.length > 30 || phrases.some(phrase => !phraseOK(phrase))) throw new Error('每次输入1～30个词语，用逗号或换行分隔；每个词语最多12个汉字。');
      this.setData({ rows: phrases.map(phrase => ({ phrase, characters: Array.from(new Set(Array.from(phrase))).map(character => ({ character, selected: false })) })), selectedCount: 0 });
    } catch (error) { showError(error); }
  },
  toggle(event) {
    if (this.data.pending || this.data.saving) return;
    const { row, index } = event.currentTarget.dataset;
    const rows = this.data.rows.map(item => ({ ...item, characters: item.characters.map(character => ({ ...character })) }));
    rows[row].characters[index].selected = !rows[row].characters[index].selected;
    const selected = new Set();
    rows.forEach(item => item.characters.filter(character => character.selected).forEach(character => selected.add(character.character)));
    this.setData({ rows, selectedCount: selected.size });
  },
  async save() {
    if (this.data.saving || !this.data.selectedCount) return;
    try {
      if (!this.pendingRequest) {
        const items = this.data.rows.map(row => ({ phrase: row.phrase, characters: row.characters.filter(item => item.selected).map(item => item.character) })).filter(row => row.characters.length);
        normalizeSelections(items);
        this.pendingRequest = { action: 'add', items, requestId: requestId() };
      }
      this.setData({ saving: true, pending: true });
      const result = await getApp().api.call('wordRecords', this.pendingRequest);
      this.pendingRequest = null;
      this.setData({ saved: result, text: '', rows: [], selectedCount: 0, pending: false });
    } catch (error) { showError(error); }
    finally { this.setData({ saving: false }); }
  },
  finish() { wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/words/words' }) }); },
  again() { this.setData({ saved: null }); }
});
