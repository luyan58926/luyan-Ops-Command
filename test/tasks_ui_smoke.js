/* 任务与告警页 UI 冒烟测试
 * 验证 renderTasks 改造后无运行时错误，新渲染结构正确。
 * 运行：node test/tasks_ui_smoke.js
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
    style: {}, children: [],
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

const sandbox = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  console: console,
  window: { SEED_DATA: null },
  document: documentMock,
  setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  navigator: { clipboard: { writeText: async () => {} } },
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = documentMock;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.console = console;
sandbox.window.setInterval = () => 0;
sandbox.window.clearInterval = () => {};
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'ui-smoke' });

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);

console.log('== renderTasks 无运行时错误（默认空告警场景）==');
let err = null;
try {
  run(`UI.renderTasks();`);
} catch (e) {
  err = e;
}
ok(err === null, 'renderTasks 执行无异常');

const html = run(`document.getElementById('view-tasks').innerHTML`);
ok(html.includes('tasks-ov-fixed'), '包含固定任务容器');
ok(html.includes('fx-daily'), '固定任务条目使用 fx-daily 类');
ok(html.includes('fx-status'), '固定任务含状态图标');
ok(html.includes('今日固定任务'), '固定任务标题');
ok(!html.includes('收到耗材提醒'), '不再显示旧"收到耗材提醒"入口');
ok(html.includes('tasks-ov-alert'), '包含实时告警容器');
ok(html.includes('当前没有需要处理的告警'), '无告警时显示指定空状态文案');
ok(html.includes('✨'), '空状态含星尘 Emoji');

// 检查无序号（1. 2. 3. 或 ① ② ③）
const noSeq = !/\b[1-3][.)]\s/.test(html) && !html.includes('①') && !html.includes('②') && !html.includes('③');
ok(noSeq, '固定任务无数字序号或无Emoji序号');

console.log('== 构造有告警 + 有已完成任务的混合场景 ==');
const today = run(`NK.today()`);
// 注入 P1 待处理任务 → 触发"P1任务未处理"危险告警
run(`(() => {
  const d = NK.db;
  d.tasks.push({
    id: 'TEST-T1', no: 'RW-TEST-001', name: '测试紧急故障处理', type: 'IT支持',
    priority: 'P1', status: '待处理', source: '花姐手动新增',
    siteName: '测试职场', engineer: '测试工程师',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    fixedDate: '${today}', frequency: '每日'
  });
  // 将一条固定任务标记为已完成
  const fx = d.tasks.find(x => x.source === '系统固定任务');
  if (fx) { fx.status = '已完成'; fx.updatedAt = new Date().toISOString(); }
  NK.save();
})()`);
run(`UI.renderTasks();`);
const html2 = run(`document.getElementById('view-tasks').innerHTML`);
ok(html2.includes('al-item'), '有告警时渲染 al-item 条目');
ok(html2.includes('al-emoji'), '告警含类型 Emoji');
ok(html2.includes('查看任务'), 'P1告警含查看任务按钮');
ok(html2.includes('al-meta'), '告警含 meta 信息行');
ok(html2.includes('fx-done'), '已完成固定任务含 fx-done 类');
ok(html2.includes('fx-done-label'), '已完成固定任务含右侧状态标签');
ok(html2.includes('已完成'), '已完成标签文案存在');
ok(html2.includes('RW-TEST-001'), '告警正文含任务编号');

console.log('== 全部完成状态 ==');
run(`(() => {
  NK.db.tasks.forEach(t => { if (t.source === '系统固定任务') t.status = '已完成'; });
  NK.save();
  UI.renderTasks();
})()`);
const allDone = run(`document.getElementById('view-tasks').innerHTML`);
ok(allDone.includes('fx-all-done'), '全部完成时显示 fx-all-done 轻提示');
ok(allDone.includes('今天的固定任务都完成了'), '全部完成轻提示文案正确');

console.log('== 展示层辅助函数 ==');
ok(run(`UI.fixedEmoji('TPL003')`) === '⏰', 'fixedEmoji 定时任务 → ⏰');
ok(run(`UI.fixedEmoji('TPL004')`) === '🌙', 'fixedEmoji 下班前 → 🌙');
ok(run(`UI.fixedEmoji('TPL005')`) === '📧', 'fixedEmoji 邮件检查 → 📧');
ok(run(`UI.fixedEmoji('TPL014')`) === '📅', 'fixedEmoji 月度 → 📅');
ok(run(`UI.fixedEmoji('TPL001')`) === '', 'fixedEmoji 常规任务 → 空串');
ok(run(`UI.alertEmoji({title:'系统异常',level:'danger'})`) === '🚨', 'alertEmoji 异常 → 🚨');
ok(run(`UI.alertEmoji({title:'今日上门',level:'info'})`) === '📅', 'alertEmoji 上门 → 📅');
ok(run(`UI.alertEmoji({title:'即将到期',level:'warn'})`) === '⏰', 'alertEmoji 到期 → ⏰');
ok(run(`UI.alertEmoji({title:'普通关注',level:'info'})`) === '👀', 'alertEmoji 其他 → 👀');

console.log('== alertParts 信息提取（返回 {body, meta}）==');
const parts1 = run(`UI.alertParts({content:'派单申请 RW12345678-1 已提交，今日上门，供应商：源晨', title:'今日上门'})`);
ok(parts1.meta.includes('RW12345678-1'), 'alertParts 提取 RW 编号到 meta');
ok(parts1.meta.includes('源晨'), 'alertParts 提取供应商到 meta');
ok(!parts1.body.includes('今日上门'), '标题为"上门"时正文去重');

const parts2 = run(`UI.alertParts({content:'派单 PD20240301-001 已提交'})`);
ok(parts2.meta.includes('PD20240301-001'), 'alertParts 提取 PD 编号到 meta');

const parts3 = run(`UI.alertParts({content:'设备巡检 2024-03-01 今日到期'})`);
ok(parts3.meta.includes('2024-03-01') && parts3.meta.includes('今日到期'), 'alertParts 提取日期与今日到期');
ok(!parts3.body.includes('今日到期'), '正文不含已提取的日期到期信息');

console.log('== 数据层完整性 ==');
const taskCount = run(`NK.db.tasks.filter(t => NK.taskActive(t)).length`);
ok(taskCount > 0, '任务数据未丢失，有效任务共 ' + taskCount + ' 条');
const remindCount = run(`NK.genReminders().length`);
ok(remindCount > 0, '告警生成正常，共 ' + remindCount + ' 条');
ok(typeof run(`NK.migrateConsumableReminder`) === 'function', 'migrateConsumableReminder 函数未删除');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);