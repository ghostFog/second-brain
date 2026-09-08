/* ============================================
 * 第二脑 — 布局/响应式与启动引导
 * 作者: 火 冰
 * 功能: 分栏拖拽、响应式面板、视图装载、全局初始化与 DOMContentLoaded 启动钩子
 * ============================================ */

'use strict';


  /* 目录区宽度拖拽：拖动 .tree-resizer 调整左侧文件树宽度，并持久化到本地
 * 说明：文档级 mousemove/mouseup 仅绑定一次（_treeResizeBound 守卫），
 *       每次进入编辑器视图时 handle 是重新渲染的新元素所以需重新绑定 mousedown */
  let _treeResizeBound = false;
  function bindTreeResizer() {
    const handle = document.getElementById('tree-resizer');
    const aside = document.querySelector('.resp-leaf');
    if (!handle || !aside) return;
    const saved = restoreS('treeWidth', null);
    if (saved) aside.style.width = saved + 'px';
    else aside.style.width = '280px'; // 首次进入的推荐宽度，拖拽后会覆盖并持久化
    let dragging = false;
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      document.body.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      handle.classList.add('dragging');
      e.preventDefault();
    });
    if (!_treeResizeBound) {
      _treeResizeBound = true;
      const done = function () {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        const h2 = document.getElementById('tree-resizer');
        if (h2) h2.classList.remove('dragging');
        const a2 = document.querySelector('.resp-leaf');
        if (a2) saveS('treeWidth', Math.round(parseFloat(a2.style.width) || 240));
      };
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        const vw = document.querySelector('.view-row');
        const left = vw ? vw.getBoundingClientRect().left : 0;
        let w = e.clientX - left;
        w = Math.max(180, Math.min(520, w));
        aside.style.width = w + 'px';
      });
      document.addEventListener('mouseup', done);
      document.addEventListener('mouseleave', done);
    }
  }

  /* 右侧侧边面板宽度拖拽：拖动 .side-resizer 调整面板宽度，并持久化到本地
   * 逻辑与目录区互不干扰（各自独立的 _bound 守卫与 dragging 标志）
   * 作者: 火 冰 */
  let _sideResizeBound = false;
  function bindSideResizer() {
    const handle = document.getElementById('side-resizer');
    const panel = document.getElementById('right-panel');
    if (!handle || !panel) return;
    const saved = restoreS('sideWidth', null);
    if (saved) panel.style.width = saved + 'px';      // 启动恢复上次宽度
    else panel.style.width = '288px';                  // 默认与设计稿 w-72 一致
    let dragging = false;
    handle.addEventListener('mousedown', function (e) {
      dragging = true;
      document.body.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      handle.classList.add('dragging');
      e.preventDefault();
    });
    if (!_sideResizeBound) {
      _sideResizeBound = true;
      const done = function () {
        if (!dragging) return;
        dragging = false;
        document.body.classList.remove('resizing');
        document.body.style.cursor = '';
        const h2 = document.getElementById('side-resizer');
        if (h2) h2.classList.remove('dragging');
        const p2 = document.getElementById('right-panel');
        if (p2) saveS('sideWidth', Math.round(parseFloat(p2.style.width) || 288));
      };
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        const vw = document.querySelector('.view-row');
        const right = vw ? vw.getBoundingClientRect().right : e.clientX;
        let w = right - e.clientX;
        w = Math.max(220, Math.min(440, w));
        panel.style.width = w + 'px';
      });
      document.addEventListener('mouseup', done);
      document.addEventListener('mouseleave', done);
    }
  }

  function bindResponsivePanels() {
    // 边缘展开把手：边栏收起后挂在窗口两侧，仅创建一次（作者: 火 冰）
    if (!window.__edgeToggles) {
      const mk = function (id, icon, on) {
        const b = document.createElement('button');
        b.id = id; b.className = 'edge-toggle';
        b.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4"></i>';
        b.addEventListener('click', function () { on(); });
        document.body.appendChild(b);
        return b;
      };
      const leftBtn = mk('edge-toggle-left', 'panel-left-open', function () {
        const leaf = document.querySelector('.resp-leaf');
        if (leaf) leaf.classList.remove('collapsed');
        const eb = document.getElementById('edge-toggle-left');
        if (eb) eb.classList.remove('show');
      });
      const rightBtn = mk('edge-toggle-right', 'panel-right-open', function () {
        const panel = document.getElementById('right-panel');
        if (panel) panel.classList.remove('collapsed');
        const eb = document.getElementById('edge-toggle-right');
        if (eb) eb.classList.remove('show');
      });
      window.__edgeToggles = { leftBtn: leftBtn, rightBtn: rightBtn };
      refreshIcons();
    }
    // 绑定当前视图中所有右侧面板开关按钮（编辑器保留按钮、图谱右上角 X）
    document.querySelectorAll('.view.active [data-dom-id="resp-sidebar-btn"]').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        const active = btn.closest('.view');
        const sidebar = active ? active.querySelector('.resp-sidebar') : null;
        if (sidebar) sidebar.classList.toggle('open');
      });
    });

    // 左侧文件树「收起」按钮：桌面端收起左侧栏
    const collapseLeaf = document.querySelector('[data-dom-id="leaf-collapse"]');
    if (collapseLeaf) collapseLeaf.addEventListener('click', function () {
      const leaf = document.querySelector('.resp-leaf');
      if (!leaf) return;
      leaf.classList.add('collapsed');
      const t = window.__edgeToggles && window.__edgeToggles.leftBtn;
      if (t) t.classList.add('show');
    });

    // 编辑器右侧面板「关闭面板」按钮：收起右侧面板（桌面端）
    const closeSide = document.querySelector('[data-dom-id="close-sidebar"]');
    if (closeSide) closeSide.addEventListener('click', function () {
      const panel = document.getElementById('right-panel');
      if (panel) panel.classList.add('collapsed');
      else document.querySelectorAll('.resp-sidebar.open').forEach(s => s.classList.add('collapsed'));
      const t = window.__edgeToggles && window.__edgeToggles.rightBtn;
      if (t) t.classList.add('show');
    });

    // 移动端底栏
    const toggleLeaf = document.getElementById('m-toggle-leaf');
    const toggleSide = document.getElementById('m-toggle-side');
    if (toggleLeaf) toggleLeaf.addEventListener('click', function () {
      const active = document.querySelector('.view.active');
      const leaf = active ? active.querySelector('.resp-leaf') : null;
      if (leaf) leaf.classList.toggle('open');
    });
    if (toggleSide) toggleSide.addEventListener('click', function () {
      const active = document.querySelector('.view.active');
      const side = active ? active.querySelector('.resp-sidebar') : null;
      if (side) side.classList.toggle('open');
    });
  }

  /* ============================
   * 视图加载与全局绑定
   * ============================ */

  /** 加载指定视图 */
  async function loadView(key) {
    const route = ROUTES[key];
    if (!route) { activeView = 'editor'; location.hash = '#/editor'; return; }
    // 离开编辑器视图前销毁 vditor 实例：切走时旧 DOM 被替换，但模块级 vdInst 仍持有
    // 已失效实例引用，导致切回编辑器时 ensureVd 不重建新实例 → 编辑区空白。
    // 此处显式 vdDestroy 释放引用，保证返回编辑器时 vdInit 在全新 DOM 上重建。作者: 火 冰
    if (activeView === 'editor' && typeof window.vdDestroy === 'function') {
      try { window.vdDestroy(); } catch (e) { if (window.SBLog) window.SBLog.warn('[loadView] vdDestroy: ' + e); }
    }
    viewRoot.classList.add('view', 'active');
    updateNav(key);
    updateCrumb(key);

    if (cachedViews[key]) {
      viewRoot.innerHTML = cachedViews[key];
    } else {
      // 所有视图均为 fetch 获取（需本地服务器）
      const resp = await fetch(route.file);
      if (!resp.ok) { viewRoot.innerHTML = '<div class="p-8 text-caption" style="color: var(--note-ink-3);">无法加载视图，请通过本地服务器访问（python -m http.server）。</div>'; return; }
      const html = await resp.text();
      cachedViews[key] = html;
      viewRoot.innerHTML = html;
    }
    refreshIcons();
    activeView = key;
    bindViewInteractions(key);
  }

  /** 绑定当前视图的交互
   * 说明：对每个视图的初始化做 try/catch 隔离 —— 单个视图初始化异常只记录日志，
   *       不再中断 loadView / 拖垮标题栏、Ribbon、命令面板等全局绑定的挂载（防整体空白）。作者: 火 冰 */
  function bindViewInteractions(key) {
    if (key === 'editor') {
      safeInit('initEditor', function () { initEditor(); }, key);
    } else if (key === 'graph') {
      safeInit('initGraph', function () { initGraph(); }, key);
    } else if (key === 'plugins') {
      safeInit('bindPlugins', function () {
        // DEFAULT_PLUGIN_DATA 为单一数据源（initPluginSystem 已填充 pluginData 并与本地目录插件合并）。
        // 仅当视图内嵌 JSON 为非空数组时覆盖，避免用空数组清空市场、丢掉已装插件。作者: 火 冰
        const dataEl = document.getElementById('plugin-data');
        let parsed = [];
        if (dataEl && dataEl.textContent) {
          try { parsed = JSON.parse(dataEl.textContent); } catch (_) { parsed = []; }
        }
        if (Array.isArray(parsed) && parsed.length > 0) pluginData = parsed;
        bindPlugins(); renderPlugins('all', '', '');
      }, key);
    } else if (key === 'settings') {
      safeInit('bindSettings', function () { bindSettings(); }, key);
    } else if (key === 'ai') {
      safeInit('initAi', function () { initAi(); }, key);
    }
    bindResponsivePanels();
  }

  /** 安全执行某个视图的初始化：异常时写入日志而不外抛
   * @param {string} name 初始化器名（用于日志）
   * @param {Function} fn  要执行的初始化函数
   * @param {string} key  当前视图 key
   * 作者: 火 冰 */
  function safeInit(name, fn, key) {
    try { fn(); }
    catch (e) {
      const msg = '视图初始化失败 [' + key + ' · ' + name + ']: ' + (e && e.message || e);
      if (window.SBLog) window.SBLog.error(msg, e && e.stack);
      else console.error(msg, e);
    }
  }

  /* ============================
   * 启动
   * ============================ */

  function init() {
    // 路由监听
    window.addEventListener('hashchange', function () { loadView(getRoute()); });

    // Ribbon 导航：data-nav-key 按钮点击切换 hash 路由
    document.querySelectorAll('[data-nav-key]').forEach(btn => {
      const route = btn.dataset.route;
      if (!route) return;
      btn.addEventListener('click', function () {
        // 目标 hash 与当前相同（点击当前所在视图）时不会触发 hashchange，需手动加载
        if (location.hash === route) loadView(route.replace('#/', ''));
        else location.hash = route;
      });
    });

    // 标题栏笔记库选择器
    initVaultPicker();

    // 插件系统：从 DEFAULT_PLUGIN_DATA 填充市场数据 + 注册已装插件的扩展点 + 加载本地目录插件。
    // 必须先于 RibbonManager.init，让插件 Ribbon/顶栏按钮在整体渲染前注册。作者: 火 冰
    if (typeof initPluginSystem === 'function') {
      safeInit('initPluginSystem', function () { initPluginSystem(); }, 'plugins');
    }

    // 快捷键注册表：初始化内置命令 + 同步插件命令（放在插件系统就绪之后）
    if (typeof kbInit === 'function') {
      safeInit('kbInit', function () { kbInit(); }, 'keybinds');
    }

    // Ribbon 左侧导航：由 RibbonManager 统一渲染（此前的启动引导缺失了 RibbonManager.init 调用，
    // 导致左侧按钮整列不渲染）；用 safeInit 隔离，失败只记日志不拖垮启动。作者: 火 冰
    if (typeof RibbonManager !== 'undefined' && RibbonManager.init) {
      safeInit('RibbonManager.init', function () { RibbonManager.init('file'); }, 'ribbon');
    }

    // 文件树右键菜单已由 js/file-tree-ctx.js 统一接管（目录/笔记/空白区三套，stopPropagation 阻断），此处不再绑定旧菜单

    // 编辑区右键菜单（仅当打开的是 .md 笔记）
    bindEditorContextMenu();

    // 命令面板按钮
    document.querySelectorAll('[data-dom-id="open-command-palette"], [data-dom-id="open-command-palette-ribbon"]').forEach(btn => {
      btn.addEventListener('click', openPalette);
    });
    document.querySelector('[data-dom-id="palette-close"]').addEventListener('click', closePalette);
    document.querySelector('[data-dom-id="palette-backdrop"]').addEventListener('click', closePalette);

    // 命令面板键盘交互
    document.getElementById('palette-input').addEventListener('input', function () {
      renderPalette(this.value);
    });
    document.getElementById('palette-list').addEventListener('mouseover', function (e) {
      const item = e.target.closest('.palette-item');
      if (item) { paletteIndex = +item.dataset.idx; highlightPaletteItem(); }
    });

    // 全局快捷键：命令面板/查找条 UI 键优先，其余命令统一走注册表 kbMatch（app-keybinds.js）
    document.addEventListener('keydown', function (e) {
      // Esc 关闭查找/替换条（焦点不在输入框内也生效，重复调用幂等）
      if (findOpen && !paletteOpen && e.key === 'Escape') { closeFindbar(); }
      // 命令面板 UI 键（方向键/Enter/Esc）优先处理，避免被输入态防护拦截
      if (paletteOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); return; }
        else if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1); highlightPaletteItem(); return; }
        else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); highlightPaletteItem(); return; }
        else if (e.key === 'Enter') { e.preventDefault(); if (paletteItems[paletteIndex]) runCommand(paletteItems[paletteIndex]); return; }
      }
      // 输入态防护：焦点在 input/textarea/[contenteditable] 且非命令面板时，仅放行带修饰键的命令，避免打字误触发
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
      const hasMod = e.ctrlKey || e.metaKey || e.altKey;
      if (typing && !paletteOpen && !hasMod) return;
      // 其余命令统一从注册表匹配并执行（命中即吞掉事件）
      if (typeof kbMatch === 'function') {
        const cmd = kbMatch(e);
        if (cmd && typeof cmd.action === 'function') {
          e.preventDefault();
          try { cmd.action(); } catch (_) { }
        }
      }
    });

    // 系统主题监听（auto 模式）
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
        if (localStorage.getItem('note-app:theme') === 'auto') setTheme('auto', false);
      });
    }

    // 标题栏窗口控制按钮（桌面端通过 noteDesktop 控制，网页端无操作）
    const winCtrl = window.noteDesktop;
    if (winCtrl) {
      document.querySelectorAll('[data-win]').forEach(btn => {
        btn.addEventListener('click', function () {
          const cmd = this.dataset.win;
          if (cmd === 'min') winCtrl.minimize();
          else if (cmd === 'max') winCtrl.toggleMaximize();
          else if (cmd === 'close') winCtrl.close();
        });
      });
    }

    // 恢复持久化设置（仅作用于根样式，不依赖视图 DOM）
    window.__savedTheme = localStorage.getItem('note-app:theme') || 'dark';
    window.__savedAccent = localStorage.getItem('note-app:accent') || '#7C3AED';
    window.__savedFontSize = parseInt(localStorage.getItem('note-app:font-size') || '15', 10);
    window.__savedFontFamily = localStorage.getItem('note-app:font-family') || 'Inter';
    window.__savedFontMono = localStorage.getItem('note-app:font-mono') || 'JetBrains Mono';
    setTheme(window.__savedTheme, false);
    setAccent(window.__savedAccent);
    applyFontSize(window.__savedFontSize);
    applyFontFamily(window.__savedFontFamily);
    applyFontMono(window.__savedFontMono);
    applyEditorWrap(restoreS('wrap', true));
    applyReduceMotion(restoreS('reduceMotion', false));
    applyDensity(restoreS('density', '标准'));

    // 初始加载视图
    loadView(getRoute());
  }

  // 应用启动：拆分前 app.js 末尾的启动引导代码在拆分时丢失，
  // 需在最后加载的模块末尾显式调用 init()，挂载路由、视图与全局绑定（作者: 火 冰）
  init();

