/* ============================================
 * 第二脑 — 图谱视图
 * 作者: 火 冰
 * 功能: 力导/树形布局、节点边渲染、标签过滤、节点详情与跳转
 * ============================================ */

'use strict';


  /* ============================
   * 图谱视图交互（真实数据驱动）
   * 节点 = 笔记 + 标签；连线 = 笔记间 [[内链]] + 笔记->标签
   * 作者: 火 冰
   * ============================ */

  let graphZoom = 1;
  let graphLayout = 'force';   // force | tree
  let gDepth = 2;             // 连接深度（以选中节点为中心）
  let gSel = null;            // 当前选中节点 id
  let gNodes = [];            // [{id,label,kind,path,folder,tags,deg,pos}]
  let gLinks = [];            // [{s,t,kind}]
  let gMeta = [];             // 笔记元数据列表
  let gContent = {};          // path -> md 原文
  let gTagFilter = new Set();  // 选中的标签（空 = 全部）
  let gTypeFilter = { note: true, folder: true, tag: true };

  /* 应用缩放（transform 缩放，画布原点居中） */
  function applyGraphZoom() {
    const svg = document.getElementById('graph-svg');
    const label = document.getElementById('zoom-label');
    if (svg) svg.style.transform = 'scale(' + graphZoom + ')';
    if (svg) svg.style.transformOrigin = 'center center';
    if (label) label.textContent = Math.round(graphZoom * 100) + '%';
  }

  /* 读入全部笔记内容，构造节点与连线 */
  async function loadGraph() {
    const meta = await noteStore.list();
    gMeta = meta.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    gContent = {};
    for (const n of gMeta) {
      try { gContent[n.path] = await noteStore.read(n.path); }
      catch (e) { gContent[n.path] = ''; }
    }
    buildGraph();
    renderGraph();
  }

  /* 由笔记元数据 + 内容构建 gNodes / gLinks */
  function buildGraph() {
    const idOf = (p) => 'note:' + p;
    const nodes = [];
    const nodesById = {};
    const edges = [];
    // 笔记节点
    gMeta.forEach(n => {
      const id = idOf(n.path);
      nodes.push({ id, label: (n.name || '').replace(/\.md$/, ''), kind: 'note', path: n.path, folder: n.folder || '', tags: extractTags(gContent[n.path] || ''), deg: 0 });
      nodesById[id] = true;
    });
    // 标签节点
    const tagCount = {};
    gMeta.forEach(n => extractTags(gContent[n.path] || '').forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
    Object.keys(tagCount).forEach(t => {
      nodes.push({ id: 'tag:' + t, label: t.replace('#', ''), kind: 'tag', path: '', folder: '', tags: [], deg: 0 });
    });
    // 连线
    gMeta.forEach(n => {
      const src = idOf(n.path);
      const tagEdges = new Set();
      extractTags(gContent[n.path] || '').forEach(t => {
        const tid = 'tag:' + t;
        if (nodesById[tid] && !tagEdges.has(tid)) { edges.push({ s: src, t: tid, kind: 'tag' }); tagEdges.add(tid); }
      });
      const re = /\[\[([^\]]+)\]\]/g; const md = gContent[n.path] || ''; let m;
      while ((m = re.exec(md))) {
        let name = (m[1] || '').trim();
        if (!name) continue;
        const hit = gMeta.find(x => {
          const base = (x.name || '').replace(/\.md$/, '');
          return base === name || (name.indexOf(base) === 0 && /^(\||#|$)/.test(name.slice(base.length)));
        });
        if (hit && hit.path !== n.path) {
          const dst = idOf(hit.path);
          if (edges.some(e => (e.s === src && e.t === dst) || (e.s === dst && e.t === src))) return;
          edges.push({ s: src, t: dst, kind: 'link' });
        }
      }
    });
    gNodes = nodes; gLinks = edges;
  }

  /* 一次轻量力导向布局（斥力 + 边长弹簧），返回坐标表 */
  function forceLayout(nodeList, linkList, cx, cy, r) {
    const X = {}, Y = {};
    nodeList.forEach((nd, i) => {
      const a = i / Math.max(nodeList.length, 1) * Math.PI * 2;
      X[nd.id] = cx + Math.cos(a) * r; Y[nd.id] = cy + Math.sin(a) * r;
    });
    const K = 1.1, C = 0.12, ITER = 160;
    for (let it = 0; it < ITER; it++) {
      for (let i = 0; i < nodeList.length; i++) for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i], b = nodeList[j];
        let dx = X[a.id] - X[b.id], dy = Y[a.id] - Y[b.id];
        let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1; const d = Math.sqrt(d2);
        const f = Math.min(K / d2, 0.6) * C;
        const fx = f * dx / d, fy = f * dy / d;
        X[a.id] += fx; Y[a.id] += fy; X[b.id] -= fx; Y[b.id] -= fy;
      }
      linkList.forEach(l => {
        const dx = X[l.s] - X[l.t], dy = Y[l.s] - Y[l.t];
        let d = Math.sqrt(dx * dx + dy * dy); if (d < 1) d = 1;
        const f = Math.min(d * d * 0.0006, 0.12);
        const fx = f * dx / d, fy = f * dy / d;
        X[l.s] -= fx; Y[l.s] -= fy; X[l.t] += fx; Y[l.t] += fy;
      });
    }
    return { X, Y };
  }

  /* 层级布局：按文件夹作列，标签单独一列 */
  function treeLayout(nodeList) {
    const byFolder = {};
    nodeList.forEach(n => { const k = n.kind === 'note' ? (n.folder || '/') : '#标签'; (byFolder[k] = byFolder[k] || []).push(n); });
    const folders = Object.keys(byFolder).sort((a, b) => a.localeCompare(b, 'zh'));
    const X = {}, Y = {}, colW = 170, rowH = 56, top = 48, left = 90;
    folders.forEach((f, col) => {
      byFolder[f].forEach((n, row) => {
        X[n.id] = left + col * colW; Y[n.id] = top + row * rowH + (col % 2) * 22;
      });
    });
    return { X, Y };
  }

  /* BFS 计算各节点到选中节点的步数（用于连接深度过滤） */
  function reachDepth(selId) {
    const d = {}; gNodes.forEach(n => { d[n.id] = 999; });
    if (!selId) return d;
    const adj = {}; gNodes.forEach(n => { adj[n.id] = []; });
    gLinks.forEach(l => { if (adj[l.s]) adj[l.s].push(l.t); if (adj[l.t]) adj[l.t].push(l.s); });
    const q = [selId]; d[selId] = 0;
    while (q.length) {
      const cur = q.shift(); const nd = d[cur] + 1; if (nd > gDepth || nd > 999) continue;
      (adj[cur] || []).forEach(nb => { if (nd < d[nb]) { d[nb] = nd; if (nd < 6) q.push(nb); } });
    }
    return d;
  }

  /* 依据当前过滤条件得到可见节点/连线 */
  function visibleGraph() {
    let nodes = gNodes.filter(n => gTypeFilter[n.kind]);
    if (gTagFilter.size) {
      nodes = nodes.filter(n => n.kind === 'tag' ? gTagFilter.has(n.label) : (n.tags.some(t => gTagFilter.has(t))));
    }
    const idSet = new Set(nodes.map(n => n.id));
    const links = gLinks.filter(l => idSet.has(l.s) && idSet.has(l.t));
    // 度数统计
    const deg = {}; nodes.forEach(n => { deg[n.id] = 0; });
    links.forEach(l => { if (deg[l.s] != null) deg[l.s]++; if (deg[l.t] != null) deg[l.t]++; });
    nodes.forEach(n => { n.deg = deg[n.id] || 0; });
    return { nodes, links };
  }

  /* 渲染整张图（布局 + 连线 + 节点 + 详情统计） */
  function renderGraph() {
    const nodesG = document.getElementById('graph-nodes');
    const linksG = document.getElementById('graph-links');
    if (!nodesG || !linksG) return;
    const { nodes, links } = visibleGraph();
    // 布局
    const CX = 400, CY = 250, R = 210;
    let X, Y;
    if (nodes.length === 0) { X = {}; Y = {}; }
    else if (graphLayout === 'tree') { const t = treeLayout(nodes); X = t.X; Y = t.Y; }
    else { const f = forceLayout(nodes, links, CX, CY, R); X = f.X; Y = f.Y; }
    // 深度（选中为中心）
    const reach = reachDepth(gSel);
    // 连线
    let lh = '';
    links.forEach(l => {
      const d1 = X[l.s] != null ? reach[l.s] : 999;
      const d2 = X[l.t] != null ? reach[l.t] : 999;
      const near = Math.min(d1, d2) <= gDepth;
      const cls = l.kind === 'tag' ? 'graph-link-sec' : 'graph-link-main';
      const op = near ? 1 : 0.1;
      lh += '<line class="g-link ' + cls + '" x1="' + X[l.s].toFixed(1) + '" y1="' + Y[l.s].toFixed(1) + '" x2="' + X[l.t].toFixed(1) + '" y2="' + Y[l.t].toFixed(1) + '" stroke="var(--note-border)" stroke-width="' + (near ? 1.4 : 1) + '" opacity="' + op + '"></line>';
    });
    linksG.innerHTML = lh;
    // 节点
    let nh = '';
    nodes.forEach(n => {
      if (X[n.id] == null) return;
      const d = reach[n.id] || 0;
      const isSel = n.id === gSel;
      const near = d <= gDepth;
      const op = near ? 1 : 0.12;
      let r = n.kind === 'note' ? (isSel ? 11 : 8) : (n.kind === 'tag' ? 7 : 9);
      let fill = 'url(#gradNode)';
      if (n.kind === 'tag') fill = 'url(#gradHighlight)';
      if (isSel) fill = 'url(#gradCenter)';
      const stroke = isSel ? '#FFFFFF' : 'none';
      nh += '<g class="g-node" data-id="' + esc(n.id) + '" data-path="' + esc(n.path || '') + '" transform="translate(' + X[n.id].toFixed(1) + ',' + Y[n.id].toFixed(1) + ')" opacity="' + op + '" style="cursor:pointer;">'
        + '<circle r="' + (r + 2) + '" fill="transparent"></circle>'
        + '<circle r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"></circle>'
        + (n.deg > 2 ? '<text y="' + (r + 4) + '" text-anchor="middle" class="nums" style="font:500 8px sans-serif; fill: var(--note-brand-300);">' + n.deg + '</text>' : '')
        + '<text y="' + (r + 18) + '" text-anchor="middle" style="font:11px var(--note-font-sans); fill: ' + (isSel ? 'var(--note-brand-200)' : 'var(--note-ink-2)') + '; pointer-events:none;">' + esc(n.label.slice(0, 10)) + '</text>'
        + '</g>';
    });
    nodesG.innerHTML = nh;
    // 统计
    const stats = document.getElementById('graph-stats');
    if (stats) stats.textContent = '节点 ' + nodes.length + ' · 连接 ' + links.length;
    // 节点类型计数 / 标签计数
    const cnts = { note: 0, folder: 0, tag: 0 };
    ['note', 'folder', 'tag'].forEach(k => { cnts[k] = gNodes.filter(n => n.kind === k).length; });
    const cn = document.getElementById('cnt-note'); if (cn) cn.textContent = cnts.note;
    const cf = document.getElementById('cnt-folder'); if (cf) cf.textContent = cnts.folder;
    const ct = document.getElementById('cnt-tag'); if (ct) ct.textContent = cnts.tag;
    renderGraphTags();
    refreshIcons();
    // 若未选中，默认选中第一个笔记节点
    if (!gSel && nodes.length) { gSel = nodes[0].id; }
    updGraphDetail();
  }

  /* 渲染左侧标签过滤列表 */
  function renderGraphTags() {
    const box = document.getElementById('graph-tags'); if (!box) return;
    const tags = [];
    gNodes.forEach(n => { if (n.kind === 'tag') tags.push({ label: n.label, count: n.deg }); });
    tags.sort((a, b) => b.count - a.count);
    const total = tags.length;
    const countEl = document.getElementById('graph-tag-count');
    if (countEl) countEl.textContent = gTagFilter.size + '/' + total;
    if (!tags.length) { box.innerHTML = '<p class="text-[11px]" style="color: var(--note-ink-3);">（暂无标签）</p>'; return; }
    box.innerHTML = tags.map(t => {
      const on = gTagFilter.has(t.label);
      return '<label class="flex items-center gap-2 cursor-pointer group" style="opacity:' + (on ? 1 : 0.75) + ';">'
        + '<input type="checkbox" class="sr-only graph-tag-check" data-tag="' + esc(t.label) + '"' + (on ? ' checked' : '') + '>'
        + '<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:' + (on ? 'var(--note-brand-500)' : 'var(--note-ink-3)') + ';"></span>'
        + '<span class="text-[12px] flex-1" style="color: var(--note-ink);">#' + esc(t.label) + '</span>'
        + '<span class="text-[10px] nums" style="color: var(--note-ink-3);">' + t.count + '</span></label>';
    }).join('');
    box.querySelectorAll('.graph-tag-check').forEach(cb => {
      cb.addEventListener('change', function () {
        const t = this.dataset.tag;
        if (this.checked) gTagFilter.add(t); else gTagFilter.delete(t);
        renderGraph();
      });
    });
  }

  /* 更新右侧节点详情面板 */
  function updGraphDetail() {
    const node = gNodes.find(n => n.id === gSel);
    const nameEl = document.getElementById('gd-name');
    const def = (el, v) => { if (el) el.textContent = v; };
    if (!node) {
      def(nameEl, '—');
      const c = document.getElementById('gd-cat'); if (c) c.textContent = '—';
      const cn = document.getElementById('gd-conn'); if (cn) cn.textContent = '· 0 连接';
      const b = document.getElementById('gd-basic'); if (b) b.innerHTML = '—';
      const t = document.getElementById('gd-tags'); if (t) t.innerHTML = '—';
      const lc = document.getElementById('gd-link-count'); if (lc) lc.textContent = '0';
      const l = document.getElementById('gd-links'); if (l) l.innerHTML = '';
      return;
    }
    def(nameEl, node.label);
    const cat = document.getElementById('gd-cat');
    if (cat) cat.textContent = node.kind === 'note' ? (node.folder || '根目录') : (node.kind === 'tag' ? '标签' : '文件夹');
    const cnEl = document.getElementById('gd-conn');
    if (cnEl) cnEl.textContent = '· ' + node.deg + ' 连接';
    // 基本信息
    const basic = document.getElementById('gd-basic');
    if (basic) {
      let rows = '';
      if (node.kind === 'note') {
        const n = gMeta.find(x => x.path === node.path);
        const date = n ? new Date(n.mtime).toLocaleDateString('zh-CN') : '—';
        rows = '<div class="flex justify-between"><span style="color: var(--note-ink-3);">类别</span><span>' + esc(node.folder || '根目录') + '</span></div>'
          + '<div class="flex justify-between"><span style="color: var(--note-ink-3);">修改日期</span><span>' + esc(date) + '</span></div>'
          + '<div class="flex justify-between"><span style="color: var(--note-ink-3);">字数</span><span class="nums">' + countChars(gContent[node.path] || '') + '</span></div>'
          + '<div class="flex justify-between"><span style="color: var(--note-ink-3);">连接数</span><span class="nums">' + node.deg + '</span></div>';
      } else {
        rows = '<div class="flex justify-between"><span style="color: var(--note-ink-3);">类别</span><span>' + (node.kind === 'tag' ? '标签' : '文件夹') + '</span></div>'
          + '<div class="flex justify-between"><span style="color: var(--note-ink-3);">出现次数</span><span class="nums">' + node.deg + '</span></div>';
      }
      basic.innerHTML = rows;
    }
    // 标签
    const tagsBox = document.getElementById('gd-tags');
    if (tagsBox) tagsBox.innerHTML = (node.kind === 'note' ? node.tags : [node.label])
      .map(t => '<span class="px-2 py-1 rounded text-[11px] border" style="border-color: var(--note-border); background: var(--note-surface-2); color: var(--note-brand-300);">#' + esc(t.replace('#', '')) + '</span>').join('') || '—';
    // 连接列表
    const neighbors = [];
    gLinks.forEach(l => {
      let other = null;
      if (l.s === node.id) other = gNodes.find(n => n.id === l.t);
      else if (l.t === node.id) other = gNodes.find(n => n.id === l.s);
      if (other) neighbors.push({ label: other.label, path: other.path, kind: l.kind });
    });
    const lc = document.getElementById('gd-link-count'); if (lc) lc.textContent = String(neighbors.length);
    const linksBox = document.getElementById('gd-links');
    if (linksBox) linksBox.innerHTML = neighbors.length
      ? neighbors.map(nb => '<div class="flex items-center justify-between py-1"><span class="text-[11px] truncate flex-1" style="color: var(--note-ink-2);">' + esc(nb.label) + '</span><span class="text-[9px] shrink-0 ml-2" style="color: var(--note-ink-3);">' + (nb.kind === 'tag' ? '标签' : '内链') + '</span></div>').join('')
      : '<p class="text-[11px]" style="color: var(--note-ink-3);">（无连接）</p>';
  }

  /* 图谱初始化：绑定过滤/布局/缩放/详情/打开笔记 */
  async function initGraph() {
    graphZoom = 1; applyGraphZoom();
    await loadGraph();

    // 节点点击 -> 选中 + 详情
    document.getElementById('graph-nodes').addEventListener('click', function (e) {
      const node = e.target.closest('.g-node'); if (!node) return;
      gSel = node.dataset.id;
      // 非选中节点淡出，选中与关联保留
      document.querySelectorAll('.g-node').forEach(n => n.style.opacity = 0.12);
      renderGraph();
    });

    // 布局切换
    document.querySelectorAll('.layout-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.layout-btn').forEach(b => { b.style.color = 'var(--note-ink-2)'; b.style.background = 'transparent'; });
        this.style.color = '#FFFFFF'; this.style.background = 'var(--note-brand-600)';
        graphLayout = this.dataset.layout;
        renderGraph();
      });
    });

    // 连接深度
    document.querySelectorAll('.depth-btn').forEach(btn => {
      btn.addEventListener('click', function () {
        document.querySelectorAll('.depth-btn').forEach(b => { b.style.color = 'var(--note-ink-3)'; b.style.background = 'var(--note-surface-2)'; });
        this.style.color = '#FFFFFF'; this.style.background = 'var(--note-brand-600)';
        gDepth = Math.max(1, (+this.dataset.depth || 2));
        const fill = document.getElementById('depth-fill'); if (fill) fill.style.width = (gDepth / 3 * 100) + '%';
        const label = document.getElementById('graph-depth-label'); if (label) label.textContent = gDepth + '层';
        renderGraph();
      });
    });

    // 缩放手势
    const canvas = document.getElementById('graph-canvas');
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      graphZoom = Math.min(Math.max(graphZoom + (e.deltaY < 0 ? 0.08 : -0.08), 0.5), 2);
      applyGraphZoom();
    }, { passive: false });
    document.querySelector('[data-action="zoom-in"]').addEventListener('click', function () { graphZoom = Math.min(graphZoom + 0.1, 2); applyGraphZoom(); });
    document.querySelector('[data-action="zoom-out"]').addEventListener('click', function () { graphZoom = Math.max(graphZoom - 0.1, 0.5); applyGraphZoom(); });
    document.querySelector('[data-action="zoom-fit"]').addEventListener('click', function () { graphZoom = 1; applyGraphZoom(); });

    // 节点类型过滤
    document.querySelectorAll('.peer[data-type], [data-type]').forEach(inp => {
      if (inp.type !== 'checkbox') return;
      inp.addEventListener('change', function () {
        const k = this.dataset.type; if (!k) return;
        gTypeFilter[k] = this.checked;
        renderGraph();
      });
    });

    // 重置
    const reset = document.querySelector('[data-action="graph-reset"]');
    if (reset) reset.addEventListener('click', function () {
      gTagFilter.clear();
      gSel = null;
      graphZoom = 1; applyGraphZoom();
      document.querySelectorAll('.graph-tag-check').forEach(cb => { cb.checked = false; });
      document.querySelectorAll('.peer[data-type]').forEach(cb => { cb.checked = true; });
      renderGraph();
    });

    // 打开笔记（节点 + 右侧按钮）
    document.querySelector('[data-action="open-graph-note"]').addEventListener('click', openGraphNote);
    document.getElementById('graph-nodes').addEventListener('dblclick', function (e) {
      const node = e.target.closest('.g-node'); if (!node || !node.dataset.path) return;
      openNoteFromGraph(node.dataset.path);
    });
  }

  /* 从图谱跳转编辑器并打开指定笔记 */
  function openNoteFromGraph(path) {
    if (!path) return;
    window.__openGraphPath = path;
    location.hash = '#/editor';
  }

  function openGraphNote() {
    const node = gNodes.find(n => n.id === gSel);
    if (node && node.path) openNoteFromGraph(node.path);
  }
