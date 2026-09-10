/* ============================================
 * 第二脑 — 插件市场 + 插件管理器
 * 作者: 火 冰
 * 功能: 插件网格渲染、分类/排序/搜索、详情抽屉、
 *       PluginManager 插件注册中心（Ribbon 图标、命令面板、右键菜单）
 * ============================================ */

'use strict';

/* ============================
 * PluginManager — 插件注册中心
 * 负责维护已安装插件列表，对外暴露三个扩展点：
 *   pluginManager.getRibbonItems()         → 插件 Ribbon 图标（PL-10）
 *   pluginManager.getCommands()            → 插件命令面板条目（PL-12）
 *   pluginManager.getContextMenus(slot)     → 插件右键菜单项（PL-11）
 * 作者: 火 冰
 * ============================ */
globalThis.pluginManager = (function () {
  /** @type {Object[]} 已安装插件列表（含 manifest） */
  let installedPlugins = [];

  /**
   * 安装一个插件：注册到 installedPlugins，刷新全局扩展点（Ribbon、命令面板、右键菜单）
   * @param {Object} plugin 插件完整对象（含 id、manifest、commands、ribbon、contextMenus 等）
   */
  function install(plugin) {
    if (!plugin || !plugin.id) return;
    if (installedPlugins.find(p => p.id === plugin.id)) return; // 已安装则跳过
    installedPlugins.push(plugin);
    // 调用插件的 activate 钩子（如果有）
    if (typeof plugin.activate === 'function') {
      try { plugin.activate(); } catch (_) {}
    }
    // 插件被禁用则不注册任何 UI 扩展点（顶栏/Ribbon）
    if (!isPluginEnabled(plugin.id)) return;
    // 注册插件命令到快捷键注册表（启用时才注册；默认键仅在无冲突时占用）
    if (plugin.commands && typeof kbRegisterCommand === 'function') {
      plugin.commands.forEach(function (c) {
        if (!c.id || typeof c.action !== 'function') return;
        kbRegisterCommand({
          id: c.id, label: c.label || plugin.name, icon: c.icon || 'puzzle',
          group: (plugin.name || '插件') + ' 插件',
          action: c.action, defaultShortcut: c.shortcut || '', keybindable: c.keybindable !== false,
          pluginId: plugin.id, when: c.when,
        });
      });
    }
    // 注册顶栏按钮到 ToolbarManager（优先 toolbar，否则 ribbon）
    if (plugin.toolbar && typeof ToolbarManager !== 'undefined' && ToolbarManager) {
      ToolbarManager.registerPluginButton({
        id: plugin.id + ':toolbar',
        icon: plugin.toolbar.icon || plugin.icon || 'puzzle',
        title: plugin.toolbar.title || plugin.name,
        onClick: plugin.toolbar.onClick || null,
        pluginId: plugin.id,
      });
      return;
    }
    // 注册 Ribbon 按钮到 RibbonManager（有 ribbon 声明时）
    if (plugin.ribbon && typeof RibbonManager !== 'undefined' && RibbonManager) {
      RibbonManager.registerPluginButton({
        id: plugin.id + ':ribbon',
        icon: plugin.ribbon.icon || plugin.icon || 'puzzle',
        title: plugin.ribbon.title || plugin.name,
        onClick: plugin.ribbon.onClick || null,
        pluginId: plugin.id,
      });
    } else {
      refreshPluginRibbonButtons();
    }
  }

  function uninstall(pluginId) {
    installedPlugins = installedPlugins.filter(p => p.id !== pluginId);
    // 从 ToolbarManager 移除顶栏按钮
    if (typeof ToolbarManager !== 'undefined' && ToolbarManager) {
      ToolbarManager.removePluginButton(pluginId + ':toolbar');
    }
    // 从 RibbonManager 移除
    if (typeof RibbonManager !== 'undefined' && RibbonManager) {
      RibbonManager.removePluginButton(pluginId + ':ribbon');
    } else {
      refreshPluginRibbonButtons();
    }
  }

  /**
   * 已安装插件列表快照（只读拷贝）
   * @returns {Object[]}
   */
  function list() {
    return installedPlugins.slice();
  }

  /**
   * 清空所有插件（重启/测试用）
   */
  function clearAll() {
    installedPlugins = [];
    refreshPluginRibbonButtons();
  }

  /* ---------- PL-10: Ribbon 图标 ---------- */

  /**
   * 获取所有已安装插件声明的 Ribbon 按钮配置
   * @returns {{id:string, icon:string, title:string, route?:string, onClick?:Function}[]}
   */
  function getRibbonItems() {
    const items = [];
    installedPlugins.forEach(p => {
      if (!isPluginEnabled(p.id)) return;
      if (p.ribbon) {
        items.push({
          id: p.id + ':ribbon',
          pluginId: p.id,
          icon: p.ribbon.icon || p.icon || 'puzzle',
          title: p.ribbon.title || p.name,
          route: p.ribbon.route,
          onClick: p.ribbon.onClick,
        });
      }
    });
    return items;
  }

  /**
   * 同步插件 Ribbon 按钮到 RibbonManager
   * 清掉旧的插件按钮 → 重新注册当前已安装插件声明的 ribbon 按钮 → 刷新 Ribbon
   */
  function refreshPluginRibbonButtons() {
    if (typeof RibbonManager !== 'undefined' && RibbonManager) {
      // RibbonManager 自己维护 sortableButtons，直接 render 即可
      RibbonManager.render();
      return;
    }
    // 降级：直接操作 DOM（网页版无 RibbonManager 时走这里）
    document.querySelectorAll('[data-plugin-ribbon]').forEach(el => el.remove());
    const ribbon = document.querySelector('.ribbon');
    if (!ribbon) return;
    const items = getRibbonItems();
    const spacer = ribbon.querySelector('.ribbon-spacer');
    const anchor = spacer || ribbon;
    items.forEach(item => {
      const btn = document.createElement('button');
      btn.className = 'w-9 h-9 flex items-center justify-center rounded-md transition-colors hover:opacity-80';
      btn.style.color = 'var(--note-ink-2)';
      btn.title = item.title;
      btn.dataset.pluginRibbon = item.id;
      btn.innerHTML = '<i data-lucide="' + item.icon + '" class="w-5 h-5"></i>';
      btn.addEventListener('click', function () {
        if (typeof item.onClick === 'function') { item.onClick(); return; }
        if (item.route) location.hash = item.route;
      });
      ribbon.insertBefore(btn, anchor);
    });
    refreshIcons();
  }

  /* ---------- PL-12: 命令面板 ---------- */

  /**
   * 获取所有已安装插件声明的命令，按插件分组
   * @returns {{group:string, items:{icon:string, label:string, action:Function, shortcut?:string, keybindable?:boolean, id?:string, pluginId?:string}[]}[]}
   */
  function getCommands() {
    const groups = [];
    installedPlugins.forEach(p => {
      if (!isPluginEnabled(p.id)) return;
      if (!p.commands || p.commands.length === 0) return;
      const groupName = (p.name || '插件') + ' 插件';
      const items = p.commands.map(c => ({
        icon: c.icon || 'puzzle',
        label: c.label || p.name,
        action: c.action || function () { alert('插件命令未实现'); },
        shortcut: c.shortcut,                                 // 默认快捷键（可被用户重绑）
        keybindable: c.keybindable !== false,                 // 是否支持绑定快捷键
        id: c.id || (pluginCommandId(p.id, c.actionKey || '')), // 稳定命令 id，供快捷键注册表索引
        pluginId: p.id,
      }));
      groups.push({ group: groupName, items: items });
    });
    return groups;
  }

  /* ---------- PL-11: 右键菜单 ---------- */

  /**
   * 获取所有已安装插件声明的右键菜单项
   * @param {'file-tree'|'file-tree-folder'|'editor'} slot 菜单位置
   * @returns {{label:string, icon?:string, action?:Function, children?:Array, disabled?:boolean}[]}
   */
  function getContextMenus(slot) {
    const merged = [];
    installedPlugins.forEach(p => {
      if (!isPluginEnabled(p.id)) return;
      if (!p.contextMenus) return;
      const entries = p.contextMenus[slot];
      if (entries && entries.length) {
        entries.forEach(entry => {
          // 给每个菜单项注入 owner，方便回调时知道是哪个插件
          merged.push(entry);
        });
      }
    });
    return merged;
  }

  return {
    install: install,
    uninstall: uninstall,
    list: list,
    clearAll: clearAll,
    setPluginEnabled: setPluginEnabled,
    errorForPlugin: errorForPlugin,
    getRibbonItems: getRibbonItems,
    refreshPluginRibbonButtons: refreshPluginRibbonButtons,
    getCommands: getCommands,
    getContextMenus: getContextMenus,
    getEditorProviders: getEditorProviders,
    getEditorExtensions: getEditorExtensions,
    fileExtension: fileExtension,
  };
})();


/* ============================
 * 插件市场视图交互
 * ============================ */

/* ============================
 * 插件 actionKey → 回调映射表
 * JSON 数据中只放 actionKey 字符串，这里提供实际函数
 * 每个插件注册自己的 action 实现
 * 作者: 火 冰
 * ============================ */
const PLUGIN_ACTION_MAP = {
  /* Git Sync 插件 */
  'git-sync': {
    'git-commit': function () { alert('[Git Sync] 提交当前变更（Demo：执行 git add . && git commit）'); },
    'git-pull': function () { alert('[Git Sync] 拉取最新代码（Demo：执行 git pull）'); },
    'git-push': function () { alert('[Git Sync] 推送到远程（Demo：执行 git push）'); },
    'git-history': function () { alert('[Git Sync] 查看笔记历史（Demo）'); },
  },
  /* Calendar 插件（已安装，演示 Ribbon + 右键） */
  'calendar': {
    'calendar-view': function () { showToast('日历视图尚未实现（Demo 插件）'); },
  },
  /* Minimal Theme 插件（已安装，演示 Ribbon） */
  'minimal-theme': {
    'apply-theme': function () { showToast('[Minimal] Minimal 主题已应用'); },
  },
  /* 示例：一个加密插件（演示完整 manifest） */
  'encrypt': {
    'encrypt-file': function () { alert('[Encrypt] 加密当前文件（Demo：AES-256）'); },
    'decrypt-file': function () { alert('[Encrypt] 解密当前文件（Demo：AES-256）'); },
    'encrypt-folder': function () { alert('[Encrypt] 加密目录下所有笔记（Demo）'); },
  },
};

/* ============================
 * 插件沙箱 + 冲突检测监控表
 * 作者: 火 冰
 *
 *  - pluginActionOwner  : 扩展点 key → 首个占用它的 pluginId
 *  - pluginConflictMap  : key → 冲突记录数组 [{a, b, key}]
 *  - pluginErrorMap     : pluginId → 最近一次异常信息（沙箱错误边界写入）
 * ============================ */
/** @type {Object<string,string>} */
let pluginActionOwner = {};
/** @type {Object<string,Array<{a:string,b:string,key:string}>>} */
globalThis.pluginConflictMap = {};
/** @type {Object<string,string>} */
const pluginErrorMap = {};

/**
 * 尝试占用一个扩展点 key；若已被其他插件占用则记录冲突
 * @param {string} key 扩展点唯一 key（如 actionKey / 扩展点组合 key）
 * @param {string} pluginId 当前声明方插件 id
 */
function claimActionKey(key, pluginId) {
  if (!key) return;
  if (pluginActionOwner[key] == null) { pluginActionOwner[key] = pluginId; return; }
  if (pluginActionOwner[key] === pluginId) return;
  recordConflict(key, pluginId);
}

/**
 * 记录两个插件对同一扩展点 key 的冲突，写控制台警告 + 冲突表
 * @param {string} key   扩展点 key
 * @param {string} b     后声明方（冲突方）插件 id
 */
function recordConflict(key, b) {
  const a = pluginActionOwner[key];
  if (!pluginConflictMap[key]) pluginConflictMap[key] = [];
  // 同一对冲突只记一次
  if (pluginConflictMap[key].some(r => r.b === b)) return;
  pluginConflictMap[key].push({ a: a, b: b, key: key });
  console.warn('[plugin-conflict]', key, '被', a, '与', b, '同时占用');
}

/**
 * 标记插件运行期异常（沙箱错误边界回调）
 * @param {string} pluginId 插件 id
 * @param {Error} err 异常对象
 */
function markPluginError(pluginId, err) {
  const msg = (err && err.message) ? err.message : String(err);
  pluginErrorMap[pluginId] = msg;
  console.warn('[plugin]', pluginId, '异常:', msg);
}

/**
 * 插件当前是否启用（localStorage plugin:<id>:enabled，默认启用）
 * @param {string} id 插件 id
 * @returns {boolean}
 */
function isPluginEnabled(id) {
  return localStorage.getItem('plugin:' + id + ':enabled') !== 'false';
}

/**
 * 启用/禁用插件（localStorage 持久化），并刷新顶栏 / Ribbon / 命令面板 / 右键菜单
 * @param {string} id 插件 id
 * @param {boolean} on true=启用, false=禁用
 */
function setPluginEnabled(id, on) {
  localStorage.setItem('plugin:' + id + ':enabled', on ? 'true' : 'false');
  // 刷新顶栏与 Ribbon：已注册按钮在渲染时按启用状态过滤
  if (typeof ToolbarManager !== 'undefined' && ToolbarManager && ToolbarManager.render) ToolbarManager.render();
  if (typeof pluginManager !== 'undefined' && pluginManager) pluginManager.refreshPluginRibbonButtons();
}

/**
 * 聚合某插件的运行期异常信息（无异常返回 null）
 * @param {string} pluginId 插件 id
 * @returns {string|null}
 */
function errorForPlugin(pluginId) {
  if (typeof PluginAPI !== 'undefined' && PluginAPI) return PluginAPI.getError(pluginId) || null;
  return pluginErrorMap[pluginId] || null;
}

/**
 * 聚合某插件涉及的所有冲突记录（供设置页徽章展示）
 * @param {string} pluginId 插件 id
 * @returns {Array<{a:string,b:string,key:string}>}
 */
function conflictsForPlugin(pluginId) {
  const out = [];
  Object.keys(globalThis.pluginConflictMap || {}).forEach(function (key) {
    (pluginConflictMap[key] || []).forEach(function (rec) {
      if (rec.a === pluginId || rec.b === pluginId) out.push(rec);
    });
  });
  return out;
}

/**
 * 生成插件命令的稳定 id（供快捷键注册表索引）
 * @param {string} pluginId 插件 id
 * @param {string} actionKey 命令 actionKey
 * @returns {string}
 * 作者: 火 冰
 */
function pluginCommandId(pluginId, actionKey) {
  return pluginId + ':' + (actionKey || 'cmd');
}

/**
 * 把 JSON 中的声明性 actionKey 转换成实际函数回调
 * @param {Object} rawPlugin 从 JSON 读取的插件对象
 * @returns {Object} 补全回调后的完整插件对象
 */
function materializePlugin(rawPlugin) {
  const id = rawPlugin.id || (rawPlugin.name || '').toLowerCase().replace(/\s+/g, '-');
  const actions = PLUGIN_ACTION_MAP[id] || {};
  const result = Object.assign({}, rawPlugin, { id: id });
  // commands: 把 actionKey 换成实际函数，透传 shortcut/keybindable 并注入稳定 id
  if (result.commands) {
    result.commands = result.commands.map(function (c) {
      return Object.assign({}, c, {
        action: actions[c.actionKey] || function () { alert('插件命令未实现：' + c.actionKey); },
        shortcut: c.shortcut,               // 默认快捷键（声明后若与已有绑定无冲突则自动生效）
        keybindable: c.keybindable !== false,
        id: c.id || (pluginCommandId(id, c.actionKey || '')),
      });
    });
  }
  // contextMenus: 同样把 actionKey 换成函数
  if (result.contextMenus) {
    const slots = result.contextMenus;
    Object.keys(slots).forEach(function (slot) {
      if (Array.isArray(slots[slot])) {
        slots[slot] = slots[slot].map(function (m) {
          return Object.assign({}, m, {
            action: actions[m.actionKey] || function () { alert('插件菜单未实现：' + m.actionKey); },
          });
        });
      }
    });
  }
  // ribbon: 把 actionKey 换成 onClick（优先于 route；无 actionKey 则保留原 route）
  if (result.ribbon && result.ribbon.actionKey) {
    result.ribbon = Object.assign({}, result.ribbon, {
      onClick: actions[result.ribbon.actionKey] || function () { alert('插件图标未实现：' + result.ribbon.actionKey); },
    });
  }
  // toolbar: 顶栏工具按钮，与 ribbon 相同方式把 actionKey 换成 onClick
  if (result.toolbar && result.toolbar.actionKey) {
    result.toolbar = Object.assign({}, result.toolbar, {
      onClick: actions[result.toolbar.actionKey] || function () { alert('插件图标未实现：' + result.toolbar.actionKey); },
    });
  }
  // editor: 编辑器能力（支持后缀 / 打开方式 / 工具按钮 / 侧边面板）
  // 工具按钮的 actionKey 换成实际函数；后缀/openers/sidebar 登记占用 key 供冲突检测与设置页展示
  if (result.editor) {
    result.editor = Object.assign({}, result.editor, {
      toolbar: (result.editor.toolbar || []).map(function (b) {
        return Object.assign({}, b, {
          action: actions[b.actionKey] || function () { alert('插件工具未实现：' + b.actionKey); },
        });
      }),
      openers: (result.editor.openers || []).map(function (o) {
        return Object.assign({}, o, {
          action: actions[o.actionKey] || undefined,
        });
      }),
    });
    (result.editor.extensions || []).forEach(function (ext) { claimActionKey('ext:' + String(ext).toLowerCase(), id); });
    (result.editor.openers || []).forEach(function (o) { claimActionKey('opener:' + (o.id || ''), id); });
    (result.editor.sidebar || []).forEach(function (s) { claimActionKey('sidebar:' + (s.id || ''), id); });
  }

  // 扩展点占用冲突登记：toolbar/ribbon/commands/contextMenus 的占用 key
  // 同一插件重复声明不视为冲突（claimActionKey 已处理）；记录到 result.__conflicts 供设置页展示
  if (result.toolbar) { const k = 'tool:' + (result.toolbar.icon || '') + '|' + (result.toolbar.title || ''); claimActionKey(k, id); }
  if (result.ribbon) { const k = 'rib:' + (result.ribbon.icon || '') + '|' + (result.ribbon.title || ''); claimActionKey(k, id); }
  (result.commands || []).forEach(function (c) { claimActionKey('cmd:' + (c.label || ''), id); });
  if (result.contextMenus) {
    Object.keys(result.contextMenus).forEach(function (slot) {
      (result.contextMenus[slot] || []).forEach(function (m) { claimActionKey('ctx:' + slot + ':' + (m.label || ''), id); });
    });
  }
  const myConflicts = conflictsForPlugin(id);
  if (myConflicts.length) result.__conflicts = myConflicts;
  return result;
}


/* ============================
 * 插件市场视图交互
 * ============================ */

let pluginData = [];
let installedOnly = false;   // 「管理已安装插件」过滤

/**
 * 安装/卸载切换核心逻辑：同时维护 pluginData 数组 + PluginManager 注册表
 * @param {Object} p 插件对象（已 materialize）
 * @param {boolean} toInstall true=安装, false=卸载
 */
function toggleInstallPlugin(p, toInstall) {
  if (!p || !p.id) return;
  p.installed = !!toInstall;
  if (toInstall) pluginManager.install(p);
  else pluginManager.uninstall(p.id);
}

  function renderPlugins(filterCat, filterText, sortBy) {
    const grid = document.getElementById('plugin-grid');
    if (!grid) return;
    let list = pluginData.slice();
    if (installedOnly) list = list.filter(p => p.installed);
    else if (filterCat && filterCat !== 'all') list = list.filter(p => p.cat === filterCat);
    const q = (filterText || '').trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.author.toLowerCase().includes(q) || p.desc.includes(q));
    // 排序
    if (sortBy === 'rating') list.sort((a, b) => b.rating - a.rating);
    else if (sortBy === 'latest') list.sort((a, b) => b.downloads - a.downloads);
    else list.sort((a, b) => b.downloads - a.downloads);

    if (list.length === 0) { grid.innerHTML = '<p class="text-caption p-4" style="color: var(--note-ink-3);">未找到匹配的插件</p>'; return; }

    grid.innerHTML = list.map(p => {
      const btnClass = p.installed
        ? 'style="background: var(--note-surface-2); color: var(--note-ink-3); border: 1px solid var(--note-border);"'
        : 'style="background: var(--note-brand-600); color: #FFFFFF;"';
      const btnInner = p.installed
        ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>已安装'
        : '安装';
      return '<div class="plugin-card rounded-lg border p-4 flex flex-col" data-card="' + esc(p.name) + '" style="cursor:pointer; background: var(--note-surface); border-color: var(--note-border); border-radius: var(--note-radius-lg);">'
        + '<div class="flex items-start gap-3 mb-3">'
        + '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background: ' + p.color + '; border-radius: var(--note-radius-md);">'
        + '<i data-lucide="' + p.icon + '" class="w-5 h-5" style="color: #FFFFFF;"></i></div>'
        + '<div class="min-w-0 flex-1"><div class="flex items-center gap-1.5 min-w-0"><h3 class="text-body font-semibold leading-tight truncate" style="color: var(--note-ink);">' + p.name + '</h3>'
        + (p.version ? '<span class="text-[10px] px-1 py-0.5 rounded font-mono shrink-0" title="插件版本" style="background: var(--note-surface-2); color: var(--note-ink-3); border: 1px solid var(--note-border);">v' + esc(p.version) + '</span>' : '')
        + '</div>'
        + '<p class="text-caption mt-0.5" style="color: var(--note-ink-3);">by ' + p.author + '</p></div></div>'
        + '<p class="text-caption mb-4 leading-relaxed" style="color: var(--note-ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">' + p.desc + '</p>'
        + '<div class="flex items-center justify-between mt-auto"><div class="flex items-center gap-3 text-caption nums" style="color: var(--note-ink-3);">'
        + '<span class="flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>' + (p.downloads / 1000).toFixed(1).replace(/\.0$/, '') + 'k</span>'
        + '<span class="flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5" style="color: var(--state-warning);"></i>' + p.rating + '</span></div>'
        + '<button class="install-btn flex items-center gap-1 px-3 py-1.5 rounded-md text-caption font-medium" data-install="' + p.name + '" ' + btnClass + '>' + btnInner + '</button>'
        + '</div></div>';
    }).join('');
    refreshIcons();

    // 安装/卸载按钮（与 PluginManager 联动）
    grid.querySelectorAll('[data-install]').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation(); // 避免触发卡片打开抽屉
        const name = this.dataset.install;
        const p = pluginData.find(x => x.name === name);
        if (p) {
          toggleInstallPlugin(p, !p.installed);
          renderPlugins(currentCat, searchInput.value, sortSelect.value);
        }
      });
    });
    // 点击卡片 -> 打开详情抽屉
    grid.querySelectorAll('.plugin-card').forEach(card => {
      card.addEventListener('click', function () { openPluginDrawer(this.dataset.card); });
    });
  }

  let currentCat = 'all';
  const searchInput = document.getElementById('plugin-search');
  const sortSelect = document.getElementById('plugin-sort');

  /* 渲染并打开插件详情抽屉 */
  function openPluginDrawer(name) {
    const drawer = document.getElementById('plugin-drawer');
    if (!drawer) return;
    const p = pluginData.find(x => x.name === name);
    if (!p) { closePluginDrawer(); return; }
    drawer.innerHTML = ''
      + '<div class="p-4 border-b shrink-0 flex items-center justify-between" style="border-color: var(--note-border);">'
      + '<span class="text-[13px] font-semibold tracking-wide" style="color: var(--note-ink);">插件详情</span>'
      + '<button data-action="pm-close" class="w-7 h-7 flex items-center justify-center rounded hover:opacity-70" style="color: var(--note-ink-3);" title="关闭"><i data-lucide="x" class="w-4 h-4"></i></button></div>'
      + '<div class="p-4 border-b" style="border-color: var(--note-border);">'
      + '<div class="flex items-start gap-3"><div class="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style="background:' + p.color + '; border-radius: var(--note-radius-md);"><i data-lucide="' + p.icon + '" class="w-6 h-6" style="color:#FFFFFF;"></i></div>'
      + '<div class="flex-1 min-w-0"><div class="flex items-center gap-1.5 min-w-0"><h3 class="text-body font-semibold leading-tight truncate" style="color: var(--note-ink);">' + p.name + '</h3>'
      + (p.version ? '<span class="text-[10px] px-1 py-0.5 rounded font-mono shrink-0" title="插件版本" style="background: var(--note-surface-2); color: var(--note-ink-3); border: 1px solid var(--note-border);">v' + esc(p.version) + '</span>' : '')
      + '</div>'
      + '<p class="text-caption mt-0.5" style="color: var(--note-ink-3);">by ' + p.author + '</p></div></div>'
      + '<div class="flex items-center gap-4 mt-4 text-caption nums" style="color: var(--note-ink-3);">'
      + '<span class="flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>' + p.downloads.toLocaleString() + '</span>'
      + '<span class="flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5" style="color: var(--state-warning);"></i>' + p.rating + '</span>'
      + '</div></div>'
      + '<div class="p-4 border-b flex-1 overflow-y-auto" style="border-color: var(--note-border);"><p class="text-caption leading-relaxed" style="color: var(--note-ink-2);">' + p.desc + '</p></div>'
      + '<div class="p-4 border-t shrink-0" style="border-color: var(--note-border);">'
      + '<button data-action="pm-toggle" data-name="' + esc(p.name) + '" class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium transition-colors hover:opacity-90" style="background:' + (p.installed ? 'var(--note-surface-2); color: var(--note-ink-3); border:1px solid var(--note-border);' : 'var(--note-brand-600); color:#FFFFFF;') + ';">'
      + '<i data-lucide="' + (p.installed ? 'trash-2' : 'download') + '" class="w-4 h-4"></i>' + (p.installed ? '卸载插件' : '安装插件') + '</button></div>';
    drawer.style.width = '320px';
    drawer.classList.add('open');
    refreshIcons();
    drawer.querySelector('[data-action="pm-close"]').addEventListener('click', closePluginDrawer);
    drawer.querySelector('[data-action="pm-toggle"]').addEventListener('click', function () {
      const inst = pluginData.find(x => x.name === this.dataset.name);
      if (inst) {
        toggleInstallPlugin(inst, !inst.installed);
        openPluginDrawer(inst.name);
        renderPlugins(currentCat, searchInput.value, sortSelect.value);
      }
    });
  }

  function closePluginDrawer() {
    const drawer = document.getElementById('plugin-drawer');
    if (drawer) { drawer.style.width = '0'; drawer.classList.remove('open'); drawer.innerHTML = ''; }
  }

  function bindPlugins() {
    const chips = document.getElementById('plugin-chips');
    if (!chips) return;
    // 搜索 / 排序
    if (searchInput) searchInput.addEventListener('input', function () { renderPlugins(currentCat, this.value, sortSelect ? sortSelect.value : ''); });
    if (sortSelect) sortSelect.addEventListener('change', function () { renderPlugins(currentCat, searchInput ? searchInput.value : '', this.value); });
    // 管理已安装
    document.querySelectorAll('[data-action="toggle-installed"]').forEach(btn => {
      btn.addEventListener('click', function () {
        installedOnly = !installedOnly;
        this.style.background = installedOnly ? 'var(--note-brand-600)' : 'var(--note-surface-2)';
        this.style.color = installedOnly ? '#FFFFFF' : 'var(--note-ink-2)';
        if (installedOnly) closePluginDrawer();
        renderPlugins(installedOnly ? 'all' : currentCat, searchInput ? searchInput.value : '', sortSelect ? sortSelect.value : '');
      });
    });
    if (!chips) return;
    chips.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      if (installedOnly) return;
      currentCat = btn.dataset.cat;
      chips.querySelectorAll('[data-cat]').forEach(c => {
        c.style.background = c === btn ? 'var(--note-brand-600)' : 'var(--note-background)';
        c.style.color = c === btn ? '#FFFFFF' : 'var(--note-ink-2)';
        c.style.borderColor = c === btn ? 'var(--note-brand-600)' : 'var(--note-border)';
      });
      renderPlugins(currentCat, searchInput ? searchInput.value : '', sortSelect ? sortSelect.value : '');
    });
  }


/* ============================
 * 默认插件市场数据（含完整 manifest）
 * 供应用启动时初始化 pluginData；
 * 如果 plugins.html 里有内嵌 JSON，会覆盖这里的默认值
 * 作者: 火 冰
 * ============================ */
const DEFAULT_PLUGIN_DATA = [
  {
    "name": "Markdown Editor", "id": "markdown-editor", "author": "第二脑", "icon": "file-text",
    "color": "#7C3AED", "cat": "editor", "system": true, "installed": true,
    "desc": "内置的 Markdown 编辑器能力：注册 .md/.markdown 后缀，提供编辑（源码/所见即所得）、预览、分屏打开方式、工具按钮与右侧边面板（属性/大纲/反向链接/标签）。",
    "version": "1.0.0", "downloads": 22000, "rating": 4.9,
    "editor": {
      "extensions": [".md", ".markdown"],
      "openers": [
        { "id": "edit", "label": "编辑（源码/所见即所得）", "icon": "pencil" },
        { "id": "preview", "label": "预览", "icon": "eye" },
        { "id": "split", "label": "分屏（源码+预览）", "icon": "columns-2" }
      ],
      "toolbar": [
        { "id": "mode-edit", "label": "编辑", "icon": "pencil", "mode": "edit" },
        { "id": "mode-preview", "label": "预览", "icon": "eye", "mode": "preview" },
        { "id": "mode-split", "label": "分屏", "icon": "columns-2", "mode": "split" },
        { "id": "toggle-source", "label": "源码/所见即所得", "icon": "code", "actionKey": "mde-toggle-source" },
        { "id": "toggle-lineno", "label": "行号", "icon": "list-ordered", "actionKey": "mde-toggle-lineno" },
        { "id": "toggle-wrap", "label": "自动换行", "icon": "wrap-text", "actionKey": "mde-toggle-wrap" },
        { "id": "view-index", "label": "索引面板", "icon": "database", "actionKey": "mde-view-index" },
        { "id": "delete", "label": "删除笔记", "icon": "trash-2", "actionKey": "mde-delete" }
      ],
      "sidebar": [
        { "id": "props", "label": "属性" },
        { "id": "outline", "label": "大纲" },
        { "id": "backlinks", "label": "反向链接" },
        { "id": "tags", "label": "标签" }
      ]
    },
    "commands": [
      { "icon": "file-text", "label": "Markdown: 打开当前笔记", "actionKey": "mde-open" },
    ],
  },
  {
    "name": "Calendar", "id": "calendar", "author": "NoteApp Team", "icon": "calendar",
    "color": "#8B5CF6", "cat": "productivity", "desc": "日历视图和日记管理，将你的笔记按日期组织，轻松回溯每日记录。",
    "downloads": 12500, "rating": 4.8, "installed": false,
    "version": "1.0.0",
    "ribbon": { "icon": "calendar", "title": "日历", "actionKey": "calendar-view" },
    "commands": [
      { "icon": "calendar", "label": "打开日历视图", "actionKey": "calendar-view" },
    ],
    "contextMenus": {
      "file-tree": [
        { "label": "日历: 查看这一天", "icon": "calendar-days", "actionKey": "calendar-view" },
      ],
    },
  },
  {
    "name": "Kanban", "id": "kanban", "author": "ProductivityLabs", "icon": "kanban",
    "color": "#3B82F6", "cat": "productivity", "desc": "看板式任务管理，将笔记转化为可拖拽的看板卡片，高效追踪进度。",
    "downloads": 8300, "rating": 4.6, "installed": false,
    "version": "1.0.0",
    "commands": [
      { "icon": "layout-dashboard", "label": "打开看板视图", "actionKey": "kanban-view" },
    ],
  },
  {
    "name": "Excalidraw", "id": "excalidraw", "author": "Zsolt Viczián", "icon": "pen-tool",
    "color": "#F59E0B", "cat": "editor", "desc": "手绘白板嵌入，在笔记中创建无限画布的示意图与流程图。",
    "downloads": 15200, "rating": 4.9, "installed": false,
    "version": "1.0.0",
  },
  {
    "name": "Git Sync", "id": "git-sync", "author": "Vinadon", "icon": "git-branch",
    "color": "#22C55E", "cat": "sync", "desc": "Git版本控制同步，为笔记库提供完整的版本历史与分支管理。",
    "downloads": 6700, "rating": 4.5, "installed": false,
    "version": "1.0.0",
    "ribbon": { "icon": "git-branch", "title": "Git Sync" },
    "commands": [
      { "icon": "git-commit", "label": "提交当前变更", "actionKey": "git-commit" },
      { "icon": "git-pull", "label": "拉取最新代码", "actionKey": "git-pull" },
      { "icon": "git-push", "label": "推送到远程", "actionKey": "git-push" },
    ],
    "contextMenus": {
      "file-tree": [
        { "label": "Git: 查看历史", "icon": "history", "actionKey": "git-history" },
      ],
      "editor": [
        { "label": "Git: 还原此段落", "icon": "undo-2", "actionKey": "git-history" },
      ],
    },
  },
  {
    "name": "Minimal Theme", "id": "minimal-theme", "author": "Stephan Ango", "icon": "palette",
    "color": "#EC4899", "cat": "theme", "desc": "极简主题包，专注内容阅读的克制设计，支持多种配色方案切换。",
    "version": "1.0.0", "downloads": 20100, "rating": 4.7, "installed": false,
    "ribbon": { "icon": "palette", "title": "Minimal", "actionKey": "apply-theme" },
  },
  {
    "name": "Mind Map", "id": "mind-map", "author": "Vincent Le", "icon": "network",
    "color": "#06B6D4", "cat": "editor", "desc": "思维导图编辑，将笔记结构可视化为节点树，支持拖拽与折叠展开。",
    "downloads": 9400, "rating": 4.4, "installed": false,
    "version": "1.0.0",
  },
  {
    "name": "Notion Sync", "id": "notion-sync", "author": "Cloud Studio", "icon": "cloud",
    "color": "#64748B", "cat": "integration", "desc": "Notion双向同步，在本地笔记库与 Notion 工作区之间保持数据一致。",
    "downloads": 5200, "rating": 4.3, "installed": false,
    "version": "1.0.0",
  },
  {
    "name": "Code Highlight", "id": "code-highlight", "author": "Daniel W. P.", "icon": "code-2",
    "color": "#EF4444", "cat": "editor", "desc": "代码语法高亮增强，支持 180+ 编程语言，行号显示与主题配色。",
    "version": "1.0.0", "downloads": 18600, "rating": 4.8, "installed": false,
  },
  {
    "name": "Dark Mode Pro", "id": "dark-mode-pro", "author": "hasegawa", "icon": "moon",
    "color": "#6366F1", "cat": "theme", "desc": "高级暗色主题，深度优化的 OLED 友好配色，支持自动日夜间切换。",
    "downloads": 11300, "rating": 4.6, "installed": false,
    "version": "1.0.0",
  },
];

/**
 * 应用启动时初始化插件系统：
 *   1. 读取 pluginData（优先从 plugins.html 的内嵌 JSON，否则用 DEFAULT_PLUGIN_DATA）
 *   2. materialize 每个插件（注入 actionKey → 实际函数）
 *   3. 把 installed=true 的插件注册到 PluginManager
 *   4. 渲染插件 Ribbon 按钮
 *   5. 异步加载插件目录（plugins/<id>/manifest.json + main.js，仅桌面版有 IPC）
 * 作者: 火 冰
 */
function initPluginSystem() {
  // 读取数据源
  let raw = DEFAULT_PLUGIN_DATA;
  const dataEl = document.getElementById('plugin-data');
  if (dataEl) {
    try {
      const parsed = JSON.parse(dataEl.textContent);
      if (Array.isArray(parsed) && parsed.length > 0) raw = parsed;
    } catch (_) { /* 解析失败则用默认数据 */ }
  }
  // materialize + 注册
  pluginData = raw.map(function (p) { return materializePlugin(p); });
  pluginManager.clearAll();
  pluginData.filter(function (p) { return p.installed; }).forEach(function (p) { pluginManager.install(p); });
  // 渲染 Ribbon（如果 Ribbon DOM 已存在）
  pluginManager.refreshPluginRibbonButtons();
  // 渲染顶栏工具按钮（ToolbarManager 存在时兜底首屏）
  if (typeof ToolbarManager !== 'undefined' && ToolbarManager && ToolbarManager.render) ToolbarManager.render();
  // 异步加载插件目录插件（Electron 环境）；网页版无 noteDesktop.plugins，自动跳过
  loadDirPlugins();
}

/* ============================
 * 插件目录机制
 * 每个插件是独立目录 plugins/<id>/manifest.json + main.js：
 *   - manifest.json：插件元数据（ribbon/commands/contextMenus 等扩展点声明）
 *   - main.js：插件实现，通过 PluginAPI.register(id, actions) 注册 actionKey 回调
 * 目录存在即视为已安装；与内置插件 id 冲突时，目录插件优先。
 * 作者: 火 冰
 * ============================ */

/** 插件目录插件可通过此 API 注册 actionKey → 实际函数回调 */
globalThis.PluginAPI = {
  /**
   * 把一组 actionKey 回调注册进全局映射表
   * 每个动作包一层错误边界（沙箱）：插件抛错不冒泡到宿主，只记录异常
   * @param {string} pluginId 插件 id（须与 manifest.json 的 id 一致）
   * @param {Object} actions  actionKey → function 映射
   */
  register: function (pluginId, actions) {
    if (!pluginId || !actions) return;
    if (!PLUGIN_ACTION_MAP[pluginId]) PLUGIN_ACTION_MAP[pluginId] = {};
    Object.keys(actions).forEach(function (key) {
      // 冲突监控：同名 actionKey 被其他插件占用时记录
      claimActionKey(key, pluginId);
      const fn = actions[key];
      if (typeof fn !== 'function') return;
      // 错误边界 wrap：插件异常只记录，不中断宿主
      PLUGIN_ACTION_MAP[pluginId][key] = function () {
        try { return fn.apply(null, arguments); }
        catch (err) { markPluginError(pluginId, err); }
      };
    });
  },

  /**
   * 读取插件设置（manifest settings schema 的值）
   * @param {string} pluginId 插件 id
   * @param {string} key      设置项 key
   * @returns {string|undefined} 字符串原始值；未设置返回 undefined
   */
  getSetting: function (pluginId, key) {
    if (!pluginId || !key) return undefined;
    const v = localStorage.getItem('plugin:' + pluginId + ':' + key);
    return v === null ? undefined : v;
  },

  /**
   * 写入插件设置并派发 plugin-setting-changed 事件（插件可监听即时反应）
   * @param {string} pluginId 插件 id
   * @param {string} key      设置项 key
   * @param {*} value         值（统一序列化为字符串）
   * @returns {string} 序列化后的原始值
   */
  setSetting: function (pluginId, key, value) {
    const raw = (value === true || value === false || typeof value === 'number')
      ? String(value) : String(value == null ? '' : value);
    localStorage.setItem('plugin:' + pluginId + ':' + key, raw);
    document.dispatchEvent(new CustomEvent('plugin-setting-changed', {
      detail: { id: pluginId, key: key, value: raw },
    }));
    return raw;
  },

  /**
   * 标记插件运行期异常（供 ToolbarManager 等兜底调用，写入 error 状态）
   * @param {string} pluginId 插件 id
   * @param {Error} err 异常对象
   */
  _markError: function (pluginId, err) {
    markPluginError(pluginId, err);
  },

  /** 读取某插件的异常信息（设置页展示「异常」徽章） */
  getError: function (pluginId) {
    return pluginErrorMap[pluginId] || null;
  },

  /** 注册编辑器能力 Provider（manifest.editor 声明 + 运行时实现） */
  registerEditorProvider: function (provider) { registerEditorProvider(provider); },

  /** 注册「编辑器主题解析器」（抽象）：宿主在应用 vditor 主题时调用它拿到
   *  { theme:'dark'|'light', extraCss? }；返回 null 表示不干预（回落宿主默认明暗）。
   *  插件只描述「要什么主题」，宿主的 setTheme/样式注入由宿主内部完成——不直接调 vditor。
   *  @return {Function} 注销器，调用后移除该 resolver。作者: 火 冰 */
  registerEditorThemeResolver: function (fn) {
    if (typeof fn !== 'function') return function () {};
    const list = (window.__hostThemeResolvers = window.__hostThemeResolvers || []);
    list.push(fn);
    // 解析器注册后立即触发宿主重算并应用 vditor 主题：插件 main.js 经异步 fetch 执行，
    // 若 vditor 已先构建则其上一步拿到的 extraCss(如表格深色覆盖) 为空，需在此补一次 sync，
    // 否则编辑器编辑区保持白色、要等再次进入/切换视图才回主题。作者: 火 冰
    if (window.vdSyncTheme) {
      try { window.vdSyncTheme(); } catch (_) { /* 忽略同步异常 */ }
    }
    return function () {
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    };
  },

  /** 编辑器桥：供编辑器能力插件访问宿主编辑器的状态 / 渲染 / 读写能力。
   * 核心侧函数（getEdState / renderMarkdown / setEditorMode / noteStore）在 app-editor.js 等
   * 后置脚本中定义，此处运行期再取，避免加载顺序耦合。作者: 火 冰 */
  editor: {
    getState: function () { return (typeof getEdState === 'function') ? getEdState() : {}; },
    renderMarkdown: function (md) { return (typeof renderMarkdown === 'function') ? renderMarkdown(md) : ''; },
    setMode: function (m) { if (typeof setEditorMode === 'function') setEditorMode(m); },
    getMode: function () { return (typeof restoreS === 'function' ? restoreS('edMode', 'edit') : 'edit'); },
    readNote: function (path) { return (typeof noteStore !== 'undefined' && noteStore && noteStore.read) ? noteStore.read(path) : Promise.resolve(''); },
    saveNote: function (path, md) { return (typeof noteStore !== 'undefined' && noteStore && noteStore.save) ? noteStore.save(path, md) : Promise.resolve(); },
    /* 编辑器主题抽象：宿主把 vditor 深浅切换与样式注入收口在内部，插件只读/触发，不直接调 vditor。 */
    theme: {
      /** 取当前已解析的 vditor 主题配置 { theme, extraCss } */
      get: function () {
        const fn = window.vdResolveVdTheme;
        return typeof fn === 'function' ? fn() : { theme: '', extraCss: '' };
      },
      /** 重算并应用 vditor 主题（配色/编辑器主题配置变化后由插件调用） */
      sync: function () {
        const fn = window.vdSyncTheme;
        if (typeof fn === 'function') { try { fn(); } catch (_) { /* 忽略同步异常 */ } }
      },
    },
  },

  /** 宿主外观主题抽象：深色/浅色/跟随系统。插件经此读写宿主整体明暗，
   * 内部统一收口到宿主 setTheme / toggleTheme（与设置页「外观」主题卡片是同一套操作），
   * 插件不直接改 <html> class 或 localStorage。mode 取值 'dark'|'light'|'auto'。作者: 火 冰 */
  theme: {
    /** 取当前主题模式（'dark'|'light'|'auto'），未设置回退 'dark' */
    get: function () {
      return (typeof __savedTheme !== 'undefined' && __savedTheme) ||
        localStorage.getItem('note-app:theme') || 'dark';
    },
    /** 设置主题模式（持久化到 'note-app:theme'），并刷新图标 */
    set: function (mode) {
      const m = (mode === 'light') ? 'light' : ((mode === 'auto') ? 'auto' : 'dark');
      if (typeof setTheme === 'function') setTheme(m, true);
      if (typeof refreshIcons === 'function') refreshIcons();
    },
    /** 深 ↔ 浅 循环切换 */
    toggle: function () {
      if (typeof toggleTheme === 'function') toggleTheme();
      else if (typeof setTheme === 'function') {
        const light = document.documentElement.classList.contains('light');
        setTheme(light ? 'dark' : 'light', true);
      }
      if (typeof refreshIcons === 'function') refreshIcons();
    },
  },
};

/* ============================
 * 编辑器能力提供器（EditorProvider）
 * 插件用 manifest.editor 声明能力（支持后缀 / 打开方式 / 工具按钮 / 侧边面板），并通过
 * PluginAPI.registerEditorProvider 注册运行时 Provider。核心编辑器按文件后缀路由到对应
 * Provider 打开；无 Provider 匹配时回退到内置纯文本兜底，保证任意后缀都能打开。
 * 作者: 火 冰
 * ============================ */

/** @type {Object[]} 运行时编辑器 Provider 列表 */
let editorProviders = [];

/** 内置兜底 Provider：匹配任意后缀，纯文本编辑（核心按此兜底渲染 textarea） */
const fallbackEditorProvider = {
  id: '__fallback__', name: '纯文本', extensions: ['*'],
  openers: [{ id: 'text', label: '纯文本编辑', icon: 'file-text' }],
  isFallback: true,
};

/**
 * 注册一个编辑器能力 Provider（插件经 PluginAPI.registerEditorProvider 调用）
 * 同 id 重复注册会覆盖旧实例；Provider 主体方法在调用处由宿主沙箱包裹。
 * @param {Object} provider { id,name,extensions[],openers[],toolbar[],sidebar[],open?,renderSidebar? }
 */
function registerEditorProvider(provider) {
  if (!provider || !provider.id) return;
  editorProviders = editorProviders.filter(function (p) { return p.id !== provider.id; });
  editorProviders.push(provider);
}

/**
 * 取支持某后缀的编辑器 Provider 列表；无精确匹配时返回内置兜底 Provider
 * @param {string} ext 文件后缀（含点，如 '.md'）
 * @returns {Object[]}
 */
function getEditorProviders(ext) {
  const e = String(ext || '').toLowerCase();
  const hits = editorProviders.filter(function (p) {
    return (p.extensions || []).some(function (x) { return x === '*' || String(x).toLowerCase() === e; });
  });
  return hits.length ? hits : [fallbackEditorProvider];
}

/**
 * 取当前文件的后缀（含点，小写）
 * @param {string} path 文件路径
 * @returns {string} 如 '.md'；无后缀返回 ''
 */
function fileExtension(path) {
  const name = String(path || '').split('/').pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i).toLowerCase() : '';
}

/**
 * 所有已注册 Provider 声明的后缀集合（去重；排除通配符 '*')
 * @returns {string[]} 小写后缀列表
 */
function getEditorExtensions() {
  const set = {};
  editorProviders.forEach(function (p) {
    (p.extensions || []).forEach(function (x) {
      if (x !== '*') set[x.toLowerCase()] = x;
    });
  });
  return Object.keys(set);
}

/* 记录某插件当前版本的 localStorage 键 */
function pluginVersionKey(id) { return 'plugin:' + id + ':__version__'; }

/**
 * 同步单个插件的配置：首次发现（新解压的插件）或版本号变化时，
 * 将其 settings schema 中「尚未保存」的项补齐为默认值，并记下当前版本。
 * 已存在的用户配置保持不变（只补缺失、不覆盖），供设置-插件管理展示与后续版本比对。
 * @param {Object} plugin 已 materialize 且合并过 manifest 的插件对象（含 id/version/settings）
 * 作者: 火 冰
 */
function syncPluginConfig(plugin) {
  if (!plugin || !plugin.id) return;
  const id = plugin.id;
  const ver = plugin.version || '';
  const verKey = pluginVersionKey(id);
  const was = (typeof restoreS === 'function') ? restoreS(verKey, '') : '';
  const isNew = !was;                       // 首次见到 = 新解压插件
  const changed = String(was) !== String(ver); // 版本号发生变化
  if (isNew || changed) {
    if (Array.isArray(plugin.settings)) {
      plugin.settings.forEach(function (f) {
        if (!f || !f.key || f.default === undefined) return;
        const storeKey = 'plugin:' + id + ':' + f.key;
        if (localStorage.getItem(storeKey) !== null) return; // 已有配置不覆盖
        if (typeof PluginAPI !== 'undefined' && PluginAPI.setSetting) PluginAPI.setSetting(id, f.key, f.default);
        else localStorage.setItem(storeKey, String(f.default));
      });
    }
  }
  // 记下当前版本，便于下次启动比对是否升级
  if (ver && typeof saveS === 'function') saveS(verKey, ver);
}

/**
 * 异步加载插件目录中的插件（桌面版）：
 *   1. 通过 IPC 获取目录清单（主进程 scanPlugins 扫描 plugins/ 读取各 manifest.json）
 *   2. 对每个插件 fetch 并执行 main.js（注入 PluginAPI + pluginId 沙箱执行）
 *   3. materialize 后合并进 pluginData（目录插件优先覆盖内置 mock）并安装到 PluginManager
 * 网页版无 noteDesktop.plugins 时直接返回（内置 mock 数据照常工作）。
 * 作者: 火 冰
 */
async function loadDirPlugins() {
  if (!window.noteDesktop || !noteDesktop.plugins) return;
  let res;
  try { res = await noteDesktop.plugins.list(); }
  catch (_) { return; }
  const list = (res && res.plugins) || [];
  if (list.length === 0) return;

  for (const item of list) {
    if (!item || !item.manifest || !item.manifest.id) continue;
    const id = item.manifest.id;

    // 1) 加载插件实现脚本：main.js + manifest.scripts 中声明的各模块文件
    //    只处理内置插件（note:// 协议只能加载项目内文件）
    //    多个文件按序 fetch 后「拼接为一段代码整体执行」→ 共享同一闭包作用域，各功能模块可互相调用/注册。
    //    任一脚本加载失败则终止该插件注册（与旧 main.js 失败同策略）。
    const scripts = [];
    if (item.hasMain) scripts.push('main.js');
    if (Array.isArray(item.manifest.scripts)) {
      item.manifest.scripts.forEach(function (s) { if (typeof s === 'string' && s.trim()) scripts.push(s.trim()); });
    }
    if (scripts.length > 0) {
      let ok = true;
      const parts = [];
      for (const rel of scripts) {
        const url = 'note://local/plugins/' + id + '/' + rel;
        try { parts.push(await (await fetch(url)).text()); }
        catch (err) {
          console.warn('[plugin] 加载脚本失败:', id, '/' + rel, err.message);
          ok = false; break;
        }
      }
      if (!ok) continue;              // 有脚本加载失败则不注册此插件
      try {
        const joined = parts.join('\n;\n');
        (new Function('PluginAPI', 'pluginId', joined))(PluginAPI, id);
      } catch (err) {
        console.warn('[plugin] 执行脚本失败:', id, err.message);
        continue;  // 执行失败则不注册此插件
      }
    }

    // 1.5) 加载插件样式 styles.css（manifest.styles 声明则自动注入 <head>）
    if (item.manifest.styles) {
      try {
        const cssUrl = 'note://local/plugins/' + id + '/' + item.manifest.styles;
        const cssText = await (await fetch(cssUrl)).text();
        const styleEl = document.createElement('style');
        styleEl.rel = 'stylesheet';
        styleEl.dataset.pluginId = id;
        styleEl.textContent = cssText;
        document.head.appendChild(styleEl);
      } catch (err) {
        console.warn('[plugin] 加载 styles.css 失败:', id, err.message);
        // 样式加载失败不阻塞插件注册（功能可能仍可用）
      }
    }

    // 2) materialize：从 manifest 展开字段 + actionKey → 已注册的回调
    const full = materializePlugin(Object.assign({}, item.manifest, { installed: true }));

    // 3) 合并进 pluginData：同 id 目录插件优先（覆盖内置 mock）
    const existing = pluginData.find(p => p.id === id);
    if (existing) Object.assign(existing, full);
    else pluginData.push(full);

    // 4) 安装到 PluginManager（刷新 Ribbon / 命令面板 / 右键菜单）
    pluginManager.install(full);

    // 5) 配置同步：新解压插件或版本号变化时，为其 settings 补齐默认值并记录版本
    syncPluginConfig(full);
  }

  // 渲染 Ribbon + 重新绘制插件市场网格（若当前在插件页）
  pluginManager.refreshPluginRibbonButtons();
  const grid = document.getElementById('plugin-grid');
  if (grid && typeof renderPlugins === 'function') {
    renderPlugins(currentCat, searchInput ? searchInput.value : '', sortSelect ? sortSelect.value : '');
  }
}

globalThis.syncPluginConfig = syncPluginConfig;
