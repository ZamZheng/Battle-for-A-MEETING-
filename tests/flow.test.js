const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const D=require('../miniprogram/lib/domain');
const store=require('../miniprogram/lib/store');
function mockWx() {
 const storage=new Map(),routes=[],clipboards=[],timers=new Map(),scrolls=[],relaunches=[];
 let failSave=false,failRelaunch=false,failClipboard=false,time=0,timerId=0;
 return {storage,routes,clipboards,scrolls,relaunches,failSave(value){failSave=value;},failRelaunch(value){failRelaunch=value;},failClipboard(value){failClipboard=value;},
  setTimer(fn,delay){const id=++timerId;timers.set(id,{fn,due:time+delay});return id;},clearTimer(id){timers.delete(id);},
  advance(ms){time+=ms;for(const [id,timer] of [...timers].sort((a,b)=>a[1].due-b[1].due)){if(timer.due<=time && timers.has(id)){timers.delete(id);timer.fn();}}},
  reLaunch(o){relaunches.push(o.url);if(failRelaunch){if(o.fail)o.fail({errMsg:'navigation failed'});}else{routes.push(o.url);if(o.success)o.success();}},
  pageScrollTo(o){scrolls.push(o);if(o.success)o.success();},
  getStorageSync:k=>storage.get(k),setStorageSync(k,v){if(failSave)throw Error('存储空间不足');storage.set(k,JSON.parse(JSON.stringify(v)));},removeStorageSync:k=>storage.delete(k),
  showModal:o=>o.success({confirm:true}),
  getFileSystemManager:()=>({saveFile(o){o.success({savedFilePath:'wxfile://saved/'+o.tempFilePath.split('/').at(-1)});if(o.complete)o.complete();}}),showToast(){},stopPullDownRefresh(){},
  navigateTo:o=>routes.push(o.url),redirectTo:o=>routes.push(o.url),setClipboardData(o){if(failClipboard){if(o.fail)o.fail({errMsg:'clipboard denied'});}else{clipboards.push(o.data);if(o.success)o.success({});}}
 };
}
function page(name,wx) {
 const file=path.resolve('miniprogram/pages/'+name+'/'+name+'.js');let def;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Page:p=>{def=p;},wx,console,Date,Promise,setTimeout:(fn,delay)=>wx.setTimer(fn,delay),clearTimeout:id=>wx.clearTimer(id)});
 return {...def,data:JSON.parse(JSON.stringify(def.data)),setData(patch,callback){Object.assign(this.data,patch);if(callback)callback();}};
}
const event=(value,dataset={})=>({detail:{value},currentTarget:{dataset}});
test('真实页面控制器+本地存储完整流程：创建→独立身份页→确认跳转→提交→切换身份→锁定→新一轮',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const date=new Date(Date.now()+2*86400000+8*3600000).toISOString().slice(0,10);
  const create=page('create',wx);create.onLoad({});
  create.setData({title:'团队会议',purpose:'安排下一步',dates:[date],from:'09:00',to:'10:00',duration:'60',interval:'30',deadlineDate:date,deadlineTime:'08:00',roster:'甲\n乙\n丙\n丁?'});
  create.preview();assert.equal(create.data.slots.length,1);await create.publish();
  assert.equal(wx.routes.length,0);
  const query=new URLSearchParams(create.data.publishedInvite.path.split('?')[1]),id=query.get('id'),token=query.get('token');
  await create.copyInvitation();wx.advance(2000);assert.equal(wx.routes.length,1);assert.equal(wx.routes[0],'/pages/home/home');create.onUnload();
  assert.equal(store.list().length,1);
  let meeting=page('meeting',wx);meeting.onLoad({id,token});meeting.onShow();
  assert.equal(meeting.data.meeting.isOwner,true);
  const actors=['demo-a','demo-b','demo-c','demo-guest'];
  for(let i=0;i<actors.length;i++) {
   meeting.switchActor(event(String(store.identities.findIndex(a=>a.id===actors[i]))));
   assert.equal(meeting.data.meeting,null);assert.equal(meeting.data.slots.length,0);
   assert.match(wx.routes.at(-1),/pages\/identity\/identity/);
   const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();
   assert.equal(identity.data.meeting.title,'团队会议');assert.equal(identity.data.meeting.submitted,i);
   identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/member-'+i+'.png'}});
   await identity.selectRole(event('',{index:String(i)}));
   assert.match(wx.routes.at(-1),/pages\/meeting\/meeting/);meeting.onShow();
   assert.equal(meeting.data.meeting.self.roleId,'r'+i);assert.equal(meeting.data.canVote,true);
   meeting.batch(event('',{choice:'yes'}));
   assert.equal(store.view(id,token).slots[0].yes,i); // draft not shared
   await meeting.submit();assert.equal(store.view(id,token).slots[0].yes,i+1);
   meeting.confirmSubmission();meeting.onUnload();
   meeting=page('meeting',wx);meeting.onLoad({id,token});meeting.onShow();
  }
  meeting.switchActor(event('0'));assert.equal(meeting.data.meeting.slots[0].eligible,true);assert.equal(meeting.data.meeting.slots[0].missing,0);
  await meeting.lock(event('',{id:meeting.data.slots[0].id}));assert.equal(meeting.data.meeting.status,'locked');
  await meeting.copyNotice();assert.match(wx.clipboards.at(-1),/北京时间/);
  const fresh=page('meeting',wx);fresh.onLoad({id});fresh.onShow();assert.equal(fresh.data.meeting.status,'locked');
  fresh.newRound();assert.match(wx.routes.at(-1),/previous=/);
  const round=page('create',wx);round.onLoad({previous:id});assert.equal(round.data.title,'团队会议');assert.equal(round.data.dates.length,0);
  const home=page('home',wx);home.onShow();assert.equal(home.data.meetings.length,1);
 } finally {global.wx=previous;}
});
test('存储失败不宣称提交成功，旧回复仍保留；重新加载恢复已保存数据',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
  const {id,token}=store.create({title:'会议',purpose:'测试',dates:[date],from:'09:00',to:'10:00',duration:60,interval:30,deadline:D.dateTime(date,'08:00'),roster:[{name:'甲',required:true}]});
  store.setActor('demo-a');store.act(id,token,'claim',{roleId:'r0',profile:{name:'甲'}});
  const slot=store.view(id,token).slots[0].id;
  wx.failSave(true);assert.throws(()=>store.act(id,token,'reply',{choices:{[slot]:'yes'}}),/空间不足/);
  assert.equal(store.view(id,token).submitted,0);
  wx.failSave(false);store.act(id,token,'reply',{choices:{[slot]:'no'}});
  assert.equal(store.view(id,token).reply[slot],'no');
 } finally {global.wx=previous;}
});
test('无效邀请页面明确报错；页面不展示数据；非发起人不能复制会议开启新一轮',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const p=page('meeting',wx);p.onLoad({id:'unknown',token:'bad'});p.onShow();
  assert.equal(p.data.meeting,null);assert.match(p.data.error,/不存在/);
  const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
  const input={title:'会议',purpose:'测试',dates:[date],from:'09:00',to:'10:00',duration:60,interval:30,deadline:D.dateTime(date,'08:00'),roster:[{name:'甲',required:true}]};
  const {id}=store.create(input);store.setActor('demo-a');
  assert.throws(()=>store.create({...input,previousId:id}),/仅发起人/);
 } finally {global.wx=previous;}
});
function fixture(wx) {
 const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
 return store.create({title:'独立身份页',purpose:'确认会议目的',dates:[date],from:'09:00',to:'11:00',duration:60,interval:30,
  deadline:D.dateTime(date,'08:00'),roster:[{name:'甲',required:true},{name:'乙',required:true}]});
}
test('身份页：只选头像无需打字，保存失败不跳转；角色被占用不能覆盖',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();
  await identity.selectRole(event('',{index:'0'}));assert.match(identity.data.error,/头像/);assert.equal(wx.routes.length,0);
  identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});wx.failSave(true);
  await identity.confirmIdentity(event('',{}));assert.match(identity.data.error,/存储空间/);assert.equal(wx.routes.length,0);assert.equal(store.view(id,token).self,null);
  wx.failSave(false);await identity.confirmIdentity(event('',{}));assert.match(wx.routes.at(-1),/pages\/meeting\/meeting/);
  store.setActor('demo-b');const other=page('identity',wx);other.onLoad({id,token});other.onShow();
  other.chooseAvatar({detail:{avatarUrl:'wxfile://temp/b.png'}});other.setData({roleIndex:0});
  const before=wx.routes.length;await other.confirmIdentity(event('',{}));assert.match(other.data.error,/已被认领/);assert.equal(wx.routes.length,before);assert.equal(store.view(id,token).self,null);
 }finally{global.wx=previous;}
});
test('身份页：已认领者直接进入；更正时留在身份页并迁移已提交选择',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');
  store.act(id,token,'claim',{roleId:'r0',profile:{name:'甲'}});
  const votes=Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'yes']));store.act(id,token,'reply',{choices:votes});
  const reenter=page('identity',wx);reenter.onLoad({id,token});reenter.onShow();assert.match(wx.routes.at(-1),/pages\/meeting\/meeting/);
  const edit=page('identity',wx);edit.onLoad({id,token,edit:'1'});const before=wx.routes.length;edit.onShow();assert.equal(wx.routes.length,before);assert.equal(edit.data.roleIndex,0);
  edit.chooseAvatar({detail:{avatarUrl:'wxfile://temp/edit.png'}});await edit.selectRole(event('',{index:'1'}));
  const m=store.view(id,token);assert.equal(m.self.roleId,'r1');assert.deepEqual(m.reply,votes);assert.equal(m.members.length,1);
 }finally{global.wx=previous;}
});
test('身份页：仅接收信息者确认后进入但不能投票；无效邀请不显示会议',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-guest');
  const bad=page('identity',wx);bad.onLoad({id,token:'wrong'});bad.onShow();assert.equal(bad.data.meeting,null);assert.match(bad.data.error,/邀请/);
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/guest.png'}});
  assert.equal(identity.data.roles.at(-1).name,'旁听者');
  await identity.selectRole(event('',{index:String(identity.data.roles.length-1)}));
  const m=page('meeting',wx);m.onLoad({id,token});m.onShow();assert.equal(m.data.canVote,false);assert.equal(m.data.meeting.self.roleId,null);
 }finally{global.wx=previous;}
});
test('截止后身份页不能新增认领，发起人可独立管理；保留旧邀请入口兼容',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);
  const data=wx.storage.get('meeting-battle.mock.v1');data.meetings[id].deadline=Date.now()-1;
  store.setActor('demo-a');const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();assert.equal(identity.data.editable,false);
  identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});await identity.selectRole(event('',{index:'0'}));assert.match(identity.data.error,/截止/);assert.equal(wx.routes.length,0);
  store.setActor('demo-owner');const manage=page('meeting',wx);manage.onLoad({id});manage.onShow();assert.equal(manage.data.meeting.isOwner,true);assert.equal(manage.data.meeting.self,null);
  const home=page('home',wx);home.typeInvite(event('/pages/meeting/meeting?id='+id+'&token='+token));home.join();assert.match(wx.routes.at(-1),/pages\/identity\/identity/);
  home.typeInvite(event('/pages/identity/identity?id='+id+'&token='+token));home.join();assert.equal(home.data.error,'');assert.match(wx.routes.at(-1),/pages\/identity\/identity/);
 }finally{global.wx=previous;}
});
test('头像取消/保存失败不产生绑定；保存未完成前不能认领，成功后无需输入直接进入',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();
  identity.chooseAvatar({detail:{}});assert.equal(identity.data.error,'');assert.equal(identity.data.avatar,'');
  wx.getFileSystemManager=()=>({saveFile(o){o.fail();o.complete();}});
  identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});assert.match(identity.data.error,/保存失败/);
  await identity.selectRole(event('',{index:'0'}));assert.equal(store.view(id,token).self,null);assert.equal(wx.routes.length,0);
  let pending;wx.getFileSystemManager=()=>({saveFile(o){pending=o;}});
  identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});assert.equal(identity.data.savingAvatar,true);
  await identity.selectRole(event('',{index:'0'}));assert.equal(wx.routes.length,0);
  pending.success({savedFilePath:'wxfile://saved/a.png'});pending.complete();
  await identity.selectRole(event('',{index:'0'}));
  const self=store.view(id,token).self;assert.equal(self.profile.name,'甲');assert.equal(self.profile.nameSource,'role');assert.equal(self.profile.avatar,'wxfile://saved/a.png');
  assert.match(wx.routes.at(-1),/pages\/meeting\/meeting/);
 }finally{global.wx=previous;}
});
test('取消角色确认停留原页不绑定；再次点击确认才跳转',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});
  let message='';wx.showModal=o=>{message=o.content;o.success({confirm:false});};
  await identity.selectRole(event('',{index:'0'}));assert.match(message,/甲/);assert.equal(store.view(id,token).self,null);assert.equal(wx.routes.length,0);
  wx.showModal=o=>o.success({confirm:true});await identity.selectRole(event('',{index:'0'}));
  assert.equal(store.view(id,token).self.roleId,'r0');assert.equal(wx.routes.length,1);
 }finally{global.wx=previous;}
});
test('确认期间角色被另一成员抢先认领，保存失败不跳转或覆盖',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/a.png'}});
  wx.showModal=o=>{
   store.setActor('demo-b');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/b.png'}});
   store.setActor('demo-a');o.success({confirm:true});
  };
  await identity.selectRole(event('',{index:'0'}));assert.match(identity.data.error,/已被认领/);assert.equal(wx.routes.length,0);assert.equal(store.view(id,token).self,null);
  store.setActor('demo-b');assert.equal(store.view(id,token).self.roleId,'r0');
 }finally{global.wx=previous;}
});
test('重进已有会议：列表链接携带有效邀请，恢复旧编号链接后仍可切换未加入成员',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);
  const home=page('home',wx);home.onShow();home.open(event('',{id}));
  const query=new URLSearchParams(wx.routes.at(-1).split('?')[1]);assert.equal(query.get('token'),token);
  const restored=page('meeting',wx);restored.onLoad({id});restored.onShow();assert.equal(restored.data.meeting.isOwner,true);
  restored.switchActor(event('1'));assert.equal(restored.data.error,'');assert.equal(restored.data.actorIndex,1);
  assert.match(wx.routes.at(-1),/pages\/identity\/identity/);
  const invite=new URLSearchParams(wx.routes.at(-1).split('?')[1]);assert.equal(invite.get('token'),token);
  const identity=page('identity',wx);identity.onLoad({id,token:invite.get('token')});identity.onShow();assert.equal(identity.data.editable,true);
 }finally{global.wx=previous;}
});
test('已加入成员以无token旧链接重进，也能在模拟模式携带有效邀请切换新人',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
  const m=page('meeting',wx);m.onLoad({id});m.onShow();assert.equal(m.data.meeting.self.roleId,'r0');
  m.switchActor(event('2'));assert.equal(m.data.error,'');assert.match(wx.routes.at(-1),/pages\/identity\/identity/);
  assert.equal(new URLSearchParams(wx.routes.at(-1).split('?')[1]).get('token'),token);
 }finally{global.wx=previous;}
});
test('撤销邀请后模拟新人仍被拒绝，失败时身份显示正确，并可切回发起人或已加入成员',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-a');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
  store.setActor('demo-owner');store.act(id,null,'revoke',{});
  const m=page('meeting',wx);m.onLoad({id,token});m.onShow();m.switchActor(event('2'));
  assert.match(m.data.error,/已撤销/);assert.equal(m.data.actorIndex,2);assert.equal(m.data.meeting,null);
  m.switchActor(event('0'));assert.equal(m.data.error,'');assert.equal(m.data.actorIndex,0);assert.equal(m.data.meeting.isOwner,true);
  m.switchActor(event('1'));assert.equal(m.data.error,'');assert.equal(m.data.meeting.self.roleId,'r0');
 }finally{global.wx=previous;}
});
test('不能用模拟辅助函数从无权限的编号或错误token取出邀请；缺少/错误/撤销分开提示',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-guest');
  assert.throws(()=>store.simulationInvite(id),/缺少邀请/);assert.throws(()=>store.simulationInvite(id,'bad'),/凭证无效/);
  const m=page('meeting',wx);m.onLoad({id});m.onShow();assert.match(m.data.error,/缺少邀请/);
  m.switchActor(event('1'));assert.match(m.data.error,/缺少邀请/);assert.equal(m.data.actorIndex,1);assert.equal(m.data.meeting,null);
  assert.throws(()=>store.view(id,undefined),/缺少邀请/);assert.throws(()=>store.view(id,'bad'),/凭证无效/);
 }finally{global.wx=previous;}
});
test('名单备注在创建/新一轮保留，认领选项可读；发起人工具只显示C而不拼接身份',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
  const create=page('create',wx);create.setData({title:'称呼测试',purpose:'讨论',dates:[date],deadlineDate:date,deadlineTime:'08:00',roster:'C:提供管理建议\nD：主持会议?'});
  const input=create.input();assert.equal(input.roster[0].name,'C');assert.equal(input.roster[0].note,'提供管理建议');
  const {id,token}=store.create(input);store.setActor('demo-c');
  const identity=page('identity',wx);identity.onLoad({id,token});identity.onShow();assert.equal(identity.data.roles[0].name,'C');assert.equal(identity.data.roles[0].note,'提供管理建议');
  identity.chooseAvatar({detail:{avatarUrl:'wxfile://temp/c.png'}});await identity.selectRole(event('',{index:'0'}));
  store.setActor('demo-owner');const m=page('meeting',wx);m.onLoad({id});m.onShow();assert.equal(m.data.managed[0].label,'C');assert.equal(m.data.moveRoles[1].label,'C');
  const round=page('create',wx);round.onLoad({previous:id});assert.equal(round.data.roster,'C：提供管理建议\nD：主持会议?');
 }finally{global.wx=previous;}
});
test('旧版冒号姓名兼容：角色ID、头像、回复均保留，旧存储不因读取被重写',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);store.setActor('demo-c');
  store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/c.png'}});
  const votes=Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'yes']));store.act(id,token,'reply',{choices:votes});
  const raw=wx.storage.get('meeting-battle.mock.v1');raw.meetings[id].roles[0].name='C:ehui';delete raw.meetings[id].roles[0].note;
  raw.meetings[id].members[0].profile.name='C:ehui';const snapshot=JSON.stringify(raw);
  store.setActor('demo-owner');const m=page('meeting',wx);m.onLoad({id});m.onShow();
  assert.equal(m.data.managed[0].label,'C');assert.equal(m.data.meeting.roles[0].name,'C');assert.equal(m.data.meeting.roles[0].note,'ehui');assert.equal(m.data.managed[0].roleId,'r0');assert.equal(m.data.managed[0].profile.avatar,'wxfile://saved/c.png');
  assert.equal(JSON.stringify(wx.storage.get('meeting-battle.mock.v1')),snapshot);
  store.act(id,null,'move',{targetActor:'demo-c',roleId:'r1'});store.setActor('demo-c');assert.deepEqual(store.view(id,null).reply,votes);
 }finally{global.wx=previous;}
});
test('最终会议通知只使用称呼，不带冒号后的备注',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
  const {id,token}=store.create({title:'通知测试',purpose:'安排',dates:[date],from:'09:00',to:'10:00',duration:60,interval:30,deadline:D.dateTime(date,'08:00'),roster:D.parseRoster('C：只在认领选项显示的备注')});
  store.setActor('demo-c');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/c.png'}});
  const votes=Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'yes']));store.act(id,token,'reply',{choices:votes});
  store.setActor('demo-owner');const v=store.view(id);store.act(id,null,'lock',{slotId:v.slots[0].id,version:v.version});
  const m=page('meeting',wx);m.onLoad({id});m.onShow();await m.copyNotice();assert.match(wx.clipboards.at(-1),/参会名单：C\n/);assert.doesNotMatch(wx.clipboards.at(-1),/只在认领选项显示/);
 }finally{global.wx=previous;}
});
test('添加日期状态：未添加可操作、重复点击不清空预览，切日期与删除后状态正确',()=>{
 const wx=mockWx(),create=page('create',wx);create.onLoad({});
 assert.equal(create.data.dateAdded,false);
 const first=create.data.date;
 create.addDate();assert.equal(create.data.dateAdded,true);assert.equal(create.data.dates.length,1);
 create.preview();assert.ok(create.data.slots.length>0);
 const snapshot=JSON.stringify(create.data.slots);create.addDate();assert.equal(create.data.dates.length,1);assert.equal(JSON.stringify(create.data.slots),snapshot);
 const second=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
 create.dateChanged(event(second));assert.equal(create.data.dateAdded,false);create.addDate();assert.equal(create.data.dateAdded,true);assert.equal(create.data.dates.length,2);
 create.removeDate(event('',{date:first}));assert.equal(create.data.dateAdded,true);
 create.removeDate(event('',{date:second}));assert.equal(create.data.dateAdded,false);assert.equal(create.data.dates.length,0);
 create.addDate();create.dateChanged(event(first));assert.equal(create.data.dateAdded,false);
 create.dateChanged(event(second));assert.equal(create.data.dateAdded,true);
});
function voterPage(wx,owner=false) {
 const {id,token}=fixture(wx);
 if(!owner)store.setActor('demo-a');
 store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
 const m=page('meeting',wx);m.onLoad({id,token});m.onShow();m.batch(event('',{choice:'yes'}));
 return {m,id,token};
}
test('被邀请人提交成功：感谢提示等待OK，防重复提交，首页只高亮该会议并滚动一次',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=voterPage(wx);await m.submit();assert.equal(m.data.submissionSuccess,true);assert.equal(m.data.submitPending,true);
  const version=store.view(id,token).version;await m.submit();assert.equal(store.view(id,token).version,version);
  wx.advance(60000);assert.equal(wx.relaunches.length,0);assert.equal(m.data.submissionSuccess,true);
  m.confirmSubmission();assert.equal(wx.relaunches.length,1);m.confirmSubmission();assert.equal(wx.relaunches.length,1);
  const query=new URLSearchParams(wx.relaunches[0].split('?')[1]);assert.equal(query.get('highlight'),id);
  const home=page('home',wx);home.onLoad({highlight:query.get('highlight')});home.onShow();
  assert.equal(home.data.highlightId,id);assert.equal(home.data.meetings.filter(x=>x.id===id).length,1);assert.equal(wx.scrolls.length,0);
  home.onReady();assert.equal(wx.scrolls.length,1);assert.equal(wx.scrolls[0].selector,'#my-meetings');home.refresh();assert.equal(wx.scrolls.length,1);
  home.open(event('',{id}));assert.equal(home.data.highlightId,'');home.onShow();assert.equal(home.data.highlightId,'');
 }finally{global.wx=previous;}
});
test('未填完整或存储失败不显示感谢、不安排跳转，也不伪装成保存成功',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=voterPage(wx);m.setChoices({});await m.submit();assert.match(m.data.error,/全部候选/);assert.equal(m.data.submissionSuccess,false);assert.equal(m.data.submitPending,false);
  m.batch(event('',{choice:'yes'}));wx.failSave(true);await m.submit();assert.match(m.data.error,/存储空间/);assert.equal(store.view(id,token).submitted,0);
  assert.equal(m.data.submissionSuccess,false);assert.equal(m.data.submitPending,false);wx.advance(3000);assert.equal(wx.relaunches.length,0);
 }finally{global.wx=previous;}
});
test('成功提示隐藏后仍保留，隐藏或卸载时不能触发跳转；已提交内容仍保存',async()=>{
 const previous=global.wx;
 try {
  for(const lifecycle of ['onHide','onUnload']){
   const wx=mockWx();global.wx=wx;const {m,id,token}=voterPage(wx);await m.submit();
   m[lifecycle]();wx.advance(60000);m.confirmSubmission();assert.equal(wx.relaunches.length,0);assert.equal(store.view(id,token).submitted,1);
   if(lifecycle==='onHide'){m.onShow();assert.equal(m.data.submissionSuccess,true);m.confirmSubmission();assert.equal(wx.relaunches.length,1);}
  }
 }finally{global.wx=previous;}
});
test('返回首页失败保留感谢弹窗和回复，允许再次点击OK重试',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=voterPage(wx);wx.failRelaunch(true);await m.submit();m.confirmSubmission();
  assert.equal(store.view(id,token).submitted,1);assert.equal(m.data.submissionSuccess,true);assert.equal(m.data.returningHome,false);assert.match(m.data.returnError,/选择已保存.*返回首页失败/);
  const version=store.view(id,token).version;wx.failRelaunch(false);m.confirmSubmission();assert.equal(wx.relaunches.length,2);assert.equal(store.view(id,token).version,version);
 }finally{global.wx=previous;}
});
test('发起人填写自己的选择后留在协调页，不自动离开管理流程',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=voterPage(wx,true);await m.submit();assert.equal(store.view(id,token).submitted,1);assert.equal(m.data.submissionSuccess,false);assert.equal(m.data.submitPending,false);
  wx.advance(3000);assert.equal(wx.relaunches.length,0);assert.equal(m.data.meeting.isOwner,true);
 }finally{global.wx=previous;}
});
test('首页普通进入不高亮，伪造/未参与会议不高亮，切换账号清除上次高亮',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);const normal=page('home',wx);normal.onLoad({});normal.onShow();normal.onReady();assert.equal(normal.data.highlightId,'');assert.equal(wx.scrolls.length,0);
  const invalid=page('home',wx);invalid.onLoad({highlight:'unknown'});invalid.onShow();invalid.onReady();assert.equal(invalid.data.highlightId,'');
  store.setActor('demo-a');const other=page('home',wx);other.onLoad({highlight:id});other.onShow();other.onReady();assert.equal(other.data.highlightId,'');assert.equal(other.data.meetings.length,0);
  store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
  const highlight=page('home',wx);highlight.onLoad({highlight:id});highlight.onShow();assert.equal(highlight.data.highlightId,id);
  highlight.switchActor(event('2'));assert.equal(highlight.data.highlightId,'');assert.equal(highlight.data.meetings.length,0);
 }finally{global.wx=previous;}
});
function correctionPage(wx,count=4) {
 const {id,token}=fixture(wx),actors=['demo-a','demo-b','demo-c','demo-guest'];
 for(let i=0;i<count;i++){
  store.setActor(actors[i]);store.act(id,token,'claim',{roleId:i<2?'r'+i:null,profile:{nameSource:'role',avatar:'wxfile://saved/'+actors[i]+'.png'}});
  if(i<2)store.act(id,token,'reply',{choices:Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'yes']))});
 }
 store.setActor('demo-owner');const m=page('meeting',wx);m.onLoad({id});m.onShow();return {m,id,token,actors};
}
test('更正列表最多三行高度，所有已加入成员仍可列出，少于三人时按人数收缩',()=>{
 const previous=global.wx;
 try {
  for(const count of [1,2,3,4]){
   const wx=mockWx();global.wx=wx;const {m}=correctionPage(wx,count);
   assert.equal(m.data.managed.length,count);assert.equal(m.data.correctionListStyle,'height:'+Math.min(count,3)*160+'rpx;');assert.equal(m.data.hasMoreCorrections,count>3);
   for(const row of m.data.managed){assert.equal(row.canMove,false);assert.equal(row.targetLabel,'选择角色');assert.ok(row.profile.avatar);}
  }
 }finally{global.wx=previous;}
});
test('每行独立选择/确认，提交一行不执行另一行，头像及回复保留',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=correctionPage(wx);
  m.moveChange(event('0',{actor:'demo-a'})); // free A's role by moving to observer
  m.moveChange(event('1',{actor:'demo-b'})); // select A, but do not submit this row yet
  assert.equal(m.data.managed.find(p=>p.actor==='demo-a').targetIndex,0);assert.equal(m.data.managed.find(p=>p.actor==='demo-b').targetIndex,1);
  assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,'r0');
  await m.move(event('',{actor:'demo-a'}));
  assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,null);assert.equal(store.view(id).members.find(p=>p.actor==='demo-b').roleId,'r1');
  assert.equal(m.data.managed.find(p=>p.actor==='demo-b').targetIndex,1);assert.equal(m.data.managed.find(p=>p.actor==='demo-b').canMove,true);
  await m.move(event('',{actor:'demo-b'}));assert.equal(store.view(id).members.find(p=>p.actor==='demo-b').roleId,'r0');
  store.setActor('demo-b');const v=store.view(id,token);assert.equal(v.self.profile.avatar,'wxfile://saved/demo-b.png');assert.ok(Object.values(v.reply).every(c=>c==='yes'));
 }finally{global.wx=previous;}
});
test('目标被占用时更正失败，不覆盖双方，选择保留；相同角色不重复写入',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=correctionPage(wx);m.moveChange(event('2',{actor:'demo-a'}));
  await m.move(event('',{actor:'demo-a'}));assert.match(m.data.error,/已被认领/);
  const v=store.view(id);assert.equal(v.members.find(p=>p.actor==='demo-a').roleId,'r0');assert.equal(v.members.find(p=>p.actor==='demo-b').roleId,'r1');assert.equal(m.data.managed.find(p=>p.actor==='demo-a').targetIndex,2);
  m.moveChange(event('1',{actor:'demo-a'}));const version=store.view(id).version;await m.move(event('',{actor:'demo-a'}));assert.equal(store.view(id).version,version);
 }finally{global.wx=previous;}
});
test('取消确认或存储失败不更正；切换模拟账号清除待选目标，普通成员不能操作',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=correctionPage(wx);m.moveChange(event('0',{actor:'demo-a'}));
  wx.showModal=o=>o.success({confirm:false});await m.move(event('',{actor:'demo-a'}));assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,'r0');assert.equal(m.data.moveConfirming,false);
  wx.showModal=o=>o.success({confirm:true});wx.failSave(true);await m.move(event('',{actor:'demo-a'}));assert.match(m.data.error,/存储空间/);assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,'r0');assert.equal(m.data.moveConfirming,false);
  wx.failSave(false);m.switchActor(event('1'));assert.equal(Object.keys(m.data.moveSelections).length,0);assert.equal(m.data.managed.length,0);
  const version=store.view(id,token).version;await m.move(event('',{actor:'demo-b'}));assert.equal(store.view(id,token).version,version);
 }finally{global.wx=previous;}
});
test('目标角色已占用：直接弹单按钮拒绝提示，不出现执行确认，不改任何绑定或回复',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m}=correctionPage(wx);const snapshot=JSON.stringify(wx.storage.get('meeting-battle.mock.v1')),modals=[];
  wx.showModal=o=>{modals.push(o);o.success({confirm:true});};
  m.moveChange(event('2',{actor:'demo-a'}));await m.move(event('',{actor:'demo-a'}));
  assert.equal(modals.length,1);assert.equal(modals[0].title,'角色已被认领');assert.equal(modals[0].showCancel,false);assert.match(modals[0].content,/乙.*已被认领.*未执行/);
  assert.equal(JSON.stringify(wx.storage.get('meeting-battle.mock.v1')),snapshot);assert.equal(m.data.moveConfirming,false);assert.equal(m.data.busy,false);
 }finally{global.wx=previous;}
});
test('确认弹窗期间角色被他人认领：业务层拒绝后也弹窗，不静默失败',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=correctionPage(wx);store.act(id,null,'move',{targetActor:'demo-a',roleId:null});m.refresh();
  const modals=[];wx.showModal=o=>{
   modals.push(o);
   if(o.showCancel!==false){store.setActor('demo-c');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/c.png'}});store.setActor('demo-owner');}
   o.success({confirm:true});
  };
  m.moveChange(event('1',{actor:'demo-b'}));await m.move(event('',{actor:'demo-b'}));
  assert.equal(modals.length,2);assert.equal(modals[1].showCancel,false);assert.match(modals[1].content,/已被认领/);
  const v=store.view(id);assert.equal(v.members.find(p=>p.actor==='demo-b').roleId,'r1');assert.equal(v.members.find(p=>p.actor==='demo-c').roleId,'r0');
  assert.equal(m.data.moveConfirming,false);
 }finally{global.wx=previous;}
});
test('更正写入失败也就地弹窗，解除锁定后可重试且不改变其他行',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=correctionPage(wx),modals=[];wx.showModal=o=>{modals.push(o);o.success({confirm:true});};
  m.moveChange(event('0',{actor:'demo-a'}));wx.failSave(true);await m.move(event('',{actor:'demo-a'}));
  assert.equal(modals.at(-1).showCancel,false);assert.match(modals.at(-1).content,/存储空间/);assert.equal(m.data.moveConfirming,false);
  assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,'r0');
  wx.failSave(false);await m.move(event('',{actor:'demo-a'}));assert.equal(store.view(id).members.find(p=>p.actor==='demo-a').roleId,null);assert.equal(store.view(id).members.find(p=>p.actor==='demo-b').roleId,'r1');
 }finally{global.wx=previous;}
});
function publishPage(wx){
 const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
 const c=page('create',wx);c.onLoad({});c.onShow();
 c.setData({title:'邀请发布测试',purpose:'讨论安排',dates:[date],from:'09:00',to:'11:00',duration:'60',interval:'30',deadlineDate:date,deadlineTime:'08:00',roster:'A：主持\nB：建议?'});c.preview();return c;
}
test('发布后先展示会议邀请摘要，不立即返回；只包含保留候选及短称呼',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const c=publishPage(wx);c.toggleSlot(event('',{id:c.data.slots[0].id}));await c.publish();
  const invite=c.data.publishedInvite;assert.equal(invite.title,'邀请发布测试');assert.equal(invite.participants,'A、B');assert.equal(invite.slots.length,2);assert.match(invite.path,/pages\/identity\/identity\?id=.+&token=/);
  assert.equal(store.list().length,1);assert.equal(wx.clipboards.length,0);wx.advance(60000);assert.equal(wx.relaunches.length,0);assert.equal(wx.routes.length,0);
 }finally{global.wx=previous;}
});
test('只有确认复制且剪贴板成功才显示成功，两秒回首页，连点不重复复制或创建',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const c=publishPage(wx);await c.publish();await c.publish();assert.equal(store.list().length,1);
  const first=c.copyInvitation();const second=c.copyInvitation();await Promise.all([first,second]);
  assert.equal(wx.clipboards.length,1);assert.equal(wx.clipboards[0],c.data.publishedInvite.path);assert.equal(c.data.copySuccess,true);
  wx.advance(1999);assert.equal(wx.relaunches.length,0);wx.advance(1);assert.equal(wx.relaunches.length,1);assert.equal(wx.relaunches[0],'/pages/home/home');assert.equal(store.list().length,1);
 }finally{global.wx=previous;}
});
test('复制失败不提示成功、不跳转；重试复制同一会议链接，不要求再次发布',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const c=publishPage(wx);await c.publish();const id=c.data.publishedInvite.id;
  wx.failClipboard(true);await c.copyInvitation();assert.equal(c.data.copySuccess,false);assert.equal(c.data.copying,false);assert.match(c.data.copyError,/复制未成功/);
  wx.advance(3000);assert.equal(wx.relaunches.length,0);assert.equal(store.list().length,1);
  wx.failClipboard(false);await c.copyInvitation();assert.equal(c.data.copySuccess,true);assert.equal(c.data.publishedInvite.id,id);assert.equal(store.list().length,1);
 }finally{global.wx=previous;}
});
test('发布取消或写入失败不显示邀请，也不能复制不存在的会议',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const c=publishPage(wx);wx.showModal=o=>o.success({confirm:false});await c.publish();assert.equal(c.data.publishedInvite,null);assert.equal(store.list().length,0);
  wx.showModal=o=>o.success({confirm:true});wx.failSave(true);await c.publish();assert.match(c.data.error,/存储空间/);assert.equal(c.data.publishedInvite,null);assert.equal(c.data.busy,false);
  await c.copyInvitation();assert.equal(wx.clipboards.length,0);assert.equal(wx.routes.length,0);
 }finally{global.wx=previous;}
});
test('复制成功后隐藏暂停返回计时，回前台重新等待两秒；卸载不再跳转',async()=>{
 const previous=global.wx;
 try {
  for(const lifecycle of ['onHide','onUnload']){
   const wx=mockWx();global.wx=wx;const c=publishPage(wx);await c.publish();await c.copyInvitation();
   wx.advance(1000);c[lifecycle]();wx.advance(4000);assert.equal(wx.relaunches.length,0);
   if(lifecycle==='onHide'){c.onShow();wx.advance(1999);assert.equal(wx.relaunches.length,0);wx.advance(1);assert.equal(wx.relaunches.length,1);}
  }
 }finally{global.wx=previous;}
});
test('邀请已复制但返回失败，保留成功状态和已保存会议，点击返回首页可重试',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const c=publishPage(wx);await c.publish();wx.failRelaunch(true);await c.copyInvitation();wx.advance(2000);
  assert.equal(c.data.copySuccess,true);assert.equal(c.data.returnFailed,true);assert.match(c.data.copyError,/邀请已复制.*返回首页失败/);
  wx.failRelaunch(false);c.returnHome();assert.equal(wx.relaunches.length,2);assert.equal(store.list().length,1);assert.equal(wx.clipboards.length,1);
 }finally{global.wx=previous;}
});
test('我的会议发起人标识按真实创建身份显示，参与别人会议不显示，切换身份即时重算',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const first=fixture(wx);store.setActor('demo-a');store.act(first.id,first.token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
  const second=fixture(wx);const home=page('home',wx);home.onLoad({});home.onShow();
  assert.equal(home.data.meetings.find(m=>m.id===first.id).isOwner,false);assert.equal(home.data.meetings.find(m=>m.id===second.id).isOwner,true);
  store.setActor('demo-owner');store.act(second.id,second.token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/owner.png'}});
  home.switchActor(event('0'));assert.equal(home.data.meetings.find(m=>m.id===first.id).isOwner,true);assert.equal(home.data.meetings.find(m=>m.id===second.id).isOwner,false);
 }finally{global.wx=previous;}
});
test('参与者未提交提示：选择草稿后仍提醒，失败不消失，明确保存成功后消失',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=voterPage(wx);assert.equal(m.data.showVotePrompt,true);assert.equal(m.data.hasSubmitted,false);
  m.batch(event('',{choice:'yes'}));assert.equal(m.data.showVotePrompt,true);
  wx.failSave(true);await m.submit();assert.equal(m.data.showVotePrompt,true);assert.equal(m.data.hasSubmitted,false);
  wx.failSave(false);await m.submit();assert.equal(m.data.showVotePrompt,false);assert.equal(m.data.hasSubmitted,true);
  const again=page('meeting',wx);again.onLoad({id,token});again.onShow();assert.equal(again.data.showVotePrompt,false);assert.equal(again.data.hasSubmitted,true);
 }finally{global.wx=previous;}
});
test('参会发起人会被提醒，旁听者及已截止参与者不提示下滑提交',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const owner=voterPage(wx,true);assert.equal(owner.m.data.showVotePrompt,true);
  store.setActor('demo-guest');store.act(owner.id,owner.token,'claim',{roleId:null,profile:{nameSource:'role',avatar:'wxfile://saved/guest.png'}});
  const observer=page('meeting',wx);observer.onLoad({id:owner.id,token:owner.token});observer.onShow();assert.equal(observer.data.showVotePrompt,false);assert.equal(observer.data.canVote,false);
  store.setActor('demo-owner');const {id,token}=fixture(wx);store.setActor('demo-a');store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}});
  wx.storage.get('meeting-battle.mock.v1').meetings[id].deadline=Date.now()-1;
  const closed=page('meeting',wx);closed.onLoad({id,token});closed.onShow();assert.equal(closed.data.showVotePrompt,false);assert.equal(closed.data.canVote,false);
 }finally{global.wx=previous;}
});
function submittedPage(wx,owner=false){
 const context=voterPage(wx,owner);
 store.act(context.id,context.token,'reply',{choices:context.m.data.choices});context.m.refresh();return context;
}
test('已提交详情默认只读，单项/批量点击与直接提交均不改保存的回复',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=submittedPage(wx);assert.equal(m.data.hasSubmitted,true);assert.equal(m.data.canVote,false);assert.equal(m.data.editingVote,false);
  const snapshot=JSON.stringify(store.view(id,token).reply),version=store.view(id,token).version;
  m.pick(event('',{slot:m.data.slots[0].id,choice:'no'}));m.batch(event('',{choice:'no'}));await m.submit();
  assert.equal(JSON.stringify(m.data.choices),snapshot);assert.equal(store.view(id,token).version,version);assert.equal(wx.relaunches.length,0);
 }finally{global.wx=previous;}
});
test('点击修改进入填写状态并滚动，预填原选择，保存后回只读并保留OK确认流程',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=submittedPage(wx);m.beginEditTime();assert.equal(m.data.editingVote,true);assert.equal(m.data.canVote,true);assert.equal(wx.scrolls.at(-1).selector,'#vote-options');
  const slot=m.data.slots[0].id;assert.equal(m.data.choices[slot],'yes');m.pick(event('',{slot,choice:'maybe'}));assert.equal(store.view(id,token).reply[slot],'yes');
  await m.submit();assert.equal(store.view(id,token).reply[slot],'maybe');assert.equal(m.data.canVote,false);assert.equal(m.data.editingVote,false);assert.equal(m.data.submissionSuccess,true);
  m.confirmSubmission();const again=page('meeting',wx);again.onLoad({id,token});again.onShow();assert.equal(again.data.canVote,false);assert.equal(again.data.choices[slot],'maybe');
 }finally{global.wx=previous;}
});
test('取消修改丢弃草稿，保存失败保留填写状态，均不覆盖原回复',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=submittedPage(wx);m.beginEditTime();m.batch(event('',{choice:'no'}));m.cancelEditTime();assert.equal(m.data.canVote,false);assert.ok(Object.values(m.data.choices).every(c=>c==='yes'));
  m.beginEditTime();m.batch(event('',{choice:'no'}));wx.failSave(true);await m.submit();assert.equal(m.data.canVote,true);assert.equal(m.data.editingVote,true);assert.equal(m.data.submissionSuccess,false);assert.ok(Object.values(store.view(id,token).reply).every(c=>c==='yes'));
 }finally{global.wx=previous;}
});
test('已截止/锁定不能进入修改；发起人修改自己的回复后也回只读详情',async()=>{
 const previous=global.wx;
 try {
  for(const status of ['closed','locked']){
   const wx=mockWx();global.wx=wx;const {m,id}=submittedPage(wx);const raw=wx.storage.get('meeting-battle.mock.v1').meetings[id];
   if(status==='closed')raw.deadline=Date.now()-1;else{raw.status='locked';raw.finalSlot=raw.slots[0].id;}
   m.beginEditTime();assert.equal(m.data.editingVote,false);assert.equal(m.data.canVote,false);
  }
  const wx=mockWx();global.wx=wx;const {m,id,token}=submittedPage(wx,true);m.beginEditTime();m.batch(event('',{choice:'no'}));await m.submit();
  assert.equal(m.data.canVote,false);assert.equal(m.data.submissionSuccess,false);assert.equal(wx.relaunches.length,0);assert.ok(Object.values(store.view(id,token).reply).every(c=>c==='no'));
 }finally{global.wx=previous;}
});
test('发起人未认领参会角色不催填，认领后提醒；草稿仍提醒，成功提交后消失',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {id,token}=fixture(wx);const m=page('meeting',wx);m.onLoad({id});m.onShow();assert.equal(m.data.showVotePrompt,false);assert.equal(m.data.isVoter,false);
  store.act(id,token,'claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/owner.png'}});m.refresh();assert.equal(m.data.showVotePrompt,true);
  m.batch(event('',{choice:'yes'}));assert.equal(m.data.showVotePrompt,true);await m.submit();assert.equal(m.data.showVotePrompt,false);assert.equal(m.data.hasSubmitted,true);assert.equal(m.data.canVote,false);assert.equal(m.data.submissionSuccess,false);
 }finally{global.wx=previous;}
});
function lockPage(wx){
 const context=correctionPage(wx,2);return context;
}
test('发起人锁定可协调时段前明确提示人员，锁定成功而非冒充全员明确可以',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=lockPage(wx);store.setActor('demo-a');const choices=Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'maybe']));store.act(id,token,'reply',{choices});
  store.setActor('demo-owner');m.refresh();const s=m.data.slots[0];assert.equal(s.eligible,true);assert.equal(s.allYes,false);
  let content='';wx.showModal=o=>{content=o.content;o.success({confirm:true});};await m.lock(event('',{id:s.id}));assert.match(content,/可协调：甲/);assert.equal(store.view(id).status,'locked');
 }finally{global.wx=previous;}
});
test('发起人填写网络会议链接并复制时保存，其他成员重进看到并复制同一链接',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=lockPage(wx);await m.lock(event('',{id:m.data.slots[0].id}));
  const url='https://meeting.example.com/join?pwd=123';m.meetingLinkChanged(event(url));assert.equal(store.view(id).meetingLink,'');await m.copyNotice();assert.equal(store.view(id).meetingLink,url);assert.match(wx.clipboards.at(-1),/网络会议链接：https:\/\/meeting.example.com\/join\?pwd=123/);
  store.setActor('demo-a');const attendee=page('meeting',wx);attendee.onLoad({id,token});attendee.onShow();assert.equal(attendee.data.meeting.meetingLink,url);attendee.meetingLinkChanged(event('https://wrong.example.com'));assert.equal(attendee.data.meetingLinkInput,url);
  await attendee.copyNotice();assert.ok(wx.clipboards.at(-1).includes(url));assert.ok(!wx.clipboards.at(-1).includes('wrong.example.com'));
 }finally{global.wx=previous;}
});
test('网络会议链接验证或存储失败时不复制通知，保持草稿以便重试',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=lockPage(wx);await m.lock(event('',{id:m.data.slots[0].id}));
  m.meetingLinkChanged(event('不是链接'));await m.copyNotice();assert.match(m.data.noticeError,/会议链接/);assert.equal(wx.clipboards.length,0);assert.equal(m.data.linkDirty,true);
  m.meetingLinkChanged(event('https://meeting.example.com/a'));wx.failSave(true);await m.copyNotice();assert.match(m.data.noticeError,/存储空间/);assert.equal(store.view(id).meetingLink,'');assert.equal(wx.clipboards.length,0);assert.equal(m.data.noticeCopying,false);
  wx.failSave(false);await m.copyNotice();assert.equal(wx.clipboards.length,1);assert.equal(m.data.linkDirty,false);
 }finally{global.wx=previous;}
});
test('会议链接保存后剪贴板失败不丢链接，重试不重复写入；取消后不能复制旧安排',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=lockPage(wx);await m.lock(event('',{id:m.data.slots[0].id}));m.meetingLinkChanged(event('https://meeting.example.com/a'));
  wx.failClipboard(true);await m.copyNotice();assert.match(m.data.noticeError,/未复制成功/);assert.equal(store.view(id).meetingLink,'https://meeting.example.com/a');const version=store.view(id).version;
  wx.failClipboard(false);await m.copyNotice();assert.equal(store.view(id).version,version);assert.equal(wx.clipboards.length,1);
  store.act(id,null,'cancel',{});await m.copyNotice();assert.match(m.data.noticeError,/已取消/);assert.equal(wx.clipboards.length,1);
 }finally{global.wx=previous;}
});
function screenshotLegacyMeeting(wx){
 const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
 const input={title:'旧会议复现',purpose:'核对锁定',dates:[date],from:'09:00',to:'12:00',duration:60,interval:30,deadline:D.dateTime(date,'08:00'),roster:[{name:'A',required:true},{name:'B',required:true},{name:'C',required:true}]};
 input.excluded=D.generateSlots(input).filter(s=>['10:00','10:30'].includes(D.labelTime(s.start).slice(11))).map(s=>s.id);
 const {id,token}=store.create(input),slots=store.view(id,token).slots;
 const actors=['demo-owner','demo-b','demo-c'],votes=[['maybe','yes','yes'],['maybe','maybe','yes'],['maybe','no','maybe']];
 actors.forEach((actor,i)=>{store.setActor(actor);store.act(id,token,'claim',{roleId:'r'+i,profile:{nameSource:'role',avatar:'wxfile://saved/'+actor+'.png'}});store.act(id,token,'reply',{choices:Object.fromEntries(slots.map((s,j)=>[s.id,votes[i][j]]))});});
 store.setActor('demo-guest');store.act(id,token,'claim',{roleId:null,profile:{nameSource:'role',avatar:'wxfile://saved/guest.png'}});store.setActor('demo-owner');
 const raw=wx.storage.get('meeting-battle.mock.v1').meetings[id];delete raw.meetingLink;
 raw.roles.forEach((r,i)=>{r.name=r.name+':旧备注'+i;delete r.note;});raw.members.forEach(p=>delete p.profile.nameSource);
 raw.slots.forEach(s=>{s.eligible=false;}); // obsolete computed flags must not determine current lockability
 const m=page('meeting',wx);m.onLoad({id,token});m.onShow();return {m,id,token};
}
test('截图旧会议复现：三人提交加一旁听，3个可协调和2可以1可协调都能锁定',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=screenshotLegacyMeeting(wx);assert.equal(m.data.meeting.submitted,3);assert.equal(m.data.meeting.observers,1);assert.equal(m.data.noIntersection,false);assert.equal(m.data.lockRuleReady,true);
  const first=m.data.slots.find(s=>s.heatTime==='09:00—10:00'),second=m.data.slots.find(s=>s.heatTime==='09:30—10:30'),third=m.data.slots.find(s=>s.heatTime==='11:00—12:00');
  assert.equal(first.maybe,3);assert.equal(first.eligible,true);assert.equal(second.no,1);assert.equal(second.eligible,false);assert.equal(third.yes,2);assert.equal(third.maybe,1);assert.equal(third.eligible,true);
  await m.lock(event('',{id:first.id}));assert.equal(store.view(id).status,'locked');assert.equal(store.view(id).finalSlot,first.id);
 }finally{global.wx=previous;}
});
test('热力图不行票优先红色，即使有可以票；1/2/3个不行时背景逐步变深',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=screenshotLegacyMeeting(wx);const slot=m.data.slots.find(s=>s.heatTime==='09:30—10:30');
  assert.equal(slot.heatClass,'heat-conflict');assert.equal(slot.yes,1);
  const rgb=value=>value.match(/rgb\((\d+),(\d+),(\d+)\)/).slice(1).map(Number);const colors=[rgb(slot.heatStyle)];
  for(const actor of ['demo-b','demo-owner']){
   store.setActor(actor);const choices={...store.view(id,token).reply,[slot.id]:'no'};store.act(id,token,'reply',{choices});store.setActor('demo-owner');m.refresh();colors.push(rgb(m.data.slots.find(s=>s.id===slot.id).heatStyle));
  }
  for(let i=1;i<colors.length;i++)assert.ok(colors[i].every((value,j)=>value<colors[i-1][j]));
  assert.equal(m.data.slots.find(s=>s.id===slot.id).no,3);assert.match(m.data.slots.find(s=>s.id===slot.id).heatStyle,/color:#fff/);
 }finally{global.wx=previous;}
});
test('新选择窗规则排除所有红色时段，可选不行也不列入候选',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=lockPage(wx);const raw=wx.storage.get('meeting-battle.mock.v1').meetings[id];raw.roles[1].required=false;
  store.setActor('demo-b');store.act(id,token,'reply',{choices:Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'no']))});store.setActor('demo-owner');m.refresh();assert.equal(m.data.slots[0].heatClass,'heat-conflict');assert.equal(m.data.slots[0].eligible,false);assert.equal(m.data.lockCandidates.length,0);
 }finally{global.wx=previous;}
});
test('检测页面已更新但业务规则文件遗漏，加载完整规则后恢复就绪标志',()=>{
 const previous=global.wx,wx=mockWx(),version=D.LOCK_RULE_VERSION;global.wx=wx;
 try {
  const {m}=lockPage(wx);delete D.LOCK_RULE_VERSION;m.refresh();assert.equal(m.data.lockRuleReady,false);
  D.LOCK_RULE_VERSION=version;m.refresh();assert.equal(m.data.lockRuleReady,true);
 }finally{D.LOCK_RULE_VERSION=version;global.wx=previous;}
});
test('发起人每个热力块分别显示可协调/不行人数及短称呼，不包含备注或旁听者',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m}=screenshotLegacyMeeting(wx),first=m.data.slots.find(s=>s.heatTime==='09:00—10:00'),second=m.data.slots.find(s=>s.heatTime==='09:30—10:30'),third=m.data.slots.find(s=>s.heatTime==='11:00—12:00');
  assert.equal(first.maybe,3);assert.equal(first.maybeNames,'A、B、C');assert.equal(first.noNames,'');assert.equal(second.maybeNames,'B');assert.equal(second.noNames,'C');assert.equal(third.maybeNames,'C');assert.equal(third.noNames,'');assert.equal(m.data.meeting.total,3);
  for(const s of m.data.slots){assert.ok(!s.maybeNames.includes('旧备注'));assert.ok(!s.noNames.includes('旁听'));}
 }finally{global.wx=previous;}
});
test('成员视图保持简洁，发起人刷新时人员名单跟随已提交修改更新',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=screenshotLegacyMeeting(wx);m.switchActor(event('2'));assert.equal(m.data.meeting.isOwner,false);assert.ok(m.data.slots.every(s=>s.maybeNames==='' && s.noNames===''));
  const slot=m.data.slots.find(s=>s.heatTime==='09:30—10:30');store.act(id,token,'reply',{choices:{...store.view(id,token).reply,[slot.id]:'yes'}});
  m.switchActor(event('0'));const updated=m.data.slots.find(s=>s.id===slot.id);assert.equal(updated.maybeNames,'');assert.equal(updated.noNames,'C');assert.equal(updated.yes,2);
 }finally{global.wx=previous;}
});
function fourPersonLockPicker(wx,completed=4){
 const date=new Date(Date.now()+3*86400000+8*3600000).toISOString().slice(0,10);
 const input={title:'四人锁定选择',purpose:'确定安排',dates:[date],from:'09:30',to:'12:00',duration:60,interval:30,deadline:D.dateTime(date,'08:00'),roster:['A','B','C','D'].map(name=>({name,required:true}))};
 input.excluded=D.generateSlots(input).filter(s=>D.labelTime(s.start).slice(11)==='10:00').map(s=>s.id);
 const {id,token}=store.create(input),slots=store.view(id,token).slots;
 const actors=['demo-owner','demo-b','demo-c','demo-guest'],votes=[['maybe','maybe','yes'],['no','maybe','maybe'],['no','maybe','yes'],['yes','yes','yes']];
 actors.forEach((actor,i)=>{store.setActor(actor);store.act(id,token,'claim',{roleId:'r'+i,profile:{nameSource:'role',avatar:'wxfile://saved/'+actor+'.png'}});if(i<completed)store.act(id,token,'reply',{choices:Object.fromEntries(slots.map((s,j)=>[s.id,votes[i][j]]))});});
 store.setActor('demo-a');store.act(id,token,'claim',{roleId:null,profile:{nameSource:'role',avatar:'wxfile://saved/observer.png'}});store.setActor('demo-owner');
 const m=page('meeting',wx);m.onLoad({id,token});m.onShow();return {m,id,token};
}
test('4/4右上锁定入口可用，选时弹窗只含10:30和11:00，选后成功并定位最终安排',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=fourPersonLockPicker(wx);assert.equal(m.data.meeting.submitted,4);assert.equal(m.data.allResponded,true);assert.equal(m.data.canOpenLockPicker,true);
  m.openLockPicker();assert.equal(m.data.lockPickerOpen,true);assert.deepEqual(Array.from(m.data.lockOptions,s=>s.heatTime),['10:30—11:30','11:00—12:00']);
  const modals=[];wx.showModal=o=>{modals.push(o);o.success({confirm:true});};const slot=m.data.lockOptions[0];await m.lock(event('',{id:slot.id}));
  assert.equal(store.view(id).status,'locked');assert.equal(store.view(id).finalSlot,slot.id);assert.equal(m.data.lockPickerOpen,false);assert.equal(m.data.canOpenLockPicker,false);assert.equal(modals.at(-1).title,'已锁定成功');assert.equal(wx.scrolls.at(-1).selector,'#final-arrangement');
 }finally{global.wx=previous;}
});
test('3/4不能打开锁定；最后一人提交后出现入口，取消弹窗不锁定',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=fourPersonLockPicker(wx,3);assert.equal(m.data.meeting.submitted,3);assert.equal(m.data.allResponded,false);assert.equal(m.data.canOpenLockPicker,false);m.openLockPicker();assert.equal(m.data.lockPickerOpen,false);
  store.setActor('demo-guest');store.act(id,token,'reply',{choices:Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'yes']))});store.setActor('demo-owner');m.openLockPicker();assert.equal(m.data.canOpenLockPicker,true);assert.equal(m.data.lockOptions.length,2);
  m.closeLockPicker();assert.equal(m.data.lockPickerOpen,false);assert.equal(store.view(id).status,'collecting');
 }finally{global.wx=previous;}
});
test('选择弹窗打开后有人改票，旧版本拒绝锁定，刷新可选列表后排除新冲突',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=fourPersonLockPicker(wx);m.openLockPicker();const selected=m.data.lockOptions[0];
  store.setActor('demo-b');store.act(id,token,'reply',{choices:{...store.view(id,token).reply,[selected.id]:'no'}});store.setActor('demo-owner');
  await m.lock(event('',{id:selected.id}));assert.equal(store.view(id).status,'collecting');assert.equal(m.data.lockPickerOpen,true);assert.match(m.data.lockPickerError,/数据已更新/);
  m.openLockPicker();assert.equal(m.data.lockOptions.length,1);assert.equal(m.data.lockOptions[0].heatTime,'11:00—12:00');assert.equal(m.data.lockPickerError,'');
 }finally{global.wx=previous;}
});
test('回复收齐但每项都存在不行时仍可打开选择窗，明确空结果而不强行锁定',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=fourPersonLockPicker(wx);store.act(id,token,'reply',{choices:Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'no']))});m.refresh();assert.equal(m.data.allResponded,true);assert.equal(m.data.canOpenLockPicker,true);
  m.openLockPicker();assert.equal(m.data.lockPickerOpen,true);assert.equal(m.data.lockOptions.length,0);assert.equal(store.view(id).status,'collecting');
 }finally{global.wx=previous;}
});
test('空白/不完整回复不能被计作已提交，回复进度与锁定条件保持一致',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=fourPersonLockPicker(wx);wx.storage.get('meeting-battle.mock.v1').meetings[id].replies['demo-guest']={};m.refresh();assert.equal(m.data.meeting.submitted,3);assert.deepEqual(m.data.meeting.missing,['D']);assert.equal(m.data.allResponded,false);assert.equal(m.data.canOpenLockPicker,false);
 }finally{global.wx=previous;}
});
test('截止待确认仍可选择未来时段；锁定后及非发起人不再显示锁定入口',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id}=fourPersonLockPicker(wx);wx.storage.get('meeting-battle.mock.v1').meetings[id].deadline=Date.now()-1;m.refresh();assert.equal(m.data.meeting.status,'closed');assert.equal(m.data.canOpenLockPicker,true);
  m.openLockPicker();await m.lock(event('',{id:m.data.lockOptions[0].id}));assert.equal(m.data.canOpenLockPicker,false);m.openLockPicker();assert.equal(m.data.lockPickerOpen,false);
  m.switchActor(event('2'));assert.equal(m.data.meeting.isOwner,false);assert.equal(m.data.canOpenLockPicker,false);
 }finally{global.wx=previous;}
});
test('发起人正在修改个人选项时不静默丢弃草稿，先保存或取消才能打开锁定窗口',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m}=fourPersonLockPicker(wx);m.beginEditTime();m.batch(event('',{choice:'no'}));const draft=JSON.stringify(m.data.choices),modals=[];
  wx.showModal=o=>{modals.push(o);o.success({confirm:true});};m.openLockPicker();assert.equal(m.data.lockPickerOpen,false);assert.equal(JSON.stringify(m.data.choices),draft);assert.match(modals.at(-1).content,/保存或取消/);
  m.cancelEditTime();m.openLockPicker();assert.equal(m.data.lockPickerOpen,true);assert.equal(m.data.lockOptions.length,2);
 }finally{global.wx=previous;}
});
test('旧eligible标记不决定弹窗列表，统一评估结果仍列出9点和11点',()=>{
 const previous=global.wx,wx=mockWx(),originalView=store.view;global.wx=wx;
 try {
  const {m}=screenshotLegacyMeeting(wx);
  store.view=(...args)=>{const view=originalView(...args);view.slots=view.slots.map(s=>({...s,eligible:false}));return view;};
  m.openLockPicker();assert.equal(m.data.lockOptions.length,2);assert.deepEqual(Array.from(m.data.lockOptions,s=>s.heatTime),['09:00—10:00','11:00—12:00']);
 }finally{store.view=originalView;global.wx=previous;}
});
test('打开弹窗读取当次新快照，不依赖旧页面候选缓存或视图更新时序',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m}=screenshotLegacyMeeting(wx);m.data.lockCandidates=[];m.data.canOpenLockPicker=false;
  const originalSet=m.setData;let pending;
  m.setData=function(patch,callback){if(patch.meeting){pending=patch;return;}originalSet.call(this,patch,callback);};
  m.openLockPicker();assert.equal(m.data.lockPickerOpen,true);assert.equal(m.data.lockOptions.length,2);assert.deepEqual(Array.from(m.data.lockOptions,s=>s.heatTime),['09:00—10:00','11:00—12:00']);
  originalSet.call(m,pending);assert.equal(m.data.lockCandidates.length,2);
 }finally{global.wx=previous;}
});
test('空候选显示明确筛选原因，排查复制不含邀请token、头像或会议链接',()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const {m,id,token}=fourPersonLockPicker(wx);store.act(id,token,'reply',{choices:Object.fromEntries(store.view(id,token).slots.map(s=>[s.id,'no']))});m.openLockPicker();assert.equal(m.data.lockOptions.length,0);assert.match(m.data.lockEmptyReason,/每个候选时段都有人/);
  m.copyLockDiagnostics();const copied=wx.clipboards.at(-1),diagnostic=JSON.parse(copied);assert.equal(diagnostic.submitted,4);assert.equal(diagnostic.options.length,3);assert.ok(diagnostic.options.every(row=>row.result==='conflict'));
  assert.ok(!copied.includes(token));assert.ok(!copied.includes('avatar'));assert.ok(!copied.includes('meetingLink'));
 }finally{global.wx=previous;}
});
