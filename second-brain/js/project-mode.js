/* ============================================
 * 第二脑 — 「打开项目」工作区 & 文件拖拽临时打开
 * 作者: 火 冰
 * 功能:
 *   sbProject   : 非知识库 git 项目工作区。复用既有知识库文件树/编辑器/页签机制，
 *                  仅以「相对路径直连 project: IPC」注入读/写/调色，不建笔记索引、不写库。
 *   sbTempFiles : 外部文件拖入窗口 → 单页签只读临时打开（不写库、不建索引、不落 recent），
 *                  跨知识库共享「最近打开」二级（最多 10 条）。
 *
 * 设计约定（避免大面重构）：
 *   - 项目文件用「相对项目根的 rel 路径」作为 edNotes/edCurrent 路径，直接复用既有渲染与页签；
 *     读取/保存经本项目模块代理到 project:read/project:save。
 *   - 临时文件用合成路径 `temp://<absPath>` 作为 edCurrent，独立小页签承载，只读不落盘。
 *   - 通过 window.sbIsProjectMode / window.sbSave / window.sbRenderTempArea 注入少量挂钩，
 *     供 editor-host.js / editor-filetree.js 按需调用；两者皆保持原逻辑走默认分支。
 * ============================================ */
'use strict';

/* ============================
 * 标识判定（供 editor-host 等调用）
 * ============================ */

/* 是否处于项目窗口（当前窗口为「打开项目」工作区，非知识库）
 * @returns {boolean} 项目窗口返回 true
 * 作者: 火 冰 */
function sbIsProjectMode() {
  return !!(window.sbProject && window.sbProject.isProjectMode());
}

/* 判断给定路径是否为合成伪路径（临时文件），用于跳过写盘/知识库侧边面板
 * @param {string} p 路径
 * @returns {boolean}
 * 作者: 火 冰 */
function sbIsPseudoPath(p) {
  return typeof p === 'string' && p.indexOf('temp://') === 0;
}

/* 统一保存路由：项目文件走 project:save，临时文件忽略（只读），其余返回 false 交给知识库。
 * @param {string} path  当前编辑路径
 * @param {string} mdText 全文
 * @returns {boolean} true=已由项目/临时分支处理，false=应交由既有知识库保存
 * 作者: 火 冰 */
async function sbSave(path, mdText) {
  if (!path) return false;
  if (sbIsPseudoPath(path)) return true;                 // 临时文件只读，忽略保存
  if (window.sbProject && window.sbProject.isProjectMode() && !path.startsWith('temp://')) {
    return await window.sbProject.saveRel(path, mdText); // 项目文件
  }
  return false;
}

/* ============================
 * sbProject —— 项目工作区
 * ============================ */
globalThis.sbProject = (function () {
  let root = null;      // 项目根绝对路径
  let ready = false;    // 是否已进入项目模式并完成首渲染

  /* 检测当前窗口是否为项目窗口：经 preload 取值，非项目窗口返回 null。
   * 作者: 火 冰 */
  async function detect() {
    if (ready) return;
    if (!window.noteDesktop || !window.noteDesktop.project) { root = null; return; }
    try { root = (await window.noteDesktop.project.current()) || null; }
    catch (_) { root = null; }
  }

  /* 是否项目模式
   * @returns {boolean}
   * 作者: 火 冰 */
  function isProjectMode() { return !!root; }

  /* 读取项目文件正文（相对路径 rel）
   * @param {string} rel 相对项目根的路径
   * @returns {Promise<{ok,content,name,error}>}
   * 作者: 火 冰 */
  async function read(rel) {
    if (!window.noteDesktop || !window.noteDesktop.project) return { ok: false, error: '仅桌面版可用' };
    return await window.noteDesktop.project.read(rel);
  }

  /* 保存项目文件正文（相对路径 rel）
   * @param {string} rel 相对项目根的路径
   * @param {string} content 全文
   * @returns {Promise<boolean>} 是否保存成功
   * 作者: 火 冰 */
  async function saveRel(rel, content) {
    if (!window.noteDesktop || !window.noteDesktop.project) return false;
    const r = await window.noteDesktop.project.save(rel, content);
    return !!(r && r.ok);
  }

  /* 隐藏知识库专属 UI：Ribbon 的 图谱/插件/AI 入口、右侧侧边面板与底板统计、移动端侧面板按钮。
   * 只隐藏 DOM，不改动知识库渲染逻辑。作者: 火 冰 */
  function hideVaultUi() {
    ['graph', 'plugins', 'ai'].forEach(function (id) {
      document.querySelectorAll('.ribbon [data-ribbon-btn="' + id + '"]').forEach(function (el) { el.style.display = 'none'; });
    });
    const rr = document.querySelectorAll('.ribbon [data-ribbon-btn="graph"],[data-ribbon-btn="plugins"],[data-ribbon-btn="ai"]');
    rr.forEach(function (el) { el.style.display = 'none'; });
    const side = document.getElementById('right-panel');   if (side) side.style.display = 'none';
    const sr = document.getElementById('side-resizer');    if (sr) sr.style.display = 'none';
    ['vault-stat', 'vault-size'].forEach(function (id) { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
  }

  /* 构建项目文件树数据：project:list 结果归一化为 renderFileTree 期望结构
   * （rel→path，补齐 folder/name/size/mtime），并同步 Git 着色映射。
   * @returns {Promise<Array>} 树数据
   * 作者: 火 冰 */
  async function buildTreeData() {
    let list = [];
    try { list = (await window.noteDesktop.project.list()) || []; }
    catch (_) { list = []; }
    const files = list.map(function (it) {
      return {
        path: it.rel,
        name: it.name,
        folder: it.folder || '',
        size: it.size || 0,
        mtime: it.mtime || Date.now(),
      };
    });
    // Git 状态着色：复用既有 gs-* class 机制（renderFileTree 读 window.__gsColoring）
    try {
      const gs = await window.noteDesktop.project.gitStatus();
      if (gs && gs.status) {
        const map = {};
        Object.keys(gs.status).forEach(function (rel) { map[rel] = gs.status[rel]; });
        window.__gsColoring = map;
      }
    } catch (_) { window.__gsColoring = {}; }
    return files;
  }

  /* 拉取项目文件树数据（归一化 + Git 着色映射），不渲染。
   * @returns {Promise<Array>} 归一化后的树数据
   * 作者: 火 冰 */
  async function loadList() {
    if (!isProjectMode()) return [];
    return await buildTreeData();
  }

  /* 刷新文件树（拉最新列表 + Git 状态 → renderFileTree）。
   * 作者: 火 冰 */
  async function renderProjectTree() {
    if (!isProjectMode()) return;
    edNotes = (await buildTreeData()).sort(function (a, b) { return a.path.localeCompare(b.path, 'zh'); });
    renderFileTree(edNotes);
  }

  /* 应用项目模式 UI（隐藏知识库专属 UI + 打开默认文件 + 提示）。
   * 由 initEditor 在完成通用绑定、渲染完初始文件树后调用。作者: 火 冰 */
  async function applyUi() {
    if (!isProjectMode()) return;
    ready = true;
    hideVaultUi();
    // 打开项目首页：默认打开最后一个 Git 变更文件（新增/修改/未跟踪），无则不打开任何文件，等用户点击
    const gs = window.__gsColoring || {};
    const changed = edNotes.filter(function (n) { return gs[n.path]; });
    if (changed.length && !edCurrent) await window.sbProjectOpenNote(changed[changed.length - 1].path);
    showToast('已打开项目：' + root.split(/[\\/]/).pop());
  }

  return { detect: detect, isProjectMode: isProjectMode, applyUi: applyUi, list: loadList, refresh: renderProjectTree, read: read, saveRel: saveRel };
})();

/* 项目模式打开笔记的薄封装（供 initEditor 项目分支与页签复用）：先按项目读正文注入缓存，
 * 再走既有 openNote（其内容装载分支已识别项目模式）。作者: 火 冰 */
async function sbProjectOpenNote(rel) {
  const r = await window.sbProject.read(rel);
  if (!r || !r.ok || r.binary) { if (r && r.binary) showToast('二进制文件不可编辑'); return; }
  edOutdated[rel] = r.content;
  await openNote(rel);
}

/* ============================
 * sbTempFiles —— 文件拖拽临时打开
 * ============================ */
globalThis.sbTempFiles = (function () {
  let tempList = [];     // [{abs, name}] 最近/已打开的临时文件（全局跨知识库展示；最多 10 条历史）
  let activeAbs = null;  // 当前激活临时文件绝对路径

  /* 渲染「临时文件」区 HTML（置于文件树最上方；折叠态记忆复用 collapsedFolders）
   * @returns {string} HTML 片段
   * 作者: 火 冰 */
  function areaHtml() {
    const folded = (typeof collapsedFolders !== 'undefined') ? collapsedFolders.has('__temparea__') : false;
    let h = '<div class="px-2 pt-1.5 pb-0.5 text-[11px] font-semibold flex items-center gap-1 cursor-pointer" data-temp-toggle style="color: var(--note-ink-3);">'
      + '<i data-lucide="' + (folded ? 'chevron-right' : 'chevron-down') + '" class="w-3 h-3" style="color: var(--note-ink-3);"></i>'
      + '<i data-lucide="file-clock" class="w-3 h-3"></i><span>临时文件</span>'
      + '<span class="ml-auto text-[10px] nums">' + tempList.length + '</span></div>';
    if (!folded) {
      if (!tempList.length) {
        h += '<div class="px-6 py-1 text-[11px]" style="color: var(--note-ink-3);">（将文件拖入窗口在临时打开）</div>';
      } else {
        tempList.forEach(function (it, i) {
          const on = it.abs === activeAbs;
          h += '<div class="tree-temp flex items-center gap-1.5 pr-2 py-1 cursor-pointer" data-temp-open="' + i + '" title="' + esc(it.abs) + '" style="' + (on ? 'background: var(--note-brand-600); color: #FFF;' : 'color: var(--note-ink-2);') + '">'
            + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0"></i>'
            + '<span class="flex-1 truncate">' + esc(it.name) + '</span>'
            + '<i data-lucide="x" class="w-3 h-3 shrink-0 cursor-pointer" data-temp-close="' + i + '" style="color:' + (on ? 'rgba(255,255,255,0.7)' : 'var(--note-ink-3)') + '"></i>'
            + '</div>';
        });
      }
    }
    return h;
  }

  /* 把「临时文件」区渲染进文件树容器顶部（renderFileTree 之后调用）。
   * @param {Element} tree #file-tree 容器
   * 作者: 火 冰 */
  function renderInto(tree) {
    if (!tree) return;
    // 先移除已存在的「临时文件」区（仅直接子级），避免每次插入叠加新区块而在目录区出现多个「临时文件」。
    // 注意：标记属性必须打在真正插入的元素上，若打在临时 wrapper 上（元素不会被插入）则去重永远定位不到旧块。
    const old = tree.querySelector('[data-temp-area]');
    if (old) old.remove();
    const patch = document.createElement('div');
    patch.innerHTML = areaHtml();
    const areaEl = patch.firstElementChild;
    if (!areaEl) { refreshIcons(); return; }
    areaEl.dataset.tempArea = '1';
    tree.insertBefore(areaEl, tree.firstChild);
    refreshIcons();
  }

  /* 记录一次临时打开到历史（去重置顶，最多 10 条），供库下拉「最近打开」二级。
   * @param {string} abs 绝对路径
   * 作者: 火 冰 */
  async function recordRecent(abs) {
    if (!window.noteDesktop || !window.noteDesktop.tempRecent) return;
    try { await window.noteDesktop.tempRecent.record(abs); } catch (_) { /* 忽略 */ }
  }

  /* 打开一个临时文件：读取正文 → 作为唯一临时页签展示（只读），并刷新目录区选中/侧边面板为空。
   * @param {string} abs 绝对路径
   * 作者: 火 冰 */
  async function openTemp(abs) {
    const it = tempList.find(function (t) { return t.abs === abs; });
    const nd = window.noteDesktop || {};
    if (!it && nd.readFileExternal) {
      const r = await nd.readFileExternal(abs);
      if (!r || !r.ok) { showToast(r && r.error || '无法读取文件'); return; }
      tempList.push({ abs: abs, name: r.name || abs.split(/[\\/]/).pop() });
    }
    const item = tempList.find(function (t) { return t.abs === abs; });
    if (!item) return;
    activeAbs = abs;
    // 目录区取消选中；切到临时文件时侧边面板各块显示空数据
    edSel = null;
    clearSidebar();
    // 读取正文（优先复用缓存）
    if (!(edOutdated['temp://' + abs] != null)) {
      const r = await nd.readFileExternal(abs);
      if (!r || !r.ok) { showToast(r && r.error || '读取失败'); return; }
      edOutdated['temp://' + abs] = r.content || '';
    }
    edCurrent = 'temp://' + abs;
    if (typeof vdSyncValue === 'function') vdSyncValue(edOutdated[edCurrent] || '');
    const cnt = document.getElementById('ed-count'); if (cnt) cnt.textContent = countChars(edOutdated[edCurrent] || '') + ' 字';
    const saved = document.getElementById('ed-saved'); if (saved) saved.textContent = '只读';
    // 渲染唯一临时页签：隐藏既有知识库页签 + 挂一个临时页签；打开知识库笔记时 renderTabs 会清掉它
    renderTempTab(item.name);
    await recordRecent(abs);
    renderInto(document.getElementById('file-tree'));
  }

  /* 在页签栏渲染唯一临时页签（隐藏知识库普通页签，红 × 关闭）。
   * @param {string} name 临时文件名
   * 作者: 火 冰 */
  function renderTempTab(name) {
    const tabs = document.getElementById('editor-tabs'); if (!tabs) return;
    // 隐藏所有普通页签（仅临时激活时）
    tabs.querySelectorAll('[data-path]').forEach(function (el) { el.style.display = 'none'; });
    // 移除旧临时页签
    const old = document.querySelector('#editor-tabs [data-temp-tab]'); if (old) old.remove();
    const tab = document.createElement('div');
    tab.dataset.tempTab = '1';
    tab.className = 'editor-tab flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] cursor-pointer shrink-0';
    tab.style.cssText = 'background: var(--note-surface-2); color: var(--note-ink); border:1px solid var(--note-brand-400); font-style:italic;';
    tab.innerHTML = '<i data-lucide="file-clock" class="w-3 h-3"></i><span class="truncate max-w-[180px]">' + esc(name) + '</span>'
      + '<i data-lucide="x" class="w-3 h-3 cursor-pointer" data-temp-close-tab style="color: var(--note-ink-3);"></i>';
    tabs.appendChild(tab);
    refreshIcons();
  }

  /* 关闭当前临时文件：移除临时页签、恢复知识库页签显示、回到最后打开的笔记或空编辑区。
   * 作者: 火 冰 */
  async function closeTemp() {
    if (!activeAbs) return;
    delete edOutdated['temp://' + activeAbs];
    activeAbs = null;
    // 恢复普通页签显示并重载
    const tabs = document.getElementById('editor-tabs');
    if (tabs) { const old = tabs.querySelector('[data-temp-tab]'); if (old) old.remove(); tabs.querySelectorAll('[data-path]').forEach(function (el) { el.style.display = ''; }); }
    if (edOpenTabs.length) { await openNote(edOpenTabs[edOpenTabs.length - 1]); }
    else if (typeof vdSetValue === 'function') vdSetValue('');
    renderInto(document.getElementById('file-tree'));
  }

  /* 临时文件激活时：候选目录选中清空 + 侧边面板各数据块显示空数据。
   * 作者: 火 冰 */
  function clearSidebar() {
    document.querySelectorAll('[data-panel-section]').forEach(function (sec) {
      // 保留区块头，清空数据内容
      sec.querySelectorAll(':scope > *:not([data-panel-keep])').forEach(function (el) {
        if (el.className && el.className.indexOf && el.className.indexOf('collapse-head') === -1) el.remove();
      });
      // 若区块非 collapse 结构，直接置空可编辑数据容器
      sec.innerHTML = sec.innerHTML;
    });
    // 属性/反链/标签等已知数据块取空
    ['ed-backlinks', 'ed-tags', 'ed-prop-body', 'ed-chunk-body'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<div class="px-3 py-2 text-[11px]" style="color:var(--note-ink-3);">（临时文件无数据）</div>';
    });
  }

  /* 全局外部文件拖拽：dragover + drop（capture），解析 File → abspath → 读取 → 临时打开。
   * 内部文件树/页签拖拽不携带 files，不会误触发。作者: 火 冰 */
  function bindGlobalDrag() {
    if (window.__sbTempDragBound) return;
    window.__sbTempDragBound = 1;
    window.addEventListener('dragover', function (e) {
      // 编辑区：交给 vditor 自身拖拽逻辑（图片行内 / 附件卡片），不在此放行，避免干扰其 drop 指示
      const t = e.target;
      if (t && t.closest && t.closest('#ed-vditor')) return;
      // 外部文件拖入目录区/页签栏等：dragover 阶段 dataTransfer.files 为空（内容要到 drop 才可读），
      // 不能依赖 files.length 判断（否则恒 0 → 不 preventDefault → 拖入显示禁止图标）。
      // 只要 types 含 'Files' 即放行并设 copy，显示可拖入；是否 .md 在 drop 阶段再校验。
      if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }
    }, true);
    window.addEventListener('drop', async function (e) {
      const dt = e.dataTransfer;
      // 注意：dataTransfer.files 是 FileList 而非数组，不能用 Array.isArray 判断（否则恒 false，drop 静默失效）
      const files = (dt && dt.files && dt.files.length) ? dt.files : null;
      if (!files) return;
      e.preventDefault();
      const t = e.target;
      // 编辑区：让 vditor 自身上传逻辑处理（非图片 → `> [!attach]` 附件卡片，图片 → 行内预览），不劫持为临时打开
      if (t && t.closest && t.closest('#ed-vditor')) return;
      // 页签栏：由页签栏自身 drop 处理（作为新临时页签打开），避免与下方重复且防止落入编辑器
      if (t && t.closest && t.closest('#editor-tabs')) return;
      const nd = window.noteDesktop || {};
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        let abs = '';
        if (nd.getPathForFile) abs = nd.getPathForFile(f);     // 优先 webUtils（精确）
        if (!abs && f && typeof f.path === 'string') abs = f.path;
        if (!abs) { showToast('无法获取拖入文件的路径'); return; }
        // 仅支持 .md / .markdown / .txt 临时打开，其它类型提示不支持
        const ext = (abs.split('.').pop() || '').toLowerCase();
        if (ext !== 'md' && ext !== 'markdown' && ext !== 'txt') {
          showToast('仅支持拖拽 .md / .markdown / .txt 文件');
          return;
        }
        await globalThis.sbTempFiles.openTemp(abs);
      }
    }, true);
  }

  /* 全局点击委托：临时文件区 展开折叠 / 打开条目 / 红 × 移除 / 页签红 × 关闭。
   * 作者: 火 冰 */
  function bindGlobalTreeClick() {
    if (window.__sbTempClickBound) return;
    window.__sbTempClickBound = 1;
    document.addEventListener('click', function (e) {
      // 页签关闭
      const tabX = e.target.closest('[data-temp-close-tab]');
      if (tabX) { e.stopPropagation(); closeTemp(); return; }
      // 临时区折叠
      const toggle = e.target.closest('[data-temp-toggle]');
      if (toggle) {
        if (collapsedFolders.has('__temparea__')) collapsedFolders.delete('__temparea__');
        else collapsedFolders.add('__temparea__');
        renderInto(document.getElementById('file-tree'));
        return;
      }
      // 关闭某临时文件（仅移除其临时列表，不动磁盘）
      const c = e.target.closest('[data-temp-close]');
      if (c) {
        e.stopPropagation();
        const i = parseInt(c.dataset.tempClose, 10);
        const it = tempList[i];
        if (it) {
          tempList.splice(i, 1);
          if (edCurrent === 'temp://' + it.abs) { delete edOutdated[edCurrent]; activeAbs = null; renderTempTabCleanup(); }
          if (window.noteDesktop && window.noteDesktop.tempRecent) window.noteDesktop.tempRecent.remove(it.abs).catch(function () {});
        }
        renderInto(document.getElementById('file-tree'));
        return;
      }
      // 打开某临时文件
      const op = e.target.closest('[data-temp-open]');
      if (op) { e.stopPropagation(); const it = tempList[parseInt(op.dataset.tempOpen, 10)]; if (it) openTemp(it.abs); }
    });
  }

  /* 关闭临时页签后的收尾：恢复普通页签显示、回到最后知识库笔记或空编辑区。
   * 作者: 火 冰 */
  function renderTempTabCleanup() {
    const tabs = document.getElementById('editor-tabs');
    if (tabs) { const old = tabs.querySelector('[data-temp-tab]'); if (old) old.remove(); tabs.querySelectorAll('[data-path]').forEach(function (el) { el.style.display = ''; }); }
    if (edOpenTabs.length) openNote(edOpenTabs[edOpenTabs.length - 1]);
    else if (typeof vdSetValue === 'function') vdSetValue('');
  }

  /* 初始化：绑定全局拖拽与点击委托；加载「最近打开」历史（跨知识库）。作者: 火 冰 */
  async function init() {
    bindGlobalDrag();
    bindGlobalTreeClick();
    if (window.noteDesktop && window.noteDesktop.tempRecent) {
      try {
        const rec = await window.noteDesktop.tempRecent.load();
        if (Array.isArray(rec)) tempList = rec.slice(0, 10);
      } catch (_) { tempList = []; }
    }
  }

  return { init: init, renderInto: renderInto, openTemp: openTemp, closeTemp: closeTemp, getList: function () { return tempList; } };
})();

/* 渲染进程全局钩子：把临时文件区渲染进文件树顶部（renderFileTree 末尾调用）。作者: 火 冰 */
function sbRenderTempArea(tree) {
  if (window.sbTempFiles) window.sbTempFiles.renderInto(tree);
}