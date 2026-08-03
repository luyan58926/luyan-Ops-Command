/* 首页问候语 + 每日语录 回归测试
 * 验证：五段制问候无 undefined、24 小时全覆盖、非法输入兜底、
 *       每日语录稳定索引与次日切换、问候区单行结构、
 *       每分钟定时器先清后建 / 离开 home 清理。
 * 运行：node test/greeting_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

// ---------- 简化 DOM mock（复用 tasks_ui_smoke 方案）----------
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

// ---------- 定时器计数 mock：验证"先清后建"与"离开清理" ----------
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
  vm.runInContext(uiSrc, sandbox, { filename: 'ui.js' }); // 加载时即执行 UI.init() → nav('home')
} catch (e) {
  console.error('加载失败:', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'greeting-test' });

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);

console.log('== 五段制问候（六时段模拟）==');
const g7 = run(`UI.getGreetingByTime(new Date(2026,7,3,7,0,0))`);
ok(g7 && g7.emoji === '🌤️' && g7.text === '早上好', '07:00 → 🌤️ 早上好');
const g12 = run(`UI.getGreetingByTime(new Date(2026,7,3,12,0,0))`);
ok(g12 && g12.emoji === '☀️' && g12.text === '中午好', '12:00 → ☀️ 中午好');
const g15 = run(`UI.getGreetingByTime(new Date(2026,7,3,15,0,0))`);
ok(g15 && g15.emoji === '🌞' && g15.text === '下午好', '15:00 → 🌞 下午好');
const g19 = run(`UI.getGreetingByTime(new Date(2026,7,3,19,0,0))`);
ok(g19 && g19.emoji === '🌆' && g19.text === '晚上好', '19:00 → 🌆 晚上好');
const g2209 = run(`UI.getGreetingByTime(new Date(2026,7,3,22,9,0))`);
ok(g2209 && g2209.emoji === '🌙' && g2209.text === '夜深了', '22:09 → 🌙 夜深了');
const g02 = run(`UI.getGreetingByTime(new Date(2026,7,3,2,0,0))`);
ok(g02 && g02.emoji === '🌙' && g02.text === '夜深了', '02:00 → 🌙 夜深了');

console.log('== 24 小时全覆盖（无 undefined）==');
let allHoursOk = true;
for (let hour = 0; hour < 24; hour++) {
  const g = run(`UI.getGreetingByTime(new Date(2026,7,3,${hour},0,0))`);
  if (!g || typeof g.text !== 'string' || !g.text.trim() || typeof g.emoji !== 'string' || !g.emoji.trim()) {
    allHoursOk = false;
    console.log('    FAIL hour=' + hour, JSON.stringify(g));
  }
}
ok(allHoursOk, '0-23 点问候均返回合法 {emoji, text}（不再出现 undefined）');

console.log('== 非法输入兜底 ==');
const gObj = run(`UI.getGreetingByTime({})`);
ok(gObj && gObj.emoji === '✨' && gObj.text === '你好', '传普通对象 → ✨/你好 兜底');
const gStr = run(`UI.getGreetingByTime('abc')`);
ok(gStr && gStr.emoji === '✨' && gStr.text === '你好', '传字符串 → ✨/你好 兜底');
const gNow = run(`UI.getGreetingByTime()`);
ok(gNow && typeof gNow.emoji === 'string' && typeof gNow.text === 'string' && gNow.text.length > 0, '不传参按当前时间返回合法问候');

console.log('== 每日语录：15 条 + 同日稳定 + 次日切换 ==');
ok(run(`UI.huajieQuotes.length`) === 15, '内置语录共 15 条');
const q1 = run(`UI.getDailyQuote(new Date(2026,7,3))`);
const q2 = run(`UI.getDailyQuote(new Date(2026,7,3))`);
ok(q1 === q2, '同一天两次取语录一致（刷新/切换菜单不变化）');
ok(q1 === run(`UI.huajieQuotes[20260803 % UI.huajieQuotes.length]`), '索引 = dateKey % 15（2026-08-03）');
const qNext = run(`UI.getDailyQuote(new Date(2026,7,4))`);
ok(qNext === run(`UI.huajieQuotes[20260804 % UI.huajieQuotes.length]`), '次日按新索引自动切换');
ok(run(`UI.getDailyQuote('bad')`) === '今天也要把重要的事情稳稳闭环。', '非法输入 → 默认语录兜底');
ok(q1 === run(`UI.huajieQuotes[3]`), '2026-08-03（dateKey%15=3）命中索引 3 语录');

console.log('== renderHome 问候区结构（单行三元素）==');
let err = null;
try { run(`UI.renderHome();`); } catch (e) { err = e; }
ok(err === null, 'renderHome 再次执行无异常');
const html = run(`document.getElementById('view-home').innerHTML`);
ok(html.includes('home-greeting-line'), '问候区容器 home-greeting-line');
ok(html.includes('home-greeting-main'), '问候主线 home-greeting-main');
ok(html.includes('home-greeting-divider'), '分隔符元素 home-greeting-divider');
ok(html.includes('home-daily-quote'), '语录元素 home-daily-quote');
ok(html.includes('id="homeGreetingEmoji"'), '问候 Emoji 占位元素');
ok(html.includes('id="homeGreetingText"'), '问候文案占位元素');
ok(html.includes('id="homeDailyQuote"'), '每日语录占位元素');
const lineHtml = html.match(/<div class="dg-hello[^>]*>[\s\S]*?<\/div>/);
ok(!!lineHtml && lineHtml[0].includes('home-greeting-main') && lineHtml[0].includes('home-greeting-divider') && lineHtml[0].includes('home-daily-quote'),
  '问候 / ｜ / 语录处于同一行容器（单行显示）');

console.log('== renderHomeGreeting 填充与更新 ==');
const filled = run(`UI.renderHomeGreeting(new Date(2026,7,3,7,0,0))`);
ok(filled.emoji === '🌤️' && filled.text === '早上好，花姐', '07:00 → 渲染「🌤️ 早上好，花姐」');
ok(typeof filled.quote === 'string' && filled.quote.length > 0, '渲染返回语录文本');
ok(run(`document.getElementById('homeGreetingEmoji').textContent`) === '🌤️', 'Emoji 元素已填充');
ok(run(`document.getElementById('homeGreetingText').textContent`) === '早上好，花姐', '文案元素已填充「早上好，花姐」');
ok(run(`UI.huajieQuotes.indexOf(document.getElementById('homeDailyQuote').textContent)`) >= 0, '语录元素填充的是内置语录');
const filled2 = run(`UI.renderHomeGreeting(new Date(2026,7,3,7,0,0))`);
ok(filled2.emoji === filled.emoji && filled2.text === filled.text && filled2.quote === filled.quote, '同一时段重复渲染结果一致');
// 兜底渲染：非法 greeting → ✨/你好
run(`UI.__greetingTestDirty = true`); // 无操作标记（占位），走真实兜底路径
const filledBad = run(`UI.renderHomeGreeting('bad')`);
ok(filledBad.emoji === '✨' && filledBad.text === '你好，花姐', '非法输入渲染 → ✨ 你好，花姐');

console.log('== 每分钟定时器：先清后建 / 离开清理 ==');
ok(countTimers(60000) === 1, 'home 渲染后 60s 问候定时器恰好 1 个（先清后建不重复）');
run(`UI.renderHome();`);
ok(countTimers(60000) === 1, '再次渲染仍只有 1 个 60s 定时器（不重复创建）');
run(`UI.nav('tasks');`);
ok(countTimers(60000) === 0, '离开 home → 问候定时器已清理');
run(`UI.nav('home');`);
ok(countTimers(60000) === 1, '回到 home → 问候定时器重建');
ok(countTimers(300000) === 1, '原有 5 分钟全局刷新定时器不受影响');

console.log('== CSS 单行排版 ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(cssSrc.includes('.home-greeting-main'), 'CSS 定义 .home-greeting-main');
ok(/\.home-greeting-main\s*\{[^}]*18px[^}]*600/.test(cssSrc), '问候语 18px/600');
ok(/\.home-greeting-main\s*\{[^}]*#2F3443/.test(cssSrc), '问候语深灰蓝 #2F3443');
ok(cssSrc.includes('.home-greeting-divider'), 'CSS 定义 .home-greeting-divider');
ok(cssSrc.includes('.home-daily-quote'), 'CSS 定义 .home-daily-quote');
ok(/\.dg-hello\s*\{[^}]*flex-wrap/.test(cssSrc), '.dg-hello 允许窄屏换行（flex-wrap）');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
