/* 首页今日时间轴 · 来源标签 + 隐藏P3 回归测试
 * 验证：P3 标签隐藏（P1/P2 保留）、派单任务显示"派单"标签且位于任务名之前、
 *       日常固定任务保留"日常"、普通任务"任务"、专项"专项"、
 *       已完成来源标签弱化（不加删除线）、无新增 Emoji、
 *       撤销/取消/删除派单关联任务不显示、原始任务标题不修改、排序/统计不变。
 * 运行：node test/timeline_tag_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

// ---------- 简化 DOM mock（复用 tasks_ui_smoke / greeting_test 方案）----------
const storage = {};
const elements = {};
function makeEl(id) {
  const el = {
    id, _innerHTML: '', _text: '', _value: '', dataset: {}, className: '', disabled: false,
    style: {}, children: [], scrollTop: 0,
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
    set value(v) { this._value = String(v); },
    get value() { return this._value; },
  };
  return el;
}
const getElementById = (id) => { if (!elements[id]) elements[id] = makeEl(id); return elements[id]; };
const documentMock = {
  getElementById,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => [],
  querySelector: () => makeEl('q'),
  body: makeEl('body'),
  addEventListener: function () {},
  removeEventListener: function () {},
};

let nextTimerId = 1;
const activeTimers = new Map();
const sandboxSetInterval = (fn, ms) => { const id = nextTimerId++; activeTimers.set(id, { fn, ms }); return id; };
const sandboxClearInterval = (id) => { if (activeTimers.has(id)) activeTimers.delete(id); };

const sandbox = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  console: console,
  window: { SEED_DATA: null },
  document: documentMock,
  setTimeout: () => 0, clearTimeout: () => {},
  setInterval: sandboxSetInterval, clearInterval: sandboxClearInterval,
  navigator: { clipboard: { writeText: async () => {} } },
};
sandbox.globalThis = sandbox;
sandbox.window.window = sandbox.window;
sandbox.window.localStorage = sandbox.localStorage;
sandbox.window.document = documentMock;
sandbox.window.navigator = sandbox.navigator;
sandbox.window.console = console;
sandbox.window.setInterval = sandboxSetInterval;
sandbox.window.clearInterval = sandboxClearInterval;
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
const run = (code) => vm.runInContext(code, sandbox, { filename: 'timeline-tag-test' });

// 渲染 home 并读取时间轴 HTML
const renderTL = () => {
  run(`UI.renderHome();`);
  return run(`document.getElementById('view-home').innerHTML`);
};
// 提取时间轴中包含指定名称的单个 tl-item 原始 HTML。
// 注意：任务名称可能先出现在快捷区/派单状态区，因此不能按名称全局 lastIndexOf('<div') 定位，
// 必须锚定在时间轴容器的 tl-item 条目上。
const itemHtml = (html, name) => {
  const marker = 'class="tl-item';
  const items = [];
  let from = 0;
  // 收集所有 tl-item 起始位置
  while (true) {
    const s = html.indexOf(marker, from);
    if (s < 0) break;
    // 找到该条目对应的 </div> 结束（item 为一级结构，取最近一个 </div>）
    const e = html.indexOf('</div>', s);
    if (e < 0) break;
    items.push(html.slice(s, e + 6));
    from = e + 6;
  }
  return items.find(it => it.includes(name)) || '';
};

console.log('== 初始化 ==');
run(`NK.initDB(); NK.ensureFixedTasks(); NK.save();`);
// 清理任何历史派单/任务，保证隔离
run(`NK.db.dispatches = []; NK.db.tasks = NK.db.tasks.filter(t => t.source !== '派单自动生成'); NK.save();`);

console.log('== 派单关联任务 → "派单"标签 ==');
const dispInfo = run(`(() => {
  const d = NK.createDispatch({ title: '山东青岛打印机处理', type: '故障', priority: 'P2', supplier: '源晨' });
  // 找到该派单自动生成的关联任务
  const t = NK.db.tasks.find(x => x.dispatchId === d.id);
  return { did: d.id, tid: t ? t.id : '', tname: t ? t.name : '', tpri: t ? t.priority : '' };
})()`);
ok(!!dispInfo.tid, '派单自动生成关联任务存在');
ok(dispInfo.tname === '山东青岛打印机处理', '派单任务原始名称保留（未写"派单"进名称）');
ok(dispInfo.tpri === 'P2', '派单任务优先级为 P2');

let html = renderTL();
// 找到包含"山东青岛打印机处理"的 tl-item
const itemForDisp = itemHtml(html, '山东青岛打印机处理');
ok(!!itemForDisp, '时间轴包含派单任务条目');
ok(!!itemForDisp && itemForDisp.includes('tl-src-dispatch') && itemForDisp.includes('>派单<'), '派单任务显示「派单」来源标签');
ok(!!itemForDisp && itemForDisp.indexOf('>派单<') < itemForDisp.indexOf('山东青岛打印机处理'), '「派单」标签位于任务名称之前');
ok(!!itemForDisp && itemForDisp.includes('>P2<'), 'P2 优先级标签正常显示');

console.log('== 固定日常任务 → "日常"标签 + P3 隐藏 ==');
// 找一个每日固定任务实例（TPL001 日常，P3）
const tplInfo = run(`(() => {
  const t = NK.db.tasks.find(x => x.source === '系统固定任务' && x.templateId === 'TPL001');
  return { tid: t ? t.id : '', tname: t ? t.name : '', tpri: t ? t.priority : '' };
})()`);
ok(!!tplInfo.tid, 'TPL001 每日固定任务实例存在');
ok(tplInfo.tpri === 'P3', '固定任务后台优先级仍为 P3（数据未被修改）');
html = renderTL();
const itemForTpl = itemHtml(html, '宏1站、Teams、Outlook用户消息跟进');
ok(!!itemForTpl, '时间轴包含每日固定任务条目');
ok(!!itemForTpl && itemForTpl.includes('tl-src-daily') && itemForTpl.includes('>日常<'), '固定任务显示「日常」来源标签');
ok(!!itemForTpl && !itemForTpl.includes('>P3<'), '固定任务 P3 标签已被隐藏');
// 验证后台 P3 数据仍在（taskActive 仍返回 true）
ok(run(`NK.db.tasks.find(x => x.templateId === 'TPL001').priority`) === 'P3', '后台 P3 优先级数据仍然存在');

console.log('== 普通任务 → "任务"标签 + P1/P2 保留 ==');
const normalInfo = run(`(() => {
  const t = NK.createTask({ name: '李亚男SF6月工单待完成', type: '临时任务', priority: 'P1' });
  return { tid: t.id, tname: t.name, tpri: t.priority };
})()`);
html = renderTL();
const itemForNormal = itemHtml(html, '李亚男SF6月工单待完成');
ok(!!itemForNormal, '时间轴包含普通任务条目');
ok(!!itemForNormal && itemForNormal.includes('tl-src-task') && itemForNormal.includes('>任务<'), '普通任务显示「任务」来源标签');
ok(!!itemForNormal && itemForNormal.includes('>P1<'), 'P1 优先级标签正常显示');

// P2 任务
run(`NK.createTask({ name: '设备巡检专项记录', type: '专项任务', priority: 'P2' });`);
html = renderTL();
ok(!!itemHtml(html, '设备巡检专项记录').includes('>P2<'), 'P2 优先级标签正常显示');

// 无优先级任务不显示空标签（创建无 priority 的普通任务）
run(`NK.db.tasks.push({ id: NK.uid('T'), no: NK.nextNo('task'), name: '无优先级手工任务', type: '临时任务', priority: '', source: '手动录入', createdAt: NK.now(), status: '待处理', dispatchId: '', projectId: '' }); NK.save();`);
html = renderTL();
const itemNoPri = itemHtml(html, '无优先级手工任务');
ok(!!itemNoPri && !itemNoPri.match(/>P\d</), '无优先级任务不显示空优先级标签');
ok(!!itemNoPri && itemNoPri.includes('>任务<'), '无优先级普通任务仍显示「任务」来源标签');

console.log('== 无新增 Emoji ==');
const srcOnly = html.match(/<span class="tl-src[^>]*>[^<]*<\/span>/g) || [];
const noEmojiInSrc = srcOnly.every(s => !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s));
ok(noEmojiInSrc, '来源标签均为纯文字（无 Emoji）');

console.log('== 已完成任务：来源标签弱化 + 不修改名称 ==');
const doneInfo = run(`(() => {
  const t = NK.db.tasks.find(x => x.name === '山东青岛打印机处理');
  const beforeName = t.name;
  NK.setTaskStatus(t, '已完成');
  return { id: t.id, beforeName, afterName: t.name };
})()`);
ok(doneInfo.beforeName === doneInfo.afterName, '标记完成后任务名称未被修改');
html = renderTL();
const itemForDone = itemHtml(html, '山东青岛打印机处理');
ok(!!itemForDone, '已完成派单任务在时间轴中仍存在');
ok(!!itemForDone && itemForDone.includes('tl-done'), '已完成派单任务带 tl-done 样式');
ok(!!itemForDone && itemForDone.includes('tl-src-done'), '已完成任务来源标签带弱化类 tl-src-done');
ok(!!itemForDone && itemForDone.includes('>派单<'), '已完成派单任务仍显示「派单」标签');
// 恢复未完成
run(`NK.setTaskStatus(NK.db.tasks.find(x => x.name === '山东青岛打印机处理'), '待处理');`);

console.log('== 撤销/取消/删除派单 → 关联任务不显示 ==');
const revokeInfo = run(`(() => {
  const t = NK.db.tasks.find(x => x.name === '山东青岛打印机处理');
  const d = NK.getDispatch(t.dispatchId);
  NK.revokeDispatch(d.id);
  return { ok: true };
})()`);
ok(!!revokeInfo, '撤销派单执行成功');
html = renderTL();
ok(!html.includes('山东青岛打印机处理'), '撤销派单后关联任务不再出现在时间轴');
// 后台数据仍在（未被删除）
ok(run(`NK.db.tasks.some(x => x.name === '山东青岛打印机处理')`), '撤销派单后关联任务后台数据仍保留');

console.log('== 进行中派单条目（上门日）→ dispatchDetail 点击跳转保留 ==');
const dispItemInfo = run(`(() => {
  const d = NK.createDispatch({ title: '华为网络设备维护', type: '故障', priority: 'P1', supplier: '源晨', siteName: '华为网络', planArrive: NK.today(), planArriveTime: NK.today() + 'T16:20' });
  return { did: d.id };
})()`);
html = renderTL();
// 派单条目标题 = "{siteName} 派单"（名称已含"派单"，不再叠加来源标签）
const itemForDispEntry = itemHtml(html, '华为网络 派单');
ok(!!itemForDispEntry, '进行中派单条目出现在时间轴（按上门日）');
ok(/onclick="UI\.dispatchDetail/.test(html), '派单条目点击跳转保留（dispatchDetail）');
// 清理该测试派单，避免影响后续统计
run(`(() => {
  const d = NK.getDispatch('${dispItemInfo.did}');
  if (d) { NK.revokeDispatch(d.id); }
  NK.db.tasks = NK.db.tasks.filter(t => t.dispatchId !== '${dispItemInfo.did}');
  NK.save();
})()`);
html = renderTL();

console.log('== 专项任务 → "专项"标签 ==');
const projInfo = run(`(() => {
  const now = NK.now();
  const p = { id: NK.uid('P'), name: '李亚男巡检报告', type: '专项', createdAt: now, updatedAt: now, status: '进行中', progress: 50, priority: '' };
  NK.db.projects.push(p); NK.save();
  return { pid: p.id };
})()`);
html = renderTL();
const itemForProj = itemHtml(html, '李亚男巡检报告');
ok(!!itemForProj, '时间轴包含专项条目');
ok(!!itemForProj && itemForProj.includes('tl-src-project') && itemForProj.includes('>专项<'), '专项显示「专项」来源标签');

console.log('== 排序 / 统计 / 点击不变 ==');
// 统计：时间轴条目数与渲染逻辑一致（含固定任务 fixedDate/fixedYM + 频率过滤、
//       今日新建任务 + 今日新建专项 + 今日上门进行中派单，全部经 taskActive/状态过滤）。
//       注意：此时"山东青岛打印机处理"关联任务已被撤销，taskActive=false，不计入。
const itemCount = (html.match(/class="tl-item/g) || []).length;
const expectedCount = run(`(() => {
  const today = NK.today();
  const tasks = NK.db.tasks, projs = NK.db.projects, disps = NK.db.dispatches;
  const fixedKeys = NK.FIXED_TASKS ? NK.FIXED_TASKS.map(x => x.id) : [];
  const fixed = tasks.filter(t => NK.taskActive(t) && t.source === '系统固定任务' &&
    (t.fixedDate === today || t.fixedYM === today.slice(0, 7)));
  const fixedCount = fixed.filter(t => {
    const tpl = NK.FIXED_TASKS.find(x => x.id === t.templateId);
    const freq = t.frequency || (tpl && tpl.frequency) || '';
    const isDaily = ['每日', '每日14:30', '每日下班前'].includes(freq);
    return isDaily || ['每月', '月报完成后'].includes(freq);
  }).length;
  const taskCount = tasks.filter(t => NK.taskActive(t) && (t.createdAt || '').slice(0, 10) === today && t.source !== '系统固定任务').length;
  const projCount = projs.filter(p => (p.createdAt || '').slice(0, 10) === today).length;
  const dispCount = disps.filter(d => (d.planArrive || '') === today &&
    !['completed', 'draft', 'revoked'].includes(NK.dispatchStatusKey(d))).length;
  return fixedCount + taskCount + projCount + dispCount;
})()`);
ok(itemCount === expectedCount, '时间轴项目数量统计与渲染逻辑一致 (' + itemCount + '项)');
// 点击功能保留：派单关联任务条目（kind=task）点击跳转任务页
ok(/onclick="UI\.nav\('tasks'\)"/.test(html) || /onclick="UI\.taskDetail/.test(html), '任务点击跳转保留');

console.log('== 刷新稳定性 ==');
const htmlA = renderTL();
const htmlB = renderTL();
ok(htmlA === htmlB, '两次渲染（刷新）结果一致');

console.log('== CSS 断言 ==');
const cssSrc = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
ok(cssSrc.includes('.tl-src'), 'CSS 定义 .tl-src 来源标签基类');
ok(cssSrc.includes('.tl-src-dispatch'), 'CSS 定义派单标签 .tl-src-dispatch');
ok(cssSrc.includes('.tl-src-daily'), 'CSS 定义日常标签 .tl-src-daily');
ok(cssSrc.includes('.tl-src-task'), 'CSS 定义任务标签 .tl-src-task');
ok(cssSrc.includes('.tl-src-done'), 'CSS 定义已完成弱化 .tl-src-done');
ok(/\.tl-src\s*\{[^}]*font-size:\s*11px/.test(cssSrc), '来源标签字号约 11px');
ok(/\.tl-src\s*\{[^}]*border-radius:\s*7px/.test(cssSrc), '来源标签圆角约 7px');
// P1/P2 不与来源标签同色（badge.p1 红、badge.p2 橙，来源标签低饱和）
ok(/\.tl-src-dispatch\s*\{[^}]*#5a6cc0/.test(cssSrc), '派单标签浅蓝紫（非 P2 橙）');

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
