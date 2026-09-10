# 历史 Bug 追踪规范

> 与 `.hermes/design.md`、`.hermes/progress.md` 职责一致：本文件仅协定**规则与模板**，不承载实际记录；实际 Bug 记录落盘 `doc/历史Bug记录.md`（仅数据）。

## 触发条件

对话内容包含 bug 语义即登记：如「报错」「bug」「异常」「崩溃」「坏」「bug 报告」「修复」等。

## 状态枚举

`待定位` → `已定位` → `处理中` → `已修复（测试完成）` → `已关闭`

- 记录创建时必须填 `待定位`（或更高，如已能初步定位）。

- 问题定位运行时改为 `已定位` / `已处理`，问题处理并测试通过后改为 `已修复（测试完成）`。

- 一条记录**必须同时含状态与处理方法**，不得只留「待定位」。

## 去重规则

按「现象」或「复现地点」匹配已有记录；命中则更新该条，不重复新增。

## 记录模板

| 字段   | 说明            | 必填   |
| ---- | ------------- | ---- |
| ID   | Bug-XXX（递增编号） | 是    |
| 日期   | 发现日期          | 是    |
| 现象   | 问题描述 / 报错信息   | 是    |
| 复现地点 | 模块 / 文件 / 页面  | 是    |
| 关联会话 | 会话上下文（可选）     | 否    |
| 原因   | 根因分析          | 定位后填 |
| 状态   | 见状态枚举         | 是    |
| 处理方法 | 修复方案与改动内容     | 是    |
| 验证结果 | 测试与验证结论       | 处理完填 |
| 防再犯要点 | 根因对应的通用编码约束（禁止/必须），回填到下方防再犯清单 | 处理完填 |

## 防再犯清单（已沉淀的通用约束，编码时须规避）

> 修复 bug 时把根因提炼成 Don't/Do，登记到此处；编码命中这些模式即规避，避免同类问题再犯。编号 CD-（checklist don't/do）。新条目追加到末尾。

| 编号 | 类型 | 约束 | 来源 Bug |
| --- | --- | --- | --- |
| CD-01 | 禁止 | 不要用原生 `window.prompt` / `confirm` 弹窗（Electron 调用即抛错）——统一用 `window.inputModal` / `noteDesktop.confirm` | Bug-004 |
| CD-02 | 必须 | 操作可能被摘除（detached、`parentNode`=null）的 DOM 节点前，先判 `parentNode`/`isConnected` 再 `insertBefore`/`appendChild` | Bug-005 |
| CD-03 | 必须 | 视图重建（loadView 重入）+ 切回时，tab/编辑区需补渲染，不能只在首次分支渲染 | Bug-001 |
| CD-04 | 必须 | 遍历/收集节点的循环（`while (node.firstChild)` 等）必须边取边移除（`removeChild`），否则 `firstChild` 恒存在会死循环/数组无限增长 | Bug-008 |
| CD-05 | 必须 | 子菜单等浮动层依赖鼠标跨越空隙展开展收时，不能只靠 CSS `:hover`（空隙处会瞬间收起）——需 JS `mouseenter/mouseleave` + 延迟收起桥接空隙 | Bug-008 |
| CD-06 | 必须 | 编辑器块级插入（WYSIWYG 的 `<pre>/<table>` 等）必须落到 `#ed-wysiwyg` 顶层（当前顶层块之后的兄弟），不能嵌进 `<p>` 等行内容器，否则 `domToMd` 只认顶层块会还原错乱 | Bug-009 |
| CD-07 | 必须 | 代码块语言标签只保留一处承载：语言写入 `<pre data-lang>`（供序列化还原），不要在 `<pre>` 前再输出可见的 `.code-lang` 幽灵标签；同一信息不重复展示，渲染与 `applyCodeLang` 两端保持一致 | Bug-018 |
| CD-08 | 必须 | Markdown 管道表格单元格序列化时须去掉 `\n`（含空占位 `<br>` 归一为空串）——Markdown 表格单元格不能含换行，否则 `domToMd` 会拼出 `| \n | \n |` 的多行空单元格 | Bug-019 |
| CD-09 | 必须 | 凡是 `wys.innerHTML = rwRender(md)` 重建所见即所得内容的路径都必须紧跟 `appendWysTrailingP(wys)`（只在首次渲染/`renderArticle`不够）；渲染与插入的空表格单元格统一用 `<br>` 占位，且给 td 留最小高度，保证空行不塌缩 | Bug-020 |
| CD-10 | 必须 | WYSIWYG「单击=整块选中锁编辑」只适用于代码块这类需按源码编辑的块；表格等需要逐格编辑的块不得在单击时整块锁定，否则光标被弹回块前无法输入（拖拽/删除另走 dragstart/右键） | Bug-021 |
| CD-11 | 必须 | 特殊块(TABLE/PRE/BLOCKQUOTE/HR)由于「单击不整选中」，其后的空占位段按 Backspace 必须由编辑器接管为「一次删除前一块」，不能依赖原生 contenteditable（会变成移光标→选中→删三连） | Bug-022 |
| CD-12 | 必须 | WYSIWYG 编辑区内各块（尤其表格）的可视样式（如格线）必须在宿主 CSS 里给 `#ed-wysiwyg` 一层兜底（用 `var(--note-*)` 变量），不能只依赖插入/渲染各自生成的行内样式，否则任一路径差异都导致整体"空白" | Bug-023 |
| CD-13 | 必须 | 所有「复制到剪贴板」的实现都要走 Clipboard API + 失败回退 `document.execCommand('copy')` 并给用户反馈（成功对勾/失败 toast），不能只 `writeText().then()` 无 `.catch`——Electron / `note://` 下 Clipboard API 常被拒，否则静默复制失败（markdown-editor `wysCopyBlock` 与 code-highlight 复制按钮同策略） | Bug-024 |
| CD-14 | 必须 | 右键菜单针对「焦点/光标所在元素」的操作，目标定位必须取自右键命中信息（如 `resolveWysHit` 的 `hit.cell`），不能依赖 `document.getSelection()`——右键不移动光标/选区，选区常停在别处，会退化成默认值（如表格行列增删固定到最左列/首行）；命中信息沿 右键委托 → 菜单 schema(action 闭包) → 操作函数参数 链路显式传递 | Bug-025 |
| CD-15 | 必须 | vditor（及同类第三方编辑器）的 `after`/事件回调若需调用实例方法，必须用闭包捕获的实例引用（`inst || vdInst`）显式调用，不能依赖回调内 `this`——vditor 源码对触发类回调是平调用（`mergedOptions.after()`），`this` 指向 window，`this.setValue` 会抛 TypeError 导致补渲失败、编辑区空白 | Bug-026 |
| CD-16 | 必须 | 视图重建（`loadView` 重入）时，若该视图承载拥有模块级实例/引用的第三方编辑器（vditor 等），切离该视图前必须显式销毁并清空模块级实例引用（如 `vdDestroy`），否则切回时 `ensureVd`（`if (!vdInst)`）不会在新 DOM 上重建而留白 | Bug-027 |
| CD-17 | 必须 | 持久化与恢复必须共用同一数据源：凡 `window.__saved*` 启动快照（主题/强调色/字体等），任何设置变更写入 localStorage 时必须同步更新对应快照，否则视图重建（`bindSettings` 用 `window.__savedTheme || 'dark'` 恢复）会用旧值回退用户新选择 | Bug-028 |
| CD-18 | 必须 | 第三方编辑器（vditor 等）的资源必须全部本地化（vendor 目录 + 与官方一致的 dist 结构），初始化 opts 显式传 `cdn` 指向本地；禁止依赖 unpkg.com 等外网 CDN，否则弱网下编辑区渲染被网络拖慢 | Bug-029 |
| CD-19 | 必须 | 打开笔记等异步装载流程里，「当前文件」状态（如 `edCurrent`）必须在内容真正装载进编辑器之后、渲染之前才激活，不能同步前置；否则装载间隙内编辑器 blur/input 事件会把旧文件可见内容按新文件路径保存（串文件/丢失）。同时自动保存去抖 timer 必须按文件独立并捕获输入瞬间归属的文件 | Bug-030 |
| CD-20 | 必须 | 配置第三方编辑器（vditor 等）的 `toolbar` 数组只能使用其**内置合法 key**；臆造/臆想的 key（如 `formula`、`find`）会被 vditor 原样保留并在 `Custom` 兜底渲染成 `data-type="undefined"` 的空白按钮，静默难察。新增 key 前先到 `node_modules/vditor/dist/index.js` 的 `genItem`/`mergeToolbar` 核对 | Bug-032 |
| CD-21 | 必须 | Electron 桌面应用必须配置 `app.requestSingleInstanceLock()`：未获得锁的实例直接 `app.quit()`（不并发建窗），获得锁的实例监听 `second-instance` 恢复既有窗口；且 `whenReady` 开头用 `if (!gotTheLock) return;` 守卫。否则托盘常驻/残留后再次启动会与旧实例并发，渲染进程争用资源造成「再启动十几秒卡顿」 | Bug-033 |
| CD-22 | 必须 | 第三方编辑器（vditor 等）资源优先用 **npm 运行时依赖 + `cdn` 直接指向 `node_modules/<pkg>`**（npm 包自带官方 `dist/` 结构、electron-builder 随分发），**禁止在仓库内手动 vendor 复制大体积 `dist`**：手工复制必然伴随「把仓库文件搬进 dist」这类迁移，git 会把它识别为删除旧路径 + 新增全新文件，历史无法 `--follow` 追溯、又造成新旧布局双重占库；静态 vendor 副本与 npm 包重复冗余易脱节。资源必须本地化，不得依赖 unpkg 等外网 CDN | Bug-031 |
| CD-23 | 必须 | 注入 `<head>` 的自定义主题/覆盖 CSS，选择器特异度必须 ≥ 第三方编辑器（vditor 等）自带规则（如加 `html body` 前缀），或每次应用把注入 `<style>` 重挂到 `<head>` 末尾——否则会被引擎运行时**动态后加载**的同特异度样式覆盖，覆盖失效（编辑器落回默认纯白、主题不统一） | Bug-034 |
| CD-24 | 必须 | 引入 Tailwind 等 preflight（全局重置样式）时，凡它重置掉的排版默认值（`ol/ul` 的 `list-style` 等），第三方编辑器（vditor 等）自带 CSS 未恢复的必须按容器作用域显式恢复（如 `#ed-vditor .vditor-reset ol{list-style-type:decimal}`），并补回归断言；对待办列表类渲染以 Lute 序列化往返 + 各编辑模式实机作门禁，防退化为普通 `[ ]` 文本 | Bug-035 / Bug-036 / Bug-037 |
| CD-25 | 必须 | 自定义第三方编辑器（vditor 等）键盘行为（Backspace/Delete/Enter 等）时，用捕获阶段监听（`document.addEventListener('keydown', h, true)`）并在命中场景 `preventDefault`+`stopImmediatePropagation`，不与引擎自身 keydown/undo 冲突；对 ZWSP 空段落（`<p data-block="0">ZWSP<wbr></p>`）的删除须按「整行」语义处理（删段落并定位光标到相邻块），而非仅删文本节点 | Bug-038 |
| CD-26 | 必须 | 使用 Tailwind v4 browser 版的方向性边界类 `border-b/t/l/r` 时，须确保 `--tw-border-style` 有全局默认值（如 `:root{--tw-border-style:solid}`）或同时上 `border-solid` 类，否则 `border-*-style` 解成 `var()` 未定义→回退 none 不显示边框 | Bug-039 |
| CD-28 | 必须 | 首屏恢复持久化外观/主题须双层处理避免明暗闪烁：①HTML 层在 `<head>` 的 CSS 引用之前放首帧同步脚本，按 `localStorage` 预置 `<html>` class（light/dark，`auto` 用 `matchMedia`），且 `<html>` 不得硬编码与用户设置冲突的主题属性；②主进程 `BrowserWindow` 设了 `backgroundColor` 时，必须 `show:false` + 监听 `ready-to-show` 后再 `show()` 并留超时兜底（防渲染异常白窗），否则窗口背景会抢在页面浅色首帧前露出深色 | Bug-041 |
| CD-29 | 必须 | 首屏「渲染前恢复主题」须覆盖所有主题维度（宿主明暗 + 插件配色），前置到 head 且挂在同一元素 `<html>`；任何配色的变量取值应落在宿主同步资源（如 `js/theme-palettes.js` 的 `window.SB_PALETTES`）并在 head 同步引用，不得依赖插件异步注入的样式（styles.css 常晚于插件 js 执行），否则「清 head 前置变量→样式未就绪→闪宿主默认色」再闪回 | Bug-043 |

## 维护要求

- 新 Bug 在 `doc/bugs/Bug-NNN.md` 中新建（编号递增、复用记录模板字段），并在 `doc/历史Bug记录.md`（Bug 索引）与 `doc/bugs/index.md` 同步登记一行摘要+状态；不删除历史记录，不改变既有编号。

- `doc/历史Bug记录.md` 仅作**索引**，不再承载完整正文；完整记录落点在 `doc/bugs/Bug-NNN.md`（每条独立成文，无需空行分隔）。

- 问题定位、处理、验证每推进一档，同步回填子文件中的「状态」「原因」「处理方法」「验证结果」。

