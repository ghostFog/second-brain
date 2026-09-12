# AGENTS.md — second-brain 工程级智能体规则

> 本文件是 second-brain 工程的【就近规则入口】：只承载该工程专属高频信息
> （模块结构速览、常用命令、编码规范引用）。
> 项目级导航与行为控制见根目录 AGENTS.md + doc/读取路由.md（懒加载，按需读取）。

## 就近优先

在 second-brain/ 内工作时，先读本文件，再按需读根路由 doc/读取路由.md；
本文件缺失或表述陈旧时，回退根 AGENTS.md + .hermes/ + doc/（权威正文为准）。

## 模块结构速览

- js/app-core.js —— 核心逻辑（应用初始化、全局状态与公共工具）
- js/app-note.js —— 笔记管理（笔记 CRUD、元数据）
- js/app-editor-ctx.js —— 编辑器上下文（当前笔记/编辑状态）
- js/app-graph.js —— 图谱视图（节点过滤、脉冲动画、节点详情）
- js/app-plugins.js —— 插件系统（市场、管理、扩展点调度）
- js/app-ai.js —— AI 问答前端（SSE 流式对话、嵌入检索）
- js/app-vault.js —— 库管理（库结构、库统计）
- js/app-layout.js —— 布局/路由（hash 路由 SPA，loadView 加载 views/*.html）
- js/app-ribbon.js —— Ribbon 导航（侧栏扩展点注册）
- js/app-toolbar.js —— 工具栏
- js/app-input.js —— 输入处理
- js/app-keybinds.js —— 快捷键绑定（命令面板触发）
- js/app-log.js —— 日志
- js/file-tree-ctx.js —— 文件树上下文
- js/theme-palettes.js —— 主题调色板
- js/editor/ —— 编辑器宿主模块（editor-core/host/tabs/filetree/sidepanel/md/ctx/vditor/wys-toolbar/format），
  编辑器能力由后缀对应插件按 Provider 契约接管
- js/settings/ —— 设置视图模块（settings-core/ai/appearance/shortcuts/plugins/panels/main，main 须最后引入）
- views/ —— 各 hash 视图页面（editor/graph/plugins/settings/ai）
- plugins/ —— 插件目录（markdown-editor / minimal-theme 等）
- main.js —— Electron 主进程（窗口、note:// 协议、IPC）；preload.js 暴露 window.noteDesktop
- ai-engine.js —— AI 引擎（主进程，本地 ONNX 嵌入/重排序）
- css/ —— base.css（Design Token）+ app.css（组件样式）
- regression.test.js / smoke-*.test.js —— 回归断言门禁与冒烟测试

## 常用命令（在 second-brain/ 目录内执行）

| 操作 | 命令 | 说明 |
| ---- | ---- | ---- |
| 回归断言门禁 | npm test | 已修 bug 的复现断言，提交前必须通过（node regression.test.js） |
| 启动桌面版 | npm start | electron .（也可双击 start-desktop.bat） |
| 打包 exe | npm run dist | electron-builder --win，产物在 second-brain/dist/，勿手动编辑 |

## 编码规范与测试规范

按需懒加载：@.hermes/coding-style.md（编码风格、命名、注释、开发与测试规范；本文件不内嵌全文）。

## 权威正文入口

设计/需求/进度/Bug 等权威正文按根路由懒加载：doc/读取路由.md（任务类型/模块 → 最小必读文件集）。