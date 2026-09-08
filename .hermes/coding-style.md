# 编码风格与开发测试规范

## 编码风格（强制）

**通用**

- 所有代码/注释使用中文；类、函数必须带注释，说明功能/参数/返回。

- 注释作者统一写 **火 冰**；shell/ps1 作者写 `huobing`。

- 消灭所有警告与错误；不留无用代码、未引用变量。

- 只做被要求的事：不扩散已测功能、不大面调整、不主动新增文档/文件。

**文件类型要点**

- `sh / ps1`：Unix 换行 LF；函数注释含功能说明、参数、返回值。

- `bat`：Windows 换行 CRLF。

- HTML：复用 Design Token 变量（`var(--note-*)`），不写死颜色。

- CSS：遵循 base.css 的 Token 体系；组件样式归入 app.css。

- JS：IIFE 包裹、`'use strict'`；全局多文件拆分场景下，可用每文件顶部 `'use strict';` 替代外层 IIFE 保障严格模式（参照 `js/app-*.js` 拆分约定）。

**桌面化约束**

- 渲染进程用 `contextIsolation:true, nodeIntegration:false`，禁止直接 require。

- 需 Node 能力走 `preload.js` + IPC，通过 `window.noteDesktop.*` 暴露。

- 第三方前端库必须本地化，禁止 CDN（保证离线可用）。

## 界面区域命名规范（UI 区域词典）

> 目标：为界面每个区域确定**统一中文名 + DOM 结构标识**，作为智能体与开发者的共同语言，
> 讨论需求、定位 bug、写代码引用时用同一套名字，避免「左侧那个栏」「右边面板」之类的歧义。

### 命名总则

- 各视图顶层容器一律用 `.view-row`；当前视图为 `.view.active`，视图内容统一注入 `#view-root`。

- 左右响应式栏：**左栏**一律 `resp-leaf`，**右栏**一律 `resp-sidebar`（可收起，拖拽条 `.tree-resizer` / `.side-resizer`）。

- 视图私有区域统一用 ID 标识，ID 带视图前缀 —— editor 用 `ed-*`、graph 用 `gd-*`/`graph-*`、ai 用 `ai-*`、plugins 用 `plugin-*`。

- AI 会话列表例外：用独立 `#ai-sidebar`（不再套 resp-leaf），因其收起/展开状态独立于通用响应式体系。

### 全局骨架（index.html）

| 区域中文名      | DOM                | 说明                                                                  |
| ---------- | ------------------ | ------------------------------------------------------------------- |
| 标题栏        | `header`           | 36px，含库选择器 `#vault-picker`、面包屑 `#crumbs`、搜索、`.window-controls` 窗口控制 |
| Ribbon 导航栏 | `nav.ribbon`       | 48px，按钮由 RibbonManager 动态渲染，设置按钮固定末位                                |
| 视图装载区      | `#view-root`       | 所有视图注入点                                                             |
| 命令面板       | `#palette-overlay` | ⌘P 呼出的覆盖层，列表 `#palette-list`                                        |
| 移动端底栏      | `.mobile-bar`      | 移动端面板开关                                                             |
| 视图模板缓存     | `#view-templates`  | 隐藏的视图模板注入容器                                                         |

### 编辑器视图（editor.html）

| 区域中文名        | DOM                         | 说明                                                                       |
| ------------ | --------------------------- | ------------------------------------------------------------------------ |
| 文件树（目录区）     | `aside.resp-leaf`           | `#file-tree`、搜索 `#file-search`、统计 `#vault-stat`/`#vault-size`            |
| 目录调宽条        | `#tree-resizer`             | 拖拽调左栏宽度                                                                  |
| Tab 栏 + 工具按钮 | `#editor-tabs-row`          | 单个 Tab `#editor-tabs`                                                    |
| 查找 / 替换条     | `#ed-findbar`               | Ctrl+F 查找、Ctrl+R 替换                                                      |
| 编辑滚动容器       | `#ed-split`                 | 唯一下方滚动容器，源码与预览同步滚动                                                       |
| 源码 / 所见即所得   | `#ed-pane-src`              | `#ed-edit`、`#ed-wysiwyg`、行号 `#ed-gutter`、当前行 `#ed-current-line`          |
| 分隔条          | `#ed-split-sep`             | 源码与预览之间的竖向分隔                                                             |
| 预览           | `#ed-pane-prev`             | `#ed-preview`                                                            |
| 当前笔记索引       | `#ed-index-panel`           | 工具栏「查看索引」展开/收起                                                           |
| 状态栏          | 编辑区底部 `h-7`                 | 保存状态、光标位置、字数等                                                            |
| 侧边面板         | `#right-panel.resp-sidebar` | 文件属性 `#ed-fileprops`、大纲 `#ed-outline`、反向链接 `#ed-backlinks`、标签 `#ed-tags` |
| 侧栏调宽条        | `#side-resizer`             | 拖拽调右面板宽度                                                                 |

### 图谱视图（graph.html）

| 区域中文名 | DOM                  | 说明                                                         |
| ----- | -------------------- | ---------------------------------------------------------- |
| 过滤面板  | `aside.resp-leaf`    | `#graph-tags` 标签过滤、连接深度、节点类型、重置                            |
| 图谱画布  | `#graph-canvas`      | `#graph-svg` 连线 `#graph-links`、节点 `#graph-nodes`，图例/缩放提示浮层 |
| 节点详情  | `aside.resp-sidebar` | `#gd-name`、基本信息 `#gd-basic`、`#gd-tags`、连接 `#gd-links`      |

### 设置视图（settings.html）

| 区域中文名 | DOM                 | 说明                                                            |
| ----- | ------------------- | ------------------------------------------------------------- |
| 设置分类  | `aside.resp-leaf`   | 分类项 `.settings-cat`，如「外观」「编辑器」…                               |
| 设置内容  | `#settings-content` | 分组 `.settings-group`，标题 `#settings-title`、副标题 `#settings-sub` |

### AI 问答视图（ai.html）

| 区域中文名 | DOM                       | 说明                                            |
| ----- | ------------------------- | --------------------------------------------- |
| 会话列表  | `#ai-sidebar`             | 会话数 `#ai-session-count`、列表 `#ai-session-list` |
| 顶部工具栏 | 主列顶部 `h-12`               | 状态 `#ai-status`、索引库下拉 `#ai-index-dd`、新建会话     |
| 对话区   | `#ai-chat`                | 消息列表滚动区                                       |
| 底部输入区 | 主列底部 `px-4 py-3 border-t` | 模型 `#ai-model`、输入框 `#ai-input`、发送按钮           |

### 插件市场视图（plugins.html）

| 区域中文名  | DOM                           | 说明                                                            |
| ------ | ----------------------------- | ------------------------------------------------------------- |
| 插件头部   | 顶部 `px-6 py-4 border-b`       | 搜索 `#plugin-search`、排序 `#plugin-sort`、分类 chip `#plugin-chips` |
| 插件网格   | `#plugin-grid`                | 卡片网格                                                          |
| 插件详情抽屉 | `#plugin-drawer.resp-sidebar` | 右侧折叠抽屉                                                        |

## 开发流程标准动作

1. 开始任务先读根目录 `AGENTS.md`，按其指引读取 `.hermes/` 相关文件。
2. 功能变更前必须先读 `.hermes/design.md` 与对应设计稿，明确视觉与交互目标。
3. 只测本次新增/修改的功能，不回归稳定部分。
4. 修改文件后在回复中展示**修改前后对比**，确认后再写入。

## 测试规范

- 桌面版：`second-brain` 内 `npm start`（electron）验证。

- 网页版：`start-server.bat` 起 http server 验证。

- 打包：`npm run dist`，产物在 `second-brain/dist/`。

- 测试新增/修改功能；**一次性诊断/临时断言脚本**测完即删除，不残留；**回归断言脚本**（`regression.test.js`）作为防再犯基础设施**保留**，提交/发布前执行 `npm test` 作为门禁。

- 打包后 exe 需实际启动验证（进程存活）而非仅看产物存在。

