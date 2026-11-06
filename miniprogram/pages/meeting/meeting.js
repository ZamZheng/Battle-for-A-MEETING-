const store = require('../../lib/store');
const D = require('../../lib/domain');
const ui = require('../../lib/ui');
// Any negative vote takes visual priority; its fraction drives a continuous red scale.
function conflictHeatStyle(no,total) {
 if (!no || !total) return '';
 const strength=Math.pow(no/total,2);
 const light=[253,237,240],dark=[178,43,61];
 const rgb=light.map((value,i)=>Math.round(value+(dark[i]-value)*strength));
 return 'background:rgb('+rgb.join(',')+');color:'+(strength>=0.75?'#fff':'#7d2937')+';';
}
Page({
 data:{ meeting:null,error:'',busy:false,submitPending:false,submissionSuccess:false,returningHome:false,returnError:'',identities:store.identities,actorIndex:0,choices:{},meetingLinkInput:'',linkDirty:false,noticeCopying:false,noticeError:'',lockPickerOpen:false,lockOptions:[],lockPickerError:'',lockPending:false,editingVote:false,moveSelections:{},moveConfirming:false,
   deadlineDate:'',deadlineTime:'',states:[{id:'yes',label:'可以'},{id:'maybe',label:'可协调'},{id:'no',label:'不行'}] },
 onLoad(options) { this.id=options.id; this.token=options.token || ''; },
 onShow() { this.pageInactive=false;this.setData({editingVote:false});this.refresh(); },
 onHide() { this.pageInactive=true; },
 onUnload() { this.pageInactive=true;this.destroyed=true; },
 ignoreEvent() {},
 onPullDownRefresh() { this.refresh(); wx.stopPullDownRefresh(); },
 refresh() {
  this.setData({actorIndex:store.identities.findIndex(p=>p.id===store.actor())});
  try {
   const m=store.view(this.id,this.token);
   if (!m.self && !m.isOwner) {
    this.setData({meeting:null,slots:[],choices:{},error:'',actorIndex:store.identities.findIndex(p=>p.id===store.actor())});
    wx.redirectTo({url:'/pages/identity/identity?id='+encodeURIComponent(this.id)+'&token='+encodeURIComponent(this.token),fail:e=>ui.error(this,new Error(e.errMsg || '无法打开身份确认页，请重试'))});
    return;
   }
   const roles=m.roles.map(r=>({...r,label:r.name}));
   const moveRoles=[{id:null,label:'旁听者'},...roles];
   const mine=m.self && m.self.roleId;
   const lockState=m.lockState;
   const candidateIds=lockState ? lockState.candidateIds : [];
   const slots=m.slots.map(s=>({...s,eligible:candidateIds.includes(s.id),
     yesStyle:'width:'+s.yesWidth+'%;',maybeStyle:'width:'+s.maybeWidth+'%;',noStyle:'width:'+s.noWidth+'%;',
     heatClass:s.no>0?'heat-conflict':s.yes===m.total?'heat-strong':s.yes/m.total>=0.5?'heat-medium':s.yes>0?'heat-light':'heat-empty',
     heatStyle:conflictHeatStyle(s.no,m.total),
     maybeNames:m.isOwner?s.details.filter(d=>d.choice==='maybe').map(d=>d.name).join('、'):'',
     noNames:m.isOwner?s.details.filter(d=>d.choice==='no').map(d=>d.name).join('、'):'',
     heatDate:D.labelTime(s.start).slice(0,10),heatTime:D.labelTime(s.start).slice(11)+'—'+D.labelTime(s.end).slice(11),
   }));
   const editable=m.status==='collecting';
   const lockRuleReady=D.LOCK_RULE_VERSION==='vote-lock-state-v3' && !!lockState;
   const allResponded=!!lockState && lockState.allResponded;
   const lockCandidates=slots.filter(s=>candidateIds.includes(s.id));
   const hasSubmitted=m.selfSubmitted===undefined ? Object.keys(m.reply).length>0 : m.selfSubmitted;
   const editingVote=!!this.data.editingVote && editable && !!mine && hasSubmitted;
   const managed=m.isOwner ? m.members.map(person=>{
    const chosen=Object.prototype.hasOwnProperty.call(this.data.moveSelections,person.actor);
    const selected=chosen ? this.data.moveSelections[person.actor] : person.roleId;
    const targetIndex=Math.max(0,moveRoles.findIndex(r=>r.id===selected));
    const role=moveRoles[targetIndex];
    return {...person,label:(roles.find(r=>r.id===person.roleId)||{}).name || '旁听者',
      targetIndex,targetLabel:chosen?role.label:'选择角色',canMove:chosen && role.id!==person.roleId};
   }) : [];
   const presentation={ meeting:{...m,slots,roles}, actorIndex:store.identities.findIndex(p=>p.id===store.actor()), choices:m.reply,
     slots:slots.map(s=>({...s,choice:m.reply[s.id] || ''})), editable, editingVote, canVote:editable && !!mine && (!hasSubmitted || editingVote),
     hasSubmitted,showVotePrompt:editable && !!mine && !hasSubmitted,
     isVoter:!!mine, roleName:mine ? (roles.find(r=>r.id===mine)||{}).name : '旁听者',
     lockRuleReady,allResponded,lockCandidates,canOpenLockPicker:m.isOwner && lockRuleReady && allResponded && (m.status==='collecting' || m.status==='closed'),
     noIntersection:!slots.some(s=>s.eligible), hasNames:m.isOwner || !!m.self,
     updated:D.labelTime(m.updatedAt),deadline:D.labelTime(m.deadline),datesText:m.dates.join('、'),missingText:m.missing.join('、'),
     final:slots.find(s=>s.id===m.finalSlot)||null,moveRoles,
     ...(!this.data.linkDirty || !m.isOwner ? {meetingLinkInput:m.meetingLink,linkDirty:false} : {}),
     managed,correctionListStyle:'height:'+Math.min(managed.length,3)*160+'rpx;',hasMoreCorrections:managed.length>3,
     error:'' };
   this.setData(presentation);
   return presentation;
  } catch(e) { this.setData({meeting:null}); ui.error(this,e); return null; }
 },
 switchActor(e) {
  if (this.data.busy || this.data.submitPending || this.data.moveConfirming || this.data.noticeCopying || this.data.lockPending || this.data.lockPickerOpen) return;
  try {
   const next=store.identities[Number(e.detail.value)];
   if (!next) throw new Error('未知模拟身份');
   // Also repairs id-only routes restored by old builds or DevTools page restore.
   // When the current user has no access, preserve the original token and let
   // the selected identity pass normal access checks (e.g. switching back to owner).
   try { this.token=store.simulationInvite(this.id,this.token); } catch (_) {}
   store.setActor(next.id);
   this.setData({moveSelections:{},editingVote:false,linkDirty:false,meetingLinkInput:'',noticeError:''});
   this.refresh();
  } catch(e) { ui.error(this,e); }
 },
 async run(action,payload) {
  if (this.data.busy) return false;
  this.setData({busy:true,error:''});
  try { store.act(this.id,this.token,action,payload); if(action==='reply')this.setData({editingVote:false});this.refresh();return true; }
  catch(e) { ui.error(this,e); return false; }
  finally { this.setData({busy:false}); }
 },
 beginClaim() {
  wx.navigateTo({url:'/pages/identity/identity?id='+encodeURIComponent(this.id)+'&token='+encodeURIComponent(this.token)+'&edit=1',fail:e=>ui.error(this,new Error(e.errMsg || '无法打开身份确认页，请重试'))});
 },
 beginEditTime() {
  if (this.data.busy || this.data.submitPending) return;
  this.refresh();
  if (!this.data.meeting || !this.data.editable || !this.data.isVoter || !this.data.hasSubmitted) return;
  this.setData({editingVote:true,canVote:true,error:''},()=>wx.pageScrollTo({selector:'#vote-options',duration:300}));
 },
 cancelEditTime() {
  if (this.data.busy || this.data.submitPending) return;
  this.setData({editingVote:false});this.refresh();
 },
 pick(e) {
  if (!this.data.canVote || this.data.submitPending) return;
  const choices={...this.data.choices,[e.currentTarget.dataset.slot]:e.currentTarget.dataset.choice};
  this.setChoices(choices);
 },
 setChoices(choices) { this.setData({choices,slots:this.data.slots.map(s=>({...s,choice:choices[s.id]||''}))}); },
 batch(e) {
  if (!this.data.canVote || this.data.submitPending) return;
  const choices={}; this.data.slots.forEach(s=>{choices[s.id]=e.currentTarget.dataset.choice;}); this.setChoices(choices);
 },
 async submit() {
  if (this.data.busy || this.data.submitPending || !this.data.canVote) return;
  const isOwner=!!(this.data.meeting && this.data.meeting.isOwner);
  this.setData({submitPending:true});
  const saved=await this.run('reply',{choices:this.data.choices});
  if (this.pageInactive || this.destroyed) {if (!this.destroyed) this.setData({submitPending:false});return;}
  if (!saved) {this.setData({submitPending:false});return;}
  if (isOwner) {
   this.setData({submitPending:false});
   wx.showToast({title:'已提交并更新汇总',icon:'success'});
   return;
  }
  this.setData({submissionSuccess:true,returningHome:false,returnError:''});
 },
 confirmSubmission() {
  if (!this.data.submissionSuccess || this.data.returningHome || this.pageInactive || this.destroyed) return;
  this.setData({returningHome:true,returnError:''});
  wx.reLaunch({url:'/pages/home/home?highlight='+encodeURIComponent(this.id),fail:()=>{
   if (!this.destroyed) this.setData({returningHome:false,returnError:'选择已保存，返回首页失败。请点击 OK 重试。'});
  }});
 },
 openLockPicker() {
  if (this.data.busy || this.data.lockPending) return;
  if (this.data.editingVote) {
   wx.showModal({title:'请先处理时间修改',content:'请先保存或取消你正在修改的时间选择，再锁定会议。',showCancel:false,confirmText:'知道了',success:()=>{}});
   return;
  }
  const fresh=this.refresh();
  if (!fresh || !fresh.canOpenLockPicker) {
   if (this.data.lockPickerOpen) this.setData({lockOptions:[],lockPickerError:'会议状态或回复已变化，请等待名单成员全部提交后再选择。'});
   return;
  }
  this.lockSnapshotVersion=fresh.meeting.version;
  this.setData({lockPickerOpen:true,lockOptions:fresh.lockCandidates,lockPickerError:'',
    lockEmptyReason:fresh.meeting.lockState.emptyReason,lockCheckedTime:D.labelTime(fresh.meeting.lockState.evaluatedAt),
    lockListStyle:'height:'+Math.min(fresh.lockCandidates.length,4)*112+'rpx;'});
 },
 copyLockDiagnostics() {
  const m=this.data.meeting;
  if(!m || !m.isOwner || !m.lockState)return;
  const diagnostic={rule:D.LOCK_RULE_VERSION,checkedAt:D.labelTime(m.lockState.evaluatedAt),status:m.status,
    submitted:m.lockState.submitted,total:m.lockState.total,options:m.lockState.decisions.map(row=>({time:row.label,start:row.start,yes:row.yes,maybe:row.maybe,no:row.no,missing:row.missing,result:row.reason}))};
  wx.setClipboardData({data:JSON.stringify(diagnostic,null,2),fail:()=>this.setData({lockPickerError:'排查信息未复制成功，请重试。'})});
 },
 closeLockPicker() {
  if (!this.data.lockPending) this.setData({lockPickerOpen:false,lockPickerError:''});
 },
 async lock(e) {
  if (this.data.busy || this.data.lockPending || !this.data.meeting || !this.data.meeting.isOwner) return;
  const id=e.currentTarget.dataset.id,m=this.data.meeting;
  const s=(this.data.lockPickerOpen?this.data.lockOptions:m.slots).find(x=>x.id===id);
  if (!s || s.no>0) return;
  const version=this.data.lockPickerOpen?this.lockSnapshotVersion:m.version;
  this.setData({lockPending:true,lockPickerError:''});
  try {
   store.act(this.id,this.token,'lock',{slotId:id,version});
   this.setData({lockPickerOpen:false,linkDirty:false});this.refresh();
   const maybe=s.details.filter(d=>d.choice==='maybe').map(d=>d.name);
   await new Promise(resolve=>wx.showModal({title:'已锁定成功',content:s.label+'（北京时间）。'+(maybe.length?'可协调：'+maybe.join('、')+'。':''),
    showCancel:false,confirmText:'查看安排',success:resolve,fail:resolve}));
   if (!this.destroyed && !this.pageInactive) wx.pageScrollTo({selector:'#final-arrangement',duration:300});
  } catch(e) {
   if (!this.destroyed) this.setData({lockPickerOpen:true,lockPickerError:e.message || '锁定未成功，请刷新后重试'});
  } finally {if (!this.destroyed) this.setData({lockPending:false});}
 },
 copyInvite() {
  const token=this.data.meeting.token;
  if (!token) return;
  wx.setClipboardData({data:'/pages/identity/identity?id='+this.id+'&token='+token,fail:e=>ui.error(this,new Error(e.errMsg))});
 },
 onShareAppMessage() {
  const m=this.data.meeting;
  if (!m || !m.token) return {title:'会议时间协调（本地模拟）',path:'/pages/home/home'};
  return {title:m.title+'（本地模拟，不能跨设备共享）',path:'/pages/identity/identity?id='+this.id+'&token='+m.token};
 },
 async revoke() { if (await ui.confirm('撤销后新访客无法预览或加入，已加入成员仍可访问。')) await this.run('revoke',{}); },
 async cancel() { if (await ui.confirm('取消会议？取消后不能继续填写或锁定。')) await this.run('cancel',{}); },
 deadlineField(e) { this.setData({[e.currentTarget.dataset.field]:e.detail.value}); },
 async extend() { try { await this.run('extend',{deadline:D.dateTime(this.data.deadlineDate,this.data.deadlineTime)}); } catch(e) { ui.error(this,e); } },
 newRound() { wx.navigateTo({url:'/pages/create/create?previous='+this.id}); },
 moveChange(e) {
  if (this.data.busy || this.data.moveConfirming || !this.data.meeting || !this.data.meeting.isOwner) return;
  const actor=e.currentTarget.dataset.actor,index=Number(e.detail.value),role=this.data.moveRoles[index];
  const person=this.data.managed.find(p=>p.actor===actor);
  if (!person || !role) return;
  this.setData({moveSelections:{...this.data.moveSelections,[actor]:role.id},error:'',
    managed:this.data.managed.map(p=>p.actor===actor ? {...p,targetIndex:index,targetLabel:role.label,canMove:role.id!==p.roleId} : p)});
 },
 showCorrectionNotice(message,title='无法更正身份') {
  if (this.destroyed) return Promise.resolve();
  ui.error(this,new Error(message));
  return new Promise(resolve=>wx.showModal({title,content:message,showCancel:false,confirmText:'知道了',success:resolve,fail:resolve}));
 },
 async move(e) {
  if (this.data.busy || this.data.moveConfirming || !this.data.meeting || !this.data.meeting.isOwner) return;
  const target=this.data.managed.find(p=>p.actor===e.currentTarget.dataset.actor);
  if (!target || !target.canMove) return;
  const role=this.data.moveRoles[target.targetIndex];
  if (!role) return;
  const actor=store.actor();
  this.setData({moveConfirming:true});
  try {
   const latest=store.view(this.id,this.token);
   if (!latest.isOwner) throw new Error('仅发起人可更正身份');
   if (role.id!==null && latest.members.some(p=>p.roleId===role.id && p.actor!==target.actor)) {
    await this.showCorrectionNotice('角色“'+role.label+'”已被认领，不能重复占用。本次更正未执行，请选择其他角色。','角色已被认领');
    return;
   }
   if (!(await ui.confirm('将「'+target.label+'」更正为「'+role.label+'」？其选择随账号保留；不覆盖已认领角色。'))) return;
   if (store.actor()!==actor) throw new Error('测试身份已变化，请重新确认');
   if (await this.run('move',{targetActor:target.actor,roleId:role.id})) {
    const remaining={...this.data.moveSelections};delete remaining[target.actor];
    this.setData({moveSelections:remaining,managed:this.data.managed.map(p=>p.actor===target.actor ? {...p,targetLabel:'选择角色',canMove:false} : p)});
   } else {
    // The role may have been claimed while the confirmation dialog was open.
    await this.showCorrectionNotice(this.data.error || '更正未完成，请刷新后重试。','更正未完成');
   }
  } catch(e) {await this.showCorrectionNotice(e.message || '更正未完成，请重试。');}
  finally {if (!this.destroyed) this.setData({moveConfirming:false});}
 },
 meetingLinkChanged(e) {
  if (!this.data.meeting || !this.data.meeting.isOwner || this.data.meeting.status!=='locked' || this.data.noticeCopying) return;
  this.setData({meetingLinkInput:e.detail.value,linkDirty:true,noticeError:''});
 },
 async copyNotice() {
  if (this.data.noticeCopying) return;
  this.setData({noticeCopying:true,noticeError:''});
  try {
   let m=store.view(this.id,this.token);
   if (m.status!=='locked') throw new Error('会议未锁定或已取消，不能复制最终通知');
   if (m.isOwner && this.data.linkDirty) {
    m=store.act(this.id,this.token,'meetingLink',{url:this.data.meetingLinkInput});
    this.setData({linkDirty:false,meetingLinkInput:m.meetingLink});this.refresh();
   }
   const f=m.slots.find(s=>s.id===m.finalSlot);
   if (!f) throw new Error('最终时段不存在，请刷新后重试');
   const notice='会议：'+m.title+'\n目的：'+m.purpose+'\n时间：'+f.label+'（北京时间）'+
    (m.meetingLink?'\n网络会议链接：'+m.meetingLink:'')+'\n参会名单：'+m.roles.map(r=>r.name).join('、')+'\n请查看小程序中的最终安排。';
   await new Promise((resolve,reject)=>wx.setClipboardData({data:notice,success:resolve,fail:()=>reject(new Error('会议通知未复制成功，请重试。已保存的链接不会丢失。'))}));
   if (!this.destroyed) wx.showToast({title:'会议通知已复制',icon:'success'});
  } catch(e) {if (!this.destroyed) this.setData({noticeError:e.message || '复制未成功，请重试'});}
  finally {if (!this.destroyed) this.setData({noticeCopying:false});}
 }
});
