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

/* 系统提示词：约束模型只依据提供的笔记片段作答，避免幻觉 */
const SYSTEM_PROMPT = [
  '你是一个基于个人知识库的第二大脑问答助手。',
  '请优先依据下面提供的「参考笔记片段」回答用户问题；',
  '若片段不足以回答，请明确说明，不要编造事实。',
  '回答使用中文，保持简洁、条理清晰，可用 Markdown 列表。',
].join('');

/* 内置默认 Agent「知识库助手」：不可删除、可编辑内容、可还原为初始化介绍。
 * 开启「使用知识库」（useKnowledge=true）时，调用大模型前先检索知识库并把片段拼入系统提示词。
 * 该 Agent 始终可用：即使 cfg.agents 被清空，currentAgent() 也会回退到此处定义。
 * 作者: 火 冰 */
const DEFAULT_AGENT = {
  id: 'kb-assistant',
  name: '知识库助手',
  systemPrompt: SYSTEM_PROMPT,
  useKnowledge: true,
  builtin: true,
};

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
  // 设置页「生成模型」各组运行状态自动刷新频率（秒）
  modelRefreshSec: 5,
  // 设置页「Agent 配置」：自定义角色列表 { id, name, systemPrompt } 与当前选中 id（问答时注入 systemPrompt）
  agents: [Object.assign({}, DEFAULT_AGENT)],
  currentAgentId: 'kb-assistant',
  // 应用启动时是否自动加载嵌入模型
  autoLoadEmbedding: false,
  // 应用启动时是否自动常驻「最后使用的问答模型」（Ollama keep_alive=-1，加速首次问答）
  autoResidentOnStart: true,
  // AI 问答时是否携带上文对话历史（关闭则每轮只发送当前问题；顶栏「携带历史」开关与设置页同步此配置）
  carryHistory: true,
  // 知识库检索相关度阈值（0~100）：低于该百分比的索引块不作为参考资料；0=不过滤（默认）。设置页「知识库索引」与顶栏可调
  minSimilarity: 0,
  // 索引分块全局默认：块大小（字符）与相邻重叠（字符）；未单独设置的笔记按此生成
  blockSize: 200,
  overlap: 40,
  // 单块长度上限（字符）：>0 时切分块宽度封顶，避免单块过长；0/未填=不限制（仅受块大小约束）。全局统一，不随单文件覆盖
  maxChunkSize: 300,
  // 分块策略：'fixed' 固定字符+重叠硬切（默认）；'semantic' 按标题/段落/句末语义切分（忽略重叠，块头注入 文件名+当前标题上下文）
  chunkStrategy: 'fixed',
  // 嵌入模型下载目录（空=使用应用数据目录下的默认 models 目录）
  modelDir: '',
};

/* 嵌入式模型库：可从 HuggingFace / ModelScope 下载。repo 为远程仓库 id（保留斜杠），
 * 下载落盘到 <modelDir>/<repo>/...（transformers 缓存结构），embedModelPath 指向 <modelDir>/<repo>。
 * 说明/阈值等展示文案由渲染进程 js/settings/*.js 维护。 */
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

/* Ollama keep_alive 保活时长：-1=常驻内存直到手动卸载（卸载用 0 立即释放）。
 * 设置页「加载（常驻内存）」与每次 Ollama 问答请求都带该值，避免被默认 5 分钟保活覆盖而自动卸载。
 * 作者: 火 冰 */
const OLLAMA_KEEP_ALIVE = -1;

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
 * 语义分块：按「标题层级 / 段落(空行) / 语义完整句(句末符)」作为断点切分，而非固定字符数硬切。
 * - 忽略相邻重叠；块文本以 size 为目标、maxChunkSize 为绝对上限封顶（未设上限退化为 size）。
 * - 每个块头部注入上下文前缀：文件名 + 当前所在标题（若处于二级标题下，追加「/ 一级 / 二级」链）。
 * - 返回每块正文在原文的字符区间 { text, content, start, end }（text=前缀+正文，供检索/向量化）。
 * @param {string} text 原文
 * @param {{size:number, maxChunkSize:number, fileName:string}} [opts] 目标窗宽 / 块上限 / 文件名
 * @returns {Array<{text:string, content:string, start:number, end:number}>}
 * @author 火 冰
 */
function semanticChunkText(text, opts) {
  const clean = String(text || '').replace(/\r\n/g, '\n');
  const maxLen = clean.length;
  if (!maxLen) return [];
  const size = Math.max(1, Math.floor(Number(opts && opts.size) || 200));
  const rawCap = Math.floor(Number(opts && opts.maxChunkSize) || 0);
  const cap = rawCap > 0 ? Math.max(1, rawCap) : Math.max(size, 1);
  const fileLabel = String((opts && opts.fileName) || '').trim();

  /* 句末符集合：中文标点 + 基础英文标点 + 省略符 */
  const SENT_END = new Set(['。', '！', '？', '！', '.', '!', '?', '；', ';', '…']);

  /* 按行扫描，把原文切成「标题单元」：每个标题行开启一个新单元，单元持有其所属标题链(一级/二级)与行的绝对偏移 */
  const titleRe = /^(#{1,6})\s+(.+)$/;
  const rows = [];
  let acc = 0;
  clean.split('\n').forEach(function (ln) {
    const m = ln.match(titleRe);
    rows.push({
      text: ln, start: acc, heading: !!m,
      level: m ? m[1].length : 0, titleText: m ? m[2].trim() : '',
    });
    acc += ln.length + 1;
  });

  /* 标题链维护 + 单元汇聚：h1/h2 取最近生效的一级/二级标题；三级以上不改变链 */
  const units = [];
  let h1 = '', h2 = '', curOpen = false, curStart = 0;
  const flush = function () {
    // 用布尔标志 curOpen 判断单元是否已开启：不能用数值起点 curStart 充当哨兵，
    // 否则文件以标题开头（起点为 0）时，!0 为真，后续内容行会误重置单元起点
    if (curOpen) units.push({ h1: h1, h2: h2, start: curStart });
  };
  for (const row of rows) {
    if (row.heading) {
      flush();
      if (row.level === 1) { h1 = row.titleText; h2 = ''; }
      else if (row.level === 2) { h2 = row.titleText; }
      curStart = row.start; curOpen = true;
    } else if (!curOpen) {
      // 无标题开头的内容：视为一个无链单元
      if (row.text.trim()) { curStart = row.start; curOpen = true; }
    }
    // 已进入单元：内容行不产生新单元（end 在 flush 时取全文边界，此处无需维护）
  }
  flush();

  /* 从文末补上最后的单元结束边界（统一取 maxLen），并按单元切块 */
  const makePrefix = function (file, a, b) {
    const p = [];
    if (file) p.push(file);
    if (a) p.push(a);
    if (b) p.push(b);
    return p.join(' / ');
  };

  const out = [];
  for (let ui = 0; ui < units.length; ui++) {
    const u = units[ui];
    const start = u.start;
    const end = (ui + 1 < units.length) ? units[ui + 1].start : maxLen;
    if (end <= start) continue;
    const prefix = makePrefix(fileLabel, u.h1, u.h2);

    /* 在单元正文区间内按 cap 贪心打包，块尾优先落在语义断点（行尾/句末、段落边界） */
    let p = start;
    while (p < end) {
      let win = Math.min(p + cap, end);
      let cut = win;
      if (win < end) {
        const from = Math.max(p + Math.floor(cap * 0.5), p);
        for (let i = win; i > from; i--) {
          const ch = clean[i - 1];
          if (ch === '\n' || SENT_END.has(ch)) { cut = i; break; }
        }
      }
      const content = clean.slice(p, cut).trim();
      if (content) out.push({ text: prefix ? prefix + '\n' + content : content, content: content, start: p, end: cut });
      p = cut;
    }
  }
  return out;
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
 * @param {string} [strategy] 分块策略：'semantic' 走语义分块（忽略重叠/偏移，块头注入 文件名+标题 前缀）；缺省=固定字符分块
 * @param {string} [fileName] 语义分块时注入块头的文件名（basename）
 * @returns {Array<{text:string, start:number, end:number}>} 非空片段（含起止）
 * @author 火 冰
 */
function chunkConfigured(text, size, overlap, offsets, maxChunkSize, strategy, fileName) {
  // 语义分块策略：忽略重叠与显式偏移，按标题/段落/句末语义切分，并注入「文件名+当前标题」上下文
  if (strategy === 'semantic') {
    return semanticChunkText(text, { size: size, maxChunkSize: maxChunkSize, fileName: fileName });
  }
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
    this._runningMap = {};        // Ollama 运行状态缓存：baseUrl\0model -> true（后台轮询维护）
    this._pollTimer = null;       // 可用模型后台轮询定时器
    this._available = {};         // 可用模型全局缓存：baseUrl -> { provider, models:[{name,size,modifiedAt}], updatedAt }
    this._modelCbs = [];          // 可用模型/运行状态更新回调（后台轮询刷新后触发，页面监听即实时刷新）
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
    this._residentOnStart(); // 启动常驻最后使用的问答模型（异步执行，不阻塞应用启动）
    return this.getStatus();
  }

  /**
   * 应用启动时自动常驻「最后使用的问答模型」：开关开启且当前模型为本地 Ollama 时，
   * 以 keep_alive=-1 加载并常驻内存（首次加载可能较慢，异步执行不阻塞应用启动）。
   * Ollama 服务未启动等错误静默忽略，用户问答或手动加载时再自然处理。
   * @author 火 冰
   */
  _residentOnStart() {
    const task = async function () {
      if (!this.cfg.autoResidentOnStart) return;
      const list = Array.isArray(this.cfg.models) ? this.cfg.models : [];
      if (!list.length || !this.cfg.currentModelId) return;
      const cur = list.find((m) => m && m.id === this.cfg.currentModelId);
      if (!cur || cur.provider !== 'ollama' || !cur.model) return;
      try {
        await this.manageOllamaModel({
          baseUrl: cur.baseUrl, model: cur.model, action: 'load', numCtx: cur.numCtx,
        });
      } catch (e) { /* Ollama 未启动等错误不阻塞启动，静默忽略 */ }
    };
    task.call(this);
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
      if (it.name.startsWith('.')) continue; // 跳过隐藏目录/文件（.git/.obsidian/.second-brain 等），不建索引
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
        // 加载时即过滤历史误入的隐藏路径 chunk（如 git-sync 写 .gitignore 触发的增量索引脏数据）
        const clean = j.chunks.filter(function (c) { return !this._isDotPath(c.path); }, this);
        this.index = {
          vaultName: j.vaultName || '',
          vaultPath: j.vaultPath || '',
          builtAt: j.builtAt || Date.now(),
          files: 0,
          noteIndexAt: (j && typeof j.noteIndexAt === 'object') ? j.noteIndexAt : {},
          chunks: clean.map(function (c) {
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
        noteIndexAt: this.index.noteIndexAt || {},
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
    if (!this.index) this.index = { vaultName: '', vaultPath: '', builtAt: null, files: 0, chunks: [], noteIndexAt: {} };
    this.index.vaultName = this._vaultName();
    this.index.vaultPath = this.getVaultRoot ? this.getVaultRoot() : '';
    return { vaultName: this.index.vaultName, files: this.index.files, chunks: this.index.chunks.length, builtAt: this.index.builtAt };
  }

  /**
   * 确保内存索引与「当前请求所在窗口的知识库」一致：二者根目录不一致时懒加载该库索引。
   * 应用支持多窗口/多知识库，而 AI 引擎为全局单实例、内存索引仅一份；检索前调用本方法，
   * 可让每个窗口的 AI 问答都引用『当前打开的知识库』自己的索引，而非默认库或上次加载的库。
   * @returns {object} 当前索引（可能为该库的空索引）
   * @author 火 冰
   */
  _ensureCurrentIndex() {
    if (!this.index || this.index.vaultPath !== this._currentRoot()) this.activateVault();
    return this.index;
  }

  /** 统计当前索引涉及的去重笔记数 */
  _distinctNotes() {
    const s = new Set();
    (this.index ? this.index.chunks : []).forEach(function (c) { s.add(c.noteId); });
    return s.size;
  }

  /**
   * 判断相对路径是否属于「隐藏路径」：任一路径段以 . 开头（如 .gitignore、.second-brain/x.md）。
   * 与元数据扫描 _scanMd 跳过点文件的索引口径一致，确保过滤文件/内部目录不进入向量库与检索来源。
   * @param {string} rel 相对路径
   * @returns {boolean}
   * @author 火 冰
   */
  _isDotPath(rel) {
    const segs = String(rel || '').split(/[\\/]+/).filter(Boolean);
    return segs.some(function (s) { return s.charAt(0) === '.'; });
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
      total += chunkConfigured(fs.readFileSync(path.join(root, f), 'utf8'), prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize, prm.strategy, path.basename(f)).length;
    }
    const noteIndexAt = {};   // 每篇笔记的索引生成时间（用于「索引时间 < 文件更新时间」的过期检测）
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch (e) { continue; }
      const noteId = await this._metaNoteIdFor(f, text);
      const prm = await this._chunkParamsFor(f);
      const cs = chunkConfigured(text, prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize, prm.strategy, path.basename(f));
      noteIndexAt[noteId] = Date.now();
      for (let i = 0; i < cs.length; i++) {
        const c = cs[i];
        const vec = await this.embed(c.text);
        chunks.push({ id: noteId + '#b' + i, noteId, path: f, block: i, text: c.text, start: c.start, end: c.end, vec });
        done++;
        if (onProgress) onProgress({ done, total, path: f });
      }
    }
    const notes = new Set(chunks.map(function (c) { return c.noteId; }));
    this.index = { vaultName: this._vaultName(), vaultPath: root, builtAt: Date.now(), files: notes.size, chunks, noteIndexAt };
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
      // 与 _scanMd 口径一致：隐藏路径（.gitignore/.second-brain 等）或非 .md 文件不建索引；
      // 若历史误入索引（如 git-sync 写 .gitignore 触发）则清除该路径的脏 chunk
      const relStr = String(rel || '');
      if (this._isDotPath(relStr) || !/\.md$/i.test(relStr.split(/[\\/]+/).pop() || '')) {
        if (this.index.chunks.some(function (c) { return c.path === relStr; })) {
          this.index.chunks = this.index.chunks.filter(function (c) { return c.path !== relStr; });
          this.index.files = this._distinctNotes();
          this._saveIndex();
        }
        return;
      }
      let text = '';
      try { text = fs.readFileSync(path.join(root, rel), 'utf8'); } catch (e) { return this._removeNoteWork(rel); }
      const noteId = await this._metaNoteIdFor(rel, text);
      const prm = await this._chunkParamsFor(rel);
      const cs = chunkConfigured(text, prm.blockSize, prm.overlap, prm.offsets, prm.maxChunkSize, prm.strategy, path.basename(rel));
      const indexedAt = Date.now();
      const fresh = [];
      for (let i = 0; i < cs.length; i++) {
        const vec = await this.embed(cs[i].text);
        fresh.push({ id: noteId + '#b' + i, noteId, path: rel, block: i, text: cs[i].text, start: cs[i].start, end: cs[i].end, vec });
      }
      this.index.chunks = this.index.chunks.filter(function (c) { return c.path !== rel; }).concat(fresh);
      this.index.files = this._distinctNotes();
      if (!this.index.noteIndexAt) this.index.noteIndexAt = {};
      this.index.noteIndexAt[noteId] = indexedAt;
      this._saveIndex();
    };
    this._queue = this._queue.then(run).catch(function () { /* 单篇增量更新失败不阻塞 */ });
    return this._queue;
  }

  /**
   * 手动强制重建单篇笔记的索引块（供「索引过期」补救）。
   * 复用 updateNote 的重算/替换骨架：只重算该文件块、刷新该笔记索引时间，不影响库内其他笔记。
   * @param {string} rel 笔记相对路径
   * @returns {Promise<void>}
   * @author 火 冰
   */
  rebuildNoteIndex(rel) {
    return this.updateNote(rel);
  }

  /**
   * 解析某篇笔记的分块参数（块大小 / 相邻重叠 / 单块长度上限 / 显式偏移 / 分块策略）。
   * 优先取 `.second-brain` 元数据中该笔记的 `chunk` 覆盖配置；未单独设置时回退全局默认。
   * @param {string} rel 笔记相对路径
   * @returns {Promise<{blockSize:number, overlap:number, maxChunkSize:number, offsets:number[]|null, strategy:string}>}
   * @author 火 冰
   */
  async _chunkParamsFor(rel) {
    const base = this.cfg || DEFAULT_CONFIG;
    const maxGlobal = Math.max(0, Math.floor(Number(base.maxChunkSize) || 0));
    const defaultStrategy = base.chunkStrategy === 'semantic' ? 'semantic' : 'fixed';
    const empty = {
      blockSize: Number(base.blockSize) || 200,
      overlap: Number(base.overlap) || 40,
      maxChunkSize: maxGlobal,
      offsets: null,
      strategy: defaultStrategy,
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
        strategy: c.strategy === 'semantic' ? 'semantic' : defaultStrategy,   // 单笔记可覆盖分块策略
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
      // 同步清理该笔记的索引时间戳（若来自单个 noteId）
      if (this.index.noteIndexAt) {
        const removedIds = new Set();
        this.index.chunks.forEach(function (c) { removedIds.add(c.noteId); });
        Object.keys(this.index.noteIndexAt).forEach(function (k) { if (!removedIds.has(k)) delete this.index.noteIndexAt[k]; });
      }
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
    const root = this.getVaultRoot ? this.getVaultRoot() : null;
    const byPath = new Map();
    idx.chunks.forEach(function (c) {
      if (!byPath.has(c.path)) byPath.set(c.path, []);
      byPath.get(c.path).push({ id: c.id, noteId: c.noteId, block: c.block, text: (c.text || '').slice(0, 160), start: c.start, end: c.end });
    });
    const noteIndexAt = idx.noteIndexAt || {};
    const groups = [];
    byPath.forEach(function (blocks, p) {
      const noteId = blocks[0] ? blocks[0].noteId : p;
      // 索引生成时间（该笔记全部块共享）与文件更新时间：前者 < 后者即视为「索引过期」
      let mtime = 0;
      if (root && p) { try { mtime = fs.statSync(path.join(root, p)).mtimeMs; } catch (e) { mtime = 0; } }
      groups.push({ path: p, noteId: noteId, indexedAt: noteIndexAt[noteId] || 0, mtime: mtime, blocks: blocks });
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
    // 使用「当前打开的知识库」的索引：检索前懒加载当前库索引（多窗口多库时与发起窗口的库绑定一致）。
    // 同步快照该库索引供后续异步(embed/rerank)使用，避免期间被其他窗口的检索重载覆盖。
    const idx = this._ensureCurrentIndex();
    if (!idx || !idx.chunks.length) return [];
    const qv = await this.embed(query);
    // 兜底：过滤隐藏路径 chunk（.gitignore 等），与索引口径一致，双保险
    const scored = idx.chunks
      .filter(c => !this._isDotPath(c.path))
      .map(c => ({ path: c.path, text: c.text, vec: c.vec, sim: cosine(qv, c.vec) }));
    scored.sort((a, b) => b.sim - a.sim);
    // 相关度阈值过滤：低于 minSimilarity（0~100，cfg.minSimilarity）的索引块不作为参考资料；0=不过滤
    const minSim = (this.cfg && this.cfg.minSimilarity) ? this.cfg.minSimilarity : 0;
    const cand = (minSim > 0 ? scored.filter(c => c.sim * 100 >= minSim) : scored).slice(0, k);
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
    // fullText 为索引块完整文本（供前端「查看来源块」按钮弹窗展示），text 为截断片段用于拼提示词
    return cand.slice(0, 5).map(c => ({
      path: c.path, sim: c.sim, score: c.score, text: c.text.slice(0, 300), fullText: c.text,
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
    if (!list.length && !this.cfg.currentModelId) return null;
    return this._modelById(this.cfg.currentModelId || (list[0] && list[0].id)) || list[0] || null;
  }

  /**
   * 解析模型：优先从已配置 models 查找；未命中且 id 形如 avail:<baseUrl>:<provider>:<model> 时，
   * 从可用模型全局缓存 _available 构造临时模型（AI 问答页直接选用实时可用模型）。
   * @param {string} id 模型 id（或 avail: 临时 id）
   * @returns {object|null} 模型配置 { id, provider, baseUrl, apiKey, model } 或 null
   * @author 火 冰
   */
  _modelById(id) {
    const list = this.cfg.models || [];
    const hit = list.find(function (m) { return m.id === id; });
    if (hit) return hit;
    if (id && String(id).indexOf('avail:') === 0) {
      const parts = String(id).split(':');
      const baseUrl = parts[1] || '';
      const provider = parts[2] || '';
      const model = parts.slice(3).join(':');
      const a = this._available && this._available[baseUrl];
      const exists = a && a.models && a.models.some(function (x) { return x.name === model; });
      if (exists) {
        const same = list.find(function (m) { return m.baseUrl === baseUrl && m.provider === provider; });
        return { id: id, provider: provider, baseUrl: baseUrl, apiKey: (same && same.apiKey) || '', model: model };
      }
    }
    return null;
  }

  /**
   * 获取当前选中的 Agent（自定义角色，按 currentAgentId；未选中取列表首个；列表为空回退内置默认「知识库助手」）。
   * @returns {{id: string, name: string, systemPrompt: string, useKnowledge: boolean}|object} 内置默认 Agent（始终可用）
   * @author 火 冰
   */
  currentAgent() {
    const list = this.cfg.agents || [];
    const cur = this.cfg.currentAgentId;
    // 优先 currentAgentId；未命中取列表首个；列表为空回退内置默认「知识库助手」（不可删除，始终可用）
    let a = (cur && list.length) ? list.find(x => x.id === cur) || null : null;
    if (!a && list.length) a = list[0];
    return a || DEFAULT_AGENT;
  }

  /**
   * 发起一次 AI 问答：检索上下文 → 组装消息 → 流式生成。
   * @param {{question: string, history: Array, agent: object|null, devMode?: boolean}} opts 参数
   *        agent 为当前选中的自定义 Agent（含 systemPrompt），未配置时为 null
   *        devMode 为「开发者模式」开关（外层设置-常规存储），开启时打印完整提示词并返回检索耗时
   * @param {Function} onToken 流式 token 回调
   * @returns {Promise<{sources: Array, retrieveMs: number}>}
   * @author 火 冰
   */
  async ask({ question, history, onToken, agent, modelId, devMode }) {
    const m = modelId ? this._modelById(String(modelId)) : this.currentModel();
    if (!m) throw new Error('尚未配置生成模型，请到设置页添加');
    this.abort = new AbortController();
    // 是否使用知识库：Agent 关闭（useKnowledge=false）则不检索、不拼接笔记片段，直接问答
    const useKb = agent ? (agent.useKnowledge !== false) : true;
    let sources = [];
    let ctx = '';
    let retrieveMs = 0;
    if (useKb) {
      const _rt = Date.now();
      try { sources = await this.retrieve(question, 20); } catch (e) { sources = []; }
      retrieveMs = Date.now() - _rt;
      ctx = sources.map((s, i) => '[来源' + (i + 1) + '] ' + s.path + '\n' + s.text).join('\n\n');
    }
    // Agent 自定义系统提示词即完整系统提示词（含角色/行为指令）；未配置时使用默认 SYSTEM_PROMPT
    const sys = (agent && agent.systemPrompt && String(agent.systemPrompt).trim())
      ? String(agent.systemPrompt).trim()
      : SYSTEM_PROMPT;
    let sysContent = sys;
    if (useKb) {
      sysContent += ctx ? '\n\n参考笔记片段：\n' + ctx : '\n\n（当前没有可用的笔记片段，请直接作答）';
    }
    const messages = [
      { role: 'system', content: sysContent },
      ...(history || []),
      { role: 'user', content: question },
    ];
    // 调试：开发者模式开启（或旧配置 printFullPrompt 残留）时，把完整请求消息（含系统提示词）打印到控制台
    if (devMode || this.cfg.printFullPrompt) {
      console.log('[调试·完整提示词] ' + JSON.stringify(messages, null, 2));
    }
    try {
      if (m.provider === 'openai') await this._streamOpenAI(messages, m, onToken, agent);
      else await this._streamOllama(messages, m, onToken, agent);
    } finally {
      this.abort = null;
    }
    return { sources, retrieveMs };
  }

  /** 停止当前流式生成 */
  stop() { if (this.abort) this.abort.abort(); }

  /**
   * 提取 Agent 生成参数（仅返回已配置且合法的字段；未配置/非法值忽略，流式函数走各自默认）。
   * @param {object|null} agent 当前 Agent
   * @returns {{temperature?: number, topP?: number, maxTokens?: number}}
   * @author 火 冰
   */
  _agentParams(agent) {
    const p = {};
    if (agent && typeof agent.temperature === 'number' && !isNaN(agent.temperature)) p.temperature = agent.temperature;
    if (agent && typeof agent.topP === 'number' && !isNaN(agent.topP)) p.topP = agent.topP;
    if (agent && Number.isInteger(agent.maxTokens) && agent.maxTokens > 0) p.maxTokens = agent.maxTokens;
    return p;
  }

  /**
   * OpenAI 兼容接口流式生成（SSE）。
   * @param {Array} messages 消息列表
   * @param {object} m 生成模型配置（baseUrl/apiKey/model）
   * @param {Function} onToken token 回调
   * @param {object|null} agent 当前 Agent（生成参数覆盖默认 temperature，top_p/max_tokens 仅配置时携带）
   * @author 火 冰
   */
  async _streamOpenAI(messages, m, onToken, agent) {
    const base = String(m.baseUrl || '').replace(/\/+$/, '');
    const body = { model: m.model, messages, stream: true, temperature: 0.7 };
    // Agent 生成参数：temperature 覆盖默认 0.7；top_p / max_tokens 配置了才随请求携带
    const ap = this._agentParams(agent);
    if (ap.temperature !== undefined) body.temperature = ap.temperature;
    if (ap.topP !== undefined) body.top_p = ap.topP;
    if (ap.maxTokens !== undefined) body.max_tokens = ap.maxTokens;
    const resp = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (m.apiKey || ''),
      },
      body: JSON.stringify(body),
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
  async _streamOllama(messages, m, onToken, agent) {
    const base = String(m.baseUrl || '').replace(/\/+$/, '');
    const body = { model: m.model, messages, stream: true, keep_alive: OLLAMA_KEEP_ALIVE };
    // 生成参数合并：num_ctx（模型级）+ Agent 级 temperature / top_p / max_tokens（num_predict），仅配置的字段才携带
    const ap = this._agentParams(agent);
    const opts = {};
    if (m.numCtx) opts.num_ctx = Number(m.numCtx);
    if (ap.temperature !== undefined) opts.temperature = ap.temperature;
    if (ap.topP !== undefined) opts.top_p = ap.topP;
    if (ap.maxTokens !== undefined) opts.num_predict = ap.maxTokens;
    if (Object.keys(opts).length) body.options = opts;
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
   * 获取已配置的生成模型列表（用于顶部选择器展示：供应商 + 模型名称 + 可用标记）。
   * 可用性：远程 OpenAI 模型始终可用（无「运行中」概念）；本地 Ollama 模型按 baseUrl 去重查询
   * /api/ps，仅当前正在运行的标记为可用（running=true）。
   * @returns {Promise<{models: Array<{id,provider,model,running}>, currentModelId: string}>}
   * @author 火 冰
   */
  async listModels() {
    const models = (this.cfg.models || []);
    const urls = [];
    // 对 Ollama 模型按 baseUrl 去重，避免同地址重复查询
    models.forEach(function (m) {
      if (m.provider !== 'ollama') return;
      const u = String(m.baseUrl || '');
      if (u && urls.indexOf(u) === -1) urls.push(u);
    });
    // key = baseUrl + '\u0000' + model 名，命中表示该 Ollama 模型正在运行
    const runningSet = new Set();
    await Promise.all(urls.map(async function (u) {
      try {
        const r = await this.listRunningModels(u);
        (r && Array.isArray(r.models) ? r.models : []).forEach(function (md) {
          if (md && md.name) runningSet.add(String(u) + '\u0000' + md.name);
        });
      } catch (e) { /* 服务不可达：该组 Ollama 模型视为不可用 */ }
    }.bind(this)));
    return {
      models: models.map(m => ({
        id: m.id,
        provider: m.provider,
        model: m.model,
        running: m.provider === 'openai' || runningSet.has(String(m.baseUrl || '') + '\u0000' + m.model),
      })),
      currentModelId: this.cfg.currentModelId,
    };
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
      signal: AbortSignal.timeout(3000),
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
      keep_alive: isLoad ? OLLAMA_KEEP_ALIVE : 0, // 加载常驻内存；卸载立即释放
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

  /**
   * 获取 Ollama 正在运行的模型列表（GET /api/ps），供「生成模型」列表按运行状态显示 加载/卸载 按钮。
   * @param {string} baseUrl Ollama 服务地址（如 http://127.0.0.1:11434）
   * @returns {Promise<{models: Array<{name: string, size: number, sizeVram: number, expiresAt: string}>}>}
   * @throws {Error} 服务不可达或返回非 2xx
   * @author 火 冰
   */
  async listRunningModels(baseUrl) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const resp = await fetch(base + '/api/ps', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) throw new Error('Ollama 获取运行模型失败 ' + resp.status);
    const j = await resp.json();
    const models = Array.isArray(j.models) ? j.models : [];
    return {
      models: models.map(m => ({
        name: m.name || m.model || '',
        size: m.size || 0,
        sizeVram: m.size_vram || 0,
        expiresAt: m.expires_at || '',
      })),
    };
  }

  /**
   * 刷新所有配置的 Ollama 服务运行状态到 _runningMap 缓存（baseUrl\0model -> true）。
   * 服务不可达/超时静默保留旧状态。由后台轮询与设置页手动刷新共用。
   * @returns {Promise<Object>} 最新运行状态映射
   * @author 火 冰
   */
  async refreshRunningMap() {
    const urls = [];
    (this.cfg.models || []).forEach(function (m) {
      if (m.provider !== 'ollama') return;
      const u = String(m.baseUrl || '');
      if (u && urls.indexOf(u) === -1) urls.push(u);
    });
    const next = {};
    await Promise.all(urls.map(async function (u) {
      try {
        const r = await this.listRunningModels(u);
        (r && Array.isArray(r.models) ? r.models : []).forEach(function (md) {
          if (md && md.name) next[String(u) + '\u0000' + md.name] = true;
        });
      } catch (e) { /* 服务不可达：该组视为无运行中模型 */ }
    }.bind(this)));
    this._runningMap = next;
    return next;
  }

  /**
   * 从 OpenAI 兼容服务拉取可用模型列表（GET /models），供可用模型全局缓存与设置页选择。
   * @param {string} baseUrl 服务地址
   * @param {string} apiKey API Key（可为空）
   * @returns {Promise<{models: Array<{name: string}>}>}
   * @throws {Error} 服务不可达或返回非 2xx
   * @author 火 冰
   */
  async listOpenAiModels(baseUrl, apiKey) {
    const base = String(baseUrl || '').replace(/\/+$/, '');
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
    const resp = await fetch(base + '/models', {
      method: 'GET',
      headers: headers,
      signal: AbortSignal.timeout(3000),
    });
    if (!resp.ok) throw new Error('OpenAI 获取模型列表失败 ' + resp.status);
    const j = await resp.json();
    const models = Array.isArray(j.data) ? j.data : [];
    return {
      models: models.map(function (m) { return { name: m.id || m.model || '', size: 0, modifiedAt: '' }; }),
    };
  }

  /**
   * 刷新可用模型全局缓存 _available（baseUrl -> { provider, models, updatedAt }）：
   * 按已配置模型去重 baseUrl，Ollama 走 /api/tags、OpenAI 兼容走 /models。
   * 服务不可达时缓存置 { error } 并保留旧数据？不：失败即标记，下次轮询恢复。
   * @returns {Promise<Object>} 最新可用模型缓存
   * @author 火 冰
   */
  async refreshAvailableModels() {
    const models = this.cfg.models || [];
    const seen = {};
    models.forEach(function (m) {
      const u = String(m.baseUrl || '');
      if (u && !seen[u]) seen[u] = m;
    });
    await Promise.all(Object.keys(seen).map(async function (u) {
      const m = seen[u];
      try {
        const r = m.provider === 'openai'
          ? await this.listOpenAiModels(u, m.apiKey)
          : await this.listOllamaModels(u);
        this._available[u] = {
          provider: m.provider,
          models: (r && Array.isArray(r.models) ? r.models : []),
          updatedAt: Date.now(),
          error: '',
        };
      } catch (e) {
        this._available[u] = { provider: m.provider, models: [], updatedAt: Date.now(), error: String((e && e.message) || e) };
      }
    }.bind(this)));
    return this._available;
  }

  /**
   * 启动可用模型后台轮询：立即执行一次（刷新运行状态 + 可用模型全局缓存），
   * 之后每 interval 毫秒同步一次。由 main.js 在引擎初始化（配置加载完成）后调用。
   * @param {number} interval 轮询间隔毫秒（默认 5000）
   * @returns {void}
   * @author 火 冰
   */
  startModelPolling(interval) {
    if (this._pollTimer) return;
    const run = () => {
      // 并行刷新运行状态与可用模型缓存，全部完成后触发更新钩子（页面监听即实时刷新）
      Promise.all([
        this.refreshRunningMap().catch(() => {}),
        this.refreshAvailableModels().catch(() => {}),
      ]).then(() => this._notifyModelsUpdated());
    };
    run(); // 打开软件后台调用一次（配置已加载，立即可查）
    this._pollTimer = setInterval(run, interval || 5000);
  }

  /**
   * 注册「模型数据更新」钩子：后台轮询（或手动刷新）完成一次数据刷新后触发，页面监听后即可实时刷新。
   * 与 stopModelPolling 解耦——轮询停止后回调数组保留，重启轮询仍可继续通知。
   * @param {Function} cb 更新回调（无参）
   * @returns {void}
   * @author 火 冰
   */
  onModelsUpdated(cb) {
    if (typeof cb !== 'function') return;
    if (this._modelCbs.indexOf(cb) === -1) this._modelCbs.push(cb);
  }

  /**
   * 遍历通知所有已注册的模型数据更新回调（内部调用，含异常隔离，单个回调报错不影响其余）。
   * @returns {void}
   * @author 火 冰
   */
  _notifyModelsUpdated() {
    this._modelCbs.forEach(function (cb) {
      try { cb(); } catch (e) { /* 单回调异常隔离 */ }
    });
  }

  /**
   * 停止可用模型后台轮询（应用退出时调用，防残留定时器）。
   * @returns {void}
   * @author 火 冰
   */
  stopModelPolling() {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  /**
   * 获取当前后台轮询缓存的 Ollama 运行状态映射（baseUrl\0model -> true）。
   * @returns {Object} 运行状态映射（可能为空对象）
   * @author 火 冰
   */
  getRunningMap() {
    return this._runningMap || {};
  }

  /**
   * 获取可用模型全局缓存（baseUrl -> { provider, models:[{name,size,modifiedAt}], updatedAt, error }）。
   * 软件启动后即由后台轮询维护，设置页与 AI 问答页共用同一份实时数据。
   * @returns {Object} 可用模型缓存
   * @author 火 冰
   */
  getAvailableModels() {
    return this._available || {};
  }
}

module.exports = { AiEngine, chunkText, chunkConfigured, semanticChunkText, cosine, extractNoteId, DEFAULT_CONFIG };
