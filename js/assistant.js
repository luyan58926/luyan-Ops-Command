/* ============================================================
   花姐助手 · 操作助手引擎
   ------------------------------------------------------------
   将花姐的自然语言指令解析为结构化意图，调用现有模块的真实
   数据方法执行，并支持撤销与操作日志。

   设计原则（对应升级需求）：
   - 规则 + 关键词解析优先，外部 AI 作为补充
   - 真实写入现有数据源，绝不只回聊天
   - 少提问：只有影响执行结果才询问
   - 支持撤销与操作日志
   - 数据全部持久化到 NK.db（localStorage）

   依赖：NK（app.js）提供数据层方法，UI（ui.js）提供视图。
   ============================================================ */
(() => {
  if (typeof NK === 'undefined' || typeof UI === 'undefined') return;

  const A = {};
  NK.assistant = A;

  /* ==========================================================
     一、工具函数
     ========================================================== */

  /** 生成 operationId（用于撤销与日志） */
  A.opId = () => 'OP-' + Date.now() + '-' + Math.floor(Math.random() * 1000);

  /** 当前时间 */
  A.now = () => NK.now();
  A.today = () => NK.today();

  /** 规范化日期：支持 "明天" / "后天" / "X月X日" / "YYYY-MM-DD" / "今天" */
  A.normDate = (input) => {
    if (!input) return null;
    const s = String(input).trim();
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    // 相对今天
    if (/^今天$/.test(s)) return fmt(today);
    if (/^明天$/.test(s)) { const d = new Date(today); d.setDate(d.getDate() + 1); return fmt(d); }
    if (/^后天$/.test(s)) { const d = new Date(today); d.setDate(d.getDate() + 2); return fmt(d); }
    if (/^昨天$/.test(s)) { const d = new Date(today); d.setDate(d.getDate() - 1); return fmt(d); }
    // 明天下午/明晚 等 —— 取日期
    const relDate = s.match(/^(明天|后天|今天)/);
    if (relDate) { const d = new Date(today); const off = relDate[1] === '明天' ? 1 : relDate[1] === '后天' ? 2 : 0; d.setDate(d.getDate() + off); return fmt(d); }
    // X月X日 / X月X号
    const md = s.match(/(\d{1,2})月(\d{1,2})[日号]/);
    if (md) { const d = new Date(today.getFullYear(), parseInt(md[1], 10) - 1, parseInt(md[2], 10)); return fmt(d); }
    // YYYY-MM-DD
    const ymd = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (ymd) { const d = new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10)); return fmt(d); }
    // YYYY年M月D日
    const ymd2 = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})[日号]/);
    if (ymd2) { const d = new Date(parseInt(ymd2[1], 10), parseInt(ymd2[2], 10) - 1, parseInt(ymd2[3], 10)); return fmt(d); }
    return null;
  };

  /** 解析时段：上午 / 下午 / 全天 / 晚上（默认全天） */
  A.normPeriod = (s) => {
    if (!s) return '全天';
    if (/上午|早上|中午/.test(s)) return '上午';
    if (/下午|晚上|傍晚|下班后/.test(s)) return '下午';
    return '全天';
  };

  /** 匹配工程师姓名（支持姓名中包含的别名） */
  A.matchEngineer = (text) => {
    if (!text) return null;
    const engs = NK.db.engineers || [];
    for (const e of engs) {
      if (text.indexOf(e.name) !== -1) return e;
    }
    // 姓名别名（常见）
    const aliases = { '孙益东': ['孙哥'], '沈煜钦': ['沈工'] };
    for (const [real, als] of Object.entries(aliases)) {
      if (als.some(a => text.indexOf(a) !== -1)) { const e = engs.find(x => x.name === real); if (e) return e; }
    }
    return null;
  };

  /** 匹配职场（按名称/城市包含） */
  A.matchSite = (text) => {
    if (!text) return null;
    const sites = NK.db.sites || [];
    // 城市优先
    const byCity = NK.sitesByCity(text);
    if (byCity && byCity.length) return byCity[0];
    // 名称包含
    for (const s of sites) {
      if (text.indexOf(s.name) !== -1 || (s.city && text.indexOf(s.city) !== -1)) return s;
    }
    return null;
  };

  /** 模糊匹配任务：按优先级搜索 NK.db.tasks */
  A.matchTask = (kw, opts = {}) => {
    kw = (kw || '').trim();
    if (!kw) return [];
    const tasks = (NK.db.tasks || []).filter(t => {
      if (t.status === '已完成' && !opts.includeDone) return false;
      if (t.status === '已取消') return false;
      return true;
    });
    const score = (t) => {
      let s = 0;
      const name = t.name || '';
      if (name === kw) s += 100;
      else if (name.indexOf(kw) !== -1) s += 60;
      else {
        // 关键词匹配：优先整词，其次 2-gram 相邻双字子串（适应无空格中文）
        const words = kw.replace(/[，。、\s]/g, ' ').split(' ').filter(w => w.length >= 2);
        let hit = 0, denom = words.length;
        words.forEach(w => { if (name.indexOf(w) !== -1) hit++; });
        // 若整词全未命中，退化为 2-gram 滑动匹配
        if (hit === 0 && words.length) {
          const grams = [];
          for (let i = 0; i + 1 < kw.length; i++) grams.push(kw.slice(i, i + 2));
          denom = grams.length;
          grams.forEach(g => { if (name.indexOf(g) !== -1) hit++; });
        }
        if (denom) s += (hit / denom) * 40;
      }
      if (t.engineer && kw.indexOf(t.engineer) !== -1) s += 15;
      if (t.siteName && kw.indexOf(t.siteName) !== -1) s += 10;
      if (t.siteCity && kw.indexOf(t.siteCity) !== -1) s += 8;
      return s;
    };
    const scored = tasks.map(t => ({ t, s: score(t) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.map(x => x.t);
  };

  /** 匹配专项任务 */
  A.matchProject = (kw) => {
    kw = (kw || '').trim();
    if (!kw) return [];
    const pros = (NK.db.projects || []).filter(p => p.status !== '已完成' && p.status !== '已归档');
    const score = (p) => {
      let s = 0;
      const name = p.name || '';
      if (name === kw) s += 100;
      else if (name.indexOf(kw) !== -1) s += 60;
      if (p.goal && kw.indexOf(p.goal) !== -1) s += 15;
      return s;
    };
    return pros.map(p => ({ p, s: score(p) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).map(x => x.p);
  };

  /** 匹配派单：支持编号(no)/标题/职场/工程师；默认排除已删除/已撤销/已取消/已闭环 */
  A.matchDispatch = (kw, opts = {}) => {
    kw = (kw || '').trim();
    if (!kw) return [];
    const includeAll = !!opts.includeAll;
    const disps = (NK.db.dispatches || []).filter(d => {
      if (includeAll) return true;
      if (d.recordStatus === '已删除') return false;
      if (d.status === '已撤销' || d.status === '已取消' || d.status === '已闭环') return false;
      return true;
    });
    const score = (d) => {
      let s = 0;
      const title = d.title || '';
      const no = d.no || '';
      const site = d.siteName || d.city || '';
      const eng = d.engineer || '';
      // 编号精确/前缀优先
      if (no === kw) s += 120;
      else if (no && kw.indexOf(no) !== -1) s += 100;
      else if (kw.startsWith('单') && no && no.indexOf(kw.slice(1)) !== -1) s += 100;
      if (title === kw) s += 80;
      else if (title.indexOf(kw) !== -1) s += 50;
      else if (kw.length >= 2) {
        const words = kw.replace(/[，。、\s]/g, ' ').split(' ').filter(w => w.length >= 2);
        let hit = 0, denom = words.length;
        words.forEach(w => { if (title.indexOf(w) !== -1 || no.indexOf(w) !== -1) hit++; });
        if (hit === 0 && words.length) {
          const grams = [];
          for (let i = 0; i + 1 < kw.length; i++) grams.push(kw.slice(i, i + 2));
          denom = grams.length;
          grams.forEach(g => { if (title.indexOf(g) !== -1 || no.indexOf(g) !== -1) hit++; });
        }
        if (denom) s += (hit / denom) * 40;
      }
      if (site && kw.indexOf(site) !== -1) s += 25;
      if (eng && kw.indexOf(eng) !== -1) s += 15;
      return s;
    };
    const scored = disps.map(d => ({ d, s: score(d) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    return scored.map(x => x.d);
  };

  /** 任务是否超时 */
  A.isOverdue = (t) => t.status !== '已完成' && t.dueDate && t.dueDate < A.today();

  /** 普通任务数据（新增用） */
  A.newTaskData = (intent) => {
    const data = {
      name: intent.title,
      type: intent.taskType || '临时任务',
      priority: intent.priority || 'P3',
      source: '花姐助手',
      nextAction: intent.nextAction || '',
      dueDate: intent.date || intent.startDate || A.today(),
    };
    if (intent.engineerId || intent.personName) data.engineer = intent.engineerId ? (NK.getEngineer(intent.engineerId) ? intent.engineerId : intent.personName) : intent.personName;
    const site = intent.siteName ? NK.getSite(intent.siteName) || A.matchSite(intent.siteName) : null;
    if (site) { data.siteId = site.id; data.siteName = site.name; data.siteCity = site.city; }
    return data;
  };

  /* ==========================================================
     二、意图解析（规则 + 关键词）
     ========================================================== */

  /** 判断是否专项意图 */
  A.isProjectIntent = (q) => {
    if (/专项/.test(q)) return true;
    // 人员 + 持续跟进特征
    const hasPerson = !!A.matchEngineer(q);
    const persist = /督促|未完成|还没|没弄完|继续推进|持续|跟进|长期|后续/.test(q);
    return hasPerson && persist;
  };

  /** 判断是否快速记录（纯记录、无明确执行要求） */
  A.isNoteIntent = (q) => {
    if (/快速记录|记一下|帮我记|记下来|会议记录|备忘|记到记录/.test(q)) return true;
    // 会议/想法/电话记录，无任务动词
    const actionVerbs = /新增|创建|完成|更新|派单|休假|登记|记录|KPI|交接|催办|清空/.test(q);
    if (!actionVerbs && /例会|会议|确认|沟通|讨论|决定|要求/.test(q)) return true;
    return false;
  };

  /**
   * 主解析入口：返回结构化意图对象
   */
  A.parse = (q) => {
    q = (q || '').trim();
    const intent = {
      intent: 'unknown', action: '', targetModule: '', targetId: '',
      title: '', description: '', personName: '', engineerId: '', siteName: '',
      taskType: '', date: '', startDate: '', endDate: '', timePeriod: '',
      status: '', nextAction: '', batchOperation: false, requiresConfirmation: false,
      confidence: 0, raw: q,
    };

    if (!q) return intent;

    /* —— 查询类 —— */
    if (/今天.*休假|谁休假|休假.*谁|今日休假/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'leave_today', targetModule: 'leave', confidence: 0.95 });
    }
    if (/谁负责|负责.*(湖州|城市|职场)|工程师.*(湖州|哪里)|(湖州|某职场).*谁/.test(q)) {
      const cityM = q.match(/([\u4e00-\u9fa5]{2,4})谁负责|([\u4e00-\u9fa5]{2,4})负责|([\u4e00-\u9fa5]{2,4})工程师/);
      return Object.assign(intent, { intent: 'query', action: 'site_engineer', targetModule: 'resources', siteName: (cityM && (cityM[1] || cityM[2] || cityM[3])) || '', confidence: 0.9 });
    }
    if (/超时|逾期|风险/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'overdue', targetModule: 'alerts', confidence: 0.92 });
    }
    if (/待办|待确认|待验收|要做什么|有哪些待办/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'todo', targetModule: 'tasks', confidence: 0.9 });
    }
    if (/实时告警|告警|当前告警/.test(q) && !/清空/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'alerts', targetModule: 'alerts', confidence: 0.88 });
    }
    if (/KPI|绩效|得分|评分/.test(q) && !/登记|记|扣分|不完整|遗漏|候选/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'kpi', targetModule: 'kpi', confidence: 0.9 });
    }
    if (/专项进度|专项.*进展|专项.*怎样|专项.*怎么样/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'project_progress', targetModule: 'projects', confidence: 0.88 });
    }
    if (/快速记录.*查询|查询.*记录|我的记录|有哪些记录/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'notes', targetModule: 'notes', confidence: 0.85 });
    }
    if (/今天.*情况|今日概览|今天怎么样|总体情况/.test(q)) {
      return Object.assign(intent, { intent: 'query', action: 'overview', targetModule: 'home', confidence: 0.85 });
    }

    /* —— 清空告警（高风险，需确认） —— */
    if (/清空.*告警|清空告警/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'clear_alerts', targetModule: 'alerts', batchOperation: true, requiresConfirmation: true, confidence: 0.95 });
    }

    /* —— 批量完成今日日常（高风险，需确认） —— */
    if (/今日日常.*完成|日常任务.*全部完成|全部完成.*日常|批量完成|完成今日日常|完成今天日常/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'complete_daily_all', targetModule: 'tasks', batchOperation: true, requiresConfirmation: true, confidence: 0.9 });
    }

    /* —— 上下文补充（"给它补一句"等），需在快速记录/新增任务前优先识别 —— */
    if (/给它补|补一句|补充一下|给.*加一句|补一条/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'context_append', targetModule: 'tasks', description: q.replace(/给它补|补一句|补充一下|给.*加一句|补一条/g, '').replace(/^[，,：:]+/, '').trim(), confidence: 0.75 });
    }

    /* —— 完成指定任务 —— */
    const doneM = q.match(/^(?:请)?完成[：:]?(.+)/);
    if (doneM || (/^完成/.test(q) && !/全部/.test(q))) {
      const kw = doneM ? doneM[1] : q.replace(/^完成/, '').replace(/。?$/, '');
      return Object.assign(intent, { intent: 'action', action: 'complete_task', targetModule: 'tasks', title: kw.trim(), confidence: 0.85 });
    }

    /* —— 更新任务进度 —— */
    const updM = q.match(/更新(.+?)(?:[，,：:])(.+)$/);
    if (updM) {
      return Object.assign(intent, {
        intent: 'action', action: 'update_task', targetModule: 'tasks',
        title: updM[1].trim(), description: updM[2].trim(), nextAction: updM[2].trim(),
        confidence: 0.85,
      });
    }

    /* —— 登记休假 —— */
    if (/休假|请假|休年假/.test(q) && /登记|记录|帮我登记|请假/.test(q) || (/休假/.test(q) && /登记|记录/.test(q))) {
      const eng = A.matchEngineer(q);
      const period = A.normPeriod(q);
      const start = A.normDate(q) || A.today();
      return Object.assign(intent, {
        intent: 'action', action: 'leave_create', targetModule: 'leave',
        personName: eng ? eng.name : '', engineerId: eng ? eng.id : '',
        startDate: start, endDate: start, timePeriod: period,
        confidence: eng ? 0.9 : 0.7,
      });
    }

    /* —— 撤销派单（业务取消） —— */
    if (/撤销.*派单|把.*派单撤销|取消.*派单/.test(q) && !/撤销刚才|撤销.*上一步/.test(q)) {
      const kw = q.replace(/撤销|派单|了|吧|把/g, '').replace(/^[，,：:\s]+/, '').replace(/[，。、]?$/, '').trim();
      const cands = A.matchDispatch(kw || q);
      const unique = cands.length === 1;
      return Object.assign(intent, {
        intent: 'action', action: 'dispatch_revoke', targetModule: 'dispatch',
        dispatchId: unique ? cands[0].id : '', matchKw: kw, candidates: unique ? [] : cands.map(d => ({ id: d.id, no: d.no, title: d.title })),
        confidence: unique ? 0.85 : (cands.length ? 0.5 : 0.3),
      });
    }

    /* —— 删除派单（录入错误 → 回收站） —— */
    if (/删除.*派单|把.*派单删除/.test(q) && !/撤销刚才|撤销.*上一步/.test(q)) {
      const kw = q.replace(/删除|派单|了|吧|把/g, '').replace(/^[，,：:\s]+/, '').replace(/[，。、]?$/, '').trim();
      const cands = A.matchDispatch(kw || q, { includeAll: true });
      const unique = cands.length === 1;
      return Object.assign(intent, {
        intent: 'action', action: 'dispatch_delete', targetModule: 'dispatch',
        dispatchId: unique ? cands[0].id : '', matchKw: kw, candidates: unique ? [] : cands.map(d => ({ id: d.id, no: d.no, title: d.title, status: d.status })),
        confidence: unique ? 0.85 : (cands.length ? 0.5 : 0.3),
      });
    }

    /* —— 创建派单（打开预填） —— */
    if (/创建派单|新建派单|派单|报障|报修/.test(q) && !/新增任务|创建任务|新任务|记得任务/.test(q)) {
      const eng = A.matchEngineer(q);
      const site = A.matchSite(q);
      let reason = '';
      const after = q.split(/派单|报障|报修/).pop() || '';
      reason = after.replace(/^[，,：:]+/, '').replace(/。?$/, '').trim();
      return Object.assign(intent, {
        intent: 'action', action: 'dispatch_create', targetModule: 'dispatch',
        siteName: site ? site.name : '', personName: eng ? eng.name : '',
        description: reason, confidence: site ? 0.85 : 0.7,
      });
    }

    /* —— KPI 候选事件 —— */
    if (/登记KPI|KPI事件|KPI候选|记KPI/.test(q) || (/KPI/.test(q) && /扣分|不完整|未完成|遗漏/.test(q))) {
      const eng = A.matchEngineer(q);
      const rest = q.replace(/登记KPI|记KPI|KPI候选|KPI事件/g, '').replace(/^[，,：:]+/, '').trim();
      return Object.assign(intent, {
        intent: 'action', action: 'kpi_event', targetModule: 'kpi',
        personName: eng ? eng.name : '', engineerId: eng ? eng.id : '',
        description: rest, confidence: eng ? 0.85 : 0.6,
      });
    }

    /* —— 生成今日交接 —— */
    if (/生成今日交接|今日交接|生成交接|交接/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'handover', targetModule: 'reports', confidence: 0.9 });
    }

    /* —— 快速记录 —— */
    if (/快速记录|记一下|帮我记|记到记录|记录本|备忘/.test(q) || A.isNoteIntent(q)) {
      const content = q.replace(/快速记录|记一下|帮我记|记到记录|记录本|备忘/g, '').replace(/^[，,：:]+/, '').replace(/。?$/, '').trim();
      return Object.assign(intent, { intent: 'action', action: 'quick_note', targetModule: 'notes', description: content, confidence: content ? 0.85 : 0.5 });
    }

    /* —— 新增专项任务 —— */
    if (/新增专项|创建专项/.test(q) || A.isProjectIntent(q)) {
      const title = q.replace(/新增专项|创建专项|新增任务|创建任务/g, '').replace(/^[，,：:]+/, '').replace(/。?$/, '').trim();
      let next = '';
      const nextM = title.match(/(需要|要|继续|下一步|后面)?(督促|跟进|推进|确认|催|持续)/);
      if (nextM) next = nextM[0];
      const eng = A.matchEngineer(q);
      return Object.assign(intent, {
        intent: 'action', action: 'project_create', targetModule: 'projects',
        title: title, nextAction: next, personName: eng ? eng.name : '', engineerId: eng ? eng.id : '',
        confidence: 0.85,
      });
    }

    /* —— 新增普通任务 —— */
    if (/新增任务|创建任务|新增|创建|记得任务|新任务/.test(q)) {
      const title = q.replace(/新增任务|创建任务|新增|创建|记得任务|新任务/g, '').replace(/^[，,：:]+/, '').replace(/。?$/, '').trim();
      const date = A.normDate(q);
      const period = A.normPeriod(q);
      return Object.assign(intent, {
        intent: 'action', action: 'task_create', targetModule: 'tasks',
        title: title, date: date || A.today(), timePeriod: period, confidence: title ? 0.85 : 0.5,
      });
    }

    /* —— 撤销 —— */
    if (/撤销.*(刚才|上次|刚才操作|上一步)/.test(q) || /撤销刚才/.test(q) || /上一步/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'undo', targetModule: 'assistant', confidence: 0.8 });
    }

    /* —— 操作日志 —— */
    if (/操作记录|操作日志|助手.*记录|查看.*操作/.test(q)) {
      return Object.assign(intent, { intent: 'action', action: 'logs', targetModule: 'assistant', confidence: 0.8 });
    }

    return intent;
  };

  /* ==========================================================
     三、撤销机制
     ========================================================== */

  /** 保存操作日志（含快照，用于撤销） */
  A._logOp = (op) => {
    if (!NK.db.assistantOps) NK.db.assistantOps = [];
    // 归一化：调用处传 before，撤销统一读 snapshot
    const rec = Object.assign({
      operationId: A.opId(), time: A.now(), undone: false,
    }, op);
    if (rec.before && !rec.snapshot) { rec.snapshot = rec.before; delete rec.before; }
    NK.db.assistantOps.push(rec);
    // 最多保留 100 条
    if (NK.db.assistantOps.length > 100) NK.db.assistantOps = NK.db.assistantOps.slice(-100);
    NK.save();
    return NK.db.assistantOps[NK.db.assistantOps.length - 1];
  };

  A.logs = () => (NK.db.assistantOps || []).slice().reverse();

  /** 撤销一个操作：按 operationId 恢复 */
  A.undo = (operationId) => {
    const ops = NK.db.assistantOps || [];
    const op = ops.find(o => o.operationId === operationId);
    if (!op) return { ok: false, msg: '找不到这条操作记录' };
    if (op.undone) return { ok: false, msg: '这条操作已经撤销过了' };
    if (!op.snapshot) return { ok: false, msg: '这条操作不支持撤销' };

    try {
      // 恢复数据
      for (const key of Object.keys(op.snapshot)) {
        NK.db[key] = op.snapshot[key];
      }
      op.undone = true;
      op.undoneAt = A.now();
      NK.save();
      return { ok: true, msg: '花姐，刚才的操作已撤销 ✓', op };
    } catch (e) {
      return { ok: false, msg: '撤销失败：' + e.message };
    }
  };

  /** 撤销最近一次由助手执行的、可撤销的操作 */
  A.undoLast = () => {
    const ops = (NK.db.assistantOps || []).slice().reverse();
    const last = ops.find(o => !o.undone && o.snapshot);
    if (!last) return { ok: false, msg: '花姐，暂时没有可撤销的操作哦' };
    return A.undo(last.operationId);
  };

  /** 为操作拍摄快照（记录要修改的数组） */
  A._snapshot = (keys) => {
    const snap = {};
    for (const k of keys) {
      snap[k] = JSON.parse(JSON.stringify(NK.db[k] || []));
    }
    return snap;
  };

  /** 记录某条回复的撤销按钮 */
  A._undoBtn = (operationId, label = '撤销') => ({
    label, act: 'assistantUndo', arg: operationId,
  });

  /* ==========================================================
     四、查询类执行
     ========================================================== */

  /** 查询：今日休假 */
  A.q_leave_today = () => {
    const leaves = NK.leavesToday();
    if (!leaves.length) {
      return [{ text: `🙂 今天${NK.db.engineers.length}名工程师均在岗，无人休假。` }];
    }
    const lines = leaves.map(l => {
      const cover = l.dispatchStatus === '已闭环' || l.dispatchRequired === '否' ? '无需派单' : (l.dispatchStatus === '已安排' ? '已安排补位' : '未安排补位');
      return `- ${NK.v.engName(l.engineerName)}：${l.leavePeriod === '全天' ? '全天' : (l.leavePeriod + '时段')}，${cover}`;
    });
    return [{ text: `花姐，今天有 ${leaves.length} 名工程师休假：\n` + lines.join('\n') }];
  };

  /** 查询：职场/工程师 */
  A.q_site_engineer = (siteName) => {
    const city = siteName;
    const sites = city ? NK.sitesByCity(city) : (NK.db.sites || []).slice(0, 1);
    if (!sites || !sites.length) {
      return [{ text: `花姐，没找到「${city}」的职场资料，换个城市或职场简称试试～` }];
    }
    const lines = sites.map(s => {
      const eng = NK.getEngineer(s.defaultEngineer);
      return `【${NK.v.siteName(s.name)}】${s.city}：\n  联系人 ${s.contactName} ${NK.v.phone(s.contactPhone)}\n  默认工程师 ${NK.v.engName(s.defaultEngineer)}（${s.supportType || '驻场'}${s.needDispatch ? '，需派单' : '，无需派单'}）\n  ${NK.v.address(s.address)}`;
    });
    return [{ text: `花姐，这是「${city}」的职场信息：\n` + lines.join('\n') }];
  };

  /** 查询：超时/风险 */
  A.q_overdue = () => {
    const rem = NK.genReminders().filter(x => x.level === 'danger');
    if (!rem.length) return [{ text: '花姐，当前没有超时/风险事项 ✨ 一切正常～' }];
    const lines = rem.map(x => `- ${x.title}：${x.content}`).join('\n');
    return [{
      text: `花姐，目前有 ${rem.length} 项超时/风险事项：\n` + lines,
      actions: [{ label: '查看实时告警', act: 'nav', arg: 'tasks' }],
    }];
  };

  /** 查询：今日待办 */
  A.q_todo = () => {
    const rem = NK.genReminders();
    const blocks = [];
    const daily = (NK.db.tasks || []).filter(t => t.status === '待处理' && t.templateId && NK.FIXED_DAILY().some(x => x.id === t.templateId));
    const projPending = (NK.db.projects || []).filter(p => p.status === '未开始' || p.status === '进行中');
    const disp = (NK.db.dispatches || []).filter(d => d.status === '已生成' || d.status === '待花姐验收');
    const leave = NK.leavesToday();
    const manual = (NK.db.tasks || []).filter(t => t.status === '待处理' && !t.templateId);

    if (daily.length) blocks.push(`未完成日常（${daily.length} 项）：${daily.slice(0, 5).map(t => t.name).join('；')}`);
    if (projPending.length) blocks.push(`需推进专项（${projPending.length} 项）：${projPending.slice(0, 4).map(p => p.name).join('；')}`);
    if (disp.length) blocks.push(`待跟进派单（${disp.length} 项）：${disp.slice(0, 4).map(d => d.title).join('；')}`);
    if (leave.length) blocks.push(`今日休假补位（${leave.length} 人）：${leave.map(l => NK.v.engName(l.engineerName)).join('、')}`);
    if (manual.length) blocks.push(`其他任务（${manual.length} 项）：${manual.slice(0, 4).map(t => t.name).join('；')}`);

    if (!blocks.length) return [{ text: '花姐，今天的待办都处理完啦 ✨ 可以安心了～' }];
    return [{ text: '花姐，今天需要关注的事项：\n' + blocks.join('\n') }];
  };

  /** 查询：实时告警 */
  A.q_alerts = () => {
    const alerts = NK.alerts();
    if (!alerts.length) return [{ text: '花姐，当前没有实时告警 ✨' }];
    const lines = alerts.map(a => `- [${a.level === 'danger' ? '严重' : '提醒'}] ${a.title}：${a.content}`).join('\n');
    return [{
      text: `花姐，当前有 ${alerts.length} 条实时告警：\n` + lines,
      actions: [{ label: '查看告警', act: 'nav', arg: 'tasks' }, { label: '清空告警', act: 'assistantClearAlerts' }],
    }];
  };

  /** 查询：KPI */
  A.q_kpi = () => {
    const month = NK.curMonth();
    const rows = NK.db.engineers.map(e => ({ name: e.name, k: NK.computeKpi(e.name, month) }));
    rows.sort((a, b) => b.k.final - a.k.final);
    const text = `花姐，本月（${month}）KPI 概览：\n` + rows.map(x => `- ${NK.v.engName(x.name)}：${x.k.final} 分`).join('\n');
    return [{
      text,
      actions: [{ label: '查看KPI明细', act: 'nav', arg: 'kpi' }],
    }];
  };

  /** 查询：专项进度 */
  A.q_project_progress = () => {
    const pros = (NK.db.projects || []).filter(p => p.status !== '已归档');
    if (!pros.length) return [{ text: '花姐，当前没有进行中的专项任务 ✨' }];
    const lines = pros.map(p => {
      const pct = NK.db.projectTasks && NK.db.projectTasks.some(x => x.projectId === p.id) ?
        Math.round((NK.db.projectTasks.filter(x => x.projectId === p.id && x.status === '已完成').length / NK.db.projectTasks.filter(x => x.projectId === p.id).length) * 100) : 0;
      return `- ${p.name}：${p.status}（进度约 ${pct}%）`;
    }).join('\n');
    return [{
      text: `花姐，当前专项进度：\n` + lines,
      actions: [{ label: '查看专项管理', act: 'nav', arg: 'projects' }],
    }];
  };

  /** 查询：我的记录 */
  A.q_notes = () => {
    const notes = (NK.db.quickNotes || []).filter(n => !n.deleted).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    if (!notes.length) return [{ text: '花姐，我的记录本还是空的，可以跟我说「快速记录，……」，我帮你记下来 📝' }];
    const lines = notes.slice(0, 8).map(n => `- ${n.title || '无标题'}${n.createdAt ? '（' + NK.fmtDT(new Date(n.createdAt)) + '）' : ''}`).join('\n');
    return [{
      text: `花姐，最近 ${Math.min(notes.length, 8)} 条记录：\n` + lines + (notes.length > 8 ? `\n… 共 ${notes.length} 条` : ''),
      actions: [{ label: '查看我的记录', act: 'nav', arg: 'notes' }],
    }];
  };

  /** 查询：今日概览 */
  A.q_overview = () => {
    const rem = NK.genReminders();
    const urgent = rem.filter(x => x.level === 'danger');
    const disps = NK.db.dispatches;
    return [{
      text: `花姐，今天共 ${rem.length} 项提醒：P1/超时 ${urgent.length} 项、待发送 ${disps.filter(d => d.status === '已生成').length} 项、待验收 ${disps.filter(d => d.status === '待花姐验收').length} 项。${urgent.length ? '\n优先级最高：' + urgent.slice(0, 3).map(u => u.title).join('；') : '\n今天没有超时事项 ✨'}`,
      actions: urgent.length ? [{ label: '查看实时告警', act: 'nav', arg: 'tasks' }] : undefined,
    }];
  };

  /* ==========================================================
     五、任务类执行
     ========================================================== */

  /** 创建普通任务（B类：直接执行 + 撤销） */
  A.x_task_create = (intent) => {
    const title = intent.title || intent.description || '';
    if (!title) return [{ text: '花姐，这条任务没识别到标题，麻烦把要做的事情说清楚一点～' }];
    const data = A.newTaskData(intent);
    const snap = A._snapshot(['tasks']);
    const t = NK.createTask(data);
    NK.save();
    const op = A._logOp({
      action: 'task_create', targetModule: 'tasks', title: t.name,
      targetId: t.id, before: snap, result: 'ok',
      summary: `新增任务「${t.name}」`,
    });
    return [{
      text: `花姐，已经新增任务「${t.name}」${intent.date ? '，安排在 ' + intent.date : ''}${intent.timePeriod && intent.timePeriod !== '全天' ? '（' + intent.timePeriod + '）' : ''}。`,
      actions: [{ label: '查看任务', act: 'taskDetail', arg: t.id }, A._undoBtn(op.operationId)],
    }];
  };

  /** 创建专项任务（B类） */
  A.x_project_create = (intent) => {
    const title = intent.title || intent.description || '';
    if (!title) return [{ text: '花姐，这条专项没识别到名称，麻烦补充一下～' }];
    const snap = A._snapshot(['projects', 'projectTasks']);
    const p = NK.createProject({
      name: title,
      type: '临时专项',
      goal: intent.nextAction || '',
      status: '未开始',
      owner: intent.engineerId || '',
      participants: intent.personName ? [intent.personName] : [],
    });
    NK.save();
    const op = A._logOp({
      action: 'project_create', targetModule: 'projects', title: p.name,
      targetId: p.id, before: snap, result: 'ok',
      summary: `新增专项「${p.name}」`,
    });
    return [{
      text: `花姐，已经将「${p.name}」记到专项任务中${intent.nextAction ? '，下一步是' + intent.nextAction : ''}。`,
      actions: [{ label: '查看专项', act: 'projectDetail', arg: p.id }, A._undoBtn(op.operationId)],
    }];
  };

  /** 完成指定任务（B类，模糊需选择） */
  A.x_complete_task = (intent) => {
    const kw = intent.title || '';
    const cands = A.matchTask(kw);
    if (!cands.length) return [{ text: `花姐，我暂时没找到「${kw}」这条任务，换个关键词或告诉我是哪个工程师的试试～` }];
    if (cands.length === 1) {
      const t = cands[0];
      const snap = A._snapshot(['tasks']);
      const beforeStatus = t.status;
      NK.setTaskStatus(t, '已完成');
      NK.save();
      const op = A._logOp({
        action: 'complete_task', targetModule: 'tasks', title: t.name, targetId: t.id,
        before: snap, result: 'ok', summary: `完成任务「${t.name}」`,
      });
      return [{
        text: `花姐，「${t.name}」已经完成。✅`,
        actions: [A._undoBtn(op.operationId)],
      }];
    }
    // 多条候选：让花姐选择
    return [{
      text: `花姐，我找到 ${cands.length} 条相似任务，你要完成哪一条？`,
      actions: cands.slice(0, 4).map(t => ({ label: t.name, act: 'assistantCompletePick', arg: t.id })),
    }];
  };

  /** 更新任务进度（B类，唯一匹配直接更新，多候选选择） */
  A.x_update_task = (intent) => {
    const kw = intent.title || '';
    const newDesc = intent.description || intent.nextAction || '';
    const cands = A.matchTask(kw);
    if (!cands.length) return [{ text: `花姐，没找到「${kw}」这条任务，换个关键词试试～` }];
    if (cands.length === 1) {
      const t = cands[0];
      const snap = A._snapshot(['tasks']);
      const prevFeedback = t.latestFeedback || '';
      t.latestFeedback = newDesc;
      t.nextAction = newDesc;
      t.updatedAt = A.now();
      if (t.status === '待处理' || t.status === '已取消') t.status = '跟进中';
      NK.save();
      const op = A._logOp({
        action: 'update_task', targetModule: 'tasks', title: t.name, targetId: t.id,
        before: snap, result: 'ok', summary: `更新进度「${t.name}」`,
      });
      return [{
        text: `花姐，已更新「${t.name}」的最新进展：\n${newDesc}`,
        actions: [{ label: '查看任务', act: 'taskDetail', arg: t.id }, A._undoBtn(op.operationId)],
      }];
    }
    return [{
      text: `花姐，我找到 ${cands.length} 条相关任务，你要更新哪一条？`,
      actions: cands.slice(0, 4).map(t => ({ label: t.name, act: 'assistantUpdatePick', arg: t.id + '__SUB__' + encodeURIComponent(newDesc) })),
    }];
  };

  /** 批量完成今日日常（C类：需确认，列出影响范围） */
  A.x_complete_daily_all = (intent, confirm) => {
    const today = A.today();
    const pending = (NK.db.tasks || []).filter(t =>
      t.status === '待处理' && t.templateId && NK.FIXED_DAILY().some(x => x.id === t.templateId) && t.fixedDate === today);
    if (!pending.length) return [{ text: '花姐，今天没有需要完成的日常任务了 ✨' }];
    if (!confirm) {
      // 未确认：列出影响范围
      return [{
        text: `花姐，今天还有以下 ${pending.length} 项日常任务未完成：\n` + pending.map((t, i) => `${i + 1}. ${t.name}`).join('\n') + `\n\n是否全部标记为完成？`,
        requiresConfirmation: true,
        actions: [
          { label: '确认全部完成', act: 'assistantConfirmDailyAll', arg: pending.map(t => t.id).join(',') },
          { label: '取消', act: 'assistantNoop' },
        ],
      }];
    }
    // 确认后批量完成
    const ids = (intent._pendingIds || []).length ? intent._pendingIds : pending.map(t => t.id);
    const snap = A._snapshot(['tasks']);
    const targets = (NK.db.tasks || []).filter(t => ids.indexOf(t.id) !== -1);
    targets.forEach(t => NK.setTaskStatus(t, '已完成'));
    NK.save();
    const op = A._logOp({
      action: 'complete_daily_all', targetModule: 'tasks', batchOperation: true,
      before: snap, result: 'ok', summary: `批量完成今日 ${targets.length} 项日常任务`,
    });
    return [{
      text: `花姐，今天的 ${targets.length} 项日常任务已经全部完成，盘面干净了。✨`,
      actions: [{ label: '撤销本次批量操作', act: 'assistantUndo', arg: op.operationId }],
    }];
  };

  /** 完成今日日常（确认回调） */
  A.confirmDailyAll = (idsCsv) => {
    const ids = String(idsCsv || '').split(',').filter(Boolean);
    return A.x_complete_daily_all({ _pendingIds: ids }, true);
  };

  /** 完成指定任务（选择回调） */
  A.completePick = (taskId) => {
    const t = NK.getTask(taskId);
    if (!t) return [{ text: '花姐，这条任务不存在或已失效～' }];
    const snap = A._snapshot(['tasks']);
    const beforeStatus = t.status;
    NK.setTaskStatus(t, '已完成');
    NK.save();
    const op = A._logOp({
      action: 'complete_task', targetModule: 'tasks', title: t.name, targetId: t.id,
      before: snap, result: 'ok', summary: `完成任务「${t.name}」`,
    });
    return [{
      text: `花姐，「${t.name}」已经完成。✅`,
      actions: [A._undoBtn(op.operationId)],
    }];
  };

  /** 更新进度（选择回调） */
  A.updatePick = (taskId, newDesc) => {
    const t = NK.getTask(taskId);
    if (!t) return [{ text: '花姐，这条任务不存在或已失效～' }];
    const snap = A._snapshot(['tasks']);
    t.latestFeedback = newDesc;
    t.nextAction = newDesc;
    t.updatedAt = A.now();
    if (t.status === '待处理' || t.status === '已取消') t.status = '跟进中';
    NK.save();
    const op = A._logOp({
      action: 'update_task', targetModule: 'tasks', title: t.name, targetId: t.id,
      before: snap, result: 'ok', summary: `更新进度「${t.name}」`,
    });
    return [{
      text: `花姐，已更新「${t.name}」的最新进展：\n${newDesc}`,
      actions: [{ label: '查看任务', act: 'taskDetail', arg: t.id }, A._undoBtn(op.operationId)],
    }];
  };

  /* ==========================================================
     六、其他模块执行
     ========================================================== */

  /** 快速记录（B类） */
  A.x_quick_note = (intent) => {
    const content = intent.description || '';
    if (!content) return [{ text: '花姐，这条记录没识别到内容，麻烦把要记的话说清楚一点～' }];
    const snap = A._snapshot(['quickNotes']);
    const title = NK.notesAutoTitle(content);
    NK.db.quickNotes.push({
      id: NK.uid('QN'), title: title, content: content,
      createdAt: A.now(), updatedAt: A.now(), pinned: false, archived: false, deleted: false,
    });
    NK.save();
    const op = A._logOp({
      action: 'quick_note', targetModule: 'notes', title: title,
      targetId: NK.db.quickNotes[NK.db.quickNotes.length - 1].id, before: snap, result: 'ok',
      summary: `新增记录「${title}」`,
    });
    return [{
      text: `花姐，已经帮你记下来了。📝\n「${title}」\n${content}`,
      actions: [{ label: '查看记录', act: 'nav', arg: 'notes' }, A._undoBtn(op.operationId)],
    }];
  };

  /** 登记休假（打开预填 + 仍需确认补位） */
  A.x_leave_create = (intent) => {
    const engName = intent.personName;
    if (!engName) return [{ text: '花姐，休假要告诉我工程师是谁哦～ 比如「登记孙益东明天下午休假」' }];
    // 打开现有休假登记弹窗并预填工程师
    UI.leaveCreate(engName);
    // 预填日期（在弹窗 onMount 后设置）
    setTimeout(() => {
      try {
        const layer = UI.__stack[UI.__stack.length - 1];
        if (!layer) return;
        const root = layer.layer;
        const start = root.querySelector('#lvStart');
        const end = root.querySelector('#lvEnd');
        const period = root.querySelector('#lvPeriod');
        if (start && intent.startDate) start.value = intent.startDate;
        if (end && intent.endDate) end.value = intent.endDate;
        if (period && intent.timePeriod) period.value = intent.timePeriod;
        // 触发补位询问
        if (window.UI && UI.leaveDateChanged) UI.leaveDateChanged();
      } catch (e) {}
    }, 60);
    return [{
      text: `花姐，已经帮你打开休假登记，选中了 ${NK.v.engName(engName)}${intent.startDate ? '，日期 ' + intent.startDate : ''}${intent.timePeriod && intent.timePeriod !== '全天' ? '（' + intent.timePeriod + '）' : ''}。\n请确认是否需要安排补位派单。`,
      actions: [{ label: '前往登记', act: 'nav', arg: 'leave' }],
    }];
  };

  /** 创建派单（打开预填，不静默创建） */
  A.x_dispatch_create = (intent) => {
    const site = intent.siteName ? A.matchSite(intent.siteName) : null;
    const reason = intent.description || '';
    // 打开现有派单创建表单并预填职场与原因（siteId 触发自动选中 + prefillReason 预填原因）
    UI.dispatchCreate(site ? site.id : undefined, { prefillReason: reason });
    return [{
      text: `花姐，已经帮你打开新建派单${site ? '，选中职场「' + NK.v.siteName(site.name) + '」' : ''}${reason ? '，派单原因已填：' + reason : ''}。\n请核对联系人、地址和工程师后确认生成。`,
      actions: site ? [{ label: '前往派单', act: 'nav', arg: 'dispatch' }] : undefined,
    }];
  };

  /** 派单摘要（用于确认卡片） */
  A._dispatchSummary = (d) => {
    const v = NK.v.dispatch(d);
    const site = v.siteName || d.city || '—';
    const eng = v.engineer || '—';
    return `派单 ${d.no}｜${v.title}\n职场：${site}　工程师：${eng}　状态：${d.status}`;
  };

  /** 撤销派单（业务取消；唯一匹配先展示摘要确认） */
  A.x_dispatch_revoke = (intent) => {
    // 多候选：让花姐选
    if (intent.candidates && intent.candidates.length > 1) {
      return [{
        text: `花姐，有 ${intent.candidates.length} 条派单匹配「${intent.matchKw}」，你要撤销哪一条？`,
        actions: intent.candidates.slice(0, 4).map(c => ({
          label: `${c.no} ${c.title}`, act: 'assistantRevokePick', arg: c.id,
        })),
      }];
    }
    const d = intent.dispatchId ? NK.getDispatch(intent.dispatchId) : null;
    if (!d) {
      return [{ text: `花姐，没找到「${intent.matchKw}」这条进行中的派单～ 你可以用派单编号或职场/事项名称描述。` }];
    }
    if (d.status === '已撤销') return [{ text: `花姐，派单 ${d.no} 已经是"已撤销"状态了。` }];
    if (d.recordStatus === '已删除') return [{ text: `花姐，派单 ${d.no} 已在回收站中，请先恢复再撤销。` }];
    return [{
      text: `我将撤销这条派单，撤销后不再进入催办和超时提醒，但会保留完整记录：\n${A._dispatchSummary(d)}\n确认撤销吗？`,
      requiresConfirmation: true,
      actions: [
        { label: '确认撤销', act: 'assistantConfirmRevokeDispatch', arg: d.id },
        { label: '再想想', act: 'assistantNoop' },
      ],
    }];
  };

  /** 删除派单（录入错误 → 回收站；删除为高风险需二次确认） */
  A.x_dispatch_delete = (intent) => {
    if (intent.candidates && intent.candidates.length > 1) {
      return [{
        text: `花姐，有 ${intent.candidates.length} 条派单匹配「${intent.matchKw}」，你要删除哪一条？`,
        actions: intent.candidates.slice(0, 4).map(c => ({
          label: `${c.no} ${c.title}（${c.status}）`, act: 'assistantDeletePick', arg: c.id,
        })),
      }];
    }
    const d = intent.dispatchId ? NK.getDispatch(intent.dispatchId) : null;
    if (!d) {
      return [{ text: `花姐，没找到「${intent.matchKw}」这条派单～ 你可以用派单编号或职场/事项名称描述。` }];
    }
    // 探测是否可普通删除（已处理需引导撤销）—— 仅判断状态，不真正执行删除
    const processed = ['已发送', '跟进中', '处理中', '等待外部条件', '已处理', '待花姐验收', '已闭环'];
    if (processed.includes(d.status) && d.recordStatus !== '已删除') {
      return [{
        text: `花姐，派单 ${d.no} 已经产生处理记录，建议用「撤销派单」保留过程留痕：\n${A._dispatchSummary(d)}\n要改为撤销吗？`,
        requiresConfirmation: true,
        actions: [
          { label: '改为撤销派单', act: 'assistantConfirmRevokeDispatch', arg: d.id },
          { label: '不操作', act: 'assistantNoop' },
        ],
      }];
    }
    return [{
      text: `我将删除这条派单，删除后将移入回收站（可恢复），不会永久清库：\n${A._dispatchSummary(d)}\n删除是不可逆的误录纠错操作，确认删除吗？`,
      requiresConfirmation: true,
      actions: [
        { label: '确认删除', act: 'assistantConfirmDeleteDispatch', arg: d.id },
        { label: '取消', act: 'assistantNoop' },
      ],
    }];
  };

  /** 确认撤销派单（从确认卡片回调） */
  A.confirmRevokeDispatch = (id) => {
    const d = NK.getDispatch(id);
    if (!d) return { ok: false, msg: '找不到这条派单' };
    if (d.status === '已撤销') return { ok: false, msg: `派单 ${d.no} 已经撤销过了` };
    const snap = A._snapshot(['dispatches', 'tasks', 'leaves']);
    const res = NK.revokeDispatch(id, { reason: '花姐助手撤销', cancelTask: true });
    if (!res.ok) return { ok: false, msg: res.msg };
    A._logOp({ type: 'revoke_dispatch', desc: `撤销派单 ${d.no} ${d.title}`, snapshot: snap });
    return { ok: true, msg: res.leaveLinked
      ? '花姐，补位派单已撤销，休假记录已重新标记为"补位待安排"。'
      : '花姐，这条派单已经撤销，不会再进入催办和超时提醒。' };
  };

  /** 确认删除派单（从确认卡片回调） */
  A.confirmDeleteDispatch = (id) => {
    const d = NK.getDispatch(id);
    if (!d) return { ok: false, msg: '找不到这条派单' };
    // 先快照（记录删除前状态），再删除，保证可撤销
    const snap = A._snapshot(['dispatches', 'tasks', 'leaves']);
    const res = NK.softDeleteDispatch(id, { reason: '花姐助手删除', force: false });
    if (!res.ok) {
      if (res.blocked) return { ok: false, msg: res.msg + ' 建议改用撤销派单。' };
      return { ok: false, msg: res.msg };
    }
    A._logOp({ type: 'delete_dispatch', desc: `删除派单 ${d.no} ${d.title}（进回收站）`, snapshot: snap });
    return { ok: true, msg: '花姐，这条错误记录已经移到回收站。' };
  };


  /** KPI 候选事件（B类，只能创建候选，不能正式扣分） */
  A.x_kpi_event = (intent) => {
    const engName = intent.personName;
    if (!engName) return [{ text: '花姐，登记KPI要告诉我工程师是谁哦～ 比如「登记KPI，李亚男SF工单录入不完整」' }];
    const desc = intent.description || '';
    if (!desc) return [{ text: '花姐，这条KPI事件没识别到说明，麻烦补充一下～' }];
    const snap = A._snapshot(['kpiEvents']);
    const ev = NK.addKpiEvent({
      engineer: engName,
      itemId: '',
      itemName: '待定',
      type: 'manual',
      points: 0,
      reason: desc,
      evidence: '',
      source: '花姐助手',
      confirmed: false,
    });
    NK.save();
    const op = A._logOp({
      action: 'kpi_event', targetModule: 'kpi', title: desc, targetId: ev.id,
      before: snap, result: 'ok', summary: `新增KPI候选事件（${engName}）`,
    });
    return [{
      text: `花姐，已经生成一条KPI候选事件（${NK.v.engName(engName)}）：\n${desc}\n等待你确认后才会计入。`,
      actions: [{ label: '审核事件', act: 'nav', arg: 'kpi' }, A._undoBtn(op.operationId)],
    }];
  };

  /** 生成今日交接（展示预览，不覆盖已有） */
  A.x_handover = () => {
    UI.handoverToday();
    return [{ text: '花姐，今日交接已生成并展示预览，可以直接复制粘贴到微信/邮件 📄' }];
  };

  /** 清空实时告警（C类：需确认） */
  A.x_clear_alerts = (intent, confirm) => {
    const alerts = NK.alerts();
    if (!alerts.length) return [{ text: '花姐，当前没有需要清空的告警 ✨' }];
    if (!confirm) {
      return [{
        text: `花姐，当前有 ${alerts.length} 条告警。清空只会移除当前提示，不会删除原始任务。确定清空吗？`,
        requiresConfirmation: true,
        actions: [{ label: '确认清空', act: 'assistantConfirmClearAlerts' }, { label: '取消', act: 'assistantNoop' }],
      }];
    }
    const res = NK.clearAlerts('all');
    const cleared = res && res.cleared ? res.cleared.length : alerts.length;
    return [{
      text: `花姐，已清空 ${cleared} 条实时告警，今天的面板干净了。✨`,
    }];
  };

  /** 清空告警确认回调 */
  A.confirmClearAlerts = () => A.x_clear_alerts({}, true);

  /* ==========================================================
     七、主入口：解析 + 执行，返回结构化回复数组
     ========================================================== */

  /**
   * 返回结构：[{ text, actions?: [{label, act, arg, sub?}], requiresConfirmation? }]
   * act 取值：
   *   - 'nav'            UI.nav(arg)
   *   - 'taskDetail'     UI.taskDetail(arg)
   *   - 'projectDetail'  UI.projectDetail(arg)
   *   - 'dispatchDetail' UI.dispatchDetail(arg)
   *   - 'assistantUndo'  NK.assistant.undo(arg)
   *   - 'assistantCompletePick' / 'assistantUpdatePick' / 'assistantConfirmDailyAll'
   *   - 'assistantConfirmClearAlerts' / 'assistantNoop'
   *   - 其他 JS 表达式字符串
   */
  A.handle = (q, ctx = {}) => {
    const intent = A.parse(q);
    // 记录最近意图到上下文（供"它/补一句"引用）
    if (intent.intent === 'action' && intent.action !== 'context_append') {
      ctx.lastIntent = intent;
    }

    // 撤销指令优先（在任何操作之前）
    if (intent.action === 'undo') {
      const res = A.undoLast();
      return [{ text: res.msg }];
    }
    if (intent.action === 'logs') {
      return A._logsReply();
    }

    // 查询类
    const queryMap = {
      leave_today: () => A.q_leave_today(),
      site_engineer: () => A.q_site_engineer(intent.siteName),
      overdue: () => A.q_overdue(),
      todo: () => A.q_todo(),
      alerts: () => A.q_alerts(),
      kpi: () => A.q_kpi(),
      project_progress: () => A.q_project_progress(),
      notes: () => A.q_notes(),
      overview: () => A.q_overview(),
    };
    if (intent.intent === 'query' && queryMap[intent.action]) {
      return queryMap[intent.action]();
    }

    // 上下文补充（"给它补一句"）
    if (intent.action === 'context_append') {
      return A._contextAppend(intent, ctx);
    }

    // 操作类
    const actionMap = {
      task_create: () => A.x_task_create(intent),
      project_create: () => A.x_project_create(intent),
      complete_task: () => A.x_complete_task(intent),
      update_task: () => A.x_update_task(intent),
      complete_daily_all: () => A.x_complete_daily_all(intent, false),
      quick_note: () => A.x_quick_note(intent),
      leave_create: () => A.x_leave_create(intent),
      dispatch_create: () => A.x_dispatch_create(intent),
      dispatch_revoke: () => A.x_dispatch_revoke(intent),
      dispatch_delete: () => A.x_dispatch_delete(intent),
      kpi_event: () => A.x_kpi_event(intent),
      handover: () => A.x_handover(),
      clear_alerts: () => A.x_clear_alerts(intent, false),
    };
    if (intent.intent === 'action' && actionMap[intent.action]) {
      // 低置信度确认（B类，置信度<0.6 时先确认一次）
      if (['task_create', 'project_create', 'quick_note'].indexOf(intent.action) !== -1 && intent.confidence < 0.6) {
        return [{
          text: `花姐，我理解你是想${intent.action === 'task_create' ? '新增任务' : intent.action === 'project_create' ? '新增专项' : '记一条记录'}，对吗？\n内容：${intent.title || intent.description}`,
          requiresConfirmation: true,
          actions: [
            { label: '确认执行', act: 'assistantConfirmIntent', arg: JSON.stringify(intent) },
            { label: '再想想', act: 'assistantNoop' },
          ],
        }];
      }
      return actionMap[intent.action]();
    }

    // 兜底
    return [{
      text: '花姐，我没太理解你的意思 😅 可以试试：\n· "今天有什么待办"\n· "新增任务，明天下午确认南京网络问题"\n· "快速记录，今天例会……"\n· "登记孙益东明天下午休假"\n· "生成今日交接"',
    }];
  };

  /** 上下文补充：更新最近查询到的任务 */
  A._contextAppend = (intent, ctx) => {
    const last = ctx.lastIntent;
    if (!last || !last.title) {
      return [{ text: '花姐，我还不知道要更新哪个任务，先问一句：你要给哪条任务补进展呀？' }];
    }
    const kw = last.title;
    const cands = A.matchTask(kw);
    if (!cands.length) return [{ text: `花姐，没找到「${kw}」这条任务～` }];
    const t = cands[0];
    const newDesc = intent.description || '';
    if (!newDesc) return [{ text: '花姐，补充的内容没识别到，麻烦再说清楚一点～' }];
    const snap = A._snapshot(['tasks']);
    t.latestFeedback = t.latestFeedback ? t.latestFeedback + '\n' + newDesc : newDesc;
    t.nextAction = newDesc;
    t.updatedAt = A.now();
    if (t.status === '待处理' || t.status === '已取消') t.status = '跟进中';
    NK.save();
    const op = A._logOp({
      action: 'update_task', targetModule: 'tasks', title: t.name, targetId: t.id,
      before: snap, result: 'ok', summary: `补充「${t.name}」进展`,
    });
    return [{
      text: `花姐，已为「${t.name}」补充进展：\n${newDesc}`,
      actions: [{ label: '查看任务', act: 'taskDetail', arg: t.id }, A._undoBtn(op.operationId)],
    }];
  };

  /** 确认意图后执行（低置信度场景） */
  A.confirmIntent = (intentJson) => {
    try {
      const intent = JSON.parse(intentJson);
      const map = {
        task_create: () => A.x_task_create(intent),
        project_create: () => A.x_project_create(intent),
        quick_note: () => A.x_quick_note(intent),
      };
      return (map[intent.action] || (() => [{ text: '花姐，这条操作我没法执行～' }]))();
    } catch (e) {
      return [{ text: '花姐，确认操作时出了点问题，麻烦再试一次～' }];
    }
  };

  /** 操作日志回复 */
  A._logsReply = () => {
    const logs = A.logs();
    if (!logs.length) return [{ text: '花姐，目前还没有助手操作记录。' }];
    const lines = logs.slice(0, 10).map((l, i) => {
      const undone = l.undone ? ' ↺已撤销' : '';
      return `${i + 1}. ${l.summary || l.action}${undone}（${NK.fmtDT(new Date(l.time))}）`;
    });
    return [{
      text: `花姐，最近助手操作记录：\n` + lines.join('\n'),
      actions: [{ label: '查看全部记录', act: 'assistantShowLogs' }],
    }];
  };

  /* ==========================================================
     八、回滚兼容：assistantReply 保留（供旧调用）
     ========================================================== */

  const origReply = NK.assistantReply;
  NK.assistantReply = (q) => {
    // 兼容旧接口：返回文本数组。新引擎优先。
    try {
      const replies = A.handle(q);
      return replies.map(r => r.text);
    } catch (e) {
      if (origReply) return origReply(q);
      return ['花姐，助手出了点小问题，请稍后再试～'];
    }
  };

})();
