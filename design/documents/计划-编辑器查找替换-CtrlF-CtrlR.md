# Markdown 编辑器查找 / 替换功能（Ctrl+F / Ctrl+R）

## Context（背景）

用户需要编辑器内提供「查找 / 替换」功能，并绑定 **Ctrl+F（查找）**、**Ctrl+R（替换）**（若已有则加快捷键，否则先实现）。

**调研结论（当前无可用实现）**：
- vditor 4.0 内核**没有内置**查找/替换：toolbar 无 `search` 项、`src` 无 find 模块、公开 API 无 find/replace 方法。
- 宿主旧的 `openFindbar` 系列（`js/editor/editor-host.js` L271-373）是写给已退役 `#ed-edit` textarea / `#ed-findbar` 的，这些 DOM 已从 `views/vault.html` 删除，当前完全失效。
- 但 `css/app.css` L73-115 的 `.ed-findbar` / `.show-replace` 样式仍保留，可直接复用，**不需改 CSS**。

因此属于「没有 → 先实现，再绑定快捷键」。

## 实现方案

三种编辑模式（sv 源码 / ir 即时渲染 / wysiwyg）统一用 `vdInst.getValue()`（markdown 全文）算匹配偏移计数；选区跳转按模式分策略。

### 核心逻辑放 `js/editor/editor-vditor.js`（能访问 vdInst/vdMode/sync2Host）

在 L994 附近（现有 Escape / handleIrDeleteKeydown 挂点旁）新增 document keydown：
```js
document.addEventListener('keydown', function (e) {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'f') { e.preventDefault(); vdOpenFindbar(false); }
  else if (mod && e.key === 'r') { e.preventDefault(); vdOpenFindbar(true); }
});
```
并新增以下函数（名称带 `vd` 前缀避免与宿主旧函数冲突）：
- `vdOpenFindbar(replace)`：显示 findbar、`show-replace` 切换、预填选中文本、聚焦查找输入框、`vdRunFind()`。
- `vdRunFind()`：在 `vdInst.getValue()` 全文收集匹配偏移（复用 `escapeReg`，来自 `editor-core.js` L118），更新计数「当前/总数」，跳转首个匹配。
- `vdFindNav(dir)`：上一 / 下一循环。
- `vdHighlight()`：**sv** → `v.sv.element.setSelectionRange` + `scrollIntoView`；**ir/wysiwyg** → TreeWalker 遍历当前编辑元素文本节点、`Range` 选中当前匹配 + `scrollIntoView`（选区软件高亮，不污染 vditor DOM）。
- `vdDoReplace()`：sv → textarea `setSelectionRange` + `execCommand('insertText')`；ir/wysiwyg → `execCommand` 在 Range 处替换。都触发 vditor `input`（已绑定 `sync2Host`）自动同步保存。
- `vdDoReplaceAll()`：sv → `value.replace(/gi)` + `sync2Host`；ir/wysiwyg → 循环 `vdDoReplace` 至无匹配。然后 `vdRunFind()` 刷新。
- `vdCloseFindbar()`：隐藏、清计数、焦点还给编辑区。
- 在文件尾部 `window` 导出薄封装：`window.vdFindbar = { open: vdOpenFindbar, close: vdCloseFindbar };`（供主机薄转发）。

### UI 挂载 `views/vault.html`

在 `<div id="ed-vditor">`（L77）**之前**新增独立的 findbar 行（`hidden` 初始隐藏），不放进 vditor 容器内部（避免 destroy/rebuild 被清）：
```html
<div id="ed-vditor-find" class="ed-findbar" hidden>
  <input class="find-input" id="vd-find-input" placeholder="查找">
  <span class="find-count" id="vd-find-count">0 / 0</span>
  <button class="find-btn" id="vd-find-prev">上一个</button>
  <button class="find-btn" id="vd-find-next">下一个</button>
  <button class="find-btn" id="vd-find-close">×</button>
  <div class="find-replace">
    <input class="find-input" id="vd-replace-input" placeholder="替换为">
    <button class="find-btn" id="vd-replace-one">替换</button>
    <button class="find-btn" id="vd-replace-all">全部替换</button>
  </div>
</div>
```
样式完全复用 `css/app.css` 现有 `.ed-findbar` / `.find-replace` / `.show-replace`。

### 宿主薄改造 `js/editor/editor-host.js`

- 保留名 `openFindbar(replace)`、`closeFindbar()`（L307 Escape 与 app-layout.js 依赖）。
- 删除失效的 `runFind/findNav/updateFindHighlight/doReplace/doReplaceAll` 内部实现（它们引用的 `#ed-edit`/`#ed-findbar` 不存在），改为转发到 `window.vdFindbar`：
  - `openFindbar(replace)` → `if (window.vdFindbar) window.vdFindbar.open(replace);`
  - `closeFindbar()` → `if (window.vdFindbar) window.vdFindbar.close();`
- 保留 `findOpen` 布尔（app-layout.js Escape 分支引用），由新 findbar 维护。

### 快捷键冲突

`app-keybinds.js` L219 未注册这些键（注释误以为 vditor 原生接管），无需改动；vditor keydown 中 `preventDefault()` 拦截 Electron/浏览器系统查找条；`e.isComposing` 判断避免中文输入法时误触发。

### 不改动

- vditor 内核、`css/app.css`、`js/app-layout.js`（KeyEscape 对接保留）、既有预览/分屏链路、markdown-editor 插件。

## 验证

1. `node --check js/editor/editor-vditor.js` + JSON/引用宿主语法通过。
2. `npm test` 回归通过；尽力在 `regression.test.js` 补一条 Ctrl+F 打开 findbar 的断言（若 jsdom 环境可控）。
3. 手动（Electron 桌面端）：打开笔记 → Ctrl+F 弹出查找、输入词高亮并跳转；Ctrl+R 显示替换行、替换/全部替换生效并写盘；sv / ir 两模式分别验证跳转与替换；Escape 关闭 findbar。三种模式 + 切换笔记不报错。

## 修改文件清单

- `js/editor/editor-vditor.js`（核心实现 + keydown + window.vdFindbar 导出）
- `views/vault.html`（findbar DOM）
- `js/editor/editor-host.js`（旧失效实现删除 + 薄转发）
- （不改）`css/app.css`、`js/app-layout.js`、`js/app-keybinds.js`