const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const D=require('../miniprogram/lib/domain');
const store=require('../miniprogram/lib/store');
function mockWx() {
 const storage=new Map(),routes=[],clipboards=[];
 let failSave=false;
 return {storage,routes,clipboards,failSave(value){failSave=value;},
  getStorageSync:k=>storage.get(k),setStorageSync(k,v){if(failSave)throw Error('存储空间不足');storage.set(k,JSON.parse(JSON.stringify(v)));},removeStorageSync:k=>storage.delete(k),
  showModal:o=>o.success({confirm:true}),showToast(){},stopPullDownRefresh(){},
  navigateTo:o=>routes.push(o.url),redirectTo:o=>routes.push(o.url),setClipboardData:o=>clipboards.push(o.data)
 };
}
function page(name,wx) {
 const file=path.resolve('miniprogram/pages/'+name+'/'+name+'.js');let def;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Page:p=>{def=p;},wx,console,Date,Promise});
 return {...def,data:JSON.parse(JSON.stringify(def.data)),setData(patch){Object.assign(this.data,patch);}};
}
const event=(value,dataset={})=>({detail:{value},currentTarget:{dataset}});
test('真实页面控制器+本地存储完整流程：创建→匿名预览→认领→提交→切换身份→锁定→新一轮',async()=>{
 const previous=global.wx,wx=mockWx();global.wx=wx;
 try {
  const date=new Date(Date.now()+2*86400000+8*3600000).toISOString().slice(0,10);
  const create=page('create',wx);create.onLoad({});
  create.setData({title:'团队会议',purpose:'安排下一步',dates:[date],from:'09:00',to:'10:00',duration:'60',interval:'30',deadlineDate:date,deadlineTime:'08:00',roster:'甲\n乙\n丙\n丁?'});
  create.preview();assert.equal(create.data.slots.length,1);await create.publish();
  assert.equal(wx.routes.length,1);
  const query=new URLSearchParams(wx.routes[0].split('?')[1]),id=query.get('id'),token=query.get('token');
  assert.equal(store.list().length,1);
  const meeting=page('meeting',wx);meeting.onLoad({id,token});meeting.onShow();
  assert.equal(meeting.data.meeting.isOwner,true);
  const actors=['demo-a','demo-b','demo-c'];
  for(let i=0;i<3;i++) {
   meeting.switchActor(event(String(store.identities.findIndex(a=>a.id===actors[i]))));
   assert.equal(meeting.data.hasNames,false);assert.equal(meeting.data.slots[0].yes,i);
   meeting.beginClaim();assert.equal(meeting.data.profileOpen,true);
   meeting.profileField(event('工作姓名'+i,{field:'name'}));meeting.confirmProfile();assert.equal(meeting.data.profileReady,true);
   meeting.roleChange(event(String(i)));await meeting.claim(event('',{}));
   assert.equal(meeting.data.meeting.self.roleId,'r'+i);assert.equal(meeting.data.canVote,true);
   meeting.batch(event('',{choice:'yes'}));
   assert.equal(store.view(id,token).slots[0].yes,i); // draft not shared
   await meeting.submit();assert.equal(store.view(id,token).slots[0].yes,i+1);
  }
  meeting.switchActor(event('0'));assert.equal(meeting.data.meeting.slots[0].eligible,true);assert.equal(meeting.data.meeting.slots[0].missing,1);
  await meeting.lock(event('',{id:meeting.data.slots[0].id}));assert.equal(meeting.data.meeting.status,'locked');
  meeting.copyNotice();assert.match(wx.clipboards.at(-1),/北京时间/);
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
