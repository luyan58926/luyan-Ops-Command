/* ============================================================
   LY Ops Command - ui.js  渲染层
   框架 / 首页 / 派单中心 / 全局搜索
   ============================================================ */
'use strict';

const UI = {};

/* ================= 通用渲染工具 ================= */
UI.priBadge = (p) => `<span class="badge ${p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : 'p3'}">${p}</span>`;
UI.statusBadge = (st) => {
  const map = {
    '已完成': 'done', '已关闭': 'done', '已闭环': 'done', '处理中': 'proc', '已确认': 'proc', '已分配': 'proc', '已处理': 'proc', '跟进中': 'proc',
    '待反馈': 'wait', '待我验收': 'wait', '待工程师确认': 'wait', '待验收': 'wait', '等待反馈': 'wait', '等待验收': 'wait',
    '已发送': 'wait', '等待外部条件': 'wait', '待花姐验收': 'wait',
    '待处理': 'gray', '草稿': 'gray', '待派单': 'gray', '未开始': 'gray', '已暂停': 'gray', '已取消': 'gray', '已生成': 'gray', '待发送': 'gray', '已撤销': 'gray',
    '异常待处理': 'risk', '有风险': 'risk', '已超时': 'risk', '升级处理': 'risk', '计划撤场': 'risk', '已撤场': 'risk', '搬迁中': 'risk',
    '进行中': 'accent', '计划搬迁': 'accent',
  };
  const cls = map[st] || 'gray';
  return `<span class="badge ${cls}">${st}</span>`;
};
UI.toast = (msg, type = 'ok') => {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(() => el.remove(), 3200);
};
UI.copy = async (text) => {
  try { await navigator.clipboard.writeText(text); UI.toast('花姐，已复制到剪贴板 ✓'); }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); UI.toast('花姐，已复制到剪贴板 ✓');
  }
};
UI.empty = (msg, col) => `<tr><td colspan="${col || 6}" class="tbl-empty">${msg}</td></tr>`;
/** 清空告警按钮用轻量线性图标（清扫/归档感，非红色垃圾桶） */
UI.ICON_CLEAR = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>`;
/* ============================================================
   统一弹窗栈（Modal Stack）
   - 支持多层弹窗：每层独立 .modal-layer，自带遮罩，z-index 递增
   - 关闭最上层不影响下层（下层输入内容保留，DOM 不销毁）
   - 统一关闭接口：× / 取消 / 关闭 / 返回 / Esc / 遮罩点击
   - 滚动锁定：栈非空时锁定 body，全部关闭后恢复
   - 焦点管理：打开聚焦首输入，关闭归还焦点到打开按钮
   - 未保存内容：编辑类弹窗通过 opts.onBeforeClose 判断，走统一确认
   ============================================================ */
UI.__stack = [];              // 每层 {layer, modal, mask, titleBtn, onBeforeClose, onClosed}
UI.__dirtyMap = new WeakMap(); // modal 节点 -> dirty 判断函数
UI.__openedBy = new WeakMap(); // modal 节点 -> 触发按钮（焦点归还）
UI.__scrollPos = null;

/** 打开一个弹窗层（压栈）。参数与旧 UI.modal 兼容。 */
UI.modal = (title, bodyHTML, footHTML, opts) => {
  opts = opts || {};
  const root = document.getElementById('modalRoot');
  root.classList.remove('hidden');

  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.style.zIndex = 200 + UI.__stack.length * 10;
  layer.innerHTML = `
    <div class="modal-mask" data-mask></div>
    <div class="modal ${opts.size || ''}">
      <div class="modal-head"><div class="modal-title">${title}</div>
      <button class="modal-close" type="button" aria-label="关闭" data-close>×</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
    </div>`;
  root.appendChild(layer);

  const modalEl = layer.querySelector('.modal');
  const maskEl  = layer.querySelector('.modal-mask');
  const headBtn = layer.querySelector('.modal-head [data-close]');
  const topBtn  = UI.__lastTrigger && document.activeElement && document.body.contains(document.activeElement)
    ? (document.activeElement.closest('[data-open],button') || null) : null;

  const entry = {
    layer, modal: modalEl, mask: maskEl, headBtn,
    onBeforeClose: opts.onBeforeClose || null,
    onClosed: opts.onClosed || null,
    editable: !!opts.editable,
    root,
  };
  UI.__stack.push(entry);

  // —— 统一关闭逻辑 ——
  const requestClose = (reason) => { UI.__requestClose(entry, reason); };

  // 1. 绑定所有 [data-close]（head × / foot 取消 / body 取消 …）
  layer.querySelectorAll('[data-close]').forEach((btn) => {
    btn.setAttribute('type', 'button');
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); requestClose('close'); });
  });
  // 确保层内所有非提交按钮均为 type=button（无 <form>，防御性归一）
  layer.querySelectorAll('button').forEach((b) => {
    if (!b.getAttribute('type')) b.setAttribute('type', 'button');
  });
  // 2. 遮罩点击
  maskEl.addEventListener('click', () => requestClose('mask'));
  // 3. 内层面板点击不冒泡到遮罩
  modalEl.addEventListener('click', (e) => e.stopPropagation());

  // 焦点管理：打开后聚焦弹窗内第一个可输入元素（body 内 input/textarea/select）
  if (!opts.noAutoFocus) {
    const f = modalEl.querySelector('.modal-body input:not([type=hidden]), .modal-body textarea, .modal-body select');
    if (f) setTimeout(() => { try { f.focus(); } catch (e) {} }, 30);
  }

  // 通用编辑类弹窗：记录初始快照，用于未保存内容判断
  if (opts.editable) {
    try {
      entry.__snapshot = UI.__capture(entry);
    } catch (e) { entry.__snapshot = null; }
  }

  if (opts.onMount) opts.onMount(root, layer);
  UI.__syncScrollLock();
  return entry;
};

/** 捕获弹窗内所有可输入控件的值快照 */
UI.__capture = (entry) => {
  const controls = entry.layer.querySelectorAll('.modal-body input, .modal-body textarea, .modal-body select');
  const snap = {};
  controls.forEach((el) => {
    const key = el.name || el.id || ('k' + snapCount++);
    snap[key] = el.value;
  });
  return snap;
};
let snapCount = 0;

/** 通用未保存判断：当前值与初始快照不一致即为 dirty */
UI.__isDirty = (entry) => {
  if (!entry.__snapshot) return false;
  try {
    const now = UI.__capture(entry);
    const keys = new Set([...Object.keys(entry.__snapshot), ...Object.keys(now)]);
    for (const k of keys) {
      if ((entry.__snapshot[k] || '') !== (now[k] || '')) return true;
    }
    return false;
  } catch (e) { return false; }
};

/** 统一关闭请求：onBeforeClose 优先；否则通用 editable 未保存判断；否则直接关闭。
 *  reason: 'close' | 'mask' | 'esc' | 'save'（save 跳过未保存拦截） */
UI.__requestClose = (entry, reason) => {
  const close = () => { UI.modalClose(); };
  if (entry.onBeforeClose) {
    entry.onBeforeClose(close, reason);
  } else if (entry.editable && reason !== 'save' && UI.__isDirty(entry)) {
    UI.confirmDiscard();
    return;
  } else {
    close();
  }
};

/** 关闭最上层弹窗。返回被关闭的层是否成功（未保存被拦截时返回 false）。 */
UI.modalClose = () => {
  const entry = UI.__stack[UI.__stack.length - 1];
  if (!entry) return true;
  UI.__stack.pop();
  const { layer, onClosed } = entry;
  // 归还焦点到打开该层的按钮（若仍存在）
  if (onClosed) { try { onClosed(); } catch (e) { console.error('[modal] onClosed error', e); } }
  if (layer && layer.parentNode) layer.remove();
  UI.__syncScrollLock();
  UI.__focusLast(entry);
  return true;
};

/** 关闭全部弹窗（供重置/切换等场景） */
UI.modalCloseAll = () => {
  while (UI.__stack.length) UI.modalClose();
  const root = document.getElementById('modalRoot');
  root.classList.add('hidden');
  root.innerHTML = '';
  UI.__syncScrollLock();
};

/** 同步 body 滚动锁定（栈空恢复滚动，保留滚动位置）。对测试 mock 环境容错。 */
UI.__syncScrollLock = () => {
  const body = document.body;
  const root = document.getElementById('modalRoot');
  try {
    if (UI.__stack.length > 0) {
      if (UI.__scrollPos === null) {
        UI.__scrollPos = (typeof window !== 'undefined' && window.pageYOffset) || (document.documentElement && document.documentElement.scrollTop) || 0;
      }
      body.style.overflow = 'hidden';
      body.style.position = 'fixed';
      body.style.top = `-${UI.__scrollPos}px`;
      body.style.width = '100%';
    } else {
      if (UI.__scrollPos !== null) {
        if (typeof window !== 'undefined' && window.scrollTo) window.scrollTo(0, UI.__scrollPos);
        UI.__scrollPos = null;
      }
      body.style.overflow = '';
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
    }
    if (root) root.classList.toggle('hidden', UI.__stack.length === 0);
  } catch (e) {
    // 测试 mock 环境无完整 DOM 时静默跳过滚动锁定
  }
};

/** 焦点归还到打开该层的按钮 */
UI.__focusLast = (entry) => {
  const trigger = UI.__openedBy.get(entry.modal);
  if (trigger && document.body.contains(trigger)) {
    try { trigger.focus({ preventScroll: true }); } catch (e) {}
  }
};

/** 记录当前弹窗由哪个按钮打开（用于焦点归还） */
UI.modalOpenedBy = (btn) => {
  const top = UI.__stack[UI.__stack.length - 1];
  if (top) UI.__openedBy.set(top.modal, btn);
};

/** 统一未保存内容确认弹窗。
 *  继续编辑 → 关闭确认层，保留原弹窗输入与光标。
 *  放弃并关闭 → 关闭原弹窗与确认层。
 */
UI.confirmDiscard = (dirtyMsg) => {
  const baseLayer = UI.__stack[UI.__stack.length - 1];
  if (!baseLayer) return;
  UI.confirm(
    `${dirtyMsg || '当前内容还没有保存，确定放弃吗？'}<div style="color:var(--text-3);font-size:12px;margin-top:4px">放弃后，本次未保存的修改不会保留。</div>`,
    () => { UI.modalClose(); }, // 放弃并关闭：关闭最上层（此时最上层是确认框）
    '放弃并关闭'
  );
  // 注意：确认框打开后成为新最上层；"继续编辑"按钮需二次绑定
  const layer = UI.__stack[UI.__stack.length - 1];
  if (layer) {
    layer.onBeforeClose = null; // 确认框自身直接可关
    const keepBtn = layer.layer.querySelector('.modal-foot .btn:not([data-close])');
    // 追加"继续编辑"
    const foot = layer.layer.querySelector('.modal-foot');
    if (foot && !foot.querySelector('[data-keep]')) {
      const k = document.createElement('button');
      k.type = 'button'; k.className = 'btn btn-accent'; k.setAttribute('data-keep', '1');
      k.textContent = '继续编辑';
      foot.insertBefore(k, foot.firstChild);
      k.addEventListener('click', () => {
        // 只关闭确认层，保留原弹窗输入
        UI.modalClose();
      });
    }
  }
};

/** 确认框：通用确认弹窗（作为新层压栈，关闭不影响底层） */
UI.confirm = (msg, onOk, okLabel, opts) => {
  opts = opts || {};
  const headClose = opts.allowHeadClose !== false;
  UI.modal('请确认', `<div style="padding:6px 2px">${msg}</div>`,
    `<button class="btn" type="button" data-close>取消</button><button class="btn btn-danger" id="cfOk" type="button">${okLabel || '确认'}</button>`, {
    size: 'modal-sm',
    noAutoFocus: true,
    onMount(root, layer) {
      const okBtn = layer.querySelector('#cfOk');
      const cancelBtn = layer.querySelector('.modal-foot [data-close]');
      if (okBtn) okBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        // 先关确认层，再执行回调（回调内部可能再开弹窗）
        const idx = UI.__stack.findIndex(x => x.layer === layer);
        if (idx >= 0) UI.__stack.splice(idx, 1);
        if (layer.parentNode) layer.remove();
        UI.__syncScrollLock();
        if (onOk) { try { onOk(); } catch (err) { console.error('[confirm] onOk error', err); } }
      });
      // 确认框的取消应只关闭确认层本身（不解散底层）
      if (cancelBtn) cancelBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); UI.modalClose(); });
      // head × 仅当允许时关闭
      const headBtn = layer.querySelector('.modal-head [data-close]');
      if (headBtn && !headClose) headBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); UI.modalClose(); });
    },
  });
};

/** 全局键盘：Esc 关闭最上层弹窗（尊重 onBeforeClose / 未保存判断） */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' || e.key === 'Esc') {
    const top = UI.__stack[UI.__stack.length - 1];
    if (!top) return;
    e.preventDefault();
    e.stopPropagation();
    UI.__requestClose(top, 'esc');
  }
});

/* ================= 导航 ================= */
UI.nav = (view, arg) => {
  if (view !== 'home' && UI.__greetingTimer) { clearInterval(UI.__greetingTimer); UI.__greetingTimer = null; }
  NK.currentView = view;
  document.querySelectorAll('#sidebar .nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  document.querySelectorAll('#main .view').forEach(v => v.classList.add('hidden'));
  const target = document.getElementById('view-' + view);
  target.classList.remove('hidden');
  UI.renderView(view, arg);
  document.getElementById('main').scrollTop = 0;
};

UI.renderView = (view, arg) => {
  const fns = {
    home: UI.renderHome, dispatch: UI.renderDispatch, tasks: UI.renderTasks,
    projects: UI.renderProjects, resources: UI.renderResources, leave: UI.renderLeave,
    kpi: UI.renderKpi,
    reports: UI.renderReports, notes: UI.renderNotes, import: UI.renderImport, settings: UI.renderSettings,
    about: UI.renderAbout,
  };
  if (fns[view]) fns[view](arg);
  UI.refreshBadges();
};

UI.refreshBadges = () => {
  const rem = NK.genReminders();
  const d = rem.filter(x => x.level === 'danger').length;
  const n1 = document.getElementById('navBadgeDispatch');
  const n2 = document.getElementById('navBadgeTasks');
  const n3 = document.getElementById('navBadgeNotes');
  const waitCount = NK.db.dispatches.filter(x => !NK.dispatchInactive(x) && ['pending_send', 'exception'].includes(NK.dispatchStatusKey(x))).length;
  n1.textContent = waitCount; n1.classList.toggle('hidden', !waitCount);
  n2.textContent = d; n2.classList.toggle('hidden', !d);
  const notesCount = (NK.db.quickNotes || []).filter(x => !x.archived && !x.deleted).length;
  if (n3) { n3.textContent = notesCount; n3.classList.toggle('hidden', !notesCount); }
};

/* ================= 页面头 ================= */
UI.pageHead = (title, sub, actions) => `
  <div class="page-head">
    <div><div class="page-title">${title}</div><div class="page-sub">${sub || ''}</div></div>
    <div style="display:flex;gap:8px">${actions || ''}</div>
  </div>`;

/* ============================================================
   首页问候语 — 统一对象结构（修复 undefined Bug）
   - getGreetingByTime：五段制返回 {emoji, text}
   - huajieQuotes：每日工作语录（花姐语录）
   - getDailyQuote：按日期稳定索引，同日不变化、次日自动切换
   - renderHomeGreeting：更新现有问候区元素（不重复插入 DOM）
   ============================================================ */
UI.__greetingTimer = null;

/** 五段制问候：05-10 早上好 / 11-13 中午好 / 14-17 下午好 / 18-21 晚上好 / 22-04 夜深了 */
UI.getGreetingByTime = (date) => {
  const d = (date === undefined || date === null) ? new Date() : date;
  if (!(d instanceof Date) || isNaN(d.getTime())) return { emoji: '✨', text: '你好' }; // 非法输入兜底
  const hour = d.getHours();
  if (hour >= 5 && hour < 11) return { emoji: '🌤️', text: '早上好' };
  if (hour >= 11 && hour < 14) return { emoji: '☀️', text: '中午好' };
  if (hour >= 14 && hour < 18) return { emoji: '🌞', text: '下午好' };
  if (hour >= 18 && hour < 22) return { emoji: '🌆', text: '晚上好' };
  return { emoji: '🌙', text: '夜深了' };
};

/** 每日工作语录（15 条） */
UI.huajieQuotes = [
  '今天的重点不在多，在于闭环。',
  '先处理最要紧的那一件，其他自然顺起来。',
  '每一步留痕，回头复盘才有据可依。',
  '重要的事早点做完，心里才踏实。',
  '不急不躁，把眼前这一件事做好。',
  '有问题及时上报，别让小事变成大事。',
  '今日事今日毕，明日才有从容。',
  '多问一句，胜过事后补救。',
  '把节奏稳住，事情自然会向前走。',
  '记录是最好的提醒，别让细节溜走。',
  '对账、巡检、跟进，一件都不能少。',
  '稳稳推进，胜过仓促完成。',
  '做完一件事，就给它画个句号。',
  '今日复盘十分钟，明天少踩一个坑。',
  '今天也要把重要的事情稳稳闭环。',
];

/** 按日期稳定取语录：dateKey = YYYYMMDD，取模索引 → 同日稳定、次日自动切换 */
UI.getDailyQuote = (date) => {
  const d = (date === undefined || date === null) ? new Date() : date;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '今天也要把重要的事情稳稳闭环。';
  if (!UI.huajieQuotes || !UI.huajieQuotes.length) return '今天也要把重要的事情稳稳闭环。';
  const dateKey = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  return UI.huajieQuotes[dateKey % UI.huajieQuotes.length];
};

/** 本地日期+星期显示：YYYY年M月D日　星期X（月/日不补零，不含秒；非法输入返回空串）
 *  仅读取浏览器本地时间，不依赖联网，不做时区偏移。 */
UI.getLocalDateDisplay = (date) => {
  const d = (date === undefined || date === null) ? new Date() : date;
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日　${weekdays[d.getDay()]}`;
};

/** 更新首页问候区现有元素（emoji / 文案+花姐 / ｜ / 每日语录 / 当前日期·星期），仅在内容变化时写入 DOM。
 *  问候、语录、日期共用同一个本地时间对象，避免跨天后不同步。 */
UI.renderHomeGreeting = (date) => {
  const now = (date === undefined || date === null) ? new Date() : date;
  const g = UI.getGreetingByTime(now);
  const emoji = (typeof g.emoji === 'string' && g.emoji.trim()) ? g.emoji.trim() : '✨';
  const text = ((typeof g.text === 'string' && g.text.trim()) ? g.text.trim() : '你好') + '，花姐';
  const quote = UI.getDailyQuote(now);
  const dateText = UI.getLocalDateDisplay(now);
  const emojiEl = document.getElementById('homeGreetingEmoji');
  const textEl = document.getElementById('homeGreetingText');
  const quoteEl = document.getElementById('homeDailyQuote');
  const dateEl = document.getElementById('homeCurrentDate');
  if (emojiEl && emojiEl.textContent !== emoji) emojiEl.textContent = emoji;
  if (textEl && textEl.textContent !== text) textEl.textContent = text;
  if (quoteEl && quoteEl.textContent !== quote) quoteEl.textContent = quote;
  // 日期异常时暂时隐藏日期区域，不影响问候与首页其他内容
  if (dateEl) {
    const next = dateText || '';
    if (dateEl.textContent !== next) dateEl.textContent = next;
    dateEl.style.display = next ? '' : 'none';
  }
  return { emoji, text, quote, dateText };
};

/* ============================================================
   今日时间轴 · 来源标签
   - tlSourceBadge(t)：根据条目来源返回文字胶囊（不添加 Emoji）
     · 派单任务（关联有效派单）→ 派单（浅蓝紫）
     · 系统固定任务 → 日常（浅灰紫）
     · 专项 → 专项（沿用现有风格）
     · 普通任务 → 任务（中性浅灰）
   - done 时追加弱化样式（降低透明度，不加删除线）
   ============================================================ */
UI.tlSourceBadge = (t) => {
  if (!t) return '';
  // 派单条目（dispsOnDay 收录，名称已含"派单"字样）不再重复加来源标签
  if (t.kind === 'dispatch' || t.type === 'dispatch') return '';
  let label = '', cls = 'tl-src';
  // 是否为派单关联任务：条目自带 dispatchId/sourceType，或通过 taskId 反查原始任务
  let isDispatch = !!(t.dispatchId || (t.sourceType === 'dispatch' && t.sourceId) || t.dispatchOfTask);
  if (!isDispatch && t.kind === 'task' && t.taskId) {
    const raw = NK.getTask(t.taskId);
    if (raw && NK.dispatchOfTask(raw)) isDispatch = true;
  }
  if (t.kind === 'project' || t.type === 'project') { label = '专项'; cls += ' tl-src-project'; }
  else if (isDispatch) { label = '派单'; cls += ' tl-src-dispatch'; }
  else if (t.kind === 'tpl' || t.source === '系统固定任务' || t.templateId) { label = '日常'; cls += ' tl-src-daily'; }
  else { label = '任务'; cls += ' tl-src-task'; }
  if (t.done) cls += ' tl-src-done';
  return `<span class="${cls}">${label}</span>`;
};

/* ============================================================
   今日时间轴 · 上门日期（仅派单关联任务）
   - 返回「（上门：X月X日）」，跨年带完整年份；无日期→「（上门待确认）」
   - 数据来源：关联派单记录的真实上门日期字段 visitDate（YYYY-MM-DD）
   - 安全解析，避免 YYYY-MM-DD 因 UTC 时区偏移一天
   - 非派单任务（日常/专项/普通）返回空字符串，不显示
   - done 时并入整条弱化（由外层 tl-done 统一降低透明度，不单独加删除线）
   ============================================================ */
UI.tlOnsiteDate = (t) => {
  if (!t) return '';
  // 仅对派单关联任务显示；派单条目本身（dispsOnDay 收录）不加括号
  if (t.kind === 'dispatch' || t.type === 'dispatch') return '';
  let isDispatch = !!(t.dispatchId || (t.sourceType === 'dispatch' && t.sourceId) || t.dispatchOfTask);
  // 时间轴 task/tpl 条目可能只带 taskId，需反查原始任务再判派单
  let raw = null;
  if (!isDispatch && (t.kind === 'task' || t.kind === 'tpl') && t.taskId) {
    raw = NK.getTask(t.taskId);
    if (raw && NK.dispatchOfTask(raw)) isDispatch = true;
  }
  if (!isDispatch) return '';
  // 取关联派单记录
  const d = t.dispatchOfTask ? t.dispatchOfTask : NK.dispatchOfTask(raw || t);
  if (!d) return '';
  const v = d.visitDate || d.planArrive || '';
  return `<span class="timeline-onsite-date">（${UI.fmtOnsite(v)}）</span>`;
};

/** 格式化上门日期：YYYY-MM-DD 安全解析避免 UTC 偏移；无值→「上门待确认」；跨年带完整年份 */
UI.fmtOnsite = (dateValue, now) => {
  now = now || new Date();
  if (!dateValue) return '上门待确认';
  let year, month, day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const parts = dateValue.split('-').map(Number);
    [year, month, day] = parts;
  } else {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '上门待确认';
    year = date.getFullYear();
    month = date.getMonth() + 1;
    day = date.getDate();
  }
  return year === now.getFullYear()
    ? `上门：${month}月${day}日`
    : `上门：${year}年${month}月${day}日`;
};

/* ============================================================
   今日指挥台 v2 — 四区域结构
   ============================================================ */
UI.renderHome = () => {
  const el = document.getElementById('view-home');

  // ── 区域1：轻量问候区（带助手头像；问候与语录由 UI.renderHomeGreeting 填充）──
  const today = NK.today();

  const rem = NK.genReminders();
  const disps = NK.db.dispatches.filter(d => !NK.dispatchInactive(d));
  const tasks = NK.db.tasks;

  const focusItems = NK.genFocusItems();
  const statusText = focusItems.length ? focusItems[0].title : '今天没有紧急事项，继续保持 ✨';
  const greetingSub = focusItems.length
    ? `有 ${focusItems.length} 件需要花姐重点跟进`
    : '当前运维节奏良好';

  // ── 区域2：轻量状态概览 ──────────────────────────────
  const p1 = rem.filter(x => x.level === 'danger').length;
  const waitSend = disps.filter(d => NK.dispatchStatusKey(d) === 'pending_send').length;
  const waitExc = disps.filter(d => NK.dispatchStatusKey(d) === 'exception').length;
  const overdue = rem.filter(x => x.title.includes('超时')).length;

  // ── 区域3：横向轻量快捷入口条 ──────────────────────────────
  const quickCards = [
    { icon: '📋', label: '新建派单', sub: '30秒搞定', primary: true, act: 'UI.dispatchCreate()' },
    { icon: '📝', label: '快速记录', sub: '先记下来，别让它溜走', act: 'UI.quickNote()' },
    { icon: '🗓️', label: '登记休假', sub: '记休假，补位不遗漏', lavender: true, act: 'UI.leaveCreate()' },
    { icon: '🔄', label: '更新进度', sub: '补一句反馈', act: 'UI.taskCreate(true)' },
    { icon: '📊', label: '登记KPI', sub: '加分扣分都留痕', act: 'UI.kpiEventCreate()' },
    { icon: '📄', label: '生成交接', sub: '一键整理今日', act: 'UI.handoverToday()' },
  ];
  const quickCardsHTML = quickCards.map(q => 
    `<a class="quick-card ${q.primary ? 'qc-primary' : ''}${q.lavender ? ' qc-lavender' : ''}" href="javascript:void(0)" onclick="${q.act}">
      <span class="qc-icon">${q.icon}</span>
      <div class="qc-text">
        <div class="qc-label">${q.label}</div>
        <div class="qc-sub">${q.sub}</div>
      </div>
    </a>`
  ).join('');

  // ── 区域4a：花姐今天重点盯这几件（简化版：只显事实项名称）──
  const focusItemsHTML = focusItems.length ? focusItems.map((f, idx) => {
    const num = ['①','②','③'][idx] || (idx + 1) + '.';
    const dot = f.tagLevel === 'danger'
      ? '<span class="fi-dot fi-dot-danger">●</span>'
      : '';
    return `
    <div class="fi-item${f.actionAct ? ' fi-clickable' : ''}"${f.actionAct ? ` onclick="${NK.esc(f.actionAct)}"` : ''}>
      <span class="fi-num">${num}</span>${dot}
      <span class="fi-name">${NK.esc(f.title)}</span>
    </div>`;
  }).join('') : `
    <div class="fc-empty">
      <div class="fc-empty-icon">✨</div>
      <div class="fc-empty-text">今天没有特别需要盯的事项。</div>
    </div>`;

  const focusHTML = `<div class="fc-card">
    <div class="fc-card-head">
      <div class="fc-title"><span class="fc-title-icon">👀</span> 花姐今天重点盯这几件</div>
      ${focusItems.length ? `<span class="badge wait">${focusItems.length}件</span>` : '<span class="badge ok">✓</span>'}
    </div>
    <div class="fc-body">${focusItemsHTML}</div>
  </div>`;

  // ── 区域4b：今日时间轴（固定任务 + 今日新建任务 + 今日新建专项）──
  const tl = [];
  // 1) 每日/月度固定任务实例：只显示今天确实存在的实例（固定任务去重，不堆叠）
  //    每日类：今日实例；月度类：当月实例（月报/月会满足条件后才会生成）
  const todayFixed = tasks.filter(t => NK.taskActive(t) && t.source === '系统固定任务' &&
    (t.fixedDate === today || t.fixedYM === today.slice(0, 7)));
  todayFixed.forEach(t => {
    const tpl = NK.FIXED_TASKS.find(x => x.id === t.templateId);
    const freq = t.frequency || (tpl && tpl.frequency) || '';
    const isDaily = ['每日', '每日14:30', '每日下班前'].includes(freq);
    // 月度类只显示月报/月会；触发类只在触发后出现（此时已生成今日实例）
    if (!isDaily && !['每月', '月报完成后'].includes(freq)) return;
    const time = t.fixedTime === '14:30' ? '14:30' : (t.fixedTime === '下班前' ? '下班前' : (t.fixedTime === '每月初' ? '每月' : '每日'));
    const done = t.status === '已完成';
    tl.push({
      sort: time === '每日' ? '0800' : time === '下班前' ? '1800' : time === '每月' ? '2400' : (String(time).replace(':', '') || '0800'),
      time, kind: 'tpl', name: t.name, note: tpl ? tpl.requirement : '', pri: t.priority,
      done, status: t.status, taskId: t.id, templateId: t.templateId,
    });
  });
  // 2) 今日新建的任务（排除固定任务实例，避免与定时条目重复；只保留当前有效任务）
  tasks.filter(t => NK.taskActive(t) && (t.createdAt || '').slice(0, 10) === today && t.source !== '系统固定任务')
    .forEach(t => {
      tl.push({
        sort: (t.createdAt || '23:59:59').slice(11, 16).replace(':', '') || '2359',
        time: (t.createdAt || '').slice(11, 16) || '今日',
        kind: 'task', name: t.name,
        note: t.type + (t.siteName ? ' · ' + NK.v.siteName(t.siteName) : '') + (t.engineer ? ' · ' + NK.v.engName(t.engineer) : ''),
        pri: t.priority, done: t.status === '已完成', status: t.status, taskId: t.id,
      });
    });
  // 3) 今日新建的专项
  NK.db.projects.filter(p => (p.createdAt || '').slice(0, 10) === today)
    .forEach(p => {
      tl.push({
        sort: (p.createdAt || '23:59:59').slice(11, 16).replace(':', '') || '2359',
        time: (p.createdAt || '').slice(11, 16) || '今日',
        kind: 'project', name: p.name,
        note: `专项 · 进度 ${p.progress}%` + (p.status && p.status !== '已完成' ? ' · ' + p.status : ''),
        pri: '', done: p.status === '已完成', status: p.status, projectId: p.id,
      });
    });
  // ── 按上门时间收录进行中的派单 ──────────────────────
  const dispOnDay = (dateStr) =>
    disps.filter(d =>
      (d.planArrive || '') === dateStr &&
      !['completed', 'draft', 'revoked'].includes(NK.dispatchStatusKey(d))
    );  const dispsOnDay = dispOnDay(today);
  dispsOnDay.forEach(d => {
    tl.push({
      sort: (d.planArriveTime || (d.planArrive || today) + 'T12:00').replace(/.*T/, '').slice(0, 5).replace(':', ''),
      time: d.planArriveTime ? d.planArriveTime.slice(0, 5) : (d.planArrive || today).slice(5),
      name: `${NK.v.siteName(d.siteName)} 派单`,
      sub: `${NK.v.engName(d.engineer)} · ${UI.statusBadge(NK.dispatchStatusLabel(d))}`,
      pri: null, type: 'dispatch',
      click: `UI.dispatchDetail('${d.id}')`,
      done: NK.dispatchStatusKey(d) === 'completed',
    });
  });
  tl.sort((a, b) => a.sort.localeCompare(b.sort));

  const tlHTML = `<div class="tl-card">
    <div class="tl-card-head">
      <div class="tl-title"><span>📅</span> 今日时间轴</div>
      <span class="badge accent">${tl.length}项</span>
    </div>
    <div class="tl-body">
      ${tl.length ? `<div class="timeline">${tl.map(t => {
        const isConsumable = t.kind === 'tpl' && t.templateId === 'TPL005' && t.taskId;
        const jump = t.kind === 'task'
          ? ` onclick="UI.nav('tasks')" title="点击查看任务"`
          : t.kind === 'tpl' && t.taskId
            ? ` onclick="UI.taskDetail('${t.taskId}')" title="点击查看任务"`
            : t.kind === 'project'
              ? ` onclick="UI.nav('projects')" title="点击查看专项"`
              : t.click
                ? ` onclick="${t.click}" title="点击查看详情"`
                : '';
        const clickAttr = jump ? ` class="tl-item ${t.done ? 'tl-done' : ''} tl-link"${jump}` : ` class="tl-item ${t.done ? 'tl-done' : ''}"`;
        const cmplBtn = isConsumable
          ? `<button class="btn btn-sm ${t.done ? 'btn-ghost' : 'btn-accent'}" style="margin-left:8px;vertical-align:middle" onclick="event.stopPropagation();UI.toggleConsumableDone('${t.taskId}',${t.done})">${t.done ? '↩ 撤销' : '✓ 标记完成'}</button>`
          : '';
        const srcBadge = UI.tlSourceBadge(t);
        // 派单任务在名称后补充上门日期（读取关联派单 visitDate），非派单任务为空
        const onsiteDate = UI.tlOnsiteDate(t);
        // P3 为普通优先级，时间轴中不显示其标签；无优先级也不显示
        const priBadge = (t.pri && t.pri !== 'P3') ? `<span class="tl-pri">${UI.priBadge(t.pri)}</span>` : '';
        return `<div ${clickAttr}>
          <span class="tl-time">${t.time}</span>
          ${srcBadge ? `<span class="tl-src-wrap">${srcBadge}</span>` : ''}
          <span class="tl-name">${t.done ? '✓ ' : ''}${NK.esc(t.name)}</span>
          ${onsiteDate}
          ${priBadge}
          ${t.sub ? `<div class="tl-note">${t.sub}</div>` : ''}
          ${cmplBtn}
        </div>`;
      }).join('')}</div>` : '<div class="fc-empty"><div class="fc-empty-icon">📅</div><div class="fc-empty-text">今天还没有任务和定时事项<br>有安排随时记进来 ✨</div></div>'}
    </div>
  </div>`;

  // ── 组装页面 ──────────────────────────────
  el.innerHTML = `
    <div class="dash-zone dash-greet">
      <div class="dg-avatar">💼</div>
      <div class="dg-text">
        <div class="home-welcome-header">
          <div class="dg-hello home-greeting-line">
            <span class="home-greeting-main"><span id="homeGreetingEmoji" class="dg-emoji"></span><span id="homeGreetingText" class="home-greeting-text"></span></span>
            <span id="homeGreetingDivider" class="home-greeting-divider" aria-hidden="true">｜</span>
            <span id="homeDailyQuote" class="home-daily-quote"></span>
          </div>
          <div id="homeCurrentDate" class="home-current-date" aria-label="当前日期"></div>
        </div>
        <div class="dg-status">
          <span class="dg-dot">●</span> ${NK.esc(statusText)}
          <span style="color:var(--text-3)">·</span>
          ${greetingSub}
        </div>
      </div>
    </div>
    <div class="dash-zone dash-status">
      ${p1 > 0 ? `<span class="ds-pill ds-risk" onclick="UI.nav('tasks')"><span class="ds-dot"></span>P1待处理 <strong>${p1}</strong></span>` : ''}
      ${waitSend > 0 ? `<span class="ds-pill ds-warn" onclick="UI.nav('dispatch')"><span class="ds-dot"></span>待发送 <strong>${waitSend}</strong></span>` : ''}
      ${waitExc > 0 ? `<span class="ds-pill ds-info" onclick="UI.nav('dispatch')"><span class="ds-dot"></span>异常待处理 <strong>${waitExc}</strong></span>` : ''}
      ${overdue > 0 ? `<span class="ds-pill ds-danger" onclick="UI.nav('tasks')"><span class="ds-dot"></span>已超时 <strong>${overdue}</strong></span>` : ''}
      ${!p1 && !waitSend && !waitExc && !overdue ? '<span class="ds-all-ok">✓ 当前无紧急事项，运维节奏良好 ✨</span>' : ''}
    </div>
    ${UI.leaveRemindHTML()}
    <div class="dash-zone dash-quick">
      <div class="quick-toolbar">
        ${quickCardsHTML}
      </div>
    </div>
    <div class="dash-core-grid">
      ${focusHTML}
      ${tlHTML}
    </div>
  `;
  // 填充问候与每日语录（新 DOM 必然写入；随后定时器每分钟检查，仅跨时段/跨日变化时更新）
  UI.renderHomeGreeting();
  if (UI.__greetingTimer) clearInterval(UI.__greetingTimer);
  UI.__greetingTimer = setInterval(() => {
    if (NK.currentView !== 'home') { clearInterval(UI.__greetingTimer); UI.__greetingTimer = null; return; }
    UI.renderHomeGreeting();
  }, 60000);
};

/** 首页时间轴 · HP耗材每日邮件检查：标记今日已完成 / 撤销完成
 *  只切换当天提醒的完成状态，不弹表单、不要求填写任何内容、
 *  不进入重点/告警/KPI。完成后当天不再提醒，第二天自动出现新的当日提醒。 */
UI.toggleConsumableDone = (taskId, isDone) => {
  const t = NK.getTask(taskId);
  if (!t || t.templateId !== 'TPL005') return;
  if (isDone) {
    // 撤销完成
    NK.setTaskStatus(t, '待处理');
    t.doneAt = '';
    UI.toast('已撤销，今天仍需检查一次Outlook 📬');
  } else {
    // 标记完成（不要求任何填写内容，不产生KPI）
    NK.setTaskStatus(t, '已完成');
    UI.toast('已记录今日完成，花姐辛苦了 ✓');
  }
  NK.save();
  UI.renderHome();
  UI.refreshBadges && UI.refreshBadges();
};

/* ============================================================
   首页 · 今日休假提醒（紧凑区块）
   只做状态展示与提醒，不进入今日时间轴；补位派单走派单任务规则。
   ============================================================ */
UI.leaveRemindHTML = () => {
  const today = NK.today();
  const todayLeaves = NK.leavesToday();          // 今天正在休假（含半天）
  const tomorrowLeaves = NK.leavesTomorrow();     // 明天开始休假
  const total = NK.db.engineers.length;

  // 明天休假但补位未安排（待创建派单）→ 提前一天提醒
  const tomorrowNeed = tomorrowLeaves.filter(l => l.dispatchStatus === '待创建派单');

  // 今日休假：展示姓名 / 时段 / 补位状态
  const parts = todayLeaves.map(l => {
    const name = NK.v.engName(l.engineerName);
    const per = l.leavePeriod === '全天' ? '全天' : l.leavePeriod;
    let tag = '';
    if (l.dispatchStatus === '已创建派单') tag = '<span class="lr-tag lr-ok">已安排补位</span>';
    else if (l.dispatchStatus === '无需派单') tag = '<span class="lr-tag lr-mute">无需派单</span>';
    else if (l.dispatchStatus === '待创建派单') tag = '<span class="lr-tag lr-warn">待安排补位</span>';
    else tag = '<span class="lr-tag lr-mute">未判断</span>';
    return `${name}<span class="lr-period">（${per}）</span>${tag}`;
  });

  // 有今天休假但补位未安排 → 加强提示（不标记严重告警）
  const todayNeed = todayLeaves.filter(l => l.dispatchStatus === '待创建派单');

  let body = '';
  let cls = 'lr-row lr-none';

  if (parts.length) {
    const todayPart = parts.map(p => `<span class="lr-person">${p}</span>`).join('');
    // 明天未安排补位 → 额外追加"去创建派单"按钮
    const tomorrowBtn = tomorrowNeed.length
      ? `<button class="lr-btn" onclick="UI.leaveCreateDispatch('${tomorrowNeed[0].leaveId}')">去创建派单 →</button>`
      : '';
    body = `<span class="lr-emoji">🌴</span><span class="lr-title">今日休假 ${todayLeaves.length}人</span> ${todayPart}${tomorrowBtn}`;
    cls = todayNeed.length ? 'lr-row lr-need' : 'lr-row';
  } else if (tomorrowNeed.length) {
    // 今天没人休，但明天有人休且未安排补位 → 提前提醒
    const name = NK.v.engName(tomorrowNeed[0].engineerName);
    const per = tomorrowNeed[0].leavePeriod === '全天' ? '全天' : tomorrowNeed[0].leavePeriod;
    body = `<span class="lr-emoji">⏰</span><span class="lr-title">明天 ${name} 休假（${per}）补位未安排</span>
      <button class="lr-btn" onclick="UI.leaveCreateDispatch('${tomorrowNeed[0].leaveId}')">去创建派单 →</button>`;
    cls = 'lr-row lr-need';
  } else {
    // 无人休假（或都无需/已安排）→ 降低视觉权重
    body = `<span class="lr-emoji">🙂</span><span class="lr-title">今日 ${total}名工程师均在岗</span>`;
    cls = 'lr-row lr-none';
  }

  const clickTarget = (todayLeaves.length || tomorrowNeed.length)
    ? ' onclick="UI.leaveTodayDetail()"'
    : '';
  return `<div class="dash-zone dash-leave"><div class="${cls}"${clickTarget}>${body}</div></div>`;
};

/** 今日休假详情抽屉（点击首页休假提醒整行打开） */
UI.leaveTodayDetail = () => {
  const today = NK.today();
  const leaves = NK.leavesToday();
  const tomorrowNeed = NK.leavesTomorrow().filter(l => l.dispatchStatus === '待创建派单');
  const rows = [...leaves, ...tomorrowNeed.filter(l => !leaves.includes(l))].map(l => {
    const days = NK.daysBetween(l.startDate, l.endDate) + 1;
    const sites = (l.responsibleSitesSnapshot || []).map(s => NK.v.siteName(s.siteName)).join('、') || '—';
    let stBadge = UI.leaveStatusBadge(l.dispatchStatus);
    if (l.dispatchStatus === '待创建派单') {
      stBadge += ` <button class="btn btn-sm btn-accent" onclick="UI.leaveCreateDispatch('${l.leaveId}')">去创建派单</button>`;
    }
    if (l.relatedDispatchId) {
      const d = NK.getDispatch(l.relatedDispatchId);
      if (d) stBadge += ` <button class="btn btn-sm" onclick="UI.dispatchDetail('${d.id}')">查看派单 ${NK.esc(d.no)}</button>`;
    }
    return `<div class="lr-d-item">
      <div class="lr-d-line"><b>${NK.esc(NK.v.engName(l.engineerName))}</b>
        <span class="badge gray">${l.leavePeriod}</span>
        <span class="num">${l.startDate} ~ ${l.endDate}（${days}天）</span></div>
      <div class="lr-d-sub">负责职场：${NK.esc(sites)}${l.remark ? '　备注：' + NK.esc(l.remark) : ''}</div>
      <div style="margin-top:6px">${stBadge}</div>
    </div>`;
  }).join('');

  const body = rows
    ? `<div class="lr-d-list">${rows}</div>
       <div style="margin-top:10px;font-size:11px;color:var(--text-3)">点击"去创建派单"为现场支持缺口安排补位；已安排补位的不再催促。</div>`
    : '<div class="fc-empty"><div class="fc-empty-icon">🙂</div><div class="fc-empty-text">今日无休假安排，工程师均在岗</div></div>';

  UI.modal('今日休假详情', body, `<button class="btn" data-close>关闭</button>`, {
    onMount() {},
  });
};

UI.resourcesJump = () => {
  UI.nav('resources');
  setTimeout(() => document.getElementById('resSearch') && document.getElementById('resSearch').focus(), 80);
};

/* ============================================================
   派单中心
   ============================================================ */
UI.renderDispatch = (filterArg) => {
  const el = document.getElementById('view-dispatch');
  if (filterArg) { NK.dispatchFilter = { ...filterArg }; }
  const f = NK.dispatchFilter;
  const today = NK.today();
  let list = [...NK.db.dispatches].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // 默认"全部"不包含已删除记录；仅在"已删除"筛选中显示回收站内容
  const showDeleted = f.status === '已删除';
  list = list.filter(d => (d.recordStatus === '已删除') === showDeleted);
  if (f.status && f.status !== '全部' && f.status !== '已删除') list = list.filter(d => NK.dispatchStatusLabel(d) === f.status);
  if (f.priority && f.priority !== '全部') list = list.filter(d => d.priority === f.priority);
  if (f.q) list = list.filter(d => `${d.no} ${d.title} ${d.city} ${d.engineer} ${d.contactName}`.includes(f.q));
  if (f.overdue) list = list.filter(d => d.visitDate && d.visitDate < today && !['completed', 'revoked'].includes(NK.dispatchStatusKey(d)) && d.recordStatus !== '已删除');
  // 上门日期范围筛选：与花姐助手共享同一套逻辑（NK.filterByVisitRange），保证数量一致
  list = NK.filterByVisitRange(list, f.visitStart, f.visitEnd);
  // 供应商筛选：与花姐助手共享同一套逻辑（NK.filterBySupplier），保证数量一致
  list = NK.filterBySupplier(list, f.supplier);
  const _vs = (f.visitStart || '').trim(), _ve = (f.visitEnd || '').trim();
  const _sup = (f.supplier || '').trim() || '全部供应商';

  const statusOpts = ['全部', '已删除', ...NK.DISPATCH_STATUS];
  const priOpts = ['全部', 'P1', 'P2', 'P3'];
  const supOpts = ['全部供应商', '源晨', '亚北', '未标注'];

  // 上门日期显示标签：今天· / 明天· 需保留具体日期；无日期显示「未填写」
  const visitLabel = (d) => {
    if (!d.visitDate) return '<span style="color:var(--text-3)">未填写</span>';
    if (d.visitDate === today) return `今天 · ${d.visitDate}`;
    const tm = (() => { const x = new Date(); x.setDate(x.getDate() + 1); return NK.fmtDate(x); })();
    if (d.visitDate === tm) return `明天 · ${d.visitDate}`;
    return d.visitDate;
  };

  // 快捷日期范围：今天 / 本周 / 本月 / 上月（需正确处理跨年）
  const _calc = UI._dispatchRangeCalc || (UI._dispatchRangeCalc = {});
  const _weekStart = (() => {
    const x = new Date(); const day = x.getDay(); x.setDate(x.getDate() - ((day + 6) % 7)); return NK.fmtDate(x);
  })();
  const _weekEnd = (() => {
    const x = new Date(); const day = x.getDay(); x.setDate(x.getDate() - ((day + 6) % 7) + 6); return NK.fmtDate(x);
  })();
  const _nowY = new Date().getFullYear(), _nowM = new Date().getMonth();
  const _monthStart = NK.fmtDate(new Date(_nowY, _nowM, 1));
  const _monthEnd = NK.fmtDate(new Date(_nowY, _nowM + 1, 0));
  const _lastY = _nowM === 0 ? _nowY - 1 : _nowY, _lastM = _nowM === 0 ? 11 : _nowM - 1;
  const _lastStart = NK.fmtDate(new Date(_lastY, _lastM, 1));
  const _lastEnd = NK.fmtDate(new Date(_lastY, _lastM + 1, 0));
  const _rangeShortcuts = [
    { label: '今天', start: today, end: today },
    { label: '本周', start: _weekStart, end: _weekEnd },
    { label: '本月', start: _monthStart, end: _monthEnd },
    { label: '上月', start: _lastStart, end: _lastEnd },
  ];
  const _rangeActive = (_vs && _ve && _vs === today && _ve === today) ? '今天'
    : (_vs === _weekStart && _ve === _weekEnd) ? '本周'
    : (_vs === _monthStart && _ve === _monthEnd) ? '本月'
    : (_vs === _lastStart && _ve === _lastEnd) ? '上月' : '';
  const _shortcutHTML = _rangeShortcuts.map(s =>
    `<button class="fb-chip ${_rangeActive === s.label ? 'on' : ''}" data-vs="${s.start}" data-ve="${s.end}" onclick="UI.setDispatchRange('${s.label}')">${s.label}</button>`).join('');

  // 供应商标签：低饱和色区分（源晨=灰蓝，亚北=灰紫，未标注=中性灰），不使用风险色
  const supLabel = (d) => {
    const s = NK.getSupplierOf(d);
    const name = s ? s.name : '未标注';
    const cls = s && s.id === 'yuanchen' ? 'sup-yc' : s && s.id === 'yabei' ? 'sup-yb' : 'sup-na';
    return `<span class="sup-tag ${cls}">${NK.esc(name)}</span>`;
  };

  // 供应商统计（轻量）：基于当前日期范围及其他筛选条件；选择单一供应商时只显示该供应商条数
  const _allSupCount = list.length;
  const _supStats = [];
  if (_sup === '全部供应商' || !_sup) {
    NK.SUPPLIERS.forEach(s => {
      const c = list.filter(d => { const g = NK.getSupplierOf(d); return g && g.id === s.id; }).length;
      _supStats.push(`${s.name}${c}条`);
    });
    const na = list.filter(d => !NK.getSupplierOf(d)).length;
    if (na > 0) _supStats.push(`未标注${na}条`);
  } else if (_sup !== '未标注') {
    const c = list.filter(d => { const g = NK.getSupplierOf(d); return g && g.name === _sup; }).length;
    _supStats.push(`${_sup}${c}条`);
  }
  const _supStatsHTML = _supStats.length ? `<div class="sup-stats">共${_allSupCount}条｜${_supStats.join('｜')}</div>` : '';

  el.innerHTML = UI.pageHead('派单中心', '全国派单 · 任务闭环 · 一次录入多处复用',
    `<button class="btn btn-accent" onclick="UI.dispatchCreate()">⇶ 新建派单</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" id="dpQ" placeholder="搜索编号/标题/城市/工程师…" value="${NK.esc(f.q || '')}">
      <select class="fb-select" id="dpStatus">${statusOpts.map(s => `<option ${(f.status || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="dpPri">${priOpts.map(s => `<option ${(f.priority || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="dpSupplier" title="供应商">
        ${supOpts.map(s => `<option ${_sup === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select>
      <span style="font-size:12px;color:var(--text-3);white-space:nowrap">上门日期</span>
      <input type="date" class="fb-date" id="dpVisitStart" value="${_vs || ''}" title="上门日期-开始">
      <span style="color:var(--text-3);font-size:12px">至</span>
      <input type="date" class="fb-date" id="dpVisitEnd" value="${_ve || ''}" title="上门日期-结束">
      <span class="fb-chips">${_shortcutHTML}</span>
      ${(_vs || _ve) ? `<button class="fb-clear" id="dpVisitClear" title="清除日期">清除日期</button>` : ''}
      <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="dpOverdue" ${f.overdue ? 'checked' : ''}>只看超时</label>
      <span class="spacer"></span>
      <span style="font-size:12px;color:var(--text-3)">共 ${list.length} 条</span>
    </div>
    ${_supStatsHTML}
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>派单编号</th><th>事项</th><th>职场</th><th>供应商</th><th>工程师</th><th>上门日期</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${list.length ? list.map(d => {
        const disp = NK.v.dispatch(d);
        const inactive = NK.dispatchInactive(d) || d.recordStatus === '已删除';
        const rowDim = inactive ? ' style="opacity:.62;filter:grayscale(.4)"' : '';
        // 操作按钮：详情始终；快捷操作按状态显示；更多菜单（撤销/删除）仅未撤销未删除记录；已撤销可恢复；回收站内可恢复/永久删除
        const dkey = NK.dispatchStatusKey(d);
        let ops = `<button class="btn btn-sm" onclick="UI.dispatchDetail('${d.id}')">详情</button>`;
        if (dkey === 'pending_send' && !inactive) {
          ops += `<button class="btn btn-sm btn-accent" onclick="UI.dispatchMarkSent('${d.id}')">标记已发送</button>`;
        }
        if (dkey === 'exception' && !inactive) {
          ops += `<button class="btn btn-sm btn-warn" onclick="UI.dispatchResolveException('${d.id}')">处理异常</button>`;
        }
        if (dkey === 'completed' && !inactive) {
          ops += `<button class="btn btn-sm btn-warn" onclick="UI.dispatchReopen('${d.id}')">重新打开</button>`;
        }
        if (d.recordStatus === '已删除') {
          ops += `<button class="btn btn-sm" onclick="UI.dispatchRestore('${d.id}')">恢复</button>`;
          ops += `<button class="btn btn-sm btn-danger" onclick="UI.dispatchPurge('${d.id}')">永久删除</button>`;
        } else if (dkey === 'revoked') {
          ops += `<button class="btn btn-sm" onclick="UI.dispatchUnrevoke('${d.id}')">恢复派单</button>`;
        } else {
          ops += `<span style="position:relative">
            <button class="btn btn-sm" data-more="${d.id}">更多 ▾</button>
            <span class="dm-menu" id="dmMenu${d.id}" style="display:none;position:absolute;right:0;top:100%;z-index:30;background:var(--bg-card,#fff);border:1px solid var(--line,#e5e5e5);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);padding:4px;min-width:110px">
              <button class="dm-item" style="display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;cursor:pointer;font-size:12px;border-radius:6px" onclick="UI.dispatchRevoke('${d.id}')">撤销派单</button>
              <button class="dm-item" style="display:block;width:100%;text-align:left;background:none;border:none;padding:7px 10px;cursor:pointer;font-size:12px;border-radius:6px;color:var(--danger,#d93025)" onclick="UI.dispatchDelete('${d.id}')">删除记录</button>
            </span>
          </span>`;
        }
        return `<tr${rowDim}>
          <td class="num">${d.no}</td>
          <td style="max-width:260px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${NK.esc(d.title)}</div>
            <div style="color:var(--text-3);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${NK.esc((d.desc || '').slice(0, 40))}</div></td>
          <td>${NK.esc(disp.siteName || d.city)}</td>
          <td style="white-space:nowrap">${supLabel(d)}</td>
          <td>${NK.esc(disp.engineer || '—')}</td>
          <td style="white-space:nowrap">${visitLabel(d)}</td>
          <td>${UI.statusBadge(NK.dispatchStatusLabel(d))}${d.urgentCount ? `<div style="font-size:10px;color:var(--warn)">已催${d.urgentCount}次</div>` : ''}${d.revokeReason ? `<div style="font-size:10px;color:var(--text-3)">撤销原因：${NK.esc(d.revokeReason)}</div>` : ''}</td>
          <td style="white-space:nowrap">${ops}</td>
        </tr>`;
      }).join('') : UI.empty(showDeleted ? '回收站为空，暂无已删除派单' : '暂无派单，点击右上角「新建派单」开始', 8)}</tbody>
    </table></div></div>`;

  const bind = () => {
    const onFilter = () => {
      const vs = document.getElementById('dpVisitStart').value;
      const ve = document.getElementById('dpVisitEnd').value;
      // 日期合法性校验：开始不能晚于结束（不静默交换、不清空数据）
      if (vs && ve && vs > ve) {
        UI.toast('开始日期不能晚于结束日期，请重新选择。', 'warn');
        return;
      }
      NK.dispatchFilter = {
        q: document.getElementById('dpQ').value,
        status: document.getElementById('dpStatus').value,
        priority: document.getElementById('dpPri').value,
        supplier: document.getElementById('dpSupplier').value,
        visitStart: vs,
        visitEnd: ve,
        overdue: document.getElementById('dpOverdue').checked,
      };
      UI.renderDispatch();
    };
    document.getElementById('dpQ').addEventListener('input', NK.debounce ? NK.debounce(onFilter, 300) : onFilter);
    document.getElementById('dpStatus').onchange = onFilter;
    document.getElementById('dpPri').onchange = onFilter;
    document.getElementById('dpSupplier').onchange = onFilter;
    document.getElementById('dpVisitStart').onchange = onFilter;
    document.getElementById('dpVisitEnd').onchange = onFilter;
    document.getElementById('dpOverdue').onchange = onFilter;
    const clearBtn = document.getElementById('dpVisitClear');
    if (clearBtn) clearBtn.onclick = () => {
      document.getElementById('dpVisitStart').value = '';
      document.getElementById('dpVisitEnd').value = '';
      onFilter();
    };
    // 更多菜单：点击展开/收起
    el.querySelectorAll('[data-more]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const m = document.getElementById('dmMenu' + btn.getAttribute('data-more'));
        const all = el.querySelectorAll('.dm-menu');
        all.forEach(x => { if (x !== m) x.style.display = 'none'; });
        m.style.display = m.style.display === 'none' ? 'block' : 'none';
      };
    });
    // 点击其他区域关闭更多菜单
    document.addEventListener('click', (e) => {
      if (!e.target.closest || !e.target.closest('[data-more], .dm-menu')) {
        el.querySelectorAll('.dm-menu').forEach(x => x.style.display = 'none');
      }
    }, { once: false });
  };
  setTimeout(bind, 0);
};

/** 派单中心：上门日期范围快捷筛选（今天/本周/本月/上月/清除） */
UI.setDispatchRange = (label) => {
  const today = NK.today();
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  const day = now.getDay();
  let start = '', end = '';
  if (label === '今天') { start = end = today; }
  else if (label === '本周') {
    const mon = new Date(now); mon.setDate(now.getDate() - ((day + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    start = NK.fmtDate(mon); end = NK.fmtDate(sun);
  } else if (label === '本月') {
    start = NK.fmtDate(new Date(y, m, 1)); end = NK.fmtDate(new Date(y, m + 1, 0));
  } else if (label === '上月') {
    const ly = m === 0 ? y - 1 : y, lm = m === 0 ? 11 : m - 1;
    start = NK.fmtDate(new Date(ly, lm, 1)); end = NK.fmtDate(new Date(ly, lm + 1, 0));
  } else {
    // 清除日期
    NK.dispatchFilter = NK.dispatchFilter || {};
    delete NK.dispatchFilter.visitStart; delete NK.dispatchFilter.visitEnd;
    UI.renderDispatch(); return;
  }
  NK.dispatchFilter = NK.dispatchFilter || {};
  NK.dispatchFilter.visitStart = start;
  NK.dispatchFilter.visitEnd = end;
  UI.renderDispatch();
};

/** 兼容旧调用：设置单日范围（开始=结束=date），date 为空则清除 */
UI.setDispatchVisit = (date) => {
  if (date) { NK.dispatchFilter = NK.dispatchFilter || {}; NK.dispatchFilter.visitStart = date; NK.dispatchFilter.visitEnd = date; }
  else {
    NK.dispatchFilter = NK.dispatchFilter || {};
    delete NK.dispatchFilter.visitStart; delete NK.dispatchFilter.visitEnd;
  }
  UI.renderDispatch();
};

/* ============================================================
   极简化派单创建
   ============================================================ */

UI.dispatchCreate = (siteId, prefillOpts) => {
  prefillOpts = prefillOpts || {};
  const LS_KEY = 'nk_recent_sites';
  const getRecent = () => { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } };
  const addRecent = (site) => {
    const rec = getRecent().filter(r => r.id !== site.id);
    rec.unshift({ id: site.id, name: site.name, city: site.city });
    localStorage.setItem(LS_KEY, JSON.stringify(rec.slice(0, 5)));
  };
  const recentSites = getRecent();

  const body = `
    <div id="dpWrap">
      <div class="dp-field">
        <label class="dp-label">派单区域</label>
        <div class="dp-site-wrap">
          <input id="dpSiteSearch" class="dp-input" placeholder="输入城市、区域或职场，例如：湖州、南京、北京…" autocomplete="off">
          <div id="dpHint" class="dp-hint"></div>
        </div>
        <div id="dpCandidates" class="dp-candidates hidden"></div>
        <div id="dpSelected" class="dp-selected hidden"></div>
        <div id="dpError" class="dp-error hidden"></div>
      </div>
      <div class="dp-field">
        <label class="dp-label">供应商 <span style="color:var(--text-3);font-weight:400;font-size:11px">必选，本次上门派单发往哪家供应商</span></label>
        <div class="dp-supplier-row" id="dpSupplierRow">
          <button type="button" class="dp-sup-btn" data-sup="yuanchen">源晨</button>
          <button type="button" class="dp-sup-btn" data-sup="yabei">亚北</button>
        </div>
        <div class="dp-hint">请选择源晨或亚北，生成派单前必须指定供应商</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">派单原因</label>
        <textarea id="dpDesc" class="dp-textarea" placeholder="例如：3楼打印机无法打印，提示卡纸，请安排现场检查。" rows="3"></textarea>
        <div class="dp-hint">输入自然语言即可，无需填写标题</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">上门日期 <span style="color:var(--text-3);font-weight:400;font-size:11px">选填，快捷选择即可</span></label>
        <div class="dp-visit-row">
          <button type="button" class="dp-visit-btn" data-vd="today">今天</button>
          <button type="button" class="dp-visit-btn dp-visit-active" data-vd="tomorrow">明天</button>
          <input type="date" id="dpVisitDate" class="dp-input dp-date-input" style="color:var(--text);width:auto;flex:1;min-width:120px">
          <button type="button" class="dp-visit-btn dp-visit-none" data-vd="none">暂不确定</button>
        </div>
        <div class="dp-hint">默认建议「明天」，也可指定日期；选择「暂不确定」仍可正常创建派单，上门日期显示「未填写」</div>
      </div>
      <div class="dp-submit-row">
        <button class="btn" data-close>取消</button>
        <button class="btn btn-accent" id="dpSubmitBtn" disabled>生成派单</button>
      </div>
      <div id="dpCtrlHint" class="dp-ctrl-hint">Ctrl + Enter 快速提交</div>
    </div>
    <div id="dpSuccess" class="dp-success hidden">
      <div class="dp-success-icon">✓</div>
      <div class="dp-success-title" id="dpSuccessTitle"></div>
      <div class="dp-success-sub" id="dpSuccessSub"></div>
      <div class="dp-msg-box">
        <div class="dp-msg-head">派单消息</div>
        <div id="dpMsgContent" class="dp-msg-body"></div>
      </div>
      <div class="dp-success-actions">
        <button class="btn btn-accent" id="dpCopyBtn">复制派单消息</button>
        <button class="btn" id="dpViewBtn">查看派单记录</button>
        <button class="btn btn-ghost" id="dpAgainBtn">再建一条</button>
      </div>
    </div>`;

  // 未保存内容判断：供 onBeforeClose 使用（成功页不拦截）
  const modalState = { edited: false };
  const isEdited = () => modalState.edited;

  UI.modal('新建派单', body, '', {
    size: 'modal-dispatch',
    onBeforeClose(close, reason) {
      // 编辑视图且已输入内容 → 走未保存确认
      if (reason !== 'save' && isEdited()) {
        UI.confirmDiscard('当前派单还没有生成，确定放弃吗？');
        return; // 不直接关闭，等待用户选择
      }
      close();
    },
    onMount(root) {
      const searchInput  = root.querySelector('#dpSiteSearch');
      const descInput   = root.querySelector('#dpDesc');
      const visitInput  = root.querySelector('#dpVisitDate');
      const submitBtn   = root.querySelector('#dpSubmitBtn');
      const hint        = root.querySelector('#dpHint');
      const candidates  = root.querySelector('#dpCandidates');
      const selected    = root.querySelector('#dpSelected');
      const errorEl     = root.querySelector('#dpError');
      const wrap        = root.querySelector('#dpWrap');
      const successView = root.querySelector('#dpSuccess');

      let pickedSite = null;
      let candidatesShown = [];
      let pickedSupplier = (prefillOpts.supplier && NK.normSupplier(prefillOpts.supplier)) ? NK.normSupplier(prefillOpts.supplier).id : '';

      const siteCandidateHTML = (s) =>
        `<div class="dpc-item" data-id="${s.id}" tabindex="0">
          <div class="dpc-main">
            <div class="dpc-name">${NK.esc(NK.v.siteName(s.name))} <span class="badge ${s.supportType === '驻场' ? 'accent' : 'gray'}" style="margin-left:4px">${s.supportType}</span></div>
            <div class="dpc-sub">${NK.esc(s.city)} · ${NK.esc(NK.v.address(s.address || ''))}</div>
          </div>
          <div class="dpc-eng">${NK.esc(NK.v.engName(s.defaultEngineer || '—'))}</div>
        </div>`;

      const pickSite = (s) => {
        pickedSite = s;
        modalState.edited = true;
        addRecent(s);
        searchInput.value = NK.v.siteName(s.name);

        // 补位派单：若默认工程师正在休假，提示花姐改用其他工程师
        const isExcluded = prefillOpts.excludeEngineer && s.defaultEngineer === prefillOpts.excludeEngineer;

        if (!s.needDispatch) {
          errorEl.textContent = `「${NK.v.siteName(s.name)}」为驻场区域，默认由驻场直接处理，无需常规派单。`;
          errorEl.classList.remove('hidden');
          candidates.classList.add('hidden');
          selected.classList.add('hidden');
        } else {
          errorEl.classList.add('hidden');
          candidates.classList.add('hidden');
          const engLabel = isExcluded
            ? `<span class="dps-eng" style="color:var(--warn)">默认工程师 ${NK.esc(NK.v.engName(s.defaultEngineer || '—'))} 休假中，请在派单后另行指定执行工程师</span>`
            : `<span class="dps-eng">默认工程师：${NK.esc(NK.v.engName(s.defaultEngineer || '—'))}</span>`;
          selected.innerHTML = `<span class="dps-badge">已选择</span>
            <span class="dps-name">${NK.esc(NK.v.siteName(s.name))}</span>
            <span class="dps-sep">·</span>
            ${engLabel}
            <span class="dps-sep">·</span>
            <span class="dps-type">${s.supportType}</span>`;
          selected.classList.remove('hidden');
        }

        submitBtn.disabled = false;
        descInput.focus();
        // 补位派单：预填派单原因（花姐可修改）
        if (prefillOpts.prefillReason) {
          descInput.value = prefillOpts.prefillReason;
          checkSubmit && checkSubmit();
        }
      };

      const doSearch = () => {
        const q = searchInput.value.trim();
        if (!q) {
          candidatesShown = recentSites.map(r => NK.getSite(r.id)).filter(Boolean);
          candidates.innerHTML = candidatesShown.length
            ? candidatesShown.map(siteCandidateHTML).join('')
            : '<div class="dp-hint" style="padding:8px 0">无最近使用记录</div>';
          hint.textContent = '最近使用';
          selected.classList.add('hidden');
          errorEl.classList.add('hidden');
          candidates.classList.remove('hidden');
          return;
        }

        const all = NK.db.sites.filter(s =>
          `${s.name} ${s.city} ${s.province} ${s.contactName} ${s.address} ${s.siteNo || ''}`.indexOf(q) >= 0
        ).slice(0, 12);

        if (!all.length) {
          candidates.classList.add('hidden');
          errorEl.textContent = '未找到匹配的职场或区域，请检查关键词';
          errorEl.classList.remove('hidden');
          return;
        }

        const byCity = {};
        all.forEach(s => { if (!byCity[s.city]) byCity[s.city] = []; byCity[s.city].push(s); });

        candidatesShown = all;
        if (Object.keys(byCity).length === 1 && all.length > 1) {
          hint.textContent = '同城多职场，请选择具体职场';
        } else if (all.length === 1) {
          pickSite(all[0]);
          return;
        } else {
          hint.textContent = `${all.length} 个结果`;
        }
        candidates.innerHTML = all.map(siteCandidateHTML).join('');
        selected.classList.add('hidden');
        errorEl.classList.add('hidden');
        candidates.classList.remove('hidden');
      };

      candidates.addEventListener('click', (e) => {
        const item = e.target.closest('.dpc-item');
        if (!item) return;
        const s = NK.getSite(item.dataset.id);
        if (s) pickSite(s);
      });

      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const items = candidates.querySelectorAll('.dpc-item');
          if (items.length) items[0].focus();
        }
        if (e.key === 'Enter') {
          if (candidatesShown.length === 1) pickSite(candidatesShown[0]);
          else doSearch();
        }
        if (e.key === 'Escape') candidates.classList.add('hidden');
      });

      candidates.addEventListener('keydown', (e) => {
        const items = [...candidates.querySelectorAll('.dpc-item')];
        const idx = items.indexOf(e.target);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
        if (e.key === 'ArrowUp')   { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
        if (e.key === 'Enter') {
          const id = e.target.closest('.dpc-item')?.dataset.id;
          if (id) { const s = NK.getSite(id); if (s) pickSite(s); }
        }
        if (e.key === 'Escape') candidates.classList.add('hidden');
      });

      searchInput.addEventListener('input', NK.debounce ? NK.debounce(doSearch, 200) : doSearch);
      searchInput.addEventListener('focus', () => {
        if (!searchInput.value.trim() && recentSites.length) doSearch();
      });

      const checkSubmit = () => {
        if (descInput.value.trim()) modalState.edited = true;
        submitBtn.disabled = !(pickedSite && descInput.value.trim());
      };
      descInput.addEventListener('input', checkSubmit);
      visitInput.addEventListener('input', () => { if (visitInput.value) modalState.edited = true; });

      // 供应商选择：源晨/亚北 分段按钮（必选，不默认）
      const supBtns = root.querySelectorAll('.dp-sup-btn');
      const applySupActive = () => {
        supBtns.forEach(b => {
          const on = pickedSupplier && b.dataset.sup === pickedSupplier;
          b.classList.toggle('dp-sup-active', !!on);
        });
      };
      supBtns.forEach(btn => {
        btn.onclick = () => {
          pickedSupplier = btn.dataset.sup;
          modalState.edited = true;
          applySupActive();
        };
      });
      if (pickedSupplier) applySupActive();

      // 上门日期快捷选择：今天/明天/选择日期/暂不确定（默认明天）
      const visitBtns = root.querySelectorAll('.dp-visit-btn');
      const todayV = NK.today();
      const tomorrowV = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return NK.fmtDate ? NK.fmtDate(d) : NK.today(); })();
      const applyVisitActive = () => {
        visitBtns.forEach(b => {
          const vd = b.dataset.vd;
          const active = (vd === 'today' && visitInput.value === todayV) ||
                         (vd === 'tomorrow' && visitInput.value === tomorrowV) ||
                         (vd === 'none' && !visitInput.value);
          b.classList.toggle('dp-visit-active', active);
        });
      };
      // 默认建议「明天」：仅在花姐尚未自行选择时预置（可改/可清）
      if (!visitInput.value) {
        visitInput.value = tomorrowV;
      }
      visitBtns.forEach(btn => {
        btn.onclick = () => {
          const vd = btn.dataset.vd;
          if (vd === 'today') visitInput.value = todayV;
          else if (vd === 'tomorrow') visitInput.value = tomorrowV;
          else if (vd === 'none') visitInput.value = '';
          modalState.edited = true;
          applyVisitActive();
        };
      });
      visitInput.addEventListener('change', applyVisitActive);
      applyVisitActive();

      descInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !submitBtn.disabled) {
          e.preventDefault();
          submitBtn.click();
        }
      });

      submitBtn.onclick = () => {
        if (!pickedSite || !descInput.value.trim()) return;

        // 供应商必选：未选择则提示，不自动默认，不生成正式派单
        if (!pickedSupplier) {
          UI.toast('请选择本次派单供应商。', 'warn');
          return;
        }
        const supObj = NK.normSupplier(pickedSupplier) || {};
        const supName = supObj.name || '';

        // 生成前确认摘要：展示供应商/职场/上门日期，花姐最终确认后再创建
        const _confirmSup = supName || '未标注';
        const _confirmVisit = visitInput.value || '未填写';
        UI.confirm(`确认本次派单信息？<br><br>供应商：<b>${_confirmSup}</b><br>职场：${NK.esc(NK.v.siteName(pickedSite.name))}<br>上门日期：${_confirmVisit}`, () => {
          doCreate();
        }, '生成派单');
        return;

        function doCreate() {
        const reason = descInput.value.trim();
        const title = NK.v.siteName(pickedSite.name) +
          (reason.includes('打印') ? '打印机' :
           reason.includes('网络') ? '网络' :
           reason.includes('电脑') ? '电脑' :
           reason.includes('电话') || reason.includes('话机') ? '话机' :
           reason.includes('投影') || reason.includes('屏幕') ? '显示' :
           reason.includes('门禁') || reason.includes('监控') ? '安保' : '运维') + '处理';

        const d = NK.createDispatch({
          title, desc: reason,
          siteId: pickedSite.id,
          type: '故障',
          source: '花姐手动创建',
          visitDate: visitInput.value,
          supplier: supName,
        });

        // 补位派单：派单创建成功后关联休假记录，更新补位状态为"已创建派单"
        if (prefillOpts.leaveId) {
          NK.linkLeaveDispatch(prefillOpts.leaveId, d.id);
        }

        // 内部派单协调：优先关联今日已存在的待处理派单协调任务，避免重复创建
        const _today = NK.today();
        const coordTask = NK.db.tasks.find(t =>
          t.templateId === 'TPL011' && t.status !== '已完成' &&
          (t.fixedDate === _today || t.createdAt.slice(0, 10) === _today));
        if (coordTask) {
          coordTask.dispatchId = d.id;
          coordTask.latestFeedback = '已生成关联派单 ' + d.no;
          coordTask.updatedAt = NK.now();
          NK.save();
        }

        wrap.classList.add('hidden');
        modalState.edited = false; // 已保存，成功页关闭不拦截
        root.querySelector('#dpSuccessTitle').textContent =
          supName
            ? `花姐，${supName}的派单已经创建好了 ✓`
            : `花姐，${NK.v.siteName(pickedSite.name)}的派单已经生成 ✓`;
        root.querySelector('#dpSuccessSub').textContent =
          `派单已创建（待发送），记得发给${supName || '供应商'}后标记已发送`;
        root.querySelector('#dpMsgContent').textContent = d.msg;
        successView.classList.remove('hidden');

        root.querySelector('#dpCopyBtn').onclick = () => {
          UI.copy(d.msg);
          UI.toast('花姐，派单消息已复制 ✨', 'ok');
        };
        root.querySelector('#dpViewBtn').onclick = () => {
          UI.modalClose();
          UI.dispatchDetail(d.id);
        };
        root.querySelector('#dpAgainBtn').onclick = () => {
          UI.modalClose();
          UI.dispatchCreate();
        };
        } // end doCreate
      };

      // [close] 已由统一弹窗机制绑定

      // 补位派单：若传入了 siteId，自动选中该职场并预填
      if (siteId) {
        const preSite = NK.getSite(siteId);
        if (preSite) {
          pickSite(preSite);
          setTimeout(() => descInput.focus(), 60);
          return;
        }
      }
      setTimeout(() => searchInput.focus(), 60);
    },
  });
};

/** 派单详情 */
UI.dispatchDetail = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const disp = NK.v.dispatch(d);
  const t = NK.getTask(d.taskId);
  const key = NK.dispatchStatusKey(d);
  const label = NK.dispatchStatusLabel(d);
  const sup = NK.dispatchSupplierLabel(d);

  // 轻量三段状态提示：①待发送 — ②已发送 — ③已完成（当前高亮，不可点击）
  const threeFlow = ['待发送', '已发送', '已完成'];
  const flowIdx = threeFlow.indexOf(label); // completed→2, sent/pending_send/exception→对应
  const flowCur = key === 'completed' ? 2 : key === 'sent' ? 1 : key === 'exception' ? 1 : key === 'pending_send' ? 0 : -1;
  const flowHTML = `<div class="ds-flow">${threeFlow.map((s, i) => `
    <div class="dsf-step ${i < flowCur ? 'done' : i === flowCur ? 'cur' : ''}">${i + 1} ${s}</div>
    ${i < threeFlow.length - 1 ? `<div class="dsf-line ${i < flowCur ? 'done' : ''}"></div>` : ''}`).join('')}</div>`;

  // 状态说明文案
  const statusDesc = {
    pending_send: '派单已经创建，尚未记录为发送给供应商。',
    sent: `已发送给${sup === '未标注' ? '供应商' : sup}${d.visitDate ? `，计划${d.visitDate}上门` : ''}。如无异常，无需继续操作。`,
    completed: '该派单已经完成。',
    exception: '当前派单存在异常，请确认后续安排。',
    revoked: '该派单已撤销，不再继续执行。',
    draft: '草稿仅作创建前辅助态，不进入正式流程。',
  }[key] || '';

  // 上门日期编辑控件
  const visitNow = d.visitDate || '';
  const visitEdit = `
    <div class="dg-item" style="margin-bottom:8px">
      <span class="dg-label">上门日期</span>
      <span class="dg-val" id="ddVisitVal">${visitNow ? NK.esc(visitNow) : '<span style="color:var(--text-3)">未填写</span>'}</span>
      <button class="btn btn-sm" id="ddVisitEdit" style="margin-left:4px">${visitNow ? '修改' : '补充上门日期'}</button>
    </div>
    <div id="ddVisitEditBox" style="display:none;margin-bottom:8px">
      <input type="date" id="ddVisitInput" class="dp-input dp-date-input" style="width:auto" value="${visitNow}">
      <button class="btn btn-sm btn-accent" id="ddVisitSave">保存</button>
      <button class="btn btn-sm" id="ddVisitCancel">取消</button>
      <button class="btn btn-sm btn-ghost" id="ddVisitClear">设为未填写</button>
    </div>
    ${d.visitDateHistory && d.visitDateHistory.length ? `<div style="margin-top:4px;font-size:11px;color:var(--text-3)">修改历史：${d.visitDateHistory.map(h => `${h.from} → ${h.to}（${NK.fmtDT(new Date(h.at))}）`).join('；')}</div>` : ''}`;

  // 当前情况与记录（状态说明/最近反馈/异常说明/完成说明/最近更新）
  const lastFeedback = d.supplierFeedbackList && d.supplierFeedbackList.length
    ? d.supplierFeedbackList[d.supplierFeedbackList.length - 1]
    : null;
  const histHTML = (d.statusHistory && d.statusHistory.length) ? `
    <div id="ddHistToggle" style="cursor:pointer;color:var(--accent,#6a5ae0);font-size:12px;margin-top:8px">操作历史 ▸</div>
    <div id="ddHistBody" style="display:none;margin-top:6px;max-height:180px;overflow:auto">
      ${d.statusHistory.map(h => `<div style="font-size:11px;color:var(--text-3);padding:2px 0;border-bottom:1px dashed var(--line,#eee)">${NK.fmtDT(new Date(h.at))} · ${h.fromLabel || h.from} → ${h.toLabel || h.to}${h.note ? '（' + NK.esc(h.note) + '）' : ''}</div>`).join('')}
    </div>` : '';

  // 撤销原因展示
  const revokeHTML = (d.revokeReason && key === 'revoked') ? `<div class="dg-item"><span class="dg-label">撤销原因</span><span class="dg-val">${NK.esc(d.revokeReason)}</span></div>` : '';

  // 按状态动态按钮
  const btnHTML = (() => {
    const b = (id, label, cls) => `<button class="btn btn-sm ${cls || ''}" id="${id}">${label}</button>`;
    switch (key) {
      case 'draft':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsGen', '生成派单', 'btn-accent')}${b('dsEdit', '继续编辑')}${b('dsDelDraft', '删除草稿', 'btn-danger')}</div>`;
      case 'pending_send':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsSend', '标记已发送', 'btn-accent')}${b('dsCopy', '复制')}${b('dsEdit', '编辑')}${b('dsModSup', '修改供应商')}${b('dsModVisit', '修改上门日期')}${b('dsRevoke', '撤销')}${b('dsDelete', '删除', 'btn-danger')}</div>`;
      case 'sent':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsDone', '标记完成', 'btn-success')}${b('dsCopy', '复制')}${b('dsModVisit', '修改上门日期')}${b('dsFeedback', '记录供应商反馈')}${b('dsException', '记录异常', 'btn-warn')}${b('dsModSup', '更换供应商')}${b('dsRevoke', '撤销')}</div>`;
      case 'exception':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsResolve', '处理异常', 'btn-accent')}${b('dsModVisit', '修改上门日期')}${b('dsModSup', '更换供应商')}${b('dsExcNote', '补充异常说明')}${b('dsDone', '标记完成', 'btn-success')}${b('dsRevoke', '撤销')}</div>`;
      case 'completed':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsView', '查看')}${b('dsHist', '历史')}${b('dsCopy', '复制')}${b('dsReopen', '重新打开', 'btn-warn')}</div>`;
      case 'revoked':
        return `<div style="display:flex;gap:6px;flex-wrap:wrap">${b('dsView', '查看详情')}${b('dsRevokeReason', '撤销原因')}${b('dsRestore', '恢复派单', 'btn-accent')}${b('dsHist', '历史')}</div>`;
      default:
        return '';
    }
  })();

  const body = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
      <span class="num" style="font-weight:700;font-size:14px">${d.no}</span>
      <h3 style="flex:1;font-size:15px">${NK.esc(disp.title)}</h3>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--text-2);margin-bottom:8px">
      <span>供应商：<b>${sup === '未标注' ? '<span style="color:var(--text-3)">未标注</span>' : NK.esc(sup)}</b></span>
      <span>职场：<b>${NK.esc(disp.siteName || d.city || '—')}</b></span>
      <span>上门日期：<b>${d.visitDate ? NK.esc(d.visitDate) : '<span style="color:var(--text-3)">未填写</span>'}</b></span>
      <span>状态：${UI.statusBadge(label)}</span>
    </div>
    ${flowHTML}
    <div style="margin:8px 0 12px;padding:8px 12px;background:var(--bg-soft,#f6f5ff);border-radius:8px;font-size:12px;color:var(--text-2)">${NK.esc(statusDesc)}</div>
    <div class="card"><div class="card-head"><div class="card-title">基本信息</div></div><div class="card-body">
      <div class="detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">
        <div class="dg-item"><span class="dg-label">派单编号</span><span class="dg-val">${d.no}</span></div>
        <div class="dg-item"><span class="dg-label">事项名称</span><span class="dg-val">${NK.esc(disp.title)}</span></div>
        <div class="dg-item"><span class="dg-label">供应商</span><span class="dg-val" id="ddSupVal">${sup === '未标注' ? '<span style="color:var(--text-3)">未标注</span>' : NK.esc(sup)}</span>
          ${key === 'pending_send' || key === 'sent' || key === 'exception' ? `<button class="btn btn-sm" id="ddSupEdit" style="margin-left:4px">${sup === '未标注' ? '补充' : '修改'}</button>` : ''}</div>
        <div class="dg-item"><span class="dg-label">职场</span><span class="dg-val">${NK.esc(disp.siteName || d.city || '—')}</span></div>
        <div class="dg-item"><span class="dg-label">当前状态</span><span class="dg-val">${UI.statusBadge(label)}</span></div>
      </div>
      <div id="ddSupEditBox" style="display:none;margin-top:8px;padding-top:8px;border-top:1px dashed var(--line,#e5e5e5)">
        <div style="display:flex;gap:8px;align-items:center">
          ${NK.SUPPLIERS.map(s => `<button type="button" class="dp-sup-btn" data-sup="${s.id}" data-name="${s.name}">${s.name}</button>`).join('')}
          <button class="btn btn-sm btn-accent" id="ddSupSave">保存</button>
          <button class="btn btn-sm" id="ddSupCancel">取消</button>
        </div>
        ${d.supplierHistory && d.supplierHistory.length ? `<div style="margin-top:6px;font-size:11px;color:var(--text-3)">修改历史：${d.supplierHistory.map(h => `${h.fromName} → ${h.toName}（${NK.fmtDT(new Date(h.at))}）`).join('；')}</div>` : ''}
      </div>
      ${(key === 'pending_send' || key === 'sent' || key === 'exception') ? visitEdit : `<div class="dg-item" style="margin-bottom:8px"><span class="dg-label">上门日期</span><span class="dg-val">${visitNow ? NK.esc(visitNow) : '<span style="color:var(--text-3)">未填写</span>'}</span></div>`}
    </div></div>
    <div class="card"><div class="card-head"><div class="card-title">职场与联系信息</div></div><div class="card-body">
      <div class="detail-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">
        <div class="dg-item"><span class="dg-label">联系人</span><span class="dg-val">${NK.esc(disp.contactName || '—')} ${NK.esc(disp.contactPhone || '')}</span></div>
        <div class="dg-item"><span class="dg-label">电话</span><span class="dg-val">${NK.esc(disp.contactPhone || '—')}</span></div>
        <div class="dg-item"><span class="dg-label">地址</span><span class="dg-val">${NK.esc(disp.address || '—')}</span></div>
        <div class="dg-item"><span class="dg-label">默认工程师</span><span class="dg-val">${NK.esc(disp.engineer || '—')}</span></div>
        <div class="dg-item"><span class="dg-label">派单原因</span><span class="dg-val">${NK.esc(d.desc || d.title || '—')}</span></div>
        <div class="dg-item"><span class="dg-label">支持方式</span><span class="dg-val">${disp.supportType || '—'}${disp.needDispatch ? ' · 需派单' : ''}</span></div>
      </div>
    </div></div>
    <div class="card"><div class="card-head"><div class="card-title">当前情况与记录</div></div><div class="card-body">
      <div class="dg-item" style="margin-bottom:6px"><span class="dg-label">状态说明</span><span class="dg-val">${NK.esc(statusDesc)}</span></div>
      <div class="dg-item" style="margin-bottom:6px"><span class="dg-label">最近供应商反馈</span><span class="dg-val">${lastFeedback ? `${NK.esc(lastFeedback.content)}${lastFeedback.person ? '（' + NK.esc(lastFeedback.person) + '）' : ''}` : '—'}</span></div>
      ${key === 'exception' ? `<div class="dg-item" style="margin-bottom:6px"><span class="dg-label">异常说明</span><span class="dg-val">${NK.esc(d.exceptionNote || '—')}</span></div>` : ''}
      ${key === 'completed' ? `<div class="dg-item" style="margin-bottom:6px"><span class="dg-label">完成说明</span><span class="dg-val">${NK.esc(d.completionNote || '—')}</span></div>` : ''}
      <div class="dg-item"><span class="dg-label">最近更新</span><span class="dg-val">${d.updatedAt ? NK.fmtDT(new Date(d.updatedAt)) : '—'}</span></div>
      ${histHTML}
    </div></div>
    <div class="card"><div class="card-head"><div class="card-title">操作</div></div><div class="card-body">
      ${btnHTML}
    </div></div>
    ${revokeHTML}`;
  const foot = `<button class="btn" data-close>关闭</button>`;
  UI.modal(`派单详情`, body, foot, {
    size: 'modal-lg',
    onMount(root) {
      const ck = (btnId, fn) => { const b = root.querySelector(btnId); if (b) b.onclick = fn; };
      ck('#dsSend', () => UI.dispatchMarkSent(d.id));
      ck('#dsDone', () => UI.dispatchMarkCompleted(d.id));
      ck('#dsCopy', () => UI.copy(d.msg || ''));
      ck('#dsEdit', () => UI.dispatchCreate(d.siteId || '', { editId: d.id }));
      ck('#dsModSup', () => { const b = root.querySelector('#ddSupEdit'); if (b) b.click(); });
      ck('#dsModVisit', () => { const b = root.querySelector('#ddVisitEdit'); if (b) b.click(); });
      ck('#dsFeedback', () => UI.dispatchFeedback(d.id));
      ck('#dsException', () => UI.dispatchRecordException(d.id));
      ck('#dsResolve', () => UI.dispatchResolveException(d.id));
      ck('#dsExcNote', () => UI.dispatchRecordException(d.id));
      ck('#dsRevoke', () => UI.dispatchRevoke(d.id));
      ck('#dsDelete', () => UI.dispatchDelete(d.id));
      ck('#dsDelDraft', () => UI.dispatchDelete(d.id));
      ck('#dsReopen', () => UI.dispatchReopen(d.id));
      ck('#dsRestore', () => UI.dispatchUnrevoke(d.id));
      ck('#dsGen', () => { if (d.siteId) UI.dispatchCreate(d.siteId); });
      ck('#dsHist', () => { const h = root.querySelector('#ddHistBody'); if (h) h.style.display = h.style.display === 'block' ? 'none' : 'block'; });
      ck('#dsView', () => {});
      ck('#dsRevokeReason', () => {});
      ck('#ddHistToggle', () => { const h = root.querySelector('#ddHistBody'); if (h) h.style.display = h.style.display === 'block' ? 'none' : 'block'; });
      ck('#dsModVisit2', () => {});

      // 上门日期补充/修改
      const visitEditBtn = root.querySelector('#ddVisitEdit');
      const visitBox = root.querySelector('#ddVisitEditBox');
      const visitVal = root.querySelector('#ddVisitVal');
      const visitInput = root.querySelector('#ddVisitInput');
      const refreshVisitVal = () => {
        const cur = NK.getDispatch(d.id);
        const v = cur ? cur.visitDate : d.visitDate;
        if (visitVal) visitVal.innerHTML = v ? NK.esc(v) : '<span style="color:var(--text-3)">未填写</span>';
        if (visitEditBtn) visitEditBtn.textContent = v ? '修改' : '补充上门日期';
      };
      if (visitEditBtn) visitEditBtn.onclick = () => { if (visitBox) visitBox.style.display = 'flex'; };
      if (visitInput && root.querySelector('#ddVisitSave')) {
        root.querySelector('#ddVisitSave').onclick = () => {
          const v = visitInput.value;
          if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { UI.toast('花姐，日期格式不正确', 'warn'); return; }
          NK.setVisitDate(d.id, v);
          refreshVisitVal();
          if (visitBox) visitBox.style.display = 'none';
          UI.toast('花姐，上门日期已更新 ✨', 'ok');
          UI.renderDispatch();
          UI.renderHome && UI.renderHome();
        };
      }
      if (visitInput && root.querySelector('#ddVisitClear')) {
        root.querySelector('#ddVisitClear').onclick = () => {
          NK.setVisitDate(d.id, '');
          refreshVisitVal();
          if (visitBox) visitBox.style.display = 'none';
          UI.toast('花姐，已设为「未填写」', 'ok');
          UI.renderDispatch();
        };
      }
      if (root.querySelector('#ddVisitCancel')) {
        root.querySelector('#ddVisitCancel').onclick = () => { if (visitBox) visitBox.style.display = 'none'; };
      }

      // 供应商补充/修改
      const supEditBtn = root.querySelector('#ddSupEdit');
      const supBox = root.querySelector('#ddSupEditBox');
      const supVal = root.querySelector('#ddSupVal');
      let supPick = '';
      const supBtns2 = root.querySelectorAll('#ddSupEditBox .dp-sup-btn');
      const applySup2 = () => supBtns2.forEach(b => b.classList.toggle('dp-sup-active', !!supPick && b.dataset.sup === supPick));
      supBtns2.forEach(b => { b.onclick = () => { supPick = b.dataset.sup; applySup2(); }; });
      const refreshSupVal = () => {
        const cur = NK.getDispatch(d.id);
        const curSup = cur ? NK.dispatchSupplierLabel(cur) : sup;
        if (supVal) supVal.innerHTML = curSup === '未标注' ? '<span style="color:var(--text-3)">未标注</span>' : NK.esc(curSup);
        if (supEditBtn) supEditBtn.textContent = curSup === '未标注' ? '补充' : '修改';
      };
      if (supEditBtn) supEditBtn.onclick = () => { if (supBox) { supBox.style.display = 'block'; supPick = ''; applySup2(); } };
      if (root.querySelector('#ddSupCancel')) {
        root.querySelector('#ddSupCancel').onclick = () => { if (supBox) supBox.style.display = 'none'; };
      }
      if (root.querySelector('#ddSupSave')) {
        root.querySelector('#ddSupSave').onclick = () => {
          if (!supPick) { UI.toast('请选择供应商（源晨或亚北）', 'warn'); return; }
          const curSup = NK.dispatchSupplierLabel(NK.getDispatch(d.id) || d);
          const ns = NK.normSupplier(supPick);
          if (!ns) return;
          const doSave = () => {
            NK.setSupplier(d.id, ns.id);
            refreshSupVal();
            if (supBox) supBox.style.display = 'none';
            UI.toast('花姐，供应商已更新 ✨', 'ok');
            UI.renderDispatch();
          };
          if (curSup !== '未标注' && curSup !== ns.name) {
            UI.confirm(`确定将供应商从“${curSup}”修改为“${ns.name}”吗？`, doSave, '确认修改');
          } else {
            doSave();
          }
        };
      }
    },
  });
};

/** 标记已发送（轻量确认） */
UI.dispatchMarkSent = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const sup = NK.dispatchSupplierLabel(d);
  UI.confirm(
    `确认已将该派单发送给${sup === '未标注' ? '供应商' : sup}吗？\n\n供应商：${sup}\n职场：${NK.v.siteName(d.siteName) || d.city || '—'}\n上门日期：${d.visitDate || '未填写'}\n事项：${d.title || '—'}`,
    () => {
      const r = NK.markDispatchSent(id);
      if (r && r.ok) {
        UI.toast(r.msg || '已标记已发送', 'ok');
        UI.modalClose();
        UI.renderHome && UI.renderHome();
        UI.refreshBadges && UI.refreshBadges();
        UI.renderDispatch && UI.renderDispatch();
      } else {
        UI.toast(r && r.msg ? r.msg : '无法标记已发送，请先完善派单信息', 'warn');
      }
    },
    '确认已发送'
  );
};

/** 标记完成（简洁确认） */
UI.dispatchMarkCompleted = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const body = `
    <p>确认这条派单 <b>${d.no}</b>「${NK.esc(d.title)}」已经正常完成吗？</p>
    <div class="form-item" style="margin-top:10px"><label>完成说明（可选）</label><textarea id="mcNote" placeholder="如：供应商已上门处理完毕"></textarea></div>`;
  UI.modal('标记完成', body, `<button class="btn" data-close>取消</button><button class="btn btn-success" id="mcOk">确认完成</button>`, {
    onMount(root) {
      root.querySelector('#mcOk').onclick = () => {
        const note = root.querySelector('#mcNote').value.trim();
        const r = NK.markDispatchCompleted(id, note);
        UI.toast(r && r.ok ? '花姐，这条派单已经完成，顺利收尾。✅' : (r && r.msg || '操作失败'), r && r.ok ? 'ok' : 'warn');
        UI.modalClose();
        UI.renderHome && UI.renderHome();
        UI.refreshBadges && UI.refreshBadges();
        UI.renderDispatch && UI.renderDispatch();
      };
    },
  });
};

/** 记录异常（保存后改异常待处理） */
UI.dispatchRecordException = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const types = ['供应商暂时无法安排', '上门日期需要调整', '用户取消上门', '现场问题未解决', '需要更换供应商', '联系人暂时无法配合', '其他'];
  const body = `
    <p style="margin-bottom:8px;font-size:12px;color:var(--text-2)">该派单存在异常，请确认新的处理安排。</p>
    <div class="form-item"><label>异常类型</label>
      <div class="qs-grid">${types.map((t2, i) => `<button type="button" class="qs-btn" data-et="${t2}" ${i === 0 ? 'style="border-color:var(--accent,#6a5ae0);background:rgba(106,90,224,.08)"' : ''}>${t2}</button>`).join('')}</div></div>
    <div class="form-item" style="margin-top:10px"><label>异常说明</label><textarea id="exNote" placeholder="如：源晨说本周排不出人，需要改到下周三"></textarea></div>
    <div class="form-item" style="margin-top:10px"><label>后续安排（可选）</label><input id="exNext" placeholder="如：改期下周三上门"></div>`;
  UI.modal('记录异常', body, `<button class="btn" data-close>取消</button><button class="btn btn-warn" id="exOk">保存并标记异常</button>`, {
    editable: true,
    onMount(root) {
      let et = types[0];
      root.querySelectorAll('.qs-btn[data-et]').forEach(b => {
        b.onclick = () => { root.querySelectorAll('.qs-btn[data-et]').forEach(x => x.style.cssText = ''); et = b.dataset.et; b.style.cssText = 'border-color:var(--accent,#6a5ae0);background:rgba(106,90,224,.08)'; };
      });
      root.querySelector('#exOk').onclick = () => {
        const note = root.querySelector('#exNote').value.trim();
        const next = root.querySelector('#exNext').value.trim();
        const r = NK.recordDispatchException(id, { type: et, note, next });
        UI.toast(r && r.ok ? '该派单存在异常，已标记为待处理，请确认新的处理安排。' : (r && r.msg || '操作失败'), r && r.ok ? 'warn' : 'warn');
        UI.modalClose();
        UI.renderHome && UI.renderHome();
        UI.refreshBadges && UI.refreshBadges();
        UI.renderDispatch && UI.renderDispatch();
      };
    },
  });
};

/** 处理异常：resolve恢复已发送 / done完成 / revoke撤销 */
UI.dispatchResolveException = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const body = `
    <p>派单 <b>${d.no}</b>「${NK.esc(d.title)}」当前为异常待处理。</p>
    <p style="margin-top:6px;font-size:12px;color:var(--text-2)">异常类型：${NK.esc(d.exceptionType || '—')}<br>异常说明：${NK.esc(d.exceptionNote || '—')}</p>
    <div class="form-item" style="margin-top:10px"><label>选择处理结果</label>
      <select id="rsType"><option value="resolve">已恢复正常，继续已发送</option><option value="done">问题已解决，标记完成</option><option value="revoke">取消执行，标记撤销</option></select></div>
    <div class="form-item" style="margin-top:10px"><label>处理说明（可选）</label><textarea id="rsNote" placeholder="如：供应商重新排期，已恢复"></textarea></div>`;
  UI.modal('处理异常', body, `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="rsOk">确认</button>`, {
    onMount(root) {
      root.querySelector('#rsOk').onclick = () => {
        const result = root.querySelector('#rsType').value;
        const note = root.querySelector('#rsNote').value.trim();
        const r = NK.resolveDispatchException(id, result, note);
        if (r && r.ok) {
          UI.toast(r.msg, 'ok');
          UI.modalClose();
          UI.renderHome && UI.renderHome();
          UI.refreshBadges && UI.refreshBadges();
          UI.renderDispatch && UI.renderDispatch();
        } else {
          UI.toast(r && r.msg || '操作失败', 'warn');
        }
      };
    },
  });
};

/** 重新打开已完成派单（二次确认） */
UI.dispatchReopen = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  UI.confirm('确定重新打开这条已完成派单吗？', () => {
    const r = NK.reopenDispatch(id);
    UI.toast(r && r.ok ? r.msg : (r && r.msg || '操作失败'), r && r.ok ? 'ok' : 'warn');
    UI.modalClose();
    UI.renderHome && UI.renderHome();
    UI.refreshBadges && UI.refreshBadges();
    UI.renderDispatch && UI.renderDispatch();
  }, '重新打开');
};

/** 记录进展（极简：状态+可选备注） */
/** 记录供应商反馈（可选，字段全部可选；保存后仍保持已发送） */
UI.dispatchFeedback = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const body = `
    <p style="margin-bottom:8px;font-size:12px;color:var(--text-2)">记录供应商反馈（可选填写，用于后续参考）：</p>
    <div class="form-item"><label>反馈内容</label><textarea id="fbContent" rows="3" placeholder="如：源晨已确认，周三上午9点上门"></textarea></div>
    <div class="form-item" style="margin-top:10px"><label>上门人员姓名（可选）</label><input id="fbPerson" placeholder="如：张师傅"></div>
    <div class="form-item" style="margin-top:10px"><label>联系电话（可选）</label><input id="fbPhone" placeholder="如：13800000000"></div>
    <div class="form-item" style="margin-top:10px"><label>预计上门日期变更（可选）</label><input id="fbVisit" type="date" class="dp-input dp-date-input" value="${d.visitDate || ''}"></div>
    <div class="form-item" style="margin-top:10px"><label>反馈时间</label><span id="fbTime" style="font-size:12px;color:var(--text-3)">${NK.fmtDT(new Date())}</span></div>`;
  UI.modal('记录供应商反馈', body, `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="fbOk">保存</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#fbOk').onclick = () => {
        const content = root.querySelector('#fbContent').value.trim();
        const person = root.querySelector('#fbPerson').value.trim();
        const phone = root.querySelector('#fbPhone').value.trim();
        const visit = root.querySelector('#fbVisit').value;
        const data = {};
        if (content) data.content = content;
        if (person) data.person = person;
        if (phone) data.phone = phone;
        if (visit && visit !== d.visitDate) data.changedVisitDate = visit;
        const r = NK.recordSupplierFeedback(id, data);
        UI.toast(r && r.ok ? '花姐，已记录供应商反馈。' : (r && r.msg || '操作失败'), r && r.ok ? 'ok' : 'warn');
        UI.modalClose();
        UI.renderHome && UI.renderHome();
        UI.refreshBadges && UI.refreshBadges();
        UI.renderDispatch && UI.renderDispatch();
      };
    },
  });
};

/** 催办 */
UI.dispatchUrgent = (id) => {
  const d = NK.getDispatch(id);
  const msg = NK.urgent(d);
  UI.modal('一键催办', `
    <p style="margin-bottom:8px">将向 <b>${NK.esc(NK.v.engName(d.engineer))}</b> 发送以下催办消息（第 ${d.urgentCount || 1} 次）：</p>
    <div class="msg-preview">${NK.esc(msg)}</div>
    <p style="margin-top:8px;font-size:11px;color:var(--text-3)">复制后发到微信或 Teams，花姐发出去后我会记住这次催办时间。</p>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-warn" id="urOk">复制并记录</button>`, {
    onMount(root) {
      // [close] 已由统一弹窗机制绑定
      root.querySelector('#urOk').onclick = async () => {
        await UI.copy(msg);
        NK.save();
        UI.toast('花姐，催办内容已复制，发出去后我会记住这次催办时间');
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
      };
    },
  });
};

/* ============================================================
   派单撤销 / 删除 / 回收站 / 恢复
   ============================================================ */

/** 撤销派单：展示摘要 + 撤销原因快捷选项 + 关联任务/休假补位提示 */
UI.dispatchRevoke = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  const disp = NK.v.dispatch(d);
  const t = NK.getTask(d.taskId);
  const leave = NK.db.leaves.find(l => l.relatedDispatchId === d.id);
  const REASONS = ['用户取消上门', '已远程解决', '需求取消', '重复派单', '计划调整', '其他'];
  const hasTask = !!t && t.status !== '已取消';
  const body = `
    <p style="font-weight:600;margin-bottom:10px">确定撤销这条派单吗？</p>
    <div class="detail-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="dg-item"><span class="dg-label">派单编号</span><span class="dg-val">${d.no}</span></div>
      <div class="dg-item"><span class="dg-label">事项名称</span><span class="dg-val">${NK.esc(disp.title)}</span></div>
      <div class="dg-item"><span class="dg-label">职场</span><span class="dg-val">${NK.esc(disp.siteName || d.city || '—')}</span></div>
      <div class="dg-item"><span class="dg-label">当前工程师</span><span class="dg-val">${NK.esc(disp.engineer || '—')}</span></div>
    </div>
    <div class="form-item"><label>撤销原因</label>
      <div class="qs-grid" style="grid-template-columns:repeat(3,1fr);gap:6px">${REASONS.map(r => `<button class="qs-btn" data-reason="${r}">${r}</button>`).join('')}</div>
      <input id="rvReason" placeholder="补充说明（可选）" style="margin-top:8px;width:100%;box-sizing:border-box" >
    </div>
    ${hasTask ? `<div style="margin-top:12px;padding:10px;background:var(--bg-warn,rgba(255,200,0,.08));border-radius:8px;font-size:12px">
      <div style="margin-bottom:6px">该派单关联了一条任务（${t.no} ${NK.esc(t.name)}），是否同时取消关联任务？</div>
      <label style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="rvCancelTask" checked> <b>同时取消关联任务（推荐）</b></label>
      <div style="color:var(--text-3);font-size:11px;margin-top:4px">若任务还有其他用途，可取消勾选，只撤销派单保留任务。</div>
    </div>` : ''}
    ${leave ? `<div style="margin-top:12px;padding:10px;background:var(--bg-warn,rgba(255,200,0,.08));border-radius:8px;font-size:12px">
      ⚠️ 该派单关联工程师休假补位。撤销后，休假记录将重新显示为"补位待安排"。
    </div>` : ''}
    <p style="margin-top:12px;font-size:11px;color:var(--text-3)">撤销后不会删除派单记录，但该派单将停止催办、超时提醒和后续跟进。</p>`;
  UI.modal('撤销派单', body, `<button class="btn" data-close>返回</button><button class="btn btn-warn" id="rvOk">确认撤销</button>`, {
    onMount(root) {
      // [close] 已由统一弹窗机制绑定
      let picked = '';
      root.querySelectorAll('[data-reason]').forEach(b => {
        b.onclick = () => {
          root.querySelectorAll('[data-reason]').forEach(x => x.classList.remove('qs-active'));
          b.classList.add('qs-active');
          picked = b.getAttribute('data-reason');
        };
      });
      root.querySelector('#rvOk').onclick = () => {
        const reason = picked || (root.querySelector('#rvReason').value.trim() || '其他');
        const cancelTask = hasTask ? !!root.querySelector('#rvCancelTask').checked : false;
        const res = NK.revokeDispatch(d.id, { reason, cancelTask });
        if (!res.ok) { UI.toast(res.msg, 'err'); return; }
        if (res.leaveLinked) UI.toast('花姐，补位派单已撤销，休假记录已经重新标记为"补位待安排"。');
        else UI.toast(res.msg);
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
        UI.renderDispatch();
      };
    },
  });
};

/** 删除记录：已处理派单引导撤销；允许删除的走确认 */
UI.dispatchDelete = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  // 纯状态判断是否已产生处理记录（只引导，不真正删除，避免取消时误删）
  const processed = ['sent', 'exception', 'completed'];
  if (processed.includes(NK.dispatchStatusKey(d))) {
    // 已产生处理记录 → 引导撤销
    UI.modal('删除记录', `
      <p style="font-weight:600">这条派单已经产生处理记录</p>
      <p style="margin-top:8px;font-size:13px;color:var(--text-2)">该派单已经产生处理记录，建议使用"撤销派单"保留过程留痕。</p>
      <p style="margin-top:8px;font-size:12px;color:var(--text-3)">撤销会保留派单的创建、发送、跟进等历史记录，适合"业务取消"场景；错误且未发送的记录才建议删除进回收站。</p>`,
      `<button class="btn" data-close>返回</button><button class="btn btn-warn" id="blToRevoke">改为撤销派单</button>`, {
      onMount(root) {
        root.querySelector('#blToRevoke').onclick = () => {
          UI.modalClose();
          UI.dispatchRevoke(d.id);
        };
      },
    });
    return;
  }
  const disp = NK.v.dispatch(d);
  const body = `
    <p style="font-weight:600;margin-bottom:10px">确定删除这条错误派单吗？</p>
    <div class="detail-grid" style="grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="dg-item"><span class="dg-label">派单编号</span><span class="dg-val">${d.no}</span></div>
      <div class="dg-item"><span class="dg-label">事项</span><span class="dg-val">${NK.esc(disp.title)}</span></div>
      <div class="dg-item"><span class="dg-label">职场</span><span class="dg-val">${NK.esc(disp.siteName || d.city || '—')}</span></div>
    </div>
    <div class="form-item"><label>删除原因</label>
      <div class="qs-grid" style="grid-template-columns:repeat(3,1fr);gap:6px">${['录入错误', '重复创建', '测试数据', '其他'].map(r => `<button class="qs-btn" data-delreason="${r}">${r}</button>`).join('')}</div>
      <input id="delReason" placeholder="补充说明（可选）" style="margin-top:8px;width:100%;box-sizing:border-box">
    </div>
    <p style="margin-top:12px;font-size:11px;color:var(--text-3)">删除后将从正常派单列表中移除，但会暂时保留在回收站中，可随时恢复。</p>`;
  UI.modal('删除记录', body, `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="delOk">删除记录</button>`, {
    onMount(root) {
      let picked = '';
      root.querySelectorAll('[data-delreason]').forEach(b => {
        b.onclick = () => {
          root.querySelectorAll('[data-delreason]').forEach(x => x.classList.remove('qs-active'));
          b.classList.add('qs-active');
          picked = b.getAttribute('data-delreason');
        };
      });
      root.querySelector('#delOk').onclick = () => {
        const reason = picked || (root.querySelector('#delReason').value.trim() || '录入错误');
        const r2 = NK.softDeleteDispatch(d.id, { reason });
        if (!r2.ok) { UI.toast(r2.msg, 'err'); return; }
        UI.toast(r2.msg);
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
        UI.renderDispatch();
      };
    },
  });
};

/** 恢复已删除派单（回收站 → 正常列表） */
UI.dispatchRestore = (id) => {
  const res = NK.restoreDispatch(id);
  if (!res.ok) { UI.toast(res.msg, 'err'); return; }
  UI.toast(res.msg);
  UI.renderHome();
  UI.refreshBadges();
  UI.renderDispatch();
};

/** 永久删除（回收站内，二次确认） */
UI.dispatchPurge = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  UI.confirm(`永久删除后无法恢复，是否继续？\n（${d.no} ${d.title} 将从系统彻底移除，仅保留此提示）`, () => {
    NK.purgeDispatch(id);
    UI.toast('花姐，这条记录已永久删除。');
    UI.renderHome();
    UI.refreshBadges();
    UI.renderDispatch();
  }, '永久删除', { danger: true });
};

/** 恢复已撤销派单（重新进入待跟进） */
UI.dispatchUnrevoke = (id) => {
  const d = NK.getDispatch(id);
  if (!d) return;
  UI.confirm(`恢复后该派单将重新进入待跟进流程。\n（${d.no} ${d.title}）确认恢复吗？`, () => {
    const res = NK.unrevokeDispatch(id);
    if (!res.ok) { UI.toast(res.msg, 'err'); return; }
    UI.toast(res.msg);
    UI.renderHome();
    UI.refreshBadges();
    UI.renderDispatch();
  }, '恢复派单');
};

/** 验收入口（从首页/列表） */UI.acceptOpen = (id) => {
  const d = NK.getDispatch(id);
  if (d) { UI.dispatchDetail(id); return; }
  const t = NK.getTask(id);
  if (t) UI.taskDetail(id);
};

/* ============================================================
   全局搜索
   ============================================================ */
UI.bindSearch = () => {
  const input = document.getElementById('globalSearchInput');
  const dd = document.getElementById('searchDropdown');
  const render = () => {
    const q = input.value.trim();
    if (!q) { dd.classList.add('hidden'); return; }
    const r = NK.search(q);
    if (!r || (!r.sites.length && !r.engineers.length && !r.contacts.length && !r.dispatches.length && !r.tasks.length)) {
      dd.innerHTML = `<div class="sd-empty">未找到与「${NK.esc(q)}」相关的结果</div>`;
      dd.classList.remove('hidden');
      return;
    }
    let html = '';
    if (r.sites.length) {
      html += `<div class="sd-group"><div class="sd-title">职场（${r.sites.length}）</div>`;
      r.sites.slice(0, 6).forEach(s => {
        const v = NK.v.site(s);
        html += `<div class="sd-item" onclick="UI.searchGo('site','${s.id}')">
          <div class="sd-main"><div class="sd-name">${NK.esc(v.name)} ${UI.statusBadge(s.status !== '正常' ? s.status : '')}</div>
          <div class="sd-sub">${NK.esc(v.city)} · ${NK.esc(v.address)}</div></div>
          <button class="btn btn-sm btn-accent" onclick="event.stopPropagation();UI.dispatchCreate('${s.id}')">派单</button>
        </div>`;
      });
      html += `</div>`;
    }
    if (r.engineers.length) {
      html += `<div class="sd-group"><div class="sd-title">工程师（${r.engineers.length}）</div>`;
      r.engineers.slice(0, 5).forEach(e => {
        const v = NK.v.eng(e);
        html += `<div class="sd-item" onclick="UI.searchGo('eng','${e.id}')">
          <div class="sd-main"><div class="sd-name">${NK.esc(v.name)} <span class="badge gray">${NK.esc(v.phone)}</span></div>
          <div class="sd-sub">驻场：${NK.esc(e.onsiteRegions.join('/') || '—')} ｜ 远程：${NK.esc(e.remoteRegions.join('/') || '—')}</div></div>
        </div>`;
      });
      html += `</div>`;
    }
    if (r.contacts.length) {
      html += `<div class="sd-group"><div class="sd-title">联系人（${r.contacts.length}）</div>`;
      r.contacts.slice(0, 5).forEach(s => {
        const v = NK.v.site(s);
        html += `<div class="sd-item" onclick="UI.searchGo('site','${s.id}')">
          <div class="sd-main"><div class="sd-name">${NK.esc(v.contactName)} <span class="num">${NK.esc(v.contactPhone)}</span></div>
          <div class="sd-sub">${NK.esc(v.name)}</div></div></div>`;
      });
      html += `</div>`;
    }
    if (r.dispatches.length) {
      html += `<div class="sd-group"><div class="sd-title">派单（${r.dispatches.length}）</div>`;
      r.dispatches.slice(0, 5).forEach(d => {
        html += `<div class="sd-item" onclick="UI.searchGo('disp','${d.id}')">
          <div class="sd-main"><div class="sd-name">${NK.esc(d.no)} ${NK.esc(d.title)}</div>
          <div class="sd-sub">${NK.esc(NK.v.siteName(d.siteName))} · ${UI.statusBadge(NK.dispatchStatusLabel(d))}</div></div></div>`;
      });
      html += `</div>`;
    }
    dd.innerHTML = html;
    dd.classList.remove('hidden');
  };
  input.addEventListener('input', () => setTimeout(render, 80));
  input.addEventListener('focus', render);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') render(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.global-search')) dd.classList.add('hidden');
  });
};
UI.searchGo = (type, id) => {
  document.getElementById('searchDropdown').classList.add('hidden');
  document.getElementById('globalSearchInput').value = '';
  if (type === 'site') UI.siteDetail(id);
  else if (type === 'eng') UI.engDetail(id);
  else if (type === 'disp') UI.dispatchDetail(id);
};

/* ================= 全局动作入口 ================= */
UI.act = (act, arg) => {
  const map = {
    dispatchDetail: UI.dispatchDetail,
    dispatchUrgent: UI.dispatchUrgent,
    taskDetail: UI.taskDetail,
    taskUrgent: UI.taskUrgent,
    acceptOpen: UI.acceptOpen,
    updateOpen: (id) => { const t = NK.getTask(id); if (t) UI.taskFeedback(id); else UI.dispatchFeedback(id); },
    projectDetail: UI.projectDetail,
  };
  if (map[act]) map[act](arg);
};

/* ============================================================
   任务与告警中心
   ============================================================ */
/** 固定任务辅助Emoji：只对少量有明确时间含义的任务使用，不替代状态图标 */
UI.fixedEmoji = (tplId) => ({ TPL003: '⏰', TPL004: '🌙', TPL005: '📧', TPL014: '📅' }[tplId] || '');
/** 实时告警类型Emoji：按提醒性质映射（展示层，不修改告警逻辑） */
UI.alertEmoji = (r) => {
  const t = r.title || '';
  if (r.level === 'danger' || /异常/.test(t)) return '🚨';
  if (/上门/.test(t)) return '📅';
  if (/到期|超时|截止|已过|不足24/.test(t)) return '⏰';
  return '👀';
};
/** 告警块背景基调：极淡色区分提醒性质，不统一橙色 */
UI.alertTone = (r) => {
  const t = r.title || '';
  if (r.level === 'danger' || /异常/.test(t)) return 'danger';
  if (/上门/.test(t)) return 'cal';
  if (/到期|超时|截止|已过|不足24/.test(t)) return 'clock';
  return 'eye';
};
/** 展示层拆分：正文 vs 关联编号/供应商/日期（不修改任何业务数据） */
UI.alertParts = (r) => {
  let s = r.content || '';
  const meta = [];
  const no = s.match(/[A-Z]{2,4}\d{6,8}-\d+/);
  if (no) { meta.push(no[0]); s = s.replace(no[0], ''); }
  const supB = s.match(/（([^（）]{1,14})）/);
  if (supB && !/^\d{4}-\d{2}-\d{2}$/.test(supB[1])) { meta.push(supB[1]); s = s.replace(supB[0], ''); }
  s = s.replace(/（\d{4}-\d{2}-\d{2}）/g, '');
  const supK = s.match(/供应商[:：]\s*([^，,。;；\s]+)/);
  if (supK) { meta.push(supK[1]); s = s.replace(supK[0], ''); }
  const d = s.match(/\d{4}-\d{2}-\d{2}/);
  if (d) { meta.push(d[0]); s = s.replace(d[0], ''); }
  if (/今日到期/.test(r.content || '')) meta.push('今日到期');
  s = s.replace(/今日到期/g, '');
  if (/上门/.test(r.title || '')) s = s.replace(/(今日|明日)\s*上门/g, '');
  s = s.replace(/截止\s*$/, '').replace(/[,，;；]\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return { body: s, meta: meta.join(' · ') };
};
UI.renderTasks = () => {
  const el = document.getElementById('view-tasks');
  const f = NK.taskFilter = NK.taskFilter || {};
  const today = NK.today();
  // 「全部」= 全部有效任务：默认只展示当前有效工作
  //   - 有效任务 = NK.taskActive(t)：排除 已取消/已删除，及关联派单已撤销/已删除的任务
  //   - 历史（已取消/已删除）通过下方来源筛选单独查看
  const showCancelled = f.source === '已取消';
  const showDeleted = f.source === '已删除';
  let list = [...NK.db.tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (showCancelled) {
    list = list.filter(t => NK.taskInactive(t) && (t.status === '已取消' || (NK.dispatchOfTask(t) && NK.dispatchInactive(NK.dispatchOfTask(t)) && NK.dispatchStatusKey(NK.dispatchOfTask(t)) === 'revoked')));
  } else if (showDeleted) {
    list = list.filter(t => t.recordStatus === '已删除');
  } else {
    list = list.filter(t => NK.taskActive(t));
  }
  if (f.status && f.status !== '全部') list = list.filter(t => t.status === f.status);
  if (f.type && f.type !== '全部') list = list.filter(t => t.type === f.type);
  if (f.source && f.source !== '全部' && !showCancelled && !showDeleted) {
    if (f.source === '已完成') list = list.filter(t => t.status === '已完成');
    else list = list.filter(t => NK.taskSourceKey(t) === f.source);
  }
  if (f.q) list = list.filter(t => `${t.no} ${t.name} ${t.siteName} ${t.engineer}`.includes(f.q));
  if (f.overdue) list = list.filter(t => t.dueDate && t.dueDate < today && t.status !== '已完成');

  // 告警清单
  const rem = NK.genReminders();
  const danger = rem.filter(x => x.level === 'danger');
  const warn = rem.filter(x => x.level !== 'danger');

  // 今日固定任务（系统固定任务·每日类）进度
  const dailyTasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.source === '系统固定任务' &&
    ['每日', '每日14:30', '每日下班前'].includes(t.frequency) && t.fixedDate === today);
  const doneCount = dailyTasks.filter(x => x.status === '已完成').length;
  const dailyHTML = `<div class="card"><div class="card-head"><div class="card-title">今日固定任务（每日）</div>
    <span class="badge accent">${doneCount}/${dailyTasks.length} 完成</span></div>
    <div class="card-body flush tasks-ov tasks-ov-fixed">${dailyTasks.length ? dailyTasks.map(t => {
      const tpl = NK.FIXED_TASKS.find(x => x.id === t.templateId);
      const done = t.status === '已完成';
      const emoji = UI.fixedEmoji(t.templateId);
      return `<div class="focus-item fx-daily${done ? ' fx-done' : ''}">
        <span class="fx-status">${done ? '✓' : ''}</span>
        <div class="fi-main">
          <div class="fi-title">${emoji ? `<span class="fx-emoji">${emoji}</span>` : ''}${NK.esc(t.name)} ${UI.priBadge(t.priority)}</div>
          <div class="fi-meta">${NK.esc((tpl ? tpl.requirement : t.nextAction || '').replace(/[。.]$/, ''))} · ${NK.esc(t.frequency || '')}</div>
        </div>
        <div class="fi-actions">${done ? `<span class="fx-done-label">已完成</span>` : `<button class="btn btn-sm btn-accent" onclick="UI.taskDone('${t.id}')">标为完成</button>`}</div>
      </div>`;
    }).join('') + (dailyTasks.length && doneCount === dailyTasks.length ? `<div class="fx-all-done">今天的固定任务都完成了，节奏挺稳。✅</div>` : '') : '<div class="fx-empty">✨ 今日暂无固定任务</div>'}</div></div>`;

  const alertHTML = `<div class="card"><div class="card-head"><div class="card-title">实时告警</div><span class="badge ${danger.length ? 'risk' : 'done'}">${danger.length} 危险 / ${warn.length} 提醒</span>
      <span class="al-head-actions">
        <button class="btn btn-sm btn-ghost al-clear-btn${rem.length ? '' : ' is-disabled'}"${rem.length ? '' : ' disabled title="当前没有需要清空的告警"'} onclick="UI.alertClearStart()">${UI.ICON_CLEAR}清空告警</button>
        <span class="al-more-wrap">
          <button class="btn btn-sm btn-ghost al-more-btn" onclick="UI.alertMoreToggle(event)">更多 ▾</button>
          <div class="al-more-menu hidden">
            <button class="al-more-item" onclick="UI.alertRecordsOpen()">清空记录</button>
            <button class="al-more-item" onclick="UI.alertCooldownOpen()">冷却时间设置</button>
          </div>
        </span>
      </span>
    </div>
    <div class="card-body flush tasks-ov tasks-ov-alert">${rem.length ? rem.map(r => {
      const p = UI.alertParts(r);
      return `<div class="al-item al-${UI.alertTone(r)}">
        <div class="al-main">
          <div class="al-head"><span class="al-emoji">${UI.alertEmoji(r)}</span>${NK.esc(r.title)}</div>
          <div class="al-body">${NK.esc(p.body)}</div>
          ${p.meta ? `<div class="al-meta">${NK.esc(p.meta)}</div>` : ''}
        </div>
        <div class="al-actions">${(r.actions || []).map(a => `<button class="btn btn-sm" onclick="UI.act('${a.act === 'dispatch' ? 'dispatchDetail' : a.act === 'task' ? 'taskDetail' : 'projectDetail'}','${a.arg}')">${a.label}</button>`).join('')}</div>
      </div>`;
    }).join('') : '<div class="fx-empty">✨ 当前没有需要处理的告警，盘面很干净。</div>'}</div></div>`;

  const statusOpts = ['全部', ...NK.TASK_STATUS];
  const typeOpts = ['全部', ...NK.TASK_TYPES];
  const srcOpts = ['全部', '系统固定任务', '花姐手动新增', '安全告警', '派单自动关联', '专项任务', '已完成', '已取消', '已删除'];
  el.innerHTML = UI.pageHead('任务与告警', '任务闭环 · 告警驱动 · 固定任务每日/月度自动生成',
    `<button class="btn btn-accent" onclick="UI.taskCreate()">✚ 新建任务</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" id="tkQ" placeholder="搜索编号/名称/职场/工程师…" value="${NK.esc(f.q || '')}">
      <select class="fb-select" id="tkStatus">${statusOpts.map(s => `<option ${(f.status || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="tkType">${typeOpts.map(s => `<option ${(f.type || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="tkSource">${srcOpts.map(s => `<option ${(f.source || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="tkOverdue" ${f.overdue ? 'checked' : ''}>只看超时</label>
      <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">共 ${list.length} 条</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">${dailyHTML}${alertHTML}</div>
    <div class="card"><div class="card-head"><div class="card-title">${showCancelled ? '已取消任务' : showDeleted ? '已删除任务' : '全部任务（有效）'}</div></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>编号</th><th>任务</th><th>类型</th><th>优先级</th><th>职场</th><th>工程师</th><th>状态</th><th>截止</th><th>最后更新</th><th>操作</th></tr></thead>
      <tbody>${list.length ? list.map(t => {
        const v = NK.v.task(t);
        const isOv = t.dueDate && t.dueDate < today && t.status !== '已完成';
        // 历史记录（已取消/已删除）以灰色 + 删除线展示
        const hist = (showCancelled || showDeleted) && (t.status === '已取消' || t.recordStatus === '已删除');
        const nameStyle = hist ? 'text-decoration:line-through;color:var(--text-3)' : '';
        return `<tr${hist ? ' style="opacity:.7"' : ''}>
          <td class="num">${t.no}</td>
          <td style="max-width:220px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${nameStyle}">${NK.esc(t.name)}</div>
            <div style="color:var(--text-3);font-size:11px">${NK.esc(NK.taskSourceLabel(t))}${t.cancelReason ? ' · 取消原因：' + NK.esc(t.cancelReason) : ''}${t.deleteReason ? ' · ' + NK.esc(t.deleteReason) : ''}</div></td>
          <td><span class="tag">${NK.esc(t.type)}</span></td>
          <td>${UI.priBadge(t.priority)}</td>
          <td>${NK.esc(v.siteName || '—')}</td>
          <td>${NK.esc(v.engineer || '—')}</td>
          <td>${UI.statusBadge(t.status)}${isOv ? `<div style="font-size:10px;color:var(--warn)">已超时</div>` : ''}</td>
          <td>${t.dueDate ? t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') : '—'}</td>
          <td>${(t.updatedAt || t.createdAt).slice(0, 16).replace('T', ' ')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="UI.taskDetail('${t.id}')">详情</button>
            ${(showCancelled && t.status === '已取消' && NK.dispatchOfTask(t) && !NK.dispatchInactive(NK.dispatchOfTask(t))) ? `<button class="btn btn-sm btn-accent" onclick="UI.taskReactivate('${t.id}')">恢复</button>` : ''}
            ${t.status !== '已完成' && !hist ? `<button class="btn btn-sm btn-accent" onclick="UI.taskFeedback('${t.id}')">更新</button>` : ''}
            ${t.status !== '已完成' && !hist ? `<button class="btn btn-sm" onclick="UI.taskUrgent('${t.id}')">催办</button>` : ''}
          </td>
        </tr>`;
      }).join('') : UI.empty('暂无任务，点击右上角「新建任务」或通过派单自动生成', 10)}</tbody>
    </table></div></div>`;

  const bind = () => {
    const onFilter = () => {
      NK.taskFilter = {
        q: document.getElementById('tkQ').value,
        status: document.getElementById('tkStatus').value,
        type: document.getElementById('tkType').value,
        source: document.getElementById('tkSource').value,
        overdue: document.getElementById('tkOverdue').checked,
      };
      UI.renderTasks();
    };
    document.getElementById('tkQ').addEventListener('input', NK.debounce(onFilter, 300));
    document.getElementById('tkStatus').onchange = onFilter;
    document.getElementById('tkType').onchange = onFilter;
    document.getElementById('tkSource').onchange = onFilter;
    document.getElementById('tkOverdue').onchange = onFilter;
  };
  setTimeout(bind, 0);
};

/* ============================================================
   实时告警 · 一键清空 & 清空记录
   清空的是当前告警提示，不是删除工作记录。
   ============================================================ */
/** 「更多」下拉切换 */
UI.alertMoreToggle = (ev) => {
  ev.stopPropagation();
  const wrap = ev.currentTarget.closest('.al-more-wrap');
  const menu = wrap.querySelector('.al-more-menu');
  const wasHidden = menu.classList.contains('hidden');
  // 关闭其它已打开的下拉
  document.querySelectorAll('.al-more-menu').forEach(m => m.classList.add('hidden'));
  menu.classList.toggle('hidden', !wasHidden);
};
/** 点击其它区域关闭下拉 */
UI.alertMoreCloseAll = () => {
  document.querySelectorAll('.al-more-menu').forEach(m => m.classList.add('hidden'));
};

/** 打开「清空告警」二次确认弹窗 */
UI.alertClearStart = () => {
  const list = NK.alerts();
  if (!list.length) { UI.toast('花姐，当前没有需要清空的告警 ✨', 'ok'); return; }
  const danger = list.filter(r => r.level === 'danger').length;
  const warn = list.length - danger;

  const body = `
    <div class="al-confirm">
      <div class="al-confirm-t">确定清空当前 <b>${list.length}</b> 条告警吗？</div>
      <div class="al-confirm-sub">本操作只清除当前告警提示，不会删除任务、派单、专项或KPI数据。尚未解决的问题如果再次满足告警条件，之后仍会重新出现。</div>
      <div class="al-confirm-count"><span class="badge risk">${danger} 危险</span><span class="badge wait">${warn} 提醒</span></div>
    </div>`;
  UI.modal('清空实时告警', body,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="alClearOk">确认清空</button>`, {
      size: 'modal-sm',
      onMount(root) {
        // [close] 已由统一弹窗机制绑定
        root.querySelector('#alClearOk').onclick = () => UI.alertClearDo('all');
      },
    });
};

/** 执行清空（scope: all | warn） */
UI.alertClearDo = (scope) => {
  const res = NK.clearAlerts(scope);
  UI.modalClose();
  UI.alertMoreCloseAll();
  const total = res.cleared.length;
  // 反馈文案（人性化，非冷冰冰的「操作成功」）
  if (res.keptDanger > 0) {
    UI.toast(`已清空 ${total} 条告警，另有 ${res.keptDanger} 条严重风险仍需保留。`, 'warn');
  } else {
    UI.toast('花姐，当前告警已经清空，今天的面板干净了。✨', 'ok');
  }
  UI.renderTasks();
  UI.refreshBadges();
};

/** 打开「清空记录」抽屉 */
UI.alertRecordsOpen = () => {
  UI.alertMoreCloseAll();
  const records = NK.alertRecords();
  const body = records.length
    ? records.map(rec => {
        const t = (rec.clearedAt || '').slice(0, 16).replace('T', ' ');
        return `<div class="al-rec">
          <div class="al-rec-head">
            <span class="al-rec-time">${NK.esc(t)}</span>
            <span class="badge ${rec.keptDanger ? 'wait' : 'done'}">${rec.scope === 'warn' ? '仅提醒' : '全部'}</span>
          </div>
          <div class="al-rec-line">${NK.esc(rec.clearedBy)}清空 <b>${rec.total}</b> 条告警：${rec.danger}条危险、${rec.warn}条提醒。${rec.keptDanger ? `另有 ${rec.keptDanger} 条严重风险保留。` : ''}</div>
          <div class="al-rec-tags">${(rec.alerts || []).slice(0, 4).map(a => `<span class="al-rec-tag ${a.level === 'danger' ? 't-danger' : 't-warn'}">${NK.esc(a.reason)}</span>`).join('')}${(rec.alerts || []).length > 4 ? `<span class="al-rec-tag gray">+${rec.alerts.length - 4}</span>` : ''}</div>
        </div>`;
      }).join('')
    : `<div class="tbl-empty" style="padding:24px">暂无清空记录。清空告警后，这里会保留每次清空的留痕。</div>`;
  UI.modal('清空记录', `<div class="al-records">${body}</div>`,
    `<button class="btn" data-close>关闭</button>`, { size: 'modal' });
};

/** 打开「冷却时间设置」弹窗 */
UI.alertCooldownOpen = () => {
  UI.alertMoreCloseAll();
  const state = NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  const val = state.cooldownHours || 2;
  const body = `
    <div class="form-grid">
      <div class="form-item">
        <label>告警重新触发的冷却时间（小时）</label>
        <input id="alCool" type="number" min="0" max="168" step="1" value="${val}">
      </div>
    </div>
    <div class="hint" style="margin-top:10px">同一事项、同一原因在清空后，冷却时间内不会立即重复告警；冷却期结束或出现新的状态变化后再重新判断。设置 0 表示无冷却。</div>`;
  UI.modal('告警冷却时间', body,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="alCoolOk">保存</button>`, {
      size: 'modal-sm',
      onMount(root) {
        // [close] 已由统一弹窗机制绑定
        root.querySelector('#alCoolOk').onclick = () => {
          const v = Math.max(0, Math.min(168, parseInt(document.getElementById('alCool').value || '2', 10) || 0));
          state.cooldownHours = v;
          NK.save();
          UI.modalClose();
          UI.toast('花姐，告警冷却时间已更新 ✓');
        };
      },
    });
};

/** 从系统设置页保存冷却时间 */
UI.alertCooldownSave = () => {
  const el = document.getElementById('setAlCool');
  if (!el) return;
  const state = NK.db.alertState = NK.db.alertState || { cooldownHours: 2, cleared: {}, records: [] };
  const v = Math.max(0, Math.min(168, parseInt(el.value || '2', 10) || 0));
  state.cooldownHours = v;
  NK.save();
  UI.toast('花姐，告警冷却时间已更新 ✓');
  UI.renderSettings();
};

/** 新建任务（arg 为 true 时进入「更新进度」模式） */
UI.taskCreate = (updateMode) => {
  if (updateMode) { UI.taskPickUpdate(); return; }
  const engOpts = NK.db.engineers.map(e => `<option value="${NK.esc(e.name)}">${NK.esc(NK.v.engName(e.name))}${e.onsiteRegions.length ? '（驻场：' + NK.esc(e.onsiteRegions.join('/')) + '）' : ''}</option>`).join('');
  UI.modal('新建任务', `
    <div class="form-item"><label>任务名称 *</label><input id="tcName" placeholder="例如：机房温湿度巡检"></div>
    <div class="form-grid">
      <div class="form-item"><label>类型</label><select id="tcType">${NK.TASK_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
      <div class="form-item"><label>优先级</label><select id="tcPri"><option>P3</option><option>P2</option><option>P1</option></select></div>
    </div>
    <div class="form-item"><label>关联职场（可搜索城市/名称）</label><input id="tcSiteQ" placeholder="输入城市或职场名，如：湖州">
      <div id="tcSiteList" class="sd-list"></div></div>
    <div class="form-grid">
      <div class="form-item"><label>负责工程师</label><select id="tcEng"><option value="">未指派</option>${engOpts}</select></div>
      <div class="form-item"><label>截止日期</label><input id="tcDue" type="date" value="${NK.today()}"></div>
    </div>
    <div class="form-item"><label>处理要求 / 下一步</label><textarea id="tcNext" placeholder="任务要求、验收标准等"></textarea></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="tcOk">创建任务</button>`, {
    editable: true,
    onMount(root) {
      const siteQ = root.querySelector('#tcSiteQ');
      const siteList = root.querySelector('#tcSiteList');
      let picked = '';
      const renderSites = () => {
        const q = siteQ.value.trim();
        if (!q) { siteList.innerHTML = ''; return; }
        const hits = NK.search(q);
        const sites = (hits ? hits.sites : []).slice(0, 6);
        siteList.innerHTML = sites.length ? sites.map(s => `<div class="sd-item" data-id="${s.id}">
          <div class="sd-main"><div class="sd-name">${NK.esc(NK.v.siteName(s.name))}</div><div class="sd-sub">${NK.esc(s.city)} · ${NK.esc(NK.v.address(s.address))}</div></div></div>`).join('') : '';
        siteList.querySelectorAll('.sd-item').forEach(it => it.onclick = () => {
          picked = it.dataset.id;
          const s = NK.getSite(picked);
          siteQ.value = NK.v.siteName(s.name);
          siteList.innerHTML = `<div class="sd-item"><div class="sd-main"><div class="sd-name">已选：${NK.esc(NK.v.siteName(s.name))}</div><div class="sd-sub">${NK.esc(s.city)} · 默认工程师 ${NK.esc(NK.v.engName(s.defaultEngineer))}</div></div></div>`;
        });
      };
      siteQ.addEventListener('input', NK.debounce(renderSites, 200));
      root.querySelector('#tcOk').onclick = () => {
        const name = root.querySelector('#tcName').value.trim();
        if (!name) { UI.toast('请填写任务名称', 'warn'); return; }
        const site = picked ? NK.getSite(picked) : null;
        const t = NK.createTask({
          name, type: root.querySelector('#tcType').value, priority: root.querySelector('#tcPri').value,
          siteId: picked, siteName: site ? site.name : '', siteCity: site ? site.city : '',
          engineer: root.querySelector('#tcEng').value, dueDate: root.querySelector('#tcDue').value,
          nextAction: root.querySelector('#tcNext').value,
          source: '花姐手动新增',
        });
        if (t.engineer) NK.addReminder(`任务待处理：${t.name}`, `${t.no} · ${t.engineer}`, 'task', t.id);
        NK.save();
        UI.toast(`任务 ${t.no} 已创建，记下来啦 ✓`);
        UI.modalClose();
        UI.renderTasks();
      };
    },
  });
};

/* ============================================================
   快速记录（轻量备忘录）
   ============================================================ */

/** 快速记录：打开发送草稿抽屉 */
UI.quickNote = () => {
  const draft = NK.loadDraft();
  const hasDraft = !!(draft && draft.content);

  UI.modal('快速记录', `
    <div id="qnBody">
      ${hasDraft ? `
      <div class="qn-draft-bar">
        <span class="qn-draft-icon">📝</span>
        <span class="qn-draft-txt">花姐，上次有一条没写完的记录，要继续吗？</span>
        <button class="qn-draft-btn" onclick="UI.quickNoteResume()">继续编辑</button>
        <button class="qn-draft-btn qn-draft-discard" onclick="UI.quickNoteDiscard()">放弃草稿</button>
      </div>` : ''}
      <input id="qnTitle" class="qn-title" placeholder="给这条记录起个名字，可不填" value="${draft && draft.title ? NK.esc(draft.title) : ''}">
      <div class="qn-toolbar">
        <button class="qn-tpl-btn" onclick="UI.quickNoteInsertTpl()">📋 插入会议纪要模板</button>
      </div>
      <textarea id="qnContent" class="qn-content" placeholder="会议内容、电话记录、临时安排、工作想法……先记下来再说。">${draft && draft.content ? NK.esc(draft.content) : ''}</textarea>
    </div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="qnSave">保存记录</button>`,
    {
      size: 'modal-note',
      onBeforeClose(close, reason) {
        // 快速记录已有自动草稿能力：关闭时若仍有未保存输入，自动落草稿（不重复创建）
        try {
          const t = document.getElementById('qnTitle').value;
          const c = document.getElementById('qnContent').value;
          if (t || c) NK.saveDraft({ title: t, content: c });
        } catch (e) { /* 草稿保存失败则静默，交由普通关闭 */ }
        close();
      },
      onMount(root) {
        // 自动草稿保存：停止输入2秒后
        let timer;
        const saveDraft = () => {
          clearTimeout(timer);
          timer = setTimeout(() => {
            NK.saveDraft({
              title: document.getElementById('qnTitle').value,
              content: document.getElementById('qnContent').value,
            });
          }, 2000);
        };
        document.getElementById('qnTitle').addEventListener('input', saveDraft);
        document.getElementById('qnContent').addEventListener('input', saveDraft);
        // 自动聚焦内容区
        const cont = document.getElementById('qnContent');
        if (cont && !hasDraft) cont.focus();
        // Ctrl+Enter 保存
        const onKey = (e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            document.getElementById('qnSave').click();
          }
        };
        cont.addEventListener('keydown', onKey);
        document.getElementById('qnTitle').addEventListener('keydown', onKey);
        // 保存
        document.getElementById('qnSave').onclick = UI.quickNoteSave;
      }
    }
  );
};

/** 保存快速记录 */
UI.quickNoteSave = () => {
  const title = document.getElementById('qnTitle').value.trim();
  const content = document.getElementById('qnContent').value.trim();
  if (!content) { UI.toast('花姐，先写点什么再保存吧'); return; }
  // 生成标题（未填写时自动取正文第一行，超20字截断）
  const finalTitle = title || NK.notesAutoTitle(content);
  NK.db.quickNotes = NK.db.quickNotes || [];
  const note = {
    id: 'QN-' + Date.now(),
    title: finalTitle,
    content,
    createdAt: NK.now(),
    updatedAt: NK.now(),
    pinned: false, archived: false, deleted: false,
  };
  NK.db.quickNotes.push(note);
  NK.saveDraft(null); // 清除草稿
  NK.save();
  UI.modalClose();
  UI.modal('已保存', `
    <div style="text-align:center;padding:10px 0 20px">
      <div style="font-size:32px;margin-bottom:10px">📝</div>
      <div style="font-size:15px;color:var(--text)">花姐，已经帮你记下来了。</div>
    </div>`,
    `<button class="btn" onclick="UI.modalClose();UI.renderHome()">关闭</button><button class="btn" onclick="UI.modalClose();UI.quickNote()">再记一条</button><button class="btn btn-accent" onclick="UI.modalClose();UI.nav('notes','${note.id}')">查看记录</button>`,
    { size: 'modal-sm' }
  );
};

/** 快速记录：插入会议纪要模板 */
UI.quickNoteInsertTpl = () => {
  const ta = document.getElementById('qnContent');
  if (!ta) return;
  const tpl = `会议主题：

会议时间：

参会人员：

讨论内容：

1.

2.

决定事项：

1.

待跟进事项：

1.

备注：`;
  const start = ta.selectionStart;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionEnd);
  ta.value = before + tpl + after;
  ta.selectionStart = ta.selectionEnd = start + tpl.length;
  ta.focus();
};

/** 快速记录：继续编辑草稿 */
UI.quickNoteResume = () => {
  const bar = document.querySelector('.qn-draft-bar');
  if (bar) bar.remove();
  const ta = document.getElementById('qnContent');
  if (ta) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
};

/** 快速记录：放弃草稿 */
UI.quickNoteDiscard = () => {
  NK.saveDraft(null);
  const bar = document.querySelector('.qn-draft-bar');
  if (bar) bar.remove();
  document.getElementById('qnTitle').value = '';
  document.getElementById('qnContent').value = '';
  document.getElementById('qnContent').focus();
};

/** 查看全部快速记录（入口：跳转到我的记录页） */
UI.quickNoteList = () => { UI.nav('notes'); };

/** 查看单条快速记录（详情弹窗，见我的记录页） */
UI.quickNoteView = (id) => { UI.notesView(id); };

/** 删除快速记录（软删除，可到回收站恢复） */
UI.quickNoteDelete = (id) => { UI.notesDelete(id); };

/* ============================================================
   我的记录（花姐的记录本 — 快速记录的统一查看与管理页）
   ============================================================ */

/** 时间显示：今天/昨天 HH:MM → M月D日 HH:MM → YYYY-MM-DD HH:MM */
UI.noteTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = new Date();
  const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return '今天 ' + hm;
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(d, yest)) return '昨天 ' + hm;
  if (d.getFullYear() === now.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
  return NK.fmtDate(d) + ' ' + hm;
};

/** 正文摘要：取非空行拼接，最多约84字符 */
UI.notesSnippet = (content) => {
  const s = String(content || '').split('\n').map(x => x.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return s.length > 84 ? s.slice(0, 84) + '…' : s;
};

/** 规范化所有记录字段（兼容旧数据） */
UI.notesAll = () => {
  const arr = NK.db.quickNotes || [];
  arr.forEach(n => {
    n.pinned = !!n.pinned; n.archived = !!n.archived; n.deleted = !!n.deleted;
  });
  return arr;
};

/** 记录列表行 */
UI.notesItemHTML = (n) => `
  <div class="nr-item" data-nid="${n.id}" onclick="UI.notesView('${n.id}')">
    <div class="nr-item-title">${n.pinned ? '<span class="nr-pin">📌</span>' : ''}${NK.esc(n.title)}</div>
    <div class="nr-item-snippet">${NK.esc(UI.notesSnippet(n.content))}</div>
    <div class="nr-item-meta">
      <span>创建 ${UI.noteTime(n.createdAt)}</span><span class="nr-dot">·</span>
      <span>更新 ${UI.noteTime(n.updatedAt || n.createdAt)}</span>
      ${n.projectName ? `<span class="nr-dot">·</span><span class="nr-proj">▣ ${NK.esc(n.projectName)}</span>` : ''}
    </div>
  </div>`;

/** 草稿行（来自自动保存的未完成内容） */
UI.notesDraftHTML = (d) => `
  <div class="nr-item nr-draft" onclick="UI.quickNote()">
    <div class="nr-item-title"><span class="nr-chip-tag">草稿</span>${NK.esc(d.title || NK.notesAutoTitle(d.content))}</div>
    <div class="nr-item-snippet">${NK.esc(UI.notesSnippet(d.content))}</div>
    <div class="nr-item-meta"><span>最后编辑 ${d.updatedAt ? UI.noteTime(d.updatedAt) : '—'}</span></div>
  </div>`;

/** 列表区域（搜索/筛选后重建） */
UI.notesListHTML = () => {
  const state = UI.notesState || { q: '', filter: 'all' };
  const q = (state.q || '').trim().toLowerCase();
  const notes = UI.notesAll();
  const draft = NK.loadDraft();
  const hasDraft = !!(draft && String(draft.content || '').trim());
  const hay = (s) => String(s || '').toLowerCase();
  const match = (n) => !q || hay(n.title + '\n' + n.content).includes(q);

  const rows = [];
  if (state.filter === 'draft') {
    if (hasDraft && (!q || hay((draft.title || '') + '\n' + draft.content).includes(q))) {
      rows.push(UI.notesDraftHTML(draft));
    }
  } else if (state.filter === 'archived') {
    notes.filter(n => n.archived && !n.deleted && match(n)).forEach(n => rows.push(UI.notesItemHTML(n)));
  } else {
    let list = notes.filter(n => !n.archived && !n.deleted && match(n));
    if (state.filter === 'pinned') list = list.filter(n => n.pinned);
    list.sort((a, b) => ((b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)) || (new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt)));
    list.forEach(n => rows.push(UI.notesItemHTML(n)));
  }

  if (!rows.length) {
    if (q) return `<div class="nr-empty"><div class="nr-empty-icon">🔍</div><div class="nr-empty-text">没找到相关记录，换个关键词试试。</div></div>`;
    const hasAny = notes.some(n => !n.deleted) || hasDraft;
    if (!hasAny) {
      return `<div class="nr-empty">
        <div class="nr-empty-icon">📝</div>
        <div class="nr-empty-text">这里还空着。<br>下一次会议、电话沟通或临时想法，可以先用“快速记录”记下来。📝</div>
        <button class="btn btn-accent" onclick="UI.quickNote()">＋ 新建第一条记录</button>
      </div>`;
    }
    const emptyText = state.filter === 'pinned' ? '还没有置顶的记录，重要记录可以置顶方便随时回看。'
      : state.filter === 'archived' ? '还没有已归档的记录，暂时不看的记录可以归档保留。'
      : state.filter === 'draft' ? '当前没有未完成的草稿。'
      : '当前没有未归档的记录，已归档记录可在「已归档」中查看。';
    return `<div class="nr-empty"><div class="nr-empty-icon">🗂️</div><div class="nr-empty-text">${emptyText}</div></div>`;
  }
  return rows.join('');
};

/** 我的记录 主页 */
UI.renderNotes = (arg) => {
  const el = document.getElementById('view-notes');
  const notes = UI.notesAll();
  UI.notesState = UI.notesState || { q: '', filter: 'all' };
  const state = UI.notesState;
  const draft = NK.loadDraft();
  const hasDraft = !!(draft && String(draft.content || '').trim());
  const activeCount = notes.filter(n => !n.archived && !n.deleted).length;
  const pinnedCount = notes.filter(n => n.pinned && !n.archived && !n.deleted).length;
  const archivedCount = notes.filter(n => n.archived && !n.deleted).length;
  const deletedCount = notes.filter(n => n.deleted).length;

  const chips = [
    ['all', '全部', activeCount], ['pinned', '置顶', pinnedCount],
    ['draft', '草稿', hasDraft ? 1 : 0], ['archived', '已归档', archivedCount],
  ].map(([k, label, cnt]) =>
    `<div class="nr-chip${state.filter === k ? ' active' : ''}" onclick="UI.notesSetFilter('${k}')">${label}${cnt ? `<span class="nr-chip-count">${cnt}</span>` : ''}</div>`).join('');

  el.innerHTML = UI.pageHead('花姐的记录本', '会议纪要、临时安排和工作想法，都收在这里。',
    `<button class="btn btn-accent" onclick="UI.quickNote()">＋ 快速记录</button>`) + `
    <div class="card">
      <div class="card-body">
        <div class="nr-toolbar">
          <div class="nr-search"><span class="nr-search-ico">⌕</span>
            <input id="nrSearch" type="text" placeholder="搜标题或记录内容……" value="${NK.esc(state.q)}">
          </div>
          <div class="nr-chips">${chips}</div>
        </div>
        <div id="nrList">${UI.notesListHTML()}</div>
        ${deletedCount ? `<div class="nr-recycle-bar" onclick="UI.notesRecycle()">🗑️ 回收站里有 ${deletedCount} 条已删除记录，点击可恢复</div>` : ''}
      </div>
    </div>`;

  const si = document.getElementById('nrSearch');
  if (si) si.addEventListener('input', NK.debounce(() => UI.notesSetQuery(si.value), 250));

  // 定位刚保存的记录（等导航滚动复位后再滚动到该行）
  if (arg && typeof arg === 'string') {
    setTimeout(() => {
      const item = el.querySelector('[data-nid="' + arg + '"]');
      if (item) {
        item.scrollIntoView({ block: 'center' });
        item.classList.add('nr-flash');
        setTimeout(() => item.classList.remove('nr-flash'), 2600);
      }
    }, 80);
  }
};

UI.notesSetFilter = (f) => { UI.notesState = UI.notesState || {}; UI.notesState.filter = f; UI.renderNotes(); };
UI.notesSetQuery = (q) => { UI.notesState = UI.notesState || {}; UI.notesState.q = q; const l = document.getElementById('nrList'); if (l) l.innerHTML = UI.notesListHTML(); };

/** 记录详情弹窗 */
UI.notesView = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  UI.modal(`记录 \u00b7 ${NK.esc(n.title)}`,
    `<div class="nr-more" id="nrMore" hidden>
      <button class="btn btn-sm" onclick="UI.notesToTask('${n.id}')">转为任务</button>
      <button class="btn btn-sm" onclick="UI.notesLinkProject('${n.id}')">关联专项</button>
    </div>
    <div class="nr-view-meta">创建于 ${UI.noteTime(n.createdAt)} · 更新于 ${UI.noteTime(n.updatedAt || n.createdAt)}${n.projectName ? ' · ▣ ' + NK.esc(n.projectName) : ''}${n.pinned ? ' · 已置顶 📌' : ''}${n.archived ? ' · 已归档' : ''}</div>
    <div class="qn-view-content">${NK.esc(n.content).replace(/\n/g, '<br>')}</div>`,
    `<button class="btn" data-close>关闭</button>
     <button class="btn" onclick="UI.notesDelete('${n.id}')">删除</button>
     <button class="btn" onclick="UI.notesArchive('${n.id}')">${n.archived ? '取消归档' : '归档'}</button>
     <button class="btn" onclick="UI.notesCopy('${n.id}')">复制</button>
     <button class="btn" onclick="UI.notesToggleMore()">更多 ▾</button>
     <button class="btn" onclick="UI.notesPin('${n.id}')">${n.pinned ? '取消置顶' : '置顶'}</button>
     <button class="btn btn-accent" onclick="UI.notesEdit('${n.id}')">编辑</button>`,
    { size: 'modal-note' }
  );
};
UI.notesToggleMore = () => { const row = document.getElementById('nrMore'); if (row) row.hidden = !row.hidden; };

/** 编辑记录 */
UI.notesEdit = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  UI.modal('编辑记录', `
    <input id="qnTitle" class="qn-title" placeholder="给这条记录起个名字，可不填" value="${NK.esc(n.title)}">
    <div class="qn-toolbar"><button class="qn-tpl-btn" onclick="UI.quickNoteInsertTpl()">📋 插入会议纪要模板</button></div>
    <textarea id="qnContent" class="qn-content" placeholder="会议内容、电话记录、临时安排、工作想法……先记下来再说。">${NK.esc(n.content)}</textarea>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="qnSave">保存</button>`,
    { size: 'modal-note', editable: true, onMount(root) {
      const cont = document.getElementById('qnContent');
      cont.focus(); cont.selectionStart = cont.selectionEnd = cont.value.length;
      const onKey = (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') document.getElementById('qnSave').click(); };
      cont.addEventListener('keydown', onKey);
      document.getElementById('qnTitle').addEventListener('keydown', onKey);
      document.getElementById('qnSave').onclick = () => UI.notesEditSave(id);
    }}
  );
};
UI.notesEditSave = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  const title = document.getElementById('qnTitle').value.trim();
  const content = document.getElementById('qnContent').value.trim();
  if (!content) { UI.toast('花姐，内容不能为空哦'); return; }
  n.title = title || NK.notesAutoTitle(content);
  n.content = content;
  n.updatedAt = NK.now();
  NK.save();
  UI.modalClose();
  UI.toast('花姐，记录已更新。📝');
  UI.renderNotes();
};

/** 复制记录内容 */
UI.notesCopy = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  UI.copy((n.title ? n.title + '\n\n' : '') + n.content);
};

/** 置顶 / 取消置顶 */
UI.notesPin = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  n.pinned = !n.pinned;
  NK.save();
  UI.toast(n.pinned ? '花姐，已置顶 📌' : '花姐，已取消置顶');
  UI.modalClose();
  UI.renderNotes();
};

/** 归档 / 取消归档 */
UI.notesArchive = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  n.archived = !n.archived;
  NK.save();
  UI.toast(n.archived ? '花姐，已归档，可在「已归档」中查看 🗂️' : '花姐，已取消归档');
  UI.modalClose();
  UI.renderNotes();
  UI.refreshBadges();
};

/** 软删除（回收站） */
UI.notesDelete = (id) => {
  UI.confirm('确定删除这条记录吗？删除后将无法在默认列表中查看。', () => {
    const n = (NK.db.quickNotes || []).find(x => x.id === id);
    if (n) { n.deleted = true; n.deletedAt = NK.now(); NK.save(); }
    UI.modalClose();
    UI.toast('花姐，记录已移入回收站 🗑️');
    UI.renderNotes();
    UI.refreshBadges();
  });
};

/** 回收站 */
UI.notesRecycle = () => {
  const deleted = UI.notesAll().filter(n => n.deleted);
  if (!deleted.length) { UI.toast('回收站是空的'); return; }
  UI.modal('回收站', `<div class="qn-list">${deleted.map(n => `
    <div class="nr-recycle-item">
      <div class="nr-item-title">${NK.esc(n.title)}</div>
      <div class="nr-item-meta"><span>删除时间 ${n.deletedAt ? UI.noteTime(n.deletedAt) : '—'}</span></div>
      <div style="display:flex;gap:8px;margin-top:6px">
        <button class="btn btn-sm" onclick="UI.notesRestore('${n.id}')">恢复</button>
        <button class="btn btn-sm btn-danger" onclick="UI.notesPurge('${n.id}')">彻底删除</button>
      </div>
    </div>`).join('')}</div>`, `<button class="btn" data-close>关闭</button>`, { size: 'modal-note' });
};
UI.notesRestore = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  n.deleted = false; n.deletedAt = ''; n.archived = false;
  NK.save();
  UI.modalClose();
  UI.toast('花姐，记录已恢复 ✅');
  UI.renderNotes();
  UI.refreshBadges();
};
UI.notesPurge = (id) => {
  UI.confirm('确定彻底删除这条记录吗？此操作不可恢复。', () => {
    NK.db.quickNotes = (NK.db.quickNotes || []).filter(x => x.id !== id);
    NK.save();
    UI.modalClose();
    UI.toast('花姐，已彻底删除');
    UI.renderNotes();
    UI.refreshBadges();
  }, '彻底删除');
};

/** 转为任务 */
UI.notesToTask = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  const task = NK.createTask({
    name: n.title, type: '记录转化', priority: 'P3', source: '快速记录', status: '待处理',
    nextAction: n.content,
  });
  task.noteId = n.id;
  NK.save();
  UI.modalClose();
  UI.toast('花姐，已转为任务，可在「任务与告警」中查看 ✅');
};

/** 关联到专项 */
UI.notesLinkProject = (id) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === id);
  if (!n) return;
  const projects = NK.db.projects.filter(p => p.status !== '已完成' && p.status !== '已取消');
  if (!projects.length) { UI.toast('花姐，当前没有可关联的专项'); return; }
  UI.modal('关联到专项', `
    <p style="color:var(--text-3);font-size:12px;margin-bottom:8px">选择要关联的专项：</p>
    <div class="card-body flush" style="max-height:320px;overflow:auto">${projects.slice(0, 30).map(p => `
      <div class="focus-item" style="cursor:pointer" onclick="UI.notesLinkProjectDo('${n.id}','${p.id}')">
        <span class="badge gray">${NK.esc(p.type)}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(p.name)}</div>
        <div class="fi-meta">${p.no} · ${UI.statusBadge(p.status)}</div></div>
      </div>`).join('')}</div>`,
    `<button class="btn" data-close>取消</button>`, { size: 'modal-note' });
};
UI.notesLinkProjectDo = (noteId, projectId) => {
  const n = (NK.db.quickNotes || []).find(x => x.id === noteId);
  const p = NK.db.projects.find(x => x.id === projectId);
  if (!n) return;
  n.projectId = projectId; n.projectName = p ? p.name : '';
  NK.save();
  UI.modalClose();
  UI.toast('花姐，记录已关联专项 ✅');
  UI.renderNotes();
};

/** 选择任务并更新进度 */
UI.taskPickUpdate = () => {
  const active = NK.db.tasks.filter(t => NK.taskActive(t) && t.status !== '已完成' && t.status !== '已取消');
  if (!active.length) { UI.toast('花姐，当前没有进行中的任务 😊', 'warn'); return; }
  UI.modal('更新任务进度', `
    <p style="color:var(--text-3);font-size:12px">选择要更新进度的任务：</p>
    <div class="card-body flush" style="max-height:380px;overflow:auto">${active.slice(0, 30).map(t => `
      <div class="focus-item">
        <span class="badge gray">${NK.esc(t.type)}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(t.name)} ${UI.priBadge(t.priority)}</div>
        <div class="fi-meta">${t.no} · ${UI.statusBadge(t.status)} · ${NK.esc(t.siteName || '—')}</div></div>
        <div class="fi-actions"><button class="btn btn-sm btn-accent" onclick="UI.taskFeedback('${t.id}')">更新反馈</button></div>
      </div>`).join('')}</div>`, `<button class="btn" data-close>关闭</button>`);
};

/** 任务详情 */
UI.taskDetail = (id) => {
  const t = NK.getTask(id);
  if (!t) return;
  const v = NK.v.task(t);
  const d = t.dispatchId ? NK.getDispatch(t.dispatchId) : null;
  const upd = NK.db.taskUpdates.filter(u => u.taskId === id || u.refId === id);
  UI.modal(`任务详情 · ${t.no}`, `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <span style="font-size:17px;font-weight:700">${NK.esc(t.name)}</span>
      ${UI.priBadge(t.priority)} ${UI.statusBadge(t.status)} <span class="tag">${NK.esc(t.type)}</span><span class="tag gray">${NK.esc(t.source)}</span>
    </div>
    <div class="detail-grid">
      <div class="dg-item"><div class="dg-label">职场</div><div class="dg-val">${NK.esc(v.siteName || '—')}${t.siteCity ? '（' + NK.esc(t.siteCity) + '）' : ''}</div></div>
      <div class="dg-item"><div class="dg-label">工程师</div><div class="dg-val">${NK.esc(v.engineer || '未指派')}</div></div>
      <div class="dg-item"><div class="dg-label">创建时间</div><div class="dg-val">${t.createdAt.slice(0, 16).replace('T', ' ')}</div></div>
      <div class="dg-item"><div class="dg-label">截止时间</div><div class="dg-val">${t.dueDate ? t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') + '（' + NK.remainText(t.dueDate, t.dueTime) + '）' : '—'}</div></div>
      <div class="dg-item"><div class="dg-label">完成时间</div><div class="dg-val">${t.doneAt ? t.doneAt.slice(0, 16).replace('T', ' ') : '—'}</div></div>
      <div class="dg-item"><div class="dg-label">关联派单</div><div class="dg-val">${d ? `<a style="cursor:pointer;color:var(--accent)" onclick="UI.dispatchDetail('${d.id}')">${d.no} ${NK.esc(d.title)}</a>` : '—'}</div></div>
    </div>
    ${t.nextAction ? `<div class="hint">下一步：${NK.esc(t.nextAction)}</div>` : ''}
    ${t.acceptRequire ? `<div class="hint">验收要求：${NK.esc(t.acceptRequire)}</div>` : ''}
    ${t.latestFeedback ? `<div class="msg-preview" style="white-space:pre-wrap">最新反馈：${NK.esc(t.latestFeedback)}</div>` : ''}
    ${t.result ? `<div class="msg-preview" style="white-space:pre-wrap">处理结果：${NK.esc(t.result)}</div>` : ''}
    ${t.acceptResult ? `<div class="msg-preview" style="white-space:pre-wrap">验收结论：${NK.esc(t.acceptResult)}</div>` : ''}
    ${upd.length ? `<div class="card-head" style="margin-top:10px"><div class="card-title">更新记录</div></div><div class="card-body flush">${upd.slice(-8).reverse().map(u => `
      <div class="focus-item"><span class="badge gray">${(u.at || '').slice(5, 16).replace('T', ' ')}</span>
      <div class="fi-main"><div class="fi-meta">${NK.esc(u.content || u.feedback || '')}</div></div></div>`).join('')}</div>` : ''}`,
    `<button class="btn" data-close>关闭</button>
     ${t.status !== '已完成' ? `<button class="btn btn-accent" onclick="UI.taskFeedback('${t.id}')">更新反馈</button><button class="btn btn-warn" onclick="UI.taskUrgent('${t.id}')">催办</button>` : ''}`,
    { size: 'modal-lg' });
};

/** 任务更新反馈 */
UI.taskFeedback = (id) => {
  const t = NK.getTask(id);
  if (!t) return;
  UI.modal(`更新反馈 · ${t.no}`, `
    <p><b>${NK.esc(t.name)}</b> ${UI.statusBadge(t.status)}</p>
    <div class="form-item"><label>状态</label><select id="tfStatus">
      ${NK.TASK_STATUS.map(s => `<option ${t.status === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select></div>
    <div class="form-item"><label>最新反馈 *</label><textarea id="tfContent" placeholder="处理进展、遇到的问题…">${NK.esc(t.latestFeedback || '')}</textarea></div>
    <div class="form-item"><label>下一步计划</label><input id="tfNext" value="${NK.esc(t.nextAction || '')}"></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="tfOk">保存反馈</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#tfOk').onclick = () => {
        const st = root.querySelector('#tfStatus').value;
        const fb = root.querySelector('#tfContent').value.trim();
        if (!fb) { UI.toast('请填写反馈内容', 'warn'); return; }
        NK.setTaskStatus(t, st);
        NK.updateTaskFeedback(t, { feedback: fb, nextAction: root.querySelector('#tfNext').value.trim() });
        NK.db.taskUpdates.push({ id: NK.uid('TU'), taskId: t.id, at: NK.now(), content: fb });
        NK.save();
        UI.toast(`花姐，任务 ${t.no} 已更新 ✓`);
        UI.modalClose();
        UI.renderTasks();
      };
    },
  });
};

/** 任务催办 */
UI.taskUrgent = (id) => {
  const t = NK.getTask(id);
  if (!t) return;
  const msg = `${t.engineer || '工程师'}，任务“${t.name}”${t.dueDate ? '计划于 ' + t.dueDate + ' 前完成' : '等待处理'}，请尽快反馈当前进度与预计完成时间，谢谢。`;
  UI.modal('催办消息', `
    <p>已生成催办消息（复制后发给工程师）：</p>
    <div class="msg-preview" style="white-space:pre-wrap">${NK.esc(msg)}</div>`,
    `<button class="btn" data-close>关闭</button><button class="btn btn-accent" id="urgCopy">复制消息</button>`, {
    onMount(root) {
      root.querySelector('#urgCopy').onclick = () => { UI.copy(msg); };
    },
  });
};

/** 恢复已取消任务（仅当其关联派单已恢复为有效状态时可用） */
UI.taskReactivate = (id) => {
  const t = NK.getTask(id);
  if (!t) return;
  UI.confirm(`确认恢复任务「${t.name}」？恢复后将重新进入当前有效工作。`, () => {
    const d = NK.dispatchOfTask(t);
    if (d && !NK.dispatchInactive(d)) {
      t.status = '待处理';
      t.cancelReason = '';
      t.cancelledAt = '';
      if (t.recordStatus === '已删除') { t.recordStatus = '正常'; t.deleteReason = ''; t.deletedAt = ''; }
      t.updatedAt = NK.now();
      NK.save();
      UI.toast(`花姐，任务 ${t.no} 已恢复。`);
      UI.renderTasks();
      UI.refreshBadges();
    } else {
      UI.toast('该任务关联的派单当前为撤销/删除状态，请先恢复派单。', 'err');
    }
  });
};

/** 任务标记完成 */
UI.taskDone = (id) => {
  const t = NK.getTask(id);
  if (!t) return;
  UI.confirm(`确认任务「${t.name}」已完成？`, () => {
    NK.setTaskStatus(t, '已完成');
    UI.toast(`花姐，任务 ${t.no} 已完成 ✓`);
    UI.renderTasks();
    UI.refreshBadges();
  });
};

/* ============================================================
   专项管理
   ============================================================ */
UI.renderProjects = () => {
  const el = document.getElementById('view-projects');
  const f = NK.projectFilter = NK.projectFilter || {};
  let list = [...NK.db.projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (f.status && f.status !== '全部') list = list.filter(p => p.status === f.status);
  if (f.q) list = list.filter(p => `${p.no} ${p.name} ${p.owner}`.includes(f.q));

  const statusOpts = ['全部', ...NK.PROJECT_STATUS];
  const cards = list.map(p => {
    const pts = NK.getProjectTasks(p.id);
    const done = pts.filter(x => x.status === '已完成').length;
    const pct = p.progress || (pts.length ? Math.round(done / pts.length * 100) : 0);
    const risk = p.status === '有风险' || (p.dueDate && NK.today() > p.dueDate && p.status !== '已完成');
    return `<div class="card">
      <div class="card-head"><div class="card-title">${NK.esc(p.name)} <span class="tag">${NK.esc(p.type)}</span> ${UI.statusBadge(p.status)}</div>
        <span class="num">${p.no}</span></div>
      <div class="card-body">
        <div style="color:var(--text-2);font-size:12px;margin-bottom:8px">${NK.esc(p.goal || '')}</div>
        <div class="kpi-bar-row">
          <span class="kpi-bar-label">完成度 ${pct}%</span>
          <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${pct}%;background:${risk ? 'var(--warn)' : 'var(--accent)'}"></div></div>
          <span class="kpi-bar-val">${done}/${pts.length} 项</span>
        </div>
        <div class="detail-grid" style="margin-top:10px">
          <div class="dg-item"><div class="dg-label">时间</div><div class="dg-val">${p.startDate || '—'} → ${p.dueDate || '—'}</div></div>
          <div class="dg-item"><div class="dg-label">负责人</div><div class="dg-val">${NK.esc(p.owner || '—')}</div></div>
          <div class="dg-item"><div class="dg-label">参与</div><div class="dg-val">${(p.participants || []).map(x => NK.esc(NK.v.engName(x))).join('、') || '—'}</div></div>
          <div class="dg-item"><div class="dg-label">下一步</div><div class="dg-val">${NK.esc(p.nextAction || '—')}</div></div>
        </div>
        ${risk ? `<div class="hint">⚠ ${NK.esc(p.risk || '专项已超期，请尽快跟进')}</div>` : ''}
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
          <button class="btn btn-sm btn-accent" onclick="UI.projectDetail('${p.id}')">查看清单</button>
          <button class="btn btn-sm" onclick="UI.projectProgress('${p.id}')">更新进度</button>
          ${p.status !== '已完成' && p.status !== '已取消' ? `<button class="btn btn-sm btn-warn" onclick="UI.projectMarkRisk('${p.id}')">标记风险</button>` : ''}
        </div>
      </div></div>`;
  }).join('');

  el.innerHTML = UI.pageHead('专项管理', '季度巡检 · 补丁更新 · 搬迁撤场 · 通用项目',
    `<button class="btn" onclick="UI.projectCreate(true)">季度巡检模板</button><button class="btn btn-accent" onclick="UI.projectCreate()">新建专项</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" id="pjQ" placeholder="搜索专项名称/编号…" value="${NK.esc(f.q || '')}">
      <select class="fb-select" id="pjStatus">${statusOpts.map(s => `<option ${(f.status || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">共 ${list.length} 个专项</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">${cards || '<div class="card"><div class="card-body">暂无专项，点击「新建专项」或使用季度巡检模板</div></div>'}</div>`;

  const bind = () => {
    const onFilter = () => {
      NK.projectFilter = { q: document.getElementById('pjQ').value, status: document.getElementById('pjStatus').value };
      UI.renderProjects();
    };
    document.getElementById('pjQ').addEventListener('input', NK.debounce(onFilter, 300));
    document.getElementById('pjStatus').onchange = onFilter;
  };
  setTimeout(bind, 0);
};

/** 新建专项（quarter 为 true 时预填季度巡检） */
UI.projectCreate = (quarter) => {
  const engs = NK.db.engineers;
  const participantsHTML = engs.map(e => `<label style="display:flex;gap:6px;align-items:center;font-size:12px;width:31%"><input type="checkbox" class="pjPart" value="${NK.esc(e.name)}" ${quarter ? 'checked' : ''}>${NK.esc(NK.v.engName(e.name))}</label>`).join('');
  const inspect = NK.quarterlyInspectTasks();
  UI.modal(quarter ? '创建季度巡检专项' : '新建专项', `
    <div class="form-item"><label>专项名称 *</label><input id="pjName" value="${quarter ? '2026年Q' + (Math.floor((new Date().getMonth()) / 3) + 1) + '季度巡检' : ''}" placeholder="例如：2026年Q3季度巡检"></div>
    <div class="form-grid">
      <div class="form-item"><label>类型</label><select id="pjType">${NK.PROJECT_TYPES.map(t => `<option ${t === '季度巡检' ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="form-item"><label>状态</label><select id="pjStatus"><option>未开始</option><option selected>进行中</option><option>已暂停</option></select></div>
    </div>
    <div class="form-item"><label>目标</label><textarea id="pjGoal" placeholder="专项目标、范围、验收标准">${quarter ? '9名驻场工程师完成全国职场季度巡检，提交机房/监管机照片及巡检单。' : ''}</textarea></div>
    <div class="form-grid">
      <div class="form-item"><label>开始日期</label><input id="pjStart" type="date" value="${quarter ? NK.today().slice(0, 8) + '01' : NK.today()}"></div>
      <div class="form-item"><label>截止日期</label><input id="pjEnd" type="date" value="${quarter ? NK.today().slice(0, 8) + '29' : ''}"></div>
    </div>
    <div class="form-item"><label>参与工程师</label><div style="display:flex;flex-wrap:wrap;gap:6px">${participantsHTML}</div></div>
    ${quarter ? `<div class="hint">将自动生成 ${inspect.length} 项巡检子任务（机房检查/监管机检查/巡检单提交等）</div>` : ''}
    <div class="form-item"><label>验收要求</label><input id="pjAccept" placeholder="如：全部子任务完成并附照片">`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="pjOk">创建专项</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#pjOk').onclick = () => {
        const name = root.querySelector('#pjName').value.trim();
        if (!name) { UI.toast('请填写专项名称', 'warn'); return; }
        const parts = [...root.querySelectorAll('.pjPart:checked')].map(x => x.value);
        const p = NK.createProject({
          name,
          type: root.querySelector('#pjType').value,
          goal: root.querySelector('#pjGoal').value.trim(),
          startDate: root.querySelector('#pjStart').value,
          dueDate: root.querySelector('#pjEnd').value,
          status: root.querySelector('#pjStatus').value,
          owner: '花姐',
          participants: parts,
          acceptRequire: root.querySelector('#pjAccept').value.trim(),
          autoTasks: quarter ? inspect : [],
        });
        if (quarter) NK.updateProjectProgress(p);
        NK.save();
        UI.toast(`花姐，专项 ${p.no} 已创建${quarter ? '，自动生成 ' + inspect.length + ' 项巡检任务' : ''} ✓`);
        UI.modalClose();
        UI.renderProjects();
      };
    },
  });
};

/** 专项详情（子任务清单） */
UI.projectDetail = (id) => {
  const p = NK.getProject(id);
  if (!p) return;
  const pts = NK.getProjectTasks(id);
  const done = pts.filter(x => x.status === '已完成').length;
  const pct = p.progress || (pts.length ? Math.round(done / pts.length * 100) : 0);
  const engNames = NK.db.engineers.map(e => e.name);
  UI.modal(`专项详情 · ${p.no}`, `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:17px;font-weight:700">${NK.esc(p.name)}</span>
      <span class="tag">${NK.esc(p.type)}</span>${UI.statusBadge(p.status)}</div>
    <div style="color:var(--text-2);font-size:12px;margin-bottom:10px">${NK.esc(p.goal || '')}</div>
    <div class="kpi-bar-row">
      <span class="kpi-bar-label">完成度 ${pct}%</span>
      <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${pct}%;background:${pct === 100 ? 'var(--accent)' : 'var(--primary)'}"></div></div>
      <span class="kpi-bar-val">${done}/${pts.length}</span>
    </div>
    <div class="detail-grid" style="margin-top:10px">
      <div class="dg-item"><div class="dg-label">时间</div><div class="dg-val">${p.startDate || '—'} → ${p.dueDate || '—'}</div></div>
      <div class="dg-item"><div class="dg-label">负责人</div><div class="dg-val">${NK.esc(p.owner || '—')}</div></div>
      <div class="dg-item"><div class="dg-label">验收要求</div><div class="dg-val">${NK.esc(p.acceptRequire || '—')}</div></div>
      <div class="dg-item"><div class="dg-label">下一步</div><div class="dg-val">${NK.esc(p.nextAction || '—')}</div></div>
    </div>
    ${p.risk ? `<div class="hint">⚠ 风险：${NK.esc(p.risk)}</div>` : ''}
    <div class="card-head" style="margin-top:12px"><div class="card-title">子任务清单（${pts.length}）</div></div>
    <div class="card-body flush">${pts.length ? pts.map(pt => `
      <div class="focus-item">
        <span class="badge ${pt.status === '已完成' ? 'done' : 'wait'}" style="cursor:pointer" onclick="UI.projectTaskSet('${pt.id}')">${pt.status === '已完成' ? '✓' : '○'}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(pt.name)}</div>
        <div class="fi-meta">${pt.engineer ? '负责：' + NK.esc(NK.v.engName(pt.engineer)) : '未指派'}${pt.feedback ? ' ｜ 反馈：' + NK.esc(pt.feedback) : ''}</div></div>
        <div class="fi-actions">
          ${pt.engineer ? '' : `<select class="fb-select" style="height:26px;font-size:11px" onchange="UI.projectTaskAssign('${pt.id}', this.value)"><option value="">指派…</option>${engNames.map(n => `<option>${n}</option>`).join('')}</select>`}
          <button class="btn btn-sm" onclick="UI.projectTaskFeedback('${pt.id}')">反馈</button>
        </div>
      </div>`).join('') : '<div class="tbl-empty" style="padding:20px">暂无子任务</div>'}</div>`,
    `<button class="btn" data-close>关闭</button>
     <button class="btn" onclick="UI.projectProgress('${p.id}')">更新进度</button>
     ${p.status !== '已完成' ? `<button class="btn btn-accent" onclick="UI.projectFinish('${p.id}')">完成专项</button>` : ''}`,
    { size: 'modal-lg' });
};

/** 子任务勾选完成/恢复 */
UI.projectTaskSet = (ptId) => {
  const pt = NK.db.projectTasks.find(x => x.id === ptId);
  if (!pt) return;
  pt.status = pt.status === '已完成' ? '未开始' : '已完成';
  pt.updatedAt = NK.now();
  const p = NK.getProject(pt.projectId);
  if (p) NK.updateProjectProgress(p);
  NK.save();
  UI.projectDetail(pt.projectId);
};

/** 子任务指派工程师 */
UI.projectTaskAssign = (ptId, name) => {
  const pt = NK.db.projectTasks.find(x => x.id === ptId);
  if (!pt || !name) return;
  pt.engineer = name;
  pt.updatedAt = NK.now();
  NK.save();
  UI.toast(`已指派 ${NK.v.engName(name)} ✓`);
  UI.projectDetail(pt.projectId);
};

/** 子任务反馈 */
UI.projectTaskFeedback = (ptId) => {
  const pt = NK.db.projectTasks.find(x => x.id === ptId);
  if (!pt) return;
  UI.modal(`子任务反馈`, `
    <p><b>${NK.esc(pt.name)}</b></p>
    <div class="form-item"><label>反馈内容</label><textarea id="ptfText" placeholder="完成情况、遗留问题…">${NK.esc(pt.feedback || '')}</textarea></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="ptfOk">保存</button>`, {
    onMount(root) {
      root.querySelector('#ptfOk').onclick = () => {
        pt.feedback = root.querySelector('#ptfText').value.trim();
        pt.status = '已完成';
        pt.updatedAt = NK.now();
        const p = NK.getProject(pt.projectId);
        if (p) NK.updateProjectProgress(p);
        NK.save();
        UI.toast('花姐，子任务反馈已保存 ✓');
        UI.modalClose();
        UI.projectDetail(pt.projectId);
      };
    },
  });
};

/** 更新专项进度 */
UI.projectProgress = (id) => {
  const p = NK.getProject(id);
  if (!p) return;
  UI.modal(`更新进度 · ${p.name}`, `
    <div class="form-item"><label>完成度 %（0-100）</label><input id="ppPct" type="number" min="0" max="100" value="${p.progress || 0}"></div>
    <div class="form-item"><label>状态</label><select id="ppStatus">${NK.PROJECT_STATUS.map(s => `<option ${p.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="form-item"><label>风险说明（可选）</label><input id="ppRisk" value="${NK.esc(p.risk || '')}" placeholder="如：某地供应商延迟"></div>
    <div class="form-item"><label>下一步计划</label><input id="ppNext" value="${NK.esc(p.nextAction || '')}"></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="ppOk">保存</button>`, {
    onMount(root) {
      root.querySelector('#ppOk').onclick = () => {
        p.progress = Math.max(0, Math.min(100, parseInt(root.querySelector('#ppPct').value || 0)));
        p.status = root.querySelector('#ppStatus').value;
        p.risk = root.querySelector('#ppRisk').value.trim();
        p.nextAction = root.querySelector('#ppNext').value.trim();
        p.updatedAt = NK.now();
        NK.save();
        UI.toast('花姐，专项进度已更新 ✓');
        UI.modalClose();
        UI.renderProjects();
        UI.refreshBadges();
      };
    },
  });
};

/** 标记风险 */
UI.projectMarkRisk = (id) => {
  const p = NK.getProject(id);
  if (!p) return;
  UI.modal(`标记风险 · ${p.name}`, `
    <div class="form-item"><label>风险说明</label><textarea id="prText" placeholder="描述风险点、影响范围、需要的支持…"></textarea></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="prOk">标记有风险</button>`, {
    onMount(root) {
      root.querySelector('#prOk').onclick = () => {
        p.status = '有风险';
        p.risk = root.querySelector('#prText').value.trim() || '已标记风险';
        p.updatedAt = NK.now();
        NK.save();
        UI.toast('花姐，已标记为有风险 ⚠');
        UI.modalClose();
        UI.renderProjects();
      };
    },
  });
};

/** 完成专项 */
UI.projectFinish = (id) => {
  const p = NK.getProject(id);
  if (!p) return;
  UI.confirm(`确认专项「${p.name}」已完成？`, () => {
    p.status = '已完成';
    p.progress = 100;
    p.updatedAt = NK.now();
    NK.getProjectTasks(id).forEach(pt => { if (pt.status !== '已完成') pt.status = '已完成'; });
    NK.save();
    UI.toast('花姐，专项已完成 ✓');
    UI.modalClose();
    UI.renderProjects();
  });
};

/* ============================================================
   查资源密码锁
   ============================================================ */
/** 读取密码存储（独立 key，不混入主数据，避免影响备份/重置） */
UI.resStore = () => {
  try { const raw = localStorage.getItem(NK.LS_KEY + '-reslock'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
};
/** 密码编码存储（非明文，但纯前端无法防住开发者工具） */
UI.resHash = (pwd) => { try { return btoa(unescape(encodeURIComponent('nk·' + pwd))); } catch (e) { return 'e:' + String(pwd).length; } };
/** 是否已解锁（内存 + sessionStorage：刷新页面保持，关闭浏览器后需重输） */
UI.resUnlocked = () => {
  if (UI._resUnlocked) return true;
  try { if (sessionStorage.getItem(NK.LS_KEY + '-resok') === '1') { UI._resUnlocked = true; return true; } } catch (e) {}
  return false;
};
UI.resUnlockNow = () => {
  UI._resUnlocked = true;
  try { sessionStorage.setItem(NK.LS_KEY + '-resok', '1'); } catch (e) {}
};
/** 锁界面：未设置密码 → 设置表单；已设置 → 输入密码表单 */
UI.resLockHTML = () => {
  const el = document.getElementById('view-resources');
  const has = !!UI.resStore();
  el.innerHTML = UI.pageHead('工程师与职场', '查资源 · 密码保护') + `
    <div class="res-lock">
      <div class="res-lock-ico">🔒</div>
      <div class="res-lock-title">${has ? '请输入访问密码' : '首次使用，请设置访问密码'}</div>
      <div class="res-lock-sub">${has ? '密码正确后才能查看工程师与职场信息' : '设置后，「查资源」页面将需要密码才能进入'}</div>
      ${has ? `
      <input class="res-lock-input" id="resPwdIn" type="password" placeholder="输入密码" autocomplete="off">
      <button class="btn btn-accent btn-block" onclick="UI.resUnlock()">解锁进入</button>
      <div class="res-lock-links"><span onclick="UI.resChangePwd()">修改密码</span></div>` : `
      <input class="res-lock-input" id="resPwdNew" type="password" placeholder="设置新密码（至少 4 位）" autocomplete="off">
      <input class="res-lock-input" id="resPwdNew2" type="password" placeholder="再次输入确认" autocomplete="off">
      <button class="btn btn-accent btn-block" onclick="UI.resSetPwd()">设置密码并进入</button>`}
      <div class="res-lock-tip">解锁状态在当前浏览器会话内保持（关闭浏览器后需重新输入）</div>
    </div>`;
  const bindEnter = (id, fn) => { const i = document.getElementById(id); if (i) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') fn(); }); };
  if (has) bindEnter('resPwdIn', () => UI.resUnlock());
  else { bindEnter('resPwdNew', () => UI.resSetPwd()); bindEnter('resPwdNew2', () => UI.resSetPwd()); }
};
/** 首次设置密码 */
UI.resSetPwd = () => {
  const p1 = document.getElementById('resPwdNew'), p2 = document.getElementById('resPwdNew2');
  if (!p1 || !p2) return;
  if (p1.value.length < 4) { UI.toast('密码至少 4 位', 'warn'); return; }
  if (p1.value !== p2.value) { UI.toast('两次输入不一致，请重新输入', 'warn'); return; }
  localStorage.setItem(NK.LS_KEY + '-reslock', JSON.stringify({ pwd: UI.resHash(p1.value), updatedAt: NK.now() }));
  UI.resUnlockNow();
  UI.toast('密码已设置');
  UI.renderResources();
};
/** 输入密码解锁 */
UI.resUnlock = () => {
  const st = UI.resStore();
  const inp = document.getElementById('resPwdIn');
  if (!st) { UI.toast('尚未设置密码，请先设置', 'warn'); UI.renderResources(); return; }
  if (!inp) return;
  if (UI.resHash(inp.value) === st.pwd) { UI.resUnlockNow(); UI.toast('解锁成功'); UI.renderResources(); }
  else { UI.toast('密码错误，请重试', 'warn'); inp.value = ''; inp.focus(); }
};
/** 修改密码弹窗（需旧密码） */
UI.resChangePwd = () => {
  const st = UI.resStore();
  UI.modal('修改访问密码',
    `<div class="form-item"><label>当前密码</label><input id="resOld" type="password" placeholder="输入当前密码" autocomplete="off"></div>
     <div class="form-item"><label>新密码</label><input id="resNew" type="password" placeholder="至少 4 位" autocomplete="off"></div>
     <div class="form-item"><label>确认新密码</label><input id="resNew2" type="password" placeholder="再次输入" autocomplete="off"></div>
     <div class="hint">${st ? '' : '当前尚未设置密码，可直接设置新密码'}</div>`,
    `<button class="btn" onclick="UI.modalClose()">取消</button><button class="btn btn-accent" onclick="UI.resChangePwdDo()">保存</button>`,
    { onMount(root) { const i = root.querySelector('#resNew'); if (i) i.focus(); } });
};
UI.resChangePwdDo = () => {
  const st = UI.resStore();
  const oldV = document.getElementById('resOld'), n1 = document.getElementById('resNew'), n2 = document.getElementById('resNew2');
  if (!n1 || !n2) return;
  if (st && UI.resHash(oldV.value) !== st.pwd) { UI.toast('当前密码不正确', 'warn'); return; }
  if (n1.value.length < 4) { UI.toast('新密码至少 4 位', 'warn'); return; }
  if (n1.value !== n2.value) { UI.toast('两次输入不一致', 'warn'); return; }
  localStorage.setItem(NK.LS_KEY + '-reslock', JSON.stringify({ pwd: UI.resHash(n1.value), updatedAt: NK.now() }));
  UI.modalClose();
  UI.toast('密码已更新');
  if (!UI.resUnlocked()) UI.renderResources();
};
/** 关闭密码保护弹窗（需旧密码） */
UI.resClearPwd = () => {
  const st = UI.resStore();
  UI.modal('关闭密码保护',
    `<div class="form-item"><label>当前密码</label><input id="resOld" type="password" placeholder="输入当前密码以确认关闭" autocomplete="off"></div>
     <div class="hint">关闭后「查资源」将不再需要密码。${st ? '' : '当前本就未设置密码。'}</div>`,
    `<button class="btn" onclick="UI.modalClose()">取消</button><button class="btn btn-danger" onclick="UI.resClearPwdDo()">关闭密码</button>`);
};
UI.resClearPwdDo = () => {
  const st = UI.resStore();
  if (!st) { UI.toast('当前未设置密码', 'warn'); UI.modalClose(); return; }
  const oldV = document.getElementById('resOld');
  if (UI.resHash(oldV.value) !== st.pwd) { UI.toast('当前密码不正确', 'warn'); return; }
  localStorage.removeItem(NK.LS_KEY + '-reslock');
  UI.toast('密码保护已关闭');
  UI.modalClose();
  UI.renderResources();
};
/** 忘记密码重置（设置页入口，二次确认后清除，任何人都可重新设置） */
UI.resResetPwd = () => {
  UI.confirm('确定要重置「查资源」密码吗？重置后任何人都可直接设置新密码进入。', () => {
    localStorage.removeItem(NK.LS_KEY + '-reslock');
    UI._resUnlocked = false;
    try { sessionStorage.removeItem(NK.LS_KEY + '-resok'); } catch (e) {}
    UI.toast('密码已重置，请重新设置');
    UI.renderSettings();
  }, '重置密码');
};
/** 从设置页跳转去首次设置密码 */
UI.resSetupFromSettings = () => { UI.nav('resources'); };

/* ============================================================
   工程师与职场（含：工程师 / 职场 / 休假记录 三页签）
   ============================================================ */
UI.resTab = 'eng';   // eng | site | leave

UI.renderResources = () => {
  if (!UI.resUnlocked()) { UI.resLockHTML(); return; }
  const el = document.getElementById('view-resources');
  el.innerHTML = UI.pageHead('工程师与职场', `全国 ${NK.db.sites.length} 个职场 · ${NK.db.engineers.length} 名工程师 · 一次录入多处复用`,
    `<button class="btn" onclick="UI.engAdd()">新增工程师</button><button class="btn btn-accent" onclick="UI.siteAdd()">新增职场</button>`) +
    `<div class="res-tabs">
      <button class="res-tab${UI.resTab === 'eng' ? ' active' : ''}" onclick="UI.resSetTab('eng')">工程师</button>
      <button class="res-tab${UI.resTab === 'site' ? ' active' : ''}" onclick="UI.resSetTab('site')">职场</button>
      <button class="res-tab${UI.resTab === 'leave' ? ' active' : ''}" onclick="UI.resSetTab('leave')">休假记录</button>
    </div>
    <div id="resTabBody"></div>`;
  UI.resRenderTab();
};

UI.resSetTab = (t) => { UI.resTab = t; UI.renderResources(); };

UI.resRenderTab = () => {
  const body = document.getElementById('resTabBody');
  if (!body) return;
  if (UI.resTab === 'leave') { UI.renderLeaveRecords(body); return; }
  const q = (NK.resQ || '').trim().toLowerCase();
  const today = NK.today();

  if (UI.resTab === 'eng') {
    const engCards = NK.db.engineers.map(e => {
      const v = NK.v.eng(e);
      const sites = NK.sitesByEngineer(e.name);
      const active = NK.db.dispatches.filter(d => d.engineer === e.name && NK.dispatchActive(d)).length;
      const kpi = NK.computeKpi(e.name, NK.curMonth());
      const onsite = e.onsiteRegions.filter(r => r).join(' / ') || '—';
      const remote = e.remoteRegions.filter(r => r).join(' / ') || '—';
      if (q && !`${e.name}${e.phone}${onsite}${remote}`.toLowerCase().includes(q)) return '';
      return `<div class="eng-card" onclick="UI.engDetail('${e.id}')">
        <div class="ec-head"><div class="ec-avatar">${NK.esc(v.name.slice(0, 1))}</div>
          <div><div class="ec-name">${NK.esc(v.name)} <span class="badge gray">${NK.esc(v.phone)}</span></div>
          <div class="ec-phone">驻场：${NK.esc(onsite)}</div>
          <div class="ec-phone">远程：${NK.esc(remote)}</div></div></div>
        <div class="ec-stats">
          <div class="ec-stat"><div class="ec-stat-val">${sites.length}</div><div class="ec-stat-label">职场</div></div>
          <div class="ec-stat"><div class="ec-stat-val">${active}</div><div class="ec-stat-label">进行中派单</div></div>
          <div class="ec-stat"><div class="ec-stat-val" style="color:${kpi.final < 90 ? 'var(--warn)' : 'var(--accent)'}">${kpi.final}</div><div class="ec-stat-label">本月KPI</div></div>
        </div>
      </div>`;
    }).filter(Boolean).join('');
    body.innerHTML = `<div class="card"><div class="card-head"><div class="card-title">工程师（${NK.db.engineers.length}）</div></div>
      <div class="card-body"><div class="eng-grid">${engCards || '<div class="tbl-empty" style="padding:20px">无匹配工程师</div>'}</div></div></div>
      <div class="filter-bar">
        <input class="fb-input" id="resSearch" placeholder="搜索工程师 / 姓名 / 电话 / 区域…" value="${NK.esc(NK.resQ || '')}">
        <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">工程师 ${engCards ? NK.db.engineers.length : 0} 名</span>
      </div>`;
  } else {
    // 职场
    const sites = NK.db.sites.filter(s => {
      if (!q) return true;
      return `${s.id} ${s.name} ${s.city} ${s.province} ${s.address} ${s.contactName} ${s.contactPhone} ${s.defaultEngineer} ${s.remark}`.toLowerCase().includes(q);
    });
    const siteRows = sites.map(s => {
      const v = NK.v.site(s);
      const sup = NK.siteSupport(s);
      const siteDisps = NK.db.dispatches.filter(d => d.siteId === s.id && NK.dispatchActive(d));
      return `<tr>
        <td><div style="font-weight:600">${NK.esc(v.name)}</div><div class="num" style="font-size:11px">${s.id}</div></td>
        <td>${NK.esc(s.province)} · ${NK.esc(s.city)}</td>
        <td style="max-width:220px">${NK.esc(v.address)}</td>
        <td>${NK.esc(v.contactName)}<div class="num">${NK.esc(v.contactPhone)}</div></td>
        <td>${sup.type === '驻场' ? `<span class="badge accent">驻场</span>` : `<span class="badge gray">${NK.esc(s.supportType || '远程')}</span>`}${s.needDispatch ? '' : '<div style="font-size:10px;color:var(--text-3)">无需派单</div>'}</td>
        <td>${NK.esc(v.defaultEngineer || '—')}</td>
        <td>${UI.statusBadge(s.status || '正常')}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-sm" onclick="UI.siteDetail('${s.id}')">详情</button>
          ${s.needDispatch ? `<button class="btn btn-sm btn-accent" onclick="UI.dispatchCreate('${s.id}')">派单</button>` : ''}
          ${siteDisps.length ? `<span class="num" style="font-size:11px">${siteDisps.length} 单进行中</span>` : ''}
        </td>
      </tr>`;
    }).join('');
    body.innerHTML = `<div class="filter-bar">
      <input class="fb-input" id="resSearch" placeholder="搜索职场 / 城市 / 工程师 / 联系人 / 电话…" value="${NK.esc(NK.resQ || '')}">
      <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">职场 ${sites.length} 个</span>
    </div>
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>职场</th><th>省市</th><th>地址</th><th>联系人</th><th>支持方式</th><th>默认工程师</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${siteRows || UI.empty('未找到匹配的职场', 8)}</tbody>
    </table></div></div>`;
  }

  const inp = document.getElementById('resSearch');
  if (inp) inp.addEventListener('input', NK.debounce(() => {
    NK.resQ = inp.value;
    UI.resRenderTab();
    setTimeout(() => { const i = document.getElementById('resSearch'); if (i) i.focus(); }, 0);
  }, 250));
};

/** 职场详情 */
UI.siteDetail = (id) => {
  const s = NK.getSite(id);
  if (!s) return;
  const v = NK.v.site(s);
  const sup = NK.siteSupport(s);
  const disps = NK.db.dispatches.filter(d => d.siteId === s.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  UI.modal(`职场详情`, `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      <span style="font-size:17px;font-weight:700">${NK.esc(v.name)}</span>
      ${UI.statusBadge(s.status || '正常')} ${sup.type === '驻场' ? '<span class="badge accent">驻场</span>' : '<span class="badge gray">远程</span>'}
      ${s.needDispatch ? '' : '<span class="badge gray">无需派单</span>'}</div>
    <div class="detail-grid">
      <div class="dg-item"><div class="dg-label">省市</div><div class="dg-val">${NK.esc(s.province)} · ${NK.esc(s.city)}</div></div>
      <div class="dg-item"><div class="dg-label">编号</div><div class="dg-val num">${s.id}</div></div>
      <div class="dg-item"><div class="dg-label">联系人</div><div class="dg-val">${NK.esc(v.contactName)}</div></div>
      <div class="dg-item"><div class="dg-label">联系电话</div><div class="dg-val">${NK.esc(v.contactPhone)}</div></div>
      <div class="dg-item"><div class="dg-label">默认工程师</div><div class="dg-val">${NK.esc(v.defaultEngineer || '—')}</div></div>
      <div class="dg-item"><div class="dg-label">派单规则</div><div class="dg-val">${NK.esc(s.dispatchRule || '—')}</div></div>
    </div>
    <div class="hint">地址：${NK.esc(v.address)}</div>
    ${s.remark ? `<div class="hint">备注：${NK.esc(s.remark)}</div>` : ''}
    <div class="card-head" style="margin-top:12px"><div class="card-title">该职场派单记录（${disps.length}）</div></div>
    <div class="card-body flush" style="max-height:260px;overflow:auto">${disps.length ? disps.slice(0, 15).map(d => `
      <div class="focus-item">
        ${UI.priBadge(d.priority)}
        <div class="fi-main"><div class="fi-title">${NK.esc(d.title)}</div>
        <div class="fi-meta">${d.no} · ${UI.statusBadge(NK.dispatchStatusLabel(d))} · ${NK.esc(NK.v.engName(d.engineer))} · ${d.createdAt.slice(0, 10)}</div></div>
        <div class="fi-actions"><button class="btn btn-sm" onclick="UI.dispatchDetail('${d.id}')">查看</button></div>
      </div>`).join('') : '<div class="tbl-empty" style="padding:20px">该职场暂无派单记录</div>'}</div>`,
    `<button class="btn" data-close>关闭</button>
     <button class="btn" onclick="UI.siteEdit('${s.id}')">编辑</button>
     ${s.needDispatch ? `<button class="btn btn-accent" onclick="UI.dispatchCreate('${s.id}')">派单</button>` : ''}`,
    { size: 'modal-lg' });
};

/** 编辑职场 */
UI.siteEdit = (id) => {
  const s = NK.getSite(id);
  if (!s) return;
  UI.modal(`编辑职场 · ${s.name}`, `
    <div class="form-grid">
      <div class="form-item"><label>联系人</label><input id="seContact" value="${NK.esc(s.contactName || '')}"></div>
      <div class="form-item"><label>联系电话</label><input id="sePhone" value="${NK.esc(s.contactPhone || '')}"></div>
    </div>
    <div class="form-grid">
      <div class="form-item"><label>支持方式</label><select id="seSupport">
        <option ${s.supportType === '驻场' ? 'selected' : ''}>驻场</option>
        <option ${s.supportType === '驻场巡检' ? 'selected' : ''}>驻场巡检</option>
        <option ${s.supportType === '远程' ? 'selected' : ''}>远程</option>
      </select></div>
      <div class="form-item"><label>默认工程师</label><select id="seEng">
        ${NK.db.engineers.map(e => `<option value="${NK.esc(e.name)}" ${s.defaultEngineer === e.name ? 'selected' : ''}>${NK.esc(NK.v.engName(e.name))}</option>`).join('')}
      </select></div>
    </div>
    <div class="form-grid">
      <div class="form-item"><label>职场状态</label><select id="seStatus">${NK.SITE_STATUS.map(x => `<option ${s.status === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
      <div class="form-item"><label>派单要求</label><select id="seDispatch"><option value="1" ${s.needDispatch ? 'selected' : ''}>需要派单</option><option value="0" ${!s.needDispatch ? 'selected' : ''}>无需派单</option></select></div>
    </div>
    <div class="form-item"><label>备注</label><textarea id="seRemark">${NK.esc(s.remark || '')}</textarea></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="seOk">保存</button>`, {
    onMount(root) {
      root.querySelector('#seOk').onclick = () => {
        s.contactName = root.querySelector('#seContact').value.trim();
        s.contactPhone = root.querySelector('#sePhone').value.trim();
        s.supportType = root.querySelector('#seSupport').value;
        s.defaultEngineer = root.querySelector('#seEng').value;
        s.status = root.querySelector('#seStatus').value;
        s.needDispatch = root.querySelector('#seDispatch').value === '1';
        s.remark = root.querySelector('#seRemark').value.trim();
        NK.save();
        UI.toast('花姐，职场信息已保存 ✓');
        UI.modalClose();
        UI.renderResources();
      };
    },
  });
};

/** 新增职场 */
UI.siteAdd = () => {
  UI.modal('新增职场', `
    <div class="form-grid">
      <div class="form-item"><label>省份 *</label><input id="saProv" placeholder="浙江省"></div>
      <div class="form-item"><label>城市 *</label><input id="saCity" placeholder="湖州市"></div>
    </div>
    <div class="form-item"><label>职场名称 *</label><input id="saName" placeholder="如：湖州职场"></div>
    <div class="form-item"><label>地址</label><input id="saAddr" placeholder="详细地址"></div>
    <div class="form-grid">
      <div class="form-item"><label>联系人</label><input id="saContact" placeholder="姓名：电话"></div>
      <div class="form-item"><label>支持方式</label><select id="saSupport"><option>远程</option><option>驻场</option><option>驻场巡检</option></select></div>
    </div>
    <div class="form-item"><label>默认工程师</label><select id="saEng"><option value="">未指定</option>${NK.db.engineers.map(e => `<option value="${NK.esc(e.name)}">${NK.esc(NK.v.engName(e.name))}</option>`).join('')}</select></div>
    <div class="form-item"><label>备注</label><textarea id="saRemark" placeholder="职场备注、撤场计划等"></textarea></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="saOk">创建职场</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#saOk').onclick = () => {
        const name = root.querySelector('#saName').value.trim();
        const city = root.querySelector('#saCity').value.trim();
        const prov = root.querySelector('#saProv').value.trim();
        if (!name || !city) { UI.toast('请填写职场名称与城市', 'warn'); return; }
        const contactRaw = root.querySelector('#saContact').value.trim();
        let contactName = contactRaw, contactPhone = '';
        if (contactRaw.includes('：')) { const p = contactRaw.split('：'); contactName = p[0]; contactPhone = p[1]; }
        else if (contactRaw.includes(':')) { const p = contactRaw.split(':'); contactName = p[0]; contactPhone = p[1]; }
        const eng = root.querySelector('#saEng').value;
        const id = NK.uid((prov.slice(0, 1) || '省') + (city.slice(0, 1) || '市'));
        NK.db.sites.push({
          id,
          province: prov, city,
          name, address: root.querySelector('#saAddr').value.trim(),
          contactName, contactPhone, contactRaw,
          defaultEngineer: eng,
          supportType: root.querySelector('#saSupport').value,
          needDispatch: root.querySelector('#saSupport').value === '驻场' || root.querySelector('#saSupport').value === '驻场巡检' ? true : !!eng,
          dispatchRule: root.querySelector('#saSupport').value === '驻场' ? '现场直接支持' : '远程支持，必要时现场',
          status: '正常', remark: root.querySelector('#saRemark').value.trim(),
        });
        NK.save();
        UI.toast('花姐，职场已创建 ✓');
        UI.modalClose();
        UI.renderResources();
      };
    },
  });
};

/** 工程师详情 */
UI.engDetail = (id) => {
  const e = NK.db.engineers.find(x => x.id === id);
  if (!e) return;
  const v = NK.v.eng(e);
  const sites = NK.sitesByEngineer(e.name);
  const disps = NK.db.dispatches.filter(d => d.engineer === e.name && !NK.dispatchInactive(d)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.engineer === e.name && t.status !== '已完成');
  const kpi = NK.computeKpi(e.name, NK.curMonth());
  // ── 休假情况（轻量）──
  const engLeaves = NK.leavesByEngineer(e.name).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const today = NK.today();
  const onLeaveNow = engLeaves.find(l => l.recordStatus === '有效' && l.startDate <= today && today <= l.endDate);
  const nextLeave = engLeaves.find(l => l.recordStatus === '有效' && l.startDate > today);
  const recentLeave = engLeaves.filter(l => l.recordStatus === '有效' && l.endDate < today)[0] || engLeaves.find(l => l.recordStatus === '有效');
  const hasCover = NK.engineerHasActiveCoverDispatch(e.name);
  const leaveHTML = `
    <div class="card-head" style="margin-top:12px"><div class="card-title">休假情况</div>
      <button class="btn btn-sm btn-accent" onclick="UI.leaveCreate('${e.id}')">＋ 登记休假</button></div>
    <div class="card-body">
      <div class="detail-grid">
        <div class="dg-item"><div class="dg-label">当前状态</div><div class="dg-val">${onLeaveNow ? `<span style="color:var(--warn);font-weight:600">🌴 休假中（${NK.esc(onLeaveNow.leavePeriod)}）</span>` : '<span class="num" style="color:var(--text-2)">在岗</span>'}</div></div>
        <div class="dg-item"><div class="dg-label">下一次休假</div><div class="dg-val">${nextLeave ? `${NK.esc(nextLeave.startDate)}${nextLeave.endDate !== nextLeave.startDate ? '~' + NK.esc(nextLeave.endDate) : ''}（${NK.esc(nextLeave.leavePeriod)}）` : '—'}</div></div>
        <div class="dg-item"><div class="dg-label">补位派单</div><div class="dg-val">${hasCover ? '<span style="color:var(--accent);font-weight:600">有进行中补位派单</span>' : '—'}</div></div>
        <div class="dg-item"><div class="dg-label">最近休假</div><div class="dg-val">${recentLeave ? `${NK.esc(recentLeave.startDate)}${recentLeave.endDate !== recentLeave.startDate ? '~' + NK.esc(recentLeave.endDate) : ''}` : '—'}</div></div>
      </div>
      ${engLeaves.length ? `<div class="num" style="font-size:11px;color:var(--text-3);margin-top:6px">共 ${engLeaves.length} 条休假记录，可在"休假记录"页签查看</div>` : ''}
    </div>`;

  UI.modal(`工程师详情`, `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <div class="ec-avatar" style="width:44px;height:44px;font-size:20px">${NK.esc(v.name.slice(0, 1))}</div>
      <div><div style="font-size:18px;font-weight:700">${NK.esc(v.name)}</div>
      <div class="num">${NK.esc(v.phone)}</div></div>
      <div style="margin-left:auto;text-align:right"><div class="kpi-score-big" style="color:${kpi.final < 90 ? 'var(--warn)' : 'var(--accent)'}">${kpi.final}</div><div style="font-size:11px;color:var(--text-3)">本月KPI</div></div>
    </div>
    <div class="detail-grid">
      <div class="dg-item"><div class="dg-label">驻场区域</div><div class="dg-val">${NK.esc((e.onsiteRegions || []).join(' / ') || '—')}</div></div>
      <div class="dg-item"><div class="dg-label">远程支持区域</div><div class="dg-val">${NK.esc((e.remoteRegions || []).join(' / ') || '—')}</div></div>
      <div class="dg-item"><div class="dg-label">负责职场</div><div class="dg-val">${sites.length} 个</div></div>
      <div class="dg-item"><div class="dg-label">待办任务</div><div class="dg-val">${tasks.length} 个</div></div>
    </div>
    ${leaveHTML}
    ${sites.length ? `<div class="card-head" style="margin-top:12px"><div class="card-title">负责职场（${sites.length}）</div></div>
      <div class="card-body flush" style="max-height:180px;overflow:auto">${sites.map(s => `
        <div class="focus-item"><span class="badge gray">${NK.esc(s.city)}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(NK.v.siteName(s.name))}</div>
        <div class="fi-meta">${NK.esc(s.contactName)} ${NK.esc(NK.v.phone(s.contactPhone))}</div></div>
        <div class="fi-actions"><button class="btn btn-sm" onclick="UI.siteDetail('${s.id}')">详情</button></div></div>`).join('')}</div>` : ''}
    ${disps.length ? `<div class="card-head" style="margin-top:12px"><div class="card-title">最近派单</div></div>
      <div class="card-body flush" style="max-height:180px;overflow:auto">${disps.slice(0, 10).map(d => `
        <div class="focus-item">${UI.priBadge(d.priority)}
        <div class="fi-main"><div class="fi-title">${NK.esc(d.title)}</div>
        <div class="fi-meta">${d.no} · ${UI.statusBadge(NK.dispatchStatusLabel(d))} · ${d.createdAt.slice(0, 10)}</div></div>
        <div class="fi-actions"><button class="btn btn-sm" onclick="UI.dispatchDetail('${d.id}')">查看</button></div></div>`).join('')}</div>` : ''}`,
    `<button class="btn" data-close>关闭</button>`,
    { size: 'modal-lg' });
};

/** 新增工程师 */
UI.engAdd = () => {
  UI.modal('新增工程师', `
    <div class="form-grid">
      <div class="form-item"><label>姓名 *</label><input id="eaName"></div>
      <div class="form-item"><label>联系电话 *</label><input id="eaPhone" placeholder="13800000000"></div>
    </div>
    <div class="form-item"><label>驻场区域（多个用、分隔）</label><input id="eaOnsite" placeholder="如：湖州、上海"></div>
    <div class="form-item"><label>远程支持区域</label><input id="eaRemote" placeholder="如：南京、苏州"></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="eaOk">创建工程师</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#eaOk').onclick = () => {
        const name = root.querySelector('#eaName').value.trim();
        const phone = root.querySelector('#eaPhone').value.trim();
        if (!name || !phone) { UI.toast('请填写姓名与电话', 'warn'); return; }
        const split = (s) => s.split(/[、,，\/]/).map(x => x.trim()).filter(Boolean);
        NK.db.engineers.push({
          id: NK.uid('E'),
          name, phone,
          onsiteRegions: split(root.querySelector('#eaOnsite').value),
          remoteRegions: split(root.querySelector('#eaRemote').value),
          onsiteRaw: root.querySelector('#eaOnsite').value, remoteRaw: root.querySelector('#eaRemote').value,
        });
        NK.save();
        UI.toast('花姐，工程师已创建 ✓');
        UI.modalClose();
        UI.renderResources();
      };
    },
  });
};

/* ============================================================
   休假记录（Leave）
   ============================================================ */
UI.leaveStatusBadge = (st) => {
  const map = {
    '无需派单': 'ok', '已创建派单': 'done', '待创建派单': 'warn', '未判断': 'gray', '已取消': 'gray',
  };
  const label = st === '已创建派单' ? '已安排补位' : st;
  return `<span class="badge ${map[st] || 'gray'}">${label}</span>`;
};

/** 休假记录列表 */
UI.renderLeaveRecords = (body, opts) => {
  opts = opts || {};
  const hideCreateBtn = !!opts.hideCreateBtn;
  if (body && body.dataset) body.dataset.hideLeaveCreateBtn = hideCreateBtn ? '1' : '';
  const f = NK.leaveFilter = NK.leaveFilter || { scope: '全部' };
  const scope = f.scope || '全部';
  const today = NK.today();
  const month = today.slice(0, 7);
  let list = [...NK.db.leaves].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt));
  if (scope === '今天') list = list.filter(l => l.recordStatus === '有效' && NK.leavesOnDate(today).some(x => x.leaveId === l.leaveId));
  else if (scope === '明天') list = list.filter(l => l.recordStatus === '有效' && NK.leavesTomorrow().some(x => x.leaveId === l.leaveId));
  else if (scope === '本月') list = list.filter(l => l.startDate.slice(0, 7) === month || l.endDate.slice(0, 7) === month);
  else if (scope === '待安排补位') list = list.filter(l => l.recordStatus === '有效' && l.dispatchStatus === '待创建派单');

  const scopes = ['全部', '今天', '明天', '本月', '待安排补位'];
  const rows = list.map(l => {
    const vName = NK.v.engName(l.engineerName);
    const sitesLabel = (l.responsibleSitesSnapshot || []).map(s => NK.v.siteName(s.siteName)).join('、') || '—';
    const days = NK.daysBetween(l.startDate, l.endDate) + 1;
    const linked = l.relatedDispatchId ? NK.getDispatch(l.relatedDispatchId) : null;
    const actBtns = [
      `<button class="btn btn-sm" onclick="UI.leaveDetail('${l.leaveId}')">查看</button>`,
      l.recordStatus === '有效' ? `<button class="btn btn-sm" onclick="UI.leaveEdit('${l.leaveId}')">编辑</button>` : '',
      l.recordStatus === '有效' && l.dispatchStatus === '待创建派单' ? `<button class="btn btn-sm btn-accent" onclick="UI.leaveCreateDispatch('${l.leaveId}')">创建补位派单</button>` : '',
      linked ? `<button class="btn btn-sm" onclick="UI.dispatchDetail('${linked.id}')">查看关联派单</button>` : '',
      l.recordStatus === '有效' ? `<button class="btn btn-sm btn-danger" onclick="UI.leaveCancel('${l.leaveId}')">取消休假</button>` : '',
    ].filter(Boolean).join('');
    return `<tr>
      <td><div style="font-weight:600">${NK.esc(vName)}</div>${l.recordStatus === '已取消' ? '<div style="font-size:10px;color:var(--text-3)">已取消</div>' : ''}</td>
      <td>${NK.esc(l.startDate)}<div class="num" style="font-size:11px">${l.endDate !== l.startDate ? '至 ' + NK.esc(l.endDate) : ''}</div></td>
      <td>${NK.esc(l.leavePeriod)}<div class="num" style="font-size:11px">${days} 天</div></td>
      <td>${NK.esc(sitesLabel)}</td>
      <td>${UI.leaveStatusBadge(l.dispatchStatus)}</td>
      <td>${linked ? `<a href="javascript:void(0)" onclick="UI.dispatchDetail('${linked.id}')">${NK.esc(linked.no)}</a>` : (l.dispatchStatus === '待创建派单' ? `<button class="btn btn-sm btn-accent" onclick="UI.leaveCreateDispatch('${l.leaveId}')">去创建</button>` : '—')}</td>
      <td>${l.remark ? `<span title="${NK.esc(l.remark)}">${NK.esc(String(l.remark).slice(0, 12))}${String(l.remark).length > 12 ? '…' : ''}</span>` : '—'}</td>
      <td style="white-space:nowrap">${actBtns}</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <div class="leave-toolbar">
      <div class="leave-scopes">
        ${scopes.map(s => `<button class="res-tab${scope === s ? ' active' : ''}" onclick="NK.leaveFilter.scope='${s}';UI.renderLeaveRecords(document.getElementById('${body.id}'), {hideCreateBtn: document.getElementById('${body.id}').dataset.hideLeaveCreateBtn === '1'})">${s}</button>`).join('')}
      </div>
      ${hideCreateBtn ? '' : `<div style="display:flex;gap:8px">
        <button class="btn btn-accent" onclick="UI.leaveCreate()">＋ 登记休假</button>
      </div>`}
    </div>
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>工程师</th><th>开始日期</th><th>时段</th><th>负责职场</th><th>补位状态</th><th>关联派单</th><th>备注</th><th>操作</th></tr></thead>
      <tbody>${rows || UI.empty(list.length ? '无匹配休假记录' : '还没有休假记录，点击右上角「登记休假」记录第一条 🌴', 8)}</tbody>
    </table></div></div>`;
};

/** 独立「休假与补位」管理页面（左侧一级菜单） */
UI.renderLeave = () => {
  const el = document.getElementById('view-leave');
  el.innerHTML = UI.pageHead('工程师休假与补位管理', '记录工程师休假安排，及时确认驻场支持是否需要补位。',
    `<button class="btn btn-accent" onclick="UI.leaveCreate()">＋ 登记休假</button>`) +
    `<div id="leaveTabBody"></div>`;
  UI.renderLeaveRecords(document.getElementById('leaveTabBody'), { hideCreateBtn: true });
};

/** 休假数据变更后，刷新当前所在页面（独立休假页 或 工程师页内的休假记录页签） */
UI.refreshLeaveView = () => {
  if (NK.currentView === 'leave') { UI.renderLeave(); return; }
  if (NK.currentView === 'resources') { UI.renderResources(); return; }
  UI.nav('leave');
};

/** 登记休假弹窗（极简表单 + 是否需要派单判断） */
UI.leaveCreate = (prefillEngName) => {
  // 防重复：若栈中已存在一个打开的休假登记弹窗，则不重复打开，避免连点/重复事件产生多个窗口
  for (let i = UI.__stack.length - 1; i >= 0; i--) {
    const en = UI.__stack[i];
    if (en && en.layer && en.layer.innerHTML && en.layer.innerHTML.includes('lvEng') && en.layer.innerHTML.includes('登记休假')) {
      try { if (typeof en.layer.classList !== 'undefined' && en.layer.classList.remove) en.layer.classList.remove('hidden'); } catch (e) {}
      return;
    }
  }
  let initSnapshot = null;
  const engOpts = NK.db.engineers.map(e => `<option value="${NK.esc(e.id)}" ${prefillEngName && e.name === prefillEngName ? 'selected' : ''}>${NK.esc(NK.v.engName(e.name))}</option>`).join('');
  const today = NK.today();
  const body = `
    <div class="form-item"><label>休假工程师</label>
      <select id="lvEng" onchange="UI.leaveEngChanged()">${engOpts}</select>
      <div id="lvEngSum" class="hint" style="margin-top:4px"></div>
    </div>
    <div class="form-grid">
      <div class="form-item"><label>开始日期 *</label><input type="date" id="lvStart" value="${today}" onchange="UI.leaveDateChanged()"></div>
      <div class="form-item"><label>结束日期 *</label><input type="date" id="lvEnd" value="${today}" onchange="UI.leaveDateChanged()"></div>
    </div>
    <div class="form-item"><label>休假时段</label>
      <select id="lvPeriod" onchange="UI.leaveDateChanged()"><option>全天</option><option>上午</option><option>下午</option></select>
    </div>
    <div class="form-item"><label>备注</label><textarea id="lvRemark" rows="2" placeholder="需要补充的工作安排，可不填。"></textarea></div>
    <div id="lvSuggest" class="leave-suggest" style="display:none"></div>
    <div id="lvDispatchAsk" class="leave-dispatch-ask" style="display:none">
      <div class="leave-ask-title">该工程师休假期间，是否需要安排补位派单？</div>
      <div id="lvAskInfo" class="leave-ask-info"></div>
      <div class="leave-ask-btns">
        <button class="btn btn-accent" id="lvNeedDispatch">需要，创建补位派单</button>
        <button class="btn" id="lvNoDispatch">不需要，只记录休假</button>
      </div>
    </div>`;
  UI.modal('登记休假', body,
    `<button class="btn" data-close>取消</button>`,
    { size: 'modal-md',
      onBeforeClose(close, reason) {
        try {
          const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
          const now = { eng: g('lvEng'), s: g('lvStart'), e: g('lvEnd'), p: g('lvPeriod'), r: document.getElementById('lvRemark') ? document.getElementById('lvRemark').value : '' };
          const same = now.eng === initSnapshot.eng && now.s === initSnapshot.s && now.e === initSnapshot.e && now.p === initSnapshot.p && now.r === initSnapshot.r;
          if (!same) { UI.confirmDiscard('当前休假登记还没有保存，确定放弃吗？'); return; }
        } catch (e) {}
        close();
      },
      onMount(root) {
      // 记录初始快照（未保存判断基准）
      initSnapshot = (() => {
        const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        return { eng: g('lvEng'), s: g('lvStart'), e: g('lvEnd'), p: g('lvPeriod'), r: document.getElementById('lvRemark') ? document.getElementById('lvRemark').value : '' };
      })();
      UI.leaveEngChanged();
      UI.leaveDateChanged();
      root.querySelector('#lvNeedDispatch').onclick = () => UI.leaveSave(true, root);
      root.querySelector('#lvNoDispatch').onclick = () => UI.leaveSave(false, root);
    } });
};

/** 工程师选择变化：显示摘要 */
UI.leaveEngChanged = () => {
  const sel = document.getElementById('lvEng');
  if (!sel) return;
  const eng = NK.db.engineers.find(e => e.id === sel.value);
  const sum = document.getElementById('lvEngSum');
  if (!eng || !sum) return;
  const sites = NK.sitesByEngineer(eng.name);
  const onsite = (eng.onsiteRegions || []).join('、') || '—';
  const remote = (eng.remoteRegions || []).join('、') || '—';
  const sitesLabel = sites.map(s => NK.v.siteName(s.name)).join('、') || '—';
  sum.innerHTML = `<b>${NK.esc(NK.v.engName(eng.name))}</b> · 驻场：${NK.esc(onsite)} · 远程：${NK.esc(remote)}<br>负责职场：${NK.esc(sitesLabel)}`;
  UI.leaveDateChanged();
};

/** 日期/时段变化：更新天数、建议、是否需要派单询问 */
UI.leaveDateChanged = () => {
  const engSel = document.getElementById('lvEng');
  const start = document.getElementById('lvStart');
  const end = document.getElementById('lvEnd');
  const period = document.getElementById('lvPeriod');
  if (!engSel || !start || !end || !period) return;
  const eng = NK.db.engineers.find(e => e.id === engSel.value);
  const days = NK.daysBetween(start.value, end.value) + 1;
  // 结束日期不得早于开始
  if (end.value && start.value && end.value < start.value) end.value = start.value;
  const tips = eng ? NK.leaveSuggestions(eng, start.value, end.value, period.value) : [];
  const sug = document.getElementById('lvSuggest');
  if (sug) {
    sug.innerHTML = tips.map(t => `<div class="ls-tip">· ${NK.esc(t)}</div>`).join('');
    sug.style.display = tips.length ? '' : 'none';
  }
  // 询问是否需要派单（每次登记都必须出现）
  const ask = document.getElementById('lvDispatchAsk');
  const info = document.getElementById('lvAskInfo');
  if (ask && info && eng) {
    const sites = NK.sitesByEngineer(eng.name);
    const sitesLabel = sites.map(s => NK.v.siteName(s.name)).join('、') || '（无固定驻场职场）';
    info.textContent = `${eng.name}负责 ${sitesLabel}。本次休假：${start.value} 至 ${end.value}，共 ${days} 天。`;
    ask.style.display = '';
  }
};

/** 保存休假。needDispatch: true=需要派单，false=无需派单 */
UI.leaveSave = (needDispatch, root) => {
  const engSel = root.querySelector('#lvEng');
  const start = root.querySelector('#lvStart');
  const end = root.querySelector('#lvEnd');
  const period = root.querySelector('#lvPeriod');
  const remark = root.querySelector('#lvRemark');
  if (!engSel.value) { UI.toast('请选择休假工程师', 'warn'); return; }
  if (!start.value || !end.value) { UI.toast('请选择休假日期', 'warn'); return; }
  if (end.value < start.value) { UI.toast('结束日期不能早于开始日期', 'warn'); return; }
  // 1) 先保存休假记录（无论是否派单，先落库，避免跳转派单后数据丢失）
  const rec = NK.createLeave({
    engineerId: engSel.value,
    startDate: start.value,
    endDate: end.value,
    leavePeriod: period.value,
    remark: remark.value.trim(),
    dispatchRequired: needDispatch ? '是' : '否',
    dispatchStatus: needDispatch ? '待创建派单' : '无需派单',
  });
  if (!rec) { UI.toast('保存失败，请重试', 'warn'); return; }
  UI.modalClose();
  UI.toast('花姐，休假记录已经记下来了。🌴');
  UI.refreshLeaveView();
  if (needDispatch) {
    // 2) 需要派单：跳转到现有派单页面并预填该工程师的职场与补位原因
    UI.leaveCreateDispatch(rec.leaveId);
  }
};

/** 创建补位派单：预填休假工程师负责职场 + 补位原因 */
UI.leaveCreateDispatch = (leaveId) => {
  const l = NK.getLeave(leaveId);
  if (!l) return;
  const sites = (l.responsibleSitesSnapshot || []).slice();
  if (!sites.length) { UI.toast('该工程师无固定驻场职场，可直接手动派单', 'warn'); UI.nav('dispatch'); return; }
  if (sites.length === 1) {
    // 单一职场：直接带出
    const site = NK.getSite(sites[0].siteId);
    UI.dispatchCreate(sites[0].siteId, {
      prefillReason: `${l.engineerName}于${l.startDate}至${l.endDate}休假，需安排${NK.v.siteName(sites[0].siteName)}IT现场支持补位。`,
      excludeEngineer: l.engineerName,
      leaveId: l.leaveId,
    });
  } else {
    // 多职场：先让花姐选择本次为哪些职场安排补位
    const opts = sites.map(s => `<label class="leave-site-chk"><input type="checkbox" value="${s.siteId}"> ${NK.esc(NK.v.siteName(s.siteName))} <span class="num" style="font-size:11px;color:var(--text-3)">${NK.esc(s.city)} · ${NK.esc(s.supportType)}</span></label>`).join('');
    UI.modal('本次需要为哪些职场安排补位？', `<div class="leave-site-picker">${opts}</div>`,
      `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="lsOk">下一步</button>`, {
      onMount(root) {
        root.querySelector('#lsOk').onclick = () => {
          const picked = [...root.querySelectorAll('input:checked')].map(i => i.value);
          if (!picked.length) { UI.toast('请至少选择一个职场', 'warn'); return; }
          UI.modalClose();
          const site = NK.getSite(picked[0]);
          UI.dispatchCreate(site.id, {
            prefillReason: `${l.engineerName}于${l.startDate}至${l.endDate}休假，需安排${NK.v.siteName(site.name)}IT现场支持补位。`,
            excludeEngineer: l.engineerName,
            leaveId: l.leaveId,
          });
        };
      },
    });
  }
};

/** 休假记录详情 */
UI.leaveDetail = (leaveId) => {
  const l = NK.getLeave(leaveId);
  if (!l) return;
  const linked = l.relatedDispatchId ? NK.getDispatch(l.relatedDispatchId) : null;
  const sitesLabel = (l.responsibleSitesSnapshot || []).map(s => `${NK.v.siteName(s.siteName)}（${s.city}）`).join('、') || '—';
  const days = NK.daysBetween(l.startDate, l.endDate) + 1;
  const vName = NK.v.engName(l.engineerName);
  UI.modal(`休假记录 · ${vName}`, `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
      <span style="font-size:16px;font-weight:700">${NK.esc(vName)}</span>
      ${l.recordStatus === '已取消' ? '<span class="badge gray">已取消</span>' : '<span class="badge ok">休假中/计划中</span>'}
      ${UI.leaveStatusBadge(l.dispatchStatus)}
    </div>
    <div class="detail-grid">
      <div class="dg-item"><div class="dg-label">休假日期</div><div class="dg-val">${NK.esc(l.startDate)} 至 ${NK.esc(l.endDate)}（${days} 天）</div></div>
      <div class="dg-item"><div class="dg-label">时段</div><div class="dg-val">${NK.esc(l.leavePeriod)}</div></div>
      <div class="dg-item"><div class="dg-label">负责职场</div><div class="dg-val">${NK.esc(sitesLabel)}</div></div>
      <div class="dg-item"><div class="dg-label">补位派单</div><div class="dg-val">${linked ? `<a href="javascript:void(0)" onclick="UI.dispatchDetail('${linked.id}')">${NK.esc(linked.no)}</a>` : '—'}</div></div>
    </div>
    ${l.remark ? `<div class="hint">备注：${NK.esc(l.remark)}</div>` : ''}
    <div class="hint" style="color:var(--text-3)">登记于 ${l.createdAt.slice(0, 16).replace('T', ' ')}${l.cancelledAt ? ' · 取消于 ' + l.cancelledAt.slice(0, 16).replace('T', ' ') : ''}</div>`,
    `<button class="btn" data-close>关闭</button>
     ${l.recordStatus === '有效' ? `
       ${l.dispatchStatus === '待创建派单' ? `<button class="btn btn-accent" onclick="UI.leaveCreateDispatch('${l.leaveId}')">创建补位派单</button>` : ''}
       <button class="btn" onclick="UI.leaveEdit('${l.leaveId}')">编辑</button>
       <button class="btn btn-danger" onclick="UI.leaveCancel('${l.leaveId}')">取消休假</button>` : ''}`,
    { size: 'modal-md' });
};

/** 编辑休假 */
UI.leaveEdit = (leaveId) => {
  const l = NK.getLeave(leaveId);
  if (!l) return;
  const engOpts = NK.db.engineers.map(e => `<option value="${NK.esc(e.id)}" ${e.name === l.engineerName ? 'selected' : ''}>${NK.esc(NK.v.engName(e.name))}</option>`).join('');
  const body = `
    <div class="form-item"><label>休假工程师</label><select id="leEng">${engOpts}</select></div>
    <div class="form-grid">
      <div class="form-item"><label>开始日期 *</label><input type="date" id="leStart" value="${l.startDate}"></div>
      <div class="form-item"><label>结束日期 *</label><input type="date" id="leEnd" value="${l.endDate}"></div>
    </div>
    <div class="form-item"><label>休假时段</label><select id="lePeriod">
      ${NK.LEAVE_PERIODS.map(p => `<option ${l.leavePeriod === p ? 'selected' : ''}>${p}</option>`).join('')}
    </select></div>
    <div class="form-item"><label>备注</label><textarea id="leRemark" rows="2">${NK.esc(l.remark || '')}</textarea></div>
    ${l.relatedDispatchId ? `<div class="hint" style="color:var(--warn)">该记录已关联补位派单 ${NK.esc(l.relatedDispatchNo || '')}。休假时间调整后，请确认关联补位派单是否也需要修改。</div>` : ''}`;
  UI.modal('编辑休假', body,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="leOk">保存</button>`, {
    editable: true,
    onMount(root) {
      root.querySelector('#leOk').onclick = () => {
        const start = root.querySelector('#leStart').value;
        const end = root.querySelector('#leEnd').value;
        if (!start || !end || end < start) { UI.toast('请检查休假日期', 'warn'); return; }
        const eng = NK.db.engineers.find(e => e.id === root.querySelector('#leEng').value);
        if (!eng) { UI.toast('请选择工程师', 'warn'); return; }
        // 若工程师变化，需重算快照
        if (eng.name !== l.engineerName) {
          l.engineerId = eng.id; l.engineerName = eng.name;
          const sites = NK.sitesByEngineer(eng.name);
          l.responsibleSitesSnapshot = sites.map(s => ({
            siteId: s.id, siteName: s.name, city: s.city,
            supportType: s.supportType || '远程', contactName: s.contactName || '',
            defaultEngineer: s.defaultEngineer || '',
          }));
        }
        NK.updateLeave(l.leaveId, {
          startDate: start, endDate: end,
          leavePeriod: root.querySelector('#lePeriod').value,
          remark: root.querySelector('#leRemark').value.trim(),
        });
        UI.modalClose();
        UI.toast('花姐，休假记录已更新 ✓');
        UI.refreshLeaveView();
      };
    },
  });
};

/** 取消休假 */
UI.leaveCancel = (leaveId) => {
  const l = NK.getLeave(leaveId);
  if (!l) return;
  const linked = l.relatedDispatchId ? NK.getDispatch(l.relatedDispatchId) : null;
  UI.confirm(`确定取消${NK.v.engName(l.engineerName)}${l.startDate}至${l.endDate}的休假记录吗？`,
    () => {
      NK.cancelLeave(leaveId);
      UI.modalClose();
      if (linked) {
        UI.confirm(`该休假已关联补位派单 ${NK.esc(linked.no)}。补位派单不会自动删除，请自行确认该派单是否仍然需要。`, () => {}, '我知道了');
      }
      UI.toast('花姐，休假已取消。');
      UI.refreshLeaveView();
    }, '确定取消');
};


/* ============================================================
   KPI绩效
   ============================================================ */
UI.renderKpi = () => {
  const el = document.getElementById('view-kpi');
  const month = NK.kpiMonth = NK.kpiMonth || NK.curMonth();
  const only = NK.kpiEngineer || 'all';
  const rules = NK.db.kpiRules;

  const engs = only === 'all' ? NK.db.engineers : NK.db.engineers.filter(e => e.name === only);
  const rows = engs.map(e => {
    const k = NK.computeKpi(e.name, month);
    const auto = k.auto || {};
    return { e, k, auto };
  }).sort((a, b) => b.k.final - a.k.final);

  const scoreRows = rows.map(({ e, k, auto }) => {
    const v = NK.v.eng(e);
    const warn = k.final < 90;
    return `<tr onclick="UI.kpiDetail('${e.id}','${month}')" style="cursor:pointer">
      <td><b>${NK.esc(v.name)}</b> <span class="badge gray">${NK.esc(v.phone)}</span></td>
      <td class="num">${k.base}</td>
      <td style="color:var(--danger)">${k.deductTotal || 0}</td>
      <td style="color:var(--accent)">+${k.bonusTotal || 0}</td>
      <td>${k.ratingCount ? k.ratingAvg.toFixed(1) + '（' + k.ratingCount + '次）' : '—'}</td>
      <td><div class="kpi-bar-row" style="min-width:140px">
        <div class="kpi-bar-track"><div class="kpi-bar-fill" style="width:${k.final}%;background:${warn ? 'var(--warn)' : 'var(--accent)'}"></div></div>
        <span class="kpi-bar-val" style="color:${warn ? 'var(--warn)' : 'var(--accent)'}">${k.final}</span></div></td>
      <td>${auto.taskCount || 0} 单${auto.overdue && auto.overdue.length ? `<div style="font-size:10px;color:var(--warn)">超时${auto.overdue.length}</div>` : ''}</td>
    </tr>`;
  }).join('');

  // 事件台账（当月）
  const events = NK.db.kpiEvents.filter(e => e.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date) || b.no.localeCompare(a.no));
  const eventRows = events.map(ev => `
    <tr>
      <td class="num">${ev.no}</td>
      <td>${NK.esc(NK.v.engName(ev.engineer))}</td>
      <td>${NK.esc(ev.date)}</td>
      <td>${ev.points > 0 ? `<span class="badge accent">+${ev.points}</span>` : `<span class="badge risk">${ev.points}</span>`}</td>
      <td>${NK.esc(ev.itemName)}</td>
      <td style="max-width:260px">${NK.esc(ev.reason || '')}${ev.evidence ? `<div class="num" style="font-size:11px">证据：${NK.esc(ev.evidence)}</div>` : ''}</td>
      <td><span class="badge ${ev.type === 'auto' ? 'gray' : 'proc'}">${ev.type === 'auto' ? '自动' : '人工'}</span></td>
      <td>${ev.confirmed ? '<span class="badge done">已确认</span>' : `<button class="btn btn-sm" onclick="UI.kpiEventToggle('${ev.id}')">确认</button>`}</td>
      <td><button class="btn btn-sm" onclick="UI.kpiEventDel('${ev.id}')">删除</button></td>
    </tr>`).join('');

  el.innerHTML = UI.pageHead('KPI绩效', '可配置规则 · 每月自动计算 · 证据可追溯 · 事件台账留痕',
    `<button class="btn btn-accent" onclick="UI.kpiEventCreate()">◬ 登记KPI事件</button><button class="btn" onclick="UI.kpiExportCSV('${month}')">导出明细CSV</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" style="max-width:160px" id="kpiMonth" type="month" value="${month}">
      <select class="fb-select" id="kpiEng">
        <option value="all" ${only === 'all' ? 'selected' : ''}>全部工程师</option>
        ${NK.db.engineers.map(e => `<option value="${NK.esc(e.name)}" ${only === e.name ? 'selected' : ''}>${NK.esc(NK.v.engName(e.name))}</option>`).join('')}
      </select>
      <span class="spacer"></span>
      <span style="font-size:12px;color:var(--text-3)">基础分 ${rules.baseScore} · 加分封顶 +${rules.bonusCap} · 总分上限 ${rules.maxScore}</span>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">${month} 工程师KPI得分（点击行查看明细）</div></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>工程师</th><th>基础分</th><th>扣分</th><th>加分</th><th>客户评价</th><th>最终得分</th><th>工单量</th></tr></thead>
        <tbody>${scoreRows || UI.empty('暂无工程师', 7)}</tbody>
      </table></div></div>
    <div class="card"><div class="card-head"><div class="card-title">KPI事件台账（${month} · ${events.length} 条）</div>
      <span class="badge gray">自动事件来源于派单/任务数据</span></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>编号</th><th>工程师</th><th>日期</th><th>分值</th><th>项目</th><th>原因/证据</th><th>来源</th><th>确认</th><th>操作</th></tr></thead>
        <tbody>${eventRows || UI.empty('本月暂无KPI事件，点击「登记KPI事件」录入', 9)}</tbody>
      </table></div></div>`;

  const bind = () => {
    const onChg = () => {
      NK.kpiMonth = document.getElementById('kpiMonth').value || NK.curMonth();
      NK.kpiEngineer = document.getElementById('kpiEng').value;
      UI.renderKpi();
    };
    document.getElementById('kpiMonth').onchange = onChg;
    document.getElementById('kpiEng').onchange = onChg;
  };
  setTimeout(bind, 0);
};

/** 登记KPI事件 */
UI.kpiEventCreate = () => {
  const rules = NK.db.kpiRules;
  const engOpts = NK.db.engineers.map(e => `<option value="${NK.esc(e.name)}">${NK.esc(NK.v.engName(e.name))}</option>`).join('');
  const deductOpts = rules.items.filter(i => i.type !== 'rating').map(i => `<option value="${i.id}" data-pts="${i.rules[0].points}">${i.name}（${i.rules.map(r => r.description).join('；')} ${i.rules[0].points}分/${i.rules[0].per}）</option>`).join('');
  const bonusOpts = rules.bonusItems.map(i => `<option value="${i.id}" data-pts="+${i.points}">${i.name}（+${i.points}分/次，月上限+${i.maxPerMonth}）</option>`).join('');
  UI.modal('登记KPI事件', `
    <div class="form-grid">
      <div class="form-item"><label>工程师 *</label><select id="keEng">${engOpts}</select></div>
      <div class="form-item"><label>日期</label><input id="keDate" type="date" value="${NK.today()}"></div>
    </div>
    <div class="form-item"><label>类型</label><div class="seg">
      <span class="seg-item" data-kind="deduct" style="border-color:var(--danger);color:var(--danger)">扣分项</span>
      <span class="seg-item" data-kind="bonus">加分项</span>
    </div></div>
    <div class="form-item"><label>项目</label><select id="keItem">${deductOpts}</select></div>
    <div class="form-grid">
      <div class="form-item"><label>分值</label><input id="kePts" type="number" value="-2"></div>
      <div class="form-item"><label>来源</label><select id="keSource"><option>人工登记</option><option>客户反馈</option><option>巡检发现</option><option>复盘会议</option></select></div>
    </div>
    <div class="form-item"><label>原因说明 *</label><textarea id="keReason" placeholder="具体经过、影响…"></textarea></div>
    <div class="form-item"><label>证据（可选）</label><input id="keEvidence" placeholder="如：聊天截图/工单号/照片"></div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="keOk">登记事件</button>`, {
    editable: true,
    onMount(root) {
      const itemSel = root.querySelector('#keItem');
      const ptsInp = root.querySelector('#kePts');
      let kind = 'deduct';
      root.querySelectorAll('.seg-item').forEach(s => s.onclick = () => {
        root.querySelectorAll('.seg-item').forEach(x => { x.style.borderColor = ''; x.style.color = ''; });
        s.style.borderColor = kind === 'deduct' ? 'var(--danger)' : 'var(--accent)';
        s.style.color = kind === 'deduct' ? 'var(--danger)' : 'var(--accent)';
        kind = s.dataset.kind;
        itemSel.innerHTML = kind === 'deduct' ? deductOpts : bonusOpts;
        ptsInp.value = kind === 'deduct' ? '-2' : '+5';
      });
      itemSel.onchange = () => {
        const opt = itemSel.selectedOptions[0];
        if (opt && opt.dataset.pts) ptsInp.value = opt.dataset.pts;
      };
      root.querySelector('#keOk').onclick = () => {
        const engineer = root.querySelector('#keEng').value;
        const reason = root.querySelector('#keReason').value.trim();
        const pts = parseInt(ptsInp.value) || 0;
        const itemId = itemSel.value;
        const isBonus = kind === 'bonus';
        const itemName = itemSel.selectedOptions[0].textContent.split('（')[0];
        if (!reason) { UI.toast('请填写原因说明', 'warn'); return; }
        NK.addKpiEvent({
          date: root.querySelector('#keDate').value, engineer, itemId, itemName,
          type: 'manual', points: pts, reason,
          source: root.querySelector('#keSource').value,
          evidence: root.querySelector('#keEvidence').value.trim(),
          confirmed: !isBonus,
        });
        NK.save();
        UI.toast(`花姐，已登记 KPI 事件（${pts > 0 ? '+' + pts : pts} 分）✓`);
        UI.modalClose();
        UI.renderKpi();
      };
    },
  });
};

/** KPI明细 */
UI.kpiDetail = (engId, month) => {
  const e = NK.db.engineers.find(x => x.id === engId);
  if (!e) return;
  const k = NK.computeKpi(e.name, month);
  const auto = k.auto || {};
  const v = NK.v.eng(e);
  UI.modal(`KPI明细 · ${NK.esc(v.name)} · ${month}`, `
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px">
      <div><div style="font-size:13px;color:var(--text-3)">最终得分</div>
      <div class="kpi-score-big" style="color:${k.final < 90 ? 'var(--warn)' : 'var(--accent)'}">${k.final}</div></div>
      <div class="detail-grid" style="flex:1">
        <div class="dg-item"><div class="dg-label">基础分</div><div class="dg-val">${k.base}</div></div>
        <div class="dg-item"><div class="dg-label">扣分合计</div><div class="dg-val" style="color:var(--danger)">${k.deductTotal}</div></div>
        <div class="dg-item"><div class="dg-label">加分合计</div><div class="dg-val" style="color:var(--accent)">+${k.bonusTotal}</div></div>
        <div class="dg-item"><div class="dg-label">客户评价</div><div class="dg-val">${k.ratingCount ? k.ratingAvg.toFixed(1) + ' / 5（' + k.ratingCount + '次）' : '暂无'}</div></div>
      </div>
    </div>
    <div class="card-head"><div class="card-title">扣分项</div></div>
    <div class="card-body flush">${k.deductions.length ? k.deductions.map(ev => `
      <div class="focus-item"><span class="badge risk">${ev.points}</span>
      <div class="fi-main"><div class="fi-title">${NK.esc(ev.itemName)}</div>
      <div class="fi-meta">${NK.esc(ev.date)} · ${NK.esc(ev.reason)}${ev.evidence ? ' · 证据：' + NK.esc(ev.evidence) : ''}${ev.type === 'auto' ? ' · 自动判定' : ''}</div></div></div>`).join('') : '<div class="tbl-empty" style="padding:16px">无人工/自动扣分</div>'}</div>
    <div class="card-head"><div class="card-title">加分项</div></div>
    <div class="card-body flush">${k.bonuses.length ? k.bonuses.map(ev => `
      <div class="focus-item"><span class="badge accent">+${ev.points}</span>
      <div class="fi-main"><div class="fi-title">${NK.esc(ev.itemName)}</div>
      <div class="fi-meta">${NK.esc(ev.date)} · ${NK.esc(ev.reason)}</div></div></div>`).join('') : '<div class="tbl-empty" style="padding:16px">无加分事件</div>'}</div>
    <div class="card-head"><div class="card-title">自动判定（来自派单/任务数据）</div></div>
    <div class="card-body flush">
      ${auto.events && auto.events.length ? auto.events.map(x => `
        <div class="focus-item"><span class="badge ${x.points < 0 ? 'risk' : 'accent'}">${x.points > 0 ? '+' : ''}${x.points}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(x.name)}</div><div class="fi-meta">${NK.esc(x.reason || '')}</div></div></div>`).join('') : '<div class="tbl-empty" style="padding:16px">无自动判定事件</div>'}
      <div style="font-size:12px;color:var(--text-3);padding:10px 14px">本月任务/派单量 ${auto.taskCount || 0} 单（标准 ${NK.db.kpiRules.dailyQuota}单×22天=${NK.db.kpiRules.dailyQuota * 22} 单）${auto.overdue && auto.overdue.length ? '；超时 ' + auto.overdue.length + ' 单' : ''}${auto.slowResp && auto.slowResp.length ? '；响应超1h ' + auto.slowResp.length + ' 单' : ''}</div>
    </div>`,
    `<button class="btn" data-close>关闭</button><button class="btn btn-accent" onclick="UI.kpiEventCreate()">补登事件</button>`,
    { size: 'modal-lg' });
};

/** 事件确认/取消确认 */
UI.kpiEventToggle = (id) => {
  const ev = NK.db.kpiEvents.find(x => x.id === id);
  if (!ev) return;
  ev.confirmed = !ev.confirmed;
  ev.updatedAt = NK.now();
  NK.save();
  UI.toast(ev.confirmed ? '事件已确认' : '已取消确认');
  UI.renderKpi();
};

/** 删除事件 */
UI.kpiEventDel = (id) => {
  UI.confirm('确定删除该KPI事件？删除后KPI计算将即时更新。', () => {
    NK.db.kpiEvents = NK.db.kpiEvents.filter(x => x.id !== id);
    NK.save();
    UI.toast('花姐，KPI事件已删除');
    UI.renderKpi();
  });
};

/** 导出KPI明细 CSV */
UI.kpiExportCSV = (month) => {
  const rows = NK.db.engineers.map(e => {
    const k = NK.computeKpi(e.name, month);
    return [e.name, k.base, k.deductTotal, k.bonusTotal, k.ratingAvg, k.ratingCount, k.final].join(',');
  });
  const csv = '\uFEFF工程师,基础分,扣分,加分,客户评价均分,评价次数,最终得分\n' + rows.join('\n');
  UI.download('KPI-' + month + '.csv', csv);
};

/* ============================================================
   交接与报表
   ============================================================ */
UI.renderReports = () => {
  const el = document.getElementById('view-reports');
  const today = NK.today();
  const openDisps = NK.db.dispatches.filter(d => NK.dispatchActive(d)).length;
  const openTasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.status !== '已完成' && t.status !== '已取消').length;
  const openProjs = NK.db.projects.filter(p => p.status !== '已完成' && p.status !== '已取消').length;
  const overdue = NK.genReminders().filter(x => x.level === 'danger').length;

  el.innerHTML = UI.pageHead('交接与报表', '休假交接 · 今日交接 · 周报月报 · 一键复制粘贴',
    `<button class="btn btn-accent" onclick="UI.handoverToday()">生成今日交接</button>`) +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-head"><div class="card-title">今日交接</div><span class="badge accent">即时</span></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:12px">汇总今日已完成事项、每日固定工作、进行中的派单/任务、到期项、专项与风险，生成一份可直接粘贴到微信/邮件的交接文本。</div>
          <div class="detail-grid">
            <div class="dg-item"><div class="dg-label">进行中派单</div><div class="dg-val">${openDisps}</div></div>
            <div class="dg-item"><div class="dg-label">进行中任务</div><div class="dg-val">${openTasks}</div></div>
            <div class="dg-item"><div class="dg-label">进行中专项</div><div class="dg-val">${openProjs}</div></div>
            <div class="dg-item"><div class="dg-label">超时/风险</div><div class="dg-val" style="color:${overdue ? 'var(--warn)' : 'var(--accent)'}">${overdue}</div></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:14px">
            <button class="btn btn-accent" style="flex:1" onclick="UI.handoverToday()">▤ 生成今日交接</button>
            <button class="btn" style="flex:1" onclick="UI.handoverLeave()">休假交接（选日期）</button>
          </div>
        </div></div>
      <div class="card"><div class="card-head"><div class="card-title">周报 / 月报</div><span class="badge gray">统计</span></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:12px">基于派单、任务、KPI事件自动生成周期报表，用于向上汇报与复盘。</div>
          <div style="display:flex;gap:8px">
            <button class="btn" style="flex:1" onclick="UI.weekReport()">生成周报</button>
            <button class="btn" style="flex:1" onclick="UI.monthReport()">生成月报</button>
          </div>
          <div class="hint" style="margin-top:10px">统计口径：完成数、平均响应、超时率、各工程师工单量、KPI事件、专项进度。</div>
        </div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">最近生成的交接/报表</div><span class="badge gray">${NK.db.handovers.length} 份</span></div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>类型</th><th>时段</th><th>生成时间</th><th>操作</th></tr></thead>
        <tbody>${NK.db.handovers.length ? NK.db.handovers.slice(-10).reverse().map(h => `
          <tr><td><span class="tag">${NK.esc(h.type)}</span></td><td>${NK.esc(h.start)} → ${NK.esc(h.end)}</td>
          <td>${h.createdAt.slice(0, 16).replace('T', ' ')}</td>
          <td><button class="btn btn-sm" onclick="UI.handoverView('${h.id}')">查看/复制</button></td></tr>`).join('') : UI.empty('暂无历史记录，点击上方按钮生成第一份', 4)}</tbody>
      </table></div></div>`;
};

/** 今日交接 */
UI.handoverToday = () => {
  const today = NK.today();
  const h = NK.genHandover(today, today, { includeToday: true });
  NK.db.handovers.push({ id: NK.uid('H'), type: '今日交接', start: today, end: today, createdAt: NK.now(), text: h.text });
  NK.save();
  UI.modal('今日交接', `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <span class="badge accent">今日交接</span><span style="font-size:12px;color:var(--text-3)">${NK.fmtDT(new Date())} · 可直接复制粘贴到微信/邮件</span>
    </div>
    <textarea id="hvText" readonly style="width:100%;height:430px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.7;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);color:var(--text-1);box-sizing:border-box">${NK.esc(h.text)}</textarea>`,
    `<button class="btn" data-close>关闭</button><button class="btn btn-accent" id="hvCopy">复制交接文本</button>`,
    { size: 'modal-lg', onMount(root) { root.querySelector('#hvCopy').onclick = () => UI.copy(h.text); } });
};

/** 休假交接（选日期） */
UI.handoverLeave = () => {
  const today = NK.today();
  UI.modal('休假交接', `
    <div class="form-grid">
      <div class="form-item"><label>开始日期</label><input id="hlStart" type="date" value="${today}"></div>
      <div class="form-item"><label>结束日期</label><input id="hlEnd" type="date" value="${today}"></div>
    </div>
    <div class="hint">将汇总：休假期间每日固定工作、将到期的派单/任务、进行中的派单、等待反馈、等待验收、已超时、进行中的专项与风险。</div>
    <textarea id="hlText" readonly style="width:100%;height:380px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.7;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);color:var(--text-1);box-sizing:border-box;margin-top:10px" placeholder="选择日期后点击「生成交接」…"></textarea>`,
    `<button class="btn" data-close>取消</button><button class="btn" id="hlGen">生成交接</button><button class="btn btn-accent" id="hlCopy" style="display:none">复制文本</button>`, {
    onMount(root) {
      let text = '';
      root.querySelector('#hlGen').onclick = () => {
        const s = root.querySelector('#hlStart').value;
        const e = root.querySelector('#hlEnd').value;
        if (!s || !e) { UI.toast('请选择日期范围', 'warn'); return; }
        const h = NK.genHandover(s, e);
        text = h.text;
        NK.db.handovers.push({ id: NK.uid('H'), type: '休假交接', start: s, end: e, createdAt: NK.now(), text });
        NK.save();
        root.querySelector('#hlText').value = text;
        root.querySelector('#hlCopy').style.display = '';
        UI.toast('花姐，交接已生成 ✓');
      };
      root.querySelector('#hlCopy').onclick = () => UI.copy(text);
    },
  });
};

/** 查看历史交接 */
UI.handoverView = (id) => {
  const h = NK.db.handovers.find(x => x.id === id);
  if (!h) return;
  UI.modal(`${h.type} · ${h.start} → ${h.end}`, `
    <textarea id="hvText" readonly style="width:100%;height:430px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.7;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);color:var(--text-1);box-sizing:border-box">${NK.esc(h.text)}</textarea>`,
    `<button class="btn" data-close>关闭</button><button class="btn btn-accent" id="hvCopy">复制</button>`,
    {
      size: 'modal-lg',
      onMount(root) {
        const ta = root.querySelector('#hvText');
        root.querySelector('#hvCopy').onclick = () => { UI.copy(ta.value); };
      },
    });
};

/** 周报 */
UI.weekReport = () => {
  const end = NK.today();
  const start = new Date(Date.now() - 6 * 86400000);
  const s = NK.fmtDate(start);
  const disps = NK.db.dispatches.filter(d => d.createdAt.slice(0, 10) >= s && d.createdAt.slice(0, 10) <= end);
  const formalDisps = disps.filter(d => NK.dispatchStatusKey(d) !== 'draft' && d.recordStatus !== '已删除');
  const tasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.createdAt.slice(0, 10) >= s && t.createdAt.slice(0, 10) <= end);
  const done = NK.db.tasks.filter(t => NK.taskActive(t) && t.doneAt && t.doneAt.slice(0, 10) >= s && t.doneAt.slice(0, 10) <= end);
  const evs = NK.db.kpiEvents.filter(e => e.date >= s && e.date <= end);
  const text = [
    `══════ IT运维周报（${s} 至 ${end}）══════`,
    `一、总体概况`,
    `  新建正式派单 ${formalDisps.length} 单（草稿 ${disps.length - formalDisps.length} 条未计入），新建任务 ${tasks.length} 条，完成任务 ${done.length} 条。`,
    `  当前进行中：派单 ${NK.db.dispatches.filter(d => NK.dispatchActive(d)).length} 单 / 任务 ${NK.db.tasks.filter(t => NK.taskActive(t) && t.status !== '已完成').length} 条 / 专项 ${NK.db.projects.filter(p => p.status !== '已完成').length} 个。`,
    ``,
    `二、派单明细`,
    formalDisps.length ? formalDisps.map(d => `  • [${d.priority}] ${d.no} ${d.title}（${d.city}）→ ${d.engineer}，${NK.dispatchStatusLabel(d)}`).join('\n') : `  （本周无新建派单）`,
    ``,
    `三、任务完成情况`,
    done.length ? done.slice(0, 15).map(t => `  ✓ ${t.no} ${t.name}${t.siteName ? '（' + t.siteName + '）' : ''}`).join('\n') : `  （本周无完成任务）`,
    ``,
    `四、KPI事件`,
    evs.length ? evs.map(e => `  • ${e.date} ${e.engineer} ${e.itemName} ${e.points > 0 ? '+' : ''}${e.points}分：${e.reason}`).join('\n') : `  （本周无KPI事件）`,
    ``,
    `五、风险与问题`,
    `  ${NK.genReminders().filter(x => x.level === 'danger').length ? NK.genReminders().filter(x => x.level === 'danger').slice(0, 8).map(x => `⚠ ${x.title}：${x.content}`).join('\n  ') : '（无重大风险）'}`,
    ``,
    `──── 由 卢女开·IT运维指挥台 自动生成 ────`,
  ].join('\n');
  UI.showReportModal('周报', text);
};

/** 月报 */
UI.monthReport = () => {
  const month = NK.curMonth();
  const allDisps = NK.db.dispatches.filter(d => d.createdAt.slice(0, 7) === month);
  // 正式派单：排除草稿与已删除（recordStatus）
  const disps = allDisps.filter(d => NK.dispatchStatusKey(d) !== 'draft' && d.recordStatus !== '已删除');
  const tasks = NK.db.tasks.filter(t => NK.taskActive(t) && t.createdAt.slice(0, 7) === month);
  const done = NK.db.tasks.filter(t => NK.taskActive(t) && t.doneAt && t.doneAt.slice(0, 7) === month);
  const kpiRows = NK.db.engineers.map(e => { const k = NK.computeKpi(e.name, month); return `${k.engineer}:${k.final}分`; }).join('  ');
  const engStat = NK.db.engineers.map(e => {
    const n = NK.db.tasks.filter(t => NK.taskActive(t) && t.engineer === e.name && t.createdAt.slice(0, 7) === month).length;
    const nd = NK.db.dispatches.filter(d => !NK.dispatchInactive(d) && d.engineer === e.name && d.createdAt.slice(0, 7) === month).length;
    return `  ${e.name}：任务${n} / 派单${nd}`;
  }).join('\n');
  // 新状态统计：草稿/已删除不计入正式总数
  const sToday = d => NK.dispatchStatusKey(d);
  const countSt = k => disps.filter(d => sToday(d) === k).length;
  const completed = countSt('completed');
  const revoked = countSt('revoked');
  const exception = countSt('exception');
  const pendingSend = countSt('pending_send');
  const sent = countSt('sent');
  // 供应商分布
  const suppStat = NK.SUPPLIERS.map(s => {
    const c = disps.filter(d => { const g = NK.getSupplierOf(d); return g && g.id === s.id; }).length;
    return `${s.name}${c}条`;
  }).join('，');
  const noSupp = disps.filter(d => !NK.getSupplierOf(d)).length;
  const text = [
    `══════ IT运维月报（${month}）══════`,
    `一、总体概况`,
    `  新建正式派单 ${disps.length} 单（草稿 ${allDisps.filter(d => sToday(d) === 'draft').length} 条未计入），新建任务 ${tasks.length} 条，完成任务 ${done.length} 条。`,
    ``,
    `二、派单状态分布`,
    `  待发送 ${pendingSend} 条 / 已发送 ${sent} 条 / 异常待处理 ${exception} 条 / 已完成 ${completed} 条 / 已撤销 ${revoked} 条`,
    `  供应商：${suppStat}${noSupp > 0 ? `，未标注 ${noSupp} 条` : ''}`,
    ``,
    `三、工程师工单量`,
    engStat,
    ``,
    `四、工程师KPI`,
    `  ${kpiRows}`,
    ``,
    `五、专项进度`,
    NK.db.projects.filter(p => p.status !== '已取消').map(p => `  • ${p.name}（${p.status}，完成率${p.progress || 0}%）`).join('\n') || `  （无专项）`,
    ``,
    `六、本月KPI事件`,
    NK.db.kpiEvents.filter(e => e.date.slice(0, 7) === month).length ? NK.db.kpiEvents.filter(e => e.date.slice(0, 7) === month).map(e => `  • ${e.date} ${e.engineer} ${e.itemName} ${e.points > 0 ? '+' : ''}${e.points}分：${e.reason}`).join('\n') : `  （本月无KPI事件）`,
    ``,
    `──── 由 卢女开·IT运维指挥台 自动生成 ────`,
  ].join('\n');
  UI.showReportModal('月报', text);
};

/** 报表展示弹窗 */
UI.showReportModal = (title, text) => {
  NK.db.handovers.push({ id: NK.uid('H'), type: title, start: NK.today(), end: NK.today(), createdAt: NK.now(), text });
  NK.save();
  UI.modal(title, `
    <textarea readonly style="width:100%;height:430px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.7;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);color:var(--text-1);box-sizing:border-box">${NK.esc(text)}</textarea>`,
    `<button class="btn" data-close>关闭</button><button class="btn btn-accent" id="rpCopy">复制</button>`,
    { size: 'modal-lg', onMount(root) { root.querySelector('#rpCopy').onclick = () => UI.copy(text); } });
};

/* ============================================================
   数据导入导出
   ============================================================ */
/** 通用下载 */
UI.download = (filename, content, mime) => {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 300);
};

UI.renderImport = () => {
  const el = document.getElementById('view-import');
  const db = NK.db;
  const size = () => {
    try { return (localStorage.getItem(NK.LS_KEY) || '').length; } catch (e) { return 0; }
  };
  const csvBtns = [
    ['职场联系人', 'sites'], ['工程师', 'engineers'], ['派单', 'dispatches'],
    ['任务', 'tasks'], ['专项', 'projects'], ['KPI事件', 'kpiEvents'],
  ].map(([label, type]) => `<button class="btn" onclick="UI.exportCSV('${type}')">${label}</button>`).join('');

  el.innerHTML = UI.pageHead('数据导入导出', '本地数据 100% 保存在浏览器 · 可随时导出备份 / 迁移 / 恢复',
    `<button class="btn btn-accent" onclick="UI.exportJSON()">导出完整备份 (JSON)</button>`) +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-head"><div class="card-title">导出数据</div><span class="badge accent">备份</span></div>
        <div class="card-body">
          <div style="font-size:12px;color:var(--text-2);margin-bottom:10px">完整备份包含全部业务数据（职场/工程师/派单/任务/专项/KPI/交接），可在另一台电脑恢复。CSV 可直接用 Excel 打开。</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${csvBtns}</div>
          <div class="hint" style="margin-top:10px">提示：Excel 数据请先整理为「职场联系人」列格式（IT技术支持/省份/城市/联系人/地址/备注/派单要求），再用下方「从CSV导入职场」导入。</div>
        </div></div>
      <div class="card"><div class="card-head"><div class="card-title">导入数据</div><span class="badge gray">恢复/迁移</span></div>
        <div class="card-body">
          <div class="import-zone" id="importZone">
            <div style="font-size:26px;margin-bottom:6px">⇪</div>
            <div>点击选择或拖拽 JSON 备份文件到此处</div>
            <div style="font-size:11px;color:var(--text-3);margin-top:4px">仅支持本应用导出的 .json 备份（含 seedHash 校验）</div>
          </div>
          <input type="file" id="importFile" accept=".json,application/json" style="display:none">
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn" onclick="UI.importCSVSites()">从CSV导入职场</button>
            <button class="btn btn-danger" onclick="UI.resetData()">重置为初始数据</button>
          </div>
        </div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">数据状态</div></div>
      <div class="card-body">
        <div class="detail-grid">
          <div class="dg-item"><div class="dg-label">职场</div><div class="dg-val">${db.sites.length} 个</div></div>
          <div class="dg-item"><div class="dg-label">工程师</div><div class="dg-val">${db.engineers.length} 名</div></div>
          <div class="dg-item"><div class="dg-label">派单</div><div class="dg-val">${db.dispatches.length} 条</div></div>
          <div class="dg-item"><div class="dg-label">任务</div><div class="dg-val">${db.tasks.length} 条</div></div>
          <div class="dg-item"><div class="dg-label">专项</div><div class="dg-val">${db.projects.length} 个</div></div>
          <div class="dg-item"><div class="dg-label">KPI事件</div><div class="dg-val">${db.kpiEvents.length} 条</div></div>
          <div class="dg-item"><div class="dg-label">交接/报表</div><div class="dg-val">${db.handovers.length} 份</div></div>
          <div class="dg-item"><div class="dg-label">存储占用</div><div class="dg-val">${(size() / 1024).toFixed(1)} KB</div></div>
        </div>
      </div></div>`;

  const zone = document.getElementById('importZone');
  const file = document.getElementById('importFile');
  zone.onclick = () => file.click();
  zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag'); };
  zone.ondragleave = () => zone.classList.remove('drag');
  zone.ondrop = (e) => {
    e.preventDefault();
    zone.classList.remove('drag');
    if (e.dataTransfer.files[0]) UI.importJSON(e.dataTransfer.files[0]);
  };
  file.onchange = () => { if (file.files[0]) UI.importJSON(file.files[0]); };
};

/** 导出完整 JSON 备份 */
UI.exportJSON = () => {
  UI.download(`NK-Ops-Backup-${NK.today()}.json`, JSON.stringify(NK.db, null, 2), 'application/json');
  UI.toast('花姐，完整备份已导出 ✓');
};

/** 导出 CSV（按类型） */
UI.exportCSV = (type) => {
  const db = NK.db;
  let csv = '';
  if (type === 'sites') {
    csv = '\uFEFFIT技术支持,省份,城市,联系人,地址,备注,派单要求\n' + db.sites.map(s =>
      `${NK.esc(s.name)},${NK.esc(s.province)},${NK.esc(s.city)},${NK.esc(s.contactName + '：' + s.contactPhone)},${NK.esc(s.address)},${NK.esc(s.remark || '')},${NK.esc(s.dispatchRule || '')}`).join('\n');
  } else if (type === 'engineers') {
    csv = '\uFEFF工程师,驻场区域,联系电话,远程支持区域\n' + db.engineers.map(e =>
      `${NK.esc(e.name)},${NK.esc(e.onsiteRaw || '')},${NK.esc(e.phone)},${NK.esc(e.remoteRaw || '')}`).join('\n');
  } else if (type === 'dispatches') {
    csv = '\uFEFF编号,事项,城市,职场,工程师,优先级,状态,创建时间,计划完成,最新反馈\n' + db.dispatches.map(d =>
      `${d.no},${NK.esc(d.title)},${NK.esc(d.city)},${NK.esc(d.siteName)},${NK.esc(d.engineer)},${d.priority},${d.status},${d.createdAt.slice(0, 16).replace('T', ' ')},${d.planDone || ''},${NK.esc((d.latestFeedback || '').replace(/\n/g, ' '))}`).join('\n');
  } else if (type === 'tasks') {
    csv = '\uFEFF编号,任务,类型,优先级,职场,工程师,状态,创建时间,截止,最新反馈\n' + db.tasks.map(t =>
      `${t.no},${NK.esc(t.name)},${t.type},${t.priority},${NK.esc(t.siteName)},${NK.esc(t.engineer)},${t.status},${t.createdAt.slice(0, 16).replace('T', ' ')},${t.dueDate || ''},${NK.esc((t.latestFeedback || '').replace(/\n/g, ' '))}`).join('\n');
  } else if (type === 'projects') {
    csv = '\uFEFF编号,专项,类型,状态,开始,截止,完成度,负责人,下一步\n' + db.projects.map(p =>
      `${p.no},${NK.esc(p.name)},${p.type},${p.status},${p.startDate || ''},${p.dueDate || ''},${p.progress || 0},${NK.esc(p.owner)},${NK.esc(p.nextAction || '')}`).join('\n');
  } else if (type === 'kpiEvents') {
    csv = '\uFEFF编号,工程师,日期,项目,分值,类型,原因,来源,确认\n' + db.kpiEvents.map(e =>
      `${e.no},${NK.esc(e.engineer)},${e.date},${NK.esc(e.itemName)},${e.points},${e.type === 'auto' ? '自动' : '人工'},${NK.esc(e.reason)},${NK.esc(e.source)},${e.confirmed ? '是' : '否'}`).join('\n');
  }
  UI.download(`NK-${type}-${NK.today()}.csv`, csv);
  UI.toast(`已导出 ${type} CSV`);
};

/** 从 JSON 备份导入 */
UI.importJSON = (file) => {
  if (!(file && typeof file === 'object' && file instanceof Blob)) {
    UI.toast('无效文件：请选择本应用导出的JSON备份文件', 'warn');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || data.version !== 1 || !data.seedHash || !data.sites || !data.engineers) {
        UI.toast('文件格式不正确：请使用本应用导出的备份文件', 'warn');
        return;
      }
      if (data.seedHash !== NK.seedHash()) {
        UI.confirm('备份的种子数据版本与当前不同（职场/工程师模板有差异），导入后可能与现有数据不完全匹配。仍要导入吗？', () => {
          NK.db = data; NK.save(); UI.toast('数据已导入，页面即将刷新'); setTimeout(() => location.reload(), 800);
        });
        return;
      }
      UI.confirm(`将导入备份数据：${data.sites.length} 职场 / ${data.engineers.length} 工程师 / ${data.dispatches.length} 派单 / ${data.tasks.length} 任务 / ${data.kpiEvents.length} KPI事件。将覆盖当前全部数据，确定继续吗？`, () => {
        NK.db = data; NK.save(); UI.toast('数据已导入，页面即将刷新'); setTimeout(() => location.reload(), 800);
      });
    } catch (e) {
      UI.toast('文件解析失败：不是有效的JSON备份', 'warn');
    }
  };
  reader.readAsText(file, 'utf-8');
};

/** 从 CSV 导入职场（列：IT技术支持,省份,城市,联系人,地址,备注,派单要求） */
UI.importCSVSites = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv';
  input.onchange = () => {
    const f = input.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const lines = String(reader.result).replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { UI.toast('CSV 为空', 'warn'); return; }
        let added = 0, skipped = 0;
        lines.slice(1).forEach(line => {
          const cells = line.split(',').map(c => c.trim());
          const [name, prov, city, contactRaw, address, remark, dispatchRule] = cells;
          if (!name || !city) { skipped++; return; }
          if (NK.db.sites.find(s => s.name === name && s.city === city)) { skipped++; return; }
          let contactName = contactRaw || '', contactPhone = '';
          if (contactRaw && contactRaw.includes('：')) { const p = contactRaw.split('：'); contactName = p[0]; contactPhone = p[1]; }
          NK.db.sites.push({
            id: NK.uid((prov || '省').slice(0, 1) + (city.slice(0, 1) || '市')),
            province: prov || '', city, name, address: address || '',
            contactName, contactPhone, contactRaw: contactRaw || '',
            defaultEngineer: '', supportType: '远程',
            needDispatch: false, dispatchRule: dispatchRule || '', status: '正常', remark: remark || '',
          });
          added++;
        });
        NK.save();
        UI.toast(`导入完成：新增 ${added} 个职场，跳过 ${skipped} 个`);
        UI.renderImport();
      } catch (e) {
        UI.toast('CSV 解析失败，请检查编码（UTF-8）与列顺序', 'warn');
      }
    };
    reader.readAsText(f, 'utf-8');
  };
  input.click();
};

/** 重置为初始数据 */
UI.resetData = () => {
  UI.confirm('<b>⚠️ 此操作将清空当前全部业务数据（派单/任务/专项/KPI/交接）并恢复初始职场、工程师数据，且不可恢复！</b>建议先「导出完整备份」。确定重置吗？', () => {
    try { localStorage.removeItem(NK.LS_KEY); } catch (e) { }
    setTimeout(() => location.reload(), 500);
  }, '我已备份，确认重置');
};

/* ============================================================
   系统设置
   ============================================================ */
UI.renderSettings = () => {
  const el = document.getElementById('view-settings');
  const rules = NK.db.kpiRules;
  const tpl = NK.activeTpl() || NK.db.templates[0];

  const itemRows = rules.items.map((it, i) => `
    <div class="rule-row">
      <div style="width:160px"><b>${NK.esc(it.name)}</b><div style="font-size:11px;color:var(--text-3)">${NK.esc(it.category)} · 封顶${it.maxScore}分</div></div>
      <div style="flex:1">${(it.rules || []).map((r, j) => `
        <div style="display:flex;align-items:center;gap:6px;margin:3px 0;font-size:12px">
          <span style="flex:1;color:var(--text-2)">${NK.esc(r.description)}</span>
          <span>${r.points}分/${NK.esc(r.per)}</span>
        </div>`).join('')}
      </div>
      <div class="form-item" style="margin:0"><label style="font-size:10px">上限</label><input id="ruleMax_${it.id}" type="number" value="${it.maxScore}" style="width:70px"></div>
    </div>`).join('');
  const bonusRows = rules.bonusItems.map((b, i) => `
    <div class="rule-row">
      <div style="width:160px"><b>${NK.esc(b.name)}</b><div style="font-size:11px;color:var(--text-3)">月上限+${b.maxPerMonth}</div></div>
      <div style="flex:1;font-size:12px;color:var(--text-2)">每次 +${b.points} 分</div>
      <div class="form-item" style="margin:0"><label style="font-size:10px">单次分</label><input id="bonusPts_${b.id}" type="number" value="${b.points}" style="width:70px"></div>
      <div class="form-item" style="margin:0"><label style="font-size:10px">月上限</label><input id="bonusMax_${b.id}" type="number" value="${b.maxPerMonth}" style="width:70px"></div>
    </div>`).join('');

  el.innerHTML = UI.pageHead('系统设置', '运行模式 · KPI规则 · 派单消息模板 · 数据维护',
    `<button class="btn btn-accent" onclick="UI.saveRules()">保存规则</button>`) +
    `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
      <div class="card"><div class="card-head"><div class="card-title">运行模式</div></div>
        <div class="card-body">
          <div class="seg">
            <span class="seg-item ${NK.mode === 'work' ? 'seg-on' : ''}" data-mode="work">工作模式（真实数据）</span>
            <span class="seg-item ${NK.mode === 'demo' ? 'seg-on' : ''}" data-mode="demo">作品演示模式（脱敏）</span>
          </div>
          <div style="font-size:12px;color:var(--text-2);margin-top:10px">
            <b>工作模式</b>：显示真实职场名、工程师姓名、完整电话与地址。<br>
            <b>作品演示模式</b>：职场名替换为「某某」，工程师姓名替换为虚构姓名，手机号打码（138****1234），地址模糊化，适合演示作品/对外展示。
          </div>
          <button class="btn" style="margin-top:12px" onclick="UI.toggleMode()">切换到${NK.mode === 'work' ? '作品演示' : '工作'}模式</button>
        </div></div>
      <div class="card"><div class="card-head"><div class="card-title">KPI规则</div><span class="badge gray">${rules.items.length}项扣分 + ${rules.bonusItems.length}项加分</span></div>
        <div class="card-body">
          <div class="form-grid" style="margin-bottom:10px">
            <div class="form-item"><label>基础分</label><input id="ruleBase" type="number" value="${rules.baseScore}"></div>
            <div class="form-item"><label>加分封顶</label><input id="ruleCap" type="number" value="${rules.bonusCap}"></div>
            <div class="form-item"><label>总分上限</label><input id="ruleMax" type="number" value="${rules.maxScore}"></div>
            <div class="form-item"><label>日工单标准</label><input id="ruleQuota" type="number" value="${rules.dailyQuota}"></div>
          </div>
          ${itemRows}
          <div class="card-head" style="margin-top:8px"><div class="card-title">加分项</div></div>
          ${bonusRows}
        </div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">派单消息模板</div><span class="badge gray">TPL_MSG · {占位符}自动替换</span></div>
      <div class="card-body">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:6px">可用占位符：{职场} {事项} {优先级} {联系人} {电话} {地址} {工程师} {到场时间} {完成时间}</div>
        <textarea id="tplContent" style="width:100%;height:220px;font-family:Consolas,Menlo,monospace;font-size:12px;line-height:1.7;padding:12px;border:1px solid var(--line);border-radius:8px;background:var(--bg-soft);color:var(--text-1);box-sizing:border-box">${NK.esc(tpl.content)}</textarea>
        <button class="btn btn-accent" style="margin-top:10px" onclick="UI.saveTpl()">保存模板</button>
      </div></div>
    <div class="card"><div class="card-head"><div class="card-title">数据维护</div><span class="badge gray">谨慎操作</span></div>
      <div class="card-body">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-danger" onclick="UI.resetData()">重置为初始数据</button>
          <button class="btn" onclick="UI.exportJSON()">导出完整备份</button>
        </div>
        <div class="hint" style="margin-top:10px">重置前请务必先导出备份。数据存储于浏览器 localStorage，清除浏览器数据或更换设备会导致数据丢失，请定期备份。</div>
      </div></div>
    <div class="card"><div class="card-head"><div class="card-title">查资源密码锁</div><span class="badge gray">工程师与职场页</span></div>
      <div class="card-body">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:10px">当前状态：${UI.resStore() ? '<b style="color:var(--accent)">已开启</b>（会话内解锁有效）' : '<b>未开启</b>'}。开启后访问「工程师与职场」需输入密码，防止他人随手翻看。</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${UI.resStore()
            ? `<button class="btn" onclick="UI.resChangePwd()">修改密码</button><button class="btn btn-danger" onclick="UI.resClearPwd()">关闭密码</button><button class="btn" onclick="UI.resResetPwd()">忘记密码 · 重置</button>`
            : `<button class="btn btn-accent" onclick="UI.resSetupFromSettings()">开启密码保护</button>`}
        </div>
        <div class="hint" style="margin-top:10px">密码仅保存在本机浏览器（编码存储）。本应用为纯前端工具，此锁用于防止随手翻看，无法防住懂技术的人通过开发者工具绕过，请勿在其中存放敏感信息。</div>
      </div></div>
    <div class="card"><div class="card-head"><div class="card-title">实时告警 · 清空设置</div><span class="badge gray">清空的是提示，不是数据</span></div>
      <div class="card-body">
        <div style="font-size:12px;color:var(--text-2);margin-bottom:10px">「清空告警」只清除当前告警提示，不会删除任务、派单、专项或KPI。未解决的问题在冷却期结束后若仍满足条件，会重新告警。</div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="form-item" style="margin:0"><label style="font-size:11px">重新触发冷却（小时）</label><input id="setAlCool" type="number" min="0" max="168" step="1" value="${((NK.db.alertState||{}).cooldownHours) != null ? NK.db.alertState.cooldownHours : 2}" style="width:90px"></div>
          <button class="btn" onclick="UI.alertCooldownSave()">保存冷却时间</button>
          <button class="btn" onclick="UI.alertRecordsOpen()">查看清空记录</button>
        </div>
      </div></div>`;

  // 绑定模式切换
  el.querySelectorAll('.seg-item[data-mode]').forEach(s => s.onclick = () => {
    if (s.dataset.mode !== NK.mode) UI.toggleMode();
  });
};

/** 切换工作/演示模式 */
UI.toggleMode = () => {
  NK.mode = NK.mode === 'work' ? 'demo' : 'work';
  NK.db.mode = NK.mode;
  NK.save();
  const label = document.getElementById('modeLabel');
  const dot = document.querySelector('.mode-switch .mode-dot');
  if (NK.mode === 'demo') {
    label.textContent = '演示模式';
    dot.classList.add('demo');
    let b = document.getElementById('demoBanner');
    if (!b) {
      b = document.createElement('div');
      b.id = 'demoBanner';
      b.className = 'demo-banner';
      b.textContent = '作品演示模式：姓名/电话/地址已脱敏，仅用于作品展示';
      document.body.appendChild(b);
    }
  } else {
    label.textContent = '工作模式';
    dot.classList.remove('demo');
    const b = document.getElementById('demoBanner');
    if (b) b.remove();
  }
  UI.toast(`已切换到${NK.mode === 'demo' ? '作品演示模式（脱敏）' : '工作模式'}`);
  UI.nav(NK.currentView);
};

/** 保存KPI规则 */
UI.saveRules = () => {
  const rules = NK.db.kpiRules;
  const baseEl = document.getElementById('ruleBase');
  if (!baseEl) { UI.toast('规则表单未渲染，请先打开设置页', 'warn'); return; }
  const get = (id) => parseInt(document.getElementById(id).value) || 0;
  rules.baseScore = get('ruleBase');
  rules.bonusCap = get('ruleCap');
  rules.maxScore = get('ruleMax');
  rules.dailyQuota = get('ruleQuota');
  rules.items.forEach(it => {
    const v = get('ruleMax_' + it.id);
    if (v) it.maxScore = v;
  });
  rules.bonusItems.forEach(b => {
    b.points = get('bonusPts_' + b.id) || b.points;
    b.maxPerMonth = get('bonusMax_' + b.id) || b.maxPerMonth;
  });
  NK.save();
  UI.toast('花姐，KPI规则已保存，各工程师得分已即时更新 ✓');
  UI.renderKpi();
};

/** 保存派单消息模板 */
UI.saveTpl = () => {
  const tpl = NK.activeTpl() || NK.db.templates[0];
  const el = document.getElementById('tplContent');
  if (!tpl || !el) { UI.toast('模板表单未渲染，请先打开设置页', 'warn'); return; }
  tpl.content = el.value;
  NK.save();
  UI.toast('花姐，派单消息模板已保存 ✓');
};

/* ============================================================
   项目说明
   ============================================================ */
UI.renderAbout = () => {
  const el = document.getElementById('view-about');
  const feats = [
    ['＋ 新建派单', '按城市选职场（同城多职场必须选具体地点），自动带出联系人/电话/地址/默认工程师，生成派单消息，自动创建跟进任务'],
    ['☰ 任务闭环', '派单自动生成任务；由花姐在系统内维护派单状态：草稿→待发送→已发送→异常待处理→已完成/已撤销；工程师通过微信/Teams/电话沟通，响应与超时由花姐记录的时间自动判定'],
    ['◉ 今日指挥台', '状态概览 + 快捷操作工具条 + 重点盯三件事 + 今日时间轴，打开就知道今天该做什么'],
    ['▣ 专项管理', '季度巡检模板（自动生成11项巡检子任务）、补丁更新、搬迁撤场、通用项目，进度/风险/子任务清单'],
    ['◬ KPI绩效', '可配置规则（9项扣分+3项加分），每月自动计算，工单量/响应速度/超时自动判定，事件台账证据可追溯'],
    ['▤ 交接与报表', '今日交接、休假交接一键生成，周报月报自动汇总，复制即用'],
    ['◈ 资源库', '67个职场、9名工程师，按城市/名称/电话全局搜索，联系人一键查找'],
    ['⇅ 数据导入导出', '完整JSON备份/恢复、CSV导出（Excel可开）、从CSV批量导入职场、重置'],
    ['⚙ 双模式', '工作模式（真实数据）与作品演示模式（姓名/电话/地址脱敏），一键切换'],
  ];
  const scenarios = [
    ['湖州职场打印机故障', '在派单中心输入"湖州"→ 自动带出职场/联系人/地址/工程师沈煜钦 → 确认派单 → 消息自动生成 → 任务自动创建'],
    ['同城多职场（南京/北京）', '输入城市出现多个职场，必须选择具体地点后才可派单，避免派错'],
    ['无需派单提示', '驻场工程师所在地职场标记"无需派单"，仍可创建任务跟踪'],
    ['派单全流程闭环', '草稿→待发送→已发送→异常待处理→已完成/已撤销，全程由花姐留痕'],
    ['KPI自动计算', '每月按规则自动算分：响应>1h扣分、逾期扣分、工单量对照标准、表扬加分'],
    ['休假交接', '一键生成休假期间每日固定工作+到期派单+进行中事项+风险清单'],
    ['演示模式脱敏', '切换后职场名/姓名/电话/地址全部脱敏，适合作品展示'],
  ];
  el.innerHTML = UI.pageHead('项目说明', '卢女开 · IT运维指挥台 LY Ops Command · Designed by 卢女开', '') +
    `<div class="card"><div class="card-head"><div class="card-title">项目背景</div></div>
      <div class="card-body">
        <div style="font-size:13px;line-height:1.9;color:var(--text-2)">
          本系统面向 IT 运维团队负责人「卢女开」，覆盖全国 <b>${NK.db.sites.length} 个职场</b>、<b>${NK.db.engineers.length} 名工程师</b>的日常运维管理。
          核心理念是<b>一次录入、多处复用</b>：录入一次派单，自动生成任务、提醒、KPI数据源与交接素材。
          所有数据保存在浏览器本地，随用随取，无服务器依赖；可导出备份迁移到任意电脑。
        </div>
      </div></div>
    <div class="card"><div class="card-head"><div class="card-title">功能清单</div></div>
      <div class="card-body">${feats.map(f => `<div class="focus-item">
        <span class="badge accent">${f[0].split(' ')[0]}</span>
        <div class="fi-main"><div class="fi-title">${f[0].split(' ').slice(1).join(' ')}</div><div class="fi-meta">${f[1]}</div></div></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><div class="card-title">核心验收场景</div><span class="badge gray">可对照操作</span></div>
      <div class="card-body">${scenarios.map((s, i) => `<div class="focus-item">
        <span class="badge gray">${i + 1}</span>
        <div class="fi-main"><div class="fi-title">${s[0]}</div><div class="fi-meta">${s[1]}</div></div></div>`).join('')}</div></div>
    <div class="card"><div class="card-head"><div class="card-title">使用提示</div></div>
      <div class="card-body">
        <div style="font-size:12px;line-height:2;color:var(--text-2)">
          • 首次打开自动初始化：67职场 / 9工程师 / 13每日任务模板 / 3条演示派单 / 2个演示专项。<br>
          • 数据存于浏览器 localStorage（键 nk_ops_command_v1），请定期到「数据导入导出」备份。<br>
          • 顶栏搜索支持：城市、职场名、工程师、联系人、电话号码、派单号。<br>
          • 「✦ 花姐助手」支持自然语言：湖州谁负责？今天有什么超时？本月KPI？<br>
          • 页面每 5 分钟自动刷新提醒与每日任务；数据变更即时保存。
        </div>
      </div></div>`;
};

/* ============================================================
   花姐助手面板（操作助手）
   ------------------------------------------------------------
   支持：结果卡片 / 操作按钮（查看、撤销、确认）/ 加载提示 /
   欢迎语与快捷指令 / 当前会话上下文（"它/补一句"）/
   操作日志面板入口
   ============================================================ */
UI.bindAssistant = () => {
  const panel = document.getElementById('assistantPanel');
  const body = document.getElementById('apBody');
  const input = document.getElementById('apInput');
  // 当前会话上下文（供"它/补一句"引用最近意图）
  const ctx = { lastIntent: null };
  // 快捷指令
  const quickCmds = [
    '今天有什么待办？', '新增任务，明天下午确认南京网络问题', '今日日常任务全部完成',
    '今天谁休假？', '创建派单，湖州打印机无法打印', '生成今日交接',
  ];

  /** 执行 act 动作（供结果卡片按钮回调） */
  const runAct = (act, arg) => {
    try {
      if (!act) return;
      if (act === 'nav') { UI.nav(arg); return; }
      if (act === 'taskDetail') { UI.taskDetail(arg); return; }
      if (act === 'projectDetail') { UI.projectDetail(arg); return; }
      if (act === 'dispatchDetail') { UI.dispatchDetail(arg); return; }
      if (act === 'assistantUndo') {
        const res = NK.assistant.undo(arg);
        pushBot({ text: res.msg });
        return;
      }
      if (act === 'assistantCompletePick') {
        pushBot(NK.assistant.completePick(arg)[0]); return;
      }
      if (act === 'assistantUpdatePick') {
        const parts = String(arg).split('__SUB__');
        const id = parts[0];
        const sub = parts.length > 1 ? decodeURIComponent(parts[1]) : '';
        pushBot(NK.assistant.updatePick(id, sub)[0]); return;
      }
      if (act === 'assistantConfirmDailyAll') {
        pushBot(NK.assistant.confirmDailyAll(arg)[0]); return;
      }
      if (act === 'assistantConfirmClearAlerts') {
        pushBot(NK.assistant.confirmClearAlerts()[0]); return;
      }
      if (act === 'assistantConfirmIntent') {
        pushBot(NK.assistant.confirmIntent(arg)[0]); return;
      }
      if (act === 'assistantRevokePick') {
        pushBot(NK.assistant.x_dispatch_revoke({ dispatchId: arg, candidates: [] })[0]); return;
      }
      if (act === 'assistantDeletePick') {
        pushBot(NK.assistant.x_dispatch_delete({ dispatchId: arg, candidates: [] })[0]); return;
      }
      if (act === 'assistantConfirmRevokeDispatch') {
        const r = NK.assistant.confirmRevokeDispatch(arg);
        pushBot({ text: r.msg });
        if (r.ok) { UI.renderHome(); UI.refreshBadges(); UI.renderDispatch(); }
        return;
      }
      if (act === 'assistantConfirmDeleteDispatch') {
        const r = NK.assistant.confirmDeleteDispatch(arg);
        pushBot({ text: r.msg });
        if (r.ok) { UI.renderHome(); UI.refreshBadges(); UI.renderDispatch(); }
        return;
      }
      if (act === 'assistantNoop') { return; }
      if (act === 'assistantShowLogs') {
        UI.assistantLogs();
        return;
      }
      // 其他 JS 表达式
      // eslint-disable-next-line no-eval
      eval(act);
    } catch (e) {
      UI.toast('花姐，这个操作暂时没成功，请重试～', 'warn');
    }
  };

  /** 推送一条消息（支持纯文本或 {text, actions} 结构） */
  const push = (who, content) => {
    const d = document.createElement('div');
    d.className = 'ap-msg ' + (who === 'me' ? 'me' : 'her');
    if (typeof content === 'string') {
      d.textContent = content;
    } else {
      const textDiv = document.createElement('div');
      textDiv.className = 'ap-text';
      textDiv.textContent = content.text || '';
      d.appendChild(textDiv);
      if (content.actions && content.actions.length) {
        const actWrap = document.createElement('div');
        actWrap.className = 'am-actions';
        content.actions.forEach(a => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'am-btn';
          b.textContent = a.label;
          b.onclick = () => runAct(a.act, a.arg);
          actWrap.appendChild(b);
        });
        d.appendChild(actWrap);
      }
    }
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
    return d;
  };

  const pushBot = (content) => push('her', content);
  const pushMe = (text) => push('me', text);

  /** 发送处理 */
  const ask = () => {
    const q = input.value.trim();
    if (!q) return;
    pushMe(q);
    input.value = '';
    // 加载提示
    const loading = document.createElement('div');
    loading.className = 'ap-msg her ap-loading';
    loading.textContent = '花姐助手正在理解你的意思…';
    body.appendChild(loading);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => {
      try {
        const replies = (NK.assistant && NK.assistant.handle) ? NK.assistant.handle(q, ctx) : NK.assistantReply(q);
        loading.remove();
        (Array.isArray(replies) ? replies : [{ text: replies }]).forEach(r => pushBot(r));
      } catch (e) {
        loading.remove();
        pushBot({ text: '花姐，助手处理时出了点小问题，麻烦换个说法试试～' });
      }
    }, 180);
  };

  /** 欢迎语 + 快捷指令 */
  const welcome = () => {
    pushBot('花姐你好呀 ✨\n你可以直接告诉我想查什么、记录什么或完成什么。');
    const tips = document.createElement('div');
    tips.className = 'ap-quick';
    quickCmds.forEach(c => {
      const q = document.createElement('button');
      q.type = 'button';
      q.className = 'ap-quick-btn';
      q.textContent = c;
      q.onclick = () => { input.value = c; ask(); };
      tips.appendChild(q);
    });
    body.appendChild(tips);
  };

  document.getElementById('assistantBtn').onclick = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      input.focus();
      if (!body.children.length) welcome();
    }
  };
  document.getElementById('apClose').onclick = () => panel.classList.add('hidden');
  document.getElementById('apSend').onclick = ask;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); ask(); }
  });
};

/** 操作日志面板 */
UI.assistantLogs = () => {
  const logs = (NK.assistant && NK.assistant.logs) ? NK.assistant.logs() : [];
  if (!logs.length) {
    UI.toast('花姐，目前还没有助手操作记录～', 'ok');
    return;
  }
  const rows = logs.map(l => `
    <div class="al-row">
      <div class="al-line"><span class="badge ${l.undone ? 'gray' : 'accent'}">${l.undone ? '已撤销' : '已执行'}</span>
        <strong>${NK.esc(l.summary || l.action)}</strong></div>
      <div class="al-sub">${NK.esc(l.targetModule || '')} · ${NK.fmtDT(new Date(l.time))}</div>
      ${l.raw ? `<div class="al-raw">原话：${NK.esc(l.raw)}</div>` : ''}
      ${!l.undone && l.snapshot ? `<button class="btn btn-sm" data-op="${NK.esc(l.operationId)}">撤销</button>` : ''}
    </div>`).join('');
  UI.modal('花姐助手 · 操作记录', `<div class="al-list">${rows}</div>`,
    `<button class="btn" data-close>关闭</button>`,
    { size: 'modal-md', onMount(root) {
      root.querySelectorAll('[data-op]').forEach(b => {
        b.onclick = () => {
          const res = NK.assistant.undo(b.dataset.op);
          UI.toast(res.msg, res.ok ? 'ok' : 'warn');
          UI.modalClose();
          UI.assistantLogs();
        };
      });
    } });
};

/* ============================================================
   启动
   ============================================================ */
UI.init = () => {
  NK.initDB();
  // 导航
  document.querySelectorAll('#sidebar .nav-item').forEach(n => {
    n.onclick = () => UI.nav(n.dataset.view);
  });
  UI.bindSearch();
  UI.bindAssistant();
  // 点击其它区域关闭「实时告警」更多下拉
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.al-more-wrap')) UI.alertMoreCloseAll();
  });
  // 模式切换
  const label = document.getElementById('modeLabel');
  const dot = document.querySelector('.mode-switch .mode-dot');
  if (NK.mode === 'demo') {
    label.textContent = '演示模式';
    dot.classList.add('demo');
    const b = document.createElement('div');
    b.id = 'demoBanner';
    b.className = 'demo-banner';
    b.textContent = '作品演示模式：姓名/电话/地址已脱敏，仅用于作品展示';
    document.body.appendChild(b);
  }
  document.getElementById('modeSwitch').onclick = () => UI.toggleMode();

  // —— 全站按钮类型归一：确保非提交按钮均为 type="button" ——
  // 本应用无 <form>，按钮默认 type 为 submit 不会触发表单提交，
  // 但为满足「非提交按钮必须 type='button'」的验收要求，统一归一化。
  // 通过 MutationObserver 覆盖 #main 视图与 #modalRoot 弹窗的后续动态按钮。
  UI.__normalizeButtons = (scope) => {
    (scope || document).querySelectorAll('button').forEach((b) => {
      if (!b.getAttribute('type')) b.setAttribute('type', 'button');
    });
  };
  if (typeof MutationObserver !== 'undefined') {
    UI.__btnObserver = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'BUTTON' && !n.getAttribute('type')) n.setAttribute('type', 'button');
          else UI.__normalizeButtons(n);
        });
      }
    });
    const mainEl = document.getElementById('main');
    const modalEl2 = document.getElementById('modalRoot');
    if (mainEl) UI.__btnObserver.observe(mainEl, { childList: true, subtree: true });
    if (modalEl2) UI.__btnObserver.observe(modalEl2, { childList: true, subtree: true });
  }
  UI.__normalizeButtons(document);
  // 每日任务与首屏
  NK.ensureFixedTasks();
  NK.save();
  UI.nav('home');
  UI.refreshBadges();
  // 定时刷新提醒
  if (NK.globalTimer) clearInterval(NK.globalTimer);
  NK.globalTimer = setInterval(() => {
    NK.ensureFixedTasks();
    NK.save();
    UI.refreshBadges();
    if (NK.currentView === 'home') UI.renderHome();
  }, 300000);
};

// 页面加载完成后启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', UI.init);
} else {
  UI.init();
}
