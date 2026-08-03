/* 派单关联任务迁移清理测试：验证 NK.migrateDispatchTaskSync() 处理现有错误数据
 * 运行：node test/dispatch_migrate_cleanup_test.js
 * 用 vm 加载 data.js + app.js，模拟历史遗留数据后调用迁移，验证：
 *   1) RW20260803-017/-018（已取消派单）→ 关联任务隐藏，不进入任何"当前有效工作"
 *   2) RW20260803-019（有效派单）→ 关联任务保留为有效工作
 *   3) 同一派单多条关联任务 → 去重保留一条主记录，其余归档已删除
 *   4) 同标题不同派单ID → 用派单ID区分，不误删最新有效记录
 *   5) 迁移可重复调用（幂等），不删除历史数据
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

// 初始化数据库
run(`NK.initDB(); NK.mode = 'work';`);

/* ============================================================
   构造历史遗留数据场景
   ------------------------------------------------------------
   依据需求：现存错误数据为
   - RW20260803-018 浙江湖州运维处理（已取消派单）
   - RW20260803-017 山东青岛打印机处理（已取消派单）
   - RW20260803-019 山东青岛打印机处理（有效派单）
   关键：用派单ID区分，不因标题相同误删最新有效记录。
   ============================================================ */
const setup = () => run(`
  (() => {
    NK.db.dispatches = [];
    NK.db.tasks = [];
    NK.db.leaves = [];
    NK.db.reminders = [];
    // ---- 派单 ----
    // 017：山东青岛，已取消
    const d017 = {
      id: 'PD20260803-017', no: 'PD20260803-017', title: '山东青岛打印机处理',
      type: '故障', priority: 'P2', siteName: '青岛中宏', city: '青岛',
      engineer: '李亚男', status: '已取消', recordStatus: '正常',
      dispatchStatus: 'revoked', revokeReason: '用户取消上门', revokedAt: '2026-08-03T10:00:00',
      nextFollowup: '', createdAt: '2026-08-03T09:30:00', planDone: '2026-08-05',
    };
    // 018：浙江湖州，已取消
    const d018 = {
      id: 'PD20260803-018', no: 'PD20260803-018', title: '浙江湖州运维处理',
      type: '运维', priority: 'P3', siteName: '湖州中宏', city: '湖州',
      engineer: '沈煜钦', status: '已取消', recordStatus: '正常',
      dispatchStatus: 'revoked', revokeReason: '需求变更', revokedAt: '2026-08-03T11:00:00',
      nextFollowup: '', createdAt: '2026-08-03T10:30:00', planDone: '2026-08-06',
    };
    // 019：山东青岛，有效（与017同标题，但不同派单ID）
    const d019 = {
      id: 'PD20260803-019', no: 'PD20260803-019', title: '山东青岛打印机处理',
      type: '故障', priority: 'P2', siteName: '青岛中宏', city: '青岛',
      engineer: '李亚男', status: 'pending_send', recordStatus: '正常',
      dispatchStatus: 'pending_send', nextFollowup: '',
      createdAt: '2026-08-03T12:00:00', planDone: '2026-08-05',
    };
    NK.db.dispatches = [d017, d018, d019];
    // ---- 关联任务（历史遗留，缺 sourceType/sourceId 标记）----
    // 017 关联任务
    NK.db.tasks.push({
      id: 'RW20260803-017', no: 'RW20260803-017', title: '山东青岛打印机处理',
      dispatchId: 'PD20260803-017', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T09:31:00', updatedAt: '2026-08-03T09:31:00',
    });
    // 018 关联任务
    NK.db.tasks.push({
      id: 'RW20260803-018', no: 'RW20260803-018', title: '浙江湖州运维处理',
      dispatchId: 'PD20260803-018', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T10:31:00', updatedAt: '2026-08-03T10:31:00',
    });
    // 019 关联任务（有效，须保留）
    NK.db.tasks.push({
      id: 'RW20260803-019', no: 'RW20260803-019', title: '山东青岛打印机处理',
      dispatchId: 'PD20260803-019', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T12:01:00', updatedAt: '2026-08-03T12:01:00',
    });
    NK.save();
    return NK.db;
  })()
`);

console.log('== 场景 A：清理已取消派单的关联任务 + 保留有效派单任务 ==');
setup();
// 先跑一次迁移（模拟 initDB 自动清理）
run(`NK.migrateDispatchTaskSync();`);
// 017 关联任务 → 已取消（不再作为当前有效工作）
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-017'); return t.status === '已取消'; })()`), '017(已取消派单)关联任务状态同步为"已取消"');
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-017'); return !NK.taskActive(t); })()`), '017关联任务不可见（非当前有效工作）');
// 018 关联任务 → 已取消
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-018'); return t.status === '已取消'; })()`), '018(已取消派单)关联任务状态同步为"已取消"');
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-018'); return !NK.taskActive(t); })()`), '018关联任务不可见（非当前有效工作）');
// 019 关联任务 → 保留有效
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-019'); return t.status === '待处理' && t.recordStatus === '正常'; })()`), '019(有效派单)关联任务保留为待处理');
ok(run(`(() => { const t = NK.db.tasks.find(t=>t.dispatchId==='PD20260803-019'); return NK.taskActive(t); })()`), '019关联任务仍为当前有效工作');
// 数据未物理删除
ok(run(`NK.db.tasks.length === 3`), '迁移不删除任何任务（3条仍在）');
ok(run(`NK.db.dispatches.length === 3`), '迁移不删除任何派单（3条仍在）');
// 补全 sourceType/sourceId 关联标记
ok(run(`NK.db.tasks.every(t => t.sourceType === 'dispatch' && t.sourceId === t.dispatchId)`), '迁移为所有关联任务补全 sourceType/sourceId');
// 各模块不再出现已取消任务
ok(run(`!NK.genReminders().some(r => r.dispatchId==='PD20260803-017' || r.dispatchId==='PD20260803-018')`), '017/018 不再进入实时告警');
ok(run(`!NK.genFocusItems().some(r => r.type==='dispatch' && (r.itemId==='PD20260803-017'||r.itemId==='PD20260803-018'))`), '017/018 不再进入重点事项');
ok(run(`(() => { const h = NK.genHandover(); const all=[...(h.sec.dispatchingDue||[]),...(h.sec.dispatching||[]),...(h.sec.waitingFeedback||[]),...(h.sec.waitingAccept||[]),...(h.sec.overdue||[])]; return all.every(x=>x.id!=='PD20260803-017'&&x.id!=='PD20260803-018'); })()`), '017/018 不再进入交接');
// KPI 统计基于有效任务计数（已取消/删除不计入）：
// autoKpi 内部按 engineerName + month 过滤，再叠加 taskActive；这里验证有效任务集仅含019
ok(run(`NK.db.tasks.filter(t=>NK.taskActive(t)).length === 1`), 'KPI统计源仅含1条有效任务（019）');
// 019 仍在有效工作中
ok(run(`NK.genFocusItems().some(r => r.type==='dispatch' && r.itemId==='PD20260803-019') || NK.taskActive(NK.db.tasks.find(t=>t.dispatchId==='PD20260803-019'))`), '019 仍为有效工作');

console.log('== 场景 B：同一派单多条关联任务 → 去重保留一条主记录 ==');
setup();
// 为 019 派单额外塞入重复关联任务（模拟重复生成）
run(`
  (() => {
    NK.db.tasks.push({ id: 'RW20260803-019b', no: 'RW20260803-019b', title: '山东青岛打印机处理',
      dispatchId: 'PD20260803-019', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T12:30:00', updatedAt: '2026-08-03T12:30:00' });
    NK.db.tasks.push({ id: 'RW20260803-019c', no: 'RW20260803-019c', title: '山东青岛打印机处理',
      dispatchId: 'PD20260803-019', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T12:40:00', updatedAt: '2026-08-03T12:40:00' });
    NK.save();
  })()
`);
run(`NK.migrateDispatchTaskSync();`);
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='PD20260803-019').filter(t=>NK.taskActive(t)).length === 1`), '同一派单仅保留1条有效主记录');
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='PD20260803-019').filter(t=>!NK.taskActive(t)).length === 2`), '其余2条重复任务归档为不可见');
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='PD20260803-019').filter(t=>t.recordStatus==='已删除').length === 2`), '重复任务标记 recordStatus=已删除');
// 派单 taskId 指向主记录（有效那条）
ok(run(`(() => { const d=NK.getDispatch('PD20260803-019'); const t=NK.db.tasks.find(x=>x.id===d.taskId); return !!t && NK.taskActive(t); })()`), '派单 taskId 指向有效主记录');

console.log('== 场景 C：同标题不同派单ID → 用ID区分，不误删最新有效 ==');
setup();
// 让 017 与 019 标题完全相同（实际历史也如此），验证只按派单ID区分
run(`
  (() => {
    // 017 派单标题改为与019一致（模拟同标题历史数据）
    NK.db.dispatches.find(d=>d.id==='PD20260803-017').title = '山东青岛打印机处理';
    // 再给019派单加一条重复任务，标题也相同
    NK.db.tasks.push({ id: 'RW20260803-019x', no: 'RW20260803-019x', title: '山东青岛打印机处理',
      dispatchId: 'PD20260803-019', status: '待处理', recordStatus: '正常',
      createdAt: '2026-08-03T12:30:00', updatedAt: '2026-08-03T12:30:00' });
    NK.save();
  })()
`);
run(`NK.migrateDispatchTaskSync();`);
// 017（已取消）仍为已取消，不受019影响
ok(run(`(() => { const t=NK.db.tasks.find(t=>t.dispatchId==='PD20260803-017'); return t.status==='已取消' && !NK.taskActive(t); })()`), '017(同标题已取消)仍为已取消、不可见');
// 019 有效主记录保留为有效
ok(run(`(() => { const t=NK.db.tasks.find(t=>t.dispatchId==='PD20260803-019' && NK.taskActive(t)); return !!t && t.title==='山东青岛打印机处理'; })()`), '019(同标题有效)仍保留一条有效主记录');
ok(run(`NK.db.tasks.filter(t=>t.dispatchId==='PD20260803-019' && NK.taskActive(t)).length === 1`), '019仅一条有效主记录');
// 未因标题相同误删最新有效记录
ok(run(`NK.db.tasks.some(t=>t.dispatchId==='PD20260803-019' && NK.taskActive(t) && t.title==='山东青岛打印机处理')`), '最新有效山东青岛记录未被误删');
// 三条派单仍在
ok(run(`NK.db.dispatches.length === 3`), '三条派单记录均保留');

console.log('== 场景 D：迁移幂等（重复调用不产生新问题）==');
setup();
run(`NK.migrateDispatchTaskSync();`);
const snapshot = run(`JSON.stringify(NK.db.tasks.map(t=>({id:t.id,status:t.status,recordStatus:t.recordStatus,dispatchId:t.dispatchId})))`);
run(`NK.migrateDispatchTaskSync();`);
const snapshot2 = run(`JSON.stringify(NK.db.tasks.map(t=>({id:t.id,status:t.status,recordStatus:t.recordStatus,dispatchId:t.dispatchId})))`);
ok(snapshot === snapshot2, '重复调用迁移不改变任务状态（幂等）');
ok(run(`NK.db.tasks.length === 3`), '重复迁移不新增/删除任务');

console.log('== 场景 E：首页时间轴过滤规则 ==');
setup();
run(`NK.migrateDispatchTaskSync();`);
// 首页"今日任务"数据源应只含有效任务（已取消/删除/关联派单失效的排除）
ok(run(`
  (() => {
    const active = NK.db.tasks.filter(t => NK.taskActive(t));
    return active.length === 1 && active[0].dispatchId === 'PD20260803-019';
  })()
`), '首页时间轴只展示有效任务（仅019）');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
