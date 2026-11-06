const D = require('../../lib/domain');
const store = require('../../lib/store');
const ui = require('../../lib/ui');
function tomorrow() { return new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10); }
Page({
  data:{ title:'', purpose:'', dates:[], date:tomorrow(), dateAdded:false, from:'09:00', to:'12:00', duration:'60', interval:'30',
    deadlineDate:tomorrow(), deadlineTime:'08:00', roster:'', slots:[], excluded:[], error:'', previousId:null, busy:false, publishedInvite:null, copying:false, copySuccess:false, copyError:'', returnFailed:false },
  onLoad(options) {
    if (!options.previous) return;
    try {
      const m = store.view(options.previous);
      if (!m.isOwner) throw new Error('仅发起人可开启新一轮');
      this.setData({ title:m.title, purpose:m.purpose, duration:String(m.duration), previousId:m.id,
        roster:D.formatRoster(m.roles) });
    } catch(e) { ui.error(this,e); }
  },
  onShow() {
    this.pageInactive=false;
    if (this.data.copySuccess && !this.data.returnFailed) this.scheduleHome();
  },
  onHide() {this.pageInactive=true;this.clearReturnTimer();},
  onUnload() {this.destroyed=true;this.pageInactive=true;this.clearReturnTimer();},
  clearReturnTimer() {
    if (this.returnTimer!==undefined && this.returnTimer!==null) clearTimeout(this.returnTimer);
    this.returnTimer=null;
  },
  scheduleHome() {
    this.clearReturnTimer();
    this.returnTimer=setTimeout(()=>{this.returnTimer=null;this.returnHome();},2000);
  },
  returnHome() {
    if (!this.data.copySuccess || this.pageInactive || this.destroyed || this.returningHome) return;
    this.returningHome=true;
    wx.reLaunch({url:'/pages/home/home',fail:()=>{
      this.returningHome=false;
      if (!this.destroyed) this.setData({returnFailed:true,copyError:'邀请已复制，但返回首页失败，请点击下方按钮重试。'});
    }});
  },
  ignoreEvent() {},
  async copyInvitation() {
    if (!this.data.publishedInvite || this.data.copying || this.data.copySuccess) return;
    this.setData({copying:true,copyError:''});
    try {
      await new Promise((resolve,reject)=>wx.setClipboardData({data:this.data.publishedInvite.path,success:resolve,fail:reject}));
      if (this.destroyed) return;
      if (wx.hideToast) wx.hideToast();
      this.setData({copySuccess:true,returnFailed:false});
      if (!this.pageInactive) this.scheduleHome();
    } catch(e) {
      if (!this.destroyed) this.setData({copyError:'复制未成功，请点击按钮重试。会议已经保存，不需要重新发布。'});
    } finally {if (!this.destroyed) this.setData({copying:false});}
  },
  field(e) {
    const key=e.currentTarget.dataset.field;
    this.setData({[key]:e.detail.value,...(['from','to','duration','interval'].includes(key)?{slots:[],excluded:[]}: {})});
  },
  dateChanged(e) {
    const date=e.detail.value;
    this.setData({date,dateAdded:this.data.dates.includes(date)});
  },
  addDate() {
    if (this.data.dates.includes(this.data.date)) { this.setData({dateAdded:true}); return; }
    this.setData({dates:[...this.data.dates,this.data.date].sort(),dateAdded:true,slots:[],excluded:[]});
  },
  removeDate(e) {
    const dates=this.data.dates.filter(d=>d!==e.currentTarget.dataset.date);
    this.setData({dates,dateAdded:dates.includes(this.data.date),slots:[],excluded:[]});
  },
  input() {
    return { ...this.data, duration:Number(this.data.duration), interval:Number(this.data.interval),
      deadline:D.dateTime(this.data.deadlineDate,this.data.deadlineTime),
      roster:D.parseRoster(this.data.roster) };
  },
  preview() { try { const slots=D.generateSlots(this.data); this.setData({slots:slots.map(s=>({...s,keep:true})),excluded:[],error:''}); } catch(e) { ui.error(this,e); } },
  toggleSlot(e) {
    const id=e.currentTarget.dataset.id;
    const slots=this.data.slots.map(s=>s.id===id?{...s,keep:!s.keep}:s);
    this.setData({slots,excluded:slots.filter(s=>!s.keep).map(s=>s.id)});
  },
  async publish() {
    if (this.data.busy || this.data.publishedInvite) return;
    try {
      if (!this.data.slots.length) throw new Error('请先生成并预览候选时段');
      const input=this.input();
      // Validate before confirmation, without persisting.
      const actor=store.actor();
      const validated=D.create(input,actor,'validation','validation');
      this.setData({busy:true});
      if (!(await ui.confirm('发布后成员可认领并填写。变更候选需要开启新一轮。'))) return;
      if (store.actor()!==actor) throw new Error('测试身份已变化，请重新发布');
      const result=store.create(input);
      this.setData({publishedInvite:{id:result.id,title:validated.title,duration:validated.duration,
        slots:validated.slots,participants:validated.roles.map(r=>r.name).join('、'),
        path:'/pages/identity/identity?id='+encodeURIComponent(result.id)+'&token='+encodeURIComponent(result.token)},
        copySuccess:false,copyError:'',returnFailed:false});
    } catch(e) { ui.error(this,e); } finally { this.setData({busy:false}); }
  }
});
