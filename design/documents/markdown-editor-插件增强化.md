# Markdown Editor 插件增强化（从外壳 → 编辑器增强）

## Summary

把 `markdown-editor` 插件从「声明外壳」改造成「对编辑器的真正增强」：将 markdown 专属增强代码从宿主迁入插件目录，由插件注册编辑器 Provider 并承载右键菜单（插入图片 / 上传附件 / 在上方插入空行）、Markdown DOM↔Md 往返序列化、代码块语言选择器、WYSIWYG 块级编辑等增强能力；vditor 引擎仍留宿主做共享底座。

依据用户决策：**范围=增强层**（迁增强逻辑，不动 vditor 引擎）；**网页版=仅桌面为主**（页面版 `127.0.0.1:8000` 不加载目录插件，增强缺失可接受，仍可基本读写 md）。

---

## 当前状态分析

- 宿主 [editor-vditor.js](file:///d:/project/aiCode/second-brain/second-brain/js/editor/editor-vditor.js#L1265) 的 `registerVdProvider()` 以 `id:'markdown-editor'` 注册 Provider，承载 `.md/.markdown` 打开、`getMd: vdGetValue`、`renderWysiwyg`。
- 插件 [plugins/markdown-editor/main.js](file:///d:/project/aiCode/second-brain/second-brain/plugins/markdown-editor/main.js) 仅注册 `mde-*` actionKey 并委托宿主函数，无实质 md 代码。
- markdown 专属增强代码分散在宿主三处：
  - `js/editor/editor-md.js` — `inlineToMd`/`domToMd`（往返序列化）、代码块语言选择器（`ensureCodeLangPicker`/`showCodeLangPicker`/`applyCodeLang` 等）、WYSIWYG 块编辑（`selectWysBlock`/`appendWysTrailingP`）。
  - `js/editor/editor-vditor.js` — IR 模式右键菜单（`在上方插入空行`、`sbUploadAccept`、`irInsertAbove`）。
  - `js/app-editor-ctx.js` — WYSIWYG 右键菜单（`插入图片`/`附件`、`wysUploadBlockHtml`、`insertWysBlock`）。
- 插件加载：`js/app-plugins.js` 的 `loadDirPlugins()` 已支持 `manifest.scripts`（多个文件拼接为一段整体执行，共享闭包作用域）；同 id Provider 用 `registerEditorProvider` 去重（后注册覆盖）。

**关键约束**：网页版 `loadDirPlugins` 因无 `noteDesktop.plugins` 直接返回，不加载目录插件；宿主 `app-plugins.js` 还有一份 `markdown-editor` 内置 mock（L616）。因此桌面由插件接管、网页回退宿主默认，属用户已确认的可接受差异。

---

## 变更方案

### 原则
1. **桌面插件接管**：插件注册同 id `markdown-editor` Provider（异步加载晚于宿主注册 → 覆盖宿主），并承载全部 md 增强。
2. **宿主只留底座**：vditor 引擎、Provider 路由、打开/保存/模式逻辑不动；移除宿主内已迁走的 md 专属 UI 代码，避免双份。
3. **网页不崩溃**：宿主保留一份 `registerVdProvider` 兜底（仅 id/后缀/打开方式/getMd 委托 vdGetValue），使网页仍能以 vditor 打开 md；增强项（右键菜单/序列化/代码块选择器）在网页缺失可接受。

### 文件改动

#### 1. 新增插件源码模块（桌面插件本体，`manifest.scripts` 加载，与 `main.js` 共享闭包）
- **`plugins/markdown-editor/md-serialize.js`**：迁入 `inlineToMd`、`domToMd`、`mdToDom` 块渲染等往返逻辑（原 `editor-md.js` 对应函数）。函数级注释作者「火 冰」。
- **`plugins/markdown-editor/md-blocks.js`**：迁入代码块语言选择器（`ensureCodeLangPicker`/`anchorCodeLangPicker`/`filterCodeLangs`/`renderCodeLangList`/`applyCodeLang`/`showCodeLangPicker`/`hideCodeLangPicker`）与 WYSIWYG 块编辑（`wysBlockTags`/`clearWysBlock`/`selectWysBlock`/`appendWysTrailingP`）。
- **`plugins/markdown-editor/md-context.js`**：迁入右键菜单构建（插入图片 / 上传附件 / 在上方插入空行）、插入块 HTML（`wysUploadBlockHtml`/`irInsertAbove` 的“在上方插入空行”实现）、`sbUploadAccept` 上传类型过滤。
- **`plugins/markdown-editor/styles.css`**：迁入 `.mde-code-lang` 等插件自有样式（`manifest.styles` 声明自动注入）。
- **`plugins/markdown-editor/main.js`**：改为插件实现核心——
  - `PluginAPI.registerEditorProvider({ id:'markdown-editor', extensions:[.md/.markdown], openers/toolbar/sidebar（沿用 manifest）`, `buildContextMenu: md 右键菜单`, `getMd: window.vdGetValue`, `renderWysiwyg: ()=>''`, `open: 委托宿主 vditor 打开` })。
  - 保留/补充 `mde-toggle-source`、`mde-toggle-lineno`、`mde-toggle-wrap`、`mde-view-index`、`mde-delete`、`mde-open`。
  - 注册迁移而来的增强入口（插入图片/附件等）。
  - 出错边界沿用宿主 `PluginAPI.register` 统一包裹；脚本自身 try/catch 兜底。
- **`plugins/markdown-editor/manifest.json`**：新增 `scripts: ["md-serialize.js","md-blocks.js","md-context.js"]`、`styles: "styles.css"`，desc 改为增强化描述。

#### 2. 宿主收口（移除/回退已迁走的 md 增强）
- **`js/editor/editor-md.js`**：迁走 `inlineToMd`/`domToMd`/代码块语言选择器/WYSIWYG 块编辑后，仅保留宿主 WYSIWYG 兜底所需的最小 `domToMd`（或改为调用插件注册的全局桥 `window.sbMdBridge.domToMd`），避免网页回退路径 undefined。若确认网页不依赖则可整体删。
- **`js/editor/editor-vditor.js`**：移除 IR 右键菜单构建代码（`在上方插入空行`、`sbUploadAccept`、`irInsertAbove`）及其外层自定义菜单渲染；`registerVdProvider` 保留为网页兜底（不注册 buildContextMenu，或 buildContextMenu 返回空数组）。
- **`js/app-editor-ctx.js`**：移除 WYSIWYG 右键「插入图片/附件」「在上方插入空行」的宿主实现；改为回退到插件桥（未加载则无增强）。
- **`js/app-plugins.js`**：更新内置 mock（L616 `markdown-editor`）的 desc，与插件增强化描述保持一致（desktop 目录插件会覆盖）。

#### 3. 回归测试 / 文档（AGENTS 规则）
- **`regression.test.js`**：把原先 grep 宿主文件的增强断言改为 grep 插件目录文件（`plugins/markdown-editor/*.js`），并保证「网页宿主兜底仍含基本 md 注册」的断言。
- **`doc/需求/需求-编辑界面.md`**、**`doc/进度/进度-编辑界面.md`**：登记「markdown-editor 插件增强化」条目；完成后归档到进度历史。
- 若引入可复现 bug：按 `.hermes/bug-tracking.md` 登记 `doc/bugs/`，回填 CD 清单。

---

## 假设与决策

1. vditor 引擎留宿主，不迁；`window.vd*` 桥接函数（`vdGetValue` 等）视为宿主提供的稳定接口供插件调用。
2. 桌面与网页差异（网页缺增强）为已确认的可接受降级。
3. 同 id Provider 由「后注册覆盖」保证桌面插件接管；宿主 `registerVdProvider` 保留作网页/未加载插件时的兜底。
4. 迁移时逐函数保留签名与行为，不重构逻辑；注释作者统一「火 冰」。
5. `manifest.scripts` 拼接共享闭包——三个模块通过同一个「作用于插件作用域的导出对象」相互调用（如 `window.sbMdBridge = {...}` 或在 main.js 顶部组装），避免模块间作用域割裂。

---

## 验证步骤

1. 桌面版启动，插件正常加载（目录扫描加载 `main.js`+三个脚本+styles）。
2. `.md` 笔记在桌面：右键编辑区出现「插入图片 / 上传附件 / 在上方插入空行」菜单，IR 与 WYSIWYG 均可用；插入图片/附件后 markdown 正确写入、可往返还原。
3. 代码块语言选择器、WYSIWYG 块选中/块后回车仍正常。
4. 宿主导航、保存、模式切换（编辑/预览/分屏）不受影响。
5. 网页版 `127.0.0.1:8000` 仍能打开/编辑 md（基本能力），增强项缺失不报错。
6. `npm test` 通过（回归断言已指向插件目录）。
7. 完成后按归档规则把该功能从 `doc/开发进度.md` 看板移入 `doc/进度/进度-编辑界面.md`。