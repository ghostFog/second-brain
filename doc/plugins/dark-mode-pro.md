# 插件规划：Dark Mode Pro（高级暗色主题）

> 优先级：P2 | 分类：theme | 依赖宿主 API：`settings.theme`、`vault.read`、时间 API

***

## 1. 功能概述

在宿主暗色主题基础上做深度优化：OLED 友好纯黑、降低蓝光、自动日夜间切换。与宿主的 theme-mode 配合使用。

### 核心功能

| 功能 | 说明 |
|------|------|
| OLED 纯黑 | 背景色 #000000 代替宿主的 #1E1E2E，省电量+更沉浸 |
| 降低蓝光 | 蓝色调饱和度降低、色温偏移 |
| 自动日夜间 | 日出时间切浅色、日落切深色（可配置地区） |
| 自动跟随系统 | 系统浅/深模式切换时自动跟随 |
| 亮度调整 | 全局 CSS filter brightness 微调 |

***

## 2. manifest.json

```json
{
  "name": "Dark Mode Pro",
  "id": "dark-mode-pro",
  "author": "hasegawa",
  "icon": "moon",
  "color": "#6366F1",
  "cat": "theme",
  "desc": "高级暗色主题，深度优化的 OLED 友好配色，支持自动日夜间切换。",
  "version": "1.0.0",
  "main": "main.js",
  "styles": "styles.css",
  "permissions": ["settings.theme"],
  "ribbon": {
    "icon": "moon",
    "title": "Dark Mode Pro",
    "actionKey": "toggle"
  },
  "commands": [
    { "icon": "moon",     "label": "Dark Pro: 启用",        "actionKey": "enable" },
    { "icon": "sun",      "label": "Dark Pro: 禁用",        "actionKey": "disable" },
    { "icon": "moon-star","label": "Dark Pro: OLED 纯黑",   "actionKey": "oled" },
    { "icon": "cloud",    "label": "Dark Pro: 降低蓝光",    "actionKey": "low-blue" },
    { "icon": "clock",    "label": "Dark Pro: 自动日夜",    "actionKey": "auto-daynight" },
    { "icon": "settings", "label": "Dark Pro 设置...",      "actionKey": "open-settings" }
  ]
}
```

***

## 3. 宿主 API 依赖

| API | 用途 |
|-----|------|
| `settings.theme-mode` | 读取宿主当前浅/深模式，Dark Pro 在此之上叠加 |
| CSS 变量覆盖 | 同 Minimal Theme，用 body class + CSS 变量 |
| 时间 API | `new Date()` + 可选：Geolocation API 算日出日落时间 |

***

## 4. 技术要点

1. **三层主题叠加**：宿主 theme-mode（底层）→ Dark Mode Pro 叠层 → Minimal Theme 叠层（可选共存）
2. **OLED 纯黑**：把宿主 `--note-bg: #1E1E2E` 覆盖成 `#000000`
3. **自动日夜**：用 `suncalc` 库算本地日出日落（可插件内打包，或用简化的固定 6:30/18:00）
4. **定时器**：`setInterval` 每分钟检查是否需要切换模式，避免频繁触发
5. **防闪烁**：切换时瞬间应用，不要做过渡动画

***

## 5. 实现步骤

1. 创建 `plugins/dark-mode-pro/manifest.json`
2. 创建 `plugins/dark-mode-pro/styles.css`（OLED 黑色变量 + 低蓝光变量覆盖）
3. 创建 `plugins/dark-mode-pro/main.js`（toggle + auto-daynight 定时器 + 亮度调整）
4. 宿主侧：确认多层主题叠加的 CSS 优先级机制正常（后加载的 styles.css 优先级高）
5. 测试：深色宿主 + Dark Pro 叠加 → 验证黑色纯度；自动日夜定时器验证
