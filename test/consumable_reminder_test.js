/* HP耗材每日邮件检查 - 简化验收测试
 * 运行：node test/consumable_reminder_test.js
 * 覆盖需求十节验收标准：
 *   1) 首页今日时间轴显示「HP打印机耗材邮件检查（Outlook）」
 *   2) 无「收到耗材提醒」快捷入口（已移除 triggerFixed/按钮）
 *   3) 任务与告警无耗材提醒录入入口
 *   4) 完成后时间轴显示已完成（已完成状态）
 *   5) 不要求填写任何内容（完成仅切换状态，无表单）
 *   6) 刷新页面后完成状态保留（持久化）
 *   7) 同一天不重复生成
 *   8) 第二天自动出现新的当日提醒
 *   9) 未完成时不产生P1/实时告警
 *   10) 原有真实耗材历史记录不被删除
 *   11) 其他固定任务/派单/告警不受影响
 * 另覆盖：
 *   - 旧触发型耗材任务在迁移时归档（不删除），仅保留一条有效
 *   - 花姐助手"完成HP耗材邮件检查"唯一匹配即完成并撤销
 *   - 完成不产生KPI事件、不进入重点/告警
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const asstSrc = fs.readFileSync(path.join(ROOT, 'js', 'assistant.js'), 'utf8').replace(/^\uFEFF/, '');

const storage = {};
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};
// UI mock：assistant.js 需要 typeof UI !== 'undefined' 才会绑定 NK.assistant
const UI = {
  __stack: [], nav() {}, taskDetail() {}, projectDetail() {}, leaveCreate() {}, dispatchCreate() {},
};
const sandbox = {
  localStorage: localStorageMock,
  console: console,
  window: { SEED_DATA: null },
  document: { getElementById: () => null },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Date: Date, Math: Math, JSON: JSON,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
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
const asst = `NK.assistant`;

run(`NK.initDB(); NK.mode = 'work';`);

// 干净初始化：清空业务数据，保留固定任务体系
const fresh = () => run(`
  NK.db.tasks = [];
  NK.db.dispatches = [];
  NK.db.leaves = [];
  NK.db.reminders = [];
  NK.db.kpiEvents = [];
  NK.ensureFixedTasks();
  NK.save();
`);

// ──────────────────────────────────────────────────────────
console.log('\n【1】模板配置：TPL005 已改为每日提醒');
const tpl = run(`JSON.stringify(NK.FIXED_TASKS.find(t=>t.id==='TPL005'))`);
ok(tpl.includes('HP打印机耗材邮件检查（Outlook）'), '模板名称为「HP打印机耗材邮件检查（Outlook）」');
ok(tpl.includes('"frequency":"每日"'), 'frequency = 每日');
ok(tpl.includes('查看Outlook中是否收到HP打印机耗材提醒邮件'), '说明=查看Outlook中是否收到耗材提醒邮件');
ok(!tpl.includes('邮件触发') && !tpl.includes('"trigger":"耗材提醒"'), '已删除邮件触发规则与耗材提醒trigger');
ok(run(`NK.FIXED_DAILY().some(t=>t.id==='TPL005')`), 'TPL005 归入每日固定任务（FIXED_DAILY）');
ok(run(`!NK.FIXED_TRIGGER().some(t=>t.id==='TPL005')`), 'TPL005 已不在触发类（FIXED_TRIGGER）');

// ──────────────────────────────────────────────────────────
console.log('\n【2】每日生成一条今日提醒 + 不重复');
fresh();
ok(run(`NK.db.tasks.filter(t=>t.templateId==='TPL005' && NK.taskActive(t)).length===1`), '当天仅生成一条有效耗材提醒');
ok(run(`(function(){const t=NK.db.tasks.find(t=>t.templateId==='TPL005');return t && t.name==='HP打印机耗材邮件检查（Outlook）' && t.fixedDate===NK.today();})()`), '今日实例名称/日期正确（fixedDate=今日）');
ok(run(`NK.db.tasks.filter(t=>t.templateId==='TPL005').length===1`), '再次ensure不重复（去重按 模板+日期）');
run(`NK.ensureFixedTasks(); NK.ensureFixedTasks();`);
ok(run(`NK.db.tasks.filter(t=>t.templateId==='TPL005').length===1`), '多次调用ensureFixedTasks仍只有一条');

// ──────────────────────────────────────────────────────────
console.log('\n【3】未完成时不产生P1/实时告警/重点事项');
fresh();
run(`const t=NK.db.tasks.find(t=>t.templateId==='TPL005'); t.priority='P3'; t.dueDate=''; NK.save();`);
ok(run(`(NK.genReminders()||[]).length===0`), '未完成时不产生任何实时告警（genReminders为空）');
ok(run(`(NK.genFocusItems()||[]).filter(f=>/耗材/.test(f.title)).length===0`), '不进入重点事项');
ok(run(`(NK.autoKpi('李亚男', NK.today().slice(0,7)).events||[]).length===0`), '未完成不产生KPI事件');

// ──────────────────────────────────────────────────────────
console.log('\n【4】首页时间轴展示 + 标记完成（切换状态）');
fresh();
const tkId = run(`NK.db.tasks.find(t=>t.templateId==='TPL005').id`);
ok(run(`NK.getTask('${tkId}').status==='待处理'`), '初始为待处理');
// 模拟首页时间轴完成交互：完成 = 置为已完成
run(`NK.setTaskStatus(NK.getTask('${tkId}'), '已完成'); NK.save();`);
ok(run(`NK.getTask('${tkId}').status==='已完成' && !!NK.getTask('${tkId}').doneAt`), '标记完成后状态为已完成并记录完成时间');
ok(run(`NK.getTask('${tkId}').name==='HP打印机耗材邮件检查（Outlook）'`), '完成不改名、不要求填写任何内容');
// 撤销
run(`NK.setTaskStatus(NK.getTask('${tkId}'), '待处理'); NK.getTask('${tkId}').doneAt=''; NK.save();`);
ok(run(`NK.getTask('${tkId}').status==='待处理'`), '撤销后回到待处理（提供撤销）');

// ──────────────────────────────────────────────────────────
console.log('\n【5】完成后刷新/持久化状态保留');
run(`NK.setTaskStatus(NK.getTask('${tkId}'), '已完成'); NK.save();`);
run(`NK.initDB();`);  // 模拟刷新（从localStorage重新加载）
ok(run(`(function(){const t=NK.db.tasks.find(x=>x.templateId==='TPL005' && x.fixedDate===NK.today());return t && t.status==='已完成';})()`), '刷新后当日耗材提醒仍为已完成');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && NK.taskActive(x)).length===1`), '刷新后不重复生成');

// ──────────────────────────────────────────────────────────
console.log('\n【6】第二天自动出现新的当日提醒（不堆叠）');
fresh();
run(`
  (function(){
    const t = NK.db.tasks.find(x=>x.templateId==='TPL005');
    // 把今日实例视为"昨天"已完成，生成新的今日实例
    t.fixedDate = '2026-08-02'; t.status='已完成'; NK.save();
    NK.ensureFixedTasks();
  })()
`);
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.fixedDate===NK.today() && NK.taskActive(x)).length===1`), '次日自动生成一条新的当日提醒');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.status==='待处理').length===1`), '同一时刻只保留一条待处理的耗材提醒（不堆叠）');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && NK.taskActive(x) && x.status==='待处理').length===1`), '同一时刻只保留一条有效且待处理的耗材提醒');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005').some(x=>x.status==='已完成' && x.fixedDate==='2026-08-02')`), '昨天已完成的历史记录仍保留（不删除）');

// ──────────────────────────────────────────────────────────
console.log('\n【7】历史记录保留归档 + 旧触发型任务迁移去重');
run(`
  (function(){
    NK.db.tasks = [];
    // 构造旧的触发型耗材任务：今日两条 + 昨日已完成一条
    ['old1','old2'].forEach(nm=>{
      const t = NK.createTask({name:'HP打印机耗材提醒（Outlook）',type:'日常检查',priority:'P3',source:'系统固定任务',status:'待处理'});
      t.templateId='TPL005'; t.fixedDate=NK.today(); t.frequency='邮件触发'; t.trigger='耗材提醒';
    });
    const od = NK.createTask({name:'HP打印机耗材提醒（Outlook）',type:'日常检查',priority:'P3',source:'系统固定任务',status:'已完成'});
    od.templateId='TPL005'; od.fixedDate='2026-08-01'; od.frequency='邮件触发';
    NK.migrateConsumableReminder();
    NK.ensureFixedTasks();
    NK.save();
  })()
`);
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.status==='待处理').length===1`), '迁移后仅保留一条今日待处理的耗材提醒');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.status==='待处理' && x.fixedDate===NK.today()).length===1`), '唯一待处理记录为今日实例');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.status==='已完成').length>=1`), '昨日/历史已完成耗材记录保留（不删除）');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && x.status==='已取消').length>=1`), '旧触发型重复任务归档为已取消（保留历史）');
ok(run(`NK.db.tasks.filter(x=>x.templateId==='TPL005' && NK.taskActive(x) && x.status==='待处理')[0].name==='HP打印机耗材邮件检查（Outlook）'`), '有效待处理记录已统一改名');

// ──────────────────────────────────────────────────────────
console.log('\n【8】花姐助手：唯一匹配即完成并提供撤销');
fresh();
const todayTk = run(`NK.db.tasks.find(x=>x.templateId==='TPL005').id`);
// 直接走 assistant 的 complete_task 流程（唯一匹配）
const r = run(`
  (function(){
    const A = ${asst};
    if (!A || typeof A.handle !== 'function') return 'NO_HANDLE';
    const out = A.handle('完成HP耗材邮件检查');
    return JSON.stringify(out);
  })()
`);
ok(r.length > 0 && r !== 'NO_HANDLE', '花姐助手能响应「完成HP耗材邮件检查」');
ok(run(`NK.db.tasks.find(x=>x.id==='${todayTk}').status==='已完成'`), '唯一匹配后当日提醒被标记为已完成');
ok(run(`(function(){const t=NK.db.tasks.find(x=>x.id==='${todayTk}'); return !t.result && !t.acceptResult && !t.latestFeedback && !t.siteName && !t.engineer;})()`), '完成过程未引导填写职场/打印机/耗材型号等信息');

// ──────────────────────────────────────────────────────────
console.log('\n【9】不影响其他固定任务/派单/告警');
fresh();
ok(run(`NK.db.tasks.filter(x=>NK.taskActive(x) && x.source==='系统固定任务').length>=5`), '其他每日固定任务仍正常生成');
ok(run(`NK.FIXED_DAILY().length>=5`), '每日固定任务模板集合完整');
// 派单正常
const dId = run(`
  (function(){ const d=NK.createDispatch({title:'湖州网络异常',type:'故障',priority:'P2',siteName:'湖州中宏',city:'湖州',engineer:'沈煜钦',planDone:'2026-08-05',planDoneTime:'18:00'}); return d.id; })()
`);
ok(run(`NK.getDispatch && NK.db.dispatches.some(x=>x.id==='${dId}' && x.title==='湖州网络异常')`), '派单创建功能不受影响');

// ──────────────────────────────────────────────────────────
console.log('\n【10】入口已移除：无「收到耗材提醒」按钮/触发逻辑');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');
ok(!/收到耗材提醒/.test(uiSrc), 'ui.js 中已无「收到耗材提醒」按钮文案');
ok(!/UI\.triggerFixed/.test(uiSrc), 'ui.js 中已无 triggerFixed 触发入口函数');
ok(!/triggerTask\(['\"]TPL005/.test(appSrc), 'app.js 中无针对TPL005的触发式创建');
ok(!/triggerFixed\(['\"]TPL005/.test(uiSrc), '无 TPL005 快捷触发按钮调用');
ok(run(`NK.db.handoverTemplates.find(t=>t.id==='TPL005').frequency==='每日'`), 'handoverTemplates 中 TPL005 已同步为每日');
ok(run(`NK.db.handoverTemplates.find(t=>t.id==='TPL005').name==='HP打印机耗材邮件检查（Outlook）'`), 'handoverTemplates 中 TPL005 名称已同步');

// ──────────────────────────────────────────────────────────
console.log('\n【11】data.js 种子同步');
ok(!/HP打印机耗材提醒（Outlook）/.test(dataSrc), 'data.js 中已无旧的触发型耗材模板名');
ok(/HP打印机耗材邮件检查（Outlook）/.test(dataSrc), 'data.js 中已更新为新的每日邮件检查模板名');
ok(/查看Outlook中是否收到HP打印机耗材提醒邮件/.test(dataSrc), 'data.js 中模板说明已更新');

console.log('\n═══════════════════════════════');
console.log(`结果：${pass} 通过，${fail} 失败`);
console.log('═══════════════════════════════');
process.exit(fail ? 1 : 0);
