/* ============================================
 * 第二脑 — 编辑器核心
 * 作者: 火 冰
 * 功能: 文件树、标签页、笔记渲染、源模式/查找替换、新建笔记/文件夹与编辑器初始化
 * ============================================ */

'use strict';

  /* ============================
   * 编辑器视图交互（真实数据驱动）
   * ============================ */

  let edNotes = [];          // 当前笔记库列表
  let edCurrent = null;      // 当前打开笔记的相对路径
  let edOutdated = {};       // 已加载内容缓存 path->text，未保存标记
  let edOpenTabs = [];       // 打开中的标签 path 列表
  let collapsedFolders = new Set(); // 已折叠的文件夹键集合
  let edMode = 'edit';        // edit | preview | split（默认编辑；可被设置「默认编辑模式」覆盖）
  let edSource = false;       // 源码模式开关：true=编辑区显示源码 textarea；false=所见即所得（渲染可编辑）
  let edSaveTimer = null;
  let edLineNum = true;       // 行号显示开关（initEditor 时从设置恢复）
  let findOpen = false;       // 查找/替换条是否打开
  let edFindQ = '';           // 当前查找关键词
  let edFindMatches = [];     // 匹配位置 [{start,end}]
  let edFindIdx = -1;         // 当前匹配索引（0 起）

  const $ = (id) => document.getElementById(id);

  /* 统计字数（去空白） */
  function countChars(text) { return String(text || '').replace(/\s/g, '').length; }

  /* 从 markdown 提取标签 */
  function extractTags(md) {
    const tags = [];
    (String(md || '').match(/#[\u4e00-\u9fa5A-Za-z0-9_-]+/g) || []).forEach(t => {
      if (t.length > 1 && tags.indexOf(t) === -1) tags.push(t);
    });
    return tags;
  }

  /* 从 markdown 提取标题（大纲） */
  function extractOutline(md) {
    const out = [];
    (String(md || '').match(/^#{1,3}\s+.*$/gm) || []).forEach(line => {
      const m = line.match(/^(#{1,3})\s+(.*)$/);
      out.push({ level: m[1].length, text: m[2] });
    });
    return out;
  }

  /* 将相对日期格式化 */
  function relDate(mtime) {
    const d = new Date(mtime);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((start - t) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    return days + '天前';
  }

  /* 渲染文件树 */
  function renderFileTree(notes) {
    const tree = $('file-tree'); if (!tree) return;
    // 默认隐藏以 . 开头的目录/文件（如 .obsidian），可在文件树空白区右键菜单切换显示（作者: 火 冰）
    if (!restoreS('showHidden', false)) {
      notes = notes.filter(n => !n.path.split('/').some(seg => seg.startsWith('.')));
    }
    const folders = new Map();
    notes.forEach(n => {
      const parts = n.folder ? n.folder.split('/') : [];
      let key = '';
      parts.forEach((p, i) => {
        const parentKey = key;
        key = key ? key + '/' + p : p;
        if (!folders.has(key)) folders.set(key, { label: p, parent: parentKey, children: [] });
      });
    });
    const filesByFolder = new Map();
    notes.forEach(n => { if (!filesByFolder.has(n.folder)) filesByFolder.set(n.folder, []); filesByFolder.get(n.folder).push(n); });

    // 建立嵌套
    let html = '';
    const folderNodes = new Map();
    folders.forEach((f, key) => {
      const depth = key.split('/').length;
      f.depth = depth;
      folderNodes.set(key, f);
    });
    // 深度优先输出，根层级排序
    const rootFolders = [];
    folderNodes.forEach((f, key) => { if (!f.parent) rootFolders.push({ key, f }); });
    rootFolders.sort((a, b) => a.f.label.localeCompare(b.f.label, 'zh'));

    const renderFolder = (fNode, key) => {
      const isCollapsed = collapsedFolders.has(key);
      html += '<div class="tree-folder flex items-center gap-1 px-2 py-1 cursor-pointer hover:opacity-80" draggable="true" data-type="folder" data-folder="' + esc(key) + '" title="' + esc(key) + '" style="' + (fNode.depth > 1 ? 'padding-left:' + (8 + (fNode.depth - 1) * 24) + 'px;' : '') + 'color: var(--note-ink);">'
        + '<i data-lucide="' + (isCollapsed ? 'chevron-right' : 'chevron-down') + '" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-ink-3);"></i>'
        + '<i data-lucide="folder-open" class="w-4 h-4 shrink-0" style="color: var(--note-brand-400);"></i>'
        + '<span class="truncate font-medium">' + esc(fNode.label) + '</span>'
        + '<span class="ml-auto text-[10px] nums" style="color: var(--note-ink-3);">' + (filesByFolder.get(key) || []).length + '</span>'
        + '</div>';
      if (isCollapsed) return;
      // 子文件夹
      const children = [];
      folderNodes.forEach((cf, ckey) => { if (cf.parent === key) children.push({ key: ckey, f: cf }); });
      children.sort((a, b) => a.f.label.localeCompare(b.f.label, 'zh'));
      children.forEach(c => renderFolder(c.f, c.key));
      // 文件（跳过纯目录项）
      (filesByFolder.get(key) || []).forEach(n => {
        if (n.isFolder) return;
        const active = n.path === edCurrent;
        html += '<div class="tree-file flex items-center gap-1.5 pr-2 py-1 cursor-pointer" draggable="true" data-type="note" data-path="' + esc(n.path) + '" data-name="' + esc(n.name) + '" title="' + esc(n.path) + '" style="' + (fNode.depth ? 'padding-left:' + (24 + fNode.depth * 24) + 'px;' : 'padding-left:24px;') + (active ? 'background: var(--note-brand-600); color: #FFFFFF;' : 'color: var(--note-ink-2);') + '">'
          + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: ' + (active ? '#FFFFFF' : 'var(--note-ink-3)') + ';"></i>'
          + '<span class="flex-1 truncate">' + esc(n.name) + '</span>'
          + '<span class="text-[10px] shrink-0" style="color: ' + (active ? 'rgba(255,255,255,0.7)' : 'var(--note-ink-3)') + ';">' + relDate(n.mtime) + '</span>'
          + '</div>';
      });
    };
    rootFolders.forEach(r => renderFolder(r.f, r.key));
    // 顶层文件（folder 为空；跳过纯目录项）
    (filesByFolder.get('') || []).forEach(n => {
      if (n.isFolder) return;
      const active = n.path === edCurrent;
      html += '<div class="tree-file flex items-center gap-1.5 pl-6 pr-2 py-1 cursor-pointer" draggable="true" data-type="note" data-path="' + esc(n.path) + '" data-name="' + esc(n.name) + '" title="' + esc(n.path) + '" style="' + (active ? 'background: var(--note-brand-600); color: #FFFFFF;' : 'color: var(--note-ink-2);') + '">'
        + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: ' + (active ? '#FFFFFF' : 'var(--note-ink-3)') + ';"></i>'
        + '<span class="flex-1 truncate">' + esc(n.name) + '</span>'
        + '<span class="text-[10px] shrink-0" style="color: ' + (active ? 'rgba(255,255,255,0.7)' : 'var(--note-ink-3)') + ';">' + relDate(n.mtime) + '</span>'
        + '</div>';
    });
    tree.innerHTML = html;
    refreshIcons();
    // 库统计
    const stat = $('vault-stat'); if (stat) stat.textContent = '共 ' + notes.length + ' 篇笔记' + (noteStore.isMock() ? ' · 网页演示' : '');
    const sizeEl = $('vault-size');
    if (sizeEl) { const kb = notes.reduce((s, n) => s + (n.size || 0), 0) / 1024; sizeEl.textContent = (kb < 1024 ? kb.toFixed(1) : (kb / 1024).toFixed(1)) + (kb < 1024 ? ' KB' : ' MB'); }
  }

  /* 打开一篇笔记：读取并装载到编辑器 */
  async function openNote(path) {
    if (!path) return;
    if (edOpenTabs.indexOf(path) === -1) edOpenTabs.push(path);
    edCurrent = path;
    // 读取（有缓存则不重复）
    if (!(path in edOutdated)) {
      const c = await noteStore.read(path);
      edOutdated[path] = c;
    }
    renderTabs();
    renderArticle();
    renderFileTree(edNotes);
    if (findOpen) runFind(); // 切换文档后重新统计匹配
    updateCrumb('editor');   // 面包屑随当前打开笔记路径刷新
    // 索引面板已展开时，随当前笔记刷新展示
    const p = $('ed-index-panel');
    if (p && !p.hidden) renderIndexPanel();
  }

  /* 渲染标签栏 */
  function renderTabs() {
    const box = $('editor-tabs'); if (!box) return;
    let html = edOpenTabs.map(p => {
      const name = p.split('/').pop();
      const active = p === edCurrent;
      return '<div class="editor-tab h-full flex items-center gap-2 px-3 border-r cursor-pointer" data-path="' + esc(p) + '" title="' + esc(p) + '" style="border-color: var(--note-border); background: ' + (active ? 'var(--note-background)' : 'transparent') + '; color: ' + (active ? 'var(--note-ink)' : 'var(--note-ink-3)') + ';">'
        + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-brand-400);"></i>'
        + '<span class="text-[13px] whitespace-nowrap">' + esc(name) + '</span>'
        + '<i data-lucide="x" data-action="close-tab" class="w-3 h-3 shrink-0" style="opacity: 0.5; cursor: pointer;" data-path="' + esc(p) + '"></i>'
        + '</div>';
    }).join('');
    box.innerHTML = html;
    refreshIcons();
  }

  /* 所见即所得编辑区的行内节点逆转换：把渲染后的内联 DOM 转回 Markdown 行内语法
   * 支持：加粗/**、行内代码、[[内链]]、[链接](url)、斜体*
   * 作者: 火 冰 */
  function inlineToMd(el) {
    let md = '';
    el.childNodes.forEach(function (node) {
      if (node.nodeType === 3) { md += node.nodeValue; return; }  // 文本节点原样
      if (node.nodeType !== 1) return;
      const t = node.nodeName.toLowerCase();
      const inner = inlineToMd(node);
      if (t === 'strong' || t === 'b') { if (inner) md += '**' + inner + '**'; }
      else if (t === 'em' || t === 'i') { if (inner) md += '*' + inner + '*'; }
      else if (t === 'code') { md += '`' + inner + '`'; }
      else if (t === 'a') {
        const href = node.getAttribute && node.getAttribute('href');
        const wiki = node.dataset && node.dataset.wikilink;
        if (wiki) md += '[[' + inner + ']]';
        else if (href && href !== '#') md += '[' + inner + '](' + href + ')';
        else md += inner;
      }
      else if (t === 'input') { md += node.checked ? '[x]' : '[ ]'; }
      else if (t === 'br') { md += '\n'; }
      else { md += inner; }
    });
    return md;
  }

  /* 所见即所得编辑区 → Markdown：遍历渲染后的整块 DOM，还原为 Markdown 源文本
   * 与 renderMarkdown 输出的结构一一对应，保证来回转换一致
   * 作者: 火 冰 */
  function domToMd(root) {
    const lines = [];
    (root.childNodes || []).forEach(function (node) {
      if (node.nodeType === 3) { const t = node.nodeValue; if (t && t.trim()) lines.push(t); else lines.push(''); return; }
      if (node.nodeType !== 1) return;
      const tg = node.nodeName.toLowerCase();
      if (/^h[1-3]$/.test(tg)) { lines.push('#'.repeat(+tg[1]) + ' ' + inlineToMd(node)); return; }
      if (tg === 'pre') { lines.push('```'); lines.push((node.textContent || '').replace(/\n$/, '')); lines.push('```'); return; }
      if (tg === 'blockquote') {
        const inner = node.querySelector('p, div, span');
        lines.push('> ' + (inner ? inlineToMd(inner) : inlineToMd(node)));
        return;
      }
      if (tg === 'li' || /div|p|span/.test(tg)) {
        // 待办：lucide 的 square/check-square 图标 + 文本
        const icon = node.querySelector && node.querySelector('i[data-lucide="square"], i[data-lucide="check-square"]');
        if (icon) {
          const done = icon.dataset && icon.dataset.lucide === 'check-square';
          const body = node.querySelector('span');
          lines.push('- [' + (done ? 'x' : ' ') + '] ' + ((body && body !== icon) ? inlineToMd(body) : inlineToMd(node)));
          return;
        }
        // 无序 / 有序列表：圆点 span 或 “•” 文本 + 内容 span
        const dot = node.querySelector && node.querySelector('span.w-1');
        if (dot) {
          const body = node.querySelector('span:not(.w-1):not(.text-caption)') || node;
          lines.push('- ' + inlineToMd(body));
          return;
        }
        const marker = node.textContent && node.textContent.trim().charAt(0) === '•';
        if (marker) {
          const body = node.querySelector('span:not(.text-caption)') || node;
          lines.push('1. ' + inlineToMd(body));  // 有序列表序号因渲染丢失，用 1. 兜底
          return;
        }
        lines.push(inlineToMd(node));
        return;
      }
      if (tg === 'hr') { lines.push('---'); return; }
      lines.push(inlineToMd(node));
    });
    // 合并尾随空行，还原原始换行（每段一行）
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const raw = lines.join('\n');
    return raw.replace(/\n{3,}/g, '\n\n');
  }

  /* textarea 高度自适应，让外层 ed-split 统一承载滚动
   * 作者: 火 冰 */
  function autoResizeTa(ta) {
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight ? ta.scrollHeight + 'px' : 'auto');
  }

  /* 编辑区两种子视图显隐：edSource=true 显示源码 textarea，false 显示所见即所得
   * 作者: 火 冰 */
  function applySourceMode() {
    const ta = $('ed-edit'); const wys = $('ed-wysiwyg'); if (!ta || !wys) return;
    ta.hidden = !edSource;   // 源码模式显示 textarea
    wys.hidden = edSource;   // 非源码显示所见即所得
    autoResizeTa(ta);
    syncModeButtons();
    updateGutter();          // 行号 gutter 仅源码模式显示
    updateCurrentLine();     // 当前行高亮：仅源码模式可见，切模式时刷新显隐/位置
  }

  /* 同步工具条三个模式按钮的高亮：
   * 编辑按钮=源码开关（源码模式时高亮）；预览/分屏=当前布局
   * 作者: 火 冰 */
  function syncModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(function (b) {
      const m = b.dataset.mode;
      let on;
      if (m === 'edit') on = edSource;
      else if (m === 'preview') on = edMode === 'preview';
      else if (m === 'split') on = edMode === 'split';
      else on = edMode === m;
      b.style.background = on ? 'var(--note-surface-2)' : 'transparent';
      b.style.color = on ? 'var(--note-ink)' : 'var(--note-ink-3)';
    });
  }

  /* 编辑按钮：切换源码模式（所见即所得 <-> 源码）
   * 从预览切回时先进入编辑布局；进入所见即所得时按当前内容重渲染
   * 作者: 火 冰 */
  function toggleSource() {
    if (edMode === 'preview') setEditorMode('edit');
    edSource = !edSource;
    const md = edOutdated[edCurrent] || '';
    if (edSource) {
      // 进入源码：把最新缓存同步回 textarea
      const ta = $('ed-edit'); if (ta) ta.value = md;
    } else {
      // 进入所见即所得：按当前内容重渲染
      const wys = $('ed-wysiwyg');
      if (wys) { wys.innerHTML = renderMarkdown(md); refreshIcons(); }
    }
    applySourceMode();
  }

  /* 编辑输入统一处理：更新缓存/字数/状态栏/实时预览/防抖保存
   * textarea 与所见即所得共用；输入内容变化即刷新预览（分屏同步）
   * 作者: 火 冰 */
  function onEdInput(mdText) {
    if (!edCurrent) return;
    edOutdated[edCurrent] = mdText;
    const cnt = $('ed-count'); if (cnt) cnt.textContent = countChars(mdText) + ' 字';
    const saved = $('ed-saved'); if (saved) saved.textContent = '编辑中…';
    // 分屏 / 预览布局下实时同步预览
    if (edMode !== 'edit') {
      const pv = $('ed-preview');
      if (pv) { pv.innerHTML = renderMarkdown(mdText); refreshIcons(); }
    }
    renderGutter();          // 内容行数变化 → 刷新行号 gutter
    if (findOpen) runFind(); // 查找条打开时，让匹配与当前内容保持同步
    if (!restoreS('edAutoSave', true)) { if (saved) saved.textContent = '自动保存已关闭'; return; }
    if (edSaveTimer) clearTimeout(edSaveTimer);
    edSaveTimer = setTimeout(async function () {
      try { await noteStore.save(edCurrent, mdText); const s = $('ed-saved'); if (s) s.textContent = '已自动保存'; }
      catch (err) { const s = $('ed-saved'); if (s) s.textContent = '保存失败'; }
    }, 800);
  }

  /* ============================
   * 查找 / 替换（Ctrl+F 查找，Ctrl+R 替换）
   * 作者: 火 冰
   * ============================ */

  /* 正则转义：把用户输入的原样当作字面文本搜索 */
  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

  /* 渲染编辑区（根据模式）与元信息/大纲/反链/标签 */
  function renderArticle() {
    const path = edCurrent;
    const md = edOutdated[path] || '';
    const textarea = $('ed-edit'); if (!textarea) return;
    const preview = $('ed-preview');
    // 仅在首次或内容变更时同步
    textarea.value = md;
    // 所见即所得编辑区同步渲染（源码/预览共用同一渲染结果）
    const wys = $('ed-wysiwyg');
    if (wys) { wys.innerHTML = renderMarkdown(md); refreshIcons(); }
    // 应用当前源码模式（决定 textarea/wysiwyg 谁可见）
    applySourceMode();
    // 元信息
    const meta = $('editor-meta');
    if (meta) {
      const n = edNotes.find(x => x.path === path);
      const date = n ? new Date(n.mtime).toLocaleDateString('zh-CN') : '';
      const t = n ? relDate(n.mtime) : '';
      meta.innerHTML = '<div class="flex items-center gap-1"><i data-lucide="calendar" class="w-3 h-3"></i><span>' + esc(date || '未知') + '</span></div>'
        + '<div class="flex items-center gap-1"><i data-lucide="clock" class="w-3 h-3"></i><span>最后编辑：' + esc(t) + '</span></div>'
        + '<div class="flex items-center gap-1"><i data-lucide="hash" class="w-3 h-3"></i><span>' + countChars(md) + ' 字</span></div>';
    }
    // 字数 / 保存状态
    const cnt = $('ed-count'); if (cnt) cnt.textContent = countChars(md) + ' 字';
    const saved = $('ed-saved'); if (saved) saved.textContent = '已加载';
    // 预览渲染
    if (preview) { preview.innerHTML = renderMarkdown(md); refreshIcons(); }
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
  }

  /* 渲染反向链接 */
  function renderBacklinks() {
    const box = $('ed-backlinks'); if (!box) return;
    if (!edCurrent) { box.innerHTML = ''; const c = $('ed-backlink-count'); if (c) c.textContent = '0'; return; }
    const currentName = edCurrent.split('/').pop().replace(/\.md$/, '');
    const refs = [];
    Object.keys(edOutdated).forEach(p => {
      if (p === edCurrent) return;
      const c = edOutdated[p] || '';
      const re = new RegExp('\\[\\[' + currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\.[a-z0-9]+)?\\]\\]|\\[\\[' + currentName, 'i');
      if (re.test(c)) refs.push({ path: p, name: p.split('/').pop() });
    });
    const c = $('ed-backlink-count'); if (c) c.textContent = String(refs.length);
    if (!refs.length) { box.innerHTML = '<p class="text-[11px] pl-3" style="color: var(--note-ink-3);">（无反向链接）</p>'; return; }
    box.innerHTML = refs.map(r => '<div class="mx-3 p-2.5 rounded-md border cursor-pointer transition-colors hover:opacity-90" data-open="' + esc(r.path) + '" style="border-color: var(--note-border); background: var(--note-surface-2);">'
      + '<div class="flex items-center gap-1.5 mb-1.5"><i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-brand-400);"></i><span class="text-[12px] font-medium" style="color: var(--note-ink);">' + esc(r.name) + '</span></div>'
      + '<p class="text-[11px] leading-relaxed" style="color: var(--note-ink-3);">' + (edOutdated[r.path] || '').slice(0, 40) + '…</p>'
      + '</div>').join('');
    refreshIcons();
  }

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
      if (file) { openNote(file.dataset.path); return; }
      const folder = e.target.closest('.tree-folder');
      if (folder) {
        const key = folder.dataset.folder;
        if (collapsedFolders.has(key)) collapsedFolders.delete(key); else collapsedFolders.add(key);
        renderFileTree(edNotes);
        return;
      }
    });
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
    // 标签区点击（放在 #editor-tabs 上，事件委托）
    const tabs = $('editor-tabs');
    if (tabs) tabs.addEventListener('click', function (e) {
      const close = e.target.closest('[data-action="close-tab"]');
      if (close) {
        e.stopPropagation();
        const p = close.dataset.path;
        const idx = edOpenTabs.indexOf(p);
        if (idx >= 0) edOpenTabs.splice(idx, 1);
        if (edCurrent === p) edCurrent = edOpenTabs[idx] || edOpenTabs[edOpenTabs.length - 1] || null;
        renderTabs();
        if (edCurrent) renderArticle(); else { const ta = $('ed-edit'); if (ta) ta.value = ''; const pv = $('ed-preview'); if (pv) pv.innerHTML = ''; }
        renderFileTree(edNotes);
        return;
      }
      const tab = e.target.closest('.editor-tab');
      if (tab && tab.dataset.path) { openNote(tab.dataset.path); }
    });
    // 编辑 textarea：输入 → 统一处理（字数/状态/预览实时同步/防抖保存）
    const ta = $('ed-edit');
    if (ta) ta.addEventListener('input', function () {
      onEdInput(this.value);
      autoResizeTa(this);
    });
    // 光标移动/点击/选中：刷新源码模式当前行高亮
    if (ta) ['keyup', 'click', 'select'].forEach(function (ev) {
      ta.addEventListener(ev, updateCurrentLine);
    });

    // 编辑 textarea：Enter 智能列表延续（受「智能列表 smartList」开关控制）
    const ta3 = $('ed-edit');
    if (ta3) ta3.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && continueListOnEnter(ta3)) e.preventDefault();
    });

    // 所见即所得编辑区：输入 → 还原为 Markdown 统一处理；粘贴以纯文本插入，避免破坏 DOM 结构
    const wys = $('ed-wysiwyg');
    if (wys) {
      wys.addEventListener('input', function () {
        onEdInput(domToMd(wys));
        const t2 = $('ed-edit'); if (t2 && edSource) t2.value = edOutdated[edCurrent] || '';
        autoResizeTa(t2);
      });
      wys.addEventListener('paste', function (e) {
        e.preventDefault();
        const txt = ((e.clipboardData || window.clipboardData) || {}).getData ? ((e.clipboardData || window.clipboardData)).getData('text/plain') : '';
        document.execCommand('insertText', false, txt || '');
      });
    }

    // 查找/替换条：输入即时查找、Enter/Shift+Enter 上/下、Esc 关闭、按钮动作
    const findbar = $('ed-findbar');
    if (findbar) {
      const fi = $('ed-find-input');
      const ri = $('ed-replace-input');
      if (fi) fi.addEventListener('input', function () { runFind(); });
      if (fi) fi.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); findNav(e.shiftKey ? -1 : 1); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFindbar(); }
      });
      if (ri) ri.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doReplace(); }
        else if (e.key === 'Escape') { e.preventDefault(); closeFindbar(); }
      });
      findbar.addEventListener('click', function (e) {
        const btn = e.target.closest('[data-find-action]');
        if (!btn) return;
        const act = btn.dataset.findAction;
        if (act === 'next') findNav(1);
        else if (act === 'prev') findNav(-1);
        else if (act === 'replace') doReplace();
        else if (act === 'replace-all') doReplaceAll();
        else if (act === 'close') closeFindbar();
      });
    }

    // 编辑按钮=切换源码模式；分屏按钮=启动/关闭分屏；预览=切换到预览布局
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', function () {
        const m = this.dataset.mode;
        if (m === 'edit') toggleSource();
        else if (m === 'split') setEditorMode(edMode === 'split' ? 'edit' : 'split');
        else setEditorMode(m);
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
        edCurrent = edOpenTabs[edOpenTabs.length - 1] || null;
        renderFileTree(edNotes);
        renderTabs();
        if (edCurrent) renderArticle(); else { const ta = $('ed-edit'); if (ta) ta.value = ''; const pv = $('ed-preview'); if (pv) pv.innerHTML = ''; }
      });
    });
    // 查看当前笔记索引：工具栏按钮展开/收起编辑区内联面板（只展示当前打开笔记的分块）
    function renderIndexPanel() {
      const panel = $('ed-index-panel');
      if (!panel) return;
      const body = $('ed-index-body'), pathEl = $('ed-index-path'), countEl = $('ed-index-count');
      const pathNow = edCurrent || '';
      if (pathEl) pathEl.textContent = pathNow || '';
      if (countEl) countEl.textContent = '';
      if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">读取索引…</span>';
      const ai = (window.noteDesktop || {}).ai;
      if (!pathNow) {
        if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">请先打开一篇笔记。</span>';
        return;
      }
      if (!ai || !ai.listIndex) {
        if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">当前环境未启用索引（需桌面版并配置嵌入模型）。</span>';
        return;
      }
      ai.listIndex().then(function (d) {
        d = d || {};
        const g = (d.groups || []).find(function (it) { return it.path === pathNow; });
        const blocks = (g && g.blocks) || [];
        if (countEl) countEl.textContent = blocks.length ? blocks.length + ' 块' : '0 块';
        if (!blocks.length) {
          if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">本篇尚未建立索引。请到 AI 问答页点击「重建索引」后重试。</span>';
          return;
        }
        body.innerHTML = blocks.map(function (blk) {
          return '<div class="rounded-md px-3 py-2 mb-2 text-[12px] leading-relaxed" style="color: var(--note-ink-2); background: var(--note-surface-2);">'
            + '<div class="mb-1 flex flex-wrap items-center gap-2 font-mono text-[10px]" style="color: var(--note-ink-3);">'
            + '<span title="笔记 id">' + esc(blk.noteId) + '</span><span>块 ' + (blk.block + 1) + '</span><span class="nums" title="块 id">' + esc(blk.id) + '</span>'
            + '</div>' + esc(blk.text) + '</div>';
        }).join('');
        refreshIcons();
      }).catch(function () { if (body) body.innerHTML = '<span style="color: var(--state-danger);">读取索引失败</span>'; });
    }
    function toggleIndexPanel() {
      const panel = $('ed-index-panel');
      if (!panel) return;
      if (panel.hidden) { panel.hidden = false; renderIndexPanel(); }
      else panel.hidden = true;
    }
    document.querySelectorAll('[data-action="view-index"], [data-action="index-toggle"]').forEach(function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); toggleIndexPanel(); });
    });
    // 反链 / 预览内链点击
    const back = $('ed-backlinks');
    if (back) back.addEventListener('click', function (e) { const t = e.target.closest('[data-open]'); if (t) openNote(t.dataset.open); });
    const prev = $('ed-preview');
    if (prev) prev.addEventListener('click', function (e) { const a = e.target.closest('[data-wikilink]'); if (a) { e.preventDefault(); const name = a.dataset.wikilink; const hit = edNotes.find(n => n.name.replace(/\.md$/, '') === name || n.name === name); if (hit) openNote(hit.path); } });

    // 默认打开笔记：优先图谱跳转目标，否则第一篇
    if (!edCurrent) {
      const gp = window.__openGraphPath;
      if (gp && edNotes.some(n => n.path === gp)) { openNote(gp); window.__openGraphPath = null; }
      else if (edNotes.length) openNote(edNotes[0].path);
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
    // 自动换行：绑定工具栏按钮（点击切换持久化，默认值来自设置「自动换行」）
    document.querySelectorAll('[data-action="toggle-wrap"]').forEach(b => {
      b.addEventListener('click', function () { setEditorWrap(!restoreS('wrap', true)); });
    });
    // 命令面板「新建笔记」入口
    document.addEventListener('note:new', doNewNote);
    // 侧边面板折叠
    bindCollapse();
    // 文件树：右键菜单 + 拖拽移动
    bindFileTreeContextMenu && bindFileTreeContextMenu();
    bindFileTreeDrag();
    // 应用当前模式：默认编辑，可被设置「默认编辑模式」覆盖（预览/编辑）
    edMode = restoreS('edMode', 'edit') === 'preview' ? 'preview' : 'edit';
    setEditorMode(edMode);
  }

  /* 绑定文件树拖拽移动：事件委托在 #file-tree 上，处理 HTML5 dragstart / dragover / drop / dragend
   * 支持：笔记拖入目录 → 移入；笔记/目录拖入根 → 移出；禁止把目录拖入自身子目录
   * 作者: 火 冰 */
  function bindFileTreeDrag() {
    const root = $('file-tree');
    if (!root) return;
    let dragSrc = null;   /* 正在被拖的元素 */
    let dragType = null;  /* 'note' | 'folder' */
    let dragPath = null;  /* 正在被拖的 path */

    // 根容器空白区作为「拖入根目录」的放置目标
    root.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    root.addEventListener('dragleave', e => {
      if (e.target === root) root.classList.remove('drop-root-active');
    });
    root.addEventListener('drop', async e => {
      e.preventDefault();
      root.classList.remove('drop-root-active');
      if (!dragSrc) return;
      // 目标：根目录（root 自身）
      const newParent = '';
      await handleFileTreeDrop(dragType, dragPath, newParent, null);
      clearDragVisual();
    });

    // 委托：每个条目自身作为 draggable 源 & 放置目标
    root.addEventListener('dragstart', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      if (!node) return;
      dragSrc = node;
      dragType = node.dataset.type;                /* 'note' | 'folder' */
      dragPath = node.dataset.type === 'folder' ? node.dataset.folder : node.dataset.path;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragPath); } catch (_) {}
      node.style.opacity = '0.4';
    });
    root.addEventListener('dragend', e => {
      clearDragVisual();
    });

    root.addEventListener('dragover', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      // 根容器兜底
      if (!node || node === dragSrc) {
        if (dragSrc && !dragSrc.contains(e.target)) root.classList.add('drop-root-active');
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 放置目标：目录 → 移入；文件 → 同目录追加（简单起见也移入它的父目录）
      node.classList.add('is-drop-target');
    });

    root.addEventListener('dragleave', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      if (node) node.classList.remove('is-drop-target');
      root.classList.remove('drop-root-active');
    });

    root.addEventListener('drop', async e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      e.preventDefault();
      root.classList.remove('drop-root-active');
      if (!dragSrc || !node) return;
      // 不能拖到自己或自己的子目录里
      if (node === dragSrc) { clearDragVisual(); return; }
      if (dragType === 'folder' && node.dataset.type === 'folder') {
        const targetDir = node.dataset.folder;
        if ((targetDir + '/').startsWith(dragPath.replace(/[\\/]+$/, '') + '/')) {
          showToast('不能把目录拖入它自己的子目录');
          clearDragVisual();
          return;
        }
      }
      // 目标父目录：拖到 file 用其父目录；拖到 folder 用该 folder
      let newParent = '';
      if (node.dataset.type === 'folder') newParent = node.dataset.folder;
      else newParent = (node.dataset.path || '').includes('/') ? (node.dataset.path || '').slice(0, (node.dataset.path || '').lastIndexOf('/')) : '';

      await handleFileTreeDrop(dragType, dragPath, newParent, node);
      clearDragVisual();
    });

    /* 清除拖拽视觉态（源节点透明度、目标高亮、根容器高亮） */
    function clearDragVisual() {
      if (dragSrc) dragSrc.style.opacity = '';
      dragSrc = dragType = dragPath = null;
      root.classList.remove('drop-root-active');
      root.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    }
  }

  /* 执行一次拖拽移动/排序：note → noteStore.move；folder → noteStore.moveDir。
 * 若 newPath === dragPath 且有目标笔记 → 用 noteStore.swap 实现同目录排序
 * （交换两个文件的名字，保留内容不变，链接 [[A]] / [[B]] 指向正确内容）。
 * 内部会根据移动结果刷新文件树、处理当前打开笔记路径同步。
 * 作者: 火 冰 */
  async function handleFileTreeDrop(dragType, dragPath, newParent, targetEl) {
    if (!dragPath) return;
    if (dragType === 'note') {
      const name = dragPath.split('/').pop();
      const newPath = (newParent ? newParent + '/' : '') + name;
      // 同目录排序：newPath === dragPath，且有明确目标笔记 → swap
      if (newPath === dragPath) {
        if (!targetEl || targetEl.dataset.type !== 'note') {
          showToast('原地拖放无变化');
          return;
        }
        const targetPath = targetEl.dataset.path;
        if (!targetPath || targetPath === dragPath) { showToast('原地拖放无变化'); return; }
        try {
          const ok = await noteStore.swap(dragPath, targetPath);
          if (!ok) { showToast('同目录排序失败'); return; }
          showToast('已交换顺序：' + dragPath.split('/').pop() + ' ↔ ' + targetPath.split('/').pop());
        } catch (e) { showToast('排序失败：' + (e && e.message || e)); return; }
        // swap 可能涉及当前打开笔记 → 重开
        if (dragPath === edCurrent || targetPath === edCurrent) {
          const other = dragPath === edCurrent ? targetPath : dragPath;
          edCurrent = other;
          await openNote(other);
          renderTabs();
        }
        await refreshTreeAfterChange();
        return;
      }
      await actMoveNote(dragPath, newPath);
    } else if (dragType === 'folder') {
      if (newParent === dragPath || (newParent + '/').startsWith(dragPath.replace(/[\\/]+$/, '') + '/')) {
        showToast('不能把目录拖入它自己的子目录');
        return;
      }
      await actMoveDir(dragPath, newParent || '');
    }
  }

  /* 新建笔记 */
  async function doNewNote() {
    const name = prompt('新笔记名称：', '新笔记-' + new Date().getDate() + '-' + (new Date().getHours()) + (new Date().getMinutes()));
    if (!name) return;
    let rel;
    try { rel = await noteStore.create(name, ''); }
    catch (err) { alert('新建失败：' + err.message); return; }
    const meta = await noteStore.list();
    const n = meta.find(x => x.path === rel) || { path: rel, name: rel.split('/').pop(), folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', mtime: Date.now(), size: (edOutdated[rel] || '').length };
    edNotes = meta.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    await openNote(n.path);
    renderFileTree(edNotes);
    setEditorMode('edit');
    // 聚焦当前可见的编辑元素（源码 textarea 或所见即所得）
    const visEl = edSource ? $('ed-edit') : $('ed-wysiwyg');
    if (visEl) visEl.focus();
  }

  /* 新建目录：提示输入目录名，创建后刷新文件树 */
  async function doNewFolder() {
    const name = prompt('新建目录名（支持子目录，用 / 分隔）：', '新建目录');
    if (!name) return;
    let rel;
    try { rel = await noteStore.createDir(name); }
    catch (err) { alert('新建目录失败：' + err.message); return; }
    // 重新列笔记并重绘文件树，使新目录即时显示
    const meta = await noteStore.list();
    edNotes = meta.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    renderFileTree(edNotes);
    showToast('已创建目录 ' + rel);
  }

  /* 切换编辑/预览/分屏模式：edit 仅源码、preview 仅预览、split 源码+预览左右并排
   * 作者: 火 冰 */
  function setEditorMode(mode) {
    edMode = mode;
    const pv = $('ed-preview');
    const label = $('ed-mode-label');
    syncModeButtons();
    // 三态面板显隐：源码面板（edit/split）、预览面板（preview/split）、分隔线（分屏）
    const srcPane = $('ed-pane-src');
    const prevPane = $('ed-pane-prev');
    const sep = $('ed-split-sep');
    const srcOn = mode !== 'preview';
    const prevOn = mode !== 'edit';
    if (srcPane) srcPane.style.display = srcOn ? '' : 'none';
    if (prevPane) prevPane.style.display = prevOn ? '' : 'none';
    if (sep) sep.style.display = mode === 'split' ? '' : 'none';
    if (label) label.textContent = ({ edit: '编辑', preview: '预览', split: '分屏' })[mode] || mode;
    if (prevOn && edCurrent) {
      const mdV = edOutdated[edCurrent] || '';
      pv.innerHTML = renderMarkdown(mdV); refreshIcons();
    }
    applySourceMode();
  }

  /* 侧边面板折叠 */
  function bindCollapse() {
    document.querySelectorAll('.collapse-head').forEach(head => {
      head.addEventListener('click', function () {
        const body = this.nextElementSibling;
        if (!body) return;
        const chevron = this.querySelector('i[data-lucide="chevron-down"]');
        if (body.style.display === 'none') {
          body.style.display = ''; if (chevron) chevron.setAttribute('data-lucide', 'chevron-down');
        } else {
          body.style.display = 'none'; if (chevron) chevron.setAttribute('data-lucide', 'chevron-right');
        }
        refreshIcons();
      });
    });
    const expandAll = document.querySelector('[data-action="expand-all"]');
    if (expandAll) expandAll.addEventListener('click', function () {
      document.querySelectorAll('#right-panel .collapse-head').forEach(head => {
        const body = head.nextElementSibling;
        if (body) body.style.display = '';
        const chevron = head.querySelector('i[data-lucide="chevron-right"]');
        if (chevron) chevron.setAttribute('data-lucide', 'chevron-down');
      });
      refreshIcons();
    });
  }

