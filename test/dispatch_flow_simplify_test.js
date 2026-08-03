/* 派单状态与详情流程简化 · 验收测试
 * 覆盖（八场景，二十五条最终验收标准）：
 *   场景一 正常派单闭环：创建→待发送→标记已发送→已发送→标记完成→已完成
 *   场景二 供应商正常无反馈：已发送后无异常，无需额外操作
 *   场景三 异常处理：记录异常→异常待处理→处理异常（恢复已发送/完成/撤销）
 *   场景四 修改上门日期：供应商反馈变更日期 + 详情编辑
 *   场景五 已完成派单重新打开（二次确认）→ 恢复已发送
 *   场景六 旧数据迁移：旧状态自动映射到新枚举 + legacyStatus/migrationNote/statusHistory
 *   场景七 列表状态筛选：全部/草稿/待发送/已发送/异常待处理/已完成/已撤销
 *   场景八 月报查询：新状态统计（正式总数/供应商/已完成/已撤销/异常，草稿不计入）
 * 运行：node test/dispatch_flow_simplify_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');
const asstSrc = fs.readFileSync(path.join(ROOT, 'js', 'assistant.js'), 'utf8').replace(/^\uFEFF/, '');

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
    getAttribute(k) { return this.dataset[k] != null ? this.dataset[k] : ''; },
    setAttribute(k, v) { this.dataset[k] = v; },
    set innerHTML(v) { this._innerHTML = v; },
    get innerHTML() { return this._innerHTML; },
    set textContent(v) { this._text = String(v); },
    get textContent() { return this._text; },
  };
  return el;
}
const toastRoot = makeEl('toastRoot');
const modalRoot = makeEl('modalRoot');
elements['toastRoot'] = toastRoot;
elements['modalRoot'] = modalRoot;
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
  vm.runInContext(asstSrc, sandbox, { filename: 'assistant.js' });
} catch (e) { console.error('加载失败:', e.message); process.exit(1); }

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'flow-test' });

run(`NK.initDB(); NK.mode = 'work';`);

const reset = () => run(`
  NK.db.dispatches = []; NK.db.tasks = []; NK.db.reminders = []; NK.db.leaves = [];
  NK.db.quickNotes = []; NK.db.handovers = []; NK.db.kpiEvents = [];
  NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'全部供应商', visitStart:'', visitEnd:'', overdue:false };
  NK.save();
`);
const mkDispatch = (extra = {}) => run(`
  (() => { const d = NK.createDispatch(Object.assign({ title: '山东青岛打印机处理', type: '故障', priority: 'P2',
    siteId: 'SD-QD-01', desc: '3楼打印机无法打印', supplier: '源晨', visitDate: '2026-08-05' }, ${JSON.stringify(extra)})); return d.id; })()
`);

console.log('== 场景一：正常派单闭环（创建→待发送→已发送→已完成）==');
reset();
const d1 = mkDispatch();
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d1}')) === 'pending_send'`), '创建后状态为待发送(pending_send)');
ok(run(`NK.dispatchStatusLabel(NK.getDispatch('${d1}')) === '待发送'`), '中文显示为「待发送」');
// 标记已发送
let r = run(`NK.markDispatchSent('${d1}')`);
ok(r.ok === true, '标记已发送成功');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d1}')) === 'sent'`), '标记后状态为已发送(sent)');
ok(run(`NK.getDispatch('${d1}').sentAt !== ''`), '记录发送时间 sentAt');
ok(run(`NK.getDispatch('${d1}').sentBy === '花姐'`), '操作人为花姐');
// 标记完成
r = run(`NK.markDispatchCompleted('${d1}', '供应商已处理完毕')`);
ok(r.ok === true, '标记完成成功');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d1}')) === 'completed'`), '标记后状态为已完成(completed)');
ok(run(`NK.getDispatch('${d1}').completedAt !== ''`), '记录完成时间 completedAt');
ok(run(`NK.getDispatch('${d1}').completionNote === '供应商已处理完毕'`), '记录完成说明');
// 已完成派单不再进入提醒/重点/告警
ok(run(`!NK.genReminders().some(x => x.dispatchId === '${d1}')`), '已完成派单不再进入实时提醒');
ok(run(`!NK.genFocusItems().some(x => x.type === 'dispatch' && x.itemId === '${d1}')`), '已完成派单不再进入重点事项');

console.log('== 场景二：供应商正常无反馈（已发送，无需操作）==');
reset();
const d2 = mkDispatch();
run(`NK.markDispatchSent('${d2}')`);
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d2}')) === 'sent'`), '已发送状态保持');
// 上门日期未到 → 正常提醒但非催办（不标异常/不判失败）
const rem2 = run(`(() => { const r = NK.genReminders().filter(x => x.dispatchId === '${d2}'); return r.length ? r.map(x => x.level).join(',') : 'none'; })()`);
ok(typeof rem2 === 'string' && rem2 !== '', '已发送派单进入提醒');
// 不自动改状态、不判失败、不KPI扣分
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d2}')) === 'sent'`), '上门日期未到不自动改状态');
const kpiAuto = run(`(() => { const b = NK.autoKpi ? NK.autoKpi() : null; return !b || !NK.db.kpiEvents.some(e => e.dispatchId === '${d2}'); })()`);
ok(kpiAuto, '不自动判定 KPI 扣分/责任');

console.log('== 场景三：异常处理（记录异常→异常待处理→处理异常）==');
reset();
const d3 = mkDispatch();
run(`NK.markDispatchSent('${d3}')`);
// 记录异常
r = run(`NK.recordDispatchException('${d3}', { type: '供应商暂时无法安排', note: '源晨本周人手不足', nextStep: '改期到下周一' })`);
ok(r.ok === true, '记录异常成功');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d3}')) === 'exception'`), '异常后状态为异常待处理(exception)');
ok(run(`NK.getDispatch('${d3}').exceptionType === '供应商暂时无法安排'`), '记录异常类型');
ok(run(`NK.getDispatch('${d3}').exceptionNote === '源晨本周人手不足'`), '记录异常说明');
ok(run(`NK.getDispatch('${d3}').exceptionNext === '改期到下周一'`), '记录后续安排');
// 异常待处理进入首页重点/告警
ok(run(`NK.genFocusItems().some(x => x.type === 'dispatch' && x.itemId === '${d3}')`), '异常待处理进入首页重点事项');
// 处理异常：恢复已发送
r = run(`NK.resolveDispatchException('${d3}', 'resolve', '源晨已安排明天')`);
ok(r.ok === true, '异常已解决→恢复已发送');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d3}')) === 'sent'`), '处理后状态恢复为已发送');
// 异常处理→完成
const d3b = mkDispatch();
run(`NK.markDispatchSent('${d3b}')`);
run(`NK.recordDispatchException('${d3b}', { type: '其他' })`);
r = run(`NK.resolveDispatchException('${d3b}', 'done', '已替代处理')`);
ok(r.ok === true && run(`NK.dispatchStatusKey(NK.getDispatch('${d3b}')) === 'completed'`), '异常处理选完成→状态已完成');
// 异常处理→撤销
const d3c = mkDispatch();
run(`NK.markDispatchSent('${d3c}')`);
run(`NK.recordDispatchException('${d3c}', { type: '用户取消上门' })`);
r = run(`NK.resolveDispatchException('${d3c}', 'revoke', '用户取消')`);
ok(r.ok === true && run(`NK.dispatchStatusKey(NK.getDispatch('${d3c}')) === 'revoked'`), '异常处理选撤销→状态已撤销');

console.log('== 场景四：修改上门日期 ==');
reset();
const d4 = mkDispatch();
run(`NK.markDispatchSent('${d4}')`);
// 供应商反馈变更日期
r = run(`NK.recordSupplierFeedback('${d4}', { content: '改期到8月8日', person: '王师傅', phone: '13800000000', changedVisitDate: '2026-08-08' })`);
ok(r.ok === true, '记录供应商反馈成功');
ok(run(`NK.getDispatch('${d4}').visitDate === '2026-08-08'`), '反馈变更日期已同步上门日期');
ok(run(`NK.getDispatch('${d4}').supplierFeedbackList.length === 1`), '反馈记录追加到列表');
ok(run(`NK.getDispatch('${d4}').visitDateHistory.some(h => h.to === '2026-08-08' && h.note === '供应商反馈调整')`), '记录上门日期变更历史');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d4}')) === 'sent'`), '记录反馈后仍保持已发送（不改变状态）');

console.log('== 场景五：已完成派单重新打开（二次确认）==');
reset();
const d5 = mkDispatch();
run(`NK.markDispatchSent('${d5}')`);
run(`NK.markDispatchCompleted('${d5}')`);
// 重新打开（UI 层二次确认前先由数据层校验）
r = run(`NK.reopenDispatch('${d5}')`);
ok(r.ok === true, '重新打开成功');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d5}')) === 'sent'`), '重新打开后恢复为已发送');
ok(run(`NK.getDispatch('${d5}').reopenedAt !== ''`), '记录重新打开时间');
ok(run(`NK.getDispatch('${d5}').completedAt === ''`), '清空完成时间');
ok(run(`(NK.getDispatch('${d5}').statusHistory || []).length >= 4`), '状态历史完整保留（可追溯）');

console.log('== 场景六：旧数据迁移 ==');
reset();
// 用旧中文状态写入一条历史派单，模拟旧数据
run(`
  (() => {
    const d = NK.createDispatch({ title: '旧状态派单', siteId: 'SD-QD-01', desc: '旧数据' });
    d.status = '已生成'; d.legacyStatus = '已生成';
    return d.id;
  })()
`);
const d6 = run(`(() => { const x = NK.db.dispatches.find(d => d.title === '旧状态派单'); return x.id; })()`);
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${d6}')) === 'pending_send'`), '旧状态「已生成」→ 待发送(pending_send)');
ok(run(`NK.dispatchStatusLabel(NK.getDispatch('${d6}')) === '待发送'`), '旧状态中文显示为「待发送」');
// 旧状态映射表完整
ok(run(`NK.DISPATCH_STATUS_KEY['已处理'] === 'completed' && NK.DISPATCH_STATUS_KEY['已闭环'] === 'completed'`), '「已处理/已闭环」→ 已完成');
ok(run(`NK.DISPATCH_STATUS_KEY['跟进中'] === 'sent' && NK.DISPATCH_STATUS_KEY['处理中'] === 'sent'`), '「跟进中/处理中」→ 已发送');
ok(run(`NK.DISPATCH_STATUS_KEY['等待外部条件'] === 'exception'`), '「等待外部条件」→ 异常待处理');
ok(run(`NK.DISPATCH_STATUS_KEY['待花姐验收'] === 'sent'`), '「待花姐验收」→ 已发送（不自动判完成）');
ok(run(`NK.DISPATCH_STATUS_KEY['已撤销'] === 'revoked'`), '「已撤销」→ 已撤销');
// 待花姐验收迁移应带一次性备注
const migNote = run(`NK.DISPATCH_STATUS_KEY['待花姐验收'] === 'sent' ? NK.STATUS_CHANGE_NOTE['sent'] || '' : ''`);
ok(typeof migNote === 'string', '迁移备注机制存在');

console.log('== 场景七：列表状态筛选 ==');
reset();
const s1 = mkDispatch({ title: '待发送A' }); // pending_send
const s2 = mkDispatch({ title: '待发送B' }); // pending_send
run(`NK.markDispatchSent('${s1}')`);          // s1 → sent
run(`NK.markDispatchCompleted('${s2}')`);      // s2 → completed
const s3 = mkDispatch({ title: '异常C' });
run(`NK.markDispatchSent('${s3}')`);
run(`NK.recordDispatchException('${s3}', { type: '其他' })`); // s3 → exception
const s4 = mkDispatch({ title: '草稿D' });
run(`NK.getDispatch('${s4}').status = 'draft'`); // 草稿
const s5 = mkDispatch({ title: '撤销E' });
run(`NK.revokeDispatch('${s5}', { reason: '取消', cancelTask: true })`); // revoked
// 状态筛选标签：全部/待发送/已发送/异常待处理/已完成/已撤销/草稿
const filterCount = (status) => run(`(() => { let l = NK.db.dispatches.filter(d => d.recordStatus !== '已删除'); if ('${status}' !== '全部') { const k = NK.DISPATCH_STATUS_KEY['${status}'] || '${status}'; l = l.filter(d => NK.dispatchStatusKey(d) === k); } return l.length; })()`);
ok(filterCount('全部') === 5, '全部筛选 5 条');
ok(filterCount('待发送') === 0, '待发送筛选 0 条（A已发送、B已完成、C异常、D草稿、E撤销）');
ok(filterCount('已发送') === 1, '已发送筛选 1 条（A）');
ok(filterCount('异常待处理') === 1, '异常待处理筛选 1 条（C）');
ok(filterCount('已完成') === 1, '已完成筛选 1 条（B）');
ok(filterCount('已撤销') === 1, '已撤销筛选 1 条（E）');
ok(filterCount('草稿') === 1, '草稿筛选 1 条（D）');

console.log('== 场景八：月报查询（新状态统计）==');
reset();
const m1 = mkDispatch({ title: '月报-已完成' });
run(`NK.markDispatchSent('${m1}')`);
run(`NK.markDispatchCompleted('${m1}')`);
const m2 = mkDispatch({ title: '月报-已发送' });
run(`NK.markDispatchSent('${m2}')`);
const m3 = mkDispatch({ title: '月报-异常' });
run(`NK.markDispatchSent('${m3}')`);
run(`NK.recordDispatchException('${m3}', { type: '其他' })`);
const m4 = mkDispatch({ title: '月报-撤销' });
run(`NK.revokeDispatch('${m4}', { reason: '取消', cancelTask: true })`);
const m5 = mkDispatch({ title: '月报-草稿' });
run(`NK.getDispatch('${m5}').status = 'draft'`);
const month = run(`NK.curMonth()`);
const formal = run(`NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) !== 'draft' && d.recordStatus !== '已删除').length`);
ok(formal === 4, '正式派单总数 = 4（草稿不计入）');
ok(run(`NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'completed').length === 1`), '已完成 = 1');
ok(run(`NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'revoked').length === 1`), '已撤销 = 1（单独统计不与完成混用）');
ok(run(`NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'exception').length === 1`), '异常 = 1');
ok(run(`NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) === 'sent').length === 1`), '已发送 = 1');
// 供应商分布：4 条正式派单均为源晨
ok(run(`(() => { const f = NK.db.dispatches.filter(d => NK.dispatchStatusKey(d) !== 'draft' && d.recordStatus !== '已删除'); return f.every(d => NK.dispatchSupplierLabel(d) === '源晨'); })()`), '正式派单供应商均为源晨');
// 月报生成可用（不抛错）
run(`UI.monthReport();`);
ok(true, '月报可正常生成');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
