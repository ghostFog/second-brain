/* ============================================
 * 第二脑 — Markdown 编辑引擎 vditor 桥接 + .md Provider
 * 作者: 火 冰
 * 功能:
 *   - 引入开源引擎 vditor（js/vendor/vditor）作为 Markdown 编辑区唯一渲染/编辑实现，
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
    'quote', 'line', 'code', 'inline-code', '|', 'table', 'formula', 'link', '|',
    'outline', 'export', '|', 'find',
  ];

  /** 应用当前是否为暗色主题（用于 vditor theme 选项跟随宿主）。
   *  读取全局已解析的 `html[data-theme]`（设置-外观-主题模式 dark/light/auto 的最终结果），
   *  auto 时由 app-core setTheme 已解析为 dark/light
   * author 火 冰 */
  function isDarkTheme() {
    return document.documentElement && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  /** 将 vditor 主题与全局一致（跟随 设置-外观-主题模式 的已解析结果）。
   *  已构建实例即时 setTheme；未构建则空转，由 buildVditor 用 isDarkTheme() 兜底。
   * author 火 冰 */
  function syncVdTheme() {
    const dark = isDarkTheme();
    if (vdInst) {
      try { vdInst.setTheme(dark ? 'dark' : 'light'); } catch (_) { /* 忽略同步异常 */ }
    }
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
      theme: isDarkTheme() ? 'dark' : 'light',
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

  /** 切换宿主全屏：给 #ed-vditor 加 fixed 全屏类，并显示/隐藏浮动「退出全屏」按钮
   * 作者: 火 冰 */
  function vdHostFullscreen(on) {
    vdHf = on;
    const el = vdEl();
    if (el) el.classList.toggle('vd-host-fullscreen', on);
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