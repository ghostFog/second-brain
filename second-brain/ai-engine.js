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

/* 默认 AI 配置：本地模型指向工作区 models 目录，生成模型为列表（可配置多个） */
const DEFAULT_CONFIG = {
  embedModelPath: 'D:/BaiduSyncdisk/work/ai/ai-second-brain/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
  rerankModelPath: 'D:/BaiduSyncdisk/work/ai/ai-second-brain/models/bge-reranker-v2-m3',
  // 兼容字段（旧版单模型配置）：迁移到 models 列表后不再使用
  provider: 'ollama',          // 'ollama' | 'openai'
  baseUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  model: 'qwen2.5:7b',
  // 生成模型列表：{ id, provider:'ollama'|'openai', baseUrl, apiKey, model }
  models: [],
  currentModelId: '',
};

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

  getConfig() { return Object.assign({}, this.cfg); }

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
      const dir = this.cfg.embedModelPath;
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
      const dir = this.cfg.rerankModelPath;
      env.localModelPath = path.dirname(dir) + path.sep;
      this.rerankTokenizer = await AutoTokenizer.from_pretrained(path.basename(dir));
      this.rerankSession = await ORT.InferenceSession.create(path.join(dir, 'onnx', 'model.onnx'));
    }
    return this.rerankSession;
  }

  /** 对外：仅加载嵌入模型（供设置页/索引使用） */
  async loadEmbedding() { await this._loadEmbedder(); return this.getStatus(); }

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
            return { id: c.id || c.noteId + '#b' + (c.block || 0), noteId: c.noteId || c.path, path: c.path, block: c.block || 0, text: c.text, vec: new Float32Array(Buffer.from(c.v, 'base64').buffer) };
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
          return { id: c.id, noteId: c.noteId, path: c.path, block: c.block, text: c.text, v: Buffer.from(c.vec).toString('base64') };
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
      total += chunkText(fs.readFileSync(path.join(root, f), 'utf8'), 200, 40).length;
    }
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
      const noteId = extractNoteId(text, f);
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
      const noteId = extractNoteId(text, rel);
      const cs = chunkText(text, 200, 40);
      const fresh = [];
      for (let i = 0; i < cs.length; i++) {
        const vec = await this.embed(cs[i]);
        fresh.push({ id: noteId + '#b' + i, noteId, path: rel, block: i, text: cs[i], vec });
      }
      this.index.chunks = this.index.chunks.filter(function (c) { return c.path !== rel; }).concat(fresh);
      this.index.files = this._distinctNotes();
      this._saveIndex();
    };
    this._queue = this._queue.then(run).catch(function () { /* 单篇增量更新失败不阻塞 */ });
    return this._queue;
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
      byPath.get(c.path).push({ id: c.id, noteId: c.noteId, block: c.block, text: (c.text || '').slice(0, 160) });
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
      const noteId = extractNoteId(text, f);
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
    const resp = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m.model, messages, stream: true }),
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
}

module.exports = { AiEngine, chunkText, cosine, extractNoteId, DEFAULT_CONFIG };
