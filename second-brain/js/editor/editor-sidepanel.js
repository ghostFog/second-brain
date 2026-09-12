/* ============================================
 * 第二脑 — 编辑器宿主·侧边面板
 * 作者: 火 冰
 * 功能: 目录/文件属性、索引分块、反向链接、索引面板
 * ============================================ */

'use strict';

  /* 字节大小格式化 */
  function fmtSizeFn() {
    return function (b) { if (typeof b !== 'number' || b < 0) return '–'; if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; };
  }
  /* 时间格式化（仅到分钟） */
  function relDateFn() {
    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    return function (ms) { if (!ms) return ''; const d = new Date(ms); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  }
  /* 属性行：label + inner 内容 */
  function propRow(label, inner) {
    return '<div class="flex items-start gap-2 py-1"><span class="w-16 shrink-0 text-[11px] mt-0.5" style="color: var(--note-ink-3);">' + label + '</span>' + inner + '</div>';
  }

  /* 渲染目录属性视图：路径 / 占用大小 / 内容(子目录·笔记个数) / 创建时间 / 修改时间。 */
  async function renderDirProps(box, dir, rootSel) {
    const napi = window.noteDesktop || {};
    let rec = null;
    if (napi && napi.dirMeta) { try { rec = await napi.dirMeta(dir); } catch (_) { /* 忽略 */ } }
    if (!rec) { box.innerHTML = '<p class="text-[11px]" style="color: var(--note-ink-3);">无法读取目录属性。</p>'; return; }
    const fmt = fmtSizeFn(), rd = relDateFn();
    let html = '';
    html += propRow('路径', '<span class="text-[11px] break-all" style="color: var(--note-ink-2);">' + (dir ? esc(dir) : '/（根目录）') + '</span>');
    html += propRow('占用大小', '<span class="text-[11px]"><span class="nums text-[11px]" style="color: var(--note-brand-300);">' + fmt(rec.totalSize) + '</span></span>');
    html += propRow('内容', '<span class="text-[11px]" style="color: var(--note-ink-2);"><span class="nums">' + rec.dirCount + '</span> 个子目录 · <span class="nums">' + rec.noteCount + '</span> 篇直接 · 共 <span class="nums">' + rec.totalNotes + '</span> 篇</span>');
    html += propRow('创建时间', '<span class="text-[11px]" style="color: var(--note-ink-2);">' + (rec.created ? rd(rec.created) : '—') + '</span>');
    html += propRow('修改时间', '<span class="text-[11px]" style="color: var(--note-ink-2);">' + (rec.mtime ? rd(rec.mtime) : rd(rec.updatedAt)) + '</span>');
    box.innerHTML = html;
  }

  /* 渲染右侧面板「文件属性」。
   * 两种视图：
   *  A. 选中目录（edSel.type==='folder'）→ 目录属性（文件列表 + 大小）
   *  B. 打开笔记 → 笔记属性（文档 id / 路径 / 自身大小字数标签时间 / 所在目录内容 / 索引分块起止）
   * 数据源：知识库内 .second-brain 元数据（fileMeta/dirMeta），无桌面桥接时降级用 AI listIndex。
   * 作者: 火 冰 */
  async function renderFileProps() {
    const box = $('ed-fileprops');
    if (!box) return;
    const napi = window.noteDesktop || {};
    const fmt = fmtSizeFn(), rd = relDateFn();
    // A. 目录属性
    if (edSel && edSel.type === 'folder' && napi.dirMeta) {
      await renderDirProps(box, edSel.path, edSel.path === '');
      refreshIcons();
      renderChunkPanel();   // 目录视图：清空独立「索引分块」区块
      return;
    }
    if (!edCurrent) {
      box.innerHTML = '<p class="text-[11px]" style="color: var(--note-ink-3);">请打开一篇笔记，或在左侧文件树选中目录查看其属性。</p>';
      renderChunkPanel();
      return;
    }
    // B. 笔记属性
    const ed = (window.noteDesktop || {}).ai || null;
    let meta = null, note = null, group = null;
    if (napi && napi.fileMeta) { try { const fm = await napi.fileMeta(edCurrent); meta = fm.meta || null; note = fm.note || null; } catch (_) { /* 忽略 */ } }
    try { if (ed && ed.listIndex) { const d = await ed.listIndex() || {}; group = ((d.groups || []).find(function (g) { return g.path === edCurrent; })) || null; } } catch (_) { /* 忽略 */ }
    const fileName = edCurrent.split('/').pop();
    const docId = (note && note.noteId) || (group && group.noteId) || fileName;
    let html = '';
	html += propRow('文档id', '<span class="text-[11px] break-all" style="color: var(--note-ink-2);">' + esc(docId) + '</span>');
	html += propRow('路径', '<span class="text-[11px] break-all" style="color: var(--note-ink-2);">' + esc(edCurrent) + '</span>');
    if (note) {
      // 笔记自身属性（文档 id / 路径 / 大小 / 创建 / 更新时间合并为一项，无独立分组）
		html += propRow('占用大小', '<span class="text-[11px]"><span class="nums text-[11px]" style="color: var(--note-brand-300);">' + fmt(note.size) + '</span></span>');
		html += propRow('创建时间', '<span class="text-[11px]" style="color: var(--note-ink-2);">' + (note.created ? rd(note.created) : '—') + '</span>');
		html += propRow('修改时间', '<span class="text-[11px]" style="color: var(--note-ink-2);">' + (note.mtime ? rd(note.mtime) : rd(note.updatedAt)) + '</span>');
    }
    // 所在目录属性：目录数 / 笔记数 / 总大小
    if (meta) {
      html += '<div class="border-t mt-1 pt-2" style="border-color: var(--note-border);"><p class="text-[11px]" style="color: var(--note-ink-2);">所在目录属性 <span class="text-[10px]" style="color: var(--note-ink-3);">' + (meta.dir ? esc(meta.dir) : '/') + '</span></p>'
        + '<div class="text-[11px] mt-1 space-y-0.5" style="color: var(--note-ink-3);">'
        + '<div>目录数：<span class="nums">' + meta.dirCount + '</span> 个</div>'
        + '<div>笔记数：<span class="nums">' + meta.totalNotes + '</span> 篇（直接 <span class="nums">' + meta.noteCount + '</span>）</div>'
        + '<div>总大小：<span class="nums" style="color: var(--note-brand-300);">' + fmt(meta.totalSize) + '</span></div>'
        + '</div></div>';
    }
    // 索引分块已拆分到独立区块（renderChunkPanel 单独渲染，不再内嵌到属性）
    box.innerHTML = html;
    refreshIcons();
    renderChunkPanel();
  }

  /* 渲染独立「索引分块」区块：
   *  - 打开笔记：读取该笔记元数据并委托 renderChunkSection 渲染可编辑分块面板
   *  - 未打开笔记 / 选中目录：显示占位提示
   * 与 renderFileProps 同步调用，保证切笔记 / 切目录时索引分块随属性一起刷新。
   * @returns {void}
   * @author 火 冰 */
  async function renderChunkPanel() {
    const box = $('ed-chunk');
    if (!box) return;
    if (!edCurrent || (edSel && edSel.type === 'folder')) {
      box.innerHTML = '<p class="text-[11px] pl-3" style="color: var(--note-ink-3);">请打开一篇笔记查看其索引分块。</p>';
      return;
    }
    const napi = window.noteDesktop || {};
    let note = null;
    if (napi && napi.fileMeta) { try { const fm = await napi.fileMeta(edCurrent); note = fm.note || null; } catch (_) { /* 忽略 */ } }
    renderChunkSection(edCurrent, note);
  }

  /* 渲染「属性 → 索引分块」可编辑面板：
   *  - 顶部：块大小 / 相邻重叠 输入框（单文件覆盖，未单独设置的按全局默认生成）
   *  - 块列表：块名称(b0/b1…) + 偏移值（该块起始偏移）两列，支持编辑
   *  - 偏移调整两种模式：仅本块（只改当前块，其他不变）/ 整体平移（当前块变化后后续整体平移）
   *  - 保存（持久化到笔记 chunk 覆盖）与恢复默认（清除覆盖）
   * 数据源：笔记覆盖配置 note.chunk 或全局默认 ai.getConfig；预览块来自 ai.previewChunk。
   * @param {string} rel 笔记相对路径
   * @param {object|null} note 该笔记的元数据记录（含可能的 chunk 覆盖）
   * @returns {Promise<void>}
   * @author 火 冰 */
  async function renderChunkSection(rel, note) {
    const box = $('ed-chunk');
    if (!box || !rel) return;
    const napi = window.noteDesktop || {};
    const ai = napi.ai || {};
    // 读取全局默认参数
    let cfg = {};
    if (ai.getConfig) { try { cfg = (await ai.getConfig()) || {}; } catch (_) { /* 忽略 */ } }
    const defBlock = Math.max(1, Math.floor(Number(cfg.blockSize) || 200));
    const defOverlap = Math.max(0, Math.floor(Number(cfg.overlap) || 40));
    const defMax = Math.max(0, Math.floor(Number(cfg.maxChunkSize) || 0));
    const defStrategy = cfg.chunkStrategy === 'semantic' ? 'semantic' : 'fixed';
    // 单文件覆盖参数（未覆盖则用全局默认）
    const override = (note && note.chunk) || null;
    const blockSize = Math.max(1, Math.floor(Number(override && override.blockSize ? override.blockSize : defBlock)));
    const overlap = Math.max(0, Math.floor(Number(override && override.overlap !== undefined ? override.overlap : defOverlap)));
    const maxChunk = Math.max(0, Math.floor(Number(override && override.maxChunkSize !== undefined ? override.maxChunkSize : defMax)));
    const strategy = (override && override.strategy === 'semantic') ? 'semantic' : defStrategy;
    const hasOffsets = Array.isArray(override && override.offsets) && override.offsets.length > 0;
    const st = { rel: rel, blockSize: blockSize, overlap: overlap, maxChunkSize: maxChunk, strategy: strategy, mode: 'single', offsets: hasOffsets ? override.offsets.map(Number) : null, rows: [] };
    // ===== 构建面板骨架 =====
    box.innerHTML =
      '<div class="flex items-center gap-2 mb-1.5">'
      + '<div class="flex-1"><div class="text-[10px]" style="color:var(--note-ink-3);">块大小</div><input type="number" min="1" class="ed-chunk-size w-full rounded px-1.5 py-0.5 text-[10px] nums outline-none" value="' + blockSize + '" title="单文件块大小（字符）；留空请编辑该笔记的设置或恢复默认" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
      + '<div class="flex-1"><div class="text-[10px]" style="color:var(--note-ink-3);">相邻重叠</div><input type="number" min="0" class="ed-chunk-overlap w-full rounded px-1.5 py-0.5 text-[10px] nums outline-none" value="' + overlap + '" title="相邻分块重叠字符数" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
      + '</div>'
      + '<div class="flex items-center gap-2 mt-1 mb-1">'
      + '<span class="text-[10px] shrink-0" style="color:var(--note-ink-3);">切分策略</span>'
      + '<select class="ed-chunk-strategy flex-1 rounded px-1.5 py-0.5 text-[10px] outline-none" title="分块策略：语义分块按标题/段落/句末切分并注入文件名与标题上下文" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"><option value="fixed"' + (st.strategy !== 'semantic' ? ' selected' : '') + '>固定字符</option><option value="semantic"' + (st.strategy === 'semantic' ? ' selected' : '') + '>语义分块</option></select>'
      + '</div>'
      + '<div class="flex flex-wrap items-center gap-1 mb-1">'
      + '<span class="text-[10px]" style="color:var(--note-ink-2);">偏移调整：</span>'
      + '<button class="ed-chunk-mode px-1.5 py-0.5 rounded text-[10px] border" data-mode="single" title="只调整当前块的偏移值，其他块不变" style="border-color:var(--note-border); color:var(--note-ink);">仅本块</button>'
      + '<button class="ed-chunk-mode px-1.5 py-0.5 rounded text-[10px] border" data-mode="shift" title="当前块偏移变化时，后续块整体平移相同的差值" style="border-color:var(--note-border); color:var(--note-ink-2);">整体平移</button>'
      + '<button class="ed-chunk-load px-1.5 py-0.5 rounded text-[10px] border ml-auto" title="按当前块大小/重叠重新推导默认分块（覆盖显式偏移）" style="border-color:var(--note-border); color:var(--note-ink-2);">按默认推导</button>'
      + '</div>'
      + '<div class="ed-chunk-list rounded border divide-y" style="border-color:var(--note-border);"></div>'
      + '<div class="flex items-center gap-1.5 mt-1">'
      + '<button class="ed-chunk-save px-2 py-1 rounded text-[11px] font-medium" style="background:var(--note-brand-600); color:#FFFFFF;">保存</button>'
      + '<button class="ed-chunk-reset px-2 py-1 rounded text-[11px] border" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">恢复默认</button>'
      + '<span class="ed-chunk-hint text-[9px] ml-auto" style="color:var(--note-ink-3);"></span>'
      + '</div>';
    refreshIcons();
    const listEl = box.querySelector('.ed-chunk-list');
    const hintEl = box.querySelector('.ed-chunk-hint');
    const hint = function (m) { if (hintEl) hintEl.textContent = m || ''; };

    // 高亮当前偏移调整模式
    const paintMode = function () {
      box.querySelectorAll('.ed-chunk-mode').forEach(function (b) {
        b.style.background = b.dataset.mode === st.mode ? 'rgba(124,58,237,0.15)' : '';
        b.style.color = b.dataset.mode === st.mode ? 'var(--note-brand-400)' : 'var(--note-ink-2)';
      });
      hint((st.mode === 'shift') ? '平移模式：调整本块，后续整体平移' : '单块模式：只调整当前块，其他不变');
    };

    // 生成块列表 HTML：块名称 + 偏移值（含 end 参考）
    const paintRows = function (blocks) {
      listEl.innerHTML = '';
      if (!blocks || !blocks.length) { listEl.innerHTML = '<p class="px-2 py-2 text-[10px]" style="color:var(--note-ink-3);">（无分块）</p>'; st.rows = []; return; }
      st.rows = blocks.map(function (b) { return { start: b.start, end: b.end, text: b.text || '' }; });
      listEl.innerHTML = st.rows.map(function (r, i) {
        return '<div class="flex items-center gap-2 px-2 py-1">'
          + '<span class="nums text-[10px] shrink-0" style="color:var(--note-brand-300); width:26px;">b' + i + '</span>'
          + '<input type="number" min="0" class="ed-chunk-off nums w-[72px] shrink-0 rounded px-1 py-0.5 text-[10px] outline-none" data-idx="' + i + '" value="' + r.start + '" title="' + esc((r.text || '').slice(0, 200)) + '" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">'
          + '<span class="text-[9px] shrink-0" style="color:var(--note-ink-3);">至 ' + r.end + '</span>'
          + '<span class="text-[9px] truncate flex-1" style="color:var(--note-ink-3);">' + esc((r.text || '').replace(/\s+/g, ' ')) + '</span>'
          + '</div>';
      }).join('');
    };

    // 用当前参数预览分块并刷新列表
    const loadRows = async function (offsets) {
      listEl.innerHTML = '<p class="px-2 py-2 text-[10px]" style="color:var(--note-ink-3);">计算中…</p>';
      let blocks = null;
      if (ai.previewChunk) {
        try { const res = await ai.previewChunk(st.rel, st.blockSize, st.overlap, offsets, st.maxChunkSize, st.strategy); blocks = (res && res.ok) ? res.blocks : null; }
        catch (_) { blocks = null; }
      }
      if (!blocks) { listEl.innerHTML = '<p class="px-2 py-2 text-[10px]" style="color:var(--note-ink-3);">预览失败（桌面端需重启后生效）</p>'; return; }
      paintRows(blocks);
    };

    paintMode();
    loadRows(hasOffsets ? st.offsets : null);

    // 偏移调整模式切换
    box.querySelectorAll('.ed-chunk-mode').forEach(function (b) {
      b.addEventListener('click', function () { st.mode = b.dataset.mode; paintMode(); });
    });
    // 按默认推导：清除显式偏移，改按块大小/重叠推导
    const load = box.querySelector('.ed-chunk-load');
    if (load) load.addEventListener('click', function () { st.offsets = null; loadRows(null); });
    // 切分策略变更：重新预览（语义分块由内容驱动，清空显式偏移）
    const stratSel = box.querySelector('.ed-chunk-strategy');
    if (stratSel) stratSel.addEventListener('change', function () {
      st.strategy = stratSel.value === 'semantic' ? 'semantic' : 'fixed';
      st.offsets = null;
      loadRows(null);
    });
    // 块大小 / 重叠 变更：重新预览
    ['ed-chunk-size', 'ed-chunk-overlap'].forEach(function (cls) {
      const inp = box.querySelector('.' + cls);
      if (inp) inp.addEventListener('change', function () {
        if (cls === 'ed-chunk-size') st.blockSize = Math.max(1, Math.floor(Number(inp.value) || 200));
        else st.overlap = Math.max(0, Math.floor(Number(inp.value) || 0));
        loadRows(st.offsets);   // 有显式偏移则保留，否则按步长推导
      });
    });
    // 偏移值编辑（委托）：仅本块 / 整体平移
    listEl.addEventListener('change', function (e) {
      const input = e.target.closest('.ed-chunk-off');
      if (!input) return;
      const idx = Number(input.dataset.idx);
      // 首次编辑：把当前预览行冻结为显式偏移数组
      if (!Array.isArray(st.offsets)) st.offsets = st.rows.map(function (r) { return r.start; });
      if (idx >= st.offsets.length) return;
      const old = st.offsets[idx];
      let nv = Math.max(0, Math.floor(Number(input.value) || old));
      if (nv === old) return;
      const delta = nv - old;
      st.offsets[idx] = nv;
      if (st.mode === 'shift') { for (let j = idx + 1; j < st.offsets.length; j++) st.offsets[j] += delta; }
      input.value = nv;
      loadRows(st.offsets);
    });
    // 保存覆盖配置：有显式偏移则一并保存
    const save = box.querySelector('.ed-chunk-save');
    if (save) save.addEventListener('click', async function () {
      if (!napi.saveNoteChunk) { showToast('桌面端才支持保存索引分块配置'); return; }
      const payload = Array.isArray(st.offsets) && st.offsets.length
        ? { blockSize: st.blockSize, overlap: st.overlap, offsets: st.offsets, strategy: st.strategy }
        : { blockSize: st.blockSize, overlap: st.overlap, strategy: st.strategy };
      try { const res = await napi.saveNoteChunk(st.rel, payload); showToast(res && res.ok ? '已保存，重建索引后生效' : '保存失败'); }
      catch (err) { showToast('保存失败：' + ((err && err.message) || err)); }
    });
    // 恢复默认：清除覆盖，回到全局默认
    const reset = box.querySelector('.ed-chunk-reset');
    if (reset) reset.addEventListener('click', async function () {
      if (!napi.saveNoteChunk) { showToast('桌面端才支持恢复默认'); return; }
      try {
        const res = await napi.saveNoteChunk(st.rel, { reset: true });
        if (res && res.ok) {
          st.blockSize = defBlock; st.overlap = defOverlap; st.strategy = defStrategy; st.offsets = null;
          const s = box.querySelector('.ed-chunk-size'); if (s) s.value = defBlock;
          const o = box.querySelector('.ed-chunk-overlap'); if (o) o.value = defOverlap;
          const sel = box.querySelector('.ed-chunk-strategy'); if (sel) sel.value = defStrategy;
          loadRows(null);
          showToast('已恢复全局默认，重建索引后生效');
        } else { showToast('恢复默认失败'); }
      } catch (err) { showToast('恢复默认失败：' + ((err && err.message) || err)); }
    });
  }

  /* 渲染反向链接 */
  function renderBacklinks() {
    const box = $('ed-backlinks'); if (!box) return;
    if (!edCurrent) { box.innerHTML = ''; const c = $('ed-backlink-count'); if (c) c.textContent = '0'; return; }
    const currentName = edCurrent.split('/').pop().replace(/\.md$/, '');
    const refs = [];
    Object.keys(edOutdated).forEach(p => {
      if (p === edCurrent) return;
      const c = edOutdated[p] || '';
      const re = new RegExp('\\[\\[' + currentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:\\.[a-z0-9]+)?\\]\\]|\\[\\[' + currentName, 'i');
      if (re.test(c)) refs.push({ path: p, name: p.split('/').pop() });
    });
    const c = $('ed-backlink-count'); if (c) c.textContent = String(refs.length);
    if (!refs.length) { box.innerHTML = '<p class="text-[11px] pl-3" style="color: var(--note-ink-3);">（无反向链接）</p>'; return; }
    box.innerHTML = refs.map(r => '<div class="mx-3 p-2.5 rounded-md border cursor-pointer transition-colors hover:opacity-90" data-open="' + esc(r.path) + '" style="border-color: var(--note-border); background: var(--note-surface-2);">'
      + '<div class="flex items-center gap-1.5 mb-1.5"><i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-brand-400);"></i><span class="text-[12px] font-medium" style="color: var(--note-ink);">' + esc(r.name) + '</span></div>'
      + '<p class="text-[11px] leading-relaxed" style="color: var(--note-ink-3);">' + (edOutdated[r.path] || '').slice(0, 40) + '…</p>'
      + '</div>').join('');
    refreshIcons();
  }

  /* 查看当前笔记索引：展开/收起编辑区内联面板（只展示当前打开笔记的分块） */
  function renderIndexPanel() {
    const panel = $('ed-index-panel');
    if (!panel) return;
    const body = $('ed-index-body'), pathEl = $('ed-index-path'), countEl = $('ed-index-count');
    const pathNow = edCurrent || '';
    if (pathEl) pathEl.textContent = pathNow || '';
    if (countEl) countEl.textContent = '';
    if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">读取索引…</span>';
    const ai = (window.noteDesktop || {}).ai;
    if (!pathNow) {
      if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">请先打开一篇笔记。</span>';
      return;
    }
    if (!ai || !ai.listIndex) {
      if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">当前环境未启用索引（需桌面版并配置嵌入模型）。</span>';
      return;
    }
    ai.listIndex().then(function (d) {
      d = d || {};
      const g = (d.groups || []).find(function (it) { return it.path === pathNow; });
      const blocks = (g && g.blocks) || [];
      if (countEl) countEl.textContent = blocks.length ? blocks.length + ' 块' : '0 块';
      if (!blocks.length) {
        if (body) body.innerHTML = '<span style="color: var(--note-ink-3);">本篇尚未建立索引。请到 AI 问答页点击「重建索引」后重试。</span>';
        return;
      }
      // 索引过期检测：该篇索引生成时间早于文件修改时间 → 顶部提示并提供「重建本篇索引」
      const stale = !!g && !!g.indexedAt && !!g.mtime && g.indexedAt < g.mtime;
      const staleBar = stale
        ? '<div class="rounded-md px-3 py-2 mb-2 text-[12px] flex items-center justify-between gap-2" style="color: var(--state-danger); background: var(--note-surface-2);"><span>索引已过期（文件已被修改）</span><button data-action="rebuild-note-index" class="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium" style="background: var(--note-brand-600); color: #FFFFFF;">重建本篇</button></div>'
        : '';
      body.innerHTML = staleBar + blocks.map(function (blk) {
        return '<div class="rounded-md px-3 py-2 mb-2 text-[12px] leading-relaxed" style="color: var(--note-ink-2); background: var(--note-surface-2);">'
          + '<div class="mb-1 flex flex-wrap items-center gap-2 font-mono text-[10px]" style="color: var(--note-ink-3);">'
          + '<span title="笔记 id">' + esc(blk.noteId) + '</span><span>块 ' + (blk.block + 1) + '</span><span class="nums" title="块 id">' + esc(blk.id) + '</span>'
          + '</div>' + esc(blk.text) + '</div>';
      }).join('');
      var rebuildBtn = body && body.querySelector('[data-action="rebuild-note-index"]');
      if (rebuildBtn) {
        rebuildBtn.addEventListener('click', function () {
          if (!ai.rebuildNoteIndex) return;
          body.innerHTML = '<span style="color: var(--note-ink-3);">重建中…</span>';
          ai.rebuildNoteIndex(pathNow).then(function () { renderIndexPanel(); }).catch(function () {
            if (body) body.innerHTML = '<span style="color: var(--state-danger);">重建失败</span>';
          });
        });
      }
      refreshIcons();
    }).catch(function () { if (body) body.innerHTML = '<span style="color: var(--state-danger);">读取索引失败</span>'; });
  }

  function toggleIndexPanel() {
    const panel = $('ed-index-panel');
    if (!panel) return;
    if (panel.hidden) { panel.hidden = false; renderIndexPanel(); }
    else panel.hidden = true;
  }

  /* 侧边面板区块顺序持久化 key */
  var SIDE_ORDER_KEY = 'sideOrder';

  /* 按持久化的顺序恢复侧边面板区块的 DOM 顺序。
   * 只在有记录时按 secId 顺序重排；无记录或已变动时保持当前（默认）顺序不动。
   * @returns {void}
   * @author 火 冰 */
  function restoreSidePanelOrder() {
    var container = document.querySelector('#right-panel .app-scroll');
    if (!container) return;
    var order = (typeof restoreS === 'function') ? restoreS(SIDE_ORDER_KEY, null) : null;
    if (!Array.isArray(order) || !order.length) return;
    var done = {};
    order.forEach(function (id) {
      if (done[id]) return;
      var sec = container.querySelector('[data-panel-section="' + id + '"]');
      if (sec) { container.appendChild(sec); done[id] = 1; }
    });
  }

  /* 把当前侧边面板区块顺序持久化到 localStorage。
   * @returns {void}
   * @author 火 冰 */
  function saveSidePanelOrder() {
    var container = document.querySelector('#right-panel .app-scroll');
    if (!container) return;
    var ids = [];
    container.querySelectorAll('[data-panel-section]').forEach(function (s) { ids.push(s.dataset.panelSection); });
    if (typeof saveS === 'function') saveS(SIDE_ORDER_KEY, ids);
  }

  /* 绑定侧边面板区块拖拽调整顺序：拖 grip-vertical 手柄把区块在面板内前移/后移，结束后持久化。
   * 采用原生 HTML5 draggable，draggable 挂在 collapse-head 上，拖动即整块移动、点击不触发拖拽（仍可折叠）。
   * @returns {void}
   * @author 火 冰 */
  function bindSidePanelDrag() {
    var container = document.querySelector('#right-panel .app-scroll');
    if (!container) return;
    var dragSec = null;
    document.querySelectorAll('#right-panel .collapse-head[draggable]').forEach(function (head) {
      head.addEventListener('dragstart', function (e) {
        var sec = head.closest('[data-panel-section]');
        if (!sec) return;
        dragSec = sec;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', sec.dataset.panelSection); } catch (_) { /* 某些环境需先 setData */ }
        sec.style.opacity = '0.5';
      });
      head.addEventListener('dragend', function () {
        if (!dragSec) return;
        dragSec.style.opacity = '';
        dragSec = null;
        saveSidePanelOrder();
        const chev = head.querySelector('i[data-lucide="chevron-right"]');
        if (chev) chev.setAttribute('data-lucide', 'chevron-down');
        refreshIcons();
      });
      head.addEventListener('dragover', function (e) {
        if (!dragSec) return;
        e.preventDefault();                  // 允许 drop 并触发目标 dragover 连续调度
        e.dataTransfer.dropEffect = 'move';
        var target = head.closest('[data-panel-section]');
        if (!target || target === dragSec) return;
        // 依据指针在目标头部的上下半区决定插入位置，避免反复横跳
        var rect = target.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        if (before) container.insertBefore(dragSec, target);
        else container.insertBefore(dragSec, target.nextSibling);
      });
      head.addEventListener('drop', function (e) { if (dragSec) e.preventDefault(); });
    });
  }