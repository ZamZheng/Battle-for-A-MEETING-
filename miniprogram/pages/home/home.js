const store = require('../../lib/store');
const ui = require('../../lib/ui');
Page({
  data:{ meetings:[], identities:store.identities, actorIndex:0, error:'', invite:'', highlightId:'' },
  onLoad(options) {
    this.requestedHighlight=options.highlight || '';
    this.highlightActor=store.actor();
  },
  onShow() { this.refresh(); },
  onReady() { this.ready=true;this.scrollToHighlight(); },
  scrollToHighlight() {
    if (!this.ready || !this.data.highlightId || this.highlightScrolled) return;
    this.highlightScrolled=true;
    wx.pageScrollTo({selector:'#my-meetings',duration:300});
  },
  refresh() {
    try {
      const meetings=store.list();
      const highlightId=this.highlightActor===store.actor() && meetings.some(m=>m.id===this.requestedHighlight) ? this.requestedHighlight : '';
      this.setData({meetings,highlightId,actorIndex:store.identities.findIndex(p=>p.id===store.actor()),error:''},()=>this.scrollToHighlight());
    } catch(e) { ui.error(this,e); }
  },
  switchActor(e) { try { store.setActor(store.identities[Number(e.detail.value)].id); this.requestedHighlight='';this.refresh(); } catch(e) { ui.error(this,e); } },
  create() { wx.navigateTo({url:'/pages/create/create'}); },
  open(e) {
    try {
      const id=e.currentTarget.dataset.id,token=store.simulationInvite(id);
      if (id===this.data.highlightId) {this.requestedHighlight='';this.setData({highlightId:''});}
      wx.navigateTo({url:'/pages/meeting/meeting?id='+encodeURIComponent(id)+(token?'&token='+encodeURIComponent(token):'')});
    } catch(e) { ui.error(this,e); }
  },
  typeInvite(e) { this.setData({ invite:e.detail.value }); },
  join() {
    const path = this.data.invite.trim();
    if (!/^\/?pages\/(?:meeting\/meeting|identity\/identity)\?id=[\w-]+&token=[\w-]+$/.test(path)) { ui.error(this,new Error('请粘贴本机模拟邀请路径')); return; }
    const target=path.replace('pages/meeting/meeting','pages/identity/identity');
    wx.navigateTo({url:target.startsWith('/') ? target : '/'+target});
  },
  async reset() { if (await ui.confirm('清除本机全部模拟会议？此操作不可恢复。')) { try { store.reset(); this.refresh(); } catch(e) { ui.error(this,e); } } }
});
