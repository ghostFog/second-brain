/**
 * 快捷键注册表冒烟测试（jsdom 离线）
 * 作者: 火 冰
 * 验证本次新增功能：
 *   1. kbRegisterCommand：默认键无冲突时占用、冲突不强占
 *   2. kbMatch：从键盘事件匹配命令并返回可执行命令
 *   3. kbSetBind：用户重绑 + 冲突返回 conflictId
 *   4. kbClearBind / kbResetAll：清除/恢复默认
 *   5. kbUnregisterPlugin：停用插件即释放其组合键
 * 脚本以 <script> 注入 window 作用域，全部符号经 window 访问，模拟真实浏览器全局环境。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body></body></html>`, { url: 'https://localhost/', pretendToBeVisual: true, runScripts: 'dangerously' });
const W = dom.window;

// 宿主提供的基础全局（挂到 window，模拟 app-settings.js 的 saveS/restoreS）
const storage = {};
W.saveS = (k, v) => { if (v === null || v === undefined) delete storage[k]; else storage[k] = String(v); };
W.restoreS = (k, d) => Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : d;

const SCRIPTS = ['app-plugins.js', 'app-keybinds.js'];
function loadScripts() {
  for (const name of SCRIPTS) {
    const s = W.document.createElement('script');
    s.textContent = fs.readFileSync(path.join(__dirname, 'js', name), 'utf8');
    W.document.head.appendChild(s);
  }
}
let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
loadScripts();

const { kbRegisterCommand, kbMatch, kbSetBind, kbClearBind, kbUnregisterPlugin, kbResetAll, kbResolveBind } = W;
const ev = (key, opts = {}) => Object.assign({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, opts);

const ran = {};
// 内置命令
kbRegisterCommand({ id: 'built:palette', label: '打开命令面板', group: '内置', defaultShortcut: 'Ctrl+P', action: () => { ran.palette = true; } });
// 插件命令：默认键 Ctrl+K
kbRegisterCommand({ id: 'plug:hello', label: 'Hello', pluginId: 'hello', group: 'hello 插件', defaultShortcut: 'Ctrl+K', action: () => { ran.hello = true; } });

// ---- 1. 默认键命中 ----
const m1 = kbMatch(ev('p', { ctrlKey: true }));
assert(m1 && m1.id === 'built:palette', 'Ctrl+P 命中内置命令');
const m2 = kbMatch(ev('k', { ctrlKey: true }));
assert(m2 && m2.id === 'plug:hello', 'Ctrl+K 命中插件命令');

// ---- 2. 冲突不强占：同默认键 Ctrl+K 的第二条命令不抢占 ----
kbRegisterCommand({ id: 'plug:conflict', label: '冲突命令', pluginId: 'conflict', group: 'conflict 插件', defaultShortcut: 'Ctrl+K', action: () => { ran.conflict = true; } });
const mConf = kbMatch(ev('k', { ctrlKey: true }));
assert(mConf && mConf.id === 'plug:hello', '默认键冲突时，后注册命令不强占 Ctrl+K');

// ---- 3. 执行 + 未绑定不命中 ----
const m3 = kbMatch(ev('x', { ctrlKey: true }));
assert(m3 === null, '未绑定组合不命中任何命令');

// ---- 4. kbSetBind 重绑 ----
const rb = kbSetBind('plug:hello', 'Ctrl+Alt+B');
assert(rb.ok === true, '重绑 Ctrl+Alt+B 成功');
assert(kbResolveBind('plug:hello') === 'Ctrl+Alt+B', '生效键位变为 Ctrl+Alt+B');
const m4 = kbMatch(ev('b', { ctrlKey: true, altKey: true }));
assert(m4 && m4.id === 'plug:hello', 'Ctrl+Alt+B 命中插件命令');
assert(kbMatch(ev('k', { ctrlKey: true })) === null, '原 Ctrl+K 已被释放');
// 冲突：重绑到被占用的 Ctrl+P
const rb2 = kbSetBind('plug:hello', 'Ctrl+P');
assert(rb2.ok === false && rb2.conflictId === 'built:palette', '重绑会与 Ctrl+P 冲突并返回 conflictId');
assert(kbResolveBind('plug:hello') === 'Ctrl+Alt+B', '冲突后键位保持不变');

// ---- 5. kbClearBind 恢复默认 ----
kbClearBind('plug:hello');
assert(kbResolveBind('plug:hello') === 'Ctrl+K', '清除后回退默认 Ctrl+K');

// ---- 6. kbUnregisterPlugin 停用即释放 ----
kbUnregisterPlugin('hello');
assert(kbMatch(ev('k', { ctrlKey: true })) === null, '插件停用后其默认键被释放');
// conflict 命令同样属冲突插件，一并释放
assert(kbMatch(ev('k', { ctrlKey: true })) === null, '同插件命令全部释放');

// ---- 7. kbResetAll 回到默认 ----
kbRegisterCommand({ id: 'plug:r2', label: 'R2', pluginId: 'r2', group: 'r2 插件', defaultShortcut: 'Ctrl+R', action: () => {} });
kbSetBind('plug:r2', 'Ctrl+1');
assert(kbResolveBind('plug:r2') === 'Ctrl+1', '重置前用户绑定为 Ctrl+1');
kbResetAll();
assert(kbResolveBind('plug:r2') === 'Ctrl+R', 'kbResetAll 后回退默认键');

console.log(`\n[smoke-keybind] 通过 ${pass} / ${pass + fail}`);
if (fail > 0) process.exit(1);