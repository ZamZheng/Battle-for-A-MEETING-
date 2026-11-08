const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const C=require('../miniprogram/lib/calendar');
const D=require('../miniprogram/lib/domain');

test('日期星期按北京时间显示，周日/跨月/跨年/闰日准确，不改变业务原始格式',()=>{
 assert.equal(C.dateLabel('2026-11-08'),'2026-11-08（周日）');
 assert.equal(C.dateLabel('2026-11-09'),'2026-11-09（周一）');
 assert.equal(C.dateLabel('2024-02-29'),'2024-02-29（周四）');
 assert.equal(C.dateLabel('2027-01-01'),'2027-01-01（周五）');
 const start=D.dateTime('2026-11-08','23:31'),end=start+3600000;
 assert.equal(C.rangeLabel(start,end),'2026-11-08（周日） 23:31—2026-11-09（周一） 00:31');
 assert.equal(D.labelTime(start),'2026-11-08 23:31');
 assert.equal(C.dateLabel('2026-02-30'),'2026-02-30');
});

test('年月变化时限制日期至月末，闰日/年切换重算星期',()=>{
 let s=C.pickerState('date','2024-01-31');
 s=C.movePicker('date',s,[s.indices[0],1,30]);assert.equal(s.draft,'2024-02-29');assert.equal(s.columns[2].length,29);assert.equal(s.columns[2][28].label,'29日（周四）');
 s=C.movePicker('date',s,[s.indices[0]+1,1,28]);assert.equal(s.draft,'2025-02-28');assert.equal(s.columns[2].length,28);
 s=C.pickerState('date','2026-12-31');s=C.movePicker('date',s,[s.indices[0]+1,0,30]);assert.equal(s.draft,'2027-01-31');
});

test('建议日期范围准确限制当天之前，时间小时分钟独立且保留零分钟',()=>{
 let s=C.pickerState('date','2026-01-01','2026-11-08');assert.equal(s.draft,'2026-11-08');assert.equal(s.columns[2][0].label,'08日（周日）');
 s=C.movePicker('date',s,[0,0,0],'2026-11-08');assert.equal(s.draft,'2026-11-08');
 s=C.pickerState('time','23:59');s=C.movePicker('time',s,[0,0]);assert.equal(s.draft,'00:00');
 assert.equal(C.pickerState('time','09:00').draft,'09:00');
});

function component(properties={}){
 const file=path.resolve('miniprogram/components/date-time-picker/date-time-picker.js');let definition;
 vm.runInNewContext(fs.readFileSync(file,'utf8'),{require:createRequire(file),Component:d=>{definition=d;}});
 const props=Object.fromEntries(Object.entries(definition.properties).map(([key,p])=>[key,p.value]));
 const events=[];const instance={...definition.methods,properties:{...props,...properties},data:JSON.parse(JSON.stringify(definition.data)),setData(p){Object.assign(this.data,p);},triggerEvent(name,detail){events.push({name,detail});}};
 return {instance,events};
}

test('选择器取消不提交，未滚动也可确认，输出原始日期；滚动未停止禁止误提交',()=>{
 const {instance:p,events}=component({value:'2026-11-08'});
 p.openPicker();assert.equal(p.data.opened,true);p.wheelChange({detail:{value:[p.data.indices[0],10,8]}});p.closePicker();assert.equal(events.filter(e=>e.name==='change').length,0);
 p.openPicker();assert.equal(p.data.draft,'2026-11-08');p.wheelStart();p.confirmPicker();assert.equal(p.data.opened,true);
 p.wheelEnd();p.confirmPicker();assert.equal(p.data.opened,false);assert.equal(events.filter(e=>e.name==='change')[0].detail.value,'2026-11-08');
 p.confirmPicker();assert.equal(events.filter(e=>e.name==='change').length,1);
});

test('时间选择器确认与禁用正确，日期范围生效而输出不含星期',()=>{
 const {instance:p,events}=component({mode:'time',value:'09:00'});p.openPicker();p.wheelChange({detail:{value:[14,3]}});p.confirmPicker();assert.equal(events.find(e=>e.name==='change').detail.value,'14:30');
 p.properties.disabled=true;p.openPicker();assert.equal(p.data.opened,false);
 const {instance:d}=component({value:'2020-01-01',start:'2026-11-08'});d.openPicker();assert.equal(d.data.draft,'2026-11-08');
});

test('所有时间滚轮分钟仅有十分钟档位，索引映射正确且不修改传入旧时间',()=>{
 const s=C.pickerState('time','19:46');assert.deepEqual(s.columns[1].map(row=>row.value),[0,10,20,30,40,50]);assert.deepEqual(s.columns[1].map(row=>row.label),['00分','10分','20分','30分','40分','50分']);assert.equal(s.draft,'19:40');
 for(let index=0;index<6;index++)assert.equal(C.movePicker('time',s,[19,index]).draft,'19:'+String(index*10).padStart(2,'0'));
 assert.equal(C.pickerState('time','23:59').draft,'23:50');
 const {instance:p,events}=component({mode:'time',value:'19:46'});p.openPicker();p.closePicker();assert.equal(p.properties.value,'19:46');assert.equal(events.filter(e=>e.name==='change').length,0);
});

test('连续滚动小时和分钟不重建选项，提交变化后确认不会卡在滚动状态',()=>{
 const {instance:p,events}=component({mode:'time',value:'09:00'});p.openPicker();const columns=p.data.columns;
 p.wheelStart();p.wheelChange({detail:{value:[14,3]}});assert.equal(p.data.columns,columns);assert.equal(p.data.moving,false);assert.equal(p.data.draft,'14:30');
 p.wheelStart();p.wheelChange({detail:{value:[16,5]}});assert.equal(p.data.columns,columns);assert.equal(p.data.draft,'16:50');
 p.confirmPicker();assert.equal(events.find(e=>e.name==='change').detail.value,'16:50');
 p.openPicker();p.wheelStart();p.wheelEnd();p.confirmPicker();assert.equal(p.data.opened,false);
});

test('日期设置不变：同月滚动不重建，切换年月重算星期和月底，取消不保存',()=>{
 const {instance:p,events}=component({value:'2024-01-31'});p.openPicker();const columns=p.data.columns;
 p.wheelChange({detail:{value:[p.data.indices[0],0,29]}});assert.equal(p.data.draft,'2024-01-30');assert.equal(p.data.columns,columns);
 p.wheelChange({detail:{value:[p.data.indices[0],1,30]}});assert.equal(p.data.draft,'2024-02-29');assert.equal(p.data.columns[2][28].label,'29日（周四）');
 p.closePicker();assert.equal(events.filter(e=>e.name==='change').length,0);
});

test('五处时间入口的默认/空白/旧分钟值均可连续选择并确认，关闭后迟到事件不改变已选结果',()=>{
 for(const value of ['09:00','12:00','08:00','','19:46']){
  const {instance:p,events}=component({mode:'time',value});p.openPicker();
  p.wheelStart();p.wheelChange({detail:{value:[20,0]}});p.wheelStart();p.wheelChange({detail:{value:[21,5]}});p.confirmPicker();
  assert.equal(events.filter(e=>e.name==='change').length,1);assert.equal(events.find(e=>e.name==='change').detail.value,'21:50');
  p.wheelChange({detail:{value:[1,1]}});assert.equal(p.data.draft,'21:50');
 }
});
