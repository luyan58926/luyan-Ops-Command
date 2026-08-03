/* 修复验收测试：独立"休假与补位"页右上角只保留一个「登记休假」按钮
 * 运行：node test/leave_dup_btn_fix.js
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
    id, _innerHTML: '', _text: '', value: '', dataset: {}, className: '', disabled: false,
    style: {}, children: [],
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) { if (on) this._set.add(c); else this._set.delete(c); },
      contains(c) { return this._set.has(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    remove() {}, addEventListener() {}, focus() {},
    querySelector() { return makeEl('q'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
  };
  return el;
}
const getElementById = (id) => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; };
const documentMock = {
  getElementById, createElement: (t) => makeEl(t),
  querySelectorAll: () => [], querySelector: () => makeEl('q'), body: makeEl('body'),
  addEventListener() {}, removeEventListener() {},
};
const sandbox = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  console, window: { SEED_DATA: null }, document: documentMock,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
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
} catch (e) { console.error('加载失败:', e.message); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'dup-fix' });

// 统计给定 HTML 中「登记休假」按钮（<button ...>＋ 登记休假</button>）出现次数
// 用精确正则，避免把空列表提示文案「点击右上角『登记休假』」误算为按钮
const countBtn = (html) => (html.match(/<button[^>]*onclick="UI\.leaveCreate\(\)"[^>]*>＋\s*登记休假<\/button>/g) || []).length;

console.log('== 初始化 ==');
run(`NK.initDB();`);

console.log('== 场景1：首次进入独立休假页，右上角只有一个「登记休假」按钮 ==');
run(`UI.renderLeave();`);
let leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
let cnt = countBtn(leaveHTML);
ok(cnt === 1, 'view-leave 中「登记休假」出现次数=' + cnt + '（期望 1）');
ok(leaveHTML.includes('工程师休假与补位管理'), '标题区保留');
ok(leaveHTML.includes('btn-accent') && leaveHTML.includes('UI.leaveCreate()'), '保留的按钮在页头且功能不变');

console.log('== 场景2：刷新页面后仍只有一个 ==');
run(`UI.renderLeave();`);
leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
cnt = countBtn(leaveHTML);
ok(cnt === 1, '刷新后「登记休假」出现次数=' + cnt + '（期望 1）');

console.log('== 场景3：切换筛选（全部/今天/明天/本月/待安排补位）后仍只有一个 ==');
let scopeOk = true;
for (const s of ['全部', '今天', '明天', '本月', '待安排补位']) {
  run(`NK.leaveFilter.scope='${s}';UI.renderLeaveRecords(document.getElementById('leaveTabBody'), {hideCreateBtn: true});`);
  leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
  const c = countBtn(leaveHTML);
  if (c !== 1) { scopeOk = false; console.log(`    → 筛选[${s}]后次数=${c}`); }
}
ok(scopeOk, '五个筛选切换后「登记休假」始终为 1');

console.log('== 场景4：从其他菜单返回后再进入，仍只有一个 ==');
run(`UI.nav('home');`); run(`UI.nav('leave');`);
leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
cnt = countBtn(leaveHTML);
ok(cnt === 1, '返回后「登记休假」出现次数=' + cnt + '（期望 1）');

console.log('== 场景5：连续进入/退出多次仍只有一个 ==');
let loopOk = true;
for (let i = 0; i < 5; i++) { run(`UI.nav('dispatch');`); run(`UI.nav('leave');`); }
leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
cnt = countBtn(leaveHTML);
ok(cnt === 1, '连续进出5次后「登记休假」出现次数=' + cnt + '（期望 1）');

console.log('== 工程师页休假记录页签仍保留「登记休假」按钮（不应被移除）==');
run(`UI.resTab = 'leave'; UI.resUnlocked = () => true;`);
run(`UI.renderResources();`);
let resBody = run(`document.getElementById('resTabBody').innerHTML`);
let resCnt = countBtn(resBody);
ok(resCnt === 1, '工程师页休假页签「登记休假」出现次数=' + resCnt + '（期望 1，保留）');
ok(resBody.includes('登记休假'), '工程师页休假页签按钮保留');

console.log('== 场景6-7：点击一次只开一个窗口、保存只生成一条记录 ==');
// 先清空弹窗栈，确保从干净状态验证
run(`while (UI.__stack.length) UI.__stack.pop();`);
const before = run(`NK.db.leaves.length`);
run(`UI.leaveCreate();`);
run(`UI.leaveCreate();`); // 连续点击两次
let stackLen = run(`UI.__stack.length`);
ok(stackLen === 1, '连续调用 leaveCreate 两次，弹窗栈仅 ' + stackLen + ' 个（期望 1）');
// 关闭弹窗后再次点击，仍只开一个窗口
while (run(`UI.__stack.length`)) run(`UI.modalClose();`);
run(`UI.leaveCreate();`);
stackLen = run(`UI.__stack.length`);
ok(stackLen === 1, '关闭后再次点击仍只开 1 个窗口（实际 ' + stackLen + '）');
while (run(`UI.__stack.length`)) run(`UI.modalClose();`);
const after = run(`NK.db.leaves.length`);
ok(after === before, '多次打开/关闭弹窗未生成重复记录（记录数=' + after + '）');

console.log('== 场景8：原有休假登记与补位派单功能正常 ==');
// 取一个真实存在的工程师
const engInfo = run(`(() => { const e = NK.db.engineers[0]; return { id: e.id, name: e.name }; })()`);
const today8 = run(`NK.today()`);
const leavesBefore = run(`NK.db.leaves.length`);
const created = run(`NK.createLeave({ engineerId: '${engInfo.id}', engineerName: '${engInfo.name}', startDate: '${today8}', endDate: '${today8}', leavePeriod: '全天', dispatchRequired: '否' })`);
ok(!!created && created.engineerName === engInfo.name && created.recordStatus === '有效', '登记休假生成一条有效记录（' + engInfo.name + '）');
ok(created.dispatchStatus === '无需派单', '无需派单逻辑正常');
ok(run(`NK.db.leaves.length`) === leavesBefore + 1, '新增恰好一条休假记录');
// 重置筛选为"全部"，确保新增记录可见（避免场景3遗留的筛选状态污染）
run(`NK.leaveFilter.scope = '全部';`);
run(`UI.renderLeave();`);
leaveHTML = run(`document.getElementById('view-leave').innerHTML`);
const leaveBodyHTML = run(`document.getElementById('leaveTabBody').innerHTML`);
ok(leaveBodyHTML.includes(engInfo.name), '新休假记录展示在休假列表');
ok(countBtn(leaveBodyHTML) === 0, '列表区（leaveTabBody）不再渲染「登记休假」按钮');
cnt = countBtn(leaveHTML);
ok(cnt === 1, '新增记录后「登记休假」按钮仍为 1（仅页头）');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
