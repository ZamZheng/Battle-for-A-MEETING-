const D = require('../../lib/domain');
const C = require('../../lib/calendar');
const store = require('../../lib/store');
const ui = require('../../lib/ui');
function tomorrow() { return new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10); }
const FIELD_LABELS={title:'会议主题',purpose:'会议目的',dates:'预计日期',timeRange:'每天可安排时间',duration:'会议时长',interval:'候选开始间隔',deadline:'回复截止',roster:'预设参会名单',candidates:'候选时段'};
function fieldGroup(key) { return ['from','to'].includes(key)?'timeRange':['deadlineDate','deadlineTime'].includes(key)?'deadline':key; }
Page({
  data:{ title:'', purpose:'', dates:[], dateItems:[], date:tomorrow(), dateAdded:false, from:'09:00', to:'12:00', duration:'60', interval:'30',
    deadlineDate:tomorrow(), deadlineTime:'08:00', rows:[{key:'new-1',name:'',note:'',required:true}], kinds:['必到','可选'], slots:[], excluded:[], error:'', validationField:'', validationMessage:'', validationPending:false, previousId:null, busy:false, publishedInvite:null, copying:false, copySuccess:false, copyError:'', returnFailed:false },
  onLoad(options) {
    this.memberRowCounter=1;
    if (!options.previous) return;
    try {
      const m = store.view(options.previous);
      if (!m.isOwner) throw new Error('仅发起人可开启新一轮');
      const roles=m.editableRoster || m.roles;
      this.memberRowCounter=roles.length;
      this.setData({ title:m.title, purpose:m.purpose, duration:String(m.duration), previousId:m.id,
        rows:roles.map((r,i)=>({key:'new-'+(i+1),name:r.name,note:r.note || '',required:r.required})) });
    } catch(e) { this.showCreationError(e); }
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
  showCreationError(error) {
    if (this.destroyed || this.data.validationPending) return;
    const field=Object.prototype.hasOwnProperty.call(FIELD_LABELS,error.field)?error.field:'';
    const message=error.message || '操作未完成，请重试。';
    this.setData({error:message,validationField:field,validationMessage:message,validationPending:true},()=>{
      if (this.destroyed) return;
      wx.showModal({title:field?'请检查'+FIELD_LABELS[field]:'操作未完成',content:message,
        showCancel:false,confirmText:'OK',
        success:result=>{
          if (this.destroyed) return;
          this.setData({validationPending:false});
          if (result.confirm && field && this.data.validationField===field && !this.pageInactive) this.scrollToField(field);
        },
        fail:()=>{if(!this.destroyed)this.setData({validationPending:false});}
      });
    });
  },
  scrollToField(field) {
    const selector='#create-field-'+field;
    const fallback=()=>wx.pageScrollTo({selector,duration:300});
    if (!wx.createSelectorQuery) { fallback(); return; }
    wx.createSelectorQuery().in(this).select(selector).boundingClientRect().selectViewport().scrollOffset().exec(result=>{
      if (this.destroyed || this.pageInactive || this.data.validationField!==field) return;
      const [rect,viewport]=result || [];
      const info=wx.getWindowInfo?wx.getWindowInfo():(wx.getSystemInfoSync?wx.getSystemInfoSync():{});
      if (!rect || !viewport || !info.windowHeight) { fallback(); return; }
      // Center ordinary fields; for a taller group keep its label and start visible.
      const height=Math.min(rect.height,info.windowHeight*0.7);
      wx.pageScrollTo({scrollTop:Math.max(0,viewport.scrollTop+rect.top-(info.windowHeight-height)/2),duration:300});
    });
  },
  clearFieldIssue(field) {
    if (this.data.validationField===field) this.setData({validationField:'',validationMessage:'',error:''});
  },
  editField(e) { this.clearFieldIssue(fieldGroup(e.currentTarget.dataset.field)); },
  editRosterField() {this.clearFieldIssue('roster');},
  rosterField(e) {
    if(this.data.busy || this.data.validationPending || this.data.publishedInvite)return;
    const {key,field}=e.currentTarget.dataset;
    if(!['name','note','required'].includes(field))return;
    this.clearFieldIssue('roster');
    const value=field==='required'?Number(e.detail.value)===0:e.detail.value;
    this.setData({rows:this.data.rows.map(r=>r.key===key?{...r,[field]:value}:r)});
  },
  addMember() {
    if(this.data.busy || this.data.validationPending || this.data.publishedInvite)return;
    if(this.data.rows.length>=30){this.showCreationError(Object.assign(new Error('预设名单最多30位成员'),{field:'roster'}));return;}
    this.memberRowCounter=Math.max(this.memberRowCounter || 0,...this.data.rows.map(r=>Number(r.key.replace('new-','')) || 0))+1;
    this.clearFieldIssue('roster');
    this.setData({rows:[...this.data.rows,{key:'new-'+this.memberRowCounter,name:'',note:'',required:true}]});
  },
  removeMember(e) {
    if(this.data.busy || this.data.validationPending || this.data.publishedInvite)return;
    this.clearFieldIssue('roster');this.setData({rows:this.data.rows.filter(r=>r.key!==e.currentTarget.dataset.key)});
  },
  moveMember(e) {
    if(this.data.busy || this.data.validationPending || this.data.publishedInvite)return;
    const rows=[...this.data.rows],direction=Number(e.currentTarget.dataset.direction),index=rows.findIndex(r=>r.key===e.currentTarget.dataset.key),target=index+direction;
    if(![-1,1].includes(direction) || index<0 || target<0 || target>=rows.length)return;
    [rows[index],rows[target]]=[rows[target],rows[index]];this.clearFieldIssue('roster');this.setData({rows});
  },
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
    this.clearFieldIssue(fieldGroup(key));
    this.setData({[key]:e.detail.value,...(['from','to','duration','interval'].includes(key)?{slots:[],excluded:[]}: {})});
  },
  dateChanged(e) {
    this.clearFieldIssue('dates');
    const date=e.detail.value;
    this.setData({date,dateAdded:this.data.dates.includes(date)});
  },
  addDate() {
    this.clearFieldIssue('dates');
    if (this.data.dates.includes(this.data.date)) { this.setData({dateAdded:true}); return; }
    const dates=[...this.data.dates,this.data.date].sort();
    this.setData({dates,dateItems:dates.map(date=>({date,label:C.dateLabel(date)})),dateAdded:true,slots:[],excluded:[]});
  },
  removeDate(e) {
    this.clearFieldIssue('dates');
    const dates=this.data.dates.filter(d=>d!==e.currentTarget.dataset.date);
    this.setData({dates,dateItems:dates.map(date=>({date,label:C.dateLabel(date)})),dateAdded:dates.includes(this.data.date),slots:[],excluded:[]});
  },
  input() {
    return { ...this.data, duration:Number(this.data.duration), interval:Number(this.data.interval),
      deadline:D.dateTime(this.data.deadlineDate,this.data.deadlineTime,'deadline'),
      roster:this.data.rows.map(({name,note,required})=>({name,note,required})) };
  },
  preview() {
    if (this.data.validationPending || this.data.busy || this.data.publishedInvite) return;
    this.clearFieldIssue('candidates');
    try { const slots=D.generateSlots(this.data); this.setData({slots:slots.map(s=>({...s,keep:true,displayLabel:C.rangeLabel(s.start,s.end)})),excluded:[]}); }
    catch(e) { this.showCreationError(e); }
  },
  toggleSlot(e) {
    this.clearFieldIssue('candidates');
    const id=e.currentTarget.dataset.id;
    const slots=this.data.slots.map(s=>s.id===id?{...s,keep:!s.keep}:s);
    this.setData({slots,excluded:slots.filter(s=>!s.keep).map(s=>s.id)});
  },
  async publish() {
    if (this.data.busy || this.data.validationPending || this.data.publishedInvite) return;
    try {
      if (!this.data.slots.length) { const error=new Error('请先生成并预览候选时段'); error.field='candidates'; throw error; }
      const input=this.input();
      // Validate before confirmation, without persisting.
      const actor=store.actor();
      const validated=D.create(input,actor,'validation','validation');
      this.setData({busy:true,error:'',validationField:'',validationMessage:''});
      if (!(await ui.confirm('发布后成员可认领并填写。变更候选需要开启新一轮。'))) return;
      if (store.actor()!==actor) throw new Error('测试身份已变化，请重新发布');
      const result=store.create(input);
      this.setData({publishedInvite:{id:result.id,title:validated.title,duration:validated.duration,
        slots:validated.slots.map(s=>({...s,displayLabel:C.rangeLabel(s.start,s.end)})),participants:validated.roles.map(r=>r.name).join('、'),
        path:'/pages/identity/identity?id='+encodeURIComponent(result.id)+'&token='+encodeURIComponent(result.token)},
        copySuccess:false,copyError:'',returnFailed:false});
    } catch(e) { this.showCreationError(e); } finally { if(!this.destroyed)this.setData({busy:false}); }
  }
});
