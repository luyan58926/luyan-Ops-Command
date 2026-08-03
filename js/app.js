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
// 派单状态：花姐单人使用，工程师通过外部渠道沟通，不在系统内确认或反馈。
// 正常流程只有三态：待发送 → 已发送 → 已完成；旁路两态：异常待处理、已撤销；草稿为创建前辅助态。
// 数据字段统一使用英文枚举：draft | pending_send | sent | exception | completed | revoked
NK.DISPATCH_STATUS = [
  '草稿', '待发送', '已发送', '已完成', '异常待处理', '已撤销',
];
// 中文显示映射
NK.DISPATCH_STATUS_LABEL = {
  draft: '草稿',
  pending_send: '待发送',
  sent: '已发送',
  exception: '异常待处理',
  completed: '已完成',
  revoked: '已撤销',
};
// 中文状态 → 英文枚举（含旧状态迁移映射）
NK.DISPATCH_STATUS_KEY = {
  '草稿': 'draft',
  '待发送': 'pending_send',
  '已发送': 'sent',
  '已完成': 'completed',
  '异常待处理': 'exception',
  '已撤销': 'revoked',
  // 旧九步状态迁移
  '已生成': 'pending_send',
  '跟进中': 'sent',
  '处理中': 'sent',
  '等待外部条件': 'exception',
  '已处理': 'completed',
  '待花姐验收': 'sent',       // 不自动判完成，转待发送后提示确认
  '已闭环': 'completed',
};
NK.DISPATCH_EXTRA = ['已取消', '已暂停', '升级处理', '无需派单', '已撤销'];
NK.DISPATCH_RECORD_STATUS = ['正常', '已删除'];
NK.TASK_STATUS = ['待处理', '已分配', '处理中', '待反馈', '待验收', '已完成'];
NK.TASK_TYPES = ['派单', '故障', '用户请求', '日常检查', '安全告警', '专项子任务', '临时任务'];
NK.PROJECT_STATUS = ['未开始', '进行中', '有风险', '等待反馈', '等待验收', '已完成', '已暂停', '已取消'];
NK.PROJECT_TYPES = ['季度巡检', 'Windows补丁更新', 'DLP修复', '职场搬迁', '职场撤场', '资产盘点', '安全整改', '新系统上线', '设备升级', '临时专项'];
NK.SITE_STATUS = ['正常', '计划搬迁', '搬迁中', '计划撤场', '已撤场', '暂停服务'];

/* ---------- 供应商（现场上门派单） ---------- */
// 固定供应商：源晨、亚北。不可自由新增，不做复杂供应商管理页面。
NK.SUPPLIERS = [
  { id: 'yuanchen', name: '源晨' },
  { id: 'yabei', name: '亚北' },
];
NK.SUPPLIER_MAP = NK.SUPPLIERS.reduce((m, s) => { m[s.id] = s; m[s.name] = s; return m; }, {});
/** 校验供应商 id/名称是否为固定供应商之一；合法返回 {id,name}，否则返回 null */
NK.normSupplier = (v) => {
  if (!v) return null;
  const s = NK.SUPPLIER_MAP[v] || null;
  return s ? { id: s.id, name: s.name } : null;
};
/** 供应商 id → 名称；未标注/无效返回 '未标注' */
NK.supplierName = (id) => {
  if (!id) return '未标注';
  const s = NK.SUPPLIER_MAP[id];
  return s ? s.name : '未标注';
};
/** 共享的供应商过滤：派单中心与花姐助手必须使用同一套逻辑，保证数量一致。
 *  rule: supplier 空/全部 → 全部；'未标注' → 无 supplierId 的派单；否则 → 匹配指定 id/名称。 */
NK.filterBySupplier = (list, supplier) => {
  const s = (supplier || '').trim();
  if (!s || s === '全部' || s === '全部供应商') return list;
  if (s === '未标注') return list.filter(d => !NK.getSupplierOf(d));
  const ns = NK.normSupplier(s);
  if (!ns) return list;
  return list.filter(d => {
    const cur = NK.getSupplierOf(d);
    return cur && cur.id === ns.id;
  });
};
/** 读取派单当前供应商（兼容数据可能只存 id 或只存 name 的情况） */
NK.getSupplierOf = (d) => {
  if (!d) return null;
  if (d.supplierId) { const s = NK.SUPPLIER_MAP[d.supplierId]; if (s) return s; }
  if (d.supplierName) { const s = NK.SUPPLIER_MAP[d.supplierName]; if (s) return s; }
  return null;
};
/** 派单供应商显示名称：有→固定供应商名；无→未标注 */
NK.dispatchSupplierLabel = (d) => {
  const s = NK.getSupplierOf(d);
  return s ? s.name : '未标注';
};

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
  { id: 'TPL005', name: 'HP打印机耗材邮件检查（Outlook）', category: '日常工作', type: '日常检查', frequency: '每日', requirement: '查看Outlook中是否收到HP打印机耗材提醒邮件。', priority: 'P3', trigger: '', fixedTime: '每日' },
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
    NK.db.assistantOps = NK.db.assistantOps || [];
    NK.mode = saved.mode === 'demo' ? 'demo' : 'work';
    NK.migrateFixedTasks();   // 固定任务升级 + 清理旧演示/预置数据（幂等）
    NK.migrateDispatchTaskSync(); // 派单关联任务同步（去重 + 状态对齐，幂等）
    NK.migrateConsumableReminder(); // HP耗材提醒 → 每日邮件检查（幂等）
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
    templates: [{ id: 'TPL_MSG', name: '默认派单消息', active: true, content: '【{职场}现场支持派单】\n供应商：{供应商}\n处理事项：{事项}\n优先级：{优先级}\n职场联系人：{联系人}\n联系电话：{电话}\n详细地址：{地址}\n负责工程师：{工程师}\n计划到场时间：{到场时间}\n期望完成时间：{完成时间}\n\n请收到后及时确认。\n到场后请反馈到场情况，处理完成后反馈处理结果。\n如涉及设备、资产、网络线路或现场变更，请同时提供相关信息及现场照片。' }],
    // 运行时数据
    tasks: [], dispatches: [], projects: [], projectTasks: [],
    taskUpdates: [], kpiEvents: [], customerRatings: [], reminders: [], handovers: [],
    quickNotes: [], leaves: [], assistantOps: [],
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

/* ============================================================
   工程师休假记录（LeaveRecord）
   只记录休假 + 是否需补位，不开发考勤/审批/申请。
   ============================================================ */
NK.LEAVE_PERIODS = ['全天', '上午', '下午'];
NK.LEAVE_DISPATCH_STATUS = ['未判断', '无需派单', '待创建派单', '已创建派单', '已取消'];
NK.LEAVE_RECORD_STATUS = ['有效', '已取消', '已归档'];
NK.getLeave = (id) => NK.db.leaves.find(l => l.leaveId === id);
NK.leavesByEngineer = (name) => NK.db.leaves.filter(l => l.engineerName === name && l.recordStatus !== '已归档');

/**
 * 创建休假记录。data: {engineerId, startDate, endDate, leavePeriod, remark, dispatchRequired}
 * 保留负责职场快照，避免日后区域变化导致历史记录失真。
 */
NK.createLeave = (data) => {
  const eng = NK.db.engineers.find(e => e.id === data.engineerId) || NK.getEngineer(data.engineerName);
  if (!eng) return null;
  const sites = NK.sitesByEngineer(eng.name);
  const record = {
    leaveId: NK.uid('L'),
    engineerId: eng.id,
    engineerName: eng.name,
    startDate: data.startDate,
    endDate: data.endDate || data.startDate,
    leavePeriod: data.leavePeriod || '全天',
    remark: data.remark || '',
    dispatchRequired: data.dispatchRequired || '否',       // 是 / 否
    dispatchStatus: data.dispatchStatus || (data.dispatchRequired === '是' ? '待创建派单' : '无需派单'),
    relatedDispatchId: data.relatedDispatchId || '',
    responsibleSitesSnapshot: sites.map(s => ({
      siteId: s.id, siteName: s.name, city: s.city,
      supportType: s.supportType || '远程', contactName: s.contactName || '',
      defaultEngineer: s.defaultEngineer || '',
    })),
    createdAt: NK.now(),
    updatedAt: NK.now(),
    cancelledAt: '',
    recordStatus: '有效',
  };
  NK.db.leaves.push(record);
  NK.save();
  return record;
};

/** 编辑休假（软更新，保留快照与关联派单） */
NK.updateLeave = (id, patch) => {
  const l = NK.getLeave(id);
  if (!l || l.recordStatus !== '有效') return null;
  if (patch.startDate) l.startDate = patch.startDate;
  if (patch.endDate) l.endDate = patch.endDate;
  if (patch.leavePeriod) l.leavePeriod = patch.leavePeriod;
  if (patch.remark !== undefined) l.remark = patch.remark;
  // 若快照缺失或工程师负责职场变化，补快照
  if (!l.responsibleSitesSnapshot || !l.responsibleSitesSnapshot.length) {
    const sites = NK.sitesByEngineer(l.engineerName);
    l.responsibleSitesSnapshot = sites.map(s => ({
      siteId: s.id, siteName: s.name, city: s.city,
      supportType: s.supportType || '远程', contactName: s.contactName || '',
      defaultEngineer: s.defaultEngineer || '',
    }));
  }
  l.updatedAt = NK.now();
  NK.save();
  return l;
};

/** 取消休假（软删除，不删历史、不自动删关联派单） */
NK.cancelLeave = (id) => {
  const l = NK.getLeave(id);
  if (!l) return null;
  l.recordStatus = '已取消';
  l.cancelledAt = NK.now();
  l.updatedAt = NK.now();
  NK.save();
  return l;
};

/** 休假补位派单创建成功后，将派单关联到休假记录 */
NK.linkLeaveDispatch = (leaveId, dispatchId) => {
  const l = NK.getLeave(leaveId);
  if (!l) return null;
  const d = NK.getDispatch(dispatchId);
  l.relatedDispatchId = dispatchId;
  l.dispatchStatus = d ? '已创建派单' : '待创建派单';
  if (d) l.relatedDispatchNo = d.no;
  l.updatedAt = NK.now();
  NK.save();
  return l;
};

/** 计算某条休假记录覆盖的自然日集合（YYYY-MM-DD 数组） */
NK.leaveDates = (l) => {
  const out = [];
  const d = new Date(l.startDate + 'T00:00:00');
  const end = new Date(l.endDate + 'T00:00:00');
  if (isNaN(d) || isNaN(end)) return out;
  while (d <= end) {
    out.push(NK.fmtDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
};

/** 某天（YYYY-MM-DD）正在休假的有效记录。
 *  半天休假（上午/下午）：该天也算在休（首页按"该工程师当天在休"处理）。 */
NK.leavesOnDate = (dateStr) =>
  NK.db.leaves.filter(l =>
    l.recordStatus === '有效' &&
    l.startDate <= dateStr && dateStr <= l.endDate);

/** 今天 / 明天休假的记录 */
NK.leavesToday = () => NK.leavesOnDate(NK.today());
NK.leavesTomorrow = () => NK.leavesOnDate(NK.fmtDate(new Date(Date.now() + 86400000)));

/**
 * 休假建议（只给建议，不替花姐决定）。
 * 返回 string[] 建议列表。
 */
NK.leaveSuggestions = (eng, startDate, endDate, period) => {
  const tips = [];
  if (!eng) return tips;
  const days = NK.daysBetween(startDate, endDate) + 1;
  const isOnsite = (eng.onsiteRegions || []).length > 0;
  // 驻场工程师缺口
  if (isOnsite) {
    tips.push('该工程师休假期间可能出现现场支持缺口，请确认是否需要派单。');
  }
  // 连续休假阈值（可在系统设置修改）
  const threshold = NK.db.leaveRules && NK.db.leaveRules.continuousDays ? NK.db.leaveRules.continuousDays : 2;
  if (days >= threshold) {
    tips.push(`本次连续休假 ${days} 天，建议确认补位安排。`);
  }
  // 半天休假
  if (period === '上午' || period === '下午') {
    tips.push('本次为半天休假，预计影响相对较小，请根据现场安排判断。');
  }
  // 同一职场已有其他覆盖工程师
  const sites = NK.sitesByEngineer(eng.name);
  if (sites.length) {
    const covered = sites.some(s => s.defaultEngineer && s.defaultEngineer !== eng.name);
    if (covered) tips.push('该职场已有其他工程师覆盖，可能无需额外派单。');
  }
  // 多人休假重叠
  const overlap = NK.db.leaves.filter(l =>
    l.recordStatus === '有效' && l.engineerName !== eng.name &&
    l.startDate <= endDate && l.endDate >= startDate);
  if (overlap.length >= 1) {
    tips.push(`该时间段已有 ${overlap.length + 1} 名工程师休假，请留意区域支持能力。`);
  }
  return tips;
};

/**
 * 某工程师某月因休假应排除的"工作日"天数（用于 KPI 工单量扣分排除）。
 * 只统计"全天"休假的天；半天休假不纳入工单量排除（影响较小）。
 * 返回数字（排除后该月标准工作量天数相应减少）。
 */
NK.leaveWorkdaysExcluded = (engineerName, month) => {
  const leaves = NK.db.leaves.filter(l =>
    l.recordStatus === '有效' && l.engineerName === engineerName &&
    l.leavePeriod === '全天' && l.startDate.slice(0, 7) <= month && l.endDate.slice(0, 7) >= month);
  let days = 0;
  leaves.forEach(l => {
    NK.leaveDates(l).forEach(d => {
      if (d.slice(0, 7) === month) {
        const dow = new Date(d + 'T00:00:00').getDay();
        if (dow !== 0 && dow !== 6) days++;   // 只扣工作日
      }
    });
  });
  return days;
};

/** 工程师是否有进行中的补位派单（关联且未闭环） */
NK.engineerHasActiveCoverDispatch = (engineerName) =>
  NK.db.leaves.some(l =>
    l.recordStatus === '有效' && l.engineerName === engineerName &&
    l.relatedDispatchId &&
    ['已创建派单'].includes(l.dispatchStatus) &&
    (() => { const d = NK.getDispatch(l.relatedDispatchId); return d && !NK.dispatchInactive(d) && NK.dispatchStatusKey(d) !== 'completed'; })());

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
    if (NK.dispatchInactive(d)) return; // 已撤销/已取消/已删除派单不作为当前有效工作
    if (`${d.no} ${d.title} ${d.siteCity} ${d.siteName} ${d.engineer} ${d.contactName} ${d.workNo || ''}`.toLowerCase().includes(q))
      out.dispatches.push(d);
  });
  NK.db.tasks.forEach(t => {
    if (!NK.taskActive(t)) return; // 已取消/已删除或关联派单已失效的任务不作为当前有效工作
    if (`${t.no} ${t.name} ${t.type} ${t.siteCity} ${t.engineer} ${t.workNo || ''}`.toLowerCase().includes(q))
      out.tasks.push(t);
  });
  return out;
};

/* ============================================================
   派单
   ============================================================ */
// 新派单状态（英文枚举，数据库字段值）。正常三态 + 旁路两态 + 草稿。
NK.DISPATCH_FLOW = ['draft', 'pending_send', 'sent', 'exception', 'completed', 'revoked'];
/** 取派单当前状态的英文枚举值：兼容旧中文状态数据（自动迁移） */
NK.dispatchStatusKey = (d) => {
  if (!d || !d.status) return '';
  if (NK.DISPATCH_STATUS_KEY[d.status]) return NK.DISPATCH_STATUS_KEY[d.status];
  return d.status; // 已经是英文枚举则原样返回
};
/** 取派单当前状态的中文显示名（历史/未知状态回退为原值） */
NK.dispatchStatusLabel = (d) => {
  if (!d || !d.status) return '未标注';
  if (NK.DISPATCH_STATUS_LABEL[d.status]) return NK.DISPATCH_STATUS_LABEL[d.status];
  if (NK.DISPATCH_STATUS_KEY[d.status]) return NK.DISPATCH_STATUS_LABEL[NK.DISPATCH_STATUS_KEY[d.status]];
  return d.status;
};
/** 是否草稿（创建前辅助态，不进入正式流程） */
NK.isDraft = (d) => NK.dispatchStatusKey(d) === 'draft';
/** 是否已撤销/已软删除（退出一切正常跟进、催办、告警、统计、交接） */
NK.dispatchInactive = (d) => !d || d.recordStatus === '已删除' || NK.dispatchStatusKey(d) === 'revoked' || d.status === '已取消';
/** 是否仍在正式推进流程（非已完成/撤销/取消/删除/草稿）。草稿未正式生成，不算推进中。 */
NK.dispatchActive = (d) => !NK.dispatchInactive(d) && !NK.isDraft(d) && NK.dispatchStatusKey(d) !== 'completed';

/**
 * 取一条派单关联任务的派单。优先按 dispatchId，其次按 sourceId/sourceType。
 */
NK.dispatchOfTask = (t) => {
  if (!t) return null;
  const id = t.dispatchId || (t.sourceType === 'dispatch' ? t.sourceId : '');
  return id ? NK.getDispatch(id) : null;
};

/** 取一个派单关联的任务（一个派单至多一条任务）。优先按 taskId，其次按 sourceId/dispatchId 查找。 */
NK.taskOfDispatch = (d) => {
  if (!d) return null;
  if (d.taskId) {
    const t = NK.getTask(d.taskId);
    if (t) return t;
  }
  return NK.db.tasks.find(x => (x.sourceType === 'dispatch' && x.sourceId === d.id) || x.dispatchId === d.id) || null;
};

/**
 * 是否"当前有效任务"（核心统一规则）。
 * 一个任务只有在满足以下条件时才属于当前工作，进入默认列表/时间轴/重点/告警/统计/交接/助手查询：
 *   1. 任务本身未取消、未删除；
 *   2. 若任务关联派单（dispatchId/sourceType=dispatch），对应派单必须是有效状态
 *      —— 已撤销/已取消/已删除（软删除）的派单，其关联任务一律不作为当前有效工作。
 * 历史记录保留在数据库，仅从"当前有效工作"中隐藏。
 */
NK.taskActive = (t) => {
  if (!t) return false;
  if (t.recordStatus === '已删除' || t.status === '已取消' || t.status === '已删除') return false;
  const d = NK.dispatchOfTask(t);
  if (d) {
    // 关联派单已撤销/取消/删除（软删除）→ 任务不作为当前有效工作
    if (NK.dispatchInactive(d)) return false;
  }
  return true;
};
/** 历史/非当前有效任务（取消、删除，或关联派单已失效）——仍可在历史/回收站查看 */
NK.taskInactive = (t) => !NK.taskActive(t);

/**
 * 创建派单（核心：一次操作完成多项工作）
 * 自动：保存派单 + 创建关联任务 + 分配工程师 + 生成派单消息（花姐复制发送）
 */
NK.createDispatch = (data) => {
  const site = data.siteId ? NK.getSite(data.siteId) : null;
  const no = NK.nextNo('dispatch');
  const nowIso = NK.now();
  // 供应商：正式派单必须指定（源晨/亚北）。历史/草稿可能为空→未标注。
  const _sup = NK.normSupplier(data.supplier || data.supplierId || data.supplierName) || {};
  const dispatch = {
    id: NK.uid('D'),
    no,
    title: data.title || (site ? `${site.name}${data.typeName || ''}处理` : '运维事项'),
    desc: data.desc || '',
    type: data.type || '故障',
    priority: data.priority || 'P2',
    supplierId: _sup.id || '',
    supplierName: _sup.name || '',
    supplierUpdatedAt: data.supplierUpdatedAt || '',
    supplierHistory: data.supplierHistory || [],
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
    visitDate: data.visitDate || '',      // 上门日期（YYYY-MM-DD），用于列表展示与按日期筛选
    visitDateUpdatedAt: data.visitDateUpdatedAt || '',
    visitDateHistory: data.visitDateHistory || [],
    planArrive: data.planArrive || '',
    planArriveTime: data.planArriveTime || '',
    planDone: data.planDone || '',
    planDoneTime: data.planDoneTime || '',
    confirmAt: '', startAt: '', doneAt: '', feedbackAt: '',
    sentAt: data.sentAt || '', completedAt: data.completedAt || '', revokedAt: data.revokedAt || '',
    status: 'pending_send',      // 新派单统一从「待发送」开始
    latestFeedback: '', nextAction: '', result: '', acceptResult: '',
    supplierFeedback: data.supplierFeedback || '',   // 供应商反馈（可选）
    exceptionType: data.exceptionType || '',         // 异常类型
    exceptionNote: data.exceptionNote || '',         // 异常说明
    exceptionNext: data.exceptionNext || '',         // 异常下一步安排
    completionNote: data.completionNote || '',       // 完成说明（可选）
    legacyStatus: data.legacyStatus || '',           // 旧状态（迁移时保留）
    migrationNote: data.migrationNote || '',         // 迁移备注（如"待花姐验收"待确认）
    workNo: data.workNo || '', projectId: data.projectId || '',
    creator: '花姐', updatedAt: nowIso,
    reminders: [], attachments: [], source: data.source || 'manual',
    msg: '', urgentCount: 0, kpiCounted: false,
  };
  NK.db.dispatches.push(dispatch);
  // 派单状态历史：记录初始状态与创建时间（用于追溯）
  NK.ensureStatusHistory(dispatch, 'pending_send', '创建派单');

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
    dispatchId: dispatch.id, sourceType: 'dispatch', sourceId: dispatch.id,
    projectId: dispatch.projectId || '',
    workNo: dispatch.workNo || '', tags: [], updatedAt: nowIso, kpiCounted: false,
  };
  NK.db.tasks.push(task);
  dispatch.taskId = task.id;

  // 提醒花姐派单已生成，处于"待发送"
  NK.addReminder('派单待发送', `${dispatch.no} ${dispatch.title} 已创建，尚未发送给供应商`, 'dispatch', dispatch.id);
  NK.save();
  return dispatch;
};

/** 设置派单上门日期（记录简单修改历史，不改变派单状态） */
NK.setVisitDate = (id, date) => {
  const d = NK.getDispatch(id);
  if (!d) return null;
  const nowIso = NK.now();
  const prev = d.visitDate || '';
  date = (date || '').trim() || '';
  if (prev !== date) {
    d.visitDateHistory = d.visitDateHistory || [];
    d.visitDateHistory.push({ from: prev || '未填写', to: date || '未填写', at: nowIso });
    d.visitDate = date;
    d.visitDateUpdatedAt = nowIso;
    d.updatedAt = nowIso;
  }
  NK.save();
  return d;
};

/** 设置派单供应商（记录修改历史，不改变派单状态/编号/工程师） */
NK.setSupplier = (id, supplier) => {
  const d = NK.getDispatch(id);
  if (!d) return null;
  const nowIso = NK.now();
  const ns = NK.normSupplier(supplier);
  const prev = NK.getSupplierOf(d);
  const prevId = prev ? prev.id : '';
  const nextId = ns ? ns.id : '';
  if (prevId !== nextId) {
    d.supplierHistory = d.supplierHistory || [];
    d.supplierHistory.push({ from: prevId || '', fromName: prev ? prev.name : '未标注', to: nextId || '', toName: ns ? ns.name : '未标注', at: nowIso });
    d.supplierId = nextId;
    d.supplierName = ns ? ns.name : '';
    d.supplierUpdatedAt = nowIso;
    d.updatedAt = nowIso;
  }
  NK.save();
  return d;
};

/**
 * 共享的上门日期范围过滤：派单中心与花姐助手必须使用同一套逻辑，保证数量一致。
 * 规则：开始≤上门日期≤结束；只填开始→该日及以后；只填结束→该日及以前；两端相同→单日；均为空→全部。
 * 设置了任何日期条件后，未填写上门日期的派单不进入结果。
 * @param {Array} list 派单数组
 * @param {string} start 开始日期 YYYY-MM-DD 或 ''
 * @param {string} end 结束日期 YYYY-MM-DD 或 ''
 * @returns {Array} 过滤后的派单
 */
NK.filterByVisitRange = (list, start, end) => {
  const vs = (start || '').trim(), ve = (end || '').trim();
  if (!vs && !ve) return list;
  return list.filter(d => {
    if (!d.visitDate) return false;
    if (vs && d.visitDate < vs) return false;
    if (ve && d.visitDate > ve) return false;
    return true;
  });
};

/** 渲染派单消息 */
NK.renderDispatchMsg = (d) => {
  const tpl = NK.activeTpl();
  const site = d.siteId ? NK.getSite(d.siteId) : null;
  const cityLabel = d.siteName || d.city || d.siteName;
  const supplier = NK.dispatchSupplierLabel(d);
  const map = {
    '{职场}': cityLabel,
    '{事项}': d.desc || d.title,
    '{优先级}': d.priority,
    '{供应商}': supplier,
    '{联系人}': d.contactName || '（现场联系人见地址）',
    '{电话}': d.contactPhone || '—',
    '{地址}': d.address || '—',
    '{工程师}': d.engineer || '待指派',
    '{到场时间}': d.planArrive ? `${d.planArrive}${d.planArriveTime ? ' ' + d.planArriveTime : ''}` : '尽快到场',
    '{完成时间}': d.planDone ? `${d.planDone}${d.planDoneTime ? ' ' + d.planDoneTime : ''}` : '请评估后回复',
  };
  return tpl.content.replace(/\{职场\}|\{事项\}|\{优先级\}|\{供应商\}|\{联系人\}|\{电话\}|\{地址\}|\{工程师\}|\{到场时间\}|\{完成时间\}/g,
    (m) => map[m] || '');
};
NK.activeTpl = () => {
  const t = NK.db.templates.find(x => x.active);
  return t || NK.db.templates[0];
};

/** 记录派单状态历史（追加一条，不覆盖已有历史）。note 为该次操作说明。 */
NK.ensureStatusHistory = (d, statusKey, note, at) => {
  if (!d) return;
  d.statusHistory = d.statusHistory || [];
  const nowIso = at || NK.now();
  const prev = d.statusHistory.length ? d.statusHistory[d.statusHistory.length - 1] : null;
  // 避免完全重复的连续记录
  if (prev && prev.to === statusKey && prev.note === note) return;
  d.statusHistory.push({
    from: prev ? prev.to : (d.legacyStatus || ''), fromLabel: prev ? prev.toLabel : (d.status || ''),
    to: statusKey, toLabel: NK.DISPATCH_STATUS_LABEL[statusKey] || statusKey,
    at: nowIso, note: note || '',
  });
};

/** 状态流转（花姐单人模式：所有状态由花姐手动更新）。
 * 新状态使用英文枚举：draft/pending_send/sent/exception/completed/revoked。
 * 兼容旧中文状态：传入中文时自动映射为英文枚举。
 * 记录时间戳（sentAt/completedAt/revokedAt）与状态历史。
 */
NK.setDispatchStatus = (d, status) => {
  const nowIso = NK.now();
  const key = NK.DISPATCH_STATUS_KEY[status] || status; // 中文→英文枚举
  const label = NK.DISPATCH_STATUS_LABEL[key] || key;
  const prevKey = NK.dispatchStatusKey(d);
  const prevLabel = NK.dispatchStatusLabel(d);
  // 记录历史（含旧→新迁移追溯）
  if (prevKey !== key) {
    d.statusHistory = d.statusHistory || [];
    d.statusHistory.push({
      from: prevKey, fromLabel: prevLabel, to: key, toLabel: label,
      at: nowIso, note: NK.STATUS_CHANGE_NOTE[key] || '',
    });
  }
  d.status = key;
  d.updatedAt = nowIso;
  // 时间戳记录（首次进入才写入，避免重复）
  if (key === 'sent' && !d.sentAt) d.sentAt = nowIso;
  if (key === 'completed') {
    d.doneAt = d.doneAt || nowIso;
    d.completedAt = d.completedAt || nowIso;
    // 关联任务完成
    const t = NK.taskOfDispatch(d);
    if (t && t.status !== '已完成') { t.doneAt = nowIso; t.status = '已完成'; t.updatedAt = nowIso; }
  }
  if (key === 'revoked' && !d.revokedAt) d.revokedAt = nowIso;
  if (key === 'exception' && !d.exceptionAt) d.exceptionAt = nowIso;
  if (key === 'pending_send' && d.status === 'completed') {
    // 重新打开：清除完成时间，恢复待发送态（由重新打开流程处理）
    d.doneAt = ''; d.completedAt = '';
  }
  // 同步关联任务状态（按花姐的操作推进）
  const task = NK.taskOfDispatch(d);
  if (task && key !== 'completed') {
    const map = {
      'pending_send': '待处理', 'sent': '待处理',
      'exception': '处理中', 'draft': '待处理'
    };
    if (map[key]) { task.status = map[key]; task.updatedAt = nowIso; }
  }
  NK.save();
  return d;
};
// 状态变化时的历史备注文案
NK.STATUS_CHANGE_NOTE = {
  pending_send: '标记待发送', sent: '标记已发送', completed: '标记完成',
  exception: '记录异常', revoked: '撤销派单', draft: '保存草稿',
};

/** 更新派单反馈 */
NK.updateDispatchFeedback = (d, { feedback, nextAction, result, acceptResult, workNo }) => {
  d.latestFeedback = feedback != null ? feedback : d.latestFeedback;
  d.nextAction = nextAction != null ? nextAction : d.nextAction;
  d.result = result != null ? result : d.result;
  d.acceptResult = acceptResult != null ? acceptResult : d.acceptResult;
  if (workNo != null) d.workNo = workNo;
  d.updatedAt = NK.now();
  const t = NK.taskOfDispatch(d);
  if (t) {
    if (feedback != null) t.latestFeedback = feedback;
    if (nextAction != null) t.nextAction = nextAction;
    if (result != null) t.result = result;
    if (acceptResult != null) t.acceptResult = acceptResult;
    t.updatedAt = d.updatedAt;
  }
  NK.save();
};

/* ============================================================
   派单新流程操作（待发送 / 已发送 / 完成 / 异常 / 反馈 / 重新打开）
   核心原则：正常只记录"发出"和"完成"；只有问题才进入异常处理。
   ============================================================ */

/** 校验待发送派单的核心信息是否齐全（供应商/职场/原因/上门日期）。 */
NK.dispatchSendCheck = (d) => {
  const miss = [];
  if (!NK.getSupplierOf(d)) miss.push('供应商');
  if (!d.siteName && !d.siteId) miss.push('职场');
  if (!d.desc && !d.title) miss.push('派单原因');
  if (!d.visitDate) miss.push('上门日期');
  return miss;
};

/** 标记已发送：校验必填后，将派单从待发送改为已发送，记录发送时间/操作人。 */
NK.markDispatchSent = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  const key = NK.dispatchStatusKey(d);
  if (key === 'revoked' || d.recordStatus === '已删除') return { ok: false, msg: '这条派单已撤销/已删除，无法标记已发送' };
  if (key === 'completed') return { ok: false, msg: '这条派单已完成，无需再标记已发送' };
  const miss = NK.dispatchSendCheck(d);
  if (miss.length) return { ok: false, msg: `标记已发送前请先填写：${miss.join('、')}`, miss };
  if (key !== 'sent') {
    const nowIso = NK.now();
    d.status = 'sent';
    d.sentAt = d.sentAt || nowIso;
    d.sentBy = '花姐';
    d.updatedAt = nowIso;
    NK.ensureStatusHistory(d, 'sent', '标记已发送', nowIso);
  }
  // 若此前为异常待处理，恢复正常已发送时清除异常标记（保留异常记录用于追溯）
  d.exceptionType = ''; d.exceptionNote = ''; d.exceptionNext = '';
  // 关联任务置为待处理（若被标为处理中）
  const t = NK.taskOfDispatch(d);
  if (t && t.status !== '已完成') { t.status = '待处理'; t.updatedAt = NK.now(); }
  NK.save();
  return { ok: true, msg: `花姐，这条派单已记录为发给${NK.dispatchSupplierLabel(d)}，接下来按上门日期关注即可。` };
};

/** 标记完成：已发送/异常待处理 → 已完成，记录完成时间与可选完成说明。 */
NK.markDispatchCompleted = (id, note) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  const key = NK.dispatchStatusKey(d);
  if (key === 'completed') return { ok: false, msg: '这条派单已经是完成状态了' };
  if (key === 'revoked' || d.recordStatus === '已删除') return { ok: false, msg: '这条派单已撤销/已删除，无法标记完成' };
  const nowIso = NK.now();
  d.status = 'completed';
  d.doneAt = d.doneAt || nowIso;
  d.completedAt = d.completedAt || nowIso;
  d.completedBy = '花姐';
  if (note != null && note !== '') d.completionNote = note;
  d.updatedAt = nowIso;
  NK.ensureStatusHistory(d, 'completed', note ? `标记完成：${note}` : '标记完成', nowIso);
  // 关联任务完成
  const t = NK.taskOfDispatch(d);
  if (t && t.status !== '已完成') { t.doneAt = nowIso; t.status = '已完成'; t.updatedAt = nowIso; }
  NK.save();
  return { ok: true, msg: '花姐，这条派单已经完成，顺利收尾。✅' };
};

/** 记录供应商反馈（可选，字段全部可选；不改派单状态，除非反馈含异常花姐另行记录异常）。 */
NK.recordSupplierFeedback = (id, data) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  data = data || {};
  const nowIso = NK.now();
  d.supplierFeedback = data.content || d.supplierFeedback || '';
  d.supplierFeedbackList = d.supplierFeedbackList || [];
  d.supplierFeedbackList.push({
    content: data.content || '',
    person: data.person || '',
    phone: data.phone || '',
    changedVisitDate: data.changedVisitDate || '',
    at: nowIso,
  });
  if (data.person != null) d.supplierPerson = data.person;
  if (data.phone != null) d.supplierPhone = data.phone;
  // 若反馈中变更了预计上门日期，同步更新 visitDate 并记录历史
  if (data.changedVisitDate && d.visitDate !== data.changedVisitDate) {
    const prev = d.visitDate || '';
    d.visitDateHistory = d.visitDateHistory || [];
    d.visitDateHistory.push({ from: prev || '未填写', to: data.changedVisitDate, at: nowIso, note: '供应商反馈调整' });
    d.visitDate = data.changedVisitDate;
    d.visitDateUpdatedAt = nowIso;
  }
  d.updatedAt = nowIso;
  NK.save();
  return { ok: true, msg: '花姐，已记录供应商反馈。' };
};

/** 记录异常：已发送/待发送 → 异常待处理。保留原供应商/上门日期/派单信息。 */
NK.recordDispatchException = (id, data) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  const key = NK.dispatchStatusKey(d);
  if (key === 'completed') return { ok: false, msg: '这条派单已完成，无需记录异常' };
  if (key === 'revoked' || d.recordStatus === '已删除') return { ok: false, msg: '这条派单已撤销/已删除' };
  data = data || {};
  const nowIso = NK.now();
  d.status = 'exception';
  d.exceptionType = data.type || '其他';
  d.exceptionNote = data.note || '';
  d.exceptionNext = data.nextStep || '';
  d.exceptionAt = d.exceptionAt || nowIso;
  d.updatedAt = nowIso;
  NK.ensureStatusHistory(d, 'exception', `记录异常：${d.exceptionType}`, nowIso);
  // 关联任务标记处理中
  const t = NK.taskOfDispatch(d);
  if (t && t.status !== '已完成') { t.status = '处理中'; t.updatedAt = nowIso; }
  NK.save();
  return { ok: true, msg: '该派单存在异常，请确认新的处理安排。' };
};

/** 处理异常：根据花姐选择的结果推进。result: 'resolve'恢复已发送 | 'done'标记完成 | 'revoke'标记撤销 */
NK.resolveDispatchException = (id, result, note) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (NK.dispatchStatusKey(d) !== 'exception') return { ok: false, msg: '这条派单当前不是异常待处理状态' };
  if (result === 'done') {
    return NK.markDispatchCompleted(id, note);
  }
  if (result === 'revoke') {
    return NK.revokeDispatch(id, { reason: note || '异常无法解决，撤销派单', cancelTask: true });
  }
  // resolve：异常已解决，恢复已发送
  return NK.markDispatchSent(id);
};

/** 重新打开已完成派单：二次确认后，已发送恢复流程（不清除历史/完成说明）。 */
NK.reopenDispatch = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (NK.dispatchStatusKey(d) !== 'completed') return { ok: false, msg: '这条派单不是已完成状态，无需重新打开' };
  const nowIso = NK.now();
  d.status = 'sent';
  d.reopenedAt = nowIso;
  d.doneAt = '';
  d.completedAt = '';
  d.updatedAt = nowIso;
  NK.ensureStatusHistory(d, 'sent', '重新打开（回到已发送）', nowIso);
  // 关联任务重新打开
  const t = NK.taskOfDispatch(d);
  if (t && t.status === '已完成') { t.status = '待处理'; t.doneAt = ''; t.updatedAt = nowIso; }
  NK.save();
  return { ok: true, msg: `花姐，派单 ${d.no} 已重新打开，回到已发送状态。` };
};

/**
 * 撤销派单（业务取消，保留记录）。
 * opts: { reason }
 *  - 状态改"已撤销"，记录撤销原因/时间/操作人
 *  - 停止等待时长/催办/告警/重点/待发送/超时统计（通过状态过滤）
 *  - 保留完整历史记录（reminders/feedback等不动）
 *  - 关联任务：无论 cancelTask 如何，一律同步置为"已取消"（保留关联与历史，不删除）。
 *    这是数据同步核心：派单一旦撤销，其关联任务立即退出"当前有效工作"。
 *  - 休假补位派单：回退休假记录的补位状态为"待创建派单"
 * 返回 { ok, msg, cancelTask, leaveLinked }
 */
NK.revokeDispatch = (id, opts = {}) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (d.recordStatus === '已删除') return { ok: false, msg: '这条派单已在回收站，请先恢复再撤销' };
  if (NK.dispatchStatusKey(d) === 'revoked') return { ok: false, msg: '这条派单已经撤销过了' };
  const nowIso = NK.now();
  d.status = 'revoked';
  d.revokeReason = opts.reason || '其他';
  d.revokedAt = nowIso;
  d.revokedBy = '花姐';
  d.updatedAt = nowIso;
  NK.ensureStatusHistory(d, 'revoked', '撤销派单', nowIso);
  // 清空下次跟进提醒，停止催办
  d.nextFollowup = '';
  let taskCancelled = false;
  // 关联任务处理：撤销派单 → 关联任务同步置为"已取消"（保留历史，不删除）。
  // 这是数据同步核心：派单一旦撤销，其关联任务立即退出"当前有效工作"。
  const t = NK.taskOfDispatch(d);
  if (t) {
    t.status = '已取消';
    t.cancelReason = d.revokeReason || '派单撤销';
    t.cancelledAt = nowIso;
    t.dispatchId = d.id;
    t.sourceType = 'dispatch';
    t.sourceId = d.id;
    t.updatedAt = nowIso;
    taskCancelled = true;
  }
  // 休假补位派单：回退补位状态
  let leaveLinked = false;
  const leave = NK.db.leaves.find(l => l.relatedDispatchId === d.id);
  if (leave) {
    leave.relatedDispatchId = '';
    leave.relatedDispatchNo = '';
    leave.dispatchStatus = '待创建派单';
    leave.updatedAt = nowIso;
    leaveLinked = true;
  }
  NK.save();
  return { ok: true, msg: `花姐，这条派单已经撤销，不会再进入催办和超时提醒。`, taskCancelled, leaveLinked };
};

/**
 * 软删除派单（录入错误/重复/测试数据 → 回收站）。
 * opts: { reason, force }
 *  - 已产生处理记录（已发送及之后状态）默认不允许普通删除，需 force 二次确认
 *  - 删除后：recordStatus='已删除'，不进正常列表，保留数据用于回收站恢复
 *  - 关联任务同步标记为"已删除"（不可见，保留关联与历史）；休假补位派单回退补位状态
 * 返回 { ok, msg, blocked, canRevoke }
 */
NK.softDeleteDispatch = (id, opts = {}) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (d.recordStatus === '已删除') return { ok: false, msg: '这条派单已在回收站中' };
  // 已产生处理记录的状态：默认禁止普通删除，引导用撤销
  const processed = ['sent', 'exception', 'completed']; // 已发送/异常待处理/已完成视为已产生处理记录
  const dkey = NK.dispatchStatusKey(d);
  if (processed.includes(dkey) && !opts.force) {
    return {
      ok: false, blocked: true, canRevoke: true,
      msg: '该派单已经产生处理记录，建议使用"撤销派单"保留过程留痕。',
    };
  }
  const nowIso = NK.now();
  d.recordStatus = '已删除';
  d.deletedAt = nowIso;
  d.deletedBy = '花姐';
  d.deleteReason = opts.reason || '录入错误';
  d.updatedAt = nowIso;
  // 休假补位派单：回退补位状态（删除错误补位派单，休假记录保留）
  const leave = NK.db.leaves.find(l => l.relatedDispatchId === d.id);
  if (leave) {
    leave.relatedDispatchId = '';
    leave.relatedDispatchNo = '';
    leave.dispatchStatus = '待创建派单';
    leave.updatedAt = nowIso;
  }
  // 关联任务：标记为已删除（不可见，保留数据），不再参与任何正常列表/统计/告警/交接。
  // 保留 dispatchId/sourceId 关系，恢复派单时可一键恢复关联任务。
  const t = NK.taskOfDispatch(d);
  if (t) {
    t.recordStatus = '已删除';
    t.dispatchId = d.id;
    t.sourceType = 'dispatch';
    t.sourceId = d.id;
    t.deleteReason = d.deleteReason || '派单删除';
    t.deletedAt = nowIso;
    t.updatedAt = nowIso;
  }
  NK.save();
  return { ok: true, msg: '花姐，这条错误记录已经移到回收站。' };
};

/** 恢复已删除派单（回收站 → 回到正常列表，状态恢复为删除前状态） */
NK.restoreDispatch = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (d.recordStatus !== '已删除') return { ok: false, msg: '这条派单不在回收站中' };
  const nowIso = NK.now();
  d.recordStatus = '正常';
  d.deletedAt = '';
  d.deletedBy = '';
  d.deleteReason = '';
  d.updatedAt = nowIso;
  // 恢复关联任务：清除"已删除"标记，重新进入当前有效工作。
  // 任务若因派单删除被置为 recordStatus='已删除'，这里一并恢复。
  const t = NK.taskOfDispatch(d);
  if (t) {
    if (t.recordStatus === '已删除') { t.recordStatus = '正常'; t.deleteReason = ''; t.deletedAt = ''; }
    if (t.status !== '已取消') { t.dispatchId = d.id; t.sourceType = 'dispatch'; t.sourceId = d.id; }
    t.updatedAt = nowIso;
  }
  NK.save();
  return { ok: true, msg: `花姐，派单 ${d.no} 已恢复到正常列表。` };
};

/** 恢复已撤销派单（重新进入待跟进流程） */
NK.unrevokeDispatch = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return { ok: false, msg: '找不到这条派单' };
  if (d.status !== 'revoked') return { ok: false, msg: '这条派单当前不是已撤销状态' };
  const nowIso = NK.now();
  d.status = 'pending_send';
  d.revokeReason = '';
  d.revokedAt = '';
  d.revokedBy = '';
  d.updatedAt = nowIso;
  NK.ensureStatusHistory(d, 'pending_send', '恢复派单（重新进入待发送）', nowIso);
  // 恢复关联任务（若任务被取消则恢复为待处理；清除删除标记）
  const t = NK.taskOfDispatch(d);
  if (t) {
    if (t.status === '已取消') { t.status = '待处理'; t.cancelReason = ''; t.cancelledAt = ''; }
    if (t.recordStatus === '已删除') { t.recordStatus = '正常'; t.deleteReason = ''; t.deletedAt = ''; }
    t.dispatchId = d.id;
    t.sourceType = 'dispatch';
    t.sourceId = d.id;
    t.updatedAt = nowIso;
  }
  // 休假补位：若该派单原本来自休假补位，需重新标记（保留当前休假关系判断由UI处理）
  NK.save();
  return { ok: true, msg: `花姐，派单 ${d.no} 已恢复，将重新进入待跟进流程。` };
};

/**
 * 永久删除派单（回收站内，二次确认后调用）。返回删除的行数。
 * 永久删除不删除基础资料、不休假记录；仅从 dispatches 数组移除。
 */
NK.purgeDispatch = (id) => {
  const idx = NK.db.dispatches.findIndex(x => x.id === id);
  if (idx === -1) return 0;
  NK.db.dispatches.splice(idx, 1);
  // 永久删除派单后，其关联任务一并标记为已删除（不可见），避免成为无主/幽灵任务。
  NK.db.tasks.forEach(t => {
    if (t.dispatchId === id || (t.sourceType === 'dispatch' && t.sourceId === id)) {
      t.dispatchId = ''; t.sourceId = ''; t.sourceType = '';
      t.recordStatus = '已删除';
      t.deleteReason = '关联派单已永久删除';
      t.updatedAt = NK.now();
    }
  });
  NK.save();
  return 1;
};

/** 撤销 / 删除时需要清理该派单的"派单已生成"提醒与跟进提醒 */
NK.clearDispatchReminders = (dispatchId) => {
  const rm = NK.db.reminders || [];
  const before = rm.length;
  NK.db.reminders = rm.filter(r => !(r.source === 'dispatch' && r.refId === dispatchId));
  if (NK.db.reminders.length !== before) NK.save();
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
  const tasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.engineer === engineerName && (t.createdAt || '').slice(0, 7) === month);
  const disps = NK.db.dispatches.filter(d => d.engineer === engineerName && (d.createdAt || '').slice(0, 7) === month && !NK.dispatchInactive(d));
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
    // 派单不自动因上门日期超时扣分（上门日期已过不自动判失败，不自动认定驻场工程师责任）
  });
  tasks.forEach(t => {
    if (t.dueDate && t.status !== '已完成' && NK.today() > t.dueDate) {
      const pts = (rules.items.find(i => i.id === 'execution') || {}).rules?.[0]?.points || -5;
      out.overdue.push({ ref: t.no });
      out.deductTotal += pts;
    }
  });
  // 工单量（休假全天工作日排除：休假日不计入标准工单量要求，不因此扣分）
  const quota = rules.dailyQuota || 15;
  const workdays = 22;
  const leaveExcluded = NK.leaveWorkdaysExcluded ? NK.leaveWorkdaysExcluded(engineerName, month) : 0;
  const effectiveWorkdays = Math.max(0, workdays - leaveExcluded);
  const required = Math.round(quota * effectiveWorkdays);
  if (out.taskCount < required) {
    const miss = required - out.taskCount;
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
  // 1. P1未处理任务（仅当前有效任务；已取消/已删除或关联派单已失效的任务不参与告警）
  NK.db.tasks.forEach(t => {
    if (!NK.taskActive(t)) return;   // 派单已撤销/删除/取消的任务不产生任何任务告警
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
  // 4. 派单提醒 —— 只提醒需要花姐关注的事项：待发送 / 明日上门 / 今日上门 / 上门日期已过未完成 / 异常待处理 / 需补位未创建
  //    正常已发送未临近、已完成、已撤销、已删除不产生告警
  NK.db.dispatches.forEach(d => {
    if (NK.dispatchInactive(d)) return; // 已撤销/已删除/已取消
    const key = NK.dispatchStatusKey(d);
    if (key === 'completed') return; // 已完成不提醒
    if (key === 'draft') return; // 草稿不进入正式提醒
    if (key === 'pending_send') {
      list.push({ id: 'R-' + d.id, level: 'warn', title: '派单待发送', content: `${d.no} ${d.title}（${d.supplierName || '未选供应商'}）`, actions: [{ label: '标记已发送', act: 'dispatch', arg: d.id }] });
      return;
    }
    if (key === 'exception') {
      list.push({ id: 'R-' + d.id + '-exc', level: 'warn', title: '派单异常待处理', content: `${d.no} ${d.title}（${d.supplierName || '未选供应商'}）存在异常，请确认后续安排`, actions: [{ label: '处理异常', act: 'dispatch', arg: d.id }] });
      return;
    }
    // key === 'sent'：按上门日期生成轻量提醒
    if (d.visitDate) {
      const diff = NK.daysBetween(today, d.visitDate);
      if (diff === 0) {
        list.push({ id: 'R-' + d.id + '-visit', level: 'warn', title: '今日上门', content: `${d.no} ${d.title} 今日（${d.visitDate}）上门，供应商：${d.supplierName || '—'}`, actions: [{ label: '查看派单', act: 'dispatch', arg: d.id }] });
      } else if (diff === 1) {
        list.push({ id: 'R-' + d.id + '-visit1', level: 'warn', title: '明日上门', content: `${d.no} ${d.title} 明日（${d.visitDate}）上门，供应商：${d.supplierName || '—'}`, actions: [{ label: '查看派单', act: 'dispatch', arg: d.id }] });
      } else if (diff < 0) {
        list.push({ id: 'R-' + d.id + '-visitov', level: 'warn', title: '上门日期已过，请确认是否完成', content: `${d.no} ${d.title} 计划 ${d.visitDate} 上门，请确认是否已经完成`, actions: [{ label: '确认完成', act: 'dispatch', arg: d.id }] });
      }
      // diff > 1：上门日期还早，正常已发送不提醒
    }
  });
  // 4a. 休假补位：需创建补位派单但尚未创建的休假记录提醒
  (NK.db.leaves || []).forEach(l => {
    if (l.dispatchStatus === '待创建派单') {
      list.push({ id: 'R-' + l.id + '-cover', level: 'warn', title: '需补位未创建派单', content: `${l.engineer || '—'} ${l.date || ''} 休假，请创建补位派单`, actions: [{ label: '新建补位派单', act: 'dispatch', arg: 'new' }] });
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
    if (!NK.taskActive(t)) return;   // 关联派单已失效/已取消/已删除的任务不进入重点
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
    if (!NK.taskActive(t)) return;   // 关联派单已失效/已取消/已删除的任务不进入重点
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

  // ── 3. 派单重点事项（待发送 / 异常待处理 / 上门日期提醒）─────
  NK.db.dispatches.forEach(d => {
    if (NK.dispatchInactive(d)) return;
    const key = NK.dispatchStatusKey(d);
    if (key === 'completed' || key === 'draft') return;
    const sup = d.supplierName || '未选供应商';
    if (key === 'pending_send') {
      add({
        id: 'd-send-' + d.id,
        type: 'dispatch',
        itemId: d.id,
        tag: '待发送',
        tagLevel: 'warn',
        title: d.title,
        line1: `${NK.v.siteName(d.siteName)} · ${sup}`,
        line2: d.visitDate ? `计划 ${d.visitDate} 上门，尚未发送给供应商` : '尚未填写上门日期',
        line3: '记得发给供应商',
        actionBtn: '标记已发送',
        actionAct: `UI.dispatchDetail('${d.id}')`,
      });
      return;
    }
    if (key === 'exception') {
      add({
        id: 'd-exc-' + d.id,
        type: 'dispatch',
        itemId: d.id,
        tag: '异常待处理',
        tagLevel: 'danger',
        title: d.title,
        line1: `${NK.v.siteName(d.siteName)} · ${sup}`,
        line2: d.exceptionNote || '该派单存在异常，请确认新的处理安排',
        line3: '请确认后续安排',
        actionBtn: '处理异常',
        actionAct: `UI.dispatchDetail('${d.id}')`,
      });
      return;
    }
    // key === 'sent'：上门日期提醒
    if (d.visitDate) {
      const diff = NK.daysBetween(today, d.visitDate);
      if (diff === 0) {
        add({
          id: 'd-visit-' + d.id,
          type: 'dispatch',
          itemId: d.id,
          tag: '今日上门',
          tagLevel: 'accent',
          title: d.title,
          line1: `${NK.v.siteName(d.siteName)} · ${sup}`,
          line2: `今日 ${d.visitDate} 上门`,
          line3: '今日按计划上门',
          actionBtn: '查看派单',
          actionAct: `UI.dispatchDetail('${d.id}')`,
        });
      } else if (diff === 1) {
        add({
          id: 'd-visit1-' + d.id,
          type: 'dispatch',
          itemId: d.id,
          tag: '明日上门',
          tagLevel: 'accent',
          title: d.title,
          line1: `${NK.v.siteName(d.siteName)} · ${sup}`,
          line2: `明日 ${d.visitDate} 上门`,
          line3: '明天按计划上门',
          actionBtn: '查看派单',
          actionAct: `UI.dispatchDetail('${d.id}')`,
        });
      } else if (diff < 0) {
        add({
          id: 'd-visitov-' + d.id,
          type: 'dispatch',
          itemId: d.id,
          tag: '上门已过',
          tagLevel: 'danger',
          title: d.title,
          line1: `${NK.v.siteName(d.siteName)} · ${sup}`,
          line2: `计划 ${d.visitDate} 上门，日期已过`,
          line3: '上门日期已过，请确认是否已经完成',
          actionBtn: '确认完成',
          actionAct: `UI.dispatchDetail('${d.id}')`,
        });
      }
    }
  });

  // ── 7. 24小时内到期的任务 ─────────────────────────────────
  NK.db.tasks.forEach(t => {
    if (!NK.taskActive(t)) return;   // 已取消/已删除/关联派单已失效的任务不进入重点
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
  // 派单（新状态：正常推进 pending_send/sent；异常 exception 单独归入等待处理）
  NK.db.dispatches.forEach(d => {
    if (NK.dispatchInactive(d)) return;
    const key = NK.dispatchStatusKey(d);
    if (key === 'completed' || key === 'draft') return;
    if (key === 'exception') {
      sec.waitingAccept.push(d);
      if (d.visitDate && NK.today() > d.visitDate) sec.overdue.push(d);
      return;
    }
    // pending_send / sent
    if (d.visitDate && d.visitDate >= s && d.visitDate <= e) sec.dispatchingDue.push(d);
    else sec.dispatching.push(d);
    if (d.visitDate && NK.today() > d.visitDate) sec.overdue.push(d);
  });
  // 任务
  NK.db.tasks.forEach(t => {
    if (!NK.taskActive(t)) return; // 已取消/已删除/关联派单已失效 → 不作为当前交接工作
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
    sec.doneToday = NK.db.tasks.filter(t => NK.taskActive(t) && t.doneAt && t.doneAt.slice(0, 10) === today);
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
  sec.dispatching.forEach(d => line(`  • [${d.priority}] ${d.no} ${d.title} 状态:${NK.dispatchStatusLabel(d)} 负责工程师:${d.engineer || '—'} 最新进展:${d.latestFeedback || '无'}`));
  line('');
  line(`【等待花姐跟进】`);
  if (!sec.waitingFeedback.length) line(`  （无）`);
  sec.waitingFeedback.forEach(d => line(`  • ${d.no || d.id} ${d.title || d.name} 状态:${d.status}`));
  line('');
  line(`【异常待处理】`);
  if (!sec.waitingAccept.length) line(`  （无）`);
  sec.waitingAccept.forEach(d => line(`  • ${d.no || d.id} ${d.title || d.name} 状态:${NK.dispatchStatusLabel(d) || d.status}`));
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
    const disps = NK.db.dispatches.filter(d => !NK.dispatchInactive(d));
    const pendSend = disps.filter(d => NK.dispatchStatusKey(d) === 'pending_send');
    const exc = disps.filter(d => NK.dispatchStatusKey(d) === 'exception');
    r.push(`花姐，今天共 ${rem.length} 项提醒：P1/超时 ${urgent.length} 项、待发送派单 ${pendSend.length} 项、异常待处理 ${exc.length} 项。`);
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
    const disps = NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'pending_send' && !NK.dispatchInactive(d));
    const exc = NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'exception' && !NK.dispatchInactive(d));
    r.push(`花姐，当前有这些待处理事项：\n待发送派单 ${disps.length} 项：${disps.slice(0, 5).map(d => `${d.no} ${d.title}`).join('；') || '无'}。\n异常待处理 ${exc.length} 项：${exc.slice(0, 5).map(d => `${d.no} ${d.title}`).join('；') || '无'}。`);
    if (!disps.length && !exc.length) r.push('花姐，今天的待办都处理完啦 ✨');
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
  NK.db.leaves = NK.db.leaves || [];   // 休假记录（旧存档初始化，幂等）

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

/* ============================================================
   HP耗材提醒 → 每日邮件检查（幂等迁移）
   需求：HP耗材仅保留"每日检查一次Outlook"的日常提醒，
   不再提供独立录入入口，也不再要求创建独立耗材任务。
   - 所有旧 TPL005 任务统一改名/改频次为每日邮件检查
   - 旧触发型耗材任务（非今日、未完成）一律归档为"已取消"，保留历史不删除
   - 每日去重：同一 fixedDate 仅保留一条有效主记录，其余归档
   - 已完成的旧耗材记录保留为历史，不影响今日工作流
   安全可重复调用，绝不删除任何真实历史数据。
   ============================================================ */
NK.migrateConsumableReminder = () => {
  const tpl = NK.FIXED_TASKS.find(t => t.id === 'TPL005');
  if (!tpl) return;
  const today = NK.today();
  const nowIso = NK.now();
  // 1) 统一旧 TPL005 任务的名称/频次（对齐新模板）
  (NK.db.tasks || []).forEach(t => {
    if (t.templateId === 'TPL005') {
      t.name = tpl.name;
      t.frequency = '每日';
      t.fixedTime = '每日';
      t.trigger = '';
    }
  });
  // 2) 按 fixedDate（回退到 createdAt 日期）分组去重，保留一条有效主记录
  const grp = {};
  (NK.db.tasks || []).forEach(t => {
    if (t.templateId !== 'TPL005' || t.status === '已完成') return;
    const d = t.fixedDate || (t.createdAt || '').slice(0, 10);
    if (!d) return;
    (grp[d] = grp[d] || []).push(t);
  });
  Object.keys(grp).forEach(d => {
    if (grp[d].length < 2) return;
    // 非今日的旧记录：全部归档为已取消（历史保留）
    if (d !== today) {
      grp[d].forEach(t => {
        if (t.status !== '已取消' && t.recordStatus !== '已删除') {
          t.status = '已取消';
          t.cancelReason = 'HP耗材提醒已改为每日检查Outlook，旧触发型耗材任务归档';
          t.cancelledAt = t.cancelledAt || nowIso;
          t.updatedAt = nowIso;
        }
      });
      return;
    }
    // 今日多条的：保留最新一条有效，其余归档
    const sorted = grp[d].slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    sorted.slice(1).forEach(t => {
      if (t.status !== '已取消' && t.recordStatus !== '已删除') {
        t.status = '已取消';
        t.cancelReason = '同一天重复的耗材提醒，已归档';
        t.cancelledAt = t.cancelledAt || nowIso;
        t.updatedAt = nowIso;
      }
    });
  });
  NK.save();
};

/* ============================================================
   派单关联任务同步迁移（幂等）
   核心原则：一个派单只能对应一条关联任务；任务是否有效以派单当前状态为准。
    - 为旧关联任务补齐 sourceType/sourceId
    - 去重：同一派单的多条任务，保留一条有效主记录，其余标记为已删除
    - 已撤销/已删除派单 → 其关联任务同步标记为已取消/已删除（不可见）
    - 已恢复派单（非失效状态）→ 其关联任务恢复可见
   安全可重复调用，不删除任何派单或任务历史数据。
   ============================================================ */
NK.migrateDispatchTaskSync = () => {
  const nowIso = NK.now();
  const byDispatch = {};   // dispatchId -> [tasks]
  (NK.db.tasks || []).forEach(t => {
    const did = t.dispatchId || (t.sourceType === 'dispatch' ? t.sourceId : '');
    if (!did) return;
    t.sourceType = 'dispatch';
    t.sourceId = did;
    (byDispatch[did] = byDispatch[did] || []).push(t);
  });
  // 去重：同一派单只保留一条主记录（优先未删除、未取消、最新创建），其余归档为已删除
  Object.keys(byDispatch).forEach(did => {
    const arr = byDispatch[did];
    if (arr.length <= 1) return;
    // 主记录优先级：recordStatus 正常 > 未取消 > createdOrder
    const rank = t => (
      (t.recordStatus !== '已删除' ? 8 : 0) +
      (t.status !== '已取消' ? 4 : 0) +
      (t.status !== '已完成' ? 2 : 0)
    );
    const sorted = [...arr].sort((a, b) => (rank(b) - rank(a)) || (new Date(b.createdAt) - new Date(a.createdAt)));
    const primary = sorted[0];
    const d = NK.getDispatch(did);
    if (d) d.taskId = primary.id;
    // 主记录不再视为归档重复（若曾被打标记则清除）
    delete primary.dupArchived;
    sorted.slice(1).forEach(dup => {
      if (dup.recordStatus !== '已删除') {
        dup.recordStatus = '已删除';
        dup.deleteReason = '同派单重复关联任务，已归档';
        dup.deletedAt = dup.deletedAt || nowIso;
        dup.updatedAt = nowIso;
      }
      // 标记为去重归档：状态对齐阶段不得再将其恢复为可见
      dup.dupArchived = true;
    });
  });
  // 状态对齐：以派单当前状态为准同步关联任务
  (NK.db.tasks || []).forEach(t => {
    if (t.sourceType !== 'dispatch' && !t.dispatchId) return;
    // 去重归档的记录不再参与状态对齐恢复（保持不可见）
    if (t.dupArchived) return;
    const did = t.dispatchId || t.sourceId;
    const d = NK.getDispatch(did);
    // 派单已被永久删除 → 任务标记为已删除，不再作为当前工作
    if (!d) {
      if (t.recordStatus !== '已删除') { t.recordStatus = '已删除'; t.deleteReason = '关联派单已不存在'; t.updatedAt = nowIso; }
      return;
    }
    if (NK.dispatchInactive(d)) {
      // 已撤销/已取消/已删除派单 → 关联任务退出当前工作
      if (NK.dispatchStatusKey(d) === 'revoked' || d.status === '已取消') {
        if (t.status !== '已取消') {
          t.status = '已取消';
          t.cancelReason = t.cancelReason || (d.revokeReason || '派单撤销');
          t.cancelledAt = t.cancelledAt || (d.revokedAt || nowIso);
          t.updatedAt = nowIso;
        }
      } else if (d.recordStatus === '已删除') {
        if (t.recordStatus !== '已删除') {
          t.recordStatus = '已删除';
          t.deleteReason = t.deleteReason || (d.deleteReason || '派单删除');
          t.deletedAt = t.deletedAt || (d.deletedAt || nowIso);
          t.updatedAt = nowIso;
        }
      }
    } else if (t.status === '已取消' && !t.cancelledAt && NK.dispatchStatusKey(d) !== 'revoked') {
      // 非失效派单但任务残留已取消（可能由旧撤销未恢复导致）——恢复为待处理
      t.status = '待处理';
      t.cancelReason = '';
      t.cancelledAt = '';
      t.updatedAt = nowIso;
    } else if (t.recordStatus === '已删除' && d.recordStatus !== '已删除') {
      // 派单已恢复，但任务仍被标记删除（撤销恢复场景）
      if (NK.dispatchStatusKey(d) !== 'revoked') {
        t.recordStatus = '正常';
        t.deleteReason = '';
        t.deletedAt = '';
        t.updatedAt = nowIso;
      }
    }
  });
  NK.save();
};
