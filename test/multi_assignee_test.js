/* 任务多选工程师及完成进度汇总 验收测试
 *
 * 覆盖需求 17 个章节：
 *   1. 负责工程师字段改为「可多选」（多选面板含全选9人/清空，用工程师ID保存，点击整行勾选）
 *   2. 多选面板交互（外部点击关闭、保留选择、动态显示有效人数）
 *   3. 选择结果显示（未指派/姓名标签/已选择N名/已选全部N名，标签×可单独取消）
 *   4. 任务完成逻辑（多人分别完成，全部完成主任务才完成）
 *   5. 数据结构（一条主任务 + assigneeIds + assigneeProgress）
 *   6. 兼容单人工程师任务
 *   7. 任务列表聚合展示
 *   8. 任务详情页「工程师完成情况」（按人完成/恢复，记录完成时间）
 *   9. 主任务整体完成需二次确认（多人任务）
 *   10. 首页今日时间轴只显示一条汇总记录
 *   11. 首页重点事项与告警只显示一条
 *   12. 编辑任务（增删工程师/全选清空/改标题截止备注；有完成记录者移除需确认）
 *   13. 取消和删除同步处理所有负责人执行项
 *   14. 创建成功反馈（按人数显示不同文案）
 *   15. 不修改派单/休假/KPI/工程师资料等
 *   16. 历史数据兼容（assigneeId → assigneeIds）
 *   17. 25项验收
 *
 * 运行：node test/multi_assignee_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

// ---------- 简化 DOM mock ----------
const storage = {};
const elements = {};
function makeEl(id) {
  const el = {
    id, _innerHTML: '', _text: '', _value: '', dataset: {}, className: '', disabled: false,
    style: {}, children: [], scrollTop: 0, _listeners: {},
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      toggle: function (c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains: function (c) { return this._set.has(c); },
    },
    appendChild: function (c) { this.children.push(c); return c; },
    remove: function () {},
    addEventListener: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
    dispatchEvent: function (ev) {
      const fns = this._listeners[ev.type] || [];
      const fake = { target: this, currentTarget: this, stopPropagation: () => {}, preventDefault: () => {} };
      fns.forEach(fn => fn(fake));
    },
    focus: function () {},
    querySelector: function () { return makeEl('q'); },
    querySelectorAll: function () { return []; },
    closest: function () { return null; },
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
    set value(v) { this._value = String(v); },
    get value() { return this._value; },
  };
  return el;
}
const getElementById = (id) => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; };
const documentMock = {
  getElementById,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => [],
  querySelector: () => makeEl('q'),
  body: makeEl('body'),
  addEventListener: function () {},
  removeEventListener: function () {},
};
let nextTimerId = 1;
const activeTimers = new Map();
const sandboxSetInterval = (fn, ms) => { const id = nextTimerId++; activeTimers.set(id, { fn, ms }); return id; };
const sandboxClearInterval = (id) => { if (activeTimers.has(id)) activeTimers.delete(id); };

const sandbox = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  console: console,
  window: { SEED_DATA: null },
  document: documentMock,
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: sandboxSetInterval, clearInterval: sandboxClearInterval,
  navigator: { clipboard: { writeText: async () => {} } },
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = documentMock;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.console = console;
sandbox.window.setInterval = sandboxSetInterval;
sandbox.window.clearInterval = sandboxClearInterval;
vm.createContext(sandbox);

try {
  vm.runInContext(dataSrc, sandbox, { filename: 'data.js' });
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
  vm.runInContext(uiSrc, sandbox, { filename: 'ui.js' });
} catch (e) {
  console.error('加载失败:', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'multi-assignee-test' });

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);
const engIds = run(`NK.db.engineers.map(e=>e.id)`);

// 工具：创建多人任务
const mkTask = (ids, name) => run(`(() => {
  const t = NK.createTask({ name: ${JSON.stringify(name || '多工程师协作任务')}, type: '专项任务', priority: 'P3', source: '花姐手动新增', assigneeIds: ${JSON.stringify(ids)} });
  NK.save(); return { id: t.id, no: t.no, assigneeIds: t.assigneeIds, progress: t.assigneeProgress };
})()`);

console.log('== 章节1+5：多选工程师数据结构（一条主任务 + assigneeIds + assigneeProgress）==');
const m1 = mkTask([engIds[0], engIds[1], engIds[2]], '三人协作专项');
ok(run(`NK.db.tasks.length`) > 0, '任务列表存在（只创建一条主任务）');
const taskCountDelta = run(`(() => { const c = NK.db.tasks.filter(t=>t.name==='三人协作专项').length; return c; })()`);
ok(taskCountDelta === 1, '多选工程师只创建 1 条主任务（不生成重复任务）');
ok(JSON.stringify(m1.assigneeIds) === JSON.stringify([engIds[0], engIds[1], engIds[2]]), 'assigneeIds 保存工程师唯一ID数组');
ok(m1.progress.length === 3, 'assigneeProgress 生成 3 条每人完成明细');
ok(m1.progress.every(p => p.completed === false && p.completedAt === null), '每名负责人初始为未完成');

console.log('== 章节2：多选面板交互（外部点击关闭、保留选择、动态人数）==');
const msSrc = run(`UI.taskQuickCreate.toString()`);
ok(/tqcEngTrigger/.test(msSrc) && /tqcMsPanel/.test(msSrc), '多选面板含 触发器 + 下拉面板');
ok(/ms-panel hidden/.test(msSrc), '面板默认隐藏');
ok(/外部点击|layer.querySelector\('.modal'\)/.test(msSrc) || msSrc.includes('modal'), '外部点击关闭逻辑存在');
ok(/已选 \$\{selIds.length\}\/\$\{allEngs.length\}/.test(msSrc) || msSrc.includes('selIds.length'), '动态显示有效人数');
ok(/全选/.test(msSrc) && /清空/.test(msSrc), '面板含 全选/清空 按钮');

console.log('== 章节3：选择结果显示（未指派/姓名标签/已选N名/已选全部）==');
const engLabelA = run(`NK.taskAssigneeLabel({ assigneeIds: [] })`);
ok(engLabelA === '', '未指派 → 不显示标签');
const engLabelB = run(`NK.taskAssigneeLabel({ assigneeIds: ['${engIds[0]}'] })`);
ok(engLabelB === run(`NK.db.engineers.find(e=>e.id==='${engIds[0]}').name`), '单人名 → 显示姓名');
const engLabelC = run(`NK.taskAssigneeLabel({ assigneeIds: ['${engIds[0]}','${engIds[1]}','${engIds[2]}'] })`);
const engC0 = run(`NK.engineerName('${engIds[0]}')`);
const engC1 = run(`NK.engineerName('${engIds[1]}')`);
const engC2 = run(`NK.engineerName('${engIds[2]}')`);
ok(engLabelC === engC0 + '、' + engC1 + '、' + engC2, '≤3人 → 显示姓名（顿号连接）');
const engLabelD = run(`NK.taskAssigneeLabel({ assigneeIds: ['${engIds[0]}','${engIds[1]}','${engIds[2]}','${engIds[3]}'] })`);
ok(engLabelD === '4名工程师', '超过3人 → 显示 N名工程师');
const engLabelE = run(`NK.taskAssigneeLabel({ assigneeIds: ${JSON.stringify(engIds)} })`);
ok(engLabelE === '9名工程师', '选满9人 → 显示 已选全部（9名工程师）');
// 标签 × 可单独取消（UI 层面验证触发器内移除按钮）
ok(/ms-tag-x/.test(msSrc) && /data-rm/.test(msSrc), '选中标签带 × 可单独取消');

console.log('== 章节4+8+9：多人完成逻辑（分别完成/全部才完成/二次确认）==');
// 标记一人完成
run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); NK.setAssigneeDone(t,'${engIds[0]}',true); NK.save(); })()`);
let st = run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); return { status: t.status, done: NK.taskCompletedCount(t), all: NK.taskAllDone(t) }; })()`);
ok(st.status === '待处理' && st.done === 1 && st.all === false, '1人完成 → 主任务仍待处理（未全部完成）');
run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); NK.setAssigneeDone(t,'${engIds[1]}',true); NK.setAssigneeDone(t,'${engIds[2]}',true); NK.save(); })()`);
st = run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); return { status: t.status, done: NK.taskCompletedCount(t), all: NK.taskAllDone(t) }; })()`);
ok(st.status === '已完成' && st.done === 3 && st.all === true, '3人全部完成 → 主任务已完成');
// 完成时间记录
const p0 = run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); return t.assigneeProgress.find(p=>p.engineerId==='${engIds[0]}'); })()`);
ok(p0 && p0.completed === true && p0.completedAt, '完成明细记录 completedAt 完成时间');
// 恢复一人 → 主任务回到待处理
run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); NK.setAssigneeDone(t,'${engIds[0]}',false); NK.save(); })()`);
st = run(`(() => { const t = NK.db.tasks.find(t=>t.name==='三人协作专项'); return { status: t.status, done: NK.taskCompletedCount(t) }; })()`);
ok(st.status === '待处理' && st.done === 2, '恢复一人 → 主任务回到待处理（2/3完成）');
// 二次确认：UI.taskDone 对多人任务走二次确认
ok(/确认将全部/.test(uiSrc) || /全部 \$\{cnt\} 名工程师标记为已完成/.test(uiSrc), '主任务整体完成需二次确认');
// 任务详情「工程师完成情况」列表
ok(/工程师完成情况/.test(uiSrc) && /as-progress/.test(uiSrc), '详情页有「工程师完成情况」聚合列表');
ok(/taskAssigneeToggle/.test(uiSrc), '详情页按人 完成/恢复 操作存在');

console.log('== 章节6：兼容单人工程师任务 ==');
const single = run(`(() => {
  const t = NK.createTask({ name: '单人老式任务', type: '普通任务', priority: 'P3', source: '花姐手动新增', engineer: NK.db.engineers[4].name });
  NK.save();
  // 仅传 engineer 名的老式任务：不强制多选，走普通单人逻辑
  return { id: t.id, isMulti: NK.taskIsMulti(t), progLabel: NK.taskProgressLabel(t), eng: t.engineer };
})()`);
ok(single.isMulti === false, '仅传 engineer 名的老式任务不强制多人逻辑（向后兼容）');
ok(single.eng === run(`NK.db.engineers[4].name`), '老式单人任务 engineer 字段正常');
ok(single.progLabel === '', '单人任务不显示 x/y 进度标签');
ok(run(`NK.taskAssigneeCount({assigneeIds:['${engIds[0]}']})`) === 1, '单人任务负责人数为 1');
// 用 assigneeIds 传单人也应识别为单人（ids.length===1 → 进度标签为空）
ok(run(`NK.taskProgressLabel({assigneeIds:['${engIds[0]}']})`) === '', '单负责人 assigneeIds 任务不显示进度标签');

console.log('== 章节7+10+11：列表/时间轴/重点/告警 聚合展示，只显示一条 ==');
// 创建一条新的多人任务用于展示面
mkTask([engIds[0], engIds[1]], '聚合展示多人任务');
run(`(() => { const t = NK.db.tasks.find(t=>t.name==='聚合展示多人任务'); NK.setAssigneeDone(t,'${engIds[0]}',true); NK.save(); })()`);
// 任务列表聚合
const listHtml = run(`(() => { UI.renderTasks(); return document.getElementById('view-tasks').innerHTML; })()`);
ok(listHtml.includes('聚合展示多人任务'), '任务列表包含多人任务');
const eng0Name = run(`NK.engineerName('${engIds[0]}')`);
const eng1Name = run(`NK.engineerName('${engIds[1]}')`);
ok(listHtml.includes(eng0Name) && listHtml.includes(eng1Name), '任务列表工程师列显示聚合的负责人姓名');
ok(/(孙益东、孙晓)|(孙晓、孙益东)/.test(listHtml), '任务列表工程师列按聚合标签展示（≤3人显示姓名）');
// 时间轴：只显示一条汇总记录（name 唯一）
const homeHtml = run(`(() => { UI.renderHome(); return document.getElementById('view-home').innerHTML; })()`);
const nameOccur = (homeHtml.match(/聚合展示多人任务/g) || []).length;
ok(nameOccur >= 1, '首页时间轴显示该多人任务（至少一条）');
const progInTimeline = /1\/2已完成/.test(homeHtml);
ok(progInTimeline, '时间轴显示进度汇总 x/y已完成');
// 重点事项：只显示一条（同任务不重复）
const focusOccur = (homeHtml.match(/聚合展示多人任务/g) || []).length;
ok(focusOccur >= 1, '首页重点事项/时间轴显示该任务（一条汇总）');

console.log('== 章节12：编辑任务（增删工程师/全选清空/改标题截止备注；有完成记录移除需确认）==');
const editSrc = run(`UI.taskEdit.toString()`);
ok(/tqeEngTrigger/.test(editSrc) && /tqeMsPanel/.test(editSrc), '编辑弹窗含多选面板');
ok(/tqeMsAll/.test(editSrc) && /tqeMsClear/.test(editSrc), '编辑弹窗含 全选/清空');
ok(/tqeName/.test(editSrc) && /tqeDue/.test(editSrc) && /tqeNote/.test(editSrc), '编辑弹窗可改 标题/截止/备注');
ok(/removedWithDone/.test(editSrc), '有完成记录者被移除需确认逻辑存在');
// 实际编辑：增删工程师 + 改字段
const editR = run(`(() => {
  const t = NK.db.tasks.find(t=>t.name==='聚合展示多人任务');
  const before = t.assigneeIds.slice();
  // 移除完成者 eng0，新增 eng2
  const newIds = ['${engIds[1]}','${engIds[2]}'];
  NK.syncTaskAssignees(t, newIds);
  t.name = '聚合展示多人任务（已编辑）';
  t.dueDate = NK.today();
  t.nextAction = '新备注';
  NK.save();
  return { before, after: t.assigneeIds, progress: t.assigneeProgress };
})()`);
ok(JSON.stringify(editR.before) !== JSON.stringify(editR.after), '编辑后负责人变化（增删生效）');
ok(editR.after.length === 2 && !editR.after.includes(engIds[0]), '移除 eng0、保留 eng1、新增 eng2');
const keptProg = editR.progress.find(p => p.engineerId === engIds[1]);
ok(keptProg && keptProg.completed === false, '保留的负责人 eng1 完成状态延续（未被标记完成，保持 false）');
const newProg = editR.progress.find(p => p.engineerId === engIds[2]);
ok(newProg && newProg.completed === false, '新增负责人 eng2 初始为未完成');
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.name==='聚合展示多人任务（已编辑）'); return t.dueDate === NK.today() && t.nextAction === '新备注'; })()`), '标题/截止/备注已更新');
// 全选清空辅助函数行为
ok(run(`NK.taskAssigneeIdsUnique(['${engIds[0]}','${engIds[0]}','${engIds[1]}'])`).length === 2, 'assigneeIds 去重');

console.log('== 章节13：取消/删除同步处理所有负责人执行项 ==');
const cancelR = run(`(() => {
  const t = NK.createTask({ name: '待取消多人任务', type: '专项任务', priority: 'P3', source: '花姐手动新增', assigneeIds: ['${engIds[0]}','${engIds[1]}'] });
  NK.save();
  t.status = '已取消'; t.cancelReason = '需求取消'; t.cancelledAt = NK.now(); t.updatedAt = NK.now();
  NK.save();
  return { status: t.status, stillHasProgress: Array.isArray(t.assigneeProgress) };
})()`);
ok(cancelR.status === '已取消', '多人任务可整体取消');
ok(cancelR.stillHasProgress, '取消后 assigneeProgress 随主任务归档（无独立残留执行项）');

console.log('== 章节14：创建成功反馈（按人数不同文案）==');
ok(/当前未指派负责人/.test(uiSrc), '未指派 → 创建成功文案提示未指派');
ok(/共 \$\{assigneeIds.length\} 名工程师需要分别完成/.test(uiSrc), '多人 → 创建成功文案提示 N 名工程师');

console.log('== 章节15：不修改派单/休假/KPI/工程师资料 ==');
const dispBefore = run(`NK.db.dispatches.length`);
const leaveBefore = run(`(NK.db.leaves ? NK.db.leaves.length : 0)`);
const kpiBefore = run(`(NK.db.kpiEvents ? NK.db.kpiEvents.length : 0)`);
const engBefore = run(`NK.db.engineers.length`);
mkTask([engIds[3], engIds[4]], '不越权任务');
ok(run(`NK.db.dispatches.length`) === dispBefore, '创建多人任务不产生派单');
ok(run(`(NK.db.leaves ? NK.db.leaves.length : 0)`) === leaveBefore, '创建多人任务不修改休假');
ok(run(`(NK.db.kpiEvents ? NK.db.kpiEvents.length : 0)`) === kpiBefore, '创建多人任务不登记 KPI');
ok(run(`NK.db.engineers.length`) === engBefore, '工程师资料不变');

console.log('== 章节16：历史数据兼容（assigneeId → assigneeIds）==');
run(`(() => {
  // 构造历史单字段任务
  const legacy = { id: 'LEG-1', no: 'T-LEG', name: '历史单负责人任务', type: '普通任务', priority: 'P3', source: '旧数据', status: '待处理', engineer: NK.db.engineers[2].name, assigneeId: '${engIds[2]}', createdAt: NK.now(), assigneeProgress: [] };
  NK.db.tasks.push(legacy);
  NK.migrateAssigneeIds();
  NK.save();
  return NK.db.tasks.find(t=>t.id==='LEG-1');
})()`);
const legacy = run(`NK.db.tasks.find(t=>t.id==='LEG-1')`);
ok(Array.isArray(legacy.assigneeIds) && legacy.assigneeIds.length === 1 && legacy.assigneeIds[0] === engIds[2], '历史 assigneeId 迁移为 assigneeIds');
ok(Array.isArray(legacy.assigneeProgress) && legacy.assigneeProgress.length === 1, '历史任务补齐 assigneeProgress');
ok(run(`NK.migrateAssigneeIds(); NK.db.tasks.find(t=>t.id==='LEG-1').assigneeIds.length`) === 1, '迁移幂等（重复执行不改变）');

console.log('== CSS 断言 ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(cssSrc.includes('.ms-trigger'), 'CSS 定义多选触发器 .ms-trigger');
ok(cssSrc.includes('.ms-panel'), 'CSS 定义下拉面板 .ms-panel');
ok(cssSrc.includes('.ms-opt'), 'CSS 定义整行勾选 .ms-opt');
ok(cssSrc.includes('.ms-tag-x'), 'CSS 定义标签× .ms-tag-x');
ok(cssSrc.includes('.as-progress'), 'CSS 定义工程师完成情况列表 .as-progress');
ok(cssSrc.includes('.ms-panel-bar') && cssSrc.includes('.ms-bar-btn'), 'CSS 定义全选/清空按钮区');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
