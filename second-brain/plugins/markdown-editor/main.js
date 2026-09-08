/* ============================================
 * 第二脑 — Markdown Editor 插件（声明外壳，引擎归宿主）
 * 作者: 火 冰
 * 功能:
 *   - 声明支持的 Markdown 后缀（.md / .markdown）与打开方式、工具按钮、侧边面板
 *   - 将工具按钮/命令 action 委托给宿主（editor-host.js）与 vditor 桥接（editor-vditor.js）
 * 说明:
 *   - vditor 引擎与 .md Provider 已整体迁入宿主 js/editor/editor-vditor.js（桌面+网页共用）。
 *   - 本插件仅保留动作映射外壳，不再注册独立 Provider，避免与宿主重复。
 * ============================================ */
'use strict';

/* 触发宿主某个 data-action 工具按钮（存在才点；按钮由宿主渲染） */
function fireAction(action) {
  try {
    const btn = document.querySelector('[data-action="' + action + '"]');
    if (btn) btn.click();
  } catch (_) { /* 忽略 */ }
}

/* 注册 md 编辑器操作（错误边界由 PluginAPI.register 统一包裹） */
try {
  PluginAPI.register('markdown-editor', {
    /* 源码 / 即时渲染 切换（委托宿主 toggleSource → vditor ir/sv） */
    'mde-toggle-source': function () { if (typeof toggleSource === 'function') toggleSource(); },
    /* 显示/隐藏行号（vditor 自控，首版 no-op） */
    'mde-toggle-lineno': function () { /* no-op：行号由 vditor 设置控制 */ },
    /* 自动换行（vditor 自控，首版 no-op） */
    'mde-toggle-wrap': function () { /* no-op：换行由 vditor 设置控制 */ },
    /* 查看/收起当前笔记索引面板（宿主侧边索引） */
    'mde-view-index': function () { if (typeof toggleIndexPanel === 'function') toggleIndexPanel(); },
    /* 删除当前笔记 */
    'mde-delete': function () { fireAction('delete-note'); },
    /* 打开当前笔记（命令面板调用） */
    'mde-open': function () { if (typeof openCurrentNote === 'function') openCurrentNote(); },
  });
} catch (_) { /* 装配异常由宿主沙箱兜底 */ }