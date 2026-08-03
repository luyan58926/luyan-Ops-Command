/* 派单撤销/删除能力测试：验证 app.js 数据层撤销/删除/回收站与联动
 * 运行：node test/dispatch_revoke_test.js
 * 用 vm 加载 data.js + app.js，在上下文中执行断言。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');

// ---- mock 浏览器环境 ----
const storage = {};
const localStorageMock = {
  getItem: (k) => (k in storage ? storage[k] : null),
  setItem: (k, v) => { storage[k] = String(v); },
  removeItem: (k) => { delete storage[k]; },
};
const sandbox = {
  localStorage: localStorageMock,
  console: console,
  window: { SEED_DATA: null },
  document: { getElementById: () => null },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Math: Math,
  JSON: JSON,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = localStorageMock;
sandbox.window.document = sandbox.document;
sandbox.window.console = console;
vm.createContext(sandbox);

try {
  vm.runInContext(dataSrc, sandbox, { filename: 'data.js' });
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });
} catch (e) {
  console.error('加载失败:', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'test' });

// 初始化数据库并设为工作模式（不脱敏）
run(`NK.initDB(); NK.mode = 'work';`);

// 重置状态：清空派单/任务/休假/提醒，让每个场景独立
const reset = () => run(`
  NK.db.dispatches = [];
  NK.db.tasks = [];
  NK.db.leaves = [];
  NK.db.reminders = [];
  NK.save();
`);

// 辅助：创建一条派单 + 关联任务 + 可选休假
// 返回派单 id
const mkDispatch = (extra = {}) => run(`
  (() => {
    const d = NK.createDispatch(Object.assign({
      title: '山东青岛打印机处理', type: '故障', priority: 'P2',
      siteName: '青岛中宏', city: '青岛', engineer: '李亚男',
      planDone: '2026-08-05', planDoneTime: '18:00',
    }, ${JSON.stringify(extra)}));
    return d.id;
  })()
`);

console.log('== 场景一：录入错误 → 删除进回收站 → 恢复 ==');
reset();
const d1 = mkDispatch({ title: '测试重复派单' });
// 未发送（已生成）状态允许直接删除
let r = run(`NK.softDeleteDispatch('${d1}')`);
ok(r.ok === true, '未发送派单允许普通删除');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').recordStatus === '已删除'`), '删除后 recordStatus=已删除');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').deletedBy === '花姐'`), '记录 deletedBy=花姐');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').deleteReason === '录入错误'`), '默认删除原因=录入错误');
ok(run(`NK.db.dispatches.length === 1`), '数据仍保留（软删除不物理删除）');
// 从正常列表不可见（默认过滤）
ok(run(`NK.db.dispatches.filter(d=>!NK.dispatchInactive(d)).length === 0`), '撤销/删除后不进入正常统计');
// 恢复
r = run(`NK.restoreDispatch('${d1}')`);
ok(r.ok === true, '恢复成功');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').recordStatus === '正常'`), '恢复后 recordStatus=正常');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').deletedAt === ''`), '恢复后清空 deletedAt');
ok(run(`NK.dispatchActive(NK.db.dispatches.find(x=>x.id==='${d1}'))`), '恢复后重新为正常派单');
// 永久删除
run(`NK.softDeleteDispatch('${d1}')`);
r = run(`NK.purgeDispatch('${d1}')`);
ok(r === 1, '永久删除返回删除行数 1');
ok(run(`NK.db.dispatches.length === 0`), '永久删除后从数组移除');

console.log('== 场景二：业务取消 → 撤销 → 不再催办/告警/重点 → 历史保留 ==');
reset();
const d2 = mkDispatch({ title: '青岛用户取消上门' });
// 关联任务自动创建
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='${d2}')`), '创建派单自动关联任务');
// 撤销（默认同时取消关联任务）
r = run(`NK.revokeDispatch('${d2}', { reason: '用户取消上门', cancelTask: true })`);
ok(r.ok === true, '撤销成功');
ok(r.msg.includes('不会再进入催办'), '撤销提示含"不会再进入催办"');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').status === '已撤销'`), '撤销后 status=已撤销');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').revokeReason === '用户取消上门'`), '保存撤销原因');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').revokedBy === '花姐'`), '保存操作人=花姐');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').revokedAt !== ''`), '保存撤销时间');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').nextFollowup === ''`), '清空下次跟进（停止催办）');
ok(run(`NK.dispatchInactive(NK.db.dispatches.find(x=>x.id==='${d2}'))`), '已撤销派单为 inactive');
// 历史保留
ok(run(`NK.db.dispatches.some(x=>x.id==='${d2}')`), '撤销后记录仍保留');
// 不再进入实时告警
ok(run(`!NK.genReminders().some(r=>r.dispatchId==='${d2}')`), '撤销派单不再进入实时告警');
// 不再进入重点事项
ok(run(`!NK.genFocusItems().some(r=>r.type==='dispatch' && r.itemId==='${d2}')`), '撤销派单不再进入重点事项');
// 不再进入交接
ok(run(`(() => { const h = NK.genHandover(); const all = [...(h.sec.dispatchingDue||[]), ...(h.sec.dispatching||[]), ...(h.sec.waitingFeedback||[]), ...(h.sec.waitingAccept||[]), ...(h.sec.overdue||[])]; return all.every(x => x.id !== '${d2}'); })()`), '撤销派单不再进入交接');
// 关联任务被取消
ok(run(`NK.db.tasks.find(t=>t.dispatchId==='${d2}').status === '已取消'`), '关联任务默认同时取消为"已取消"');
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='${d2}')`), '关联任务不永久删除，仍保留');

console.log('== 场景三：已处理派单禁止普通删除 → 引导撤销 ==');
reset();
const d3 = mkDispatch({ title: '已处理故障' });
run(`NK.db.dispatches.find(x=>x.id==='${d3}').status = '已处理';`);
r = run(`NK.softDeleteDispatch('${d3}')`);
ok(r.ok === false && r.blocked === true, '已处理派单普通删除被阻止');
ok(r.canRevoke === true, '返回 canRevoke=true（引导撤销）');
ok(r.msg.includes('撤销派单'), '提示建议用撤销派单');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d3}').recordStatus !== '已删除'`), '已处理派单未被删除');
// force 强制删除仍然可行（极端情况兜底，二次确认后）
r = run(`NK.softDeleteDispatch('${d3}', { force: true })`);
ok(r.ok === true, 'force 强制删除可行（二次确认兜底）');

console.log('== 场景四：撤销时关联任务处理 ==');
reset();
const d4 = mkDispatch({ title: '关联任务单独保留' });
// 撤销但不同时取消任务
r = run(`NK.revokeDispatch('${d4}', { reason: '计划调整', cancelTask: false })`);
ok(r.taskCancelled === false, 'cancelTask=false 时任务不取消');
ok(run(`NK.db.tasks.some(t=>t.id && t.name === '关联任务单独保留' && t.status !== '已取消')`), '任务保留且未取消');
ok(run(`!NK.db.tasks.some(t=>t.dispatchId==='${d4}')`), '撤销后任务解绑派单关联');
// 恢复已撤销派单
r = run(`NK.unrevokeDispatch('${d4}')`);
ok(r.ok === true, '恢复已撤销派单成功');
ok(run(`NK.db.dispatches.find(x=>x.id==='${d4}').status === '已生成'`), '恢复后 status=已生成');
ok(run(`NK.dispatchActive(NK.db.dispatches.find(x=>x.id==='${d4}'))`), '恢复后重新为正常派单');
// 已撤销派单撤销操作被拒绝
run(`NK.revokeDispatch('${d4}', { reason: '重复', cancelTask: true })`);
r = run(`NK.revokeDispatch('${d4}', { reason: '重复', cancelTask: true })`);
ok(r.ok === false, '重复撤销被拒绝');

console.log('== 场景五：休假补位派单撤销 → 休假保留 + 补位待安排 ==');
reset();
// 登记休假（需要补位）
const lid = run(`
  (() => {
    const l = NK.createLeave({ engineerId: 'ENG001', engineerName: '孙益东', startDate: '2026-08-03', endDate: '2026-08-03', leavePeriod: '全天', dispatchRequired: '是' });
    return l.leaveId;
  })()
`);
// 创建补位派单并关联
const d5 = mkDispatch({ title: '补位派单' });
run(`NK.linkLeaveDispatch('${lid}', '${d5}')`);
ok(run(`NK.db.leaves.find(l=>l.leaveId==='${lid}').dispatchStatus === '已创建派单'`), '补位派单关联成功');
// 撤销补位派单
r = run(`NK.revokeDispatch('${d5}', { reason: '用户取消上门', cancelTask: true })`);
ok(r.ok === true && r.leaveLinked === true, '撤销补位派单返回 leaveLinked=true');
ok(run(`NK.db.leaves.some(l=>l.leaveId==='${lid}')`), '休假记录保留');
ok(run(`NK.db.leaves.find(l=>l.leaveId==='${lid}').dispatchStatus === '待创建派单'`), '补位状态回退为"待创建派单"');
ok(run(`NK.db.leaves.find(l=>l.leaveId==='${lid}').relatedDispatchId === ''`), '清空 relatedDispatchId');
ok(run(`!NK.engineerHasActiveCoverDispatch('孙益东')`), '补位派单撤销后不再视为进行中补位');
ok(run(`NK.genFocusItems().every(x => x.type !== 'dispatch' || x.itemId !== '${d5}')`), '撤销补位派单不再进入重点事项');

console.log('== 场景六：统计与首页联动 ==');
reset();
const d6a = mkDispatch({ title: '待发送派单A' });
const d6b = mkDispatch({ title: '待发送派单B' });
// 初始：2 条待发送
const before = run(`NK.db.dispatches.filter(d=>d.status==='已生成' && !NK.dispatchInactive(d)).length`);
ok(before === 2, '初始 2 条待发送');
// 撤销一条 → 待发送变 1
run(`NK.revokeDispatch('${d6a}', { reason: '用户取消上门', cancelTask: true })`);
const after = run(`NK.db.dispatches.filter(d=>d.status==='已生成' && !NK.dispatchInactive(d)).length`);
ok(after === 1, '撤销后待发送数减为 1');
// 删除另一条 → 待发送变 0
run(`NK.softDeleteDispatch('${d6b}', { reason: '重复创建' })`);
const after2 = run(`NK.db.dispatches.filter(d=>d.status==='已生成' && !NK.dispatchInactive(d)).length`);
ok(after2 === 0, '删除后待发送数减为 0');
// 首页概览统计（助手/概览）同样过滤
ok(run(`NK.db.dispatches.filter(d=>!NK.dispatchInactive(d)).length === 0`), '所有正常统计均排除撤销/删除派单');
// 刷新后（重新加载 localStorage）仍正确
run(`NK.save()`);
const reloadOk = run(`
  (() => {
    const raw = localStorage.getItem('nk_ops_command_v1');
    return raw && JSON.parse(raw).dispatches.every(d => d.status==='已撤销' || d.recordStatus==='已删除');
  })()
`);
ok(reloadOk, '持久化后刷新仍保持撤销/删除状态');
// 回收站可查（已删除仍可在 dispatches 找到且标记 recordStatus）
ok(run(`NK.db.dispatches.some(d=>d.recordStatus==='已删除')`), '已删除记录仍在回收站中可查');
// 已撤销可查
ok(run(`NK.db.dispatches.some(d=>d.status==='已撤销')`), '已撤销记录仍在历史中可查');

console.log('== KPI 保护 ==');
reset();
const dk = mkDispatch({ title: 'KPI保护派单' });
run(`NK.db.dispatches.find(x=>x.id==='${dk}').status = '待花姐验收';`);
// KPI 自动统计不应计入撤销/删除派单
run(`NK.revokeDispatch('${dk}', { reason: '用户取消上门', cancelTask: true })`);
ok(run(`!NK.genFocusItems().some(r=>r.type==='dispatch' && r.itemId==='${dk}')`), '撤销派单不计入 KPI 相关重点');
ok(run(`NK.db.dispatches.find(x=>x.id==='${dk}').kpiCounted === false || NK.db.dispatches.find(x=>x.id==='${dk}').kpiCounted === undefined`), '撤销不强制修改 KPI 正式分数');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
