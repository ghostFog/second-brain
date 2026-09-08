# 插件规划：Code Highlight（代码语法高亮增强）

> 优先级：P1 | 分类：editor | 依赖宿主 API：`ui.editor`、`notes.read`

***

## 1. 功能概述

为 Markdown 编辑器里的代码块提供语法高亮增强。宿主已集成 highlight.js，本插件在此基础上增加：行号、复制按钮、语言标签、代码块主题切换。

### 核心功能

| 功能 | 说明 |
|------|------|
| 语法高亮 | 宿主已有 highlight.js，插件通过 CSS 覆盖主题 |
| 代码块行号 | 在代码块左侧显示行号列（`<span class="mt-lineno">`） |
| 复制按钮 | 每个代码块右上角出现"复制"按钮 |
| 语言标签 | 代码块右上角显示识别到的语言名 |
| 多主题切换 | 内置 3 套代码主题（github / monokai / dracula） |

***

## 2. manifest.json

```json
{
  "name": "Code Highlight",
  "id": "code-highlight",
  "author": "Daniel W. P.",
  "icon": "code-2",
  "color": "#EF4444",
  "cat": "editor",
  "desc": "代码语法高亮增强，支持 180+ 编程语言，行号显示与主题配色。",
  "version": "1.0.0",
  "main": "main.js",
  "styles": "styles.css",
  "permissions": ["ui.editor"],
  "commands": [
    { "icon": "code-2",   "label": "代码主题: GitHub",   "actionKey": "theme-github" },
    { "icon": "code-2",   "label": "代码主题: Monokai",  "actionKey": "theme-monokai" },
    { "icon": "code-2",   "label": "代码主题: Dracula",  "actionKey": "theme-dracula" },
    { "icon": "settings", "label": "代码高亮设置...",    "actionKey": "open-settings" }
  ],
  "contextMenus": {
    "editor": [
      { "label": "代码: 格式化",     "icon": "braces",       "actionKey": "format-code" },
      { "label": "代码: 切换行号",   "icon": "list",         "actionKey": "toggle-lineno" },
      { "label": "代码: 切换复制按钮","icon": "copy",        "actionKey": "toggle-copybtn" }
    ]
  }
}
```

***

## 3. 宿主 API 依赖

| API | 用途 |
|-----|------|
| 编辑器渲染完成钩子 | 监听 `editor.onNoteOpen` 后遍历代码块注入行号/按钮 |
| `ui.editor.getCurrent()` | 获取当前编辑视图（源码模式/所见即所得） |
| clipboard API | 复制按钮用 `navigator.clipboard.writeText()` |

***

## 4. 技术要点

1. **代码块扫描**：在 `editor.onNoteOpen` 后，等宿主 Markdown 渲染完成（MutationObserver 轮询 `pre code`）
2. **行号注入**：遍历 `pre code`，按 `\n` 拆行，每行前插 `<span class="ch-lineno">n</span>`
3. **复制按钮**：在代码块容器前插 `<button class="ch-copy-btn">复制</button>`
4. **主题切换**：body 上加 `.ch-theme-{name}` 类，styles.css 内对应覆盖 `.hljs` 相关变量
5. **防副作用**：宿主原生 highlight.js 不受影响，插件增强元素用 `ch-` 前缀

***

## 5. 实现步骤

1. 确认宿主已有 highlight.js（`js/vendor/` 下搜索）
2. 创建 `plugins/code-highlight/manifest.json`
3. 创建 `plugins/code-highlight/main.js`（MutationObserver + 行号注入 + 复制按钮 + 主题切换）
4. 创建 `plugins/code-highlight/styles.css`（ch-theme-github / monokai / dracula + 行号 + 复制按钮样式）
5. 宿主侧：确认 Markdown 渲染完成的时机钩子存在（如果没有需要加 `editor.onRender`）
6. 测试：打开含多种语言代码块的笔记，验证高亮/行号/复制/主题切换
