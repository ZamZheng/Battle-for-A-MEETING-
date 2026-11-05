// Pure business rules shared by the mock repository and future server implementation.
// All timestamps are epoch milliseconds; candidate inputs explicitly use Asia/Shanghai (+08:00).
const clone = value => JSON.parse(JSON.stringify(value));
const STATES = ['yes', 'maybe', 'no'];
function fail(message) { throw new Error(message); }
function text(value, label, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(label + '不能为空或过长');
  return value.trim();
}
function dateTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('日期或时间格式不正确');
  const value = Date.parse(date + 'T' + time + ':00+08:00');
  if (!Number.isFinite(value) || new Date(value + 8 * 3600000).toISOString().slice(0, 10) !== date) fail('日期不存在');
  return value;
}
function labelTime(value) { return new Date(value + 8 * 3600000).toISOString().slice(0,16).replace('T',' '); }
function generateSlots(input, now = Date.now()) {
  const duration = Number(input.duration), interval = Number(input.interval);
  if (!Number.isInteger(duration) || duration < 15 || duration > 480 || !Number.isInteger(interval) || interval < 15 || interval > 480) fail('时长与间隔须为15—480分钟整数');
  if (!Array.isArray(input.dates) || !input.dates.length || input.dates.length > 14) fail('请选择1—14个日期');
  const slots = [];
  [...new Set(input.dates)].sort().forEach(date => {
    const from = dateTime(date, input.from), to = dateTime(date, input.to);
    if (to <= from) fail('结束时间须晚于开始时间，不支持跨午夜');
    for (let start = from; start + duration * 60000 <= to; start += interval * 60000) {
      if (start <= now) fail('候选开始时间必须在未来');
      slots.push({ id: 's' + start, start, end: start + duration * 60000, label: labelTime(start) + '—' + labelTime(start + duration * 60000).slice(11) });
      if (slots.length > 80) fail('候选过多，请缩小范围或增大间隔（最多80项）');
    }
  });
  if (!slots.length) fail('范围内无法安排一个完整会议时段');
  return slots;
}
function create(input, actor, id, token, now = Date.now()) {
  if (!actor) fail('缺少当前身份');
  const slots = generateSlots(input, now).filter(s => !(input.excluded || []).includes(s.id));
  if (!slots.length) fail('请保留至少一个候选时段');
  if (!Array.isArray(input.roster) || !input.roster.length || input.roster.length > 30) fail('预设名单须为1—30人');
  const names = new Set();
  const roles = input.roster.map((r, i) => {
    const name = text(r.name, '姓名', 40);
    if (names.has(name)) fail('名单有重名，请在姓名后加部门等备注');
    names.add(name);
    return { id: 'r' + i, name, required: !!r.required };
  });
  if (!roles.some(r => r.required)) fail('请设置至少一位必到人员');
  const deadline = Number(input.deadline);
  if (!Number.isFinite(deadline) || deadline <= now || deadline > slots[0].start) fail('回复截止须在未来且不晚于最早候选开始时间');
  return { id, token, inviteActive: true, owner: actor, title: text(input.title, '主题'), purpose: text(input.purpose, '会议目的', 1000),
    timezone:'Asia/Shanghai', dates: [...new Set(input.dates)].sort(), duration:Number(input.duration), roles, slots,
    members:[], replies:{}, deadline, status:'collecting', finalSlot:null, version:1, updatedAt:now, history:[], previousId:input.previousId || null };
}
function member(m, actor) { return m.members.find(x => x.actor === actor); }
function authorize(m, actor, token, ownerOnly = false) {
  if (!actor) fail('缺少当前身份');
  if (ownerOnly) { if (m.owner !== actor) fail('仅发起人可操作'); return; }
  if (m.owner === actor || member(m, actor)) return;
  if (!m.inviteActive || token !== m.token) fail('邀请无效或已撤销');
}
function open(m, now) {
  if (m.status !== 'collecting') fail('会议已锁定或取消，不能修改');
  if (now >= m.deadline) fail('已截止，请联系发起人延长截止');
}
function summary(m) {
  const voters = m.roles.map(role => {
    const person = m.members.find(p => p.roleId === role.id);
    return { ...role, person, reply:person && m.replies[person.actor] };
  });
  return m.slots.map(slot => {
    let yes = 0, maybe = 0, no = 0, missing = 0, optionalYes = 0;
    const blockers = [], details = [];
    voters.forEach(v => {
      const choice = v.reply ? v.reply[slot.id] : null;
      if (choice === 'yes') { yes++; if (!v.required) optionalYes++; }
      else if (choice === 'maybe') maybe++;
      else if (choice === 'no') no++;
      else missing++;
      if (v.required && choice !== 'yes') blockers.push({ name:v.name, choice:choice || 'missing' });
      details.push({ name:v.name, required:v.required, choice:choice || 'missing' });
    });
    return { ...slot, yes, maybe, no, missing, optionalYes, blockers, details,
      eligible: blockers.length === 0, allYes:yes === voters.length,
      yesWidth:100 * yes/voters.length, maybeWidth:100 * maybe/voters.length, noWidth:100 * no/voters.length };
  }).sort((a,b) => Number(b.allYes)-Number(a.allYes) || Number(b.eligible)-Number(a.eligible) || b.optionalYes-a.optionalYes || a.start-b.start);
}
function view(m, actor, token, now = Date.now()) {
  authorize(m, actor, token);
  const self = member(m, actor), isOwner = m.owner === actor, named = !!self || isOwner;
  const slots = summary(m).map(s => named ? s : { ...s, details:[], blockers:[] });
  return { id:m.id, title:m.title, purpose:m.purpose, dates:m.dates, duration:m.duration, deadline:m.deadline,
    status:m.status === 'collecting' && now >= m.deadline ? 'closed' : m.status, finalSlot:m.finalSlot,
    version:m.version, updatedAt:m.updatedAt, slots, self: self || null, isOwner, inviteActive:m.inviteActive,
    roles:m.roles.map(r => ({ ...r, occupied:m.members.some(p => p.roleId === r.id) })).sort((a,b) => Number(b.required)-Number(a.required)),
    members:named ? m.members.map(p => ({roleId:p.roleId, profile:p.profile, submitted:!!m.replies[p.actor], ...(isOwner ? {actor:p.actor} : {})})) : [],
    reply:self ? m.replies[actor] || {} : {}, submitted:m.roles.filter(r => m.members.some(p => p.roleId === r.id && m.replies[p.actor])).length,
    total:m.roles.length, missing:m.roles.filter(r => !m.members.some(p => p.roleId === r.id && m.replies[p.actor])).map(r => r.name),
    observers:m.members.filter(p => !p.roleId).length,
    token:isOwner && m.inviteActive ? m.token : undefined };
}
function apply(original, actor, token, action, payload = {}, now = Date.now()) {
  authorize(original, actor, token);
  const m = clone(original);
  const ownerActions = ['lock','extend','cancel','revoke','move'];
  if (ownerActions.includes(action)) authorize(m, actor, token, true);
  if (action === 'claim' || action === 'move') {
    open(m, now);
    const targetActor = action === 'move' ? payload.targetActor : actor;
    const old = member(m, targetActor);
    if (action === 'move' && !old) fail('成员不存在');
    const roleId = payload.roleId || null;
    if (roleId && !m.roles.some(r => r.id === roleId)) fail('角色不存在');
    if (roleId && m.members.some(p => p.roleId === roleId && p.actor !== targetActor)) fail('角色已被认领，请联系发起人处理冲突');
    const profile = action === 'move' ? old.profile : { name:text(payload.profile && payload.profile.name, '工作姓名',40), nickname:String(payload.profile.nickname || '').trim().slice(0,40), avatar:String(payload.profile.avatar || '').slice(0,2048) };
    if (old) { old.roleId = roleId; old.profile = profile; }
    else m.members.push({ actor:targetActor, roleId, profile });
    m.history.push({action:'claim', actor, targetActor, from:old ? member(original,targetActor).roleId : null, to:roleId, at:now});
  } else if (action === 'reply') {
    open(m, now);
    const person = member(m, actor);
    if (!person || !person.roleId) fail('请先认领参会角色；仅接收信息者不投票');
    if (Object.keys(payload.choices || {}).length !== m.slots.length || m.slots.some(s => !STATES.includes(payload.choices[s.id]))) fail('请填写全部候选，可批量选择');
    m.replies[actor] = clone(payload.choices);
  } else if (action === 'lock') {
    if (m.status !== 'collecting') fail('会议已锁定或取消');
    if (m.slots.find(s => s.id === payload.slotId && s.start <= now)) fail('不能锁定已经开始的时段');
    if (payload.version !== m.version) fail('数据已更新，请刷新后重新确认');
    const selected = summary(m).find(s => s.id === payload.slotId);
    if (!selected || !selected.eligible) fail('必到人员尚未全部明确可以，不能锁定');
    m.status = 'locked'; m.finalSlot = selected.id;
  } else if (action === 'extend') {
    if (m.status !== 'collecting') fail('仅收集中或截止待确认的会议可延长');
    const deadline = Number(payload.deadline);
    if (!Number.isFinite(deadline) || deadline <= now || deadline <= m.deadline || deadline > m.slots[0].start) fail('新截止须晚于当前截止和现在，且不晚于最早候选');
    m.deadline = deadline;
  } else if (action === 'cancel') {
    if (m.status === 'cancelled') fail('会议已取消');
    m.status = 'cancelled';
  } else if (action === 'revoke') {
    m.inviteActive = false; // existing members retain access; outsiders lose preview and claim
  } else fail('未知操作');
  m.version++; m.updatedAt = now;
  return m;
}
module.exports = { create, generateSlots, dateTime, labelTime, summary, view, apply, authorize, clone };
