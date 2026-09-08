# Minimal Theme 插件 · 已完结进度

> 归属：单个插件功能归档。插件框架/规范功能见 `进度-插件.md`（开发进度入口见 `../开发进度.md`）。

- 插件目录：`plugins/minimal-theme/`，当前 manifest 版本 `1.0.0`
- 能力：极简主题包，支持 纸白/亚麻/冷灰/墨绿 4 套内置配色与整套可调的自定义主题，顶栏按钮悬浮弹出主题列表

| 编号 | 功能点 | 功能点详情 | 状态 | 开始时间 | 完成时间 | 记录 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| PL-18 | Minimal Theme 自定义配色 + 顶栏悬浮列表 | Minimal Theme 支持整套配色可调的自定义主题；顶栏主题按钮悬浮弹出可用主题列表 | 测试完成 | 2026-09-06 | 2026-09-06 | plugins/minimal-theme/main.js 重构：新增 getSetting/readCustomColors/buildCustomVars/applyCustomVars/clearCustomVars（自定义主题以 body 内联 CSS 变量注入 8 项可调色值 + 派生全量变量）、applyTheme 增加 'custom' 分支与 silent 参数（启动静默恢复）、mapDefaultToId 把「默认配色方案」下拉值映射为 id；顶栏悬浮：watchToolbar 用常驻 MutationObserver 按元素去重重绑按钮（兼容 ToolbarManager.render 重建 DOM），悬浮弹出 .mt-theme-dropdown 列表（停用/纸白/亚麻/冷灰/墨绿/自定义配色，点击应用并关闭，受 hoverToolbar 开关控制）；监听 plugin-setting-changed 实时重套自定义色值/套用默认配色。host 侧 app-settings.js renderSchemaForm 新增 type:"color" 原生取色器分支（向后兼容，value 存 HEX）。manifest.json 新增 apply-custom 命令、defaultTheme 选项「自定义配色」、8 项 color 设置字段（cBg/cCard/cSurface/cBorder/cInk/cInk3/cLine/cBrand）。smoke-plugin.test.js 新增 color 取色器渲染断言 + 隔离 dom 注入最小主题插件验证（加载无异常/apply-custom 注册/悬浮弹列表/自定义套用写内联变量/停用清除），并校正陈旧断言「基本设置」→「基本信息」与 ST-23 一致；smoke 34/34、回归 5/5、node --check 全过 |