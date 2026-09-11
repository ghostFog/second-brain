/* ============================================
 * 主题配色统一数据源（宿主 index.html 首屏 + minimal-theme 插件共用）
 * 作者: 火 冰
 *
 * 为什么需要它：
 *   内置配色此前只在插件 styles.css（fetch 异步注入）里定义。首屏若只加 class，在插件样式
 *   就绪前会闪宿主默认色。于是把这些配色集中到 window.SB_PALETTES，宿主 head 的同步脚本在
 *   CSS 之前引用于渲染前内联，插件应用时也读同一份值，从而「渲染前前置恢复」与「插件应用」
 *   永远取一致的数据，不再依赖 styles.css 的加载时机。
 * ============================================ */
(function (global) {
  'use strict';

  /** 自定义配色注入到 <html> 的完整 CSS 变量集合（head 与插件共用，避免新旧交错不一致） */
  var CUSTOM_VAR_PROPS = [
    '--note-background', '--note-foreground', '--note-card', '--note-card-foreground',
    '--note-surface', '--note-surface-2', '--note-popover', '--note-popover-foreground',
    '--note-muted', '--note-muted-foreground', '--note-border', '--note-input',
    '--note-ring', '--note-gutter-bg', '--note-ink', '--note-ink-2', '--note-ink-3',
    '--note-line', '--note-brand', '--note-brand-50', '--note-brand-100', '--note-brand-200',
    '--note-brand-300', '--note-brand-400', '--note-brand-500', '--note-brand-600',
    '--note-brand-700', '--note-brand-800', '--note-brand-900', '--note-brand-950',
    '--note-primary', '--note-primary-foreground', '--note-brand-ink', '--note-line-active',
    '--note-shadow-1', '--note-shadow-2', '--note-shadow-3'
  ];

  /** 自定义配色可调字段：key → { label, cssVar, default }。
   *  与插件 main.js 的 THEME_FIELD_DEFS 对齐，覆盖 base.css 深/浅模式的全部语义色令牌，
   *  使自建主题与内置明暗主题的完整度一致（23 配色）。作者: 火 冰 */
  var CUSTOM_FIELDS = [
    { key: 'cBg',        label: '背景色',     cssVar: '--note-background',          default: '#FAF7F0' },
    { key: 'cForeground', label: '前景色',    cssVar: '--note-foreground',          default: '#3D3D3D' },
    { key: 'cCard',      label: '卡片背景',   cssVar: '--note-card',                default: '#F2EDE3' },
    { key: 'cCardForeground', label: '卡片前景', cssVar: '--note-card-foreground',  default: '#3D3D3D' },
    { key: 'cSurface',   label: '表面',       cssVar: '--note-surface',             default: '#F2EDE3' },
    { key: 'cSurface2',  label: '表面次级',   cssVar: '--note-surface-2',           default: '#E8E1D4' },
    { key: 'cPopover',   label: '弹层背景',   cssVar: '--note-popover',             default: '#F2EDE3' },
    { key: 'cPopoverForeground', label: '弹层前景', cssVar: '--note-popover-foreground', default: '#3D3D3D' },
    { key: 'cMuted',     label: '弱化背景',   cssVar: '--note-muted',               default: '#F2EDE3' },
    { key: 'cMutedFg',   label: '弱化前景',   cssVar: '--note-muted-foreground',    default: '#8A8478' },
    { key: 'cBorder',    label: '边框',       cssVar: '--note-border',              default: '#E0DBD0' },
    { key: 'cInput',     label: '输入框',     cssVar: '--note-input',               default: '#E0DBD0' },
    { key: 'cRing',      label: '强调环',     cssVar: '--note-ring',                default: '#B8A890' },
    { key: 'cGutterBg',  label: '行号列',     cssVar: '--note-gutter-bg',           default: '#F5F0E8' },
    { key: 'cInk',       label: '主文字',     cssVar: '--note-ink',                 default: '#3D3D3D' },
    { key: 'cInk2',      label: '中等文字',   cssVar: '--note-ink-2',               default: '#6B6B5E' },
    { key: 'cInk3',      label: '次要文字',   cssVar: '--note-ink-3',               default: '#9A9488' },
    { key: 'cLine',      label: '分隔线',     cssVar: '--note-line',                default: '#E0DBD0' },
    { key: 'cLineActive', label: '当前行高亮', cssVar: '--note-line-active',         default: '#E9E5DA' },
    { key: 'cBrand',     label: '强调色',     cssVar: '--note-brand',               default: '#7C6A52' },
    { key: 'cBrandInk',  label: '强调色文字', cssVar: '--note-brand-ink',           default: '#FFFFFF' },
    { key: 'cPrimary',   label: '主操作色',   cssVar: '--note-primary',             default: '#6B5A44' },
    { key: 'cPrimaryForeground', label: '主操作前景', cssVar: '--note-primary-foreground', default: '#FFFFFF' }
  ];

  /** 内置 4 套配色：themeId → 完整 CSS 变量（与 plugins/minimal-theme/styles.css 的 .mt-theme-N 对齐） */
  var BUILTIN = {
    '1': {
      '--note-background': '#FAF7F0', '--note-foreground': '#3D3D3D',
      '--note-card': '#F2EDE3', '--note-card-foreground': '#3D3D3D',
      '--note-surface': '#F2EDE3', '--note-surface-2': '#E8E1D4',
      '--note-popover': '#F2EDE3', '--note-popover-foreground': '#3D3D3D',
      '--note-muted': '#F2EDE3', '--note-muted-foreground': '#8A8478',
      '--note-border': '#E0DBD0', '--note-input': '#E0DBD0', '--note-ring': '#B8A890',
      '--note-gutter-bg': '#F5F0E8',
      '--note-ink': '#3D3D3D', '--note-ink-2': '#6B6B5E', '--note-ink-3': '#9A9488', '--note-line': '#E0DBD0',
      '--note-brand': '#7C6A52', '--note-brand-500': '#7C6A52', '--note-brand-600': '#6B5A44',
      '--note-shadow-1': '0 1px 2px rgba(120, 110, 90, 0.06)', '--note-shadow-2': '0 8px 24px -8px rgba(120, 110, 90, 0.18)'
    },
    '2': {
      '--note-background': '#F5F0E6', '--note-foreground': '#4A4237',
      '--note-card': '#EDE6D8', '--note-card-foreground': '#4A4237',
      '--note-surface': '#EDE6D8', '--note-surface-2': '#E2D9C6',
      '--note-popover': '#EDE6D8', '--note-popover-foreground': '#4A4237',
      '--note-muted': '#EDE6D8', '--note-muted-foreground': '#857C6C',
      '--note-border': '#D8CFBE', '--note-input': '#D8CFBE', '--note-ring': '#B5A88C',
      '--note-gutter-bg': '#F0E9DD',
      '--note-ink': '#4A4237', '--note-ink-2': '#6F6655', '--note-ink-3': '#9B927E', '--note-line': '#D8CFBE',
      '--note-brand': '#7C6A52', '--note-brand-500': '#7C6A52', '--note-brand-600': '#6B5A44',
      '--note-shadow-1': '0 1px 2px rgba(130, 115, 90, 0.06)', '--note-shadow-2': '0 8px 24px -8px rgba(130, 115, 90, 0.18)'
    },
    '3': {
      '--note-background': '#F0F1F3', '--note-foreground': '#3A3D42',
      '--note-card': '#E4E6EA', '--note-card-foreground': '#3A3D42',
      '--note-surface': '#E4E6EA', '--note-surface-2': '#D5D8DE',
      '--note-popover': '#E4E6EA', '--note-popover-foreground': '#3A3D42',
      '--note-muted': '#E4E6EA', '--note-muted-foreground': '#7F858F',
      '--note-border': '#C8CBD1', '--note-input': '#C8CBD1', '--note-ring': '#9AA0A8',
      '--note-gutter-bg': '#E8EAEF',
      '--note-ink': '#3A3D42', '--note-ink-2': '#6A7078', '--note-ink-3': '#959BA4', '--note-line': '#C8CBD1',
      '--note-brand': '#7C6A52', '--note-brand-500': '#7C6A52', '--note-brand-600': '#6B5A44',
      '--note-shadow-1': '0 1px 2px rgba(60, 70, 90, 0.06)', '--note-shadow-2': '0 8px 24px -8px rgba(60, 70, 90, 0.18)'
    },
    '4': {
      '--note-background': '#E8ECE6', '--note-foreground': '#2E3D2E',
      '--note-card': '#DDE3D8', '--note-card-foreground': '#2E3D2E',
      '--note-surface': '#DDE3D8', '--note-surface-2': '#CDD5C6',
      '--note-popover': '#DDE3D8', '--note-popover-foreground': '#2E3D2E',
      '--note-muted': '#DDE3D8', '--note-muted-foreground': '#6D7A65',
      '--note-border': '#BEC9B6', '--note-input': '#BEC9B6', '--note-ring': '#8E9C83',
      '--note-gutter-bg': '#E4E8E0',
      '--note-ink': '#2E3D2E', '--note-ink-2': '#55644E', '--note-ink-3': '#85947D', '--note-line': '#BEC9B6',
      '--note-brand': '#7C6A52', '--note-brand-500': '#7C6A52', '--note-brand-600': '#6B5A44',
      '--note-shadow-1': '0 1px 2px rgba(50, 80, 55, 0.06)', '--note-shadow-2': '0 8px 24px -8px rgba(50, 80, 55, 0.18)'
    }
  };

  /** 读取自定义配色字段键；缺失/异常返回 null（head 早期 localStorage 也可能不可用） */
  function read(key) {
    try { return localStorage.getItem('plugin:minimal-theme:' + key); } catch (_) { return null; }
  }

  /** 读取全部自定义配色字段（缺失用默认）→ { fieldKey: color } */
  function readCustomColors() {
    var out = {};
    CUSTOM_FIELDS.forEach(function (f) { out[f.key] = read(f.key) || f.default; });
    return out;
  }

  /* 颜色辅助：复制宿主 app-core.js 的 tint/shade 口径，便于在主题侧由单个强调色派生品牌色阶，
   * 保证主题与宿主「设置-外观-强调色」用同一套派生算法，协调一致。作者: 火 冰 */
  function hexToRgb(hex) {
    hex = hex.replace('#', '');
    return { r: parseInt(hex.substr(0, 2), 16), g: parseInt(hex.substr(2, 2), 16), b: parseInt(hex.substr(4, 2), 16) };
  }
  function tint(hex, weight) {
    const rgb = hexToRgb(hex);
    return 'rgb(' + Math.round(rgb.r * weight + 255 * (1 - weight)) + ',' +
      Math.round(rgb.g * weight + 255 * (1 - weight)) + ',' +
      Math.round(rgb.b * weight + 255 * (1 - weight)) + ')';
  }
  function shade(hex, weight) {
    const rgb = hexToRgb(hex);
    return 'rgb(' + Math.round(rgb.r * weight) + ',' + Math.round(rgb.g * weight) + ',' + Math.round(rgb.b * weight) + ')';
  }

  /** 由单个强调色（brand-600）派生完整品牌色阶 + primary/brand-ink + 当前行高亮色。
   *  base.css 里 --note-brand-* / --note-primary / --note-line-active 是参考值；主题启用时若不覆盖，
   *  这些令牌仍停留在宿主默认紫罗兰，与主题强调色不协调。故主题注入时统一补齐。作者: 火 冰
   * @param {string} brand 强调色 HEX（主题的 --note-brand-600）
   * @returns {Object} brand 色阶与相关令牌的变量键值对 */
  function deriveBrandVars(brand) {
    return {
      '--note-primary': brand,
      '--note-primary-foreground': '#FFFFFF',
      '--note-brand-ink': '#FFFFFF',
      '--note-brand-50': tint(brand, 0.95),
      '--note-brand-100': tint(brand, 0.85),
      '--note-brand-200': tint(brand, 0.72),
      '--note-brand-300': tint(brand, 0.56),
      '--note-brand-400': tint(brand, 0.4),
      '--note-brand-700': shade(brand, 0.74),
      '--note-brand-800': shade(brand, 0.6),
      '--note-brand-900': shade(brand, 0.48),
      '--note-brand-950': shade(brand, 0.34),
      // 主题当前为浅色系：源码模式当前行高亮用浅色黑（覆盖宿主 .dark 的白叠加，避免深色残留）
      '--note-line-active': 'rgba(0,0,0,0.045)'
    };
  }

  /** 内置 4 套主题补齐品牌色阶派生（以各自 --note-brand-600 为强调色基座，保持与宿主 setAccent 同口径） */
  Object.keys(BUILTIN).forEach(function (id) {
    Object.assign(BUILTIN[id], deriveBrandVars(BUILTIN[id]['--note-brand-600']));
  });

  /** 由自定义字段计算完整注入变量集合（cssVar → 颜色），与插件 buildCustomVars 同源。
   *  与 CUSTOM_FIELDS 逐一对应（直接映射），先派生补齐品牌色阶，再用显式字段覆盖
   *  派生的 primary/primary-foreground/brand-ink/line-active，使每个语义色令牌均可独立调节。作者: 火 冰 */
  function buildCustomVars(c) {
    var vars = {
      '--note-background': c.cBg, '--note-foreground': c.cForeground,
      '--note-card': c.cCard, '--note-card-foreground': c.cCardForeground,
      '--note-surface': c.cSurface, '--note-surface-2': c.cSurface2,
      '--note-popover': c.cPopover, '--note-popover-foreground': c.cPopoverForeground,
      '--note-muted': c.cMuted, '--note-muted-foreground': c.cMutedFg,
      '--note-border': c.cBorder, '--note-input': c.cInput, '--note-ring': c.cRing,
      '--note-gutter-bg': c.cGutterBg,
      '--note-ink': c.cInk, '--note-ink-2': c.cInk2, '--note-ink-3': c.cInk3, '--note-line': c.cLine,
      '--note-brand': c.cBrand, '--note-brand-500': c.cBrand, '--note-brand-600': c.cBrand,
      '--note-shadow-1': '0 1px 2px rgba(120, 110, 90, 0.06)',
      '--note-shadow-2': '0 8px 24px -8px rgba(120, 110, 90, 0.18)'
    };
    Object.assign(vars, deriveBrandVars(c.cBrand)); // 品牌色阶 + 派生的 primary/brand-ink/line-active
    // 显式字段覆盖派生值：主操作色/主操作前景/强调色文字/当前行高亮可独立调节
    vars['--note-primary'] = c.cPrimary;
    vars['--note-primary-foreground'] = c.cPrimaryForeground;
    vars['--note-brand-ink'] = c.cBrandInk;
    vars['--note-line-active'] = c.cLineActive;
    return vars;
  }

  global.SB_PALETTES = {
    CUSTOM_VAR_PROPS: CUSTOM_VAR_PROPS.slice(),
    CUSTOM_FIELDS: CUSTOM_FIELDS,
    BUILTIN: BUILTIN,
    read: read,
    readCustomColors: readCustomColors,
    buildCustomVars: buildCustomVars,
    deriveBrandVars: deriveBrandVars
  };
})(typeof window !== 'undefined' ? window : globalThis);