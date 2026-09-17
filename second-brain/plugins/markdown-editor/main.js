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
    /* 显示/隐藏大纲：复用 vditor 内置大纲浮层（宿主 vdToggleOutline） */
    'mde-outline': function () { if (typeof window.vdToggleOutline === 'function') window.vdToggleOutline(); },
    /* 删除当前笔记 */
    'mde-delete': function () { fireAction('delete-note'); },
    /* 打开当前笔记（命令面板调用） */
    'mde-open': function () { if (typeof openCurrentNote === 'function') openCurrentNote(); },
    /* 切换编辑器宽屏模式（编辑内容铺满宽度 100%，记忆恢复） */
    'mde-widescreen': function () { mdeToggleWide(); },
    /* 切换表格列宽模式：固定宽度(各列等宽) / 按内容宽度显示（记忆恢复） */
    'mde-table-layout': function () { mdeToggleTableAuto(); },
    /* 链接：浏览器打开 */
    'mde-link-open': function () {
      const link = document.querySelector('a[href]:hover') || document.activeElement.closest('a[href]');
      if (link && link.getAttribute('href') && /^https?:\/\//i.test(link.getAttribute('href'))) {
        window.open(link.getAttribute('href'), '_blank');
      }
    },
    /* 链接：取消链接 */
    'mde-link-unlink': function () {
      const link = document.querySelector('a[href]:hover') || document.activeElement.closest('a[href]');
      if (link && typeof mdeUnlinkAtCaret === 'function') {
        mdeUnlinkAtCaret(link);
      }
    },
    /* 图片：下载 */
    'mde-img-download': function () {
      const img = document.querySelector('img:hover') || document.activeElement.closest('img');
      if (img && typeof mdeDownloadImage === 'function') {
        mdeDownloadImage(img.getAttribute('src') || '');
      }
    },
    /* 图片：设置尺寸 */
    'mde-img-size': function () {
      const img = document.querySelector('img:hover') || document.activeElement.closest('img');
      if (img && typeof mdeOpenImageSizeDialog === 'function') {
        mdeOpenImageSizeDialog(img);
      }
    },
  });
} catch (_) { /* 装配异常由宿主沙箱兜底 */ }

/* ============================================
 * 宽屏模式（编辑内容铺满宽度 100%）
 * 作者: 火 冰
 * 功能: 给 html/body 挂 ed-wide 类（由 styles.css 把编辑 body 与表格宽度强制 100%），
 *       经 #ed-plugin-wide-slot 向宿主页签栏注入「宽屏」按钮并绑定，
 *       启动/切回编辑器视图（DOM 重建）后用 MutationObserver 重新注入并按记忆恢复。
 *============================================ */
const mdeWideKey = 'sbWide';     // 宽屏状态记忆键（沿用宿主旧键，兼容既有设置）

/** 宽屏是否开启 */
function mdeWideOn() {
  return document.documentElement.classList.contains('ed-wide');
}

/** 应用/撤销宽屏：挂 ed-wide 类并记忆 */
function mdeSetWide(on) {
  document.documentElement.classList.toggle('ed-wide', !!on);
  if (document.body) document.body.classList.toggle('ed-wide', !!on);
  if (typeof saveS === 'function') saveS(mdeWideKey, !!on);
  mdeSyncWideBtn();
}

/** 切换宽屏模式（命令面板 / 按钮共用） */
function mdeToggleWide() {
  mdeSetWide(!mdeWideOn());
}

/** 刷新「宽屏」按钮高亮态（开启时高亮品牌色） */
function mdeSyncWideBtn() {
  const btn = document.querySelector('[data-action="mde-widescreen"]');
  if (btn) btn.style.color = mdeWideOn() ? 'var(--note-brand-400)' : 'var(--note-ink-3)';
}

/** 向宿主页签栏注入「宽屏」按钮（幂等：插槽内已有按钮则跳过） */
function mdeInjectWideBtn() {
  const slot = document.getElementById('ed-plugin-wide-slot');
  if (!slot || slot.querySelector('[data-action="mde-widescreen"]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.action = 'mde-widescreen';
  btn.title = '宽屏模式（编辑内容占满宽度，Esc 退出全屏不受影响）';
  btn.className = 'w-7 h-7 flex items-center justify-center rounded transition-colors hover:opacity-80';
  btn.style.cssText = 'background: transparent; color: var(--note-ink-3);';
  btn.innerHTML = '<i data-lucide="move-horizontal" class="w-3.5 h-3.5"></i>';
  btn.addEventListener('click', function () { mdeToggleWide(); });
  slot.appendChild(btn);
  // 唤醒宿主 lucide 图标渲染（宿主导入的是 lucide.createIcons，图标 <i> 会替换为 SVG）
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try { window.lucide.createIcons(); } catch (_) { /* 忽略 */ }
  }
  mdeSyncWideBtn();
}

/** 按记忆恢复宽屏状态（编辑器视图每次 DOM 重建后调用） */
function mdeRestoreWide() {
  const on = (typeof restoreS === 'function') ? !!restoreS(mdeWideKey, false) : false;
  if (on !== mdeWideOn()) mdeSetWide(on);
}

/** 监听宿主 loadView 重建编辑视图 DOM：注入槽出现时注入按钮并按记忆恢复 */
function mdeWideObserve() {
  const onChange = function () {
    mdeInjectWideBtn();
    mdeRestoreWide();
    mdeInjectTableBtn();
    mdeRestoreTableAuto();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { onChange(); startWideObserver(); });
  } else {
    onChange();
    startWideObserver();
  }
  function startWideObserver() {
    const mo = new MutationObserver(onChange);
    mo.observe(document.body, { childList: true, subtree: true });
  }
}

/* ============================================
 * 表格列宽模式（固定宽度 等宽 / 按内容宽度 显示）
 * 作者: 火 冰
 * 功能: 默认 fixed 等宽（styles.css table-layout:fixed），按钮切到 auto 让列宽贴合内容。
 *       挂 html.fe-table-auto 类（独立于 ed-wide），经 #ed-plugin-wide-slot 追加「列宽」按钮，
 *       状态存 saveS/restoreS（键 sbTableAuto）。observer 复用上面 mdeWideObserve 的统一回调。
 *============================================ */
const mdeTableKey = 'sbTableAuto';    // 表格列宽模式记忆键（true=按内容宽度，缺省=固定等宽）

/** 表格是否「按内容宽度」显示 */
function mdeTableAutoOn() {
  return document.documentElement.classList.contains('fe-table-auto');
}

/** 应用列宽模式：挂/摘 fe-table-auto 类并记忆 */
function mdeSetTableAuto(on) {
  document.documentElement.classList.toggle('fe-table-auto', !!on);
  if (typeof saveS === 'function') saveS(mdeTableKey, !!on);
  mdeSyncTableBtn();
}

/** 切换表格列宽模式（命令面板 / 按钮共用） */
function mdeToggleTableAuto() {
  mdeSetTableAuto(!mdeTableAutoOn());
}

/** 刷新「列宽」按钮高亮态（按内容宽度时高亮品牌色） */
function mdeSyncTableBtn() {
  const btn = document.querySelector('[data-action="mde-table-layout"]');
  if (btn) btn.style.color = mdeTableAutoOn() ? 'var(--note-brand-400)' : 'var(--note-ink-3)';
}

/** 向宿主页签栏注入「表格列宽」按钮（幂等，复用宽屏插槽） */
function mdeInjectTableBtn() {
  const slot = document.getElementById('ed-plugin-wide-slot');
  if (!slot || slot.querySelector('[data-action="mde-table-layout"]')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.action = 'mde-table-layout';
  btn.title = '表格列宽：固定等宽 / 按内容宽度显示';
  btn.className = 'w-7 h-7 flex items-center justify-center rounded transition-colors hover:opacity-80';
  btn.style.cssText = 'background: transparent; color: var(--note-ink-3);';
  btn.innerHTML = '<i data-lucide="stretch-horizontal" class="w-3.5 h-3.5"></i>';
  btn.addEventListener('click', function () { mdeToggleTableAuto(); });
  slot.appendChild(btn);
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    try { window.lucide.createIcons(); } catch (_) { /* 忽略 */ }
  }
  mdeSyncTableBtn();
}

/** 按记忆恢复表格列宽模式（编辑器视图每次 DOM 重建后调用） */
function mdeRestoreTableAuto() {
  const on = (typeof restoreS === 'function') ? !!restoreS(mdeTableKey, false) : false;
  if (on !== mdeTableAutoOn()) mdeSetTableAuto(on);
}

mdeWideObserve();   // 统一启动：注入宽屏/列宽按钮并按记忆恢复（须在全部 const 声明之后，避免 TDZ）