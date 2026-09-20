# AI 问答增强：后台运行 / 回答统计 / 打断 / 可用模型过滤 / 模型常驻

## Context（背景）

AI 问答（`AI` 视图）现有实现存在五处不足，用户要求改进：

1. **切换 Ribbon 后回答气泡消失**：切走再切回 AI 视图时，`app-layout.js` 的 `loadView` 重新注入 `ai.html` 并重跑 `initAi()`（`js/app-layout.js` L187-L226）。当前回答进度只存于 DOM 引用 `aiCurBubble`，未写入 `session.history`；返回后 `aiCurBubble` 指向已被销毁的旧节点，且 `renderSessionChat` 只按 history 重绘，因此进行中的回答「凭空消失」（主进程问答仍在继续，只是无节点渲染）。
2. **无回答统计**：每次回答未记录「使用的模型 / 首 token 时长 / 总耗时」。
3. **不支持打断**：设计稿已提「生成中显示停止按钮」，但发送按钮无「停止」态；主动 `ai.stop()` 中止时 `ai:ask-error` 触发 `onError`，会把打断当错误渲染。
4. **模型选择器不过滤可用性**：`ai:listModels` 返回全部配置模型，未区分是否可用。
5. **模型不常驻**：设置页「加载（常驻内存）」用 `keep_alive:'30m'`，但问答走 `_streamOllama` 时未带 `keep_alive`，被 Ollama 默认 5 分钟覆盖，模型 5 分钟即卸载。

**已与用户确认的决策**：
- 可用模型 = Ollama 运行中（`/api/ps`）+ 全部远程 OpenAI 模型。
- 打断后保留已生成部分 + 标记「已打断」，本回答统计仍记录进会话。
- 常驻 = 设置「加载」与 Ollama 问答请求都带 `keep_alive=-1`（常驻到手动卸载）。

## 改动清单

### 1. `second-brain/ai-engine.js`（主进程引擎）

**a. 模型常驻（需求 5）**
- 新增模块常量 `const OLLAMA_KEEP_ALIVE = -1;`。
- `manageOllamaModel`：加载时 `keep_alive` 由 `'30m'` 改为 `OLLAMA_KEEP_ALIVE`（-1 常驻）。
- `_streamOllama`：请求体新增 `keep_alive: OLLAMA_KEEP_ALIVE`，使问答也不会重置为默认 5 分钟。

**b. 可用模型过滤（需求 4）**
- 重写 `listModels()`：对每个配置模型按 provider 判定可用性——
  - `openai`：`running: true`（始终可用）；
  - `ollama`：按 `baseUrl` 去重后调用 `listRunningModels(baseUrl)` 拉取 `/api/ps`，命中正在运行的标记 `running: true`。
- 返回 `{ models: [{id, provider, model, running}], currentModelId }`（保留原字段，仅追加 `running`）。

### 2. `second-brain/js/app-ai.js`（AI 视图前端）

**新增模块级状态**：`aiStopFlag=false`、`aiT0=0`、`aiFirstMs=null`、`aiCurModel=''`。

**a. 后台运行恢复（需求 1）**：`initAi()` 末尾在 `renderSessionChat(aiActiveSession())` 之后追加——当 `aiGenerating === true` 时重建进行中的助手气泡并回灌当前 `aiCurText`，使后续 `ai.token` 能继续渲染到新节点。

**b. 回答统计 + 打断（需求 2、3）**：
- `aiSend()`：记录 `aiT0=Date.now()`、`aiCurModel`（取 `#ai-model` 选中项文本）、`aiStopFlag=false`，并调用 `aiUpdateSendButton()`。
- `onToken` 回调：首次 token 记 `aiFirstMs = Date.now()-aiT0`。
- 抽取 `aiFinish(stopped, sources)` 作为完成统一出口（onDone 置 stopped=false；onError 且被主动打断置 stopped=true）：把 `{role:'assistant', content, model, firstTokenMs, totalMs, stopped}` 写入 `session.history`，在气泡尾部追加统计行（`aiAppendMeta`），并在打断时状态徽标为「已停止」。
- `onError`：若 `aiStopFlag` 为真则调 `aiFinish(true)`（非错误路径），否则维持现有错误渲染。
- `aiUpdateSendButton()`：以 `aiGenerating` 切换发送按钮文案「发送 / 停止」；`[data-ai="send"]` 点击逻辑改为：生成中→触发停止（`aiStopFlag=true; ai.stop()`），空闲→`aiSend()`。
- `aiAddMessage(role, text, meta)`：assistant 分支支持 meta 渲染统计行（含历史重绘）。
- `renderSessionChat`：遍历 history 时把 `m` 作为 meta 传入 `aiAddMessage`，使已完成回答在切回视图时也能显示模型/时间统计。
- 清理逻辑（removeSession / aiVaultAction / 新建会话 / 重建索引等置 `aiGenerating=false` 处）同步调用 `aiUpdateSendButton()`。

### 3. `second-brain/views/ai.html`
- 无结构性改动；发送按钮的「停止/发送」文案态由 JS `aiUpdateSendButton()` 动态控制。

### 4. 不修改
- `main.js`、`preload.js`：`ai:listModels`/`ai:ask`/`ai:stop` 等 IPC 契约保持不变，仅在引擎层增强 `listModels` 返回值。

## 文档登记（项目规则：功能追踪）

按 `AGENTS.md` 功能追踪规则登记新增需求。AI 模块已用至 AI-17，新增 AI-18~AI-22：

| 编号 | 功能点 | 说明 |
| ---- | ---- | ---- |
| AI-18 | 后台运行与恢复 | 切换 Ribbon 生成不中断，返回视图保留进行中气泡与已累计内容 |
| AI-19 | 回答统计 | 每次回答记录并展示 使用模型 / 首 token 时长 / 总耗时 |
| AI-20 | 生成打断 | 生成中提供「停止」，打断后保留部分内容并标记已打断 |
| AI-21 | 可用模型过滤 | 选择器仅显示 Ollama 运行中 + 全部远程 OpenAI 模型 |
| AI-22 | 模型常驻 | 加载与 Ollama 问答均带 keep_alive=-1，常驻到手动卸载 |

- 在 `doc/功能需求文档.md`（AI 模块需求表）补充上述条目。
- 在 `doc/需求/需求-AI问答.md` 需求表中追加 AI-18~AI-22。
- 在 `doc/开发进度.md` 未完结看板追加 5 行（状态=计划），并同步「各模块需求最大编号」表 AI 已用至 22 / 下一个 AI-23。

## 验证

1. **模型常驻**：设置页点「加载（常驻内存）」→ 底部 `ai-model` 下拉对应 Ollama 模型出现；问答后 `curl /api/ps` 确认模型仍加载，超过 5 分钟不卸载。
2. **可用模型过滤**：设置页取消加载某 Ollama 模型 → AI 页选择器不再出现该模型；远程 OpenAI 模型始终出现。
3. **后台运行恢复**：问答过程中切换到编辑器再切回，气泡含已流式内容并持续输出。
4. **回答统计**：回答完成后气泡尾部显示「模型 · 首token X.Xs · 总耗时 Y.Ys」；切走再切回仍显示。
5. **打断**：生成中点「停止」→ 保留部分内容 + 「已打断」标记，状态徽标「已停止」，无错误样式。
6. `node --check` 各改动 JS 语法通过；`npm test`（`second-brain/regression.test.js`）通过，且不引入回归。