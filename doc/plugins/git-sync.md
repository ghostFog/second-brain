# 插件规划：Git Sync（版本控制同步）

> 优先级：P3 | 分类：sync | 依赖宿主 API：shell（ChildProcess）、vault.read、notes.*

***

## 1. 功能概述

为笔记库提供 Git 版本控制能力：提交变更、拉取远程、推送、查看历史、还原段落。

### 核心功能

| 功能 | 说明 |
|------|------|
| 一键提交 | 扫描 vault 下的变更（git status），自动生成提交信息 |
| 拉取/推送 | 从远程仓库同步 |
| 历史查看 | 右键文件树 → "查看历史"，弹出版本列表 + diff |
| 段落还原 | 编辑器右键 → "还原此段落"，对比历史版本还原选中内容 |
| 自动定时提交 | 可配置每 N 分钟自动 commit（仅本地，不自动 push） |
| 状态栏指示 | 宿主状态栏显示当前分支 + 变更数 |

***

## 2. manifest.json

```json
{
  "name": "Git Sync",
  "id": "git-sync",
  "author": "Vinadon",
  "icon": "git-branch",
  "color": "#22C55E",
  "cat": "sync",
  "desc": "Git版本控制同步，为笔记库提供完整的版本历史与分支管理。",
  "version": "1.0.0",
  "main": "main.js",
  "permissions": ["shell.exec", "vault.read", "notes.read"],
  "ribbon": {
    "icon": "git-branch",
    "title": "Git Sync"
  },
  "commands": [
    { "icon": "git-commit", "label": "提交当前变更",   "actionKey": "git-commit" },
    { "icon": "git-pull",   "label": "拉取最新",      "actionKey": "git-pull" },
    { "icon": "git-push",   "label": "推送到远程",    "actionKey": "git-push" },
    { "icon": "git-branch", "label": "切换分支...",   "actionKey": "git-branch" },
    { "icon": "history",    "label": "查看变更历史", "actionKey": "git-log" },
    { "icon": "settings",   "label": "Git 设置...",  "actionKey": "git-settings" }
  ],
  "contextMenus": {
    "file-tree": [
      { "label": "Git: 查看历史",    "icon": "history",  "actionKey": "git-history" }
    ],
    "editor": [
      { "label": "Git: 还原此段落",  "icon": "undo-2",   "actionKey": "git-revert-selection" }
    ]
  }
}
```

***

## 3. 宿主 API 依赖（需新增）

| API | 状态 | 说明 |
|-----|------|------|
| `shell.exec(cmd, cwd)` | ❌ 需新增 | 插件执行 git 命令的 IPC 桥接（preload.js → main.js `shell.exec`） |
| `vault.getRoot()` | ✅ 已有 | 获取 vault 根路径作为 git 工作目录 |
| `notes.read(path)` | ✅ 已有 | 读取笔记内容用于段落还原的 diff 对比 |

***

## 4. 技术要点

1. **宿主侧改造**：Git Sync 插件必须在 main.js 新增 `shell.exec` IPC（安全白名单限制 git 命令）
2. **git 命令白名单**：只允许 `git status` / `git add` / `git commit` / `git pull` / `git push` / `git log` / `git diff` / `git checkout`
3. **提交信息**：自动格式 `auto: YYYY-MM-DD HH:mm vault: N 个文件变更`，用户可编辑
4. **SSH/HTTPS 凭据**：不处理，交给宿主系统 git credential manager
5. **历史还原**：`git log --follow -p -- <file>` 拿 diff，用户选中段落 → `git show <hash>:<file>` 拿历史版本 → diff-match-patch 对比还原
6. **后台定时器**：自动定时提交用 `setInterval`，注意 Electron 退出时清理

***

## 5. 实现步骤（先宿主后插件）

1. **宿主侧（必做）**：
   - preload.js 新增 `shell.exec(cmd, cwd)` 桥接
   - main.js 新增 `shell:exec` IPC handler，内置 git 命令白名单
   - 插件 API 注入时给 Git Sync 插件开放 `shell.exec` 权限
2. **插件侧**：
   - 创建 `plugins/git-sync/manifest.json`
   - 创建 `plugins/git-sync/main.js`（所有 actionKey 的实现）
   - 创建历史查看面板 + diff 展示（可用 diff2html 或自绘）
3. **测试**：
   - 空 vault 初始化 git → 首次 commit → 验证
   - 有远程仓库 → pull/push 验证（需要用户配置 remote）
   - 段落还原 → 选中一段文字撤销 → 验证
4. **风险评估**：
   - Git Sync 是 P3，因为**依赖宿主新增 shell.exec 权限**，而这涉及安全边界设计（白名单命令、禁止 shell 注入、cwd 限制在 vault 内）
