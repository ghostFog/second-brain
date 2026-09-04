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

## 开发流程标准动作

1. 开始任务先读根目录 `AGENTS.md`，按其指引读取 `.hermes/` 相关文件。
2. 功能变更前必须先读 `.hermes/design.md` 与对应设计稿，明确视觉与交互目标。
3. 只测本次新增/修改的功能，不回归稳定部分。
4. 修改文件后在回复中展示**修改前后对比**，确认后再写入。

## 测试规范

- 桌面版：`second-brain` 内 `npm start`（electron）验证。

- 网页版：`start-server.bat` 起 http server 验证。

- 打包：`npm run dist`，产物在 `second-brain/dist/`。

- 测试新增/修改功能；自动化断言脚本测完即删除，不残留。

- 打包后 exe 需实际启动验证（进程存活）而非仅看产物存在。

