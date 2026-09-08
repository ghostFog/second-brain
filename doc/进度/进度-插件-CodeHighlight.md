# Code Highlight 插件 · 已完结进度

> 归属：单个插件功能归档。插件框架/规范功能见 `进度-插件.md`（开发进度入口见 `../开发进度.md`）。

- 插件目录：`plugins/code-highlight/`，当前 manifest 版本 `1.0.0`
- 能力：代码语法高亮（180+ 语言），复制按钮；行号已移除

| 编号 | 功能点 | 功能点详情 | 状态 | 开始时间 | 完成时间 | 记录 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| PL-17 | Code Highlight 取消行号 | 移除 Code Highlight 插件「显示行号」设置项：代码块不再渲染行号列，删除右键「切换行号」菜单与 toggle-lineno action | 测试完成 | 2026-09-06 | 2026-09-06 | plugins/code-highlight/main.js 删除 LS_LINENO/config.lineno/行号列构建/applyConfig 行号切换/loadConfig 行号读取/toggle-lineno；manifest.json 删除 lineno 设置项与右键「代码: 切换行号」、desc 更新；styles.css 删除 .ch-lineno-col/.ch-content-col/.ch-no-lineno，code 改 display:block 直铺；jsdom mock hljs 验证：无行号列、高亮直接渲染、toggle-lineno 已移除、toggle-copybtn 保留，全部通过；node --check + manifest JSON 解析通过 |