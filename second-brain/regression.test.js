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
  const pluginPath = path.join(__dirname, 'plugins', 'code-highlight', 'main.js');
  if (!fs.existsSync(pluginPath)) {
    // 插件未安装（app-plugins.js 市场条目 installed:false），宿主本就不加载它：
    // 此时无插件文件可注入，断言跳过，避免 ENOENT 中断全量回归
    assert(true, 'Bug-005: code-highlight 未安装，无插件文件需加载（跳过注入）');
    return;
  }
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(pluginPath, 'utf8');
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
  const pluginPath = path.join(__dirname, 'plugins', 'code-highlight', 'main.js');
  if (!fs.existsSync(pluginPath)) {
    // 插件未安装（app-plugins.js 市场条目 installed:false），宿主不加载它，跳过注入断言
    assert(true, 'Bug-024: code-highlight 未安装，跳过复制按钮回退断言');
    return;
  }
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
  s.textContent = fs.readFileSync(pluginPath, 'utf8');
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
  const pluginPath = path.join(__dirname, 'plugins', 'code-highlight', 'main.js');
  if (!fs.existsSync(pluginPath)) {
    // 插件未安装（app-plugins.js 市场条目 installed:false），宿主不加载它，跳过注入断言
    assert(true, 'Bug-025: code-highlight 未安装，跳过编辑面不劫持断言');
    return;
  }
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
  s.textContent = fs.readFileSync(pluginPath, 'utf8');
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

  // vdSetMode 三态映射：split/preview 进入 SV 模式并重建实例、edit 退回编辑节点重建；
  // 视图显隐已由宿主 applyVdVisibility 确定性接管（不再调用 vditor setPreviewMode）。
  calls.initModes.length = 0;
  W.vdSetMode('split');
  W.vdSetMode('preview');
  W.vdSetMode('edit');
  assert(JSON.stringify(calls.initModes) === JSON.stringify(['sv', 'sv', 'ir']),
    '迁移: vdSetMode 映射 split→sv、preview→sv、edit→ir 重建（实际 ' + calls.initModes.join(',') + '）');
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

/* ---- Bug-028: 主题持久化同步 __savedTheme 快照，视图重建不再回退 ----
 * 根因: window.__savedTheme 是应用启动时的一次性快照（app-layout.js），setTheme(mode,true)
 *       只写 localStorage、不更新快照；每次进入设置视图 bindSettings 用旧快照
 *       setTheme(savedTheme,false) 恢复，把 auto 覆盖回 dark。
 * 修复: persist=true 时同步 window.__savedTheme；accent/字体三类函数同根因一并同步。
 * 断言: 模拟「启动快照 dark → 选跟随系统 → 切回设置恢复」全过程，最终仍为 auto 效果
 *       且「跟随系统」卡片高亮；另验证 accent/字体快照同步。
 * 作者: 火 冰 */
function testThemeSavedSnapshot() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body>'
    + '<div id="view-root"></div><div id="palette-overlay"></div>'
    + '<div class="theme-card" data-theme-mode="dark"><span class="theme-card-check"></span></div>'
    + '<div class="theme-card" data-theme-mode="auto"><span class="theme-card-check"></span></div>'
    + '<div class="color-dot" data-accent="#EF4444"></div>'
    + '</body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window; const D = W.document;
  // jsdom 无 matchMedia 时 setTheme 内部已有 `window.matchMedia &&` 防御
  const s = D.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-core.js'), 'utf8');
  D.head.appendChild(s);

  // 模拟启动快照（app-layout.js 一次性赋值），用户随后在设置选「跟随系统」
  W.__savedTheme = 'dark';
  W.setTheme('auto', true);
  assert(W.__savedTheme === 'auto', 'Bug-028: 选「跟随系统」后 __savedTheme 同步为 auto（不再停留启动快照）');
  assert(W.localStorage.getItem('note-app:theme') === 'auto', 'Bug-028: 持久化 localStorage 为 auto');

  // 模拟切回设置视图 bindSettings 的恢复路径 setTheme(__savedTheme,false)
  W.setTheme(W.__savedTheme, false);
  const html = D.documentElement;
  assert(!html.classList.contains('dark'), 'Bug-028: bindSettings 用最新快照恢复，不再把主题回退为深色');
  const autoCard = D.querySelector('.theme-card[data-theme-mode="auto"]');
  assert(autoCard.classList.contains('active'), 'Bug-028: 恢复后「跟随系统」卡片高亮（active）');

  // accent/字体同类快照同步（同一根因防护）
  W.setAccent('#EF4444');
  assert(W.__savedAccent === '#EF4444', 'Bug-028: 强调色同步 __savedAccent 快照（同根因）');
  W.applyFontSize(16);
  assert(W.__savedFontSize === 16, 'Bug-028: 字号同步 __savedFontSize 快照（同根因）');
  W.applyFontFamily('Noto Sans SC');
  assert(W.__savedFontFamily === 'Noto Sans SC', 'Bug-028: 字体族同步 __savedFontFamily 快照（同根因）');
  W.applyFontMono('Fira Code');
  assert(W.__savedFontMono === 'Fira Code', 'Bug-028: 代码字体同步 __savedFontMono 快照（同根因）');
}

/* ---- Bug-041: 首屏主题不再闪烁（FOUC）----
 * 根因1（HTML 层）: index.html 的 <html> 曾硬编码 data-theme="dark" 且无首屏同步脚本，
 *       导致即使持久化为浅色，首帧仍按深色渲染，直到 setTheme('light') 才变浅。
 * 根因2（主进程窗口层）: main.js 创建 BrowserWindow 时未设 show:false，窗口一创建即用
 *       backgroundColor:'#1E1E2E'（深色）填充显示，抢在页面浅色 body 渲染完成前露出 → 仍「先深后浅」。
 * 修复: HTML 层移除硬编码并在 head CSS 之前插入同步脚本；主进程层 show:false +
 *       ready-to-show 后再 show()，首帧渲染完成后才显示窗口。
 * 回归门禁（静态）：<html> 不得再含 data-theme="dark"，且首帧同步脚本位于 CSS 引用之前；
 *       main.js 不得在浅色 body 就绪前直接显示深色窗口。 */
(() => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const scriptIdx = html.indexOf('note-app:theme');
  const cssIdx = html.indexOf('css/base.css');
  assert(html.indexOf('data-theme="dark"') === -1, 'Bug-041: index.html <html> 不再硬编码 data-theme="dark"');
  assert(scriptIdx !== -1 && scriptIdx < cssIdx, 'Bug-041: 首屏同步主题脚本位于 CSS 引用之前（消除深→浅闪烁）');
  assert(html.indexOf("'auto' && prefersDark") !== -1, 'Bug-041: 首屏脚本处理「跟随系统」时按系统明暗取值');

  // 主进程窗口层门禁：窗口须 show:false，且存在 ready-to-show 后显示与超时兜底，避免深色背景抢显
  const mainJs = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
  assert(/\bshow:\s*false\b/.test(mainJs), 'Bug-041: main.js 创建窗口 show:false（不提前露深色背景）');
  assert(mainJs.indexOf('ready-to-show') !== -1, 'Bug-041: main.js 在 ready-to-show 后才显示窗口');
  assert(mainJs.indexOf('isVisible') !== -1 && mainJs.indexOf('setTimeout') !== -1,
    'Bug-041: main.js 有超时兜底强制显示，避免渲染异常导致白窗');
})();

/* ---- Bug-043: 自定义/内置配色首屏不再闪默认色；删除「停用」配色档 ----
 * 根因: minimal-theme 配色（mt-theme-N / custom 变量）挂在 body，宿主 head 首屏脚本只恢复宿主明暗，
 *       配色要等插件异步加载后才应用 → 自定义配色首帧用默认色、插件加载后再突变（闪烁）。
 * 修复: ①配色应用目标统一到 <html>（documentElement），与首屏前置恢复同一元素，可正确清理不残留；
 *       ②index.html head 在 CSS 引用之前内联还原 minimal 配色（内置 4 套 + custom）到 <html>；
 *       ③删除「停用」配色档（悬浮列表/循环/disable 动作/manifest 默认）。
 * 回归门禁（静态）：首屏 minimal 恢复在 CSS 之前；插件配色挂 <html> 而非 body；manifest 无停用。 */
(() => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const mtIdx = html.indexOf("localStorage.getItem('note-app:minimal-theme')");
  const mtCssIdx = html.indexOf('css/base.css');
  assert(mtIdx !== -1 && mtIdx < mtCssIdx, 'Bug-043: 首屏 minimal 配色恢复位于 CSS 引用之前（自定义配色不再闪默认色）');

  const pjs = fs.readFileSync(path.join(__dirname, 'plugins', 'minimal-theme', 'main.js'), 'utf8');
  assert(!/document\.body\.classList/.test(pjs) && pjs.indexOf('document.documentElement') !== -1,
    'Bug-043: 配色 class 挂到 <html>（documentElement），与首屏前置恢复同元素、可清理不残留');
  assert(pjs.indexOf("itemHTML('0', '停用')") === -1, 'Bug-043: 悬浮列表已删除「停用」配色项');
  assert(pjs.indexOf('applyBuiltinVars') !== -1 && pjs.indexOf('SB.BUILTIN') !== -1,
    'Bug-043: 插件内置配色走共享 SB_PALETTES 内联，不依赖异步 styles.css（消除首帧闪宿主默认色）');

  const mani = JSON.parse(fs.readFileSync(path.join(__dirname, 'plugins', 'minimal-theme', 'manifest.json'), 'utf8'));
  assert(!mani.settings.some(s => s.key === 'defaultTheme'), '默认配色方案已移除（改由宿主「常规-主题设置」决定，不设插件独立默认配色）');
  assert(mani.settings.some(s => s.key === 'hoverToolbar') && mani.settings.some(s => s.key === 'injectCss'),
    'manifest 保留 hoverToolbar/injectCss 等公共设置项');
  assert(html.indexOf('js/theme-palettes.js') !== -1 && html.indexOf('js/theme-palettes.js') < mtCssIdx,
    'Bug-043: head 前置加载共享主题数据源 theme-palettes.js（早于 CSS，渲染前内联内置配色）');

  const ejs = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');

  // Bug-046: 编辑器做主题配色「数值映射」——buildEditorCss 把当前主题的 --note-* 值映射进 vditor
  // 壳与内容层（含表格/文字，兜底 .vditor-reset 硬编码 #24292e 在深色下不可读）；
  // 不得回落固定深色/浅色值；editorThemeResolver 按 hint.dark 套 vditor 深浅主题打底并可关映射；
  // manifest 含 injectCss 配色映射开关。宿主 resolveVdTheme fallback 按 isDarkTheme() 返回 dark/light。
  assert(/buildEditorCss/.test(pjs) && pjs.indexOf('html body .vditor .vditor-reset { background-color: var(--note-background); color: var(--note-ink); }') !== -1,
    'Bug-046: 插件用 buildEditorCss 把主题配色数值映射进编辑器（含 .vditor-reset 文字色，深色下可读）');
  assert(/html body \.vditor table \{ background-color: var\(--note-background[^#]/.test(pjs)
    && /html body \.vditor table th \{ background-color: var\(--note-card/.test(pjs),
    'Bug-046: 表格/表头数值映射为主题颜色（无固定深色/浅色残留）');
  const mapSeg = pjs.slice(pjs.indexOf('function buildEditorCss'), pjs.indexOf('function editorThemeResolver'));
  assert(!/, ?#[0-9a-fA-F]{3,6}/.test(mapSeg) && mapSeg.indexOf('var(--note-background)') !== -1,
    'Bug-046: buildEditorCss 映射只引用主题变量，不回落固定色值');
  assert(pjs.indexOf("if (getSetting('injectCss') !== 'false') css = buildEditorCss();") !== -1
    && pjs.indexOf("return { theme: (hint && hint.dark) ? 'dark'") !== -1,
    'Bug-046: editorThemeResolver 可按开关注入配色映射，并按宿主明暗(hint.dark)套 vditor 深浅主题打底');
  assert(ejs.indexOf("hint.dark ? 'dark' : 'light'") !== -1
    && ejs.indexOf('minimalThemeEditorMode') === -1,
    'Bug-046: 宿主 resolveVdTheme fallback 按宿主明暗返回 dark/light，已移除 minimalThemeEditorMode 深浅推导');
  assert(mani.settings.every(s => !/^edTheme/.test(s.key)) && mani.settings.some(s => s.key === 'injectCss'),
    'Bug-046: manifest 无 edTheme 深浅设置项，但保留 injectCss 配色映射开关');

  // Bug-044-1: 插件解析器异步注册后，宿主须补一次 vditor 主题 sync，避免已构建的编辑器表格保持白色
  // （渲染容器需读到 buildEditorCss 的表格深色覆盖，否则要等再次进入/切换视图才回主题）。
  const pjs44 = fs.readFileSync(path.join(__dirname, 'js', 'app-plugins.js'), 'utf8');
  assert(pjs44.indexOf('registerEditorThemeResolver') !== -1
    && /list\.push\(fn\)[\s\S]*?vdSyncTheme/.test(pjs44),
    'Bug-044-1: registerEditorThemeResolver 注册后触发 window.vdSyncTheme 补一次主题应用，修复编辑器表格白色');

  // Bug-044-2: Ribbon 按钮点击用「视图 key」归一化比较，避免启动时 location.hash 为空串仍触发重渲染装载区。
  const rjs44 = fs.readFileSync(path.join(__dirname, 'js', 'app-ribbon.js'), 'utf8');
  assert(/'#\/editor'\)\.replace\('#\/'|location\.hash \|\| '#\/editor'/.test(rjs44)
    && /current !== target/.test(rjs44)
    && !/location\.hash === btn\.route/.test(rjs44),
    'Bug-044-2: Ribbon 点击按视图 key 比较，点击当前激活按钮不重渲染装载区');

  // Bug-047-1: 内置「编辑器」Ribbon 按钮 id 直接用 'editor'（与路由 key 一致），
  // updateActive 直接匹配即可高亮，不再需要 'file' 与 editor→file 归一化。
  assert(/id: 'editor'/.test(rjs44)
    && /navKey \|\| 'editor'/.test(rjs44)
    && /dataset\.ribbonBtn === navKey/.test(rjs44)
    && !/=== 'editor'\)\s*\?\s*'file'/.test(rjs44),
    'Bug-047-1: Ribbon 编辑器按钮 id 统一为 editor，切回编辑器时高亮正常');

  // Bug-045: 主题「一次设置、一次渲染」——启动主题由 index.html head 读取 localStorage 一次性渲染；
  // 插件启动不再自动 applyTheme（restore），head 需含「默认配色方案」兜底，避免二次设置。
  const pjs45 = fs.readFileSync(path.join(__dirname, 'plugins', 'minimal-theme', 'main.js'), 'utf8');
  assert(!/\(function restore\(\)/.test(pjs45) && !/applyIfReady\(/.test(pjs45)
    && !/var saved = localStorage\.getItem\(LS_KEY\);/.test(pjs45),
    'Bug-045: minimal-theme 插件启动不再 restore/applyTheme 自动套用主题');
  assert(html.indexOf("plugin:minimal-theme:defaultTheme") === -1,
    'Bug-045: 已移除「默认配色方案」首屏兜底，配色完全由 note-app:minimal-theme 决定、深浅跟随宿主，一次渲染不再二次设置');

  // vditor 黑边框：.vditor--dark 内 --border-color 固定近黑(#141414)，会让编辑器外框(1px solid var(--border-color))
  // 在浅色配皮下呈黑框且不受主题控制。插件须把它挂到主题 --note-border。/作者: 火 冰
  assert(pjs45.indexOf('html body .vditor { --border-color: var(--note-border)') !== -1,
    '编辑器外观：插件注入样式覆盖 vditor --border-color → 边框随主题配色，不再出现黑框');
  assert(pjs45.indexOf('--textarea-background-color: var(--note-editor-bg, var(--note-surface-2))') !== -1
    && pjs45.indexOf("'--note-editor-bg'") !== -1 && pjs45.indexOf('--textarea-background-color: var(--note-surface-2)') === -1,
    '编辑器激活背景：独立字段 --note-editor-bg（内置无此字段时 CSS 兜底回落 --note-surface-2），随主题管理不再跳 vditor 默认色');

  // 外观-主题模式：宿主「设置-外观」的深色/浅色/跟随系统走 setTheme，不经插件 applyTheme；
  // 而配色内联变量写进 <html> 内联优先级高于宿主 .dark/.light 类规则，会盖死宿主明暗切换。
  // 插件须监听宿主明暗属性(data-theme/data-theme-mode)变化时清掉钉住的配色变量，宿主明暗才真正生效。
  const obsAt = pjs45.indexOf('new MutationObserver(function () {');
  const obsBody = obsAt >= 0 ? pjs45.slice(obsAt) : '';
  assert(/attributeFilter:\s*\['data-theme', 'data-theme-mode'\]/.test(pjs45)
    && obsAt >= 0 && obsBody.indexOf('clearCustomVars()') !== -1,
    '外观-主题模式：插件监听宿主 data-theme 变更并清配色内联变量，宿主明暗不被配色盖死');

  // 需求：画廊激活高亮实时刷新 + 弹框实时预览(关闭还原) + 独立编辑器激活背景字段
  assert(pjs45.indexOf('function refreshGalleryActive()') !== -1
    && pjs45.indexOf('notifyThemeChanged()') !== -1 && pjs45.indexOf('refreshGalleryActive();') !== -1,
    '主题画廊：notifyThemeChanged 刷新「当前使用」高亮框，点切主题后选中实时跟随');
  assert(pjs45.indexOf('function applyPreviewVars(fields)') !== -1
    && pjs45.indexOf('ov.__mtPreviewed') !== -1 && pjs45.indexOf('applyTheme(preOpenId)') !== -1,
    '主题弹框：配色字段实时预览(applyPreviewVars)，关闭/保存/删除统一还原当前激活主题(非刷新)');
  assert(/key:\s*'cEditorBg'/.test(pjs45) && /default:\s*'#E8E1D4'/.test(pjs45)
    && pjs45.indexOf("'--note-editor-bg'") !== -1
    && JSON.parse(fs.readFileSync(path.join(__dirname, 'plugins', 'minimal-theme', 'manifest.json'), 'utf8'))
      .settings.some(function (s) { return s.key === 'cEditorBg'; }),
    '编辑器激活背景：独立字段 cEditorBg 已加入弹框字段定义与 manifest');
  assert(pjs45.indexOf("hdr.addEventListener('pointerdown'") !== -1
    && pjs45.indexOf('dlg.style.position = \'fixed\'') !== -1
    && pjs45.indexOf('.mt-form-close') !== -1 && pjs45.indexOf('pointerup') !== -1,
    '主题弹框：支持拖拽（按住标题区移动窗口，关闭按钮不抢）');
  assert(pjs45.indexOf('function previewDialog()') !== -1
    && pjs45.indexOf('ov.__mtExtraStyle') !== -1 && pjs45.indexOf('function clearPreviewStyle(ov)') !== -1
    && pjs45.indexOf('cExtraCss') !== -1,
    '主题弹框：实时预览含自定义编辑器CSS（临时 style 注入，关闭/保存/删除统一清理），编辑器界面可见效果');
  assert(pjs45.indexOf('function themeSettingButton(') !== -1
    && pjs45.indexOf("closest('.mt-item-set')") !== -1 && pjs45.indexOf('relookThemeDialog') === -1
    && pjs45.indexOf('function openSettingsFromMenu(') !== -1,
    '顶栏下拉：每个主题项带「设置」按钮（内置只读/自建可编辑），点击开弹框且不触发主题切换');
})();

/* ---- Bug-029: vditor 资源本地化，避免弱网下 unpkg CDN 拖慢编辑区渲染 ----
 * 确定性复现点：editor-vditor.js 若把 cdn 指回 unpkg.com（或本地资源被删除/缺失），
 * 编辑区会重新陷入十几秒空白。此处做静态门禁：
 *   1) 宿主 opts.cdn 指向 node_modules/vditor（npm 运行时依赖，不再 vendor 复制），且源码不残留 unpkg.com
 *   2) node_modules/vditor/dist 关键资源齐备（lute/i18n/icons/content-theme）
 * 作者: 火 冰 */
function testVditorLocalCdn() {
  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  assert(/cdn\s*:\s*['"]node_modules\/vditor['"]/.test(src),
    'Bug-031: editor-vditor.js 的 opts.cdn 指向 node_modules/vditor（不再走 unpkg.com、不再 vendor 复制）');
  assert(!/cdn\s*:\s*['"]https?:\/\/unpkg\.com/.test(src),
    'Bug-029: cdn 配置值不指向 unpkg.com 外网地址');

  const vd = path.join(__dirname, 'node_modules', 'vditor', 'dist');
  const need = [
    'js/lute/lute.min.js',
    'js/i18n/zh_CN.js',
    'js/icons/ant.js',
    'js/highlight.js/highlight.min.js',
    'css/content-theme/light.css',
    'images/emoji/vditor.png',
  ];
  need.forEach(function (rel) {
    assert(fs.existsSync(path.join(vd, rel)), 'Bug-031: vditor 资源存在于 node_modules/dist ' + rel);
  });
}

/* ---- Bug: Tailwind v4 `border-b/t/l/r` 单类不显示实线 ----
 * Tailwind v4 browser 版中，`border-b` 仅生成 `border-bottom-style: var(--tw-border-style)`，
 * 若 `--tw-border-style` 未定义，回退到 none → 不显示边框。修复：在 base.css :root 默认`--tw-border-style:solid`。
 * 断言：base.css 根含该变量默认值。
 * 作者: 火 冰 */
function testDefaultBorderStyle() {
  const css = fs.readFileSync(path.join(__dirname, 'css', 'base.css'), 'utf8');
  assert(css.indexOf('--tw-border-style') !== -1
    && /--tw-border-style:\s*solid/.test(css),
    'base.css :root 默认 --tw-border-style: solid，解决 border-b/t/l/r 单类边框消失问题');
}

/* ---- Bug-030b: openNote 异步装载间隙，edCurrent 不得提前指向新文件 ----
 * openNote 的 noteStore.read 是异步 await；若 edCurrent=path 在函数开头同步设置，
 * 则「点击新文件」到「新内容渲染进 vditor」之间编辑器仍显示旧文件，此时 vditor 的
 * blur/input 事件会把旧文件可见内容按新文件路径保存（串文件/笔记丢失）。
 * 修复：edCurrent=path 必须放在内容装载（await noteStore.read / 取缓存）完成之后、渲染之前。
 * 断言：源码中 openNote 内 `await noteStore.read` 出现在 `edCurrent = path` 之前。
 * 作者: 火 冰 */
function testEdOpenRace() {
  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-host.js'), 'utf8');
  const fn = src.slice(src.indexOf('function openNote'), src.indexOf('function persistRecentTabs'));
  const readIdx = fn.indexOf('noteStore.read');
  const assignIdx = fn.indexOf('edCurrent = path');
  assert(readIdx !== -1 && assignIdx !== -1 && readIdx < assignIdx,
    'Bug-030b: openNote 中 edCurrent 在内容装载（noteStore.read/缓存命中）之后才激活（' +
    (readIdx) + '<' + (assignIdx) + '）');
}

/* ---- Bug-030: autosave 把内容保存到「产生输入时所在文件」，per-path 去抖互不覆盖 ----
 * 旧实现在 autosave 去抖 timer 触发时才读 edCurrent，且所有文件共用一个 timer：
 * 快速切换笔记时 A 的内容会被保存进 B（串文件/覆盖），或 A 的 timer 被 B 的输入清掉而丢保存。
 * 修复：onEdInput 在输入瞬间固定归属 p=edCurrent，且按文件独立去抖 edSaveTimers[p]。
 * 断言：编辑 a → 切 b → 编辑 b 后，两个文件各按其归属被保存，而非只保存 b。
 * 作者: 火 冰 */
async function testEdAutosaveBinding() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  // 预置 onEdInput 依赖：$ / countChars / restoreS / noteStore（记录保存调用）
  W.__saveCalls = [];
  const stubScript = W.document.createElement('script');
  stubScript.textContent = '(function () {'
    + 'window.$ = function () { return null; };'
    + 'window.countChars = function (t) { return t ? String(t).length : 0; };'
    + 'window.restoreS = function () { return true; };' // autosave 开启
    + 'window.noteStore = { save: async function (p, c) { window.__saveCalls.push([p, c]); }, read: async function () { return ""; } };'
    + '})();';
  W.document.head.appendChild(stubScript);
  // 注入 editor-core.js（定义 edCurrent/edOutdated/edDirty/edSaveTimers，顶层 let 跨 script 全局可见）
  ['js/editor/editor-core.js', 'js/editor/editor-host.js'].forEach(function (rel) {
    const s = W.document.createElement('script');
    try { s.textContent = fs.readFileSync(path.join(__dirname, rel), 'utf8'); } catch (e) { assert(false, 'Bug-030: 注入 ' + rel + ' 失败: ' + e.message); }
    W.document.head.appendChild(s);
  });
  // 驱动：编辑 a → 立即切 b → 编辑 b（模拟快速切换；修复前只会保存 b、或 a 覆盖 b）
  try {
    W.eval('edCurrent="a.md"; onEdInput("AAAContent"); edCurrent="b.md"; onEdInput("BBBContent");');
  } catch (e) {
    assert(false, 'Bug-030: 驱动 onEdInput 报错: ' + e.message);
    return;
  }
  await new Promise(function (r) { setTimeout(r, 1000); }); // 等待 800ms 去抖保存触发
  const calls = W.__saveCalls || [];
  const hasA = calls.some(function (c) { return c[0] === 'a.md' && c[1] === 'AAAContent'; });
  const hasB = calls.some(function (c) { return c[0] === 'b.md' && c[1] === 'BBBContent'; });
  assert(hasA && hasB && calls.length === 2,
    'Bug-030: a、b 两笔记各自按输入时归属被保存，不被切换串台/丢保存');
}

/* ---- Bug-032: 工具栏不得配置 vditor 不存在的 key，否则渲染空白 undefined 按钮 ----
 * 根因: 'formula'/'find' 非 vditor 内置 key，mergeToolbar 会原样保留字符串，
 *        genItem 读 menuItem.name=undefined → Custom 兜底渲染出 data-type="undefined" 空白按钮。
 * 修复: VDTOOLBAR 只保留内置合法 key。
 * 断言: 源码中 VDTOOLBAR 数组内的字符串均不得命中 'formula'/'find' 这两个无效 key。
 * 作者: 火 冰 */
function testVditorToolbarValid() {
  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  const start = src.indexOf('const VDTOOLBAR');
  const end = src.indexOf('\n  ]', start);
  const arr = src.slice(src.indexOf('[', start), end + 3);
  const invalid = ['formula', 'find'];
  const hits = invalid.filter(function (k) { return arr.indexOf("'" + k + "'") !== -1; });
  assert(hits.length === 0,
    'Bug-032: VDTOOLBAR 不包含 vditor 不存在的工具栏 key（formula/find），不会渲染空白按钮' +
    (hits.length ? '（残留: ' + hits.join(',') + '）' : ''));
}

/* ---- 设置-快捷键: F11 全屏 / F12 开发者工具 纳入快捷键注册表 ----
 * 注册 cmd:fullscreen（默认 F11）与 cmd:devtools（默认 F12），经 kbMatch 命中后
 * 调 noteDesktop.toggleFullScreen / toggleDevTools 走 IPC 控制主进程。
 * 断言: F11/F12 命中对应命令，且 action 正确触发 noteDesktop 接口。
 * 作者: 火 冰 */
function testFullscreenDevtoolsKeybinds() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  W.saveS = function () {}; W.restoreS = function () { return null; };
  const calls = [];
  W.noteDesktop = {
    toggleFullScreen: function () { calls.push('fs'); },
    toggleDevTools: function () { calls.push('dt'); },
  };
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-keybinds.js'), 'utf8');
  W.document.head.appendChild(s);
  W.kbInit();
  const f11 = W.kbMatch({ key: 'F11', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
  assert(f11 && f11.id === 'cmd:fullscreen', '设置-快捷键: F11 命中「切换全屏（窗口）」命令');
  const f12 = W.kbMatch({ key: 'F12', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
  assert(f12 && f12.id === 'cmd:devtools', '设置-快捷键: F12 命中「开发者工具」命令');
  f11.action(); f12.action();
  assert(calls.join(',') === 'fs,dt', '设置-快捷键: F11/F12 触发 noteDesktop.toggleFullScreen/toggleDevTools');
}

/* ---- IR 模式表格工具条：__vdTable 纯 DOM 行/列增删助手 ----
 * 供 jsdom 直接验证：插入行/列、删除行/列、列表引都应正确改变表格结构。
 * 作者: 火 冰 */
function testIrTableBarHelpers() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(W.__vdTable && typeof W.__vdTable.irInsertRow === 'function', 'editor-vditor.js 暴露 __vdTable 表格助手');

  const makeTable = function () {
    const t = W.document.createElement('table');
    t.innerHTML = '<thead><tr><th>a</th><th>b</th></tr></thead>'
      + '<tbody><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></tbody>';
    return t;
  };
  const tbl = W.__vdTable;

  // 表头 1 行 + 数据 2 行
  let t = makeTable();
  assert(t.rows.length === 3, 'IR表: 初始 3 行');
  const bodyRow0 = t.querySelector('tbody tr:first-child');
  tbl.irInsertRow(t, bodyRow0, true);                       // 在首数据行上方插行
  assert(t.rows.length === 4, 'IR表: 上方插入行后 4 行');
  assert(t.querySelector('tbody tr:first-child').children.length === 2, 'IR表: 新行 2 格');

  t = makeTable();
  const bodyRow1 = t.querySelector('tbody tr:nth-child(2)');
  tbl.irInsertCol(t, bodyRow1, 0, true);                    // 在第 0 列左侧插列
  Array.prototype.forEach.call(t.rows, function (r) { assert(r.cells.length === 3, 'IR表: 每行 3 格(插列)'); });
  assert(t.querySelectorAll('thead th').length === 3, 'IR表: 表头插入 th 列');

  t = makeTable();
  tbl.irDeleteRow(t, t.querySelector('tbody tr:nth-child(2)')); // 删一数据行
  assert(t.rows.length === 2, 'IR表: 删除行后 2 行');

  t = makeTable();
  tbl.irDeleteCol(t, t.querySelector('tbody tr:first-child'), 0); // 删第 0 列
  Array.prototype.forEach.call(t.rows, function (r) { assert(r.cells.length === 1, 'IR表: 删除列后每行 1 格'); });
  // 仅 1 列的表格删除列不应清空（防整表被删）
  const oneCol = W.document.createElement('table');
  oneCol.innerHTML = '<thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody>';
  tbl.irDeleteCol(oneCol, oneCol.querySelector('tbody tr:first-child'), 0);
  oneCol.querySelectorAll('tbody tr').forEach(function (r) { assert(r.cells.length === 1, 'IR表: 单列表不误删'); });

  const idxT = makeTable();
  assert(tbl.irTableCellIndex(idxT.querySelector('tbody tr:first-child'),
    idxT.querySelector('tbody tr:first-child').children[1]) === 1, 'IR表: 列索引正确');

  // 边界：表头行(th)「下方插入行」必须落到 |---| 分隔线下（tbody 首行，不串进 thead）
  const hdrT = makeTable();
  tbl.irInsertRow(hdrT, hdrT.querySelector('thead tr:first-child'), false);
  assert(hdrT.querySelectorAll('thead tr').length === 1, 'IR表: 表头下方插行不增加表头行(thead 仍 1 行)');
  assert(hdrT.querySelector('tbody tr:first-child').cells[0].tagName === 'TD', 'IR表: 表头下方插行为数据格(td)');

  // 边界：表头行不可删除
  const hdrDel = makeTable();
  tbl.irDeleteRow(hdrDel, hdrDel.querySelector('thead tr:first-child'));
  assert(hdrDel.querySelectorAll('thead tr').length === 1, 'IR表: 表头行不可删除');
}

/* ---- Bug: IR 模式「表格/代码块前无法插入新行」→ __vdBlock.irInsertAbove ----
 * 表格/代码块作为文档第一个元素时，光标无法落到块前，此前没有插入入口。
 * 修复：右键表格/代码块弹菜单「在上方插入空行」，在带 data-block="0" 的块根前
 *       插入 `<p data-block="0">ZWSP<wbr></p>`，再同步保存。
 * 断言：暴露 __vdBlock.irInsertAbove 助手，且其以 insertBefore 插 <p>、用 [data-block="0"]
 *       归一表格/代码块根，右侧菜单含表格/代码块两项「上方插入空行」。
 * 作者: 火 冰 */
function testIrBlockAbove() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(W.__vdBlock && typeof W.__vdBlock.irInsertAbove === 'function',
    'editor-vditor.js 暴露 __vdBlock 块级插入助手');

  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  const ctxSrc = fs.readFileSync(path.join(__dirname, 'plugins', 'markdown-editor', 'md-context.js'), 'utf8');
  assert(/root\.parentNode\.insertBefore/.test(ctxSrc) && /closest\(['"]\[data-block="0"\]/.test(ctxSrc),
    '上方插入空行：插件 md-context.js 以 [data-block="0"] 归一表格/代码块根，并 insertBefore 插 <p data-block="0">');
  assert(src.indexOf('在上方插入空行') !== -1,
    '右侧菜单含「在上方插入空行」（表格与代码块通用文案）：提供了块前插入的 UI 入口');
  assert(src.indexOf('在代码块上方插入空行') === -1 && src.indexOf('在表格上方插入空行') === -1,
    '右侧菜单已移除旧长文案「在代码块上方/表格上方插入空行」');
}

/* ---- 编辑区右键「插入图片/上传附件」：类型按 accept 过滤，分流插行内图片或卡片引言 ----
 * 断言：editor-vditor.js 的通用右键菜单提供「插入图片」「上传附件」两项；
 *       二者通过 sbUploadAccept(type) 映射 accept——图片 `image/*`、附件非图片扩展名白名单，
 *       选中文件再经 handleVdUpload 按 isImageName 分流（图片行内、附件 `> [!attach]` 卡片）。
 * 另：命中判定必须用 vditor 内容容器 vdInst.vditor.element / vdEl()，绝不能再用 vdInst.element——
 *     Vditor 实例从不挂该字段，恒为 undefined，会导致右键菜单永不触发（Bug 防再犯）。
 * 作者: 火 冰 */
function testEditorRightClickUpload() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  // accept 过滤已迁入插件 md-context.js：一并注入以便行为断言
  const cs = W.document.createElement('script');
  cs.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'markdown-editor', 'md-context.js'), 'utf8');
  W.document.head.appendChild(cs);
  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  assert(src.indexOf("label: '插入图片'") !== -1 && src.indexOf("label: '上传附件'") !== -1,
    '右键：编辑区通用右键菜单含「插入图片」「上传附件」两项');
  assert(src.indexOf('vdInst.element &&') === -1 && src.indexOf('vdInst.element.contains') === -1,
    '右键：命中判定不再用从不赋值的 vdInst.element（否则 contains 恒 false，菜单永不弹出）');
  assert(src.indexOf('vdInst.vditor.element') !== -1 || src.indexOf('vdEl()') !== -1,
    '右键：命中判定改用 vditor 内容容器（vdInst.vditor.element / vdEl）');
  // Bug-047 同源：vditor IR 把整个编辑区包在一个 <pre class="vditor-reset"> 里，若 IR 代码块判定用
  // closest('pre')，普通文字也命中 pre 会被误短路，导致 IR 通用右键菜单永不弹出（WYSIWYG 无此包裹所以正常）。
  // 回归守卫：代码块判定必须用 [data-type="code-block"]，且通用菜单短路条件不得再含 pre。
  assert(src.indexOf('closest(\'[data-type="code-block"]\')') !== -1,
    '右键: IR 代码块用 [data-type="code-block"] 判定（非 closest(\'pre\')）——普通文字不被整区 <pre> 误短路，通用菜单可弹出');
  assert(src.indexOf('closest(\'table,pre\')') === -1,
    '右键: IR 通用菜单短路条件不再含 pre（旧 Bug：IR 整区 <pre> 包裹致通用菜单永不弹出）');
  assert(typeof W.sbUploadAccept === 'function', '右键：暴露 sbUploadAccept 类型→accept 助手');
  assert(W.sbUploadAccept('image') === 'image/*', '右键：插入图片仅选 image/*');
  assert(W.sbUploadAccept('attachment').indexOf('.pdf') !== -1 && W.sbUploadAccept('attachment').indexOf('image') === -1,
    '右键：上传附件仅选非图片扩展名白名单');
}

/* ---- WYSIWYG 右键「插入」子菜单新增「图片/附件」上传入口 ----
 * 断言：app-editor-ctx.js 的 WYSIWYG 插入子菜单含「图片」「附件」两入口（走 insWysPickUpload，
 *       与 IR 共用 uploadResource 落盘到 .resources）；上传后按类型生成可往返 DOM 块：
 *       图片 → `![名](url)` 段落；附件 → `> [!attach]` 引用块（预览/阅读渲染完整卡片）。
 * 作者: 火 冰 */
function testWysRightClickUpload() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-editor-ctx.js'), 'utf8');
  try { W.document.head.appendChild(s); } catch (e) { /* 脚本仅在函数调用期落地，加载期不依赖 DOM */ }
  // 块生成/上传纯逻辑已迁入插件 md-context.js，此处一并注入以便行为断言
  const cs = W.document.createElement('script');
  cs.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'markdown-editor', 'md-context.js'), 'utf8');
  try { W.document.head.appendChild(cs); } catch (e) { /* 同上 */ }
  const src = fs.readFileSync(path.join(__dirname, 'js', 'app-editor-ctx.js'), 'utf8');
  const csrc = fs.readFileSync(path.join(__dirname, 'plugins', 'markdown-editor', 'md-context.js'), 'utf8');
  assert(src.indexOf("specItem('图片'") !== -1 && src.indexOf("specItem('附件'") !== -1,
    'WYSIWYG: 插入子菜单含「图片」「附件」两入口');
  assert(csrc.indexOf('insWysPickUpload') !== -1 && csrc.indexOf('accept') !== -1,
    'WYSIWYG: 两入口走插件 md-context.js 的 insWysPickUpload，accept 过滤上传类型');
  assert(typeof W.sbWysUploadBlockHtml === 'function', 'WYSIWYG: 暴露 sbWysUploadBlockHtml 纯函数');
  const p = W.sbWysUploadBlockHtml('cap.png', 'note://vault_res/u.png', true);
  assert(p.indexOf('![cap.png](note://vault_res/u.png)') !== -1 && p.indexOf('<p') !== -1,
    'WYSIWYG: 图片上传生成 ![名](url) 段落块（预览正常显示图片）');
  const q = W.sbWysUploadBlockHtml('打包.zip', 'note://vault_res/u.zip', false);
  assert(q.indexOf('<blockquote') !== -1 && q.indexOf('[!attach] 打包.zip note://vault_res/u.zip') !== -1,
    'WYSIWYG: 附件上传生成 `> [!attach]` 引用块（预览/阅读渲染完整卡片）');
}

/* ---- Bug: 有序列表序号丢失（Tailwind preflight 重置 ol/ul，vditor 未恢复 ol）----
 * Tailwind preflight 将 ol/ul/menu 统一 list-style:none，vditor index.css 只恢复了 ul，
 * 未恢复 ol，导致有序列表 1. 2. 3. 序号消失。
 * 修复：app.css 在 #ed-vditor 作用域恢复 ol 的 decimal。
 * 断言：app.css 含该恢复规则（防 preflight 注入再次吞掉 ol 序号）。
 * 作者: 火 冰 */
function testOrderedListCss() {
  const css = fs.readFileSync(path.join(__dirname, 'css', 'app.css'), 'utf8');
  const hasRestore = css.indexOf('#ed-vditor .vditor-reset ol') !== -1
    && /list-style-type:\s*decimal/.test(css);
  assert(hasRestore, '有序列表: app.css 恢复 #ed-vditor 内 ol 的 decimal 序号样式');
}

/* ---- Bug: 待办列表切换视图/重渲染后不得退化为字面 ".[]" / "[]" ----
 * 复现点：Lute 的 IR(WYSIWYG) 转换必须把 `- [ ]` 输出为带 vditor-task 的 <input type="checkbox">，
 *         且 VditorIRDOM2Md 往返仍保留待办标记，否则重开后会渲染成普通列表的 "[ ]" 文本。
 * 经实机复测：当前解析器在插入/切预览/切所见即所得/重渲染下均保持 checkbox，此处以 Lute
 * 序列化往返作确定性门禁，防后续 misconfigure 导致退化。
 * 作者: 火 冰 */
function testTaskListRoundTrip() {
  const vm = require('vm');
  const fm = require('fs');
  const ctx = { require: require, console: console, process: process };
  ctx.global = ctx;
  ctx.addEventListener = function () {};
  ctx.setTimeout = function () { return 0; };
  ctx.clearTimeout = function () {};
  vm.createContext(ctx);
  try {
    vm.runInContext(fm.readFileSync(
      path.join(__dirname, 'node_modules', 'vditor', 'dist', 'js', 'lute', 'lute.min.js'), 'utf8'), ctx);
  } catch (e) {
    assert(false, '待办往返: 无法加载 lute.min.js: ' + e.message);
    return;
  }
  const lute = ctx.Lute.New();
  const ir = lute.Md2VditorIRDOM('- [ ] 任务A\n- [x] 完成B');
  const hasCheckbox = /vditor-task/.test(ir) && /<input type="checkbox"/.test(ir);
  const back = lute.VditorIRDOM2Md(ir);
  const keepsTask = /\[[ xX]\]/.test(back);
  assert(hasCheckbox, '待办往返: Lute IR 转换输出 vditor-task + checkbox（不会渲染成字面 [ ]）');
  assert(keepsTask, '待办往返: IR→MD 序列化保留待办标记 [ ]（重开后仍为待办）');
}

/* ---- Bug: IR 模式空行删不掉 / 块前 Backspace 不删上一空行 ----
 * vditor 对 `<p data-block="0">ZWSP<wbr></p>` 空行按 Backspace 只删 ZWSP 字符、不删整行；
 * 表格/代码块在最前面无法在其上删除空行。新增 isEmptyLine/blockRootOf/caretAtBlockStart/
 * removeEmptyLine/handleIrDeleteKeydown，捕获阶段拦截 Backspace/Delete：
 * 规则一：空行上 Backspace/Delete 删除整行；规则二：块最前 Backspace 且上一行是空行则删除之，
 * 非空行放行给 vditor 原生跳转。
 * 断言：暴露上述助手，isEmptyLine 正确识别 ZWSP 空段落。
 * 作者: 火 冰 */
function testIrEmptyLineDelete() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(W.__vdBlock && typeof W.__vdBlock.isEmptyLine === 'function'
    && typeof W.__vdBlock.handleIrDeleteKeydown === 'function',
    'IR空行: __vdBlock 暴露 isEmptyLine/handleIrDeleteKeydown');

  // isEmptyLine 空段落识别（用 jsdom window 内的元素测试，避免污染 Node 全局）
  const p = W.document.createElement('p');
  p.setAttribute('data-block', '0');
  p.appendChild(W.document.createTextNode('\u200b')); // ZWSP 空行
  p.appendChild(W.document.createElement('wbr'));
  assert(W.__vdBlock.isEmptyLine(p) === true, 'IR空行: ZWSP 空段落 isEmptyLine=true');
  p.appendChild(W.document.createTextNode('x'));
  assert(W.__vdBlock.isEmptyLine(p) === false, 'IR空行: 含文本段落 isEmptyLine=false');

  const src = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  assert(src.indexOf('块最前 Backspace') !== -1, 'IR空行: 源码含块最前 Backspace 删除上一空行逻辑');
  assert(/addEventListener\(['"]keydown['"],\s*handleIrDeleteKeydown,\s*true\)/.test(src),
    'IR空行: 捕获阶段绑定 handleIrDeleteKeydown 拦截 Backspace/Delete');
}

/* ---- AI-16 语义分块回归断言 ----
 * 覆盖语义分块算法的确定性复现点：
 *   1) 文件以一级标题开头（起点为 0）时，单元起点必须落在标题行，不得被 !0 误判重置（曾导致首块丢失标题行）
 *   2) 块内容按单元拼接须覆盖全文关键片段（标题行作为单元正文首行被保留）
 *   3) 默认 chunkStrategy 为 'fixed'，strategy=semantic 走语义分块并注入文件名前缀
 * 作者: 火 冰 */
function testSemanticChunk() {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, 'ai-engine.js'), 'utf8');
  const sandbox = {
    module: { exports: {} }, exports: {}, __filename: __dirname, __dirname: __dirname,
    require: function (id) {
      if (id === 'onnxruntime-node') return { InferenceSession: null };
      if (id === 'gray-matter') return function () { return { data: {}, content: '' }; };
      return require(id);
    },
  };
  sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'ai-engine.js' });
  const mod = sandbox.module.exports || {};
  const { chunkConfigured, semanticChunkText, DEFAULT_CONFIG } = mod;

  assert(DEFAULT_CONFIG && DEFAULT_CONFIG.chunkStrategy === 'fixed', 'AI-16: 默认 chunkStrategy 为 fixed');
  const FILE = '回归笔记.md';
  const text = [
    '# 一级标题A', '',
    '这是第一个段落，包含中文句子。这里有更多内容。', '',
    '## 二级标题B', '',
    '这是第二个段落。句子二。', '',
    '# 一级标题C', '',
    '结尾段落。',
  ].join('\n');
  const blocks = semanticChunkText(text, { size: 200, maxChunkSize: 300, fileName: FILE });
  const strip = function (s) { return s.replace(/\s+/g, ''); };
  const joined = strip(blocks.map(function (b) { return b.content; }).join(''));
  assert(joined.indexOf('一级标题A') > -1, 'AI-16: 文件以标题开头时单元起点落在标题行（首块含一级标题A）');
  assert(joined.indexOf('二级标题B') > -1 && joined.indexOf('一级标题C') > -1 && joined.indexOf('结尾段落') > -1,
    'AI-16: 块内容拼接覆盖全文关键片段');
  const semantic = chunkConfigured(text, 200, 40, null, 300, 'semantic', FILE);
  assert(semantic.length > 1 && semantic[0].text.indexOf(FILE) === 0, 'AI-16: strategy=semantic 走语义分块并含文件名前缀');
  const fixed = chunkConfigured(text, 200, 40, null, 300);
  assert(fixed[0].text.indexOf(FILE) === -1, 'AI-16: 默认固定分块不含文件名前缀（向后兼容）');
}

/* ---- 资源上传助手：sbResMarkdown / resolveVaultResUrl ----
 * 覆盖 Markdown Editor 上传图片/附件的确定性复现点：
 *   1) 注入 editor-vditor.js 后暴露 window.sbResMarkdown；
 *   2) 图片文件名 → `![真实名](note://vault_res/uuid.png)`；
 *   3) 附件文件名（pdf/zip 等非图片）→ `[真实名](note://vault_res/uuid.pdf)`；
 *   4) resolveVaultResUrl 从 note://vault_res/ 地址抽出存储名 uuid.ext，非该协议返回空串。
 * 作者: 火 冰 */
function testVaultResHelpers() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(typeof W.sbResMarkdown === 'function', 'resources: editor-vditor.js 暴露 sbResMarkdown 资源片段助手');
  assert(W.sbResMarkdown('截屏.png', 'note://vault_res/abc.png') === '![截屏.png](note://vault_res/abc.png)',
    'resources: 图片用真实名插入为 ![截屏.png](note://vault_res/abc.png)');
  assert(W.sbResMarkdown('设计文档.pdf', 'note://vault_res/uuid.pdf') === '[设计文档.pdf](note://vault_res/uuid.pdf)',
    'resources: 附件(pdf)用真实名插入为 [设计文档.pdf](note://vault_res/uuid.pdf)');
  assert(W.sbResMarkdown('打包.zip', 'note://vault_res/uuid.zip') === '[打包.zip](note://vault_res/uuid.zip)',
    'resources: 附件(zip)插入为 [打包.zip](note://vault_res/uuid.zip)');
  assert(typeof W.resolveVaultResUrl === 'function', 'resources: editor-vditor.js 暴露 resolveVaultResUrl');
  assert(W.resolveVaultResUrl('note://vault_res/uuid-abc.png') === 'uuid-abc.png',
    'resources: resolveVaultResUrl 抽出 note://vault_res/ 存储名 uuid-abc.png');
  assert(W.resolveVaultResUrl('note://local/index.html') === '',
    'resources: 非 vault_res 地址 resolveVaultResUrl 返回空串');
  assert(W.resolveVaultResUrl(null) === '', 'resources: 空入参 resolveVaultResUrl 返回空串');
}

/* ---- 附件卡片与「> [!attach]」引言语法（预览变换 / 卡片 HTML / 编辑区指示块） ----
 * 覆盖确定性复现点：
 *   1) sbAttachCardHTML 生成 `.sb-res-card` 卡片（扩展名徽标 + 真实名 + 下载按钮 + data 属性）；
 *   2) transformPreviewHtml 把 `[!attach] 名 url` 引言换成 `.sb-res-card`，普通引言不受影响；
 *   3) markAttachCallouts 为编辑区 attach 引言加 `sb-attach-callout` 指示类。
 * 作者: 火 冰 */
function testVaultResCards() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  const card = W.sbAttachCardHTML('设计文档_最终.pdf', 'note://vault_res/uuid.pdf');
  assert(typeof card === 'string' && card.indexOf('class="sb-res-card"') !== -1 && card.indexOf('data-sb-res-url="note://vault_res/uuid.pdf"') !== -1,
    'card: sbAttachCardHTML 生成带 url 的附件卡片');
  assert(card.indexOf('>PDF<') !== -1 && card.indexOf('设计文档_最终.pdf') !== -1 && card.indexOf('sb-res-card-dl') !== -1,
    'card: 卡片含 PDF 扩展名徽标、真实名与下载按钮');
  // transformPreviewHtml：attach 引言 → 卡片，普通引言原样
  const input = '<blockquote><p>[!attach] 设计文档_最终.pdf note://vault_res/uuid.pdf</p></blockquote><blockquote><p>普通引言</p></blockquote>';
  const out = W.sbTransformPreviewHtml(input);
  const root = W.document.createElement('div');
  root.innerHTML = out;
  assert(root.querySelector('.sb-res-card') !== null, 'card: transform 把 [!attach] 引言渲染成 .sb-res-card 卡片');
  assert(root.querySelector('.sb-res-card') && root.querySelector('.sb-res-card').getAttribute('data-sb-res-url') === 'note://vault_res/uuid.pdf',
    'card: 卡片保留 data-sb-res-url 供下载/右键');
  const quotes = root.querySelectorAll('blockquote');
  assert(quotes.length === 1 && quotes[0].textContent.indexOf('普通引言') !== -1,
    'card: 普通引言不受 transform 影响、不被替换');
  assert(W.sbTransformPreviewHtml('<blockquote><p>[!attach] 未知链接 xyz</p></blockquote>').indexOf('sb-res-card') === -1,
    'card: 非 note://vault_res 地址不渲染卡片');
  // markAttachCallouts：编辑区指示块 class 切换（含 SV 源码 data-type 结构）
  const editor = W.document.createElement('div');
  editor.innerHTML = '<blockquote><p>[!attach] a.pdf note://vault_res/u.pdf</p></blockquote><blockquote><p>普通</p></blockquote>';
  W.sbMarkAttachCallouts(editor);
  const bqs = Array.prototype.slice.call(editor.querySelectorAll('blockquote'));
  assert(bqs[0].classList.contains('sb-attach-callout') && !bqs[1].classList.contains('sb-attach-callout'),
    'card: 编辑区 attach 引言加指示类，普通引言不加');
  // SV 源码 mode 用 data-type="blockquote" 结构，也应加指示类
  const svRoot = W.document.createElement('div');
  svRoot.innerHTML = '<div data-type="blockquote"><p>[!attach] b.pdf note://vault_res/v.pdf</p></div>';
  W.sbMarkAttachCallouts(svRoot);
  assert(svRoot.firstChild.classList.contains('sb-attach-callout'),
    'card: SV 源码 data-type=blockquote 结构也加指示类');
}

/* ---- 上传插入片段分流：图片行内预览 / 附件卡片引言 ----
 * 覆盖 handleVdUpload 的插入片段决策（上传附件应渲染成「醒目指示块+完整卡片」而非普通链接）：
 *   1) sbAttachMarkdown 生成 `> [!attach] 名 url` 引言；
 *   2) 图片名 → sbResMarkdown（![名](url) 行内预览）；
 *   3) 附件名（pdf/zip 等非图片）→ sbAttachMarkdown（卡片引言），保证预览/阅读出完整卡片。
 * 作者: 火 冰 */
function testVaultResUploadSnippet() {
  const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>',
    { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const W = dom.window;
  const s = W.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'js', 'editor', 'editor-vditor.js'), 'utf8');
  W.document.head.appendChild(s);
  assert(typeof W.sbAttachMarkdown === 'function', 'upload: editor-vditor.js 暴露 sbAttachMarkdown');
  assert(W.sbAttachMarkdown('设计文档.pdf', 'note://vault_res/uuid.pdf') === '> [!attach] 设计文档.pdf note://vault_res/uuid.pdf',
    'upload: 附件插入为 > [!attach] 名 url 卡片引言');
  assert(!!W.__vdRes && W.__vdRes.sbAttachMarkdown === W.sbAttachMarkdown, 'upload: __vdRes 导出 sbAttachMarkdown');
  // 镜像 handleVdUpload 的分流逻辑：图片走行内预览，附件走卡片引言
  const isImg = function (n) { return W.__vdRes.isImageName(n); };
  const snippetOf = function (name, url) { return isImg(name) ? W.sbResMarkdown(name, url) : W.sbAttachMarkdown(name, url); };
  assert(snippetOf('cap.png', 'note://vault_res/u.png') === '![cap.png](note://vault_res/u.png)',
    'upload: 图片上传插图为行内图片语法（保持预览）');
  assert(snippetOf('打包.zip', 'note://vault_res/u.zip') === '> [!attach] 打包.zip note://vault_res/u.zip',
    'upload: 附件(zip)上传插图 > [!attach] 卡片引言，预览/阅读出完整卡片');
}

testLogBadge();
testSemanticChunk();
testPluginLoad();
testCodeLangGhost();
testThemeSavedSnapshot();
testVditorLocalCdn();
testDefaultBorderStyle();
testVditorToolbarValid();
testFullscreenDevtoolsKeybinds();
testIrTableBarHelpers();
testIrBlockAbove();
testEditorRightClickUpload();
testOrderedListCss();
testTaskListRoundTrip();
testIrEmptyLineDelete();
testVaultResHelpers();
testVaultResCards();
testVaultResUploadSnippet();
testVditorBridge();
Promise.all([
  testCodeHighlightCopyBtn(),
  testRenameNoteFile(),
  testCodeHighlightSkipEditSurface(),
  testEdAutosaveBinding(),
testEdOpenRace(),
]).then(function () {
  console.log(`\n回归结果: ${pass} 通过, ${fail} 失败`);
  if (fail) process.exitCode = 1;
  else process.exitCode = 0;
});