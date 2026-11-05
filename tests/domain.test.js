const {test}=require('node:test');
const assert=require('node:assert/strict');
const D=require('../miniprogram/lib/domain');
const NOW=Date.parse('2030-01-01T00:00:00+08:00');
function input(overrides={}) { return {title:'项目讨论',purpose:'确认范围',dates:['2030-01-03'],from:'09:00',to:'11:00',duration:60,interval:30,deadline:D.dateTime('2030-01-02','18:00'),roster:[{name:'甲',required:true},{name:'乙',required:true},{name:'丙',required:true},{name:'丁',required:false}],...overrides}; }
function meeting(overrides={}) {return D.create(input(overrides),'owner','m','invite',NOW);}
function claim(m,actor,role,profile={name:actor}) {return D.apply(m,actor,'invite','claim',{roleId:role,profile},NOW);}
function choices(m,state) {return Object.fromEntries(m.slots.map(s=>[s.id,state]));}
function reply(m,actor,state) {return D.apply(m,actor,'invite','reply',{choices:choices(m,state)},NOW);}
function ready() {let m=meeting();for(let i=0;i<4;i++){m=claim(m,'u'+i,'r'+i);m=reply(m,'u'+i,'yes');}return m;}
test('生成连续完整候选：时长与间隔独立，去重且北京时间不随主机时区变化',()=>{
 const m=meeting({dates:['2030-01-03','2030-01-03']});
 assert.equal(m.slots.length,3);assert.equal(m.slots[1].label,'2030-01-03 09:30—10:30');
 assert.equal(m.slots[0].end-m.slots[0].start,3600000);
 assert.equal(m.slots[0].start,Date.parse('2030-01-03T01:00:00Z'));
});
test('拒绝过去时间、非法日期、跨午夜、无完整候选和超限',()=>{
 for(const bad of [{dates:['2029-12-31']},{dates:['2030-02-30']},{from:'22:00',to:'01:00'},{duration:240},{duration:0},{interval:0}]) assert.throws(()=>meeting(bad));
 assert.throws(()=>meeting({dates:Array.from({length:15},(_,i)=>'2030-01-'+String(i+3).padStart(2,'0'))}));
 assert.throws(()=>meeting({from:'00:00',to:'23:59',duration:15,interval:15}));
});
test('名单与截止校验、候选删选',()=>{
 assert.throws(()=>meeting({roster:[{name:'同名',required:true},{name:'同名',required:true}]}),/重名/);
 assert.throws(()=>meeting({roster:[{name:'人',required:false}]}),/必到/);
 assert.throws(()=>meeting({deadline:NOW}),/截止/);
 const m=meeting();assert.throws(()=>meeting({excluded:m.slots.map(s=>s.id)}),/保留/);
 assert.equal(meeting({excluded:[m.slots[0].id]}).slots.length,2);
});
test('有效邀请可在认领前看匿名热力图，不能拿会议编号访问',()=>{
 let m=claim(meeting(),'a','r0');m=reply(m,'a','yes');
 const v=D.view(m,'guest','invite',NOW);assert.equal(v.slots[0].yes,1);assert.equal(v.slots[0].details.length,0);assert.equal(v.members.length,0);assert.equal(v.token,undefined);
 assert.throws(()=>D.view(m,'guest','bad',NOW),/邀请/);
 assert.throws(()=>D.view(m,'guest',undefined,NOW),/邀请/);
});
test('未回复不算可以：三必到一可选，不能锁定',()=>{
 const m=reply(claim(meeting(),'a','r0'),'a','yes');
 assert.equal(D.summary(m)[0].missing,3);assert.equal(D.summary(m)[0].eligible,false);
 assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW),/必到/);
});
test('全员可以优先，其次满足必到并按可选可以数、时间排序',()=>{
 let m=ready();
 const votes=choices(m,'no');votes[m.slots[2].id]='yes';votes[m.slots[1].id]='maybe';
 m=D.apply(m,'u3',null,'reply',{choices:votes},NOW);
 const results=D.summary(m);assert.equal(results[0].id,m.slots[2].id);assert.equal(results[0].allYes,true);
 assert.equal(results[1].id,m.slots[0].id);assert.equal(results[1].eligible,true);assert.equal(results[1].no,1);
});
test('可协调与不行分开；全部不行计为已回复',()=>{
 let m=reply(claim(meeting(),'a','r0'),'a','no');m=reply(claim(m,'b','r1'),'b','maybe');
 const v=D.view(m,'owner',null,NOW);assert.equal(v.submitted,2);assert.equal(v.slots[0].no,1);assert.equal(v.slots[0].maybe,1);assert.equal(v.slots[0].yes,0);assert.equal(v.slots[0].eligible,false);
});
test('提交前必须完整、状态合法，不静默填充空白',()=>{
 const m=claim(meeting(),'a','r0');
 assert.throws(()=>D.apply(m,'a',null,'reply',{choices:{}},NOW),/全部候选/);
 assert.throws(()=>D.apply(m,'a',null,'reply',{choices:choices(m,'unknown')},NOW),/全部候选/);
 assert.equal(Object.keys(m.replies).length,0);
});
test('一个账号一个身份，重复进入不新增；不能覆盖已绑定角色',()=>{
 let m=claim(meeting(),'a','r0');m=claim(m,'a','r0');assert.equal(m.members.length,1);
 assert.throws(()=>claim(m,'b','r0'),/已被认领/);
 assert.throws(()=>claim(m,'b','not-a-role'),/角色不存在/);
});
test('本人更正角色，选择随账号迁移，旧角色成为未回复',()=>{
 let m=reply(claim(meeting(),'a','r0'),'a','yes');m=claim(m,'a','r1');
 assert.equal(m.members.length,1);assert.equal(m.members[0].roleId,'r1');assert.equal(m.replies.a[m.slots[0].id],'yes');
 const s=D.summary(m)[0];assert.equal(s.details[0].choice,'missing');assert.equal(s.details[1].choice,'yes');assert.equal(m.history.at(-1).from,'r0');
});
test('仅接收信息者不参与汇总，转入转出保留选择而不重复计数',()=>{
 let m=reply(claim(meeting(),'a','r0'),'a','yes');m=claim(m,'a',null);
 assert.equal(D.summary(m)[0].yes,0);assert.equal(D.view(m,'a',null,NOW).observers,1);
 assert.throws(()=>reply(m,'a','yes'),/不投票/);
 m=claim(m,'a','r1');assert.equal(D.summary(m)[0].yes,1);
});
test('发起人可协助迁移；非发起人不可迁移、锁定、延长或取消',()=>{
 let m=claim(meeting(),'a','r0');
 for(const action of ['move','lock','extend','cancel','revoke']) assert.throws(()=>D.apply(m,'a',null,action,{},NOW),/仅发起人/);
 m=D.apply(m,'owner',null,'move',{targetActor:'a',roleId:'r2'},NOW);assert.equal(m.members[0].roleId,'r2');
});
test('不能指定其他人的回复：身份取自调用者，逐人保存保留其他人选择',()=>{
 let m=claim(claim(meeting(),'a','r0'),'b','r1');m=reply(m,'a','yes');
 m=D.apply(m,'b',null,'reply',{actor:'a',choices:choices(m,'no')},NOW);
 assert.equal(m.replies.a[m.slots[0].id],'yes');assert.equal(m.replies.b[m.slots[0].id],'no');
});
test('邀请撤销阻止新访客，已加入成员保留访问',()=>{
 let m=claim(meeting(),'a','r0');m=D.apply(m,'owner',null,'revoke',{},NOW);
 assert.throws(()=>D.view(m,'outsider','invite',NOW),/邀请/);
 assert.throws(()=>claim(m,'outsider','r1'),/邀请/);
 assert.equal(D.view(m,'a',null,NOW).self.roleId,'r0');
});
test('截止后禁改票；可延长重开；截止待确认仍可锁定合格的未来候选',()=>{
 let m=ready();const later=m.deadline+1;
 assert.equal(D.view(m,'u0',null,later).status,'closed');
 assert.throws(()=>D.apply(m,'u0',null,'reply',{choices:choices(m,'no')},later),/截止/);
 const locked=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},later);assert.equal(locked.status,'locked');
 m=D.apply(m,'owner',null,'extend',{deadline:m.deadline+3600000},later);
 assert.equal(D.view(m,'u0',null,later).status,'collecting');
});
test('锁定用最新版本，过期快照被拒绝，锁定后禁止改票与改身份',()=>{
 let m=ready();const old=m.version;m=reply(m,'u0','no');
 assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:old},NOW),/数据已更新/);
 m=reply(m,'u0','yes');m=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW);
 assert.throws(()=>reply(m,'u0','no'),/已锁定/);assert.throws(()=>claim(m,'u0','r1'),/已锁定/);
 assert.throws(()=>D.apply(m,'owner',null,'extend',{deadline:m.deadline+100},NOW),/仅收集中/);
});
test('已开始时段不能锁定，取消后禁止修改',()=>{
 const m=ready();assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},m.slots[0].start),/已经开始/);
 const c=D.apply(m,'owner',null,'cancel',{},NOW);assert.throws(()=>reply(c,'u0','yes'),/取消/);
});
test('新一轮无绑定、无旧回复，旧会保持不变',()=>{
 const old=ready();const fresh=D.create(input({previousId:old.id,duration:30}),'owner','new','new-token',NOW);
 assert.equal(fresh.previousId,old.id);assert.deepEqual(fresh.replies,{});assert.equal(fresh.members.length,0);assert.equal(old.members.length,4);
});
test('输入对象不会被失败或成功的操作就地修改',()=>{
 const m=meeting(),before=JSON.stringify(m);claim(m,'a','r0');assert.equal(JSON.stringify(m),before);
 assert.throws(()=>D.apply(m,'owner',null,'unknown',{},NOW));assert.equal(JSON.stringify(m),before);
});
