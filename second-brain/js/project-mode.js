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

/* 统一保存路由：临时文件写回原绝对路径，项目文件走 project:save，其余返回 false 交给知识库。
 * @param {string} path  当前编辑路径
 * @param {string} mdText 全文
 * @returns {Promise<boolean>} true=已由临时/项目分支处理，false=应交由既有知识库保存
 * 作者: 火 冰 */
async function sbSave(path, mdText) {
  if (!path) return false;
  if (sbIsPseudoPath(path)) {
    // 临时文件：单独一套读写机制，写回拖入时的原始绝对路径（白名单见 notes:writeFileExternal）
    const nd = window.noteDesktop || {};
    if (nd && nd.writeFileExternal) {
      const abs = path.slice('temp://'.length);
      try {
        const r = await nd.writeFileExternal(abs, mdText);
        return !!(r && r.ok);
      } catch (_) { return true; } // 失败交给存储在 onEdInput 侧提示，此处避免落入知识库保存
    }
    return true; // 无写回桥接（网页/演示）时忽略保存
  }
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
      // walkProject 返回的 folder 字段是布尔「是否目录」标记（目录=true/文件=false），
      // 与 renderFileTree 期望的「父目录路径字符串」语义不同。这里转成父目录路径 + isFolder 标记，
      // 避免 folder=true 时 renderFileTree 对 n.folder.split('/') 触发崩溃。
      const isFolder = it.folder === true;
      const rel = String(it.rel || '');
      const slash = rel.lastIndexOf('/');
      return {
        path: rel,
        name: it.name,
        folder: slash > 0 ? rel.slice(0, slash) : '',
        isFolder: isFolder,
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

  /* 目录区不再渲染「临时文件」区（外部拖入改由 tab 栏临时打开 / 目录区新增笔记）。
   * 保留空实现以兼容既有调用点（openTemp/closeTemp/bindGlobalTreeClick），不往 #file-tree 插入区块。
   * @param {Element} _tree 忽略（历史遗留参数）
   * 作者: 火 冰 */
  function renderInto(tree) {
    // 仅清理可能残留的旧区块，避免叠加；不再重建。
    if (tree) { const old = tree.querySelector('[data-temp-area]'); if (old) old.remove(); }
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
    const saved = document.getElementById('ed-saved'); if (saved) saved.textContent = '已加载（临时文件）';
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

  /* 全局外围拖拽协调：capture 阶段放行「可拖入」并设置拖拽反馈。
   * 按落点分流：
   *   - tab 栏（#editor-tabs）→ 放行供临时打开，dropEffect='move'（不显示「复制」）；
   *   - 文件树（#file-tree）→ 放行，由 bindFileTreeDrag 在 drop 时按目录新增笔记；
   *   - 编辑区（#ed-vditor）→ 交给 vditor 自身的图片/附件拖拽；
   *   - 其余区域不再拦截临时打开（临时打开仅限 tab 栏）。
   * 内部文件树/页签拖拽不携带 files，不会误触发。作者: 火 冰 */
  function bindGlobalDrag() {
    if (window.__sbTempDragBound) return;
    window.__sbTempDragBound = 1;
    window.addEventListener('dragover', function (e) {
      const t = e.target;
      if (t && t.closest && t.closest('#ed-vditor')) return;         // 编辑区交给 vditor
      if (!e.dataTransfer) return;
      const hasFiles = e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1;
      if (!hasFiles) return;
      // tab 栏：外部文件可拖入（作为新临时页签打开）；不显示「复制」
      if (t && t.closest && t.closest('#editor-tabs')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return; }
      // 文件树：放行供按目录新增笔记（具体落点由 bindFileTreeDrag 在 drop 判定）
      if (t && t.closest && t.closest('#file-tree')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
    }, true);
    // 全局兜底 drop 不再自行拦截临时打开：外部 md/txt 临时打开已收敛到 tab 栏，
    // 目录区新增笔记由 bindFileTreeDrag 处理；其余区域不劫持为临时打开。
    window.addEventListener('drop', function (e) {
      const t = e.target;
      if (!t || !t.closest) return;
      // 编辑区交给 vditor 自身上传逻辑（图片/附件卡片），不劫持
      if (t.closest('#ed-vditor')) return;
      // tab 栏交由其自身 drop 处理（作为新临时页签打开）；文件树交由 bindFileTreeDrag 新增笔记
      if (t.closest('#editor-tabs') || t.closest('#file-tree')) return;
      const dt = e.dataTransfer;
      const files = (dt && dt.files && dt.files.length) ? dt.files : null;
      if (!files) return;
      // 其余区域：不再临时打开，阻止浏览器默认把文件拖入页面
      e.preventDefault();
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
    // 系统「打开方式」传入的文件（OS 右键→打开方式→第二脑）→ 作为临时文件打开
    if (window.noteDesktop && window.noteDesktop.onOpenFile) {
      window.noteDesktop.onOpenFile(function (abs) { if (abs) openTemp(abs); });
    }
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