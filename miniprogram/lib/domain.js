// Pure business rules shared by the mock repository and future server implementation.
// All timestamps are epoch milliseconds; candidate inputs explicitly use Asia/Shanghai (+08:00).
const clone = value => JSON.parse(JSON.stringify(value));
const STATES = ['yes', 'maybe', 'no'];
const LOCK_RULE_VERSION = 'vote-lock-state-v3';
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
// Split at the first ASCII/Chinese colon. Notes are recognition-only metadata.
function roleFields(role) {
  const raw=text(role.name,'称呼',300);
  const colon=raw.search(/[:：]/);
  const name=text(colon<0?raw:raw.slice(0,colon),'称呼',40);
  const note=role.note===undefined ? (colon<0?'':raw.slice(colon+1).trim()) : role.note;
  if (typeof note!=='string' || note.trim().length>200) fail('备注须为200字以内文字');
  return {name,note:note.trim()};
}
function parseRoster(value) {
  if (typeof value!=='string') fail('请填写参会名单');
  return value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{
    const optional=/[?？]$/.test(line);
    return {...roleFields({name:optional?line.slice(0,-1).trim():line}),required:!optional};
  });
}
function formatRoster(roles) {
  return roles.map(role=>{const {name,note}=roleFields(role);return name+(note?'：'+note:'')+(role.required?'':'?');}).join('\n');
}
function normalizeMeeting(meeting) {
  // Read old colon-in-name records without rewriting IDs, replies or original storage.
  const roles=meeting.roles.map(role=>({...role,...roleFields(role)}));
  const members=meeting.members.map(person=>person.profile.nameSource==='role' ? {...person,profile:{...person.profile,
    name:person.roleId ? (roles.find(r=>r.id===person.roleId)||{}).name || person.profile.name : '旁听者'}} : person);
  return {...meeting,roles,members};
}
function create(input, actor, id, token, now = Date.now()) {
  if (!actor) fail('缺少当前身份');
  const slots = generateSlots(input, now).filter(s => !(input.excluded || []).includes(s.id));
  if (!slots.length) fail('请保留至少一个候选时段');
  if (!Array.isArray(input.roster) || !input.roster.length || input.roster.length > 30) fail('预设名单须为1—30人');
  const names = new Set();
  const roles = input.roster.map((r, i) => {
    const {name,note} = roleFields(r);
    if (names.has(name)) fail('名单有重名称呼，请使用不同称呼区分；备注不能用于区分重名');
    names.add(name);
    return { id: 'r' + i, name, note, required: !!r.required };
  });
  if (!roles.some(r => r.required)) fail('请设置至少一位必到人员');
  const deadline = Number(input.deadline);
  if (!Number.isFinite(deadline) || deadline <= now || deadline > slots[0].start) fail('回复截止须在未来且不晚于最早候选开始时间');
  return { id, token, inviteActive: true, owner: actor, title: text(input.title, '主题'), purpose: text(input.purpose, '会议目的', 1000),
    timezone:'Asia/Shanghai', dates: [...new Set(input.dates)].sort(), duration:Number(input.duration), roles, slots,
    members:[], replies:{}, deadline, status:'collecting', finalSlot:null, meetingLink:'', version:1, updatedAt:now, history:[], previousId:input.previousId || null };
}
function member(m, actor) { return m.members.find(x => x.actor === actor); }
function authorize(m, actor, token, ownerOnly = false) {
  if (!actor) fail('缺少当前身份');
  if (ownerOnly) { if (m.owner !== actor) fail('仅发起人可操作'); return; }
  if (m.owner === actor || member(m, actor)) return;
  if (!m.inviteActive) fail('邀请已撤销，尚未加入的成员不能进入');
  if (!token) fail('缺少邀请凭证，请通过有效邀请进入');
  if (token !== m.token) fail('邀请凭证无效，请重新获取邀请');
}
function open(m, now) {
  if (m.status !== 'collecting') fail('会议已锁定或取消，不能修改');
  if (now >= m.deadline) fail('已截止，请联系发起人延长截止');
}
function completeReply(m,actor) {
  const reply=m.replies[actor];
  return !!reply && m.slots.every(slot=>STATES.includes(reply[slot.id]));
}
function summary(m) {
  m=normalizeMeeting(m);
  const voters = m.roles.map(role => {
    const person = m.members.find(p => p.roleId === role.id);
    return { ...role, person, reply:person && m.replies[person.actor] };
  });
  const allReplied=voters.every(v=>v.person && completeReply(m,v.person.actor));
  return m.slots.map(slot => {
    let yes = 0, maybe = 0, no = 0, missing = 0, optionalYes = 0;
    const blockers = [], details = [];
    voters.forEach(v => {
      const choice = v.reply ? v.reply[slot.id] : null;
      if (choice === 'yes') { yes++; if (!v.required) optionalYes++; }
      else if (choice === 'maybe') maybe++;
      else if (choice === 'no') no++;
      else missing++;
      if (choice !== 'yes' && choice !== 'maybe') blockers.push({ name:v.name, choice:choice || 'missing' });
      details.push({ name:v.name, required:v.required, choice:choice || 'missing' });
    });
    return { ...slot, yes, maybe, no, missing, optionalYes, blockers, details,
      eligible: allReplied && blockers.length === 0, allYes:yes === voters.length,
      requiredMaybeNames:details.filter(d=>d.required && d.choice==='maybe').map(d=>d.name),
      yesWidth:100 * yes/voters.length, maybeWidth:100 * maybe/voters.length, noWidth:100 * no/voters.length };
  }).sort((a,b) => Number(b.allYes)-Number(a.allYes) || Number(b.eligible)-Number(a.eligible) || b.optionalYes-a.optionalYes || a.start-b.start);
}
function getLockState(m,now=Date.now(),slots=summary(m)) {
  const submitted=m.roles.filter(role=>m.members.some(person=>person.roleId===role.id && completeReply(m,person.actor))).length;
  const allResponded=m.roles.length>0 && submitted===m.roles.length;
  const active=m.status==='collecting';
  const decisions=slots.map(slot=>({id:slot.id,label:slot.label,start:slot.start,yes:slot.yes,maybe:slot.maybe,no:slot.no,missing:slot.missing,
    reason:!active?'inactive':!allResponded?'waiting':slot.no>0?'conflict':!Number.isFinite(slot.start)?'invalid-time':slot.start<=now?'past':'available'}));
  const candidateIds=decisions.filter(row=>row.reason==='available').map(row=>row.id);
  let emptyReason='';
  if(!active)emptyReason='会议已锁定或取消，不能再次锁定。';
  else if(!allResponded)emptyReason='名单中还有成员未完整提交，请等待回复收齐。';
  else if(!candidateIds.length){
    const noConflict=decisions.filter(row=>row.no===0);
    if(!noConflict.length)emptyReason='每个候选时段都有人选择“不行”，请重新协调或开启新一轮。';
    else if(noConflict.every(row=>row.reason==='past'))emptyReason='没有“不行”票的时段都已过开始时间。请核对下方设备时间，或开启新一轮。';
    else emptyReason='候选时间数据不完整，请复制排查信息后反馈，不必清空会议。';
  }
  return {evaluatedAt:now,submitted,total:m.roles.length,allResponded,candidateIds,decisions,emptyReason};
}
function view(m, actor, token, now = Date.now()) {
  m=normalizeMeeting(m);
  authorize(m, actor, token);
  const self = member(m, actor), isOwner = m.owner === actor, named = !!self || isOwner;
  const computed=summary(m);
  const lockState=getLockState(m,now,computed);
  const slots = computed.map(s => named ? s : { ...s, details:[], blockers:[] });
  return { id:m.id, title:m.title, purpose:m.purpose, dates:m.dates, duration:m.duration, deadline:m.deadline,
    status:m.status === 'collecting' && now >= m.deadline ? 'closed' : m.status, finalSlot:m.finalSlot, meetingLink:m.meetingLink || '',
    version:m.version, updatedAt:m.updatedAt, slots, lockState, self: self || null, isOwner, inviteActive:m.inviteActive,
    roles:m.roles.map(r => ({ ...r, occupied:m.members.some(p => p.roleId === r.id) })).sort((a,b) => Number(b.required)-Number(a.required)),
    members:named ? m.members.map(p => ({roleId:p.roleId, profile:p.profile, submitted:!!p.roleId && completeReply(m,p.actor), ...(isOwner ? {actor:p.actor} : {})})) : [],
    reply:self ? m.replies[actor] || {} : {}, selfSubmitted:!!self && !!self.roleId && completeReply(m,actor), submitted:m.roles.filter(r => m.members.some(p => p.roleId === r.id && completeReply(m,p.actor))).length,
    total:m.roles.length, missing:m.roles.filter(r => !m.members.some(p => p.roleId === r.id && completeReply(m,p.actor))).map(r => r.name),
    observers:m.members.filter(p => !p.roleId).length,
    token:isOwner && m.inviteActive ? m.token : undefined };
}
function apply(original, actor, token, action, payload = {}, now = Date.now()) {
  authorize(original, actor, token);
  const m = normalizeMeeting(clone(original));
  const ownerActions = ['lock','extend','cancel','revoke','move','meetingLink'];
  if (ownerActions.includes(action)) authorize(m, actor, token, true);
  if (action === 'claim' || action === 'move') {
    open(m, now);
    const targetActor = action === 'move' ? payload.targetActor : actor;
    const old = member(m, targetActor);
    if (action === 'move' && !old) fail('成员不存在');
    const roleId = payload.roleId || null;
    if (roleId && !m.roles.some(r => r.id === roleId)) fail('角色不存在');
    if (roleId && m.members.some(p => p.roleId === roleId && p.actor !== targetActor)) fail('角色已被认领，请联系发起人处理冲突');
    const roleName=roleId ? m.roles.find(r=>r.id===roleId).name : '旁听者';
    let profile;
    if (action === 'move') {
      profile=old.profile.nameSource==='role' ? { ...old.profile,name:roleName } : old.profile;
    } else if (payload.profile && payload.profile.nameSource==='role') {
      // New avatar-only flow: the display label comes from the selected roster role, not typed identity.
      profile={name:roleName,nameSource:'role',nickname:'',avatar:text(payload.profile.avatar,'头像',2048)};
    } else {
      // Preserve existing mock data and earlier manually entered names during migration.
      profile={name:text(payload.profile && payload.profile.name,'工作姓名',40),nickname:String(payload.profile.nickname || '').trim().slice(0,40),avatar:String(payload.profile.avatar || '').slice(0,2048)};
    }
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
    if (!selected || !getLockState(m,now).candidateIds.includes(selected.id)) fail('请先等待名单成员全部提交，并确认参会人员（含必到）都选择可以或可协调，再锁定。');
    m.status = 'locked'; m.finalSlot = selected.id;
  } else if (action === 'meetingLink') {
    if (m.status!=='locked') fail('仅已锁定会议可以更新网络会议链接');
    if (typeof payload.url!=='string') fail('请填写完整的 http:// 或 https:// 会议链接');
    const link=payload.url.trim();
    const matched=/^https?:\/\/([^\s/?#]+)(?:[/?#][^\s]*)?$/i.exec(link);
    if (link.length>2048) fail('会议链接过长，最多2048字符，请检查是否误粘贴了整段邀请');
    if (link && (!matched || /[@<>"'\\]/.test(matched[1]) || /[<>"'\\]/.test(link))) fail('请粘贴完整的 http:// 或 https:// 会议链接，不要包含整段邀请文字');
    m.meetingLink=link;
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
module.exports = { LOCK_RULE_VERSION, getLockState, create, generateSlots, dateTime, labelTime, summary, view, apply, authorize, clone, parseRoster, formatRoster };
