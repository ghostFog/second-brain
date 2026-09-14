# 插件设计：Git Sync（版本控制同步）· 增强设计

> 分类：sync | 状态：设计待评审
> 对应需求：`需求-平台规划.md`（GIT-09 ~ GIT-16）
> 关联宿主：`main.js`（git 白名单 IPC）、`preload.js`、`js/file-tree-ctx.js`、`js/app-plugins.js`
> 本文为**设计文档**，确认后再编码。

---

## 0. 现状与缺口（设计起因）

### 已实现（第一轮）
- 宿主：`git:run` / `git:check` / `vault:cloneGit` IPC + 子命令白名单（`init/status/add/commit/log/show/diff/remote/push/pull/rev-parse/ls-files/ls-remote/config/checkout`），execFile 非 shell，cwd 锁定知识库根。
- 插件：命令面板命令（提交/历史/还原/同步/自动提交/设置/从Git打开）、Ribbon 图标（未初始化时引导 `git init`）、设置弹框、历史弹框（含 Diff / 还原到此）、自动提交定时器。

### 现状缺口（本次要解决的）
1. **入口发现性差**：用户感知「只有 Ribbon 图标」，命令面板命令未被注意到；文件树右键**根本不会出现 Git 项**。
2. **根因 A（右键不出现）**：`pluginManager.getContextMenus(slot)` 只在 `app-editor-ctx.js` 消费了 `'editor'` slot；`file-tree` 与 `file-tree-folder` slot 定义的插件菜单从未被文件树右键处理器合并进来。
3. **根因 B（单文件无目标路径）**：文件树右键菜单动作 `spec.action()` 不传参，插件拿不到被右键的笔记路径。
4. **还原不彻底**：`git checkout <hash> -- .` 只覆盖/恢复**已跟踪**文件；该版本之后**新增**的未跟踪文件与空目录会残留，导致工作区与该版本不完全一致。
5. **历史无改动文件**：历史弹框仅 `git log` 一行一条，不展示每次提交改了哪些文件。
6. **无常驻状态**：只有点 Ribbon 才有 toast，无持续性 Git 状态指示（分支/待提交数/未初始化）。

---

## 1. 需求清单（GIT-09 ~ GIT-16，确认后登记）

| 编号 | 功能点 | 说明 |
| ---- | ---- | ---- |
| GIT-09 | 入口并联 | 命令面板 + 文件树右键 + 常驻状态条三处暴露 Git 全部能力，消除「只有 Ribbon」 |
| GIT-10 | 单文件历史/还原 | 文件树右键单篇笔记：「查看此文件历史」「还原此文件到版本」，互不影响库整体历史 |
| GIT-11 | 还原彻底性 | 还原到版本时**可选**清理该版本之后新增的未跟踪文件/空目录，保证工作区与版本完全一致 |
| GIT-12 | 历史改动文件 | 历史列表每条提交展示改动文件清单，可点某文件查看该次提交的具体 Diff |
| GIT-13 | 常驻 Git 状态指示 | ~~底部常驻状态条显示「分支 · 待提交数 · 是否未初始化」，点击可操作~~ **已取消**：左下贴边状态条遮挡目录区；状态反馈收敛到 GIT-14（文件变动即时调色） |
| GIT-14 | 目录树状态着色 | 文件树按 Git 工作区状态着色区分：**新增（未跟踪）/ 加入跟踪（暂存）/ 修改 / 未变动**；目录用宿主默认色；渲染即带状态色、无补色闪烁 |
| GIT-15 | 过滤设置（编辑 .gitignore） | 自动提交忽略指定路径：设置弹框可编辑当前库根 .gitignore，被忽略路径不进自动提交 |
| GIT-16 | 实时提交 & Ribbon 同步 | ①实时提交：文件变动即提交本地仓库（不等定时），关闭则不执行；②Ribbon 改为同步：未初始化→确认后 git init，已初始化→提交 |

---

## 2. 设计

### 2.1 命令层（沿用 git:run 白名单，仅 1 处宿主扩展）

| 场景 | git 命令 | 白名单状态 |
| ---- | ---- | ---- |
| 库历史（含单文件） | `log --format=... --name-status` / `log --oneline -- <path>` / `log --follow -p -- <path>` | ✅ log 已在 |
| 库级还原 | `checkout <hash> -- .` | ✅ checkout 已在 |
| 单文件还原 | `checkout <hash> -- <relPath>` | ✅ checkout 已在 |
| 单文件差异 | `show <hash> -- <relPath>` / `diff <hash>^ <hash> -- <path>` | ✅ show/diff 已在 |
| 清理未跟踪文件（还原彻底性） | `clean -fd`（交互经删除固定路径，见 2.3） | ❌ **需新增 `clean` 入白名单**（host 改动） |

> 约束：任何 `-- <path>` 的路径由插件基于知识库根拼接的相对路径，传参非 shell，无注入面；路径统一用正斜杠相对库根。

### 2.2 入口并联（host 改动）

**a) 文件树右键挂载插件菜单（解决根因 A）**
位置：`js/file-tree-ctx.js` 的 `bindFileTreeContextMenu` 笔记分支（`noteNode` 命中，已有 `targetPath`）。
在 schema 里增加：`'-'` 分隔线后合并 `pluginManager.getContextMenus('file-tree')`。

**b) 把目标路径暴露给插件（解决根因 B）**
在弹菜单前设置全局 `window.__pluginCtxNote = targetPath`，关闭菜单后清空；
插件单文件菜单动作从该全局读取 `relPath`（相对库根），并以其打开专用弹框。
（`file-tree-folder` slot 同理挂到目录分支，`__pluginCtxFolder` 传目录相对路径。）

**c) 命令面板**：现有 manifest `commands` 已注册即出现于命令面板（无需改动），本次仅增补单文件相关命令（打开的是「当前打开笔记」的历史/还原）。

### 2.3 还原彻底性（GIT-11）

- 默认仍是 `git checkout <hash> -- .`（覆盖已跟踪文件，不动 HEAD/历史，符合「不管理分支」）。
- 新增复选：`还原到此版本` 时，弹框询问是否**一并清理该版本之后新增的未跟踪文件与空目录**。
  - 清理 = `git clean -fd`（作用于库根；交互先经 `confirm`，命令里加 `--` 杜绝参数歧义）。
  - 说明文案明示「将删除所有未纳入版本控制的新文件/空目录」，避免误删。
- 单文件还原同理：`checkout <hash> -- <relPath>`，不清理（单文件版本回滚不涉及整库未跟踪清理）。

### 2.4 历史列表改动文件（GIT-12）

- 开历史弹框改为：`git log --format=%H%x1f%s%x1f%ad%x1f%an --name-status -20`。
- 解析：提交行 + 其下改动记录（`M/A/D/… 路径`），按提交聚合。
- 每条提交行展开显示该次改动的文件清单（绿色 `D 路径` 用改动标记标识）；
  清单内文件可点 → 该文件的本次差异（`git show <hash> -- <relPath>` 的纯 `-/+` 文本，截断展示）。
- 库级结构与单文件历史共用同一 `historyModal(source)`；`source='vault'|'file'`。

### 2.5 常驻 Git 状态指示（GIT-13）· 已取消

- **已取消**：左下贴边常驻状态条遮挡目录区。状态反馈收敛到 §2.7 目录树状态着色——监听 `#file-tree` 重绘作为「有变动」信号，文件变动后即时刷新目录树颜色（GIT-14/GIT-16）。
- 原实现（`ensureStatusBar` / `.gitsync-statusbar` 样式）已删除，不再注入左下 chip。

### 2.6 manifest 变更（插件）

```json
"commands": [
  { "icon": "file-history",  "label": "Git: 查看当前笔记历史", "actionKey": "git-file-log" },
  { "icon": "undo-2",        "label": "Git: 还原当前笔记到版本…", "actionKey": "git-file-revert" }
],
"contextMenus": {
  "file-tree": [
    { "label": "Git: 查看此文件历史", "icon": "history",  "actionKey": "git-file-log" },
    { "label": "Git: 还原此文件到版本…", "icon": "undo-2", "actionKey": "git-file-revert" }
  ]
}
```
新增 actionKey 与动作：
- `git-file-log`：目标=全局 `__pluginCtxNote`（右键）或 `edCurrent`（命令面板）→ 单文件历史弹框。
- `git-file-revert`：目标同上 → 单文件版本列表弹出，选中确认后 `checkout <hash> -- <relPath>`。
- 原 `git-log` / `git-revert` 保留（库级）；Ribbon 由 `git-status`（查询）改为 `git-sync`（同步：未初始化→确认 init，已初始化→提交并按需推送）。

### 2.7 目录树状态着色（GIT-14）

- **数据源**（均已在白名单，无需新增宿主命令）：
  - `git status --porcelain -z` → 变更文件集（`??`=未跟踪；首列非空=A/M/D/R=暂存；次列=M/D=工作区改动）。
  - `git ls-files` → 已跟踪全集；`未变动` = 已跟踪 ∩ 未在 status 出现。
- **状态定义与优先级**（同文件互斥，按序取最高；配色对齐 IntelliJ IDEA 深色模式）：

  | 状态 | 判定 | 颜色 |
  | ---- | ---- | --- |
  | 新增（未跟踪 unversioned） | `??` | 红/橙（red/orange） |
  | 加入跟踪（add to VCS，暂存） | A / M / D / R（首列非空） | 绿 |
  | 修改（工作区改动） | 次列 M / D | 蓝 |
  | 未变动（已跟踪且干净） | ls-files 命中且 status 未出现 | 默认 |

- **着色对象**：遍历 `#file-tree [data-path="相对库根"]`，依映射给节点加状态 class（`gs-untracked / gs-staged / gs-modified`；干净不加）；路径大小写终审按库根相对路径归一。
- **目录着色**：目录不单独着色，使用宿主默认色；含变更目录不加色标（避免橙黄干扰整体视觉）。
- **渲染时着色（防闪烁）**：宿主 `renderFileTree` 渲染 `.tree-file` 时读取插件维护的全局映射 `window.__gsColoring`，直接在拼接的 class 中带上 `gs-untracked/staged/modified`，渲染即带状态色、无「先灰白再补色」闪烁；已打开（高亮）节点不上状态色，保持白字。插件在状态周期（30s）/git 动作后更新映射，并对已渲染 DOM 就地兜底补/改 class；插件另监听 `#file-tree` 重绘作为「有变动」信号，文件变动后即时刷新目录树颜色（GIT-14/GIT-16）。
- **失败降级**：非仓库 / 未安装 git / 状态读取失败 → 清空所有状态 class，不干扰默认样式。

---

## 3. 宿主改动清单

| 文件 | 改动 | 说明 |
| ---- | ---- | ---- |
| `main.js` | `GIT_ALLOWED_SUBCMDS` 增加 `'clean'` | 还原彻底性所需（仅经 `confirm` + `--` 使用） |
| `js/file-tree-ctx.js` | 笔记/目录分支合并 `getContextMenus('file-tree'/'file-tree-folder')` + 设置 `__pluginCtxNote`/`__pluginCtxFolder` | 打通右键入口 + 传目标路径 |
| `preload.js` | 无需改动 | git:run/check 已够用 |

目录树着色（GIT-14）复用现有 `status` / `ls-files` 白名单，**无需新增宿主命令**；着色在插件侧对 `#file-tree [data-path]` 增删状态 class 完成。

插件侧全部改动集中在 `plugins/git-sync/main.js` + `styles.css` + `manifest.json`，无新宿主 API。

---

## 4. 实施步骤（先宿主后插件）

1. 宿主：`main.js` 白名单加 `clean`。
2. 宿主：`file-tree-ctx.js` 合并插件菜单 + 注入目标路径。
3. 插件：新增单文件历史/还原 action + 弹框；历史弹框改 `--name-status` 并展示改动文件；还原增加清理复选；目录树状态着色 + 实时提交（监听文件树重绘即时调色/提交）。
4. 文档：登记 `GIT-09..14` 到 `需求-平台规划.md`、`开发进度.md` 看板；更新 `doc/plugins/git-sync.md`、`doc/plugins/index.md`。
5. 测试：回归 `npm test`；临时目录验证 `clean -fd`、`checkout -- <file>`、`log --name-status`、`status --porcelain -z` + `ls-files` 解析语义；文件树右键入口与目录树着色待手动验证。

---

## 5. 风险

- **`clean -fd` 具删除性**：仅限还原弹框显式确认，且 `confirm` 文案明示；不自动执行。
- **右键目标路径全局变量**：弹菜单到实际点击间的隔离窗口期极短、可接受；菜单关闭即清空，防串库。
- **历史 `--name-status` 无 `--follow`**：重命名/移动的历史不做 `--follow` 追踪，避免库级性能开销；单文件历史可单独用 `--follow`。
- **着色目标=`data-path` 相对库根**：文件树渲染样式/类名若有变（宿主升级），着色可能失效；降级为不改默认样式，不影响使用。
- 交互（右键菜单、目录树着色）无法自动化回归，标注「待手动验证」。

---

> **评审点**：
> 1. 文件树右键挂钩 + 目录树即时（文件变动）着色是否接受？
> 2. `clean -fd` 默认不勾选、由用户显式选择，是否 OK？
> 3. 目录树状态着色对齐 IntelliJ IDEA 深色：
>    **新增(未跟踪)=红/橙 / 加入跟踪(暂存)=绿 / 修改=蓝 / 未变动=白**，色语义 OK 吗？目录聚合只加细点不整块变色，可否？
> 确认后我登记需求并编码。