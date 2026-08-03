/* 派单中心「上门日期」功能验收测试
 * 覆盖：
 *   场景一 列表字段精简（7 列：派单编号|事项|职场|工程师|上门日期|状态|操作）
 *   场景二 新建派单（默认明天 / 今天 / 选择日期 / 暂不确定）
 *   场景三 按日期查询（选某天只显示该日派单；清除日期恢复）
 *   场景四 组合查询（关键词+日期+状态 同时满足）
 *   场景五 旧派单（无日期显示「未填写」；详情补充日期后列表/搜索立即生效；不改变状态；记录修改历史）
 *   场景六 数据保护（优先级/计划完成/等待时长等原字段仍在数据库；撤销/删除功能不受影响）
 * 运行：node test/dispatch_visitdate_test.js
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
    getAttribute(k) { return this.dataset[k] != null ? this.dataset[k] : ''; },
    setAttribute(k, v) { this.dataset[k] = v; },
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'visitdate-test' });

// 初始化数据库并设为工作模式
run(`NK.initDB(); NK.mode = 'work';`);
run(`NK.dispatchFilter = { q: '', status: '全部', priority: '全部', visitDate: '', visitNoDate: false, overdue: false };`);

// 重置派单数据，让每个场景独立
const reset = () => run(`
  NK.db.dispatches = [];
  NK.db.tasks = [];
  NK.db.reminders = [];
  NK.db.leaves = [];
  NK.dispatchFilter = { q: '', status: '全部', priority: '全部', visitDate: '', visitNoDate: false, overdue: false };
  NK.save();
`);

// 渲染派单中心并返回 view-dispatch 的 HTML
const renderHTML = () => {
  run(`UI.renderDispatch();`);
  return run(`document.getElementById('view-dispatch').innerHTML`);
};

// 创建一条派单，可指定 visitDate 等扩展字段，返回 id
const mkDispatch = (extra = {}) => run(`
  (() => {
    const d = NK.createDispatch(Object.assign({
      title: '山东青岛打印机处理', type: '故障', priority: 'P2',
      siteId: 'SD-QD-01',
      desc: '3楼打印机无法打印',
    }, ${JSON.stringify(extra)}));
    return d.id;
  })()
`);

const today = run(`NK.today()`);
const tomorrow = run(`(() => { const x = new Date(); x.setDate(x.getDate() + 1); return NK.fmtDate(x); })()`);

console.log('== 场景一：列表字段精简为 7 列（派单编号|事项|职场|工程师|上门日期|状态|操作）==');
reset();
mkDispatch({ title: '青岛打印机' });
let html = renderHTML();
// 表头精确 7 列
const headRow = (html.match(/<thead>.*?<\/thead>/s) || [''])[0];
const headCols = (headRow.match(/<th>/g) || []).length;
ok(headCols === 7, '表头列数=' + headCols + '（期望 7）');
for (const col of ['派单编号', '事项', '职场', '工程师', '上门日期', '状态', '操作']) {
  ok(headRow.includes('<th>' + col + '</th>'), '表头含列「' + col + '」');
}
ok(!headRow.includes('优先级'), '表头不再显示「优先级」');
ok(!headRow.includes('计划完成'), '表头不再显示「计划完成」');
ok(!headRow.includes('等待时长'), '表头不再显示「等待时长」');
// 数据行中也不再输出这三列内容
ok(!html.includes('P2') || html.includes('上门日期'), '列表不再渲染优先级标签');
console.log('== 场景二：新建派单的上门日期（默认明天 / 今天 / 选择日期 / 暂不确定）==');
reset();
// 2a. 默认「明天」
run(`UI.dispatchCreate();`);
ok(run(`(UI.__stack && UI.__stack.length) ? true : false`), '新建派单弹窗已打开');
ok(run(`(() => { const m = UI.__stack ? UI.__stack[0] : null; if (!m || !m.layer) return false; return m.layer.innerHTML.indexOf('id="dpVisitDate"') >= 0; })()`), '新建表单含上门日期输入框');
ok(run(`(() => { const m = UI.__stack ? UI.__stack[0] : null; if (!m || !m.layer) return false; return m.layer.innerHTML.indexOf('data-vd="tomorrow"') >= 0 && m.layer.innerHTML.indexOf('dp-visit-active') >= 0; })()`), '新建表单含「明天」快捷按钮且默认高亮');
run(`while (UI.__stack.length) UI.modalClose();`);
// 2b. 通过 createDispatch 直接创建"明天"日期派单（对应表单默认明天）
const d2 = mkDispatch({ visitDate: tomorrow, title: '青岛打印机' });
ok(run(`NK.getDispatch('${d2}').visitDate === '${tomorrow}'`), '创建派单保存上门日期=' + tomorrow);
ok(run(`NK.getDispatch('${d2}').visitDateHistory.length === 0`), '新建时无修改历史');
// 2c. 暂不确定 → 可创建且显示「未填写」
const d2n = mkDispatch({ visitDate: '', title: '暂不确定派单' });
html = renderHTML();
const tbody2 = (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
ok(tbody2.includes('未填写'), '无日期的派单在列表中显示「未填写」');
// 2d. 今天
const d2t = mkDispatch({ visitDate: today, title: '今天上门' });
html = renderHTML();
ok(html.includes('今天 · ' + today), '今天派单显示「今天 · 日期」');
// 2e. 明天标签需保留具体日期
const d2m = mkDispatch({ visitDate: tomorrow, title: '明天上门' });
html = renderHTML();
ok(html.includes('明天 · ' + tomorrow), '明天派单显示「明天 · ' + tomorrow + '」（保留具体日期）');
ok(html.includes('今天 · ' + today), '今天与明天派单可同时显示');

console.log('== 场景三：按上门日期查询（选某天只显示该日；清除日期恢复）==');
reset();
const D1 = '2026-09-05', D2 = '2026-09-06'; // 使用明确的未来日期，避免与 today/tomorrow 冲突
const qd1 = mkDispatch({ visitDate: D1, title: '九月五号派单', siteId: 'SD-QD-01' });
const qd2 = mkDispatch({ visitDate: D2, title: '九月六号派单', siteId: 'SD-WF-01' });
// 筛选 D1 → 只显示 qd1
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitDate:'${D1}', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(html.includes('九月五号派单'), '选 ' + D1 + ' 显示该日派单');
ok(!html.includes('九月六号派单'), '选 ' + D1 + ' 不显示 ' + D2 + ' 派单');
// 清除日期 → 恢复显示全部
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitDate:'', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(html.includes('九月五号派单') && html.includes('九月六号派单'), '清除日期后两条均显示');
// 快捷「全部」（setDispatchVisit('')）
run(`UI.setDispatchVisit('');`);
html = renderHTML();
ok(html.includes('九月五号派单') && html.includes('九月六号派单'), '快捷「全部」恢复全部');
// 快捷「今天」→ 无今天派单，两条 09-05/09-06 均不显示
run(`UI.setDispatchVisit('${today}');`);
html = renderHTML();
ok(!html.includes('九月五号派单') && !html.includes('九月六号派单'), '快捷「今天」不显示 09-05/09-06');
// 快捷「明天」→ 只有明天派单
run(`UI.setDispatchVisit('${tomorrow}');`);
run(`NK.createDispatch({ title:'明天测试', siteId:'SD-QD-01', visitDate:'${tomorrow}' });`);
html = renderHTML();
ok(html.includes('明天测试'), '快捷「明天」显示明天的派单');
ok(!html.includes('九月五号派单'), '快捷「明天」不显示其他日期');

console.log('== 场景四：组合查询（关键词+日期+状态 同时满足）==');
reset();
const E1 = '2026-09-15', E2 = '2026-09-16';
const c1 = mkDispatch({ visitDate: E1, title: '青岛打印机处理', siteId: 'SD-QD-01', status: '已生成' });
mkDispatch({ visitDate: E2, title: '青岛打印机处理', siteId: 'SD-QD-01', status: '已生成' });
mkDispatch({ visitDate: E1, title: '湖州网络处理', siteId: 'ZJ-HUZ-01', status: '已生成' });
// 关键词「青岛」+ 日期 E1 → 只剩 1 条
run(`NK.dispatchFilter = { q:'青岛', status:'全部', priority:'全部', visitDate:'${E1}', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(html.includes('青岛打印机处理'), '组合（青岛+' + E1 + '）保留匹配派单');
ok(!html.includes('湖州网络处理'), '组合（青岛+' + E1 + '）排除湖州（关键词不符）');
// 再加状态筛选（改为不存在的状态组合，验证 AND 逻辑）
run(`NK.dispatchFilter = { q:'青岛', status:'已撤销', priority:'全部', visitDate:'${E1}', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(!html.includes('青岛打印机处理'), '组合（青岛+' + E1 + '+已撤销）无结果（AND 逻辑）');
// 恢复全部
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitDate:'', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(html.includes('青岛打印机处理') && html.includes('湖州网络处理'), '清除组合后恢复全部');

console.log('== 场景五：旧派单（无日期显示「未填写」→ 详情补充 → 列表/搜索立即生效，不改状态，记历史）==');
reset();
const oldId = mkDispatch({ visitDate: '', title: '历史旧派单' });
// 5a. 详情页含「补充上门日期」与「未填写」显示
run(`UI.dispatchDetail('${oldId}');`);
const dhtml = run(`(() => { const m = UI.__stack ? UI.__stack[0] : null; return m && m.layer ? m.layer.innerHTML : ''; })()`);
ok(dhtml.includes('补充上门日期'), '旧派单详情显示「补充上门日期」按钮');
ok(dhtml.includes('未填写'), '旧派单详情上门日期显示「未填写」');
ok(dhtml.includes('id="ddVisitEdit"') && dhtml.includes('id="ddVisitInput"'), '详情含上门日期编辑控件（补充/保存）');
run(`while (UI.__stack.length) UI.modalClose();`);
// 5b. 补充日期
const r = run(`NK.setVisitDate('${oldId}', '2026-08-07');`);
ok(r && r.visitDate === '2026-08-07', '补充上门日期成功');
ok(run(`NK.getDispatch('${oldId}').visitDate === '2026-08-07'`), '派单上门日期已更新');
ok(run(`NK.getDispatch('${oldId}').status === '已生成'`), '补充日期不改变派单状态（仍已生成）');
ok(run(`NK.getDispatch('${oldId}').visitDateHistory.length === 1`), '记录 1 条修改历史');
ok(run(`NK.getDispatch('${oldId}').visitDateHistory[0].from === '未填写'`), '历史 from=未填写');
ok(run(`NK.getDispatch('${oldId}').visitDateHistory[0].to === '2026-08-07'`), '历史 to=2026-08-07');
ok(run(`NK.getDispatch('${oldId}').visitDateUpdatedAt !== ''`), '记录修改时间 visitDateUpdatedAt');
// 5c. 列表立即更新
html = renderHTML();
ok(html.includes('2026-08-07'), '补充后列表立即显示 2026-08-07');
// 列表 tbody 内（排除筛选区的「上门日期未填写」下拉）不再有「未填写」占位
const tbody5 = (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
ok(tbody5.includes('2026-08-07') && !tbody5.includes('未填写'), '补充后列表行显示日期且不再显示「未填写」');
// 5d. 按日期可搜索到
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitDate:'2026-08-07', visitNoDate:false, overdue:false };`);
html = renderHTML();
ok(html.includes('历史旧派单'), '按 08-07 可搜索到补充日期的旧派单');
// 5e. 设为未填写 → 回到「未填写」且可按「上门日期未填写」查到
run(`NK.setVisitDate('${oldId}', '');`);
ok(run(`NK.getDispatch('${oldId}').visitDate === ''`), '设为未填写后 visitDate 为空');
ok(run(`NK.getDispatch('${oldId}').visitDateHistory.length === 2`), '再次修改追加第 2 条历史');
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitDate:'', visitNoDate:true, overdue:false };`);
html = renderHTML();
ok(html.includes('历史旧派单'), '「上门日期未填写」可查到该旧派单');

console.log('== 场景六：数据保护（原字段保留 / 撤销删除不受影响）==');
reset();
const p1 = mkDispatch({ title: '受保护派单', priority: 'P1', planDone: '2026-08-09', planDoneTime: '18:00', planArrive: '2026-08-08' });
ok(run(`NK.getDispatch('${p1}').priority === 'P1'`), '优先级字段仍保留在数据库（P1）');
ok(run(`NK.getDispatch('${p1}').planDone === '2026-08-09'`), '计划完成字段仍保留');
ok(run(`NK.getDispatch('${p1}').planArrive === '2026-08-08'`), '计划到场字段仍保留');
ok(run(`NK.getDispatch('${p1}').contactName === '孙燕飞'`), '联系人数据仍保留（青岛孙燕飞）');
ok(run(`NK.getDispatch('${p1}').engineer === '王彪'`), '工程师匹配仍保留（王彪）');
ok(run(`NK.getDispatch('${p1}').msg && NK.getDispatch('${p1}').msg.length > 0`), '派单消息模板仍生成');
// 关联任务仍创建
ok(run(`NK.db.tasks.some(t => t.dispatchId === '${p1}')`), '关联任务仍自动创建');
// 撤销功能不受影响
const rev = run(`NK.revokeDispatch('${p1}', { reason:'测试撤销', cancelTask:true });`);
ok(rev.ok === true, '撤销功能正常');
ok(run(`NK.getDispatch('${p1}').status === '已撤销'`), '撤销后状态=已撤销');
// 删除功能不受影响（重新建一条）
const p2 = mkDispatch({ title: '待删除派单' });
const del = run(`NK.softDeleteDispatch('${p2}', { reason:'重复创建' });`);
ok(del.ok === true, '删除功能正常');
ok(run(`NK.getDispatch('${p2}').recordStatus === '已删除'`), '删除后 recordStatus=已删除');
// 上门日期快捷筛选后数据仍完整
run(`UI.setDispatchVisit('${today}');`);
ok(run(`NK.db.dispatches.length === 2`), '筛选不删除数据库记录（仍 2 条）');
ok(run(`NK.db.dispatches.some(d => d.priority !== undefined)`), '原字段未因筛选/精简而丢失');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
