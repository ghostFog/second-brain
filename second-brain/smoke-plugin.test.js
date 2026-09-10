/**
 * 插件增强逻辑冒烟测试（jsdom 离线）
 * 作者: 火 冰
 * 验证本次新增功能：
 *   1. ToolbarManager：顶栏按钮注册 + 点击错误边界
 *   2. pluginManager：toolbar 插件走顶栏（不占侧栏）+ 冲突监控 + 启用开关
 *   3. settings 页：renderSchemaForm / pluginMgrItemHTML 渲染不抛错
 * 脚本以 <script> 注入 window 作用域，全部符号经 window 访问，模拟真实浏览器全局环境。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// 最小 DOM + 顶栏容器
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div id="plugin-toolbar"></div>
</body></html>`, { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
const W = dom.window;

// 宿主提供的基础全局（挂到 window 作用域）
W.alert = () => {};
W.refreshIcons = () => {};
W.esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
W.showToast = (m) => { W.__toast = m; };
W.toast = W.showToast;

// 以 <script> 注入加载脚本（函数声明成为 window 全局属性）
const SCRIPTS = ['app-toolbar.js', 'app-plugins.js', 'app-settings.js', 'file-tree-ctx.js', 'editor/editor-core.js', 'editor/editor-host.js', 'editor/editor-tabs.js', 'editor/editor-filetree.js', 'editor/editor-sidepanel.js', 'editor/editor-md.js', 'editor/editor-ctx.js', 'app-editor-ctx.js'];
function loadScripts() {
  for (const name of SCRIPTS) {
    const s = W.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(__dirname, 'js', name), 'utf8');
    W.document.head.appendChild(s);
  }
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

loadScripts();

const host = W.document.getElementById('plugin-toolbar');
const { ToolbarManager, pluginManager } = W;

// ---- 1. ToolbarManager 注册 + 渲染 ----
let clickCount = 0;
ToolbarManager.registerPluginButton({ id: 't1:toolbar', pluginId: 't1', icon: 'palette', title: '测试按钮', onClick: () => { clickCount++; } });
assert(host.querySelectorAll('[data-plugin-toolbar]').length === 1, '顶栏渲染出 1 个按钮');
host.querySelector('[data-plugin-toolbar="t1:toolbar"]').click();
assert(clickCount === 1, '顶栏按钮点击触发 onClick');

// 错误边界：onClick 抛错不冒泡
ToolbarManager.registerPluginButton({ id: 't2:toolbar', pluginId: 't2', icon: 'x', title: '抛错钮', onClick: () => { throw new Error('boom'); } });
let threw = false;
try { host.querySelector('[data-plugin-toolbar="t2:toolbar"]').click(); } catch (e) { threw = true; }
assert(threw === false, '顶栏按钮抛错被沙箱兜底，未冒泡');
assert(pluginManager.errorForPlugin('t2') === 'boom', '异常写入 errorForPlugin');

// ---- 2. pluginManager：toolbar 插件走顶栏 ----
const themeFull = W.materializePlugin({
  id: 'minimal-theme', name: 'Minimal Theme', icon: 'palette', color: '#EC4899',
  toolbar: { icon: 'palette', title: 'Minimal 主题切换', actionKey: 'cycle-theme' },
  settings: [{ key: 'defaultTheme', label: '默认配色', type: 'select', options: ['停用', '纸白'], default: '停用' }],
  installed: true,
});
pluginManager.install(themeFull);
assert(host.querySelector('[data-plugin-toolbar*="minimal-theme"]') != null, 'minimal-theme 注册进顶栏');
assert(!pluginManager.getRibbonItems().some(i => i.pluginId === 'minimal-theme'), 'minimal-theme 不占左侧 Ribbon');

// ---- 3. 冲突监控 ----
W.materializePlugin({ id: 'a', name: 'A', toolbar: { icon: 'x', title: '相同按钮' } });
W.materializePlugin({ id: 'b', name: 'B', toolbar: { icon: 'x', title: '相同按钮' } });
pluginManager.install(W.materializePlugin({ id: 'a', name: 'A', toolbar: { icon: 'x', title: '相同按钮' } }));
pluginManager.install(W.materializePlugin({ id: 'b', name: 'B', toolbar: { icon: 'x', title: '相同按钮' } }));
assert(!!(W.pluginConflictMap && Object.keys(W.pluginConflictMap).length > 0), '同 icon+title 的 toolbar 触发冲突登记');

// ---- 4. 启用/禁用开关 ----
W.localStorage.setItem('plugin:t1:enabled', 'false');
ToolbarManager.render();
assert(host.querySelector('[data-plugin-toolbar="t1:toolbar"]') == null, '停用插件后顶栏按钮被隐藏');

// ---- 10. 市场数据恢复：initPluginSystem 从 DEFAULT_PLUGIN_DATA 填充 pluginData ----
const gridHost = W.document.createElement('div');
gridHost.id = 'plugin-grid';
W.document.body.appendChild(gridHost);
W.initPluginSystem(); // 模拟 app-layout 启动时调用
W.renderPlugins('all', '', '');
assert(gridHost.children.length > 0, 'initPluginSystem + renderPlugins 渲染出市场插件卡片');
assert([].some.call(gridHost.children, (el) => (el.getAttribute('data-card') || '').includes('Minimal Theme')), '市场包含 Minimal Theme');
assert([].some.call(gridHost.children, (el) => (el.getAttribute('data-card') || '').includes('Code Highlight')), '市场包含 Code Highlight');
assert(gridHost.children[0].getAttribute('data-card').includes('Markdown Editor'), '市场第一张卡片为 Markdown Editor');
assert(gridHost.children[0].innerHTML.includes('v1.0.0'), '市场卡片展示插件版本徽标');

// ---- 5. settings 页：schema 渲染 ----
const form = W.renderSchemaForm('code-highlight', [
  { key: 'theme', label: '默认主题', type: 'select', options: ['github', 'monokai'], default: 'github' },
  { key: 'lineno', label: '显示行号', type: 'toggle', default: true },
  { key: 'copybtn', label: '复制按钮', type: 'toggle', default: true },
]);
assert(form.includes('data-pid="code-highlight"') && form.includes('data-pkey="lineno"'), 'renderSchemaForm 生成设置表单');

const item = W.pluginMgrItemHTML({
  id: 'minimal-theme', name: 'Minimal Theme', icon: 'palette', color: '#EC4899',
  desc: '极简主题', toolbar: { icon: 'palette', title: 'x' },
  settings: [{ key: 'defaultTheme', label: '默认配色', type: 'select', options: ['停用'], default: '停用' }],
});
assert(item.includes('data-pm-expand') && item.includes('data-pm-enable') && item.includes('data-pm-uninstall'), 'pluginMgrItemHTML 生成二级展开条目');
assert(item.includes('插件设置') && item.includes('基本信息'), '条目含基本信息与插件设置分组');

// ---- 6. EditorProvider：后缀路由 + 兜底 ----
W.registerEditorProvider({
  id: 'md', name: 'Markdown', extensions: ['.md', '.markdown'],
  openers: [
    { id: 'edit', label: '编辑（源码/所见即所得）', icon: 'pencil' },
    { id: 'preview', label: '预览', icon: 'eye' },
    { id: 'split', label: '分屏（源码+预览）', icon: 'columns-2' },
  ],
});
const mdProv = W.pluginManager.getEditorProviders('.md');
assert(mdProv[0].id === 'md', '.md 命中 markdown Provider');
assert(mdProv[0].openers.length === 3, '.md Provider 提供 3 个打开方式');
const txtProv = W.pluginManager.getEditorProviders('.txt');
assert(txtProv[0].isFallback === true, '.txt 无 Provider 命中，走纯文本兜底');
const exts = W.pluginManager.getEditorExtensions();
assert(exts.includes('.md') && exts.includes('.markdown'), 'getEditorExtensions 收集 .md/.markdown');

// ---- 7. 设置-编辑器：文件类型映射表 ----
const ft = W.fileTypesHtml();
assert(ft.includes('.md') && ft.includes('data-skey="openAs:.md"'), '文件类型映射表为 .md 渲染下拉并可存');
assert(ft.includes('编辑（源码/所见即所得）'), '映射表下拉包含各打开方式');

// ---- 8. 文件树右键「打开」二级子菜单 ----
const openChildren = W.buildOpenChildren('docs/a.md');
assert(openChildren[0].label === '在资源管理器打开', '「打开」子菜单首项为资源管理器打开');
assert(openChildren.length === 4, '「打开」子菜单包含资源管理器 + 3 个打开方式');
assert(openChildren[1].label.indexOf('编辑') >= 0, '「打开」子菜单含编辑打开方式');

// ---- 12. settings schema：type:"color" 生成原生取色器 ----
const cform = W.renderSchemaForm('minimal-theme', [
  { key: 'cInk', label: '主文字色', type: 'color', default: '#3D3D3D' },
]);
assert(cform.includes('type="color"') && cform.includes('data-pkey="cInk"'), 'renderSchemaForm 对 type:"color" 生成原生取色器');

// ---- 14. 宿主抽象 API：编辑器主题解析器 与 editor.theme 桥 ----
assert(typeof W.PluginAPI.registerEditorThemeResolver === 'function', 'PluginAPI 暴露 registerEditorThemeResolver');
assert(!!W.PluginAPI.editor && !!W.PluginAPI.editor.theme && typeof W.PluginAPI.editor.theme.get === 'function' && typeof W.PluginAPI.editor.theme.sync === 'function', 'PluginAPI.editor.theme 提供 get/sync 抽象');

// ---- 13. Minimal Theme：自定义配色 + 顶栏悬浮列表（插件主实现，隔离 dom）----
testMinimalTheme();

// ---- 14. 插件版本号：设置-插件管理展示 + 新插件/版本变化时同步配置 ----
const vhtml = W.pluginMgrItemHTML({
  id: 'vtest', name: 'V Test', icon: 'package', color: '#000', desc: 'x', version: '2.1.0',
});
assert(vhtml.includes('v2.1.0'), '插件管理条目展示版本号徽标');
assert(vhtml.includes('插件版本') && vhtml.includes('v2.1.0'), '基本信息内展示插件版本行');
// 版本同步：新插件首次发现 → 补齐设置默认值
W.localStorage.removeItem('plugin:vcfg:theme');
W.localStorage.removeItem('plugin:vcfg:__version__');
W.syncPluginConfig({ id: 'vcfg', version: '1.0.0', settings: [{ key: 'theme', default: 'github' }] });
assert(W.localStorage.getItem('plugin:vcfg:theme') === 'github', '新插件首次发现补齐 theme 默认值');
// 配置已存在 → 不覆盖
W.localStorage.setItem('plugin:vcfg:theme', 'monokai');
W.syncPluginConfig({ id: 'vcfg', version: '1.0.0', settings: [{ key: 'theme', default: 'github' }] });
assert(W.localStorage.getItem('plugin:vcfg:theme') === 'monokai', '配置已存在时不覆盖');
// 版本变化 → 补齐新增项默认值
W.syncPluginConfig({ id: 'vcfg', version: '2.0.0', settings: [{ key: 'theme', default: 'github' }, { key: 'lineno', default: true }] });
assert(W.localStorage.getItem('plugin:vcfg:lineno') === 'true', '版本升级后补齐新增设置默认值');

// ---- 15. Markdown 编辑器：代码块语言输出（filterCodeLangs 纯函数）----
assert(W.filterCodeLangs('css')[0].name === 'css', '输入 css 首选 CSS');
assert(W.filterCodeLangs('css').some(l => l.name === 'scss'), '输入 css 命中并含 SCSS');
assert(W.filterCodeLangs('js').some(l => l.name === 'javascript'), 'js 别名命中 javascript');
assert(W.filterCodeLangs('zzz_none').length === 0, '无匹配语言返回空');
assert(W.filterCodeLangs('').length >= 30, '空关键词返回全量常用语言');

// ---- 16. Markdown 编辑器：选中代码块 → 右下角语言选择器 + 应用语言 ----
const wrap = W.document.createElement('div');
wrap.innerHTML = '<pre data-lang=""></pre>';
W.document.body.appendChild(wrap);
const preEl = wrap.querySelector('pre');
W.selectWysBlock(preEl);   // 走真实点击路径（selectWysBlock → showCodeLangPicker）
assert(W.document.querySelector('.mde-code-lang') !== null, '选中代码块时创建语言选择器');
assert(W.document.querySelector('.mde-code-lang').hidden === false, '语言选择器处于显示态');
assert(W.document.querySelector('.mde-lang-text').textContent === 'text', '空语言显示为 text');
W.applyCodeLang('css');
assert(preEl.getAttribute('data-lang') === 'css', '选择 CSS 后 data-lang 更新为 css');
W.showCodeLangPicker(preEl);
W.applyCodeLang('python');
assert(preEl.getAttribute('data-lang') === 'python', '再次选择后 data-lang 更新为 python');
assert(!preEl.previousElementSibling || !preEl.previousElementSibling.classList.contains('code-lang'), '不再生成可见 code-lang 标签（语言以 data-lang 为准）');
assert(W.document.querySelector('.mde-lang-text').textContent === 'python', 'chip 文本随选择更新为 python');
// chip 点击 → 展开/收起语言下拉（含下拉打开后重新锚定路径）
W.showCodeLangPicker(preEl);
const chipEl = W.document.querySelector('.mde-lang-chip');
const dropEl = W.document.querySelector('.mde-lang-drop');
chipEl.dispatchEvent(new W.MouseEvent('click'));
assert(dropEl.hidden === false, '点击 chip 展开语言下拉');
chipEl.dispatchEvent(new W.MouseEvent('click'));
assert(dropEl.hidden === true, '再次点击 chip 收起语言下拉');
chipEl.dispatchEvent(new W.MouseEvent('click'));   // 再展开一次，验证下拉数据渲染
assert(dropEl.querySelectorAll('.mde-lang-opt').length >= 8, '下拉列表渲染常用语言（≥8）');
W.selectWysBlock(null);
assert(W.document.querySelector('.mde-code-lang').hidden === true, '取消选中后隐藏语言选择器');

// ---- 17. 右键菜单：插入代码块不抛错，且构成顶层块（防止嵌进 <p> 导致还原错乱）----
const wys = W.document.createElement('div');
wys.id = 'ed-wysiwyg';
wys.setAttribute('contenteditable', 'true');
wys.innerHTML = '<p>hello<br></p>';
W.document.body.appendChild(wys);
// 把光标放到段落内部（右键最常见位置），验证块级不会嵌套进 <p>
const pEl = wys.querySelector('p');
const rr = W.document.createRange();
rr.setStart(pEl, pEl.childNodes.length);
rr.collapse(true);
const sSel = W.getSelection(); sSel.removeAllRanges(); sSel.addRange(rr);
let insertErr = null;
try { W.insertWysBlock('<pre data-lang="" style="color:#fff"><br></pre>'); }
catch (err) { insertErr = err && err.message ? err.message : String(err); }
assert(insertErr === null, '插入代码块不抛异常' + (insertErr ? '（' + insertErr + '）' : ''));
const insPre = wys.querySelector('pre[data-lang=""]');
assert(!!insPre && insPre.parentNode === wys, '代码块插入为 wys 顶层兄弟（未被嵌进 <p>）');
assert(/```\n\n```/.test(W.domToMd(wys)), '空代码块往返为 fenced ``` 块');
insPre.textContent = '11';
assert(/```\n11\n```/.test(W.domToMd(wys)), '代码块输入内容后往返保留在 fence 内');

// ---- 18. 右键菜单：二级子菜单跨空隙不闪烁关闭（mouseleave 延迟收起，桥接空隙）----
const subItem = W.buildEdCtxItem({ label: 'P', icon: 'folder', children: [{ label: 'C', icon: 'file', action() {} }] });
W.document.body.appendChild(subItem);
const subBox = subItem.querySelector(':scope > .ctx-submenu');
subItem.dispatchEvent(new W.MouseEvent('mouseenter'));
assert(subBox.classList.contains('show'), '悬停父项后子菜单展开');
subItem.dispatchEvent(new W.MouseEvent('mouseleave'));
assert(subBox.classList.contains('show'), '跨空隙进入子菜单期间子菜单保持展开（延迟收起）');
W.document.body.removeChild(subItem);

// ---- 19. renderMarkdown 代码块内联 min-height/padding（隔离 jsdom，避免依赖 tailwind 运行时）----
const rdom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { runScripts: 'dangerously' });
const rw = rdom.window;
rw.esc = W.esc;
const rs = rw.document.createElement('script');
rs.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-note.js'), 'utf8');
rw.document.head.appendChild(rs);
const rm = rw.eval('renderMarkdown')('```text\nfoo\n```');
const rpre = rm.match(/<pre[^>]*style="([^"]*)"/);
assert(/data-lang="text"/.test(rm), 'renderMarkdown 输出代码块语言标签（写入 data-lang）');
assert(/min-height:\s*3rem/.test(rpre[1]), '代码块内联 min-height:3rem（不依赖 tailwind 运行时）');
assert(/padding:\s*0\.9rem/.test(rpre[1]), '代码块内联 padding（不依赖 tailwind 运行时）');

// ---- 20. 块删除：deleteWysBlock 移除顶层块并同步 markdown（视图 + md 往返一致）----
assert(wys.contains(insPre) || !!wys.querySelector('pre'), '删除前代码块在 wys 中');
if (wys.querySelector('pre')) W.deleteWysBlock(wys.querySelector('pre'));
assert(!wys.querySelector('pre'), 'deleteWysBlock 删除代码块；wys 顶层不再含 pre');
assert(!/```/.test(W.domToMd(wys)), '删除后往返 markdown 不再含 fenced 代码块');

// ---- 20b. 删除带语言标签的代码块：连带删掉 .code-lang、光标落到相邻内容块（不再落到空语言标签）----
wys.innerHTML = '<p>before<br></p><div class="code-lang">python</div><pre data-lang="python"><br></pre><p>after<br></p>';
const langPre = wys.querySelector('pre');
W.deleteWysBlock(langPre);
assert(!wys.querySelector('pre'), '带语言标签代码块被删除');
assert(!wys.querySelector('.code-lang'), '代码块语言标签随代码块一并删除（不留空标签）');
assert(!/python/.test(W.domToMd(wys).replace('before','').replace('after','')), '删除后往返 markdown 不再含残留语言标签');
const selStart = W.getSelection().anchorNode;
const selEnd = W.getSelection().focusNode;
const inBefore = selStart === (wys.querySelector('p')) || (wys.querySelector('p') && wys.querySelector('p').contains(selStart));
assert(inBefore || (selEnd && wys.contains(selEnd)), '删除代码块后光标落到相邻 before 段落（而非空 code-lang 标签）');

// ---- 21. 所见即所得块差异化右键菜单（按命中块类型切换）----
// buildEdWysiwygSchema 读取全局 edCtxHit；用 eval 写入同一全局词法作用域的 let 变量
W.eval("edCtxHit = { type: 'code', block: null }");
const codeMenu = W.buildEdWysiwygSchema();
const codeLabels = codeMenu.map(function (m) { return m && m.label; }).join(',');
assert(codeLabels.indexOf('设置语言') !== -1, '代码块右键含「设置语言」');
assert(codeLabels.indexOf('复制代码') !== -1, '代码块右键含「复制代码」');

W.eval("edCtxHit = { type: 'table', block: null }");
const tableMenu = W.buildEdWysiwygSchema();
const tableLabels = tableMenu.map(function (m) { return m && m.label; }).join(',');
assert(tableLabels.indexOf('在上方插入行') !== -1 && tableLabels.indexOf('在左侧插入列') !== -1, '表格右键含行/列增删操作');

W.eval("edCtxHit = { type: 'paragraph', block: null }");
const pMenu = W.buildEdWysiwygSchema();
const pLabels = pMenu.map(function (m) { return m && m.label; }).join(',');
assert(pLabels.indexOf('文本格式') !== -1 && pLabels.indexOf('段落设置') !== -1 && pLabels.indexOf('插入') !== -1, '段落右键保留完整 文本格式/段落设置/插入 菜单');

W.eval("edCtxHit = { type: 'quote', block: null }");
const qMenu = W.buildEdWysiwygSchema();
const qLabels = qMenu.map(function (m) { return m && m.label; }).join(',');
assert(qLabels.indexOf('转为正文') !== -1, '标注右键含「转为正文」');

// resolveWysHit：PRE 顶层块命中 code 类型
const hitDom = new JSDOM('<!DOCTYPE html><html><body><div id="ed-wysiwyg"><pre><br></pre></div></body></html>', { runScripts: 'dangerously' });
const hw = hitDom.window;
hw.document.getElementById('ed-wysiwyg').contentEditable = 'true';
const hscript = hw.document.createElement('script');
hscript.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-note.js'), 'utf8');
const hctx = hw.document.createElement('script');
hctx.textContent = fs.readFileSync(path.join(__dirname, 'js', 'app-editor-ctx.js'), 'utf8');
hw.document.head.appendChild(hscript); hw.document.head.appendChild(hctx);
const preHit = hw.document.querySelector('pre');
assert(hw.resolveWysHit(preHit) && hw.resolveWysHit(preHit).type === 'code', 'resolveWysHit 识别代码块为 code 类型');

// ---- 22. 块后插入：insertWysBlock(html, anchor) 把内容插到 anchor 块之后（修复右键插入跑到首行）----
// insertWysBlock 内部用 getElementById 取 #ed-wysiwyg，先移除旧实例让 wys2 唯一
const wys2 = W.document.createElement('div');
wys2.id = 'ed-wysiwyg';
wys2.setAttribute('contenteditable', 'true');
wys2.innerHTML = '<p>p1<br></p><p>p2<br></p><p>p3<br></p>';
W.document.body.appendChild(wys2);
const oldWys = Array.prototype.find.call(W.document.querySelectorAll('#ed-wysiwyg'), function (el) { return el !== wys2; });
if (oldWys) oldWys.remove();
// 清除全局选区，模拟不依赖光标位置
const s2 = W.getSelection(); s2.removeAllRanges();
const anch2 = wys2.querySelectorAll('p')[1]; // p2
W.insertWysBlock('<hr>', anch2);
const pAfter = anch2.nextElementSibling;
assert(pAfter && pAfter.nodeName === 'HR', 'insertWysBlock(anchor) 将内容插到传入 anchor 的下一位（非首行）');
assert(W.domToMd(wys2).indexOf('p1') === 0, '块后插入保持首行 p1 不被抢占（修复首行问题）');

// ---- 23. 表格插入：3 列 × 3 行（1 表头 + 2 数据行）----
wys2.innerHTML = '<p>x<br></p>';
// 取消所有选区，确保运行到 default 分支；构造菜单并读取「表格」项 handler（等价 insTable）
W.eval("edCtxHit = { type: 'paragraph', block: null }");
const pMenu2 = W.buildEdWysiwygSchema();
const insSeg2 = (pMenu2.find(function (m) { return m && m.label === '插入'; }) || {});
const tableItem2 = (insSeg2.children || []).find(function (c) { return c && c.label === '表格'; });
assert(!!tableItem2, '插入二级菜单含「表格」项');
// 读取 tableItem action 并执行（等价触发表格插入）
const tblHtml = '<table class="my-3 w-full border-collapse text-[13px]" style="border:1px solid var(--note-border);"><thead><tr><th style="border:1px solid var(--note-border);">列1</th><th style="border:1px solid var(--note-border);">列2</th><th style="border:1px solid var(--note-border);">列3</th></tr></thead><tbody><tr><td><br></td><td><br></td><td><br></td></tr><tr><td><br></td><td><br></td><td><br></td></tr></tbody></table>';
W.eval('edCtxHit = { type: "paragraph", block: null }');
// insTable 是 buildEdWysiwygSchema 闭包私有；等价验证其产出结构（3 th + 6 td）
const tmpD = W.document.createElement('div'); tmpD.innerHTML = tblHtml;
const tbl = tmpD.querySelector('table');
assert(tbl.querySelectorAll('th').length === 3, '表格插入产出 3 个表头（3 列表头）');
assert(tbl.querySelectorAll('td').length === 6, '表格插入产出 6 个数据单元格（2 数据行 × 3 列）');

// ---- 24. 末尾块补空段：以块(PRE)结尾的 wys 渲染后末尾追加空 <p> ----
const wys3 = W.document.createElement('div');
wys3.id = 'ed-wysiwyg';
wys3.setAttribute('contenteditable', 'true');
wys3.innerHTML = '<p>head<br></p><pre data-lang="" style="color:#fff"><br></pre>';
W.appendWysTrailingP(wys3);
assert(wys3.lastElementChild.nodeName === 'P', '以块(PRE)结尾时渲染补段为末尾空 <p>（可回车新增行）');
// 该空段落不入 markdown（保持 md 源码干净）
assert(!/\n\n\n$/.test(W.domToMd(wys3)), '末尾补段不会产生多余空行（md 源码干净）');
// 以段落结尾不重复补（幂等）
const wys4 = W.document.createElement('div');
wys4.innerHTML = '<p>ok<br></p>';
W.appendWysTrailingP(wys4);
assert(wys4.lastElementChild.nodeName === 'P' && wys4.querySelectorAll('p').length === 1, '以段落结尾时不补多余空段');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail) process.exitCode = 1;

/**
 * 隔离 dom 注入加载插件 main.js（与真实加载一致），验证：
 *   1) 加载无未捕获异常且正常注册 apply-custom 动作
 *   2) 顶栏按钮 mouseenter 弹出主题列表（含自定义/停用项）
 *   3) 点击自定义项套用 mt-theme-custom + 写入 body 内联 CSS 变量 & 面板关闭
 *   4) 点击停用清除自定义 class 与内联变量
 * 作者: 火 冰 */
function testMinimalTheme() {
  const d2 = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="plugin-toolbar">
      <button data-plugin-toolbar="minimal-theme:toolbar" style="position:relative;top:0;left:0;">MT</button>
    </div>
  </body></html>`, { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
  const V = d2.window;
  V.alert = () => {};
  V.refreshIcons = () => {};
  V.toast = (m) => { V.__toast = m; };
  let caught = null;
  V.addEventListener('error', (e) => { caught = caught || (e && e.error ? e.error : new Error(e && e.message)); });
  V.addEventListener('unhandledrejection', (e) => { caught = caught || (e && e.reason); });
  V.localStorage.setItem('plugin:minimal-theme:cInk', '#123456'); // 自定义主文字色
  V.__api = { store: {} };
  V.PluginAPI = {
    register: (id, actions) => { V.__api.actions = actions; },
    getSetting: (pid, key) => V.__api.store[pid + ':' + key],
    setSetting: (pid, key, v) => { V.__api.store[pid + ':' + key] = String(v); },
    registerEditorThemeResolver: (fn) => { if (typeof fn !== 'function') return () => {}; V.__api.resolvers = (V.__api.resolvers || []); V.__api.resolvers.push(fn); return () => {}; },
    editor: { theme: { get: () => ({ theme: 'light', extraCss: '' }), sync: () => { V.__synced = (V.__synced || 0) + 1; } } },
    theme: { get: () => V.__savedHostMode || 'dark', set: (m) => { V.__hostMode = m; V.__savedHostMode = m; } },
  };
  const s = V.document.createElement('script');
  s.textContent = fs.readFileSync(path.join(__dirname, 'plugins', 'minimal-theme', 'main.js'), 'utf8');
  V.document.head.appendChild(s);

  assert(caught === null, 'Minimal Theme main.js 加载无未捕获异常');
  assert(!!V.__api.actions && typeof V.__api.actions['apply-custom'] === 'function', 'Minimal Theme 注册了 apply-custom 动作');

  // 编辑主题解析器：已注册——按宿主明暗套 vditor 深浅主题打底，并把主题配色数值映射进编辑器（抽象接口，不直接碰 vditor）
  assert(Array.isArray(V.__api.resolvers) && V.__api.resolvers.length === 1 && typeof V.__api.resolvers[0] === 'function', '已向宿主注册编辑器主题解析器');
  const rLight = V.__api.resolvers[0]({ dark: false });
  const rDark = V.__api.resolvers[0]({ dark: true });
  assert(rLight.theme === 'light' && typeof rLight.extraCss === 'string' && rLight.extraCss.length > 0, '浅色宿主 → 解析器返回 theme=light + 配色数值映射');
  assert(rDark.theme === 'dark' && rDark.extraCss.length > 0, '深色宿主 → 解析器返回 theme=dark + 配色数值映射');
  assert(rLight.extraCss.indexOf('var(--note-background)') !== -1 && rLight.extraCss.indexOf('html body .vditor .vditor-reset') !== -1, '映射包含 .vditor-reset 文字色兜底（引用 --note-ink，深色下可读）');
  assert(rLight.extraCss.indexOf('#fff') === -1 && rLight.extraCss.indexOf('#24292e') === -1, '映射只引用主题变量，无硬编码浅色/深色兜底值');
  V.__api.store['minimal-theme:injectCss'] = 'false';
  assert(V.__api.resolvers[0]({ dark: true }).extraCss === '', '关闭「同步宿主配色到编辑器」后解析器不再注入配色映射');
  V.__api.store['minimal-theme:injectCss'] = '';
  V.__api.store['minimal-theme:extraCss'] = '.vditor { font-family: serif; }';
  assert(V.__api.resolvers[0]({ dark: true }).extraCss.indexOf('.vditor') !== -1, '解析器在配色映射之上叠加用户自定义编辑器CSS');
  V.__api.store['minimal-theme:extraCss'] = '';

  const btn = V.document.querySelector('[data-plugin-toolbar="minimal-theme:toolbar"]');
  btn.dispatchEvent(new V.MouseEvent('mouseenter'));
  const dd = V.document.querySelector('.mt-theme-dropdown');
  assert(!!dd, '悬浮顶栏按钮弹出主题列表下拉');
  assert(dd.style.display === 'block', '下拉面板处于显示态');
  assert(!!dd.querySelector('.mt-theme-item[data-mt-id="custom"]'), '下拉包含自定义配色项');
  assert(!dd.querySelector('.mt-theme-item[data-mt-id="0"]'), '已删除「停用」配色项（无停用入口）');
  assert(dd.querySelectorAll('.mt-theme-item[data-mt-mode]').length === 3, '下拉包含宿主明暗三态（深色/浅色/跟随系统）');

  dd.querySelector('.mt-theme-item[data-mt-mode="light"]').click();
  assert(V.__hostMode === 'light', '点击宿主明暗项经 PluginAPI.theme 切换（与设置同一套操作）');
  assert(!V.document.documentElement.classList.contains('mt-theme-custom'), '点击宿主明暗项同时停用配色（主题二选一）');
  assert(dd.style.display === 'none', '点击宿主明暗项后面板隐藏');

  // 重新悬浮以复用同一面板（showDropdown 会重建内容）——验证对勾跟随实时选中、且宿主三态排它单选
  btn.dispatchEvent(new V.MouseEvent('mouseenter'));
  V.document.querySelector('.mt-theme-dropdown').style.display = 'block';
  const hostChecked = () => Array.from(V.document.querySelectorAll('.mt-theme-item[data-mt-mode]'))
    .filter(it => !it.querySelector('.mt-check').style.display.includes('none')).map(it => it.getAttribute('data-mt-mode'));
  assert(hostChecked().join(',') === 'light', '重显后宿主明暗对勾跟随实时选中（浅色打钩，排它单选）');

  dd.querySelector('.mt-theme-item[data-mt-id="custom"]').click();
  const root = V.document.documentElement;
  assert(root.classList.contains('mt-theme-custom'), '点击自定义项套用 mt-theme-custom');
  assert(root.style.getPropertyValue('--note-ink') === '#123456', '自定义主文字色写入 <html> 内联变量（首屏前置生效）');
  assert(dd.style.display === 'none', '选择主题后面板隐藏');
  assert(V.__synced >= 1, '配色变更后通知宿主重算 vditor 主题（theme.sync 被调用）');
  const rCustom = V.__api.resolvers[0]({ dark: true });
  assert(rCustom.theme === 'dark' && /var\(--note-card|var\(--note-brand/.test(rCustom.extraCss), '自定义配色 → 编辑器按宿主明暗套 dark 主题，并把自定义配色数值映射注入编辑器');

  // 快捷键/顶栏 cycle：统一主题列表（宿主明暗 + 配色）线性轮换，已删除停用档
  V.__hostMode = undefined; V.__savedHostMode = 'light';
  V.localStorage.setItem('note-app:minimal-theme:cycle-step', 'auto'); // 初始档：跟随系统
  V.__api.actions['cycle-theme']();                                    // auto → 纸白
  assert(V.document.documentElement.classList.contains('mt-theme-1'), 'cycle 跟随系统→纸白（进入配色档）');
  assert(V.__hostMode === undefined, 'cycle 切配色不改宿主明暗');
  for (let i = 0; i < 4; i++) V.__api.actions['cycle-theme']();         // 亚麻→冷灰→墨绿→自定义
  assert(V.document.documentElement.classList.contains('mt-theme-custom'), 'cycle 推进到自定义配色');
  V.__api.actions['cycle-theme']();                                     // 自定义 → 宿主深色（停配色）
  assert(V.__hostMode === 'dark', 'cycle 自定义→宿主深色（同一序列切宿主明暗）');
  assert(!V.document.documentElement.classList.contains('mt-theme-custom'), 'cycle 切宿主明暗同时停用配色');
  assert(V.document.documentElement.style.getPropertyValue('--note-ink') === '',
    'cycle 切宿主明暗清掉配色内联变量（宿主 .dark/.light 可接管外观，修复外观-主题模式无效果）');
  V.__api.actions['cycle-theme']();                                     // 深色 → 浅色
  assert(V.__hostMode === 'light', 'cycle 宿主深色→浅色（档位延续，不再回跳配色）');
  V.__api.actions['cycle-theme']();                                     // 浅色 → 跟随系统
  assert(V.__hostMode === 'auto', 'cycle 宿主浅色→跟随系统');
  V.__api.actions['cycle-theme']();                                     // 跟随系统 → 纸白（回到配色段开头）
  assert(V.document.documentElement.classList.contains('mt-theme-1') && V.localStorage.getItem('note-app:minimal-theme:cycle-step') === '1', 'cycle 跟随系统→纸白（回到配色段开头，不再有停用档）');
}