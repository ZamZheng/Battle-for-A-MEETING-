const D = require('../../lib/domain');
const store = require('../../lib/store');
const ui = require('../../lib/ui');
function tomorrow() { return new Date(Date.now()+86400000+8*3600000).toISOString().slice(0,10); }
Page({
  data:{ title:'', purpose:'', dates:[], date:tomorrow(), from:'09:00', to:'12:00', duration:'60', interval:'30',
    deadlineDate:tomorrow(), deadlineTime:'08:00', roster:'', slots:[], excluded:[], error:'', previousId:null, busy:false },
  onLoad(options) {
    if (!options.previous) return;
    try {
      const m = store.view(options.previous);
      if (!m.isOwner) throw new Error('仅发起人可开启新一轮');
      this.setData({ title:m.title, purpose:m.purpose, duration:String(m.duration), previousId:m.id,
        roster:m.roles.map(r=>r.name+(r.required?'':'?')).join('\n') });
    } catch(e) { ui.error(this,e); }
  },
  field(e) {
    const key=e.currentTarget.dataset.field;
    this.setData({[key]:e.detail.value,...(['from','to','duration','interval'].includes(key)?{slots:[],excluded:[]}: {})});
  },
  dateChanged(e) { this.setData({date:e.detail.value}); },
  addDate() { this.setData({dates:[...new Set([...this.data.dates,this.data.date])].sort(),slots:[],excluded:[]}); },
  removeDate(e) { this.setData({dates:this.data.dates.filter(d=>d!==e.currentTarget.dataset.date),slots:[],excluded:[]}); },
  input() {
    return { ...this.data, duration:Number(this.data.duration), interval:Number(this.data.interval),
      deadline:D.dateTime(this.data.deadlineDate,this.data.deadlineTime),
      roster:this.data.roster.split('\n').map(x=>x.trim()).filter(Boolean).map(name=>({name:name.endsWith('?')?name.slice(0,-1).trim():name,required:!name.endsWith('?')})) };
  },
  preview() { try { const slots=D.generateSlots(this.data); this.setData({slots:slots.map(s=>({...s,keep:true})),excluded:[],error:''}); } catch(e) { ui.error(this,e); } },
  toggleSlot(e) {
    const id=e.currentTarget.dataset.id;
    const slots=this.data.slots.map(s=>s.id===id?{...s,keep:!s.keep}:s);
    this.setData({slots,excluded:slots.filter(s=>!s.keep).map(s=>s.id)});
  },
  async publish() {
    if (this.data.busy) return;
    try {
      if (!this.data.slots.length) throw new Error('请先生成并预览候选时段');
      const input=this.input();
      // Validate before confirmation, without persisting.
      D.create(input,store.actor(),'validation','validation');
      this.setData({busy:true});
      if (!(await ui.confirm('发布后成员可认领并填写。变更候选需要开启新一轮。'))) return;
      const result=store.create(input);
      wx.redirectTo({url:'/pages/meeting/meeting?id='+result.id+'&token='+result.token});
    } catch(e) { ui.error(this,e); } finally { this.setData({busy:false}); }
  }
});
