# 插件规划：Minimal Theme（极简主题）

> 优先级：P1 | 分类：theme | 依赖宿主 API：`vault.read`、`settings.theme`

***

## 1. 功能概述

极简主义主题包，专注阅读体验。提供多种低对比度配色方案（米白、冷灰、暖棕等），通过 Ribbon 图标或命令面板一键切换。

### 核心功能

| 功能       | 说明                                       |
| -------- | ---------------------------------------- |
| 多配色方案    | 内置 4-6 种低对比度配色（纸白/亚麻/冷灰/暖棕/墨绿/藏青）        |
| 一键切换     | Ribbon 图标或命令面板选择主题                       |
| 持久化      | 主题选择存 localStorage，下次启动自动恢复              |
| 与宿主主题联动  | 宿主的浅色/深色模式作为基础，Minimal Theme 在此之上叠加自己的配色 |
| CSS 变量注入 | 插件通过覆盖 `:root` CSS 变量实现主题切换              |

***

## 2. manifest.json

```json
{
  "name": "Minimal Theme",
  "id": "minimal-theme",
  "author": "Stephan Ango",
  "icon": "palette",
  "color": "#EC4899",
  "cat": "theme",
  "desc": "极简主题包，专注内容阅读的克制设计，支持多种配色方案切换。",
  "version": "1.0.0",
  "main": "main.js",
  "styles": "styles.css",
  "permissions": ["settings.theme"],
  "ribbon": {
    "icon": "palette",
    "title": "Minimal 主题切换",
    "actionKey": "cycle-theme"
  },
  "commands": [
    { "icon": "palette",   "label": "Minimal: 主题 1 - 纸白",   "actionKey": "apply-1" },
    { "icon": "palette",   "label": "Minimal: 主题 2 - 亚麻",   "actionKey": "apply-2" },
    { "icon": "palette",   "label": "Minimal: 主题 3 - 冷灰",   "actionKey": "apply-3" },
    { "icon": "palette",   "label": "Minimal: 主题 4 - 墨绿",   "actionKey": "apply-4" },
    { "icon": "palette",   "label": "Minimal: 停用（恢复宿主）", "actionKey": "disable" }
  ]
}
```

***

## 3. 宿主 API 依赖

| API                                      | 用途                                                                |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `noteDesktop.settings.get('theme-mode')` | 读取宿主当前浅/深模式                                                       |
| `noteDesktop.settings.set()`             | 保存当前配色方案 id                                                       |
| CSS 变量覆盖                                 | `document.documentElement.style.setProperty('--note-bg', '#xxx')` |

***

## 4. 技术要点

1. **styles.css** 定义 4-6 个 `.mt-theme-N` 类，覆盖 `--note-bg`、`--note-ink`、`--note-border` 等变量
2. 切换时给 `<body>` 加/移除 `.mt-theme-N` 类名即可生效
3. 停用插件时移除所有 Minimal Theme 加的 body class，恢复宿主原始主题
4. 配色方案数据存 main.js 内部常量，不需要远程获取

***

## 5. 实现步骤

1. 创建 `plugins/minimal-theme/manifest.json`
2. 创建 `plugins/minimal-theme/main.js`（切换逻辑 + PluginAPI.register）
3. 创建 `plugins/minimal-theme/styles.css`（4-6 套配色的 CSS 变量覆盖）
4. 宿主侧：确认 CSS 变量覆盖机制工作正常（宿主允许 body class 切换主题）
5. 测试：在浅色和深色宿主主题上分别叠加 Minimal Theme，验证效果

<br />
