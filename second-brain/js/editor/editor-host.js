/* ============================================
 * 第二脑 — 编辑器宿主·打开/保存/模式/编辑区
 * 作者: 火 冰
 * 功能: 打开笔记与模式路由、保存与字数、标题、启动初始化（initEditor）、
 *       源码/所见即所得模式骨架、查找替换、编辑区宿主
 * ============================================ */

'use strict';

  /* 渲染编辑区内容（Provider 化）：优先调用当前 Provider 的 renderWysiwyg，
   * 未实现时回退宿主默认 markdown 渲染（renderMarkdown 全局共享）。
   * @param {string} md 源文本
   * @returns {string} 渲染后的 HTML 字符串
   * 作者: 火 冰 */
  function rwRender(md) {
    if (edProvider && typeof edProvider.renderWysiwyg === 'function') return edProvider.renderWysiwyg(md);
    return renderMarkdown(md);
  }

  /* 从编辑区取回源文本（Provider 化）：优先调用当前 Provider 的 getMd，
   * 未实现时回退宿主默认 domToMd（所见即所得 DOM → Markdown）。
   * @param {Element} wys 所见即所得根元素（回退分支使用）
   * @returns {string} 源文本
   * 作者: 火 冰 */
  function rwGetMd(wys) {
    if (edProvider && typeof edProvider.getMd === 'function') return edProvider.getMd();
    return domToMd(wys);
  }

  /* 统一编辑模式常量集合：'wysiwyg' | 'ir' | 'sv' | 'preview'（阅读）
   * 记忆键 sbEditorMode，未设置默认 'ir'（即时渲染）。
   * author 火 冰 */
  function normalizeEditorMode(m) {
    return (['wysiwyg', 'ir', 'sv', 'preview'].indexOf(m) !== -1) ? m : 'ir';
  }

  /* 读取上次记忆的统一编辑模式
   * @returns {string} 'wysiwyg'|'ir'|'sv'|'preview'
   * author 火 冰 */
  function lastEditorMode() {
    const m = (typeof restoreS === 'function') ? restoreS('sbEditorMode', 'ir') : 'ir';
    return normalizeEditorMode(m);
  }

  /* 上次记忆的编辑节点（锁在 WYSIWYG / IR），供「编辑」按钮点击直接切回可编辑态
   * @returns {'wysiwyg'|'ir'}
   * author 火 冰 */
  function lastEditNode() {
    return (lastEditorMode() === 'wysiwyg') ? 'wysiwyg' : 'ir';
  }

  /* 刷新工具栏模式标签文本（随统一编辑模式）
   * author 火 冰 */
  function updateModeLabel() {
    const label = $('ed-mode-label'); if (!label) return;
    const m = lastEditorMode();
    label.textContent = ({ wysiwyg: 'WYSIWYG', ir: '即时渲染', sv: 'SV', preview: '阅读' })[m] || '编辑';
  }

  /* 应用统一编辑模式并记忆：WYSIWYG/IR=编辑节点、SV=源码分屏（上次布局）、preview=SV 纯预览
   * @param {string} mode 'wysiwyg'|'ir'|'sv'|'preview'
   * 作者: 火 冰 */
  function applyEditorMode(mode) {
    mode = normalizeEditorMode(mode);
    if (typeof saveS === 'function') saveS('sbEditorMode', mode);
    if (mode === 'sv') { applySplitLayout(lastSplitLayout()); }      // SV + 上次分屏布局
    else if (mode === 'preview') { applySplitLayout('preview'); }    // SV + 纯预览
    else { if (typeof vdSetEditorNode === 'function') vdSetEditorNode(mode); setEditorMode('edit'); }
  }

  /* 读取上次记忆的 SV 分屏布局（both/editor/preview），用于恢复分屏细分状态
   * @returns {'both'|'editor'|'preview'}
   * author 火 冰 */
  function lastSplitLayout() {
    const l = (typeof restoreS === 'function') ? restoreS('sbSplitLayout', 'both') : 'both';
    return (['both', 'editor', 'preview'].indexOf(l) !== -1) ? l : 'both';
  }

  /* 应用「分屏」某布局（三种均为 SV 基础 + preview.mode 细分）：
   *  - both    分屏（源码+预览）
   *  - editor  仅源码
   *  - preview 仅预览（预览按钮同样走此）
   * 统一由 vditor 的 SV 视图承载，只切换 preview.mode，并记忆以便跨笔记/重启恢复。
   * @param {'both'|'editor'|'preview'} layout 分屏布局
   * 作者: 火 冰 */
  function applySplitLayout(layout) {
    if (['both', 'editor', 'preview'].indexOf(layout) === -1) layout = 'both';
    if (typeof saveS === 'function') saveS('sbSplitLayout', layout);
    // 宿主态与持久化统一记忆：preview 布局即 SV 纯预览
    edMode = (layout === 'preview') ? 'preview' : 'split';
    if (typeof saveS === 'function') saveS('sbEditorMode', (layout === 'preview') ? 'preview' : 'sv');
    if (typeof vdSetPreviewMode === 'function') vdSetPreviewMode(layout);
    const label = $('ed-mode-label');
    if (label) label.textContent = ({ both: '分屏', editor: '源码', preview: '预览' })[layout] || '分屏';
    document.getElementById('ed-mode-pop') && (document.getElementById('ed-mode-pop').hidden = true);
    syncModeButtons();
  }

  /* 「分屏」按钮点击：在 both → editor → preview → both 间循环切换（均在 SV 基础内） */
  function cycleSplitLayout() {
    const order = ['both', 'editor', 'preview'];
    const cur = lastSplitLayout();
    applySplitLayout(order[(order.indexOf(cur) + 1) % 3]);
  }

  /* 编辑器宿主态快照（供 PluginAPI.editor.getState 与 md 编辑器插件读取）
   * 作者: 火 冰 */
  function getEdState() {
    return {
      current: edCurrent, mode: edMode, source: edSource, ext: edExt,
      provider: edProvider ? edProvider.id : null,
    };
  }

  /* 打开当前笔记（命令面板「打开当前笔记」调用） */
  function openCurrentNote() {
    if (edCurrent) openNote(edCurrent);
  }

  /* 打开一篇笔记：读取并装载到编辑器，按后缀路由到编辑器能力 Provider
   * @param {string} path    笔记相对路径
   * @param {Object} [opts]  可选 { mode:'wysiwyg'|'ir'|'sv'|'preview' }
   * 作者: 火 冰 */
  async function openNote(path, opts) {
    if (!path) return;
    opts = opts || {};
    edSel = null;             // 打开笔记后清除目录选中，右侧转笔记属性
    if (edOpenTabs.indexOf(path) === -1) edOpenTabs.push(path);
    edCurrent = path;
    // 后缀路由：md → markdown-editor Provider；无 Provider 匹配 → 内置纯文本兜底
    edExt = (typeof fileExtension === 'function') ? fileExtension(path) : '';
    const provs = (typeof pluginManager !== 'undefined' && pluginManager && pluginManager.getEditorProviders)
      ? pluginManager.getEditorProviders(edExt) : [];
    edProvider = provs[0] || null;
    edTextFallback = !!(edProvider && edProvider.isFallback);
    // 读取（有缓存则不重复）
    if (!(path in edOutdated)) {
      const c = await noteStore.read(path);
      edOutdated[path] = c;
    }
    // 打开方式：入参优先，否则按上次记忆的统一编辑模式（WYSIWYG/IR/SV/阅读）应用
    applyEditorMode(opts.mode || lastEditorMode());
    renderTabs();
    renderArticle();
    renderFileTree(edNotes);
    if (findOpen) runFind(); // 切换文档后重新统计匹配
    updateCrumb('editor');   // 面包屑随当前打开笔记路径刷新
    persistRecentTabs();     // 把当前打开标签页写入 .second-brain/recent.json，供下次启动恢复
    // 索引面板已展开时，随当前笔记刷新展示
    const p = $('ed-index-panel');
    if (p && !p.hidden) renderIndexPanel();
  }

  /* 把当前打开的标签页路径列表持久化到 .second-brain/recent.json（桌面版桥接）。
   * 持久化时把当前激活（最后打开/切换）的笔记移到列表末尾，启动恢复据此定位「最后打开的文件」。 */
  function persistRecentTabs() {
    const nd = window.noteDesktop || {};
    if (nd && nd.recentSave) {
      try {
        const cur = edOpenTabs.slice();
        if (edCurrent && cur.length > 1) {
          const i = cur.indexOf(edCurrent);
          if (i > -1) { cur.splice(i, 1); cur.push(edCurrent); }
        }
        nd.recentSave({ tabs: cur, pinned: Array.from(edPinned) });
      } catch (_) { /* 记录失败忽略 */ }
    }
  }

  /* 自动调整源码 textarea 高度：取「内容高」与「可视区高」的较大值，
   * 使内容不足时编辑区也撑满与行号 gutter 通栏等高（占满 #ed-split 可视区）；外层 ed-split 统一承载滚动。
   * 作者: 火 冰 */
  function autoResizeTa(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    const contentH = ta.scrollHeight || 0;
    // 参考容器：唯一滚动容器 #ed-split；其可视高即为编辑区应占满的高度
    const split = $('ed-split');
    let viewportH = 0, tTop = 0, splitTop = 0;
    if (split) {
      const r = split.getBoundingClientRect(); splitTop = r.top; viewportH = split.clientHeight;
      if (ta.getBoundingClientRect) tTop = ta.getBoundingClientRect().top;
    }
    // 剩余高度 = 可视区高 − textarea 顶缘相对滚动容器顶的偏移
    const remain = Math.max(0, viewportH - (tTop - splitTop));
    ta.style.height = Math.max(contentH, remain) + 'px';
  }

  /* 编辑区两种子视图显隐（vditor 化）：源码/所见即所得/预览均由 vditor 自管，
   * 宿主在此仅同步模式按钮的高亮状态。
   * 作者: 火 冰 */
  function applySourceMode() {
    syncModeButtons();
  }

  /* 同步工具条三个模式按钮的高亮：编辑/预览/分屏各自独立，按当前布局模式点亮；
   * 同时点亮「编辑」冒泡子菜单中当前选中的编辑节点（WYSIWYG / IR）
   * 作者: 火 冰 */
  function syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      const m = b.dataset.mode;
      const on = edMode === m;
      b.style.background = on ? 'var(--note-surface-2)' : 'transparent';
      b.style.color = on ? 'var(--note-ink)' : 'var(--note-ink-3)';
    });
    // 「编辑」按钮悬浮菜单：高亮当前使用的编辑节点（WYSIWYG / IR，菜单仅两项编辑节点）
    const node = lastEditNode();
    document.querySelectorAll('#ed-mode-pop [data-mode-item]').forEach(function (item) {
      const on = item.dataset.modeItem === node;
      item.style.background = on ? 'var(--note-surface-2)' : 'transparent';
      item.style.color = on ? 'var(--note-ink)' : 'var(--note-ink-3)';
    });
    // 「分屏」按钮悬浮菜单：高亮当前布局（both/editor/preview 三种 SV 布局）
    const layout = lastSplitLayout();
    document.querySelectorAll('#ed-split-pop [data-split-item]').forEach(function (item) {
      const on = item.dataset.splitItem === layout;
      item.style.background = on ? 'var(--note-surface-2)' : 'transparent';
      item.style.color = on ? 'var(--note-ink)' : 'var(--note-ink-3)';
    });
  }

  /* 编辑输入统一处理：更新缓存/字数/状态栏/防抖保存
   * vditor 在 input 事件把最新文本回调至此；预览联动由 vditor 自管。
   * 作者: 火 冰 */
  function onEdInput(mdText) {
    if (!edCurrent) return;
    edOutdated[edCurrent] = mdText;
    edDirty.add(edCurrent); // 内容变化记为「有未保存更改」
    const cnt = $('ed-count'); if (cnt) cnt.textContent = countChars(mdText) + ' 字';
    const saved = $('ed-saved'); if (saved) saved.textContent = '编辑中…';
    if (!restoreS('edAutoSave', true)) { if (saved) saved.textContent = '自动保存已关闭'; return; }
    if (edSaveTimer) clearTimeout(edSaveTimer);
    edSaveTimer = setTimeout(async function () {
      const p = edCurrent;
      try { await noteStore.save(p, mdText); edDirty.delete(p); const s = $('ed-saved'); if (s) s.textContent = '已自动保存'; }
      catch (err) { const s = $('ed-saved'); if (s) s.textContent = '保存失败'; }
    }, 800);
  }

  /* ============================
   * 查找 / 替换（Ctrl+F 查找，Ctrl+R 替换）
   * 作者: 火 冰
   * ============================ */

  /* 打开查找/替换条：replace=true 时显示替换行（Ctrl+R），否则仅查找（Ctrl+F）。
   * 预填当前选中的文本；打开后聚焦输入框并即时查找。
   * 作者: 火 冰 */
  function openFindbar(replace) {
    const bar = $('ed-findbar'); const fi = $('ed-find-input');
    if (!bar || !fi) return;
    findOpen = true;
    bar.hidden = false;
    bar.classList.toggle('show-replace', !!replace);
    // 预填当前选中的文本作为查找词（无选中或跨行时不预填）
    const ta = $('ed-edit');
    if (ta && !edFindQ) {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (sel && sel.indexOf('\n') === -1) fi.value = sel;
    }
    fi.focus(); fi.select();
    runFind();
  }

  /* 关闭查找/替换条，清空匹配状态并把焦点还给编辑区 */
  function closeFindbar() {
    findOpen = false;
    const bar = $('ed-findbar'); if (bar) bar.hidden = true;
    edFindMatches = []; edFindIdx = -1;
    const c = $('ed-find-count'); if (c) c.textContent = '0 / 0';
    const ta = $('ed-edit'); if (ta) ta.focus();
  }

  /* 在当前文档中收集所有匹配位置（不区分大小写），并高亮首个合适匹配 */
  function runFind() {
    const ta = $('ed-edit'); const c = $('ed-find-count');
    const q = ($('ed-find-input') || {}).value || '';
    edFindQ = q;
    edFindMatches = [];
    edFindIdx = -1;
    if (!ta || !q) { if (c) c.textContent = '0 / 0'; return; }
    const text = ta.value || '';
    const lower = text.toLowerCase(); const lq = q.toLowerCase();
    let from = 0, idx;
    while ((idx = lower.indexOf(lq, from)) !== -1) {
      edFindMatches.push({ start: idx, end: idx + q.length });
      from = idx + q.length;
    }
    // 优先定位到当前光标（或选区起点）之后的第一个匹配，无则回绕到最后一个
    if (ta.selectionStart != null) {
      const pos = ta.selectionStart;
      for (let i = 0; i < edFindMatches.length; i++) {
        if (edFindMatches[i].start >= pos) { edFindIdx = i; break; }
      }
      if (edFindIdx === -1 && edFindMatches.length) edFindIdx = edFindMatches.length - 1;
    }
    updateFindHighlight();
  }

  /* 跳转到上一个/下一个匹配（dir=1 下一个，-1 上一个，循环） */
  function findNav(dir) {
    if (!edFindMatches.length) { runFind(); return; }
    edFindIdx = (edFindIdx + dir + edFindMatches.length) % edFindMatches.length;
    updateFindHighlight();
  }

  /* 高亮当前匹配：选中 textarea 对应区间并滚动到可见，更新「当前/总数」计数 */
  function updateFindHighlight() {
    const ta = $('ed-edit'); const c = $('ed-find-count');
    if (c) c.textContent = edFindMatches.length ? (edFindIdx + 1) + ' / ' + edFindMatches.length : '0 / 0';
    if (!ta || !edFindMatches.length || edFindIdx < 0) return;
    const m = edFindMatches[edFindIdx];
    // 不抢焦点（焦点留在查找/替换输入框，保证可连续输入与回车跳转）
    ta.setSelectionRange(m.start, m.end);
    // textarea 高度已展开（无内部滚动），需手动滚动外层 ed-split 使选区可见
    const scrollEl = $('ed-split');
    if (scrollEl) {
      const lineCount = ta.value.slice(0, m.start).split('\n').length;
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const top = Math.max(0, (lineCount - 1) * lh - scrollEl.clientHeight * 0.4);
      scrollEl.scrollTop = top;
    }
  }

  /* 替换当前匹配：用替换词替换选区，再重新查找定位到下一处 */
  function doReplace() {
    const ta = $('ed-edit'); const ri = $('ed-replace-input');
    const rv = (ri && ri.value) || '';
    if (!ta || !edFindMatches.length || edFindIdx < 0) return;
    const m = edFindMatches[edFindIdx];
    ta.focus();
    ta.setSelectionRange(m.start, m.end);
    document.execCommand('insertText', false, rv); // 触发 input → onEdInput 同步
    runFind();
    if (ri) ri.focus();
  }

  /* 全部替换：整篇文档替换所有匹配（保持大小写原样），并刷新查找结果 */
  function doReplaceAll() {
    const ta = $('ed-edit'); const ri = $('ed-replace-input');
    const rv = (ri && ri.value) || '';
    if (!ta || !edFindQ) return;
    ta.focus();
    const re = new RegExp(escapeReg(edFindQ), 'gi');
    ta.value = (ta.value || '').replace(re, function () { return rv; });
    onEdInput(ta.value);
    autoResizeTa(ta);
    renderGutter();
    runFind();
    if (ri) ri.focus();
  }

  /* 渲染编辑区（vditor 化）与元信息/大纲/反链/标签 */
  function renderArticle() {
    const path = edCurrent;
    const md = edOutdated[path] || '';
    // 编辑区移交 vditor：首次打开懒创建实例，并把当前内容同步进去（预览/分屏由 vditor 自管）
    if (typeof vdSyncValue === 'function') vdSyncValue(md);
    // 标题/时间/字数组件已按 ED-44 移除：顶部不留标题条，改名统一走文件树（右键「重命名」/双击文件名）
    // 字数/保存状态仍由下方状态栏（ed-count/ed-saved）承担
    const cnt = $('ed-count'); if (cnt) cnt.textContent = countChars(md) + ' 字';
    const saved = $('ed-saved'); if (saved) saved.textContent = '已加载';
    // 大纲
    const ol = $('ed-outline');
    if (ol) {
      const o = extractOutline(md);
      if (!o.length) {
        ol.innerHTML = '<p class="text-[11px] pl-9" style="color: var(--note-ink-3);">（无标题）</p>';
      } else {
        ol.innerHTML = o.map(function (h) {
          const isH1 = h.level === 1;
          const pad = isH1 ? '36px' : (36 + (h.level - 1) * 12) + 'px';
          const color = isH1 ? 'var(--note-brand-300)' : 'var(--note-ink-2)';
          const dot = isH1 ? 'var(--note-brand-400)' : 'var(--note-ink-3)';
          return '<div class="flex items-center gap-1.5 pl-9 pr-3 py-1 cursor-pointer" style="color:' + color + '; padding-left:' + pad + ';"><span class="w-1 h-1 rounded-full shrink-0" style="background:' + dot + ';"></span><span class="text-[12px] truncate">' + esc(h.text) + '</span></div>';
        }).join('');
      }
    }
    // 标签
    const tags = extractTags(md);
    const tagBox = $('ed-tags'); if (tagBox) tagBox.innerHTML = tags.map(t => '<span class="px-2 py-1 rounded text-[12px] border" style="border-color: var(--note-border); background: var(--note-surface-2); color: var(--note-brand-300);">' + esc(t) + '</span>').join('') || '<span class="text-[11px]" style="color: var(--note-ink-3);">（暂无标签）</span>';
    const tagC = $('ed-tags-count'); if (tagC) tagC.textContent = String(tags.length);
    // 反向链接：其它笔记包含 [[当前名片段]]
    renderBacklinks();
    // 文件属性：文档 id / 路径 / 索引分块起止规则
    renderFileProps();
  }

  /* 选择编辑子节点（WYSIWYG / IR）：委托 vditor 切换并进入编辑模式。
   * @param {'wysiwyg'|'ir'} node 编辑节点类型
   * 作者: 火 冰 */
  function selectEditNode(node) {
    applyEditorMode(node === 'wysiwyg' ? 'wysiwyg' : 'ir');
    syncModeButtons();               // 高亮当前选择的模式项
  }

  /* 定位冒泡子菜单：基于触发按钮所在容器（相对定位）铺开菜单
   * @param {Element} anchor 相对定位的触发容器
   * @param {Element} pop 冒泡菜单元素
   * 作者: 火 冰 */
  function stylePopAnchor(anchor, pop) {
    pop.style.left = '0px';
    pop.style.top = (anchor.offsetHeight + 4) + 'px';
  }

  /* 切换编辑/预览/分屏模式：映射驱动 vditor 模式（编辑→编辑节点、分屏→SV、预览→纯预览）
   * 作者: 火 冰 */
  function setEditorMode(mode) {
    edMode = mode;
    const label = $('ed-mode-label');
    syncModeButtons();
    if (typeof vdSetMode === 'function') vdSetMode(mode);
    if (label) {
      if (mode === 'edit' && typeof vdGetEditorNode === 'function') {
        const n = vdGetEditorNode();
        label.textContent = n === 'wysiwyg' ? '编辑 · 所见即所得' : '编辑 · 即时渲染';
      } else {
        label.textContent = ({ preview: '预览', split: '分屏', edit: '编辑' })[mode] || mode;
      }
    }
    // 关闭编辑子节点冒泡菜单（如有打开）
    const pop = document.getElementById('ed-mode-pop'); if (pop) pop.hidden = true;
    applySourceMode();
  }

  /* bindWysCopyButton：自研所见即所得代码块悬浮复制按钮——已随 vditor 接管整体退役。
   * 保留空函数占位，避免外部遗留调用断链。作者: 火 冰 */
  function bindWysCopyButton() { return null; }

  /* 编辑器初始化：装载列表 + 默认打开第一篇 */
  async function initEditor() {
    // 先绑定目录区/侧边面板拖拽条：即使下面装载/渲染异常也保证可拖动调宽
    bindTreeResizer();
    bindSideResizer();
    let notes = [];
    try { notes = await noteStore.list(); }
    catch (err) { console.error('[noteStore.list] 失败：', err); }
    edNotes = notes.sort((a, b) => (a.path).localeCompare(b.path, 'zh'));
    renderFileTree(edNotes);
    // 绑定文件树点击 / 搜索
    const tree = $('file-tree');
    if (tree) tree.addEventListener('click', function (e) {
      const file = e.target.closest('.tree-file');
      if (file) {
        const path = file.dataset.path;
        // 双击文件名 → 就地重命名。单击 openNote 会重建文件树 DOM 使原生 dblclick 丢失，
        // 故在此用时间窗判定：<320ms 内再次点击同文件视为双击，第二击直接走重命名、不再 openNote
        const now = Date.now();
        if (edClickPath === path && now - edClickTime < 320) {
          edClickPath = null;
          renameNoteFile(path);
          return;
        }
        edClickPath = path;
        edClickTime = now;
        openNote(path);
        return;
      }
      const folder = e.target.closest('.tree-folder');
      if (folder) {
        const key = folder.dataset.folder;
        if (collapsedFolders.has(key)) collapsedFolders.delete(key); else collapsedFolders.add(key);
        edSel = { type: 'folder', path: key };   // 选中目录 → 右侧显示该目录属性
        renderFileTree(edNotes);
        renderFileProps();
        return;
      }
      // 点击目录区空白 → 显示根目录属性
      edSel = { type: 'folder', path: '' };
      renderFileProps();
    });
    // 双击重命名已改为 click 内时间窗判定（见 .tree-file 分支），避免 openNote 重建 DOM 使 dblclick 丢失
    // 搜索过滤
    const search = $('file-search');
    if (search) search.addEventListener('input', function () {
      const q = this.value.trim().toLowerCase();
      document.querySelectorAll('.tree-file').forEach(f => {
        const ok = !q || (f.dataset.name || '').toLowerCase().includes(q);
        f.style.display = ok ? '' : 'none';
      });
    });
    // 新建
    const newBtn = $('file-tree');
    document.querySelectorAll('[data-action="new-note"]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); doNewNote(); }));
    // 重建元数据（文件属性面板刷新按钮）：重建当前库全部目录的属性数据
    document.querySelectorAll('[data-action="rebuild-fileprops"]').forEach(b => b.addEventListener('click', async e => {
      e.stopPropagation();
      const nd = window.noteDesktop || {};
      if (nd && nd.refreshMeta) {
        try { await nd.refreshMeta(); showToast('已重建元数据'); } catch (err) { showToast('重建失败：' + (err && err.message || err)); }
      } else { showToast('桌面端才支持重建元数据'); }
      renderFileProps();
    }));
    // 标签区点击（放在 #editor-tabs 上，事件委托）：切换 / 关闭 / 锁定
    const tabs = $('editor-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      const actEl = e.target.closest('[data-action]');
      if (actEl) {
        const act = actEl.dataset.action;
        const p = actEl.dataset.path;
        if (act === 'close-tab') { e.stopPropagation(); closeTabs([p]); renderFileTree(edNotes); }
        else if (act === 'pin-toggle') { e.stopPropagation(); toggleTabPin(p); }
        return;
      }
      const tab = e.target.closest('.editor-tab');
      if (tab && tab.dataset.path) { openNote(tab.dataset.path); }
    });
    // Tab 溢出滚动按钮（在 #editor-tabs 之外，单独绑定）
    document.querySelectorAll('[data-action="tabs-scroll-left"]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); scrollTabs(-1); });
    });
    document.querySelectorAll('[data-action="tabs-scroll-right"]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); scrollTabs(1); });
    });
    // Tab 右键菜单
    if (tabs) tabs.addEventListener('contextmenu', function (e) {
      const tab = (e.target && e.target.closest) ? e.target.closest('.editor-tab') : null;
      if (tab && tab.dataset.path) { e.preventDefault(); e.stopPropagation(); showTabContextMenu(e.clientX, e.clientY, tab.dataset.path); }
    });
    // Tab 拖拽排序：仅允许固定区↔固定区、普通区↔普通区内部重排（锁定状态一致才落点）
    if (tabs) {
      tabs.addEventListener('scroll', function () { updateTabScroll(); });
      const clearDragHint = function () {
        tabs.querySelectorAll('.editor-tab').forEach(function (el) { el.style.opacity = ''; el.style.boxShadow = ''; });
      };
      tabs.addEventListener('dragstart', function (e) {
        const tab = (e.target && e.target.closest) ? e.target.closest('.editor-tab') : null;
        if (!tab || !tab.dataset.path) return;
        edDragFrom = tab.dataset.path; edDragTarget = null;
        tab.style.opacity = '0.35';
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      tabs.addEventListener('dragover', function (e) {
        if (!edDragFrom) return;
        e.preventDefault();
        const tab = (e.target && e.target.closest) ? e.target.closest('.editor-tab') : null;
        const target = (tab && tab.dataset.path) || null;
        const ok = target && edPinned.has(edDragFrom) === edPinned.has(target)
          && edOpenTabs.indexOf(edDragFrom) !== edOpenTabs.indexOf(target);
        if (edDragTarget) {
          const old = tabs.querySelector('.editor-tab[data-path="' + CSS.escape(edDragTarget) + '"]');
          if (old) old.style.boxShadow = '';
        }
        edDragTarget = ok ? target : null;
        if (edDragTarget) {
          const tEl = tabs.querySelector('.editor-tab[data-path="' + CSS.escape(edDragTarget) + '"]');
          if (tEl) tEl.style.boxShadow = 'inset 0 -2px 0 var(--note-brand-400)';
        }
        if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'move' : 'none';
      });
      tabs.addEventListener('drop', function (e) {
        e.preventDefault();
        const from = edDragFrom, target = edDragTarget;
        edDragFrom = null; edDragTarget = null; clearDragHint();
        if (from && target && from !== target) reorderTab(from, target);
        else renderTabs();
      });
      tabs.addEventListener('dragend', function () {
        edDragFrom = null; edDragTarget = null; clearDragHint(); renderTabs();
      });
    }
    // 标题区取消双击改名（改名统一走文件树右键「重命名」/双击文件名，见 renameNoteFile）
    // 编辑区由 vditor 引擎接管：自研 textarea/WYSIWYG/查找条绑定已随 vditor 迁移整体退役，
    // 首次懒创建 vditor 实例（真正渲染见 renderArticle → vdSyncValue / vdInit）。
    vdInit();

    // 编辑/预览/分屏 三个模式按钮：绑定 vditor 能力（编辑=冒泡子菜单选 WYSIWYG/IR 或即时渲染，预览=纯预览，分屏=SV 源码分屏）
    const editWrap = document.querySelector('#ed-mode-edit-wrap');
    const modePop = document.getElementById('ed-mode-pop');
    const editBtn = document.getElementById('ed-mode-edit');
    // 悬浮编辑按钮 / 菜单：鼠标移入按钮区显示模式菜单，移出按钮与菜单后延迟隐藏（悬浮选择模式）
    if (editWrap && modePop) {
      let popTimer = null;
      const showModePop = function () {
        clearTimeout(popTimer);
        modePop.hidden = false;
        stylePopAnchor(editWrap, modePop);
        if (typeof refreshIcons === 'function') refreshIcons();
      };
      const hideModePop = function () {
        clearTimeout(popTimer);
        popTimer = setTimeout(function () { modePop.hidden = true; }, 150);
      };
      editWrap.addEventListener('mouseenter', showModePop);
      editWrap.addEventListener('mouseleave', hideModePop);
      // 点页面其它处也收起冒泡菜单（编辑 + 分屏两个悬浮菜单）
      document.addEventListener('click', function () {
        const mp = document.getElementById('ed-mode-pop'); if (mp) mp.hidden = true;
        const sp = document.getElementById('ed-split-pop'); if (sp) sp.hidden = true;
      });
    }
    // 编辑按钮点击：不弹菜单，直接切回上次记忆的编辑节点（WYSIWYG/IR，可编辑态）
    if (editBtn) editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      selectEditNode(lastEditNode());
      if (modePop) modePop.hidden = true;
    });
    // 冒泡子菜单选项：所见即所得 / 即时渲染 / SV 源码分屏 / 阅读，选择后应用统一模式并记忆
    if (modePop) modePop.querySelectorAll('[data-mode-item]').forEach(item => {
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        applyEditorMode(this.dataset.modeItem);
        if (modePop) modePop.hidden = true;
      });
    });
    // 预览按钮：进入「SV 模式的纯预览」（阅读），整幅渲染文档。
    document.querySelectorAll('[data-mode="preview"]').forEach(btn => {
      btn.addEventListener('click', function () {
        applyEditorMode('preview');
      });
    });
    // 分屏按钮：点击在 分屏(both)→仅源码(editor)→仅预览(preview) 间循环切换（均在 SV 基础内）；
    // 悬浮显示布局菜单，可在 分屏(both)/编辑(editor)/预览(preview) 三种布局间直接选择。
    const splitWrap = document.getElementById('ed-split-wrap');
    const splitPop = document.getElementById('ed-split-pop');
    if (splitWrap && splitPop) {
      let splitTimer = null;
      const showSplitPop = function () {
        clearTimeout(splitTimer);
        splitPop.hidden = false;
        stylePopAnchor(splitWrap, splitPop);
        if (typeof refreshIcons === 'function') refreshIcons();
      };
      const hideSplitPop = function () {
        clearTimeout(splitTimer);
        splitTimer = setTimeout(function () { splitPop.hidden = true; }, 150);
      };
      splitWrap.addEventListener('mouseenter', showSplitPop);
      splitWrap.addEventListener('mouseleave', hideSplitPop);
      // 悬浮菜单项：both / editor / preview，点击应用对应 SV 布局并收起菜单
      splitPop.querySelectorAll('[data-split-item]').forEach(item => {
        item.addEventListener('click', function (e) {
          e.stopPropagation();
          applySplitLayout(this.dataset.splitItem);
          splitPop.hidden = true;
        });
      });
    }
    document.querySelectorAll('#ed-split-wrap [data-mode="split"]').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        cycleSplitLayout();
        if (splitPop) splitPop.hidden = true;
      });
    });
    // 删除当前笔记
    document.querySelectorAll('[data-action="delete-note"]').forEach(b => {
      b.addEventListener('click', async function () {
        if (!edCurrent) return;
        if (!confirm('确定删除笔记「' + edCurrent.split('/').pop() + '」吗？')) return;
        await noteStore.remove(edCurrent);
        edNotes = edNotes.filter(n => n.path !== edCurrent);
        edOpenTabs = edOpenTabs.filter(p => p !== edCurrent);
        delete edOutdated[edCurrent];
        edPinned.delete(edCurrent); edDirty.delete(edCurrent);
        edCurrent = edOpenTabs[edOpenTabs.length - 1] || null;
        renderFileTree(edNotes);
        renderTabs();
        persistRecentTabs(); // 删除笔记后同步最近打开记录
        if (edCurrent) renderArticle(); else if (typeof vdSetValue === 'function') vdSetValue('');
      });
    });
    // 查看当前笔记索引：工具栏按钮展开/收起编辑区内联面板（只展示当前打开笔记的分块）
    document.querySelectorAll('[data-action="view-index"], [data-action="index-toggle"]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); toggleIndexPanel(); });
    });
    // 反链点击：跳转到 [[内链]] 指向的笔记
    const back = $('ed-backlinks');
    if (back) back.addEventListener('click', function (e) { const t = e.target.closest('[data-open]'); if (t) openNote(t.dataset.open); });
    // 预览内链点击已由 vditor 原生预览承接（原 #ed-preview 绑定随自研渲染退役删除）

    // 启动恢复：优先读取 .second-brain/recent.json 中上次打开的笔记（多个标签）；
    // 其次图谱跳转目标；都无则打开第一篇。均已打开则保持不变。
    if (!edCurrent) {
      const nd = window.noteDesktop || {};
      const gp = window.__openGraphPath;
      let tabs = [], pinned = [];
      if (nd && nd.recentLoad) {
        try {
          const r = (await nd.recentLoad()) || null;
          if (Array.isArray(r)) tabs = r;                                    // 旧格式：纯路径数组
          else if (r && Array.isArray(r.tabs)) { tabs = r.tabs; pinned = Array.isArray(r.pinned) ? r.pinned : []; }
        } catch (_) { tabs = []; }
      }
      if (gp && edNotes.some(n => n.path === gp)) {
        await openNote(gp);
        window.__openGraphPath = null;
      } else if (tabs.length) {
        const valid = tabs.filter(p => edNotes.some(n => n.path === p)); // 过滤已被删除/不再存在的笔记
        if (valid.length) {
          // 展示全部最近标签，但仅激活「最后打开」的用 openNote（走记忆模式 + 加载正文），其余标签懒加载（点击时才读），避免启动逐个装载闪烁
          valid.forEach(function (p) { if (edOpenTabs.indexOf(p) === -1) edOpenTabs.push(p); });
          // 恢复锁定状态：仅恢复仍存在于当前打开标签中的项
          pinned.forEach(function (p) { if (valid.indexOf(p) !== -1) edPinned.add(p); });
          // 统一用 openNote 打开最后打开的文件：应用上次记忆模式 + 加载正文内容
          //（替代原先手写 edCurrent/renderArticle 的恢复分支，修复启动后编辑器空白的问题）
          await openNote(valid[valid.length - 1]);
        } else if (edNotes.length) {
          await openNote(edNotes[0].path);
        }
      } else if (edNotes.length) {
        await openNote(edNotes[0].path);
      }
    }
    // 应用已保存的编辑区设置：自动换行 / 界面密度 / 减少动画
    setEditorWrap(restoreS('wrap', true));
    applyDensity(restoreS('density', '标准'));
    applyReduceMotion(restoreS('reduceMotion', false));
    // 行号开关：恢复持久化设置并绑定工具栏按钮（点击切换，与设置「显示行号」联动）
    edLineNum = !!restoreS('lineNumbers', true);
    document.querySelectorAll('[data-action="toggle-line-numbers"]').forEach(b => {
      b.addEventListener('click', function () { setLineNumbers(!edLineNum); });
    });
    updateGutter();
    // 窗口尺寸变化时，编辑区 textarea 的位置/换行会随布局改变，需刷新行号 gutter 与当前行高亮，
    // 否则行号列（绝对定位）仍按旧坐标计算导致序号错位。仅绑定一次，避免多次切回重复注册。
    if (!window.__sbEdResizeBound) {
      window.__sbEdResizeBound = 1;
      window.addEventListener('resize', function () {
        if (activeView !== 'editor') return;              // 仅在编辑器可见时刷新，节省开销
        window.requestAnimationFrame(function () { renderGutter(); });
      });
    }
    // 自动换行：绑定工具栏按钮（点击切换持久化，默认值来自设置「自动换行」）
    document.querySelectorAll('[data-action="toggle-wrap"]').forEach(b => {
      b.addEventListener('click', function () { setEditorWrap(!restoreS('wrap', true)); });
    });
    // 全屏：宿主自接管（见 editor-vditor.js vdToggleFullscreen），Esc / 浮动按钮可还原
    document.querySelectorAll('[data-action="fullscreen"]').forEach(b => {
      b.addEventListener('click', function () { if (typeof vdToggleFullscreen === 'function') vdToggleFullscreen(); });
    });
    // 命令面板「新建笔记」入口
    document.addEventListener('note:new', doNewNote);
    // 侧边面板折叠
    bindCollapse();
    // 文件树：右键菜单 + 拖拽移动
    bindFileTreeContextMenu && bindFileTreeContextMenu();
    bindFileTreeDrag();
    // 应用统一编辑模式（WYSIWYG/IR/SV/阅读），按上次记忆恢复（键 sbEditorMode，未设置默认「即时渲染」）
    applyEditorMode(lastEditorMode());
    // 切到其它视图再切回编辑器时，loadView 会重建整个视图 DOM，需把「已打开的标签 + 当前笔记」
    // 重新渲染/装载，避免 tab 栏与编辑区空白（恢复分支仅覆盖首次启动 edCurrent 为空的情况）。
    if (edCurrent) {
      if (!(edCurrent in edOutdated)) { const c = await noteStore.read(edCurrent); edOutdated[edCurrent] = c; }
      renderTabs();
      renderArticle();
      renderFileTree(edNotes);
      const idxPanel2 = $('ed-index-panel');
      if (idxPanel2 && !idxPanel2.hidden) renderIndexPanel();
    }
  }