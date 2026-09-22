/* ============================================
 * 第二脑 桌面版 — Preload（预加载脚本）
 * 作者: 火 冰
 * 功能: 在 contextIsolation 下安全地向渲染进程
 *       暴露最小化的窗口控制接口
 * ============================================ */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('noteDesktop', {
  /** 最小化窗口 */
  minimize: () => ipcRenderer.send('win:minimize'),
  /** 最大化/还原窗口（切换） */
  toggleMaximize: () => ipcRenderer.send('win:maximize'),
  /** 切换整个窗口全屏（F11 / 设置-快捷键 cmd:fullscreen） */
  toggleFullScreen: () => ipcRenderer.send('win:fullscreen'),
  /** 开/关开发者工具（设置-快捷键 cmd:devtools，默认 F12） */
  toggleDevTools: () => ipcRenderer.send('win:devtools'),
  /** 关闭窗口 */
  close: () => ipcRenderer.send('win:close'),
  /** 关闭按钮行为：confirm/quit/tray（供设置页调整并持久化） */
  getCloseAction: () => ipcRenderer.invoke('win:getCloseAction'),
  setCloseAction: (val) => ipcRenderer.invoke('win:setCloseAction', val),
  /** 写运行日志（落盘到 userData/logs/app.log） */
  log: (level, msg, detail) => ipcRenderer.send('app:log', { level: level, msg: msg, detail: detail }),
  /** 监听主进程 console 日志（main:log，渲染进程用于 F12 控制台 / 日志面板展示） */
  onMainLog: (cb) => ipcRenderer.on('main:log', (_e, text) => cb && cb(text)),
  /** 打开运行日志目录（主进程错误弹窗「打开日志目录」按钮用，文件管理器定位到 logs/） */
  openLogDir: () => ipcRenderer.invoke('shell:openLogDir'),
  /** 获取当前日志目录（设置页展示用；仅目录，不含文件名） */
  getLogDir: () => ipcRenderer.invoke('app:getLogDir'),
  /** 读取某份日志内容：type='info'|'error'，返回末段文本 */
  readLog: (type) => ipcRenderer.invoke('app:readLog', type),
  /** 设置自定义日志目录（空串回退默认 userData/logs）；返回日志目录 */
  setLogDir: (dir) => ipcRenderer.invoke('app:setLogDir', dir),
  /** 用系统目录选择器选择日志目录；返回选中目录路径，取消返回空串 */
  chooseLogDir: () => ipcRenderer.invoke('app:chooseLogDir'),
  /** 打开（或聚焦）独立日志查看浮窗（frameless，可拖出主窗口） */
  openLogViewer: () => ipcRenderer.invoke('app:openLogViewer'),
  /** 关闭独立日志查看浮窗 */
  closeLogViewer: () => ipcRenderer.invoke('app:closeLogViewer'),
  /** 获取单日志文件大小上限（MB） */
  getLogMaxMB: () => ipcRenderer.invoke('app:getLogMaxMB'),
  /** 设置单日志文件大小上限（MB）：校验通过后持久化，返回新值 */
  setLogMaxMB: (mb) => ipcRenderer.invoke('app:setLogMaxMB', mb),
  /** 清空指定日志文件内容：type='info'|'error'（只清文件文本，不删文件/不删 .1 历史） */
  clearLogFile: (type) => ipcRenderer.invoke('app:clearLogFile', type),
  /** 同步确认对话框（window.confirm 的 Electron 实现，返回是否确定） */
  confirm: (msg) => ipcRenderer.sendSync('dialog:confirm', msg),
  /** 列出笔记库全部笔记：挂起返回 [{path,name,folder,mtime,size}] */
  listNotes: () => ipcRenderer.invoke('notes:list'),
  /** 读取单篇笔记原文 */
  readNote: (relPath) => ipcRenderer.invoke('notes:read', relPath),
  /** 保存单篇笔记：relPath 相对路径 + 全文 */
  saveNote: (relPath, content) => ipcRenderer.invoke('notes:save', relPath, content),
  /** 新建笔记：dir 为目标目录（可选），返回规范化相对路径 */
  createNote: (name, dir) => ipcRenderer.invoke('notes:create', name, dir),
  /** 新建目录：dir 为相对路径，返回规范化的相对路径 */
  createDir: (dir) => ipcRenderer.invoke('notes:createDir', dir),
  /** 删除笔记 */
  deleteNote: (relPath) => ipcRenderer.invoke('notes:delete', relPath),
  /** 上传资源（图片/附件）：落盘到 .resources（UUID 重命名），返回 {url, name} */
  uploadResource: (fileName, data) => ipcRenderer.invoke('notes:uploadResource', fileName, data),
  /** 用系统默认程序打开上传的资源文件（传入 note://vault_res/ 路径的存储名 uuid.ext） */
  openResource: (stored) => ipcRenderer.invoke('notes:openResource', stored),
  /** 用系统默认浏览器打开外部 URL（http/https 链接） */
  openExternal: (url) => ipcRenderer.invoke('notes:openExternal', url),
  /** 删除上传的资源文件（图片/附件）：从 .resources 物理删除并刷新元数据 */
  deleteResource: (url) => ipcRenderer.invoke('notes:deleteResource', url),
  /** 在系统文件管理器中显示该笔记 */
  revealNote: (relPath) => ipcRenderer.invoke('notes:reveal', relPath),
  /** 移动整个目录到新父目录（保留内部结构 + 空目录；源目录被移除），返回 {dir, moved} */
  moveDir: (oldDir, newParent) => ipcRenderer.invoke('notes:moveDir', oldDir, newParent),
  /** 重命名目录（把末级目录名改为新名，父级不变），返回 {dir, moved} */
  renameDir: (oldDir, newName) => ipcRenderer.invoke('notes:renameDir', oldDir, newName),
  /** 作用域重建某目录子树的元数据并同步关联反链（不重建全库），返回 {dirs, notes} */
  refreshDirMeta: (dir, scopeParent) => ipcRenderer.invoke('notes:refreshDirMeta', dir, scopeParent),
  /** 删除整个目录（含子目录与空目录本身），返回删除的 .md 篇数 */
  removeDir: (dir) => ipcRenderer.invoke('notes:removeDir', dir),
  /** 重建 .second-brain 元数据（每个目录一条 _meta.json 记录），返回 {dirs, updatedAt} */
  refreshMeta: () => ipcRenderer.invoke('notes:refreshMeta'),
  /** 读取某笔记所在目录的元数据记录 + 该笔记自身属性：返回 {dir, noteName, meta, note} */
  fileMeta: (relPath) => ipcRenderer.invoke('notes:fileMeta', relPath),
  /** 读取某目录的元数据记录（目录属性：文件列表 children + 总大小等）：'' 表示根目录 */
  dirMeta: (dir) => ipcRenderer.invoke('notes:dirMeta', dir),
  /** 读取全库链接索引（outlinks/backlinks 摘要），供图谱视图与反向链接消费；只读不重建 */
  linksIndex: () => ipcRenderer.invoke('notes:linksIndex'),
  /** 读取最近打开的笔记路径列表（.second-brain/recent.json）：{tabs, pinned} */
  recentLoad: () => ipcRenderer.invoke('notes:recentLoad'),
  /** 保存最近打开的笔记路径列表 + 锁定集合（.second-brain/recent.json）：接收 {tabs, pinned} */
  recentSave: (paths) => ipcRenderer.invoke('notes:recentSave', paths),
  /** 保存单篇笔记的「索引分块」覆盖配置（块大小/相邻重叠/可选显式偏移值）；chunk={reset:true} 清除覆盖 */
  saveNoteChunk: (relPath, chunk) => ipcRenderer.invoke('notes:saveNoteChunk', relPath, chunk),
  /** 获取当前笔记库信息：{path, name, history} */
  getVault: () => ipcRenderer.invoke('vault:get'),
  /** 打开目录选择器切换到（或新建）笔记库，返回 {canceled, path, name, history} */
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  /** 按路径切换库（历史库列表用），返回 {canceled, path, name, history} */
  switchVault: (dir) => ipcRenderer.invoke('vault:switch', dir),
  /** 从历史列表移除某库（不改当前库），返回 {history} */
  removeVault: (dir) => ipcRenderer.invoke('vault:remove', dir),
  /** 恢复默认笔记库（userData/vault 或已迁移后的新默认库），返回 {path, name, history} */
  resetVault: () => ipcRenderer.invoke('vault:reset'),

  /* ---------- 「打开项目」工作区桥接（非知识库，git 项目；不建笔记/向量索引） ---------- */
  project: {
    /** 弹目录选择器打开一个 git 项目目录作为非库工作区，返回 {canceled, path, name, windowOpened} */
    open: () => ipcRenderer.invoke('project:open'),
    /** 最近打开的项目列表：[{path, name}]（库下拉「一般项目」分组） */
    listRecent: () => ipcRenderer.invoke('project:listRecent'),
    /** 按绝对路径打开（或聚焦）一个项目窗口：absPath → {ok, path, name, windowOpened} */
    openPath: (absPath) => ipcRenderer.invoke('project:openPath', absPath),
    /** 当前窗口项目根（非项目窗口返回 null，用于渲染端判定项目模式） */
    current: () => ipcRenderer.invoke('project:current'),
    /** 项目文件树：[{rel,name,folder,size,mtime,isBinary}]（相对项目根） */
    list: () => ipcRenderer.invoke('project:list'),
    /** 读取项目文本文件：{rel} → {ok, content, binary, name, error} */
    read: (rel) => ipcRenderer.invoke('project:read', rel),
    /** 保存项目文本文件：{rel, content} → {ok, error} */
    save: (rel, content) => ipcRenderer.invoke('project:save', { rel: rel, content: content }),
    /** 项目 git 状态：{ok, repo, status:{rel:code}}（status --porcelain 解析） */
    gitStatus: () => ipcRenderer.invoke('project:gitStatus'),
    /** 在系统文件管理器中显示项目文件 */
    reveal: (rel) => ipcRenderer.invoke('project:reveal', rel),
  },

  /* ---------- 应用安全桥接（SEC-01 启动密码 / SEC-02 超时锁定） ---------- */
  security: {
    /** 读取安全状态：{hasPwd, lockEnabled, lockMinutes, unlocked}（不下发任何密码哈希） */
    getState: () => ipcRenderer.invoke('app:getSecurity'),
    /** 同步读取启动锁定态（sendSync，首帧前用，避免启动/召回先闪内容再弹密码框） */
    getStateSync: () => ipcRenderer.sendSync('app:getSecuritySync'),
    /** 设置/修改/移除密码：data={old?, next?}，返回 {ok, reason?} */
    setPassword: (data) => ipcRenderer.invoke('app:setPassword', data),
    /** 解锁校验：传密码返回是否解锁成功 */
    unlock: (pwd) => ipcRenderer.invoke('app:unlock', pwd),
    /** 配置超时锁定：data={enabled?, minutes?}，返回最新状态 */
    setLockConfig: (data) => ipcRenderer.invoke('app:setLockConfig', data),
    /** 监听主进程锁定推送（桌面端 powerMonitor 超时触发） */
    onLocked: (cb) => {
      ipcRenderer.removeAllListeners('app:locked');
      ipcRenderer.on('app:locked', () => { if (typeof cb === 'function') cb(); });
    },
  },

  /* ---------- 文件拖拽临时打开（只读；不写库、不建索引） ---------- */
  /** 从拖拽入窗口的 File 对象解析真实绝对路径（Electron webUtils）。参数为 renderer 侧 File。
      返回值是绝对路径字符串；解析失败返回空串。作者: 火 冰 */
  getPathForFile: (file) => {
    try { return webUtils ? webUtils.getPathForFile(file) : ''; }
    catch (_) { return ''; }
  },
  /** 读取外部临时文件内容：{absPath} → {ok, path, name, content, binary, error}（≤5MB） */
  readFileExternal: (absPath) => ipcRenderer.invoke('notes:readFileExternal', { absPath: absPath }),
  /** 写回外部临时文件内容：{absPath, content} → {ok, path, error}（仅允许已登记的临时文件） */
  writeFileExternal: (absPath, content) => ipcRenderer.invoke('notes:writeFileExternal', { absPath: absPath, content: content }),
  /** 订阅：系统「打开方式」传入的外部文件（OS 右键→打开方式→第二脑）→ 回调绝对路径，作为临时文件打开 */
  onOpenFile: (cb) => ipcRenderer.on('open-file', (_e, abs) => { if (typeof cb === 'function') cb(abs); }),
  /** 在系统文件管理器中显示外部临时文件 */
  revealExternal: (absPath) => ipcRenderer.invoke('notes:revealExternal', absPath),

  /* ---------- 最近打开的临时文件（全局、跨知识库，最多 10 条；库下拉「最近打开」二级） ---------- */
  tempRecent: {
    /** 读取最近临时文件列表：[{path, name}] */
    load: () => ipcRenderer.invoke('temp:recentLoad'),
    /** 登记一个临时文件（去重置顶），返回最新列表 */
    record: (absPath) => ipcRenderer.invoke('temp:recentRecord', absPath),
    /** 从最近列表移除，返回最新列表 */
    remove: (absPath) => ipcRenderer.invoke('temp:recentRemove', absPath),
    /** 清空最近打开列表，返回最新（空）列表 */
    clear: () => ipcRenderer.invoke('temp:recentClear'),
  },

  /* ---------- 插件目录桥接 ---------- */
  plugins: {
    /** 列出插件目录中的插件：{plugins:[{id,dir,manifest,hasMain}], dir} */
    list: () => ipcRenderer.invoke('plugins:list'),
    /** 在系统文件管理器中打开插件目录 */
    reveal: () => ipcRenderer.invoke('plugins:reveal'),
  },

  /* ---------- Git 同步桥接（Git Sync 插件消费） ---------- */
  git: {
    /** 执行一条白名单 git 命令：req={cwd, args}，返回 {exit, stdout, stderr} */
    run: (req) => ipcRenderer.invoke('git:run', req),
    /** 探测 git 环境与知识库状态：{installed, isRepo, branch, remote} */
    check: () => ipcRenderer.invoke('git:check'),
  },
  /** 从 Git 仓库克隆为独立知识库并打开：url 为仓库地址，返回 {canceled, path, name, error} */
  cloneGit: (url) => ipcRenderer.invoke('vault:cloneGit', url),
  /** 迁移默认知识库到新目录（移动语义），返回 {canceled, path, name, history, error} */
  migrateVault: () => ipcRenderer.invoke('vault:migrate'),
  /** 把指定知识库（绝对路径）设置为新的默认库（不迁移文件，仅持久化默认库指针），返回 {canceled, defaultPath, error} */
  setDefaultVault: (dir) => ipcRenderer.invoke('vault:setDefault', dir),

  /* ---------- AI 问答桥接 ---------- */
  ai: {
    /** 读取 AI 配置（本地模型路径 + 远程大模型参数） */
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    /** 保存 AI 配置 */
    saveConfig: (cfg) => ipcRenderer.invoke('ai:saveConfig', cfg),
    /** 预览某篇笔记按给定分块配置生成的索引分块（属性-索引分块面板实时展示）；maxChunkSize 为单块长度上限，0=不限制 */
    previewChunk: (rel, size, overlap, offsets, maxChunkSize, strategy, fileName) => ipcRenderer.invoke('ai:previewChunk', rel, size, overlap, offsets, maxChunkSize, strategy, fileName),
    /** 手动重建指定单篇笔记的索引（「索引过期」补救） */
    rebuildNoteIndex: (rel) => ipcRenderer.invoke('ai:rebuildNoteIndex', rel),
    /** 获取 AI 引擎状态 */
    getStatus: () => ipcRenderer.invoke('ai:getStatus'),
    /** 获取当前提供方可用的生成模型列表 */
    listModels: () => ipcRenderer.invoke('ai:listModels'),
    /** 从 Ollama 服务拉取已安装模型列表（返回 {models:[{name,size,modifiedAt}]}） */
    listOllamaModels: (baseUrl) => ipcRenderer.invoke('ai:listOllamaModels', baseUrl),
    /** 管理 Ollama 模型：加载/卸载/上下文长度（{baseUrl, model, action:'load'|'unload', numCtx}） */
    manageOllamaModel: (p) => ipcRenderer.invoke('ai:manageOllamaModel', p),
    /** 获取 Ollama 正在运行的模型列表（返回 {models:[{name,size,sizeVram,expiresAt}]}） */
    listRunningModels: (baseUrl) => ipcRenderer.invoke('ai:listRunningModels', baseUrl),
    getRunningMap: () => ipcRenderer.invoke('ai:runningMap'),
    /** 获取可用模型全局缓存（baseUrl -> {provider, models:[{name,size,modifiedAt}], updatedAt, error}） */
    getAvailableModels: () => ipcRenderer.invoke('ai:availableModels'),
    /** 监听可用模型/运行状态数据更新（后台轮询每次刷新完成后触发，页面据此实时刷新） */
    onModelsUpdated: (cb) => {
      ipcRenderer.removeAllListeners('ai:models-updated');
      ipcRenderer.on('ai:models-updated', () => { if (typeof cb === 'function') cb(); });
    },
    /** 加载本地嵌入模型 */
    loadEmbedding: () => ipcRenderer.invoke('ai:loadEmbedding'),
    /** 重建知识库索引（进度经 onProgress 推送） */
    rebuildIndex: () => ipcRenderer.invoke('ai:rebuildIndex'),
    /** 查看当前知识库索引：统计 + 按文件分组明细 */
    listIndex: () => ipcRenderer.invoke('ai:listIndex'),
    /** 列出索引库中所有知识库的索引概要（含目录是否仍存在） */
    listIndexes: () => ipcRenderer.invoke('ai:listIndexes'),
    /** 重建指定知识库索引（进度经 onProgress 推送） */
    rebuildIndexFor: (vaultPath) => ipcRenderer.invoke('ai:rebuildIndexFor', vaultPath),
    /** 删除指定知识库索引文件 */
    deleteIndex: (vaultPath) => ipcRenderer.invoke('ai:deleteIndex', vaultPath),
    /** 发起问答：question + 历史消息 + 当前 Agent id（可空，未配置时走默认助手）+ modelId（可空）+ devMode（开发者模式，控制打印提示词）；token 经 onToken 流式回调 */
    ask: (question, history, agentId, modelId, devMode) => ipcRenderer.invoke('ai:ask', question, history, agentId, modelId, devMode),
    /** 停止当前流式生成 */
    stop: () => ipcRenderer.send('ai:stop'),
    /** 注册流式 token 回调（自动替换旧监听） */
    onToken: (cb) => {
      ipcRenderer.removeAllListeners('ai:token');
      ipcRenderer.on('ai:token', (_e, t) => cb(t));
    },
    /** 注册回答完成回调（携带检索来源 sources） */
    onDone: (cb) => {
      ipcRenderer.removeAllListeners('ai:ask-done');
      ipcRenderer.on('ai:ask-done', (_e, p) => cb(p));
    },
    /** 注册回答错误回调 */
    onError: (cb) => {
      ipcRenderer.removeAllListeners('ai:ask-error');
      ipcRenderer.on('ai:ask-error', (_e, err) => cb(err));
    },
    /** 注册索引重建进度回调 */
    onProgress: (cb) => {
      ipcRenderer.removeAllListeners('ai:progress');
      ipcRenderer.on('ai:progress', (_e, p) => cb(p));
    },
    /** 获取模型库状态（下载目录 + 各嵌入模型是否已下载） */
    getModelLib: () => ipcRenderer.invoke('ai:getModelLib'),
    /** 设置模型下载目录（空串=恢复默认目录） */
    setModelDir: (dir) => ipcRenderer.invoke('ai:setModelDir', dir),
    /** 弹出目录选择框（返回所选路径或 null） */
    pickModelDir: () => ipcRenderer.invoke('ai:pickModelDir'),
    /** 从远端下载嵌入模型；进度经 onModelProgress 回调推送 */
    downloadModel: (repo, source) => ipcRenderer.invoke('ai:downloadModel', repo, source),
    /** 在系统文件管理器中打开模型下载目录 */
    revealModelDir: () => ipcRenderer.invoke('ai:revealModelDir'),
    /** 注册模型下载进度回调（自动替换旧监听） */
    onModelProgress: (cb) => {
      ipcRenderer.removeAllListeners('ai:modelProgress');
      ipcRenderer.on('ai:modelProgress', (_e, p) => cb(p));
    },
    /** 列出知识库内全部 AI 会话（轻量元信息，按最近更新倒序） */
    listSessions: () => ipcRenderer.invoke('ai:listSessions'),
    /** 读取单个 AI 会话完整内容 */
    readSession: (id) => ipcRenderer.invoke('ai:readSession', id),
    /** 保存 AI 会话：{id,title,history} 或 {id,active:true} */
    saveSession: (data) => ipcRenderer.invoke('ai:saveSession', data),
    /** 删除指定 AI 会话 */
    deleteSession: (id) => ipcRenderer.invoke('ai:deleteSession', id),
    /** 读取最近活动会话 id */
    getActiveSession: () => ipcRenderer.invoke('ai:getActiveSession'),
  },
});