# 按模块拆分 app.js

## Context（背景与目标）

`second-brain/js/app.js` 是一个约 **3560 行**的 Electron 渲染进程单文件 SPA，内含路由、命令面板、主题、Markdown 渲染、编辑器、图谱、插件、设置、AI 问答、笔记库切换、右键菜单、布局与启动引导等全部逻辑。单个文件过大，不利于后续按模块迭代与维护。

本次目标：**在不改变任何已测功能的前提下，把 app.js 按功能域拆分为多个 JS 文件**，仍由 `index.html` 按依赖顺序用普通 `<script>` 引入。不引入打包器（项目禁止 bundler，Tailwind 为运行时版本）。

## 核心方案（推荐：物理切分 + 去除单一外层 IIFE）

- 原 app.js 被单一 `IIFE (function(){ 'use strict'; ... })();` 包裹，闭包内所有函数/变量互相直接引用。

- 拆分采用 **普通多 script 按序加载**：去掉外层 IIFE，让各文件顶层 `const/let/function` 进入**全局词法作用域**（顶层 `let/const` 对后续所有经典 script 可见，顶层 `function` 成为 `window` 属性），实现跨文件共享。**逻辑代码一行不改，仅物理切分**。

- 依据浏览器标准行为：所有跨函数调用都发生在 `DOMContentLoaded` 之后，天然规避跨脚本定义时机问题；唯一加载期依赖 `noteStore → MOCK_NOTES` 在同文件内按序满足。

- 与 `.hermes/coding-style.md`「JS 用 IIFE 包裹」的偏离：改为**每文件顶部** **`'use strict';`** **保障严格模式**，中文注释 + 作者「火 冰」全部保留。这是「跨经典 script 共享全局词法作用域」的必要代价，是相对改造为 ES Module 风险最低、最符合「最小改动/不破坏功能」要求的方案。

## 拆分文件清单（按 index.html 加载顺序）

每个文件放于 `second-brain/js/`，头注释说明职责 + 作者「火 冰」+ `'use strict';`。原文件行号仅作定位参考，**切分以「函数声明符号边界」为准**。

| #  | 文件                     | 原行号区间        | 主要内容                                                                                                                                                                                                                  |
| -- | ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1  | `js/app-core.js`       | L1–\~371     | ROUTES、viewRoot/overlay/navButtons、cachedViews/activeView、palette\*、refreshIcons/getRoute/updateCrumb/updateNav、COMMAND\_ACTIONS 与命令面板全套、主题/字体/外观 apply、通用工具(tint/shade/hexToRgb)。**删除外层** **`(function () {`**}      |
| 2  | `js/app-note.js`       | L373–\~566   | MOCK\_NOTES、noteStore、esc/inline/renderMarkdown、`$`/countChars/extractTags/extractOutline/relDate。                                                                                                                    |
| 3  | `js/app-editor.js`     | L568–\~1312  | ed\* 状态、renderFileTree/openNote/renderTabs、inlineToMd/domToMd、源模式/查找替换、renderArticle/renderBacklinks/initEditor/doNewNote/doNewFolder/setEditorMode/bindCollapse。                                                     |
| 4  | `js/app-graph.js`      | L1314–\~1700 | graph\* 状态、loadGraph/buildGraph/forceLayout/treeLayout/renderGraph/renderGraphTags/updGraphDetail/initGraph/openNoteFromGraph。                                                                                        |
| 5  | `js/app-plugins.js`    | L1702–\~1836 | pluginData/installedOnly、renderPlugins、currentCat/searchInput/sortSelect、openPluginDrawer/closePluginDrawer/bindPlugins。                                                                                              |
| 6  | `js/app-settings.js`   | L1837–\~2340 | CATS、settingsShellInn/settingsPanel/tgRow/settingsPanelHtml、aiField/bindAiSettings/bindAppearance、sState/saveS/restoreS/showToast/settingsSideEffect/bindKeyedControls/bindActionButtons/switchSettings/bindSettings。 |
| 7  | `js/app-ai.js`         | L2341–\~2686 | ai\* 状态、aiSetStatus/aiNewSession/aiActiveSession/renderSessionSidebar/removeSession/renderSessionChat/aiAddMessage/aiRenderSources/aiSend/aiAutoResize/initAi。                                                        |
| 8  | `js/app-vault.js`      | L2688–\~2951 | closeVaultDropdown/toggleVaultDropdown/onVaultAction/initVaultPicker、closeNoteContextMenu/showNoteContextMenu/showBlankContextMenu/toggleHiddenFiles/bindNoteContextMenu。                                             |
| 9  | `js/app-editor-ctx.js` | L2953–\~3251 | escapeRe、编辑区右键菜单全套(buildEdCtxSchema/showEditorContextMenu/bindEditorContextMenu)、mdWrap/mdBlockFormat/mdInsert\*/mdClearFormat、edClipboard/edPaste。                                                                   |
| 10 | `js/app-layout.js`     | L3253–L3558  | bindTreeResizer/bindSideResizer/bindResponsivePanels、loadView/bindViewInteractions、init、`document.addEventListener('DOMContentLoaded', init);`。**删除收口的** **`})();`**                                                  |

## 必须删除的外层 IIFE 位置

- `js/app-core.js`：删除原 **L8** `(function () {`，保留其后 `'use strict';`。

- `js/app-layout.js`：删除原 **L3559** `})();`，文件以 `DOMContentLoaded` 挂载收尾。

- 其余 8 个文件不做 IIFE 处理，纯搬运。

## 修改的唯一其它文件

`second-brain/index.html`（L152）：把

```html
<script src="js/app.js?v=3"></script>
```

替换为（顺序不可打乱，app-layout 必须最后）：

```html
<script src="js/app-core.js?v=4"></script>
<script src="js/app-note.js?v=4"></script>
<script src="js/app-editor.js?v=4"></script>
<script src="js/app-graph.js?v=4"></script>
<script src="js/app-plugins.js?v=4"></script>
<script src="js/app-settings.js?v=4"></script>
<script src="js/app-ai.js?v=4"></script>
<script src="js/app-vault.js?v=4"></script>
<script src="js/app-editor-ctx.js?v=4"></script>
<script src="js/app-layout.js?v=4"></script>
```

版本号 `v=3→v=4` 用于避开静态缓存。

## 收尾

- 回归全部通过后，**删除旧文件** **`js/app.js`**（消灭无引用死文件）。若回归前异常，保留作对照。

- **可选项**：在 `.hermes/coding-style.md` 的 JS 规范中补充一句：「多文件拆分下，可用每文件顶部 `'use strict';` 替代外层 IIFE 保障严格模式」，保持文档一致（与 AGENTS.md 文档同步规则一致）。

## 注意/风险点

1. 跨文件共享依赖「全局词法作用域」：任一顶层名字在全部分文件合计中**只能声明一次**，否则抛 `Identifier already declared`。
2. `DOMContentLoaded` 挂载点必须在 `app-layout.js` 且仅此一处。
3. `app-plugins.js` 内 `searchInput/sortSelect` 是加载期 `getElementById`（此时插件视图未加载→为 null），为现存行为，保持原样不修。
4. 不重命名/删除任何函数与变量；`contextIsolation`/`preload`/`window.noteDesktop` 不受影响；不改 `main.js`/`preload.js`。

## 验证

1. 逐个 `node --check second-brain/js/app-*.js`（无语法错误）。
2. `rg "\(function\s*\(\)\s*\{"` 与 `rg "^}\)\("` 确认 IIFE 已移除；`rg "^  (const|let)\s+[A-Za-z_$]+"` 确认无跨文件重复声明。
3. 起本地服务器（`start-server.bat`，<http://127.0.0.1:8000）浏览首页，Console> 零报错零警告；桌面版 `npm start` 同验。
4. 最小回归（只测本次改动影响面，不扩散稳定功能）：编辑器（文件树/打开笔记/编辑）、图谱、插件、AI（发消息）、设置（切深/浅主题、改强调色/字号）、命令面板(Ctrl+P)、笔记库切换、右键菜单（树/编辑区）各走一遍，确认正常且 Console 无新增报错。

