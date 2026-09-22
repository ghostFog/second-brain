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
    /* 显示/隐藏大纲：插件自研浮层面板（能力迁入自宿主，见下方 mde-outline-* 实现） */
    'mde-outline': function () { mdeOutlineToggle(); },
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
 *       启动/切回编辑器视图（DOM 重建）后按记忆恢复，「宽屏/列宽」按钮已随页签栏精简
 *       迁入 vditor 编辑工具栏（见 editor-vditor.js），本插件只负责恢复状态并同步其高亮。
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

/** 刷新「宽屏」按钮高亮态（开启时高亮品牌色）：按钮已迁入 vditor 编辑工具栏，经宿主桥接同步 */
function mdeSyncWideBtn() {
  if (typeof window.vdSetToolbarCurrent === 'function') {
    window.vdSetToolbarCurrent('sb-wide', mdeWideOn());
  }
}

/** 按记忆恢复宽屏状态（编辑器视图每次 DOM 重建后调用） */
function mdeRestoreWide() {
  const on = (typeof restoreS === 'function') ? !!restoreS(mdeWideKey, false) : false;
  if (on !== mdeWideOn()) mdeSetWide(on);
}

/** 监听宿主 loadView 重建编辑视图 DOM：编辑器视图重建后按记忆恢复宽屏/列宽状态，
 *  并同步 vditor 编辑工具栏按钮高亮（按钮已迁入工具栏，无需再注入页签栏） */
function mdeWideObserve() {
  const onChange = function () {
    mdeRestoreWide();
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
 *       挂 html.fe-table-auto 类（独立于 ed-wide），状态存 saveS/restoreS（键 sbTableAuto）。
 *       「列宽」按钮已迁入 vditor 编辑工具栏，observer 复用上面 mdeWideObserve 的统一回调。
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

/** 刷新「列宽」按钮高亮态（按内容宽度时高亮品牌色）：按钮已迁入 vditor 编辑工具栏，经宿主桥接同步 */
function mdeSyncTableBtn() {
  if (typeof window.vdSetToolbarCurrent === 'function') {
    window.vdSetToolbarCurrent('sb-table-layout', mdeTableAutoOn());
  }
}

/** 按记忆恢复表格列宽模式（编辑器视图每次 DOM 重建后调用） */
function mdeRestoreTableAuto() {
  const on = (typeof restoreS === 'function') ? !!restoreS(mdeTableKey, false) : false;
  if (on !== mdeTableAutoOn()) mdeSetTableAuto(on);
}

mdeWideObserve();   // 统一启动：编辑器视图重建后按记忆恢复宽屏/列宽并同步工具栏高亮（须在全部 const 声明之后，避免 TDZ）

/* vditor 编辑工具栏「宽屏/表格列宽」按钮经 window.mdeToggleWide / window.mdeToggleTableAuto 调用。
 * 插件经 new Function(...) 沙箱作用域执行，顶层 function 声明不落 window，须显式导出。
 * 作者: 火 冰 */
window.mdeToggleWide = mdeToggleWide;
window.mdeToggleTableAuto = mdeToggleTableAuto;

/* ============================================
 * vditor 编辑工具栏按钮注入——「宽屏 / 表格列宽 / 大纲」三个能力归位本插件，
 * 按钮由插件经宿主注入桥 window.sbVdToolbarAdd 注入（宿主构建工具栏时并入 VDTOOLBAR）。
 *   - sb-wide / sb-table-layout：本插件 mdeToggle* 实现（见上文）
 *   - sb-outline：插件自研大纲浮层 mde-outline-*
 * 「全屏」仍为宿主自接管，宿主用同桥注册，插件无需处理。
 * 作者: 火 冰
 * ============================================ */
(function () {
  if (typeof window.sbVdToolbarAdd !== 'function') return;   // 宿主未提供注入桥（如网页版），跳过
  window.sbVdToolbarAdd({ name: 'sb-wide', tip: '宽屏模式（编辑内容占满宽度）', icon: '<svg viewBox="0 0 24 24" width="17" height="17" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="m18 8-4 4 4 4"/><path d="m6 8 4 4-4 4"/><path d="M2 12h20"/></svg>', click: function () { mdeToggleWide(); } });
  window.sbVdToolbarAdd({ name: 'sb-table-layout', tip: '表格列宽：固定等宽 / 按内容宽度', icon: '<svg viewBox="0 0 24 24" width="17" height="17" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><rect width="20" height="6" x="2" y="4" rx="2"/><rect width="20" height="6" x="2" y="14" rx="2"/></svg>', click: function () { mdeToggleTableAuto(); } });
  window.sbVdToolbarAdd({ name: 'sb-outline', tip: '大纲 (Ctrl+Shift+Q)', icon: '<svg viewBox="0 0 24 24" width="17" height="17" style="fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>', click: function () { mdeOutlineToggle(); } });
})();

/* ============================================
 * 大纲浮层（迁入自宿主 editor-vditor.js 的 sb-outline-*，能力归位本插件）。
 * vditor 内置 outline 在本应用多面板/transform 场景下跳转依赖的 scrollTop/offsetTop
 * 容器对不上（点不动）、折叠状态又易被重渲染重置，故用自研浮层：从当前可见编辑内容源
 * 取标题构建树，点击标题用 scrollIntoView 跳转（自动滚动到任意滚动容器）、父级标题可折叠。
 * 依赖宿主最小桥：
 *   - window.sbOutlineSource()  取当前可跳转的编辑内容源 DOM（宿主闭包方能取到 vdMode/vdInst）
 *   - window.vdSetToolbarCurrent('sb-outline', on)  同步按钮高亮
 *   - 宿主派发的 sbOutlineChange 事件（input/切文档/全屏/异步渲染后）→ 刷新树并重定位
 * 作者: 火 冰
 * ============================================ */
const MDE_OUTLINE_W = 240;                // 大纲浮层宽度（定位时按此贴右缘）

/** 大纲浮层是否打开 */
function mdeOutlineOpen() {
  const p = document.getElementById('sb-outline-panel');
  return !!(p && p.style.display !== 'none');
}

/** 取标题显示文本：去掉 IR 模式保留的 `#` 语法标记与零宽字符 */
function mdeOutlineText(h) {
  return String(h.textContent || '').replace(/^#{1,6}\s*/, '').replace(/[\u200b\u200c]/g, '').trim();
}

/** 依据标题 DOM 顺序构建树形 `<ul>`：打平 heads 中标题层级（最小级为根），父级标题有子级时
 *  附折叠箭头；每项 data-idx 指向其在 heads 中的下标，供点击时精确 scrollIntoView 定位。
 * @returns {HTMLUListElement} */
function mdeOutlineTree(heads) {
  if (!heads.length) return document.createElement('ul');
  let min = 7;
  for (let i = 0; i < heads.length; i++) {
    const lv = parseInt(heads[i].tagName.slice(1), 10) || 6;
    if (lv < min) min = lv;
  }
  const rootNode = { level: 0, children: [] };
  const stack = [rootNode];
  for (let i = 0; i < heads.length; i++) {
    const lv = (parseInt(heads[i].tagName.slice(1), 10) || 6) - min + 1;
    const node = { level: lv, index: i, head: heads[i], children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= lv) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  const rootUl = document.createElement('ul');
  rootUl.className = 'sb-outline-list';
  mdeOutlineFill(rootUl, rootNode.children);
  return rootUl;
}

/** 递归把节点数组渲染进给定 `<ul>`（子级套 `.sb-outline-list`） */
function mdeOutlineFill(ul, nodes) {
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const li = document.createElement('li');
    li.className = 'sb-outline-li';
    const row = document.createElement('div');
    row.className = 'sb-outline-row';
    if (n.children.length) {
      const caret = document.createElement('span');
      caret.className = 'sb-outline-caret';
      caret.title = '折叠/展开';
      row.appendChild(caret);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sb-outline-item';
    btn.dataset.idx = String(n.index);
    btn.title = '跳到正文 ' + mdeOutlineText(n.head);
    btn.appendChild(document.createTextNode(mdeOutlineText(n.head) || ('H' + (parseInt(n.head.tagName.slice(1), 10) || 1))));
    row.appendChild(btn);
    li.appendChild(row);
    if (n.children.length) {
      const sub = document.createElement('ul');
      sub.className = 'sb-outline-list';
      mdeOutlineFill(sub, n.children);
      li.appendChild(sub);
    }
    ul.appendChild(li);
  }
}

/** 渲染大纲内容到面板（依据宿主源重建树）；无标题源/无标题时显示空态 */
function mdeOutlineRender() {
  const body = document.getElementById('sb-outline-body');
  const empty = document.getElementById('sb-outline-empty');
  if (!body || !empty) return;
  let src = null;
  if (typeof window.sbOutlineSource === 'function') { try { src = window.sbOutlineSource(); } catch (_) { src = null; } }
  if (!src) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  const heads = Array.prototype.slice.call(src.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  if (!heads.length) { body.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  body.innerHTML = '';
  body.appendChild(mdeOutlineTree(heads));
  body._mdeOutlineHeads = heads;   // 供点击事件按 data-idx 精确定位
}

/** 面板打开状态下，内容/可视区域变化后防抖重建并重定位（挂到宿主派发的 sbOutlineChange） */
let mdeOutlineRefreshTimer = 0;
function mdeOutlineScheduleRefresh() {
  if (!mdeOutlineOpen()) return;
  clearTimeout(mdeOutlineRefreshTimer);
  mdeOutlineRefreshTimer = setTimeout(function () { mdeOutlinePosition(); mdeOutlineRender(); }, 120);
}

/** 按编辑器可视区域把浮层定位在编辑区右侧上下居中。
 *  top 基准确认到工具栏之下（#ed-vditor 的 top 含顶部工具栏高度，直接加偏移会盖住工具栏），
 *  取容器内 .vditor-toolbar 高度作为基准下移。 */
function mdeOutlinePosition() {
  const host = document.getElementById('ed-vditor');
  const p = document.getElementById('sb-outline-panel');
  if (!host || !p) return;
  const r = host.getBoundingClientRect();
  const tb = host.querySelector('.vditor-toolbar');
  const tbH = (tb && tb.getBoundingClientRect) ? tb.getBoundingClientRect().height : 0;
  p.style.top = (r.top + tbH + 8) + 'px';
  p.style.left = Math.max(8, r.right - MDE_OUTLINE_W - 8) + 'px';
  p.style.maxHeight = Math.max(160, r.height - tbH - 16) + 'px';
}

/** 创建大纲浮层 DOM（幂等，挂到 body）：标题栏 + 内容区（树）+ 空态提示 */
function mdeOutlineEnsure() {
  let p = document.getElementById('sb-outline-panel');
  if (p) return p;
  p = document.createElement('div');
  p.id = 'sb-outline-panel';
  p.style.cssText = 'display:none; position:fixed; z-index:1300; width:' + MDE_OUTLINE_W + 'px; '
    + 'flex-direction:column; box-shadow:0 6px 24px rgba(0,0,0,0.18); '
    + 'border-radius:10px; overflow:hidden;';
  p.innerHTML = '<div class="sb-outline-title">大纲</div>'
    + '<div id="sb-outline-body" class="sb-outline-body"></div>'
    + '<div id="sb-outline-empty" class="sb-outline-empty" style="display:none">无标题或源码模式不可用</div>';
  // 事件委托：折叠箭头收放子级；标题项点击 → scrollIntoView 跳到正文
  p.addEventListener('click', function (e) {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const caret = t.closest('.sb-outline-caret');
    if (caret) {
      e.preventDefault(); e.stopPropagation();
      const row = caret.parentElement;
      const sub = row.nextElementSibling;
      row.classList.toggle('sb-outline-collapsed');
      if (sub && sub.classList.contains('sb-outline-list')) {
        sub.style.display = sub.style.display === 'none' ? '' : 'none';
      }
      return;
    }
    const btn = t.closest('.sb-outline-item');
    if (btn) {
      const heads = p.querySelector('#sb-outline-body')._mdeOutlineHeads;
      const idx = parseInt(btn.dataset.idx, 10);
      const h = heads && heads[idx];
      if (h) {
        try { h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        catch (_) { try { h.scrollIntoView(); } catch (__) { /* 忽略 */ } }
      }
    }
  });
  document.body.appendChild(p);
  // 窗口大小变化后重定位（首次创建面板时注册一次；打开状态下才真正重算）
  if (!window.__mdeOutlineResizeBound) {
    window.__mdeOutlineResizeBound = true;
    window.addEventListener('resize', function () {
      if (mdeOutlineOpen()) mdeOutlinePosition();
    });
  }
  return p;
}

/** 切换大纲浮层：打开时重建树并定位；纯 SV 源码模式视为禁用（等价 vditor 原生行为） */
function mdeOutlineToggle() {
  const p = mdeOutlineEnsure();
  if (mdeOutlineOpen()) {
    p.style.display = 'none';
    mdeOutlineSyncBtn(false);
    return;
  }
  // 纯 SV 源码无渲染标题：不展开，保持按钮未高亮（等价 vditor 原生禁用）
  let src = null;
  if (typeof window.sbOutlineSource === 'function') { try { src = window.sbOutlineSource(); } catch (_) { src = null; } }
  if (!src) { mdeOutlineSyncBtn(false); return; }
  mdeOutlinePosition();
  mdeOutlineRender();
  p.style.display = 'flex';
  mdeOutlineSyncBtn(true);
}

/** 大纲按钮高亮态（打开时高亮品牌色）：经宿主桥 window.vdSetToolbarCurrent 同步 */
function mdeOutlineSyncBtn(on) {
  if (typeof window.vdSetToolbarCurrent === 'function') {
    window.vdSetToolbarCurrent('sb-outline', !!on);
  }
}

/* 宿主在编辑器 input/切文档/异步渲染/全屏切换后派发 sbOutlineChange → 打开状态下刷新树+重定位 */
window.addEventListener('sbOutlineChange', function () { mdeOutlineScheduleRefresh(); });