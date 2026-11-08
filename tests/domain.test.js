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
test('全员可以优先，无不行的可协调时段次之，冲突时段最后',()=>{
 let m=ready();
 const votes=choices(m,'no');votes[m.slots[2].id]='yes';votes[m.slots[1].id]='maybe';
 m=D.apply(m,'u3',null,'reply',{choices:votes},NOW);
 const results=D.summary(m);assert.equal(results[0].id,m.slots[2].id);assert.equal(results[0].allYes,true);
 assert.equal(results[1].id,m.slots[1].id);assert.equal(results[1].eligible,true);assert.equal(results[1].no,0);assert.equal(results[2].eligible,false);
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
test('头像模式无需手填姓名，角色标签由名单派生；未选择头像不能认领',()=>{
 const m=meeting();assert.throws(()=>D.apply(m,'a','invite','claim',{roleId:'r0',profile:{nameSource:'role',avatar:''}},NOW),/头像/);
 const claimed=D.apply(m,'a','invite','claim',{roleId:'r0',profile:{nameSource:'role',name:'不应采用的输入',avatar:'wxfile://saved/a.png'}},NOW);
 assert.equal(claimed.members[0].profile.name,'甲');assert.equal(claimed.members[0].profile.nickname,'');assert.equal(claimed.members[0].profile.nameSource,'role');
});
test('发起人更正头像模式角色时，头像/回复保留，标签随角色更新；旁听不计票',()=>{
 let m=D.apply(meeting(),'a','invite','claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}},NOW);
 m=reply(m,'a','yes');m=D.apply(m,'owner',null,'move',{targetActor:'a',roleId:'r1'},NOW);
 assert.equal(m.members[0].profile.name,'乙');assert.equal(m.members[0].profile.avatar,'wxfile://saved/a.png');assert.equal(m.replies.a[m.slots[0].id],'yes');
 m=D.apply(m,'owner',null,'move',{targetActor:'a',roleId:null},NOW);assert.equal(m.members[0].profile.name,'旁听者');assert.equal(D.summary(m)[0].yes,0);
});
test('名单按首个中/英文冒号拆称呼与备注，空白行忽略，可选标记保留',()=>{
 const roles=D.parseRoster(' A：主持会议\r\n\r\n B : 提供建议：市场侧?\nC\nD：旁观？');
 assert.deepEqual(roles,[{name:'A',note:'主持会议',required:true},{name:'B',note:'提供建议：市场侧',required:false},{name:'C',note:'',required:true},{name:'D',note:'旁观',required:false}]);
 assert.equal(D.formatRoster(roles),'A 主持会议\nB 提供建议：市场侧?\nC\nD 旁观?');
});
test('拆分后校验称呼/备注长度和重复称呼，不能用不同备注绕过重名检查',()=>{
 assert.throws(()=>D.parseRoster('：只有备注'),/称呼/);
 assert.throws(()=>D.parseRoster('A：'+'长'.repeat(201)),/备注/);
 assert.throws(()=>D.parseRoster('长'.repeat(41)+'：备注'),/称呼/);
 assert.throws(()=>meeting({roster:D.parseRoster('A：主持\nA：汇报')}),/重名/);
});
test('会议汇总、缺口、认领资料只显示短称呼，备注独立保留用于认领选项',()=>{
 let m=meeting({roster:D.parseRoster('A：主持会议\nB:提供意见')});
 assert.equal(m.roles[0].name,'A');assert.equal(m.roles[0].note,'主持会议');
 m=D.apply(m,'a','invite','claim',{roleId:'r0',profile:{nameSource:'role',avatar:'wxfile://saved/a.png'}},NOW);
 const v=D.view(m,'owner',null,NOW);
 assert.deepEqual(v.missing,['A','B']);assert.equal(v.slots[0].details[0].name,'A');assert.equal(v.slots[0].blockers[0].name,'A');assert.equal(m.members[0].profile.name,'A');
 assert.equal(v.roles[0].note,'主持会议');
});
test('所有名单成员已回复且均为可以或可协调能锁定，含可选的不行票也拒绝',()=>{
 let m=ready();m=reply(m,'u0','maybe');m=reply(m,'u3','maybe');
 const conflict=reply(m,'u3','no');assert.equal(D.summary(conflict)[0].eligible,false);
 const s=D.summary(m)[0];assert.equal(s.eligible,true);assert.deepEqual(s.requiredMaybeNames,['甲']);assert.equal(s.no,0);
 m=D.apply(m,'owner',null,'lock',{slotId:s.id,version:m.version},NOW);assert.equal(m.status,'locked');
});
test('新锁定规则：可选未回复仍需等待，必到不行不能锁定，旁听不参与',()=>{
 let m=meeting();for(let i=0;i<3;i++){m=claim(m,'u'+i,'r'+i);m=reply(m,'u'+i,'maybe');}
 let s=D.summary(m)[0];assert.equal(s.eligible,false);assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:s.id,version:m.version},NOW),/全部提交/);
 m=reply(claim(m,'u3','r3'),'u3','maybe');m=claim(m,'observer',null);s=D.summary(m)[0];assert.equal(s.eligible,true);
 m=reply(m,'u0','no');s=D.summary(m)[0];assert.equal(s.eligible,false);assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:s.id,version:m.version},NOW),/必到/);
});
test('网络会议链接仅发起人可在锁定后保存，支持修改清空且不改变最终时间和回复',()=>{
 let m=ready();assert.throws(()=>D.apply(m,'owner',null,'meetingLink',{url:'https://meeting.example.com/a'},NOW),/已锁定/);
 m=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW);
 const slot=m.finalSlot,replies=JSON.stringify(m.replies);assert.throws(()=>D.apply(m,'u0',null,'meetingLink',{url:'https://meeting.example.com/a'},NOW),/仅发起人/);
 m=D.apply(m,'owner',null,'meetingLink',{url:' https://meeting.example.com/a?pwd=123 '},NOW);assert.equal(D.view(m,'u0',null,NOW).meetingLink,'https://meeting.example.com/a?pwd=123');
 m=D.apply(m,'owner',null,'meetingLink',{url:'https://meeting.example.com/b'},NOW);assert.equal(m.meetingLink,'https://meeting.example.com/b');
 m=D.apply(m,'owner',null,'meetingLink',{url:''},NOW);assert.equal(m.meetingLink,'');assert.equal(m.finalSlot,slot);assert.equal(JSON.stringify(m.replies),replies);
 m=D.apply(m,'owner',null,'cancel',{},NOW);assert.throws(()=>D.apply(m,'owner',null,'meetingLink',{url:'https://meeting.example.com/c'},NOW),/已锁定/);
});
test('链接拒绝脚本协议、整段文字、空主机、嵌入账号和超长值，旧会议无链接兼容',()=>{
 let m=ready();m=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW);delete m.meetingLink;
 assert.equal(D.view(m,'owner',null,NOW).meetingLink,'');
 for(const url of ['javascript:alert(1)','请访问 https://meeting.example.com','https://','https://user:pass@meeting.example.com','https://meeting.example.com/'+'a'.repeat(2048)])assert.throws(()=>D.apply(m,'owner',null,'meetingLink',{url},NOW),/会议链接/);
 assert.equal(m.meetingLink,undefined);
});
function novemberMeetingSnapshot(){
 const now=D.dateTime('2026-11-07','04:20');
 const spec={title:'截图会议',purpose:'旧会复现',dates:['2026-11-08'],from:'09:00',to:'12:00',duration:60,interval:30,deadline:D.dateTime('2026-11-08','08:00'),roster:['H','B','K'].map(name=>({name,required:true}))};
 spec.excluded=D.generateSlots(spec,now).filter(s=>['10:00','10:30'].includes(D.labelTime(s.start).slice(11))).map(s=>s.id);
 let m=D.create(spec,'owner','fixed-meeting','fixed-invite',now);const votes=[['maybe','no','yes'],['maybe','yes','yes'],['maybe','maybe','maybe']],slots=m.slots;
 ['h','b','k'].forEach((actor,i)=>{m=D.apply(m,actor,'fixed-invite','claim',{roleId:'r'+i,profile:{name:actor}},now);m=D.apply(m,actor,'fixed-invite','reply',{choices:Object.fromEntries(slots.map((s,j)=>[s.id,votes[i][j]]))},now);});
 m=D.apply(m,'owner',null,'claim',{roleId:null,profile:{name:'旁听'}},now);return {m,now};
}
test('11月7日04:20核对11月8日旧会：统一评估返回9点与11点，不受旧eligible缓存影响',()=>{
 const {m,now}=novemberMeetingSnapshot();m.slots.forEach(s=>{s.eligible=false;});
 const v=D.view(m,'owner',null,now);assert.equal(v.lockState.submitted,3);assert.equal(v.lockState.allResponded,true);assert.equal(v.lockState.emptyReason,'');
 const times=v.slots.filter(s=>v.lockState.candidateIds.includes(s.id)).map(s=>D.labelTime(s.start).slice(11));assert.deepEqual(times,['09:00','11:00']);
 const locked=D.apply(m,'owner',null,'lock',{slotId:v.lockState.candidateIds[0],version:m.version},now);assert.equal(locked.status,'locked');
});
test('候选确实过期时给出准确原因和评估时刻，不用冲突票误导',()=>{
 const {m}=novemberMeetingSnapshot(),now=D.dateTime('2026-11-08','12:01');
 const v=D.view(m,'owner',null,now);assert.equal(v.lockState.candidateIds.length,0);assert.match(v.lockState.emptyReason,/已过开始时间/);assert.equal(v.lockState.evaluatedAt,now);
 assert.deepEqual(v.lockState.decisions.map(s=>s.reason),['past','past','conflict']);
});

test('创建错误携带栏目定位信息，校验边界保持不变',()=>{
 const cases=[
  [{title:''},'title'],[{purpose:''},'purpose'],[{duration:1},'duration'],[{interval:1},'interval'],
  [{dates:[]},'dates'],[{dates:['2030-02-30']},'dates'],[{dates:['2029-12-31']},'dates'],
  [{to:'08:00'},'timeRange'],[{from:'bad'},'timeRange'],[{duration:240},'timeRange'],
  [{roster:[]},'roster'],[{roster:Array.from({length:31},(_,i)=>({name:'成员'+i,required:true}))},'roster'],
  [{roster:[{name:'甲',required:true},{name:'甲',required:true}]},'roster'],
  [{roster:[{name:'甲',required:false}]},'roster'],[{roster:[{name:'甲',note:'长'.repeat(201),required:true}]},'roster'],
  [{deadline:NOW},'deadline']
 ];
 for(const [bad,field] of cases)assert.throws(()=>meeting(bad),e=>e.field===field,JSON.stringify(bad));
 assert.throws(()=>D.dateTime('2030-02-30','08:00','deadline'),e=>e.field==='deadline');
 assert.throws(()=>D.parseRoster('：无称呼'),e=>e.field==='roster');
 assert.throws(()=>meeting({excluded:meeting().slots.map(s=>s.id)}),e=>e.field==='candidates');
});

test('全不行补提：允许早于截止，时长固定，原投票保留且仅提议者新时段可以',()=>{
 let m=ready();const original=D.clone(m),oldIds=m.slots.map(s=>s.id);
 m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),knownSlotIds:oldIds,date:'2030-01-02',time:'10:00'},NOW);
 const added=m.slots.at(-1);assert.ok(added.start<m.deadline);assert.equal(added.end-added.start,m.duration*60000);assert.equal(added.proposed,true);
 assert.equal(m.replies.u0[added.id],'yes');assert.equal(m.replies.u1[added.id],undefined);assert.equal(m.slots.length,original.slots.length+1);
 assert.ok(oldIds.every(id=>m.replies.u0[id]==='no'));assert.deepEqual(m.replies.u1,original.replies.u1);
 const owner=D.view(m,'owner',null,NOW);assert.equal(owner.originalSubmitted,4);assert.equal(owner.submitted,1);assert.deepEqual(owner.supplementMissing,['乙','丙','丁']);assert.equal(owner.lockState.allResponded,false);
 const other=D.view(m,'u1',null,NOW);assert.equal(other.selfNeedsSupplement,true);assert.deepEqual(other.supplementMissing,[]);
});

test('连续旧页面建议累加，复用相同时间，不覆盖他人或自己已回答的新项',()=>{
 let m=ready();const oldIds=m.slots.map(s=>s.id),oldNo=choices(m,'no');
 m=D.apply(m,'u0',null,'propose',{choices:oldNo,knownSlotIds:oldIds,date:'2030-01-02',time:'10:00'},NOW);const first=m.slots.at(-1);
 m=D.apply(m,'u1',null,'propose',{choices:oldNo,knownSlotIds:oldIds,date:'2030-01-02',time:'10:30'},NOW+1);const second=m.slots.at(-1);
 assert.equal(m.slots.length,oldIds.length+2);assert.equal(m.replies.u0[first.id],'yes');assert.equal(m.replies.u1[second.id],'yes');assert.equal(m.replies.u0[second.id],undefined);assert.equal(m.replies.u1[first.id],undefined);
 const v=D.view(m,'owner',null,NOW);assert.deepEqual(v.supplementMissing,['甲','乙','丙','丁']);
 m=D.apply(m,'u2',null,'propose',{choices:oldNo,knownSlotIds:oldIds,date:'2030-01-02',time:'10:00'},NOW+2);assert.equal(m.slots.length,oldIds.length+2);assert.equal(m.replies.u2[first.id],'yes');
 m=D.apply(m,'u2',null,'reply',{choices:{...oldNo,[second.id]:'maybe'},knownSlotIds:[...oldIds,second.id]},NOW+3);assert.equal(m.replies.u2[first.id],'yes');assert.equal(m.replies.u2[second.id],'maybe');
 assert.equal(D.view(m,'u2',null,NOW).selfSubmitted,true);
});

test('建议期间旧页面普通提交保留新候选，补齐后可锁定，旧锁定快照失效',()=>{
 let m=ready(),version=m.version;const oldIds=m.slots.map(s=>s.id),oldVotes=choices(m,'yes');
 m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'10:00'},NOW);const added=m.slots.at(-1);
 m=D.apply(m,'u1',null,'reply',{choices:oldVotes,knownSlotIds:oldIds},NOW);assert.equal(D.view(m,'u1',null,NOW).selfNeedsSupplement,true);
 assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:added.id,version:m.version},NOW),/全部提交/);
 for(const actor of ['u1','u2','u3'])m=D.apply(m,actor,null,'reply',{choices:{...m.replies[actor],[added.id]:'maybe'}},NOW);
 assert.equal(D.view(m,'owner',null,NOW).submitted,4);assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:added.id,version},NOW),/数据已更新/);
 m=D.apply(m,'owner',null,'lock',{slotId:added.id,version:m.version},NOW);assert.equal(m.finalSlot,added.id);
});

test('建议失败不修改原会议：未全部不行、过去时间、旁听、截止和锁定均拒绝',()=>{
 const m=ready(),snapshot=JSON.stringify(m),payload={choices:choices(m,'no'),date:'2029-12-31',time:'10:00'};
 assert.throws(()=>D.apply(m,'u0',null,'propose',payload,NOW),/未来/);assert.equal(JSON.stringify(m),snapshot);
 assert.throws(()=>D.apply(m,'u0',null,'propose',{...payload,choices:choices(m,'maybe')},NOW),/全部选择不行/);
 assert.throws(()=>D.apply(m,'owner',null,'propose',payload,NOW),/参会角色/);
 assert.throws(()=>D.apply(m,'u0',null,'propose',payload,m.deadline),/截止/);
 const locked=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW);
 assert.throws(()=>D.apply(locked,'u0',null,'propose',payload,NOW),/锁定/);
});

test('建议支持跨日结束和80项上限，超过限制不能部分保存',()=>{
 let m=ready();m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'23:30'},NOW);
 assert.match(m.slots.at(-1).label,/2030-01-03 00:30/);
 const full=ready();while(full.slots.length<80){const start=full.slots.at(-1).start+1800000;full.slots.push({id:'s'+start,start,end:start+3600000,label:D.labelTime(start)});}
 const before=JSON.stringify(full);assert.throws(()=>D.apply(full,'u0',null,'propose',{choices:choices(full,'no'),date:'2030-01-10',time:'10:00'},NOW),/80/);assert.equal(JSON.stringify(full),before);
});

test('新增建议记录当时的短称呼，重复时间不改作者，后续身份更正不改历史来源',()=>{
 let m=ready();m.roles[0].name='A：仅认领页备注';
 m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'23:31'},NOW);
 const slot=m.slots.at(-1);assert.equal(slot.proposerName,'A');assert.equal(slot.end-slot.start,3600000);
 m=D.apply(m,'u1',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'23:31'},NOW+1);
 assert.equal(m.slots.length,4);assert.equal(m.slots.at(-1).proposerName,'A');
 m=D.apply(m,'owner',null,'move',{targetActor:'u0',roleId:null},NOW+2);
 assert.equal(D.view(m,'u1',null,NOW).slots.find(s=>s.proposed).proposerName,'A');
});

test('旧建议从新增时的认领历史恢复作者，无历史时不编造来源，读取不重写旧数据',()=>{
 let m=ready();m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'10:00'},NOW);
 delete m.slots.at(-1).proposerName;delete m.slots.at(-1).proposerRoleId;
 m=D.apply(m,'owner',null,'move',{targetActor:'u0',roleId:null},NOW+1);
 delete m.slots.at(-1).proposerName;delete m.slots.at(-1).proposerRoleId;const before=JSON.stringify(m);
 assert.equal(D.view(m,'u1',null,NOW).slots.find(s=>s.proposed).proposerName,'甲');assert.equal(JSON.stringify(m),before);
 m.history=[];assert.equal(D.view(m,'u1',null,NOW).slots.find(s=>s.proposed).proposerName,undefined);
});

function infoPayload(m,overrides={}) {return {infoVersion:m.infoVersion || 1,title:m.title,purpose:m.purpose,roster:m.roles.map(r=>({...r})),...overrides};}
test('名单空格录入：首个分隔拆称呼，连续空格/全角空格/Tab/旧冒号兼容，备注内部空格冒号保留',()=>{
 const roles=D.parseRoster(' A  产品部 项目负责人\nB\t技术：支持?\nC　运营团队\nD：主持人');
 assert.deepEqual(roles.map(r=>[r.name,r.note,r.required]),[['A','产品部 项目负责人',true],['B','技术：支持',false],['C','运营团队',true],['D','主持人',true]]);
 assert.deepEqual(D.parseRoster(D.formatRoster(roles)),roles);assert.throws(()=>D.parseRoster('：只有备注'),/称呼/);
});

test('修改主题目的、重排与改称呼保留角色ID/头像/投票和全部时间字段，忽略额外时间修改',()=>{
 const m=ready(),before=D.clone(m),rows=[m.roles[2],{...m.roles[0],name:'主持',note:'新部门'},m.roles[1],m.roles[3]];
 const result=D.apply(m,'owner',null,'editInfo',infoPayload(m,{title:'新主题',purpose:'新目的',roster:rows,duration:15,deadline:NOW,slots:[]}),NOW);
 assert.equal(result.title,'新主题');assert.equal(result.purpose,'新目的');assert.deepEqual(result.roles.map(r=>r.id),['r2','r0','r1','r3']);assert.equal(result.roles[1].name,'主持');
 for(const field of ['slots','replies','members','dates','duration','deadline','token','inviteActive','previousId'])assert.deepEqual(result[field],before[field]);
 assert.equal(result.infoVersion,2);assert.equal(result.version,m.version+1);assert.deepEqual(m,before);
});

test('新增成员使用新ID并等待认领回复，不影响旧人的已提交选择，补齐恢复可锁定',()=>{
 let m=ready(),oldReplies=D.clone(m.replies);
 m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:[...m.roles,{id:null,name:'新同事',note:'支持',required:false}]}),NOW);
 const role=m.roles.at(-1);assert.equal(role.id,'r4');assert.deepEqual(m.replies,oldReplies);assert.equal(D.view(m,'owner',null,NOW).submitted,4);assert.equal(D.view(m,'owner',null,NOW).total,5);
 assert.deepEqual(D.view(m,'owner',null,NOW).missing,['新同事']);assert.throws(()=>D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW),/全部提交/);
 m=claim(m,'new','r4');m=reply(m,'new','maybe');assert.equal(D.view(m,'owner',null,NOW).submitted,5);
 m=D.apply(m,'owner',null,'lock',{slotId:m.slots[0].id,version:m.version},NOW);assert.equal(m.status,'locked');
});

test('删除已认领角色须精确确认，转为旁听保留头像与回复；删除后不重用旧ID',()=>{
 let m=ready();m.members[0].profile={nameSource:'role',name:'甲',nickname:'',avatar:'avatar.png'};
 const payload=infoPayload(m,{roster:m.roles.filter(r=>r.id!=='r0')});const before=JSON.stringify(m);
 assert.throws(()=>D.apply(m,'owner',null,'editInfo',payload,NOW),/认领情况/);assert.equal(JSON.stringify(m),before);
 m=D.apply(m,'owner',null,'editInfo',{...payload,confirmedRemovals:[{actor:'u0',roleId:'r0'}]},NOW);
 const person=m.members.find(p=>p.actor==='u0');assert.equal(person.roleId,null);assert.equal(person.profile.name,'旁听者');assert.equal(person.profile.avatar,'avatar.png');assert.ok(m.replies.u0);
 assert.equal(D.view(m,'u0',null,NOW).self.roleId,null);assert.equal(D.view(m,'owner',null,NOW).total,3);
 m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:[...m.roles,{name:'新甲',note:'',required:true}]}),NOW);assert.equal(m.roles.at(-1).id,'r4');
 const empty=meeting();let deleted=D.apply(empty,'owner',null,'editInfo',infoPayload(empty,{roster:empty.roles.slice(0,3)}),NOW);
 deleted=D.apply(deleted,'owner',null,'editInfo',infoPayload(deleted,{roster:[...deleted.roles,{name:'新人',note:'',required:true}]}),NOW);assert.equal(deleted.roles.at(-1).id,'r4');
});

test('编辑期间新回复及新建议不丢失，会议信息二次修改则拒绝旧编辑页',()=>{
 let m=ready();const stale=infoPayload(m,{title:'编辑中的主题'});
 m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'10:00'},NOW);const slots=D.clone(m.slots),replies=D.clone(m.replies);
 m=D.apply(m,'owner',null,'editInfo',stale,NOW);assert.deepEqual(m.slots,slots);assert.deepEqual(m.replies,replies);
 assert.throws(()=>D.apply(m,'owner',null,'editInfo',stale,NOW),/会议信息已被修改/);
});

test('删除确认期间被认领的角色不能静默转旁听，须重新确认最新占位',()=>{
 let m=meeting();const payload=infoPayload(m,{roster:m.roles.filter(r=>r.id!=='r2')});assert.deepEqual(D.prepareInfoEdit(m,payload).removedBindings,[]);
 m=claim(m,'late','r2');const before=JSON.stringify(m);assert.throws(()=>D.apply(m,'owner',null,'editInfo',payload,NOW),/认领情况/);assert.equal(JSON.stringify(m),before);
});

test('会议信息编辑校验权限、状态、角色标识及名单边界，兼容缺少信息版本的旧会议',()=>{
 const m=ready(),payload=infoPayload(m);
 for(const actor of ['u0','visitor'])assert.throws(()=>D.apply(m,actor,'invite','editInfo',payload,NOW),/仅发起人/);
 assert.throws(()=>D.apply(m,'owner',null,'editInfo',payload,m.deadline),/截止/);
 for(const status of ['locked','cancelled'])assert.throws(()=>D.apply({...m,status},'owner',null,'editInfo',payload,NOW),/锁定或取消/);
 const cases=[{title:''},{purpose:''},{roster:[]},{roster:[{...m.roles[0]},{...m.roles[0]}]},{roster:[{...m.roles[0],id:'invalid'}]},
  {roster:[{...m.roles[0],required:false}]},{roster:[{...m.roles[0],name:'新 称呼'}]},{roster:[{...m.roles[0],note:'长'.repeat(201)}]}];
 for(const bad of cases)assert.throws(()=>D.apply(m,'owner',null,'editInfo',{...payload,...bad},NOW));
 const old=D.clone(m);delete old.infoVersion;delete old.nextRoleIndex;assert.equal(D.apply(old,'owner',null,'editInfo',infoPayload(old),NOW).infoVersion,2);
});

test('更正分号误写的成员称呼后，已有新增建议从原角色ID显示新称呼，时间和投票不变',()=>{
 for(const legacy of [false,true]){
  let m=ready();m.roles[0].name='吴主任; 医院一线经验';
  m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'10:00'},NOW);
  if(legacy)delete m.slots.at(-1).proposerRoleId;
  const start=m.slots.at(-1).start,replies=D.clone(m.replies);
  m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:m.roles.map(r=>r.id==='r0'?{...r,name:'吴主任',note:'医院一线经验'}:r)}),NOW);
  const slot=D.view(m,'u1',null,NOW).slots.find(s=>s.proposed);assert.equal(slot.proposerName,'吴主任');assert.equal(slot.proposerRoleId,'r0');assert.equal(slot.start,start);assert.deepEqual(m.replies,replies);
 }
});

test('提议来源跟随原角色改称呼，原角色被删除后保留最后称呼，不冒认新角色',()=>{
 let m=ready();m=D.apply(m,'u0',null,'propose',{choices:choices(m,'no'),date:'2030-01-02',time:'10:00'},NOW);
 m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:m.roles.map(r=>r.id==='r0'?{...r,name:'新称呼'}:r)}),NOW);
 assert.equal(D.view(m,'owner',null,NOW).slots.find(s=>s.proposed).proposerName,'新称呼');
 m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:m.roles.filter(r=>r.id!=='r0'),confirmedRemovals:[{actor:'u0',roleId:'r0'}]}),NOW);
 m=D.apply(m,'owner',null,'editInfo',infoPayload(m,{roster:[...m.roles,{name:'另一个人',note:'',required:true}]}),NOW);
 const slot=D.view(m,'owner',null,NOW).slots.find(s=>s.proposed);assert.equal(slot.proposerName,'新称呼');assert.equal(slot.proposerRoleId,'r0');assert.ok(!m.roles.some(r=>r.id==='r0'));
});
