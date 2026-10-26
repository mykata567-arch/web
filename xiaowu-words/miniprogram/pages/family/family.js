const { requestId, showError } = require('../../utils/ui');
const { today } = require('../../domain/date');

Page({
  data: { loading: true, error: '', family: null, name: '', memberName: '', code: '', busy: false, expires: '' },
  onShow() { this.load(); },
  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await getApp().api.profile();
      this.setData({ family: result.family, expires: result.family ? today(Date.parse(result.family.inviteExpiresAt)) : '' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ loading: false }); }
  },
  input(event) {
    this.pending = null;
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },
  create() { this.submit('createFamily'); },
  join() { this.submit('joinFamily'); },
  async submit(action) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (!this.pending || this.pending.action !== action) this.pending = { action, name: this.data.name, memberName: this.data.memberName, code: this.data.code, requestId: requestId() };
      await getApp().api.call('initUser', this.pending);
      this.pending = null;
      if (action === 'joinFamily') this.backToWords();
      else await this.load();
    } catch (error) { showError(error); if (error.code === 'ALREADY_IN_FAMILY') await this.load(); }
    finally { this.setData({ busy: false }); }
  },
  copy() { wx.setClipboardData({ data: this.data.family.inviteCode }); },
  rotate() {
    wx.showModal({ title: '更新家庭邀请码？', content: '旧码会立即失效，已经加入的家人不受影响。新码有效期7天。', success: result => { if (result.confirm) this.doRotate(); } });
  },
  async doRotate() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (!this.rotateRequest) this.rotateRequest = { action: 'rotateInvite', requestId: requestId() };
      await getApp().api.call('initUser', this.rotateRequest);
      this.rotateRequest = null;
      await this.load();
    } catch (error) { showError(error); }
    finally { this.setData({ busy: false }); }
  },
  backToWords() { wx.reLaunch({ url: '/pages/words/words' }); }
});
