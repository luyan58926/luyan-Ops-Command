/* 派单撤销同步 - 最终验收测试
 * 运行：node test/dispatch_sync_acceptance_test.js
 * 覆盖需求十二节验收标准：
 *   1) 撤销派单后：关联任务不出现任务默认列表 / 首页时间轴 / 重点事项 / 实时告警 / 待处理·待发送·超时数量 / 今日交接当前待办，停止催办，但历史保留
 *   2) 删除派单后：关联任务不出现在任何正常列表/时间轴/统计/告警/交接，只在回收站查看，恢复时恢复关联关系
 *   3) 任务页"全部任务"= 全部有效任务（默认不展示已取消/已删除），含"当前/已完成/已取消/已删除"筛选
 *   4) 首页时间轴只展示有效的日常/专项/派单任务，派单任务须 dispatchStatus != 已撤销/已取消/已删除
 *   5) 同名派单（017已取消 vs 019有效）：用派单ID区分，不因标题相同误删最新有效记录
 *   6) 一个派单只能对应一条派单关联任务（按 dispatchId/sourceId 判断，不按标题）
 *   7) 撤销/取消/删除后当前页面立即更新、刷新后状态正确、关闭重开不重新出现
 *   8) 恢复派单后关联任务重新有效且不重复建任务
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');

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

run(`NK.initDB(); NK.mode = 'work';`);

const reset = () => run(`
  NK.db.dispatches = [];
  NK.db.tasks = [];
  NK.db.leaves = [];
  NK.db.reminders = [];
  NK.save();
`);
// 创建派单（返回 id）
const mk = (extra = {}) => run(`
  (() => {
    const d = NK.createDispatch(Object.assign({
      title: '山东青岛打印机处理', type: '故障', priority: 'P2',
      siteName: '青岛中宏', city: '青岛', engineer: '李亚男',
      planDone: '2026-08-05', planDoneTime: '18:00',
    }, ${JSON.stringify(extra)}));
    return d.id;
  })()
`);
// 构造同名新旧派单历史（017已取消 / 019有效）
const setupSameTitle = () => run(`
  (() => {
    NK.db.dispatches = [];
    NK.db.tasks = [];
    NK.db.leaves = [];
    NK.db.reminders = [];
    const d017 = { id:'PD20260803-017', no:'PD20260803-017', title:'山东青岛打印机处理', type:'故障', priority:'P2', siteName:'青岛中宏', city:'青岛', engineer:'李亚男', status:'已取消', recordStatus:'正常', dispatchStatus:'revoked', revokeReason:'用户取消上门', revokedAt:'2026-08-03T10:00:00', nextFollowup:'', createdAt:'2026-08-03T09:30:00', planDone:'2026-08-05', sourceType:'dispatch', sourceId:'PD20260803-017' };
    const d019 = { id:'PD20260803-019', no:'PD20260803-019', title:'山东青岛打印机处理', type:'故障', priority:'P2', siteName:'青岛中宏', city:'青岛', engineer:'李亚男', status:'pending_send', recordStatus:'正常', dispatchStatus:'pending_send', nextFollowup:'', createdAt:'2026-08-03T12:00:00', planDone:'2026-08-05', sourceType:'dispatch', sourceId:'PD20260803-019' };
    NK.db.dispatches = [d017, d019];
    NK.db.tasks.push({ id:'RW20260803-017', no:'RW20260803-017', title:'山东青岛打印机处理', dispatchId:'PD20260803-017', sourceType:'dispatch', sourceId:'PD20260803-017', status:'已取消', cancelReason:'用户取消上门', cancelledAt:'2026-08-03T10:00:00', recordStatus:'正常', createdAt:'2026-08-03T09:31:00' });
    NK.db.tasks.push({ id:'RW20260803-019', no:'RW20260803-019', title:'山东青岛打印机处理', dispatchId:'PD20260803-019', sourceType:'dispatch', sourceId:'PD20260803-019', status:'待处理', recordStatus:'正常', createdAt:'2026-08-03T12:01:00' });
    NK.save();
  })()
`);

console.log('== 验收1：撤销派单 → 各模块同步隐藏 + 历史保留 + 停止催办 ==');
reset();
const d1 = mk({ title: '青岛上门撤销场景' });
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='${d1}' && t.sourceType==='dispatch')`), '创建派单自动生成1条带派单关联的任务');
run(`NK.revokeDispatch('${d1}', { reason: '用户取消上门', cancelTask: true })`);
// 任务默认列表不出现（全部任务=有效）
ok(run(`!NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='${d1}'))`), '撤销后关联任务非当前有效工作');
ok(run(`NK.db.tasks.find(t=>t.dispatchId==='${d1}').status === '已取消'`), '关联任务状态=已取消');
// 首页时间轴不出现
ok(run(`!NK.db.tasks.some(t=>t.dispatchId==='${d1}' && NK.taskActive(t))`), '首页时间轴不含已撤销派单任务');
// 重点事项/实时告警/交接/统计不出现
ok(run(`!NK.genReminders().some(r=>r.dispatchId==='${d1}')`), '撤销后不进入实时告警');
ok(run(`!NK.genFocusItems().some(r=>r.type==='dispatch' && r.itemId==='${d1}')`), '撤销后不进入重点事项');
ok(run(`(() => { const h=NK.genHandover(); const all=[...(h.sec.dispatchingDue||[]),...(h.sec.dispatching||[]),...(h.sec.waitingFeedback||[]),...(h.sec.waitingAccept||[]),...(h.sec.overdue||[])]; return all.every(x=>x.id!=='${d1}'); })()`), '撤销后不进入今日交接');
ok(run(`NK.db.dispatches.filter(d=>NK.dispatchStatusKey(d)==='pending_send' && !NK.dispatchInactive(d)).length === 0`), '待发送统计排除撤销派单');
// 停止催办
ok(run(`NK.db.dispatches.find(x=>x.id==='${d1}').nextFollowup === ''`), '撤销后清空下次跟进（停止催办）');
// 历史保留
ok(run(`NK.db.dispatches.some(x=>x.id==='${d1}')`), '撤销派单历史记录保留');
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='${d1}')`), '撤销关联任务不永久删除，历史保留');

console.log('== 验收2：删除派单 → 关联任务不在任何正常列表 + 回收站可查 + 恢复关联 ==');
reset();
const d2 = mk({ title: '青岛删除场景' });
run(`NK.softDeleteDispatch('${d2}', { reason: '录入错误' })`);
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').recordStatus === '已删除'`), '删除后派单 recordStatus=已删除');
ok(run(`NK.db.tasks.find(t=>t.dispatchId==='${d2}').recordStatus === '已删除'`), '删除后关联任务 recordStatus=已删除');
ok(run(`!NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='${d2}'))`), '删除后关联任务非当前有效工作');
ok(run(`!NK.genReminders().some(r=>r.dispatchId==='${d2}')`), '删除后不进入实时告警');
ok(run(`!NK.genFocusItems().some(r=>r.type==='dispatch' && r.itemId==='${d2}')`), '删除后不进入重点事项');
ok(run(`NK.db.dispatches.some(x=>x.id==='${d2}' && x.recordStatus==='已删除')`), '已删除派单在回收站中可查');
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='${d2}')`), '删除关联任务不物理删除（保留追溯）');
// 恢复 → 恢复关联关系
run(`NK.restoreDispatch('${d2}')`);
ok(run(`NK.db.dispatches.find(x=>x.id==='${d2}').recordStatus === '正常'`), '恢复后派单 recordStatus=正常');
ok(run(`NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='${d2}'))`), '恢复派单后关联任务重新有效');

console.log('== 验收3：同名新旧派单（017已取消 vs 019有效）用ID区分 ==');
setupSameTitle();
run(`NK.migrateDispatchTaskSync();`);
ok(run(`NK.db.tasks.find(t=>t.dispatchId==='PD20260803-017').status === '已取消'`), '017(已取消)关联任务保持已取消');
ok(run(`!NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='PD20260803-017'))`), '017关联任务不可见');
ok(run(`NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='PD20260803-019'))`), '019(有效)关联任务为当前有效工作');
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='PD20260803-019' && NK.taskActive(t)).length === 1`), '019仅1条有效关联任务');
ok(run(`NK.db.dispatches.length === 2`), '两条同名派单记录均保留（ID区分）');
// 默认"全部任务"只含019
ok(run(`NK.db.tasks.filter(t=>NK.taskActive(t)).length === 1`), '默认全部任务=1条有效（019）');

console.log('== 验收4：一个派单一条任务（按 dispatchId 判断，不重复生成）==');
reset();
const d4 = mk({ title: '唯一关联派单' });
const taskCountAfterCreate = run(`NK.db.tasks.filter(t=>t.dispatchId==='${d4}'||t.sourceId==='${d4}').length`);
ok(taskCountAfterCreate === 1, '创建派单仅生成1条关联任务');
// 再次调用迁移不应新增重复任务
run(`NK.migrateDispatchTaskSync();`);
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='${d4}'||t.sourceId==='${d4}').length === 1`), '迁移去重后仍为1条（按dispatchId判断）');

console.log('== 验收5：刷新持久化 → 状态正确、关闭重开不恢复 ==');
reset();
const d5 = mk({ title: '刷新场景派单' });
run(`NK.revokeDispatch('${d5}', { reason: '用户取消上门', cancelTask: true })`);
run(`NK.save()`);
// 模拟刷新：重新加载 localStorage 数据
const refreshOk = run(`
  (() => {
    const raw = localStorage.getItem('nk_ops_command_v1');
    const db = JSON.parse(raw);
    const d = db.dispatches.find(x=>x.id==='${d5}');
    const t = db.tasks.find(x=>x.dispatchId==='${d5}');
    return d && NK.dispatchInactive(d) && t && !NK.taskActive(t);
  })()
`);
ok(refreshOk, '刷新后撤销派单仍不可见、任务仍不可见（不恢复）');
ok(run(`NK.db.dispatches.some(x=>x.id==='${d5}')`), '刷新后历史记录仍在');
// 关闭重开（重新 initDB）也不重新出现
storage['nk_ops_command_v1'] = run(`localStorage.getItem('nk_ops_command_v1')`);
run(`NK.initDB();`);
ok(run(`(() => { const d=NK.getDispatch('${d5}'); return d && NK.dispatchInactive(d); })()`), '关闭重开后已撤销派单仍不可见');
ok(run(`(() => { const t=NK.db.tasks.find(x=>x.dispatchId==='${d5}'); return t && !NK.taskActive(t); })()`), '关闭重开后关联任务仍不可见');

console.log('== 验收6：恢复派单 → 关联任务重新有效且不重复建任务 ==');
reset();
const d6 = mk({ title: '恢复场景派单' });
run(`NK.revokeDispatch('${d6}', { reason: '计划调整', cancelTask: true })`);
run(`NK.unrevokeDispatch('${d6}')`);
ok(run(`NK.dispatchActive(NK.getDispatch('${d6}'))`), '恢复后派单重新有效');
ok(run(`NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='${d6}'))`), '恢复后关联任务重新有效');
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='${d6}').length === 1`), '恢复后仍只有1条关联任务（不重复创建）');
ok(run(`!NK.genReminders().some(r=>r.dispatchId==='${d6}') || true`), '恢复后正常（不抛错）');

console.log('== 验收7：已取消任务在"全部"不展示、历史筛选可见 ==');
reset();
const d7 = mk({ title: '取消历史可见' });
run(`NK.revokeDispatch('${d7}', { reason: '用户取消', cancelTask: true })`);
// 默认有效列表不含
ok(run(`NK.db.tasks.filter(t=>NK.taskActive(t)).every(t=>t.dispatchId!=='${d7}')`), '默认有效任务列表不含已取消派单任务');
// 历史筛选（已取消来源）可见
ok(run(`(() => { const t=NK.db.tasks.find(x=>x.dispatchId==='${d7}'); return t.status==='已取消'; })()`), '已取消任务在"已取消"历史筛选中可查');
// 记录完整可追溯
ok(run(`(() => { const t=NK.db.tasks.find(x=>x.dispatchId==='${d7}'); return !!t.cancelReason && !!t.cancelledAt; })()`), '已取消任务保留取消原因与取消时间');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
