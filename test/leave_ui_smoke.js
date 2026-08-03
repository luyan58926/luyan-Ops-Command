/* 休假功能 UI 冒烟测试
 * 用简化 DOM mock 验证休假相关 UI 函数能正确生成 HTML 且不报错。
 * 运行：node test/leave_ui_smoke.js
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
const elements = {}; // id -> element mock

function makeEl(id) {
  const el = {
    id, _innerHTML: '', _text: '', value: '', dataset: {}, className: '', disabled: false,
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
run(`NK.initDB();`);

console.log('== 首页休假提醒（无人休假）==');
const htmlNone = run(`UI.leaveRemindHTML()`);
ok(typeof htmlNone === 'string' && htmlNone.includes('均在岗'), '无人休假时显示"均在岗"');
ok(htmlNone.includes('lr-none'), '无人休假使用低权重样式');

console.log('== 首页休假提醒（今天有人休假·无需派单）==');
const today = run(`NK.today()`);
run(`NK.createLeave({ engineerId: 'ENG003', engineerName: '沈煜钦', startDate: '${today}', endDate: '${today}', leavePeriod: '全天', dispatchRequired: '否' });`);
const htmlNoDispatch = run(`UI.leaveRemindHTML()`);
ok(htmlNoDispatch.includes('今日休假 1人'), '显示今日休假人数');
ok(htmlNoDispatch.includes('沈煜钦'), '显示休假工程师姓名');
ok(htmlNoDispatch.includes('无需派单'), '显示无需派单状态');
ok(!htmlNoDispatch.includes('lr-need'), '无需派单不高亮催促');

console.log('== 首页休假提醒（今天休假·待创建派单→加强提示）==');
run(`NK.createLeave({ engineerId: 'ENG006', engineerName: '余滔', startDate: '${today}', endDate: '${today}', leavePeriod: '全天', dispatchRequired: '是' });`);
const htmlNeed = run(`UI.leaveRemindHTML()`);
ok(htmlNeed.includes('lr-need'), '有待创建派单时高亮提醒');
ok(htmlNeed.includes('待安排补位'), '显示待安排补位标签');

console.log('== 三页签渲染（工程师/职场/休假记录）==');
run(`UI.resTab = 'leave'; UI.resUnlocked = () => true;`);
const resHTML = run(`(() => { UI.renderResources(); return document.getElementById('view-resources').innerHTML; })()`);
ok(resHTML.includes('休假记录'), '页签栏含休假记录');
ok(resHTML.includes('res-tab'), '含页签样式');
const bodyHTML = run(`document.getElementById('resTabBody').innerHTML`);
ok(bodyHTML.includes('登记休假'), '休假记录页签含登记休假按钮');
ok(bodyHTML.includes('补位状态') || bodyHTML.includes('休假'), '休假记录表格已渲染');

console.log('== 登记休假弹窗 ==');
run(`UI.leaveCreate();`);
const modalHTML = run(`(() => { const s = UI.__stack; return s.length ? s[s.length-1].layer.innerHTML : ''; })()`);
ok(modalHTML.includes('登记休假'), '弹出登记休假弹窗');
ok(modalHTML.includes('休假工程师'), '含工程师选择');
ok(modalHTML.includes('开始日期') && modalHTML.includes('结束日期'), '含开始/结束日期');
ok(modalHTML.includes('是否需要安排补位派单'), '含是否需要派单询问');
ok(modalHTML.includes('需要，创建补位派单'), '含创建补位派单按钮');
ok(modalHTML.includes('不需要，只记录休假'), '含只记录休假按钮');

console.log('== 休假记录列表（renderLeaveRecords）==');
run(`UI.renderLeaveRecords(document.getElementById('resTabBody'));`);
const listHTML = run(`document.getElementById('resTabBody').innerHTML`);
ok(listHTML.includes('全部') && listHTML.includes('今天') && listHTML.includes('明天') && listHTML.includes('本月'), '列表含筛选页签');
ok(listHTML.includes('待安排补位'), '列表含"待安排补位"筛选');
ok(listHTML.includes('沈煜钦') && listHTML.includes('余滔'), '列表显示已登记休假');
ok(listHTML.includes('取消休假'), '操作列含取消休假');
ok(listHTML.includes('查看关联派单') || listHTML.includes('创建补位派单') || listHTML.includes('去创建'), '操作列含补位派单入口');

console.log('== 独立"休假与补位"管理页面 ==');
run(`UI.renderLeave();`);
const leaveViewHTML = run(`document.getElementById('view-leave').innerHTML`);
const leaveBodyHTML = run(`document.getElementById('leaveTabBody').innerHTML`);
ok(leaveViewHTML.includes('工程师休假与补位管理'), '页面标题正确');
ok(leaveViewHTML.includes('及时确认驻场支持是否需要补位'), '副标题正确');
ok(leaveViewHTML.includes('登记休假'), '右上角含登记休假按钮');
ok(leaveBodyHTML.includes('沈煜钦') && leaveBodyHTML.includes('余滔'), '页面展示已有休假记录');

console.log('== 首页快捷操作区（6卡·登记休假·移除两卡）==');
const quickHTML = run(`(() => { NK.currentView = 'home'; UI.renderHome(); return document.getElementById('view-home').innerHTML; })()`);
const qcCount = (quickHTML.match(/quick-card/g) || []).length;
ok(qcCount === 6, '快捷卡数量为6（实际 ' + qcCount + '）');
ok(quickHTML.includes('登记休假') && quickHTML.includes('记休假，补位不遗漏'), '含"登记休假"卡及副文案');
ok(!quickHTML.includes('查资源'), '首页不再显示"查资源"卡');
ok(!quickHTML.includes('收到耗材提醒'), '首页不再显示"收到耗材提醒"卡');
ok(quickHTML.includes('新建派单') && quickHTML.includes('快速记录') && quickHTML.includes('更新进度') && quickHTML.includes('登记KPI') && quickHTML.includes('生成交接'), '其余5张卡保留');
ok(quickHTML.includes('qc-lavender'), '登记休假卡使用薰衣草点缀样式');
ok(quickHTML.includes('qc-primary'), '新建派单保持主卡样式');

console.log('== 原功能保留：任务与告警耗材提醒入口 ==');
const tasksViewHTML = run(`(() => { UI.renderTasks(); return document.getElementById('view-tasks').innerHTML; })()`);
ok(tasksViewHTML.includes('收到耗材提醒'), '任务与告警保留"收到耗材提醒"入口');

console.log('== 补位派单：职场快照与多职场选择 ==');
// 所有工程师均负责 2+ 个职场 → 生产实际走"多职场选择"路径（单一职场路径为兜底）
const snapCheck = run(`(() => {
  const l = NK.db.leaves.find(x => x.engineerName === '余滔');
  const snap = (l.responsibleSitesSnapshot || []).slice();
  return { len: snap.length, hasId: snap.length > 0 && !!snap[0].siteId, hasName: snap.length > 0 && !!snap[0].siteName };
})()`);
ok(snapCheck.len >= 2, '余滔负责多职场，快照记录数量=' + snapCheck.len);
ok(snapCheck.hasId && snapCheck.hasName, '快照含 siteId/siteName 字段');

console.log('== 补位派单：多职场选择弹窗 ==');
const leaveId = run(`NK.db.leaves.find(x => x.engineerName === '余滔').leaveId`);
run(`UI.leaveCreateDispatch(${JSON.stringify(leaveId)});`);
const pickerHTML = run(`(() => { const s = UI.__stack; return s.length ? s[s.length-1].layer.innerHTML : ''; })()`);
ok(pickerHTML.includes('本次需要为哪些职场安排补位'), '多职场弹出选择弹窗');
ok(pickerHTML.includes('leave-site-chk'), '含职场多选');
ok(pickerHTML.includes('下一步'), '含下一步按钮');

console.log('== 补位派单：补位原因模板 ==');
const reasonOK = run(`(() => {
  const l = NK.db.leaves.find(x => x.engineerName === '余滔');
  const s = l.responsibleSitesSnapshot[0];
  const reason = l.engineerName + '于' + l.startDate + '至' + l.endDate + '休假，需安排' + NK.v.siteName(s.siteName) + 'IT现场支持补位。';
  return reason;
})()`);
ok(reasonOK.includes('余滔于') && reasonOK.includes('休假，需安排') && reasonOK.includes('IT现场支持补位'), '补位原因格式正确');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
