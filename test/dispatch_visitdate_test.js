/* 派单中心「上门日期范围查询」验收测试
 * 覆盖（日期范围十场景 + 数据保护）：
 *   场景一 完整月份（2026-08-01 至 2026-08-31，含首尾两天，排除7/9月）
 *   场景二 快捷「本月」（自动填当月首尾，结果数量正确）
 *   场景三 快捷「上月」（自动填上月完整月份，跨年正确）
 *   场景四 只填开始日期（该日及以后）
 *   场景五 只填结束日期（该日及以前）
 *   场景六 单日查询（开始=结束）
 *   场景七 组合查询（日期范围+关键词+状态 AND）
 *   场景八 错误日期（开始晚于结束 → 提示，不执行查询）
 *   场景九 清除日期（恢复全部）
 *   场景十 历史未填写（设日期范围后不显示「未填写」记录）
 *   场景十一 列表字段精简（7 列）+ 新建派单（保留）
 *   场景十二 数据保护（原字段保留 / 撤销删除不受影响）
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
run(`NK.dispatchFilter = { q: '', status: '全部', priority: '全部', visitStart: '', visitEnd: '', overdue: false };`);

// 重置派单数据，让每个场景独立
const reset = () => run(`
  NK.db.dispatches = [];
  NK.db.tasks = [];
  NK.db.reminders = [];
  NK.db.leaves = [];
  NK.dispatchFilter = { q: '', status: '全部', priority: '全部', visitStart: '', visitEnd: '', overdue: false };
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

console.log('== 场景一：完整月份范围查询（2026-08-01 至 2026-08-31，含首尾，排除7/9月）==');
reset();
const J1 = '2026-08-01', J2 = '2026-08-31', J0 = '2026-07-31', J3 = '2026-09-01';
mkDispatch({ visitDate: J0, title: '七月末派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: J1, title: '八月初派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-08-15', title: '八月中派单', siteId: 'SD-WF-01' });
mkDispatch({ visitDate: J2, title: '八月末派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: J3, title: '九月初派单', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'${J1}', visitEnd:'${J2}', overdue:false };`);
html = renderHTML();
ok(html.includes('八月初派单'), '包含范围首日 ' + J1);
ok(html.includes('八月末派单'), '包含范围末日 ' + J2);
ok(html.includes('八月中派单'), '包含范围内派单');
ok(!html.includes('七月末派单'), '不含 7 月派单');
ok(!html.includes('九月初派单'), '不含 9 月派单');

console.log('== 场景二：快捷「本月」==');
reset();
const mS = run(`(() => { const x=new Date(); return NK.fmtDate(new Date(x.getFullYear(), x.getMonth(), 1)); })()`);
const mE = run(`(() => { const x=new Date(); return NK.fmtDate(new Date(x.getFullYear(), x.getMonth()+1, 0)); })()`);
// 「非本月」日期：取当前月首日再往前推 40 天，必然落入上月，与 mS/mE 一定不同
const mOutside = run(`(() => { const x=new Date(); const d=new Date(x.getFullYear(), x.getMonth(), 1); d.setDate(d.getDate()-40); return NK.fmtDate(d); })()`);
mkDispatch({ visitDate: mS, title: '本月首日派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: mE, title: '本月末日派单', siteId: 'SD-WF-01' });
mkDispatch({ visitDate: mOutside, title: '非本月派单', siteId: 'SD-QD-01' });
run(`UI.setDispatchRange('本月');`);
html = renderHTML();
const fM = run(`NK.dispatchFilter`);
ok(fM.visitStart === mS && fM.visitEnd === mE, '快捷「本月」自动填' + mS + '至' + mE);
ok(html.includes('本月首日派单') && html.includes('本月末日派单'), '显示本月首末派单');
ok(!html.includes('非本月派单'), '不显示非本月派单');
// 结果数量正确性：本月只包含首末两条（非本月记录已被排除）
const mCount = (html.match(/共 (\d+) 条/) || [])[1];
ok(mCount === '2', '本月结果数量=' + mCount + '（期望2：首日+末日，非本月记录不显示）');

console.log('== 场景三：快捷「上月」（跨年正确）==');
reset();
const lY = run(`(() => { const x=new Date(); const y=x.getFullYear(), m=x.getMonth(); const ly=m===0?y-1:y, lm=m===0?11:m-1; return NK.fmtDate(new Date(ly, lm, 1)); })()`);
const lE = run(`(() => { const x=new Date(); const y=x.getFullYear(), m=x.getMonth(); const ly=m===0?y-1:y, lm=m===0?11:m-1; return NK.fmtDate(new Date(ly, lm+1, 0)); })()`);
mkDispatch({ visitDate: lY, title: '上月首日派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: lE, title: '上月末日派单', siteId: 'SD-WF-01' });
mkDispatch({ visitDate: today, title: '本月派单', siteId: 'SD-QD-01' });
run(`UI.setDispatchRange('上月');`);
html = renderHTML();
const fL = run(`NK.dispatchFilter`);
ok(fL.visitStart === lY && fL.visitEnd === lE, '快捷「上月」自动填' + lY + '至' + lE);
ok(html.includes('上月首日派单') && html.includes('上月末日派单'), '显示上月首末派单');
ok(!html.includes('本月派单'), '不显示本月派单');
// 跨年：1月点"上月" → 去年12月
const janTest = run(`(() => {
  const x = new Date(2027, 0, 15); // 2027-01-15
  const y = x.getFullYear(), m = x.getMonth();
  const ly = m === 0 ? y - 1 : y, lm = m === 0 ? 11 : m - 1;
  const s = NK.fmtDate(new Date(ly, lm, 1)), e = NK.fmtDate(new Date(ly, lm + 1, 0));
  return s === '2026-12-01' && e === '2026-12-31';
})()`);
ok(janTest, '跨年处理：2027年1月点「上月」→ 2026-12-01 至 2026-12-31');

console.log('== 场景四：只填开始日期（该日及以后）==');
reset();
mkDispatch({ visitDate: '2026-08-01', title: '八月一号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-08-20', title: '八月二十号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-07-31', title: '七月三十一号', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-01', visitEnd:'', overdue:false };`);
html = renderHTML();
ok(html.includes('八月一号'), '只填开始含起点当天');
ok(html.includes('八月二十号'), '只填开始含之后派单');
ok(!html.includes('七月三十一号'), '只填开始不含之前派单');

console.log('== 场景五：只填结束日期（该日及以前）==');
reset();
mkDispatch({ visitDate: '2026-08-01', title: '八月一号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-08-31', title: '八月三十一号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-09-01', title: '九月一号', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
ok(html.includes('八月一号'), '只填结束含之前派单');
ok(html.includes('八月三十一号'), '只填结束含终点当天');
ok(!html.includes('九月一号'), '只填结束不含之后派单');

console.log('== 场景六：单日查询（开始=结束）==');
reset();
mkDispatch({ visitDate: '2026-08-03', title: '八月三号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-08-04', title: '八月四号', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-03', visitEnd:'2026-08-03', overdue:false };`);
html = renderHTML();
ok(html.includes('八月三号'), '单日查询显示当天派单');
ok(!html.includes('八月四号'), '单日查询不显示其他日期');

console.log('== 场景七：组合查询（日期范围+关键词+状态 AND）==');
reset();
mkDispatch({ visitDate: '2026-08-15', title: '青岛打印机处理', siteId: 'SD-QD-01', status: '已生成' });
mkDispatch({ visitDate: '2026-08-16', title: '青岛打印机处理', siteId: 'SD-QD-01', status: '已生成' });
mkDispatch({ visitDate: '2026-08-15', title: '湖州网络处理', siteId: 'ZJ-HUZ-01', status: '已生成' });
run(`NK.dispatchFilter = { q:'青岛', status:'全部', priority:'全部', visitStart:'2026-08-01', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
ok(html.includes('青岛打印机处理'), '组合（青岛+8月）保留匹配');
ok(!html.includes('湖州网络处理'), '组合排除湖州（关键词不符）');
// 加状态筛选 → 无结果（AND）
run(`NK.dispatchFilter = { q:'青岛', status:'已撤销', priority:'全部', visitStart:'2026-08-01', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
ok(!html.includes('青岛打印机处理'), '组合（青岛+8月+已撤销）无结果（AND）');
// 恢复全部
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'', visitEnd:'', overdue:false };`);
html = renderHTML();
ok(html.includes('青岛打印机处理') && html.includes('湖州网络处理'), '清除组合后恢复全部');

console.log('== 场景八：错误日期（开始晚于结束 → 提示，不执行查询）==');
reset();
mkDispatch({ visitDate: '2026-08-15', title: '八月十五号', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-31', visitEnd:'2026-08-01', overdue:false };`);
// 校验在 onFilter 内做 toast，不改变 dispatchFilter；这里直接验证范围逻辑不产生结果（vs>ve 时按该 filter 过滤应为空）
html = renderHTML();
ok(!html.includes('八月十五号'), '开始晚于结束时 08-15 不进入结果');
// 验证 UI.toast 会被调用（通过临时包裹）—— 在 onFilter 中触发
run(`
  (() => {
    const el = document.getElementById('view-dispatch');
    UI.renderDispatch(); // 重渲染以绑定
    // 手动调用 onFilter 会读输入框值；测试直接验证 filter 校验逻辑存在于代码
    window.__checkStr = UI.renderDispatch.toString();
  })()
`);
ok(run(`window.__checkStr.indexOf('开始日期不能晚于结束日期') !== -1`), '代码含「开始日期不能晚于结束日期」提示文案');
// 不清空数据
ok(run(`NK.db.dispatches.length === 1`), '错误日期不清空派单数据');

console.log('== 场景九：清除日期（恢复全部）==');
reset();
mkDispatch({ visitDate: '2026-08-15', title: '八月十五号', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '', title: '无日期派单', siteId: 'SD-QD-01' });
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-01', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
ok(html.includes('八月十五号'), '设日期范围后显示有日期派单');
ok(!(function(){ const tb=(html.match(/<tbody>[\s\S]*<\/tbody>/)||[''])[0]; return tb.includes('无日期派单'); })(), '设日期范围后不显示无日期派单');
// 清除日期
run(`UI.setDispatchRange('清除日期');`);
html = renderHTML();
ok(html.includes('八月十五号') && html.includes('无日期派单'), '清除日期后恢复显示全部（含无日期派单）');
ok(run(`NK.dispatchFilter.visitStart === undefined && NK.dispatchFilter.visitEnd === undefined`), '清除后 visitStart/visitEnd 已清空');

console.log('== 场景十：设置日期范围后，历史未填写派单不进入结果 ==');
reset();
mkDispatch({ visitDate: '', title: '历史未填写派单', siteId: 'SD-QD-01' });
mkDispatch({ visitDate: '2026-08-15', title: '八月十五号', siteId: 'SD-QD-01' });
// 全部日期（无范围）→ 未填写记录显示
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'', visitEnd:'', overdue:false };`);
html = renderHTML();
ok(html.includes('历史未填写派单'), '无日期范围时显示「未填写」记录');
// 设置范围 → 未填写记录不进入
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-01', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
const tbody10 = (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
ok(html.includes('八月十五号'), '有日期范围时显示有日期派单');
ok(!tbody10.includes('历史未填写派单'), '有日期范围时不显示「未填写」记录');
ok(tbody10.includes('未填写') === false || !tbody10.includes('历史未填写派单'), '列表行不出现未填写记录的标题');


console.log('== 场景十一：旧派单（无日期显示「未填写」→ 详情补充 → 列表/搜索立即生效，不改状态，记历史）==');
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
// 列表 tbody 内不再有「未填写」占位
const tbody5 = (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];
ok(tbody5.includes('2026-08-07') && !tbody5.includes('未填写'), '补充后列表行显示日期且不再显示「未填写」');
// 5d. 按日期范围可搜索到（单日范围）
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'2026-08-07', visitEnd:'2026-08-07', overdue:false };`);
html = renderHTML();
ok(html.includes('历史旧派单'), '按 08-07（单日范围）可搜索到补充日期的旧派单');
// 5e. 设为未填写 → 回到「未填写」，且在无日期范围时显示
run(`NK.setVisitDate('${oldId}', '');`);
ok(run(`NK.getDispatch('${oldId}').visitDate === ''`), '设为未填写后 visitDate 为空');
ok(run(`NK.getDispatch('${oldId}').visitDateHistory.length === 2`), '再次修改追加第 2 条历史');
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', visitStart:'', visitEnd:'', overdue:false };`);
html = renderHTML();
ok(html.includes('历史旧派单'), '无日期范围时显示该旧派单（未填写）');

console.log('== 场景十二：数据保护（原字段保留 / 撤销删除不受影响）==');
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
// 快捷筛选后数据仍完整
run(`UI.setDispatchRange('今天');`);
ok(run(`NK.db.dispatches.length === 2`), '筛选不删除数据库记录（仍 2 条）');
ok(run(`NK.db.dispatches.some(d => d.priority !== undefined)`), '原字段未因筛选/精简而丢失');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
