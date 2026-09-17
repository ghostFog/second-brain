# Markdown Editor 插件 · 已完结进度

> 归属：单个插件功能归档。插件框架/规范功能见 `进度-插件.md`（开发进度入口见 `../开发进度.md`）。

- 插件目录：`plugins/markdown-editor/`，当前 manifest 版本 `1.0.0`
- 能力：注册 `.md`/`.markdown` 后缀，提供 编辑（源码/所见即所得）、预览、分屏 打开方式，工具按钮与右侧边面板
- 该插件的基础能力由框架「编辑器能力插件化」承载（`进度-插件.md` PL-14），市场排序见 PL-15
- 独立的单插件功能点登记见下方表格

| 编号 | 功能点 | 功能点详情 | 状态 | 开始时间 | 完成时间 | 记录 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| MD-01 | 代码块语言选择器 | WYSIWYG 插入代码块时直接插入一个只有单个空白行的空代码块（不再弹语言输入框）；单击代码块在右下角显示语言 chip（空语言显示 text），点击弹出带搜索框的语言下拉，可输入关键词筛选常用语言（按名称/别名命中并加权排序）；选择后同步 data-lang、code-lang 标签与 markdown | 测试完成 | 2026-09-06 | 2026-09-06 | 逻辑在宿主编辑器（app-editor.js 语言选择器、app-editor-ctx.js 空块插入），随 MarkdownEditor 插件归口；冒烟测试新增 12 断言（filterCodeLangs 筛选 + 选择器应用） |
| MD-02 | 插件增强化（宿主薄壳委托） | 插件从「声明外壳」重构为编辑器增强：把 markdown 专属实现代码迁入插件——`md-serialize.js`（往返序列化）、`md-blocks.js`（代码块语言选择器 + WYSIWYG 块编辑）、`md-context.js`（右键插入/上传）、`styles.css`（配套样式）；宿主收口为薄壳委托（`window.sbMdBridge`，网页版回落兜底）；`main.js` 先注册 Provider 再注册命令，`manifest.json` 声明 scripts/styles | 完成 | 2026-09-12 | 2026-09-12 | 见 `进度-知识库.md` ED-49（同一次增强的编辑器侧记录）；回归 **137 通过、0 失败** |
| MD-05 | 图片/附件上传（原 ED-48） | Markdown Editor 编辑器支持上传「图片+附件」：vditor 工具栏新增 upload 按钮，上传落盘到 `.resources`（UUID 命名保留扩展名），图片插 `![名](url)`、附件插 `> [!attach] 名 url` 卡片引言；`note://` 协议 `vault_res` 路由 → `.resources`；附件点击经捕获拦截调 `notes:openResource` 用系统默认程序打开；`.resources` 在 walkNotes/scanVaultMeta 跳过 | 测试完成 | 2026-09-11 | 2026-09-11 | 见原 `进度-知识库.md` ED-48 归档记录（已迁出本文件）；交互增强含拖拽上传/右键插入/Obsidian 附件卡片语法；回归 124 通过 |
| MD-06 | 表格列宽模式切换按钮 | 在 Markdown Editor 编辑器**主工具栏**（editor-tabs-row）新增「列宽模式」按钮：`sbTableAuto` 记忆键持久化「按内容宽度显示（table-layout:auto）」/「固定宽度展示」，供 `html.fe-table-auto` 类切样式；固定宽度时样式表对 `.vditor-reset table th/td` 强制 `white-space:normal` 覆盖 vditor 自带 nowrap 实现自动换行避免横向溢出；按钮经 `MutationObserver` 监听 `#ed-plugin-wide-slot` 注入并随记忆恢复/高亮；修复 `mdeWideObserve()` 调用时机（移动文件末尾）避免 `mdeTableKey` TDZ 导致宽屏功能失效 | 测试完成 | 2026-09-16 | 2026-09-16 | 与 MD-08 宽屏共用同一注入槽与观察器；npm test 通过 |
| MD-09 | 编辑器查找/替换（Ctrl+F 查找、Ctrl+R 替换） | vditor 4.0 无内置查找条，宿主旧实现已随 `#ed-edit` textarea 退役失效。在 `editor-vditor.js` 实现统一查找替换（函数 `vd` 前缀，`window.vdFindbar` 导出 open/close/refresh）：sv 用 textarea value + setSelectionRange，ir/wysiwyg 用 TreeWalker 文本节点 + Range 映射跳转，替换走 execCommand 触发 input 回传宿主；findbar DOM 放 `#ed-vditor` 外（`#ed-vditor-find`，复用 app.css `.ed-findbar/.show-replace`）不受 vditor 重建清空；document keydown 绑定 Ctrl+F/Ctrl+R（`e.isComposing` 防中文输入法误触发，焦点在编辑器外放行系统查找；Esc 关闭沿用宿主 `findOpen`/`closeFindbar`）。宿主 `editor-host.js` 删除失效实现改为薄转发（保留 openFindbar/closeFindbar/runFind 函数名与 findOpen 布尔）。UI 复用无需改 CSS | 测试完成 | 2026-09-17 | 2026-09-17 | 回归新增 testFindbar 3 条断言，**216 通过、0 失败**；node --check 语法通过 |
| MD-08 | 编辑器宽屏模式 + 表格 100%（功能与按钮均归插件） | 功能与工具按钮均迁入 Markdown Editor 插件：插件 main.js 实现 `mde-widescreen`（挂 `html/body.ed-wide`，记忆键 `sbWide`，命令面板 action + `MutationObserver` 监听 `#ed-plugin-wide-slot` 注入槽渲染「宽屏」按钮并在宿主 loadView 重建编辑视图 DOM 时重注入 + 按记忆恢复 + 按钮高亮）；插件 styles.css 迁入宽屏（`html.ed-wide` 编辑区宽度 100% + 清水平留白）与表格 100%（`.vditor-reset table{display:table}` + 单元格 `word-break`，不横向溢出、不做容器滚动）样式；宿主移除硬编码按钮/绑定/命令/CSS。**修复**：vditor 在 IR 模式给 `pre.vditor-reset` 内联 `padding:10px 35px`、预览给 `.vditor-reset` 内联 `max-width:800px`（inline 样式普通样式表盖不掉），宽屏下统一 `!important` 覆盖 `padding:0 8px` + `max-width:100%`，避免内容向里挤、预览受限 800px；按钮图标改为左右箭头 `move-horizontal`（区别于全屏） | 测试完成 | 2026-09-17 | 2026-09-17 | npm test 179 + 冒烟 122 通过，UI 待手动验证 |

<!-- 后续 Markdown Editor 插件自身的功能点追加入上表（编号建议 MD-01、MD-02 …） -->