/**
 * 第二脑 — 插件顶栏工具按钮管理器（ToolbarManager）
 * 作者: 火 冰
 *
 * 管理顶部标题栏中「窗口控制按钮左侧」的插件横向工具按钮。
 * 每个插件在 manifest.json 声明 `toolbar` 字段后，由 pluginManager.install
 * 调用 ToolbarManager.registerPluginButton 注册；顶栏按钮不持久化顺序，
 * 是否存在由「插件已安装 + 已启用」决定。
 */
(function () {
  'use strict';

  /** 已注册的顶栏插件按钮 */
  var toolbarButtons = [];

  /**
   * 返回当前可见的顶栏按钮（过滤掉已禁用的插件）
   * @returns {Array<{id:string, pluginId:string, icon:string, title:string, onClick:Function}>}
   */
  function visibleButtons() {
    return toolbarButtons.filter(function (btn) {
      // 插件被禁用则隐藏顶栏按钮（isPluginEnabled 由 pluginManager 提供）
      if (typeof isPluginEnabled === 'function' && !isPluginEnabled(btn.pluginId)) return false;
      return true;
    });
  }

  /**
   * 渲染所有顶栏插件按钮到 #plugin-toolbar
   * 重建容器子节点，并为每个按钮绑定点击事件（错误边界兜底）
   */
  function render() {
    var host = document.getElementById('plugin-toolbar');
    if (!host) return;
    var items = visibleButtons();
    host.innerHTML = items.map(function (btn) {
      return '<button data-plugin-toolbar="' + btn.id + '" title="' + esc(btn.title) + '" '
        + 'class="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:opacity-80" '
        + 'style="color: var(--note-ink-2); background: transparent; border: none; cursor: pointer;">'
        + '<i data-lucide="' + esc(btn.icon) + '" class="w-4 h-4"></i></button>';
    }).join('');

    // 绑定点击事件 + 沙箱错误兜底
    Array.prototype.forEach.call(host.querySelectorAll('[data-plugin-toolbar]'), function (el) {
      var btn = items.find(function (b) { return b.id === el.dataset.pluginToolbar; });
      if (!btn) return;
      el.addEventListener('click', function () {
        if (typeof btn.onClick !== 'function') return;
        try {
          btn.onClick();
        } catch (err) {
          console.warn('[plugin-toolbar] 插件动作异常:', btn.pluginId, err.message);
          if (typeof PluginAPI !== 'undefined' && PluginAPI._markError) {
            PluginAPI._markError(btn.pluginId, err);
          }
        }
      });
    });

    if (typeof refreshIcons === 'function') refreshIcons();
  }

  /**
   * 注册一个顶栏插件按钮
   * @param {{id:string, icon:string, title:string, onClick:Function, pluginId:string}} btn
   */
  function registerPluginButton(btn) {
    if (!btn || !btn.id) return;
    // 去重：同 id 覆盖
    toolbarButtons = toolbarButtons.filter(function (b) { return b.id !== btn.id; });
    toolbarButtons.push({
      id: btn.id,
      pluginId: btn.pluginId || (btn.id.split(':')[0] || ''),
      icon: btn.icon || 'puzzle',
      title: btn.title || '',
      onClick: btn.onClick || null,
    });
    render();
  }

  /**
   * 移除一个顶栏插件按钮
   * @param {string} id 按钮 id（pluginId + ':toolbar'）
   */
  function removePluginButton(id) {
    toolbarButtons = toolbarButtons.filter(function (b) { return b.id !== id; });
    render();
  }

  /**
   * 清空所有顶栏插件按钮（重启/测试用）
   */
  function clearAll() {
    toolbarButtons = [];
    render();
  }

  // 全局暴露
  globalThis.ToolbarManager = {
    init: render,
    render: render,
    registerPluginButton: registerPluginButton,
    removePluginButton: removePluginButton,
    clearAll: clearAll,
  };
})();