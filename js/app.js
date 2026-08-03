/* ============================================================
   LY Ops Command - app.js  核心逻辑层
   数据层 / 状态管理 / 业务规则 / 一次录入多处复用
   ============================================================ */
'use strict';

const NK = {
  LS_KEY: 'nk_ops_command_v1',
  mode: 'work', // work | demo
  db: null,
  currentView: 'dispatch',
  dispatchFilter: {},
  taskFilter: {},
  projectFilter: {},
  kpiMonth: null, // 'YYYY-MM'
  kpiEngineer: null,
  globalTimer: null,
};

/* ---------- 状态枚举 ---------- */
// 派单状态：花姐单人使用，工程师通过外部渠道沟通，不在系统内确认或反馈
NK.DISPATCH_STATUS = [
  '草稿', '已生成', '已发送', '跟进中', '处理中',
  '等待外部条件', '已处理', '待花姐验收', '已闭环',
];
NK.DISPATCH_EXTRA = ['已取消', '已暂停', '升级处理', '无需派单'];
NK.TASK_STATUS = ['待处理', '已分配', '处理中', '待反馈', '待验收', '已完成'];
NK.TASK_TYPES = ['派单', '故障', '用户请求', '日常检查', '安全告警', '专项子任务', '临时任务'];
NK.PROJECT_STATUS = ['未开始', '进行中', '有风险', '等待反馈', '等待验收', '已完成', '已暂停', '已取消'];
NK.PROJECT_TYPES = ['季度巡检', 'Windows补丁更新', 'DLP修复', '职场搬迁', '职场撤场', '资产盘点', '安全整改', '新系统上线', '设备升级', '临时专项'];
NK.SITE_STATUS = ['正常', '计划搬迁', '搬迁中', '计划撤场', '已撤场', '暂停服务'];

/* ---------- 工具函数 ---------- */
NK.uid = (p) => p + String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10);
NK.today = () => { const d = new Date(); return NK.fmtDate(d); };
NK.fmtDate = (d) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
};
NK.fmtDT = (d) => { const t = d || new Date(); return NK.fmtDate(t) + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
NK.curMonth = () => NK.fmtDate(new Date()).slice(0, 7);
NK.now = () => new Date().toISOString();
NK.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
NK.daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
NK.hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;
/** 防抖 */
NK.debounce = (fn, wait) => {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait || 250); };
};

/** 人性化时长显示 */
NK.humanDur = (ms) => {
  if (ms < 0) ms = 0;
  const min = Math.floor(ms / 60000);
  if (min < 1) return '<1分钟';
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}小时${min % 60 ? min % 60 + '分' : ''}`;
  const d = Math.floor(h / 24);
  return `${d}天${h % 24 ? h % 24 + '小时' : ''}`;
};
NK.waitText = (ts) => {
  if (!ts) return '—';
  return NK.humanDur(Date.now() - new Date(ts).getTime());
};
/** 剩余时间 */
NK.remainText = (dueDate, dueTime) => {
  if (!dueDate) return '—';
  const end = dueTime ? new Date(`${dueDate}T${dueTime}`) : new Date(`${dueDate}T23:59:59`);
  const ms = end - Date.now();
  if (ms < 0) return `<span class="t-danger">已超时 ${NK.humanDur(-ms)}</span>`;
  if (ms < 86400000) return `<span class="t-warn">剩余 ${NK.humanDur(ms)}</span>`;
  return `剩余 ${NK.humanDur(ms)}`;
};

/* ---------- 持久化 ---------- */
NK.save = () => { try { localStorage.setItem(NK.LS_KEY, JSON.stringify(NK.db)); } catch (e) { console.warn('save fail', e); } };
NK.load = () => {
  try { const raw = localStorage.getItem(NK.LS_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
};

/* ---------- 快速记录草稿 ---------- */
NK.saveDraft = (draft) => {
  try {
    if (draft === null) { localStorage.removeItem(NK.LS_KEY + '-draft'); return; }
    localStorage.setItem(NK.LS_KEY + '-draft', JSON.stringify(Object.assign({}, draft, { updatedAt: NK.now() })));
  } catch (e) {}
};
NK.loadDraft = () => {
  try { const raw = localStorage.getItem(NK.LS_KEY + '-draft'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
};
/** 记录自动标题：正文第一行，超20字截断；正文为空则用「快速记录 日期 时间」 */
NK.notesAutoTitle = (content) => {
  if (!content) return '快速记录 ' + NK.fmtDT(new Date());
  const firstLine = String(content).split('\n')[0].trim();
  return firstLine.length > 20 ? firstLine.slice(0, 20) + '\u2026' : (firstLine || '快速记录 ' + NK.fmtDT(new Date()));
};

/* ---------- 固定任务白名单（唯一正式固定任务，9项）---------- */
// 来源标记：系统固定任务。仅此白名单内的任务属于正式固定任务，
// 手动新增任务 / 派单关联任务不受白名单限制。
NK.FIXED_TASKS = [
  { id: 'TPL001', name: '宏1站、Teams、Outlook用户消息跟进', category: '日常工作', type: '日常检查', frequency: '每日', requirement: '查看宏1站、Teams及Outlook中的用户消息、反馈和待跟进事项。', priority: 'P3', trigger: '', fixedTime: '每日' },
  { id: 'TPL002', name: '中宏OA待办事项检查', category: '日常工作', type: '日常检查', frequency: '每日', requirement: '检查中宏OA中的待办事项和需要处理的内容。', priority: 'P3', trigger: '', fixedTime: '每日' },
  { id: 'TPL003', name: 'Symantec管理员摘要报告处理（Outlook）', category: '日常工作', type: '日常检查', frequency: '每日14:30', requirement: '通过Outlook查看并处理Symantec管理员摘要报告。', priority: 'P3', trigger: '', fixedTime: '14:30' },
  { id: 'TPL004', name: '联想SF工单系统检查', category: '日常工作', type: '日常检查', frequency: '每日下班前', requirement: '下班前检查联想SF工单系统中的工单录入和处理情况。', priority: 'P3', trigger: '', fixedTime: '下班前' },
  { id: 'TPL005', name: 'HP打印机耗材提醒（Outlook）', category: '日常工作', type: '日常检查', frequency: '邮件触发', requirement: '收到HP打印机耗材提醒邮件后，根据设备和职场信息进行跟进。', priority: 'P3', trigger: '耗材提醒', fixedTime: '触发' },
  { id: 'TPL006', name: '监管机Windows登录失败告警（Outlook）', category: '安全告警', type: '安全告警', frequency: '邮件触发', requirement: '收到监管机Windows登录失败告警后，确认职场、原因和后续处理情况。', priority: 'P3', trigger: '登录失败告警', fixedTime: '触发' },
  { id: 'TPL011', name: '内部派单协调', category: '专项任务', type: '专项子任务', frequency: '收到请求', requirement: '收到内部派单请求后，查询对应职场和工程师，完成派单及后续协调。', priority: 'P3', trigger: '派单协调', fixedTime: '触发' },
  { id: 'TPL014', name: '联想月报', category: '日常工作', type: '日常检查', frequency: '每月', requirement: '每月初整理和完成联想月报。', priority: 'P3', trigger: '', fixedTime: '每月初' },
  { id: 'TPL015', name: '联想内部月会', category: '日常工作', type: '日常检查', frequency: '月报完成后', requirement: '联想月报完成后，安排或准备当月内部月会。', priority: 'P3', trigger: '', fixedTime: '月报完成后' },
];
NK.FIXED_DAILY = () => NK.FIXED_TASKS.filter(t => ['每日', '每日14:30', '每日下班前'].includes(t.frequency));
NK.FIXED_MONTHLY = () => NK.FIXED_TASKS.filter(t => ['每月', '月报完成后'].includes(t.frequency));
NK.FIXED_TRIGGER = () => NK.FIXED_TASKS.filter(t => ['邮件触发', '收到请求'].includes(t.frequency));

/** 任务来源归类键（用于任务页来源筛选） */
NK.taskSourceKey = (t) => {
  if (t.type === '安全告警') return '安全告警';
  if (t.source === '系统固定任务') return '系统固定任务';
  if (t.projectId) return '专项任务';
  if (t.dispatchId) return '派单自动关联';
  return '花姐手动新增';   // 手动录入 / 花姐手动新增 归为手动
};
/** 任务来源显示标签 */
NK.taskSourceLabel = (t) => {
  const map = { '系统固定任务': '固定任务', '花姐手动新增': '手动任务', '安全告警': '安全告警', '派单自动关联': '派单任务', '专项任务': '专项任务' };
  return map[NK.taskSourceKey(t)] || t.source || '—';
};

/* ---------- 初始化 ---------- */
NK.initDB = () => {
  const saved = NK.load();
  const S = window.SEED_DATA;
  // 复用判定：基础资料（工程师/职场）匹配即可复用存档；
  // 固定任务与旧演示数据交由 NK.migrateFixedTasks() 幂等升级，绝不因模板数量变化而丢弃用户真实数据。
  const baseMatch = saved && typeof saved === 'object' && saved.version >= 1 &&
    saved.engineers && saved.sites &&
    saved.engineers.length === S.engineers.length &&
    saved.sites.length === S.sites.length;
  if (baseMatch) {
    NK.db = saved;
    NK.db.quickNotes = NK.db.quickNotes || [];
    NK.mode = saved.mode === 'demo' ? 'demo' : 'work';
    NK.migrateFixedTasks();   // 固定任务升级 + 清理旧演示/预置数据（幂等）
    NK.ensureFixedTasks();    // 生成今日/本月应出现的固定任务实例
    NK.save();
    return;
  }
  NK.db = {
    version: 2,
    seedHash: NK.seedHash(),
    mode: 'work',
    engineers: S.engineers.map(e => ({
      id: e.id, name: e.name, phone: e.phone,
      onsiteRegions: e.onsiteRegions || [], remoteRegions: e.remoteRegions || [],
      onsiteRaw: e.onsiteRaw || '', remoteRaw: e.remoteRaw || '',
    })),
    sites: S.sites.map(s => ({ ...s })),
    handoverTemplates: NK.FIXED_TASKS.slice(),
    kpiRules: JSON.parse(JSON.stringify(S.kpiRules)),
    templates: [{ id: 'TPL_MSG', name: '默认派单消息', active: true, content: '【{职场}现场支持派单】\n处理事项：{事项}\n优先级：{优先级}\n职场联系人：{联系人}\n联系电话：{电话}\n详细地址：{地址}\n负责工程师：{工程师}\n计划到场时间：{到场时间}\n期望完成时间：{完成时间}\n\n请收到后及时确认。\n到场后请反馈到场情况，处理完成后反馈处理结果。\n如涉及设备、资产、网络线路或现场变更，请同时提供相关信息及现场照片。' }],
    // 运行时数据
    tasks: [], dispatches: [], projects: [], projectTasks: [],
    taskUpdates: [], kpiEvents: [], customerRatings: [], reminders: [], handovers: [],
    quickNotes: [],
    nextSeq: { dispatch: 1, task: 1, project: 1, kpi: 1 },
    createdAt: NK.now(),
    // 实时告警清空状态（一键清空）：只标记告警提示，绝不删除业务数据
    alertState: { cooldownHours: 2, cleared: {}, records: [] },
    fixedMigrated: true,
  };
  // 兼容旧存档：补齐 alertState 字段
  NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  NK.ensureFixedTasks();
  NK.save();
};
NK.seedHash = () => {
  const S = window.SEED_DATA;
  return (S.engineers.length + '-' + S.sites.length);
};
/** 生成编号 */
NK.nextNo = (type) => {
  const seq = NK.db.nextSeq[type] || 1;
  NK.db.nextSeq[type] = seq + 1;
  const pad = String(seq).padStart(3, '0');
  if (type === 'dispatch') return `PD${NK.today().replace(/-/g, '')}-${pad}`;
  if (type === 'task') return `RW${NK.today().replace(/-/g, '')}-${pad}`;
  if (type === 'project') return `ZX-${pad}`;
  return `KP-${pad}`;
};

/* ============================================================
   数据访问辅助
   ============================================================ */
NK.getEngineer = (name) => NK.db.engineers.find(e => e.name === name);
NK.getSite = (id) => NK.db.sites.find(s => s.id === id);
NK.getDispatch = (id) => NK.db.dispatches.find(d => d.id === id);
NK.getTask = (id) => NK.db.tasks.find(t => t.id === id);
NK.getProject = (id) => NK.db.projects.find(p => p.id === id);
NK.getProjectTasks = (pid) => NK.db.projectTasks.filter(t => t.projectId === pid);

/** 按城市查找职场（同城多职场必须列出全部） */
NK.sitesByCity = (city) => NK.db.sites.filter(s => s.city.includes(city) || city.includes(s.city));
/** 按工程师找职场 */
NK.sitesByEngineer = (name) => NK.db.sites.filter(s => s.defaultEngineer === name);
/** 职场支持工程师及支持方式 */
NK.siteSupport = (site) => {
  const eng = NK.getEngineer(site.defaultEngineer);
  if (!eng) return { engineer: '', phone: '', type: site.supportType || '远程' };
  const isOnsite = site.supportType === '驻场' || site.supportType === '驻场巡检';
  return { engineer: eng.name, phone: eng.phone, type: isOnsite ? '驻场' : '远程' };
};

/* ============================================================
   搜索（职场/工程师/联系人/电话/地址/派单/任务）
   ============================================================ */
NK.search = (q) => {
  q = (q || '').trim().toLowerCase();
  if (!q) return null;
  const out = { sites: [], engineers: [], contacts: [], dispatches: [], tasks: [] };
  NK.db.sites.forEach(s => {
    const hay = `${s.id} ${s.name} ${s.city} ${s.province} ${s.address} ${s.contactName} ${s.contactPhone} ${s.defaultEngineer} ${s.remark}`.toLowerCase();
    if (hay.includes(q)) out.sites.push(s);
  });
  NK.db.engineers.forEach(e => {
    const hay = `${e.id} ${e.name} ${e.phone} ${e.onsiteRegions.join(' ')} ${e.remoteRegions.join(' ')}`.toLowerCase();
    if (hay.includes(q)) out.engineers.push(e);
  });
  // 联系人去重（按电话）
  const seen = new Set();
  NK.db.sites.forEach(s => {
    if (s.contactName && s.contactPhone && !seen.has(s.contactPhone) &&
        (`${s.contactName}${s.contactPhone}`.toLowerCase().includes(q))) {
      seen.add(s.contactPhone);
      out.contacts.push(s);
    }
  });
  NK.db.dispatches.forEach(d => {
    if (`${d.no} ${d.title} ${d.siteCity} ${d.siteName} ${d.engineer} ${d.contactName} ${d.workNo || ''}`.toLowerCase().includes(q))
      out.dispatches.push(d);
  });
  NK.db.tasks.forEach(t => {
    if (`${t.no} ${t.name} ${t.type} ${t.siteCity} ${t.engineer} ${t.workNo || ''}`.toLowerCase().includes(q))
      out.tasks.push(t);
  });
  return out;
};

/* ============================================================
   派单
   ============================================================ */
NK.DISPATCH_FLOW = ['草稿', '已生成', '已发送', '跟进中', '处理中', '等待外部条件', '已处理', '待花姐验收', '已闭环'];
NK.dispatchStep = (status) => NK.DISPATCH_FLOW.indexOf(status);

/**
 * 创建派单（核心：一次操作完成多项工作）
 * 自动：保存派单 + 创建关联任务 + 分配工程师 + 生成派单消息（花姐复制发送）
 */
NK.createDispatch = (data) => {
  const site = data.siteId ? NK.getSite(data.siteId) : null;
  const no = NK.nextNo('dispatch');
  const nowIso = NK.now();
  const dispatch = {
    id: NK.uid('D'),
    no,
    title: data.title || (site ? `${site.name}${data.typeName || ''}处理` : '运维事项'),
    desc: data.desc || '',
    type: data.type || '故障',
    priority: data.priority || 'P2',
    province: data.province || (site ? site.province : ''),
    city: data.city || (site ? site.city : ''),
    siteId: data.siteId || '',
    siteName: site ? site.name : (data.siteName || ''),
    contactName: data.contactName || (site ? site.contactName : ''),
    contactPhone: data.contactPhone || (site ? site.contactPhone : ''),
    address: data.address || (site ? site.address : ''),
    defaultEngineer: site ? site.defaultEngineer : (data.defaultEngineer || ''),
    engineer: data.engineer || (site ? site.defaultEngineer : '') || '',
    supportType: site ? site.supportType : '',
    needDispatch: site ? site.needDispatch : true,
    createdAt: nowIso,
    requireConfirmBy: data.requireConfirmBy || '',
    planArrive: data.planArrive || '',
    planArriveTime: data.planArriveTime || '',
    planDone: data.planDone || '',
    planDoneTime: data.planDoneTime || '',
    confirmAt: '', startAt: '', doneAt: '', feedbackAt: '',
    status: '已生成',
    latestFeedback: '', nextAction: '', result: '', acceptResult: '',
    workNo: data.workNo || '', projectId: data.projectId || '',
    creator: '花姐', updatedAt: nowIso,
    reminders: [], attachments: [], source: data.source || 'manual',
    msg: '', urgentCount: 0, kpiCounted: false,
  };
  NK.db.dispatches.push(dispatch);

  // 生成派单消息
  dispatch.msg = NK.renderDispatchMsg(dispatch);

  // 自动创建关联任务
  const task = {
    id: NK.uid('T'),
    no: NK.nextNo('task'),
    name: dispatch.title,
    type: '派单',
    priority: dispatch.priority,
    source: '派单自动生成',
    siteId: dispatch.siteId, siteName: dispatch.siteName, siteCity: dispatch.city,
    engineer: dispatch.engineer,
    createdAt: nowIso, startAt: '', dueDate: dispatch.planDone, dueTime: dispatch.planDoneTime,
    doneAt: '', status: '待处理', latestFeedback: '', nextAction: '派单已生成，等待花姐复制发送并通知工程师',
    result: '', acceptResult: '', acceptRequire: '处理完成后提交结果与现场照片，由创建人验收',
    dispatchId: dispatch.id, projectId: dispatch.projectId || '',
    workNo: dispatch.workNo || '', tags: [], updatedAt: nowIso, kpiCounted: false,
  };
  NK.db.tasks.push(task);
  dispatch.taskId = task.id;

  // 提醒花姐派单已生成，尚未标记发送
  NK.addReminder('派单已生成', `${dispatch.no} ${dispatch.title} 已生成，尚未发送`, 'dispatch', dispatch.id);
  NK.save();
  return dispatch;
};

/** 渲染派单消息 */
NK.renderDispatchMsg = (d) => {
  const tpl = NK.activeTpl();
  const site = d.siteId ? NK.getSite(d.siteId) : null;
  const cityLabel = d.siteName || d.city || d.siteName;
  const map = {
    '{职场}': cityLabel,
    '{事项}': d.desc || d.title,
    '{优先级}': d.priority,
    '{联系人}': d.contactName || '（现场联系人见地址）',
    '{电话}': d.contactPhone || '—',
    '{地址}': d.address || '—',
    '{工程师}': d.engineer || '待指派',
    '{到场时间}': d.planArrive ? `${d.planArrive}${d.planArriveTime ? ' ' + d.planArriveTime : ''}` : '尽快到场',
    '{完成时间}': d.planDone ? `${d.planDone}${d.planDoneTime ? ' ' + d.planDoneTime : ''}` : '请评估后回复',
  };
  return tpl.content.replace(/\{职场\}|\{事项\}|\{优先级\}|\{联系人\}|\{电话\}|\{地址\}|\{工程师\}|\{到场时间\}|\{完成时间\}/g,
    (m) => map[m] || '');
};
NK.activeTpl = () => {
  const t = NK.db.templates.find(x => x.active);
  return t || NK.db.templates[0];
};

/** 状态流转（花姐单人模式：所有状态由花姐手动更新） */
NK.setDispatchStatus = (d, status) => {
  const nowIso = NK.now();
  const flow = NK.DISPATCH_FLOW;
  const oldIdx = flow.indexOf(d.status);
  const newIdx = flow.indexOf(status);
  d.status = status;
  d.updatedAt = nowIso;
  // 时间戳记录
  if (status === '已发送' && !d.sentAt) d.sentAt = nowIso;
  if (status === '处理中' && !d.startAt) d.startAt = nowIso;
  if (status === '待花姐验收' && !d.feedbackAt) d.feedbackAt = nowIso; // 花姐记录处理结果的时间
  if (status === '已闭环') {
    d.doneAt = d.doneAt || nowIso;
    const t = NK.getTask(d.taskId);
    if (t) { t.doneAt = nowIso; t.status = '已完成'; t.updatedAt = nowIso; }
  }
  // 同步关联任务状态（按花姐的操作推进）
  const task = NK.getTask(d.taskId);
  if (task && status !== '已闭环') {
    const map = {
      '已生成': '待处理', '已发送': '待处理',
      '跟进中': '处理中', '处理中': '处理中',
      '等待外部条件': '处理中', '已处理': '待验收', '待花姐验收': '待验收'
    };
    if (map[status]) { task.status = map[status]; task.updatedAt = nowIso; }
  }
  NK.save();
};

/** 更新派单反馈 */
NK.updateDispatchFeedback = (d, { feedback, nextAction, result, acceptResult, workNo }) => {
  d.latestFeedback = feedback != null ? feedback : d.latestFeedback;
  d.nextAction = nextAction != null ? nextAction : d.nextAction;
  d.result = result != null ? result : d.result;
  d.acceptResult = acceptResult != null ? acceptResult : d.acceptResult;
  if (workNo != null) d.workNo = workNo;
  d.updatedAt = NK.now();
  const t = NK.getTask(d.taskId);
  if (t) {
    if (feedback != null) t.latestFeedback = feedback;
    if (nextAction != null) t.nextAction = nextAction;
    if (result != null) t.result = result;
    if (acceptResult != null) t.acceptResult = acceptResult;
    t.updatedAt = d.updatedAt;
  }
  NK.save();
};

/** 催办 */
NK.urgent = (d) => {
  d.urgentCount = (d.urgentCount || 0) + 1;
  d.reminders.push({ t: NK.now(), type: '催办', count: d.urgentCount });
  d.updatedAt = NK.now();
  NK.save();
  const msg = `${d.engineer || '工程师'}，麻烦确认一下"${d.title}"目前处理进度。该事项计划于${d.planDone || '约定时间'}前完成，请在微信/Teams/电话中反馈当前状态、下一步计划及预计完成时间，谢谢。`;
  return msg;
};

/* ============================================================
   任务
   ============================================================ */
NK.createTask = (data) => {
  const nowIso = NK.now();
  const task = {
    id: NK.uid('T'),
    no: NK.nextNo('task'),
    name: data.name, type: data.type || '临时任务', priority: data.priority || 'P3',
    source: data.source || '手动录入',
    siteId: data.siteId || '', siteName: data.siteName || '', siteCity: data.siteCity || '',
    engineer: data.engineer || '',
    createdAt: nowIso, startAt: data.startAt || '', dueDate: data.dueDate || '', dueTime: data.dueTime || '',
    doneAt: '', status: data.status || '待处理',
    latestFeedback: '', nextAction: data.nextAction || '', result: '',
    acceptResult: '', acceptRequire: data.acceptRequire || '',
    dispatchId: data.dispatchId || '', projectId: data.projectId || '',
    workNo: data.workNo || '', tags: data.tags || [], updatedAt: nowIso, kpiCounted: false,
  };
  NK.db.tasks.push(task);
  NK.save();
  return task;
};
NK.setTaskStatus = (t, status) => {
  const nowIso = NK.now();
  t.status = status; t.updatedAt = nowIso;
  if (status === '已完成') t.doneAt = nowIso;
  NK.save();
  // 完成当月联想月报后，自动生成当月联想内部月会任务（同月去重）
  if (status === '已完成' && t.templateId === 'TPL014' && t.fixedYM) {
    NK.ensureFixedMonthly(NK.FIXED_TASKS.find(x => x.id === 'TPL015'), t.fixedYM);
  }
};
NK.updateTaskFeedback = (t, { feedback, nextAction, result, acceptResult }) => {
  if (feedback != null) t.latestFeedback = feedback;
  if (nextAction != null) t.nextAction = nextAction;
  if (result != null) t.result = result;
  if (acceptResult != null) t.acceptResult = acceptResult;
  t.updatedAt = NK.now();
  NK.save();
};

/* ============================================================
   固定任务实例生成
   规则：
   · 每日类（每日/每日14:30/每日下班前）→ 每天生成一条今日实例（fixedDate=today）
   · 月度类（每月/月报完成后）        → 按「年月+模板ID」去重，同月只生成一次（fixedYM=ym）
   · 触发类（邮件触发/收到请求）      → 不自动生成，仅由花姐手动点击快捷入口触发（triggerTask）
   · 每日任务次日重置：当天实例完成后标记当日完成，第二天重新生成新实例，绝不堆叠。
   ============================================================ */
NK.ensureFixedTasks = () => {
  const today = NK.today();
  const ym = today.slice(0, 7);
  NK.FIXED_DAILY().forEach(tpl => NK.ensureFixedDaily(tpl, today));
  NK.FIXED_MONTHLY().forEach(tpl => NK.ensureFixedMonthly(tpl, ym));
  NK.save();
};

/** 每日类固定任务：仅生成一条 fixedDate=today 的实例（去重按 模板+当天日期） */
NK.ensureFixedDaily = (tpl, today) => {
  const exists = NK.db.tasks.find(t =>
    t.source === '系统固定任务' && t.templateId === tpl.id && t.fixedDate === today);
  if (exists) return exists;
  const task = NK.createTask({
    name: tpl.name, type: tpl.type, priority: tpl.priority,
    source: '系统固定任务', nextAction: tpl.requirement || '',
    status: '待处理',
  });
  task.templateId = tpl.id;
  task.fixedDate = today;      // 每日实例的日期，用于次日重置与去重
  task.frequency = tpl.frequency || '';
  task.fixedTime = tpl.fixedTime || '';   // '每日' | '14:30' | '下班前'
  task.updatedAt = NK.now();
  return task;
};

/** 月度类固定任务：按「年月+模板ID」去重，同月只生成一次 */
NK.ensureFixedMonthly = (tpl, ym) => {
  // 联想内部月会：当月月报（TPL014）完成前不生成
  if (tpl.id === 'TPL015') {
    const report = NK.db.tasks.find(t => t.templateId === 'TPL014' && t.fixedYM === ym);
    if (!report || report.status !== '已完成') return null;
  }
  const exists = NK.db.tasks.find(t =>
    t.source === '系统固定任务' && t.templateId === tpl.id && t.fixedYM === ym);
  if (exists) return exists;
  const task = NK.createTask({
    name: tpl.name, type: tpl.type, priority: tpl.priority,
    source: '系统固定任务', nextAction: tpl.requirement || '',
    status: '待处理',
  });
  task.templateId = tpl.id;
  task.fixedYM = ym;           // 月度实例的年月，用于同月去重
  task.frequency = tpl.frequency || '';
  task.fixedTime = tpl.fixedTime || '';
  task.updatedAt = NK.now();
  return task;
};

/** 触发式固定任务入口：当天已有该模板的待处理实例则复用，否则新建一条今日实例 */
NK.triggerTask = (tplId) => {
  const tpl = NK.FIXED_TASKS.find(t => t.id === tplId);
  if (!tpl) return null;
  const today = NK.today();
  let task = NK.db.tasks.find(t =>
    t.source === '系统固定任务' && t.templateId === tplId &&
    t.status !== '已完成' && (t.fixedDate === today || t.createdAt.slice(0, 10) === today));
  if (!task) {
    task = NK.createTask({
      name: tpl.name, type: tpl.type, priority: tpl.priority,
      source: '系统固定任务', nextAction: tpl.requirement || '',
      status: '待处理',
    });
    task.templateId = tplId;
    task.fixedDate = today;
    task.frequency = tpl.frequency || '';
    task.fixedTime = tpl.fixedTime || '';
    task.updatedAt = NK.now();
  }
  NK.save();
  return task;
};

/* ============================================================
   专项
   ============================================================ */
NK.createProject = (data) => {
  const nowIso = NK.now();
  const project = {
    id: NK.uid('P'), no: NK.nextNo('project'),
    name: data.name, type: data.type || '临时专项',
    goal: data.goal || '', startDate: data.startDate || '', dueDate: data.dueDate || '',
    sites: data.siteIds || [], owner: data.owner || '', participants: data.participants || [],
    status: data.status || '未开始', progress: 0, risk: '', nextAction: '',
    acceptRequire: data.acceptRequire || '', createdAt: nowIso, updatedAt: nowIso,
    attachments: [], remark: data.remark || '',
  };
  NK.db.projects.push(project);
  if (data.autoTasks && data.autoTasks.length) {
    data.autoTasks.forEach(name => {
      NK.db.projectTasks.push({
        id: NK.uid('PT'), projectId: project.id, name,
        status: '未开始', engineer: '', feedback: '', updatedAt: nowIso,
      });
    });
  }
  NK.save();
  return project;
};
NK.updateProjectProgress = (p) => {
  const pts = NK.getProjectTasks(p.id);
  const done = pts.filter(x => x.status === '已完成').length;
  p.progress = pts.length ? Math.round(done / pts.length * 100) : 0;
  p.updatedAt = NK.now();
  NK.save();
};
/** 季度巡检模板 */
NK.quarterlyInspectTasks = () => [
  '工程师是否到场', '巡检是否完成', '机房照片是否提交', '机房照片是否合格',
  '监管机照片是否提交', '监管机照片是否合格', '巡检单是否提交',
  '每名工程师是否提交规定数量', '监管机信息是否更新', '资产盘点表是否更新', '是否完成验收',
];

/* ============================================================
   KPI
   ============================================================ */
NK.kpiItems = () => NK.db.kpiRules.items;
NK.kpiBonus = () => NK.db.kpiRules.bonusItems;

/**
 * 登记KPI事件。data: {date, engineer, itemId, type('deduct'|'bonus'|'rating'|'auto'), points, reason, refType, refId, source}
 */
NK.addKpiEvent = (data) => {
  const ev = {
    id: NK.uid('K'),
    no: NK.nextNo('kpi'),
    date: data.date || NK.today(),
    engineer: data.engineer,
    itemId: data.itemId, itemName: data.itemName,
    type: data.type || 'manual', // manual | auto
    points: data.points || 0,
    reason: data.reason || '',
    refType: data.refType || '', refId: data.refId || '',
    source: data.source || '人工登记',
    evidence: data.evidence || '',
    recorder: data.recorder || '花姐',
    confirmed: data.confirmed != null ? data.confirmed : false,
    disputed: false, updatedAt: NK.now(),
  };
  NK.db.kpiEvents.push(ev);
  NK.save();
  return ev;
};

/** 计算某工程师某月KPI */
NK.computeKpi = (engineerName, month) => {
  const rules = NK.db.kpiRules;
  const evs = NK.db.kpiEvents.filter(e => e.engineer === engineerName && e.date.slice(0, 7) === month);
  const ratings = NK.db.customerRatings.filter(r => r.engineer === engineerName && r.date.slice(0, 7) === month);
  const result = {
    engineer: engineerName, month,
    base: rules.baseScore,
    deductions: [], bonuses: [], details: [],
    ratingAvg: 0, ratingCount: ratings.length,
    final: rules.baseScore,
  };
  // 按 item 聚合扣分
  rules.items.forEach(item => {
    const itemEvs = evs.filter(e => e.itemId === item.id);
    let deductSum = 0;
    itemEvs.forEach(ev => {
      if (ev.points < 0) {
        deductSum += ev.points;
        result.deductions.push(ev);
      } else if (ev.points > 0 && ev.type === 'deduct_restore') {
        deductSum += ev.points;
        result.deductions.push(ev);
      }
    });
    // 客户评价维度
    if (item.type === 'rating') {
      let total = 0, cnt = 0;
      ratings.forEach(r => { Object.values(r.scores || {}).forEach(v => { total += Number(v) || 0; cnt++; }); });
      if (cnt) {
        const avg = total / cnt;
        result.ratingAvg = avg;
        const score = Math.round(avg * 20 / 20 * 10) / 10; // 20分制 = 平均维度分 * 4
        result.details.push({ itemId: item.id, itemName: item.name, score, avg, count: cnt });
      } else {
        result.details.push({ itemId: item.id, itemName: item.name, score: null, avg: 0, count: 0 });
      }
      return;
    }
    result.details.push({ itemId: item.id, itemName: item.name, deduct: deductSum, count: itemEvs.length });
  });
  // 加分
  rules.bonusItems.forEach(bi => {
    const bEvs = evs.filter(e => e.itemId === bi.id && e.points > 0);
    let sum = 0;
    bEvs.forEach(ev => { sum += ev.points; result.bonuses.push(ev); });
    if (sum > bi.maxPerMonth) sum = bi.maxPerMonth; // 单项上限
    result.details.push({ itemId: bi.id, itemName: bi.name, bonus: sum, count: bEvs.length });
  });
  // 工单量自动统计（任务/派单数量）
  const auto = NK.autoKpi(engineerName, month);
  result.auto = auto;
  // 最终分 = base - 扣分合计 + 加分合计（cap）
  let deductTotal = 0;
  result.deductions.forEach(ev => deductTotal += ev.points);
  let bonusTotal = 0;
  result.bonuses.forEach(ev => bonusTotal += ev.points);
  const autoDeduct = auto.deductTotal || 0;
  const autoBonus = auto.bonusTotal || 0;
  result.deductTotal = deductTotal + autoDeduct;
  result.bonusTotal = Math.min(bonusTotal + autoBonus, rules.bonusCap);
  let final = rules.baseScore + result.deductTotal + result.bonusTotal;
  if (final > rules.maxScore) final = rules.maxScore;
  if (final < rules.minScore) final = rules.minScore;
  result.final = final;
  return result;
};

/** 自动KPI：从任务/派单中提取证据 */
NK.autoKpi = (engineerName, month) => {
  const rules = NK.db.kpiRules;
  const out = { taskCount: 0, overdue: [], slowResp: [], deductTotal: 0, bonusTotal: 0, events: [] };
  // 当月该工程师任务与派单
  const tasks = NK.db.tasks.filter(t => t.engineer === engineerName && (t.createdAt || '').slice(0, 7) === month);
  const disps = NK.db.dispatches.filter(d => d.engineer === engineerName && (d.createdAt || '').slice(0, 7) === month);
  out.taskCount = tasks.length + disps.length;
  // 响应速度：花姐标记"已发送"后超1h无跟进记录
  disps.forEach(d => {
    // 花姐自己记录的响应时间（sentAt = 标记已发送的时间）
    if (d.sentAt && d.createdAt) {
      const h = NK.hoursBetween(d.sentAt, d.startAt || d.updatedAt);
      if (h > 1 && !d.kpiCounted) {
        const pts = (rules.items.find(i => i.id === 'response_speed') || {}).rules?.[0]?.points || -2;
        out.slowResp.push({ ref: d.no, hours: Math.round(h * 10) / 10 });
        out.deductTotal += pts;
      }
    }
    // 超时
    if (d.planDone && d.status !== '已闭环' && NK.today() > d.planDone) {
      const pts = (rules.items.find(i => i.id === 'execution') || {}).rules?.[0]?.points || -5;
      out.overdue.push({ ref: d.no });
      out.deductTotal += pts;
    }
  });
  tasks.forEach(t => {
    if (t.dueDate && t.status !== '已完成' && NK.today() > t.dueDate) {
      const pts = (rules.items.find(i => i.id === 'execution') || {}).rules?.[0]?.points || -5;
      out.overdue.push({ ref: t.no });
      out.deductTotal += pts;
    }
  });
  // 工单量
  const quota = rules.dailyQuota || 15;
  const workdays = 22;
  if (out.taskCount < quota * workdays) {
    const miss = quota * workdays - out.taskCount;
    const pts = -Math.min(miss, 10); // max 10
    if (pts < 0) out.deductTotal += pts;
  }
  return out;
};

/* ============================================================
   提醒
   ============================================================ */
NK.addReminder = (title, content, refType, refId, dueDate) => {
  NK.db.reminders.push({ id: NK.uid('R'), title, content, refType, refId, dueDate, created: NK.now(), done: false });
};
NK.genReminders = () => {
  const list = [];
  const today = NK.today();
  // 1. P1未处理任务
  NK.db.tasks.forEach(t => {
    if (t.priority === 'P1' && ['待处理', '已分配'].includes(t.status)) {
      list.push({ id: 'R-' + t.id, level: 'danger', title: 'P1任务未处理', content: `${t.no} ${t.name}（${t.siteName || '—'}）`, actions: [{ label: '查看任务', act: 'task', arg: t.id }] });
    }
    // 2. 超时
    if (t.dueDate && t.status !== '已完成' && today > t.dueDate) {
      list.push({ id: 'R-' + t.id + '-ov', level: 'danger', title: '任务已超时', content: `${t.no} ${t.name} 截止 ${t.dueDate}`, actions: [{ label: '催办', act: 'task', arg: t.id }] });
    }
    // 3. 距截止不足24h
    if (t.dueDate && t.status !== '已完成' && NK.daysBetween(today, t.dueDate) === 0) {
      list.push({ id: 'R-' + t.id + '-soon', level: 'warn', title: '距截止不足24小时', content: `${t.no} ${t.name} 今日到期`, actions: [{ label: '查看', act: 'task', arg: t.id }] });
    }
  });
  // 4. 派单未标记已发送（生成后花姐还未发送）
  NK.db.dispatches.forEach(d => {
    if (d.status === '已生成') {
      list.push({ id: 'R-' + d.id, level: 'warn', title: '派单已生成待发送', content: `${d.no} ${d.title}（${d.engineer || '未指派'}）`, actions: [{ label: '复制并发送', act: 'dispatch', arg: d.id }] });
    }
    if (d.status === '待花姐验收') {
      list.push({ id: 'R-' + d.id + '-acc', level: 'accent', title: '派单等待花姐验收', content: `${d.no} ${d.title} 已处理完成`, actions: [{ label: '立即验收', act: 'dispatch', arg: d.id }] });
    }
    // 4a. 下次跟进时间已到（花姐设置的跟进提醒）
    if (d.nextFollowup && d.status !== '已闭环' && d.status !== '已取消') {
      const due = new Date(d.nextFollowup).getTime();
      if (due <= Date.now()) {
        list.push({ id: 'R-' + d.id + '-nf', level: 'warn', title: '到点跟进派单', content: `${d.no} ${d.title}（${d.engineer || '未指派'}）`, actions: [{ label: '记录进展', act: 'dispatch', arg: d.id }] });
      }
    }
  });
  // 5. 专项风险
  NK.db.projects.forEach(p => {
    if (p.status === '进行中' || p.status === '有风险') {
      if (NK.daysBetween(p.updatedAt.slice(0, 10), today) >= 3) {
        list.push({ id: 'R-' + p.id, level: 'warn', title: '专项三天以上无更新', content: `${p.name}`, actions: [{ label: '查看专项', act: 'project', arg: p.id }] });
      }
      if (p.dueDate && today >= p.dueDate && p.status !== '已完成') {
        list.push({ id: 'R-' + p.id + '-due', level: 'danger', title: '专项即将到期/已超期', content: `${p.name} 截止 ${p.dueDate}`, actions: [{ label: '查看专项', act: 'project', arg: p.id }] });
      }
    }
  });

  /* ── 告警来源标识（用于一键清空 + 冷却去重）──────────── */
  list.forEach(r => {
    const a = (r.actions || [])[0];
    const typeMap = { task: 'task', dispatch: 'dispatch', project: 'project' };
    r.sourceType = a && typeMap[a.act] ? typeMap[a.act] : (a && a.act || 'other');
    r.sourceId = (a && a.arg) || r.id;
    // 稳定告警键：同一来源 + 同一告警类型 = 一条实例
    r.alertKey = r.id.replace(/^R-/, '');
  });

  /* ── 一键清空后的冷却抑制（清空的是提示，不是解决问题）──────────── */
  // 清空后 cooldownHours 小时内，同一来源同一原因不立即重复出现；
  // 冷却期结束或出现新的状态变化后，重新满足条件仍会重新告警。
  const cleared = NK.db.alertState && NK.db.alertState.cleared || {};
  const nowMs = Date.now();
  let expired = false;
  const filtered = list.filter(r => {
    const c = cleared[r.alertKey];
    if (!c) return true;                       // 从未清空
    if (c.solved) return true;                 // 已解决（重新触发）
    if (c.cooldownUntil && nowMs < c.cooldownUntil) return false; // 冷却期内
    // 冷却期已过：允许重新告警，同时生成一条新的告警实例（保留历史清空记录）
    delete cleared[r.alertKey];
    expired = true;
    return true;
  });
  if (expired) NK.save(); // 仅当清除了冷却期到期的标记时才持久化

  return filtered;
};

/* ============================================================
   实时告警 · 一键清空
   核心原则：清空的是当前告警提示，不是删除工作记录。
   ============================================================ */
/**
 * 获取实时告警完整清单（已应用冷却抑制）。含来源与告警键。
 */
NK.alerts = () => NK.genReminders();

/**
 * 一键清空当前告警。
 * scope: 'all' 全部清空 | 'warn' 只清空普通提醒，保留危险告警
 * 返回 { cleared: 本次清空实例数组, record: 清空记录, keptDanger: 保留危险数 }
 * 严格：不删除/不改动任务、派单、专项、KPI 任何业务数据。
 */
NK.clearAlerts = (scope) => {
  scope = scope || 'all';
  const list = NK.genReminders();
  const clearable = list.filter(r => scope === 'all' || r.level !== 'danger');
  const keptDanger = list.filter(r => r.level === 'danger' && scope !== 'all').length;

  const state = NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  const cooldownHours = (state.cooldownHours != null) ? state.cooldownHours : 2;
  const cooldownUntil = Date.now() + cooldownHours * 3600000;
  const batchId = NK.uid('CLR');
  const nowIso = NK.now();

  // 每条可清空告警标记为已清空（冷却期内不重复出现）
  clearable.forEach(r => {
    state.cleared[r.alertKey] = {
      alertKey: r.alertKey,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      alertLevel: r.level,
      alertReason: r.title,
      alertContent: r.content,
      createdAt: nowIso,
      clearedAt: nowIso,
      clearedBy: '花姐',
      clearBatchId: batchId,
      clearStatus: 'cleared',
      cooldownUntil,
    };
  });

  // 生成清空记录（历史留痕）
  const record = {
    batchId,
    clearedAt: nowIso,
    clearedBy: '花姐',
    scope,
    total: clearable.length,
    danger: clearable.filter(r => r.level === 'danger').length,
    warn: clearable.filter(r => r.level !== 'danger').length,
    keptDanger,
    cooldownHours,
    alerts: clearable.map(r => ({
      alertKey: r.alertKey, sourceType: r.sourceType, sourceId: r.sourceId,
      level: r.level, reason: r.title, content: r.content,
    })),
  };
  state.records.push(record);
  NK.save();
  return { cleared: clearable, record, keptDanger };
};

/**
 * 冷却期后告警重新出现时，允许清空状态解除并重新触发。
 * 当原始事项已解决（任务完成/派单闭环/专项完成）时调用，标记告警已解决。
 */
NK.resolveAlert = (alertKey) => {
  const state = NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  const c = state.cleared[alertKey];
  if (c) { c.solved = true; c.resolvedAt = NK.now(); c.clearStatus = 'solved'; }
  NK.save();
};

/**
 * 读取清空记录（按时间倒序）。
 */
NK.alertRecords = () => {
  const state = NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  return state.records.slice().reverse();
};

/* ============================================================
   花姐重点盯三件 — 真实可操作事项生成
   ============================================================ */
/**
 * 生成最多3条具体可操作重点事项。
 * 优先顺序：P1超时 > 任务超时 > 已发送无跟进 > 处理中无跟进 > 等待外部条件 >
 *           等验收 > 24h内到期 > 3天未更新 > 专项超期
 * 每条包含：title/sub/label/tag/badge/badgeLevel/actionBtn/actionAct/id/type
 * 所有提醒基于"花姐多久没更新记录"，而非工程师是否在系统内操作
 */
NK.genFocusItems = () => {
  const today = NK.today();
  const now = Date.now();
  const items = [];

  // ── 内部辅助：去重（同一派单/任务/专项只出现一次）───────────────
  const usedIds = new Set();

  const add = (item) => {
    if (usedIds.has(item.id)) return;
    usedIds.add(item.id);
    items.push(item);
  };

  // ── 1. P1超时任务 ─────────────────────────────────────────
  NK.db.tasks.forEach(t => {
    if (t.priority !== 'P1' || t.status === '已完成') return;
    const overdue = t.dueDate && today > t.dueDate;
    const longWait = (t.status === '已分配' || t.status === '待处理') &&
      NK.hoursBetween(t.createdAt, now) >= 2; // 等了2h以上
    if (!overdue && !longWait) return;
    const wait = NK.humanDur(now - new Date(t.createdAt).getTime());
    add({
      id: 't-p1-' + t.id,
      type: 'task',
      itemId: t.id,
      tag: 'P1超时',
      tagLevel: 'danger',
      title: t.name,
      line1: `${NK.v.siteName(t.siteName) || '—'} · ${NK.v.engName(t.engineer) || '待分配'}`,
      line2: overdue
        ? `已超时 ${NK.humanDur(new Date(today + 'T23:59:59').getTime() - new Date(t.dueDate + 'T23:59:59').getTime())}，截止 ${t.dueDate}`
        : `已等待 ${wait}`,
      line3: '建议立即处理，避免影响 SLA',
      actionBtn: '立即处理',
      actionAct: `UI.taskDetail('${t.id}')`,
    });
  });

  // ── 2. 任务超时（P2/P3）──────────────────────────────────
  NK.db.tasks.forEach(t => {
    if (t.priority === 'P1' || t.status === '已完成') return;
    if (!t.dueDate || today <= t.dueDate) return;
    const wait = NK.humanDur(new Date(today + 'T23:59:59').getTime() - new Date(t.dueDate + 'T23:59:59').getTime());
    add({
      id: 't-ov-' + t.id,
      type: 'task',
      itemId: t.id,
      tag: '已超时',
      tagLevel: 'danger',
      title: t.name,
      line1: `${NK.v.siteName(t.siteName) || '—'} · ${NK.v.engName(t.engineer) || '待分配'}`,
      line2: `已超时 ${wait}，截止 ${t.dueDate}`,
      line3: '需要尽快处理',
      actionBtn: '查看处理',
      actionAct: `UI.taskDetail('${t.id}')`,
    });
  });

  // ── 3. 已发送但30min以上无跟进记录 ──────────────────────
  NK.db.dispatches.forEach(d => {
    if (d.status !== '已发送') return;
    const ms = now - new Date(d.sentAt || d.createdAt).getTime();
    if (ms < 30 * 60000) return; // 不到30分钟不催
    const wait = NK.humanDur(ms);
    const longWait = ms >= 60 * 60000; // 超过1小时
    add({
      id: 'd-conf-' + d.id,
      type: 'dispatch',
      itemId: d.id,
      tag: longWait ? '超30分钟无跟进' : '待跟进',
      tagLevel: longWait ? 'danger' : 'warn',
      title: d.title,
      line1: `${NK.v.siteName(d.siteName)} · ${NK.v.engName(d.engineer)} 尚未更新进展`,
      line2: `已等待 ${wait} 无新进展`,
      line3: longWait ? '建议立即催一次' : '建议跟进一下进展',
      actionBtn: '催一下',
      actionAct: `NK.quickRemind('${d.id}')`,
    });
  });

  // ── 4. 跟进中/处理中派单2h以上无更新记录 ──────────────────
  NK.db.dispatches.forEach(d => {
    if (!['跟进中', '处理中'].includes(d.status)) return;
    const lastUpdate = d.updatedAt;
    if (!lastUpdate) return;
    const ms = now - new Date(lastUpdate).getTime();
    if (ms < 2 * 3600000) return; // 不到2小时
    const wait = NK.humanDur(ms);
    const lastFb = d.latestFeedback || '暂无进展记录';
    add({
      id: 'd-fb-' + d.id,
      type: 'dispatch',
      itemId: d.id,
      tag: '待跟进',
      tagLevel: 'warn',
      title: d.title,
      line1: `${NK.v.engName(d.engineer)} 处理中，最新进展：${lastFb.slice(0, 20)}${lastFb.length > 20 ? '…' : ''}`,
      line2: `${wait} 没有新进展记录`,
      line3: '建议主动问一次进度',
      actionBtn: '问进度',
      actionAct: `NK.quickRemind('${d.id}')`,
    });
  });

  // ── 5. 等待外部条件派单（可提醒花姐确认是否解除）─────────
  NK.db.dispatches.forEach(d => {
    if (d.status !== '等待外部条件') return;
    const wait = NK.humanDur(now - new Date(d.updatedAt).getTime());
    add({
      id: 'd-wait-' + d.id,
      type: 'dispatch',
      itemId: d.id,
      tag: '等待外部条件',
      tagLevel: 'warn',
      title: d.title,
      line1: `${NK.v.siteName(d.siteName)} · ${NK.v.engName(d.engineer)}`,
      line2: `已等待 ${wait}，当前卡点：${d.nextAction || '等待外部条件'}`,
      line3: '确认条件是否已解除',
      actionBtn: '更新状态',
      actionAct: `UI.dispatchDetail('${d.id}')`,
    });
  });

  // ── 6. 等花姐验收的派单 ──────────────────────────────────
  NK.db.dispatches.forEach(d => {
    if (d.status !== '待花姐验收') return;
    const ms = now - new Date(d.feedbackAt || d.updatedAt).getTime();
    const wait = ms > 0 ? NK.humanDur(ms) : '刚刚';
    const sub = d.result || '处理结果已记录，等待花姐验收';
    add({
      id: 'd-acc-' + d.id,
      type: 'dispatch',
      itemId: d.id,
      tag: '待验收',
      tagLevel: 'accent',
      title: d.title,
      line1: `${NK.v.siteName(d.siteName)} · ${NK.v.engName(d.engineer)}`,
      line2: sub.slice(0, 40) + (sub.length > 40 ? '…' : ''),
      line3: `等待花姐验收 ${wait}`,
      actionBtn: '立即验收',
      actionAct: `UI.dispatchDetail('${d.id}')`,
    });
  });

  // ── 7. 24小时内到期的任务 ─────────────────────────────────
  NK.db.tasks.forEach(t => {
    if (t.status === '已完成') return;
    if (!t.dueDate || NK.daysBetween(today, t.dueDate) > 1) return;
    if (usedIds.has('t-p1-' + t.id) || usedIds.has('t-ov-' + t.id)) return;
    const rem = NK.humanDur(new Date(t.dueDate + 'T23:59:59').getTime() - now);
    const remaining = NK.remainText(t.dueDate, t.dueTime);
    add({
      id: 't-due-' + t.id,
      type: 'task',
      itemId: t.id,
      tag: '即将到期',
      tagLevel: 'warn',
      title: t.name,
      line1: `${NK.v.siteName(t.siteName) || '—'} · ${NK.v.engName(t.engineer) || '—'}`,
      line2: `截止 ${t.dueDate}，${remaining}`,
      line3: '建议今天优先完成',
      actionBtn: '查看进度',
      actionAct: `UI.taskDetail('${t.id}')`,
    });
  });

  // ── 8. 专项三天以上无更新 ─────────────────────────────────
  NK.db.projects.forEach(p => {
    if (!['进行中', '有风险'].includes(p.status)) return;
    const days = NK.daysBetween(p.updatedAt.slice(0, 10), today);
    if (days < 3) return;
    add({
      id: 'p-stale-' + p.id,
      type: 'project',
      itemId: p.id,
      tag: '久未更新',
      tagLevel: 'warn',
      title: p.name,
      line1: `${p.type || '专项'} · 进度 ${p.progress}% · ${p.status}`,
      line2: `已 ${days} 天没有任何更新`,
      line3: '建议主动跟进一次',
      actionBtn: '查看专项',
      actionAct: `UI.projectDetail('${p.id}')`,
    });
  });

  // ── 9. 专项超期或有风险 ──────────────────────────────────
  NK.db.projects.forEach(p => {
    if (!p.dueDate || today <= p.dueDate) return;
    if (usedIds.has('p-stale-' + p.id)) return;
    add({
      id: 'p-due-' + p.id,
      type: 'project',
      itemId: p.id,
      tag: p.status === '有风险' ? '已超期' : '已超期',
      tagLevel: 'danger',
      title: p.name,
      line1: `${p.type || '专项'} · 进度 ${p.progress}%`,
      line2: `截止 ${p.dueDate}，已超时`,
      line3: '需要立即跟进',
      actionBtn: '查看专项',
      actionAct: `UI.projectDetail('${p.id}')`,
    });
  });

  return items.slice(0, 3);
};

/** 快速催办派单（生成催办消息并复制到剪贴板） */
NK.quickRemind = async (dispatchId) => {
  const d = NK.getDispatch(dispatchId);
  if (!d) return;
  const msg = NK.urgent(d);
  try { await UI.copy(msg); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = msg; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove();
  }
  NK.save();
  UI.toast('花姐，催办内容已复制到剪贴板，发出去后我会记住这次催办时间', 'warn');
};

/* ============================================================
   交接
   ============================================================ */
/** 生成交接内容 */
NK.genHandover = (startDate, endDate, opts) => {
  opts = opts || {};
  const today = NK.today();
  const s = startDate || today, e = endDate || today;
  const sec = { daily: [], dispatching: [], dispatchingDue: [], waitingFeedback: [], waitingAccept: [], overdue: [], projects: [], tomorrow: [], risks: [] };
  // 日常固定工作
  NK.db.handoverTemplates.forEach(t => {
    if ((t.frequency || '').includes('每日')) {
      sec.daily.push({ name: t.name, requirement: t.requirement, priority: t.priority });
    }
  });
  // 派单
  NK.db.dispatches.forEach(d => {
    if (d.status === '已闭环' || d.status === '已取消') return;
    if (d.planDone && d.planDone >= s && d.planDone <= e) sec.dispatchingDue.push(d);
    else if (d.status !== '已闭环') sec.dispatching.push(d);
    if (['跟进中','处理中'].includes(d.status)) sec.waitingFeedback.push(d);
    if (d.status === '待花姐验收') sec.waitingAccept.push(d);
    if (d.planDone && NK.today() > d.planDone && d.status !== '已闭环') sec.overdue.push(d);
  });
  // 任务
  NK.db.tasks.forEach(t => {
    if (t.status === '已完成') return;
    if (t.dueDate && t.dueDate >= s && t.dueDate <= e && !sec.dispatchingDue.find(x => x.id === t.dispatchId)) {
      sec.dispatchingDue.push(t);
    }
    if (t.dueDate && NK.today() > t.dueDate && t.status !== '已完成') sec.overdue.push(t);
    if (t.status === '待反馈') sec.waitingFeedback.push(t);
    if (t.status === '待验收') sec.waitingAccept.push(t);
  });
  // 专项
  NK.db.projects.forEach(p => {
    if (p.status === '已完成' || p.status === '已取消') return;
    sec.projects.push(p);
    if (p.status === '有风险' || (p.dueDate && NK.today() > p.dueDate)) sec.risks.push({ name: p.name, note: p.risk || '已超期或存在风险' });
  });
  if (opts.includeToday) {
    sec.doneToday = NK.db.tasks.filter(t => t.doneAt && t.doneAt.slice(0, 10) === today);
  }
  const text = NK.renderHandoverText(sec, { s, e, includeToday: opts.includeToday });
  return { sec, text, start: s, end: e };
};

NK.renderHandoverText = (sec, meta) => {
  const L = [];
  const line = (t) => L.push(t);
  line(`══════ IT运维休假交接清单 ══════`);
  line(`交接时段：${meta.s} 至 ${meta.e}   生成时间：${NK.fmtDT(new Date())}`);
  line('');
  if (sec.doneToday && sec.doneToday.length) {
    line(`【今日已完成】`);
    sec.doneToday.forEach(t => line(`  ✓ ${t.name}`));
    line('');
  }
  line(`【休假期间每日固定工作】`);
  sec.daily.forEach(t => line(`  • [${t.priority}] ${t.name} — ${t.requirement || ''}`));
  line('');
  line(`【休假期间将到期的派单/任务】`);
  if (!sec.dispatchingDue.length) line(`  （无）`);
  sec.dispatchingDue.forEach(d => line(`  • [${d.priority}] ${d.no || ''} ${d.title || d.name} 截止${d.planDone || d.dueDate || '—'} 工程师:${d.engineer || d.engineer || '—'}`));
  line('');
  line(`【进行中的派单】`);
  if (!sec.dispatching.length) line(`  （无）`);
  sec.dispatching.forEach(d => line(`  • [${d.priority}] ${d.no} ${d.title} 状态:${d.status} 负责工程师:${d.engineer || '—'} 最新进展:${d.latestFeedback || '无'}`));
  line('');
  line(`【等待花姐跟进】`);
  if (!sec.waitingFeedback.length) line(`  （无）`);
  sec.waitingFeedback.forEach(d => line(`  • ${d.no || d.id} ${d.title || d.name} 状态:${d.status}`));
  line('');
  line(`【等待花姐验收】`);
  if (!sec.waitingAccept.length) line(`  （无）`);
  sec.waitingAccept.forEach(d => line(`  • ${d.no || d.id} ${d.title || d.name}`));
  line('');
  line(`【已超时】`);
  if (!sec.overdue.length) line(`  （无）`);
  sec.overdue.forEach(d => line(`  • ${d.no || d.id} ${d.title || d.name}`));
  line('');
  line(`【进行中的专项】`);
  if (!sec.projects.length) line(`  （无）`);
  sec.projects.forEach(p => line(`  • ${p.name}（${p.status}，完成率${p.progress}%，${p.nextAction ? '下一步：' + p.nextAction : ''}）`));
  line('');
  line(`【风险与注意事项】`);
  if (!sec.risks.length) line(`  （无特别风险）`);
  sec.risks.forEach(r => line(`  ⚠ ${r.name}: ${r.note}`));
  line('');
  line(`请接手人按上述清单逐项确认，遇到问题联系 花姐 或对应工程师。`);
  line(`──── 由 卢女开·IT运维指挥台 自动生成 ────`);
  return L.join('\n');
};

/* ============================================================
   脱敏（作品演示模式）
   ============================================================ */
const FAKE_NAMES = ['陈思远', '林晓峰', '周子昂', '吴雨桐', '郑凯文', '许嘉怡', '何俊杰', '罗文博', '苏婉婷'];
NK.mask = (phone) => {
  if (!phone) return '***';
  const s = String(phone).replace(/\s/g, '');
  if (s.length < 7) return s.slice(0, 1) + '***' + s.slice(-1);
  return s.slice(0, 3) + '****' + s.slice(-4);
};
NK.fakeEngineer = (name) => {
  const i = (NK.db.engineers.findIndex(e => e.name === name) + 10) % FAKE_NAMES.length;
  return FAKE_NAMES[i];
};
NK.maskAddress = (addr) => {
  if (!addr) return '';
  if (addr.length <= 6) return addr.slice(0, 2) + '···';
  return addr.slice(0, 6) + '…（地址已脱敏）';
};
/** 脱敏后的展示对象 */
NK.v = {
  engName(name) { return NK.mode === 'demo' ? NK.fakeEngineer(name) : name; },
  phone(p) { return NK.mode === 'demo' ? NK.mask(p) : p; },
  address(a) { return NK.mode === 'demo' ? NK.maskAddress(a) : a; },
  siteName(s) {
    if (NK.mode !== 'demo') return s;
    return String(s).replace(/中宏/g, '某某').replace(/保险/g, '企业');
  },
  site(site) {
    return {
      ...site,
      name: NK.v.siteName(site.name),
      address: NK.v.address(site.address),
      contactPhone: NK.v.phone(site.contactPhone),
      defaultEngineer: NK.v.engName(site.defaultEngineer),
    };
  },
  dispatch(d) {
    return { ...d, siteName: NK.v.siteName(d.siteName), address: NK.v.address(d.address), contactPhone: NK.v.phone(d.contactPhone), engineer: NK.v.engName(d.engineer) };
  },
  task(t) {
    return { ...t, siteName: NK.v.siteName(t.siteName), engineer: NK.v.engName(t.engineer) };
  },
  eng(e) {
    return { ...e, name: NK.v.engName(e.name), phone: NK.v.phone(e.phone), onsiteRaw: e.onsiteRaw, remoteRaw: e.remoteRaw };
  },
};

/* ============================================================
   花姐助手 - 意图识别
   ============================================================ */
NK.assistantReply = (q) => {
  q = (q || '').trim();
  const r = [];
  // 今日概览
  if (/今天|今日|现在|概览|情况/.test(q)) {
    const rem = NK.genReminders();
    const urgent = rem.filter(x => x.level === 'danger');
    const disps = NK.db.dispatches;
    r.push(`花姐，今天共 ${rem.length} 项提醒：P1/超时 ${urgent.length} 项、已生成待发送 ${disps.filter(d => d.status === '已生成').length} 项、待验收 ${disps.filter(d => d.status === '待花姐验收').length} 项。`);
    if (urgent.length) r.push(`优先级最高的：${urgent.slice(0, 3).map(u => u.title + '·' + u.content).join('；')}，花姐优先处理一下 👀`);
    else r.push('花姐，今天没有超时事项 ✨ 运维节奏良好，继续保持～');
  }
  // 谁负责某城市
  const cityM = q.match(/([\u4e00-\u9fa5]{2,4})谁负责|([\u4e00-\u9fa5]{2,4})负责|([\u4e00-\u9fa5]{2,4})工程师|([\u4e00-\u9fa5]{2,4})职场/);
  if (cityM) {
    const city = cityM[1] || cityM[2] || cityM[3] || cityM[4];
    const sites = NK.sitesByCity(city);
    if (sites.length) {
      sites.forEach(s => {
        const eng = NK.getEngineer(s.defaultEngineer);
        r.push(`【${NK.v.siteName(s.name)}】${s.city}：联系人 ${s.contactName} ${NK.v.phone(s.contactPhone)}，默认工程师 ${NK.v.engName(s.defaultEngineer)}（${s.supportType}${s.needDispatch ? '，需派单' : '，无需派单'}）。${NK.v.address(s.address)}`);
      });
    } else {
      r.push(`没有找到"${city}"的职场资料，花姐可以试试输入城市或职场简称～`);
    }
  }
  // 超时
  if (/超时|逾期|风险/.test(q)) {
    const rem = NK.genReminders().filter(x => x.level === 'danger');
    if (rem.length) r.push(`花姐，当前有 ${rem.length} 项超时/风险事项，需要优先处理：\n` + rem.map(x => `• ${x.title}：${x.content}`).join('\n'));
    else r.push('花姐，当前没有超时事项 ✨ 一切正常～');
  }
  // 待办
  if (/待办|待确认|待验收|要做什么/.test(q)) {
    const disps = NK.db.dispatches.filter(d => d.status === '已生成');
    const acc = NK.db.dispatches.filter(d => d.status === '待花姐验收');
    r.push(`花姐，当前有这些待处理事项：\n已生成待发送 ${disps.length} 项：${disps.slice(0, 5).map(d => `${d.no} ${d.title}`).join('；') || '无'}。\n待验收 ${acc.length} 项：${acc.slice(0, 5).map(d => `${d.no} ${d.title}`).join('；') || '无'}。`);
    if (!disps.length && !acc.length) r.push('花姐，今天的待办都处理完啦 ✨');
  }
  // 派单创建指引
  if (/派单|湖州|打印机|故障/.test(q) && !cityM) {
    r.push(`创建派单很简单 ✨ 花姐只需两步：① 点击首页「＋ 新建派单」；② 输入区域（如"湖州"）+ 原因，系统自动填充联系人、工程师等信息，确认后即可生成派单消息。`);
  }
  // KPI
  if (/KPI|绩效|得分/.test(q)) {
    const month = NK.curMonth();
    const rows = NK.db.engineers.map(e => { const k = NK.computeKpi(e.name, month); return { name: e.name, score: k.final }; });
    rows.sort((a, b) => b.score - a.score);
    r.push(`本月（${month}）KPI 概览：\n` + rows.map(x => `• ${NK.v.engName(x.name)}：${x.score} 分`).join('\n'));
  }
  if (!r.length) {
    r.push('花姐，我没太理解你的意思 😅 可以试试：\n· "湖州谁负责"\n· "今天有什么超时"\n· "有哪些待办"\n· "本月KPI怎么样"\n也可以直接点击首页的快捷入口操作～');
  }
  return r;
};

/* ============================================================
   固定任务迁移（幂等）
   只在首次升级 / 模板调整时执行：把旧存档里的固定任务、旧演示数据
   一次性收敛到 9 项白名单，并清理旧预置/测试/演示任务，绝不误删
   花姐手动新增的真实数据。可安全重复调用。
   ============================================================ */
NK.migrateFixedTasks = () => {
  const whitelistIds = NK.FIXED_TASKS.map(t => t.id);   // 9 项白名单
  const oldTemplateIds = NK.db.handoverTemplates || [];

  /* 1) 固定任务模板升级为 9 项白名单 */
  NK.db.handoverTemplates = NK.FIXED_TASKS.slice();

  /* 2) 清理旧演示派单（种子演示数据标题精确匹配）及其关联任务 */
  const demoDispatchTitles = ['湖州打印机故障处理', '南京职场网络异常排查', '北京东方广场用户新机部署'];
  const demoDispatchIds = new Set();
  NK.db.dispatches = (NK.db.dispatches || []).filter(d => {
    if (demoDispatchTitles.includes(d.title)) { demoDispatchIds.add(d.id); return false; }
    return true;
  });

  /* 3) 清理演示专项（Q3季度巡检 / Windows补丁更新）及其子任务 */
  const demoProjectIds = new Set();
  const demoProjectNames = ['2026年Q3季度巡检', 'Windows 6月补丁更新', 'Q3季度巡检', '6月补丁更新'];
  NK.db.projects = (NK.db.projects || []).filter(p => {
    if (demoProjectNames.includes(p.name)) { demoProjectIds.add(p.id); return false; }
    return true;
  });
  NK.db.projectTasks = (NK.db.projectTasks || []).filter(pt => !demoProjectIds.has(pt.projectId));

  /* 4) 清理旧模板生成的日常任务：
         - 模板不在白名单（旧 TPL007/008/009/010/012/013 等）
         - 或 source === '日常模板'（旧日常任务体系）
         - 或引用已删除的演示派单/专项 */
  NK.db.tasks = (NK.db.tasks || []).filter(t => {
    if (t.source === '日常模板') return false;
    if (t.source === '系统固定任务' && t.templateId && !whitelistIds.includes(t.templateId)) return false;
    if (oldTemplateIds.some(ot => ot.id === t.templateId) && !whitelistIds.includes(t.templateId)) return false;
    if (t.dispatchId && demoDispatchIds.has(t.dispatchId)) return false;
    if (t.projectId && demoProjectIds.has(t.projectId)) return false;
    return true;
  });

  /* 5) 清理 source='演示数据' 的 KPI 事件（保留花姐人工登记/系统自动事件） */
  NK.db.kpiEvents = (NK.db.kpiEvents || []).filter(ev => ev.source !== '演示数据');

  /* 6) 已完成的旧固定任务（白名单模板）标记为历史归档，不再出现在今日工作流 */
  NK.db.tasks.forEach(t => {
    if (t.source === '系统固定任务' && t.templateId && whitelistIds.includes(t.templateId)) {
      // 为白名单任务补齐 fixedDate / fixedYM 字段以便按日/月去重
      if (!t.fixedDate && !t.fixedYM) {
        const tpl = NK.FIXED_TASKS.find(x => x.id === t.templateId);
        if (tpl && ['每日', '每日14:30', '每日下班前'].includes(tpl.frequency)) t.fixedDate = t.createdAt.slice(0, 10);
        if (tpl && ['每月', '月报完成后'].includes(tpl.frequency)) t.fixedYM = t.createdAt.slice(0, 7);
      }
    }
  });

  NK.db.fixedMigrated = true;
  NK.save();
};
