# Markdown Editor 插件重写 —— vditor 引擎迁移

## 一、Summary（目标）

放弃自研的 Markdown 编辑引擎（源码 textarea + 自研 WYSIWYG + 自研预览，及全部自研编辑增强），改用开源项目 **vditor** 整体替换编辑区。保留宿主外壳（标签栏、文件树、侧边面板、状态栏、标题/元信息、索引面板），保留宿主三个模式按钮（编辑/预览/分屏）并**映射驱动 vditor 模式**。

架构决策（已与用户确认）：

1. **引擎进宿主**：新建 `js/editor/editor-vditor.js`，静态注册 `.md/.markdown` 的 Provider 并初始化 vditor；桌面版与网页版双端都可得到 vditor 能力。`markdown-editor` 插件保留为「声明外壳」（manifest 声明后缀/工具按钮/侧边面板/命令），不再承载引擎。
2. **单 vditor 容器全替换**：退役 `#ed-edit`（源码 textarea）、`#ed-wysiwyg`（自研所见即所得）、`#ed-preview`（自研预览）三套 DOM 与自研增强（悬浮工具栏 ED-40、右键格式 ED-41、HTML 透传、数学块、代码块悬浮复制等），改由 vditor 的 `ir / sv / preview` 原生承接。

vditor 能力范围：
- 编辑（源码/即时渲染/所见即所得、分屏）、预览渲染、GFM/Lute 解析、表格、代码高亮、数学（KaTeX）、工具栏格式、内置查找（Ctrl+F）、破坏性/非破坏性编辑由 vditor 原生提供，不再自研。

## 二、Current State Analysis（现状）

- **Provider 机制**：宿主 `openNote()` 通过 `pluginManager.getEditorProviders(ext)`（[app-plugins.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-plugins.js#L884-L890)）路由后缀到运行时 Provider（经 `registerEditorProvider` 注册，[L873](file:///d:/project/aiCode/second-brain/second-brain/js/app-plugins.js#L873-L877)）。`markdown-editor` 插件经 `PluginAPI.registerEditorProvider` 注册 `.md/.markdown` Provider，暴露 `open/renderWysiwyg/getMd/buildContextMenu` 契约。
- **插件加载**：`loadDirPlugins`（[L958](file:///d:/project/aiCode/second-brain/second-brain/js/app-plugins.js#L958-L1037)）**仅在桌面端**运行（需 `noteDesktop.plugins`），脚本以 `new Function('PluginAPI','pluginId', joined)` 独立作用域执行，只能访问 `window/globalThis`。**网页版不加载该插件** → 这正是引擎需放宿主的原因。
- **宿主编核心**：[editor-host.js](file:///d:/project/aiCode/second-brain/second-brain/js/editor/editor-host.js) 硬编码操作 `#ed-edit`、`#ed-wysiwyg`、`#ed-preview`、`#ed-gutter`、`#ed-current-line`，并绑定自研增强（`bindWysCopyButton`、`bindWysSelToolbar`、块编辑、表格操作、数学块、拖拽重排）。
- **宿主 markdown 渲染**：`renderMarkdown` 在 [app-note.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-note.js#L224)，仍被 AI 问答展示使用，**保留不动**。`domToMd`（Host 方向量）在 [editor-md.js](file:///d:/project/aiCode/second-brain/second-brain/js/editor/editor-md.js#L46)，仅 `rwGetMd` 兜底使用，迁移后对 `.md` 失效但可无害保留。
- **视图/样式**：`views/editor.html` 含三套编辑 DOM；`index.html` 按序加载全部本地脚本；vditor 资产目录 `js/vendor/vditor` 尚不存在（node_modules 未装 vditor）。

## 三、Proposed Changes（改动清单）

### 1. vditor 资产引入
- 在 `second-brain/` 目录执行 `npm install vditor`，将 `node_modules/vditor/dist/**` 整体拷贝到 `js/vendor/vditor/`（含 `index.css`、`index.min.js`/`index.js`、`content-theme/`、`icon/`、`themes/` 等）。
- **依赖已存在则跳过下载**（实现时用 `ls js/vendor/vditor/index.css` 判断）。
- 桌面端 `note://` 协议能加载（同 vendor/lucide 的静态引用方式）；网页端由服务器静态托管同路径。

### 2. `second-brain/index.html`（脚本/样式接入）
在 `<head>` 追加（vditor 样式需在我们覆盖样式之前，保证可覆盖）：
```html
<link rel="stylesheet" href="js/vendor/vditor/index.css">
```
在 `<body>` 底部脚本区，于 `js/app-plugins.js` 之后新增两行：
```html
<script src="js/vendor/vditor/index.min.js"></script>
<script src="js/editor/editor-vditor.js?v=1"></script>
```
> `editor-vditor.js` 依赖 `registerEditorProvider`（在 app-plugins.js 定义），故必须放在其后。

### 3. `second-brain/main.js`（Electron MIME）
在 `MIME` 表追加字体与 sourcemap 类型，避免 vditor 资源 / 控制台告警：
```js
'.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
'.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject', '.map': 'application/json',
```

### 4. `second-brain/views/editor.html`（编辑区结构改造）
- 保留：标题 `#ed-title`、元信息 `#editor-meta`、查找条 `#ed-findbar`（如需留则重新挂 vditor 查找，见第 7 条）、索引面板 `#ed-index-panel`、状态栏（`#ed-count`/`#ed-saved`）。
- 删除：`#ed-split` 整块内容中的 `#ed-pane-src`（含 `#ed-gutter`、`#ed-current-line`、`#ed-edit`、`#ed-wysiwyg`）、`#ed-split-sep`、`#ed-pane-prev`（含 `#ed-preview`）。
- 新增：以单个容器替代上述区域：
```html
<div id="ed-vditor" class="ed-vditor"></div>
```

### 5. 新增 `second-brain/js/editor/editor-vditor.js`（vditor 桥接 + Provider）
- 类级注释；作者 `huobing`。
- 模块级延迟初始化：首次打开 `.md` 时才 `new Vditor('#ed-vditor', opts)`（懒建，避免空文档时无谓创建）；`window.Vditor` 不存在时打印警告并安全返回（保护 jsdom 测试）。
- vditor 选项：
  - `mode`: 默认 `'ir'`（即时渲染，最接近原「所见即所得」编辑体验）；
  - `value`: 初始 `edOutdated[edCurrent]`；
  - `input(v)` → 回调宿主 `onEdInput(v)`（联动缓存/字数/状态栏/防抖保存）；
  - `cache: false`、`upload: null`（首版不做文件上传）、`preview: { ... cdn: '' ... }` 使用本地资源；
  - `theme: 'dark'`（跟随应用暗色），`counter/lineNumber` 等按需开启；
  - `toolbar`：精简常用项，保留原生「搜索（find）」「表格」「代码」「数学」「格式刷」等承接原自研能力。
- 暴露全局桥接函数（供宿主与插件 action 映射调用）：
  - `vdInit()` 确保并返回实例；
  - `vdGetValue()` / `vdSetValue(md)`；
  - `vdSetMode(mode)`：映射 `edit→'ir'`、`split→'sv'`、`preview→纯预览`；
  - `vdToggleSource()`：在 `ir/sv` 之间切换（承接原「源码/所见即所得」按钮）；
  - `vdFocus()` / `vdDestroy()`。
- 注册 Provider：`id:'markdown-editor'`，`extensions:['.md','.markdown']`，外层用模块级 `window.__vdProviderRegistered` **防重复注册**（宿主注册 + 桌面插件残留都可能再调）。`open/renderWysiwyg/getMd/buildContextMenu` 提供薄实现（`getMd: vdGetValue`），避免生效空档。

### 6. `second-brain/js/editor/editor-host.js`（宿主适配）
逐函数替换，删除对已退役 DOM 的引用：
- `applySourceMode()` → 改为仅 `syncModeButtons()`（去除 textarea/wysiwyg 显隐、`updateGutter`/`updateCurrentLine`）。
- `syncModeButtons()` → 保持刷新 `[data-mode]` 高亮，语义改为「vditor 当前有效模式」。
- `toggleSource()` → 委托 `vdToggleSource()`（不再操作 `#ed-edit`/`#ed-wysiwyg`）。
- `setEditorMode(mode)` → 只更新 `edMode`、`ed-mode-label`、`syncModeButtons()`，并 `vdSetMode(mode)`（删除 pane/sep/预览面板显隐）。
- `renderArticle()` → 保留标题/元信息/大纲/标签/反链/属性面板；编辑区用 `vdSetValue(md)`（首次 `vdInit()`）。删除 textarea/wysiwyg/preview 三处 innerHTML 分支。
- `onEdInput()` → 删除分屏/预览手动 `#ed-preview` 刷新（vditor 负责预览联动），保留缓存/字数/状态/防抖保存。
- `initEditor()` → 删除：整个 `#ed-wysiwyg` 绑定块（块编辑/表格/数学/拖拽、`bindWysCopyButton`、`bindWysSelToolbar`）、`#ed-edit` 的 input/智能列表/光标高亮/`autoResizeTa`、查找条绑定、`updateGutter`/`updateCurrentLine`/`setLineNumbers`/`setEditorWrap` 中对 `#ed-edit` 的调用（行号/换行交由 vditor）。保留：文件树/标签/侧边/新建/删除笔记/标题改名/索引面板/启动恢复逻辑。首次打开 `.md` 时调用 `vdInit()`。
- **仍保留**：`renderMarkdown` 兜底（app-note.js 共用，保留）、标签选择器文件树等宿主外壳。
- 右键菜单：对 `.md`（vditor 激活时）在 `bindEditorContextMenu` 中 `return`，**交给 vditor 原生右键**；仅非 `.md` 走宿主菜单。

### 7. 查找条（决策）
- 首版**下线宿主 `#ed-findbar`**（其逻辑强依赖 `#ed-edit` textarea）。
- 由 vditor 原生「搜索」承接 Ctrl+F/查找替换；`openFindbar` 等函数不再被调用（保留函数定义或标注废弃，不处理断链引用）。

### 8. 插件重写 `second-brain/plugins/markdown-editor/`
- **`main.js`（重写为薄壳）**：仅保留 `PluginAPI.register('markdown-editor', {...})` 的 action 映射，委托宿主/桥接全局：
  - `mde-toggle-source` → `vdToggleSource()`
  - `mde-open` → `openCurrentNote()`、`mde-view-index` → `toggleIndexPanel()`、`mde-delete` → `fireAction('delete-note')`
  - `mde-toggle-lineno` / `mde-toggle-wrap` → no-op（vditor 自控）
  - **删除** `PluginAPI.registerEditorProvider(...)` 注册（引擎归宿主，避免重复）。
- **`manifest.json`**：删除 `scripts`（仅剩 `main.js`）与 `styles`；保留 `editor` 声明外壳（extensions/openers/toolbar/sidebar）、`commands`。
- **删除文件**：`plugins/markdown-editor/common/*`、`features/*`、`styles.css`（自研渲染/序列化/菜单全部废弃）。目录结构删不动则清空脚本引用即可。

> 说明：宿主 `editor-host.js` 中残留对 `plugins/.../common` 函数的引用（`domToMd`、`wysBlockTags` 等）在改造后不再被 vditor 路径调用；若仍有裸引用会导致报错，实现时对发现的未知引用一并删除。

### 9. `second-brain/js/editor/editor-core.js`、`css/app.css`
- **editor-core.js**：`edSource` 复用为「vditor ir/sv 源码开关」语义；清理已退役状态变量（`mdeCodePre/mdeCodeEl`, `edBlockSel/edMathSel/edDragBlock`）——确认无引用后删除，避免残留。
- **app.css**：删除 `#wys-copy-btn`、`#wys-sel-tool`/`.wys-tool-*`/`.wys-swatch`、`.sb-math` 等自研样式；新增 `#ed-vditor` 容器尺寸/主题覆盖：
  ```css
  #ed-vditor { height: 100%; overflow: hidden; }
  #ed-vditor .vditor { border: none; border-radius: 0; height: 100%; }
  ```
  并将 vditor 配色对齐应用主题变量（暗色下覆盖 `.vditor--dark` 的边框/背景为 `--note-*`）。

### 10. 已停用的宿主文件（删除其脚本引用即可，文件可留壳）
- `js/editor/editor-wys-toolbar.js`、`js/editor/editor-format.js`、`js/editor/editor-ctx.js` 已无入口调用（宿主不再走自研 WYSIWYG）。在 `index.html` 删除对应 `<script>`，文件删除或保留空壳（建议删除，属「放弃自研」）。
- `js/editor/editor-md.js`（`domToMd`）：`rwGetMd` 对 `.md` 不再调用，**保留文件**避免无关处断链，标记为第三方未用即可。

### 11. 回归测试 `second-brain/regression.test.js`
- **移除/替换**已删除功能的断言：`testWysCopyBtn`（Bug-026 复制按钮）、表格行列删除/插入断言、自研 WYSIWYG `$…$` 数学块、自研 `domToMd` 往返等 —— vditor 接管后这些断言失效，改为新桥接测试。
- **新增**（jsdom 注入 `window.Vditor` 桩，占位返回实例，验证桥接不因 vditor 缺失抛错）：
  - `.md/.markdown` Provider 已注册（`getEditorProviders('.md')[0].id === 'markdown-editor'`）；
  - Provider 注册去重（重复调用不产生多实例）；
  - `vdSetMode` 映射：`edit→'ir'`、`split→'sv'`、`preview→preview`；
  - `vdSetValue/vdGetValue` 往返调用链路。
- 其余无关测试保持不动；改后 `npm test` 全绿。

### 12. 文档同步
- `doc/需求/需求-编辑器.md`：登记新功能「vditor 引擎迁移（ED-xx）」；将 ED-40（悬浮工具栏）、ED-41（右键格式）、HTML 透传、数学块、代码块复制标记为**被 vditor 承接/退役**。
- `doc/开发进度.md`：看板保留未完结，登记 vditor 迁移行；把被退役功能的「未完结」行归档到 `doc/进度/进度-编辑器.md`（按归档模板追加），不留在看板。
- `doc/进度/进度-编辑器.md`：追加 vditor 迁移完成项与说明。

## 四、Assumptions & Decisions（假设与决策）

1. vditor 采用 **npm + 本地 vendor 静态引入**（离线桌面端必需，符合 `note://` 静态加载）。
2. 引擎/Provider **进宿主** `editor-vditor.js`，桌面+网页双端一致；插件只留声明外壳（已确认）。
3. 编辑区 **单 vditor 容器全替换**，退役三套自研 DOM 与全部自研编辑增强（已确认）。
4. 模式映射：宿主 `编辑→ir`、`分屏→sv`、`预览→纯预览`；原「源码/所见即所得」按钮降级为 `ir/sv` 切换。
5. 首版不做 vditor 内嵌文件上传/CDN 依赖；主题默认 `dark`（对齐应用暗色），细节用 `#ed-vditor` 作用域覆盖。
6. `renderMarkdown`（app-note.js，AI 展示用）**保留**；宿主 `renderArticle` 的侧边面板逻辑（大纲/标签/反链/属性）保持。
7. 宿主查找条首版下线，查找交给 vditor 原生（避免与 vditor 自带 Ctrl+F 冲突）。

## 五、Verification（验证）

1. `cd second-brain && npm test` —— regression+smoke 全绿。
2. 桌面端起服务 `start-desktop.bat`：打开 `.md` 笔记，验证：
   - 编辑(ir)录入/删除同步到状态栏字数、自动保存落盘、重开可见；
   - 分屏(sv)源码+预览同屏、预览(纯预览)只读展示；
   - 表格/代码高亮/数学/格式由 vditor 原生可用；右键菜单为 vditor 原生；
   - 标签栏、文件树、侧边面板（属性/大纲/反链/标签）、标题改名、索引面板仍正常；
   - AI 问答回顾（`app-ai.js` 的 `renderMarkdown`）不受影响。
3. 网页服务 `start-server.bat` + `http://127.0.0.1:8000`：网页端同样获得 vditor 编辑能力（无插件目录也生效）。
4. 打开一个**非 .md** 文件：仍走宿主纯文本兜底，不崩。
5. 控制台无 `#ed-wysiwyg`/`#ed-edit`/`#ed-preview` 相关 TypeError。