// LOCAL MOCK ONLY. This is not an authorization boundary or a multi-device backend.
const D = require('./domain');
const KEY = 'meeting-battle.mock.v1';
const ACTOR = 'meeting-battle.actor';
const identities = [
  { id:'demo-owner', name:'模拟：发起人' }, { id:'demo-a', name:'模拟：成员甲' },
  { id:'demo-b', name:'模拟：成员乙' }, { id:'demo-c', name:'模拟：成员丙' }, { id:'demo-guest', name:'模拟：旁听参与者' }
];
function read() { const data = wx.getStorageSync(KEY); return data ? D.clone(data) : { meetings:{} }; }
function actor() { return wx.getStorageSync(ACTOR) || identities[0].id; }
function setActor(id) {
  if (!identities.some(p => p.id === id)) throw new Error('未知模拟身份');
  wx.setStorageSync(ACTOR,id);
}
function get(id) {
  const meeting = read().meetings[id];
  if (!meeting) throw new Error('会议不存在或本机没有该会议。模拟邀请不能跨设备共享。');
  return meeting;
}
function save(meeting) {
  const data = read(); data.meetings[meeting.id] = meeting;
  wx.setStorageSync(KEY,data); // throw on failure; never show a false success
}
function create(input) {
  if (input.previousId && get(input.previousId).owner !== actor()) throw new Error('仅发起人可开启新一轮');
  const id = 'local-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,8);
  // Local identifier only; future server tokens MUST use cryptographic randomness.
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  save(D.create(input, actor(), id, token));
  return { id, token };
}
function list() {
  const current=actor(),now=Date.now();
  return Object.values(read().meetings).filter(m => m.owner === current || m.members.some(p => p.actor === current))
    .sort((a,b)=>b.updatedAt-a.updatedAt).map(m => {
      const isOwner=m.owner===current,self=m.members.find(p=>p.actor===current),proposed=m.slots.filter(s=>s.proposed);
      const missing=person=>!person || proposed.some(s=>!['yes','maybe','no'].includes((m.replies[person.actor] || {})[s.id]));
      const reply=self && m.replies[self.actor];
      const hadOriginalReply=!!reply && m.slots.filter(s=>!s.proposed).every(s=>['yes','maybe','no'].includes(reply[s.id]));
      // This badge represents the current voter's own pending supplement only.
      // Other members' progress remains visible in the organizer's detail view.
      const needsSupplement=m.status==='collecting' && now<m.deadline && proposed.length>0 && hadOriginalReply &&
        !!(self && self.roleId && missing(self));
      const collectionComplete=isOwner && m.status==='collecting' && D.getLockState(m,now).allResponded;
      return {id:m.id,title:m.title,status:m.status,updatedAt:D.labelTime(m.updatedAt),isOwner,needsSupplement,collectionComplete};
    });
}
// Mock test utility only: carry an active invitation between simulated users.
// It requires a currently authorized context and does not revive revoked invites.
function simulationInvite(id,token) {
  const meeting=get(id);
  D.authorize(meeting,actor(),token);
  return meeting.inviteActive ? meeting.token : '';
}
function view(id,token) { return D.view(get(id), actor(),token); }
function act(id,token,action,payload) { save(D.apply(get(id),actor(),token,action,payload)); return view(id,token); }
function reset() { wx.removeStorageSync(KEY); }
module.exports = { identities, actor, setActor, create, list, view, act, reset, simulationInvite };
