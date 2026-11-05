const store = require('../../lib/store');
const D = require('../../lib/domain');
const ui = require('../../lib/ui');
const choiceNames = {yes:'可以',maybe:'可协调',no:'不行',missing:'未回复'};
Page({
 data:{ meeting:null,error:'',busy:false,identities:store.identities,actorIndex:0,choices:{},profileOpen:false,
   name:'',nickname:'',avatar:'',profileReady:false,roleIndex:0,moveIndex:0,memberIndex:0,
   deadlineDate:'',deadlineTime:'',states:[{id:'yes',label:'可以'},{id:'maybe',label:'可协调'},{id:'no',label:'不行'}] },
 onLoad(options) { this.id=options.id; this.token=options.token || ''; },
 onShow() { this.refresh(); },
 onPullDownRefresh() { this.refresh(); wx.stopPullDownRefresh(); },
 refresh() {
  try {
   const m=store.view(this.id,this.token);
   const roles=m.roles.map(r=>({...r,label:r.name+' · '+(r.required?'必到':'可选')+(r.occupied?'（已认领）':'')}));
   const moveRoles=[{id:null,label:'仅接收会议信息'},...roles];
   const mine=m.self && m.self.roleId;
   const slots=m.slots.map(s=>({...s,
     heatClass:s.yes===m.total?'heat-strong':s.yes/m.total>=0.5?'heat-medium':s.yes>0?'heat-light':'heat-empty',
     heatDate:D.labelTime(s.start).slice(0,10),heatTime:D.labelTime(s.start).slice(11)+'—'+D.labelTime(s.end).slice(11),
     conflict:s.blockers.map(b=>b.name+'：'+choiceNames[b.choice]).join('、'),
     detailsText:s.details.map(p=>p.name+(p.required?'（必到）':'')+'：'+choiceNames[p.choice]).join('；') }));
   const editable=m.status==='collecting';
   this.setData({ meeting:{...m,slots,roles}, actorIndex:store.identities.findIndex(p=>p.id===store.actor()), choices:m.reply,
     slots:slots.map(s=>({...s,choice:m.reply[s.id] || ''})), editable, canVote:editable && !!mine,
     isVoter:!!mine, roleName:mine ? (roles.find(r=>r.id===mine)||{}).name : '仅接收会议信息',
     noIntersection:!slots.some(s=>s.eligible), hasNames:m.isOwner || !!m.self,
     updated:D.labelTime(m.updatedAt),deadline:D.labelTime(m.deadline),datesText:m.dates.join('、'),missingText:m.missing.join('、'),
     final:slots.find(s=>s.id===m.finalSlot)||null,moveRoles,
     managed:m.members.map(p=>({...p,label:p.profile.name+' · '+((roles.find(r=>r.id===p.roleId)||{}).name || '仅接收信息')+' · '+(store.identities.find(a=>a.id===p.actor)||{}).name})),
     error:'' });
  } catch(e) { this.setData({meeting:null}); ui.error(this,e); }
 },
 switchActor(e) { store.setActor(store.identities[Number(e.detail.value)].id); this.setData({profileReady:false,profileOpen:false,name:'',nickname:'',avatar:''}); this.refresh(); },
 async run(action,payload) {
  if (this.data.busy) return false;
  this.setData({busy:true,error:''});
  try { store.act(this.id,this.token,action,payload); this.refresh(); return true; }
  catch(e) { ui.error(this,e); return false; }
  finally { this.setData({busy:false}); }
 },
 beginClaim() {
  const p=this.data.meeting.self && this.data.meeting.self.profile;
  this.setData({profileOpen:true,name:p?p.name:'',nickname:p?p.nickname:'',avatar:p?p.avatar:'',profileReady:false});
 },
 profileField(e) { this.setData({[e.currentTarget.dataset.field]:e.detail.value}); },
 chooseAvatar(e) {
  wx.getFileSystemManager().saveFile({tempFilePath:e.detail.avatarUrl,success:r=>this.setData({avatar:r.savedFilePath}),fail:()=>ui.error(this,new Error('头像保存失败，可跳过头像继续'))});
 },
 closeProfile() { this.setData({profileOpen:false}); },
 confirmProfile() {
  if (!this.data.name.trim()) { ui.error(this,new Error('请填写工作姓名')); return; }
  this.setData({profileOpen:false,profileReady:true,error:''});
 },
 roleChange(e) { this.setData({roleIndex:Number(e.detail.value)}); },
 async claim(e) {
  const observer=e.currentTarget.dataset.observer==='yes';
  const r=this.data.meeting.roles[this.data.roleIndex];
  if (!observer && !r) return;
  const message=observer ? '你将仅接收会议信息，不参与时间协调。若你是名单中的必到人员，请先认领对应角色。' :
    '认领「'+r.name+'」：'+(r.required?'必到人员，你的明确同意是锁定时间的必要条件。':'可选人员，你的选择会参与汇总，但不阻止锁定。')+'请确认这是你本人。';
  if (!(await ui.confirm(message,'确认会议角色'))) return;
  if (await this.run('claim',{roleId:observer?null:r.id,profile:{name:this.data.name,nickname:this.data.nickname,avatar:this.data.avatar}})) this.setData({profileReady:false});
 },
 pick(e) {
  if (!this.data.canVote) return;
  const choices={...this.data.choices,[e.currentTarget.dataset.slot]:e.currentTarget.dataset.choice};
  this.setChoices(choices);
 },
 setChoices(choices) { this.setData({choices,slots:this.data.slots.map(s=>({...s,choice:choices[s.id]||''}))}); },
 batch(e) {
  if (!this.data.canVote) return;
  const choices={}; this.data.slots.forEach(s=>{choices[s.id]=e.currentTarget.dataset.choice;}); this.setChoices(choices);
 },
 async submit() {
  if (await this.run('reply',{choices:this.data.choices})) wx.showToast({title:'已提交并更新汇总',icon:'success'});
 },
 async lock(e) {
  const id=e.currentTarget.dataset.id, m=this.data.meeting;
  const s=m.slots.find(x=>x.id===id);
  if (!(await ui.confirm('锁定 '+s.label+'？可选人员仍可能不行或未回复。锁定后停止投票。'))) return;
  await this.run('lock',{slotId:id,version:m.version});
 },
 copyInvite() {
  const token=this.data.meeting.token;
  if (!token) return;
  wx.setClipboardData({data:'/pages/meeting/meeting?id='+this.id+'&token='+token,fail:e=>ui.error(this,new Error(e.errMsg))});
 },
 onShareAppMessage() {
  const m=this.data.meeting;
  if (!m || !m.token) return {title:'会议时间协调（本地模拟）',path:'/pages/home/home'};
  return {title:m.title+'（本地模拟，不能跨设备共享）',path:'/pages/meeting/meeting?id='+this.id+'&token='+m.token};
 },
 async revoke() { if (await ui.confirm('撤销后新访客无法预览或加入，已加入成员仍可访问。')) await this.run('revoke',{}); },
 async cancel() { if (await ui.confirm('取消会议？取消后不能继续填写或锁定。')) await this.run('cancel',{}); },
 deadlineField(e) { this.setData({[e.currentTarget.dataset.field]:e.detail.value}); },
 async extend() { try { await this.run('extend',{deadline:D.dateTime(this.data.deadlineDate,this.data.deadlineTime)}); } catch(e) { ui.error(this,e); } },
 newRound() { wx.navigateTo({url:'/pages/create/create?previous='+this.id}); },
 memberChange(e) { this.setData({memberIndex:Number(e.detail.value)}); },
 moveChange(e) { this.setData({moveIndex:Number(e.detail.value)}); },
 async move() {
  const target=this.data.managed[this.data.memberIndex],role=this.data.moveRoles[this.data.moveIndex];
  if (!target || !role || !(await ui.confirm('将「'+target.profile.name+'」更正为「'+role.label+'」？其选择随账号保留；不覆盖已认领角色。'))) return;
  await this.run('move',{targetActor:target.actor,roleId:role.id});
 },
 copyNotice() {
  const m=this.data.meeting,f=this.data.final;
  if (!f || m.status!=='locked') return;
  wx.setClipboardData({data:'会议：'+m.title+'\n目的：'+m.purpose+'\n时间：'+f.label+'（北京时间）\n参会名单：'+m.roles.map(r=>r.name).join('、')+'\n请查看小程序中的最终安排。',fail:e=>ui.error(this,new Error(e.errMsg))});
 }
});
