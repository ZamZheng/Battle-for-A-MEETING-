const store=require('../../lib/store');
const D=require('../../lib/domain');
const ui=require('../../lib/ui');
Page({
 data:{loaded:false,editable:false,title:'',purpose:'',rows:[],kinds:['必到','可选'],error:'',errorField:'',busy:false,saved:false},
 onLoad(options){this.id=options.id;this.token=options.token || '';this.newRow=0;},
 onShow(){
  try {
   const m=store.view(this.id,this.token);
   if(!m.isOwner || (this.loadedActor && this.loadedActor!==store.actor())){this.setData({loaded:false,editable:false,title:'',purpose:'',rows:[]});throw new Error('仅发起人可修改会议信息');}
   if(m.status!=='collecting'){this.setData({editable:false});throw new Error('仅收集中可修改会议信息；截止后请先延长重新开放。');}
   if(!Array.isArray(m.editableRoster) || typeof D.prepareInfoEdit!=='function')throw new Error('编辑功能更新不完整，请补齐 lib/domain.js 后重新编译。');
   if(this.data.loaded){if(!this.data.saved)this.setData({editable:true});return;}
   this.loadedActor=store.actor();this.infoVersion=m.infoVersion;
   this.setData({loaded:true,editable:true,title:m.title,purpose:m.purpose,rows:m.editableRoster.map(r=>({...r,key:r.id})),error:''});
  }catch(e){this.showError(e);}
 },
 onUnload(){this.unloaded=true;},
 clearIssue(e){const field=e.currentTarget.dataset.group || e.currentTarget.dataset.field;if(this.data.errorField===field)this.setData({errorField:'',error:''});},
 field(e){if(this.data.busy || !this.data.editable || this.data.saved)return;this.clearIssue(e);this.setData({[e.currentTarget.dataset.field]:e.detail.value});},
 rosterField(e){
  if(this.data.busy || !this.data.editable || this.data.saved)return;
  this.clearIssue(e);const {key,field}=e.currentTarget.dataset;
  const value=field==='required'?Number(e.detail.value)===0:e.detail.value;
  this.setData({rows:this.data.rows.map(r=>r.key===key?{...r,[field]:value}:r)});
 },
 addMember(){
  if(this.data.busy || !this.data.editable || this.data.saved)return;
  if(this.data.rows.length>=30){this.showError(Object.assign(new Error('名单最多30位成员'),{field:'roster'}));return;}
  this.setData({rows:[...this.data.rows,{id:null,key:'new-'+(++this.newRow),name:'',note:'',required:true}],error:'',errorField:''});
 },
 removeMember(e){
  if(this.data.busy || !this.data.editable || this.data.saved)return;
  this.setData({rows:this.data.rows.filter(r=>r.key!==e.currentTarget.dataset.key),error:'',errorField:''});
 },
 moveMember(e){
  if(this.data.busy || !this.data.editable || this.data.saved)return;
  const rows=[...this.data.rows],index=rows.findIndex(r=>r.key===e.currentTarget.dataset.key),target=index+Number(e.currentTarget.dataset.direction);
  if(index<0 || target<0 || target>=rows.length)return;
  [rows[index],rows[target]]=[rows[target],rows[index]];this.setData({rows});
 },
 showError(e){
  if(this.unloaded)return;
  const error=e.message || '修改未完成，请重试',errorField=['title','purpose','roster'].includes(e.field)?e.field:'';
  this.setData({error,errorField});
  wx.showModal({title:this.data.saved?'返回未完成':'暂时无法保存',content:error,showCancel:false,confirmText:'OK',success:()=>{
   if(!this.unloaded && errorField)wx.pageScrollTo({selector:'#edit-'+errorField,duration:300});
  }});
 },
 async save(){
  if(this.data.busy || this.data.saved || !this.data.editable)return;
  this.setData({busy:true,error:'',errorField:''});
  try {
   const latest=store.view(this.id,this.token);
   if(!latest.isOwner || store.actor()!==this.loadedActor)throw new Error('仅发起人可修改会议信息');
   if(latest.status!=='collecting')throw new Error('会议已截止、锁定或取消，暂不能修改。');
   const payload={infoVersion:this.infoVersion,title:this.data.title,purpose:this.data.purpose,roster:this.data.rows.map(({id,name,note,required})=>({id,name,note,required}))};
   const preview=D.prepareInfoEdit(latest,payload);
   const removed=preview.removedBindings.map(p=>p.name);
   const message=removed.length?'将移除已认领的角色：'+removed.join('、')+'。对应参与者会转为旁听，已填选择保留但不再计入汇总。确认保存？':'保存会议主题、目的和名单？其他成员重新进入或刷新后可看到更新。';
   if(!(await ui.confirm(message,'保存会议信息')))return;
   if(this.unloaded)return;
   if(store.actor()!==this.loadedActor)throw new Error('测试身份已变化，请重新进入');
   store.act(this.id,this.token,'editInfo',{...payload,confirmedRemovals:preview.removedBindings.map(({actor,roleId})=>({actor,roleId}))});
   this.setData({saved:true,editable:false});wx.showToast({title:'会议信息已更新',icon:'success'});this.returnToMeeting();
  }catch(e){this.showError(e);}finally{if(!this.unloaded)this.setData({busy:false});}
 },
 returnToMeeting(){
  const fallback=()=>wx.redirectTo({url:'/pages/meeting/meeting?id='+encodeURIComponent(this.id)+'&token='+encodeURIComponent(this.token),fail:()=>this.showError(new Error(this.data.saved?'修改已保存，返回未成功，请重试返回。':'返回未成功，请重试。'))});
  if(wx.navigateBack)wx.navigateBack({delta:1,fail:fallback});else fallback();
 },
 cancel(){if(!this.data.busy)this.returnToMeeting();}
});
