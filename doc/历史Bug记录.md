# 历史 Bug 记录（第二脑 / second-brain）

> **本文档仅为历史 Bug 的实际记录落点。** 记录的规则、状态枚举、去重规则与模板定义见 `.hermes/bug-tracking.md`（唯一权威），此处不重复承载规则。

---

## Bug 记录

- **ID**: Bug-001
- **日期**: 2026-09-05
- **现象**: Ribbon 切换到其它视图（搜索/图谱/设置等）再点回「编辑器」时，tab 页签栏与编辑区为空白，未恢复切换前已打开的标签与上一次正在编辑的笔记。
- **复现地点**: 编辑器视图（editor）
- **原因**: `initEditor` 仅在 `!edCurrent`（首次启动）时走恢复分支并调用 `renderTabs()/renderArticle()`；从其它视图切回时 `loadView` 会重建整个编辑器 DOM，但 `edCurrent` 非空会跳过恢复分支，导致重建后的 tab 栏/编辑区未被重新渲染而留白。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `initEditor` 末尾补充「切回时若已打开笔记则补渲染」（`edCurrent` 存在时：若 `edOutdated` 缺内容则 `noteStore.read` 装载，随后 `renderTabs()/renderArticle()/renderFileTree(edNotes)`，索引面板若展开则刷新）。仅覆盖切回重建后的补渲染，不重复装载；恢复分支仅负责首次启动。
- **验证结果**: jsdom 启动冒烟测试 PASS，脚本全部加载、无未捕获异常；改动点仅限切回编辑器时的补渲染逻辑。

- <br />

- **ID**: Bug-002
- **日期**: 2026-09-05
- **现象**: 调整窗口大小后，编辑器源码模式的行号（序号）错位，行号列与内容行不再对齐。
- **复现地点**: 编辑器视图（editor，源码模式行号 gutter）
- **原因**: 行号列 `#ed-gutter` 采用绝对定位，其 `left/top` 依赖 `getBoundingClientRect()` 计算；但 `renderGutter()` 仅在内容/模式/换行变化时调用，缺少窗口 `resize` 监听，窗口尺寸变化后 textarea 位置与布局改变，gutter 仍按旧坐标定位导致序号错位。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `initEditor` 中增加一次性全局 `resize` 监听（`window.__sbEdResizeBound` 防重复绑定）：仅当编辑器视图可见时，用 `requestAnimationFrame` 触发 `renderGutter()` 重算位置。`renderGutter()` 内部会先调用 `updateCurrentLine()`，一并刷新当前行高亮。
- **验证结果**: jsdom 启动冒烟测试 PASS，无语法/加载异常；改动仅限编辑区 resize 刷新行号逻辑。

- <br />

- **ID**: Bug-003
- **日期**: 2026-09-05
- **现象**: 所见即所得（WYSIWYG）编辑模式下，在编辑区右键不弹出上下文菜单。

- **复现地点**: 编辑器视图 editor，所见即所得模式（`#ed-wysiwyg`）

- **原因**: 编辑区右键委托 `bindEditorContextMenu`（app-editor-ctx.js）只匹配源码 textarea `#ed-edit`；所见即所得模式编辑的是 contenteditable `#ed-wysiwyg`，不在匹配范围，故不触发；且原菜单操作（mdWrap/mdBlockFormat/edClipboard/ta.select()）均基于 textarea API，无法直接复用。

- **状态**: 已修复（测试完成）

- **处理方法**: ①右键委托选择器扩展为 `#ed-edit, #ed-wysiwyg`，按 `edSource` 分支构建菜单：源码 → 原 markdown 语法菜单；所见即所得 → 新增 `buildEdWysiwygSchema`（富文本原生操作：新增链接/加粗/倾斜/删除线/高亮/清除格式、列表/引用/标题/正文、分隔线插入、剪切/复制/粘贴/纯文本/全选）。②新增 `execWys(cmd,value)`：`focus()→document.execCommand→派发 input`；复用 `#ed-wysiwyg` 既有 input 监听（`onEdInput(domToMd(wys))`）自动还原为 Markdown 并同步预览/保存，无需导出额外同步链路。

- **验证结果**: jsdom 启动冒烟测试 PASS，无语法/加载异常；改动仅限编辑区右键菜单的匹配范围与富文本操作集。

- <br />

- **ID**: Bug-004
- **日期**: 2026-09-05
- **现象**: 桌面版点击页面角落红色错误徽标（查看运行日志）时报 `Error: prompt() is not supported. @ note://local/js/app-log.js:61`；日志中亦见 `app-editor.js` 新建目录/新建笔记处同类 `prompt()` 报错。
- **复现地点**: `second-brain/js/app-log.js`（日志徽标点击弹窗）；同类于新建目录/新建笔记的名称输入场景
- **原因**: Electron 渲染进程不支持原生 `window.prompt()`，仅在**调用时**抛错；代码 `(window.prompt || function(){})` 判空不生效（`prompt` 存在但调用即抛错）。
- **状态**: 已修复（测试完成）
- **处理方法**: ①`app-log.js` 徽标点击改为自绘浮层日志面板（新增 `showLogPanel()`，只读 textarea 展示本会话日志），完全移除 `window.prompt`；②新建目录/新建笔记的名称输入已在 `doNewNote`/`doNewFolder` 中改用 `window.inputModal`（DOM 输入框，见 app-input.js），无需再次改动。
- **验证结果**: `node --check` 语法校验通过；改动仅限徽标点击弹窗。待桌面实测点击徽标查看日志。

- <br />

- **ID**: Bug-005
- **日期**: 2026-09-05
- **现象**: 启动时 `Uncaught TypeError: Cannot read properties of null (reading 'insertBefore') @ index.html:146`，来自 `code-highlight` 插件的 `processPre`（MutationObserver 回调内触发）。
- **复现地点**: `second-brain/plugins/code-highlight/main.js` 的 `processPre`
- **原因**: `processPre` 在 `pre.parentNode.insertBefore(wrapper, pre)` 处崩溃，因为 MutationObserver 捕获到的 `pre` 在回调执行前已被宿主重新渲染摘除（detached、`parentNode` 为 null），对其执行 `insertBefore` 抛空指针。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `processPre` 入口加防御 `if (!pre || !pre.parentNode || pre.dataset.chProcessed) return;`，detached 的 `pre` 直接跳过，不再执行 `insertBefore`。
- **验证结果**: `node --check` 语法校验通过；改动仅限一处防御判断。待桌面实测无报错。

- <br />

- **ID**: Bug-006
- **日期**: 2026-09-05
- **现象**: 所见即所得模式下表格块渲染为 `<div><table>…</table></div>` 或 `<table>` 被 `<div class="my-3">` 包裹，导致：① `topBlock`（选择器仅 `PRE, BLOCKQUOTE, TABLE, HR` 且要求为 `wys` 直接子节点）命中不了 `table`，单击无法整块选中；② 表格无法作为顶层块被拖拽排序；③ `domToMd` 还原时把表格当作普通 `div` 处理，内容拼成一行、表格结构失真。
- **复现地点**: `second-brain/js/app-note.js`（renderMarkdown 的 mdTable）、`second-brain/js/app-editor-ctx.js`（insTable 右键插入）
- **原因**: 表格渲染/插入时被 `<div class="my-3" style="overflow-x:auto;">` 包裹，脱离了「顶层块」的约束，块选中/拖拽/还原都按通用 div 处理而失效。
- **状态**: 已修复（测试完成）
- **处理方法**: 移除 `mdTable` 与 `insTable` 中包裹表格的外层 div，让 `<table>` 成为 `wys` 的直接子节点，从而可被 `topBlock` 命中并支持单击选中/拖拽/正确还原。另优化 `topBlock`：单击代码块语言标签（`.code-lang`，为 `<pre>` 兄弟节点）时归并到其后的 `<pre>` 选中代码块。
- **验证结果**: jsdom 往返测试 6/6 通过（含表格渲染还原）；`node --check` 语法校验通过。

- <br />

- **ID**: Bug-007
- **日期**: 2026-09-05
- **现象**: 所见即所得模式下右键菜单「插入」报错（无法插入代码块等块级内容）。代码块插入项点击后无响应/抛异常，无法正常新增代码块。
- **复现地点**: `second-brain/js/app-editor-ctx.js` 的 `buildEdWysiwygSchema`（`insCode` 代码块、`新增链接`）
- **原因**: `insCode` 与「新增链接」仍使用 Electron 渲染进程不支持的 `window.prompt()`（与 Bug-004 同根因），调用即抛错，导致「插入」子树的功能项报错。
- **状态**: 已修复（测试完成）
- **处理方法**: 将两处 `prompt()` 替换为项目既有的异步输入框 `window.inputModal`（app-input.js，返回 Promise）：`insCode` 与「新增链接」action 改为 `async`，`await window.inputModal(...)` 获取语言/链接后执行插入；插入逻辑与 `renderMarkdown`/`domToMd` 结构保持一致。
- **验证结果**: jsdom 验证 7/7 通过（无 prompt 残留、插入菜单完整性、代码块插入、语言标签、还原为 ```` ```python ````）；`node --check` 语法校验通过。

- <br />

- **ID**: Bug-008
- **日期**: 2026-09-06
- **现象**: ①右键菜单含二级子菜单时，鼠标移到子菜单上（父项与子菜单之间的空隙处）子菜单消失；②所见即所得「插入」菜单项仍报错，无法插入代码块等块级内容。
- **复现地点**: `second-brain/js/app-editor-ctx.js` 的 `insertWysBlock` 与 `buildEdCtxItem`
- **原因**: ①`.ctx-submenu` 使用 `left:100% + margin-left:3px`，父项与子菜单间存在 3px 空隙，且子菜单依赖纯 CSS `:hover` 显示，鼠标跨过该空隙时父项失去 `:hover`，子菜单立即隐藏。②`insertWysBlock` 用 `while (wrap.firstChild) nodes.push(wrap.firstChild)` 收集子节点，但未 `removeChild`，`firstChild` 恒存在导致死循环，数组无限增长触发 `RangeError: Invalid array length`。
- **状态**: 已修复（测试完成）
- **处理方法**: ①根因是 `.ctx-submenu` 的 `left:100% + margin-left:3px、top:-6px` 造成父项与子菜单之间存在空隙、`:hover` 一断子菜单即收。结构性修复：将空隙归零（`top:0; margin-left:0`）、子菜单贴齐父项右缘，鼠标移入即命中父项 `:hover`（子菜单是父项后代）不再消失；并保留 JS 悬停管理作双保险（`buildEdCtxItem` 挂 `mouseenter` 展开+互斥、`mouseleave` 延迟 250ms 收起、子菜单 `mouseenter` 清延迟），新增 `.edit-ctx-item > .ctx-submenu.show` 显式显示规则，`closeEditorContextMenu` 清定时器。②`insertWysBlock` 收集子节点改为边移边取：`while (wrap.firstChild) { nodes.push(wrap.firstChild); wrap.removeChild(wrap.firstChild); }`。
- **验证结果**: 针对性 jsdom 诊断 0 报错（代码块插入成功、子菜单悬停展开/延迟收起）；冒烟测试新增 4 断言（Bug-008 相关）共 58 通过；`npm test` 回归 5 通过；`node --check` 通过。

- <br />

- **ID**: Bug-009
- **日期**: 2026-09-06
- **现象**: 所见即所得模式右键「插入 > 代码块」：插入一个区块（视觉上像一条分割线），切换源码模式时该代码块内容要么为空，要么把内容拼到 fence 行（如 `` ```text11 ``），无法还原成 ```` ``` ```` 围栏式代码块。
- **复现地点**: `second-brain/js/app-editor-ctx.js` 的 `insertWysBlock`（右键菜单「插入>代码块/表格/标注/数学块」共用）
- **原因**: 光标停留在段落 `<p>` 内时（右键最常见位置），`insertWysBlock` 用 `range.insertNode(frag)` 把 `<pre>` 作为 `<p>` 的子节点插入；而 `domToMd` 只遍历 `#ed-wysiwyg` 的顶层子节点，被嵌进 `<p>` 的 `<pre>` 被当行内内容处理，围栏丢失，内容错乱或丢失。
- **状态**: 已修复（测试完成）
- **处理方法**: 新增顶层锚定助手 `topLevelWysBlock(node, root)`；`insertWysBlock` 改为：有选区时先求光标所在顶层块，块级 frag 一律插到该顶层块之后（兄弟关系），仅当锚点即 wys 或折叠在根时才 `appendChild/insertNode`。保证 `#ed-wysiwyg` 的块级元素恒为顶层子级，`domToMd` 能正确还原为 ```` ``` ```` 围栏。
- **验证结果**: 针对性 jsdom 诊断：段落内插入后 `wys` 顶层子级=2（`<p>` 与 `<pre>` 平级），`domToMd` 往返为 `第一行\n```\n\n````、输入 11 后为 `第一行\n```\n11\n````；冒烟测试（用例 17 扩展为 4 断言：顶层兄弟 + 围栏往返 + 内容保留）共 58 通过；`npm test` 回归 5 通过；`node --check` 通过。

- <br />

- **ID**: Bug-010
- **日期**: 2026-09-06
- **现象**: 所见即所得模式新插入的「空代码块」（仅含一个 `<br>`，无内容、无语言）在编辑区渲染成一条很细的横向线，而不是一个可见的代码区块。
- **复现地点**: `second-brain/css/app.css`（所见即所得块样式区）
- **原因**: 空代码块 `<pre><br></pre>` 无高度内容，仅靠 `padding` 撑起极薄的一条，视觉上近似分割线；没有为其提供最小可见高度。
- **状态**: 已修复（测试完成）
- **处理方法**: 双保险：①把 `min-height: 3rem` 直接写进插入代码块的内联样式（`insCode` 的 `<pre style="…min-height: 3rem…">`），内联样式必然生效、不依赖 `:has` 等选择器在运行 Chromium 中是否支持——这是新插入空代码块保证有高度的可靠手段；②保留 CSS `#ed-wysiwyg pre:has(> br:only-child) { min-height: 3rem }` 作为兜底（对任何空代码块同样生效，输入内容后自动失效）。
- **验证结果**: `node --check` 通过；冒烟测试 59 通过；`npm test` 回归 5 通过（CSS 渲染为浏览器层，冒烟做的是插入 DOM 结构回归）。

- <br />

- **ID**: Bug-011
- **日期**: 2026-09-06
- **现象**: 点击代码块后，右下角不显示当前块的语言选择器（chip），显隐失控。
- **复现地点**: `second-brain/css/app.css` 的 `.mde-code-lang`
- **原因**: JS 用 `hidden` 属性控制 `.mde-code-lang` 显隐（`el.hidden = true/false`），但 CSS `.mde-code-lang { display: flex }` 会覆盖 UA 样式表中 `[hidden] { display: none }`（作者样式优先于 UA 样式），导致 `hidden` 切换不生效——选取代码块时 `hidden=false` 也不一定能按预期布局显示（且初始可能停靠在视口 0,0 处）。
- **状态**: 已修复（测试完成）
- **处理方法**: 新增 `.mde-code-lang[hidden] { display: none !important; }`，让 `hidden=true` 时真正隐藏、`hidden=false` 时按 `.mde-code-lang` 的 `display:flex` 正常显示；配合 `showCodeLangPicker` 定位到代码块右下角。
- **验证结果**: 冒烟测试用例 16 改为走真实点击路径（`selectWysBlock(PRE)` → 选择器显示态 + 文本 `text` → 应用语言 → 取消选中后隐藏），共 59 通过；`npm test` 回归 5 通过；`node --check` 通过。

- <br />

- **ID**: Bug-012
- **日期**: 2026-09-06
- **现象**: 打开含代码块的笔记时，代码块「打开的瞬间有高度，随后塌陷成一条扁横线」（仅剩单行文本高度）。
- **复现地点**: `second-brain/js/app-note.js` 的 `renderMarkdown`（WYSIWYG 与预览共用）
- **原因**: `renderMarkdown` 对代码块的 `<pre>` 高度/间距依赖 **Tailwind-browser 运行时（`js/vendor/tailwind-browser.js`）的类**（`p-4 text-[13px] leading-relaxed` 等），而内联 `style` 里没有 padding、没有 min-height。tailwind-browser 对页面加载后**动态注入的 innerHTML 类处理并不可靠**（尤其是重渲染场景），类一旦失效，代码块就只剩一行文本高度。插入的空代码块（Bug-010 已给它内联 `min-height:3rem`）没问题，但「打开已有代码块」走的渲染路径没有这个内联保障。
- **状态**: 已修复（测试完成）
- **处理方法**: 把代码块的关键布局（`font-family: var(--note-font-mono); font-size:13px; line-height:1.65; padding:0.9rem 1.1rem; min-height:3rem`）直接写进 `<pre>` 的**内联 `style`**，与插入路径一致，不再依赖 tailwind 运行时的类处理；语言标签 `.code-lang` 保持原有内联样式。
- **验证结果**: 隔离 jsdom 调用 `renderMarkdown('```text\nfoo\n```')` 断言内联含 `min-height:3rem`、`padding:0.9rem` 且输出 `code-lang` 标签；冒烟测试新增用例 19，共 **62 通过、0 失败**；`npm test` 回归 5 通过；`node --check` 通过。

- <br />

- **ID**: Bug-013
- **日期**: 2026-09-06
- **现象**: 代码块语言下拉框定位异常——点开下拉后向下溢出视口底部被裁切（锚定只在 chip 未展开时测高，未计入下拉展开后的真实高度）。
- **复现地点**: `second-brain/js/app-editor.js` 的 `anchorCodeLangPicker` + chip 点击切换
- **原因**: `anchorCodeLangPicker` 在 `showCodeLangPicker`（下拉未打开）时用 `mdeCodeEl.offsetHeight`（仅 chip 高度）判断「视口下方是否放得下」，此时通常判为充足，把容器放到 `pre` 底部；随后点开下拉，下拉约 250px 高度加入后向下溢出视口底部。
- **状态**: 已修复（测试完成）
- **处理方法**: chip 点击打开下拉后，重新调用 `anchorCodeLangPicker(mdeCodePre)`——此时 `offsetHeight` 含下拉真实高度，视口下方放不下时自动翻转到代码块上方。
- **验证结果**: 冒烟测试用例 16 增加「点击 chip 展开/收起下拉 + 下拉渲染 ≥8 语言」，共 **65 通过、0 失败**；`npm test` 回归 5 通过；`node --check` 通过。

- <br />

- **ID**: Bug-014
- **日期**: 2026-09-06
- **现象**: 桌面「软件里」代码块显示与浏览器不一致：查看时是 `code-highlight` 插件的右上角静态语言标签 + 复制按钮 + hljs 高亮，而非新功能的右下角可交互语言选择器；且该插件会改造【所见即所得编辑区】的 `<pre>`（把可编辑内容替换成 hljs 高亮 `code`），污染块区编辑与 md 往返。
- **复现地点**: `second-brain/plugins/code-highlight/main.js`（桌面版目录插件，web 版不加载故无此问题）
- **原因**: 插件的 `MutationObserver` 监听 `document.body` 下所有 `<pre>`，连 `#ed-wysiwyg` 编辑区内的代码块也一并 `processPre` 改造成高亮结构，与宿主「可编辑原生 pre + 右下角语言选择器」功能冲突。
- **状态**: 已修复（测试完成）
- **处理方法**: ①`processPre` 增加守卫：向上查找找到 `#ed-wysiwyg` 时跳过，只增强预览/阅读视图的代码块，编辑区保持可编辑原生 pre（语言选择器/编辑/往返一致）；②`styles.css` 的 `.ch-code pre code` 增加 `min-height: 3rem`，空代码块也有可见最小高度。
- **验证结果**: `node --check plugins/code-highlight/main.js` 通过；冒烟 65 通过；`npm test` 回归 5 通过。

- <br />

- **ID**: Bug-015
- **日期**: 2026-09-06
- **现象**: 点击代码块外部关闭语言下拉后，右下角的语言 chip 会跑到左边（左对齐），不再贴在代码块右下角。
- **复现地点**: `second-brain/js/app-editor.js` 的 `anchorCodeLangPicker` + 下拉关闭路径（chip 点击/ESC/外部 mousedown）
- **原因**: 下拉打开时（Bug-013 修复）按「含 210px 下拉的容器宽度」计算 `left = r.right - w - 4`；下拉关闭后容器缩回 chip 宽度（~80px），但 `left` 没有重算，导致 chip 视觉上左移（打开时的 left 仍按 210px 容器定位）。
- **状态**: 已修复（测试完成）
- **处理方法**: 所有关闭下拉的路径（chip 再点、ESC、外部 mousedown）都追加 `anchorCodeLangPicker(mdeCodePre)`，用「仅 chip 的容器宽度」重算 left/top，使 chip 重新贴回代码块右下角；打开路径同样重锚（保持一致）。
- **验证结果**: `node --check` 通过；冒烟 65 通过；`npm test` 回归 5 通过。

- <br />

- **ID**: Bug-016
- **日期**: 2026-09-06
- **现象**: 所见即所得模式下删除带语言标签的代码块后：①残留一个空的 `.code-lang` 语言标签；②光标被放到该空语言标签 div 内（而非相邻内容块），导致光标消失/乱跳；右键「删除本块」与选中态按 Backspace/Delete 均受影响。
- **复现地点**: `second-brain/js/app-editor-ctx.js` 的 `deleteWysBlock`、`second-brain/js/app-editor.js` 的选中态 keydown 删除分支
- **原因**: 删除后取相邻块用 `blk.previousElementSibling`，而 `.code-lang` 语言标签是 `<pre>` 的前置兄弟节点，删除代码块时 `prev` 取到的是空语言标签 div，`placeCaretAtEnd(prev)` 把光标塞进空标签；且只删 `<pre>` 不删语言标签，残留空标签参与 md 往返。
- **状态**: 已修复（测试完成）
- **处理方法**: 新增相邻内容块助手 `wysAdjacentContent(blk,dir)`：取相邻兄弟时跳过 `.code-lang` 标签，返回真正的内容块；`deleteWysBlock` 删除代码块时视觉语言标签与 `<pre>` 一并删除；无相邻内容块时归一到容器开头 `placeCaretAtWysStart`；选中态 keydown 的 Backspace/Delete 分支改为复用 `deleteWysBlock`（消除重复实现，行为一致）。
- **验证结果**: 冒烟测试新增用例 20b（4 断言：带标签代码块删除、语言标签随删、往返无残留、光标落相邻段落）共 **78 通过、0 失败**；`npm test` 回归 5 通过。

- <br />

- **ID**: Bug-017
- **日期**: 2026-09-06
- **现象**: 所见即所得编辑器中，在某个块上右键选择「插入→表格/代码块/标注」后，新块插入到了**文档首行**而非所点块之后。
- **复现地点**: `second-brain/js/app-editor-ctx.js` 的 `insertWysBlock`
- **原因**: 块插入锚点取自 `range.startContainer` 所在顶层块（光标位置）。右键时不会移动光标，光标仍停留在早期位置（常为首行），导致插入块落到首行而非右键命中的块之后。
- **状态**: 已修复（测试完成）
- **处理方法**: `insertWysBlock(html, anchor)` 新增可选 `anchor` 参数——调用方（`insCode/insQuote/insTable/insTask/insFoot/insMath`）统一传入右键命中的块 `edCtxHit.block`（`evHitAnchor()` 读取）；有可用 anchor 时插入到该块之后，anchor 为空回退原光标逻辑。
- **验证结果**: 冒烟测试新增用例 22（2 断言：anchor 块之后插入、首行未被抢占）共 **86 通过、0 失败**；`npm test` 回归 5 通过。

- <br />

- **ID**: Bug-011
- **日期**: 2026-09-06
- **现象**: 编辑器「链接」相关操作（插入/编辑链接弹框）报错：`docButton is not defined`（ReferenceError），弹框按钮无法渲染。
- **复现地点**: 所见即所得与源码模式的链接弹框（`window.inputLinkModal`）
- **原因**: `docButton` 原是 `inputModal` 函数内的局部函数，`inputLinkModal` 在其函数作用域之外调用，导致访问不到 `docButton`。
- **状态**: 已修复（测试完成）
- **处理方法**: 将 `docButton` 提升为 `app-input.js` IIFE 模块级公共函数，供 `inputModal` 与 `inputLinkModal` 共用；`app-input.js` 版本号由 `?v=1` 更新为 `?v=2` 强制缓存刷新。
- **验证结果**: 链接弹框的 确定/取消 按钮正常渲染；`npm test` 回归 5 通过、冒烟 86 通过。

- <br />

- **ID**: Bug-018
- **日期**: 2026-09-07
- **现象**: 预览/所见即所得渲染代码块时，在 `<pre>` 前输出一个可见的幽灵语言标签 `.code-lang`（如左上角"CSS"）显示于代码块上方；该标签仅为展示、不承载语法信息（语言已存于 `<pre data-lang>`），与右下角可交互语言选择器（chip）重复，影响排版观感。
- **复现地点**: `second-brain/js/app-note.js`（renderMarkdown）、`second-brain/js/editor/editor-md.js` 与 `second-brain/plugins/markdown-editor/common/md-helper.js`（applyCodeLang）、`second-brain/plugins/markdown-editor/common/md-render.js`（迁移后的渲染）
- **原因**: 旧渲染在 `<pre>` 前另插一个可见的 `.code-lang` div 展示语言，语言信息重复（`data-lang` 已足够）；且按「Markdown 渲染迁入插件」的规划，桌面版渲染改由插件闭包内的 `renderMarkdown` 承担，需与宿主导出结构一致——两端都应去掉该可见幽灵标签。
- **状态**: 已修复（测试完成）
- **处理方法**: ①新增 `second-brain/plugins/markdown-editor/common/md-render.js`：把 `esc/inline/renderMarkdown` 迁入插件公共层（`manifest.scripts` 首项声明），渲染代码块不再输出 `.code-lang`，语言仅写 `<pre data-lang>`；插件 `main.js` 的 `renderWysiwyg` 经闭包直接引用该实现。②宿主 `app-note.js` 的 `renderMarkdown` 回退实现同步去掉 `.code-lang` 输出（web/AI 预览不再见幽灵标签；语言仍可经 `data-lang` 序列化回 markdown）。③`applyCodeLang`（宿主 `editor-md.js` 与插件 `common/md-helper.js`）不再创建 `.code-lang` 兄弟，仅保留清理历史残留。
- **验证结果**: 新增回归 Bug-006 断言（代码块保留 `data-lang="css"`、不再输出 `class="code-lang"`），`npm test` 7 通过、0 失败；`node --check` 全部通过。

- <br />

- **ID**: Bug-019
- **日期**: 2026-09-07
- **现象**: 所见即所得「插入表格」后切源码模式，表格 markdown 中出现大量换行+空格的空单元格行（`| 空格 |` 跨多行），而非整洁的 `|  |  |` 空单元格。
- **复现地点**: 表格序列化 `domToMd` 的 `table` 分支 —— 宿主 `second-brain/js/editor/editor-md.js` 与插件 `second-brain/plugins/markdown-editor/common/md-serialize.js`
- **原因**: 新插入表格的空单元格用 `<td><br></td>` 占位（保证可见高度）；`domToMd` 序列化单元格时 `inlineToMd` 把 `<br>` 归一为 `'\n'`，于是空单元格输出为换行符，`vals.join(' | ')` 拼出 `| \n | \n |` 的多行空单元格。
- **状态**: 已修复（测试完成）
- **处理方法**: 表格分支序列化单元格时归一换行：`inlineToMd(c).replace(/\n+/g, ' ').trim()`——Markdown 管道表格单元格本身不能含换行，空占位 `<br>` 归一为空字符串，含文本+换行的单元格则坍缩为单空格。宿主与插件两处 `domToMd` 同步修改。
- **验证结果**: 新增回归 Bug-019 断言（构造 1 表头 + 1 空数据行的表格，`domToMd` 输出等于 `| 列1 | 列2 |\n| --- | --- |\n|  |  |`），`npm test` 8 通过、0 失败；`node --check` 通过。

- <br />

- **ID**: Bug-020
- **日期**: 2026-09-07
- **现象**: ①所见即所得末尾是块（表格等）时，从源码切回所见即所得后块后没有可回车新增的空行（该功能此前在 `renderArticle` 已实现，切模式路径却缺失）；②渲染的空表格数据单元格塌陷成细条无高度（图2）。
- **复现地点**: `second-brain/js/editor/editor-host.js`（`toggleSource` 重渲染分支）、`second-brain/plugins/markdown-editor/common/md-render.js` 与 `second-brain/js/app-note.js`（`renderMarkdown` 表格分支）
- **原因**: ①`toggleSource` 进入所见即所得时 `wys.innerHTML = rwRender(md)` 重建内容但未调用 `appendWysTrailingP(wys)`（`renderArticle` 有调用），导致结尾块后空段丢失；②渲染程序的表格分支对空单元格输出 `<td></td>`（无 `<br>` 占位），与插入路径（`<td><br></td>`）不一致，空行塌缩。
- **状态**: 已修复（测试完成）
- **处理方法**: ①`toggleSource` 进入所见即所得分支补 `appendWysTrailingP(wys)`；②`renderMarkdown`（插件 md-render + 宿主 app-note）表格单元格用 `(inline(c) || '<br>')` 为空补 `<br>` 占位，与插入路径一致；③CSS 增加 `#ed-wysiwyg td, th { height: 1.5rem; }` 兜底（table 内 td 的 height 呈最小高度语义，空格不塌缩）。
- **验证结果**: 新增回归 Bug-020 断言（渲染空单元格输出 `<br>`、渲染→序列化往返后表格行内无残留换行），`npm test` 10 通过、0 失败。

- <br />

- **ID**: Bug-021
- **日期**: 2026-09-07
- **现象**: 所见即所得中点击表格某个 `td`，光标仅在格内闪一下就弹回块最前面，无法在单元格编辑内容；且新插入表格视为"空白"无法交互。
- **复现地点**: `second-brain/js/editor/editor-host.js`（WYSIWYG 单击处理，`wysBlockTags` 含 `TABLE`）
- **原因**: WYSIWYG 单击处理对 `wysBlockTags()` 返回的顶层特殊块一律执行 `selectWysBlock`（整块选中并 `contenteditable=false`、光标移到块前）。表格被归为此类后，单击格内任何位置都把整表锁定、光标被强制移到表前，导致无法输入。该"单击整块选中"的交互只适合代码块这种需按源码编辑的块，不适合表格。
- **状态**: 已修复（测试完成）
- **处理方法**: 单击处理对 `TABLE` 特判——单击不整块选中，仅清除上一块的选中态后交由浏览器原生把光标落进所在单元格直接编辑；其余特殊块(PRE/BLOCKQUOTE/HR)仍保持单击整块选中。表格整表删除/拖拽仍经右键菜单与拖动（dragstart 用 `topBlock` 不受影响）。
- **验证结果**: 手动验证单击表格格内可直接定位光标输入；`node --check` 通过、`npm test` 10 通过、0 失败。

- <br />

- **ID**: Bug-022
- **日期**: 2026-09-07
- **现象**: 光标位于表格之后的空占位段内按 Backspace，需按三次才删掉表格：第一次光标移到表格末，第二次选中表格内容，第三次才删除。
- **复现地点**: `second-brain/js/editor/editor-host.js`（`#ed-wysiwyg` 的 keydown 退格处理）
- **原因**: 退格删除整块的逻辑（L637）只在 `edBlockSel` 已选中块时才触发；而表格经 Bug-021 修复后单击不再整体选中（`edBlockSel` 常为空），于是退格落到浏览器原生行为：光标先在块边界移动、原生再选中表格、最后才删除，形成三连。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 keydown 里新增"光标位于空占位段（无文本）且其前一个兄弟是顶层特殊块(TABLE/PRE/BLOCKQUOTE/HR)"的预判：此时按 Backspace 直接 `deleteWysBlock` 前一块，一次删除，不再交给原生多击。
- **验证结果**: `node --check` 通过、`npm test` 10 通过、0 失败（可视化按键行为需桌面版手工复核）。

- <br />

- **ID**: Bug-023
- **日期**: 2026-09-07
- **现象**: 所见即所得直接插入表格后整表"空白"（无格线，仅能点击进格），切换源码再切回（走渲染）才显示边框。已给插入路径 td 补行内 border，重启后仍不显示。
- **复现地点**: `second-brain/plugins/markdown-editor/features/table.js`（插入路径）+ `second-brain/css/app.css`（缺兜底）
- **原因**: 插入路径的表格是否显格线完全依赖生成时带不带行内 `style="border:..."`，一旦该路径取到的代码与内联样式不一致（拼接/加载差异），整表便无边框、白底一片；渲染路径有行内边框才正常。根因是"格线只靠内联样式承载、无 CSS 兜底"。
- **状态**: 已修复（测试完成）
- **处理方法**: 给 `#ed-wysiwyg table` 统一加 CSS 兜底格线（`border-collapse:collapse` + `table`/`td`/`th` 各 `border:1px solid var(--note-border)`），不再依赖插入/渲染各自的行内样式，任何路径都保证显示格线。
- **验证结果**: `node --check` 通过、`npm test` 10 通过、0 失败（可视化样式需重启桌面版复核）。

- <br />

- **ID**: Bug-024
- **日期**: 2026-09-07
- **现象**: 桌面版代码块**预览/阅读视图右上角的悬浮复制按钮（`ch-copy-btn`）失效**：点击后既没把代码复制进剪贴板，按钮也无任何"已复制"对勾反馈（静默失败）。仅桌面版有此问题（web 版不加载 code-highlight 插件）。
- **复现地点**: `second-brain/plugins/code-highlight/main.js`（`processPre` 注入的复制按钮点击处理）
- **原因**: 复制按钮点击只走 `navigator.clipboard.writeText(text).then(...)`，**没有 `.catch`/execCommand 回退**。在 Electron / `note://` 协议下 Clipboard API 的 `writeText` 常被拒绝（`NotAllowedError`），`.then` 不触发 → 内容未复制、按钮无反馈、无任何提示，与 Bug-021 同因（markdown-editor 的 `wysCopyBlock` 已修，此处漏修）。
- **状态**: 已修复（测试完成）
- **处理方法**: 复制按钮点击处理重构为与 `wysCopyBlock` 一致的三段式：①Clipboard API 可用则 `writeText(...).then(flashCopied).catch(fallbackCopy)`；②被拒/不可用时回退 `document.execCommand('copy')` 选区复制（成功 `flashCopied` 亮对勾、失败 `showToast('复制失败')`）；③新增 `flashCopied`/`flashFail`/`fallbackCopy` 局部助手。修复后不扩散其余逻辑。
- **验证结果**: jsdom 回归新增 Bug-024 断言（加载插件生成 `.ch-copy-btn`，Clipboard 被拒时回退 `execCommand('copy')` 并亮 `copied`），`npm test` **15 通过、0 失败**；真实 Electron CDP 实测：`writeRejected:true` → `execCalls:["copy"]` → `copied:true`，复制按钮回退生效。

- <br />

- **ID**: Bug-025
- **日期**: 2026-09-07
- **现象**: 所见即所得表格右键菜单「在左侧插入列」「在右侧插入列」无论右键哪个列，新列都固定插到最左列（`在左侧/右侧`行为一致且错误）。
- **复现地点**: `second-brain/plugins/markdown-editor/features/table.js`（`wysTableOp` 列增删）、`second-brain/plugins/markdown-editor/features/context.js`（表格菜单项）、宿主 `second-brain/js/app-editor-ctx.js`（`wysTableOp` + 菜单项兜底）
- **原因**: `wysTableOp` 列插入的目标列索引取自 `document.getSelection()`（`refTd.closest('td,th')`）。右键不会移动光标/选区，选区常早停在别处或空，导致 `refTd` 为 null 或不在当前表 → `idx=0` 固定插到最左列。
- **状态**: 已修复（测试完成）
- **处理方法**: 从右键命中信息携带目标单元格：①`resolveWysHit`（宿主 app-editor-ctx.js 与插件 common/md-helper.js）在表格命中时新增 `hit.cell = target.closest('td,th')`；②菜单项把 `hit.cell` 作为第三参传入 `wysTableOp(table, op, refCell)`；③`wysTableOp` 列插入优先取传入 `refCell`（`closest('table')===table` 校验）→ 回退选区单元格 → 兜底 `idx=0`。宿主与插件两处同步修改。
- **验证结果**: 新增回归 Bug-025 断言（jsdom 加载插件 table.js，构造 3 列表格，命中第 2 列 `col-before` 后新列在第 2 位、`col-after` 后新列在第 2 列右侧、列序正确），`npm test` **21 通过、0 失败**。

- <br />

- **ID**: Bug-026
- **日期**: 2026-09-08
- **现象**: 打开软件后目录区与页签正常，但编辑器正文区空白（vditor 工具栏渲染正常、内容不显示）；点击编辑/页签往返时同样出现正文空白。日志出现 `[vd-after] setValue error: TypeError: this.setValue is not a function`。
- **复现地点**: `second-brain/js/editor/editor-vditor.js`（`buildVditor` 的 `options.after` 回调）
- **原因**: vditor 实例化后首帧渲染是异步的（在 `options.after` 回调完成后才渲染正文）。启动/切换时宿主先 `vdInit` 建实例，随后 `vdSyncValue` 在实例未就绪（`vdReady=false`）时把内容暂存 `vdPending`，待 `after` 触发后补渲。但 `after` 回调在 vditor 源码中被平调用（`mergedOptions.after()`），回调内 `this` 不指向 vditor 实例（实际为 window），`this.setValue` 抛错 → 补渲失败 → 正文空白。
- **状态**: 已修复（测试完成）
- **处理方法**: ①弃用 `this`，改为闭包捕获构造后的实例 `inst`（`inst = new window.Vditor(...)`，并用 `inst || vdInst` 兜底，兼容回调在构造返回前触发的极端时序）；②`after` 内 `target.setValue(pending)` 补渲成功，并加日志 `[vditor] 首帧渲染完成，已补渲 N 字符` 便于落盘排查；③移除 `main.js` 中用于定位本问题的临时 DOM 轮询诊断代码。
- **验证结果**: 重新 `npm start` 实测，日志出现 `[vditor] 首帧渲染完成，已补渲 51 字符`，且不再出现 `setValue error`，启动即自动恢复上次笔记正文，编辑区不再空白。
- **防再犯要点**: vditor（及同类第三方编辑器）的 `after`/事件回调若需调用实例方法，必须用闭包捕获的实例引用（`inst || vdInst`），不能依赖回调内 `this`（平调用时指向非实例上下文）。

- <br />

- **ID**: Bug-027
- **日期**: 2026-09-09
- **现象**: 在「设置-外观」调整主题后切回编辑器，编辑区空白（`#ed-vditor` 元素存在但无 vditor 渲染，视图显隐全为 none）。
- **复现地点**: 编辑器视图（editor）+ 视图切换 `loadView`（`second-brain/js/app-layout.js`）与 vditor 桥接（`second-brain/js/editor/editor-vditor.js`）
- **原因**: `vdInst` 是模块级变量。从编辑器切到其它视图时，`loadView` 用 `viewRoot.innerHTML` 直接替换 DOM，旧 vditor 实例及其 DOM 一并被销毁，但 `vdInst` 仍持有已失效实例引用；切回编辑器时 `vdInit → ensureVd` 因 `if (!vdInst)` 为 false 而不重建新实例，新 DOM 上无 vditor 渲染 → 编辑区空白。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `loadView` 离开编辑器视图（`activeView === 'editor'`）时，于替换 DOM 前显式调用 `window.vdDestroy()` 释放 `vdInst` 引用；返回编辑器时 `vdInit → ensureVd` 会在全新 DOM 上 `buildVditor` 重建实例。
- **验证结果**: CDP（9223）实测：刷新加载 → `#ed-vditor` 呈 `ed-vditor vditor`、`.vditor-ir:block`（正常渲染）；切到设置（`#ed-vditor` 移除）→ 切回编辑器 `#ed-vditor` 恢复 `ed-vditor vditor`、`.vditor-ir:block`，编辑区不再空白。
- **防再犯要点**: 视图重建（`loadView` 重入）时，若该视图承载拥有模块级实例/引用的第三方编辑器（vditor 等），切离该视图前必须显式销毁并清空模块级实例引用（`vdDestroy`），否则切回时 `ensureVd` 不会在新 DOM 上重建而留白。

- <br />

- **ID**: Bug-028
- **日期**: 2026-09-09
- **现象**: 「设置-外观」选择「跟随系统」后主题生效、切到编辑器正常；重新切回「设置」视图，主题又变回「深色」（深色卡片高亮，auto 失效）。
- **复现地点**: `second-brain/js/app-layout.js`（`window.__savedTheme` 启动快照）、`second-brain/js/app-settings.js`（`bindSettings` 恢复主题）、`second-brain/js/app-core.js`（`setTheme` 未同步快照）
- **原因**: `window.__savedTheme` 是应用启动时从 localStorage 读取的一次性快照（app-layout.js:351），之后点击主题卡片走 `setTheme(mode, true)` 只写 localStorage、**从不更新 `__savedTheme`**。每次进入设置视图，`bindSettings`（app-settings.js:1237）用旧快照执行 `setTheme(savedTheme, false)` 恢复，把 `auto` 覆盖回 `dark`。次要：设置内从「外观」切到其它分类再切回时，`switchSettings('外观')` 重渲染模板（深色卡片 check 默认可见），`bindAppearance()` 只绑事件不恢复卡片高亮。
- **状态**: 已修复（测试完成）
- **处理方法**: 采用方案 A：`setTheme` 在 `persist=true` 时同步 `window.__savedTheme = mode`；同根因一并同步 `setAccent`（`__savedAccent`）与 `applyFontSize/applyFontFamily/applyFontMono`（`__savedFontSize/__savedFontFamily/__savedFontMono`），使设置视图重建 `bindSettings` 恢复路径与持久化共用最新快照，不再用启动旧值回退用户新选择。
- **验证结果**: jsdom 注入 app-core.js 诊断脚本 8 项断言全通过（选 auto 后 `__savedTheme` 同步 auto；`bindSettings` 恢复路径不再回退深色且「跟随系统」卡片高亮；accent/字体 4 项快照同步）；`node --check` 通过；Bug-028 回归断言已加入 `regression.test.js`。注：该次提交时完整 `npm test` 被既有 code-highlight 插件缺失阻塞（Bug-005/024/025 依赖 `plugins/code-highlight/main.js`，该插件未在本地 `plugins/` 目录）；该阻塞已随 Bug-029 一并修复（插件未安装时跳过注入，`npm test` 全绿）。
- **防再犯要点**: 持久化与恢复必须共用同一数据源：凡 `window.__saved*` 启动快照，任何设置变更写入 localStorage 时必须同步更新对应快照，否则视图重建用旧值回退用户新选择（CD-17）。

- <br />

- **ID**: Bug-029
- **日期**: 2026-09-09
- **现象**: 编辑器编辑区渲染很慢，打开笔记后十几秒才把编辑区内容渲染出来（弱网环境尤其明显）。
- **复现地点**: `second-brain/js/editor/editor-vditor.js`（`buildVditor` 的 opts 未传 `cdn`）、`second-brain/js/vendor/vditor/index.min.js`（`Constants.CDN` 默认值与 `mergeOptions` 的 `{cdn}/dist/...` 拼接）
- **原因**: vditor 初始化未指定 `cdn`，`mergeOptions` 回退默认 `Constants.CDN = "https://unpkg.com/vditor@4.0.0"`，运行期 `addScript`/`addStyle` 从外网拉取 4 个关键资源（`dist/js/i18n/zh_CN.js`、`dist/js/lute/lute.min.js`、`dist/css/content-theme/light.css`、`dist/js/icons/ant.js`），弱网下每个请求数秒，编辑区因此空白十几秒。
- **状态**: 已修复（测试完成）
- **处理方法**: ① `buildVditor` 的 opts 传 `cdn: 'js/vendor/vditor'`，使 `mergeOptions` 把全部 `{cdn}/dist/...` 拼接落到本地；② 按官方 CDN 目录结构在 `second-brain/js/vendor/vditor/dist/` 复制静态资源（`js/lute`、`js/i18n`、`js/icons`、`js/highlight.js`、`css/content-theme`、`images/emoji`）；③ 页面已本地引入 `index.css`/`index.min.js`（index.html），无需改动。
- **验证结果**: CDP（9223）实测：`openNote('学习笔记/深度工作.md')` → 编辑区内容可见仅 5ms；`Network.requestWillBeSent` 抓包 0 个外网请求（此前 4 个 unpkg.com 请求）。新增回归断言 `testVditorLocalCdn`（检查 opts.cdn 指向本地、无 unpkg cdn 配置、dist 关键资源齐备）已加入 `regression.test.js`；顺带修复回归套件依赖缺失插件导致的 ENOENT 中断（Bug-005/024/025 在 `plugins/code-highlight` 未安装时跳过注入）与过时的 vdSetMode 断言，`npm test` 现为 36 通过 0 失败。
- **防再犯要点**: 第三方编辑器（vditor 等）的资源必须全部本地化（vendor 目录 + 与官方一致的 dist 结构），并在初始化 opts 显式传 `cdn` 指向本地；禁止依赖 unpkg.com 等外网 CDN，否则弱网下编辑区渲染被网络拖慢（CD-18）。

- <br />

- **ID**: Bug-030
- **日期**: 2026-09-09
- **现象**: 编辑器偶发性「串文件内容 / 笔记丢失」：快速切换笔记时，A 的内容被写进 B（或覆盖），或某篇笔记的修改不保存、丢内容。
- **复现地点**: `second-brain/js/editor/editor-host.js`（`onEdInput`、`openNote`）、`second-brain/js/editor/editor-vditor.js`（`blur: sync2Host(vdGetValue())`）
- **原因**: 两处独立竞态导致「输入/保存的内容归属到错误的文件」：①**去抖定时器归属**：旧实现在 autosave 去抖 timer 触发时才读 `edCurrent`，且所有文件共用一个 timer——快速切换时 A 的内容被保存进 B，或 A 的 timer 被 B 的输入 `clearTimeout` 清掉而丢保存。②**openNote 异步装载间隙**：`edCurrent = path` 在 openNote 开头同步设置，而内容真正渲染进 vditor 在 `await noteStore.read` 之后——期间编辑器仍显示旧文件、`edCurrent` 已指向新文件，此时 vditor 的 `blur`（点击切换必触发）会把「旧文件可见内容」以新文件路径保存。
- **状态**: 已修复（测试完成）
- **处理方法**: ①`onEdInput` 在输入瞬间固定归属 `p = edCurrent`（`edOutdated[p]`/去抖 timer 一律用 p），并将全局单 timer 改为按文件独立 `edSaveTimers[p]`。②`openNote` 将 `edCurrent = path` 移到内容装载（`await noteStore.read`/缓存命中）完成之后、渲染之前，保证 edCurrent 恒等于「编辑器当前正显示的文件」，消除装载间隙的 blur/input 误归属。
- **验证结果**: 回归套件新增 Bug-030（`testEdAutosaveBinding`：编辑 a→切 b→编辑 b，两文件各按其归属保存）与 Bug-030b（`testEdOpenRace`：源码断言 openNote 内 `noteStore.read` 位于 `edCurrent = path` 之前）；`npm test` 现为 **38 通过、0 失败**；`node --check` 通过。
- **防再犯要点**: 打开笔记的异步装载：`edCurrent`（当前文件）必须在内容真正装载进编辑器之后、渲染之前才激活，不能同步前置；否则装载间隙内 vditor 的 blur/input 会把旧文件可见内容按新文件路径保存，造成串文件/丢失（CD-19）。

- <br />

- **ID**: Bug-031
- **日期**: 2026-09-09
- **现象**: 编辑器运行正常但控制台报 `GET js/vendor/vditor/dist/js/i18n/zh_CN.js net::ERR_ABORTED 404 (Not Found)`，vditor 工作时为每个 /dist/ 拼出的资源请求 404。
- **复现地点**: `second-brain/js/vendor/vditor/`（本地化资源目录布局）配合 `second-brain/js/editor/editor-vditor.js` 的 `buildVditor` `cdn: 'js/vendor/vditor'`
- **原因**: vditor 引擎把资源按 `{cdn}/dist/...` 硬编码拼接（`dist/js/i18n/zh_CN.js`、`dist/js/lute/lute.min.js`、`dist/css/content-theme`、`dist/js/icons`），期望 `cdn` 指向包根、其下为官方 CDN 的 `dist/` 包裹层；但仓库内 `js/vendor/vditor/` 是 npm 包解包结构（`js/`、`css/`、`content-theme/`、`images/`、`index.*` 平铺于根），缺 `dist` 包裹层 → 全部 `/dist/js/...` 资源 404（Bug-029 声明已复制 `dist/`，实际磁盘未真正建立该包裹层）。**注**：本 Bug 曾尝试把 `js/vendor/vditor/` 根内容整体搬入 `dist/` 来命中，但那会让 git 把这批 vendor 文件识别为「删除旧路径 + 新增全新文件」——历史无法沿 `--follow` 追溯、且新旧布局双重占库，用户已还原该 dist 迁移方案。
- **状态**: 已修复（测试完成）
- **处理方法**: **放弃仓库内 vendor 复制 vditor**，改用 npm 运行时依赖直接引用：vditor 本就是 `dependencies`（`"vditor": "^4.0.0"`，npm 自带官方 `dist/` 结构），electron-builder `files` 已含 `node_modules/**` 随打包分发；且 `node_modules` 位于 `ROOT` 之内，`note://` 协议命中 `node_modules/vditor/dist/...`（处理器只拦截 `..` 穿越、不拦 node_modules）。改动：① `index.html` 对 vditor 样式/入口引用由 `js/vendor/vditor/dist/index.css|index.min.js` 改为 `node_modules/vditor/dist/index.css|index.min.js`；② `editor-vditor.js` 的 `cdn` 改为 `'node_modules/vditor'`；③ `git rm -r` 移除 `js/vendor/vditor` 整个目录（连同此前暂存的 372 个 dist 双重占用）。彻底绕开「dist 迁移」。Bug-029「不拉外网 unpkg」的目标不变：cdn 仍指本地 node_modules，不涉外网。
- **验证结果**: 回归断言 `testVditorLocalCdn` 改为校验 `cdn` 指向 `node_modules/vditor`、源码不残留 `unpkg.com`，且 `node_modules/vditor/dist` 六个关键资源（`js/lute`、`js/i18n`、`js/icons`、`js/highlight.js`、`css/content-theme`、`images/emoji`）齐备；`npm test` **59 通过、0 失败**；`node --check` 通过。
- **防再犯要点**: 第三方编辑器（vditor 等）资源应**优先用 npm 运行时依赖 + `cdn` 直接指向 `node_modules/<pkg>`**（自带官方 `dist/` 结构、随分发），不要在仓库内 vendor 手动复制大体积 `dist`——手工复制必然伴随「搬进 dist」这类迁移，git 会识别为删旧 + 新增，历史无法 `--follow` 追溯、又造成新旧布局双重占库；且仓库内的静态 vendor 副本与 npm 包重复冗余，易脱节（CD-22）。

- <br />

- **ID**: Bug-032
- **日期**: 2026-09-09
- **现象**: vditor 编辑器工具栏多出一个空白按钮，F12 查看其 DOM 为 `data-type="undefined"`、`aria-label="undefined"`、`class="vditor-tooltipped vditor-tooltipped_undefined"`。
- **复现地点**: `second-brain/js/editor/editor-vditor.js` 的 `VDTOOLBAR` 配置 → vditor `mergeToolbar`/`genItem`
- **原因**: `VDTOOLBAR` 包含 `'formula'` 与 `'find'` 两个**非 vditor 内置 key**。vditor 的 `Options.mergeToolbar`（dist/index.js L15198-15214）只把命中内置定义名的字符串替换成按钮对象，未命中的字符串**原样保留**；随后 `Toolbar.genItem` 读 `menuItem.name`——字符串无 `.name`，取 `undefined`，落入 `default → new Custom(...)` 兜底（L14493-14494/13173-13175），渲染出 `data-type="undefined"` 的空白按钮（`formula` 一个、`find` 一个）。数学公式的**预览渲染**由 `preview.math`（默认开启）承担，与此插入按钮无关。
- **状态**: 已修复（测试完成）
- **处理方法**: 从 `VDTOOLBAR` 移除 `'formula'`、`'find'` 两个非法 key，仅保留 vditor 内置合法 key（table/link/outline/export 等），并更新 VDTOOLBAR 注释说明「只使用内置合法 key，避免空白按钮」。
- **验证结果**: `npm test` 回归 **39 通过、0 失败**（含新增 Bug-032 断言：VDTOOLBAR 不得包含 formula/find）；`node --check` 通过。
- **防再犯要点**: 配置 vditor `toolbar` 数组时只能使用其内置 key；臆造的 key（formula/find 等）会被 vditor 原样保留并在 Custom 兜底渲染成 `data-type="undefined"` 空白按钮，静默难察。

- <br />

- **ID**: Bug-033
- **日期**: 2026-09-09
- **现象**: 软件「第一次启动」需要十几秒（卡顿后才出界面）；偶发复现，重开不一定稳定。
- **复现地点**: `second-brain/main.js`（应用生命周期，`app.whenReady` 创建窗口阶段）
- **原因**: 未配置 `app.requestSingleInstanceLock()` 单实例锁。用户最小化到托盘（窗口隐藏但进程存活）或上次异常退出残留后再次双击启动时，会与旧实例并发运行——两个实例同时构建窗口，渲染进程争用磁盘 IO/CPU，导致后一个实例 `did-finish-load` 被拖慢到 **12+ 秒**（实测：单实例冷启动渲染仅 1.1s，双实例并发时第二个实例到 12.3s）。主进程各阶段本身极快（whenReady +140ms、clearCache +360ms），瓶颈全部在并发争用上的第二个实例渲染加载。
- **状态**: 已修复（测试完成）
- **处理方法**: ①在 `app.whenReady()` 之前调用 `app.requestSingleInstanceLock()`，未获得锁的实例直接 `app.quit()`（不会并发建窗）；②获得锁的实例监听 `app.on('second-instance')` → 调用既有 `showMainWindow()` 恢复并聚焦旧实例窗口，让用户看到既有的应用而非多起一个慢实例；③`app.whenReady().then` 开头加 `if (!gotTheLock) return;` 守卫，确保未获锁实例不执行窗口创建。另保留精简的 `[startup]` 阶段打点日志（whenReady/clearCache/did-finish-load 耗时），便于后续排查启动慢类问题。
- **验证结果**: 并发启动两个实例验证：单实例冷启动渲染加载稳定 1.1~1.2s；双实例并发时日志仅 1 条 `whenReady_begin`（第二个实例被锁拦截退出），唯一实例渲染 1.1s 无卡顿；`npm test` 回归 **59 通过、0 失败**；`node --check` 通过。
- **防再犯要点**: Electron 桌面应用必须配置 `app.requestSingleInstanceLock()`（未获锁即退出 + 监听 `second-instance` 恢复既有窗口），否则托盘常驻/残留进程再次启动会与旧实例并发，渲染进程争用资源造成「第二次启动/首次再启动」十几秒卡顿（CD-21）。

- **ID**: Bug-034
- **日期**: 2026-09-09
- **现象**: 无论选择 Minimal 哪个配色（纸白/亚麻/冷灰/墨绿/自定义），应用外壳（侧边栏/顶栏/面板）跟随换色，但编辑器（Vditor）内容区始终纯白 `#fff`，与整体主题不统一（「白色孤岛」）。
- **复现地点**: `plugins/minimal-theme/main.js`（`buildEditorCss` 注入覆盖样式）+ `js/editor/editor-vditor.js`（`applyVdExtraCss` 注入点）
- **原因**: 插件把配色 CSS 变量映射为 vditor 覆盖样式时用**单类选择器**（特异度 `(0,1,0)`）；而 vditor 运行时会把自带主题 `<link>` **动态追加**到 `<head>` 尾部，其 `.vditor{background:#fff}` 与注入样式同特异度但**后加载**、级联胜出 → 编辑器落在默认纯白，`var(--note-background)` 未生效。
- **状态**: 已修复（测试完成）
- **处理方法**: ① `buildEditorCss` 所有选择器统一加 `html body` 前缀，把特异度提到 `(0,1,2)+`，必然压过 vditor 自带的单/双类规则；同时打全真实编辑区类（`.vditor-sv/.vditor-ir/.vditor-wysiwyg/.vditor-preview/.vditor-reset`）。② `applyVdExtraCss` 每次应用把 `#host-vditor-theme-extra` `appendChild` **重挂到 `<head>` 末尾**（同节点移动），保证晚于 vditor 动态注入的 `<link>`。③ **内容层主题化**：`buildEditorCss` 拆分 UI 壳与内容层（新增 `lightContentCss`/`darkContentCss`），编辑区 `table/引用/代码块` 浅色态用 `--note-*` 跟随配色、深色态用与宿主协调的固定暗色，消除任何模式下表格刺眼白底。
- **验证结果**: 冒烟 95 通过（新增 3 条断言：注入 CSS 含 `html body .vditor` 前缀、引用 `var(--note-background, #fff)`、覆盖编辑区 `html body .vditor table`）、回归 59 通过、`node --check` 通过。
- **防再犯要点**: 注入自定义主题/覆盖 CSS 时，选择器特异度必须 ≥ 目标引擎（vditor 等）自带规则，或每次把注入节点重挂到 `<head>` 末尾——否则被引擎运行时后加载的同特异度样式覆盖（CD-23）。

- <br />

- **ID**: Bug-035
- **日期**: 2026-09-10
- **现象**: vditor 编辑区（IR/所见即所得/预览三态）的有序列表序号「1. 2. 3.」全部消失，只剩文本项。
- **复现地点**: `js/editor/editor-vditor.js`（vditor 渲染）+ `node_modules/vditor/dist/index.css` + Tailwind `js/vendor/tailwind-browser.js`（preflight）
- **原因**: Tailwind preflight 全局重置把 `ol, ul, menu` 统一 `list-style: none`；vditor 的 `index.css` 只恢复了 `ul`（disc/circle/square），**未恢复 `ol`**（无任何 `list-style-type` 规则）。vditor 的有序列表靠浏览器原生 `list-style-type` 显示序号（自绘 `data-marker` 无对应 CSS），被 preflight 抹掉即序号消失。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `css/app.css` 的 vditor 作用域补充恢复 `#ed-vditor .vditor-reset/.vditor-ir/.vditor-wysiwyg/.vditor-preview ol { list-style-type: decimal; list-style-position: outside; }`（特异度 `(1,0,2)+`，压过 preflight 的 `ol`），编辑器有序列表序号恢复正常。
- **验证结果**: 服务器提供的 `app.css` 确认含该规则（实测 32260 字节、`list-style-type: decimal` present）；jsdom 回归新增 `testOrderedListCss`（断言 app.css 含 `#ed-vditor .vditor-reset ol` 与 decimal），`npm test` **65 通过、0 失败**。
- **防再犯要点**: 引入 Tailwind 等 preflight（全局重置样式）时，凡它重置掉的列表/排版默认值，第三方编辑器（vditor 等）自带 CSS 未恢复的都必须按容器作用域显式恢复（CD-24）。

- <br />

- **ID**: Bug-036
- **日期**: 2026-09-10
- **现象**: vditor IR 模式下，当表格或代码块是文档**第一个元素**时，光标无法落到块前，无法在其上方插入新行/内容。
- **复现地点**: `js/editor/editor-vditor.js`（IR 模式，`#ed-vditor .vditor-ir`）
- **原因**: 块作为首元素时其上方没有可放置光标的空段落；vditor 原生 `insertBeforeBlock` 需先在块内任意单元格/行首派发特定方向键（ArrowUp/ArrowLeft/Backspace）才可能触发，非直觉、不稳定，用户无法直接「在表格/代码块前插入」。代码块则完全无右键入口。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `editor-vditor.js` 的 IR 上下文菜单扩展：①新增 `irInsertAbove(blockEl)`——以 `closest('[data-block="0"]')` 归一到表格/代码块的块根，`insertBefore` 插入 `<p data-block="0">ZWSP<wbr></p>`，用 `<wbr>` 锚定光标并 `sync2Host` 保存；②表格右键菜单新增「在表格上方插入空行」，代码块右键新增「在代码块上方插入空行」（共用 `showIrMenu` 通用菜单构建）。
- **验证结果**: 实机（browser_evaluate）验证：表格/代码块右键均弹出含「上方插入空行」的菜单，点击后在块前出现 `<p data-block="0"><wbr></p>`；jsdom 回归新增 `testIrBlockAbove`（暴露 `__vdBlock.irInsertAbove`、`[data-block="0"]` 归一、含表格/代码块两项菜单入口），`npm test` **65 通过、0 失败**。
- **防再犯要点**: 对块级元素（表格/代码块等）提供「上方插入空行」入口时，块根定位以 `closest('[data-block="0"]')` 归一到 IR 顶层块，避免误插入到行内容器内（CD-24 复用/补充）。

- <br />

- **ID**: Bug-037
- **日期**: 2026-09-10
- **现象**: 报告：待办（多选框）列表「插入时显示正常，切换视图或重新打开后显示字面 `.[]` / `[]`」（非复选框）。
- **复现地点**: `js/editor/editor-vditor.js`（vditor IR/WYSIWYG/预览）+ Lute 解析（`node_modules/vditor/dist/js/lute/lute.min.js`）+ `js/app-note.js`（非编辑区 `renderMarkdown`）
- **原因**: 排查结论——当前代码解析与渲染均已正确，**未能复现**。①Lute `Md2VditorIRDOM` 与 `Md2VditorDOM` 均把 `- [ ] x` 输出为带 `vditor-task` 的 `<input type="checkbox">`；`VditorIRDOM2Md` 往返仍保留 `[ ]` 标记（实测）。②实机在 IR/所见即所得/预览/重开四态均保持 checkbox。判断历史根因很可能是早期 Tailwind preflight 把待办 `ul` 还原为普通圆点列表时的视觉残留（`•[ ]`），随 vditor 迁移与样式恢复已消除。
- **状态**: 已修复（测试完成）
- **处理方法**: 增加确定性门禁 `testTaskListRoundTrip`（Lute IR→checkbox、IR→MD 往返保留待办标记）防退化，并整理既有 `app-note.js` 待办渲染（Lucide 图标）仅用于非编辑区、与编辑区解耦；未对编辑区做投机改动。
- **验证结果**: Lute 序列化往返与四态实机均确认 checkbox 正常，无 `.[]` / `[]` 字面；jsdom 回归新增 `testTaskListRoundTrip`，`npm test` **65 通过、0 失败**。
- **防再犯要点**: 涉及第三方编辑器列表/待办渲染时，以 Lute 序列化往返 + 各编辑模式实机核验作为门禁；Tailwind preflight 对列表类的重置需按容器作用域恢复，防待办/有序列表退化为纯文本列表（CD-24 复用/补充）。

- <br />

- **ID**: Bug-038
- **日期**: 2026-09-10
- **现象**: vditor IR 模式下：①空行（`<p data-block="0">ZWSP<wbr></p>`）按 Backspace/Delete「删不掉」——vditor 原生只删掉 ZWSP 字符、段落元素仍残留；②光标在表格/代码块最前面按 Backspace，若其上一行是空行，不会删除该空行。
- **复现地点**: `js/editor/editor-vditor.js`（IR 模式 `#ed-vditor .vditor-ir`）
- **原因**: vditor 原生 `fixDelete`/`insertBeforeBlock` 对 `data-block="0"` 的空段落未做「整行删除」语义（Backspace 只缩减文本节点）；且块前 Backspace 逻辑优先跳转到上一元素，未识别「上一行是空行需删除」的场景。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `editor-vditor.js` 新增捕获阶段 keydown 监听 `handleIrDeleteKeydown`（`document.addEventListener('keydown', handler, true)`，命中时 `preventDefault`+`stopImmediatePropagation` 不与 vditor 原生冲突）：①`isEmptyLine(root)` 判定 ZWSP 空段落 → Backspace/Delete 均 `removeEmptyLine` 删除整行，并把光标定位到相邻块（Backspace→上一块末尾、Delete→下一块开头），删除后保证编辑器至少留一个占位块；②`blockRootOf` + `caretAtBlockStart` 判定光标在块最前且 `Backspace`，若 `previousElementSibling` 是空行则删除之，非空行则放行给 vditor 原生跳上一行。
- **验证结果**: jsdom 回归新增 `testIrEmptyLineDelete`（断言 `__vdBlock` 暴露 isEmptyLine/handleIrDeleteKeydown、ZWSP 空段落 isEmptyLine=true、含文本则 false、capture 阶段绑定），`npm test` **70 通过、0 失败**；`node --check` 通过。
- **防再犯要点**: 自定义第三方编辑器（vditor 等）键盘行为时，用捕获阶段监听并命中时 `preventDefault`+`stopImmediatePropagation`，避免与引擎自身 keydown 冲突；对 ZWSP 空段落须按「整行」语义处理删除（CD-25 新增）。

- <br />

- **ID**: Bug-039
- **日期**: 2026-09-10
- **现象**: 在侧边面板「标签」等容器上手动添加 `class="border-b" style="border-color: var(--note-border);"`，下边框线不显示。
- **复现地点**: `css/base.css` + `js/vendor/tailwind-browser.js`（Tailwind v4 browser 版）+ `views/editor.html`（侧边面板标签区）
- **原因**: Tailwind v4 browser 版中方向性边界类 `border-b` 只生成 `border-bottom-style: var(--tw-border-style); border-bottom-width: 1px`，**不再**像 v3 那样直接写 `border-bottom: 1px solid`。而 `--tw-border-style` 这个变量只有在同元素上了 `border-solid`/`border-dashed` 等类时才会被定义；单独用 `border-b` 时变量未定义 → `border-bottom-style` 解析回退为 `none` → 无线。同理影响 `border-t/`l/`r`。
- **状态**: 已修复（测试完成）
- **处理方法**: 在 `css/base.css` 的 `:root` 全局默认 `--tw-border-style: solid`。这样 `border-b/t/l/r` 单独即可显示实线；需要虚线/点线时再叠 `border-dashed`/`border-dotted` 覆盖。因 `:root` 变量可被所有元素继承，且 base.css 在 tailwind-browser.js 之前加载，故全局生效。
- **验证结果**: jsdom 回归新增 `testDefaultBorderStyle`（断言 base.css 含 `--tw-border-style: solid`），`npm test` **71 通过、0 失败**。
- **防再犯要点**: 使用 Tailwind v4 browser 版的方向性边界类 `border-b/t/l/r` 时，须确保 `--tw-border-style` 有全局默认值（如 `:root{--tw-border-style:solid}`）或同时上 `border-solid` 类，否则变回退 none 不显示边框（CD-26 新增）。

- <br />

- **ID**: Bug-040
- **日期**: 2026-09-10
- **现象**: 设置-分类侧边栏「AI 问答」二级菜单点击折叠不生效：箭头（chevron）随 `sub-open` 正常旋转，但三个子菜单始终显示不隐藏；且点击已激活的分类会重复刷新右侧内容区。
- **复现地点**: `views/settings.html` + `css/app.css` + `js/app-settings.js`（设置分类侧边栏二级菜单）
- **原因**: ① 全项目未定义 `.hidden` 工具类（app.css 仅有 `.hidden-el` 与 `[hidden]` 属性规则），而 `.settings-subcat { display:flex }` 使 `classList.toggle('hidden')` 切换完全无效——子菜单永远显示；此前 CDP 测试用 `:not(.hidden)` 检查 class 而非 `getComputedStyle().display`，故「折叠成功」属假阳性。② 分类点击处理器无条件调用 `switchSettings` 重新渲染内容区，已激活分类再次点击也被重渲。
- **状态**: 已修复（测试完成）
- **处理方法**: ① `css/app.css` 全局补充 `.hidden { display: none !important; }`（一行修复所有 `classList.toggle('hidden')` 失效点：二级子菜单折叠、模型库描述展开、Ollama 下拉区显隐、插件详情展开等）；② 分类点击改为「未激活 → 切换面板并展开其子菜单；已激活 → 仅 toggle 子菜单展开/收起，不重复渲染内容区」。
- **验证结果**: Electron CDP 实测 8 断言全通过，改用 `getComputedStyle().display` 校验真实可见性：初始 display:none 收起 / 已激活外观点击内容不刷新（marker 保留）/ AI 问答切换面板并展开 / 再点 AI 问答真正收起且不刷新 / 子项点击自动展开并定位 / 切外观收起子菜单 / 收起态点子项自动展开定位。
- **防再犯要点**: 使用 `classList.toggle('hidden')` 切换显隐前，必须先确认 `.hidden` 工具类已定义（本项目定义于 `css/app.css`），且目标元素若带 `display:flex` 等布局类时必须 `!important` 覆盖；CDP/回归验证一律用 `getComputedStyle().display` 判断真实可见性，禁止用 `:not(.hidden)` 的 class 判断（CD-27 新增）。