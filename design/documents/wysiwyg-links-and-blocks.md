# WYSIWYG 编辑器增强：链接弹框 / 块后插入 / 3×3 表格 / 末尾空行

## Context（背景）

所见即所得（WYSIWYG，`#ed-wysiwyg`）编辑器的右键菜单与块操作存在若干未满足的体验点，用户逐条提出。经与用户确认方案后实施：

- 新增"链接"能力：右键"插入"二级菜单加「链接」；链接已有「编辑/移除链接」；选中文本右键加「链接」。
- 链接需要**双输入弹框**（链接文字 + URL）+ **确定/取消**，复用现有 app-input.js 弹框风格。
- 修复「块上右键插入跑到首行」：插入应以右键命中的块为锚点，插到该块**之后**。
- 表格插入默认 **3×3**，插入后光标放进首个 `td` 内。
- 文档末尾是块时，WYSIWYG 渲染层**自动补一个空段落**（md 源码不存多余空行）。

用户三项决策（已确认）：
1. **保留「单击整块选中」**：表格/代码块单击仍是整块选中+蓝框，双击进入编辑；td 单击不直接编辑。
2. 末尾空行在**渲染层自动补**，md 源码不写入多余空行。
3. 链接弹框用**新增双输入弹框**。

## 涉及文件

- `d:\project\aiCode\second-brain\second-brain\js\app-input.js` —— 新增 `inputLinkModal`
- `d:\project\aiCode\second-brain\second-brain\js\app-editor-ctx.js` —— 右键菜单差分、链接操作、块后插入、插入表格
- `d:\project\aiCode\second-brain\second-brain\js\app-editor.js` —— WYSIWYG 渲染末尾空行补段
- `d:\project\aiCode\second-brain\second-brain\smoke-plugin.test.js` —— 新增断言
- 文档登记：历史 Bug `doc/bugs/`（索引 `doc/历史Bug记录.md`）、进度 `doc/进度/进度-编辑器.md`

## 实现步骤

### 1. app-input.js — 新增双输入链接弹框
新增函数 `inputLinkModal(opts)`，返回 `Promise<{text,url} | null>`，复用现有弹框卡片样式（参照 `inputModal` 的 ov/card/title/btn 结构）：
- 输入框1：链接文字（`opts.text` 或 `''`）
- 输入框2：URL（`opts.value` 或 `'https://'`，placeholder `链接地址`）
- 按钮行：取消（返回 null）、确定（返回 `{text, url}`）
- Enter 提交 / Esc 取消 / 点击遮罩取消；确定时 `url` 为空则视为取消
- 挂到 `window.inputLinkModal`（紧跟 `window.inputModal` 旁，类同注释风格，作者 火 冰）

### 2. app-editor-ctx.js — 右键菜单与链接操作
- `buildEdWysiwygSchema` 的 `insSeg`（插入段）末尾追加 `specItem('链接', 'link', insLink)`（置「代码块」之后、数学块之前或末尾均可，建议紧跟"脚注"后贴近常见顺位；选择紧随「数学块」后亦可，以代码为准实现一处）。
- 新增 `insTextLink`：基于「选中内容」或光标处插入链接：
  - 有选中文本 → 弹 `inputLinkModal`，用 `execWys('createLink', url)` 把选中文字变为链接（`url` 写入 href）。
  - 无选中 → 光标处插入 `<a href>`（`placeCaretAtEnd` 到链接文字尾部）。
  - 编辑/移除链接保持现状（`case 'link'` 已有「编辑链接」「移除链接」），将「编辑链接」改为走 `inputLinkModal`（`linkEl.textContent`/`linkEl.href` 预填）。
- `insertWysBlock(html, anchor)`：新增可选 `anchor` 参数——调用方传入右键命中块 `edCtxHit.block`（若存在）时，块插入锚定到该锚点**之后**，而非 `range.startContainer` 顶层块；`anchor` 为空时回退现有 `range` 逻辑。三个插入入口 `insCode/insQuote/insTable/insTask/insFoot/insMath` 均传入 `edCtxHit.block`。
- `insTable` 改为 **3 列 × 3 行**：thead 1 行（3 个 `th`「列1/列2/列3」）+ tbody 2 行（各 3 个 `td` 空 `<br>`）；插入后 `placeCaretAtEnd(首个 td)` 使光标直接落在 td 内。

### 3. app-editor.js — WYSIWYG 末尾空行补段
`renderArticle` 中 `wys.innerHTML = renderMarkdown(md)` 之后，惰性补段：
- 若 `wys.lastElementChild` 存在且是块（`PRE/TABLE/BLOCKQUOTE/HR`，或最后顶层子节点非 `P` 段落），`appendChild` 一个空段落 `<p><br></p>`（带内联 `min-height` 防止过矮）。
- 该补段仅影响 WYSIWYG 交互层；`domToMd` 会剔除 `<p><br></p>` 空段落（现有循环 `while pop 尾随空行` 已覆盖），md 源码不产生多余空行。
- 复现确认无副作用：渲染补段需在内存在不确定时幂等（每次 `renderArticle` 重渲染，无重复累积）。

### 4. smoke-plugin.test.js — 新增断言
- 冒烟 `SCRIPTS` 列表追加 `'app-input.js'`（在 `app-editor.js` 之前或不影响即可）；注意 jsdom 下 `inputLinkModal` 依赖真实 DOM，测试改为验证：
  - `inputLinkModal` 挂载为函数（`typeof`）
  - `insertWysBlock(html, anchor)`：传入 `anchor`（某前块）后新块成为其 `nextSibling`（验证块后插入）
  - `insTable` 产量：插入后 `table` 含 3 `th` + 2×3 `td`，光标锚点落在首个 td（通过 domToMd 3 列、rowspan 总和断言）
  - 末尾空行：构造以 `pre` 结尾的 wys，调用渲染补段逻辑后 `lastElementChild` 为 `P`。
- 运行：`node smoke-plugin.test.js` 全部通过；`npm test` 回归通过。

## 验证
- `node smoke-plugin.test.js`：新增断言全绿、原断言不回归。
- `npm test`：回归 5 通过。
- web 版 `http://127.0.0.1:8000` 手动抽查（若浏览器插件可用）：右键插入→链接/代码块插到命中块后；插入表格呈 3×3 且光标在 td；打开以代码块结尾的笔记末尾有可输入空行；链接上右键出现「编辑/移除链接」。
- 注意：桌面版 `code-highlight` 插件会改造编辑区 `<pre>`（Bug-014 已加守卫不处理 `#ed-wysiwyg`），本次不改动插件。

## 备注
- 不改动「单击整块选中」机制（用户保留）。
- `code-lang` 语言标签、`domToMd`、`renderMarkdown` 结构保持不变。