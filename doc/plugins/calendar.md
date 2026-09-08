# 插件规划：Calendar（日历视图）

> 优先级：P2 | 分类：productivity | 依赖宿主 API：`notes.list`、`notes.read`、`notes.create`

***

## 1. 功能概述

新增日历视图，将笔记按创建/修改日期在月历中展示，支持点击日期查看当天所有笔记、右键快速创建日记。

### 核心功能

| 功能 | 说明 |
|------|------|
| 月历视图 | 在插件独立面板中渲染月历，每天格子里显示当天笔记数量 |
| 日期标注 | 有笔记的日期格子下方显示小圆点 |
| 点击日期 | 弹出当天笔记列表，点击跳转到编辑器打开 |
| 右键创建日记 | 在日期格子上右键 → "创建今日日记"，自动填 frontmatter 日期 |
| 年度概览 | 可选：年度热力图，显示每天笔记密度 |
| Ribbon 入口 | Ribbon 图标点击切换日历面板开关 |

***

## 2. manifest.json

```json
{
  "name": "Calendar",
  "id": "calendar",
  "author": "NoteApp Team",
  "icon": "calendar",
  "color": "#8B5CF6",
  "cat": "productivity",
  "desc": "日历视图和日记管理，将你的笔记按日期组织，轻松回溯每日记录。",
  "version": "1.0.0",
  "main": "main.js",
  "permissions": ["notes.read", "notes.write", "vault.read"],
  "ribbon": {
    "icon": "calendar",
    "title": "日历",
    "actionKey": "toggle-calendar"
  },
  "commands": [
    { "icon": "calendar",    "label": "打开日历视图",    "actionKey": "calendar-view" },
    { "icon": "calendar-days","label": "跳到今天",       "actionKey": "jump-today" },
    { "icon": "plus",        "label": "创建今日日记",    "actionKey": "create-diary" }
  ],
  "contextMenus": {
    "file-tree": [
      { "label": "日历: 查看这一天", "icon": "calendar-days", "actionKey": "calendar-view" }
    ]
  }
}
```

***

## 3. 宿主 API 依赖

| API | 用途 |
|-----|------|
| `notes.list()` | 获取 vault 下所有笔记元数据（取 frontmatter 的 date 字段或文件 mtime） |
| `notes.read(path)` | 读取指定笔记内容（打开日历视图详情） |
| `notes.create(name)` | 创建"今日日记"笔记 |
| 自定义面板 | 宿主提供 `panel.open('calendar')` 或插件用 Shadow DOM 自绘面板 |

***

## 4. 技术要点

1. **笔记日期提取**：优先读 frontmatter `date:` 字段，没有则用文件系统 mtime
2. **面板定位**：右侧侧栏或独立浮层，支持展开/折叠/拖拽调整大小
3. **月历渲染**：纯 DOM 创建 7×6 网格，不引入第三方日历库
4. **性能**：`notes.list()` 可能返回大量笔记，需要按月聚合后再渲染（`groupBy` 日期键）
5. **日记模板**：创建日记时自动填充 frontmatter（`date: 2026-09-05`、`tags: [日记]`）

***

## 5. 实现步骤

1. **宿主侧先行**：新增 `notes.list()` API 如果不存在（目前 preload.js 只有 list 方法）
2. 确认宿主是否有 `panel.open()` 扩展点，或插件用 Shadow DOM 自绘浮层面板
3. 创建 `plugins/calendar/manifest.json`
4. 创建 `plugins/calendar/main.js`（月历 DOM + 笔记日期聚合 + 点击/右键交互）
5. 测试：空 vault / 大量笔记 vault / 跨月笔记 三种场景
