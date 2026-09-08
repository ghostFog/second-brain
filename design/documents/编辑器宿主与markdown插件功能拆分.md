# 编辑器宿主与 markdown 插件功能拆分计划

作者：火 冰
日期：2026-09-06
状态：已执行（阶段1~6 完成；宿主 app-editor.js 已删除，app-editor-ctx.js / editor-md.js 保留为 Web 兜底，见阶段6备注）

---

## 1. 背景与目标

用户要求对 Markdown 编辑器做强架构拆分：

1. **编辑器相关功能拆分成独立目录**，提供一个**通用编辑器宿主（shell）**，包含：
   - 目录区（文件树）
   - tab 栏相关功能（多标签、锁定、拖拽、溢出滚动、右键菜单）
   - 「简单的空白右键菜单的编辑区（全屏高度）」——宿主不感知 Markdown 结构，只负责一个全屏高度的编辑宿主区域 + 空白区右键 + 保存/加载/模式切换骨架
   - 侧边面板
2. **具体的编辑与预览功能由「后缀对应的插件」实现**（Provider 架构）：`.md/.markdown` → markdown-editor 插件；无 Provider 匹配 → 宿主内置纯文本兜底（仅全屏 textarea + 空白右键）。
3. **markdown-editor 插件按功能拆分**为独立模块：段类、表格、列表、任务、代码块、链接、标注、脚注、数学块等，**每个功能同时支持源码模式与预览（所见即所得）模式**。
4. 链接报错（`docButton is not defined`）已确认源码层面修复（app-input.js 将 `docButton` 提升为模块级函数），本次**仅规划拆分、不再干预链接问题**，但在最终验证阶段会顺带确认无回归。

目标架构行为等价：**重构后运行结果与拆分前一致**，仅把代码按职责重分布。重构不得改变既有已测试功能，并在每阶段回归 `npm test` + 冒烟测试。

---

## 2. 现状分析

### 2.1 现状代码分布（拆分前）

- 所有 JS 通过 `index.html` 的 `<script>` 按序加载、**全局作用域共享**（`js/app-log.js → app-input.js → … → app-editor.js → … → app-editor-ctx.js`）。
- 宿主 [app-editor.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-editor.js)（约106KB）混杂了「通用宿主职责」与「Markdown 专属职责」：
  - 全局状态（L13-36）：edNotes/edCurrent/edSource/edMode/edProvider/edExt/edBlockSel… + 通用工具 $/countChars/extractTags/extractOutline/relDate/escapeReg/wysBlockTags/CODE_LANGS。
  - 通用宿主职责：文件树渲染（renderFileTree）、打开与模式入口（openNote/applyOpenMode）、多标签页（renderTabs/…/showTabContextMenu/reorderTab）、源码/预览模式切换（setEditorMode/toggleSource/applySourceMode/syncModeButtons）、查找替换（runFind/…/doReplaceAll）、文件属性/反向链接（renderFileProps/renderBacklinks）、启动初始化（initEditor/最近打开恢复）、事件委托（file tree/tab/块/resize/mode按钮）、文件树拖拽（bindFileTreeDrag 新建目录/笔记/移动）。
  - **Markdown 专属职责（本次要下沉到插件）**：
    - 渲染：`renderMarkdown`（在 app-note.js）、WYSIWYG 渲染入口（L1039 附近）
    - 序列化：`inlineToMd` / `domToMd`（L522-611，DOM→Markdown 往返）
    - 所见即所得块编辑：`selectWysBlock/clearWysBlock/placeCaretAtEnd/appendWysTrailingP` + 代码块语言选择（anchorCodeLangPicker/filterCodeLangs/renderCodeLangList/applyCodeLang/ensureCodeLangPicker/showCodeLangPicker/hideCodeLangPicker）+ 块散列事件（单击/双击/Enter/Delete/Backspace/拖拽）。
    - 侧边面板 md 专属：大纲/标签/索引面板（extractOutline/renderIndexPanel）。
- 宿主右键菜单 [app-editor-ctx.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-editor-ctx.js)（约39KB）：
  - 通用菜单 UI（buildEdCtxItem/showEditorContextMenu/bindEditorContextMenu/specItem/closeEditorContextMenu/escapeRe/setEdCtxSubmenu）。
  - 源码模式 md 工具（buildEdCtxSchema/mdWrap/mdBlockFormat/mdClearFormat/mdInsertAtCursor/mdInsertBlockAtCursor/mdInsertTable/applyBlockLine/edClipboard + 链接 md 插入）。
  - 所见即所得 md 块工具（buildEdWysiwygSchema/execWys/insertWysBlock/topLevelWysBlock/resolveWysHit/deleteWysBlock/wysAdjacentContent/placeCaretAtWysStart/wysCopyBlock/wysRemoveLink/wysTableOp + insLink/insCode/insQuote/insTable/insTask/insFoot/insMath）。
- markdown-editor 插件 [main.js](file:///d:/project/aiCode/second-brain/second-brain/plugins/markdown-editor/main.js)：目前**只有声明式 Provider**（经 `PluginAPI.registerEditorProvider` 注册 ext/openers/toolbar/sidebar），动作通过 `fireAction` / 全局函数 `toggleSource` 等调用宿主；**不含任何 md 渲染逻辑**。样式在 styles.css。
- 插件加载器 [app-plugins.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-plugins.js#L965-L995)：只 fetch `plugins/<id>/main.js`，用 `new Function('PluginAPI','pluginId', code)(PluginAPI, id)` 沙箱执行；另加载 `manifest.styles`。

### 2.2 关键结论

- 存在「无 Provider 纯文本兜底」（`edTextFallback`），正好作为宿主「简单全屏编辑区 + 空白右键」的天然形态。
- 插件多文件拆分需要扩展加载器：新增 `manifest.scripts`，按序 fetch 各文件并**拼接为同一段代码整体执行**，使各功能模块共享同一闭包作用域，可互相调用/注册。
- md 渲染与序列化位于宿主，需整体迁入插件，且必须保证 `renderMarkdown`/`domToMd`/`inlineToMd` 往返一致性（已有多处 jsdom 往返测试背书）。

---

## 3. 目标目录架构

```
second-brain/
├─ js/editor/                       # 【宿主 shell，独立目录】
│  ├─ editor-core.js                # 全局状态 + 通用工具
│  ├─ editor-host.js                # 打开/保存/加载/模式骨架 + 全屏编辑区宿主 + 空白右键 + Provider 挂载
│  ├─ editor-tabs.js                # tab 栏
│  ├─ editor-filetree.js            # 目录区/文件树/树拖拽/新建
│  ├─ editor-sidepanel.js           # 侧边面板容器（内容渲染委托 Provider）
│  └─ editor-ctx.js                 # 宿主级右键菜单通用 UI + 空白右键
├─ js/app-editor.js                 # 删除（职责全部移入 editor/ + markdown 插件）——由 git 历史可追溯
├─ js/app-editor-ctx.js             # 删除（宿主部分→editor/editor-ctx.js；md 部分→markdown 插件 features/）
└─ plugins/markdown-editor/
   ├─ manifest.json                 # 新增 "scripts" 指定各功能模块（按序）
   ├─ main.js                       # 装配：注册 Provider + 工具/侧边栏 + 让各 feature 注册自身
   ├─ styles.css
   ├─ common/
   │  ├─ md-render.js               # renderMarkdown（预览 / WYSIWYG 渲染）
   │  ├─ md-serialize.js            # domToMd / inlineToMd
   │  └─ md-helper.js               # 光标/块级工具（placeCaretAtEnd/topLevelWysBlock/selectWysBlock/clearWysBlock/wysAdjacentContent/placeCaretAtWysStart/appendWysTrailingP/wysBlockTags/execWys/insertWysBlock）
   ├─ features/                     # 每个功能独立 js，且都含源码 + 预览(WYSIWYG)双实现
   │  ├─ paragraph.js               # 段类：标题/正文/分隔线/块级格式（源码 mdBlockFormat + WYSIWYG 段落设置）
   │  ├─ table.js                   # 表格：源码 mdInsertTable + WYSIWYG insTable + 行列操作 wysTableOp + 删除
   │  ├─ list.js                    # 列表：有序/无序（源码块格式 + WYSIWYG 段落设置）
   │  ├─ task.js                    # 任务列表
   │  ├─ code.js                    # 代码块：插入/语言选择/复制（language picker 全家）
   │  ├─ link.js                    # 链接：源码 [[..]]/[..](..) + WYSIWYG 插入/编辑/移除 inputLinkModal
   │  ├─ quote.js                   # 标注(引用)：源码块格式 + WYSIWYG insQuote + 转正文
   │  ├─ footnote.js                # 脚注：源码 [^1] + WYSIWYG insFoot
   │  └─ math.js                    # 数学块：源码 $$..$$ + WYSIWYG insMath
   ├─ sidebar.js                    # 属性/大纲/反向链接/标签 渲染（原来宿主的 renderFileProps/renderIndexPanel/renderBacklinks/extractOutline）
   └─ toolbar.js                    # 工具按钮动作（toggle-source/lineno/wrap/index/delete/open）
```

---

## 4. 分阶段实施

> 每阶段必须行为等价、可独立验证；建议每阶段结束跑 `npm test` + 冒烟测试并提交一次，便于回滚。

### 阶段 1 —— 插件加载器支持多脚本

- **文件**：`js/app-plugins.js`（`loadDirPlugins`）。
- **改动**：
  - manifest 读取 `scripts`（数组，插件内相对路径，如 `["common/md-render.js",...]`）。
  - 加载 main.js 前/后按序 fetch 所有 scripts，全部**拼接为一段代码**，一次性 `(new Function('PluginAPI','pluginId', joined))(PluginAPI, id)`，使多文件共享同一闭包作用域。
  - 任一 script 加载失败则 `console.warn` 并终止该插件注册（与现 main.js 失败同策略）。
- **验证**：`npm test` 通过；临时用两文件交叉调用全局证明共享。

### 阶段 2 —— 宿主 shell 抽取到 `js/editor/`

> 本阶段只搬运、不重写业务；md 专属渲染/序列化函数暂仍保留在宿主（供引用），进入阶段 4/5 再迁出。

- **新建 `js/editor/editor-core.js`**：迁移全局状态（edNotes/edCurrent/edSel/edOutdated/edOpenTabs/edPinned/edDirty/edDragFrom/edDragTarget/edBlockSel/edDragBlock/collapsedFolders/edMode/edSource/edExt/edProvider/edTextFallback/edSaveTimer/edLineNum/findOpen/edFindQ/edFindMatches/edFindIdx/mdeCodePre/mdeCodeEl）+ 通用工具（$/countChars/extractTags/extractOutline/relDate/escapeReg/wysBlockTags/CODE_LANGS）。
- **新建 `js/editor/editor-tabs.js`**：persistRecentTabs/tabDisplayOrder/toggleTabPin/ensureTabVisible/updateTabScroll/scrollTabs/closeTabs/renderTabs/showTabContextMenu/buildTabCtxItem/reorderTab + tab 相关事件委托。
- **新建 `js/editor/editor-filetree.js`**：renderFileTree/renderFolder + bindFileTreeDrag 全量（新建目录/笔记、文件夹/笔记移动、`noteStore` 交互）。
- **新建 `js/editor/editor-sidepanel.js`**：侧边面板容器逻辑（大纲/标签/反向链接/属性渲染入口，md 专属内容实现保持占位调用，阶段 5 迁入插件）。
- **新建 `js/editor/editor-ctx.js`**：右键菜单通用 UI（buildEdCtxItem/specItem/showEditorContextMenu/bindEditorContextMenu/closeEditorContextMenu/setEdCtxSubmenu/escapeRe）+ 「空白区右键」宿主菜单（该菜单与 Provider 无关，始终可用）。
- **新建 `js/editor/editor-host.js`**：openNote/applyOpenMode/getEdState/defaultOpenMode/openCurrentNote/persistRecentTabs/initEditor/recentLoad/restore + 模式切换骨架（setEditorMode/toggleSource/applySourceMode/syncModeButtons）+ 编辑区宿主（全屏高度 textarea/预览容器挂载，`edTextFallback` 纯文本兜底）+ 保存/加载/字数/标题/元信息。
- **改 `index.html`**：替换 `js/app-editor.js` 引用为 `js/editor/*.js`（按 core→host→tabs→filetree→sidepanel→ctx 顺序，置于 app-note 之后、app-plugins 之前或按依赖定序）。
- **删除 `js/app-editor.js`**中已迁移片段；保留 md 专属函数（渲染/序列化/块编辑）至阶段 4/5。
- **验证**：`npm test` 全绿；应用启动后目录区/tab/空编辑区/侧边面板外观与交互一致。

### 阶段 3 —— Provider 接口形式化 + 宿主编辑区挂载 Provider

- 在 `editor-host.js` 定义 **Provider 契约**（宿主只认契约，不再感知 md 语法）：

```
provider = {
  id, name, extensions,
  async open(state),                    // state={path,ext,mode,md}
  renderPreview(md, el),                // 填充预览容器
  renderWysiwyg(md, el),                // 填充所见即所得可编辑容器
  getMd() -> string,                    // 从 WYSIWYG / 源码序列化当前内容
  onSourceInput(cb),                    // 源码输入回调（宿主据此驱动保存/计数）
  buildContextMenu(mode, hit) -> schema,// 组装右键菜单（源码/WYSIWYG + 命中块）
  renderSidebar(section, state),        // 侧边面板
}
```

- `openNote` 路由：`edProvider=pluginManager.getEditorProviders(edExt)[0]`；有 Provider → 挂载其编辑表面；无 → `edTextFallback` 纯文本 textarea + 空白右键。
- 源码/WYSIWYG 的「编辑区宿主」只负责全屏容器、模式显隐、加载/保存、input 通知；不再自含 md 语法。
- **验证**：`npm test`；md 仍能正常编辑（此时仍调宿主残留的 md 函数）。

### 阶段 4 —— markdown-editor 插件落地「公共层」

- 新建插件 `common/md-render.js`（移植 renderMarkdown）、`common/md-serialize.js`（移植 domToMd/inlineToMd）、`common/md-helper.js`（移植光标/块/语言选择/代码块语言全家）。
- 宿主改为调用 `edProvider` 的公共层函数（或经 Provider 门面暴露），逐步移除宿主内 md 专属代码。
- **验证**：md 打开/编辑/往返一致（`npm test` 往返用例仍绿）。

### 阶段 5 —— Markdown 各功能按模块拆分（每功能独立 js，源码 + 预览双实现）

> 这是「每个功能单独一个js，支持源码和预览」的直接落地。每个 feature 模块同时导出：
> - 源码模式：md 文本操作（插入/包裹/块格式）
> - 预览/WYSIWYG：DOM 渲染/插入/块编辑/右键菜单项
> - 向 Provider 注册自身菜单项与动作。

每个功能拆分映射（源自 app-editor-ctx.js + app-editor.js）：

| 目录 | 源码模式（source） | 预览/WYSIWYG（preview） |
| --- | --- | --- |
| `features/paragraph.js` | mdBlockFormat/mdClearFormat/applyBlockLine（标题/正文/分隔线/块级格式） | 段落设置菜单、分割线 `fmt('insertHorizontalRule')`、删除本块 |
| `features/table.js` | mdInsertTable（3×3 源码表格） | insTable（3×3）、光标落首个 td、wysTableOp（上下插行/左右插列）、删除 |
| `features/list.js` | mdBlockFormat（有序/无序列表、任务） | 段落设置（列表/任务） |
| `features/task.js` | md 任务列表源码重构（任务同时要有源码预览双实现） | WYSIWYG 待办方块渲染（`data-lucide square/check-square`）+ domToMd 还原 |
| `features/code.js` | 源码代码块（``` 语法） | insCode、语言选择器全家、`.code-lang` 往返、复制代码、删除（wysAdjacentContent/placeCaretAtWysStart） |
| `features/link.js` | 源码 `[[目标]]`/`[文字](url)` 插入（mdInsert link） | insLink、编辑链接、移除链接、rmeove link、inputLinkModal |
| `features/quote.js` | mdBlockFormat 引用 | insQuote、转正文 |
| `features/footnote.js` | 源码 `[^1]` 插入 | insFoot |
| `features/math.js` | 源码 `$$..$$` 插入 | insMath |

- 插件 `main.js` 变为装配器：注册 Provider + toolbar + sidebar，并让各 feature 模块将菜单项/动作注册进 Provider 的 schema 汇编器。
- 宿主右键菜单改为：空 Provider 时用宿主空白右键；有 Provider 时调用 `provider.buildContextMenu(mode, hit)` 汇编各 feature 菜单与 Provider 级通用项。
- **验证**：每功能分别验证「源码模式插入 → 预览模式渲染还原 → 再切回源码」一致；冒烟用例（块后插入/表格3×3/末尾补行/链接等）全部迁移到插件侧并保持通过。

### 阶段 6 —— 收尾、清理与回归

- 删除宿主中已迁走的 md 专属函数；`js/app-editor.js`、`js/app-editor-ctx.js` 清空并删除（git 可追溯）。
- 更新 `index.html` 脚本顺序；确认无残留全局引用（grep 校验 `toggleSource/domToMd/inlineToMd/renderMarkdown/editorContextMenu` 等不再被宿主引用）。
- `npm test`（含 regression）全绿；冒烟测试全量通过；手工双模式逐功能验证一次。
- 清理全部警告/错误（控制台 + 日志）。
- **文档同步**（项目规则要求）：更新 `doc/功能需求文档.md`、`doc/开发进度.md`（跟踪表推进）、`doc/历史Bug记录.md`（如有回归）、`doc/设计文档.md`、`.hermes/*`、`doc/项目结构.md` 中目录结构，并同步 `AGENTS.md` 引用。

> **阶段6执行备注（2026-09-06）**：按现状保留 `js/app-editor-ctx.js`、`js/editor/editor-md.js` 作为 **Web（无插件）兜底**——插件加载器 `loadDirPlugins` 仅在桌面（`noteDesktop.plugins` 存在）加载 markdown-editor 插件，Web 版不加载插件，直接删宿主 md 文件会导致 Web 版编辑白屏。同时修正 `index.html` 加载顺序：`app-editor-ctx.js` 置于 `editor/*` 之前，使 `editor-ctx.js` 的 Provider 路由（含 `resolveEditorCtxSchema`）最后加载生效，桌面端真正经插件菜单、Web 端回退宿主菜单。对应的「严格删除宿主 md 文件」与「让 Web 也加载插件」两种收尾方案待用户裁定后可再收敛。

---

## 5. 假设与决策

- **行为等价优先**：所有拆分阶段均为「搬运 + 重分布」，不新增需求，不改交互，保证拆分前后运行一致。
- **插件多文件共享作用域**：采用「manifest.scripts 拼接为单段代码整体 `new Function` 执行」方案，保证各 feature 模块同闭包可互调，无需改 PluginAPI 签名。
- **宿主不再感知 Markdown**：宿主只提供目录区/tab/全屏编辑区宿主/侧边面板容器/空白右键；md 渲染、序列化、块编辑、双击块、代码块语言、链接/表格/脚注/数学等全部由 markdown-editor 插件承担。
- **src 顺序依赖**：editor-core 最先加载；host 依赖 app-note（renderMarkdown 迁入插件前暂借）与 noteStore/PluginAPI。
- **文件删除用 git 追溯**：app-editor.js / app-editor-ctx.js 直接删除，不做「保留引用桩」，避免死代码与维护负担（符合项目「不留 `// removed` 兼容桩」约定）。

---

## 6. 验证方式

1. `npm test`（含 regression.test.js）——全阶段回归门禁，必须通过。
2. `smoke-plugin.test.js`——编辑器增强冒烟（块后插入/表格3×3/末尾补行/链接等）迁移后保持通过。
3. 手工验证（本地 `start_rag.bat` / 桌面端）：目录区、正文区、侧边面板布局正常；每个功能（段/表/列/任务/代码/链接/标注/脚注/数学）分别在源码与所见即所得模式操作一致。
4. 控制台无报错无警告；`app.log` 无新增错误。
5. 将修改前后文件对比以 commit 形式呈现，便于逐条追溯。

---

## 7. 风险与对策

- **回归风险高**（大范围重分布）：以「等价重构 + 每阶段回归 + 每阶段提交」控险；出现问题可回退单阶段。
- **插件加载顺序/作用域共享**：用单元级拼码验证；先落地阶段1再继续。
- **往返一致性与既有测试**：`npm test` 往返用例为核心闸门，拆分后 keep green。
- **改动量大于常规单次开发**：建议按阶段推进、每阶段作为一个 commit，避免一次性大 diff。