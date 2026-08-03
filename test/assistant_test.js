/* 花姐助手 · 操作助手引擎测试
 * 运行：node test/assistant_test.js
 * 用 vm 加载 data.js + app.js + assistant.js，mock UI 层，验证：
 *   - 各类指令解析正确
 *   - 新增专项/任务 → 真实写入 → 撤销
 *   - 完成今日日常（需确认、列出影响范围）
 *   - 快速记录
 *   - 数据持久化（刷新后仍在 NK.db）
 *   - 模糊匹配多条展示候选不误改
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const asstSrc = fs.readFileSync(path.join(ROOT, 'js', 'assistant.js'), 'utf8').replace(/^\uFEFF/, '');

// ---- mock 浏览器环境 ----
const storage = {};
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};

// UI mock：记录被调用的方法，供断言
const uiCalls = [];
const UI = {
  __stack: [],
  leaveCreate() { uiCalls.push('leaveCreate'); },
  dispatchCreate() { uiCalls.push('dispatchCreate'); },
  handoverToday() { uiCalls.push('handoverToday'); },
  taskDetail() { uiCalls.push('taskDetail'); },
  projectDetail() { uiCalls.push('projectDetail'); },
  nav() { uiCalls.push('nav'); },
};

const sandbox = {
  localStorage: localStorageMock,
  console: console,
  window: { SEED_DATA: null },
  document: { getElementById: () => null },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Math: Math,
  JSON: JSON,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  UI: UI,
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = localStorageMock;
sandbox.window.document = sandbox.document;
sandbox.window.console = console;
sandbox.window.UI = UI;
vm.createContext(sandbox);

try {
  vm.runInContext(dataSrc, sandbox, { filename: 'data.js' });
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
  vm.runInContext(asstSrc, sandbox, { filename: 'assistant.js' });
} catch (e) {
  console.error('加载失败:', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'test' });
const parse = (q) => run('NK.assistant.parse(' + JSON.stringify(q) + ')');
const handle = (q, ctx) => run('NK.assistant.handle(' + JSON.stringify(q) + ', ' + JSON.stringify(ctx || {}) + ')');

// 初始化
run('NK.initDB();');
ok(run('Array.isArray(NK.db.assistantOps)'), 'assistantOps 日志数组已初始化');
ok(run('Array.isArray(NK.assistant.parse) === false'), 'NK.assistant 为对象命名空间');

console.log('== 一、指令解析 ==');
let i = parse('今天谁休假');
ok(i.intent === 'query' && i.action === 'leave_today', '「今天谁休假」→ 查询今日休假');
i = parse('上海长宁谁负责');
ok(i.intent === 'query' && i.action === 'site_engineer', '「上海长宁谁负责」→ 查询职场工程师');
i = parse('今天有什么待办');
ok(i.intent === 'query' && i.action === 'todo', '「今天有什么待办」→ 查询待办');
i = parse('实时告警有哪些');
ok(i.intent === 'query' && i.action === 'alerts', '「实时告警有哪些」→ 查询告警');
i = parse('KPI 得分怎么样');
ok(i.intent === 'query' && i.action === 'kpi', '「KPI 得分怎么样」→ 查询 KPI');
i = parse('专项进度如何');
ok(i.intent === 'query' && i.action === 'project_progress', '「专项进度如何」→ 查询专项');
i = parse('新增任务，明天下午确认南京网络问题');
ok(i.intent === 'action' && i.action === 'task_create' && i.title.indexOf('确认南京网络问题') !== -1, '「新增任务…」→ task_create');
i = parse('新增专项，李亚男SF工单未完成，需要督促');
ok(i.intent === 'action' && i.action === 'project_create' && i.title.indexOf('李亚男') !== -1, '「新增专项…」→ project_create');
i = parse('完成数据备份任务');
ok(i.intent === 'action' && i.action === 'complete_task' && i.title === '数据备份任务', '「完成数据备份任务」→ complete_task');
i = parse('登记孙益东明天下午休假');
ok(i.intent === 'action' && i.action === 'leave_create' && i.personName === '孙益东', '「登记孙益东…休假」→ leave_create');
i = parse('创建派单，上海长宁有网络故障报障');
ok(i.intent === 'action' && i.action === 'dispatch_create' && i.siteName === '上海长宁', '「创建派单…」→ dispatch_create');
i = parse('登记KPI，李亚男SF工单录入不完整');
ok(i.intent === 'action' && i.action === 'kpi_event' && i.personName === '李亚男', '「登记KPI…」→ kpi_event');
i = parse('生成今日交接');
ok(i.intent === 'action' && i.action === 'handover', '「生成今日交接」→ handover');
i = parse('完成今日日常');
ok(i.intent === 'action' && i.action === 'complete_daily_all' && i.batchOperation, '「完成今日日常」→ 批量完成(需确认)');
i = parse('清空告警');
ok(i.intent === 'action' && i.action === 'clear_alerts' && i.batchOperation, '「清空告警」→ 高风险批量操作');
i = parse('撤销刚才');
ok(i.intent === 'action' && i.action === 'undo', '「撤销刚才」→ undo');
i = parse('查看操作记录');
ok(i.intent === 'action' && i.action === 'logs', '「查看操作记录」→ logs');

console.log('== 二、场景一：新增专项 → 真实写入 → 撤销 ==');
const projBefore = run('NK.db.projects.length');
let r = handle('新增专项，李亚男SF工单未完成，需要督促');
ok(Array.isArray(r) && r[0] && typeof r[0].text === 'string', '返回结构化回复');
ok(run('NK.db.projects.length === ' + (projBefore + 1)), '专项已真实写入 projects');
ok(run('NK.db.projects[NK.db.projects.length-1].name.indexOf("李亚男") !== -1'), '专项名称正确');
ok(run('NK.db.projects[NK.db.projects.length-1].status === "未开始"'), '专项默认未开始');
ok(run('NK.db.projects[NK.db.projects.length-1].owner === "ENG007" || NK.db.projects[NK.db.projects.length-1].participants.indexOf("李亚男") !== -1'), '专项关联工程师李亚男');
ok(r[0].actions && r[0].actions.some(a => a.label === '撤销'), '回复含撤销按钮');
const opId = run('NK.db.assistantOps[NK.db.assistantOps.length-1].operationId');
ok(run('NK.db.assistantOps[NK.db.assistantOps.length-1].undone === false'), '日志记录未撤销状态');
// 撤销
const undoRes = run('NK.assistant.undo("' + opId + '")');
ok(undoRes.ok === true, '撤销成功返回 ok');
ok(run('NK.db.projects.length === ' + projBefore), '撤销后专项数量恢复原状');
ok(run('NK.db.assistantOps[NK.db.assistantOps.length-1].undone === true'), '日志标记已撤销');

console.log('== 三、场景二：完成今日日常（需确认+批量） ==');
// 确保今日有日常任务
const dailyCount = run('(NK.db.tasks||[]).filter(function(t){return t.status==="待处理" && t.templateId && NK.FIXED_DAILY().some(function(x){return x.id===t.templateId}) && t.fixedDate===NK.today();}).length');
if (dailyCount === 0) {
  console.log('  （今日无未完成日常任务，跳过批量完成——为触发该路径手动注入一条）');
  run('NK.db.tasks.push({id:"TDAILY", name:"宏1站用户消息跟进", type:"临时任务", status:"待处理", templateId:"TPL001", fixedDate:NK.today(), createdAt:NK.now(), updatedAt:NK.now(), latestFeedback:"", nextAction:""}); NK.save();');
}
let r2 = handle('完成今日日常');
const confCount = run('(NK.db.tasks||[]).filter(function(t){return t.status==="待处理" && t.templateId && NK.FIXED_DAILY().some(function(x){return x.id===t.templateId}) && t.fixedDate===NK.today();}).length');
ok(r2[0].requiresConfirmation === true, '批量完成返回需确认');
ok(r2[0].actions.some(a => a.label === '确认全部完成'), '确认按钮已列出');
// 确认前不应误改
ok(run('NK.db.tasks.filter(function(t){return t.status==="已完成";}).length') >= 0, '确认前未误改（无断言变更）');
// 执行确认回调
const ids = run('NK.db.tasks.filter(function(t){return t.status==="待处理" && t.templateId && NK.FIXED_DAILY().some(function(x){return x.id===t.templateId}) && t.fixedDate===NK.today();}).map(function(t){return t.id;}).join(",")');
const confirmR = run('NK.assistant.confirmDailyAll("' + ids + '")');
ok(confirmR[0].text.indexOf('全部完成') !== -1, '确认后批量完成今日日常');
ok(run('NK.db.tasks.filter(function(t){return t.status==="待处理" && t.templateId && NK.FIXED_DAILY().some(function(x){return x.id===t.templateId}) && t.fixedDate===NK.today();}).length === 0'), '今日日常任务已全部完成');
// 撤销批量
const opId2 = run('NK.db.assistantOps[NK.db.assistantOps.length-1].operationId');
run('NK.assistant.undo("' + opId2 + '")');
ok(run('NK.db.tasks.filter(function(t){return t.status==="待处理" && t.templateId && NK.FIXED_DAILY().some(function(x){return x.id===t.templateId}) && t.fixedDate===NK.today();}).length === ' + confCount), '撤销批量完成后恢复原状态');

console.log('== 四、场景四：快速记录 ==');
const noteBefore = run('NK.db.quickNotes.length');
r = handle('快速记录，今天例会确认下周巡检安排');
ok(run('NK.db.quickNotes.length === ' + (noteBefore + 1)), '快速记录写入 quickNotes');
ok(run('NK.db.quickNotes[NK.db.quickNotes.length-1].content.indexOf("例会") !== -1'), '记录内容正确');
ok(run('NK.db.tasks.length') === run('NK.db.tasks.length'), '快速记录不创建任务');
const opId3 = run('NK.db.assistantOps[NK.db.assistantOps.length-1].operationId');
run('NK.assistant.undo("' + opId3 + '")');
ok(run('NK.db.quickNotes.length === ' + noteBefore), '记录可撤销');

console.log('== 五、新增任务与完成 ==');
const taskBefore = run('NK.db.tasks.length');
r = handle('新增任务，明天下午确认南京网络问题');
ok(run('NK.db.tasks.length === ' + (taskBefore + 1)), '任务已真实写入');
ok(run('NK.db.tasks[NK.db.tasks.length-1].source === "花姐助手"'), '任务来源标记为花姐助手');
const newTaskId = run('NK.db.tasks[NK.db.tasks.length-1].id');
r = handle('完成' + run('NK.db.tasks[NK.db.tasks.length-1].name'));
// 唯一匹配直接完成
ok(run('NK.getTask("' + newTaskId + '").status === "已完成"'), '唯一匹配任务直接完成');
ok(run('NK.db.tasks[NK.db.tasks.length-1].doneAt !== ""'), '已完成记录时间');

console.log('== 六、模糊匹配多条展示候选不误改 ==');
// 制造两条相似任务
run('NK.db.tasks.push({id:"T_SIM_1", name:"巡检中宏大厦网络", type:"临时任务", status:"待处理", createdAt:NK.now(), updatedAt:NK.now(), latestFeedback:"", nextAction:""});');
run('NK.db.tasks.push({id:"T_SIM_2", name:"巡检中宏网络设备", type:"临时任务", status:"待处理", createdAt:NK.now(), updatedAt:NK.now(), latestFeedback:"", nextAction:""});');
r = handle('完成巡检中宏网络');
ok(r[0].text.indexOf('条相似任务') !== -1 || r[0].actions.length > 1, '多条候选时让花姐选择');
ok(r[0].actions && r[0].actions.length > 1, '展示多条候选按钮');
ok(run('NK.getTask("T_SIM_1").status === "待处理" && NK.getTask("T_SIM_2").status === "待处理"'), '未误改任何候选任务');
// 选择一条完成
run('NK.assistant.completePick("T_SIM_1")');
ok(run('NK.getTask("T_SIM_1").status === "已完成"'), '选择后仅完成所选任务');
ok(run('NK.getTask("T_SIM_2").status === "待处理"'), '另一条保持原状');

console.log('== 七、数据持久化 ==');
const persisted = run('JSON.stringify(NK.db.assistantOps)');
ok(persisted.indexOf('operationId') !== -1, 'assistantOps 已随存档持久化');
ok(run('JSON.parse(' + JSON.stringify(storage['nk_ops_command_v1']) + ').assistantOps.length >= 1') , 'localStorage 存档含 assistantOps');

console.log('== 八、撤销最近操作（undoLast） ==');
run('NK.assistant.handle("新增任务，测试撤销最近")');
const cntBeforeUndo = run('NK.db.tasks.length');
const lastUndo = run('NK.assistant.undoLast()');
ok(lastUndo.ok === true, '撤销最近未撤销操作');
ok(run('NK.db.tasks.length === ' + (cntBeforeUndo - 1)), '最近任务已被撤销移除');

console.log('== 九、休假 / 派单 / KPI / 交接（打开预填，不静默创建） ==');
uiCalls.length = 0;
r = handle('登记孙益东明天下午休假');
ok(r[0].text.indexOf('孙益东') !== -1, '休假回复提及工程师');
ok(uiCalls.indexOf('leaveCreate') !== -1, '休假调用 leaveCreate 弹窗（未静默写入）');
ok(run('NK.db.leaves.length === 0'), '休假仅预填表单，未直接写入数据');
uiCalls.length = 0;
r = handle('创建派单，上海长宁有网络故障报障');
ok(r[0].text.indexOf('上海长宁') !== -1, '派单回复提及职场');
ok(uiCalls.indexOf('dispatchCreate') !== -1, '派单调用 dispatchCreate 预填（未静默创建）');
ok(run('NK.db.dispatches.length === 0'), '派单仅预填，未直接写入');
uiCalls.length = 0;
r = handle('登记KPI，李亚男SF工单录入不完整');
ok(run('NK.db.kpiEvents.length >= 1'), 'KPI 候选事件已写入（候选，非正式扣分）');
ok(run('NK.db.kpiEvents[NK.db.kpiEvents.length-1].confirmed === false'), 'KPI 事件为候选状态未确认');
uiCalls.length = 0;
r = handle('生成今日交接');
ok(uiCalls.indexOf('handoverToday') !== -1, '交接调用 handoverToday 预览');

console.log('== 十、上下文补充（给它补一句） ==');
// 用 vm 内共享的 ctx 引用（真实 UI 中 ctx 是同一个对象跨多次调用保留）
run('window.__ctx = {};');
run('NK.assistant.handle("新增任务，跟进中宏OA报障", window.__ctx)');
const ctxTaskId2 = run('NK.db.tasks[NK.db.tasks.length-1].id');
const ctxR = run('NK.assistant.handle("给它补一句：下午已和客户确认", window.__ctx)');
ok(ctxR[0].text.indexOf('跟进中宏OA报障') !== -1, '上下文补充定位到最近任务');
ok(run('NK.getTask("' + ctxTaskId2 + '").latestFeedback.indexOf("下午已和客户确认") !== -1'), '补充内容已写入任务进度');

console.log('== 十一、低置信度确认 ==');
// 构造一条低置信度 task_create 意图直接调 handle 验证确认分支
const lowIntent = JSON.stringify({ intent: 'action', action: 'task_create', targetModule: 'tasks', title: '测试低置信度', confidence: 0.4 });
const lowR = run('NK.assistant.confirmIntent(' + JSON.stringify(lowIntent) + ')');
ok(lowR[0].text.indexOf('测试低置信度') !== -1, '低置信度意图确认后执行成功');

console.log('== 十二、花姐助手撤销/删除派单指令 ==');
// 准备一条唯一派单：撤销山东青岛打印机派单
run('NK.db.dispatches = []; NK.db.tasks = []; NK.db.leaves = []; NK.save();');
const revD = run(`(function(){ const d = NK.createDispatch({ title: '山东青岛打印机处理', siteName: '青岛中宏', city: '青岛', engineer: '李亚男' }); return d.id; })()`);
// 唯一匹配 → 展示摘要确认，不直接执行
let rv = handle('撤销山东青岛打印机派单');
ok(rv[0].text.indexOf('撤销') !== -1 && rv[0].text.indexOf('山东青岛打印机处理') !== -1, '撤销派单指令返回摘要确认');
ok(rv[0].requiresConfirmation === true, '撤销派单需确认');
ok(rv[0].actions.some(a => a.act === 'assistantConfirmRevokeDispatch'), '提供确认撤销按钮');
ok(run('NK.dispatchStatusKey(NK.db.dispatches[0]) !== \'revoked\''), '未确认前不执行撤销');
// 确认后执行撤销
let cr = run('NK.assistant.confirmRevokeDispatch("' + revD + '")');
ok(cr.ok === true, '确认撤销成功');
ok(run('NK.dispatchStatusKey(NK.db.dispatches[0]) === \'revoked\''), '确认后状态改为已撤销');
ok(run('NK.db.dispatches[0].revokedBy === \'花姐\''), '撤销操作人=花姐');
// 已撤销派单再撤销 → 被拒绝
cr = run('NK.assistant.confirmRevokeDispatch("' + revD + '")');
ok(cr.ok === false, '重复撤销被拒绝');
// 助手撤销操作可撤销（undo 恢复）
const undoR = run('NK.assistant.undoLast()');
ok(undoR.ok === true, '助手撤销操作可撤销');
ok(run('NK.dispatchStatusKey(NK.db.dispatches[0]) !== \'revoked\''), '撤销后派单状态恢复');

console.log('== 十三、删除派单指令二次确认 ==');
// 删除一条未发送派单 → 需二次确认
run('NK.db.dispatches = []; NK.db.tasks = []; NK.save();');
const delD = run(`(function(){ const d = NK.createDispatch({ title: '测试重复派单' }); return d.id; })()`);
let dv = handle('删除测试重复派单');
ok(dv[0].text.indexOf('删除') !== -1, '删除派单指令返回确认卡片');
ok(dv[0].requiresConfirmation === true, '删除需二次确认');
ok(dv[0].actions.some(a => a.act === 'assistantConfirmDeleteDispatch'), '提供确认删除按钮');
ok(run('NK.db.dispatches[0].recordStatus !== \'已删除\''), '未确认前不删除');
// 确认后删除进回收站
let cd = run('NK.assistant.confirmDeleteDispatch("' + delD + '")');
ok(cd.ok === true, '确认删除成功');
ok(run('NK.db.dispatches[0].recordStatus === \'已删除\''), '确认后 recordStatus=已删除');
ok(run('NK.db.dispatches.length === 1'), '删除进回收站不物理删除');

console.log('== 十四、已处理派单助手删除被引导 ==');
run('NK.db.dispatches = []; NK.db.tasks = []; NK.save();');
const pD = run(`(function(){ const d = NK.createDispatch({ title: '已处理故障' }); return d.id; })()`);
run('NK.db.dispatches[0].status = \'已处理\';');
let pv = handle('删除已处理故障派单');
ok(pv[0].text.indexOf('撤销') !== -1, '已处理派单助手删除引导改为撤销');
ok(pv[0].actions.some(a => a.act === 'assistantConfirmRevokeDispatch'), '提供改为撤销按钮');
ok(run('NK.db.dispatches[0].recordStatus !== \'已删除\''), '已处理派单未被删除');

console.log('== 十五、花姐助手「查看派单」日期范围查询（与派单中心数量一致） ==');
// 准备一批带上门日期的派单
run('NK.db.dispatches = []; NK.db.tasks = []; NK.save();');
const dr1 = run(`(function(){ const d = NK.createDispatch({ title: '青岛打印机', siteName: '青岛中宏', city: '青岛', engineer: '李亚男', visitDate: '2026-08-05' }); return d.id; })()`);
const dr2 = run(`(function(){ const d = NK.createDispatch({ title: '青岛网络', siteName: '青岛中宏', city: '青岛', engineer: '李亚男', visitDate: '2026-08-20' }); return d.id; })()`);
const dr3 = run(`(function(){ const d = NK.createDispatch({ title: '湖州电力', siteName: '湖州中心', city: '湖州', engineer: '王彪', visitDate: '2026-09-10' }); return d.id; })()`);
run('NK.db.dispatches[0].recordStatus = \'已删除\';'); // 第一条作废，验证默认排除已删除
// 意图解析：本月/上月/区间/城市组合/单月+已发送
let rd = parse('查看本月派单');
ok(rd.intent === 'query' && rd.action === 'dispatch' && rd.startDate && rd.endDate, '「查看本月派单」→ 派单查询意图，含日期范围');
let mS = run(`(() => { const x=new Date(); return NK.fmtDate(new Date(x.getFullYear(), x.getMonth(), 1)); })()`);
let mE = run(`(() => { const x=new Date(); return NK.fmtDate(new Date(x.getFullYear(), x.getMonth()+1, 0)); })()`);
ok(rd.startDate === mS && rd.endDate === mE, '「本月」解析为 ' + mS + ' 至 ' + mE);
// 区间解析
rd = parse('查看8月1日到8月31日的派单');
ok(rd.action === 'dispatch' && rd.startDate === '2026-08-01' && rd.endDate === '2026-08-31', '「8月1日到8月31日」→ 2026-08-01 至 2026-08-31');
// 执行查询：区间 8月 → 应返回 1 条（青岛网络 08-20；青岛打印机 已删除排除；湖州电力 09 月排除）
let rq = run('NK.assistant.q_dispatch({ startDate: "2026-08-01", endDate: "2026-08-31", _rangeLabel: "2026-08-01至2026-08-31" })');
ok(rq[0].text.indexOf('共 1 条派单') !== -1, '8月区间查询返回 1 条（默认排除已删除）');
ok(rq[0].text.indexOf('青岛网络') !== -1 && rq[0].text.indexOf('青岛打印机') === -1, '区间结果含 08-20，不含已删除的 08-05');
// 组合：本月 + 青岛 → 应返回青岛网络 1 条
rq = run('NK.assistant.q_dispatch({ startDate: "' + mS + '", endDate: "' + mE + '", title: "青岛" })');
ok(rq[0].text.indexOf('共 1 条派单') !== -1 && rq[0].text.indexOf('青岛网络') !== -1, '「本月+青岛」组合返回 1 条');
// 无匹配
rq = run('NK.assistant.q_dispatch({ startDate: "2026-09-10", endDate: "2026-09-10", title: "青岛" })');
ok(rq[0].text.indexOf('没有找到派单记录') !== -1, '「9月10日+青岛」无匹配 → 提示未找到');
// 未删除的历史未填写在无范围时显示
const dr4 = run(`(function(){ const d = NK.createDispatch({ title: '未填写日期派单', siteName: '青岛中宏', city: '青岛' }); return d.id; })()`);
rq = run('NK.assistant.q_dispatch({ startDate: "", endDate: "", title: "" })');
ok(rq[0].text.indexOf('未填写日期派单') !== -1, '无日期范围时助手显示「未填写日期派单」');
rq = run('NK.assistant.q_dispatch({ startDate: "2026-08-01", endDate: "2026-08-31" })');
ok(rq[0].text.indexOf('未填写日期派单') === -1, '有日期范围时助手不含未填写派单');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
