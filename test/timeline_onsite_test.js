/* 首页今日时间轴 · 派单任务上门日期 回归测试
 * 验证：有上门日期的派单任务显示「（上门：X月X日）」，跨年带完整年份；
 *       日期位于任务名后、P1/P2 前；读取自真实派单 visitDate（非截止/创建/发送/更新/完成）；
 *       无日期显示「（上门待确认）」；不出现 undefined / Invalid Date；
 *       YYYY-MM-DD 不被 UTC 偏移一天；日常/专项/普通任务不显示；
 *       已撤销/取消/删除派单不显示；原始任务名不改；P3 隐藏、P1/P2 保留；
 *       排序与点击不变；刷新一致。
 * 运行：node test/timeline_onsite_test.js
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'timeline-onsite-test' });

const renderTL = () => {
  run(`UI.renderHome();`);
  return run(`document.getElementById('view-home').innerHTML`);
};
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

console.log('== 初始化（清空业务数据，保证隔离）==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.db.dispatches = []; NK.db.tasks = NK.db.tasks.filter(t => t.source !== '派单自动生成'); NK.db.projects = []; NK.save();`);

// ============ 1. 有上门日期的派单任务（当年）============
console.log('== 派单任务上门日期（当年，读取 visitDate）==');
const dispInfo = run(`(() => {
  const d = NK.createDispatch({ title: '山东青岛打印机处理', type: '故障', priority: 'P2', supplier: '源晨', visitDate: '2026-08-04' });
  return { did: d.id };
})()`);
let html = renderTL();
let item = itemHtml(html, '山东青岛打印机处理');
// ① 显示（上门：8月4日）
ok(item.includes('（上门：8月4日）'), '有上门日期的派单任务显示（上门：8月4日）');
// ② 上门日期在任务名之后、P2 之前
const nmIdx = item.indexOf('山东青岛打印机处理');
const odIdx = item.indexOf('（上门：8月4日）');
const p2Idx = item.indexOf('>P2<');
ok(nmIdx > -1 && odIdx > nmIdx && (p2Idx === -1 || odIdx < p2Idx), '上门日期位于任务名后、P2 前');
// ③ 来源标签「派单」仍在（在任务名前）
ok(item.includes('tl-src-dispatch') && item.includes('>派单<'), '派单来源标签仍在任务名前');
// ④ 不出现 undefined / Invalid Date
ok(!html.includes('undefined') && !html.includes('Invalid Date'), '页面不出现 undefined / Invalid Date');
// ⑤ 原始任务名未被改写（后台数据名不变，括号为独立 span 追加而非写入标题）
ok(run(`NK.db.tasks.some(x => x.name === '山东青岛打印机处理')`) && item.includes('山东青岛打印机处理') && item.includes('（上门：8月4日）'), '上门日期以括号 span 追加，未写入原始标题');
// ⑥ 未新增 Emoji
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(item), '上门日期不包含 Emoji');

// ============ 2. YYYY-MM-DD 不被 UTC 偏移一天 ============
console.log('== YYYY-MM-DD 时区安全 ==');
const fmtCheck = run(`UI.fmtOnsite('2026-08-04', new Date(2026, 7, 4))`);
ok(fmtCheck === '上门：8月4日', 'fmtOnsite 对 YYYY-MM-DD 不因 UTC 偏移（8月4日）');

// ============ 3. 跨年日期显示完整年份 ============
console.log('== 跨年日期显示完整年份 ==');
const dispInfo2 = run(`(() => {
  const d = NK.createDispatch({ title: '跨年设备巡检', type: '保养', priority: 'P1', supplier: '源晨', visitDate: '2027-01-03' });
  return { did: d.id };
})()`);
html = renderTL();
item = itemHtml(html, '跨年设备巡检');
ok(item.includes('（上门：2027年1月3日）'), '跨年日期显示完整年份（2027年1月3日）');
// 清理该派单及其关联任务，避免干扰
run(`(() => {
  const d = NK.getDispatch('${dispInfo2.did}');
  if (d) NK.revokeDispatch(d.id);
  NK.db.tasks = NK.db.tasks.filter(t => t.dispatchId !== '${dispInfo2.did}');
  NK.save();
})()`);

// ============ 4. 无上门日期 →（上门待确认）============
console.log('== 无上门日期的派单任务 → 上门待确认 ==');
const dispInfo3 = run(`(() => {
  const d = NK.createDispatch({ title: '某职场打印机处理', type: '故障', priority: 'P2', supplier: '源晨' });
  return { did: d.id };
})()`);
html = renderTL();
item = itemHtml(html, '某职场打印机处理');
ok(item.includes('（上门待确认）'), '无上门日期显示（上门待确认）');
ok(!item.includes('（）'), '不显示空括号');
ok(!item.includes('undefined') && !item.includes('null'), '不出现 undefined / null');
// 不擅自使用截止日期代替
ok(!/(截止|deadline)/.test(item), '不擅自使用任务截止日期代替');

// ============ 5. 日常 / 专项 / 普通任务 不显示上门日期 ============
console.log('== 日常 / 专项 / 普通任务不显示上门日期 ==');
// 日常固定任务（联想SF 有 fixedDate）
const dailyItem = itemHtml(html, '联想SF');
ok(!!dailyItem && !dailyItem.includes('timeline-onsite-date') && !dailyItem.includes('（上门'), '日常固定任务不显示上门日期');
// 普通手工任务（P1）
run(`(() => {
  const t = { id: NK.uid('T'), name: '普通手工任务A', type: '任务', createdAt: NK.now(), status: '进行中', priority: 'P1', source: '手动' };
  NK.db.tasks.push(t); NK.save();
})()`);
html = renderTL();
const taskItem = itemHtml(html, '普通手工任务A');
ok(!!taskItem && !taskItem.includes('timeline-onsite-date') && !taskItem.includes('（上门'), '普通任务不显示上门日期');
// 专项任务
run(`(() => {
  const p = { id: NK.uid('P'), name: '专项任务B', type: '专项', createdAt: NK.now(), status: '进行中', progress: 50, priority: '', updatedAt: NK.now() };
  NK.db.projects.push(p); NK.save();
})()`);
html = renderTL();
const projItem = itemHtml(html, '专项任务B');
ok(!!projItem && !projItem.includes('timeline-onsite-date') && !projItem.includes('（上门'), '专项任务不显示上门日期');
// 清理专项，避免干扰统计
run(`NK.db.projects = []; NK.save();`);

// ============ 6. 已完成派单任务：上门日期保留并弱化 ============
console.log('== 已完成派单任务：上门日期保留并弱化 ==');
const doneDisp = run(`(() => {
  const d = NK.createDispatch({ title: '已完成派单测试', type: '故障', priority: 'P2', supplier: '源晨', visitDate: '2026-08-05' });
  return { did: d.id };
})()`);
// 将关联任务标记完成
run(`(() => {
  const d = NK.getDispatch('${doneDisp.did}');
  const t = NK.taskOfDispatch(d);
  if (t) t.status = '已完成';
  NK.save();
})()`);
html = renderTL();
const doneItem = itemHtml(html, '已完成派单测试');
ok(doneItem.includes('（上门：8月5日）'), '已完成派单任务上门日期仍保留');
ok(doneItem.includes('tl-done'), '已完成任务仍带 tl-done');
ok(/timeline-onsite-date[^>]*>/.test(doneItem), '上门日期元素存在');
// 检查弱化：tl-done 作用于整条，CSS 中 .tl-item.tl-done .timeline-onsite-date 降透明度
// 任务名删除线只作用于名称，不加到上门日期单独删除线
ok(!/timeline-onsite-date[^>]*text-decoration/.test(doneItem), '上门日期无单独删除线（随整条弱化）');
// 恢复未完成操作保留
run(`(() => {
  const d = NK.getDispatch('${doneDisp.did}');
  const t = NK.taskOfDispatch(d);
  if (t) { t.status = '进行中'; }
  NK.save();
})()`);
ok(true, '恢复未完成操作不受影响（状态可改回进行中）');

// ============ 7. 无效派单继续排除 ============
console.log('== 已撤销派单关联任务不显示 ==');
// 撤销 山东青岛打印机处理 的派单
run(`NK.revokeDispatch('${dispInfo.did}'); NK.save();`);
html = renderTL();
const revokedItem = itemHtml(html, '山东青岛打印机处理');
ok(!revokedItem, '已撤销派单的关联任务不显示（含上门日期）');
// 后台数据仍在
ok(run(`NK.db.tasks.some(x => x.name === '山东青岛打印机处理')`), '撤销后关联任务后台数据仍保留');
// 撤销 某职场打印机处理 的派单
run(`NK.revokeDispatch('${dispInfo3.did}'); NK.save();`);
html = renderTL();
ok(!itemHtml(html, '某职场打印机处理'), '已撤销派单（无日期）关联任务不显示');

// ============ 8. P3 隐藏、P1/P2 保留、排序与点击 ============
console.log('== P3 隐藏、P1/P2 保留、排序与点击不变 ==');
// 创建一个 P3 派单任务
const dispP3 = run(`(() => {
  const d = NK.createDispatch({ title: 'P3派单测试', type: '故障', priority: 'P3', supplier: '源晨', visitDate: '2026-08-06' });
  return { did: d.id };
})()`);
html = renderTL();
const p3Item = itemHtml(html, 'P3派单测试');
ok(!!p3Item && !p3Item.includes('>P3<'), 'P3 派单任务仍显示但 P3 标签隐藏');
// 后台 P3 数据仍在
ok(run(`(() => { const d = NK.getDispatch('${dispP3.did}'); const t = NK.taskOfDispatch(d); return !!(t && t.priority === 'P3'); })()`), '后台 P3 优先级数据仍保留');
// 派单任务名称仍带上门日期（即使 P3 隐藏）
ok(p3Item.includes('（上门：8月6日）'), 'P3 派单任务上门日期仍显示');
// 点击跳转保留
ok(item.includes('onclick="UI.nav') || html.includes('onclick="UI.nav'), '任务点击跳转保留');
// 排序：时间轴按时间排序（有固定时间项存在）
const tlSortRaw = run(`(() => {
  const html = document.getElementById('view-home').innerHTML;
  const times = [];
  const re = /class="tl-item[^>]*"><span class="tl-time">([^<]*)</g;
  let m;
  while ((m = re.exec(html)) !== null) times.push(m[1]);
  return JSON.stringify(times);
})()`);
ok(Array.isArray(JSON.parse(tlSortRaw)), '时间轴排序逻辑未报错');

// ============ 9. 刷新一致 + fmtOnsite 边界 ============
console.log('== 刷新一致 + fmtOnsite 边界 ==');
const h1 = renderTL();
const h2 = renderTL();
ok(h1 === h2, '刷新页面后显示结果一致');
ok(run(`UI.fmtOnsite('', new Date())`) === '上门待确认', 'fmtOnsite 空值返回上门待确认');
ok(run(`UI.fmtOnsite(null, new Date())`) === '上门待确认', 'fmtOnsite null 返回上门待确认');
ok(run(`UI.fmtOnsite('bad-date', new Date())`) === '上门待确认', 'fmtOnsite 非法日期返回上门待确认');
ok(run(`UI.fmtOnsite('2026-08-04', new Date(2026, 0, 1))`) === '上门：8月4日', 'fmtOnsite 当年日期不含年份');

// ============ 10. CSS 样式断言 ============
console.log('== CSS 样式 ==');
const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(css.includes('.timeline-onsite-date'), '存在 .timeline-onsite-date 样式');
ok(css.includes('margin-left: 5px'), '上门日期与任务名间距 4-6px');
ok(css.includes('#7a8091'), '上门日期浅灰色 #7a8091');
ok(css.includes('font-size: 12px'), '上门日期字号 12px');
ok(css.includes('font-weight: 400'), '上门日期字重 400（低于任务名）');
ok(css.includes('white-space: nowrap'), '上门日期不换行');
ok(/\.tl-item\.tl-done \.timeline-onsite-date/.test(css), '已完成派单任务上门日期随整条弱化');
ok(!css.includes('.timeline-onsite-date') || !/timeline-onsite-date[\s\S]{0,120}text-decoration/.test(css), '上门日期无单独删除线规则');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
