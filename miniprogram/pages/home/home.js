const store = require('../../lib/store');
const ui = require('../../lib/ui');
Page({
  data:{ meetings:[], identities:store.identities, actorIndex:0, error:'', invite:'' },
  onShow() { this.refresh(); },
  refresh() { try { this.setData({ meetings:store.list(), actorIndex:store.identities.findIndex(p=>p.id===store.actor()), error:'' }); } catch(e) { ui.error(this,e); } },
  switchActor(e) { try { store.setActor(store.identities[Number(e.detail.value)].id); this.refresh(); } catch(e) { ui.error(this,e); } },
  create() { wx.navigateTo({url:'/pages/create/create'}); },
  open(e) { wx.navigateTo({url:'/pages/meeting/meeting?id='+encodeURIComponent(e.currentTarget.dataset.id)}); },
  typeInvite(e) { this.setData({ invite:e.detail.value }); },
  join() {
    const path = this.data.invite.trim();
    if (!/^\/?pages\/meeting\/meeting\?id=[\w-]+&token=[\w-]+$/.test(path)) { ui.error(this,new Error('请粘贴本机模拟邀请路径')); return; }
    wx.navigateTo({url:path.startsWith('/') ? path : '/'+path});
  },
  async reset() { if (await ui.confirm('清除本机全部模拟会议？此操作不可恢复。')) { try { store.reset(); this.refresh(); } catch(e) { ui.error(this,e); } } }
});
