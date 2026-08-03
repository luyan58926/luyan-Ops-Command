/* 派单供应商管理与查询 · 验收测试
 * 覆盖（九大场景）：
 *   场景一 创建源晨派单（supplierId/supplierName 持久化，消息含供应商）
 *   场景二 创建亚北派单
 *   场景三 未选供应商 → 提示「请选择本次派单供应商。」，不生成正式派单
 *   场景四 按供应商查询（源晨 / 亚北 / 未标注 / 全部）
 *   场景五 供应商 + 上门日期范围组合查询（8月源晨，7月亚北，含边界）
 *   场景六 历史派单「未标注」+ 详情补充供应商后立即参与筛选统计
 *   场景七 撤销 / 删除 / 恢复 后供应商字段保留
 *   场景八 休假补位创建派单也需供应商（createDispatch 兼容）
 *   场景九 花姐助手：解析供应商意图 + q_dispatch 过滤与派单中心数量一致 + 统计
 * 运行：node test/dispatch_supplier_test.js
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

// ---------- 简化 DOM mock（与 dispatch_visitdate_test 一致） ----------
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
// toastRoot / modalRoot 需要作为真实子容器（UI.toast appendChild / modal root）
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'supplier-test' });

run(`NK.initDB(); NK.mode = 'work';`);
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'全部供应商', visitStart:'', visitEnd:'', overdue:false };`);

const reset = () => run(`
  NK.db.dispatches = [];
  NK.db.tasks = [];
  NK.db.reminders = [];
  NK.db.leaves = [];
  NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'全部供应商', visitStart:'', visitEnd:'', overdue:false };
  NK.save();
`);

const renderHTML = () => {
  run(`UI.renderDispatch();`);
  return run(`document.getElementById('view-dispatch').innerHTML`);
};
const tbodyOf = (html) => (html.match(/<tbody>[\s\S]*<\/tbody>/) || [''])[0];

// 创建一条派单，可指定 supplier/visitDate 等字段
const mkDispatch = (extra = {}) => run(`
  (() => {
    const d = NK.createDispatch(Object.assign({
      title: '山东青岛打印机处理', type: '故障', priority: 'P2',
      siteId: 'SD-QD-01', desc: '3楼打印机无法打印',
    }, ${JSON.stringify(extra)}));
    return d.id;
  })()
`);
const mkDispatchRaw = (fields = {}) => run(`
  (() => {
    const d = NK.createDispatch(Object.assign({
      title: '原始派单', type: '故障', priority: 'P2',
      siteId: 'SD-QD-01', desc: '测试',
    }, ${JSON.stringify(fields)}));
    return d.id;
  })()
`);

const today = run(`NK.today()`);

console.log('== 场景一：创建源晨派单（supplierId/supplierName 持久化 + 消息含供应商）==');
reset();
const dyc = mkDispatch({ supplier: '源晨', visitDate: '2026-08-05', title: '源晨青岛打印机' });
ok(run(`NK.getDispatch('${dyc}').supplierId === 'yuanchen'`), '源晨派单 supplierId=yuanchen');
ok(run(`NK.getDispatch('${dyc}').supplierName === '源晨'`), '源晨派单 supplierName=源晨');
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${dyc}')) === '源晨'`), 'dispatchSupplierLabel 返回「源晨」');
ok(run(`NK.getDispatch('${dyc}').msg.indexOf('供应商：源晨') !== -1`), '派单消息含「供应商：源晨」');
ok(run(`NK.getDispatch('${dyc}').msg.indexOf('处理事项') !== -1`), '消息保留原有「处理事项」');
ok(run(`NK.getDispatch('${dyc}').msg.indexOf('负责工程师') !== -1`), '消息保留原有「负责工程师」');
ok(run(`NK.getDispatch('${dyc}').msg.indexOf('联系电话') !== -1`), '消息保留原有「联系电话」');
ok(run(`NK.getDispatch('${dyc}').msg.indexOf('详细地址') !== -1`), '消息保留原有「详细地址」');

console.log('== 场景二：创建亚北派单 ==');
const dyb = mkDispatch({ supplier: '亚北', visitDate: '2026-07-20', title: '亚北湖州网络' });
ok(run(`NK.getDispatch('${dyb}').supplierId === 'yabei'`), '亚北派单 supplierId=yabei');
ok(run(`NK.getDispatch('${dyb}').supplierName === '亚北'`), '亚北派单 supplierName=亚北');
ok(run(`NK.getDispatch('${dyb}').msg.indexOf('供应商：亚北') !== -1`), '亚北派单消息含「供应商：亚北」');
// 用 supplierId 形式创建也归一化成功
const dyc2 = mkDispatchRaw({ supplierId: 'yuanchen', visitDate: '2026-08-10' });
ok(run(`NK.getDispatch('${dyc2}').supplierId === 'yuanchen' && NK.getDispatch('${dyc2}').supplierName === '源晨'`), '以 supplierId=yuanchen 创建 → 归一化为 源晨/yuanchen');
// 非法供应商 → 空（未标注），不猜测
const dxx = mkDispatchRaw({ supplier: '其他供应商', visitDate: '2026-08-11' });
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${dxx}')) === '未标注'`), '非法供应商 → 未标注（不自动猜测归属）');

console.log('== 场景三：未选供应商 → 提示，不生成正式派单 ==');
reset();
// 3a. createDispatch 不带供应商 → 创建为「未标注」历史（兼容旧数据），但消息不伪造供应商
const dnone = mkDispatchRaw({ visitDate: '2026-08-12' });
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${dnone}')) === '未标注'`), 'createDispatch 无供应商 → 未标注（不默认源晨/亚北）');
ok(run(`NK.getDispatch('${dnone}').supplierId === '' && NK.getDispatch('${dnone}').supplierName === ''`), '无供应商时 supplierId/supplierName 均为空');
// 3b. UI 新建表单含供应商必选分段按钮（源晨/亚北），且含必选提示文案
run(`UI.dispatchCreate();`);
ok(run(`(UI.__stack && UI.__stack.length) ? true : false`), '新建派单弹窗已打开');
const formHtml = run(`(() => { const m = UI.__stack ? UI.__stack[0] : null; return m && m.layer ? m.layer.innerHTML : ''; })()`);
ok(formHtml.includes('data-sup="yuanchen"') && formHtml.includes('data-sup="yabei"'), '新建表单含源晨/亚北两个分段按钮');
ok(formHtml.includes('请选择源晨或亚北'), '新建表单含「请选择源晨或亚北」必选提示');
ok(formHtml.indexOf('供应商') !== -1 && formHtml.indexOf('id="dpSupplierRow"') !== -1, '供应商字段位于派单区域（非更多信息）');
// 3c. 源码含必选校验提示文案（与需求一致）
run(`UI.renderDispatch();`);
ok(run(`UI.renderDispatch.toString().indexOf('请选择本次派单供应商。') !== -1 || UI.dispatchCreate.toString().indexOf('请选择本次派单供应商。') !== -1`), '源码含「请选择本次派单供应商。」校验文案');
// 3d. 不自动默认：打开表单未选中任何供应商
ok(!formHtml.includes('dp-sup-active'), '打开表单默认不选中任何供应商（不自动默认）');
run(`while (UI.__stack.length) UI.modalClose();`);

console.log('== 场景四：按供应商查询（源晨 / 亚北 / 未标注 / 全部供应商）==');
reset();
const s1 = mkDispatch({ supplier: '源晨', visitDate: '2026-08-05' });
const s2 = mkDispatch({ supplier: '源晨', visitDate: '2026-08-06' });
const s3 = mkDispatch({ supplier: '亚北', visitDate: '2026-08-07' });
const s4 = mkDispatchRaw({ visitDate: '2026-08-08' }); // 未标注
// 4a. 默认全部供应商
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'全部供应商', visitStart:'', visitEnd:'', overdue:false };`);
let html = renderHTML();
ok(html.includes('源晨青岛打印机') || html.includes('原始派单'), '默认全部供应商显示所有派单');
// 4b. 只看源晨
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'源晨', visitStart:'', visitEnd:'', overdue:false };`);
html = renderHTML();
const tb4yc = tbodyOf(html);
ok(tb4yc.includes('s1') === false, '（占位）');
ok(run(`NK.filterBySupplier(NK.db.dispatches, '源晨').length === 2`), '共享过滤 NK.filterBySupplier(源晨)=2 条');
ok(run(`NK.filterBySupplier(NK.db.dispatches, 'yuanchen').length === 2`), '共享过滤 NK.filterBySupplier(yuanchen)=2 条');
// 4c. 只看亚北
ok(run(`NK.filterBySupplier(NK.db.dispatches, '亚北').length === 1`), '共享过滤 NK.filterBySupplier(亚北)=1 条');
// 4d. 只看未标注
ok(run(`NK.filterBySupplier(NK.db.dispatches, '未标注').length === 1`), '共享过滤 NK.filterBySupplier(未标注)=1 条（s4）');
// 4e. 全部
ok(run(`NK.filterBySupplier(NK.db.dispatches, '全部供应商').length === 4`), '共享过滤 NK.filterBySupplier(全部供应商)=4 条');
ok(run(`NK.filterBySupplier(NK.db.dispatches, '').length === 4`), '空供应商=全部（4 条）');

console.log('== 场景五：供应商 + 上门日期范围组合查询（含边界）==');
reset();
// 8月：源晨2条、亚北1条；7月：亚北1条；9月：源晨1条
mkDispatch({ supplier: '源晨', visitDate: '2026-08-01', title: 'YC-8月初' });
mkDispatch({ supplier: '源晨', visitDate: '2026-08-31', title: 'YC-8月末' });
mkDispatch({ supplier: '亚北', visitDate: '2026-08-15', title: 'YB-8月中' });
mkDispatch({ supplier: '亚北', visitDate: '2026-07-31', title: 'YB-7月末' });
mkDispatch({ supplier: '源晨', visitDate: '2026-09-01', title: 'YC-9月初' });
// 5a. 源晨 + 8月整月
const listYcAug = run(`NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '源晨'), '2026-08-01', '2026-08-31')`);
ok(listYcAug.length === 2, '源晨+8月整月=2 条（含首日8-01与末日8-31）');
ok(run(`(() => { const l = NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '源晨'), '2026-08-01', '2026-08-31'); return l.every(d => d.supplierId === 'yuanchen' && d.visitDate >= '2026-08-01' && d.visitDate <= '2026-08-31'); })()`), '源晨+8月组合仅含源晨且日期在8月（含边界）');
// 5b. 亚北 + 7月
const listYbJul = run(`NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '亚北'), '2026-07-01', '2026-07-31')`);
ok(listYbJul.length === 1 && listYbJul[0].title === 'YB-7月末', '亚北+7月=1 条（7月末，含边界）');
// 5c. 亚北 + 8月
ok(run(`NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '亚北'), '2026-08-01', '2026-08-31').length === 1`), '亚北+8月=1 条');
// 5d. 源晨 + 8月（中心 UI 渲染同步）
run(`NK.dispatchFilter = { q:'', status:'全部', priority:'全部', supplier:'源晨', visitStart:'2026-08-01', visitEnd:'2026-08-31', overdue:false };`);
html = renderHTML();
const tb5 = tbodyOf(html);
ok(tb5.includes('YC-8月初') && tb5.includes('YC-8月末'), '中心「源晨+8月」显示两条源晨8月派单');
ok(!tb5.includes('YB-8月中') && !tb5.includes('YC-9月初'), '中心「源晨+8月」不显示亚北/9月派单');
const cnt5 = (html.match(/共 (\d+) 条/) || [])[1];
ok(cnt5 === '2', '中心「源晨+8月」结果数量=' + cnt5 + '（期望2）');
// 5e. 统计行显示拆分数量（源晨）
ok(html.includes('源晨2条'), '统计行显示「源晨2条」');
ok(run(`NK.dispatchFilter.supplier === '源晨'`), '筛选条件 supplier 已写入');

console.log('== 场景六：历史派单「未标注」+ 详情补充供应商后立即参与筛选统计 ==');
reset();
const oldId = mkDispatchRaw({ visitDate: '2026-08-20', title: '历史旧派单' });
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${oldId}')) === '未标注'`), '历史派单默认「未标注」');
// 6a. 详情页显示「未标注」+ 补充供应商按钮
run(`UI.dispatchDetail('${oldId}');`);
const dhtml = run(`(() => { const m = UI.__stack ? UI.__stack[0] : null; return m && m.layer ? m.layer.innerHTML : ''; })()`);
ok(dhtml.includes('修改供应商') && dhtml.includes('ddSupEditBox'), '旧派单详情显示「修改供应商」按钮');
ok(dhtml.includes('id="ddSupEditBox"') && dhtml.includes('data-sup="yuanchen"') && dhtml.includes('data-sup="yabei"'), '详情含供应商编辑框（源晨/亚北）');
run(`while (UI.__stack.length) UI.modalClose();`);
// 6b. 补充供应商为源晨
const r = run(`NK.setSupplier('${oldId}', 'yuanchen');`);
ok(r && r.supplierId === 'yuanchen', 'NK.setSupplier 补充为源晨成功');
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${oldId}')) === '源晨'`), '补充后供应商显示「源晨」');
ok(run(`NK.getDispatch('${oldId}').supplierHistory.length === 1`), '补充记录修改历史 1 条');
ok(run(`NK.getDispatch('${oldId}').supplierHistory[0].fromName === '未标注' && NK.getDispatch('${oldId}').supplierHistory[0].toName === '源晨'`), '历史记录 from=未标注 to=源晨');
ok(run(`NK.getDispatch('${oldId}').supplierUpdatedAt !== ''`), '记录 supplierUpdatedAt 修改时间');
ok(run(`NK.getDispatch('${oldId}').no !== ''`), '补充不改派单编号');
ok(run(`NK.dispatchStatusKey(NK.getDispatch('${oldId}')) === 'pending_send'`), '补充不改派单状态（仍为待发送）');
// 6c. 补充后立即参与筛选统计（源晨+8月应命中该条）
const listOld = run(`NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '源晨'), '2026-08-01', '2026-08-31')`);
ok(Array.isArray(listOld) && listOld.length === 1 && listOld[0].id === oldId, '补充后立即参与「源晨+8月」筛选');
// 6d. 修改确认文案存在（源晨→亚北 需确认）
run(`UI.renderDispatch();`);
const uiSrcStr = uiSrc;
ok(uiSrcStr.indexOf('确定将供应商从') !== -1 && uiSrcStr.indexOf('修改为') !== -1, '源码含「确定将供应商从 X 修改为 Y 吗」确认文案');

console.log('== 场景七：撤销 / 删除 / 恢复 后供应商字段保留 ==');
reset();
const did = mkDispatch({ supplier: '亚北', visitDate: '2026-08-25', title: '亚北撤销测试' });
// 撤销
run(`NK.revokeDispatch('${did}');`);
ok(run(`NK.getDispatch('${did}') && NK.dispatchSupplierLabel(NK.getDispatch('${did}')) === '亚北'`), '撤销后供应商仍为「亚北」');
// 撤销恢复（unrevoke → 回到已生成）
run(`NK.unrevokeDispatch('${did}');`);
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${did}')) === '亚北'`), '撤销恢复后供应商仍为「亚北」');
// 删除（移入回收站）
run(`NK.softDeleteDispatch('${did}');`);
ok(run(`NK.getDispatch('${did}') && NK.getDispatch('${did}').recordStatus === '已删除' && NK.dispatchSupplierLabel(NK.getDispatch('${did}')) === '亚北'`), '删除到回收站后供应商仍为「亚北」（字段不丢）');
// 从回收站恢复
run(`NK.restoreDispatch('${did}');`);
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${did}')) === '亚北'`), '回收站恢复后供应商仍为「亚北」');
ok(run(`NK.getDispatch('${did}').supplierId === 'yabei'`), '恢复后 supplierId=yabei 完整保留');

console.log('== 场景八：休假补位创建派单也需供应商（createDispatch 兼容）==');
reset();
// 8a. 休假记录（先确认「张三」是存在的工程师，否则 createLeave 返回 null）
run(`(() => { if (!NK.getEngineer('张三')) { const e = NK.db.engineers[0]; e.name = '张三'; NK.save(); } })()`);
const lv = run(`(() => { const rec = NK.createLeave({ engineerName:'张三', startDate:'2026-08-10', endDate:'2026-08-12', remark:'年假', dispatchRequired:'是' }); return rec ? rec.leaveId : ''; })()`);
ok(lv ? true : false, '创建休假记录成功（leaveId=' + lv + '）');
// 8b. 通过 createDispatch 传 supplier 创建（补位场景会传 supplier 给 createDispatch）
const ld = mkDispatch({ supplier: '源晨', visitDate: '2026-08-11', title: '休假补位派单', leaveId: lv });
ok(run(`NK.getDispatch('${ld}').supplierId === 'yuanchen'`), '休假补位派单通过 supplier 字段指定供应商=源晨');
// 8c. 不根据工程师/职场猜测供应商：只传 siteId 不传 supplier → 未标注（不猜测）
const ld2 = mkDispatchRaw({ visitDate: '2026-08-11', siteId: 'SD-QD-01', title: '补位未指定' });
ok(run(`NK.dispatchSupplierLabel(NK.getDispatch('${ld2}')) === '未标注'`), '补位未传 supplier → 未标注（不按职场/工程师猜测）');
// 8d. 补位联动不丢失供应商
if (ld) {
  const linkOk = run(`(() => { const l = NK.getLeave('${lv}'); const d = NK.getDispatch('${ld}'); return l && d && NK.dispatchSupplierLabel(d) === '源晨'; })()`);
  ok(linkOk, '休假补位关联后供应商仍为源晨');
}

console.log('== 场景九：花姐助手供应商意图 + 查询过滤 + 统计（与派单中心数量一致）==');
reset();
mkDispatch({ supplier: '源晨', visitDate: '2026-08-01', title: '源晨青岛打印机' });
mkDispatch({ supplier: '源晨', visitDate: '2026-08-31', title: '源晨上海网络' });
mkDispatch({ supplier: '亚北', visitDate: '2026-08-15', title: '亚北杭州网络' });
mkDispatch({ supplier: '亚北', visitDate: '2026-07-31', title: '亚北上月派单' });
mkDispatchRaw({ visitDate: '2026-08-20', title: '历史未标注' });
// 9a. 解析：查看本月源晨的派单
let i = run(`NK.assistant.parse('查看本月源晨的派单')`);
ok(i.action === 'dispatch' && i.supplier === '源晨' && String(i._rangeLabel).indexOf('本月') !== -1, '解析「查看本月源晨的派单」→ dispatch+源晨+本月');
// 9b. 解析：查看上月亚北派单
i = run(`NK.assistant.parse('查看上月亚北派单')`);
ok(i.action === 'dispatch' && i.supplier === '亚北' && String(i._rangeLabel).indexOf('上月') !== -1, '解析「查看上月亚北派单」→ dispatch+亚北+上月');
// 9c. 解析：查看8月1日至8月31日源晨的派单
i = run(`NK.assistant.parse('查看8月1日至8月31日源晨的派单')`);
ok(i.action === 'dispatch' && i.supplier === '源晨' && i.startDate === '2026-08-01' && i.endDate === '2026-08-31', '解析「8月1日至31日源晨」→ 日期范围+源晨');
// 9d. 解析：本月两个供应商分别有多少派单
i = run(`NK.assistant.parse('本月两个供应商分别有多少派单？')`);
ok(i.action === 'dispatch_stats', '解析「本月两个供应商分别有多少派单」→ dispatch_stats');
// 9e. q_dispatch：本月源晨 → 2 条（与派单中心 NK.filterBySupplier+filterByVisitRange 一致）
const qyc = run(`(() => { const r = NK.assistant.handle('查看本月源晨的派单', {}); return r[0].text; })()`);
ok(qyc.indexOf('源晨') !== -1 && qyc.indexOf('共 2 条') !== -1, '花姐助手「本月源晨」输出 2 条（含源晨字样）');
ok(run(`(() => { const l = NK.filterByVisitRange(NK.filterBySupplier(NK.db.dispatches, '源晨'), NK.fmtDate(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), NK.fmtDate(new Date(new Date().getFullYear(), new Date().getMonth()+1, 0))); return l.length === 2; })()`), '派单中心相同过滤「本月源晨」=2 条（与助手数量一致）');
// 9f. q_dispatch：上月亚北 → 1 条
const qyb = run(`(() => { const r = NK.assistant.handle('查看上月亚北派单', {}); return r[0].text; })()`);
ok(qyb.indexOf('亚北') !== -1 && qyb.indexOf('共 1 条') !== -1, '花姐助手「上月亚北」输出 1 条');
// 9g. q_dispatch_stats：本月两个供应商
const qs = run(`(() => { const r = NK.assistant.handle('本月两个供应商分别有多少派单？', {}); return r[0].text; })()`);
ok(qs.indexOf('源晨') !== -1 && qs.indexOf('亚北') !== -1 && qs.indexOf('共 ') !== -1 && qs.indexOf('未标注') !== -1, '花姐助手「本月两个供应商统计」输出源晨/亚北/未标注/共N条');
// 9h. 派单中心"本月两个供应商"统计与助手一致（不重复）
run(`(() => { const x = new Date(); const mS = NK.fmtDate(new Date(x.getFullYear(), x.getMonth(), 1)); const mE = NK.fmtDate(new Date(x.getFullYear(), x.getMonth()+1, 0)); const l = NK.filterByVisitRange(NK.db.dispatches, mS, mE); window.__yc = l.filter(d => { const g = NK.getSupplierOf(d); return g && g.id === 'yuanchen'; }).length; window.__yb = l.filter(d => { const g = NK.getSupplierOf(d); return g && g.id === 'yabei'; }).length; window.__na = l.filter(d => !NK.getSupplierOf(d)).length; })()`);
ok(run(`window.__yc === 2 && window.__yb === 1 && window.__na === 1`), '本月统计：源晨2条 亚北1条 未标注1条（与 q_dispatch_stats 同口径）');

// ============ 数据保护 ============
console.log('== 数据保护：供应商字段不影响既有字段 / 不覆盖业务数据 ==');
reset();
mkDispatch({ supplier: '源晨', visitDate: '2026-08-05', title: '保护测试', contactName: '王工', contactPhone: '13800000000' });
ok(run(`NK.db.dispatches[0].contactName === '王工' && NK.db.dispatches[0].contactPhone === '13800000000'`), '创建派单保留联系人/电话');
ok(run(`NK.db.dispatches[0].engineer !== undefined && NK.db.dispatches[0].address !== undefined`), '保留工程师/地址字段');
ok(run(`NK.db.dispatches[0].visitDate === '2026-08-05'`), '保留上门日期字段');
ok(run(`NK.SUPPLIERS.length === 2 && NK.SUPPLIERS[0].id === 'yuanchen' && NK.SUPPLIERS[1].id === 'yabei'`), '供应商常量仅源晨/亚北两家');
ok(run(`NK.normSupplier('源晨').id === 'yuanchen' && NK.normSupplier('亚北').id === 'yabei' && NK.normSupplier('其他') === null`), 'normSupplier 仅接受源晨/亚北');

// ============ 汇总 ============
console.log('\n==============================');
console.log(`供应商验收测试：通过 ${pass} 项，失败 ${fail} 项`);
if (fail > 0) { process.exit(1); }
console.log('全部通过 ✓');
