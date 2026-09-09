/**
 * Minimal Theme 插件 — 极简主题切换
 * 作者: 火 冰
 *
 * 注册到 PluginAPI，宿主通过 materializePlugin → pluginManager.install 接入。
 * 切换方式：
 *   1. 内置 4 套配色（纸白/亚麻/冷灰/墨绿）→ body 添加 .mt-theme-N，由 styles.css 覆盖 CSS 变量
 *   2. 自定义配色（id = 'custom'）→ body 添加 .mt-theme-custom + 由插件内联注入全部 CSS 变量（from settings）
 * 顶栏按钮：MutationObserver 监听 #plugin-toolbar，按钮悬浮时弹出可用主题列表下拉。
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'minimal-theme';
  var LS_KEY = 'note-app:minimal-theme';
  var CLASS_PREFIX = 'mt-theme-';
  var PRESET_COUNT = 4; // 内置 4 套配色

  /** 主题清单：内置 4 套 + 自定义配色 */
  var THEMES = [
    { id: '1', name: '纸白' },
    { id: '2', name: '亚麻' },
    { id: '3', name: '冷灰' },
    { id: '4', name: '墨绿' },
    { id: 'custom', name: '自定义配色' }
  ];

  /** 自定义配色的可调字段：key → { label, cssVar, default } */
  var CUSTOM_FIELDS = [
    { key: 'cBg',     label: '背景色',   cssVar: '--note-background',  default: '#FAF7F0' },
    { key: 'cCard',   label: '卡片背景', cssVar: '--note-card',        default: '#F2EDE3' },
    { key: 'cSurface',label: '表面/弹层',cssVar: '--note-surface',     default: '#F2EDE3' },
    { key: 'cBorder', label: '边框/输入',cssVar: '--note-border',      default: '#E0DBD0' },
    { key: 'cInk',    label: '主文字色', cssVar: '--note-ink',         default: '#3D3D3D' },
    { key: 'cInk3',   label: '次要文字', cssVar: '--note-ink-3',       default: '#9A9488' },
    { key: 'cLine',   label: '分隔线',   cssVar: '--note-line',        default: '#E0DBD0' },
    { key: 'cBrand',  label: '强调色',   cssVar: '--note-brand',       default: '#7C6A52' }
  ];

  /** 自定义主题启用时注入到 body 的完整 CSS 变量集合 */
  var CUSTOM_VAR_PROPS = [
    '--note-background', '--note-foreground', '--note-card', '--note-card-foreground',
    '--note-surface', '--note-surface-2', '--note-popover', '--note-popover-foreground',
    '--note-muted', '--note-muted-foreground', '--note-border', '--note-input',
    '--note-ring', '--note-gutter-bg', '--note-ink', '--note-ink-2', '--note-ink-3',
    '--note-line', '--note-brand', '--note-brand-500', '--note-brand-600',
    '--note-shadow-1', '--note-shadow-2'
  ];

  /** 下拉面板元素（首次显示时惰性创建） */
  var dropdownEl = null;
  /** 顶栏按钮是否已绑定悬浮事件（若任何已渲染按钮绑定过则为 true；供测试断言） */
  var btnBound = false;
  /** 悬浮延迟隐藏定时器 */
  var hideTimer = null;

  /**
   * 读取插件设置；优先用宿主 PluginAPI.getSetting，缺失时回退 localStorage
   * @param {string} key 设置项 key
   * @returns {string|null} 原始字符串值；未设置返回 null
   */
  function getSetting(key) {
    if (typeof PluginAPI !== 'undefined' && PluginAPI && typeof PluginAPI.getSetting === 'function') {
      var v = PluginAPI.getSetting(PLUGIN_ID, key);
      if (v !== undefined && v !== null) return String(v);
    }
    var raw = localStorage.getItem('plugin:' + PLUGIN_ID + ':' + key);
    return raw;
  }

  /**
   * 读取自定义配色全部可调字段的值
   * @returns {Object} key → HEX 颜色字符串（缺失时用默认值）
   */
  function readCustomColors() {
    var out = {};
    CUSTOM_FIELDS.forEach(function (f) { out[f.key] = getSetting(f.key) || f.default; });
    return out;
  }

  /**
   * 根据自定义配色字段计算派生后的完整 CSS 变量集合
   * @param {Object} c 自定义配色字段 { cBg, cCard, cSurface, cBorder, cInk, cInk3, cLine, cBrand }
   * @returns {Object} cssVar → 颜色值
   */
  function buildCustomVars(c) {
    return {
      '--note-background': c.cBg,
      '--note-foreground': c.cInk,
      '--note-card': c.cCard,
      '--note-card-foreground': c.cInk,
      '--note-surface': c.cCard,
      '--note-surface-2': c.cBorder,
      '--note-popover': c.cCard,
      '--note-popover-foreground': c.cInk,
      '--note-muted': c.cCard,
      '--note-muted-foreground': c.cInk3,
      '--note-border': c.cBorder,
      '--note-input': c.cBorder,
      '--note-ring': c.cBrand,
      '--note-gutter-bg': c.cCard,
      '--note-ink': c.cInk,
      '--note-ink-2': c.cInk3,
      '--note-ink-3': c.cInk3,
      '--note-line': c.cLine,
      '--note-brand': c.cBrand,
      '--note-brand-500': c.cBrand,
      '--note-brand-600': c.cBrand,
      '--note-shadow-1': '0 1px 2px rgba(120, 110, 90, 0.06)',
      '--note-shadow-2': '0 8px 24px -8px rgba(120, 110, 90, 0.18)'
    };
  }

  /**
   * 向 body 内联写入自定义主题全部 CSS 变量，并清掉此前的内联变量
   */
  function applyCustomVars() {
    var body = document.body;
    if (!body) return;
    var vars = buildCustomVars(readCustomColors());
    clearCustomVars();
    Object.keys(vars).forEach(function (k) { body.style.setProperty(k, vars[k]); });
  }

  /**
   * 清掉 body 上由自定义主题写入的全部内联 CSS 变量
   */
  function clearCustomVars() {
    var body = document.body;
    if (!body) return;
    CUSTOM_VAR_PROPS.forEach(function (k) { if (body.style.getPropertyValue(k)) body.style.removeProperty(k); });
  }

  /* ---------------- 编辑器（Vditor）主题联动：抽象 resolver，经宿主执行，不直接调 vditor ---------------- */

  /** 每套配色的「编辑器主题」设置键（1..4 内置 + custom 自定义） */
  var ED_THEME_KEY = { '1': 'edTheme1', '2': 'edTheme2', '3': 'edTheme3', '4': 'edTheme4', 'custom': 'edThemeCustom' };

  /** 编辑器主题下拉显示值 → 模式映射 */
  var ED_THEME_MODE = { '自动(跟随宿主)': 'auto', '浅色': 'light', '深色': 'dark' };

  /**
   * 读取当前配色对应的「编辑器主题」设置值（auto/light/dark）
   * @returns {string}
   */
  function currentEditorMode() {
    var id = normalizeId(localStorage.getItem(LS_KEY) || '0');
    var key = ED_THEME_KEY[id] || 'edTheme1';
    var v = ED_THEME_MODE[getSetting(key)] || 'auto';
    return v;
  }

  /**
   * 根据编辑器深浅把宿主配色映射成 vditor 的覆盖 CSS（「自定义CSS注入」）。
   * 深色时交给 vditor 内建暗色主题，不强制覆盖浅色变量。
   * @param {string} theme 'dark'|'light'
   * @returns {string} CSS 文本
   */
  function buildEditorCss(theme) {
    // UI 壳：仅浅色态才用 --note-* 覆盖外壳背景（深色态交给 vditor 自带暗色，避免把浅色变量灌进深色背景）。
    // 选择器统一加 html body 前缀提高特异度：vditor 会在运行时动态注入自身主题 CSS（较晚出现在 <head>），
    // 单类选择器(0,1,0)会因同特异度后加载而胜出；加前缀后必然压过 vditor 自带样式。
    var ui = theme === 'dark' ? [] : [
      'html body .vditor, html body .vditor .vditor-content, html body .vditor .vditor-sv, html body .vditor .vditor-ir, html body .vditor .vditor-wysiwyg, html body .vditor .vditor-preview, html body .vditor .vditor-reset { background-color: var(--note-background, #fff); color: var(--note-ink, #333); }',
      'html body .vditor .vditor-toolbar { background-color: var(--note-surface, #fafafa); border-bottom-color: var(--note-border, #ddd); }',
      'html body .vditor-toolbar__item { color: var(--note-ink-3, #888); }',
      'html body .vditor-toolbar__item:hover, html body .vditor-toolbar__item--active { background-color: var(--note-surface-2, #eee); color: var(--note-brand, #7c6a52); }',
      'html body .vditor-sv .vditor-sv__marker :not(.vditor-sv__marker--blank) { color: var(--note-ink-3, #888); }',
      'html body .vditor ::selection { background-color: var(--note-brand, #7c6a52); color: #fff; }'
    ];
    // 内容层主题化：编辑区 IR/WYSIWYG 里的 table/引用/代码块不受 vditor 明暗内容主题影响（那只作用于 .vditor-reset 预览），
    // 浅色态用 --note-* 跟随配色；深色态用与宿主深色协调的固定暗色，消除刺眼白底。
    var content = (theme === 'dark' ? darkContentCss() : lightContentCss());
    return ui.concat(content).join('\n');
  }

  /**
   * 浅色态编辑区内容层 CSS：表格/引用/代码块跟随 --note-* 配色。
   * 作者: 火 冰
   * @returns {string[]}
   */
  function lightContentCss() {
    return [
      'html body .vditor table { border-collapse: collapse; background-color: var(--note-background, #fff); color: var(--note-ink, #333); border-color: var(--note-line, #ddd); }',
      'html body .vditor table th { background-color: var(--note-surface, #fafafa); color: var(--note-ink, #333); border-color: var(--note-line, #ddd); }',
      'html body .vditor table td { background-color: var(--note-background, #fff); color: var(--note-ink, #333); border-color: var(--note-line, #ddd); }',
      'html body .vditor table tbody tr:nth-child(2n) { background-color: var(--note-surface, #fafafa); }',
      'html body .vditor blockquote { background-color: var(--note-surface, #fafafa); border-left-color: var(--note-ring, #bbb); color: var(--note-ink-2, #555); }',
      'html body .vditor pre, html body .vditor code:not(.hljs) { background-color: var(--note-surface, #fafafa); color: var(--note-ink, #333); border-color: var(--note-line, #ddd); }',
      'html body .vditor pre code { background-color: transparent; color: inherit; }',
      // 以下三项为映射表「编辑层」待补全项：链接→强调色, 分隔线→行线, callout/卡片→卡片背景
      'html body .vditor a { color: var(--note-brand, #7c6a52); }',
      'html body .vditor hr, html body .vditor .vditor-sv__hr { border-top-color: var(--note-line, #ddd); }',
      'html body .vditor .vditor-callout, html body .vditor .vditor__callout { background-color: var(--note-card, #f2efe7); border-left-color: var(--note-ring, #bbb); color: var(--note-ink-2, #555); }'
    ];
  }

  /**
   * 深色态编辑区内容层 CSS：表格/引用/代码块用与宿主深色协调的固定暗色，避免刺眼白底。
   * 作者: 火 冰
   * @returns {string[]}
   */
  function darkContentCss() {
    return [
      'html body .vditor table { border-collapse: collapse; background-color: #202329; color: #d7d9dc; border-color: #3a3f47; }',
      'html body .vditor table th { background-color: #2a2e35; color: #e2e4e7; border-color: #3a3f47; }',
      'html body .vditor table td { background-color: #202329; color: #d7d9dc; border-color: #3a3f47; }',
      'html body .vditor table tbody tr:nth-child(2n) { background-color: #262a30; }',
      'html body .vditor blockquote { background-color: #262a30; border-left-color: #9aa0a8; color: #b6b9bd; }',
      'html body .vditor pre, html body .vditor code:not(.hljs) { background-color: #262a30; color: #e2e4e7; border-color: #3a3f47; }',
      'html body .vditor pre code { background-color: transparent; color: inherit; }',
      // 深色态对应三项：链接→暗调强调, 分隔线→暗行线, callout/卡片→暗卡片背景
      'html body .vditor a { color: #c9b48f; }',
      'html body .vditor hr, html body .vditor .vditor-sv__hr { border-top-color: #3a3f47; }',
      'html body .vditor .vditor-callout, html body .vditor .vditor__callout { background-color: #262a30; border-left-color: #9aa0a8; color: #b6b9bd; }'
    ];
  }

  /**
   * 编辑器主题解析器（注册给宿主）：按当前配色返回 vditor 应用深浅 + 额外注入 CSS。
   * 宿主（editor-vditor.js resolveVdTheme）调用，插件不直接操作 vditor。
   * @param {Object} hint 宿主传入 { dark: boolean }（全局明暗）
   * @returns {Object} { theme:'dark'|'light', extraCss }
   */
  function editorThemeResolver(hint) {
    var mode = currentEditorMode();
    var theme = (mode === 'dark') ? 'dark' : ((mode === 'light') ? 'light' : ((hint && hint.dark) ? 'dark' : 'light'));
    var css = '';
    if (getSetting('injectCss') !== 'false') css = buildEditorCss(theme);
    var userCss = getSetting('extraCss');
    if (userCss) css = css ? css + '\n' + userCss : userCss;
    return { theme: theme, extraCss: css };
  }

  /**
   * 通知宿主重算并应用 vditor 主题（配色/编辑器主题配置变化后调用）。
   * 经 PluginAPI.editor.theme.sync 抽象完成，宿主内部执行，插件不直接调 vditor。
   */
  function syncEditorTheme() {
    if (PluginAPI && PluginAPI.editor && PluginAPI.editor.theme &&
      typeof PluginAPI.editor.theme.sync === 'function') {
      try { PluginAPI.editor.theme.sync(); } catch (_) { /* 忽略同步异常 */ }
    }
  }

  /**
   * 返回主题名称
   * @param {string} id 主题 id（'1'-'4' / 'custom' / '0'）
   * @returns {string}
   */
  function themeName(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === String(id)) return THEMES[i].name;
    return '停用';
  }

  /**
   * Toast 轻提示（复用宿主的 toast，如果宿主没有就用简易 div）
   * @param {string} msg 提示文案
   */
  function toast(msg) {
    if (typeof window.toast === 'function') { window.toast(msg); return; }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:32px;left:50%;transform:translateX(-50%);' +
      'background:var(--note-surface, #333);color:var(--note-ink, #fff);' +
      'padding:8px 16px;border-radius:6px;z-index:99999;font-size:13px;' +
      'border:1px solid var(--note-border, #555);transition:opacity 0.3s;';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; }, 1500);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2000);
  }

  /**
   * 应用指定主题
   * @param {string|number} themeId id='custom' 或 '1'-'4'；'0'/'停用'/'undefined' 表示停用
   * @param {boolean} [silent] 为 true 时不弹 Toast（启动静默恢复用）
   */
  function applyTheme(themeId, silent) {
    var body = document.body;
    if (!body) return;
    var id = (themeId === 'custom') ? 'custom' : String(normalizeId(themeId));
    // 先清掉所有主题 class（mt-theme-1..4 + mt-theme-custom）与自定义内联变量
    for (var i = 1; i <= PRESET_COUNT; i++) body.classList.remove(CLASS_PREFIX + i);
    body.classList.remove(CLASS_PREFIX + 'custom');
    clearCustomVars();
    if (id === 'custom') {
      body.classList.add(CLASS_PREFIX + 'custom');
      applyCustomVars();
      localStorage.setItem(LS_KEY, 'custom');
      if (!silent) toast('Minimal：自定义配色');
    } else if (id >= '1' && id <= String(PRESET_COUNT)) {
      body.classList.add(CLASS_PREFIX + id);
      localStorage.setItem(LS_KEY, String(id));
      if (!silent) toast('Minimal Theme: ' + themeName(id));
    } else {
      localStorage.removeItem(LS_KEY);
      if (!silent) toast('Minimal Theme 已停用');
    }
    // 配色变更 → 通知宿主重算 vditor 主题（编辑器深浅 + 注入 CSS 跟随）
    syncEditorTheme();
  }

  /**
   * 归一化主题 id：'custom' 原样返回；可转 1-N 的数字（含 '1'..'4'）返回字符串；其余返回 '0'
   * @param {*} v 原始输入
   * @returns {string}
   */
  function normalizeId(v) {
    if (v === 'custom') return 'custom';
    var n = Number(v);
    return (n >= 1 && n <= PRESET_COUNT) ? String(n) : '0';
  }

  /**
   * 循环切换主题（顶栏按钮点击用）：停用 → 1 → 2 → 3 → 4 → 自定义 → 停用
   */
  function cycleTheme() {
    var saved = localStorage.getItem(LS_KEY) || '0';
    var order = ['0', '1', '2', '3', '4', 'custom'];
    var idx = order.indexOf(saved);
    if (idx < 0) idx = 0;
    applyTheme(order[(idx + 1) % order.length]);
  }

  /* ---------------- 顶栏悬浮主题列表下拉 ---------------- */

  /**
   * 判断悬浮即时列表开关是否开启（settings.hoverToolbar）
   * @returns {boolean}
   */
  function hoverEnabled() {
    return getSetting('hoverToolbar') !== 'false';
  }

  /**
   * 惰性构建下拉面板（首次悬浮时创建，后续复用）
   * @returns {Element} 下拉面板元素
   */
  function ensureDropdown() {
    if (dropdownEl && dropdownEl.parentNode) return dropdownEl;
    var el = document.createElement('div');
    el.className = 'mt-theme-dropdown';
    el.style.cssText = 'position:fixed;z-index:99999;min-width:180px;padding:6px;' +
      'display:none;pointer-events:auto;' +
      'background:var(--note-popover, #fff);color:var(--note-popover-foreground, #333);' +
      'border:1px solid var(--note-border, #ddd);border-radius:10px;' +
      'box-shadow:var(--note-shadow-2, 0 8px 24px -8px rgba(0,0,0,0.2));' +
      'font-size:13px;line-height:1.4;';
    el.innerHTML = '<div style="padding:6px 10px;font-weight:600;color:var(--note-ink-3,#888);' +
      'border-bottom:1px solid var(--note-border,#eee);margin-bottom:4px;">选择主题配色</div>' +
      THEMES.map(function (t) { return itemHTML(t.id, t.name); }).join('') +
      itemHTML('0', '停用');
    document.body.appendChild(el);
    // 面板内悬浮也保持打开：离开按钮进入面板不关闭
    el.addEventListener('mouseenter', cancelHide);
    el.addEventListener('mouseleave', scheduleHide);
    dropdownEl = el;
    return el;
  }

  /**
   * 生成下拉面板单个主题项 HTML（含当前选中态）
   * @param {string} id 主题 id
   * @param {string} name 主题名
   * @returns {string} HTML
   */
  function itemHTML(id, name) {
    var cur = localStorage.getItem(LS_KEY) || '';
    var active = (String(id) === String(cur)) ? '' : ' display:none;';
    return '<div class="mt-theme-item" data-mt-id="' + id + '" style="display:flex;align-items:center;gap:8px;' +
      'padding:7px 10px;border-radius:6px;cursor:pointer;color:var(--note-ink,#333);white-space:nowrap;">' +
      '<i data-lucide="' + (id === 'custom' ? 'palette' : 'circle-dot') + '" style="width:14px;height:14px;flex:none;' +
      'color:' + (id === 'custom' ? 'var(--note-brand,#7C6A52)' : 'var(--note-ink-3,#888)') + ';"></i>' +
      '<span style="flex:1;">' + name + '</span>' +
      '<i data-lucide="check" class="mt-check" style="width:14px;height:14px;flex:none;color:var(--note-brand,#7C6A52);' + active + '"></i>' +
      '</div>';
  }

  /**
   * 在指定顶栏按钮下方弹出主题列表下拉
   * @param {HTMLElement} btn 顶栏主题按钮
   */
  function showDropdown(btn) {
    if (!hoverEnabled()) return;
    var el = ensureDropdown();
    el.style.display = 'block';
    var r = btn.getBoundingClientRect();
    var w = el.offsetWidth || 180;
    // 靠近按钮左侧对齐，避免超出视口右/下边缘
    var left = Math.max(8, r.right - w);
    var top = r.bottom + 6;
    if (top + el.offsetHeight > window.innerHeight) top = r.top - el.offsetHeight - 6;
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    // lucide 图标刷新（动态追加后必须刷新才渲染出 svg）
    if (typeof refreshIcons === 'function') refreshIcons(el);
    else if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons({ scope: el });
  }

  /**
   * 隐藏下拉面板
   */
  function hideDropdown() {
    if (dropdownEl) dropdownEl.style.display = 'none';
  }

  /**
   * 取消延迟隐藏
   */
  function cancelHide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  }

  /**
   * 延迟隐藏（移入面板可取消）
   */
  function scheduleHide() {
    cancelHide();
    hideTimer = setTimeout(function () {
      if (dropdownEl) dropdownEl.style.display = 'none';
    }, 160);
  }

  /**
   * 给顶栏主题按钮绑定悬浮监听，按元素去重（ToolbarManager.render 会重建按钮 DOM，故每次针对新元素重绑）
   * @param {HTMLElement} btn 顶栏主题按钮
   */
  function bindHover(btn) {
    if (!btn || btn.__mtHoverBound) return;
    btn.__mtHoverBound = true;
    btnBound = true;
    btn.addEventListener('mouseenter', function () { cancelHide(); showDropdown(btn); });
    btn.addEventListener('mouseleave', scheduleHide);
  }

  /**
   * 查找并绑定顶栏主题按钮；未出现或后续有重建时，用常驻 MutationObserver 持续对新按钮重绑
   */
  function watchToolbar() {
    function tryBind() {
      var host = document.getElementById('plugin-toolbar');
      var btn = host && host.querySelector('[data-plugin-toolbar="' + PLUGIN_ID + ':toolbar"]');
      if (btn) { bindHover(btn); return btnBound; }
      return btnBound;
    }
    tryBind();
    if (typeof MutationObserver === 'undefined') return;
    var root = document.body || document.documentElement;
    if (!root) { document.addEventListener('DOMContentLoaded', watchToolbar); return; }
    var obs = new MutationObserver(function () { tryBind(); });
    obs.observe(root, { childList: true, subtree: true });
  }

  // 下拉面板项点击：应用对应主题并隐藏
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.mt-theme-item') : null;
    if (!el) return;
    var id = el.getAttribute('data-mt-id');
    applyTheme(id);
    hideDropdown();
  });

  // 插件设置变更（自定义配色字段 / hoverToolbar / 默认配色 / 编辑器主题配置）实时响应
  document.addEventListener('plugin-setting-changed', function (e) {
    var d = e.detail || {};
    if (!d || d.id !== PLUGIN_ID) return;
    var k = d.key || '';
    // 编辑器主题配置（每套深浅/注入开关/自定义css）变更 → 通知宿主重算 vditor 主题
    if (/^edTheme/.test(k) || k === 'injectCss' || k === 'extraCss') { syncEditorTheme(); return; }
    // 自定义配色色值变更：当前正处自定义主题时即时重套
    if (/^c[A-Z]/.test(k) && String(localStorage.getItem(LS_KEY) || '') === 'custom') {
      var body = document.body;
      if (body && body.classList.contains(CLASS_PREFIX + 'custom')) applyCustomVars();
      return;
    }
    // 默认配色变更：无已选主题时套用
    if (k === 'defaultTheme' && !localStorage.getItem(LS_KEY)) {
      applyTheme(mapDefaultToId(String(d.value)));
    }
  });

  /**
   * 把「默认配色方案」下拉值映射为主题 id
   * @param {string} label 下拉值（停用/纸白/亚麻/冷灰/墨绿/自定义配色）
   * @returns {string} 主题 id
   */
  function mapDefaultToId(label) {
    if (label === '自定义配色') return 'custom';
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === label) return THEMES[i].id;
    return '0';
  }

  // 插件启动时恢复上次主题（无显式选择时回退到「默认配色方案」设置）
  (function restore() {
    function applyIfReady(id) {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', function () { applyTheme(id, true); });
        return;
      }
      applyTheme(id, true);
    }
    var saved = localStorage.getItem(LS_KEY);
    if (saved) { applyIfReady(normalizeId(saved)); return; }
    var def = getSetting('defaultTheme');
    if (def) { var did = mapDefaultToId(String(def)); if (did !== '0') applyIfReady(did); }
  })();

  // 注册「编辑器主题解析器」给宿主：由宿主在应用 vditor 主题时调用（抽象，不直接调 vditor）
  (function registerResolver() {
    if (PluginAPI && typeof PluginAPI.registerEditorThemeResolver === 'function') {
      try { PluginAPI.registerEditorThemeResolver(editorThemeResolver); } catch (_) { /* 忽略注册异常 */ }
    }
  })();

  // 注册插件动作（宿主 PluginAPI.register 把 actionKey 映射到这里的函数）
  PluginAPI.register(PLUGIN_ID, {
    'cycle-theme': cycleTheme,
    'apply-1': function () { applyTheme(1); },
    'apply-2': function () { applyTheme(2); },
    'apply-3': function () { applyTheme(3); },
    'apply-4': function () { applyTheme(4); },
    'apply-custom': function () { applyTheme('custom'); },
    'disable': function () { applyTheme(0); }
  });

  // 绑定顶栏悬浮（含 MutationObserver 等待按钮出现）
  watchToolbar();
})();