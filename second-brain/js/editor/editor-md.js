/* ============================================
 * 第二脑 — 编辑器 markdown 专属功能·宿主薄壳（委托插件）
 * 作者: 火 冰
 * 功能: 真实逻辑已迁入 markdown-editor 插件的 md-serialize.js / md-blocks.js / md-context.js，
 *       本文件仅保留同名薄壳委托到 window.sbMdBridge，保证：
 *         - 桌面版：插件加载后以真实实现覆盖本薄壳；
 *         - 网页版（无目录插件）：薄壳取不到 bridge 时安全回落（不抛错，功能降级）。
 * 说明: 语义从「宿主为外壳」反转为「插件为增强本体、宿主只是委托薄壳」，符合插件增强化定位。
 * ============================================ */

'use strict';

  /* 从 window.sbMdBridge 取指定增强函数；取不到返回 null
   * @param {string} name 函数名
   * @returns {Function|null}
   * 作者: 火 冰 */
  function sbMdFn(name) {
    const b = window.sbMdBridge;
    if (!b) return null;
    if (b.serialize && typeof b.serialize[name] === 'function') return b.serialize[name];
    if (b.blocks && typeof b.blocks[name] === 'function') return b.blocks[name];
    if (b.context && typeof b.context[name] === 'function') return b.context[name];
    return null;
  }

  /* 所见即所得编辑区 → Markdown（委托插件 domToMd；网页无插件时回落纯文本） */
  function domToMd(root) {
    const f = sbMdFn('domToMd');
    return f ? f(root) : ((root && root.textContent) || '');
  }

  /* 行内节点逆转换 → Markdown（委托插件 inlineToMd） */
  function inlineToMd(el) {
    const f = sbMdFn('inlineToMd');
    return f ? f(el) : '';
  }

  /* 委托辅助：调用 bridge 函数（存在才调用，避免网页无插件时抛错） */
  function sbMdCall(name) {
    const f = sbMdFn(name);
    const args = Array.prototype.slice.call(arguments, 1);
    if (f) return f.apply(null, args);
    return false;
  }

  /* ----- 块编辑与代码块语言选择器（真实逻辑迁入插件 md-blocks.js） ----- */
  function wysBlockTags() { return 'PRE, BLOCKQUOTE, TABLE, HR'; }
  function clearWysBlock() { sbMdCall('clearWysBlock'); }
  function anchorCodeLangPicker(pre) { sbMdCall('anchorCodeLangPicker', pre); }
  function filterCodeLangs(kw) { return sbMdCall('filterCodeLangs', kw); }
  function renderCodeLangList() { sbMdCall('renderCodeLangList'); }
  function applyCodeLang(name) { sbMdCall('applyCodeLang', name); }
  function ensureCodeLangPicker() { return sbMdCall('ensureCodeLangPicker'); }
  function showCodeLangPicker(pre) { sbMdCall('showCodeLangPicker', pre); }
  function hideCodeLangPicker() { sbMdCall('hideCodeLangPicker'); }
  function selectWysBlock(blk) { sbMdCall('selectWysBlock', blk); }
  function placeCaretAtEnd(el) { sbMdCall('placeCaretAtEnd', el); }
  function appendWysTrailingP(wys) { sbMdCall('appendWysTrailingP', wys); }