# 计划：Markdown 编辑器操作插件化 + 后缀默认打开方式 + 打开子菜单

## Context（背景与目标）

当前「第二脑」的编辑器把 Markdown 的**所有操作**（工具按钮、源码/所见即所得切换、预览、左侧栏索引面板、右侧栏 属性/大纲/反向链接/标签）都内嵌在核心 `app-editor.js` + `views/editor.html`，且识别 Markdown 后缀是硬编码的。需求方希望：

1. 把 md 文件的操作**完整物理搬迁**进一个独立插件 `markdown-editor`，由插件**注册它支持的文件后缀、打开方式、工具按钮、侧边面板**。
2. 编辑器的侧边面板承载：文件属性、大纲/目录、当前保留索引面板。
3. 设置-编辑器可对**不同后缀**管理**默认打开方式**（后缀映射表）。
4. 文件树右键把「在资源管理器打开」改为「打开」**二级子菜单**，内含「在资源管理器打开」及各支持的打开方式。

约束/风险：单个插件异常不能拖垮整体（沿用既有沙箱）；`renderMarkdown` 被 AI 会话（`app-ai.js`）复用，**必须留在核心**，插件只消费、不搬走；改动大，需分阶段并保留核心兜底编辑器。

## 架构总览

引入 **EditorProvider（编辑器能力提供器）** 抽象：核心变成「通用编辑器宿主」，负责 Tab 栏、按后缀分发打开、脏/保存、最近标签、查找替换；md 专属操作由 `markdown-editor` 插件通过 `PluginAPI` 注册的 Provider 承接。核心保留一个**纯文本 fallback Provider**（无匹配后缀或 md 插件加载失败时打开成 textarea），保证任何情况都能打开文件。

核心 → 插件的桥接用 `PluginAPI.editor`（只读 state + renderMarkdown + setMode + 读写笔记），插件不直接碰核心内部状态。

## 实施步骤

### Phase A — 核心：Provider 注册表 + 能力声明
文件：`js/app-plugins.js`

- manifest 支持 `editor` 能力字段：`{ extensions: string[], openers: [{id,label,icon}], toolbar: [{id,label,icon,actionKey}], sidebar: [{id,label}] }`。
- `materializePlugin`：把 `editor` 合并进插件对象（含 `editorOpeners` 派生自 actions）。
- `pluginManager.getEditorProviders(ext)` → 支持某后缀的 Provider 列表；`pluginManager.getEditorExtensions()` → 注册后缀集合。
- `PluginAPI.registerEditorProvider(id, provider)`：插件注册运行时 Provider（装/卸联动），Provider 异常经既有错误边界兜底。
- `PluginAPI.editor` 桥：`getState()`(edCurrent/edMode/edSource)、`renderMarkdown(md)`、`readNote(path)`、`saveNote(path,md)`、`setMode(m)`。

### Phase B — 新插件：`plugins/markdown-editor/`
文件：新建 `plugins/markdown-editor/{manifest.json, main.js, styles.css}`

- manifest.json：`id:'markdown-editor'`，`editor.extensions=['.md','.markdown']`，openers=`edit/wysiwyg/preview/split`，toolbar=`源码/所见即所得/预览/分屏/行号/换行/索引/删除`，sidebar=`属性/大纲/反向链接/标签`。
- main.js：注册 Provider，承接：
  - 渲染**工具按钮**并绑定 action（复用 `editor.html` 现有 data-mode/data-action 约定）。
  - **源码/所见即所得**切换（`edSource`）与**预览**（调 `PluginAPI.editor.renderMarkdown`）。
  - **侧边面板**：`ed-index-panel`（保留案例）+ 属性/大纲/反向链接/标签渲染。
- styles.css：承接 md 编辑器专属样式（原 `editor-article`、`ed-pane`、`ed-gutter`、`collapse-*` 等，从 `app.css`/`app-editor` 移入或引用）。

### Phase C — 核心宿主瘦身：`js/app-editor.js` + `views/editor.html`
- `app-editor.js` 保留：Tab 栏渲染/锁定/溢出滚动、`openNote` 按后缀路由到 Provider、脏/自动保存、最近标签、查找替换、光标/状态栏。
- 移除（迁往插件）：`renderArticle` 的 md 渲染、预览实时同步、`edSource` 切换 UI、模式按钮标签、`renderIndexPanel`、右侧栏 属性/大纲/反向链接/标签 渲染。
- `openNote(path, {mode})`：`ext = 后缀` → `provider = first getEditorProviders(ext) || fallback` → 按 `mode ?? 设置默认` 打开。
- 视图 `editor.html`：md 专属片段（`ed-pane-src/prev`、`ed-index-panel`、右侧面板内容）委托给 Provider 填充，宿主只留通用骨架（文件树/Tab/查找条/状态栏/右侧面板壳）。
- 内置 fallback Provider：任意后缀/Provider 缺失时以纯 textarea 编辑，写入逻辑复用 `noteStore`。

### Phase D — 设置-编辑器 后缀映射表：`js/app-settings.js`
- 「编辑器」分类新增「文件类型」分组：遍历 `pluginManager.getEditorExtensions()`，每个后缀一行，显示来源插件 + 「默认打开方式」下拉（来自该后缀 Provider 的 openers，含「跟随默认」）。
- 存 `saveS('openAs:<ext>', openerId)`，`settingsSideEffect` 映射 `openAs:*` 即时生效。
- 复用现有 `settingsPanel`/`tgRow`/`bindKeyedControls` 模式。

### Phase E — 文件树右键「打开」子菜单：`js/file-tree-ctx.js`
- 笔记右键首项由 `在资源管理器打开` 改为 `打开`（`children` 子菜单，`buildTreeCtxItem` 已支持二级）：
  - 子菜单①`在资源管理器打开`（原 `openInExplorer(path)`）。
  - 其余由 `pluginManager.getEditorProviders(该文件后缀)` 的 openers 生成，点击 → `openNote(targetPath, { mode: openerId })`。
  - 无 Provider 时仅保留「在资源管理器打开」。

### Phase F — 安全兜底 + 收尾
- 确认 `PluginAPI.register`/Toolbar/Provider 错误边界把插件异常隔离；md 插件未注册时 fallback 生效。
- `node --check` 语法校验；同步更新 `doc/开发进度.md`、如需 `doc/功能需求文档.md`。

## 复用点
- `buildTreeCtxItem(spec)`：已支持 `children` 二级子菜单（`file-tree-ctx.js:146-167`）。
- `openInExplorer(path)`：资源管理器定位（`file-tree-ctx.js:45-50`）。
- `renderMarkdown(source)`：`app-note.js:217`，留在核心，插件经 `PluginAPI.editor.renderMarkdown` 调用（勿移动，AI 复用）。
- `settingsPanel`/`tgRow`/`bindKeyedControls`/`saveS`/`restoreS`：设置页表单基建（`app-settings.js`）。
- `PluginAPI`/`pluginManager` 扩展点与既有错误边界（`app-plugins.js`）。

## 验证
1. `node --check` 校验 `app-plugins.js`/`app-editor.js`/`app-settings.js`/`file-tree-ctx.js` 与插件 `main.js`；manifest JSON 合法。
2. 扩展 `smoke-plugin.test.js`（jsdom）新增断言：
   - `markdown-editor` Provider 注册 `.md/.markdown`，`getEditorProviders('.md')` 命中、`.txt` 不命中。
   - fallback：无 Provider 后缀 `openNote` 走纯文本。
   - 设置映射表为 `.md` 渲染「默认打开方式」下拉并可存。
   - 文件右键 `打开` 子菜单包含「在资源管理器打开」+ openers。
3. 桌面版启动：打开 `.md` 三种方式生效、右侧面板数据完整、文件树右键「打开」子菜单可点、`txt`/未知后缀走兜底编辑器、禁用 md 插件后仍能打开文件。

## 备注 / 取舍
- 「完整物理搬迁」指**md 的编辑器操作**（工具按钮、源码/WYSIWYG、预览接线、索引/侧栏渲染）进入插件；`renderMarkdown` 纯函数与 Tab/文件分发等通用宿主留在核心（否则 AI 会话与整体稳定性受影响）。
- 为控制回归面，md 逻辑先平移复用（不改行为），验证通过后再做增量优化。