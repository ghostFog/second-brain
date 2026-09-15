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

<!-- 后续 Markdown Editor 插件自身的功能点追加入上表（编号建议 MD-01、MD-02 …） -->