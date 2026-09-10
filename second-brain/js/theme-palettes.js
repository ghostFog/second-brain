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
    '--note-line', '--note-brand', '--note-brand-500', '--note-brand-600',
    '--note-shadow-1', '--note-shadow-2'
  ];

  /** 自定义配色可调字段：key → { label, cssVar, default } */
  var CUSTOM_FIELDS = [
    { key: 'cBg',     label: '背景色',   cssVar: '--note-background', default: '#FAF7F0' },
    { key: 'cCard',   label: '卡片背景', cssVar: '--note-card',        default: '#F2EDE3' },
    { key: 'cSurface', label: '表面/弹层', cssVar: '--note-surface',   default: '#F2EDE3' },
    { key: 'cBorder', label: '边框/输入', cssVar: '--note-border',     default: '#E0DBD0' },
    { key: 'cInk',    label: '主文字色', cssVar: '--note-ink',         default: '#3D3D3D' },
    { key: 'cInk3',   label: '次要文字', cssVar: '--note-ink-3',       default: '#9A9488' },
    { key: 'cLine',   label: '分隔线',   cssVar: '--note-line',        default: '#E0DBD0' },
    { key: 'cBrand',  label: '强调色',   cssVar: '--note-brand',       default: '#7C6A52' }
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

  /** 由自定义字段计算完整注入变量集合（cssVar → 颜色），与插件 buildCustomVars 同源 */
  function buildCustomVars(c) {
    return {
      '--note-background': c.cBg, '--note-foreground': c.cInk,
      '--note-card': c.cCard, '--note-card-foreground': c.cInk,
      '--note-surface': c.cCard, '--note-surface-2': c.cBorder,
      '--note-popover': c.cCard, '--note-popover-foreground': c.cInk,
      '--note-muted': c.cCard, '--note-muted-foreground': c.cInk3,
      '--note-border': c.cBorder, '--note-input': c.cBorder, '--note-ring': c.cBrand,
      '--note-gutter-bg': c.cCard,
      '--note-ink': c.cInk, '--note-ink-2': c.cInk3, '--note-ink-3': c.cInk3, '--note-line': c.cLine,
      '--note-brand': c.cBrand, '--note-brand-500': c.cBrand, '--note-brand-600': c.cBrand,
      '--note-shadow-1': '0 1px 2px rgba(120, 110, 90, 0.06)', '--note-shadow-2': '0 8px 24px -8px rgba(120, 110, 90, 0.18)'
    };
  }

  global.SB_PALETTES = {
    CUSTOM_VAR_PROPS: CUSTOM_VAR_PROPS.slice(),
    CUSTOM_FIELDS: CUSTOM_FIELDS,
    BUILTIN: BUILTIN,
    read: read,
    readCustomColors: readCustomColors,
    buildCustomVars: buildCustomVars
  };
})(typeof window !== 'undefined' ? window : globalThis);