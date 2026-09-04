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
  /** 关闭窗口 */
  close: () => ipcRenderer.send('win:close'),
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
  /** 在系统文件管理器中显示该笔记 */
  revealNote: (relPath) => ipcRenderer.invoke('notes:reveal', relPath),
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
  /** 迁移默认知识库到新目录（移动语义），返回 {canceled, path, name, history, error} */
  migrateVault: () => ipcRenderer.invoke('vault:migrate'),

  /* ---------- AI 问答桥接 ---------- */
  ai: {
    /** 读取 AI 配置（本地模型路径 + 远程大模型参数） */
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    /** 保存 AI 配置 */
    saveConfig: (cfg) => ipcRenderer.invoke('ai:saveConfig', cfg),
    /** 获取 AI 引擎状态 */
    getStatus: () => ipcRenderer.invoke('ai:getStatus'),
    /** 获取当前提供方可用的生成模型列表 */
    listModels: () => ipcRenderer.invoke('ai:listModels'),
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
  },
});