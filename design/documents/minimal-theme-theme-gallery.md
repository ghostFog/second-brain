# 计划：minimal-theme 插件「主题画廊」圆形展示 + 添加/编辑/删除

## 一、需求概述（来自用户）

把插件在「设置→插件管理→展开最小主题→插件设置」区块的现有**平铺字段**，改为**圆形主题墙**：

- 每个主题项 = 圆形色块（显示该主题背景色 + 边框色）+ 下方主题名；
- 内置主题名后带「（默认）」；当前正在使用的主题用「高亮边框」标识；
- 提供「添加」按钮 → 弹出弹框，含「主题名称」+ 13 个配置字段；
- 添加完成后同样显示为圆形色块 + 名称（名称**不带**（默认））；
- 内置（带默认）主题：双击弹框→**只读查看**，不可编辑；
- 用户添加的主题：双击弹框→**可编辑**，且需支持**删除**。

分类确认：
- **公共设置**（保持为平铺 schema 行，不属于某个主题）：`injectCss`（同步宿主配色到编辑器）、`hoverToolbar`（顶栏按钮悬停展示主题列表）；`defaultTheme`（启动默认配色）也保留为公共。
- **每个主题的配置**（弹框内）：主题名称 + 13 个配置字段；用户点选范围 = 8 个颜色字段 + `--note-surface-2`、`--note-ink-2`、`--note-gutter-bg`、`--note-ring`、`--note-muted-foreground` + 自定义CSS `extraCss`。

## 二、当前状态分析（已核实）

- 设置页由宿主 [app-settings.js](file:///d:/project/aiCode/second-brain/second-brain/js/app-settings.js#L1270-L1295) 的 `renderSchemaForm` 按 manifest `settings` 平铺渲染；支持 toggle/select/color 兜底 text。
- 插件 manifest [manifest.json](file:///d:/project/aiCode/second-brain/second-brain/plugins/minimal-theme/manifest.json) 现在只有**单一** `custom` 自定主题，8 个颜色字段平铺 + 公共设置；无 per-theme 的 surface-2/ink-2/gutter-bg/ring/muted-fg。
- 数据模型：`applyTheme` / `normalizeId` 只认内置 `1-4` 与单个 `custom`；`buildCustomVars` 把 8 色映射到全套 `--note-*`。
- 内置配色值在 `window.SB_PALETTES.BUILTIN`（[theme-palettes.js](file:///d:/project/aiCode/second-brain/second-brain/js/theme-palettes.js)）。
- 弹框/遮罩可复用现有模式：`app-settings.js` 的 `ai-model-overlay`（`fixed inset-0 z-50` 遮罩 + 居中卡片 + 保存/取消）。
- 插件设置持久化：`localStorage` key `plugin:minimal-theme:<key>`，写入选 `PluginAPI.setSetting` 并派发 `plugin-setting-changed`。
- 插件已有 MutationObserver 注入模式（`watchToolbar`），可从宿主设置 DOM 中定位本插件设置区块。
- 无独立 modal API；`window.toast` / `showToast` 可用于提示。

## 三、核心架构决策

1. **UI 靠插件自注入，不改宿主设置渲染器**。
   `renderSchemaForm` 是通用渲染器，不宜塞主题专属逻辑。插件用 MutationObserver 找到自己的「插件设置」区块，把 per-theme 字段行隐藏，并插入「主题画廊 + 添加按钮」。这样宿主零改动，符合插件注入既有模式。

2. **数据模型从「单 custom」扩展为「多自定义主题列表」**。
   新增统一「主题配置」字段 schema（命名 TSCHEMA），内置主题从 `SB_PALETTES.BUILTIN` 取值，自定义主题存 localStorage。
   - 自定义主题列表持久化到 `localStorage['plugin:minimal-theme:customs']`（JSON 数组 `{ id, name, fields }`）。
   - 迁移：旧单 custom 的 `cBg..cBrand/extraCss` 若存在则合并为第一个自定义主题，避免既有配色丢失。

3. **主题 id 规则**：内置 `1-4` 保留；自定义主题 id 用 `c1, c2, …`（自增，按已存 customs 推导下一个）。`applyTheme`/`normalizeId`/`cycleTheme`/`themeName` 需支持任意自定义 id。

## 四、具体改动

### 1) `plugins/minimal-theme/main.js`（主要逻辑）

**A. 统一主题配置 schema `TSCHEMA`**（弹框字段，14 项）：
`name(主题名称)` + 颜色字段：`cBg`(背景色)、`cCard`(卡片背景)、`cSurface`(表面/弹层)、`cBorder`(边框/输入)、`cInk`(主文字)、`cInk3`(次要文字)、`cLine`(分隔线)、`cBrand`(强调色)、`cSurface2`(--note-surface-2)、`cInk2`(--note-ink-2)、`cGutterBg`(--note-gutter-bg 行号列)、`cRing`(--note-ring 强调环)、`cMutedFg`(--note-muted-foreground) + `cExtraCss`(自定义编辑器CSS)。
内置主题：从 `SB_PALETTES.BUILTIN[id]` 读取对应值（surface-2/gutter-bg/ring/muted-fg/ink-2 若 BUILTIN 缺失则用默认近似值）；extraCss 空。新增这些键到 manifest settings（见下）以便持久化/默认初始化。

**B. 自定义主题存储**
- `readCustoms()`：解析 `localStorage['plugin:minimal-theme:customs']`，含一次性迁移旧单 custom。
- `writeCustoms(list)`：写 JSON + `syncEditorTheme()`。
- 每个自定义主题 id 生成 `c` + `(max+1)`。

**C. `buildCustomVars(fields, name)`** 扩展为按 13+extraCss 字段生成全套 `--note-*`（新增 surface-2/ink-2/gutter-bg/ring/muted-fg 映射）。

**D. 主题画廊注入**
- `injectGalleryInSettings(root)`：在设置 DOM 中找到本插件设置区块（含 `data-pid="minimal-theme"` 的容器），把 per-theme 字段行（`data-pkey` ∈ TSCHEMA 且非公共）设置 `display:none`，并在区块顶部插入：
  - 标题「主题」+「添加」按钮；
  - 主题列表：内置 4 + 自定义 N，每个 = 圆形色块（`border-radius:50%`，背景 = 该主题 cBg，边框 = 该主题 cBorder 2px；当前使用主题加高亮 ring/粗边框）+ 名字（内置名 +「（默认）」）。
- MutationObserver 监听容器重建（切分类/重开设置会重渲染），重建后重新注入。

**E. 弹框（遮罩，复用 `ai-model-overlay` 样式）**
- `openThemeDialog(theme, {readonly})`：
  - 标题「添加主题 / 编辑主题 / 查看主题」；
  - 主题名称输入（readonly 时禁用）；
  - 13 个颜色字段逐一 color picker + 自定义CSS textarea（EDITABLE 专属，readonly 禁用）；
  - 按钮：取消 / 保存；自定义主题在编辑态额外显示「删除」；
  - 保存：校验名称非空、不重名 → 写入 customs（新增或更新）→ 刷新画廊 → 若当前在用该主题则重套配色 + `syncEditorTheme`。

**F. 交互绑定**
- 单体块点击 → `applyTheme(id)` 应用；当前项切换高亮。
- 双击单体块 → `openThemeDialog`：内置 readonly=true；自定义 readonly=false。
- 「添加」→ 空模板 readonly=false。
- 删除 → 确认后移除，重套剩余/默认。

**G. 联动既有逻辑**
- `normalizeId`：内置 `1-4` 原样；自定义 id 保留；其余 `'0'`。
- `themeName(id)`：内置查表；自定义查 customs；兜底原名。
- `cycleTheme` 列表 = 深/浅/跟随 + 内置4 + 自定义N。
- `applyTheme`：内置走 `applyBuiltinVars`；自定义查 customs 并 `applyCustomVars(fields)`。
- 画廊当前态由 `activeThemeId()` 判定。

### 2) `plugins/minimal-theme/manifest.json`
- 新增 per-theme 字段：`cSurface2`、`cInk2`、`cGutterBg`、`cRing`、`cMutedFg`（type=color，含默认值），使 persisted/初始化一致（插件隐藏其平铺行，仅弹框用）。
- 保留公共设置 `defaultTheme`(select)、`hoverToolbar`(toggle)、`injectCss`(toggle) 平铺显示。
- 其余 8 个颜色字段 + `extraCss` 保留声明（插件在画廊中隐藏其平铺行）。
- `defaultTheme` 的 options 需含全部内置名 + 动态自定义名（实现上：宿主静态 options 只含内置；自定义名由插件在画廊重构时同步更新该 select 的 options）。

### 3) `plugins/minimal-theme/styles.css`
- 主题画廊 / 圆形色块 / 高亮边框 / 添加按钮 / 弹框结构样式（用 CSS class 而非内联，便于维护与测试识别）。

### 4) 测试
- `smoke-plugin.test.js`：新增断言验证——TSCHEMA 含 14 项、customs 迁移、画廊注入逻辑函数存在、`openThemeDialog` 存在、多自定义周期列表长度正确。
- `regression.test.js`：如有可确定性断言（如 `normalizeId` 对自定义 id 返回原样、`themeName` 支持自定义）。
- 订阅确认：`plugin-setting-changed` 处理需兼容新自定义字段 key（除公共外不覆盖逻辑）。

## 五、职责边界 / 不做什么

- 不改宿主 `app-settings.js` 渲染器（除必要时不新增宿主 API）。
- 不改宿主「外观-主题模式」的三态模式。
- 只改 minimal-theme 插件及其 manifest/styles/测试；不动其他插件。
- 公共设置（injectCss/hoverToolbar/defaultTheme）保持平铺行为，不并入弹框。

## 六、验证步骤

1. `npm test`：全部既有 + 新增断言通过。
2. 手动（`npm run` 起服务后）：
   - 设置→插件管理→展开最小主题：看到圆形主题墙，内置 4 名带（默认），当前使用项高亮。
   - 点「添加」弹框填名称+改色保存 → 新圆块出现且无（默认），点击可应用。
   - 双击内置 → 只读查看；
   - 双击自定义 → 可编辑/删除；改名、改色后应用正确。
   - 顶栏悬浮列表能看到新增自定义主题并可循环切换；编辑器配色随应用主题数值映射。
3. 切换「插件管理」分类再回来，画廊仍正确注入。
4. 提交前跑 `npm test` 通过。

## 七、风险与注意

- 「13 vs 14」：用户口述 13，但点选范围实际为 8 色 + 5 扩展色 + extraCss = 14；按用户明确点选的字段实现，数量以字段清单为准，不做强行裁减。
- 多自定义主题需要最小化改动既有 `applyTheme`/`themeName`/`cycleTheme`，避免破坏已测功能（cycle/编辑器联动/宿主三态）。
- 画廊注入依赖 MutationObserver 定位，需覆盖分类重渲染场景。