/* ============================================
 * 第二脑 桌面版 — Preload（预加载脚本）
 * 作者: 火 冰
 * 功能: 在 contextIsolation 下安全地向渲染进程
 *       暴露最小化的窗口控制接口
 * ============================================ */
const { contextBridge, ipcRenderer } = require('electron');

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
  /** 在系统文件管理器中显示该笔记 */
  revealNote: (relPath) => ipcRenderer.invoke('notes:reveal', relPath),
  /** 移动整个目录到新父目录（保留内部结构 + 空目录；源目录被移除），返回 {dir, moved} */
  moveDir: (oldDir, newParent) => ipcRenderer.invoke('notes:moveDir', oldDir, newParent),
  /** 删除整个目录（含子目录与空目录本身），返回删除的 .md 篇数 */
  removeDir: (dir) => ipcRenderer.invoke('notes:removeDir', dir),
  /** 重建 .second-brain 元数据（每个目录一条 _meta.json 记录），返回 {dirs, updatedAt} */
  refreshMeta: () => ipcRenderer.invoke('notes:refreshMeta'),
  /** 读取某笔记所在目录的元数据记录 + 该笔记自身属性：返回 {dir, noteName, meta, note} */
  fileMeta: (relPath) => ipcRenderer.invoke('notes:fileMeta', relPath),
  /** 读取某目录的元数据记录（目录属性：文件列表 children + 总大小等）：'' 表示根目录 */
  dirMeta: (dir) => ipcRenderer.invoke('notes:dirMeta', dir),
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

  /* ---------- 插件目录桥接 ---------- */
  plugins: {
    /** 列出插件目录中的插件：{plugins:[{id,dir,manifest,hasMain}], dir} */
    list: () => ipcRenderer.invoke('plugins:list'),
    /** 在系统文件管理器中打开插件目录 */
    reveal: () => ipcRenderer.invoke('plugins:reveal'),
  },
  /** 迁移默认知识库到新目录（移动语义），返回 {canceled, path, name, history, error} */
  migrateVault: () => ipcRenderer.invoke('vault:migrate'),

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
    /** 发起问答：question + 历史消息，token 经 onToken 流式回调 */
    ask: (question, history) => ipcRenderer.invoke('ai:ask', question, history),
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
  },
});