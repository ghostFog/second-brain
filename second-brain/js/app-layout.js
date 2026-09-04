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

  /** 绑定当前视图的交互 */
  function bindViewInteractions(key) {
    if (key === 'editor') {
      initEditor();
    } else if (key === 'graph') {
      initGraph();
    } else if (key === 'plugins') {
      const dataEl = document.getElementById('plugin-data');
      pluginData = JSON.parse(dataEl ? dataEl.textContent : '[]');
      bindPlugins(); renderPlugins('all', '', '');
    } else if (key === 'settings') {
      bindSettings();
    } else if (key === 'ai') {
      initAi();
    }
    bindResponsivePanels();
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

    // 文件树笔记行右键菜单（在资源管理器显示）
    bindNoteContextMenu();

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

    // 全局快捷键
    document.addEventListener('keydown', function (e) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); paletteOpen ? closePalette() : openPalette(); }
      else if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); location.hash = '#/graph'; }
      else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); location.hash = '#/editor'; document.dispatchEvent(new CustomEvent('note:new')); }
      else if (mod && e.key.toLowerCase() === 'f' && activeView === 'editor') { e.preventDefault(); openFindbar(false); }
      else if (mod && e.key.toLowerCase() === 'r' && activeView === 'editor') { e.preventDefault(); openFindbar(true); }
      // Esc 关闭查找/替换条（焦点不在输入框内也生效，重复调用幂等）
      if (findOpen && !paletteOpen && e.key === 'Escape') { closeFindbar(); }
      if (paletteOpen) {
        if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); paletteIndex = Math.min(paletteIndex + 1, paletteItems.length - 1); highlightPaletteItem(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); paletteIndex = Math.max(paletteIndex - 1, 0); highlightPaletteItem(); }
        else if (e.key === 'Enter') { e.preventDefault(); if (paletteItems[paletteIndex]) runCommand(paletteItems[paletteIndex]); }
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

