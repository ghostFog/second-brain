/* ============================================
 * 第二脑 — Markdown 编辑引擎 vditor 桥接 + .md Provider
 * 作者: 火 冰
 * 功能:
 *   - 引入开源引擎 vditor（node_modules/vditor/dist，npm 运行时依赖）作为 Markdown 编辑区唯一渲染/编辑实现，
 *     整体承接原自研「源码 textarea + 所见即所得 + 预览」三套 DOM 与全部自研编辑增强。
 *   - 以宿主桥接函数（vdInit / vdSyncValue / vdSetMode / vdSetSource / vdToggleSource / vdGetValue / vdSetValue）驱动 vditor。
 *   - 模式映射：宿主 编辑→ir、分屏→sv(+both)、预览→preview。
 *   - 静态注册 .md/.markdown 的编辑器 Provider（桌面版与网页版共用，保证双端一致）。
 * 说明:
 *   - 依赖 create/ further host globals：edOutdated / edCurrent / restoreS / onEdInput / renderMarkdown / registerEditorProvider。
 *   - renderMarkdown(app-note.js) 仅保留给 AI 问答等非编辑区展示，此处仅作 Provider 契约薄实现。
 * ============================================ */
'use strict';

(function () {
  /** @type {Object|null} vditor 实例（懒创建，首次进入编辑区才 new） */
  let vdInst = null;
  /** @type {string} vditor 编辑节点模式：'ir'(即时渲染) | 'wysiwyg'(所见即所得) | 'sv'(源码分屏) */
  let vdMode = 'ir';
  /** @type {string} 编辑子节点偏好（「编辑」按钮冒泡子菜单选中的编辑节点）：'ir' | 'wysiwyg'，默认 IR */
  let vdEditorNode = 'ir';
  /** @type {string} vditor 视图布局：'editor'(仅编辑) | 'both'(分屏) | 'preview'(纯预览) */
  let vdPreview = 'editor';
  /** @type {string} 实例未创建时的内容暂存缓冲（切换/重建时保内容不丢） */
  let vdBuffer = '';
  /** @type {boolean} vditor 是否已完成首帧异步渲染（options.after 后置为 true）；
   *  未就绪时 vdSyncValue 的内容先暂存 vdPending，避免被首发渲染重启清空 */
  let vdReady = false;
  /** @type {string|null} 待 vditor 异步渲染完成后补渲的内容（启动/快速切换时序缓冲） */
  let vdPending = null;
  /** @type {string[]} 工具栏精简项：承接原自研格式/表格/代码/数学能力，含原生搜索、大纲、导出 */
  const VDTOOLBAR = [
    'undo', 'redo', '|', 'headings', 'bold', 'italic', 'strike', '|',
    'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
    'quote', 'line', 'code', 'inline-code', '|', 'table', 'link', '|',
    'outline', 'export',
  ];

  /** 应用当前是否为暗色主题（用于 vditor theme 选项跟随宿主）。
   *  读取全局已解析的 `html[data-theme]`（设置-外观-主题模式 dark/light/auto 的最终结果），
   *  auto 时由 app-core setTheme 已解析为 dark/light
   * author 火 冰 */
  function isDarkTheme() {
    return document.documentElement && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  /** 收集插件注册的「编辑器主题解析器」，归并出 vditor 应应用的 { theme, extraCss }。
   *  解析器由插件经 PluginAPI.registerEditorThemeResolver 注册，返回 { theme:'dark'|'light', extraCss? }，
   *  取首个合法结果；无解析器（或全部返回空）时回落全局明暗（html[data-theme]）。
   *  作者: 火 冰 */
  function resolveVdTheme() {
    const hint = { dark: isDarkTheme() };
    const resolvers = window.__hostThemeResolvers || [];
    for (let i = 0; i < resolvers.length; i++) {
      if (typeof resolvers[i] !== 'function') continue;
      let r = null;
      try { r = resolvers[i](hint); } catch (_) { r = null; }
      if (r && (r.theme === 'dark' || r.theme === 'light')) {
        return { theme: r.theme, extraCss: typeof r.extraCss === 'string' ? r.extraCss : '' };
      }
    }
    return { theme: hint.dark ? 'dark' : 'light', extraCss: '' };
  }
  window.vdResolveVdTheme = resolveVdTheme;

  /** 注入/刷新编辑器额外主题 CSS（插件生成的自定义覆盖样式，持久 <style>，复用同一元素避免堆积）
   *  @param {string} css 可选，为空则清空既有注入
   *  作者: 火 冰 */
  function applyVdExtraCss(css) {
    const id = 'host-vditor-theme-extra';
    let style = document.getElementById(id);
    if (css) {
      if (!style) { style = document.createElement('style'); style.id = id; }
      style.textContent = css;
      // 每次应用都重新 appendChild 到 <head> 末尾（已存在时会移动节点），
      // 确保晚于 vditor 运行时动态注入的主题 <link>，让覆盖样式在级联中胜出。
      document.head.appendChild(style);
    } else if (style) {
      style.textContent = '';
    }
  }

  /** 将 vditor 主题应用到编辑区：先解析（插件可插拔源），再 setTheme + 注入额外 CSS。
   *  已构建实例即时 setTheme；未构建则仅缓存额外 CSS，由 buildVditor 用 resolveVdTheme() 兜底。
   *  作者: 火 冰 */
  function syncVdTheme() {
    const r = resolveVdTheme();
    if (vdInst) {
      try { vdInst.setTheme(r.theme); } catch (_) { /* 忽略同步异常 */ }
    }
    applyVdExtraCss(r.extraCss);
  }
  window.vdSyncTheme = syncVdTheme;

  /** 确定性接管 vditor 三个编辑视图 + 预览窗的显隐（不依赖 vditor 自身的 setPreviewMode，
   *  后者强制把 sv 源码 textarea 置为 display:block，会污染 IR/WYSIWYG 编辑态导致源码区残留挤压）。
   *  依据 vditor 内部元素结构：sv=textarea，ir/wysiwyg 用其外层容器，preview 用预览窗。
   *  - vdMode='sv'（SV 基础）：按 vdPreview 决定 both/editor/preview 三种布局
   *  - vdMode='ir'|'wysiwyg'（编辑节点）：仅显示对应编辑区，源码与预览一律隐藏
   * 作者: 火 冰 */
  function applyVdVisibility() {
    if (!vdInst || !vdInst.vditor) return;
    const v = vdInst.vditor;
    if (!v.sv || !v.ir || !v.wysiwyg || !v.preview) return;
    const sv = v.sv.element;
    const prev = v.preview.element;
    const ir = v.ir.element.parentElement;
    const wy = v.wysiwyg.element.parentElement;
    if (vdMode === 'sv') {
      sv.style.display = (vdPreview === 'preview') ? 'none' : 'block';
      prev.style.display = (vdPreview === 'both' || vdPreview === 'preview') ? 'block' : 'none';
      ir.style.display = 'none';
      wy.style.display = 'none';
      // 展示预览窗时确保其已渲染当前内容（vditor 构建时不一定触发）
      if (prev.style.display === 'block') { try { v.preview.render(v); } catch (_) { /* 忽略渲染异常 */ } }
    } else {
      sv.style.display = 'none';
      prev.style.display = 'none';
      ir.style.display = (vdMode === 'ir') ? 'block' : 'none';
      wy.style.display = (vdMode === 'wysiwyg') ? 'block' : 'none';
    }
  }

  /** 取视觉锚点元素（vditor 挂载容器） */
  function vdEl() {
    return document.getElementById('ed-vditor');
  }

  /** 取当前实例内容：有实例用 getValue，否则用暂存缓冲 */
  function vdGetValue() {
    return vdInst ? vdInst.getValue() : vdBuffer;
  }

  /** 内容变更回传给宿主：vditor input/blur 回调统一入口
   * @param {string} v 最新 markdown 源文本 */
  function sync2Host(v) {
    if (typeof onEdInput === 'function') {
      try { onEdInput(v); } catch (_) { /* 回调异常忽略 */ }
    }
  }

  /* ============================================================
   * IR 模式表格右键菜单（IR 表格操作）
   * vditor 原生「表格浮层工具栏」只在 wysiwyg.popover（仅所见即所得出现）。
   * 本模块给 ir 模式补一个等价入口：在表格单元格内**右键**弹出「插入行/列、删除行/列」菜单。
   * 关键同步思路：IR 模式下 vditor 的 getValue/getMarkdown 恒按当前
   * ir.element.innerHTML 实时推导（见 vditor getMarkdown: ir→VditorIRDOM2Md(innerHTML)），
   * 因此直接在 ir.element 的真实 <table> DOM 上增删行/列后，调用 vdInst.getValue()
   * 即得正确 markdown 并 sync2Host 保存，无需触发 vditor 内部重渲染，光标不跳转。
   * 作者: 火 冰
   * ============================================================ */

  /** @type {{table:HTMLElement,tr:HTMLElement,td:HTMLElement}|null} IR 表格右键命中的单元格 */
  let irCtxHit = null;

  /** 取单元格在其所在行中的列索引
   * @param {HTMLElement} row   行元素（tr）
   * @param {HTMLElement} cell  td/th
   * @returns {number} */
  function irTableCellIndex(row, cell) {
    return Array.prototype.indexOf.call(row.children, cell);
  }

  /** 在当前行上/下方插入一行（行内单元格数与参考行一致；表头行用 th，数据行用 td）
   * 边界：表头行(th)下方插入时，新行必须落到 `|---|` 分隔线之下（tbody 首行），
   * 否则会串进 thead 变成第二行表头，序列化后出现在分隔线上方。
   * @param {HTMLElement} table   表格
   * @param {HTMLElement} refRow  参考行
   * @param {boolean} before      true=上方插入 | false=下方插入
   * @returns {HTMLElement} 新行 */
  function irInsertRow(table, refRow, before) {
    const isHeader = refRow.parentNode && refRow.parentNode.nodeName === 'THEAD';
    // 新插入的行一律是数据行（td）。注意：绝不往 thead 里插新表头行，
    // 否则序列化会出现「分隔线上方」的假表头。
    const tr = document.createElement('tr');
    const n = refRow.cells ? refRow.cells.length : 0;
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('td');
      cell.innerHTML = '\u00a0<br>';
      tr.appendChild(cell);
    }
    if (isHeader) {
      // 表头下方插行：作为首条数据行放到 tbody（分隔线之下）
      let tb = table.querySelector('tbody');
      if (!tb) { tb = document.createElement('tbody'); table.appendChild(tb); }
      tb.insertBefore(tr, tb.firstChild || null);
    } else if (before) {
      refRow.parentNode.insertBefore(tr, refRow);
    } else if (refRow.nextSibling) {
      refRow.parentNode.insertBefore(tr, refRow.nextSibling);
    } else {
      refRow.parentNode.appendChild(tr);
    }
    return tr;
  }

  /** 在参考列左/右侧插入一列（对每一行实行插入单元格；表头行用 th，数据行用 td）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 参考行（取列数基准）
   * @param {number} idx         参考列索引
   * @param {boolean} before     true=左侧 | false=右侧
   */
  function irInsertCol(table, refRow, idx, before) {
    const rows = table.rows || [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.cells || row.cells.length <= idx) continue;
      const tag = (row.parentNode && row.parentNode.nodeName === 'THEAD') ? 'th' : 'td';
      const cell = document.createElement(tag);
      cell.innerHTML = '\u00a0<br>';
      if (before) {
        row.cells[idx].parentNode.insertBefore(cell, row.cells[idx]);
      } else {
        row.cells[idx].insertAdjacentElement('afterend', cell);
      }
    }
  }

  /** 删除参考行（边界：表头行不可删，否则失去表头；仅数据行可删，且保留至少一行避免整表被清空）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 待删行 */
  function irDeleteRow(table, refRow) {
    const isHeader = refRow.parentNode && refRow.parentNode.nodeName === 'THEAD';
    if (isHeader) return; // 表头行不可删除
    if ((table.rows || []).length > 1) refRow.parentNode.removeChild(refRow);
  }

  /** 删除参考列（每行仅当列数 >1 才删）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 参考行
   * @param {number} idx         待删列索引 */
  function irDeleteCol(table, refRow, idx) {
    const rows = table.rows || [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.cells || row.cells.length <= idx || row.cells.length <= 1) continue;
      row.removeChild(row.cells[idx]);
    }
  }

  /* 暴露纯 DOM 表格助手到 window.__vdTable（jsdom 回归断言用），不改业务路径 */
  window.__vdTable = {
    irInsertRow: irInsertRow,
    irInsertCol: irInsertCol,
    irDeleteRow: irDeleteRow,
    irDeleteCol: irDeleteCol,
    irTableCellIndex: irTableCellIndex,
  };

  /** 构建表格右键菜单单项
   * @param {string} label 文案
   * @param {string} icon  lucide 图标名
   * @param {Function} action 点击回调 */
  function irTableMenuItem(label, icon, action) {
    const item = document.createElement('button');
    item.type = 'button';
    item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
      + 'padding:6px 10px;border:none;background:transparent;color:var(--note-ink,#333);'
      + 'font-size:13px;text-align:left;cursor:pointer;border-radius:4px;';
    item.addEventListener('mouseover', function () { item.style.background = 'rgba(0,0,0,.06)'; });
    item.addEventListener('mouseout', function () { item.style.background = 'transparent'; });
    item.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4"></i><span>' + label + '</span>';
    item.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 不抢走编辑器光标
    item.addEventListener('click', function () { closeIrTableMenu(); action(); });
    return item;
  }

  /** 关闭 IR 表格右键菜单 */
  function closeIrTableMenu() {
    const menu = document.getElementById('ed-ir-table-menu');
    if (menu) menu.remove();
    const backdrop = document.getElementById('ed-ir-table-backdrop');
    if (backdrop) backdrop.remove();
  }

  /** 显示 IR 表格右键菜单（靠近边缘自动翻转防溢出）
   * @param {number} x 鼠标 X
   * @param {number} y 鼠标 Y
   * @param {boolean} isHeader 是否光标在表头行（表头行不提供「上方插入行」「删除该行」） */
  function showIrTableMenu(x, y, isHeader) {
    closeIrTableMenu();
    const menu = document.createElement('div');
    menu.id = 'ed-ir-table-menu';
    menu.style.cssText = 'position:fixed;z-index:180;min-width:150px;padding:6px;'
      + 'background:var(--note-surface-2,#fff);border:1px solid var(--note-border,#e0e0e0);'
      + 'border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.16);';
    const defs = [
      ['在上方插入行', 'arrow-up', 'row', 'before'],
      ['在下方插入行', 'arrow-down', 'row', 'after'],
      ['在左侧插入列', 'arrow-left', 'col', 'before'],
      ['在右侧插入列', 'arrow-right', 'col', 'after'],
      ['删除该行', 'unlink', 'row', 'delete'],
      ['删除该列', 'columns', 'col', 'delete'],
    ];
    defs.forEach(function (d) {
      if (isHeader && (d[2] + ':' + d[3] === 'row:before')) return; // 表头行不可在上方插入
      if (isHeader && (d[2] + ':' + d[3] === 'row:delete')) return; // 表头行不可删除
      menu.appendChild(irTableMenuItem(d[0], d[1], function () { irTableBarAction(d[2], d[3]); }));
    });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - r.width)) + 'px';
    menu.style.top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - r.height)) + 'px';
    // 遮罩：点击 / 右键 / 滚动 关闭
    const overlay = document.createElement('div');
    overlay.id = 'ed-ir-table-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:179;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeIrTableMenu(); });
    overlay.addEventListener('click', closeIrTableMenu);
    overlay.addEventListener('scroll', closeIrTableMenu, true);
    document.body.appendChild(overlay);
    if (typeof refreshIcons === 'function') { try { refreshIcons(); } catch (_) { /* 忽略 */ } }
  }

  /** 右键命中探测：落在 ir 编辑区某表格单元格内
   * @param {Event}  e 右键事件
   * @param {Object} v vditor 内部对象（vdInst.vditor）
   * @returns {{table:HTMLElement,tr:HTMLElement,td:HTMLElement}|null} */
  function irTableAtRightClick(e, v) {
    const node = e.target;
    if (!node || !v.ir || !v.ir.element || !v.ir.element.contains(node)) return null;
    const td = (node.nodeType === 1) ? node.closest('td,th')
      : (node.parentElement && node.parentElement.closest('td,th'));
    if (!td) return null;
    const tr = td.parentNode;
    const table = tr && tr.closest ? tr.closest('table') : null;
    return table ? { table: table, tr: tr, td: td } : null;
  }

  /** 执行行/列操作并同步保存（右键菜单动作）
   * @param {string} axis 'row'|'col'
   * @param {string} op   'before'|'after'|'delete' */
  function irTableBarAction(axis, op) {
    if (!irCtxHit || !vdInst) return;
    const hit = irCtxHit;
    const v = vdInst.vditor;
    const idx = irTableCellIndex(hit.tr, hit.td);
    if (axis === 'row') {
      if (op === 'delete') irDeleteRow(hit.table, hit.tr);
      else irInsertRow(hit.table, hit.tr, op === 'before');
    } else {
      if (op === 'delete') irDeleteCol(hit.table, hit.tr, idx);
      else irInsertCol(hit.table, hit.tr, idx, op === 'before');
    }
    // IR 下 getValue 实时由 ir.element.innerHTML 推导，改完直接回传宿主保存
    try { sync2Host(vdInst.getValue()); } catch (_) { /* 忽略同步异常 */ }
    irCtxHit = null;
    if (v.ir && v.ir.element) { try { v.ir.element.focus(); } catch (_) { /* 忽略 */ } }
  }

  /* IR 表格右键：落在表格单元格内时拦截默认菜单，弹表格操作菜单；切非 IR 或非表格时放行默认 */
  document.addEventListener('contextmenu', function (e) {
    if (!vdInst || vdMode !== 'ir') { irCtxHit = null; return; }
    const v = vdInst.vditor;
    const hit = irTableAtRightClick(e, v);
    if (!hit) { irCtxHit = null; return; }
    e.preventDefault();
    irCtxHit = hit;
    const isHeader = hit.tr && hit.tr.parentNode && hit.tr.parentNode.nodeName === 'THEAD';
    showIrTableMenu(e.clientX, e.clientY, isHeader);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeIrTableMenu(); });

  /** 构建 vditor 实例（核心装配）。在 vdInst 存在时先销毁保留内容。
   * 说明：edit/split/preview 用 setPreviewMode 切换，无需重建；仅 ir↔sv 切换才重建。 */
  function buildVditor() {
    const el = vdEl();
    const value = vdInst ? vdInst.getValue() : vdBuffer;
    if (vdInst) { try { vdInst.destroy(); } catch (_) { /* 忽略销毁异常 */ } }
    vdInst = null;
    vdReady = false;   // 重建后视为未就绪，待 after 回调确认首帧渲染完成
    if (!el || typeof window.Vditor !== 'function') {
      vdBuffer = value;   // vditor 不可用（如 jsdom/无依赖）时保留缓冲，保障宿主不崩
      return;
    }
    /* 闭包捕获待创建实例：vditor 的 after 回调是平调用（this 不指向实例），
     * 且可能在 new 返回前触发，故用 inst 变量在构造后立即填充，供回调取用。 */
    let inst = null;
    const opts = {
      mode: vdMode,
      value: value,
      cache: false,
      // 资源直接走 node_modules/vditor/dist（npm 运行时依赖，随包分发，含官方 dist 目录结构），
      // 避免从 unpkg.com 拉 i18n/lute/主题/icons 造成弱网下编辑区十几秒才渲染（Bug-029），
      // 也避免在仓库内 vendor 复制 vditor 导致 dist 迁移占用/历史膨胀（Bug-031）。
      cdn: 'node_modules/vditor',
      theme: resolveVdTheme().theme,
      lineNumber: !!(typeof restoreS === 'function' ? restoreS('lineNumbers', true) : true),
      toolbar: VDTOOLBAR,
      preview: { delay: 50, cdn: '', mode: (vdPreview === 'both') ? 'both' : 'editor' },
      input: function (v) { sync2Host(v); },
      blur: function () { sync2Host(vdGetValue()); },
      /* vditor 首帧异步渲染完成后的回调：把 init 期间积压的待渲内容补进编辑器，
       * 修复启动/快速切换时「工具栏渲染正常但内容区空白」的时序问题。
       * 注意回调内 this 不指向实例，必须用 inst/vdInst 显式引用。
       * 作者: 火 冰 */
      after: function () {
        vdReady = true;
        const target = inst || vdInst;
        const pending = (vdPending != null) ? vdPending : '';
        vdPending = null;
        if (pending !== '' && target) {
          try { target.setValue(pending); console.log('[vditor] 首帧渲染完成，已补渲 ' + pending.length + ' 字符'); }
          catch (e) { console.warn('[vd-after] setValue error: ' + e); }
        }
        // 异步首帧渲染后，vditor 可能按默认 preview 布局重置各视图显隐；
        // 再确定性覆盖一次，确保进入「仅源码/仅预览」等布局时其它视图不残留。
        applyVdVisibility();
      },
    };
    try {
      inst = new window.Vditor(el, opts);
      vdInst = inst;
      vdBuffer = '';
      // 构建后应用解析出的额外主题 CSS（插件注入的编辑器覆盖样式）
      applyVdExtraCss(resolveVdTheme().extraCss);
      // 构建后确定性应用当前模式对应的视图显隐（sv 三种布局 / ir / wysiwyg），
      // 取代 vditor setPreviewMode（其对 'preview' 无效且会强制 sv 源码可见）
      applyVdVisibility();
    } catch (err) {
      vdInst = null;
      vdBuffer = value;
      console.error('[vditor] 初始化失败：', err);
    }
  }

  /** 确保实例存在并返回（懒创建）；vditor 不可用时返回 null */
  function ensureVd() {
    if (!vdInst) buildVditor();
    return vdInst;
  }

  /* ---------- 宿主桥接函数（暴露到 globalThis，供 editor-host.js 与插件 action 调用） ---------- */

  /** 初始化：懒创建 vditor 实例（首次渲染实际内容见 vdSyncValue） */
  window.vdInit = function () {
    vdPreview = 'editor';
    ensureVd();
  };

  /** 把某篇笔记内容同步进编辑区（首次打开懒创建实例）；内容会覆盖编辑器当前内容并重置为保存态
   * 说明：分屏(both)布局下 vditor 运行期 setValue 只刷新右侧预览、左侧源码面板不同步，会呈现
   * 「左大片空白 + 右侧窄条」；故分屏态改为销毁重建实例，让两侧面板都用新内容填充。
   * @param {string} md markdown 源文本 */
  window.vdSyncValue = function (md) {
    vdBuffer = String(md == null ? '' : md);
    if (!vdInst) { buildVditor(); return; }
    // 实例尚未完成异步渲染（vditor 的 mode 首帧渲染是异步的，见 options.after）：
    // 立即 setValue 会因首发渲染后重置而被丢弃，导致启动/快速切换时编辑区空白。
    // 故未就绪时先暂存，待 after 回调再补渲染进去。
    if (!vdReady) { vdPending = vdBuffer; return; }
    if (vdPreview === 'both') {
      // 分屏视图：重建实例以完整刷新左源码/右预览，避免 setValue 在分屏下的内容不同步窄条
      try { vdInst.destroy(); } catch (_) { /* 忽略销毁异常 */ }
      vdInst = null;
      buildVditor();
      return;
    }
    try { vdInst.setValue(vdBuffer); } catch (_) { /* 忽略 */ }
  };

  /** 仅在暂存缓冲层面设置内容（无实例时用于清空/占位，例如删除当前笔记后）
   * @param {string} md markdown 源文本 */
  window.vdSetValue = function (md) {
    vdBuffer = String(md == null ? '' : md);
    if (vdInst) { try { vdInst.setValue(vdBuffer); } catch (_) { /* 忽略 */ } }
  };

  /** 获取编辑区当前内容 */
  window.vdGetValue = vdGetValue;

  /** 切换编辑/预览/分屏三态：绑定 vditor 能力
   *  - 'edit'    → 编辑（编辑节点由 vdEditorNode 决定：ir 即时渲染 / wysiwyg 所见即所得），只显示编辑区
   *  - 'split'   → 分屏（SV 源码分屏：左源码右预览）
   *  - 'preview' → 预览（SV 纯预览，只展示整幅渲染结果）
   * 说明：不再调用 vditor setPreviewMode('editor')（它会把 sv 源码 textarea 置为 display:block，
   *       污染 IR/WYSIWYG 编辑态、残留挤压编辑区——修复切换页签/新开笔记编辑区变窄 Bug）。
   *       视图显隐统一由 applyVdVisibility 确定性接管。
   * @param {string} mode 'edit' | 'split' | 'preview'
   * author 火 冰 */
  window.vdSetMode = function (mode) {
    if (mode === 'preview') {
      // 纯预览 = SV 模式 + preview.mode=preview（整幅渲染，不含源码）
      vdMode = 'sv';
      vdPreview = 'preview';
      applyVdOrRebuild();
      return;
    }
    if (mode === 'split') {
      // 分屏 = SV 源码分屏：重建实例使源码/预览左右并排
      vdMode = 'sv';
      vdPreview = 'both';
      applyVdOrRebuild();
      return;
    }
    // 编辑：单选已由 vdSetEditorNode 写入 vdMode(ir/wysiwyg)；保证处于编辑节点且仅显示编辑区
    if (vdMode === 'sv') {
      // 从分屏/预览退回编辑：恢复上次编辑节点，需重建实例使编辑节点生效
      vdMode = vdEditorNode;
      vdPreview = 'editor';
      buildVditor();
      return;
    }
    // 非 SV 态（ir/wysiwyg 已就位）：仅需确定性隐藏源码/预览、显示当前编辑节点
    vdPreview = 'editor';
    applyVdVisibility();
  };

  /** 在 SV 源码分屏基础上直接切换到指定预览布局（both 源码+预览 / editor 仅源码 / preview 仅预览）。
   *  这是「分屏」按钮悬浮直选与「预览」按钮的统一入口，也承载分屏「点击循环」。
   *  - 已处于 SV 视图且实例就绪（currentMode==='sv'）：直接切换显隐，避免重建闪烁、保留内容
   *  - 否则重建实例（含从编辑态进入分屏）
   * @param {'both'|'editor'|'preview'} pm 预览布局
   * author 火 冰 */
  window.vdSetPreviewMode = function (pm) {
    if (['both', 'editor', 'preview'].indexOf(pm) === -1) pm = 'both';
    vdMode = 'sv';
    vdPreview = pm;
    applyVdOrRebuild();
  };

  /** 内部：已处于 SV 视图（vditor currentMode==='sv'）直接切显隐，否则重建实例进入 SV。
   * author 火 冰 */
  function applyVdOrRebuild() {
    if (vdInst && vdInst.vditor && vdInst.vditor.currentMode === 'sv') {
      applyVdVisibility();
      return;
    }
    buildVditor();
  }

  /** 选择编辑子节点（供「编辑」按钮冒泡子菜单调用）：即时渲染 / 所见即所得
   * @param {'ir'|'wysiwyg'} node 编辑节点类型 */
  window.vdSetEditorNode = function (node) {
    vdEditorNode = (node === 'wysiwyg') ? 'wysiwyg' : 'ir';
    // 非编辑态（预览/分屏）仅记录偏好，不改 vdMode（编辑态由 vdMode 承载实例节点）
    if (vdPreview === 'editor') {
      if (vdMode === vdEditorNode) return;
      vdMode = vdEditorNode;
      buildVditor();      // 重建以应用新编辑节点
    }
  };

  /** 读取当前编辑子节点偏好（供宿主展示「编辑 · 所见即所得 / 即时渲染」）
   * @returns {'ir'|'wysiwyg'} */
  window.vdGetEditorNode = function () { return vdEditorNode; };

  /** 切换源码/即时渲染（插件 mde-toggle-source 直接调用，翻转当前编辑节点模式） */
  window.vdToggleSource = function () {
    vdMode = vdMode === 'sv' ? 'ir' : 'sv';
    buildVditor();
  };

  /** 销毁实例（切库/卸载编辑器时释放资源） */
  window.vdDestroy = function () {
    if (vdInst) { try { vdInst.destroy(); } catch (_) { /* 忽略 */ } }
    vdInst = null;
  };

  /* ---------- 宿主自接管全屏（舍弃 vditor 内置 fullscreen，其还原在宿主下不可靠） ---------- */

  /** 是否处于宿主全屏态 */
  let vdHf = false;

  /** 切换宿主全屏：给 body 加 ed-fs-active（隐藏外围 UI，编辑区独占撑满），并显示/隐藏浮动「退出全屏」按钮
   * 说明: 不再依赖 fixed 铺满（transform 包裹元素会劫持 containing block 导致铺不满视口），
   *      改为隐藏左文件树/右面板/顶栏/状态栏后由编辑区 flex 占满。作者: 火 冰 */
  function vdHostFullscreen(on) {
    vdHf = on;
    document.body.classList.toggle('ed-fs-active', on);
    document.documentElement.classList.toggle('ed-fs-active', on);
    let b = document.getElementById('vd-fs-exit');
    if (on) {
      if (!b) {
        b = document.createElement('button');
        b.id = 'vd-fs-exit';
        b.type = 'button';
        b.title = '退出全屏（Esc）';
        b.textContent = '退出全屏 ✕';
        b.style.cssText = 'position:fixed; top:52px; right:16px; z-index:99999; height:30px; padding:0 12px; border:none; border-radius:6px; background:rgba(124,58,237,.92); color:#fff; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;';
        b.addEventListener('click', function () { vdHostFullscreen(false); });
      }
      b.style.display = 'flex';
      document.body.appendChild(b);
    } else if (b) {
      b.style.display = 'none';
    }
  }

  /** 面板上「全屏」按钮入口：切换宿主全屏 */
  window.vdToggleFullscreen = function () {
    vdHostFullscreen(!vdHf);
  };

  /** Esc 退出生效的全屏 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && vdHf) vdHostFullscreen(false);
  });

  /* ---------- 注册 .md/.markdown 编辑器 Provider ---------- */

  // 全局主题变更（设置-外观-主题模式 / 命令面板切换主题）→ 即时同步 vditor 主题。
  // app-core setTheme 每次都会更新 html[data-theme]（dark/light/auto 的已解析结果），以此为唯一信号源。
  if (window.MutationObserver) {
    const themeObs = new MutationObserver(function () { syncVdTheme(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** 注册编辑器 Provider：宿主 openNote 按后缀路由到本引擎（.md/.markdown）。
   * 用模块级标记防重复注册（宿主注册 + 可能的插件残留都可能再调）。 */
  function registerVdProvider() {
    if (typeof registerEditorProvider !== 'function') return;
    if (window.__vdProviderRegistered) return;
    window.__vdProviderRegistered = 1;
    registerEditorProvider({
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
      /* 编辑区渲染已由 vditor 全权承担（vdInit/vdSetMode 驱动）——
         renderWysiwyg 仅保留契约空实现，避免宿主回退调用 app-note.js 的 renderMarkdown，
         保证 markdown 轻量渲染模块与编辑区彻底解耦。 */
      renderWysiwyg: function () { return ''; },
      getMd: function () { return vdGetValue(); },
      buildContextMenu: function () { return []; },
      renderSidebar: function () { return Promise.resolve(); },
    });
  }

  // 脚本已晚于 app-plugins.js 加载，直接注册；额外兜底 DOM 就绪后再注册一次（防顺序异常）
  registerVdProvider();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerVdProvider);
  } else {
    registerVdProvider();
  }
})();