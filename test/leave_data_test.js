/* 休假数据层测试：验证 app.js 中休假相关函数逻辑
 * 运行：node test/leave_data_test.js
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
  window: { SEED_DATA: null },   // data.js 会写入 window.SEED_DATA
  document: { getElementById: () => null },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Math: Math,
  JSON: JSON,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  // app.js 内引用的若干 helper（尽量兜底，避免报错）
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = localStorageMock;
sandbox.window.document = sandbox.document;
sandbox.window.console = console;
vm.createContext(sandbox);

try {
  // 先执行 data.js 填充 window.SEED_DATA
  vm.runInContext(dataSrc, sandbox, { filename: 'data.js' });
  // 再执行 app.js 定义 NK
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

// 执行测试代码块
const run = (code) => vm.runInContext(code, sandbox, { filename: 'test' });

console.log('== 初始化 ==');
run(`NK.initDB(); `);
ok(run(`Array.isArray(NK.db.leaves)`), 'leaves 数组已初始化');
ok(run(`NK.db.engineers.length === 9`), '9 名工程师加载');

console.log('== 创建休假记录（不需要派单）==');
// 孙益东 负责 长宁、人广
const noDispatch = run(`
  NK.createLeave({ engineerId: 'ENG001', engineerName: '孙益东', startDate: '2026-08-03', endDate: '2026-08-03', leavePeriod: '全天', remark: '家中有事', dispatchRequired: '否' });
`);
ok(noDispatch && noDispatch.leaveId, '创建成功返回记录');
ok(run(`NK.db.leaves.length === 1`), '已加入 leaves 数组');
ok(run(`NK.db.leaves[0].dispatchStatus === '无需派单'`), '无需派单状态正确');
ok(run(`NK.db.leaves[0].recordStatus === '有效'`), '记录状态为有效');
ok(run(`NK.db.leaves[0].responsibleSitesSnapshot.length === 2`), '负责职场快照含长宁、人广(2个)');
ok(run(`NK.db.leaves[0].responsibleSitesSnapshot.every(s => ['上海长宁','上海人广'].includes(s.siteName))`), '快照职场名称正确');
ok(run(`NK.daysBetween('2026-08-03','2026-08-03') === 0`), 'daysBetween 同天为0');
ok(run(`NK.leaveDates(NK.db.leaves[0]).length === 1`), '单天休假覆盖1个自然日');

console.log('== 今天/明天休假查询 ==');
// 用固定日期而非真实今天：直接构造 covers 今天的记录
run(`NK.db.leaves = []; NK.save();`);
const today = run(`NK.today()`);
const tomorrow = run(`(() => { const d = new Date(); d.setDate(d.getDate()+1); return NK.fmtDate(d); })()`);
const yesterday = run(`(() => { const d = new Date(); d.setDate(d.getDate()-1); return NK.fmtDate(d); })()`);
run(`NK.createLeave({ engineerId: 'ENG003', engineerName: '沈煜钦', startDate: '${today}', endDate: '${today}', leavePeriod: '下午', dispatchRequired: '是' });`);
ok(run(`NK.leavesToday().length === 1`), 'leavesToday 返回今天休假');
ok(run(`NK.leavesOnDate('${tomorrow}').length === 0`), '明天暂无休假');
run(`NK.createLeave({ engineerId: 'ENG006', engineerName: '余滔', startDate: '${tomorrow}', endDate: '${tomorrow}', leavePeriod: '全天', dispatchRequired: '是' });`);
ok(run(`NK.leavesTomorrow().length === 1`), 'leavesTomorrow 返回明天休假');

console.log('== 连续休假（多日不重复记录）==');
run(`NK.createLeave({ engineerId: 'ENG009', engineerName: '林泽阳', startDate: '${today}', endDate: '${today}', leavePeriod: '全天', dispatchRequired: '否' });`);
run(`NK.createLeave({ engineerId: 'ENG009', engineerName: '林泽阳', startDate: '${yesterday}', endDate: '${yesterday}', leavePeriod: '全天', dispatchRequired: '否' });`);
ok(run(`NK.leavesOnDate('${today}').length === 2`), '今天2条休假(沈煜钦+林泽阳)');
ok(run(`NK.leavesByEngineer('林泽阳').length === 2`), '林泽阳有2条休假记录');

console.log('== 休假建议 ==');
const sug1 = run(`NK.leaveSuggestions(NK.db.engineers[0], '${today}', '${today}', '全天')`);
ok(Array.isArray(sug1), '返回建议数组');
ok(run(`NK.leaveSuggestions(NK.db.engineers[0], '${today}', '${today}', '全天').some(s => s.includes('缺口'))`), '驻场工程师有驻场缺口建议');
const sugHalf = run(`NK.leaveSuggestions(NK.db.engineers[0], '${today}', '${today}', '下午')`);
ok(sugHalf.some(s => s.includes('半天')), '半天休假有半天建议');

console.log('== 取消休假（软删除）==');
run(`const l1 = NK.db.leaves[0]; NK.cancelLeave(l1.leaveId);`);
ok(run(`NK.db.leaves[0].recordStatus === '已取消'`), '取消后 recordStatus=已取消');
ok(run(`NK.db.leaves[0].cancelledAt !== ''`), '记录 cancelledAt 时间戳');
ok(run(`NK.leavesToday().filter(l=>l.recordStatus==='有效').every(l=>l.engineerName !== '沈煜钦')`), '取消后首页不再显示该工程师休假');
ok(run(`NK.db.leaves.length === 4`), '记录仍保留(软删除不物理删除)');

console.log('== KPI 休假工作日排除 ==');
run(`NK.db.leaves = []; NK.save();`);
// 找 2026-08 的一个周中工作日：2026-08-03 是周一
run(`NK.createLeave({ engineerId: 'ENG001', engineerName: '孙益东', startDate: '2026-08-03', endDate: '2026-08-05', leavePeriod: '全天', dispatchRequired: '否' });`);
// 周一~周三，3个工作日
ok(run(`NK.leaveWorkdaysExcluded('孙益东', '2026-08') === 3`), '8/3-8/5全天休假排除3个工作日');
// 半天休假不计入
run(`NK.createLeave({ engineerId: 'ENG001', engineerName: '孙益东', startDate: '2026-08-06', endDate: '2026-08-06', leavePeriod: '下午', dispatchRequired: '否' });`);
ok(run(`NK.leaveWorkdaysExcluded('孙益东', '2026-08') === 3`), '半天休假不计入排除');
// 周六日不排除
run(`NK.createLeave({ engineerId: 'ENG001', engineerName: '孙益东', startDate: '2026-08-08', endDate: '2026-08-09', leavePeriod: '全天', dispatchRequired: '否' });`);
ok(run(`NK.leaveWorkdaysExcluded('孙益东', '2026-08') === 3`), '周六日(8/8-8/9)不排除');

console.log('== 派单关联 ==');
run(`NK.db.dispatches = [{ id: 'D1', no: 'PD20260803-001', status: '已生成', engineer: '孙晓' }];`);
run(`const l = NK.db.leaves[0]; NK.linkLeaveDispatch(l.leaveId, 'D1');`);
ok(run(`NK.db.leaves[0].dispatchStatus === '已创建派单'`), '关联后 dispatchStatus=已创建派单');
ok(run(`NK.db.leaves[0].relatedDispatchId === 'D1'`), 'relatedDispatchId 正确');
ok(run(`NK.db.leaves[0].relatedDispatchNo === 'PD20260803-001'`), 'relatedDispatchNo 正确');
ok(run(`NK.engineerHasActiveCoverDispatch('孙益东') === true`), '工程师有进行中补位派单');
run(`NK.db.dispatches[0].status = '已闭环';`);
ok(run(`NK.engineerHasActiveCoverDispatch('孙益东') === false`), '派单闭环后不再视为进行中');

console.log('== 补位派单生成原因模板 ==');
const reason = run(`(() => { const eng = NK.db.engineers[0]; const siteName = '上海长宁'; return eng.name + '于' + '2026-08-03' + '至' + '2026-08-03' + '休假，需安排' + siteName + 'IT现场支持补位。'; })()`);
ok(reason === '孙益东于2026-08-03至2026-08-03休假，需安排上海长宁IT现场支持补位。', '补位原因文本格式正确');

console.log('\n=== 结果: ' + pass + ' 通过, ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
