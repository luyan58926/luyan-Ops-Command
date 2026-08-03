/* 首页欢迎区 · 当前日期与星期显示 回归测试
 * 验证：本地日期格式 YYYY年M月D日　星期X、星期计算正确、日期位于欢迎区右侧、
 *       问候+语录仍在左侧、浏览器本地时间（不依赖联网）、刷新/切换菜单一致、
 *       跨零点自动变化、非法输入兜底、不出现 undefined/Invalid Date、
 *       不新增独立日期卡片、窄屏换行、复用现有 60s 定时器（不重复创建）、
 *       CSS 样式断言。
 * 运行：node test/date_display_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

// ---------- 简化 DOM mock（复用 tasks_ui_smoke / greeting_test 方案）----------
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

const getElementById = (id) => {
  if (!elements[id]) elements[id] = makeEl(id);
  return elements[id];
};
const documentMock = {
  getElementById,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => [],
  querySelector: () => makeEl('q'),
  body: makeEl('body'),
  addEventListener: function () {},
  removeEventListener: function () {},
};

// ---------- 定时器计数 mock：验证"复用 60s 定时器不重复" ----------
let nextTimerId = 1;
const activeTimers = new Map(); // id -> {fn, ms}
function countTimers(ms) {
  let n = 0;
  activeTimers.forEach(t => { if (t.ms === ms) n++; });
  return n;
}
const sandboxSetInterval = (fn, ms) => {
  const id = nextTimerId++;
  activeTimers.set(id, { fn, ms });
  return id;
};
const sandboxClearInterval = (id) => {
  if (activeTimers.has(id)) activeTimers.delete(id);
};

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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'date-display-test' });

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);

console.log('== 日期格式与星期计算（getLocalDateDisplay）==');
// 2026-08-03 是星期一
ok(run(`UI.getLocalDateDisplay(new Date(2026,7,3))`) === '2026年8月3日　星期一', '2026-08-03(一) → "2026年8月3日　星期一"');
ok(run(`UI.getLocalDateDisplay(new Date(2026,7,3,9,30,0))`) === '2026年8月3日　星期一', '带时间的 Date 仍取年月日+星期（忽略时分秒）');
// 星期边界：周日与周六
ok(run(`UI.getLocalDateDisplay(new Date(2026,7,2))`) === '2026年8月2日　星期日', '2026-08-02(日) → 星期日');
ok(run(`UI.getLocalDateDisplay(new Date(2026,7,8))`) === '2026年8月8日　星期六', '2026-08-08(六) → 星期六');
// 跨年带完整年份
ok(run(`UI.getLocalDateDisplay(new Date(2027,0,3))`) === '2027年1月3日　星期日', '2027-01-03 跨年 → 完整年份');
ok(run(`UI.getLocalDateDisplay(new Date(2026,11,31))`) === '2026年12月31日　星期四', '2026-12-31(四) 年份边界');
// 月/日不补零
ok(!run(`UI.getLocalDateDisplay(new Date(2026,7,3))`).includes('08月'), '月不补零（8月 而非 08月）');
ok(!run(`UI.getLocalDateDisplay(new Date(2026,7,3))`).includes('03日'), '日不补零（3日 而非 03日）');

console.log('== 非法输入兜底（不出现 undefined/Invalid Date）==');
ok(run(`UI.getLocalDateDisplay() === UI.getLocalDateDisplay(new Date())`), '不传参按浏览器本地时间返回');
ok(run(`UI.getLocalDateDisplay('bad')`) === '', '字符串非法输入 → 空串');
ok(run(`UI.getLocalDateDisplay({})`) === '', '普通对象非法输入 → 空串');
ok(run(`UI.getLocalDateDisplay(null) === UI.getLocalDateDisplay(new Date())`), 'null → 按当前时间兜底');
ok(!run(`String(UI.getLocalDateDisplay(new Date(2026,7,3)))`).match(/undefined|Invalid Date|NaN|\[object Object\]|null/i), '合法输出不含 undefined/Invalid Date/NaN/[object Object]');
// 不含英文星期、不含斜杠/连字符格式
const normalDate = run(`UI.getLocalDateDisplay(new Date(2026,7,3))`);
ok(!/[A-Za-z]/.test(normalDate), '不含英文星期（Mon 等）');
ok(!/[/-]/.test(normalDate) && !/\d{4}\/\d{2}\/\d{2}/.test(normalDate), '不含斜杠/连字符格式');
ok(!normalDate.includes(':'), '不含秒/时钟');

console.log('== 页面结构：日期位于欢迎区右侧，与问候同一行容器 ==');
let err = null;
try { run(`UI.renderHome();`); } catch (e) { err = e; }
ok(err === null, 'renderHome 无异常');
const html = run(`document.getElementById('view-home').innerHTML`);
ok(html.includes('home-welcome-header'), '欢迎区使用 home-welcome-header 左右布局容器');
ok(html.includes('home-current-date'), '日期元素 home-current-date 存在');
ok(html.includes('id="homeCurrentDate"'), '日期元素 id=homeCurrentDate');
// 同一行：home-greeting-line 与 home-current-date 都在 home-welcome-header 内
const headerMatch = html.match(/<div class="home-welcome-header"[^>]*>([\s\S]*?)<\/div>\s*<div class="dg-status">/);
const headerBlock = headerMatch ? headerMatch[1] : '';
ok(headerBlock.includes('home-greeting-line') && headerBlock.includes('homeCurrentDate'), '问候行与日期在同一 header 容器（左右分布）');

console.log('== 渲染填充与更新 ==');
const filled = run(`UI.renderHomeGreeting(new Date(2026,7,3,7,0,0))`);
ok(typeof filled.dateText === 'string' && filled.dateText === '2026年8月3日　星期一', '渲染返回 dateText 文本');
ok(run(`document.getElementById('homeCurrentDate').textContent`) === '2026年8月3日　星期一', '日期元素已填充「2026年8月3日　星期一」');
ok(run(`document.getElementById('homeCurrentDate').style.display`) === '', '有日期时日期元素显示正常');
// 问候/语录仍在左侧且未受影响
ok(run(`document.getElementById('homeGreetingText').textContent`) === '早上好，花姐', '问候语仍为「早上好，花姐」（不受影响）');
ok(run(`document.getElementById('homeDailyQuote').textContent`).length > 0, '每日语录仍正常填充');
// 日期异常时隐藏日期区域，不影响其他内容
run(`UI.renderHomeGreeting('bad')`);
ok(run(`document.getElementById('homeCurrentDate').textContent`) === '', '日期异常 → 日期区域内容置空');
ok(run(`document.getElementById('homeCurrentDate').style.display`) === 'none', '日期异常 → 日期区域隐藏');
ok(run(`document.getElementById('homeGreetingText').textContent`) === '你好，花姐', '日期异常不影响问候语兜底渲染');
// 恢复
run(`UI.renderHomeGreeting(new Date(2026,7,3,7,0,0))`);
ok(run(`document.getElementById('homeCurrentDate').style.display`) === '' && run(`document.getElementById('homeCurrentDate').textContent`) === '2026年8月3日　星期一', '日期恢复正常后重新显示');

console.log('== 跨零点自动更新（复用 60s 定时器，不重复创建）==');
ok(countTimers(60000) === 1, 'home 渲染后 60s 定时器恰好 1 个（复用问候定时器，未新增重复定时器）');
// 模拟跨天：8月3日 → 8月4日（周二）
run(`UI.renderHomeGreeting(new Date(2026,7,4,0,1,0))`);
ok(run(`document.getElementById('homeCurrentDate').textContent`) === '2026年8月4日　星期二', '跨零点后日期与星期同步变化（8月4日 星期二）');
run(`UI.renderHomeGreeting(new Date(2026,7,3,23,59,0))`);
ok(run(`document.getElementById('homeCurrentDate').textContent`) === '2026年8月3日　星期一', '回到前一天 23:59 正确回落');
// 切换菜单 → 返回：定时器清理与重建，日期正确
run(`UI.nav('tasks');`);
ok(countTimers(60000) === 0, '离开 home → 定时器清理');
run(`UI.nav('home');`);
ok(countTimers(60000) === 1, '返回 home → 定时器重建（仍只有 1 个）');

console.log('== CSS 样式 ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(cssSrc.includes('.home-welcome-header'), 'CSS 定义 .home-welcome-header');
ok(cssSrc.includes('.home-current-date'), 'CSS 定义 .home-current-date');
ok(/\.home-current-date\s*\{[^}]*flex-shrink\s*:\s*0/.test(cssSrc), '日期区域不收缩（flex-shrink:0）');
ok(/\.home-current-date\s*\{[^}]*color\s*:\s*#73788a/.test(cssSrc), '日期使用灰紫次要色 #73788a');
ok(/\.home-current-date\s*\{[^}]*font-size\s*:\s*13px/.test(cssSrc), '日期字号 13px（辅助、非粗体大字）');
ok(/\.home-current-date\s*\{[^}]*white-space\s*:\s*nowrap/.test(cssSrc), '日期不换行（white-space:nowrap）');
ok(/\.home-welcome-header\s*\{[^}]*justify-content\s*:\s*space-between/.test(cssSrc), '欢迎区左右分布（space-between）');
ok(/@media\s*\(max-width\s*:\s*900px\)[\s\S]*?\.home-current-date\s*\{[^}]*width\s*:\s*100%/.test(cssSrc), '窄屏（≤900px）日期落到下一行且保持完整');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
