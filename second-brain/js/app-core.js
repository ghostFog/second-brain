/* ============================================
 * 第二脑 应用逻辑
 * 作者: 火 冰
 * 功能: hash 路由、导航高亮、命令面板、各视图交互、
 *       主题/强调色/字体响应、多端侧栏切换
 * ============================================ */

  'use strict';

  /* ---------- 路由表：视图 key -> 视图文件 ---------- */
  const ROUTES = {
    editor: { file: 'views/editor.html', name: '编辑器', crumb: null }, // 面包屑按当前打开笔记路径动态生成
    graph: { file: 'views/graph.html', name: '图谱视图', crumb: ['图谱视图', '2024年9月1日'] },
    plugins: { file: 'views/plugins.html', name: '插件市场', crumb: ['插件市场'] },
    settings: { file: 'views/settings.html', name: '设置', crumb: ['设置'] },
    ai: { file: 'views/ai.html', name: 'AI 问答', crumb: ['AI 问答'] },
  };

  /** 视图容器与当前状态 */
  const viewRoot = document.getElementById('view-root');
  const overlay = document.getElementById('palette-overlay');
  const navButtons = Array.from(document.querySelectorAll('[data-nav-key]'));
  let cachedViews = {};
  let activeView = 'editor';
  let paletteOpen = false;
  let paletteItems = [];
  let paletteIndex = 0;

  /* ============================
   * 通用工具
   * ============================ */

  /* 刷新 lucide 图标 */
  function refreshIcons() {
    if (window.lucide) {
      try { lucide.createIcons(); } catch (e) { /* 忽略图标刷新异常 */ }
    }
  }

  /* 获取当前 hash 对应的视图 key */
  function getRoute() {
    const h = (location.hash || '#/editor').replace('#/', '');
    return ROUTES[h] ? h : 'editor';
  }

  /* 更新标题栏面包屑与文档标题
   * 说明：编辑器视图按当前打开笔记的实际路径动态生成面包屑，不再硬编码。作者: 火 冰 */
  function updateCrumb(key) {
    const r = ROUTES[key];
    const crumbEl = document.getElementById('crumbs');
    if (!r || !crumbEl) return;
    // 编辑器视图：用当前打开笔记路径生成的层级；否则用路由预设
    const crumbs = (key === 'editor' && edCurrent) ? edCurrent.split('/') : (r.crumb || []);
    crumbEl.innerHTML = crumbs.map((c, i) =>
      i === crumbs.length - 1
        ? '<span style="color: var(--note-ink-2);">' + esc(c) + '</span>'
        : '<span>' + esc(c) + '</span><i data-lucide="chevron-right" class="w-3 h-3"></i>'
    ).join('');
    const titleName = (key === 'editor' && edCurrent) ? edCurrent.split('/').pop().replace(/\.md$/, '') : r.name;
    document.title = '第二脑 — ' + titleName;
    refreshIcons();
  }

  /* 更新 Ribbon 高亮态 */
  function updateNav(key) {
    navButtons.forEach(btn => {
      const active = btn.dataset.navKey;
      if (active === 'search') return;
      const isActive = active === key;
      btn.style.background = isActive ? 'var(--note-brand-600)' : 'transparent';
      btn.style.color = isActive ? '#FFFFFF' : 'var(--note-ink-2)';
    });
  }

  /* ============================
   * 命令面板
   * ============================ */

  /* 全局命令注册表 key -> 回调 */
  const COMMAND_ACTIONS = {
    '新建笔记': function () { location.hash = '#/editor'; document.dispatchEvent(new CustomEvent('note:new')); },
    '打开笔记': function () { location.hash = '#/editor'; },
    '搜索笔记': function () { document.getElementById('palette-input').focus(); },
    '打开图谱视图': function () { location.hash = '#/graph'; closePalette(); },
    '浏览插件市场': function () { location.hash = '#/plugins'; closePalette(); },
    '打开AI问答': function () { location.hash = '#/ai'; closePalette(); },
    '导出为PDF': function () { alert('演示环境：已触发「导出为 PDF」命令。'); },
    '切换主题': function () { toggleTheme(); },
    '同步设置': function () { alert('演示环境：设置已同步。'); },
    '打开设置': function () { location.hash = '#/settings'; closePalette(); },
  };

  /* 命令面板命令列表（含分组） */
  function buildCommandList() {
    return [
      { group: '最近使用', items: [
        { icon: 'file-plus', label: '新建笔记', shortcut: '⌘N', action: COMMAND_ACTIONS['新建笔记'] },
        { icon: 'folder-open', label: '打开笔记', shortcut: '⌘O', action: COMMAND_ACTIONS['打开笔记'], },
      ] },
      { group: '文件操作', items: [
        { icon: 'search', label: '搜索笔记', shortcut: '⌘F', action: COMMAND_ACTIONS['搜索笔记'] },
        { icon: 'file-down', label: '导出为PDF', action: COMMAND_ACTIONS['导出为PDF'] },
      ] },
      { group: '导航', items: [
        { icon: 'git-fork', label: '打开图谱视图', shortcut: '⌘G', action: COMMAND_ACTIONS['打开图谱视图'] },
        { icon: 'brain', label: '打开AI问答', action: COMMAND_ACTIONS['打开AI问答'] },
        { icon: 'settings', label: '打开设置', action: COMMAND_ACTIONS['打开设置'] },
      ] },
      { group: '插件', items: [
        { icon: 'puzzle', label: '浏览插件市场', action: COMMAND_ACTIONS['浏览插件市场'] },
        { icon: 'moon', label: '切换主题', action: COMMAND_ACTIONS['切换主题'] },
        { icon: 'cloud', label: '同步设置', action: COMMAND_ACTIONS['同步设置'] },
      ] },
    ];
  }

  /* 渲染命令面板列表 */
  function renderPalette(filter) {
    const list = document.getElementById('palette-list');
    const groups = buildCommandList();
    const q = (filter || '').trim().toLowerCase();
    paletteItems = [];
    let html = '';
    groups.forEach(g => {
      const items = g.items.filter(i => !q || i.label.toLowerCase().includes(q) || g.group.toLowerCase().includes(q));
      if (items.length === 0) return;
      html += '<div class="px-2 mb-1">'
        + '<div class="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wider" style="color: var(--note-ink-3);">' + g.group + '</div>';
      items.forEach(it => {
        const idx = paletteItems.length;
        paletteItems.push(it);
        html += '<div class="palette-item flex items-center gap-3 px-2 py-2 rounded-md cursor-pointer transition-colors" data-idx="' + idx + '">'
          + '<i data-lucide="' + it.icon + '" class="w-4 h-4 shrink-0" style="color: var(--note-brand);"></i>'
          + '<span class="flex-1 text-[14px]" style="color: var(--note-ink);">' + it.label + '</span>'
          + (it.shortcut ? '<kbd class="text-[11px] px-1.5 py-0.5 rounded font-mono" style="background: var(--note-surface); color: var(--note-ink-3);">' + it.shortcut + '</kbd>' : '')
          + '</div>';
      });
      html += '</div>';
    });
    list.innerHTML = html;
    refreshIcons();
    paletteIndex = 0;
    highlightPaletteItem();
    const countEl = document.getElementById('palette-count');
    if (countEl) countEl.textContent = paletteItems.length + ' 个结果';
    // 绑定行点击
    list.querySelectorAll('.palette-item').forEach(el => {
      el.addEventListener('click', () => { const it = paletteItems[+el.dataset.idx]; if (it) runCommand(it); });
    });
  }

  /* 高亮当前命令项 */
  function highlightPaletteItem() {
    const list = document.getElementById('palette-list');
    list.querySelectorAll('.palette-item').forEach(el => {
      el.classList.toggle('active', +el.dataset.idx === paletteIndex);
    });
    const cur = list.querySelector('.palette-item[data-idx="' + paletteIndex + '"]');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  /* 执行命令 */
  function runCommand(item) {
    if (item && item.action) item.action();
  }

  function openPalette() {
    overlay.style.display = 'block';
    paletteOpen = true;
    renderPalette('');
    const input = document.getElementById('palette-input');
    input.value = '';
    input.focus();
  }

  function closePalette() {
    overlay.style.display = 'none';
    paletteOpen = false;
  }

  /* 切换主题（深/浅循环） */
  function toggleTheme() {
    const html = document.documentElement;
    const isLight = html.classList.contains('light');
    // 命令面板切换主题：深 <-> 浅
    setTheme(isLight ? 'dark' : 'light', true);
    refreshIcons();
  }

  /* ============================
   * 主题 / 强调色 / 字体 设置
   * ============================ */

  /**
   * 设置主题模式
   * @param {string} mode  'dark' | 'light' | 'auto'
   * @param {boolean} persist 是否写入 localStorage/高亮设置项
   */
  function setTheme(mode, persist) {
    const html = document.documentElement;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    let target = mode;
    if (mode === 'auto') target = prefersDark ? 'dark' : 'light';
    html.classList.toggle('light', target === 'light');
    html.classList.toggle('dark', target === 'dark');
    html.dataset.theme = target;
    if (mode === 'auto') html.dataset.themeMode = 'auto'; else html.dataset.themeMode = mode;
    if (persist) localStorage.setItem('note-app:theme', mode);
    // 同步设置页主题卡片高亮
    document.querySelectorAll('.theme-card').forEach(c => {
      const active = c.dataset.themeMode === mode;
      c.classList.toggle('active', active);
      const check = c.querySelector('i[data-lucide="check"]');
      if (check) check.style.display = active ? 'block' : 'none';
    });
  }

  /* 设置强调色 */
  function setAccent(color) {
    const root = document.documentElement.style;
    root.setProperty('--note-brand-50', tint(color, 0.95));
    root.setProperty('--note-brand-100', tint(color, 0.85));
    root.setProperty('--note-brand-200', tint(color, 0.72));
    root.setProperty('--note-brand-300', tint(color, 0.56));
    root.setProperty('--note-brand-400', tint(color, 0.4));
    root.setProperty('--note-brand-500', shade(color, 0.88));
    root.setProperty('--note-brand-600', color);
    root.setProperty('--note-brand-700', shade(color, 0.74));
    root.setProperty('--note-brand-800', shade(color, 0.6));
    root.setProperty('--note-brand-900', shade(color, 0.48));
    root.setProperty('--note-brand-950', shade(color, 0.34));
    localStorage.setItem('note-app:accent', color);
    document.querySelectorAll('.color-dot').forEach(d => d.classList.toggle('active', d.dataset.accent === color));
  }

  /* 颜色辅助：混合到白色 -- 作者 huobing */
  function tint(hex, weight) {
    const rgb = hexToRgb(hex);
    const w = 1 - weight;
    return 'rgb(' + Math.round(rgb.r * w + 255 * weight) + ',' + Math.round(rgb.g * w + 255 * weight) + ',' + Math.round(rgb.b * w + 255 * weight) + ')';
  }
  /* 颜色辅助：混合到黑色 */
  function shade(hex, weight) {
    const rgb = hexToRgb(hex);
    return 'rgb(' + Math.round(rgb.r * weight) + ',' + Math.round(rgb.g * weight) + ',' + Math.round(rgb.b * weight) + ')';
  }
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) };
  }

  /* 字体大小 */
  function applyFontSize(px) {
    document.documentElement.style.setProperty('--note-text-body', px + 'px');
    localStorage.setItem('note-app:font-size', px);
    const label = document.getElementById('font-size-label');
    if (label) label.textContent = px + 'px';
  }

  /* 字体族 */
  function applyFontFamily(font) {
    const map = { 'Inter': "'Inter', 'Noto Sans SC', system-ui, sans-serif", 'Noto Sans SC': "'Noto Sans SC', 'PingFang SC', system-ui, sans-serif", '系统默认': 'system-ui, sans-serif' };
    if (map[font]) document.documentElement.style.setProperty('--note-font-sans', map[font]);
    localStorage.setItem('note-app:font-family', font);
  }

  /* 代码字体：更新根 CSS 变量 --note-font-mono，并持久化到 note-app:font-mono */
  function applyFontMono(font) {
    const map = { 'JetBrains Mono': "'JetBrains Mono', 'Consolas', monospace", 'Fira Code': "'Fira Code', 'Consolas', monospace", 'Cascadia Code': "'Cascadia Code', 'Consolas', monospace" };
    if (map[font]) document.documentElement.style.setProperty('--note-font-mono', map[font]);
    localStorage.setItem('note-app:font-mono', font);
  }

  /* 自动换行：控制编辑区 textarea 是否折行显示（关闭则横向滚动） */
  function applyEditorWrap(on) {
    document.querySelectorAll('#ed-edit').forEach(t => {
      t.style.whiteSpace = on ? '' : 'pre';
      t.style.overflowX = on ? '' : 'auto';
    });
  }

  /* 减少动画：在根元素标记 data-reduce-motion，由 CSS 全局禁用过渡与动画 */
  function applyReduceMotion(on) {
    document.documentElement.toggleAttribute('data-reduce-motion', !!on);
  }

  /* 界面密度：按紧凑/标准/舒适调整编辑区与预览区行高 */
  function applyDensity(mode) {
    const lh = { '紧凑': 1.5, '标准': 1.7, '舒适': 1.9 }[mode] || 1.7;
    document.querySelectorAll('#ed-edit, #ed-preview').forEach(el => { el.style.lineHeight = lh; });
  }

  /* 显示行号：持久化开关并刷新编辑区行号 gutter（设置与工具栏按钮共用） */
  function setLineNumbers(on) {
    edLineNum = !!on;
    saveS('lineNumbers', edLineNum);
    updateGutter();
  }

  /* 自动换行：持久化开关、应用到编辑区并刷新工具栏按钮高亮（设置与工具栏按钮共用） */
  function setEditorWrap(on) {
    const wrap = !!on;
    saveS('wrap', wrap);
    applyEditorWrap(wrap);
    document.querySelectorAll('[data-action="toggle-wrap"]').forEach(b => {
      b.style.background = wrap ? 'var(--note-surface-2)' : 'transparent';
      b.style.color = wrap ? 'var(--note-ink)' : 'var(--note-ink-3)';
    });
  }

  /* 更新行号 gutter 显隐：只要开启行号即显示（任一编辑视图）；工具栏按钮高亮随开关 */
  function updateGutter() {
    const gutter = $('ed-gutter');
    const btn = document.querySelector('[data-action="toggle-line-numbers"]');
    const on = !!edLineNum;
    if (gutter) gutter.hidden = !on;
    if (btn) {
      btn.style.background = on ? 'var(--note-surface-2)' : 'transparent';
      btn.style.color = on ? 'var(--note-ink)' : 'var(--note-ink-3)';
    }
    if (on) renderGutter();
  }

  /* 渲染编辑区行号：按内容源码逻辑行生成序号，显示为左侧通栏分隔列。
   * 仅源码模式（edSource=true）显示行号；所见即所得/纯预览不显示。
   * 给编辑内容预留左内边距，避免行号列遮挡文字；gutter 背景仅比编辑器背景微亮（见 --note-gutter-bg）。
   * 作者: 火 冰 */
  function renderGutter() {
    const gutter = $('ed-gutter');
    updateCurrentLine();
    if (!gutter) return;
    const ta = $('ed-edit');
    const srcPane = $('ed-pane-src');
    // 仅源码模式显示行号（所见即所得/纯预览隐藏）
    if (!edSource || !ta || ta.hidden || !srcPane || !edLineNum) { gutter.hidden = true; return; }
    gutter.hidden = false;
    const cs = getComputedStyle(ta);
    const tRect = ta.getBoundingClientRect();
    const paneRect = srcPane.getBoundingClientRect();
    const padT = parseFloat(cs.paddingTop) || 0;
    gutter.style.fontSize = cs.fontSize;
    gutter.style.lineHeight = cs.lineHeight;
    // 行数 → 行号列宽（等宽字体估字符宽，预留余量）
    let md = (edOutdated[edCurrent] || '');
    md = md.replace(/\n+$/, '');                  // 末尾尾随换行不产生额外空行号
    const count = md ? md.split('\n').length : 0;
    const digits = String(Math.max(count, 1)).length;
    const perCh = (parseFloat(cs.fontSize) || 14) * 0.62;
    const gutterW = Math.ceil(digits * perCh) + 16; // 序号宽 + 右余量
    gutter.style.width = gutterW + 'px';
    // 通栏列：左缘落在 textarea 边框左缘（占其左侧 padding 区，不遮文字）
    gutter.style.left = (tRect.left - paneRect.left) + 'px';
    gutter.style.right = 'auto';
    gutter.style.height = '';
    // 首行序号与内容首行顶缘对齐（相对 pane 顶）
    const padTop = Math.max(0, (tRect.top - paneRect.top) + padT);
    gutter.style.paddingTop = padTop + 'px';
    // 给内容预留左内边距 = 原始左padding(px-8) + 行号列宽 + 间距，避免遮挡
    const origPadL = parseFloat(cs.paddingRight) || 0; // px-8 左右同为 32px，借右值作左基准
    ta.style.paddingLeft = (origPadL + gutterW + 10) + 'px';
    let html = '';
    for (let i = 1; i <= count; i++) html += '<div>' + i + '</div>';
    gutter.innerHTML = html;
  }

  /* 源码模式当前行背景高亮：光标所在行铺一条半透明显色带。
   * 与行号开关无关（源码模式即高亮）；所见即所得/纯预览时隐藏。
   * 作者: 火 冰 */
  function updateCurrentLine() {
    const mark = $('ed-current-line');
    const ta = $('ed-edit');
    const srcPane = $('ed-pane-src');
    if (!mark || !ta || !srcPane) return;
    // 仅源码模式可见
    if (!edSource || ta.hidden) { if (!mark.hidden) mark.hidden = true; return; }
    mark.hidden = false;
    const cs = getComputedStyle(ta);
    const tRect = ta.getBoundingClientRect();
    const paneRect = srcPane.getBoundingClientRect();
    const lh = parseFloat(cs.lineHeight) || 24;
    const padT = parseFloat(cs.paddingTop) || 0;
    const val = ta.value || '';
    const pos = (ta.selectionStart != null ? ta.selectionStart : val.length);
    const lineIdx = val.slice(0, pos).split('\n').length - 1;
    mark.style.top = ((tRect.top - paneRect.top) + padT + lineIdx * lh) + 'px';
    mark.style.height = lh + 'px';
    mark.style.left = (tRect.left - paneRect.left) + 'px';
    mark.style.width = ta.offsetWidth + 'px';
  }

  /* 智能列表延续：Enter 时自动补齐当前行的列表标记。
   * 支持无序标记 - /* +、任务 - [ ]/[x]、有序 1. 1)、引用 >。
   * 命中标记则在光标处插入换行+标记并触发 input；否则返回 false（交给默认行为）。
   * 参数 ta: 编辑区 textarea；返回 boolean 是否已处理 */
  function continueListOnEnter(ta) {
    if (!ta || !restoreS('smartList', true)) return false;
    const v = ta.value;
    const pos = ta.selectionStart;
    const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
    const lineEnd = v.indexOf('\n', pos);
    const lineEndIdx = (lineEnd === -1) ? v.length : lineEnd;
    const line = v.slice(lineStart, lineEndIdx);
    const m = line.match(/^([\t\s]*(?:>[ \t]|[-*+](?: \[[ xX]\])?[ \t]|\d+[.)][ \t]))/) || [];
    const prefix = m[1];
    if (!prefix) return false;
    const ins = '\n' + prefix;
    ta.value = v.slice(0, pos) + ins + v.slice(pos);
    ta.selectionStart = ta.selectionEnd = pos + ins.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
