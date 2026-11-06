const store = require('../../lib/store');
const ui = require('../../lib/ui');
Page({
 data:{meeting:null,error:'',busy:false,savingAvatar:false,avatar:'',roles:[],roleIndex:-1,editable:false},
 onLoad(options) {this.id=options.id;this.token=options.token || '';this.edit=options.edit==='1';},
 onShow() {this.refresh();},
 onUnload() {this.unloaded=true;},
 refresh() {
  try {
   const m=store.view(this.id,this.token);
   if (m.self && !this.edit) {this.enter();return;}
   const roles=m.roles.map(r=>({...r,key:r.id,label:r.required?'必到':'可选',
     unavailable:r.occupied && (!m.self || m.self.roleId!==r.id)}));
   // Observer is a role in the same list, always last. No separate switch or entry.
   roles.push({id:null,key:'observer',name:'旁听者',label:'仅接收会议信息',required:false,unavailable:false});
   const sameActor=this.loadedActor===store.actor();
   const profile=m.self && m.self.profile;
   const roleIndex=m.self ? roles.findIndex(r=>r.id===m.self.roleId) : -1;
   this.setData({meeting:m,roles,editable:m.status==='collecting',error:'',
     ...(!sameActor ? {avatar:profile?profile.avatar:'',roleIndex} : {})});
   this.loadedActor=store.actor();
  } catch(e) {this.setData({meeting:null});ui.error(this,e);}
 },
 chooseAvatar(e) {
  const tempFilePath=e.detail && e.detail.avatarUrl;
  if (!tempFilePath || this.data.savingAvatar || this.data.busy) return; // cancellation is not an app failure
  const actor=store.actor();
  this.setData({savingAvatar:true,error:''});
  wx.getFileSystemManager().saveFile({tempFilePath,
   success:r=>{if (!this.unloaded && store.actor()===actor) this.setData({avatar:r.savedFilePath});},
   fail:()=>{if (!this.unloaded && store.actor()===actor) ui.error(this,new Error('头像保存失败，请重新选择'));},
   complete:()=>{if (!this.unloaded) this.setData({savingAvatar:false});}
  });
 },
 async selectRole(e) {
  if (this.data.busy || this.data.savingAvatar) return;
  const index=Number(e.currentTarget.dataset.index);
  if (!Number.isInteger(index) || !this.data.roles[index]) return;
  this.setData({roleIndex:index,error:''});
  await this.confirmIdentity();
 },
 async confirmIdentity() {
  if (this.data.busy || this.data.savingAvatar) return;
  this.setData({error:''});
  if (!this.data.avatar) {ui.error(this,new Error('请先选择头像，再认领角色'));return;}
  const role=this.data.roles[this.data.roleIndex];
  if (!role) {ui.error(this,new Error('请选择一个角色'));return;}
  if (role.unavailable) {ui.error(this,new Error('此角色已被认领，请选择其他角色或联系发起人更正'));return;}
  const actor=store.actor();
  this.setData({busy:true});
  try {
   const message=role.id===null ? '确认以「旁听者」加入？你不参与时间协调，只查看会议信息。' :
     '确认认领「'+role.name+'」？'+(role.required?'你是必到人员，你的明确同意会影响会议时间确定。':'你是可选人员，你的选择参与汇总，但不阻止锁定。');
   if (!(await ui.confirm(message,'确认认领角色'))) return;
   if (store.actor()!==actor) throw new Error('测试身份已变化，请重新进入');
   store.act(this.id,this.token,'claim',{roleId:role.id,profile:{nameSource:'role',avatar:this.data.avatar}});
   this.enter();
  } catch(e) {ui.error(this,e);} finally {if (!this.unloaded) this.setData({busy:false});}
 },
 enter() {
  wx.redirectTo({url:'/pages/meeting/meeting?id='+encodeURIComponent(this.id)+'&token='+encodeURIComponent(this.token),fail:e=>ui.error(this,new Error(e.errMsg || '无法进入会议，请重试'))});
 }
});
