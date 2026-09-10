/**
 * Minimal Theme 插件 — 极简主题切换
 * 作者: 火 冰
 *
 * 注册到 PluginAPI，宿主通过 materializePlugin → pluginManager.install 接入。
 * 切换方式：
 *   1. 内置 4 套配色（纸白/亚麻/冷灰/墨绿）→ html 添加 .mt-theme-N，由 styles.css 覆盖 CSS 变量
 *   2. 用户自建主题（可多个，带名称 + 13 项配色字段）→ html 添加 .mt-theme-custom + 插件内联注入全部 CSS 变量
 *   3. 旧「单一自定义配色」在首次读取时迁移为自建主题商店里 id='custom' 的条目，兼容既有行为
 * 首屏防闪烁：宿主 index.html head 的同步脚本会按 localStorage 前置恢复配色到 <html>（渲染前生效）；
 *   插件加载后在同一个 <html> 元素叠加刷新，切换时能正确清理，不残留、不闪默认配色。
 * 顶栏按钮：MutationObserver 监听 #plugin-toolbar，按钮悬浮时弹出可用主题列表下拉。
 * 设置页面：在「插件管理→最小主题→插件设置」区块注入主题画廊（圆形色块），支持添加/编辑/删除自建主题；
 *   内置主题（带（默认））双击只读查看，自建主题双击可编辑/删除。作者: 火 冰
 */
(function () {
  'use strict';

  var PLUGIN_ID = 'minimal-theme';
  var LS_KEY = 'note-app:minimal-theme';
  var CLASS_PREFIX = 'mt-theme-';
  var PRESET_COUNT = 4; // 内置 4 套配色
  var CUSTOMS_KEY = 'plugin:minimal-theme:customs'; // 自建主题商店（JSON 数组：{id,name,fields}）
  /** 统一主题列表循环的当前档位（配色 id/宿主模式/自建主题 id），供 cycle 准确定位下一步 */
  var CYCLE_STEP_KEY = 'note-app:minimal-theme:cycle-step';

  /** 主题清单：内置 4 套（自建主题经 readCustoms 动态并入列表） */
  var THEMES = [
    { id: '1', name: '纸白' },
    { id: '2', name: '亚麻' },
    { id: '3', name: '冷灰' },
    { id: '4', name: '墨绿' }
  ];

  /** 宿主明暗三态（并入主题列表，操作走 PluginAPI.theme，与宿主设置「外观」同一套） */
  var HOST_THEMES = [
    { mode: 'dark',  name: '深色',   icon: 'moon' },
    { mode: 'light', name: '浅色',   icon: 'sun' },
    { mode: 'auto',  name: '跟随系统', icon: 'monitor' }
  ];

  /** 主题配置字段定义（13 配色字段 + 自定义编辑器CSS）。弹框/自建主题共用同一份口径。 */
  var THEME_FIELD_DEFS = [
    { key: 'cBg',        label: '背景色',     type: 'color', default: '#FAF7F0' },
    { key: 'cCard',      label: '卡片背景',   type: 'color', default: '#F2EDE3' },
    { key: 'cSurface',   label: '表面/弹层',  type: 'color', default: '#F2EDE3' },
    { key: 'cBorder',    label: '边框/输入',  type: 'color', default: '#E0DBD0' },
    { key: 'cInk',       label: '主文字色',   type: 'color', default: '#3D3D3D' },
    { key: 'cInk3',      label: '次要文字',   type: 'color', default: '#9A9488' },
    { key: 'cLine',      label: '分隔线',     type: 'color', default: '#E0DBD0' },
    { key: 'cBrand',     label: '强调色',     type: 'color', default: '#7C6A52' },
    { key: 'cSurface2',  label: '表面次级',   type: 'color', default: '#E8E1D4' },
    { key: 'cInk2',      label: '中级文字',   type: 'color', default: '#6B6B5E' },
    { key: 'cGutterBg',  label: '行号列',     type: 'color', default: '#F5F0E8' },
    { key: 'cRing',      label: '强调环',     type: 'color', default: '#B8A890' },
    { key: 'cMutedFg',   label: '次要前景',   type: 'color', default: '#8A8478' },
    { key: 'cExtraCss',  label: '自定义编辑器CSS', type: 'text', default: '' }
  ];

  /** 配色字段（用于 buildCustomVars 的 13 项），不含 extraCss */
  var COLOR_FIELDS = THEME_FIELD_DEFS.filter(function (f) { return f.type === 'color'; }).map(function (f) { return f.key; });
  /** 全部 per-theme 字段 key（画廊中需隐藏其平铺行） */
  var PER_THEME_KEYS = THEME_FIELD_DEFS.map(function (f) { return f.key; });
  /** 配色字段 key → 默认值 */
  var COLOR_DEFAULTS = (function () {
    var m = {};
    THEME_FIELD_DEFS.forEach(function (f) { if (f.type === 'color') m[f.key] = f.default; });
    return m;
  })();

  /** 自建主题启用时注入到 body 的完整 CSS 变量集合 */
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
  /** 插件自身在切换宿主明暗（setHostTheme）时的忙标志，供宿主明暗观察者区分「插件操作」与「外部(设置-外观)变更」 */
  var mtHostBusy = false;

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
   * 读取指定自建主题的配色字段值
   * @param {Object} theme 自建主题 { id, name, fields }
   * @returns {Object} key → HEX 颜色字符串（缺失时用默认值）
   */
  function themeColors(theme) {
    var out = {};
    THEME_FIELD_DEFS.forEach(function (f) {
      var v = theme && theme.fields ? theme.fields[f.key] : null;
      out[f.key] = (v && String(v)) || f.default;
    });
    return out;
  }

  /**
   * 根据配色字段计算派生后的完整 CSS 变量集合
   * @param {Object} c 配色字段（13 配色 + cExtraCss）
   * @returns {Object} cssVar → 颜色值
   */
  function buildCustomVars(c) {
    return {
      '--note-background': c.cBg,
      '--note-foreground': c.cInk,
      '--note-card': c.cCard,
      '--note-card-foreground': c.cInk,
      '--note-surface': c.cSurface,
      '--note-surface-2': c.cSurface2,
      '--note-popover': c.cSurface,
      '--note-popover-foreground': c.cInk,
      '--note-muted': c.cCard,
      '--note-muted-foreground': c.cMutedFg,
      '--note-border': c.cBorder,
      '--note-input': c.cBorder,
      '--note-ring': c.cRing,
      '--note-gutter-bg': c.cGutterBg,
      '--note-ink': c.cInk,
      '--note-ink-2': c.cInk2,
      '--note-ink-3': c.cInk3,
      '--note-line': c.cLine,
      '--note-brand': c.cBrand,
      '--note-brand-500': c.cBrand,
      '--note-brand-600': c.cBrand,
      '--note-shadow-1': '0 1px 2px rgba(120, 110, 90, 0.06)',
      '--note-shadow-2': '0 8px 24px -8px rgba(120, 110, 90, 0.18)'
    };
  }

  /* 内置配色：从共享 SB_PALETTES 内联该配色全套变量到 <html>（内联优先，值与该配色 class 一致无冲突）。
   * 确保首屏 restore 清掉 head 前置变量后仍以该配色渲染、不闪宿主默认色——因为插件 styles.css 是
   * fetch 异步注入（可能晚于插件脚本执行），而 SB_PALETTES 为宿主同步资源，插件脚本执行时一定就绪。
   * 作者: 火 冰 */
  function applyBuiltinVars(id) {
    var root = document.documentElement;
    var SB = typeof window !== 'undefined' ? window.SB_PALETTES : null;
    var map = SB && SB.BUILTIN && SB.BUILTIN[String(id)];
    if (!root || !map) return;   // 无共享数据时仅靠 styles.css class（极端回退）
    Object.keys(map).forEach(function (k) { root.style.setProperty(k, map[k]); });
  }

  /* 向 <html> 内联写入某套配色（内置/自建）的全部 CSS 变量，并清掉此前的内联变量。
   * 目标固定为 documentElement：与宿主 index.html head 首屏前置恢复的对象一致，
   * 保证渲染前与插件刷新都在同一元素，切换时清理干净不残留。作者: 火 冰 */
  function applyColorVars(vars) {
    var root = document.documentElement;
    if (!root) return;
    clearCustomVars();
    Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
  }

  /** 应用一套配色（内置 id 或自建主题）的变量到 <html> */
  function applyThemeVars(themeId) {
    var id = String(themeId);
    var SB = typeof window !== 'undefined' ? window.SB_PALETTES : null;
    if (id >= '1' && id <= String(PRESET_COUNT) && SB && SB.BUILTIN && SB.BUILTIN[id]) {
      applyColorVars(SB.BUILTIN[id]);
      return true;
    }
    var custom = findCustom(id);
    if (custom) { applyColorVars(buildCustomVars(themeColors(custom))); return true; }
    return false;
  }

  /**
   * 清掉 <html> 上由主题写入的全部内联 CSS 变量
   */
  function clearCustomVars() {
    var root = document.documentElement;
    if (!root) return;
    CUSTOM_VAR_PROPS.forEach(function (k) { if (root.style.getPropertyValue(k)) root.style.removeProperty(k); });
  }

  /* ---------------- 自建主题商店 ---------------- */

  /**
   * 一次性迁移旧「单一自定义配色」为自建主题商店首个条目（id='custom'）
   * 旧口径的 cBg..cBrand/extraCss 存在时合并，避免既有配色丢失。
   * @returns {Array} 迁移后的自建主题数组（无旧配色→空数组）
   */
  function migrateLegacyCustom() {
    var any = false;
    COLOR_FIELDS.forEach(function (k) { if (getSetting(k)) any = true; });
    if (!any) return [];
    var theme = { id: 'custom', name: '自定义配色', fields: {} };
    THEME_FIELD_DEFS.forEach(function (f) {
      var v = getSetting(f.key);
      theme.fields[f.key] = (v && String(v)) || f.default;
    });
    writeCustoms([theme]);
    return [theme];
  }

  /**
   * 读取自建主题商店
   * @returns {Array<{id,name,fields}>} 自建主题数组（无则空；首次含旧单一自定义则迁移）
   */
  function readCustoms() {
    try {
      var raw = localStorage.getItem(CUSTOMS_KEY);
      if (raw) { var arr = JSON.parse(raw); if (Array.isArray(arr)) return arr; }
    } catch (_) { /* 解析失败回退迁移 */ }
    return migrateLegacyCustom();
  }

  /**
   * 写回自建主题商店
   * @param {Array} list 自建主题数组
   */
  function writeCustoms(list) {
    try { localStorage.setItem(CUSTOMS_KEY, JSON.stringify(list)); } catch (_) { /* 存储失败忽略 */ }
  }

  /**
   * 按 id 查找自建主题
   * @param {string} id 主题 id（含内置 id，内置返回 null）
   * @returns {Object|null} 自建主题对象或 null
   */
  function findCustom(id) {
    var list = readCustoms();
    for (var i = 0; i < list.length; i++) if (list[i].id === String(id)) return list[i];
    return null;
  }

  /**
   * 生成下一个自建主题 id（以现有最大后缀 +1；无则 c1）
   * @returns {string} 新 id，如 'c1'/'c2'
   */
  function nextCustomId() {
    var list = readCustoms();
    var max = 0;
    list.forEach(function (t) {
      var m = /^c(\d+)$/.exec(String(t.id));
      if (m) { var n = parseInt(m[1], 10); if (n > max) max = n; }
    });
    return 'c' + (max + 1);
  }

  /* ---------------- 编辑器（Vditor）主题联动：抽象 resolver，经宿主执行，不直接调 vditor ---------------- */

  /**
   * 把当前主题的配色数值映射成 vditor 的覆盖 CSS（「同步宿主配色到编辑器」）。
   * 「深色/浅色/跟随系统」只记录宿主明暗，编辑器按明暗套 vditor 深浅主题打底；
   * 在此基础上把当前生效的配色变量数值映射进 vditor 壳与内容层
   * （--note-background/--note-surface/--note-border/--note-ink/--note-brand 等，表格/引用/代码/链接/分隔线/callout 全覆盖），
   * 使编辑器颜色随主题色调整保持一致；并兜底 vditor 浅色默认文字（.vditor-reset 硬编码 #24292e）在深色下不可读的问题。
   * 作者: 火 冰
   * @returns {string} CSS 文本
   */
  function buildEditorCss() {
    return [
      // 壳：背景/表面/文字 —— 数值映射当前主题色
      'html body .vditor, html body .vditor .vditor-content, html body .vditor .vditor-sv, html body .vditor .vditor-ir, html body .vditor .vditor-wysiwyg, html body .vditor .vditor-preview, html body .vditor .vditor-reset { background-color: var(--note-background); color: var(--note-ink); }',
      // 覆盖 vditor 自己的边框变量：.vditor--dark 内 --border-color 固定近黑(#141414)，
      // 会让编辑器外框(1px solid var(--border-color))在浅色配皮下呈黑框且不受主题控制。
      // 这里把它挂到主题 --note-border，深浅配色下均随主题走。作者: 火 冰
      'html body .vditor { --border-color: var(--note-border); --resize-icon-color: var(--note-border); }',
      'html body .vditor .vditor-toolbar { background-color: var(--note-surface); border-bottom-color: var(--note-border); }',
      'html body .vditor-toolbar__item { color: var(--note-ink-3); }',
      'html body .vditor-toolbar__item:hover, html body .vditor-toolbar__item--active { background-color: var(--note-surface-2); color: var(--note-brand); }',
      'html body .vditor ::selection { background-color: var(--note-brand); color: var(--note-brand-ink); }',
      // 内容层：表格/引用/代码块/链接/分隔/卡片 —— 数值映射当前主题色
      'html body .vditor table { background-color: var(--note-background); color: var(--note-ink); border-color: var(--note-line); }',
      'html body .vditor table th { background-color: var(--note-card); color: var(--note-ink); border-color: var(--note-line); }',
      'html body .vditor table td { background-color: var(--note-background); color: var(--note-ink); border-color: var(--note-line); }',
      'html body .vditor table tbody tr:nth-child(2n) { background-color: var(--note-surface); }',
      'html body .vditor blockquote { background-color: var(--note-surface); border-left-color: var(--note-ring); color: var(--note-ink-2); }',
      'html body .vditor pre, html body .vditor code:not(.hljs) { background-color: var(--note-surface); color: var(--note-ink); border-color: var(--note-line); }',
      'html body .vditor pre code { background-color: transparent; color: inherit; }',
      'html body .vditor a { color: var(--note-brand); }',
      'html body .vditor hr { border-top-color: var(--note-line); }',
      'html body .vditor .vditor-callout { background-color: var(--note-card); border-left-color: var(--note-ring); color: var(--note-ink-2); }'
    ].join('\n');
  }

  /**
   * 编辑器主题解析器（注册给宿主）：编辑器按宿主明暗套 vditor 深浅主题打底，并把当前主题配色
   * 数值映射进编辑器（「同步宿主配色到编辑器」开关控制，默认开）。再叠加用户手写的「自定义编辑器CSS」。
   * 宿主（editor-vditor.js resolveVdTheme）调用，插件不直接操作 vditor。
   * 作者: 火 冰
   * @param {Object} hint { dark:boolean } 宿主当前是否暗色
   * @returns {Object} { theme:'dark'|'light', extraCss }
   */
  function editorThemeResolver(hint) {
    var css = '';
    if (getSetting('injectCss') !== 'false') css = buildEditorCss();
    var userCss = getSetting('extraCss');
    if (userCss) css = css ? css + '\n' + userCss : userCss;
    return { theme: (hint && hint.dark) ? 'dark' : 'light', extraCss: css };
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
   * 返回主题名称（内置/宿主明暗/自建主题）
   * @param {string} id 主题 id（'1'-'4' / 'custom' / 'cN'）
   * @returns {string}
   */
  function themeName(id) {
    var s = String(id);
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === s) return THEMES[i].name;
    for (var k = 0; k < HOST_THEMES.length; k++) if (HOST_THEMES[k].mode === s) return HOST_THEMES[k].name;
    var custom = findCustom(s);
    if (custom) return custom.name;
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
   * @param {string} themeId id：内置 '1'-'4'、自建主题 id（含既有 'custom'）；'0'/'undefined'/'停用' 表示停用
   * @param {boolean} [silent] 为 true 时不弹 Toast（启动静默恢复用）
   */
  function applyTheme(themeId, silent) {
    var root = document.documentElement;
    if (!root) return;
    var id = String(themeId === 'custom' ? 'custom' : themeId);
    localStorage.setItem(CYCLE_STEP_KEY, id); // 记录当前统一主题档位（配色/自建 id；宿主档由 setHostTheme 落）
    // 先清掉所有主题 class（mt-theme-1..4 + mt-theme-custom）与自定义内联变量
    for (var i = 1; i <= PRESET_COUNT; i++) root.classList.remove(CLASS_PREFIX + i);
    root.classList.remove(CLASS_PREFIX + 'custom');
    // 清掉残留的配色内联变量（内联优先级高于宿主 .dark/.light 类规则）：
    // 切到宿主明暗档（深/浅/跟随系统，id='0'）或停用时若不清理，旧配色变量仍占位，
    // 会盖死宿主外观深浅切换——即「设置-外观-主题模式没反应」的根因。作者: 火 冰
    clearCustomVars();
    var applied = applyThemeVars(id);
    if (id >= '1' && id <= String(PRESET_COUNT)) {
      root.classList.add(CLASS_PREFIX + id);
      localStorage.setItem(LS_KEY, String(id));
      if (!silent) toast('Minimal Theme: ' + themeName(id));
    } else if (applied) {
      root.classList.add(CLASS_PREFIX + 'custom');
      localStorage.setItem(LS_KEY, id);
      if (!silent) toast('Minimal：' + themeName(id));
    } else {
      // 无该配色 → 停用（此分支仅由切换宿主明暗档（applyStep）停用配色时触发）
      localStorage.removeItem(LS_KEY);
    }
    // 配色变更 → 通知宿主重算 vditor 主题（编辑器深浅 + 注入 CSS 跟随）
    syncEditorTheme();
  }

  /**
   * 归一化主题 id：内置 1-N 返回字符串；自建主题 id（custom/cN）原样；其余返回 '0'
   * @param {*} v 原始输入
   * @returns {string}
   */
  function normalizeId(v) {
    if (v === 'custom') return 'custom';
    if (typeof v === 'string' && /^c\d+$/.test(v)) return v;
    var n = Number(v);
    return (n >= 1 && n <= PRESET_COUNT) ? String(n) : '0';
  }

  /** 读取当前宿主外观主题模式（'dark'|'light'|'auto'），优先走 PluginAPI.theme 抽象 */
  function getHostMode() {
    try {
      if (PluginAPI && PluginAPI.theme && typeof PluginAPI.theme.get === 'function') {
        return PluginAPI.theme.get();
      }
    } catch (_) { /* 忽略抽象不可用 */ }
    return localStorage.getItem('note-app:theme') || 'dark';
  }

  /**
   * 应用宿主外观主题（深色/浅色/跟随系统）。
   * 经 PluginAPI.theme.set 收口到宿主 setTheme —— 与设置页「外观」主题卡片是同一套操作，插件不直接改宿主 state。
   * @param {string} mode 'dark'|'light'|'auto'
   */
  function setHostTheme(mode) {
    localStorage.setItem(CYCLE_STEP_KEY, mode);
    if (PluginAPI && PluginAPI.theme && typeof PluginAPI.theme.set === 'function') {
      mtHostBusy = true;
      try { PluginAPI.theme.set(mode); } finally { mtHostBusy = false; }
    }
  }

  /** 返回当前 Minimal 主题 id（'0'=停用 / '1'-'4' / 自建主题 id） */
  function activeThemeId() {
    var v = localStorage.getItem(LS_KEY) || '0';
    var id = normalizeId(v);
    // 自建主题被删除后，其 id 落入 '0' 之外时落地为空
    return (id === v) ? id : '0';
  }

  /**
   * 应用统一「主题列表」中的某一档。
   * 宿主明暗档走宿主抽象并停用配色（主题列表二选一，保证循环线性）；配色/自建档走 applyTheme。
   * @param {string} step 'dark'|'light'|'auto'（宿主档）或配色/自建 id
   */
  function applyStep(step) {
    if (step === 'dark' || step === 'light' || step === 'auto') {
      applyTheme(0); // 先停用配色（落 '0'）
      setHostTheme(step); // 再切宿主明暗，覆盖档位为宿主模式（cycle-step 最终 = 宿主档）
    } else applyTheme(step);
  }

  /**
   * 循环切换统一主题列表（顶栏按钮 / 快捷键 cycle-theme）：
   * 深色 → 浅色 → 跟随系统 → 内置4套 → 自建主题们 → 深色 …
   * 配色/自建档不改宿主明暗；宿主明暗档（深/浅/跟随）会停用配色——列表二选一，循环干净不冲突。
   */
  function cycleTheme() {
    var colorOrder = ['1', '2', '3', '4'].concat(readCustoms().map(function (t) { return t.id; }));
    var order = ['dark', 'light', 'auto'].concat(colorOrder);
    // 用记录的当前档位定位；无记录时按现状推断
    var last = localStorage.getItem(CYCLE_STEP_KEY);
    var idx = order.indexOf(last);
    if (idx < 0) {
      var cid = activeThemeId();
      if (cid !== '0') idx = order.indexOf(cid);
      else idx = Math.max(0, order.indexOf(getHostMode()));
      if (idx < 0) idx = 0;
    }
    applyStep(order[(idx + 1) % order.length]);
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
   * 生成下拉面板完整 HTML（主题分组 + 宿主明暗三态 + 配色列表）。每次显示时重建，
   * 保证「当前选中」的对勾位置始终与实时状态一致（排它单选、选中打钩）。作者: 火 冰
   * @returns {string} HTML
   */
  function dropdownHTML() {
    var colorItems = THEMES.map(function (t) { return itemHTML(t.id, t.name); });
    readCustoms().forEach(function (t) { colorItems.push(itemHTML(t.id, t.name)); });
    return '<div style="padding:6px 10px;font-weight:600;color:var(--note-ink-3,#888);' +
      'border-bottom:1px solid var(--note-border,#eee);margin-bottom:4px;">Theme</div>' +
      '<div style="padding:4px 10px;font-size:12px;color:var(--note-ink-3,#888);">Host 明暗</div>' +
      HOST_THEMES.map(function (t) { return hostItemHTML(t.mode, t.name, t.icon); }).join('') +
      '<div style="padding:4px 10px;font-size:12px;color:var(--note-ink-3,#888);margin-top:4px;">配色</div>' +
      colorItems.join('');
  }

  /**
   * 惰性构建下拉面板（首次悬浮时创建，后续复用外壳；内容在每次显示时刷新）
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
    el.innerHTML = dropdownHTML();
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
    var cur = activeThemeId();
    var active = (String(id) === String(cur)) ? '' : ' display:none;';
    var isCustom = (String(id) === 'custom' || /^c\d+$/.test(String(id)));
    return '<div class="mt-theme-item" data-mt-id="' + id + '" style="display:flex;align-items:center;gap:8px;' +
      'padding:7px 10px;border-radius:6px;cursor:pointer;color:var(--note-ink,#333);white-space:nowrap;">' +
      '<i data-lucide="' + (isCustom ? 'palette' : 'circle-dot') + '" style="width:14px;height:14px;flex:none;' +
      'color:' + (isCustom ? 'var(--note-brand,#7C6A52)' : 'var(--note-ink-3,#888)') + ';"></i>' +
      '<span style="flex:1;">' + name + '</span>' +
      '<i data-lucide="check" class="mt-check" style="width:14px;height:14px;flex:none;color:var(--note-brand,#7C6A52);' + active + '"></i>' +
      '</div>';
  }

  /**
   * 生成下拉面板单个「宿主明暗」项 HTML（选中态对照 PluginAPI.theme.get()）
   * @param {string} mode 'dark'|'light'|'auto'
   * @param {string} name 显示名
   * @param {string} icon lucide 图标名
   * @returns {string} HTML
   */
  function hostItemHTML(mode, name, icon) {
    var cur = getHostMode();
    var active = (String(mode) === String(cur)) ? '' : ' display:none;';
    return '<div class="mt-theme-item" data-mt-mode="' + mode + '" style="display:flex;align-items:center;gap:8px;' +
      'padding:7px 10px;border-radius:6px;cursor:pointer;color:var(--note-ink,#333);white-space:nowrap;">' +
      '<i data-lucide="' + icon + '" style="width:14px;height:14px;flex:none;color:var(--note-ink-3,#888);"></i>' +
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
    // 每次显示都重建内容：让「当前选中」对勾紧随实时主题（深/浅/跟随系统与配色的排它单显）作者: 火 冰
    el.innerHTML = dropdownHTML();
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

  /* ---------------- 设置页主题画廊：圆形色块 + 添加/编辑/删除 ---------------- */

  /**
   * 获取内置主题的代表色（圆形色块的背景色与边框色）
   * @param {string} id 内置主题 id '1'-'4'
   * @returns {{bg:string,border:string}} 背景色/边框色
   */
  function builtinSwatchColor(id) {
    var SB = typeof window !== 'undefined' ? window.SB_PALETTES : null;
    var m = SB && SB.BUILTIN && SB.BUILTIN[id];
    return { bg: (m && m['--note-background']) || '#FAF7F0', border: (m && m['--note-border']) || '#E0DBD0' };
  }

  /**
   * 取某主题（内置/自建）的代表色：自建取首配色字段，内置取 SB_PALETTES
   * @param {Object} theme 主题项 { id, name, isDefault?, fields? }
   * @returns {{bg:string,border:string}}
   */
  function swatchColor(theme) {
    if (!theme.isDefault) {
      var c = themeColors(theme);
      return { bg: c.cBg, border: c.cBorder };
    }
    return builtinSwatchColor(theme.id);
  }

  /**
   * 当前设置页画廊容器的「插件设置」`<section>`（含 data-pid 平铺行的祖先 section）
   * @returns {Element|null}
   */
  function findSettingsSection() {
    var scope = document.querySelector('[data-pm-body="minimal-theme"]');
    var base = scope || document;
    var row = base.querySelector('[data-pid="minimal-theme"][data-pkey]');
    if (!row) return null;
    var sec = row;
    while (sec && sec.tagName !== 'SECTION') sec = sec.parentElement;
    return sec;
  }

  /**
   * 构建主题画廊 HTML（圆形色块 + 名称 + 添加按钮）
   * @returns {string}
   */
  function galleryHTML() {
    var active = activeThemeId();
    var items = [];
    // 内置主题：名后带（默认），只读
    THEMES.forEach(function (t) {
      var sc = builtinSwatchColor(t.id);
      var act = (t.id === active);
      items.push(swatchHTML({ id: t.id, name: t.name + '（默认）', active: act, readonly: true, isDefault: true,
        bg: sc.bg, border: sc.border }));
    });
    // 自建主题：可编辑/删除
    readCustoms().forEach(function (t) {
      var c = themeColors(t);
      var act = (t.id === active);
      items.push(swatchHTML({ id: t.id, name: t.name, active: act, readonly: false, isDefault: false,
        bg: c.cBg, border: c.cBorder }));
    });
    return '<div class="mt-gallery">'
      + '<div class="mt-gallery-head">'
      + '<span style="font-size:13px;font-weight:600;color:var(--note-ink,#333);">主题</span>'
      + '<button type="button" class="mt-gallery-add" style="display:inline-flex;align-items:center;gap:4px;'
      + 'padding:4px 10px;border-radius:6px;font-size:12px;cursor:pointer;'
      + 'background:var(--note-brand-600,#6B5A44);color:#FFFFFF;border:none;">+ 添加</button>'
      + '</div>'
      + '<div class="mt-gallery-items" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:10px;margin-top:10px;">'
      + items.join('')
      + '</div></div>';
  }

  /**
   * 生成单个圆形主题块 HTML
   * @param {Object} o { id,name,active,readonly,bg,border }
   * @returns {string}
   */
  function swatchHTML(o) {
    return '<div class="mt-swatch" data-mt-id="' + o.id + '" data-mt-default="' + (o.isDefault ? '1' : '0') + '"'
      + ' title="' + (o.isDefault ? '双击查看（默认主题，仅查看）' : '双击编辑') + '"'
      + ' style="display:flex;flex-direction:column;align-items:center;gap:6px;cursor:pointer;'
      + 'padding:8px 4px;border-radius:8px;border:1px solid transparent;'
      + (o.active ? 'box-shadow:0 0 0 2px var(--note-brand,#7C6A52);border-color:var(--note-brand,#7C6A52);' : '')
      + '">'
      + '<span class="mt-swatch-dot" style="width:36px;height:36px;border-radius:50%;'
      + 'background:' + o.bg + ';'
      + 'border:2px solid ' + o.border + ';'
      + 'box-sizing:border-box;"></span>'
      + '<span class="mt-swatch-name" style="font-size:11px;line-height:1.2;text-align:center;'
      + 'color:var(--note-ink,#333);word-break:break-all;">' + o.name + '</span>'
      + '</div>';
  }

  /**
   * 同步「默认配色方案」下拉，把自建主题名补进 options（内置名保持宿主静态）
   * @param {Element} sec 插件设置 section
   */
  function syncDefaultThemeOptions(sec) {
    var sel = sec && sec.querySelector('[data-pid="minimal-theme"][data-pkey="defaultTheme"]');
    if (!sel) return;
    var customNames = readCustoms().map(function (t) { return String(t.name); });
    var existing = Array.prototype.map.call(sel.options, function (o) { return o.text; });
    customNames.forEach(function (n) {
      if (existing.indexOf(n) === -1) {
        var op = document.createElement('option');
        op.textContent = n;
        sel.appendChild(op);
      }
    });
  }

  /**
   * 在「插件设置」区块注入主题画廊：
   *   - 隐藏 per-theme 平铺字段行（13 配色 + extraCss），保留公共设置行
   *   - 在区块顶部插入主题画廊（数组件）
   * 幂等：已注入过（区块含 data-mt-gallery）则跳过
   * @param {Element} root 观察/渲染根节点（document）
   */
  function injectSettingsGallery(root) {
    var doc = root && root.nodeType === 9 ? root : document;
    var sec = findSettingsSection();
    if (!sec) return;
    if (sec.querySelector('[data-mt-gallery]')) return;
    // 隐藏 per-theme 平铺行
    sec.querySelectorAll('[data-pid="minimal-theme"][data-pkey]').forEach(function (el) {
      if (PER_THEME_KEYS.indexOf(el.getAttribute('data-pkey')) !== -1) {
        var row = el;
        // 逐级向上找“字段行”容器（含 label 的 div），最坏隐藏控件本身
        for (var i = 0; i < 3 && row; i++) {
          if (row.classList && row.classList.contains('flex')) break;
          row = row.parentElement;
        }
        if (row) row.style.display = 'none';
      }
    });
    // 插入画廊到「插件设置」标题之后
    var heading = null;
    Array.prototype.forEach.call(sec.querySelectorAll('div'), function (d) {
      if (!heading && d.textContent && d.textContent.trim() === '插件设置') heading = d;
    });
    var gal = doc.createElement('div');
    gal.setAttribute('data-mt-gallery', '1');
    gal.className = 'mt-gallery-wrap';
    gal.style.cssText = 'padding-top:6px;';
    gal.innerHTML = galleryHTML();
    if (heading && heading.nextSibling) sec.insertBefore(gal, heading.nextSibling);
    else sec.insertBefore(gal, sec.firstChild);
    syncDefaultThemeOptions(sec);
    bindGallery(gal);
  }

  /**
   * 绑定画廊交互：点圆块应用主题；双击打开弹框；点「添加」新建
   * @param {Element} gal 画廊容器
   */
  function bindGallery(gal) {
    var addBtn = gal.querySelector('.mt-gallery-add');
    if (addBtn) addBtn.addEventListener('click', function () { openThemeDialog(null); });
    gal.querySelectorAll('.mt-swatch').forEach(function (sw) {
      sw.addEventListener('click', function () { applyTheme(sw.getAttribute('data-mt-id')); });
      sw.addEventListener('dblclick', function () { openThemeDialogForSwatch(sw); });
    });
  }

  /**
   * 打开一个圆形块的弹框：内置只读查看，自建可编辑/删除
   */
  function openThemeDialogForSwatch(sw) {
    var id = sw.getAttribute('data-mt-id');
    var isDefault = sw.getAttribute('data-mt-default') === '1';
    if (isDefault) { openThemeDialog({ id: id, name: themeName(id), isDefault: true, readonly: true }, true); }
    else { var theme = findCustom(id); if (theme) openThemeDialog(theme, false); }
  }

  /**
   * 打开主题编辑/查看弹框（遮罩，复用宿主弹层样式）。
   * @param {Object|null} theme 现有主题或 null（新建）
   * @param {boolean} [forceReadonly] 为 true 表示只读查看（内置主题）
   */
  function openThemeDialog(theme, forceReadonly) {
    var isNew = !theme;
    var readonly = !!forceReadonly;
    var ov = document.createElement('div');
    ov.id = 'mt-theme-overlay';
    ov.className = 'fixed inset-0 z-50 flex items-center justify-center';
    ov.style.cssText = 'background:rgba(0,0,0,0.45);';
    var colors = theme ? themeColors(theme) : null;
    var title = isNew ? '添加主题' : (readonly ? '主题设置（默认，仅查看）' : '编辑主题');
    var nameVal = theme ? String(theme.name || '') : '';
    var fieldsHtml = THEME_FIELD_DEFS.map(function (f) {
      var val = colors ? String(colors[f.key]) : String(f.default || '');
      var ctrl;
      if (f.type === 'color') {
        ctrl = '<input type="color" data-mt-f="' + f.key + '" value="' + val + '"'
          + (readonly ? ' disabled' : '')
          + ' style="width:44px;height:28px;padding:2px;background:var(--note-surface-2,#eee);border:1px solid var(--note-border,#ddd);border-radius:6px;cursor:pointer;">';
      } else {
        ctrl = '<input type="text" data-mt-f="' + f.key + '" value="' + val + '"'
          + (readonly ? ' disabled' : '')
          + ' placeholder="如 .vditor { font-family: serif; }"'
          + ' style="flex:1;min-width:0;padding:6px 8px;border-radius:6px;font-size:12px;outline:none;background:var(--note-surface-2,#eee);border:1px solid var(--note-border,#ddd);color:var(--note-ink,#333);">';
      }
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">'
        + '<span style="font-size:12px;color:var(--note-ink,#333);white-space:nowrap;">' + f.label + '</span>'
        + ctrl + '</div>';
    }).join('<span style="height:8px;"></span>');
    var canDelete = !isNew && !readonly;
    ov.innerHTML =
      '<div style="width:400px;max-width:92vw;max-height:84vh;overflow:auto;border-radius:12px;'
      + 'border:1px solid var(--note-border,#ddd);padding:16px;'
      + 'background:var(--note-surface,#fff);color:var(--note-ink,#333);'
      + 'box-shadow:0 12px 40px rgba(0,0,0,0.35);">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">'
      + '<h3 style="font-size:15px;font-weight:600;">' + title + '</h3>'
      + '<button type="button" class="mt-form-close" style="width:28px;height:28px;display:flex;align-items:center;justify-content:center;border:none;background:transparent;color:var(--note-ink-3,#888);cursor:pointer;font-size:16px;" aria-label="关闭">&times;</button>'
      + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">'
      + '<span style="font-size:12px;color:var(--note-ink,#333);white-space:nowrap;">主题名称</span>'
      + '<input type="text" data-mt-f="name" value="' + nameVal + '"' + (readonly ? ' disabled' : '')
      + ' placeholder="输入主题名称"'
      + ' style="flex:1;min-width:0;padding:6px 8px;border-radius:6px;font-size:12px;outline:none;background:var(--note-surface-2,#eee);border:1px solid var(--note-border,#ddd);color:var(--note-ink,#333);">'
      + '</div>'
      + '<div style="display:flex;flex-direction:column;gap:8px;">' + fieldsHtml + '</div>'
      + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">'
      + (canDelete ? '<button type="button" class="mt-form-del" style="margin-right:auto;padding:6px 12px;border-radius:6px;font-size:12px;color:#EF4444;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.35);cursor:pointer;">删除</button>' : '')
      + (readonly ? '' : '<button type="button" class="mt-form-cancel" style="padding:6px 12px;border-radius:6px;font-size:12px;color:var(--note-ink-2,#555);background:var(--note-surface-2,#eee);border:1px solid var(--note-border,#ddd);cursor:pointer;">取消</button>')
      + (!readonly && '<button type="button" class="mt-form-save" style="padding:6px 16px;border-radius:6px;font-size:12px;color:#FFF;background:var(--note-brand-600,#6B5A44);border:none;cursor:pointer;font-weight:600;">' + (isNew ? '创建' : '保存') + '</button>')
      + '</div></div>';
    document.body.appendChild(ov);
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
    // 关闭
    var close = function () { if (ov.parentNode) ov.parentNode.removeChild(ov); };
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    ov.querySelector('.mt-form-close').addEventListener('click', close);
    var cancelBtn = ov.querySelector('.mt-form-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', close);
    var saveBtn = ov.querySelector('.mt-form-save');
    if (saveBtn) saveBtn.addEventListener('click', function () { saveThemeDialog(ov, theme, readonly); });
    var delBtn = ov.querySelector('.mt-form-del');
    if (delBtn) delBtn.addEventListener('click', function () { deleteThemeDialog(ov, theme); });
  }

  /**
   * 保存弹框内容：校验名称 → 写入自建主题商店 → 刷新画廊 → 若当前在用重套
   * @param {Element} ov 弹框
   * @param {Object|null} theme 现有主题（编辑）或 null（新建）
   * @param {boolean} readonly 只读则直接关
   */
  function saveThemeDialog(ov, theme, readonly) {
    if (readonly) { if (ov.parentNode) ov.parentNode.removeChild(ov); return; }
    var nameEl = ov.querySelector('[data-mt-f="name"]');
    var name = (nameEl && nameEl.value || '').trim();
    if (!name) { toast('请填写主题名称'); return; }
    var fields = {};
    THEME_FIELD_DEFS.forEach(function (f) {
      var el = ov.querySelector('[data-mt-f="' + f.key + '"]');
      fields[f.key] = (el && el.value) || f.default;
    });
    var list = readCustoms();
    var id = theme ? String(theme.id) : nextCustomId();
    // 重名校验（排除当前自身）
    var dup = list.some(function (t) { return t.id !== id && String(t.name) === name; });
    if (dup) { toast('已存在同名主题'); return; }
    var entry = { id: id, name: name, fields: fields };
    list = list.filter(function (t) { return t.id !== id; });
    list.push(entry);
    writeCustoms(list);
    toast(theme ? '已保存主题：' + name : '已创建主题：' + name);
    // 若当前正用该主题，保存色值后需重套配色（名称不变，id 仍有效）
    if (activeThemeId() === id) { applyTheme(id, true); }
    else if (!theme) { /* 新建主题不自动切换，保持当前主题 */ }
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    refreshGalleryAndSettings();
  }

  /**
   * 删除弹框内容：确认删除自建主题 → 刷新画廊；若当前在用则回退默认配色
   */
  function deleteThemeDialog(ov, theme) {
    var id = String(theme.id);
    if (!window.confirm) { /* 无 confirm 环境直接删 */ }
    else if (!window.confirm('确认删除主题「' + theme.name + '」？')) return;
    var list = readCustoms().filter(function (t) { return t.id !== id; });
    writeCustoms(list);
    toast('已删除主题：' + theme.name);
    if (activeThemeId() === id) {
      // 当前在用被删 → 回退「默认配色方案」
      applyTheme(0);
    }
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    refreshGalleryAndSettings();
  }

  /**
   * 重建画廊（刷新圆形色块与默认配色下拉）。设置面板可能在重建中，容错：找不到 section 就算了。
   */
  function refreshGalleryAndSettings() {
    var sec = findSettingsSection();
    if (!sec) return;
    var wrap = sec.querySelector('[data-mt-gallery]');
    if (!wrap) return;
    var gal = document.createElement('div');
    gal.setAttribute('data-mt-gallery', '1');
    gal.className = 'mt-gallery-wrap';
    gal.style.cssText = 'padding-top:6px;';
    gal.innerHTML = galleryHTML();
    wrap.parentNode.replaceChild(gal, wrap);
    syncDefaultThemeOptions(sec);
    bindGallery(gal);
  }

  // 下拉面板项点击：宿主明暗档（并停用配色）或配色档，选完隐藏
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('.mt-theme-item') : null;
    if (!el) return;
    var mode = el.getAttribute('data-mt-mode');
    if (mode) { setHostTheme(mode); applyTheme(0); }
    else applyTheme(el.getAttribute('data-mt-id'));
    hideDropdown();
  });

  // 插件设置变更（自定义配色字段 / hoverToolbar / 默认配色 / 编辑器主题配置 / 自建主题）实时响应
  document.addEventListener('plugin-setting-changed', function (e) {
    var d = e.detail || {};
    if (!d || d.id !== PLUGIN_ID) return;
    var k = d.key || '';
    // 编辑器主题配置（注入开关/自定义css）变更 → 通知宿主重算 vditor 主题
    if (k === 'injectCss' || k === 'extraCss') { syncEditorTheme(); return; }
    // 公共设置行（defaultTheme/hoverToolbar）无额外即时侧效
    if (k === 'hoverToolbar' || k === 'defaultTheme') return;
    // 其余均属 per-theme 字段（旧单自定义 / 弹框已转自建商店，平铺行已隐藏），若当前在用自建主题则忽略
    if (!findCustom(activeThemeId())) {
      // 旧兼容：仅在活动档为旧 'custom' 时按字段重套
      if (String(localStorage.getItem(LS_KEY) || '') === 'custom') {
        var custom = findCustom('custom');
        if (custom) applyThemeVars('custom');
      }
    }
  });

  /**
   * 把「默认配色方案」下拉值映射为主题 id（内置/自建）
   * @param {string} label 下拉值（纸白/亚麻/冷灰/墨绿/自建主题名）
   * @returns {string} 主题 id
   */
  function mapDefaultToId(label) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].name === label) return THEMES[i].id;
    var list = readCustoms();
    for (var j = 0; j < list.length; j++) if (String(list[j].name) === label) return list[j].id;
    return '0';
  }

  // 首屏主题由 index.html head 同步脚本「按 localStorage 读取数据渲染一次」完成（宿主明暗 + 配色），
  // 插件启动**不再自动套用主题**（不开 restore/applyTheme），避免与首帧渲染重复、二次设置。
  // 例外：自建主题（id 为 cN）的完整配色仅存于本插件商店，宿主 head 无其数据源，故启动时由插件补齐，
  // 保证画廊创建的主题在重载后仍以自身配色渲染、不闪宿主默认色。
  // 内置 1-4 与旧 custom 仍由 head 前置恢复，不在此重复应用（保持「一次设置、一次渲染」）。作者: 火 冰
  (function restoreCustomTheme() {
    var id = activeThemeId();
    if (/^c\d+$/.test(id) && findCustom(id)) applyTheme(id, true);
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
    'apply-custom': function () { applyTheme('custom'); }
  });

  // 绑定顶栏悬浮（含 MutationObserver 等待按钮出现）
  watchToolbar();
  // 设置页画廊注入（设置面板重渲染后也会经 observer 重建）
  if (typeof MutationObserver !== 'undefined') {
    var _root = document.body || document.documentElement;
    if (_root) {
      injectSettingsGallery(_root);
      var galleryObs = new MutationObserver(function () { injectSettingsGallery(_root); });
      galleryObs.observe(_root, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', injectGalleryLater);
    }
  }
  function injectGalleryLater() { injectSettingsGallery(document); }

  /* 宿主「外观-主题模式」变更（设置-外观主题卡片 / 宿主 toggle）→ 遵循排它：清掉插件钉住的配色内联变量，
   * 保证深/浅/跟随系统真正生效。根因：配色内联变量写进 <html>，优先级高于宿主 .dark/.light 类规则，
   * 会盖死宿主明暗；而「设置-外观」走宿主 setTheme 不经插件 applyTheme，需在此兜底清理。
   * 仅观察 data-theme / data-theme-mode 属性（宿主题模式变更才写），配色应用不触碰，故不会误清。
   * 作者: 火 冰 */
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    var hostRoot = document.documentElement;
    var hostObs = new MutationObserver(function () {
      if (mtHostBusy) return; // 插件自身 setHostTheme 已按流程清配色，忽略本次属性变化
      clearCustomVars();
      for (var i2 = 1; i2 <= PRESET_COUNT; i2++) hostRoot.classList.remove(CLASS_PREFIX + i2);
      hostRoot.classList.remove(CLASS_PREFIX + 'custom');
      localStorage.removeItem(LS_KEY);
    });
    hostObs.observe(hostRoot, { attributes: true, attributeFilter: ['data-theme', 'data-theme-mode'] });
  }
})();