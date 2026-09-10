/* ============================================
 * 第二脑 桌面版 — AI 引擎（主进程）
 * 作者: 火 冰
 * 功能: 本地 ONNX 嵌入 / 重排序 + 远程大模型（OpenAI 兼容）/ 本地 Ollama，
 *       实现知识库向量索引、语义检索与流式问答。
 * 依赖: @xenova/transformers（分词与嵌入）、onnxruntime-node（重排序推理）
 * ============================================ */
const fs = require('fs');
const path = require('path');
// @xenova/transformers 为纯 ESM 包，CJS 环境需动态 import 懒加载（见 _tf()）
// onnxruntime-node 的导出形态在不同打包下可能包一层 default，这里做兼容取值
const _ort = require('onnxruntime-node');
const ORT = (_ort && _ort.InferenceSession) ? _ort : (_ort && _ort.default);
const grayMatter = require('gray-matter'); // 解析笔记 frontmatter（获取笔记 id 元数据）

/* 默认 AI 配置：本地模型路径默认空，由设置页通过模型库「使用」选择；生成模型为列表（可配置多个） */
const DEFAULT_CONFIG = {
  embedModelPath: '',
  rerankModelPath: '',
  // 兼容字段（旧版单模型配置）：迁移到 models 列表后不再使用
  provider: 'ollama',          // 'ollama' | 'openai'
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  model: 'qwen2.5:7b',
  // 生成模型列表：{ id, provider:'ollama'|'openai', baseUrl, apiKey, model }
  models: [],
  currentModelId: '',
  // 应用启动时是否自动加载嵌入模型
  autoLoadEmbedding: false,
  // 索引分块全局默认：块大小（字符）与相邻重叠（字符）；未单独设置的笔记按此生成
  blockSize: 200,
  overlap: 40,
  // 单块长度上限（字符）：>0 时切分块宽度封顶，避免单块过长；0/未填=不限制（仅受块大小约束）。全局统一，不随单文件覆盖
  maxChunkSize: 300,
  // 嵌入模型下载目录（空=使用应用数据目录下的默认 models 目录）
  modelDir: '',
};

/* 嵌入式模型库：可从 HuggingFace / ModelScope 下载。repo 为远程仓库 id（保留斜杠），
 * 下载落盘到 <modelDir>/<repo>/...（transformers 缓存结构），embedModelPath 指向 <modelDir>/<repo>。
 * 说明/阈值等展示文案由渲染进程 app-settings.js 维护。 */
const EMBED_MODEL_LIB = [
  { id: 'paraphrase-multilingual-MiniLM-L12-v2', repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2' },
  { id: 'bge-small-zh-v1.5', repo: 'Xenova/bge-small-zh-v1.5' },
  { id: 'bge-base-zh-v1.5', repo: 'Xenova/bge-base-zh-v1.5' },
  { id: 'bge-large-zh-v1.5', repo: 'Xenova/bge-large-zh-v1.5' },
  { id: 'all-MiniLM-L6-v2', repo: 'Xenova/all-MiniLM-L6-v2' },
  { id: 'all-MiniLM-L12-v2', repo: 'Xenova/all-MiniLM-L12-v2' },
];

/* 重排序模型库：可从 HuggingFace / ModelScope 下载。
 * - bge-reranker-base：Xenova 官方转换的多语种重排序（onnx，modelscope/hf 均可用）
 * - bge-reranker-v2-m3-ONNX：BAAI 官方 v2-m3 无 onnx，用 BGLAW 转换的完整 onnx 仓库
 *        （含 onnx/model.onnx + tokenizer.json，与本项目 ORT 加载器匹配） */
const RERANK_MODEL_LIB = [
  { id: 'bge-reranker-base', repo: 'Xenova/bge-reranker-base' },
  { id: 'bge-reranker-v2-m3-ONNX', repo: 'BGLAW/bge-reranker-v2-m3-onnx' },
];

/* 系统提示词：约束模型只依据提供的笔记片段作答，避免幻觉 */
const SYSTEM_PROMPT = [
  '你是一个基于个人知识库的第二大脑问答助手。',
  '请优先依据下面提供的「参考笔记片段」回答用户问题；',
  '若片段不足以回答，请明确说明，不要编造事实。',
  '回答使用中文，保持简洁、条理清晰，可用 Markdown 列表。',
].join('');

/**
 * 将文本按固定长度 + 重叠切分为片段。
 * @param {string} text 原文
 * @param {number} size 片段目标长度（字符）
 * @param {number} overlap 相邻片段重叠长度
 * @returns {string[]} 非空片段数组
 * @author 火 冰
 */
function chunkText(text, size, overlap) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const chunks = [];
  const len = clean.length;
  if (!len) return chunks;
  let start = 0;
  while (start < len) {
    let end = Math.min(start + size, len);
    // 尽量在换行处切分，避免把一句话拦腰截断
    if (end < len) {
      const nl = clean.lastIndexOf('\n', end);
      if (nl > start + size * 0.5) end = nl;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= len) break;
    start = end - overlap;
  }
  return chunks;
}

/**
 * chunkText 的带偏移版本：返回值附带每块在原文中的字符起止区间（用于「文件属性」展示分块起止规则）。
 * 切片完成后再 trim，起止区间记录的是未 trim 的原始切片边界（start..end），相邻块因重叠而区间交叠。
 * @param {string} text 原文
 * @param {number} size 片段目标长度（字符）
 * @param {number} overlap 相邻片段重叠长度
 * @returns {Array<{text:string, start:number, end:number}>} 非空片段（含起止）
 * @author 火 冰
 */
function chunkTextDetailed(text, size, overlap) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const chunks = [];
  const len = clean.length;
  if (!len) return chunks;
  let start = 0;
  while (start < len) {
    let end = Math.min(start + size, len);
    if (end < len) {
      const nl = clean.lastIndexOf('\n', end);
      if (nl > start + size * 0.5) end = nl;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push({ text: piece, start: start, end: end });
    if (end >= len) break;
    start = end - overlap;
  }
  return chunks;
}

/**
 * 按「块大小 + 相邻重叠值」的配置生成分块（支持单文件覆盖的显式偏移值）。
 * 未提供 offsets 时按 (块大小 - 重叠) 的固定步长从 0 起生成；提供 offsets 时按给定起始偏移切片
 * （每块宽度 = 块大小，末块裁剪到文末），用于「属性 → 索引分块」中编辑既有块的偏移后按原样生成。
 * @param {string} text 原文
 * @param {number} size 块大小（字符）
 * @param {number} overlap 相邻重叠（字符）
 * @param {number[]} [offsets] 每块起始偏移（显式覆盖）；缺省按步长推导
 * @param {number} [maxChunkSize] 单块长度上限（字符），>0 时封顶，避免某块过长；缺省/0=不限制
 * @returns {Array<{text:string, start:number, end:number}>} 非空片段（含起止）
 * @author 火 冰
 */
function chunkConfigured(text, size, overlap, offsets, maxChunkSize) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const len = clean.length;
  if (!len) return [];
  const sizeN = Math.max(1, Math.floor(Number(size) || 200));
  const overlapN = Math.max(0, Math.floor(Number(overlap) || 0));
  // 单块宽度封顶：<= 块大小；maxChunkSize>0 时再取二者较小值（0/缺省=不限制）
  const rawCap = Math.floor(Number(maxChunkSize) || 0);
  const widthN = rawCap > 0 ? Math.min(sizeN, Math.max(1, rawCap)) : sizeN;
  let starts = [];
  if (Array.isArray(offsets) && offsets.length) {
    const seen = new Set();
    for (const s of offsets) {
      const v = Math.floor(Number(s) || 0);
      if (v >= 0 && v < len && !seen.has(v)) { seen.add(v); starts.push(v); }
    }
  } else {
    const stride = Math.max(1, sizeN - overlapN);
    for (let s = 0; s < len; s += stride) starts.push(s);
  }
  const chunks = [];
  for (const s of starts) {
    const e = Math.min(s + widthN, len);
    const piece = clean.slice(s, e).trim();
    if (piece) chunks.push({ text: piece, start: s, end: e });
  }
  return chunks;
}

/**
 * 从笔记 frontmatter 提取笔记 id；无 id 字段或解析失败时回退相对路径。
 * @param {string} text 笔记全文
 * @param {string} rel 相对路径（回退键）
 * @returns {string} 笔记 id
 * @author 火 冰
 */
function extractNoteId(text, rel) {
  try {
    const d = grayMatter(String(text || '')).data;
    if (d && typeof d.id === 'string' && d.id.trim()) return d.id.trim();
  } catch (e) { /* 无 frontmatter 或解析失败，用回退键 */ }
  return rel;
}

/**
 * 计算两个等长向量的余弦相似度。
 * @param {ArrayLike<number>} a 向量 a
 * @param {ArrayLike<number>} b 向量 b
 * @returns {number} 余弦相似度 [-1,1]
 * @author 火 冰
 */
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

/**
 * AI 引擎：负责模型加载、知识库索引、检索、重排序与大模型流式生成。
 * @author 火 冰
 */
class AiEngine {
  constructor() {
    this.cfg = Object.assign({}, DEFAULT_CONFIG);
    this.configFile = null;
    this.indexFile = null;
    this.getVaultRoot = null;
    this.embedder = null;         // feature-extraction 管道（嵌入）
    this.rerankSession = null;    // onnxruntime 会话（重排序）
    this.rerankTokenizer = null;  // 重排序分词器
    this.index = null;            // { vaultName, vaultPath, builtAt, files, chunks:[{id,noteId,path,block,text,vec}] }
    this.abort = null;            // 当前 LLM 流式请求的中止控制器
    this.indexDir = null;         // 索引持久化目录（按知识库分文件）
    this._defaultModelDir = null; // 模型下载目录的默认值（userData/models），由 init 注入
    this._queue = Promise.resolve(); // 增量索引更新串行队列
    this._embedPromise = null;
    this._rerankPromise = null;
    this._tfPromise = null;       // @xenova/transformers 动态 import 缓存
  }

  /**
   * 懒加载 @xenova/transformers（ESM 包在 CJS 下需动态 import）。
   * @returns {Promise<object>} { env, pipeline, AutoTokenizer, ... }
   * @author 火 冰
   */
  _tf() {
    if (!this._tfPromise) this._tfPromise = import('@xenova/transformers');
    return this._tfPromise;
  }

  /**
   * 初始化：绑定 vault 根目录读取器与配置文件路径，并加载已持久化配置/索引。
   * @param {{getVaultRoot: Function, configFile: string}} opts
   * @author 火 冰
   */
  init(opts) {
    if (opts) {
      if (typeof opts.getVaultRoot === 'function') this.getVaultRoot = opts.getVaultRoot;
      if (opts.configFile) this.configFile = opts.configFile;
      if (opts.indexDir) this.indexDir = opts.indexDir;
      else if (opts.configFile) this.indexDir = path.join(path.dirname(opts.configFile), 'ai-index');
      if (opts.modelDir) this._defaultModelDir = opts.modelDir;
    }
    this._loadConfig();
    this.activateVault();
    return this.getStatus();
  }

  /* ---------- 配置持久化 ---------- */

  _loadConfig() {
    try {
      const j = JSON.parse(fs.readFileSync(this.configFile, 'utf8'));
      this.cfg = Object.assign({}, DEFAULT_CONFIG, j || {});
    } catch (e) { /* 配置不存在或损坏时用默认 */ }
    this._migrateConfig();
  }

  /**
   * 生成一个简短唯一 id（时间戳 + 随机后缀）。
   * @returns {string}
   * @author 火 冰
   */
  _newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /**
   * 旧版单模型配置迁移：存在旧 provider/baseUrl/model 且列表为空时，
   * 将单模型构造为 models 列表；并保证 currentModelId 有值。
   * @author 火 冰
   */
  _migrateConfig() {
    if (!Array.isArray(this.cfg.models)) this.cfg.models = [];
    if (this.cfg.model && !this.cfg.models.length) {
      this.cfg.models.push({
        id: this._newId(),
        provider: this.cfg.provider === 'openai' ? 'openai' : 'ollama',
        baseUrl: this.cfg.baseUrl || 'http://127.0.0.1:11434',
        apiKey: this.cfg.apiKey || '',
        model: this.cfg.model,
      });
    }
    if (!this.cfg.currentModelId && this.cfg.models.length) {
      this.cfg.currentModelId = this.cfg.models[0].id;
    }
  }

  /**
   * 保存 AI 配置；配置变更后使已加载模型失效（路径可能变化）。
   * 兼容旧调用：传入单模型字段（provider/baseUrl/apiKey/model）时，
   * 若 models 列表为空则迁移为列表中的一项。
   * @param {object} cfg 新配置片段
   * @returns {object} 合并后的完整配置
   * @author 火 冰
   */
  saveConfig(cfg) {
    const next = Object.assign({}, this.cfg, cfg || {});
    if (!Array.isArray(next.models)) next.models = [];
    if (next.model && !next.models.length) {
      next.models.push({
        id: this._newId(),
        provider: next.provider === 'openai' ? 'openai' : 'ollama',
        baseUrl: next.baseUrl || 'http://127.0.0.1:11434',
        apiKey: next.apiKey || '',
        model: next.model,
      });
    }
    if (!next.currentModelId && next.models.length) {
      next.currentModelId = next.models[0].id;
    }
    this.cfg = next;
    try { fs.writeFileSync(this.configFile, JSON.stringify(this.cfg, null, 2), 'utf8'); } catch (e) { /* 忽略 */ }
    this.embedder = null; this.rerankSession = null; this.rerankTokenizer = null;
    this._embedPromise = null; this._rerankPromise = null;
    return this.cfg;
  }

  getConfig() {
    const c = Object.assign({}, this.cfg);
    // 未显式设置模型下载目录时，返回生效的默认目录，供前端默认显示（避免空串占位）
    if (!c.modelDir) c.modelDir = this._resolveModelDir();
    return c;
  }

  /* ---------- 模型加载 ---------- */

  /**
   * 加载本地嵌入模型（transformers.js feature-extraction，384 维多语言模型）。
   * @returns {object} pipeline 实例
   * @author 火 冰
   */
  async _loadEmbedder() {
    if (!this.embedder) {
      const { env, pipeline } = await this._tf();
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      const dir = this._expandModelPath(this.cfg.embedModelPath);
      env.localModelPath = path.dirname(dir) + path.sep;
      this.embedder = await pipeline('feature-extraction', path.basename(dir), { quantized: false });
    }
    return this.embedder;
  }

  /**
   * 加载本地重排序模型（bge-reranker）：分词器走 transformers.js，
   * 推理走 onnxruntime-node（外部权重格式 ONNX）。
   * @author 火 冰
   */
  async _loadReranker() {
    if (!this.rerankSession) {
      const { env, AutoTokenizer } = await this._tf();
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      const dir = this._expandModelPath(this.cfg.rerankModelPath);
      env.localModelPath = path.dirname(dir) + path.sep;
      this.rerankTokenizer = await AutoTokenizer.from_pretrained(path.basename(dir));
      this.rerankSession = await ORT.InferenceSession.create(path.join(dir, 'onnx', 'model.onnx'));
    }
    return this.rerankSession;
  }

  /** 对外：仅加载嵌入模型（供设置页/索引使用） */
  async loadEmbedding() { await this._loadEmbedder(); return this.getStatus(); }

  /* ---------- 嵌入模型库（下载目录 / 下载 / 本地检测） ---------- */

  /**
   * 展开路径中的 {modelDir} 变量：模型库「使用」会以 {modelDir}/<repo> 形式保存路径，
   * 实际加载前替换为当前生效的模型下载目录（绝对路径）。
   * @param {string} p 原始路径（可能含 {modelDir} 变量）
   * @returns {string} 展开后的绝对路径（不含变量时原样返回）
   * @author 火 冰
   */
  _expandModelPath(p) {
    if (typeof p !== 'string' || !p) return p;
    return p.replace(/\{modelDir\}(\/|\\)?/, function (m, sep) {
      return this._resolveModelDir() + (sep || '/');
    }.bind(this));
  }

  /** 解析当前生效的模型下载目录：优先用配置值，否则回落到应用数据目录下默认目录。 */
  _resolveModelDir() {
    return this.cfg.modelDir || this._defaultModelDir || path.join(process.env.APPDATA || '', 'second-brain', 'models');
  }

  /**
   * 写一条 AI 引擎日志到 userData/logs/ai-engine.log（与主进程 app.log 同目录），
   * 带时间戳；落盘失败不阻断主流程。
   * @param {string} level 日志级别（info/warn/error）
   * @param {string} msg 日志消息
   * @param {string} [detail] 补充详情
   * @author 火 冰
   */
  _log(level, msg, detail) {
    try {
      const p2 = function (n) { return String(n).padStart(2, '0'); };
      const t = new Date();
      const ts = t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' '
        + p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds()) + '.' + String(t.getMilliseconds()).padStart(3, '0');
      const line = '[' + ts + '] [' + level + '] ' + msg + (detail ? ('  | ' + detail) : '') + '\n';
      const dir = this.configFile ? path.join(path.dirname(this.configFile), 'logs') : path.join(process.env.APPDATA || '', 'second-brain', 'logs');
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(path.join(dir, 'ai-engine.log'), line, 'utf8');
    } catch (_) { /* 日志落盘失败不阻断 */ }
  }

  /** 判断某仓库是否已在目录下下载完成（onnx 权重存在即可用）。 */
  _hasModel(dir, repo) {
    return fs.existsSync(path.join(dir, repo, 'onnx', 'model.onnx'))
      || fs.existsSync(path.join(dir, repo, 'onnx', 'model_quantized.onnx'));
  }

  /** 判断目录是否视为一个已下载的本地模型（含 onnx 权重或 config.json）。 */
  _hasLocalDir(p) {
    return fs.existsSync(path.join(p, 'onnx', 'model.onnx'))
      || fs.existsSync(path.join(p, 'onnx', 'model_quantized.onnx'))
      || fs.existsSync(path.join(p, 'onnx', 'model_q8.onnx'))
      || fs.existsSync(path.join(p, 'config.json'));
  }

  /**
   * 在模型下载目录下按「仓库尾名」查找实际存在的本地模型目录。
   * 兼容 owner 前缀不一致的情况（如模型库用 Xenova/xxx，本地可能为
   * sentence-transformers/xxx），命中即视为已下载并返回其真实绝对路径。
   * @param {string} modelDir 模型下载目录
   * @param {string} repo 远端仓库 id（如 Xenova/paraphrase-multilingual-MiniLM-L12-v2）
   * @returns {string} 匹配到的本地目录绝对路径；未找到返回空串
   * @author 火 冰
   */
  _findLocalModel(modelDir, repo) {
    const tail = String(repo).split('/').pop();
    if (!tail) return '';
    // 直接位于 <modelDir>/<tail>
    const direct = path.join(modelDir, tail);
    if (this._hasLocalDir(direct)) return direct;
    // 位于 <modelDir>/<owner>/<tail>：遍历第一层 owner 目录
    let nodes = [];
    try { nodes = fs.readdirSync(modelDir, { withFileTypes: true }); } catch (_) { return ''; }
    for (let i = 0; i < nodes.length; i++) {
      const ent = nodes[i];
      if (!ent.isDirectory()) continue;
      const p = path.join(modelDir, ent.name, tail);
      if (this._hasLocalDir(p)) return p;
    }
    return '';
  }

  /** 获取模型库状态：下载目录 + 各嵌入/重排序模型是否已下载（含真实本地路径）。 */
  getModelLib() {
    const modelDir = this._resolveModelDir();
    return {
      modelDir,
      defaultModelDir: this._defaultModelDir,
      models: EMBED_MODEL_LIB.map(function (m) {
        const localPath = this._findLocalModel(modelDir, m.repo);
        return { id: m.id, repo: m.repo, localPath, local: !!localPath };
      }, this),
      rerankModels: RERANK_MODEL_LIB.map(function (m) {
        const localPath = this._findLocalModel(modelDir, m.repo);
        return { id: m.id, repo: m.repo, localPath, local: !!localPath };
      }, this),
    };
  }

  /** 设置模型下载目录：空串=恢复到默认目录；否则创建并持久化。 */
  setModelDir(dir) {
    const clean = String(dir || '').trim();
    if (!clean) {
      if (this.cfg.modelDir) delete this.cfg.modelDir;
      this.saveConfig({ modelDir: '' });
    } else {
      fs.mkdirSync(clean, { recursive: true });
      this.cfg.modelDir = clean;
      this.saveConfig({ modelDir: clean });
    }
    return this.getModelLib();
  }

  /**
   * 从远端（HuggingFace / ModelScope）下载嵌入模型到下载目录。
   * 复用 @xenova/transformers 的自动下载（落到 env.cacheDir=modelDir，结构 <repo>/...），
   * 源通过 env.remoteHost 切换；完成后由调用侧用 getModelLib 刷新本地状态。
   * @param {string} repo 远端仓库 id（如 Xenova/bge-small-zh-v1.5）
   * @param {string} source 'huggingface' | 'modelscope'
   * @param {(p:object)=>void} onProgress 进度回调
   * @returns {Promise<{ok:boolean, repo:string, modelDir:string, error?:string}>}
   * @author 火 冰
   */
  /**
   * 按序自动探测三个下载源（ModelScope → HF 镜像 → HuggingFace）的可达性，
   * 返回第一个可用源名；全部不可用时返回 null。
   * 探测使用与 transformers 下载相同的 <host>/<repo>/resolve/main/config.json 路径，
   * 每源带 8 秒超时，避免被无法连通的源长时间挂起。
   * @param {string} repo 远端仓库 id（如 Xenova/bge-small-zh-v1.5）
   * @returns {Promise<string|null>} 'modelscope'|'huggingface-mirror'|'huggingface' 或 null
   * @author 火 冰
   */
  async detectSource(repo) {
    const ORDER = [
      { name: 'modelscope', host: 'https://www.modelscope.cn/' },
      { name: 'huggingface-mirror', host: 'https://hf-mirror.com/' },
      { name: 'huggingface', host: 'https://huggingface.co/' },
    ];
    let picked = null;
    for (let i = 0; i < ORDER.length; i++) {
      const url = ORDER[i].host + repo + '/resolve/main/config.json';
      const ok = await this._probeSource(url);
      this._log(ok ? 'info' : 'warn', ok ? '下载源可用' : '下载源不可用', 'repo=' + repo + ' source=' + ORDER[i].name + ' url=' + url);
      if (ok && picked === null) picked = ORDER[i].name;
    }
    return picked;
  }

  /**
   * 探测单个 URL 是否可下载（HEAD、跟随重定向、8 秒超时）。
   * @param {string} url 待探测的完整地址
   * @returns {Promise<boolean>} 200-399 视为可用
   * @author 火 冰
   */
  _probeSource(url) {
    return new Promise(function (resolve) {
      if (typeof fetch !== 'function') return resolve(false);
      let ctrl = null, timer = null;
      if (typeof AbortController === 'function') {
        ctrl = new AbortController();
        timer = setTimeout(function () { ctrl.abort(); }, 8000);
      }
      const req = { method: 'HEAD', redirect: 'follow' };
      if (ctrl) req.signal = ctrl.signal;
      fetch(url, req).then(function (r) {
        if (timer) clearTimeout(timer);
        resolve(!!r && r.status >= 200 && r.status < 400);
      }).catch(function () {
        if (timer) clearTimeout(timer);
        resolve(false);
      });
    });
  }

  async downloadModel(repo, source, onProgress) {
    // source 为空或 auto：先自动检测并按序选首个可用源
    if (!source || source === 'auto') {
      const picked = await this.detectSource(repo);
      source = picked || 'huggingface';
      this._log('info', '自动检测选用下载源', 'repo=' + repo + ' picked=' + source);
    }
    const modelDir = this._resolveModelDir();
    fs.mkdirSync(modelDir, { recursive: true });
    const mod = await this._tf();
    const env = mod.env;
    // 源 -> 远端 host（hf-mirror 是 HuggingFace 国内直连镜像，路径结构一致；modelscope 路径模板不兼容 HF 仓库，可能 404）
    const HOST = {
      'huggingface': 'https://huggingface.co/',
      'huggingface-mirror': 'https://hf-mirror.com/',
      'modelscope': 'https://www.modelscope.cn/',
    };
    const host = HOST[source] || HOST.huggingface;
    this._log('info', '开始下载嵌入模型', 'repo=' + repo + ' source=' + (source || 'huggingface') + ' host=' + host + ' dir=' + modelDir);
    // 暂存并临时改写 transformers 全局环境（下载后必须恢复，避免污染后续本地加载）
    const prev = {
      cacheDir: env.cacheDir,
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      remoteHost: env.remoteHost,
    };
    try {
      env.cacheDir = modelDir;
      env.allowRemoteModels = true;
      env.allowLocalModels = false; // 强制从远端拉取（本次下载）
      env.remoteHost = host;
      await mod.pipeline('feature-extraction', repo, {
        quantized: false,
        progress_callback: function (p) {
          if (typeof onProgress === 'function') {
            onProgress({ repo, source, file: p.file, status: p.status, progress: p.progress, loaded: p.loaded, total: p.total });
          }
        },
      });
      const ok = this._hasModel(modelDir, repo);
      this._log(ok ? 'info' : 'warn', ok ? '嵌入模型下载完成' : '嵌入模型未检测到权重文件', 'repo=' + repo + ' dir=' + modelDir);
      return { ok, repo, source, modelDir };
    } catch (err) {
      this._log('error', '嵌入模型下载失败', 'repo=' + repo + ' host=' + host + ' err=' + ((err && err.message) || String(err))
        + ((err && err.cause && err.cause.message) ? (' cause=' + err.cause.message) : ''));
      return { ok: false, repo, source, modelDir, error: (err && err.message) || String(err) };
    } finally {
      Object.assign(env, prev);
    }
  }

  /** 在系统文件管理器中打开模型下载目录。 */
  revealModelDir() {
    const modelDir = this._resolveModelDir();
    fs.mkdirSync(modelDir, { recursive: true });
    try {
      const electron = require('electron');
      if (electron && electron.shell) electron.shell.openPath(modelDir);
    } catch (e) { /* 非 Electron 环境（如测试）忽略 */ }
  }

  /**
   * 将文本编码为归一化向量（Float32Array）。
   * @param {string} text 文本
   * @returns {Promise<Float32Array>} 384 维向量
   * @author 火 冰
   */
  async embed(text) {
    const p = await this._loadEmbedder();
    const out = await p(String(text || ''), { pooling: 'mean', normalize: true });
    return Float32Array.from(out.data);
  }

  /**
   * 计算 query 与文档的相关性得分（sigmoid(logits)）。
   * 注：transformers.js 对 XLM-R 句对编码存在缺陷（会丢弃第二段），
   * 这里手动拼接为 [CLS] q </s> d </s> 格式喂给 onnxruntime。
   * @param {string} query 查询
   * @param {string} doc 候选文档
   * @returns {Promise<number>} 得分 (0,1)
   * @author 火 冰
   */
  async rerankScore(query, doc) {
    const s = await this._loadReranker();
    const qEnc = await this.rerankTokenizer(String(query || ''), { padding: false, truncation: true, max_length: 256 });
    const dEnc = await this.rerankTokenizer(String(doc || '').slice(0, 500), { padding: false, truncation: true, max_length: 256 });
    // 去掉各自首尾的 [CLS](0)/[SEP](2) 后重新拼接
    const qIds = Array.from(qEnc.input_ids.data).map(Number).slice(1, -1);
    const dIds = Array.from(dEnc.input_ids.data).map(Number).slice(1, -1);
    const inputIds = [0, ...qIds, 2, ...dIds, 2];
    const feeds = {
      input_ids: new ORT.Tensor('int64', inputIds.map(v => BigInt(v)), [1, inputIds.length]),
      attention_mask: new ORT.Tensor('int64', inputIds.map(() => BigInt(1)), [1, inputIds.length]),
    };
    const out = await s.run(feeds);
    const logit = Number(Object.values(out)[0].data[0] || 0);
    return 1 / (1 + Math.exp(-logit));
  }

  /* ---------- 知识库索引 ---------- */

  /**
   * 递归扫描 vault 下的 .md 文件。
   * @param {string} dir 目录
   * @param {string} base 相对前缀
   * @returns {Promise<string[]>} 相对路径数组
   * @author 火 冰
   */
  async _scanMd(dir, base) {
    const out = [];
    let items = [];
    try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { return out; }
    for (const it of items) {
      if (it.name === '.second-brain') continue; // 跳过知识库元数据目录
      const abs = path.join(dir, it.name);
      const rel = base ? base + '/' + it.name : it.name;
      if (it.isDirectory()) out.push(...await this._scanMd(abs, rel));
      else if (it.isFile() && it.name.toLowerCase().endsWith('.md')) out.push(rel);
    }
    return out;
  }

  /**
   * 计算当前知识库的稳定标识（绝对路径小写哈希），用于区分不同库的索引文件。
   * @returns {string}
   * @author 火 冰
   */
  _vaultKey() {
    const root = this.getVaultRoot ? this.getVaultRoot() : '';
    const p = path.resolve(String(root || '')).toLowerCase();
    let h = 5381;
    for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** 当前知识库根目录（getVaultRoot 未注入时返回空串） */
  _currentRoot() {
    return this.getVaultRoot ? this.getVaultRoot() : '';
  }

  /** 按根目录计算索引文件 key（哈希）。 */
  _vaultKeyFor(root) {
    const p = path.resolve(String(root || '')).toLowerCase();
    let h = 5381;
    for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }

  /** 按根目录计算知识库显示名（索引元数据） */
  _vaultNameFor(root) {
    const p = String(root || '');
    return p ? path.basename(path.resolve(p)) : '默认笔记库';
  }

  /** 按根目录计算索引持久化文件路径（按库分文件） */
  _indexPathFor(root) {
    if (!this.indexDir) return null;
    return path.join(this.indexDir, this._vaultKeyFor(root) + '.index.json');
  }

  /** 当前知识库索引文件 key（哈希） */
  _vaultKey() {
    return this._vaultKeyFor(this._currentRoot());
  }

  /** 当前知识库显示名（索引元数据） */
  _vaultName() {
    return this._vaultNameFor(this._currentRoot());
  }

  /** 当前知识库索引持久化文件路径（按库分文件） */
  _indexPath() {
    return this._indexPathFor(this._currentRoot());
  }

  /** 从指定文件加载索引（含旧的单索引字段的兼容读取） */
  _loadIndexFrom(file) {
    this.index = null;
    if (!file) return;
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (j && Array.isArray(j.chunks)) {
        const files = new Set();
        this.index = {
          vaultName: j.vaultName || '',
          vaultPath: j.vaultPath || '',
          builtAt: j.builtAt || Date.now(),
          files: 0,
          chunks: j.chunks.map(function (c) {
            files.add(c.noteId || c.path);
            return { id: c.id || c.noteId + '#b' + (c.block || 0), noteId: c.noteId || c.path, path: c.path, block: c.block || 0, text: c.text, start: c.start, end: c.end, vec: new Float32Array(Buffer.from(c.v, 'base64').buffer) };
          }),
        };
        this.index.files = files.size;
      }
    } catch (e) { this.index = null; }
  }

  _saveIndex() {
    const file = this._indexPath();
    if (!file || !this.index) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload = {
        vaultName: this.index.vaultName,
        vaultPath: this.index.vaultPath,
        builtAt: this.index.builtAt,
        chunks: this.index.chunks.map(function (c) {
          return { id: c.id, noteId: c.noteId, path: c.path, block: c.block, text: c.text, start: c.start, end: c.end, v: Buffer.from(c.vec).toString('base64') };
        }),
      };
      fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
    } catch (e) { /* 索引持久化失败不阻塞 */ }
  }

  /**
   * 知识库切换后调用：重新加载当前库的索引（不存在则建立空索引）。
   * @returns {{vaultName:string, files:number, chunks:number, builtAt:number|null}}
   * @author 火 冰
   */
  activateVault() {
    this._loadIndexFrom(this._indexPath());
    if (!this.index) this.index = { vaultName: '', vaultPath: '', builtAt: null, files: 0, chunks: [] };
    this.index.vaultName = this._vaultName();
    this.index.vaultPath = this.getVaultRoot ? this.getVaultRoot() : '';
    return { vaultName: this.index.vaultName, files: this.index.files, chunks: this.index.chunks.length, builtAt: this.index.builtAt };
  }

  /** 统计当前索引涉及的去重笔记数 */
  _distinctNotes() {
    const s = new Set();
    (this.index ? this.index.chunks : []).forEach(function (c) { s.add(c.noteId); });
    return s.size;
  }

  /**
   * 重建当前知识库索引：扫描 → 切分（带 frontmatter id / 块号）→ 向量化 → 按库持久化。
   * @param {Function} onProgress 进度回调 ({done, total, path})
   * @returns {Promise<{files:number, chunks:number}>}
   * @author 火 冰
   */
  async rebuildIndex(onProgress) {
    if (!this.getVaultRoot) throw new Error('笔记库未就绪');
    const root = this.getVaultRoot();
    const files = await this._scanMd(root, '');
    const chunks = [];
    let done = 0;
    let total = 0;
    for (const f of files) {
      const prm = await this._chunkParamsFor(f);
      total += chunkConfigured(fs.readFileSync(path.join(root, f), 'utf8'), prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize).length;
    }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
      const noteId = await this._metaNoteIdFor(f, text);
      const prm = await this._chunkParamsFor(f);
      const cs = chunkConfigured(text, prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const vec = await this.embed(c.text);
        chunks.push({ id: noteId + '#b' + i, noteId, path: f, block: i, text: c.text, start: c.start, end: c.end, vec });
        done++;
        if (onProgress) onProgress({ done, total, path: f });
      }
    }
    const notes = new Set(chunks.map(function (c) { return c.noteId; }));
    this.index = { vaultName: this._vaultName(), vaultPath: root, builtAt: Date.now(), files: notes.size, chunks };
    this._saveIndex();
    return { files: notes.size, chunks: chunks.length };
  }

  /**
   * 单篇笔记内容变更（新建/保存）后增量更新索引：只重算该文件的块并替换，不影响库内其他笔记。
   * @param {string} rel 笔记相对路径
   * @returns {Promise<void>}
   * @author 火 冰
   */
  updateNote(rel) {
    const run = async () => {
      const root = this.getVaultRoot ? this.getVaultRoot() : null;
      if (!root) return;
      if (!this.index) this.activateVault();
      let text = '';
      try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return this._removeNoteWork(rel); }
      const noteId = await this._metaNoteIdFor(rel, text);
      const prm = await this._chunkParamsFor(rel);
      const cs = chunkConfigured(text, prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize);
      const fresh = [];
      for (let i = 0; i < cs.length; i++) {
        const vec = await this.embed(cs[i].text);
        fresh.push({ id: noteId + '#b' + i, noteId, path: rel, block: i, text: cs[i].text, start: cs[i].start, end: cs[i].end, vec });
      }
      this.index.chunks = this.index.chunks.filter(function (c) { return c.path !== rel; }).concat(fresh);
      this.index.files = this._distinctNotes();
      this._saveIndex();
    };
    this._queue = this._queue.then(run).catch(function () { /* 单篇增量更新失败不阻塞 */ });
    return this._queue;
  }

  /**
   * 解析某篇笔记的分块参数（块大小 / 相邻重叠 / 单块长度上限 / 显式偏移）。
   * 优先取 `.second-brain` 元数据中该笔记的 `chunk` 覆盖配置；未单独设置时回退全局默认。
   * @param {string} rel 笔记相对路径
   * @returns {Promise<{blockSize:number, overlap:number, maxChunkSize:number, offsets:number[]|null}>}
   * @author 火 冰
   */
  async _chunkParamsFor(rel) {
    const base = this.cfg || DEFAULT_CONFIG;
    const maxGlobal = Math.max(0, Math.floor(Number(base.maxChunkSize) || 0));
    const empty = {
      blockSize: Number(base.blockSize) || 200,
      overlap: Number(base.overlap) || 40,
      maxChunkSize: maxGlobal,
      offsets: null,
    };
    const root = this.getVaultRoot ? this.getVaultRoot() : null;
    if (!root || !rel) return empty;
    try {
      const r = String(rel).replace(/^\/+/, '');
      const i = r.lastIndexOf('/');
      const dir = i > 0 ? r.slice(0, i) : '';
      const name = i > 0 ? r.slice(i + 1) : r;
      const metaAbs = path.join(root, '.second-brain', ...(dir ? dir.split('/') : []), '_meta.json');
      const rec = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
      const note = (rec && rec.notes) ? rec.notes.find(function (n) { return n.name === name; }) : null;
      const c = note && note.chunk;
      if (c) return {
        blockSize: Number(c.blockSize) || empty.blockSize,
        overlap: Number(c.overlap) || empty.overlap,
        maxChunkSize: empty.maxChunkSize,   // 单块上限为全局统一配置，不随单文件覆盖
        offsets: (Array.isArray(c.offsets) && c.offsets.length) ? c.offsets.slice() : null,
      };
    } catch (e) { /* 无覆盖记录或读取失败 → 用全局默认 */ }
    return empty;
  }

  /**
   * 获取某篇笔记的稳定雪花 id：优先读 `.second-brain` 元数据 noteId（md 已不写 id），无则回退 frontmatter id/相对路径。
   * @param {string} rel 笔记相对路径
   * @param {string} [text] 笔记全文（回退时用 frontmatter id）
   * @returns {Promise<string>} 稳定的笔记唯一 id
   * @author 火 冰
   */
  async _metaNoteIdFor(rel, text) {
    const root = this.getVaultRoot ? this.getVaultRoot() : null;
    if (root && rel) {
      try {
        const r = String(rel).replace(/^\/+/, '');
        const i = r.lastIndexOf('/');
        const dir = i > 0 ? r.slice(0, i) : '';
        const name = i > 0 ? r.slice(i + 1) : r;
        const metaAbs = path.join(root, '.second-brain', ...(dir ? dir.split('/') : []), '_meta.json');
        const rec = JSON.parse(fs.readFileSync(metaAbs, 'utf8'));
        const note = (rec && rec.notes) ? rec.notes.find(function (n) { return n.name === name; }) : null;
        if (note && note.noteId) return note.noteId;
      } catch (e) { /* 无元数据 → 回退 */ }
    }
    return extractNoteId(text || '', rel);
  }

  /**
   * 删除笔记后从索引移除该文件全部块。
   * @param {string} rel 笔记相对路径
   * @returns {Promise<void>}
   * @author 火 冰
   */
  removeNote(rel) {
    this._queue = this._queue.then(function () { return this._removeNoteWork(rel); }.bind(this)).catch(function () { /* 移除失败不阻塞 */ });
    return this._queue;
  }

  /** 移除某文件的全部块（无串行包装的内部实现） */
  async _removeNoteWork(rel) {
    if (!this.index) this.activateVault();
    const before = this.index.chunks.length;
    this.index.chunks = this.index.chunks.filter(function (c) { return c.path !== rel; });
    if (this.index.chunks.length !== before) {
      this.index.files = this._distinctNotes();
      this._saveIndex();
    }
  }

  /**
   * 返回当前知识库索引的统计与按文件分组明细（供「查看索引」面板展示）。
   * @returns {{vaultName:string, files:number, blocks:number, builtAt:number|null, groups:Array}}
   * @author 火 冰
   */
  async listIndex() {
    if (!this.index) this.activateVault();
    const idx = this.index || { vaultName: '', builtAt: null, chunks: [] };
    const byPath = new Map();
    idx.chunks.forEach(function (c) {
      if (!byPath.has(c.path)) byPath.set(c.path, []);
      byPath.get(c.path).push({ id: c.id, noteId: c.noteId, block: c.block, text: (c.text || '').slice(0, 160), start: c.start, end: c.end });
    });
    const groups = [];
    byPath.forEach(function (blocks, p) {
      groups.push({ path: p, noteId: blocks[0] ? blocks[0].noteId : p, blocks: blocks });
    });
    return {
      vaultName: idx.vaultName || '',
      builtAt: idx.builtAt,
      files: byPath.size,
      blocks: idx.chunks.length,
      groups: groups,
    };
  }

  /**
   * 列出索引库中所有知识库的索引概要（含其目录当前是否仍存在）。
   * @returns {Array<{vaultPath:string, vaultName:string, builtAt:number|null, blocks:number, exists:boolean}>}
   * @author 火 冰
   */
  listIndexes() {
    const out = [];
    if (!this.indexDir) return out;
    let entries = [];
    try { entries = fs.readdirSync(this.indexDir); } catch (e) { return out; }
    for (const f of entries) {
      if (!/\.index\.json$/.test(f)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.indexDir, f), 'utf8'));
        const vp = j.vaultPath || '';
        out.push({
          vaultPath: vp,
          vaultName: j.vaultName || (vp ? path.basename(path.resolve(vp)) : f),
          builtAt: j.builtAt || null,
          blocks: Array.isArray(j.chunks) ? j.chunks.length : 0,
          exists: !!(vp && fs.existsSync(vp)),
        });
      } catch (e) { /* 损坏索引条目忽略 */ }
    }
    const cur = this._currentRoot();
    out.sort(function (a, b) {
      const ac = a.vaultPath === cur ? -1 : 0;
      const bc = b.vaultPath === cur ? -1 : 0;
      return (ac - bc) || String(a.vaultName).localeCompare(String(b.vaultName), 'zh');
    });
    return out;
  }

  /**
   * 重建指定知识库的索引并写回该库独立索引文件（不影响当前库上下文）。
   * @param {string} vaultPath 知识库根目录
   * @param {Function} [onProgress] 处理进度回调
   * @returns {Promise<{files:number, chunks:number}>}
   * @author 火 冰
   */
  async rebuildIndexFor(vaultPath, onProgress) {
    if (!vaultPath || !fs.existsSync(vaultPath)) throw new Error('知识库目录不存在：' + (vaultPath || ''));
    const root = vaultPath;
    const files = await this._scanMd(root, '');
    const chunks = [];
    let done = 0;
    let total = 0;
    for (const f of files) {
      try { total += chunkText(fs.readFileSync(path.join(root, f), 'utf8'), 200, 40).length; } catch (e) { /* 跳过坏文件 */ }
    }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
      const noteId = await this._metaNoteIdFor(f, text);
      const cs = chunkText(text, 200, 40);
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const vec = await this.embed(c);
        chunks.push({ id: noteId + '#b' + i, noteId, path: f, block: i, text: c, vec });
        done++;
        if (onProgress) onProgress({ done, total, path: f });
      }
    }
    const notes = new Set(chunks.map(function (c) { return c.noteId; }));
    const file = this._indexPathFor(root);
    if (file) {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify({
          vaultName: this._vaultNameFor(root), vaultPath: root, builtAt: Date.now(),
          chunks: chunks.map(function (c) {
            return { id: c.id, noteId: c.noteId, path: c.path, block: c.block, text: c.text, v: Buffer.from(c.vec).toString('base64') };
          }),
        }), 'utf8');
      } catch (e) { /* 索引持久化失败不阻塞 */ }
    }
    return { files: notes.size, chunks: chunks.length };
  }

  /**
   * 删除指定知识库的索引文件（知识库目录已移除时清理残留）。
   * @param {string} vaultPath 知识库根目录
   * @returns {boolean} 是否删除了索引文件
   * @author 火 冰
   */
  deleteIndex(vaultPath) {
    const file = this._indexPathFor(vaultPath);
    if (!file) return false;
    try { if (fs.existsSync(file)) { fs.unlinkSync(file); return true; } } catch (e) { /* 忽略 */ }
    return false;
  }

  /* ---------- 检索 ---------- */

  /**
   * 语义检索：余弦召回 TopN，再用本地重排序模型精排后取前 K。
   * @param {string} query 问题
   * @param {number} topK 召回数
   * @returns {Promise<Array>} [{path, sim, score, text}]
   * @author 火 冰
   */
  async retrieve(query, topK) {
    const k = topK || 20;
    if (!this.index || !this.index.chunks.length) return [];
    const qv = await this.embed(query);
    const scored = this.index.chunks.map(c => ({ path: c.path, text: c.text, vec: c.vec, sim: cosine(qv, c.vec) }));
    scored.sort((a, b) => b.sim - a.sim);
    let cand = scored.slice(0, k);
    // 重排序：模型可用时按相关性精排，失败则回退余弦排序
    let rerankOk = false;
    try { await this._loadReranker(); rerankOk = true; } catch (e) { rerankOk = false; }
    if (rerankOk) {
      for (const c of cand) {
        try { c.score = await this.rerankScore(query, c.text); } catch (e) { c.score = c.sim; }
      }
      cand.sort((a, b) => b.score - a.score);
    } else {
      cand.forEach(c => { c.score = c.sim; });
    }
    return cand.slice(0, 5).map(c => ({
      path: c.path, sim: c.sim, score: c.score, text: c.text.slice(0, 300),
    }));
  }

  /* ---------- 大模型生成 ---------- */

  /**
   * 获取当前选中的生成模型（按 currentModelId，缺省取列表第一个）。
   * @returns {{id: string, provider: string, baseUrl: string, apiKey: string, model: string}|null}
   * @author 火 冰
   */
  currentModel() {
    const list = this.cfg.models || [];
    if (!list.length) return null;
    return list.find(m => m.id === this.cfg.currentModelId) || list[0];
  }

  /**
   * 发起一次 AI 问答：检索上下文 → 组装消息 → 流式生成。
   * @param {{question: string, history: Array}} opts 参数
   * @param {Function} onToken 流式 token 回调
   * @returns {Promise<{sources: Array}>}
   * @author 火 冰
   */
  async ask({ question, history, onToken }) {
    const m = this.currentModel();
    if (!m) throw new Error('尚未配置生成模型，请到设置页添加');
    this.abort = new AbortController();
    let sources = [];
    try { sources = await this.retrieve(question, 20); } catch (e) { sources = []; }
    const ctx = sources.map((s, i) => '[来源' + (i + 1) + '] ' + s.path + '\n' + s.text).join('\n\n');
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT + (ctx ? '\n\n参考笔记片段：\n' + ctx : '\n\n（当前没有可用的笔记片段，请直接作答）') },
      ...(history || []),
      { role: 'user', content: question },
    ];
    try {
      if (m.provider === 'openai') await this._streamOpenAI(messages, m, onToken);
      else await this._streamOllama(messages, m, onToken);
    } finally {
      this.abort = null;
    }
    return { sources };
  }

  /** 停止当前流式生成 */
  stop() { if (this.abort) this.abort.abort(); }

  /**
   * OpenAI 兼容接口流式生成（SSE）。
   * @param {Array} messages 消息列表
   * @param {object} m 生成模型配置（baseUrl/apiKey/model）
   * @param {Function} onToken token 回调
   * @author 火 冰
   */
  async _streamOpenAI(messages, m, onToken) {
    const base = String(m.baseUrl || '').replace(/\/+$/, '');
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (m.apiKey || ''),
      },
      body: JSON.stringify({ model: m.model, messages, stream: true, temperature: 0.7 }),
      signal: this.abort.signal,
    });
    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => '');
      throw new Error('远程模型请求失败 ' + resp.status + ': ' + String(txt).slice(0, 200));
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta;
          if (delta && delta.content) onToken(delta.content);
        } catch (e) { /* 跳过解析失败的 SSE 行 */ }
      }
    }
  }

  /**
   * Ollama 本地大模型流式生成（NDJSON）。
   * @param {Array} messages 消息列表
   * @param {object} m 生成模型配置（baseUrl/model）
   * @param {Function} onToken token 回调
   * @author 火 冰
   */
  async _streamOllama(messages, m, onToken) {
    const base = String(m.baseUrl || '').replace(/\/+$/, '');
    const body = { model: m.model, messages, stream: true };
    // 上下文长度 num_ctx：模型配置了则随请求携带（Ollama 用 options.num_ctx 指定）
    if (m.numCtx) body.options = { num_ctx: Number(m.numCtx) };
    const resp = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: this.abort.signal,
    });
    if (!resp.ok || !resp.body) throw new Error('Ollama 请求失败 ' + resp.status);
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          const j = JSON.parse(t);
          if (j.message && j.message.content) onToken(j.message.content);
          if (j.done) return;
        } catch (e) { /* 跳过解析失败的 NDJSON 行 */ }
      }
    }
  }

  /** 获取引擎状态（模型加载、索引片段数等） */
  getStatus() {
    const m = this.currentModel();
    return {
      embeddingLoaded: !!this.embedder,
      rerankLoaded: !!this.rerankSession,
      provider: m ? m.provider : '',
      model: m ? m.model : '',
      vaultName: this.index ? this.index.vaultName : '',
      chunks: this.index ? this.index.chunks.length : 0,
      builtAt: this.index ? this.index.builtAt : null,
    };
  }

  /**
   * 获取已配置的生成模型列表（用于顶部选择器展示：供应商 + 模型名称）。
   * @returns {Promise<{models: Array<{id,provider,model}>, currentModelId: string}>}
   * @author 火 冰
   */
  async listModels() {
    const models = (this.cfg.models || []).map(m => ({
      id: m.id,
      provider: m.provider,
      model: m.model,
    }));
    return { models, currentModelId: this.cfg.currentModelId };
  }

  /**
   * 从 Ollama 服务拉取已安装模型列表（GET /api/tags），供添加/编辑生成模型时选择。
   * @param {string} baseUrl Ollama 服务地址（如 http://127.0.0.1:11434）
   * @returns {Promise<{models: Array<{name: string, size: number, modifiedAt: string}>}>}
   * @throws {Error} 服务不可达或返回非 2xx
   * @author 火 冰
   */
  async listOllamaModels(baseUrl) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const resp = await fetch(base + '/api/tags', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error('Ollama 拉取模型列表失败 ' + resp.status);
    const j = await resp.json();
    const models = Array.isArray(j.models) ? j.models : [];
    return {
      models: models.map(m => ({
        name: m.name || m.model || '',
        size: m.size || 0,
        modifiedAt: m.modified_at || '',
      })),
    };
  }

  /**
   * 管理 Ollama 模型的加载/卸载/上下文长度。
   * - 加载（load）：以 keep_alive 常驻内存（预热 + 保活），可同时设置 num_ctx 上下文长度
   * - 卸载（unload）：keep_alive=0 立即释放内存
   * @param {{baseUrl: string, model: string, action: 'load'|'unload', numCtx?: number|string}} p 参数
   * @returns {Promise<{done: boolean, action: string}>}
   * @throws {Error} 服务不可达或返回非 2xx
   * @author 火 冰
   */
  async manageOllamaModel({ baseUrl, model, action, numCtx }) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const isLoad = action !== 'unload';
    const body = {
      model: String(model || ''),
      prompt: '',
      stream: false,
      keep_alive: isLoad ? '30m' : 0, // 加载保活 30 分钟；卸载立即释放
    };
    if (isLoad && numCtx) body.options = { num_ctx: Number(numCtx) };
    const resp = await fetch(base + '/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000), // 首次加载模型可能较慢
    });
    if (!resp.ok) throw new Error('Ollama 操作失败 ' + resp.status);
    const j = await resp.json();
    return { done: !!j.done, action: isLoad ? 'load' : 'unload' };
  }
}

module.exports = { AiEngine, chunkText, chunkConfigured, cosine, extractNoteId, DEFAULT_CONFIG };
