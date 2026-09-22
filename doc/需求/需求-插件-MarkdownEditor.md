# 第二脑 · 需求文档：Markdown Editor 插件

> 归属：单个插件功能需求登记于此；插件市场/插件体系能力见 `需求-插件.md`（PL-）。编号前缀 `MD-`。
> 编号延续进度侧 `进度-插件-MarkdownEditor.md`（MD-01/MD-02 已完结）。本文件登记 MD-02~MD-08：MD-02 = 插件增强化、MD-03 = 文件拖拽临时打开（**与编辑界面 ED-49 及原 MD-03b「最近打开」持久化子项合并为同一需求**，读取与最终写盘由主进程承担）、MD-04/05 = 链接数据管理 / 图片附件上传、MD-06 = 表格列宽、MD-07 = 大纲浮层、MD-08 = 编辑器宽屏模式 + 表格 100%（新需求）。

- 插件目录：`plugins/markdown-editor/`，当前 manifest 版本 `1.0.0`
- 能力：注册 `.md`/`.markdown` 后缀，提供 编辑（源码/所见即所得）、预览、分屏 打开方式，工具按钮与右侧边面板
- 该插件的基础能力由「编辑器能力插件化」承载（`需求-插件.md` PL-14）

| 编号 | 功能点 | 说明 | 交互 |
| ---- | ---- | ---- | ---- |
| MD-02 | 插件增强化（宿主薄壳委托） | 将 markdown 专属逻辑迁入 `plugins/markdown-editor/`：① **往返序列化**（`md-serialize.js`：`inlineToMd`/`domToMd`）；② **代码块语言选择器 + WYSIWYG 块编辑**（`md-blocks.js`：语言 chip/下拉/应用、块选中/清空/光标归位/末尾补空段）；③ **右键插入与上传**（`md-context.js`），配套样式归入插件 `styles.css`；宿主 `editor-md.js`/`editor-vditor.js`/`app-editor-ctx.js` 收口为薄壳委托（`window.sbMdBridge.*`），网页版回落宿主薄壳兜底 | 桌面版加载目录插件：插件以 Provider + 增强代码承接编辑能力；网页版回落宿主薄壳，基础编辑可用、上传仅桌面版支持 |
| MD-03 | 文件拖拽临时打开（合并编辑界面 ED-49 · 原 MD-03b，原 ED-46） | 支持将外部文件拖拽到应用窗口，作为**临时文件**打开（不纳入知识库正式目录/不写盘到笔记库/不建索引）；打开后**打开或切换到「临时文件目录区」**用于集中查看与管理。**单页签只读**：仅打开一个页签，切到该页签时目录区取消选中、侧边面板各块显示空数据（不再当前窗口知识库文件系统中）；当前知识库**不记录**该页签（重开知识库仍按库自身记录恢复，无则第一批笔记）。**全局「最近打开」二级**：库下拉新增「最近打开」二级，跨知识库全局共享（记录随软件，其他知识库窗口也能看到），展示最近打开的临时文件最多 10 条 | 拖拽文件到窗口即打开为唯一临时页签（只读），并聚焦/切换到「临时文件」目录区；临时文件状态下侧边面板显示空数据、目录区取消选中；库下拉「最近打开」二级点击该文件临时打开；红 × 关闭临时页签｜**合并口径（2026-09-22）**：本项与编辑界面 ED-49、原 MD-03b 为**同一需求**——拖拽到编辑界面 tab 栏，若是 `.md/.markdown` 文档交由本插件展示/编辑，**读取文件与最终落盘由主程序承担**（`notes:readFileExternal` 读 / `notes:writeFileExternal` 写） |
| MD-03b | 临时文件「最近打开」持久化 ※已并入 MD-03 | 拖拽临时打开的文件按全局（跨知识库）记录去重置顶，最多保留 10 条；当前知识库的页签记录（recent.json）**不写入**临时文件；重开知识库时恢复最后一个普通文件或第一批笔记 | 库下拉「最近打开」二级读取全局临时文件历史；临时文件页签关闭时从普通页签恢复 |
| MD-04 | 链接/反向链接数据管理（原 ED-47） | 反向链接管理使用笔记**完整路径**；识别并区分两类链接语法：单括号 `[text](路径)`（普通链接）与双括号 `[[路径]]`（笔记内链/反向链接），二者结构类似、仅开头分隔符不同；扫描笔记正文解析后建立**链接索引数据**（含来源/目标路径、链接类型，按完整路径归一），**目标为本知识库内其他笔记时记录正/反向链接关系**，供**侧边面板「反向链接」**与**图谱视图**共同读取渲染。**链接点击三模式兼容**（`md-linknav.js`）：WYSIWYG/预览模式链接为标准 `<a href>` → `closest('a[href]')` 命中；IR 模式链接为 `<span data-type="a">` 内含 `.vditor-ir__marker--link`（URL 在 textContent）→ `closest('[data-type="a"]')` 检测，展开编辑状态（`vditor-ir__node--expand`）不触发导航；SV 模式链接为纯文本 `<textarea class="vditor-sv">` → 从 `selectionStart` 经 `parseLinkAtPos` 解析 `[text](url)`/`[[wiki]]`，非链接位置放行（正常定位光标） | 笔记创建/编辑/删除/移动时增量更新链接索引；侧边「反向链接」按完整路径聚合显示引用当前笔记的其他笔记，图谱视图按该索引建边；**链接点击打开方式判断**：点击笔记内链接时，若目标指向本知识库内其他笔记（内部链接），按打开笔记方式跳转（复用文件树打开笔记逻辑），否则按外链/资源链接处理。三模式统一走 `handleLink` → `findNoteByLink` → `openNote` |
| MD-05 | 图片/附件上传（原 ED-48） | vditor 工具栏新增 **upload** 按钮，`accept` 覆盖 `image/*` 与 `.pdf/.doc/.docx/.xls/.xlsx/.ppt/.pptx/.html/.htm/.md/.txt/.sh/.bat/.cmd/.ps1/.csv/.zip/.rar/.7z/.asc`；支持多选、单文件 ≤50MB。上传经桌面端 IPC `notes:uploadResource` 落盘到库根 `.resources`（UUID 命名保留扩展名），返回 `note://vault_res/<uuid.ext>`；**图片**按真实名插入 `![名](url)`（编辑/预览行内展示），**附件**插入为 Obsidian 风格卡片引言 `> [!attach] 名 url`（编辑区显示醒目指示块、预览/阅读渲染完整卡片）。`note://` 协议新增 `vault_res` 主机路由 → `.resources`；`.resources` 在 walkNotes/scanVaultMeta 中跳过（`.` 开头且被排除，文件树不可见）。附件链接点击经捕获阶段拦截，调 `notes:openResource` 用系统默认程序打开，避免窗口整体导航 | 编辑器工具栏点 **upload** 选择图片/附件 → 自动落盘并在光标处插入；图片行内展示、附件卡片展示，均可点击/右键下载；网页版无桌面桥接时提示「上传仅桌面版支持」 |
| MD-06 | 表格列宽设定与拖拽调整 | 依据表格第二行分隔符 `| ---- | ---- |` 中每列的 `-` 个数计算该列百分比宽度（`-` 越多列越宽，按各列 `-` 个数占比分配）；编辑器内渲染**表格宽度 100%**、**`td` 内容自动换行**（列宽按固定值计算，不因内容撑破）；支持**拖拽调整列宽**，拖动列边框改变列宽后按新宽度**重算该列 `-` 个数**并回写 Markdown 分隔行 | 拖拽列边界调整宽度，松手后按新宽度重算各列 `-` 个数并写回分隔行；渲染时按分隔行 `-` 个数等比例分配表格宽度（100%） |
| MD-07 | 大纲移至 vditor 浮层 + 快捷键 | 大纲不再占用宿主右侧边面板（移除 sidebar 的 outline 项）；Markdown Editor 插件新增命令「显示大纲」(`mde-outline`，默认快捷键 `Ctrl+Shift+Q`)，经宿主 `window.vdToggleOutline` 切换大纲**浮层**。浮层为宿主在编辑区右侧自研面板（`editor-vditor.js` sb-outline-*），树状列出当前编辑内容的标题层级；**点标题跳转到正文**、**父级标题可折叠/展开子级**；纯 SV 源码模式不可用（等价 vditor 原生禁用） | 按 `Ctrl+Shift+Q` 或命令面板/工具栏「大纲」按钮触发即可展开/收起大纲浮层，点标题项跳转到正文对应标题处，点标题行的折叠箭头收放其子级目录 |
| MD-08 | 编辑器宽屏模式 + 表格 100%（功能与按钮均归插件） | Markdown Editor 插件承载「宽屏模式」功能与按钮：给 `html/body` 挂 `ed-wide` 类（由插件 `styles.css` 将编辑区 body 强制宽度 100%、清除水平版心/居中留白），开启态记忆（键 `sbWide`，兼容既有设置）；**表格默认宽度 100%**（vditor 自带 `.vditor-reset table{display:block}` 会横铺溢出，插件样式改回 `display:table` + 单元格 `word-break`，保证表格始终占满编辑区宽度且不产生横向滚动，不做容器滚动）。工具按钮经宿主页签栏 `#ed-plugin-wide-slot` 注入槽由插件渲染（`data-action="mde-widescreen"`，图标用左右箭头 `move-horizontal`，区别于全屏），命令面板命令「切换编辑器宽屏模式」（`mde-widescreen`）；宿主 `loadView` 重建编辑视图 DOM 时插件用 `MutationObserver` 重注入按钮并按记忆恢复。**宽屏铺满修复**：vditor 在 IR 模式会给编辑区 `pre.vditor-reset` 内联 `padding:10px 35px`、预览给 `.vditor-reset` 内联 `max-width:800px`（inline 样式，普通样式表盖不掉），宽屏下需用 `!important` 统一覆盖为 `padding:0 8px` + `max-width:100%`，否则内容向内挤压、预览仍被 800px 限制 | 点页签栏「宽屏」按钮或命令面板「切换编辑器宽屏模式」切换编辑内容是否铺满 100% 宽度，开启态按钮高亮、持久记忆、重启/切回编辑器视图自动恢复；宽屏下 IR/所见即所得/预览内容均铺满且表格不溢出 |
## Vditor 三模式兼容规则

> Markdown Editor 插件涉及编辑区交互的功能必须同步支持 Vditor 三种编辑模式，不能只适配单一模式。

### 三模式 DOM 结构差异

| 模式 | 容器 | 链接 DOM | 块级元素 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| **WYSIWYG** | `.vditor-wysiwyg` | `<a href="url">text</a>` | `<div class="vditor-wysiwyg__block" data-block="0" data-type="...">` | 所见即所得，渲染为最终 HTML，标准 `<a href>` |
| **IR** | `.vditor-ir` | `<span class="vditor-ir__node" data-type="a"><span class="vditor-ir__marker--link">url</span>...</span>` | `<div class="vditor-ir__node" data-type="...">` | 即时渲染，保留 Markdown 语法标记，链接非 `<a>` 而是 `<span>` |
| **SV** | `.vditor-sv`（`<textarea>`） | 纯文本 `[text](url)` / `[[wiki]]` | 无渲染 | 源码模式，纯文本编辑，无渲染 DOM |

### 链接点击三模式处理规则（`md-linknav.js`）

1. **WYSIWYG/预览**：`closest('a[href]')` 命中 → `a.getAttribute('href')` 取 URL
2. **IR**：`closest('[data-type="a"]')` 命中 → `querySelector('.vditor-ir__marker--link').textContent` 取 URL；`vditor-ir__node--expand` 类表示展开编辑状态，不触发导航
3. **SV**：`e.target.tagName === 'TEXTAREA'` + `classList.contains('vditor-sv')` → `parseLinkAtPos(text, selectionStart)` 从源码解析链接；非链接位置放行（正常定位光标编辑）

### 通用开发规则

- 涉及编辑区事件委托的功能，**必须同时检测三模式的 DOM 选择器**，不能只查 `<a href>`
- IR 模式的类名前缀为 `vditor-ir__`，块级元素用 `data-type` 属性标记类型
- SV 模式是 `<textarea>`，无渲染 DOM，需从 `value` + `selectionStart` 解析源码
- Vditor 默认 `link: { isOpen: true }`，IR 点击未拦截时走 `window.open` → 被主进程 `setWindowOpenHandler` deny 兜底阻止 → 无效果；必须在捕获阶段先拦截