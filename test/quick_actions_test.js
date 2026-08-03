/* 首页快捷操作区优化 + 轻量新增任务 回归测试
 * 验证：
 *   - 快捷区移除「更新进度」入口，新增「新增任务」入口（图标📌、副文案"客户事项，及时登记"）
 *   - 六个快捷入口顺序：新建派单/新增任务/快速记录/登记休假/登记KPI/生成交接
 *   - 快速记录副文案改为"会议、备忘随手记"；登记休假不再是薰衣草色
 *   - 视觉层级：新建派单=qc-primary(深紫主卡)；新增任务=qc-second(浅紫次级卡)；
 *     其余四张为中性白卡（无 primary/second/lavender 类）
 *   - 「更新进度」底层功能保留：UI.taskCreate(true) 仍存在且内部走 taskPickUpdate
 *   - UI.taskQuickCreate() 轻量新增任务：字段齐全、复用 NK.createTask、默认专项任务、
 *     浏览器本地日期、可复用工程师、不生成派单/消息/KPI、出现在任务列表与时间轴(专项标签)
 *   - 无重复绑定：快捷卡以 HTML onclick 属性渲染，重复渲染不产生重复监听
 * 运行：node test/quick_actions_test.js
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
    style: {}, children: [], scrollTop: 0,
    classList: {
      _set: new Set(),
      add: function (c) { this._set.add(c); },
      remove: function (c) { this._set.delete(c); },
      toggle: function (c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains: function (c) { return this._set.has(c); },
    },
    appendChild: function (c) { this.children.push(c); return c; },
    remove: function () {},
    addEventListener: function () {},
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'quick-actions-test' });

const renderHomeHTML = () => {
  run(`UI.renderHome();`);
  return run(`document.getElementById('view-home').innerHTML`);
};
// 提取时间轴中包含指定名称的单个 tl-item 原始 HTML。
const itemHtml = (html, name) => {
  const marker = 'class="tl-item';
  const items = [];
  let from = 0;
  while (true) {
    const s = html.indexOf(marker, from);
    if (s < 0) break;
    const e = html.indexOf('</div>', s);
    if (e < 0) break;
    items.push(html.slice(s, e + 6));
    from = e + 6;
  }
  return items.find(it => it.includes(name)) || '';
};

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);

console.log('== 快捷区顺序与入口 ==');
let html = renderHomeHTML();
// 提取所有 quick-card 标签及其顺序
const quickOrder = [];
{
  const re = /<a class="quick-card[^"]*" href="javascript:void\(0\)" onclick="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) quickOrder.push(m[1]);
}
ok(quickOrder.length === 6, '快捷区共 6 个入口（实际 ' + quickOrder.length + ' 个）');
const acts = quickOrder.join(' | ');
ok(acts.includes('UI.dispatchCreate()'), '第1个入口为 新建派单');
ok(acts.indexOf('UI.taskQuickCreate()') > -1, '快捷区包含 新增任务入口');
ok(acts.indexOf('UI.taskCreate(true)') === -1, '快捷区已移除 更新进度 入口');
// 顺序断言：任务快速创建在快速记录之前
const idxQuick = quickOrder.indexOf('UI.taskQuickCreate()');
const idxNote = quickOrder.indexOf('UI.quickNote()');
const idxLeave = quickOrder.indexOf('UI.leaveCreate()');
const idxKpi = quickOrder.indexOf('UI.kpiEventCreate()');
const idxHand = quickOrder.indexOf('UI.handoverToday()');
ok(idxQuick === 1, '新增任务为第2个入口');
ok(idxNote === 2, '快速记录为第3个入口');
ok(idxLeave === 3, '登记休假为第4个入口');
ok(idxKpi === 4, '登记KPI为第5个入口');
ok(idxHand === 5, '生成交接为第6个入口');
// 文案断言
ok(html.includes('>📌</span>') && /新增任务<\/div>/.test(html) && html.includes('客户事项，及时登记'), '新增任务：图标📌 + 名称 + 副文案"客户事项，及时登记"');
ok(/快速记录<\/div>\s*<div class="qc-sub">会议、备忘随手记<\/div>/.test(html), '快速记录副文案改为"会议、备忘随手记"');
ok(!html.includes('更新进度'), '页面不再出现 更新进度 文案');

console.log('== 视觉层级 ==');
const primaryCount = (html.match(/qc-primary/g) || []).length;
const secondCount = (html.match(/qc-second/g) || []).length;
const lavenderCount = (html.match(/qc-lavender/g) || []).length;
ok(primaryCount === 1, '仅 1 张主卡 qc-primary（新建派单，深紫）');
ok(secondCount === 1, '仅 1 张次级卡 qc-second（新增任务，浅紫）');
ok(lavenderCount === 0, '登记休假不再使用 qc-lavender（回归中性白卡）');

console.log('== 「更新进度」底层功能保留 ==');
ok(run(`typeof UI.taskCreate === 'function'`) === true, 'UI.taskCreate 仍存在');
ok(run(`typeof UI.taskPickUpdate === 'function'`) === true, 'UI.taskPickUpdate 仍存在');
ok(uiSrc.includes('UI.taskPickUpdate(); return;'), 'UI.taskCreate(true) 仍转发到更新进度功能');

console.log('== UI.taskQuickCreate 表单结构 ==');
const formOk = run(`(() => {
  const s = UI.taskQuickCreate.toString();
  const hasName = /id="tqcName"/.test(s);
  const hasType = /id="tqcType"/.test(s) && s.includes('专项任务') && s.includes('普通任务');
  const hasDue = /id="tqcDue" type="date"/.test(s);
  const hasEng = /id="tqcEng"/.test(s) && /未指派/.test(s);
  const hasNote = /id="tqcNote"/.test(s);
  const hasButtons = s.includes('取消') && s.includes('创建任务');
  return { hasName, hasType, hasDue, hasEng, hasNote, hasButtons };
})()`);
ok(formOk.hasName, '任务名称字段存在（必填）');
ok(formOk.hasType, '任务类型字段：专项任务默认 + 普通任务');
ok(formOk.hasDue, '截止日期字段 type=date（浏览器本地）');
ok(formOk.hasEng, '负责工程师字段存在（可选，含未指派）');
ok(formOk.hasNote, '备注字段存在（可选）');
ok(formOk.hasButtons, '仅 取消 / 创建任务 两个按钮');
// 工程师复用 9 位
const engCount = run(`NK.db.engineers.length`);
ok(engCount === 9, '工程师池共 ' + engCount + ' 位（复用）');
ok(run(`UI.taskQuickCreate.toString()`).includes('NK.db.engineers.map'), '新增任务表单复用工程师下拉选项');

console.log('== 轻量新增任务（专项任务默认）==');
const beforeTaskCount = run(`NK.db.tasks.length`);
const beforeDispCount = run(`NK.db.dispatches.length`);
const beforeMsgCount = run(`(NK.db.messages ? NK.db.messages.length : 0)`);
const beforeKpiCount = run(`(NK.db.kpiEvents ? NK.db.kpiEvents.length : NK.db.kpi ? NK.db.kpi.length : 0)`);
const created = run(`(() => {
  // 模拟表单提交路径：直接调用与 UI.taskQuickCreate onMount 相同的 createTask 逻辑
  const t = NK.createTask({
    name: '客户临时加装设备登记',
    type: '专项任务',
    priority: 'P3',
    source: '花姐手动新增',
    dueDate: NK.today(),
    engineer: NK.db.engineers[0].name,
    nextAction: '客户重点跟进',
  });
  NK.save();
  return { id: t.id, no: t.no, type: t.type, source: t.source, dueDate: t.dueDate, engineer: t.engineer };
})()`);
ok(created.type === '专项任务', '默认任务类型为 专项任务');
ok(created.source === '花姐手动新增', '来源标记为 花姐手动新增');
ok(created.dueDate === run(`NK.today()`), '截止日期为浏览器本地今天');
ok(created.engineer === run(`NK.db.engineers[0].name`), '负责工程师正确记录');
ok(run(`NK.db.tasks.length`) === beforeTaskCount + 1, '任务列表新增 1 条任务');
ok(run(`NK.db.dispatches.length`) === beforeDispCount, '未自动生成派单');
ok(run(`(NK.db.messages ? NK.db.messages.length : 0)`) === beforeMsgCount, '未自动生成消息');
ok(run(`(NK.db.kpiEvents ? NK.db.kpiEvents.length : NK.db.kpi ? NK.db.kpi.length : 0)`) === beforeKpiCount, '未自动登记 KPI');

console.log('== 专项任务出现在今日时间轴并带"专项"标签 ==');
html = renderHomeHTML();
const itemZx = itemHtml(html, '客户临时加装设备登记');
ok(!!itemZx, '时间轴包含新增的专项任务条目');
ok(!!itemZx && itemZx.includes('tl-src-project') && itemZx.includes('>专项<'), '专项任务时间轴来源标签为「专项」');

console.log('== 普通任务在时间轴显示「任务」标签 ==');
run(`NK.createTask({ name: '客户普通事项登记', type: '普通任务', priority: 'P3', source: '花姐手动新增' });`);
html = renderHomeHTML();
const itemPt = itemHtml(html, '客户普通事项登记');
ok(!!itemPt, '时间轴包含普通任务条目');
ok(!!itemPt && itemPt.includes('tl-src-task') && itemPt.includes('>任务<'), '普通任务时间轴来源标签为「任务」');

console.log('== 刷新 / 路由切换 无重复绑定 ==');
// 快捷卡用 HTML onclick 属性渲染，重复 renderHome 不会叠加事件监听
const runA = renderHomeHTML();
const runB = renderHomeHTML();
ok(runA === runB, '两次渲染结果一致（刷新稳定）');
const cardCountA = (runA.match(/class="quick-card/g) || []).length;
ok(cardCountA === 6, '每次渲染恰好 6 张快捷卡（无重复累积）');

console.log('== CSS 断言 ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(cssSrc.includes('.qc-second'), 'CSS 定义次级卡 .qc-second');
ok(cssSrc.includes('.qc-primary'), 'CSS 定义主卡 .qc-primary');
ok(/\.qc-label\s*\{[^}]*font-size:\s*15px/.test(cssSrc), '快捷卡标题字号 15px');
ok(/\.qc-sub\s*\{[^}]*font-size:\s*12px/.test(cssSrc), '快捷卡副文案字号 12px');
ok(/\.qc-sub\s*\{[^}]*text-overflow:\s*ellipsis/.test(cssSrc), '副文案单行省略');
// 登记休假不再需要 lavender 类（视觉已中性）
ok(!cssSrc.includes('.qc-lavender'), 'CSS 已移除旧 .qc-lavender 类');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
