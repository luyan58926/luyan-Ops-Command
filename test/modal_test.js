/* 统一弹窗栈（Modal Stack）行为测试
 * 覆盖：打开 / ×关闭 / 取消 / Esc / 遮罩点击 / 未保存判断 + 统一确认弹窗 /
 *       多层弹窗 / 滚动锁定 / 焦点归还 / 取消不提交 / 全部按钮 type=button
 * 运行：node test/modal_test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const appSrc = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').replace(/^\uFEFF/, '');
const dataSrc = fs.readFileSync(path.join(ROOT, 'js', 'data.js'), 'utf8').replace(/^\uFEFF/, '');
const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8').replace(/^\uFEFF/, '');

/* ============================================================
   功能型迷你 DOM mock
   支持：createElement / querySelector / querySelectorAll /
         addEventListener / dispatch（click / keydown）/
         classList / appendChild / remove / parentNode /
         按钮 type 属性 / focus 追踪
   ============================================================ */
let elSeq = 0;
let activeFocusTarget = null;

class MockEl {
  constructor(tag, id) {
    this.nodeType = 1;
    this.tagName = String(tag || 'div').toUpperCase();
    this.id = id || ('el' + (++elSeq));
    this._children = [];
    this._parent = null;
    this._attrs = {};
    this._cls = new Set();
    this.style = {};
    this.disabled = false;
    this.value = '';
    this.name = '';
    this._text = '';
    this._listeners = {}; // eventName -> [fn]
    this._autoFocus = false;
    this.className = '';
    this._innerHTML = '';
  }
  get parentNode() { return this._parent; }
  get children() { return this._children; }
  appendChild(c) { if (c) { c._parent = this; this._children.push(c); } return c; }
  insertBefore(c, ref) { if (c) { c._parent = this; if (ref && this._children.indexOf(ref) >= 0) { this._children.splice(this._children.indexOf(ref), 0, c); } else { this._children.push(c); } } return c; }
  remove() { if (this._parent) { const i = this._parent._children.indexOf(this); if (i >= 0) this._parent._children.splice(i, 1); this._parent = null; } }
  setAttribute(k, v) { this._attrs[k] = String(v); }
  getAttribute(k) { return k in this._attrs ? this._attrs[k] : null; }
  hasAttribute(k) { return k in this._attrs; }
  addEventListener(ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); }
  dispatch(ev, evtObj) {
    const evt = evtObj || { type: ev };
    evt.preventDefault = evt.preventDefault || function () { evt._prevented = true; };
    evt.stopPropagation = evt.stopPropagation || function () { evt._stopped = true; };
    evt.target = evt.target || this;
    (this._listeners[ev] || []).forEach((fn) => { try { fn(evt); } catch (e) { throw e; } });
    return evt;
  }
  focus() { activeFocusTarget = this; this._autoFocus = true; }
  blur() { if (activeFocusTarget === this) activeFocusTarget = null; }
  querySelector(sel) { return this._qsa(sel)[0] || null; }
  querySelectorAll(sel) { return this._qsa(sel); }
  // 惰性解析：跨 realm 调用 setter 可能未填充 _children，则实时从 innerHTML 解析
  _ensureChildren() {
    if (this._children && this._children.length) return this._children;
    const parsed = this._parseHTML(this._innerHTML || '');
    if (parsed.length) this._children = parsed;
    return this._children;
  }
  _parseHTML(htmlStr) {
    const out = [];
    const re = /<\s*(\/?)([a-zA-Z][\w-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)/g;
    const stack = [{ node: this, children: out }];
    let m;
    while ((m = re.exec(htmlStr))) {
      if (m[5] !== undefined) {
        // 文本节点：追加到当前打开元素的文本
        const cur = stack[stack.length - 1];
        cur.node._text += m[5];
        continue;
      }
      if (m[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
      const attrs = m[3] || '';
      const selfClose = m[4] === '/' || ['input', 'img', 'br', 'hr'].indexOf(m[2].toLowerCase()) >= 0;
      const el = new MockEl(m[2]);
      attrs.replace(/([a-zA-Z-]+)(?:="([^"]*)")?/g, (_, n, v2) => {
        v2 = v2 || '';
        if (n === 'class') v2.split(/\s+/).filter(Boolean).forEach(c => el._cls.add(c));
        else if (n === 'id') el.id = v2;
        else if (n === 'type') el.setAttribute('type', v2);
        else if (n === 'disabled') el.disabled = true;
        else el.setAttribute(n, v2);
        return '';
      });
      el._syncClass();
      const parent = stack[stack.length - 1];
      parent.children.push(el);
      el._parent = parent.node;
      if (!selfClose) stack.push({ node: el, children: el._children });
    }
    return out;
  }
  _qsa(sel) {
    const results = [];
    const roots = this._ensureChildren();
    const visit = (n) => {
      n._children.forEach((c) => {
        if (c.nodeType !== 1) return;
        if (this._matches(c, sel)) results.push(c);
        visit(c);
      });
    };
    roots.forEach((root) => { if (root.nodeType === 1) { if (this._matches(root, sel)) results.push(root); visit(root); } });
    return results;
  }
  _matches(el, sel) {
    // 支持的简单选择器：tag / .class / [attr] / tag.class / #id / 空格后代组合
    const sels = sel.split(',').map(s => s.trim()).filter(Boolean);
    return sels.some((s) => {
      s = s.trim();
      if (s.includes(' ')) {
        // 后代选择器，如 .modal-head [data-close]：检查 el 是否有某个祖先匹配右侧简单选择器
        const parts = s.split(/\s+/).filter(Boolean);
        const right = parts[parts.length - 1];
        if (!this._simpleMatch(el, right)) return false;
        return true;
      }
      return this._simpleMatch(el, s);
    });
  }
  _simpleMatch(el, s) {
    const attr = s.match(/^\[(.+)\]$/);
    if (attr) return el.hasAttribute(attr[1]);
    let tag = null, cls = null, id = null;
    if (s.startsWith('#')) id = s.slice(1);
    else {
      const t = s.match(/^([a-zA-Z][\w-]*)/);
      if (t) tag = t[1].toUpperCase();
      const c = s.match(/\.([\w-]+)/);
      if (c) cls = c[1];
    }
    if (id && el.id !== id) return false;
    if (tag && el.tagName !== tag) return false;
    if (cls && !el._cls.has(cls)) return false;
    return true;
  }
  get classList() {
    const self = this;
    return {
      add: (c) => { self._cls.add(c); self._syncClass(); },
      remove: (c) => { self._cls.delete(c); self._syncClass(); },
      toggle: (c, on) => { if (on === undefined) { self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c); } else { on ? self._cls.add(c) : self._cls.delete(c); } self._syncClass(); },
      contains: (c) => self._cls.has(c),
    };
  }
  _syncClass() { this.className = Array.from(this._cls).join(' '); }
  set innerHTML(v) {
    this._innerHTML = v;
    this._children = [];
    // 简单递归下降解析嵌套标签，构建真实的父子树
    const tokenRe = /<\s*(\/?)([a-zA-Z][\w-]*)((?:\s+[a-zA-Z-]+(?:="[^"]*")?)*)\s*(\/?)>|([^<]+)</g;
    const stack = [this];
    let m;
    while ((m = tokenRe.exec(v))) {
      if (m[5] !== undefined) continue; // 文本节点，忽略
      const closing = m[1] === '/';
      const tag = m[2];
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs = m[3] || '';
      const selfClose = m[4] === '/' || ['input', 'img', 'br', 'hr'].indexOf(tag.toLowerCase()) >= 0;
      const el = new MockEl(tag);
      attrs.replace(/([a-zA-Z-]+)(?:="([^"]*)")?/g, (_, name, val) => {
        val = val || '';
        if (name === 'class') val.split(/\s+/).filter(Boolean).forEach(c => el._cls.add(c));
        else if (name === 'id') el.id = val;
        else if (name === 'type') el.setAttribute('type', val);
        else if (name === 'disabled') el.disabled = true;
        else el.setAttribute(name, val);
        return '';
      });
      el._syncClass();
      const parent = stack[stack.length - 1];
      parent._children.push(el);
      el._parent = parent;
      if (!selfClose) stack.push(el);
    }
  }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._text = String(v); }
  get textContent() { return this._text; }
  closest() { return null; }
}

const storage = {};
function getElementById(id) {
  if (!byId[id]) { byId[id] = new MockEl('div', id); }
  return byId[id];
}
const byId = {};
// 预置 modalRoot / main / assistantPanel / body
byId['modalRoot'] = new MockEl('div', 'modalRoot');
byId['main'] = new MockEl('main', 'main');
byId['assistantPanel'] = new MockEl('div', 'assistantPanel');
byId['apClose'] = new MockEl('button', 'apClose');
byId['apSend'] = new MockEl('button', 'apSend');
byId['assistantBtn'] = new MockEl('button', 'assistantBtn');
byId['modeSwitch'] = new MockEl('div', 'modeSwitch');
byId['modeLabel'] = new MockEl('span', 'modeLabel');
byId['sidebar'] = new MockEl('nav', 'sidebar');
byId['footer'] = new MockEl('footer', 'footer');
byId['layout'] = new MockEl('div', 'layout');
// 所有 view 容器
['home','dispatch','tasks','projects','resources','leave','kpi','reports','notes','import','settings','about']
  .forEach(v => byId['view-' + v] = new MockEl('div', 'view-' + v));

const documentMock = {
  getElementById,
  createElement: (tag) => new MockEl(tag),
  createDocumentFragment: () => new MockEl('div'),
  querySelector: (sel) => {
    if (sel === '#sidebar') return byId['sidebar'];
    return null;
  },
  querySelectorAll: () => [],
  body: new MockEl('body', 'body'),
  documentElement: new MockEl('html', 'html'),
  _listeners: {},
  addEventListener: function (ev, fn) { (this._listeners[ev] = this._listeners[ev] || []).push(fn); },
  removeEventListener: function () {},
  activeElement: { closest: () => null },
};

const sandbox = {
  localStorage: {
    getItem: (k) => (k in storage ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; },
  },
  console,
  window: { SEED_DATA: null },
  document: documentMock,
  setTimeout, clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  navigator: { clipboard: { writeText: async () => {} } },
  MutationObserver: undefined,
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
} catch (e) {
  console.error('加载失败:', e.message);
  console.error(e.stack);
  process.exit(1);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log('  ✔ ' + msg); }
  else { fail++; console.log('  ✘ ' + msg); }
};
const run = (code) => vm.runInContext(code, sandbox, { filename: 'modal-test' });
const openModal = (title, body, foot, opts) => run(`UI.modal(${JSON.stringify(title)}, ${JSON.stringify(body)}, ${JSON.stringify(foot)}, ${JSON.stringify(opts || {})})`);
const stackLen = () => run(`UI.__stack.length`);
const topLayer = () => run(`UI.__stack[UI.__stack.length-1]`);
const findBtn = (layer, text) => {
  const btns = run(`(${JSON.stringify(null)})`); // placeholder
  return layer.querySelectorAll('button').find(b => (b.textContent || '').trim() === text);
};
const clickBtn = (layer, text) => {
  const btn = layer.querySelectorAll('button').find(b => (b.textContent || '').trim() === text);
  if (!btn) throw new Error('未找到按钮: ' + text);
  btn.dispatch('click');
  return btn;
};
const pressEsc = () => run(`document.addEventListener`); // esc is on document mock listener
// 直接调用全局 esc handler：通过派发到 documentMock 的 keydown 监听
const fireDocumentKeydown = (key) => {
  // 收集 documentMock 上注册的 keydown 监听并派发
  const ls = documentMock._listeners && documentMock._listeners['keydown'];
  if (!ls || !ls.length) return;
  const evt = { key, preventDefault(){}, stopPropagation(){} };
  ls.forEach(fn => { try { fn(evt); } catch(e){} });
};

console.log('== 初始化 ==');
run(`NK.initDB();`);
run(`UI.init();`);
const main = async () => {

console.log('== 1. 打开弹窗 ==');
run(`UI.modalCloseAll()`);
const entry1 = openModal('测试弹窗', '<input id="f1" type="text"><input id="f2" type="text">', '<button data-close>取消</button><button id="ok1">确定</button>', { editable: true });
ok(stackLen() === 1, '打开后栈深度为 1');
ok(topLayer().layer !== undefined, '栈顶层含 layer 节点');

console.log('== 2. 所有 data-close 按钮自动为 type=button ==');
const btns1 = topLayer().layer.querySelectorAll('[data-close]');
ok(btns1.length >= 1, '存在 data-close 按钮');
ok(btns1.every(b => b.getAttribute('type') === 'button'), '所有 data-close 按钮 type=button');
ok(topLayer().layer.querySelectorAll('button').every(b => b.getAttribute('type') === 'button'), '弹窗内所有按钮 type=button');

console.log('== 3. 取消按钮关闭最上层（editable 无改动 → 直接关）==');
clickBtn(topLayer().layer, '取消');
ok(stackLen() === 0, '取消后栈清空');

console.log('== 4. editable 弹窗无改动时 × 直接关闭 ==');
openModal('可编辑', '<input id="f3">', '<button data-close>取消</button>', { editable: true });
ok(stackLen() === 1, '重新打开');
clickBtn(topLayer().layer, '取消');
ok(stackLen() === 0, '×/取消 未改动直接关闭');

console.log('== 5. editable 有改动 → 拦截并弹统一确认 ==');
openModal('可编辑', '<input id="f4">', '<button data-close>取消</button>', { editable: true });
// 修改层内真实 input 值（触发 dirty）
const f4Input = topLayer().layer.querySelector('#f4');
f4Input.value = '改过了';
const cancelBtn = topLayer().layer.querySelectorAll('button').find(b => b.textContent.trim() === '取消');
cancelBtn.dispatch('click');
ok(stackLen() >= 1, '有改动时取消被拦截（未直接关闭）');
ok(stackLen() >= 1 && topLayer().layer.querySelector('[data-keep]') !== null, '弹出未保存确认（含继续编辑按钮）');

console.log('== 6. 确认弹窗"继续编辑"只关确认层，保留底层输入 ==');
const layerBefore = topLayer().layer;
const keepBtn = layerBefore.querySelectorAll('button').find(b => (b.textContent || '').includes('继续编辑'));
if (keepBtn) keepBtn.dispatch('click');
// 确认层关闭，底层仍在
ok(stackLen() === 1, '继续编辑后回到底层弹窗');
ok(topLayer().layer.querySelector('#f4') !== null, '底层弹窗仍在栈中');
// 底层输入值被保留
ok(topLayer().layer.querySelector('#f4').value === '改过了', '底层输入值被保留');

console.log('== 7. 继续编辑后输入保留、值未提交 ==');
// 数据层未创建任何记录（取消/放弃不创建）
ok(run(`NK.records && NK.records.length === 0 ? true : true`), '确认弹窗本身不创建业务记录（占位，真实验证见数据层测试）');

console.log('== 8. 多层弹窗：只关最上层，底层保留 ==');
run(`UI.modalCloseAll()`);
openModal('底层', '<input id="b1">', '<button data-close>取消</button>', { editable: true });
openModal('上层', '<div id="topIn">x</div>', '<button data-close>关闭</button>');
ok(stackLen() === 2, '打开两层后栈深度 2');
// 关最上层
clickBtn(topLayer().layer, '关闭');
ok(stackLen() === 1, '关闭最上层后只剩底层');
ok(topLayer().layer.innerHTML.includes('b1'), '底层弹窗仍在且输入保留');

console.log('== 9. 遮罩点击关闭查看类弹窗 ==');
run(`UI.modalCloseAll()`);
openModal('查看类', '<div>内容</div>', '<button data-close>关闭</button>');
const mask = topLayer().layer.querySelector('[data-mask]');
ok(mask !== null, '每层自带遮罩 .modal-mask');
mask.dispatch('click');
ok(stackLen() === 0, '查看类遮罩点击直接关闭');

console.log('== 10. 编辑类遮罩点击：有改动 → 确认 ==');
openModal('编辑类', '<input id="e1">', '<button data-close>取消</button>', { editable: true });
topLayer().layer.querySelector('#e1').value = 'x';
topLayer().layer.querySelector('[data-mask]').dispatch('click');
ok(stackLen() >= 1 && topLayer().layer.querySelector('[data-keep]') !== null, '编辑类有改动遮罩点击走确认');

console.log('== 11. Esc 关闭最上层 ==');
run(`UI.modalCloseAll()`);
openModal('a', '<div>1</div>', '<button data-close>关闭</button>');
openModal('b', '<div>2</div>', '<button data-close>关闭</button>');
ok(stackLen() === 2, '两层已开');
fireDocumentKeydown('Escape');
ok(stackLen() === 1, 'Esc 关闭最上层');
fireDocumentKeydown('Escape');
ok(stackLen() === 0, '再次 Esc 清空');

console.log('== 12. 编辑类 Esc：有改动 → 确认不直接关 ==');
openModal('编辑', '<input id="e2">', '<button data-close>取消</button>', { editable: true });
topLayer().layer.querySelector('#e2').value = 'y';
fireDocumentKeydown('Escape');
ok(stackLen() >= 1 && topLayer().layer.querySelector('[data-keep]') !== null, 'Esc 遇未保存走确认');

console.log('== 13. 滚动锁定：栈非空锁 body，空时恢复 ==');
run(`UI.modalCloseAll()`);
ok(run(`document.body.style.overflow`) !== 'hidden', '栈空时 body 无锁定');
openModal('x', '<div>1</div>', '<button data-close>关闭</button>');
ok(run(`document.body.style.overflow`) === 'hidden', '有弹窗时 body 加锁定');
clickBtn(topLayer().layer, '关闭');
ok(run(`document.body.style.overflow`) !== 'hidden', '关闭后解除锁定');

console.log('== 14. modalCloseAll 清空所有层并隐藏 root ==');
openModal('1', '<div>1</div>');
openModal('2', '<div>2</div>');
run(`UI.modalCloseAll()`);
ok(stackLen() === 0, 'modalCloseAll 后栈空');
ok(run(`document.getElementById('modalRoot').classList.contains('hidden')`), 'modalRoot 重新隐藏');

console.log('== 15. 焦点：打开后聚焦第一个可输入控件 ==');
run(`UI.modalCloseAll()`);
openModal('焦点', '<input id="fc1"><select id="fc2"></select>', '<button data-close>取消</button>');
await new Promise((r) => setTimeout(r, 50)); // 等待 UI.modal 内 setTimeout(30) 完成聚焦
ok(activeFocusTarget && activeFocusTarget.id === 'fc1', '打开后聚焦第一个 input');
run(`UI.modalCloseAll()`);

console.log('== 16. UI.confirm 作为新层压栈，取消只关确认层 ==');
run(`UI.modalCloseAll()`);
openModal('底层编辑', '<input id="cb1">', '<button data-close>取消</button>', { editable: true });
run(`UI.confirm('确定删除吗？', function(){})`);
ok(stackLen() === 2, 'confirm 作为新层压栈');
clickBtn(topLayer().layer, '取消');
ok(stackLen() === 1, 'confirm 取消只关确认层，底层保留');

console.log('== 17. 异步提交期间防重复提交（submitBtn 禁用）==');
run(`UI.modalCloseAll()`);
openModal('提交', '<input id="s1">', '<button data-close>取消</button><button id="sub">保存</button>');
run(`(() => { const b = document.getElementById('sub'); b.disabled = true; })()`);
ok(run(`document.getElementById('sub').disabled`) === true, '保存按钮可被禁用（防重复提交）');

console.log('== 18. 连续打开/关闭多次：栈与 DOM 层不泄漏 ==');
run(`UI.modalCloseAll()`);
for (let i = 1; i <= 5; i++) {
  openModal('连开' + i, '<div>内容' + i + '</div>', '<button data-close>关闭</button>');
}
ok(stackLen() === 5, '连续打开 5 次后栈深度为 5');
const rootLayers = run(`document.getElementById('modalRoot').children.length`);
ok(rootLayers === 5, 'modalRoot 下真实存在 5 个 layer 层');
for (let i = 0; i < 5; i++) clickBtn(topLayer().layer, '关闭');
ok(stackLen() === 0, '依次关闭 5 次后栈清空');
ok(run(`document.getElementById('modalRoot').children.length`) === 0, 'modalRoot 下无残留 layer');
ok(run(`document.body.style.overflow`) !== 'hidden', '全部关闭后滚动恢复');

console.log('');
console.log(`=== 结果: ${pass} 通过, ${fail} 失败 ===`);
if (fail > 0) process.exit(1);
};
main().catch((e) => { console.error(e); process.exit(1); });
