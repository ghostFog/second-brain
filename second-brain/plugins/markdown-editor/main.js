/* ============================================
 * 第二脑 — Markdown Editor 插件（编辑器的真正增强）
 * 作者: 火 冰
 * 功能:
 *   - 注册 .md/.markdown 编辑器 Provider（编辑/预览/分屏、右侧边面板）
 *   - 承载 markdown 专属增强：往返序列化、代码块语言选择器、WYSIWYG 块编辑、
 *     右键「插入图片/上传附件/在上方插入空行」（由 md-serialize.js / md-blocks.js / md-context.js 提供）
 *   - 提供须让用户按需启用的套件，禁止直接把引擎放在宿主；vditor 引擎仍留宿主做共享底座，
 *     本插件经 window.sbMdBridge 与 window.vd* 桥接宿主
 * 说明: 与宿主 js/editor/editor-md.js 的薄壳委托同名函数配合——桌面版插件为本实现，
 *       网页版（不加载目录插件）回落宿主薄壳。
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
  // 承载编辑器能力：覆盖宿主同 id Provider（后注册覆盖），并携带右键菜单等增强
  if (typeof PluginAPI !== 'undefined' && PluginAPI.registerEditorProvider) {
    try {
      PluginAPI.registerEditorProvider({
        id: 'markdown-editor',
        name: 'Markdown Editor',
        extensions: ['.md', '.markdown'],
        openers: [
          { id: 'edit', label: '编辑', icon: 'pencil' },
          { id: 'preview', label: '预览', icon: 'eye' },
          { id: 'split', label: '分屏', icon: 'columns-2' },
        ],
        toolbar: [],
        sidebar: [
          { id: 'props', label: '属性' },
          { id: 'outline', label: '大纲' },
          { id: 'backlinks', label: '反向链接' },
          { id: 'tags', label: '标签' },
        ],
        open: function () { return Promise.resolve(); },
        /* 编辑区渲染由 vditor 全权承担（vdInit/vdSetMode 驱动）——保留契约空实现 */
        renderWysiwyg: function () { return ''; },
        getMd: function () { return (typeof window.vdGetValue === 'function') ? window.vdGetValue() : ''; },
        buildContextMenu: function () { return []; },
        renderSidebar: function () { return Promise.resolve(); },
      });
    } catch (_) { /* 装配异常由宿主沙箱兜底 */ }
  }

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