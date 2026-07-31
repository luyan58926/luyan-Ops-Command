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
    '待处理': 'gray', '草稿': 'gray', '待派单': 'gray', '未开始': 'gray', '已暂停': 'gray', '已取消': 'gray', '已生成': 'gray',
    '有风险': 'risk', '已超时': 'risk', '升级处理': 'risk', '计划撤场': 'risk', '已撤场': 'risk', '搬迁中': 'risk',
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
UI.modal = (title, bodyHTML, footHTML, opts) => {
  opts = opts || {};
  const root = document.getElementById('modalRoot');
  root.innerHTML = `
    <div class="modal ${opts.size || ''}">
      <div class="modal-head"><div class="modal-title">${title}</div>
      <button class="modal-close" data-close>×</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footHTML ? `<div class="modal-foot">${footHTML}</div>` : ''}
    </div>`;
  root.classList.remove('hidden');
  root.querySelector('[data-close]').onclick = () => UI.modalClose();
  if (opts.onMount) opts.onMount(root);
};
UI.modalClose = () => {
  document.getElementById('modalRoot').classList.add('hidden');
  document.getElementById('modalRoot').innerHTML = '';
};
UI.confirm = (msg, onOk, okLabel) => {
  UI.modal('请确认', `<div style="padding:6px 2px">${msg}</div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-danger" id="cfOk">${okLabel || '确认'}</button>`, {
    size: 'modal-sm',
    onMount(root) {
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
      root.querySelector('#cfOk').onclick = () => { UI.modalClose(); onOk(); };
    },
  });
};

/* ================= 导航 ================= */
UI.nav = (view, arg) => {
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
    projects: UI.renderProjects, resources: UI.renderResources, kpi: UI.renderKpi,
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
  const waitCount = NK.db.dispatches.filter(x => x.status === '已生成').length;
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
   今日指挥台 v2 — 四区域结构
   ============================================================ */
UI.renderHome = () => {
  const el = document.getElementById('view-home');
  const now = new Date();
  const h = now.getHours();

  // ── 区域1：轻量问候区（带助手头像）─────────────────────────────
  const hourMap = [
    ['0','快收工了'],['5','快收工了'],['6','早上好'],['7','早上好'],['8','早上好'],['9','早上好'],
    ['10','上午好'],['11','上午好'],['12','中午好'],['13','中午好'],['14','下午好'],['15','下午好'],
    ['16','下午好'],['17','下午好'],['18','傍晚好'],['19','傍晚好']
  ];
  const greeting = (hourMap.find(([k]) => h <= parseInt(k)) || ['晚上好'])[1];
  const greetingEmoji = h < 9 ? '☀️' : h < 12 ? '🌤️' : h < 14 ? '☀️' : h < 17 ? '🌤️' : h < 19 ? '🌅' : '🌙';
  const today = NK.today();

  const rem = NK.genReminders();
  const disps = NK.db.dispatches;
  const tasks = NK.db.tasks;

  const focusItems = NK.genFocusItems();
  const statusText = focusItems.length ? focusItems[0].title : '今天没有紧急事项，继续保持 ✨';
  const greetingSub = focusItems.length
    ? `有 ${focusItems.length} 件需要花姐重点跟进`
    : '当前运维节奏良好';

  // ── 区域2：轻量状态概览 ──────────────────────────────
  const p1 = rem.filter(x => x.level === 'danger').length;
  const waitSend = disps.filter(d => d.status === '已生成').length;
  const waitAccept = disps.filter(d => d.status === '待花姐验收').length;
  const overdue = rem.filter(x => x.title.includes('超时')).length;

  // ── 区域3：横向轻量快捷入口条（6个全部显示）─────────────────────────────
  const quickCards = [
    { icon: '📋', label: '新建派单', sub: '30秒搞定', primary: true, act: 'UI.dispatchCreate()' },
    { icon: '📝', label: '快速记录', sub: '先记下来，别让它溜走', act: 'UI.quickNote()' },
    { icon: '🔍', label: '查资源', sub: '10秒找到人', act: 'UI.resourcesJump()' },
    { icon: '🔄', label: '更新进度', sub: '补一句反馈', act: 'UI.taskCreate(true)' },
    { icon: '📊', label: '登记KPI', sub: '加分扣分都留痕', act: 'UI.kpiEventCreate()' },
    { icon: '📄', label: '生成交接', sub: '一键整理今日', act: 'UI.handoverToday()' },
  ];
  const quickCardsHTML = quickCards.map(q => 
    `<a class="quick-card ${q.primary ? 'qc-primary' : ''}" href="javascript:void(0)" onclick="${q.act}">
      <span class="qc-icon">${q.icon}</span>
      <div class="qc-text">
        <div class="qc-label">${q.label}</div>
        <div class="qc-sub">${q.sub}</div>
      </div>
    </a>`
  ).join('');

  // ── 区域4a：花姐今天重点盯这三件（简化版：只显事实项名称）──
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
      <div class="fc-empty-text">今天没有特别需要盯的事项</div>
    </div>`;

  const focusHTML = `<div class="fc-card">
    <div class="fc-card-head">
      <div class="fc-title"><span class="fc-title-icon">👀</span> 花姐今天重点盯这三件</div>
      ${focusItems.length ? `<span class="badge wait">${focusItems.length}件</span>` : '<span class="badge ok">✓</span>'}
    </div>
    <div class="fc-body">${focusItemsHTML}</div>
  </div>`;

  // ── 区域4b：今日时间轴（定时模板 + 今日新建任务 + 今日新建专项）──
  const tl = [];
  // 1) 每日定时模板
  NK.db.handoverTemplates.forEach(t => {
    if ((t.frequency || '').includes('每日')) {
      const time = t.frequency === '每日14:30' ? '14:30' : (t.frequency.includes('下班') ? '下班前' : '每日');
      const done = NK.db.tasks.find(x => x.templateId === t.id && x.status === '已完成');
      tl.push({
        sort: time === '每日' ? '0800' : time === '下班前' ? '1800' : time.replace(':', ''),
        time, kind: 'tpl', name: t.name, note: t.requirement, pri: t.priority,
        done: !!done, status: done ? '已完成' : '待处理',
      });
    }
  });
  // 2) 今日新建的任务（排除日常模板，避免与定时条目重复）
  tasks.filter(t => (t.createdAt || '').slice(0, 10) === today && t.source !== '日常模板')
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
      !['已闭环', '草稿'].includes(d.status)
    );
  const dispsOnDay = dispOnDay(today);
  dispsOnDay.forEach(d => {
    tl.push({
      sort: (d.planArriveTime || (d.planArrive || today) + 'T12:00').replace(/.*T/, '').slice(0, 5).replace(':', ''),
      time: d.planArriveTime ? d.planArriveTime.slice(0, 5) : (d.planArrive || today).slice(5),
      name: `${NK.v.siteName(d.siteName)} 派单`,
      sub: `${NK.v.engName(d.engineer)} · ${UI.statusBadge(d.status)}`,
      pri: null, type: 'dispatch',
      click: `UI.dispatchDetail('${d.id}')`,
      done: d.status === '已闭环',
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
        const jump = t.kind === 'task'
          ? ` onclick="UI.nav('tasks')" title="点击查看任务"`
          : t.kind === 'project'
            ? ` onclick="UI.nav('projects')" title="点击查看专项"`
            : t.click
              ? ` onclick="${t.click}" title="点击查看详情"`
              : '';
        const clickAttr = jump ? ` class="tl-item ${t.done ? 'tl-done' : ''} tl-link"${jump}` : ` class="tl-item ${t.done ? 'tl-done' : ''}"`;
        return `<div ${clickAttr}>
          <span class="tl-time">${t.time}</span>
          ${t.type === 'dispatch' ? '<span class="badge gray" style="margin-right:4px">派</span>' : ''}
          <span class="tl-name">${t.done ? '✓ ' : ''}${NK.esc(t.name)}</span>
          ${t.pri ? `<span style="margin-left:6px">${UI.priBadge(t.pri)}</span>` : ''}
          ${t.sub ? `<div class="tl-note">${t.sub}</div>` : ''}
        </div>`;
      }).join('')}</div>` : '<div class="fc-empty"><div class="fc-empty-icon">📅</div><div class="fc-empty-text">今天还没有任务和定时事项<br>有安排随时记进来 ✨</div></div>'}
    </div>
  </div>`;

  // ── 组装页面 ──────────────────────────────
  el.innerHTML = `
    <div class="dash-zone dash-greet">
      <div class="dg-avatar">💼</div>
      <div class="dg-text">
        <div class="dg-hello"><span class="dg-emoji">${greetingEmoji}</span>${greeting}，花姐</div>
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
      ${waitAccept > 0 ? `<span class="ds-pill ds-info" onclick="UI.nav('dispatch')"><span class="ds-dot"></span>待花姐验收 <strong>${waitAccept}</strong></span>` : ''}
      ${overdue > 0 ? `<span class="ds-pill ds-danger" onclick="UI.nav('tasks')"><span class="ds-dot"></span>已超时 <strong>${overdue}</strong></span>` : ''}
      ${!p1 && !waitSend && !waitAccept && !overdue ? '<span class="ds-all-ok">✓ 当前无紧急事项，运维节奏良好 ✨</span>' : ''}
    </div>
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
  if (f.status && f.status !== '全部') list = list.filter(d => d.status === f.status);
  if (f.priority && f.priority !== '全部') list = list.filter(d => d.priority === f.priority);
  if (f.q) list = list.filter(d => `${d.no} ${d.title} ${d.city} ${d.engineer} ${d.contactName}`.includes(f.q));
  if (f.overdue) list = list.filter(d => d.planDone && d.planDone < today && d.status !== '已闭环' && d.status !== '已取消');

  const statusOpts = ['全部', ...NK.DISPATCH_STATUS, '已取消', '已暂停'];
  const priOpts = ['全部', 'P1', 'P2', 'P3'];

  el.innerHTML = UI.pageHead('派单中心', '全国派单 · 任务闭环 · 一次录入多处复用',
    `<button class="btn btn-accent" onclick="UI.dispatchCreate()">⇶ 新建派单</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" id="dpQ" placeholder="搜索编号/标题/城市/工程师…" value="${NK.esc(f.q || '')}">
      <select class="fb-select" id="dpStatus">${statusOpts.map(s => `<option ${(f.status || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="dpPri">${priOpts.map(s => `<option ${(f.priority || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="dpOverdue" ${f.overdue ? 'checked' : ''}>只看超时</label>
      <span class="spacer"></span>
      <span style="font-size:12px;color:var(--text-3)">共 ${list.length} 条</span>
    </div>
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>派单编号</th><th>事项</th><th>职场</th><th>工程师</th><th>优先级</th><th>状态</th><th>计划完成</th><th>等待时长</th><th>操作</th></tr></thead>
      <tbody>${list.length ? list.map(d => {
        const disp = NK.v.dispatch(d);
        return `<tr>
          <td class="num">${d.no}</td>
          <td style="max-width:240px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${NK.esc(d.title)}</div>
            <div style="color:var(--text-3);font-size:11px">${NK.esc((d.desc || '').slice(0, 30))}</div></td>
          <td>${NK.esc(disp.siteName || d.city)}</td>
          <td>${NK.esc(disp.engineer || '—')}</td>
          <td>${UI.priBadge(d.priority)}</td>
          <td>${UI.statusBadge(d.status)}${d.urgentCount ? `<div style="font-size:10px;color:var(--warn)">已催${d.urgentCount}次</div>` : ''}</td>
          <td>${d.planDone ? d.planDone : '—'}</td>
          <td>${d.status !== '已闭环' ? NK.waitText(d.createdAt) : '—'}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="UI.dispatchDetail('${d.id}')">详情</button>
            ${d.status === '已生成' ? `<button class="btn btn-sm btn-warn" onclick="UI.dispatchUrgent('${d.id}')">催办</button>` : ''}
            ${d.status === '待花姐验收' ? `<button class="btn btn-sm btn-accent" onclick="UI.dispatchAccept('${d.id}')">验收</button>` : ''}
          </td>
        </tr>`;
      }).join('') : UI.empty('暂无派单，点击右上角「新建派单」开始', 9)}</tbody>
    </table></div></div>`;

  const bind = () => {
    const onFilter = () => {
      NK.dispatchFilter = {
        q: document.getElementById('dpQ').value,
        status: document.getElementById('dpStatus').value,
        priority: document.getElementById('dpPri').value,
        overdue: document.getElementById('dpOverdue').checked,
      };
      UI.renderDispatch();
    };
    document.getElementById('dpQ').addEventListener('input', NK.debounce ? NK.debounce(onFilter, 300) : onFilter);
    document.getElementById('dpStatus').onchange = onFilter;
    document.getElementById('dpPri').onchange = onFilter;
    document.getElementById('dpOverdue').onchange = onFilter;
  };
  setTimeout(bind, 0);
};

/* ============================================================
   极简化派单创建
   ============================================================ */

UI.dispatchCreate = (siteId) => {
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
        <label class="dp-label">派单原因</label>
        <textarea id="dpDesc" class="dp-textarea" placeholder="例如：3楼打印机无法打印，提示卡纸，请安排现场检查。" rows="3"></textarea>
        <div class="dp-hint">输入自然语言即可，无需填写标题</div>
      </div>
      <div class="dp-field">
        <label class="dp-label">上门时间 <span style="color:var(--text-3);font-weight:400;font-size:11px">选填，方便排入时间轴</span></label>
        <input type="date" id="dpArriveDate" class="dp-input dp-date-input" style="color:var(--text)">
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

  UI.modal('新建派单', body, '', {
    size: 'modal-dispatch',
    onMount(root) {
      const searchInput  = root.querySelector('#dpSiteSearch');
      const descInput   = root.querySelector('#dpDesc');
      const arriveInput = root.querySelector('#dpArriveDate');
      const submitBtn   = root.querySelector('#dpSubmitBtn');
      const hint        = root.querySelector('#dpHint');
      const candidates  = root.querySelector('#dpCandidates');
      const selected    = root.querySelector('#dpSelected');
      const errorEl     = root.querySelector('#dpError');
      const wrap        = root.querySelector('#dpWrap');
      const successView = root.querySelector('#dpSuccess');

      let pickedSite = null;
      let candidatesShown = [];

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
        addRecent(s);
        searchInput.value = NK.v.siteName(s.name);

        if (!s.needDispatch) {
          errorEl.textContent = `「${NK.v.siteName(s.name)}」为驻场区域，默认由驻场直接处理，无需常规派单。`;
          errorEl.classList.remove('hidden');
          candidates.classList.add('hidden');
          selected.classList.add('hidden');
        } else {
          errorEl.classList.add('hidden');
          candidates.classList.add('hidden');
          selected.innerHTML = `<span class="dps-badge">已选择</span>
            <span class="dps-name">${NK.esc(NK.v.siteName(s.name))}</span>
            <span class="dps-sep">·</span>
            <span class="dps-eng">默认工程师：${NK.esc(NK.v.engName(s.defaultEngineer || '—'))}</span>
            <span class="dps-sep">·</span>
            <span class="dps-type">${s.supportType}</span>`;
          selected.classList.remove('hidden');
        }

        submitBtn.disabled = false;
        descInput.focus();
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
        submitBtn.disabled = !(pickedSite && descInput.value.trim());
      };
      descInput.addEventListener('input', checkSubmit);

      descInput.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'Enter' && !submitBtn.disabled) {
          e.preventDefault();
          submitBtn.click();
        }
      });

      submitBtn.onclick = () => {
        if (!pickedSite || !descInput.value.trim()) return;

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
          planArrive: arriveInput.value,
        });

        wrap.classList.add('hidden');
        root.querySelector('#dpSuccessTitle').textContent =
          `花姐，${NK.v.siteName(pickedSite.name)}的派单已经生成 ✓`;
        root.querySelector('#dpSuccessSub').textContent =
          pickedSite.defaultEngineer
            ? `正在等待 ${NK.v.engName(pickedSite.defaultEngineer)} 确认`
            : `派单已生成，请在详情中指定工程师`;
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
      };

      root.querySelector('[data-close]').onclick = () => UI.modalClose();
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
  const flowIdx = NK.dispatchStep(d.status);
  const flowHTML = `<div class="status-flow">${NK.DISPATCH_FLOW.map((s, i) => `
    <div class="sf-step">
      <div class="sf-dot ${i < flowIdx ? 'done' : i === flowIdx ? 'cur' : ''}">${i < flowIdx ? '✓' : i + 1}</div>
      <div class="sf-name ${i === flowIdx ? 'cur' : i < flowIdx ? 'done' : ''}">${s}</div>
      ${i < NK.DISPATCH_FLOW.length - 1 ? `<div class="sf-line ${i < flowIdx ? 'done' : ''}"></div>` : ''}
    </div>`).join('')}</div>`;

  const timings = [
    ['创建时间', d.createdAt ? NK.fmtDT(new Date(d.createdAt)) : '—'],
    ['已发送时间', d.sentAt ? NK.fmtDT(new Date(d.sentAt)) : '—'],
    ['开始处理', d.startAt ? NK.fmtDT(new Date(d.startAt)) : '—'],
    ['闭环时间', d.doneAt ? NK.fmtDT(new Date(d.doneAt)) : '—'],
    ['已发送后时长', d.sentAt ? NK.humanDur((d.doneAt ? new Date(d.doneAt) : new Date()) - new Date(d.sentAt)) : '未发送'],
    ['总闭环时长', d.doneAt && d.createdAt ? NK.humanDur(new Date(d.doneAt) - new Date(d.createdAt)) : '—'],
  ];

  const body = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
      <span class="num" style="font-weight:700;font-size:14px">${d.no}</span>
      <h3 style="flex:1;font-size:15px">${NK.esc(disp.title)}</h3>
      ${UI.priBadge(d.priority)} ${UI.statusBadge(d.status)}
    </div>
    ${flowHTML}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
      <div class="card"><div class="card-head"><div class="card-title">职场与联系人</div></div><div class="card-body">
        <div class="detail-grid">
          <div class="dg-item"><span class="dg-label">职场</span><span class="dg-val">${NK.esc(disp.siteName || d.city || '—')}</span></div>
          <div class="dg-item"><span class="dg-label">地址</span><span class="dg-val">${NK.esc(disp.address || '—')}</span></div>
          <div class="dg-item"><span class="dg-label">联系人</span><span class="dg-val">${NK.esc(disp.contactName || '—')} ${NK.esc(disp.contactPhone || '')}</span></div>
          <div class="dg-item"><span class="dg-label">支持方式</span><span class="dg-val">${disp.supportType || '—'}${disp.needDispatch ? ' · 需派单' : ''}</span></div>
          <div class="dg-item"><span class="dg-label">工程师</span><span class="dg-val">${NK.esc(disp.engineer || '—')}</span></div>
          <div class="dg-item"><span class="dg-label">工单号</span><span class="dg-val">${NK.esc(d.workNo || '—')}</span></div>
        </div>
      </div></div>
      <div class="card"><div class="card-head"><div class="card-title">时间记录</div></div><div class="card-body">
        ${timings.map(([k, v]) => `<div class="dg-item" style="margin-bottom:6px"><span class="dg-label">${k}</span><span class="dg-val">${v}</span></div>`).join('')}
      </div></div>
    </div>
    <div class="card"><div class="card-head"><div class="card-title">事项描述</div></div><div class="card-body">${NK.esc(d.desc || '—')}
      <div style="margin-top:8px;color:var(--text-3);font-size:11px">要求确认：${d.requireConfirmBy || '—'} ｜ 到场：${d.planArrive || '—'} ${d.planArriveTime || ''} ｜ 完成：${d.planDone || '—'} ${d.planDoneTime || ''}</div>
    </div></div>
    <div class="card"><div class="card-head"><div class="card-title">进展与记录</div><div style="display:flex;gap:6px;flex-wrap:wrap">
      ${d.status !== '已闭环' ? `<button class="btn btn-sm" id="ddFeedback">记录进展</button>` : ''}
      ${d.status !== '已闭环' ? `<button class="btn btn-sm btn-warn" id="ddUrgent">催一下</button>` : ''}
      ${d.status === '已处理' ? `<button class="btn btn-sm btn-accent" id="ddAccept">去验收</button>` : ''}
      ${d.status === '待花姐验收' ? `<button class="btn btn-sm btn-accent" id="ddAccept">验收通过</button>` : ''}
      ${d.status !== '已闭环' ? `<button class="btn btn-sm btn-success" id="ddClose">完成闭环</button>` : ''}
    </div></div>
    <div class="card-body">
      <div class="dg-item" style="margin-bottom:6px"><span class="dg-label">当前卡点</span><span class="dg-val">${NK.esc(d.nextAction || '—')}</span></div>
      <div class="dg-item" style="margin-bottom:6px"><span class="dg-label">最新进展</span><span class="dg-val">${NK.esc(d.latestFeedback || '—')}</span></div>
      <div class="dg-item" style="margin-bottom:6px"><span class="dg-label">处理结果</span><span class="dg-val">${NK.esc(d.result || '—')}</span></div>
      <div class="dg-item"><span class="dg-label">验收结论</span><span class="dg-val">${NK.esc(d.acceptResult || '—')}</span></div>
      ${d.reminders && d.reminders.length ? `<div style="margin-top:8px;font-size:11px;color:var(--warn)">已催办 ${d.reminders.length} 次：${d.reminders.map(r => NK.fmtDT(new Date(r.t))).join('、')}</div>` : ''}
    </div></div>
    <div class="card"><div class="card-head"><div class="card-title">派单消息</div><div><button class="btn btn-sm" id="ddCopyMsg">复制</button></div></div>
      <div class="card-body"><div class="msg-preview">${NK.esc(d.msg || '')}</div></div></div>
    <div class="card"><div class="card-head"><div class="card-title">关联任务</div></div><div class="card-body">
      ${t ? `<div class="dg-item"><span class="dg-label">任务号</span><span class="dg-val">${t.no} ${NK.esc(t.name)} ${UI.statusBadge(t.status)}</span></div>
      <div style="margin-top:8px"><button class="btn btn-sm" onclick="UI.taskDetail('${t.id}')">查看任务</button></div>` : '—'}
    </div></div>`;
  const foot = `<button class="btn" data-close>关闭</button>`;
  UI.modal(`派单详情`, body, foot, {
    size: 'modal-lg',
    onMount(root) {
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
      const b1 = root.querySelector('#ddFeedback');
      if (b1) b1.onclick = () => UI.dispatchFeedback(d.id);
      const b2 = root.querySelector('#ddUrgent');
      if (b2) b2.onclick = () => UI.dispatchUrgent(d.id);
      const b3 = root.querySelector('#ddAccept');
      if (b3) b3.onclick = () => UI.dispatchAccept(d.id);
      const b4 = root.querySelector('#ddClose');
      if (b4) b4.onclick = () => UI.dispatchClose(d.id);
      const b5 = root.querySelector('#ddCopyMsg');
      if (b5) b5.onclick = () => UI.copy(d.msg);
    },
  });
};

/** 记录进展（极简：状态+可选备注） */
UI.dispatchFeedback = (id) => {
  const d = NK.getDispatch(id);
  // 花姐快速状态选项
  const quickActions = [
    { label: '标记已发送', value: '已发送', note: '复制派单消息并发送，记得在微信/Tel里通知工程师' },
    { label: '开始处理', value: '处理中', note: '事项已在处理中' },
    { label: '等待外部条件', value: '等待外部条件', note: '等配件/等现场开放/等客户' },
    { label: '已处理完成', value: '已处理', note: '工程师反馈处理完毕，等待验收' },
  ];
  const body = `
    <p style="margin-bottom:12px;font-size:12px;color:var(--text-2)">快速更新状态（可选补充一句）：</p>
    <div class="qs-grid">${quickActions.map(a => `
      <button class="qs-btn" data-qs="${a.value}" title="${a.note}">${a.label}</button>`).join('')}
    </div>
    <div style="margin-top:12px">
      <textarea id="fbText" rows="3" placeholder="补充一句进展（可不填）" style="width:100%;resize:vertical;box-sizing:border-box"></textarea>
    </div>
    <div style="margin-top:8px">
      <label style="font-size:12px;color:var(--text-2)">下次跟进提醒（可选）：</label>
      <div class="qs-grid" style="margin-top:4px">
        <button class="qs-btn" data-next="30m">30分钟后</button>
        <button class="qs-btn" data-next="1h">1小时后</button>
        <button class="qs-btn" data-next="todaypm">今天下午</button>
        <button class="qs-btn" data-next="tomorrowam">明天上午</button>
        <button class="qs-btn" data-next="custom" style="flex:2">自定义</button>
      </div>
      <input type="datetime-local" id="fbNextTime" style="display:none;margin-top:6px;width:100%;box-sizing:border-box;font-size:13px">
    </div>`;
  UI.modal('记录进展', body, `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="fbOk">保存</button>`, {
    onMount(root) {
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
      // 快速状态按钮
      root.querySelectorAll('.qs-btn[data-qs]').forEach(btn => {
        btn.onclick = () => {
          root.querySelectorAll('.qs-btn[data-qs]').forEach(b => b.classList.remove('qs-active'));
          btn.classList.add('qs-active');
          btn.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        };
      });
      // 下次跟进按钮
      root.querySelectorAll('.qs-btn[data-next]').forEach(btn => {
        btn.onclick = () => {
          const t = btn.dataset.next;
          root.querySelectorAll('.qs-btn[data-next]').forEach(b => b.classList.remove('qs-active'));
          btn.classList.add('qs-active');
          if (t === 'custom') {
            root.querySelector('#fbNextTime').style.display = 'block';
          } else if (t === '30m') {
            const dt = new Date(Date.now() + 30 * 60000);
            root.querySelector('#fbNextTime').value = dt.toISOString().slice(0, 16);
            root.querySelector('#fbNextTime').style.display = 'block';
          } else if (t === '1h') {
            const dt = new Date(Date.now() + 3600000);
            root.querySelector('#fbNextTime').value = dt.toISOString().slice(0, 16);
            root.querySelector('#fbNextTime').style.display = 'block';
          } else if (t === 'todaypm') {
            const dt = new Date(); dt.setHours(17, 0, 0, 0);
            root.querySelector('#fbNextTime').value = dt.toISOString().slice(0, 16);
            root.querySelector('#fbNextTime').style.display = 'block';
          } else if (t === 'tomorrowam') {
            const dt = new Date(); dt.setDate(dt.getDate() + 1); dt.setHours(9, 0, 0, 0);
            root.querySelector('#fbNextTime').value = dt.toISOString().slice(0, 16);
            root.querySelector('#fbNextTime').style.display = 'block';
          }
        };
      });
      root.querySelector('#fbOk').onclick = () => {
        const activeBtn = root.querySelector('.qs-btn[data-qs].qs-active');
        const status = activeBtn ? activeBtn.dataset.qs : null;
        if (!status) { UI.toast('花姐，请先选择一个状态', 'warn'); return; }
        const text = root.querySelector('#fbText').value.trim();
        const nextTime = root.querySelector('#fbNextTime').value;
        // 更新进展
        NK.updateDispatchFeedback(d, { feedback: text || '花姐更新了进展' });
        // 推进状态
        if (status !== d.status) NK.setDispatchStatus(d, status);
        // 设置下次跟进时间
        if (nextTime) d.nextFollowup = new Date(nextTime).toISOString();
        NK.save();
        UI.toast('花姐，进展已记录 ✓');
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
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
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
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

/** 验收派单 */
UI.dispatchAccept = (id) => {
  const d = NK.getDispatch(id);
  UI.modal('验收派单', `
    <p>派单 <b>${d.no}</b>「${NK.esc(d.title)}」<br>当前结果：${NK.esc(d.result || '无记录')}</p>
    <div style="margin-top:10px">
      <div class="form-item"><label>验收结论</label>
        <select id="acResult"><option>验收通过，闭环归档</option><option>验收不通过，退回继续处理</option></select></div>
      <div class="form-item" style="margin-top:10px"><label>验收说明</label><textarea id="acNote" placeholder="可填写验收意见"></textarea></div>
    </div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-accent" id="acOk">确认验收</button>`, {
    onMount(root) {
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
      root.querySelector('#acOk').onclick = () => {
        const pass = root.querySelector('#acResult').value.includes('通过');
        const note = root.querySelector('#acNote').value;
        NK.updateDispatchFeedback(d, {
          acceptResult: (pass ? '验收通过' : '验收不通过') + (note ? '：' + note : ''),
          nextAction: pass ? '已闭环' : '花姐验收不通过，退回继续处理',
        });
        if (pass) {
          NK.setDispatchStatus(d, '已闭环');
          d.acceptResult = '验收通过' + (note ? '：' + note : '');
        } else {
          NK.setDispatchStatus(d, '处理中');
        }
        NK.save();
        UI.toast(pass ? '花姐，这条派单已闭环 ✓' : '花姐，已退回继续处理，记得跟进');
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
      };
    },
  });
};

/** 完成闭环（花姐直接闭环） */
UI.dispatchClose = (id) => {
  const d = NK.getDispatch(id);
  UI.modal('完成闭环', `
    <p>派单 <b>${d.no}</b>「${NK.esc(d.title)}」<br>当前状态：${d.status}</p>
    <div style="margin-top:12px">
      <div class="form-item"><label>闭环说明（可选）</label><textarea id="clNote" placeholder="如：电话确认处理完毕，直接闭环"></textarea></div>
    </div>`,
    `<button class="btn" data-close>取消</button><button class="btn btn-success" id="clOk">确认闭环</button>`, {
    onMount(root) {
      root.querySelector('[data-close]').onclick = () => UI.modalClose();
      root.querySelector('#clOk').onclick = () => {
        const note = root.querySelector('#clNote').value.trim();
        NK.updateDispatchFeedback(d, {
          acceptResult: note ? '直接闭环：' + note : '花姐确认闭环',
          nextAction: '已闭环',
        });
        NK.setDispatchStatus(d, '已闭环');
        NK.save();
        UI.toast('花姐，这条派单已闭环 ✓');
        UI.modalClose();
        UI.renderHome();
        UI.refreshBadges();
      };
    },
  });
};

/** 验收入口（从首页/列表） */
UI.acceptOpen = (id) => {
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
          <div class="sd-sub">${NK.esc(NK.v.siteName(d.siteName))} · ${UI.statusBadge(d.status)}</div></div></div>`;
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
UI.renderTasks = () => {
  const el = document.getElementById('view-tasks');
  const f = NK.taskFilter = NK.taskFilter || {};
  const today = NK.today();
  let list = [...NK.db.tasks].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (f.status && f.status !== '全部') list = list.filter(t => t.status === f.status);
  if (f.type && f.type !== '全部') list = list.filter(t => t.type === f.type);
  if (f.q) list = list.filter(t => `${t.no} ${t.name} ${t.siteName} ${t.engineer}`.includes(f.q));
  if (f.overdue) list = list.filter(t => t.dueDate && t.dueDate < today && t.status !== '已完成');

  // 告警清单
  const rem = NK.genReminders();
  const danger = rem.filter(x => x.level === 'danger');
  const warn = rem.filter(x => x.level !== 'danger');

  // 今日模板任务进度
  const dailyTpls = NK.db.handoverTemplates.filter(t => (t.frequency || '').includes('每日'));
  const todayTasks = NK.db.tasks.filter(t => t.source === '日常模板' && t.createdAt.slice(0, 10) === today);
  const dailyHTML = `<div class="card"><div class="card-head"><div class="card-title">今日日常任务（模板）</div>
    <span class="badge accent">${todayTasks.filter(x => x.status === '已完成').length}/${dailyTpls.length} 完成</span></div>
    <div class="card-body flush">${dailyTpls.length ? dailyTpls.map(t => {
      const tk = todayTasks.find(x => x.name === t.name);
      const done = tk && tk.status === '已完成';
      return `<div class="focus-item">
        <span class="badge ${done ? 'done' : 'wait'}">${done ? '✓' : '待办'}</span>
        <div class="fi-main">
          <div class="fi-title">${NK.esc(t.name)} ${UI.priBadge(t.priority)}</div>
          <div class="fi-meta">${NK.esc(t.requirement || '')} · ${NK.esc(t.frequency || '')}</div>
        </div>
        <div class="fi-actions">${tk ? (done ? `<span style="font-size:11px;color:var(--text-3)">已完成</span>` : `<button class="btn btn-sm btn-accent" onclick="UI.taskDone('${tk.id}')">标为完成</button>`) : `<button class="btn btn-sm" onclick="UI.taskCreate()">补建任务</button>`}</div>
      </div>`;
    }).join('') : '<div class="tbl-empty" style="padding:24px">暂无每日模板</div>'}</div></div>`;

  const alertHTML = `<div class="card"><div class="card-head"><div class="card-title">实时告警</div><span class="badge ${danger.length ? 'risk' : 'done'}">${danger.length} 危险 / ${warn.length} 提醒</span></div>
    <div class="card-body flush">${rem.length ? rem.map(r => `
      <div class="focus-item">
        <span class="badge ${r.level === 'danger' ? 'risk' : r.level === 'accent' ? 'proc' : 'wait'}">${r.level === 'danger' ? '紧急' : r.level === 'accent' ? '验收' : '提醒'}</span>
        <div class="fi-main"><div class="fi-title">${NK.esc(r.title)}</div><div class="fi-meta">${NK.esc(r.content)}</div></div>
        <div class="fi-actions">${(r.actions || []).map(a => `<button class="btn btn-sm" onclick="UI.act('${a.act === 'dispatch' ? 'dispatchDetail' : a.act === 'task' ? 'taskDetail' : 'projectDetail'}','${a.arg}')">${a.label}</button>`).join('')}</div>
      </div>`).join('') : `<div class="tbl-empty" style="padding:24px">✅ 暂无告警，一切正常。</div>`}</div></div>`;

  const statusOpts = ['全部', ...NK.TASK_STATUS];
  const typeOpts = ['全部', ...NK.TASK_TYPES];
  el.innerHTML = UI.pageHead('任务与告警', '任务闭环 · 告警驱动 · 每日模板自动生成',
    `<button class="btn btn-accent" onclick="UI.taskCreate()">✚ 新建任务</button>`) +
    `<div class="filter-bar">
      <input class="fb-input" id="tkQ" placeholder="搜索编号/名称/职场/工程师…" value="${NK.esc(f.q || '')}">
      <select class="fb-select" id="tkStatus">${statusOpts.map(s => `<option ${(f.status || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <select class="fb-select" id="tkType">${typeOpts.map(s => `<option ${(f.type || '全部') === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label style="display:flex;align-items:center;gap:5px;font-size:12px"><input type="checkbox" id="tkOverdue" ${f.overdue ? 'checked' : ''}>只看超时</label>
      <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">共 ${list.length} 条</span>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">${dailyHTML}${alertHTML}</div>
    <div class="card"><div class="card-head"><div class="card-title">全部任务</div></div>
    <div class="table-wrap"><table class="tbl">
      <thead><tr><th>编号</th><th>任务</th><th>类型</th><th>优先级</th><th>职场</th><th>工程师</th><th>状态</th><th>截止</th><th>最后更新</th><th>操作</th></tr></thead>
      <tbody>${list.length ? list.map(t => {
        const v = NK.v.task(t);
        const isOv = t.dueDate && t.dueDate < today && t.status !== '已完成';
        return `<tr>
          <td class="num">${t.no}</td>
          <td style="max-width:220px"><div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${NK.esc(t.name)}</div>
            <div style="color:var(--text-3);font-size:11px">${NK.esc(t.source || '')}</div></td>
          <td><span class="tag">${NK.esc(t.type)}</span></td>
          <td>${UI.priBadge(t.priority)}</td>
          <td>${NK.esc(v.siteName || '—')}</td>
          <td>${NK.esc(v.engineer || '—')}</td>
          <td>${UI.statusBadge(t.status)}${isOv ? `<div style="font-size:10px;color:var(--warn)">已超时</div>` : ''}</td>
          <td>${t.dueDate ? t.dueDate + (t.dueTime ? ' ' + t.dueTime : '') : '—'}</td>
          <td>${(t.updatedAt || t.createdAt).slice(0, 16).replace('T', ' ')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="UI.taskDetail('${t.id}')">详情</button>
            ${t.status !== '已完成' ? `<button class="btn btn-sm btn-accent" onclick="UI.taskFeedback('${t.id}')">更新</button>` : ''}
            ${t.status !== '已完成' ? `<button class="btn btn-sm" onclick="UI.taskUrgent('${t.id}')">催办</button>` : ''}
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
        overdue: document.getElementById('tkOverdue').checked,
      };
      UI.renderTasks();
    };
    document.getElementById('tkQ').addEventListener('input', NK.debounce(onFilter, 300));
    document.getElementById('tkStatus').onchange = onFilter;
    document.getElementById('tkType').onchange = onFilter;
    document.getElementById('tkOverdue').onchange = onFilter;
  };
  setTimeout(bind, 0);
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
    `<button class="btn" onclick="UI.modalClose()">取消</button><button class="btn btn-accent" id="qnSave">保存记录</button>`,
    {
      size: 'modal-note',
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
        // 关闭时检查草稿
        root.querySelector('[data-close]').addEventListener('click', () => {
          clearTimeout(timer);
          const t = document.getElementById('qnTitle').value;
          const c = document.getElementById('qnContent').value;
          if (t || c) {
            NK.saveDraft({ title: t, content: c });
          }
        });
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
    { size: 'modal-note', onMount(root) {
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
  const active = NK.db.tasks.filter(t => t.status !== '已完成' && t.status !== '已取消');
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
   工程师与职场
   ============================================================ */
UI.renderResources = () => {
  const el = document.getElementById('view-resources');
  const q = (NK.resQ || '').trim().toLowerCase();
  const today = NK.today();

  // 工程师卡片
  const engCards = NK.db.engineers.map(e => {
    const v = NK.v.eng(e);
    const sites = NK.sitesByEngineer(e.name);
    const active = NK.db.dispatches.filter(d => d.engineer === e.name && d.status !== '已闭环' && d.status !== '已取消').length;
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

  // 职场表格
  const sites = NK.db.sites.filter(s => {
    if (!q) return true;
    return `${s.id} ${s.name} ${s.city} ${s.province} ${s.address} ${s.contactName} ${s.contactPhone} ${s.defaultEngineer} ${s.remark}`.toLowerCase().includes(q);
  });
  const siteRows = sites.map(s => {
    const v = NK.v.site(s);
    const sup = NK.siteSupport(s);
    const siteDisps = NK.db.dispatches.filter(d => d.siteId === s.id && d.status !== '已闭环');
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

  el.innerHTML = UI.pageHead('工程师与职场', `全国 ${NK.db.sites.length} 个职场 · ${NK.db.engineers.length} 名工程师 · 一次录入多处复用`,
    `<button class="btn" onclick="UI.engAdd()">新增工程师</button><button class="btn btn-accent" onclick="UI.siteAdd()">新增职场</button>`) +
    `<div class="card"><div class="card-head"><div class="card-title">工程师（${NK.db.engineers.length}）</div></div>
      <div class="card-body"><div class="eng-grid">${engCards || '<div class="tbl-empty" style="padding:20px">无匹配工程师</div>'}</div></div></div>
    <div class="filter-bar">
      <input class="fb-input" id="resSearch" placeholder="搜索职场 / 城市 / 工程师 / 联系人 / 电话…" value="${NK.esc(NK.resQ || '')}">
      <span class="spacer"></span><span style="font-size:12px;color:var(--text-3)">职场 ${sites.length} 个</span>
    </div>
    <div class="card"><div class="table-wrap"><table class="tbl">
      <thead><tr><th>职场</th><th>省市</th><th>地址</th><th>联系人</th><th>支持方式</th><th>默认工程师</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${siteRows || UI.empty('未找到匹配的职场', 8)}</tbody>
    </table></div></div>`;

  const inp = document.getElementById('resSearch');
  if (inp) inp.addEventListener('input', NK.debounce(() => {
    NK.resQ = inp.value;
    UI.renderResources();
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
        <div class="fi-meta">${d.no} · ${UI.statusBadge(d.status)} · ${NK.esc(NK.v.engName(d.engineer))} · ${d.createdAt.slice(0, 10)}</div></div>
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
  const disps = NK.db.dispatches.filter(d => d.engineer === e.name).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const tasks = NK.db.tasks.filter(t => t.engineer === e.name && t.status !== '已完成');
  const kpi = NK.computeKpi(e.name, NK.curMonth());
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
        <div class="fi-meta">${d.no} · ${UI.statusBadge(d.status)} · ${d.createdAt.slice(0, 10)}</div></div>
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
  const openDisps = NK.db.dispatches.filter(d => d.status !== '已闭环' && d.status !== '已取消').length;
  const openTasks = NK.db.tasks.filter(t => t.status !== '已完成' && t.status !== '已取消').length;
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
  const tasks = NK.db.tasks.filter(t => t.createdAt.slice(0, 10) >= s && t.createdAt.slice(0, 10) <= end);
  const done = NK.db.tasks.filter(t => t.doneAt && t.doneAt.slice(0, 10) >= s && t.doneAt.slice(0, 10) <= end);
  const evs = NK.db.kpiEvents.filter(e => e.date >= s && e.date <= end);
  const text = [
    `══════ IT运维周报（${s} 至 ${end}）══════`,
    `一、总体概况`,
    `  新建派单 ${disps.length} 单，新建任务 ${tasks.length} 条，完成任务 ${done.length} 条。`,
    `  当前进行中：派单 ${NK.db.dispatches.filter(d => d.status !== '已闭环' && d.status !== '已取消').length} 单 / 任务 ${NK.db.tasks.filter(t => t.status !== '已完成').length} 条 / 专项 ${NK.db.projects.filter(p => p.status !== '已完成').length} 个。`,
    ``,
    `二、派单明细`,
    disps.length ? disps.map(d => `  • [${d.priority}] ${d.no} ${d.title}（${d.city}）→ ${d.engineer}，${d.status}`).join('\n') : `  （本周无新建派单）`,
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
  const disps = NK.db.dispatches.filter(d => d.createdAt.slice(0, 7) === month);
  const tasks = NK.db.tasks.filter(t => t.createdAt.slice(0, 7) === month);
  const done = NK.db.tasks.filter(t => t.doneAt && t.doneAt.slice(0, 7) === month);
  const kpiRows = NK.db.engineers.map(e => { const k = NK.computeKpi(e.name, month); return `${k.engineer}:${k.final}分`; }).join('  ');
  const engStat = NK.db.engineers.map(e => {
    const n = NK.db.tasks.filter(t => t.engineer === e.name && t.createdAt.slice(0, 7) === month).length;
    const nd = NK.db.dispatches.filter(d => d.engineer === e.name && d.createdAt.slice(0, 7) === month).length;
    return `  ${e.name}：任务${n} / 派单${nd}`;
  }).join('\n');
  const text = [
    `══════ IT运维月报（${month}）══════`,
    `一、总体概况`,
    `  新建派单 ${disps.length} 单，新建任务 ${tasks.length} 条，完成任务 ${done.length} 条。`,
    ``,
    `二、工程师工单量`,
    engStat,
    ``,
    `三、工程师KPI`,
    `  ${kpiRows}`,
    ``,
    `四、专项进度`,
    NK.db.projects.filter(p => p.status !== '已取消').map(p => `  • ${p.name}（${p.status}，完成率${p.progress || 0}%）`).join('\n') || `  （无专项）`,
    ``,
    `五、本月KPI事件`,
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
    ['☰ 任务闭环', '派单自动生成任务；由花姐在系统内维护派单状态：已生成→已发送→跟进中→处理中→等待外部条件→已处理→待花姐验收→已闭环；工程师通过微信/Teams/电话沟通，响应与超时由花姐记录的时间自动判定'],
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
    ['派单全流程闭环', '已生成→复制发送→跟进中→处理中→等待外部条件→已处理→待花姐验收→已闭环，全程由花姐留痕'],
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
   花姐助手面板
   ============================================================ */
UI.bindAssistant = () => {
  const panel = document.getElementById('assistantPanel');
  const body = document.getElementById('apBody');
  const input = document.getElementById('apInput');
  const push = (who, text) => {
    const d = document.createElement('div');
    d.className = 'ap-msg ' + (who === 'me' ? 'me' : 'bot');
    d.textContent = text;
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  };
  const ask = () => {
    const q = input.value.trim();
    if (!q) return;
    push('me', q);
    input.value = '';
    const replies = NK.assistantReply(q);
    setTimeout(() => replies.forEach(r => push('bot', r)), 150);
  };
  document.getElementById('assistantBtn').onclick = () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      input.focus();
      if (!body.children.length) {
        push('bot', '花姐你好呀 ✨ 我是你的运维助手，随时待命～');
        push('bot', '可以这样问我：');
        push('bot', '· 湖州谁负责？\n· 今天有什么超时？\n· 有哪些待办？\n· 本月KPI怎么样？\n· 怎么派单？');
      }
    }
  };
  document.getElementById('apClose').onclick = () => panel.classList.add('hidden');
  document.getElementById('apSend').onclick = ask;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });
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
  // 每日任务与首屏
  NK.ensureDailyTasks();
  NK.save();
  UI.nav('home');
  UI.refreshBadges();
  // 定时刷新提醒
  if (NK.globalTimer) clearInterval(NK.globalTimer);
  NK.globalTimer = setInterval(() => {
    NK.ensureDailyTasks();
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
