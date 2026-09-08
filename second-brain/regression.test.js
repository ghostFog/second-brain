/**
 * 回归断言脚本（防再犯基础设施，保留不删）
 * 作者: 火 冰
 * 覆盖已修 Bug 的可确定性复现点，触碰相关代码时作为门禁拦截回归：
 *   Bug-004: 点击日志徽标改为自绘面板（showLogPanel），不再调用 window.prompt
 *   Bug-005: code-highlight 插件加载无未捕获异常（detached 防御已写入 processPre）
 *   Bug-006: 代码块渲染移除可见的 .code-lang 幽灵语言标签（语言仅保留于 <pre data-lang>）
 *   Bug-021: 复制代码在 Clipboard API 被拒绝时回退 execCommand，不静默失败（Electron/note:// 常见）
 *   Bug-024: code-highlight 代码块悬浮复制按钮在 Clipboard 被拒时回退 execCommand，不静默失败
 *   ED-MD-vditor: 迁移 vditor 后 .md Provider 注册/去重、vdSetMode 映射、vdSetValue/vdGetValue 往返
 * 运行: npm test（即 node regression.test.js），失败时退出码为 1
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
/* 断言计数并输出
 * @param {boolean} cond 断言是否成立
 * @param {string}  msg  断言描述
 * 作者: 火 冰 */
function assert(cond, msg) {
  if (cond) pass++; else fail++;
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
}

/* ---- Bug-004: app-log.js 徽标改为自绘面板，不调 window.prompt ----
 * 作者: 火 冰 */
function testLogBadge() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  let promptCalled = 0;
  W.prompt = function () { promptCalled++; };   // 探测：若仍调用 prompt 则此计数会增加
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-log.js'), 'utf8');
  W.document.head.appendChild(s);
  // 触发一次错误 -> 页面角落出现日志徽标
  W.dispatchEvent(new W.Event('error'));
  const badge = W.document.getElementById('sb-log-badge');
  assert(!!badge, 'Bug-004: 触发错误后生成日志徽标');
  badge.click();
  assert(!!W.document.getElementById('sb-log-panel-ov'), 'Bug-004: 点击徽标弹出自绘日志面板');
  assert(promptCalled === 0, 'Bug-004: 查看日志不再调用 window.prompt');
}

/* ---- Bug-005: code-highlight 插件加载无未捕获异常 ----
 * processPre 的 detached 防御已并入插件源码，此处验证插件加载链路干净。
 * 以 <script> 注入执行，使插件内 document/fetch/localStorage 解析到 jsdom window（与真实加载一致）。
 * 作者: 火 冰 */
function testPluginLoad() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  let caughtError = null;
  W.addEventListener('error', function (e) {
    caughtError = caughtError || (e && e.error ? e.error : new Error(e && e.message));
  });
  W.addEventListener('unhandledrejection', function (e) { caughtError = caughtError || (e && e.reason); });
  // jsdom 无网络，block 住 note:// 资源加载（插件内部 catch，不抛未捕获）
  W.fetch = function () { return Promise.reject(new Error('jsdom: fetch blocked')); };
  // 宿主通过 PluginAPI 向插件提供注册接口
  W.__registered = 0;
  W.PluginAPI = { register: function () { W.__registered++; } };
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'code-highlight', 'main.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(W.__registered === 1, 'Bug-005: 插件 main.js 正常注册（PluginAPI.register 调用 1 次）');
  assert(caughtError === null, 'Bug-005: 加载过程无未捕获异常（无 insertBefore 空指针）');
}

/* ---- Bug-006: 代码块渲染不输出可见 .code-lang 幽灵标签 ----
 * 语言仅写入 <pre data-lang>（供序列化还原 markdown），不再输出可见语言标签。
 * 说明: vditor 已接管编辑区渲染，但 renderMarkdown（app-note.js）仍被 AI 问答展示使用，断言保留。
 * 作者: 火 冰 */
function testCodeLangGhost() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-note.js'), 'utf8');
  W.document.head.appendChild(s);
  const md = '这是一段说明。\n\n```css\n.code { color: red; }\n```\n\n末尾。';
  // app-note.js 以顶层 const 暴露 renderMarkdown（全局词法绑定，非 window 属性），
  // 需在 jsdom 窗口上下文用 W.eval 取到该函数，而非 window.renderMarkdown。
  const html = W.eval('renderMarkdown')(md);
  const pre = /<pre class="[^"]*" data-lang="css"/.test(html);
  const ghost = /class="code-lang"/.test(html);
  assert(pre, 'Bug-006: 代码块保留 data-lang="css"（语言仍可序列化回 markdown）');
  assert(!ghost, 'Bug-006: 不再输出可见的 .code-lang 幽灵语言标签');
}

/* ---- Bug-024: code-highlight 代码块悬浮复制按钮在 Clipboard 被拒时回退 execCommand ----
 * 旧实现只走 navigator.clipboard.writeText(...).then,无 .catch/回退，
 * 在 Electron / note:// 协议下 writeText 常被拒 NotAllowedError → 静默复制失败、按钮无反馈。
 * 修复：按钮点击优先 Clipboard API，被拒/不可用时回退 document.execCommand 选区复制，
 * 成功按钮亮对勾、失败 showToast 提示。
 * 作者: 火 冰 */
async function testCodeHighlightCopyBtn() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><pre data-lang="css" style="white-space:pre;">body{color:red;}</pre></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  W.PluginAPI = { register: function () {} };
  W.showToast = function () {};
  // 桩高亮库：满足 highlightAuto 即可让 processPre 生成复制按钮
  W.fetch = function () {
    return Promise.resolve({ text: function () {
      return Promise.resolve('window.hljs={highlightAuto:function(t){return {value:t,language:"text"};},configure:function(){},getLanguage:function(){return null;}}');
    } });
  };
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'code-highlight', 'main.js'), 'utf8');
  W.document.head.appendChild(s);
  // 等 highlight.min.js fetch + eval + 扫描生成复制按钮
  for (let i = 0; i < 10; i++) {
    if (W.document.querySelector('.ch-copy-btn')) break;
    await new Promise(function (r) { setTimeout(r, 20); });
  }
  const btn = W.document.querySelector('.ch-copy-btn');
  assert(!!btn, 'Bug-024: 代码块渲染后生成 .ch-copy-btn 复制按钮');

  // Clipboard API 拒绝（模拟真实 Electron），应回退 execCommand
  Object.defineProperty(W.navigator, 'clipboard', {
    value: { writeText: function () { return Promise.reject(new Error('NotAllowedError')); } },
    configurable: true,
  });
  const exec = [];
  W.document.execCommand = function (cmd) { exec.push(cmd); return true; };
  W.window.getSelection = function () { return { removeAllRanges: function () {}, addRange: function () {} }; };
  btn.click();
  await new Promise(function (r) { setTimeout(r, 20); });
  assert(exec.includes('copy'), 'Bug-024: Clipboard 被拒后复制按钮回退 execCommand 复制（不静默失败）');
  assert(btn.classList.contains('copied'), 'Bug-024: 复制成功后按钮亮对勾反馈（copied class）');
}

/* ---- Bug-025: code-highlight 不得劫持 vditor 编辑面 ----
 * vditor 迁移后，IR/WYSIWYG「整个编辑区」本身就是一个 <pre class="vditor-reset" contenteditable>，
 * 位于 #ed-vditor 内 .vditor-ir/… 容器。旧守卫只跳过 #ed-wysiwyg，导致插件把整片编辑面
 * 高亮+外包 .ch-code+注入语言徽标/复制按钮 → 整篇变灰代码块（`text` 徽标）。
 * 修复：守卫扩大到跳过 .vditor-ir/.vditor-wysiwyg/.vditor-sv 容器；预览(.vditor-preview)不跳。
 * 断言：编辑面 pre 不被 .ch-code 包裹；普通（预览样）pre 仍受增强。
 * 作者: 火 冰 */
async function testCodeHighlightSkipEditSurface() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>'
    + '<div id="ed-vditor"><div class="vditor"><div class="vditor-content">'
    + '<div class="vditor-ir"><pre class="vditor-reset" contenteditable="true"># React 学习</pre></div>'
    + '</div></div></div>'
    + '<pre data-lang="js" style="white-space:pre;">const a=1;</pre>'
    + '</body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  W.PluginAPI = { register: function () {} };
  W.showToast = function () {};
  // 桩高亮库：instant 返回 language=<pre> 文本首词，模拟自动检测
  W.fetch = function () {
    return Promise.resolve({ text: function () {
      return Promise.resolve('window.hljs={highlightAuto:function(t){return {value:t,language:(/^(js|text)/.exec((t||"").trim())||[])[1]||"text"};},configure:function(){},getLanguage:function(){return null;}}');
    } });
  };
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'code-highlight', 'main.js'), 'utf8');
  W.document.head.appendChild(s);
  // 等 fetch+eval+初始扫描完成
  for (let i = 0; i < 10; i++) {
    if (W.document.querySelector('.ch-code') || (!W.document.querySelector('pre'))) break;
    await new Promise(function (r) { setTimeout(r, 20); });
  }
  const editPre = W.document.querySelector('.vditor-ir pre.vditor-reset');
  const editWrapped = editPre && editPre.closest('.ch-code');
  const editTag = W.document.querySelector('.vditor-ir .ch-lang-tag');
  const previewChoRec = W.document.body.querySelector('pre:not(.vditor-reset)');
  const previewWrapped = previewChoRec && previewChoRec.closest('.ch-code');
  const previewBtn = W.document.querySelector('.ch-code .ch-copy-btn');
  assert(!editWrapped, 'Bug-025: vditor 编辑面 pre(.vditor-ir .vditor-reset) 不被 .ch-code 包裹');
  assert(!editTag, 'Bug-025: 编辑面内不注入 .ch-lang-tag 语言徽标（无 `text` 灰代码块）');
  assert(!!previewWrapped, 'Bug-025: 编辑面外的普通 pre 仍被增强为 .ch-code');
  assert(!!previewBtn, 'Bug-025: 普通代码块复制按钮仍生成（预览/阅读高亮不受影响）');
}

/* ---- 迁移: vditor 引擎桥接 + .md Provider 注册/去重/模式映射 ----
 * 注入 editor-vditor.js（引擎已归宿主，双端共用）：
 * 桩 registerEditorProvider 收集 Provider、桩 window.Vditor 记录 setPreviewMode/value，
 * 验证：
 *   1) .md/.markdown Provider 已注册（id=markdown-editor）且重复注入去重；
 *   2) vdSetMode 映射：edit→editor、split→both、preview→preview；
 *   3) vdSetValue/vdGetValue 往返（实例未创建走缓冲、实例创建走实例）。
 * 作者: 火 冰 */
function testVditorBridge() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><div id="ed-vditor"></div></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window; const D = W.document;
  const providers = [];
  W.registerEditorProvider = function (p) { providers.push(p); };
  W.restoreS = function () { return true; };
  const calls = { previewModes: [], initModes: [] };
  // 桩 vditor：记录构造 mode 与 setPreviewMode，setValue/getValue 维护内部 _val
  const StubVditor = function (el, opts) {
    this._val = opts.value || '';
    this.mode = opts.mode;
    calls.initModes.push(opts.mode);
  };
  StubVditor.prototype.getValue = function () { return this._val; };
  StubVditor.prototype.setValue = function (v) { this._val = v; };
  StubVditor.prototype.destroy = function () {};
  StubVditor.prototype.setPreviewMode = function (m) { calls.previewModes.push(m); };
  W.Vditor = StubVditor;

  const inject = function () {
    const s = D.createElement('script');
    s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
    D.head.appendChild(s);
  };
  inject();
  inject(); // 重复注入应被 Provider 去重守卫拦截

  const mdProvider = providers.filter(function (p) { return p.extensions && p.extensions.indexOf('.md') !== -1; });
  assert(mdProvider.length === 1 && mdProvider[0].id === 'markdown-editor',
    '迁移: 注册 .md/.markdown Provider（id=markdown-editor）且重复注入去重（实际 ' + providers.length + ' 个）');

  // 无实例时 vdSetValue/vdGetValue 走缓冲
  W.vdSetValue('hello *md*');
  assert(W.vdGetValue() === 'hello *md*', '迁移: 无实例时 vdSetValue/vdGetValue 缓冲往返');

  // vdInit 懒构建实例；默认 mode=ir，且构建时默认编辑器布局不再额外 setPreviewMode
  W.vdInit();
  assert(calls.initModes.length === 1 && calls.initModes[0] === 'ir', '迁移: 懒构建 vditor，默认编辑节点 mode=ir');
  assert(W.vdGetValue() === 'hello *md*', '迁移: 构建后内容从缓冲带入实例');
  // 实例创建后 setValue/getValue 往返
  W.vdSetValue('line1\nline2');
  assert(W.vdGetValue() === 'line1\nline2', '迁移: 实例创建后 vdSetValue/vdGetValue 往返正确');

  // vdSetMode 映射：edit→editor、split→both、preview→preview
  calls.previewModes.length = 0;
  W.vdSetMode('edit');
  W.vdSetMode('split');
  W.vdSetMode('preview');
  assert(JSON.stringify(calls.previewModes) === JSON.stringify(['editor', 'both', 'preview']),
    '迁移: vdSetMode 映射 edit→editor、split→both、preview→preview（实际 ' + calls.previewModes.join(',') + '）');
}

/* ---- ED-11 迁移: 文件树「重命名」右键 / 双击文件名（renameNoteFile）----
 * 编辑器标题区已取消改名（vditor 后仅作静态展示），改名统一走文件树。
 * 注入 editor-filetree.js，桩 noteStore.move 与宿主状态，验证：
 *   1) 就地替换文件名输入框；Enter 提交 → noteStore.move('a.md','b.md')；
 *   2) 同名冲突拦截（已有 b.md 时提示且不 move）；
 *   3) 提交后 edCurrent/edOpenTabs/edNotes 与常规菜单路径同步刷新。
 * 作者: 火 冰 */
async function testRenameNoteFile() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div id="file-tree">'
    + '<div class="tree-file" data-path="a.md" data-name="a.md"><span class="flex-1 truncate">a.md</span></div>'
    + '</div></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  // 注入 editor-filetree.js（顶层函数声明挂 window：renderFileTree/renameNoteFile 等）
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-filetree.js'), 'utf8');
  W.document.head.appendChild(s);

  // 桩宿主状态与副作用
  W.edNotes = [{ path: 'a.md', name: 'a.md' }];
  W.edOutdated = {}; W.edOpenTabs = ['a.md']; W.edCurrent = 'a.md';
  W.edPinned = new Set(); W.edDirty = new Set();
  const moved = [];
  W.noteStore = {
    move: async function (o, n) { moved.push([o, n]); return true; },
    save: async function () {},
  };
  let reRender = 0;
  W.renderFileTree = function () { reRender++; };
  W.renderTabs = function () {}; W.renderArticle = function () {}; W.persistRecentTabs = function () {};
  const toasts = [];
  W.showToast = function (m) { toasts.push(m); };
  W.$ = function (id) { return W.document.getElementById(id); };
  W.restoreS = function () { return false; };
  W.esc = function (v) { return String(v).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); };
  W.relDate = function () { return '今天'; };
  W.refreshIcons = function () {};

  // ① 正常重命名 a.md → b.md（Enter 提交）
  W.renameNoteFile('a.md');
  await new Promise(function (r) { setTimeout(r, 0); });
  const input = W.document.querySelector('.tree-file input');
  assert(!!input, '迁移: 重命名就地替换文件名为输入框');
  input.value = 'b';
  input.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 20); });
  assert(moved.length === 1 && moved[0][0] === 'a.md' && moved[0][1] === 'b.md',
    '迁移: Enter 提交调用 noteStore.move(a.md → b.md)（实际 ' + JSON.stringify(moved) + '）');
  assert(W.edCurrent === 'b.md' && W.edOpenTabs[0] === 'b.md',
    '迁移: 重命名后 edCurrent/edOpenTabs 同步新路径');
  assert(W.edNotes[0].path === 'b.md', '迁移: 重命名后 edNotes 同步新路径');
  assert(reRender >= 1, '迁移: 重命名后触发 renderFileTree 刷新文件树');

  // ② 同名冲突拦截：已存在 z.md 时输入 z → 不 move、提示
  W.edNotes.push({ path: 'z.md', name: 'z.md' });
  // 模拟真实 renderFileTree 重建后的 DOM（行路径已更新为 b.md、文件名还原为 span）
  const rowEl = W.document.querySelector('.tree-file');
  rowEl.dataset.path = 'b.md';
  rowEl.innerHTML = '<span class="flex-1 truncate">b.md</span>';
  W.renameNoteFile('b.md');
  await new Promise(function (r) { setTimeout(r, 0); });
  const input2 = W.document.querySelector('.tree-file input');
  const movedBefore = moved.length;
  input2.value = 'z';
  input2.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await new Promise(function (r) { setTimeout(r, 20); });
  assert(moved.length === movedBefore && toasts.some(function (t) { return /已存在同名/.test(t); }),
    '迁移: 同名冲突被拦截（不 move 且提示「已存在同名笔记」）');
}

testLogBadge();
testPluginLoad();
testCodeLangGhost();
testVditorBridge();
Promise.all([
  testCodeHighlightCopyBtn(),
  testRenameNoteFile(),
  testCodeHighlightSkipEditSurface(),
]).then(function () {
  console.log(`\n回归结果: ${pass} 通过, ${fail} 失败`);
  if (fail) process.exitCode = 1;
  else process.exitCode = 0;
});