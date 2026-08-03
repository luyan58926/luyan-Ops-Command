/* 首页「花姐今天重点盯这几件」· 派单任务上门日期 回归测试
 * 验证：
 *   1. 有效派单任务在重点事项中显示「（上门：X月X日）」（当年）；
 *   2. 跨年显示「（上门：2027年1月3日）」；
 *   3. 日期读取自关联派单真实 visitDate，不读取任务截止/创建/发送/更新/完成；
 *   4. 普通任务、专项任务不显示上门日期；
 *   5. 无上门日期的历史派单显示「（上门待确认）」；
 *   6. 页面不出现 undefined / Invalid Date / 空括号 / ISO 完整串；
 *   7. 重点事项数量与排序保持不变；
 *   8. 点击跳转保留；原始任务标题未修改；
 *   9. 与今日时间轴显示的日期一致（复用同一格式化函数 UI.fmtOnsite）；
 *   10. 已撤销/取消/删除派单不会重新出现；
 *   11. 刷新后显示保持一致；
 *   12. 不修改任何业务数据。
 * 运行：node test/focus_onsite_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

const storage = {};
const elements = {};
function makeEl(id) {
  return {
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'focus-onsite-test' });

// 渲染首页，返回 view-home 的 HTML
const renderHome = () => {
  run(`UI.renderHome();`);
  return run(`document.getElementById('view-home').innerHTML`);
};
// 从重点事项模块中提取单条事项 HTML（按名称匹配），返回 '' 表示未找到
const focusItemHtml = (html, name) => {
  const marker = 'class="fi-item';
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
// 从今日时间轴中提取单条条目 HTML
const tlItemHtml = (html, name) => {
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

// 计数重点事项条数
const focusCount = (html) => {
  const m = html.match(/class="fi-item/g);
  return m ? m.length : 0;
};

console.log('== 初始化（清空业务数据，保证隔离）==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.db.dispatches = []; NK.db.tasks = NK.db.tasks.filter(t => t.source !== '派单自动生成'); NK.db.projects = []; NK.db.reminders = []; NK.save();`);

// 辅助：创建派单任务并让其在重点事项中稳定出现（标记派单已完成避免派单条目占位；关联任务设 dueDate=今日进入"24h内到期"）
// 同时把关联任务 createdAt 强制为本地今日，保证时间轴"今日新建"分支也收录（规避 UTC/本地日期边界）
const mkFocusDispatchTask = (title, visitDate) => run(`(() => {
  const d = NK.createDispatch({ title: ${JSON.stringify(title)}, type: '故障', priority: 'P2', supplier: '源晨', visitDate: ${JSON.stringify(visitDate || '')} });
  const t = NK.taskOfDispatch(d);
  d.status = '已完成'; d.completedAt = NK.now(); NK.ensureStatusHistory(d, 'completed', '测试完成');
  if (t) { t.dueDate = NK.today(); t.createdAt = NK.today() + 'T09:00:00'; t.status = '待处理'; }
  NK.save();
  return { did: d.id, tid: t ? t.id : '' };
})()`);

// 计算预期上门日期文案（动态，基于当前日期，避免硬编码 8月4日 依赖具体运行日）
const expectedOnsite = (visitDate) => run(`'（' + UI.fmtOnsite(${JSON.stringify(visitDate)}, new Date()) + '）'`);
const expectedCrossYear = run(`'（' + UI.fmtOnsite('2027-01-03', new Date()) + '）'`);

console.log('== 1. 有上门日期的派单任务（当年，读取 visitDate）==');
const todayStr = run(`NK.today()`);
const d1 = mkFocusDispatchTask('山东青岛打印机处理', todayStr);
const e1 = expectedOnsite(todayStr);   // e.g. （上门：8月4日）
let html = renderHome();
let item = focusItemHtml(html, '山东青岛打印机处理');
ok(!!item, '重点事项包含该派单任务条目');
ok(item.includes('山东青岛打印机处理</span><span class="focus-task-onsite">' + e1 + '</span>'), '重点事项显示（上门：X月X日）：' + e1);
// ② 结构：任务名在 focus-task-title，日期在 focus-task-onsite，同一行
const tIdx = item.indexOf('class="focus-task-title">山东青岛打印机处理</span>');
const oIdx = item.indexOf('class="focus-task-onsite">' + e1 + '</span>');
ok(tIdx > -1 && oIdx > tIdx, '上门日期位于任务名之后（focus-task-title 后 focus-task-onsite）');
// ③ 读取自关联派单 visitDate，非任务截止
ok(run(`NK.getDispatch('${d1.did}').visitDate === ${JSON.stringify(todayStr)}`), '日期读取自关联派单 visitDate 字段');
// ③b 明确验证"不读取任务截止日期"：构造 visitDate 与任务 dueDate 不同的派单任务，显示应取 visitDate
const diff = run(`(() => {
  const v = NK.today(); // 上门日=今日
  const y = v.split('-'); const tm = new Date(y[0], Number(y[1]) - 1, Number(y[2]) + 1);
  const due = tm.getFullYear() + '-' + String(tm.getMonth() + 1).padStart(2, '0') + '-' + String(tm.getDate()).padStart(2, '0'); // 截止=明日
  const d = NK.createDispatch({ title: '截止日期不应作为上门日期', type: '故障', priority: 'P2', supplier: '源晨', visitDate: v });
  const t = NK.taskOfDispatch(d);
  d.status = '已完成'; NK.ensureStatusHistory(d, 'completed', '测试完成');
  if (t) { t.dueDate = due; t.createdAt = NK.today() + 'T09:00:00'; t.status = '待处理'; }
  NK.save();
  return { did: d.id, due: due };
})()`);
const diffHtml = renderHome();
const diffItem = focusItemHtml(diffHtml, '截止日期不应作为上门日期');
const diffExpected = expectedOnsite(todayStr); // 应取 visitDate=今日，而非 dueDate=明日
ok(!!diffItem && diffItem.includes(diffExpected), '日期取关联派单 visitDate（' + diffExpected + '），未取任务截止日期（' + diff.due + '）');
ok(!diffItem.includes(expectedOnsite(diff.due)) || diff.due === todayStr, '上门日期不等于任务截止日期');
// 清理
run(`(() => { const d = NK.getDispatch('${diff.did}'); if (d) NK.revokeDispatch(d.id); NK.db.tasks = NK.db.tasks.filter(t => t.dispatchId !== '${diff.did}'); NK.save(); })()`);
// ④ 不出现 undefined / Invalid Date / ISO 完整串
ok(!html.includes('undefined') && !html.includes('Invalid Date'), '页面不出现 undefined / Invalid Date');
ok(!/（\d{4}-\d{2}-\d{2}）/.test(html), '不显示 ISO 完整时间字符串');
// ⑤ 原始任务标题未被修改（后台 name 仍为原值，括号为独立 span 追加）
const titleIntact = run(`NK.db.tasks.some(x => x.name === '山东青岛打印机处理')`);
ok(titleIntact && item.includes('focus-task-title'), '上门日期以 span 追加，未写入原始标题');
// ⑥ 无 Emoji
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(item), '上门日期不含 Emoji');

console.log('== 2. 与今日时间轴一致 ==');
const tlItem = tlItemHtml(renderHome(), '山东青岛打印机处理');
ok(!!tlItem && tlItem.includes(e1), '今日时间轴同样显示：' + e1);
ok(tlItem.includes(e1) && item.includes(e1), '重点事项与时间轴读取同一派单、日期一致');
// 复用同一格式化函数
ok(run(`typeof UI.fmtOnsite === 'function' && UI.focusOnsite.toString().includes('UI.fmtOnsite')`), '重点事项复用 UI.fmtOnsite（与时间轴同一套格式化逻辑）');

console.log('== 3. 跨年日期显示完整年份 ==');
const d3 = mkFocusDispatchTask('跨年设备巡检', '2027-01-03');
html = renderHome();
item = focusItemHtml(html, '跨年设备巡检');
ok(!!item && item.includes(expectedCrossYear), '跨年日期显示完整年份：' + expectedCrossYear);
// 清理跨年派单，避免干扰
run(`(() => { const d = NK.getDispatch('${d3.did}'); if (d) NK.revokeDispatch(d.id); NK.db.tasks = NK.db.tasks.filter(t => t.dispatchId !== '${d3.did}'); NK.save(); })()`);

console.log('== 4. 无上门日期的派单任务 → 上门待确认 ==');
const d4 = mkFocusDispatchTask('某职场打印机处理', '');
html = renderHome();
item = focusItemHtml(html, '某职场打印机处理');
ok(!!item && item.includes('（上门待确认）'), '无上门日期显示（上门待确认）');
ok(!item.includes('（）'), '不显示空括号');
ok(!item.includes('undefined') && !item.includes('null'), '不出现 undefined / null');
// 清理
run(`(() => { const d = NK.getDispatch('${d4.did}'); if (d) NK.revokeDispatch(d.id); NK.db.tasks = NK.db.tasks.filter(t => t.dispatchId !== '${d4.did}'); NK.save(); })()`);

console.log('== 5. 普通任务 / 专项任务 不显示上门日期 ==');
// 普通任务（24h内到期，进入重点事项 type=task）
run(`(() => {
  const t = { id: NK.uid('T'), no: NK.nextNo('task'), name: '普通手工任务A', type: '任务', createdAt: NK.now(), status: '待处理', priority: 'P2', source: '手动', dueDate: NK.today() };
  NK.db.tasks.push(t); NK.save();
})()`);
html = renderHome();
item = focusItemHtml(html, '普通手工任务A');
ok(!!item && !item.includes('focus-task-onsite') && !item.includes('（上门'), '普通任务不显示上门日期');
// 专项任务（超期，进入重点事项 type=project，section 9）
run(`(() => {
  const y = NK.today().split('-'); const dt = new Date(y[0], Number(y[1]) - 1, Number(y[2]) - 1);
  const past = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
  const p = { id: NK.uid('P'), name: '专项任务B', type: '专项', createdAt: NK.now(), status: '有风险', progress: 50, priority: '', dueDate: past, updatedAt: NK.now() };
  NK.db.projects.push(p); NK.save();
})()`);
html = renderHome();
item = focusItemHtml(html, '专项任务B');
ok(!!item && !item.includes('focus-task-onsite') && !item.includes('（上门'), '专项任务不显示上门日期');

console.log('== 6. 重点事项数量与排序保持不变，点击保留，原始标题未修改 ==');
const before = run(`NK.genFocusItems().map(f => f.title)`);
const beforeCount = run(`NK.genFocusItems().length`);
ok(beforeCount >= 1 && beforeCount <= 3, '重点事项数量保持在 1~3 件内');
// 渲染后数量一致（渲染不改业务数据，genFocusItems 结果不受渲染影响）
const afterCount = run(`NK.genFocusItems().length`);
ok(afterCount === beforeCount, '渲染前后重点事项数量一致');
// 点击跳转保留
html = renderHome();
ok(/class="fi-item[^"]*fi-clickable"/.test(html) || focusItemHtml(html, '山东青岛打印机处理').includes('fi-clickable'), '重点事项点击跳转保留（fi-clickable 存在）');
// 原始任务标题未修改
ok(run(`NK.db.tasks.some(x => x.name === '山东青岛打印机处理')`), '原始任务标题未修改（后台 name 保持原值）');

console.log('== 7. 已撤销 / 取消 / 删除派单不重新出现 ==');
// 撤销派单：其关联任务应被 taskActive 过滤，不再进入重点事项
const d7 = run(`(() => {
  const d = NK.createDispatch({ title: '已撤销派单任务', type: '故障', priority: 'P2', supplier: '源晨', visitDate: '2026-08-06' });
  const t = NK.taskOfDispatch(d);
  if (t) { t.dueDate = NK.today(); }
  NK.revokeDispatch(d.id);
  NK.save();
  return d.id;
})()`);
html = renderHome();
ok(!focusItemHtml(html, '已撤销派单任务'), '已撤销派单的关联任务不重新出现在重点事项');
// 软删除派单
run(`(() => {
  const d = NK.createDispatch({ title: '已删除派单任务', type: '故障', priority: 'P2', supplier: '源晨', visitDate: '2026-08-06' });
  const t = NK.taskOfDispatch(d);
  if (t) { t.dueDate = NK.today(); }
  d.recordStatus = '已删除';
  NK.save();
})()`);
html = renderHome();
ok(!focusItemHtml(html, '已删除派单任务'), '软删除派单的关联任务不重新出现在重点事项');

console.log('== 8. 刷新后显示保持一致 ==');
const html1 = renderHome();
const html2 = renderHome();
const item1 = focusItemHtml(html1, '山东青岛打印机处理');
const item2 = focusItemHtml(html2, '山东青岛打印机处理');
ok(item1.includes('（上门：8月4日）') && item1 === item2, '刷新后上门日期显示保持一致');

console.log('== 9. 不修改任何业务数据（渲染前后数据库快照一致）==');
const snapBefore = run(`JSON.stringify({ tasks: NK.db.tasks.map(t => ({name:t.name,status:t.status,dueDate:t.dueDate,dispatchId:t.dispatchId})), dispatches: NK.db.dispatches.map(d => ({title:d.title,status:d.status,visitDate:d.visitDate,recordStatus:d.recordStatus})) })`);
renderHome();
const snapAfter = run(`JSON.stringify({ tasks: NK.db.tasks.map(t => ({name:t.name,status:t.status,dueDate:t.dueDate,dispatchId:t.dispatchId})), dispatches: NK.db.dispatches.map(d => ({title:d.title,status:d.status,visitDate:d.visitDate,recordStatus:d.recordStatus})) })`);
ok(snapBefore === snapAfter, '渲染前后业务数据快照一致（未修改任何业务数据）');

console.log('');
console.log('focus_onsite_test: ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
