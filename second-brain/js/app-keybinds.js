/* ============================================
 * 第二脑 — 快捷键命令注册表
 * 作者: 火 冰
 * 功能:
 *   - 统一登记「内置命令 + 插件命令」，每个命令带稳定 id、默认快捷键、可绑定开关与执行函数
 *   - 组合键归一化 + 冲突检测（默认键仅在无冲突时占用）
 *   - kbMatch(e) 供全局 keydown 匹配并执行命令
 *   - 用户重绑持久化（saveS('keybind:<id>', combo)）
 * 说明: 依赖全局 saveS/restoreS（app-settings.js）；对 pluginManager 的访问仅在函数内做 typeof 守卫。
 * ============================================ */
'use strict';

/* 命令定义表：id -> { id,label,icon,group,action,defaultShortcut?,keybindable?,pluginId?,when? } */
const keybindCmds = {};

/* 组合键归一化 -> 命令 id（用于冲突检测与匹配） */
const keybindCombos = {};

/* 已经初始化过内置命令（kbInit 幂等） */
let kbBuiltinDone = false;

/**
 * 把用户/插件给的组合串归一化成匹配 key（如 'Ctrl+Shift+K' → 'm1s1a0:k'）
 * @param {string} combo 形如 'Ctrl+Shift+X'
 * @returns {string} 匹配 key；无主键返回 ''
 * 作者: 火 冰
 */
function kbComboKey(combo) {
  const t = { mod: false, shift: false, alt: false, key: '' };
  String(combo || '').split('+').forEach(function (p) {
    const q = p.trim().toLowerCase();
    if (!q) return;
    if (q === 'ctrl' || q === 'control' || q === 'cmd' || q === 'command' || q === 'meta' || q === 'mod' || q === '⌘') t.mod = true;
    else if (q === 'shift') t.shift = true;
    else if (q === 'alt' || q === 'option') t.alt = true;
    else t.key = q;
  });
  return t.key ? 'm' + (t.mod ? 1 : 0) + 's' + (t.shift ? 1 : 0) + 'a' + (t.alt ? 1 : 0) + ':' + t.key : '';
}

/* 把事件归一化成匹配 key（主键统一小写，常用键给别名） */
function kbEventComboKey(e) {
  const k = String(e.key || '').toLowerCase();
  if (!k) return '';
  const map = { ' ': 'space', 'escape': 'esc', 'arrowup': 'up', 'arrowdown': 'down', 'arrowleft': 'left', 'arrowright': 'right' };
  return 'm' + (e.ctrlKey || e.metaKey ? 1 : 0) + 's' + (e.shiftKey ? 1 : 0) + 'a' + (e.altKey ? 1 : 0) + ':' + (map[k] || k);
}

/* 组合串 → 显示串（简单规范化，输出如 'Ctrl+Shift+K'） */
function kbComboDisplay(combo) {
  const t = { mod: false, shift: false, alt: false, key: '' };
  String(combo || '').split('+').forEach(function (p) {
    const q = p.trim().toLowerCase();
    if (!q) return;
    if (q === 'ctrl' || q === 'control' || q === 'meta') t.mod = true;
    else if (q === 'shift') t.shift = true;
    else if (q === 'alt') t.alt = true;
    else t.key = p.trim();
  });
  return (t.mod ? 'Ctrl+' : '') + (t.alt ? 'Alt+' : '') + (t.shift ? 'Shift+' : '') + (t.key || '');
}

/* 命令的生效快捷键：用户绑定 > 默认快捷键 > '' */
function kbEffectiveCombo(cmd) {
  const user = (typeof restoreS === 'function') ? restoreS('keybind:' + cmd.id, null) : null;
  return (user && String(user).trim()) ? String(user).trim() : (cmd.defaultShortcut || '');
}

/**
 * 释放某命令占据的组合键（从匹配表移除并清理内部状态）
 * @param {Object} cmd 命令对象
 * 作者: 火 冰
 */
function kbReleaseCombo(cmd) {
  const eff = kbEffectiveCombo(cmd);
  const ck = kbComboKey(eff);
  if (ck && keybindCombos[ck] === cmd.id) delete keybindCombos[ck];
}

/**
 * 登记一条命令。默认快捷键仅在无冲突时占用；同 id 重复注册会先卸载旧实例。
 * @param {Object} cmd { id,label,icon,group,action,defaultShortcut?,keybindable?,pluginId?,when? }
 * @returns {Object} 命令对象
 * 作者: 火 冰
 */
function kbRegisterCommand(cmd) {
  if (!cmd || !cmd.id || typeof cmd.action !== 'function') return null;
  kbUnregister(cmd.id);
  cmd.keybindable = (cmd.keybindable !== false);
  keybindCmds[cmd.id] = cmd;
  const eff = kbEffectiveCombo(cmd);
  if (eff && cmd.keybindable) {
    const ck = kbComboKey(eff);
    const owner = keybindCombos[ck];
    // 默认键仅在空闲时占用；用户已有绑定（owner 非本命令但非默认登记）时不抢占
    if (!owner || owner === cmd.id) keybindCombos[ck] = cmd.id;
  }
  return cmd;
}

/* 卸载单条命令并释放其组合键 */
function kbUnregister(id) {
  const cmd = keybindCmds[id];
  if (cmd) kbReleaseCombo(cmd);
  delete keybindCmds[id];
}

/* 卸载某插件的全部命令（停用/卸载插件时调用） */
function kbUnregisterPlugin(pluginId) {
  Object.keys(keybindCmds).forEach(function (id) {
    if (keybindCmds[id].pluginId === pluginId) kbUnregister(id);
  });
}

/**
 * 用户重绑快捷键。冲突检测：同组合已属于其它命令则失败。
 * @param {string} id 命令 id
 * @param {string} combo 组合串（'Ctrl+K' 等）
 * @returns {{ok:boolean, conflictId?:string, reason?:string}}
 * 作者: 火 冰
 */
function kbSetBind(id, combo) {
  const cmd = keybindCmds[id];
  if (!cmd) return { ok: false, reason: 'no-command' };
  if (!cmd.keybindable) return { ok: false, reason: 'not-bindable' };
  const norm = String(combo || '').trim();
  if (!norm) return kbClearBind(id);
  const ck = kbComboKey(norm);
  if (!ck) return { ok: false, reason: 'invalid' };
  const owner = keybindCombos[ck];
  if (owner && owner !== id) return { ok: false, conflictId: owner };
  kbReleaseCombo(cmd); // 释放旧的
  keybindCombos[ck] = id;
  if (typeof saveS === 'function') saveS('keybind:' + id, kbComboDisplay(norm));
  return { ok: true };
}

/* 清除用户绑定，回到默认/未设置 */
function kbClearBind(id) {
  const cmd = keybindCmds[id];
  if (!cmd) return { ok: false, reason: 'no-command' };
  kbReleaseCombo(cmd);
  if (typeof saveS === 'function') saveS('keybind:' + id, null);
  // 恢复默认键占用（若有且空闲）
  const def = cmd.defaultShortcut;
  if (def && cmd.keybindable) {
    const ck = kbComboKey(def);
    const owner = keybindCombos[ck];
    if (!owner || owner === id) keybindCombos[ck] = id;
  }
  return { ok: true };
}

/* 单条命令当前生效组合（显示用） */
function kbResolveBind(id) {
  const cmd = keybindCmds[id];
  return cmd ? kbEffectiveCombo(cmd) : '';
}

/* 清除全部用户绑定，回到各命令默认/未设置（设置页「恢复默认」用） */
function kbResetAll() {
  Object.keys(keybindCmds).forEach(function (id) { kbClearBind(id); });
}

/* 全部命令及当前生效组合（设置页快捷键列表用） */
function kbGetBinds() {
  return Object.keys(keybindCmds).map(function (id) {
    const c = keybindCmds[id];
    return {
      id: c.id, label: c.label, icon: c.icon, group: c.group || '其他',
      combo: kbEffectiveCombo(c), keybindable: c.keybindable, pluginId: c.pluginId || null,
    };
  });
}

/**
 * 从事件匹配一条命令（供全局 keydown 调用）
 * @param {KeyboardEvent} e 事件对象
 * @returns {Object|null} 命中且通过 when 校验的命令；否则 null
 * 作者: 火 冰
 */
function kbMatch(e) {
  const ck = kbEventComboKey(e);
  if (!ck) return null;
  const id = keybindCombos[ck];
  if (!id) return null;
  const cmd = keybindCmds[id];
  if (!cmd) return null;
  if (typeof cmd.when === 'function') {
    try { if (!cmd.when()) return null; } catch (_) { return null; }
  }
  return cmd;
}

/* 统计信息（供调试/测试） */
function kbCount() { return Object.keys(keybindCmds).length; }

/* ---- 内置命令（默认键与改造前硬编码一致） ---- */

/** 初始化内置命令（幂等）。在应用启动、插件系统就绪后调用。作者: 火 冰 */
function kbInitBuiltins() {
  if (kbBuiltinDone) return;
  kbBuiltinDone = true;
  const inEditor = function () { return (typeof activeView === 'undefined') ? false : (activeView === 'editor'); };
  kbRegisterCommand({ id: 'cmd:palette', label: '打开命令面板', icon: 'command', group: '内置', defaultShortcut: 'Ctrl+P', action: function () {
    // 命令面板开则关、关则开；paletteOpen/openPalette/closePalette 来自 app-core.js 的全局词法环境
    if (typeof paletteOpen !== 'undefined' && paletteOpen) { if (typeof closePalette === 'function') closePalette(); }
    else if (typeof openPalette === 'function') openPalette();
  } });
  kbRegisterCommand({ id: 'cmd:new', label: '新建笔记', icon: 'file-plus', group: '内置', defaultShortcut: 'Ctrl+N', action: function () { location.hash = '#/editor'; document.dispatchEvent(new CustomEvent('note:new')); } });
  kbRegisterCommand({ id: 'cmd:graph', label: '打开图谱视图', icon: 'git-fork', group: '内置', defaultShortcut: 'Ctrl+G', action: function () { location.hash = '#/graph'; if (typeof closePalette === 'function') closePalette(); } });
  // 查找替换：vditor 原始引擎接管（Ctrl+F / Ctrl+R 在编辑区内由 vditor 原生处理），宿主不再注册
  kbRegisterCommand({ id: 'cmd:settings', label: '打开设置', icon: 'settings', group: '内置', action: function () { location.hash = '#/settings'; if (typeof closePalette === 'function') closePalette(); } });
  kbRegisterCommand({ id: 'cmd:ai', label: '打开 AI 问答', icon: 'brain', group: '内置', action: function () { location.hash = '#/ai'; if (typeof closePalette === 'function') closePalette(); } });
  kbRegisterCommand({ id: 'cmd:plugins', label: '浏览插件市场', icon: 'puzzle', group: '内置', action: function () { location.hash = '#/plugins'; if (typeof closePalette === 'function') closePalette(); } });
  kbRegisterCommand({ id: 'cmd:theme', label: '切换主题', icon: 'moon', group: '内置', action: function () { if (typeof toggleTheme === 'function') toggleTheme(); } });
  kbRegisterCommand({ id: 'cmd:export', label: '导出为 PDF', icon: 'file-down', group: '内置', action: function () { alert('演示环境：已触发「导出为 PDF」命令。'); } });
  kbRegisterCommand({ id: 'cmd:sync', label: '同步设置', icon: 'cloud', group: '内置', action: function () { alert('演示环境：设置已同步。'); } });
}

/**
 * 同步插件命令进注册表（启动时调用一次；插件增删后由 install/uninstall/setPluginEnabled 增量处理）
 * 读取 pluginManager.getCommands() 扁平化后逐一登记。
 * 作者: 火 冰
 */
function kbSyncPlugins() {
  const pm = (typeof pluginManager !== 'undefined' && pluginManager && pluginManager.getCommands) ? pluginManager : null;
  if (!pm) return;
  pm.getCommands().forEach(function (g) {
    (g.items || []).forEach(function (c) {
      if (!c.id || typeof c.action !== 'function') return;
      kbRegisterCommand({
        id: c.id, label: c.label, icon: c.icon, group: g.group || '插件',
        action: c.action, defaultShortcut: c.shortcut || '', keybindable: (c.keybindable !== false),
        pluginId: c.pluginId || null,
      });
    });
  });
}

/* 初始化：内置命令 + 插件命令（幂等，重复调用仅增量补插件命令） */
function kbInit() {
  kbInitBuiltins();
  kbSyncPlugins();
}

/* 导出到 window */
globalThis.kbRegisterCommand = kbRegisterCommand;
globalThis.kbUnregister = kbUnregister;
globalThis.kbUnregisterPlugin = kbUnregisterPlugin;
globalThis.kbSetBind = kbSetBind;
globalThis.kbClearBind = kbClearBind;
globalThis.kbResolveBind = kbResolveBind;
globalThis.kbResetAll = kbResetAll;
globalThis.kbGetBinds = kbGetBinds;
globalThis.kbMatch = kbMatch;
globalThis.kbInit = kbInit;
globalThis.kbSyncPlugins = kbSyncPlugins;
globalThis.kbComboKey = kbComboKey;
globalThis.kbComboDisplay = kbComboDisplay;
globalThis.kbCount = kbCount;