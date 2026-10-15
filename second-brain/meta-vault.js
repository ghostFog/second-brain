/* ============================================
 * 第二脑 — 知识库元数据增量维护（.second-brain/_meta.json）
 * 作者: 火 冰
 * 纯 Node 模块（不依赖 electron），由主进程注入 fs/path/crypto 与读写回调，
 * 便于在 regression.test.js 中以临时目录做端到端断言。
 *
 * 设计口径（ED-33 / ED-35）：
 *  1. 每个目录一条 _meta.json，结构与历史一致；笔记记录新增 fh 字段
 *     （明文 sha1 前 16 位指纹），使「资源管理器复制回来且保留 mtime」
 *     的外部修改也能被检出（不依赖 mtime/size 单一条件）。
 *  2. 所有落盘走 diff：新签名与磁盘旧记录一致则跳过，文件 mtime 不变；
 *     rec.updatedAt 仅在该目录记录实际变化时推进。
 *  3. 笔记增删改：只重建其所在目录到根的祖先链；多路径（移动=新存+旧删）
 *     合并后只追踪到最近公共祖先（LCA），LCA 之上不扫描、不写入。
 *  4. 反向链接：链上/子树内笔记由全库旧快照叠加最新扫描结果回填；
 *     受牵连的链外对端笔记，仅把其所在目录作为「补丁目录」单目录重建。
 *  5. 全库/子树手动重建与打开库：扫描范围照旧，落盘仍按 diff 最小化，
 *     外部（资源管理器）手动新增/删除/修改由此被检出并只写差异目录。
 * ============================================ */
'use strict';

/** 工厂：注入运行依赖，返回某知识库根无关的元数据操作集（root 由各方法显式传入）。
 * @param {object} opts 依赖注入
 * @param {object} opts.frs fs 模块（promises API）
 * @param {object} opts.pathx path 模块
 * @param {object} opts.crypto crypto 模块（sha1 指纹）
 * @param {object} opts.grayMatter gray-matter 前端解析库
 * @param {object} opts.SnowflakeId 雪花 id 类（mid=1 进程内单例）
 * @param {(root:string, rel:string)=>Promise<string>} opts.readText 解密感知的笔记读取
 * @param {(root:string, rel:string, cleanText:string)=>Promise<void>} [opts.onStrippedId] 扫描清理历史 frontmatter id 后的写回（加密库内部应跳过）
 * @returns {object} 元数据操作方法集
 * @author 火 冰 */
function createVaultMeta(opts) {
  const frs = opts.frs;
  const pathx = opts.pathx;
  const crypto = opts.crypto;
  const grayMatter = opts.grayMatter;
  const snowflake = new opts.SnowflakeId({ mid: 1 });
  const readText = opts.readText;
  const onStrippedId = opts.onStrippedId || async function () { /* 默认不写回 */ };
  const onDiag = typeof opts.onDiag === 'function' ? opts.onDiag : function () { /* 诊断输出（可选） */ };

  /** 知识库存放元数据的隐藏目录名 */
  const META_DIR = '.second-brain';

  /* ---------------- 纯解析工具（自原 main.js 搬迁，行为不变） ---------------- */

  /** 图片扩展名集合（用于区分图片与普通附件） */
  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff']);

  /** 从笔记 frontmatter 提取属性：id / tags / 字数（去空白）。
   * @param {string} text 笔记全文
   * @param {string} name 笔记文件名（无 id 时的回退）
   * @param {string} [srcPath] 笔记完整相对路径（透传给 extractOutlinks）
   * @returns {{noteId:string, tags:string[], wordCount:number, attachments:Array, outlinks:Array}}
   * @author 火 冰 */
  function parseNoteMeta(text, name, srcPath) {
    let d = {};
    try { d = grayMatter(String(text || '')).data || {}; } catch (e) { /* frontmatter 解析失败按空处理 */ }
    const idAttr = (typeof d.id === 'string' && d.id.trim()) ? d.id.trim() : '';
    const rawTags = Array.isArray(d.tags) ? d.tags : [];
    const wordCount = String(text || '').replace(/\s+/g, '').length;
    const attachments = extractAttachments(text);
    const outlinks = extractOutlinks(text, srcPath);
    return { noteId: idAttr, tags: rawTags.map(String).filter(Boolean), wordCount, attachments, outlinks };
  }

  /** 从 Markdown 文本中提取附件/图片列表（图片语法 / [!attach] 引言 / 普通链接附件）。
   * @param {string} text 笔记全文
   * @returns {Array<{name:string, url:string, type:string}>}
   * @author 火 冰 */
  function extractAttachments(text) {
    const result = [];
    const src = String(text || '');
    const seen = new Set();

    const imgRe = /!\[([^\]]*)\]\((note:\/\/vault_res\/[^)\s]+)\)/g;
    let m;
    while ((m = imgRe.exec(src)) !== null) {
      const url = m[2];
      if (seen.has(url)) continue;
      seen.add(url);
      result.push({ name: m[1] || url.split('/').pop(), url: url, type: 'image' });
    }

    const attachRe = />\s*\[!attach\]\s+(.+?)\s+(note:\/\/vault_res\/[^\s]+)/gi;
    while ((m = attachRe.exec(src)) !== null) {
      const url2 = m[2];
      if (seen.has(url2)) continue;
      seen.add(url2);
      result.push({ name: m[1].trim(), url: url2, type: 'attachment' });
    }

    const linkRe = /(?<!\!)\[([^\]]*)\]\((note:\/\/vault_res\/[^)\s]+)\)/g;
    while ((m = linkRe.exec(src)) !== null) {
      const url3 = m[2];
      if (seen.has(url3)) continue;
      seen.add(url3);
      const ext3 = pathx.extname(url3.split('/').pop() || '').toLowerCase();
      result.push({ name: m[1] || url3.split('/').pop(), url: url3, type: IMAGE_EXTS.has(ext3) ? 'image' : 'attachment' });
    }
    return result;
  }

  /** 以基准目录解析相对路径（./ ../ 同目录 sub/ 等），返回归一后的正斜杠相对路径。
   * @author 火 冰 */
  function resolveRelPath(baseDir, rel) {
    const r = String(rel || '').replace(/^\.\//, '');
    const parts = baseDir ? String(baseDir).split('/').filter(Boolean) : [];
    const segs = r.split('/');
    for (let i = 0; i < segs.length; i++) {
      if (segs[i] === '..') parts.pop();
      else if (segs[i] === '.') continue;
      else if (segs[i]) parts.push(segs[i]);
    }
    return parts.join('/');
  }

  /** 从 Markdown 文本中提取正向链接（Wiki 链接 + 相对路径 .md 链接）。
   * @returns {Array<{path:string, name:string}>}
   * @author 火 冰 */
  function extractOutlinks(text, srcPath) {
    const result = [];
    const src = String(text || '');
    const seen = new Set();
    let baseDir = '';
    if (srcPath) {
      const si = String(srcPath).lastIndexOf('/');
      baseDir = si >= 0 ? String(srcPath).slice(0, si) : '';
    }
    const ABS_RE = /^[/\\]/;

    function pathLike(p) {
      return p.indexOf('/') >= 0 || p.indexOf('\\') >= 0 || /^\.\.?[/\\]/.test(p);
    }
    function normalize(p) {
      const cleaned = String(p).replace(/^[/\\]+/, '');
      if (ABS_RE.test(String(p))) return cleaned;
      return resolveRelPath(baseDir, cleaned);
    }

    const wikiRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
    let m;
    while ((m = wikiRe.exec(src)) !== null) {
      const target = m[1].trim();
      const targetPath = target.toLowerCase().endsWith('.md') ? target : target + '.md';
      const finalPath = pathLike(targetPath) ? normalize(targetPath) : targetPath;
      if (seen.has(finalPath)) continue;
      seen.add(finalPath);
      result.push({ path: finalPath, name: target });
    }

    const relRe = /\[([^\]]*)\]\(([^)]+)\)/g;
    while ((m = relRe.exec(src)) !== null) {
      const url = m[2].trim();
      if (/^(note:|https?:|mailto:|tel:|ftp:)/i.test(url)) continue;
      if (!url.toLowerCase().endsWith('.md')) continue;
      const resolved = normalize(url);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      const linkName = resolved.split('/').pop().replace(/\.md$/i, '');
      result.push({ path: resolved, name: linkName });
    }
    return result;
  }

  /** 从笔记 frontmatter 中移除 id: 字段（md 保持干净），返回新全文与是否移除。
   * @author 火 冰 */
  function stripMetaId(src) {
    const s = String(src || '').replace(/^\uFEFF/, '');
    const m = s.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n)?([\s\S]*)$/);
    if (!m) return { text: s, removed: false };
    const body = m[1];
    const content = m[2];
    const filtered = [];
    let removed = false;
    const lines = body.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length; i++) {
      if (!removed && /^\s*id\s*:/.test(lines[i])) { removed = true; continue; }
      filtered.push(lines[i]);
    }
    if (!removed) return { text: s, removed: false };
    while (filtered.length > 0 && filtered[0] === '') filtered.shift();
    while (filtered.length > 0 && filtered[filtered.length - 1] === '') filtered.pop();
    if (!filtered.some(function (l) { return l.trim() !== ''; })) return { text: content, removed: true };
    const text = '---\n' + filtered.join('\n') + '\n---' + (content ? '\n' + content : '');
    return { text, removed: true };
  }

  /** 确保笔记拥有唯一稳定雪花 id；优先复用元数据已有 id，其次迁移 frontmatter id，否则新生成。
   * @author 火 冰 */
  function ensureNoteId(text, prevId) {
    if (prevId) return prevId;
    try {
      const d = grayMatter(String(text || '')).data || {};
      return (typeof d.id === 'string' && d.id.trim()) ? d.id.trim() : snowflake.generate();
    } catch (e) { return snowflake.generate(); }
  }

  /** 笔记明文字节指纹（sha1 前 16 位 hex）。
   * 内容被资源管理器外部修改时（即使复制保留 mtime、等长替换）也能稳定检出。
   * @param {string} text 解密后明文
   * @returns {string} 16 位指纹
   * @author 火 冰 */
  function fileHash(text) {
    return crypto.createHash('sha1').update(String(text || ''), 'utf8').digest('hex').slice(0, 16);
  }

  /* ---------------- 路径与签名工具 ---------------- */

  /** 规范化相对路径：反斜杠转正斜杠、去前导 /、小写（与 normRel 一致，用于键比较）。
   * @author 火 冰 */
  function normKey(rel) {
    return String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  }

  /** 取笔记所在目录相对路径（无目录为空串）。
   * @author 火 冰 */
  function dirOf(rel) {
    const r = String(rel || '').replace(/^\/+/, '');
    const i = r.lastIndexOf('/');
    return i > 0 ? r.slice(0, i) : (i === 0 ? '' : '');
  }

  /** 多个目录的最近公共祖先（LCA）目录，无公共祖先时为根 ''。
   * @param {string[]} dirs 目录相对路径数组
   * @returns {string} LCA 目录相对路径
   * @author 火 冰 */
  function lcaDirs(dirs) {
    if (!dirs.length) return '';
    let common = String(dirs[0] || '').split('/').filter(Boolean);
    for (let i = 1; i < dirs.length; i++) {
      const other = String(dirs[i] || '').split('/').filter(Boolean);
      const next = [];
      for (let j = 0; j < Math.min(common.length, other.length); j++) {
        if (common[j] === other[j]) next.push(common[j]); else break;
      }
      common = next;
      if (!common.length) break;
    }
    return common.join('/');
  }

  /** 由若干笔记路径计算需重建的目录链集合：每篇笔记所在目录向上到根的并集。
   *  构建范围不做 LCA 截断——链上祖先的 children 汇总依赖下层 totalSize
   *  （内容增删改会改变子树总字节，祖先记录必须重建）；是否真正写盘由 diff 决定：
   *  同目录搬移/改名时 LCA 之上祖先汇总数值不变，签名相等自然跳过，文件 mtime 不变。
   *  跨目录移动（a/x→b/x）链并集恰为 {a、b、根}，兄弟目录不在链上、不扫描不写入。
   * @param {string[]} noteRels 发生增删改的笔记相对路径
   * @returns {Set<string>} 需重建的目录集合
   * @author 火 冰 */
  function chainFromNotes(noteRels) {
    const dirs = Array.from(new Set((noteRels || []).map(dirOf)));
    const out = new Set();
    dirs.forEach(function (d) { chainUp(d, '').forEach(function (x) { out.add(x); }); });
    return out;
  }

  /** 由单个目录向上到根（或指定截断祖先）收集目录链。
   * @param {string} dir 起始目录
   * @param {string} [stopAt] 截断祖先（含），默认根
   * @returns {Set<string>}
   * @author 火 冰 */
  function chainUp(dir, stopAt) {
    const out = new Set();
    const segs = dir ? String(dir).split('/').filter(Boolean) : [];
    const stopSegs = stopAt ? String(stopAt).split('/').filter(Boolean).length : 0;
    for (let i = segs.length; i >= stopSegs; i--) out.add(segs.slice(0, i).join('/'));
    return out;
  }

  /** 目录记录稳定签名：忽略 updatedAt；notes/backlinks/children 排序后白名单序列化。
   *  新旧签名相等 = 该目录 _meta.json 无需重写。
   * @param {object} rec 目录记录
   * @returns {string} 签名字符串
   * @author 火 冰 */
  function sigProject(rec) {
    const byPath = function (a, b) { const x = a.path || ''; const y = b.path || ''; return x < y ? -1 : x > y ? 1 : 0; };
    const byName = function (a, b) { const x = a.name || ''; const y = b.name || ''; return x < y ? -1 : x > y ? 1 : 0; };
    const notes = (rec && rec.notes || []).slice().sort(byName).map(function (n) {
      return {
        name: n.name, path: n.path, noteId: n.noteId || '', wordCount: n.wordCount || 0,
        tags: Array.isArray(n.tags) ? n.tags : [],
        size: n.size || 0, created: n.created || 0, mtime: n.mtime || 0,
        chunk: n.chunk || undefined, indexTime: n.indexTime || 0, fh: n.fh || '',
        attachments: Array.isArray(n.attachments) ? n.attachments : [],
        outlinks: Array.isArray(n.outlinks) ? n.outlinks : [],
        backlinks: (Array.isArray(n.backlinks) ? n.backlinks : []).slice().sort(byPath),
      };
    });
    const children = (rec && rec.children || []).slice().sort(byName).map(function (c) {
      return { name: c.name, type: c.type, size: c.size || 0, mtime: c.mtime || 0 };
    });
    return {
      dir: rec.dir, noteCount: rec.noteCount || 0, dirCount: rec.dirCount || 0,
      size: rec.size || 0, totalNotes: rec.totalNotes || 0, totalSize: rec.totalSize || 0,
      notes: notes, children: children,
    };
  }
  function recSignature(rec) { return JSON.stringify(sigProject(rec)); }

  /** 临时诊断（Bug-077 深查）：找两个签名投影的前若干个不同字段路径。
   * @author 火 冰 */
  function sigDiffs(a, b, p, out, limit) {
    if (out.length >= limit) return;
    if (Array.isArray(a) || Array.isArray(b)) {
      const A = a || [], B = b || [];
      if (A.length !== B.length) { out.push(p + '.len ' + A.length + '!=' + B.length); return; }
      for (let i = 0; i < A.length; i++) sigDiffs(A[i], B[i], p + '[' + i + ']', out, limit);
    } else if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
      const ks = new Set(Object.keys(a).concat(Object.keys(b)));
      for (const k of ks) sigDiffs(a[k], b[k], p + '.' + k, out, limit);
    } else if (JSON.stringify(a) !== JSON.stringify(b)) {
      out.push(p + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
    }
  }

  /* ---------------- 旧镜像读取 ---------------- */

  /** 某目录镜像 _meta.json 的绝对路径。
   * @author 火 冰 */
  function metaAbsOf(root, dir) {
    return pathx.join(root, META_DIR, ...(dir ? String(dir).split('/').filter(Boolean) : []), '_meta.json');
  }

  /** 读取某目录旧镜像记录，缺失/损坏返回 null。
   * @author 火 冰 */
  async function readOldRec(root, dir) {
    try { return JSON.parse(await frs.promises.readFile(metaAbsOf(root, dir), 'utf8')); }
    catch (e) { return null; }
  }

  /** 遍历镜像目录树，加载全部旧记录到 Map（dir 相对路径 -> rec）。
   * @returns {Promise<Map<string, object>>}
   * @author 火 冰 */
  async function loadAllOldRecs(root) {
    const map = new Map();
    const metaRoot = pathx.join(root, META_DIR);
    const walk = async function (abs, dirRel) {
      let items = [];
      try { items = await frs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
      for (const it of items) {
        if (it.isDirectory()) {
          await walk(pathx.join(abs, it.name), dirRel ? dirRel + '/' + it.name : it.name);
        } else if (it.isFile() && it.name === '_meta.json') {
          try {
            const rec = JSON.parse(await frs.promises.readFile(pathx.join(abs, it.name), 'utf8'));
            if (rec) map.set(dirRel, rec);
          } catch (e) { /* 损坏镜像忽略 */ }
        }
      }
    };
    await walk(metaRoot, '');
    return map;
  }

  /* ---------------- 目录记录扫描构建 ---------------- */

  /** 扫描单个目录（仅直接条目），构建其记录；子目录汇总由 childStats 提供。
   * @param {string} root 库根
   * @param {string} dirRel 目录相对路径（'' 为根）
   * @param {Map<string,{totalSize:number,totalNotes:number}>} childStats 子目录名 -> 汇总（新记录或旧镜像）
   * @param {object|null} prev 该目录旧镜像记录（保留 chunk/noteId/indexTime）
   * @returns {Promise<object>} 新目录记录（backlinks 尚未回填）
   * @author 火 冰 */
  async function buildDirRec(root, dirRel, childStats, prev) {
    const abs = dirRel ? pathx.join(root, ...dirRel.split('/')) : root;
    let items = [];
    try { items = await frs.promises.readdir(abs, { withFileTypes: true }); }
    catch (e) { return null; } // 目录已不存在（外部删除）→ 不出现在结果中
    const prevNotes = {};
    if (prev && Array.isArray(prev.notes)) prev.notes.forEach(function (n) { if (n && n.name) prevNotes[n.name] = n; });

    const rec = { dir: dirRel, noteCount: 0, dirCount: 0, size: 0, totalNotes: 0, totalSize: 0, notes: [], children: [], updatedAt: (prev && prev.updatedAt) || Date.now() };
    let subBytes = 0, subNotes = 0;
    const dirKids = [];

    for (const it of items) {
      if (it.name.startsWith('.')) continue; // 跳过所有隐藏项（.git/.obsidian/.second-brain/.resources 等）
      const childRel = dirRel ? dirRel + '/' + it.name : it.name;
      if (it.isDirectory()) {
        rec.dirCount++;
        const st = await frs.promises.stat(pathx.join(abs, it.name)).catch(function () { return null; });
        const sum = childStats.get(childRel) || { totalSize: 0, totalNotes: 0 };
        subBytes += sum.totalSize || 0;
        subNotes += sum.totalNotes || 0;
        dirKids.push({ name: it.name, type: 'dir', size: sum.totalSize || 0, mtime: st ? st.mtimeMs : 0 });
      } else if (it.isFile() && it.name.toLowerCase().endsWith('.md')) {
        let st = null;
        try { st = await frs.promises.stat(pathx.join(abs, it.name)); } catch (e) { continue; }
        let text = '';
        try { text = await readText(root, childRel); } catch (e) { /* 读失败仅记录元信息 */ }
        const old = prevNotes[it.name] || null;
        const noteId = ensureNoteId(text, old && old.noteId);
        const clean = stripMetaId(text);
        if (clean.removed) {
          try { await onStrippedId(root, childRel, clean.text); } catch (e) { /* 清理写回失败不阻断 */ }
          text = clean.text;
        }
        const pm = parseNoteMeta(text, it.name, childRel);
        rec.notes.push({
          name: it.name, path: childRel, noteId: noteId, wordCount: pm.wordCount,
          tags: pm.tags, size: st.size, created: st.birthtimeMs, mtime: st.mtimeMs,
          chunk: old && old.chunk || undefined,
          indexTime: old && old.indexTime || Date.now(),
          fh: fileHash(text),
          attachments: pm.attachments || [], outlinks: pm.outlinks || [],
        });
        rec.noteCount++;
        rec.size += st.size;
      }
    }
    rec.size += subBytes;
    rec.totalNotes = rec.noteCount + subNotes;
    rec.totalSize = rec.size;
    dirKids.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    rec.children = dirKids;
    return rec;
  }

  /** 递归扫描一个子树（后序），返回 dir -> rec（backlinks 未回填）。
   *  overrideMap 非空时（目录移动场景）按 rel 从其中取旧覆盖项（chunk/noteId/indexTime）。
   * @returns {Promise<Map<string, object>>}
   * @author 火 冰 */
  async function scanSubtree(root, dirRel, overrideMap) {
    const out = new Map();
    const walk = async function (d) {
      const abs = d ? pathx.join(root, ...d.split('/')) : root;
      let items = [];
      try { items = await frs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
      const childStats = new Map();
      for (const it of items) {
        if (it.name.startsWith('.') || !it.isDirectory()) continue;
        const childRel = d ? d + '/' + it.name : it.name;
        await walk(childRel);
        const childRec = out.get(childRel);
        if (childRec) childStats.set(childRel, { totalSize: childRec.totalSize, totalNotes: childRec.totalNotes });
      }
      const prev = (overrideMap && overrideMap.get(d)) || await readOldRec(root, d);
      const rec = await buildDirRec(root, d, childStats, prev);
      if (rec) out.set(d, rec);
    };
    await walk(dirRel || '');
    return out;
  }

  /* ---------------- 反向链接回填 ---------------- */

  /** 以 srcSet 为来源集合，为 records 中每篇笔记回填 backlinks（去重）。
   * @param {Map<string,object>} records 本次重建的目录记录
   * @param {Set<object>} srcSet 全库来源笔记集合（旧快照叠加最新扫描）
   * @author 火 冰 */
  function computeBacklinksFor(records, srcSet) {
    const targets = new Map();
    for (const rec of records.values()) {
      if (!rec || !Array.isArray(rec.notes)) continue;
      for (const t of rec.notes) {
        t.backlinks = [];
        targets.set(normKey(t.path), t);
        targets.set(normKey(t.name), t);
        targets.set(normKey(t.name.replace(/\.md$/i, '')), t);
      }
    }
    const resolveTarget = function (link) {
      return targets.get(normKey(link.path)) || targets.get(normKey(link.name + '.md')) || targets.get(normKey(link.name)) || null;
    };
    for (const src of srcSet) {
      if (!src || !Array.isArray(src.outlinks)) continue;
      for (const link of src.outlinks) {
        const target = resolveTarget(link);
        if (target && target.path !== src.path) {
          if (!target.backlinks.some(function (b) { return b.path === src.path; })) {
            target.backlinks.push({ path: src.path, name: String(src.name || '').replace(/\.md$/i, '') });
          }
        }
      }
    }
  }

  /* ---------------- diff 落盘与镜像清理 ---------------- */

  /** 按 diff 把记录落盘：新旧签名一致跳过（文件 mtime 不变），不一致才写；
   *  updatedAt 仅在变化时推进。返回实际写入的目录相对路径数组。
   * @param {string} root 库根
   * @param {Map<string,object>} records 待落盘记录
   * @returns {Promise<string[]>} 实际写入的目录
   * @author 火 冰 */
  async function diffWrite(root, records, tag) {
    const written = [];
    for (const [dir, rec] of records) {
      const old = await readOldRec(root, dir);
      if (old && recSignature(old) === recSignature(rec)) continue; // 无变化：不动文件
      // 临时诊断（Bug-077 深查）：为何判定要写？
      try {
        const stk = (new Error().stack || '').split('\n').slice(2, 5).map(function (s) { return s.trim(); }).join(' | ');
        if (!old) {
          onDiag('[diffWrite:' + (tag || '?') + '] dir=' + JSON.stringify(dir) + ' 原因=旧记录读取为 null（缺失/JSON 损坏/读取失败） @ ' + stk);
        } else {
          const ds = [];
          sigDiffs(sigProject(old), sigProject(rec), '$', ds, 6);
          onDiag('[diffWrite:' + (tag || '?') + '] dir=' + JSON.stringify(dir) + ' 原因=签名不一致，差异=' + JSON.stringify(ds).slice(0, 600) + ' @ ' + stk);
        }
      } catch (e) { /* 诊断失败不影响主流程 */ }
      rec.updatedAt = Date.now(); // 仅实际变化（或首次创建）时推进
      const mirrorAbs = pathx.join(root, META_DIR, ...(dir ? String(dir).split('/').filter(Boolean) : []));
      try {
        await frs.promises.mkdir(mirrorAbs, { recursive: true });
        await frs.promises.writeFile(pathx.join(mirrorAbs, '_meta.json'), JSON.stringify(rec, null, 2), 'utf8');
        written.push(dir);
      } catch (e) { /* 单目录写入失败不阻断其余目录 */ }
    }
    return written;
  }

  /** 文本文件最小化写入：磁盘内容与待写内容严格相同则跳过（mtime 不变），不存在/不同才落盘。
   *  供 recent.json 等「保存调用高频（每次打开笔记都调）但内容常无变化」的状态文件复用——
   *  打开库恢复标签也会触发保存，无比对会导致每开一次库就重写一次（同步盘据此产生无意义传输）。
   * @param {string} absPath 目标文件绝对路径
   * @param {string} content 待写文本（调用方负责序列化）
   * @returns {Promise<boolean>} true=本次实际写入；false=内容一致已跳过
   * @author 火 冰 */
  async function writeIfChanged(absPath, content) {
    try {
      const old = await frs.promises.readFile(absPath, 'utf8');
      if (old === content) return false; // 内容一致：不动文件（mtime 不变）
    } catch (e) { /* 旧文件不存在/不可读 → 继续创建 */ }
    await frs.promises.mkdir(pathx.dirname(absPath), { recursive: true });
    await frs.promises.writeFile(absPath, content, 'utf8');
    return true;
  }

  /** 从 startRel 镜像子树起，清理磁盘真实目录已不存在的残留镜像（只清理该子树内）。
   * @author 火 冰 */
  async function pruneFrom(root, startRel, liveDirs) {
    const startAbs = startRel
      ? pathx.join(root, META_DIR, ...String(startRel).split('/').filter(Boolean))
      : pathx.join(root, META_DIR);
    const walk = async function (abs, rel) {
      let items = [];
      try { items = await frs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
      for (const it of items) {
        const childRel = rel ? rel + '/' + it.name : it.name;
        if (it.isDirectory()) {
          if (liveDirs.has(childRel)) await walk(pathx.join(abs, it.name), childRel);
          else { try { await frs.promises.rm(pathx.join(abs, it.name), { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
        } else if (it.isFile() && it.name === '_meta.json') {
          if (!liveDirs.has(rel)) { try { await frs.promises.rm(pathx.join(abs, it.name), { force: true }); } catch (e) { /* 忽略 */ } }
        }
      }
    };
    await walk(startAbs, startRel || '');
  }

  /** 删除某真实目录对应的整棵镜像子树（目录删除/重命名旧位置清理）。
   * @author 火 冰 */
  async function removeMirrorTree(root, dirRel) {
    const abs = pathx.join(root, META_DIR, ...String(dirRel).split('/').filter(Boolean));
    try { await frs.promises.rm(abs, { recursive: true, force: true }); } catch (e) { /* 不存在忽略 */ }
  }

  /* ---------------- 组装：链上目录 + 对端补丁目录 ---------------- */

  /** 判断库内相对路径的 .md 当前是否真实存在（用于区分新建/删除/移动旧路径）。
   * @author 火 冰 */
  async function mdExists(root, rel) {
    try {
      const st = await frs.promises.stat(pathx.join(root, ...String(rel).split('/').filter(Boolean)));
      return st.isFile();
    } catch (e) { return false; }
  }

  /** 在旧快照中按路径或笔记名定位一篇现存笔记记录（用于反链对端目录发现）。
   * @author 火 冰 */
  function findOldNote(oldRecs, link) {
    if (!link) return null;
    for (const rec of oldRecs.values()) {
      if (!rec || !Array.isArray(rec.notes)) continue;
      for (const n of rec.notes) {
        if (!n) continue;
        if (normKey(n.path) === normKey(link.path)) return n;
      }
    }
    const stem = normKey(link.name);
    for (const rec of oldRecs.values()) {
      if (!rec || !Array.isArray(rec.notes)) continue;
      for (const n of rec.notes) {
        if (n && normKey(n.name.replace(/\.md$/i, '')) === stem) return n;
      }
    }
    return null;
  }

  /** 计算反链受牵连的「链外对端目录」集合：
   *  变化笔记新旧 outlinks 的目标笔记、旧快照中链接指向变化笔记的来源笔记，
   *  其所在目录若不在本次重建集合中，则作为补丁目录单目录重建。
   * @returns {Promise<Set<string>>}
   * @author 火 冰 */
  async function collectPeerDirs(root, oldRecs, noteRels, buildSet) {
    const peers = new Set();
    if (!noteRels.length) return peers;
    const relKeys = new Set(noteRels.map(function (r) { return normKey(r); }));
    const stemKeys = new Set(noteRels.map(function (r) { return normKey(String(r).split('/').pop().replace(/\.md$/i, '')); }));

    /** 把一篇对端笔记（须现存）的所在目录加入补丁集合 */
    const addPeerNote = async function (n) {
      if (!n || !n.path) return;
      if (buildSet.has(dirOf(n.path))) return;
      if (await mdExists(root, n.path)) peers.add(dirOf(n.path));
    };

    for (const rel of noteRels) {
      // 1) 旧快照中该路径笔记的旧 outlinks 目标
      const oldDir = dirOf(rel);
      const oldRec = oldRecs.get(oldDir);
      const oldNote = oldRec && Array.isArray(oldRec.notes) ? oldRec.notes.find(function (n) { return n && normKey(n.path) === normKey(rel); }) : null;
      if (oldNote && Array.isArray(oldNote.outlinks)) {
        for (const link of oldNote.outlinks) await addPeerNote(findOldNote(oldRecs, link));
      }
      // 2) 磁盘最新内容的新 outlinks 目标
      if (await mdExists(root, rel)) {
        let text = '';
        try { text = await readText(root, rel); } catch (e) { /* 忽略 */ }
        const links = extractOutlinks(text, rel);
        for (const link of links) await addPeerNote(findOldNote(oldRecs, link));
      }
    }
    // 3) 旧快照中链接指向任一变化笔记的来源笔记（移动后 backlinks 路径要跟着改）
    for (const rec of oldRecs.values()) {
      if (!rec || !Array.isArray(rec.notes)) continue;
      for (const n of rec.notes) {
        if (!n || !Array.isArray(n.outlinks)) continue;
        let hit = false;
        for (const link of n.outlinks) {
          if (relKeys.has(normKey(link.path)) || stemKeys.has(normKey(link.name))) { hit = true; break; }
        }
        if (hit) await addPeerNote(n);
      }
    }
    return peers;
  }

  /** 通用组装：对给定目录集合做后序单目录重建（子目录汇总取新记录→旧镜像→缺失兜底递归），
   *  叠加全库旧快照回填反链，返回待落盘 records（Map）。
   * @param {string} root 库根
   * @param {Set<string>} baseDirs 必建目录（链目录/补丁目录）
   * @param {Map<string,object>} [seedRecords] 已扫好的子树记录（子树重建/目录迁移场景）
   * @param {Map<string,object>} oldRecs 全库旧镜像快照
   * @returns {Promise<Map<string,object>>}
   * @author 火 冰 */
  async function assemble(root, baseDirs, seedRecords, oldRecs) {
    const records = new Map(seedRecords || []);
    const buildSet = new Set(records.keys());
    baseDirs.forEach(function (d) { buildSet.add(d); });

    // 缺失兜底：链目录的真实子目录若既无新记录也无旧镜像（外部新建目录树），递归补扫
    for (const d of Array.from(buildSet)) {
      const abs = d ? pathx.join(root, ...d.split('/')) : root;
      let items = [];
      try { items = await frs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { continue; }
      for (const it of items) {
        if (!it.isDirectory() || it.name.startsWith('.')) continue;
        const childRel = d ? d + '/' + it.name : it.name;
        if (buildSet.has(childRel) || oldRecs.has(childRel)) continue;
        const sub = await scanSubtree(root, childRel, null);
        for (const [k, v] of sub) { buildSet.add(k); records.set(k, v); }
      }
    }

    // seedRecords 内子树目录已构建，不重复构建；仅构建 baseDirs 中且不在 seed 的目录。
    // 后序（深度降序）保证子目录汇总先就绪；子目录汇总取值顺序：新记录 > 旧镜像 > 兜底子树。
    // 根 '' 的 split("/") 长度为 1，需显式按真实路径段数计深，确保根永远最后构建。
    const dirDepth = function (d) { return d ? String(d).split('/').filter(Boolean).length : 0; };
    const toBuild = Array.from(baseDirs).filter(function (d) { return !seedRecords || !seedRecords.has(d); })
      .sort(function (a, b) { return dirDepth(b) - dirDepth(a); });
    for (const d of toBuild) {
      const abs = d ? pathx.join(root, ...d.split('/')) : root;
      let items = [];
      try { items = await frs.promises.readdir(abs, { withFileTypes: true }); }
      catch (e) {
        // 链目录已被外部（资源管理器）删除：其镜像随之清理，父记录按实际枚举自然收缩
        if (!seedRecords || !seedRecords.has(d)) await removeMirrorTree(root, d);
        continue;
      }
      const childStats = new Map();
      for (const it of items) {
        if (!it.isDirectory() || it.name.startsWith('.')) continue;
        const childRel = d ? d + '/' + it.name : it.name;
        const fresh = records.get(childRel);
        if (process.env.SB_META_DEBUG) console.log('[dbg] build', JSON.stringify(d), 'child', childRel, 'fresh=', !!fresh, 'keys=', Array.from(records.keys()).join(','));
        if (fresh) childStats.set(childRel, { totalSize: fresh.totalSize, totalNotes: fresh.totalNotes });
        else if (oldRecs.has(childRel)) {
          const o = oldRecs.get(childRel);
          childStats.set(childRel, { totalSize: o.totalSize || 0, totalNotes: o.totalNotes || 0 });
        } // 缺失兜底已在上面展开（真实存在但无镜像的子树）
      }
      const rec = await buildDirRec(root, d, childStats, oldRecs.get(d) || null);
      if (rec) records.set(d, rec);
    }

    // 反链来源集：全库旧快照笔记（同路径新记录权威覆盖）+ 本次全部新笔记
    const srcSet = new Set();
    const newPaths = new Set();
    for (const rec of records.values()) {
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { srcSet.add(n); newPaths.add(normKey(n.path)); });
    }
    // 旧快照叠加：跳过已被新记录覆盖的同路径笔记（避免陈旧 outlinks 污染）
    for (const rec of oldRecs.values()) {
      if (!rec || !Array.isArray(rec.notes)) continue;
      for (const n of rec.notes) {
        if (n && !newPaths.has(normKey(n.path))) srcSet.add(n);
      }
    }
    computeBacklinksFor(records, srcSet);
    return records;
  }

  /* ---------------- 对外方法 ---------------- */

  /** 笔记增删改后的增量刷新：只重建相关目录链（多路径 LCA 截断）+ 反链对端补丁目录，
   *  落盘按 diff 跳过无变化目录。
   * @param {string} root 库根
   * @param {string[]} noteRels 发生变化（含删除/移动新旧路径）的笔记相对路径
   * @param {string[]} [dirRels] 发生变化的目录本身（新建目录等），其链到根
   * @returns {Promise<{written:string[], scanned:number}>}
   * @author 火 冰 */
  async function touch(root, noteRels, dirRels) {
    const notes = (noteRels || []).filter(Boolean);
    const dirs = dirRels || [];
    if (!notes.length && !dirs.length) return { written: [], scanned: 0 };
    const oldRecs = await loadAllOldRecs(root);

    const buildDirs = chainFromNotes(notes);
    // 本次移动/删除的旧路径（磁盘已不存在）对应旧镜像笔记不得作为反链来源：
    // 它们不在任何新记录中，但旧快照叠加时需按路径剔除
    const vanishedKeys = new Set();
    for (const rel of notes) {
      if (!(await mdExists(root, rel))) vanishedKeys.add(normKey(rel));
    }
    for (const d of dirs) {
      chainUp(d, '').forEach(function (x) { buildDirs.add(x); });
    }
    const peers = await collectPeerDirs(root, oldRecs, notes, buildDirs);
    peers.forEach(function (d) { buildDirs.add(d); });

    const records = await assembleWithVanish(root, buildDirs, null, oldRecs, vanishedKeys);
    const written = await diffWrite(root, records, "touch");
    return { written: written, scanned: records.size };
  }

  /** assemble 的薄包装：叠加来源集时额外剔除已消失路径的旧笔记（移动旧路径/已删除笔记）。
   * @author 火 冰 */
  async function assembleWithVanish(root, baseDirs, seedRecords, oldRecs, vanishedKeys) {
    const filteredOld = new Map(oldRecs);
    if (vanishedKeys && vanishedKeys.size) {
      for (const [d, rec] of oldRecs) {
        if (!rec || !Array.isArray(rec.notes)) continue;
        const kept = rec.notes.filter(function (n) { return n && !vanishedKeys.has(normKey(n.path)); });
        if (kept.length !== rec.notes.length) {
          filteredOld.set(d, Object.assign({}, rec, { notes: kept }));
        }
      }
    }
    return assemble(root, baseDirs, seedRecords, filteredOld);
  }

  /** 作用域重建某子树（手动「重建笔记数据」/重命名后即时刷新）：
   *  子树全部重扫 + 该子树到根的祖先链 + 链外反链对端补丁；diff 落盘；清理子树残留镜像。
   * @param {string} root 库根
   * @param {string} startRel 子树根目录（'' 为全库）
   * @returns {Promise<{dirs:number, notes:number, written:string[]}>}
   * @author 火 冰 */
  async function rebuildSubtree(root, startRel) {
    const clean = String(startRel || '').trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
    const oldRecs = await loadAllOldRecs(root);
    const seed = await scanSubtree(root, clean, null);
    const liveDirs = new Set(seed.keys());
    const baseDirs = new Set();
    // 祖先链到根（子树目录自身已在 seed 中）
    chainUp(clean, '').forEach(function (d) { if (d !== clean) baseDirs.add(d); });
    // 子树边界反链对端：以子树内全部笔记为"变化笔记"发现链外对端
    const subNotes = [];
    for (const rec of seed.values()) {
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { subNotes.push(n.path); });
    }
    const builtSet = new Set(Array.from(seed.keys()).concat(Array.from(baseDirs)));
    const peers = await collectPeerDirs(root, oldRecs, subNotes, builtSet);
    peers.forEach(function (d) { baseDirs.add(d); });
    const records = await assembleWithVanish(root, baseDirs, seed, oldRecs, new Set());
    const written = await diffWrite(root, records, "rebuildSubtree");
    records.forEach(function (_v, d) { liveDirs.add(d); });
    await pruneFrom(root, clean, liveDirs);
    let noteCount = 0;
    for (const rec of records.values()) noteCount += (rec && rec.notes ? rec.notes.length : 0);
    return { dirs: records.size, notes: noteCount, written: written };
  }

  /** 全库重建（打开库后台 / 空白区「重建笔记数据」）：全库扫描但仅 diff 落盘，
   *  并清理目录已不存在的残留镜像。外部（资源管理器）增删改由此最小修正。
   * @returns {Promise<{dirs:number, notes:number, written:string[]}>}
   * @author 火 冰 */
  async function rebuildAll(root) {
    const oldRecs = await loadAllOldRecs(root);
    const records = await scanSubtree(root, '', null);
    // 全库笔记均为最新扫描：旧快照不叠加（避免陈旧 outlinks）
    const srcSet = new Set();
    for (const rec of records.values()) {
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { srcSet.add(n); });
    }
    computeBacklinksFor(records, srcSet);
    const written = await diffWrite(root, records, "rebuildAll");
    await pruneFrom(root, '', new Set(records.keys()));
    let noteCount = 0;
    for (const rec of records.values()) noteCount += (rec && rec.notes ? rec.notes.length : 0);
    return { dirs: records.size, notes: noteCount, written: written };
  }

  /** 删除目录后的元数据维护：删除镜像子树 + 旧父目录链到根重建 + 链外反链对端补丁。
   * @param {string} root 库根
   * @param {string} dirRel 被删除目录相对路径
   * @returns {Promise<{written:string[], scanned:number}>}
   * @author 火 冰 */
  async function removeDirTree(root, dirRel) {
    const clean = String(dirRel || '').trim().replace(/[\\/]+$/g, '').replace(/\\/g, '/');
    if (!clean) return { written: [], scanned: 0 }; // 不允许删除库根本身
    const oldRecs = await loadAllOldRecs(root);
    const oldPrefix = clean + '/';

    // 收集被删子树内全部笔记路径（对端发现 + 消失路径剔除）
    const vanishedNotes = [];
    const vanishedKeys = new Set();
    for (const [d, rec] of oldRecs) {
      if (d !== clean && !d.startsWith(oldPrefix)) continue;
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { vanishedNotes.push(n.path); vanishedKeys.add(normKey(n.path)); });
    }
    await removeMirrorTree(root, clean);
    oldRecs.delete(clean);
    for (const k of Array.from(oldRecs.keys())) if (k.startsWith(oldPrefix)) oldRecs.delete(k);

    const parent = clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : '';
    const buildDirs = chainUp(parent, '');
    const peers = await collectPeerDirs(root, oldRecs, vanishedNotes, buildDirs);
    peers.forEach(function (d) { buildDirs.add(d); });
    const records = await assembleWithVanish(root, buildDirs, null, oldRecs, vanishedKeys);
    const written = await diffWrite(root, records, "removeDirTree");
    return { written: written, scanned: records.size };
  }

  /** 目录重命名/移动后的元数据维护：
   *  旧子树镜像覆盖项（noteId/chunk/indexTime）按路径映射保留 → 旧镜像整树精确移除
   *  → 新子树全扫（笔记 path 前缀与相对链接基准全部更新）→ 双父链 LCA 截断重建
   *  → 链外反链对端补丁 → diff 落盘（不做全镜像树剪枝，避免误删兄弟目录镜像）。
   * @param {string} root 库根
   * @param {string} oldRel 旧目录相对路径
   * @param {string} newRel 新目录相对路径
   * @returns {Promise<{written:string[], scanned:number}>}
   * @author 火 冰 */
  async function renameDirTree(root, oldRel, newRel) {
    const oldClean = String(oldRel || '').replace(/[\\/]+$/g, '').replace(/\\/g, '/');
    const newClean = String(newRel || '').replace(/[\\/]+$/g, '').replace(/\\/g, '/');
    if (!oldClean || !newClean || oldClean === newClean) return { written: [], scanned: 0 };
    const oldRecs = await loadAllOldRecs(root);
    const oldPrefix = oldClean + '/';
    const newPrefix = newClean + '/';

    // 1) 旧子树覆盖项按新路径映射（noteId/chunk/indexTime 随搬迁移交）
    const overrideMap = new Map();
    const movedNotes = [];
    for (const [d, rec] of oldRecs) {
      if (d !== oldClean && !d.startsWith(oldPrefix)) continue;
      const mappedDir = d === oldClean ? newClean : newPrefix + d.slice(oldPrefix.length);
      overrideMap.set(mappedDir, rec); // buildDirRec 仅取 notes 的覆盖字段，dir/path 由新扫描重算
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { movedNotes.push(n.path); });
    }
    // 2) 旧镜像树删除
    await removeMirrorTree(root, oldClean);
    for (const k of Array.from(oldRecs.keys())) if (k === oldClean || k.startsWith(oldPrefix)) oldRecs.delete(k);

    // 3) 新子树全扫（带映射覆盖）
    const seed = await scanSubtree(root, newClean, overrideMap);
    const vanishedKeys = new Set(movedNotes.map(function (p) { return normKey(p); }));

    // 4) 双父链，LCA 截断
    const oldParent = oldClean.includes('/') ? oldClean.slice(0, oldClean.lastIndexOf('/')) : '';
    const newParent = newClean.includes('/') ? newClean.slice(0, newClean.lastIndexOf('/')) : '';
    const lca = lcaDirs([oldParent, newParent]);
    const buildDirs = new Set();
    chainUp(oldParent, lca).forEach(function (d) { buildDirs.add(d); });
    chainUp(newParent, lca).forEach(function (d) { buildDirs.add(d); });

    // 5) 链外反链对端：旧路径一轮（谁链接了旧位置 / 旧位置链接谁）+
    //    新路径一轮（相对链接基准目录变化后，outlinks 解析结果可能改变）
    const newPaths = [];
    for (const rec of seed.values()) {
      if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { newPaths.push(n.path); });
    }
    const builtSet = new Set(Array.from(buildDirs).concat(Array.from(seed.keys())));
    const oldPeers = await collectPeerDirs(root, oldRecs, movedNotes, builtSet);
    oldPeers.forEach(function (d) { buildDirs.add(d); builtSet.add(d); });
    const newPeers = await collectPeerDirs(root, oldRecs, newPaths, builtSet);
    newPeers.forEach(function (d) { buildDirs.add(d); });

    const records = await assembleWithVanish(root, buildDirs, seed, oldRecs, vanishedKeys);

    // 旧子树镜像已由上方 removeMirrorTree(oldClean) 精确移除，此处不得再 pruneFrom：
    // records 只含新子树+父链+对端补丁，旧父目录下的兄弟镜像不在其中，
    // 以它为 liveDirs 剪枝会误删全部无关目录镜像（历史孤儿镜像留给全库重建清理）。
    const written = await diffWrite(root, records, "renameDirTree");
    return { written: written, scanned: records.size };
  }

  return {
    // 增量入口
    touch: touch,
    rebuildSubtree: rebuildSubtree,
    rebuildAll: rebuildAll,
    removeDirTree: removeDirTree,
    renameDirTree: renameDirTree,
    // 工具（主进程删除笔记时清理资源引用用）
    parseAttachments: extractAttachments,
    // 状态文件最小化写入（内容相同跳过，保 mtime）
    writeIfChanged: writeIfChanged,
    // 测试/诊断可见
    _internals: { chainFromNotes: chainFromNotes, lcaDirs: lcaDirs, recSignature: recSignature, META_DIR: META_DIR },
  };
}

module.exports = { createVaultMeta };
