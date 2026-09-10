/* ============================================
 * 第二脑 — Ribbon 导航管理器
 * 作者: 火 冰
 * 功能: 左侧 Ribbon 的统一渲染、拖拽排序、置顶、
 *       最大显示数量控制、三点溢出折叠、持久化顺序
 *
 * 按钮分三类：
 *   1. 内置导航按钮（编辑器/搜索/图谱/插件/AI问答）— 可排序、可置顶
 *   2. 设置按钮 — 固定在最后，不可排序
 *   3. 插件注入按钮 — 通过 registerPluginButton() 动态加入
 *
 * 持久化到 localStorage：
 *   note-app:ribbon-order  — 用户自定义的按钮 id 顺序（数组）
 *   note-app:ribbon-max    — Ribbon 最大显示数量（默认 7）
 *   note-app:ribbon-pinned — 置顶按钮 id 集合（数组）
 * ============================================ */
'use strict';

globalThis.RibbonManager = (function () {

  /* ============================
   * 1. 内置按钮定义
   * ============================ */

  /**
   * 内置 Ribbon 按钮清单（设置按钮单独处理，始终在最后）
   * @type {Object[]}
   */
  var BUILTIN_BUTTONS = [
    { id: 'file',     icon: 'file-text', title: '编辑器',     route: '#/editor',          kind: 'built-in' },
    // { id: 'search',   icon: 'search',    title: '搜索',       action: 'open-command',     kind: 'built-in' },
    { id: 'graph',    icon: 'git-fork',  title: '图谱视图',   route: '#/graph',           kind: 'built-in' },
    { id: 'plugins', icon: 'puzzle',    title: '插件市场',   route: '#/plugins',         kind: 'built-in' },
    { id: 'ai',       icon: 'brain',     title: 'AI 问答',    route: '#/ai',              kind: 'built-in' },
  ];

  /** 设置按钮配置（始终固定最后，不参与排序） */
  var SETTINGS_BUTTON = { id: 'settings', icon: 'settings', title: '设置', route: '#/settings', kind: 'settings' };

  /** 同步状态圆点（固定最底部，不参与排序） */
  var SYNC_DOT = { id: 'sync-dot', kind: 'sync-dot' };

  /* ============================
   * 2. 状态 & 持久化
   * ============================ */

  /** 当前所有可排序按钮（内置 + 插件，不含 settings 和 sync-dot） */
  var sortableButtons = [];

  /** 用户置顶的按钮 id 集合 */
  var pinnedIds = new Set();

  /** 最大显示在 Ribbon 的按钮数量（含设置按钮，但不含溢出三点和 sync-dot） */
  var maxButtons = 7;

  /** localStorage keys */
  var LS_ORDER   = 'note-app:ribbon-order';
  var LS_MAX     = 'note-app:ribbon-max';
  var LS_PINNED  = 'note-app:ribbon-pinned';

  /**
   * 读取持久化配置，恢复顺序/置顶/最大数量
   */
  function loadConfig() {
    try {
      var orderStr = localStorage.getItem(LS_ORDER);
      if (orderStr) savedOrder = JSON.parse(orderStr);
      var maxStr = localStorage.getItem(LS_MAX);
      if (maxStr) { maxButtons = Math.max(7, Math.min(15, parseInt(maxStr, 10) || 7)); }
      var pinnedStr = localStorage.getItem(LS_PINNED);
      if (pinnedStr) {
        var arr = JSON.parse(pinnedStr);
        if (Array.isArray(arr)) pinnedIds = new Set(arr);
      }
    } catch (_) { /* 损坏则用默认 */ }
  }

  /** 用户保存的顺序数组（id 列表），恢复时用 */
  var savedOrder = null;

  /**
   * 保存顺序到 localStorage
   */
  function persistOrder() {
    var ids = sortableButtons.map(function (b) { return b.id; });
    localStorage.setItem(LS_ORDER, JSON.stringify(ids));
  }

  /**
   * 保存置顶集合到 localStorage
   */
  function persistPinned() {
    localStorage.setItem(LS_PINNED, JSON.stringify(Array.from(pinnedIds)));
  }

  /**
   * 设置最大显示数量
   * @param {number} n 7~15
   */
  function setMaxButtons(n) {
    maxButtons = Math.max(7, Math.min(15, n));
    localStorage.setItem(LS_MAX, String(maxButtons));
    render();
  }

  /** 获取当前最大显示数量 */
  function getMaxButtons() { return maxButtons; }

  /* ============================
   * 3. 按钮操作（增删改）
   * ============================ */

  /**
   * 注册插件注入的按钮
   * @param {Object} btn {id, icon, title, onClick, pluginId}
   */
  function registerPluginButton(btn) {
    if (!btn || !btn.id) return;
    // 去重
    if (sortableButtons.find(function (b) { return b.id === btn.id; })) return;
    sortableButtons.push(Object.assign({ kind: 'plugin' }, btn));
    render();
  }

  /**
   * 移除插件按钮
   * @param {string} id 插件按钮 id
   */
  function removePluginButton(id) {
    sortableButtons = sortableButtons.filter(function (b) { return b.id !== id; });
    // 从置顶集合里清除
    pinnedIds.delete(id);
    render();
  }

  /**
   * 置顶/取消置顶一个按钮
   * @param {string} id
   */
  function togglePin(id) {
    if (pinnedIds.has(id)) pinnedIds.delete(id);
    else pinnedIds.add(id);
    persistPinned();
    render();
  }

  /**
   * 根据用户保存的顺序恢复按钮排列
   */
  function restoreOrder() {
    if (!savedOrder) return;
    var order = savedOrder.slice();
    // 按 savedOrder 重新排列 sortableButtons 中匹配的 id
    sortableButtons.sort(function (a, b) {
      var ai = order.indexOf(a.id);
      var bi = order.indexOf(b.id);
      if (ai === -1) return 1;   // 不在保存的顺序里的，排到最后
      if (bi === -1) return 1;
      return ai - bi;
    });
    savedOrder = null; // 用过后清掉
  }

  /* ============================
   * 4. 排序 & 溢出计算
   * ============================ */

  /**
   * 计算当前排序：置顶优先 → 剩余按数组顺序
   * @returns {Object[]} 排序后的按钮数组
   */
  function computeOrdered() {
    var pinned = sortableButtons.filter(function (b) { return pinnedIds.has(b.id); });
    var normal = sortableButtons.filter(function (b) { return !pinnedIds.has(b.id); });
    return pinned.concat(normal);
  }

  /**
   * 把按钮列表分成「可见」和「溢出」两部分
   * 规则：最多 maxButtons 个按钮显示在 Ribbon。
   * 由于设置按钮固定在最后，所以可见区 = 排序后的前 (maxButtons - 1) 个 + 设置按钮
   * 剩下的进溢出面板。
   * @returns {{visible:Object[], overflow:Object[]}}
   */
  function splitVisible() {
    var ordered = computeOrdered();
    // maxButtons 包含设置按钮，所以可显示的非设置按钮数 = maxButtons - 1
    var visibleCount = maxButtons - 1;
    return {
      visible:  ordered.slice(0, visibleCount),
      overflow: ordered.slice(visibleCount),
    };
  }

  /* ============================
   * 5. 渲染核心
   * ============================ */

  /** 当前激活的导航按钮 id（来自 app-core 的 nav 状态） */
  var activeNavId = null;

  /**
   * 初始化 RibbonManager：加载配置 + 组装按钮 + 渲染
   * @param {string} navKey 当前激活的 data-nav-key
   */
  function init(navKey) {
    loadConfig();
    activeNavId = navKey || 'file';
    // 组装 sortableButtons = 内置按钮 + 已有插件按钮（空，插件稍后注册）
    sortableButtons = BUILTIN_BUTTONS.slice();
    restoreOrder();
    // maxButtons 严格按 loadConfig 恢复的值（默认 5），不自动扩展
    render();
    // 绑定 Ribbon 空白区右键菜单（快速设置最大个数）
    bindRibbonBlankAreaContext();
  }

  /**
   * 更新当前激活的导航按钮高亮
   * @param {string} navKey data-nav-key 值
   */
  function updateActive(navKey) {
    activeNavId = navKey;
    // 只更新高亮样式，不重建 DOM
    document.querySelectorAll('.ribbon [data-ribbon-btn]').forEach(function (el) {
      var isActive = el.dataset.ribbonBtn === navKey;
      el.style.background = isActive ? 'var(--note-brand-600)' : 'transparent';
      el.style.color = isActive ? '#FFFFFF' : 'var(--note-ink-2)';
    });
  }

  /**
   * 主渲染函数：重建整个 Ribbon 内部按钮区
   */
  function render() {
    var ribbon = document.querySelector('.ribbon');
    if (!ribbon) return;

    // 记住 spacer 和 sync-dot，渲染完再插回去
    var spacer = ribbon.querySelector('.ribbon-spacer');
    var syncDot = ribbon.querySelector('.ribbon .w-2.h-2.rounded-full');

    // 清掉所有旧按钮（保留 ribbon-spacer 和 sync-dot）
    ribbon.querySelectorAll('[data-ribbon-btn], [data-ribbon-more]').forEach(function (el) { el.remove(); });

    // 计算可见 / 溢出
    var split = splitVisible();
    var visible = split.visible;
    var overflow = split.overflow;

    // 插入可见按钮
    var anchor = spacer || ribbon;
    visible.forEach(function (btn) {
      anchor.parentElement.insertBefore(renderButton(btn), anchor);
    });

    // 溢出按钮 > 0 时，在设置按钮之前插入三点按钮
    if (overflow.length > 0) {
      anchor.parentElement.insertBefore(renderMoreButton(overflow), anchor);
    }

    // 确保设置按钮在最后（如果已经有了就跳过重建）
    var settingsEl = ribbon.querySelector('[data-ribbon-btn="settings"]');
    if (!settingsEl) {
      settingsEl = renderButton(SETTINGS_BUTTON);
      anchor.parentElement.insertBefore(settingsEl, anchor);
    }

    // 刷新 lucide 图标
    refreshIcons();

    // 绑定拖拽
    bindDrag();
  }

  /**
   * 渲染单个 Ribbon 按钮
   * @param {Object} btn 按钮配置
   * @returns {HTMLElement}
   */
  function renderButton(btn) {
    var el = document.createElement('button');
    el.className = 'w-9 h-9 flex items-center justify-center rounded-md transition-colors hover:opacity-80';
    el.style.color = 'var(--note-ink-2)';
    el.title = btn.title;
    el.dataset.ribbonBtn = btn.id;
    el.dataset.navKey = btn.id;  // 兼容 app-core.js 的 navButtons 扫描
    el.draggable = btn.kind === 'plugin' || btn.kind === 'built-in'; // 可排序的才允许拖拽
    // 激活态高亮
    var isActive = btn.id === activeNavId;
    if (isActive) { el.style.background = 'var(--note-brand-600)'; el.style.color = '#FFFFFF'; }
    // 置顶标记：右下角加一个小圆点
    if (pinnedIds.has(btn.id)) {
      el.dataset.ribbonPinned = '1';
    }
    el.innerHTML = '<i data-lucide="' + btn.icon + '" class="w-5 h-5"></i>' +
      (pinnedIds.has(btn.id) ? '<span class="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full" style="background: var(--note-brand-600);"></span>' : '');
    // position relative 让置顶圆点能绝对定位
    el.style.position = 'relative';

    el.addEventListener('click', function (e) {
      // 三点溢出面板里的按钮点击处理
      if (el.dataset.fromMore === '1') {
        closeOverflowPanel();
      }
      if (btn.action === 'open-command') {
        // 命令面板
        document.dispatchEvent(new CustomEvent('open-command-palette'));
        return;
      }
      if (typeof btn.onClick === 'function') { btn.onClick(); return; }
      if (btn.route) {
        // 用「视图 key」归一化比较，而非字面量 hash：启动时 location.hash 为空串时，
        // 编辑器视图已按 fallback 显示，此刻点击激活按钮不应再触发 hashchange 重渲染装载区。
        var current = (location.hash || '#/editor').replace('#/', '');
        var target = btn.route.replace('#/', '');
        if (current !== target) location.hash = btn.route;
      }
    });

    // 右键菜单：置顶 / 取消置顶 / 移到溢出
    el.addEventListener('contextmenu', function (e) {
      if (btn.kind === 'settings') return; // 设置按钮不弹菜单
      e.preventDefault();
      showButtonMenu(btn, e.clientX, e.clientY);
    });

    return el;
  }

  /**
   * 渲染三点溢出按钮
   * @param {Object[]} overflowButtons 溢出的按钮列表
   * @returns {HTMLElement}
   */
  function renderMoreButton(overflowButtons) {
    var el = document.createElement('button');
    el.className = 'w-9 h-9 flex items-center justify-center rounded-md transition-colors hover:opacity-80';
    el.style.color = 'var(--note-ink-2)';
    el.title = '更多按钮';
    el.dataset.ribbonMore = '1';
    el.innerHTML = '<i data-lucide="more-horizontal" class="w-5 h-5"></i>';
    refreshIcons();

    el.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleOverflowPanel(overflowButtons, el);
    });

    return el;
  }

  /* ============================
   * 6. 溢出面板
   * ============================ */

  var overflowPanel = null;

  /**
   * 切换溢出面板的显示/隐藏
   * @param {Object[]} buttons 溢出按钮
   * @param {HTMLElement} anchor 三点按钮（定位用）
   */
  function toggleOverflowPanel(buttons, anchor) {
    if (overflowPanel && overflowPanel.parentElement) { closeOverflowPanel(); return; }
    openOverflowPanel(buttons, anchor);
  }

  /**
   * 打开溢出面板：在三点按钮旁边显示可滚动的按钮列表
   */
  function openOverflowPanel(buttons, anchor) {
    closeOverflowPanel();
    var panel = document.createElement('div');
    panel.className = 'fixed z-[9999]';
    panel.style.background = 'var(--note-surface)';
    panel.style.border = '1px solid var(--note-border)';
    panel.style.borderRadius = 'var(--note-radius-md)';
    panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
    panel.style.padding = '4px';
    panel.style.maxHeight = '320px';
    panel.style.overflowY = 'auto';
    panel.style.width = '120px';
    panel.dataset.ribbonOverflow = '1';

    buttons.forEach(function (btn) {
      var row = document.createElement('div');
      row.className = 'flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:opacity-80';
      row.style.color = 'var(--note-ink-2)';
      row.innerHTML = '<i data-lucide="' + btn.icon + '" class="w-4 h-4"></i><span class="text-[12px]">' + btn.title + '</span>';
      row.addEventListener('click', function () {
        if (btn.action === 'open-command') {
          document.dispatchEvent(new CustomEvent('open-command-palette'));
          closeOverflowPanel();
          return;
        }
        if (typeof btn.onClick === 'function') { btn.onClick(); closeOverflowPanel(); return; }
        if (btn.route) location.hash = btn.route;
        closeOverflowPanel();
      });
      panel.appendChild(row);
    });

    document.body.appendChild(panel);
    // 所有节点 append 到 DOM 后再刷新 lucide 图标
    refreshIcons();

    // 定位：anchor 右侧 + 垂直对齐三点按钮
    var aRect = anchor.getBoundingClientRect();
    panel.style.left = (aRect.right + 8) + 'px';
    panel.style.top = aRect.top + 'px';

    overflowPanel = panel;

    // 点击外部关闭
    setTimeout(function () {
      document.addEventListener('click', onDocClickClose);
    }, 0);
  }

  /** 点击面板外关闭 */
  function onDocClickClose(e) {
    if (overflowPanel && !overflowPanel.contains(e.target)) closeOverflowPanel();
  }

  /** 关闭溢出面板 */
  function closeOverflowPanel() {
    if (overflowPanel && overflowPanel.parentElement) overflowPanel.parentElement.removeChild(overflowPanel);
    overflowPanel = null;
    document.removeEventListener('click', onDocClickClose);
  }

  /* ============================
   * 7. 右键菜单（按钮操作）
   * ============================ */

  var btnMenuEl = null;

  function showButtonMenu(btn, x, y) {
    closeButtonMenu();
    var menu = document.createElement('div');
    menu.className = 'fixed z-[10000]';
    menu.style.background = 'var(--note-surface)';
    menu.style.border = '1px solid var(--note-border)';
    menu.style.borderRadius = 'var(--note-radius-md)';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
    menu.style.padding = '4px';
    menu.style.minWidth = '140px';

    var isPinned = pinnedIds.has(btn.id);
    menu.innerHTML =
      '<div class="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-[13px]" data-menu="toggle-pin">' +
        '<i data-lucide="' + (isPinned ? 'pin-off' : 'pin') + '" class="w-4 h-4"></i>' + (isPinned ? '取消置顶' : '置顶') +
      '</div>' +
      '<div class="h-px my-1" style="background: var(--note-border);"></div>' +
      '<div class="flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer text-[13px]" data-menu="reset">' +
        '<i data-lucide="rotate-ccw" class="w-4 h-4"></i>恢复默认顺序' +
      '</div>';

    document.body.appendChild(menu);
    refreshIcons();
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    btnMenuEl = menu;

    menu.addEventListener('click', function (e) {
      var action = e.target.closest('[data-menu]');
      if (!action) return;
      var type = action.dataset.menu;
      closeButtonMenu();
      if (type === 'toggle-pin') togglePin(btn.id);
      else if (type === 'reset') resetOrder();
    });

    setTimeout(function () {
      document.addEventListener('click', onDocCloseButtonMenu);
    }, 0);
  }

  function onDocCloseButtonMenu() { closeButtonMenu(); }

  function closeButtonMenu() {
    if (btnMenuEl && btnMenuEl.parentElement) btnMenuEl.parentElement.removeChild(btnMenuEl);
    btnMenuEl = null;
    document.removeEventListener('click', onDocCloseButtonMenu);
  }

  /* ============================
   * 8. 拖拽排序
   * ============================ */

  var dragSrcId = null;

  function bindDrag() {
    var ribbon = document.querySelector('.ribbon');
    if (!ribbon) return;

    var buttons = ribbon.querySelectorAll('[data-ribbon-btn]:not([data-ribbon-btn="settings"])');
    buttons.forEach(function (btn) {
      btn.addEventListener('dragstart', function (e) {
        var id = this.dataset.ribbonBtn;
        dragSrcId = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        this.style.opacity = '0.4';
      });
      btn.addEventListener('dragend', function () {
        this.style.opacity = '';
        dragSrcId = null;
        // 清除所有 dragover 高亮
        document.querySelectorAll('[data-ribbon-btn].drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
          el.style.outline = '';
        });
      });
      btn.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (this.dataset.ribbonBtn === dragSrcId) return;
        this.classList.add('drag-over');
        this.style.outline = '2px dashed var(--note-brand-600)';
      });
      btn.addEventListener('dragleave', function () {
        this.classList.remove('drag-over');
        this.style.outline = '';
      });
      btn.addEventListener('drop', function (e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        this.style.outline = '';
        var targetId = this.dataset.ribbonBtn;
        if (!dragSrcId || dragSrcId === targetId) return;
        reorder(dragSrcId, targetId);
      });
    });
  }

  /**
   * 把 srcId 移动到 targetId 之前的位置
   * @param {string} srcId 被拖拽的按钮 id
   * @param {string} targetId 放置目标按钮 id
   */
  function reorder(srcId, targetId) {
    var srcIdx = sortableButtons.findIndex(function (b) { return b.id === srcId; });
    var tgtIdx = sortableButtons.findIndex(function (b) { return b.id === targetId; });
    if (srcIdx === -1 || tgtIdx === -1) return;
    var item = sortableButtons.splice(srcIdx, 1)[0];
    sortableButtons.splice(tgtIdx, 0, item);
    persistOrder();
    render();
  }

  /**
   * 恢复默认顺序（清掉持久化的 order 和 pinned）
   */
  function resetOrder() {
    localStorage.removeItem(LS_ORDER);
    localStorage.removeItem(LS_PINNED);
    pinnedIds.clear();
    sortableButtons = BUILTIN_BUTTONS.slice();
    render();
  }

  /* ============================
   * 9. Ribbon 空白区右键 — 快速设置最大个数
   * ============================ */

  var blankMenuEl = null;

  /**
   * 绑定 Ribbon 区域的右键事件：
   * 只在「非按钮、非三点、非 ribbon-spacer、非 sync-dot」的空白区域弹出快速设置菜单。
   * 菜单提供 7-15 的数值选项，点击后即时生效。
   */
  function bindRibbonBlankAreaContext() {
    var ribbon = document.querySelector('.ribbon');
    if (!ribbon) return;
    ribbon.addEventListener('contextmenu', function (e) {
      // 排除按钮、三点按钮（它们有各自的右键菜单）
      if (e.target.closest('[data-ribbon-btn]') || e.target.closest('[data-ribbon-more]')) return;
      e.preventDefault();
      showBlankAreaMenu(e.clientX, e.clientY);
    });
  }

  /**
   * 弹出 Ribbon 空白区快速设置菜单
   * @param {number} x
   * @param {number} y
   */
  function showBlankAreaMenu(x, y) {
    closeBlankAreaMenu();
    var menu = document.createElement('div');
    menu.className = 'fixed z-[10000]';
    menu.style.background = 'var(--note-surface)';
    menu.style.border = '1px solid var(--note-border)';
    menu.style.borderRadius = 'var(--note-radius-md)';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
    menu.style.padding = '4px';
    menu.style.minWidth = '160px';

    // 标题
    var html = '<div class="px-3 py-1 text-[11px]" style="color: var(--note-ink-3);">Ribbon 最大显示数量</div>';
    // 7-15 的快捷选项
    for (var i = 7; i <= 15; i++) {
      var checked = (i === maxButtons);
      html += '<div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded cursor-pointer text-[13px]" data-max="' + i + '" ' +
              'style="color: var(--note-ink-2);">' +
              '<span>' + i + ' 个</span>' +
              (checked ? '<i data-lucide="check" class="w-3 h-3"></i>' : '') +
              '</div>';
    }
    html += '<div class="h-px my-1" style="background: var(--note-border);"></div>' +
            '<div class="px-3 py-1.5 rounded cursor-pointer text-[13px]" data-max="reset" ' +
            'style="color: var(--note-ink-3);">恢复默认顺序</div>';

    menu.innerHTML = html;
    document.body.appendChild(menu);
    refreshIcons();
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    blankMenuEl = menu;

    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-max]');
      if (!item) return;
      var val = item.dataset.max;
      closeBlankAreaMenu();
      if (val === 'reset') resetOrder();
      else setMaxButtons(parseInt(val, 10));
    });

    setTimeout(function () {
      document.addEventListener('click', onDocCloseBlankAreaMenu);
    }, 0);
  }

  function onDocCloseBlankAreaMenu() { closeBlankAreaMenu(); }

  function closeBlankAreaMenu() {
    if (blankMenuEl && blankMenuEl.parentElement) blankMenuEl.parentElement.removeChild(blankMenuEl);
    blankMenuEl = null;
    document.removeEventListener('click', onDocCloseBlankAreaMenu);
  }

  /* ============================
   * 公开 API
   * ============================ */

  return {
    init: init,
    render: render,
    updateActive: updateActive,

    registerPluginButton: registerPluginButton,
    removePluginButton: removePluginButton,

    setMaxButtons: setMaxButtons,
    getMaxButtons: getMaxButtons,
    togglePin: togglePin,
  };

})();
