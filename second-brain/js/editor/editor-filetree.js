/* ============================================
 * 第二脑 — 编辑器宿主·目录区/文件树
 * 作者: 火 冰
 * 功能: 文件树渲染、折叠、新建笔记/目录、拖拽移动与排序、侧边面板折叠
 * ============================================ */

'use strict';

  /* 渲染文件树 */
  function renderFileTree(notes) {
    const tree = $('file-tree'); if (!tree) return;
    // 默认隐藏以 . 开头的目录/文件（如 .obsidian），可在文件树空白区右键菜单切换显示（作者: 火 冰）
    if (!restoreS('showHidden', false)) {
      notes = notes.filter(n => !n.path.split('/').some(seg => seg.startsWith('.')));
    }
    const folders = new Map();
    notes.forEach(n => {
      const parts = n.folder ? n.folder.split('/') : [];
      let key = '';
      parts.forEach((p, i) => {
        const parentKey = key;
        key = key ? key + '/' + p : p;
        if (!folders.has(key)) folders.set(key, { label: p, parent: parentKey, children: [] });
      });
    });
    const filesByFolder = new Map();
    notes.forEach(n => { if (!filesByFolder.has(n.folder)) filesByFolder.set(n.folder, []); filesByFolder.get(n.folder).push(n); });

    // 建立嵌套
    let html = '';
    const folderNodes = new Map();
    folders.forEach((f, key) => {
      const depth = key.split('/').length;
      f.depth = depth;
      folderNodes.set(key, f);
    });
    // 深度优先输出，根层级排序
    const rootFolders = [];
    folderNodes.forEach((f, key) => { if (!f.parent) rootFolders.push({ key, f }); });
    rootFolders.sort((a, b) => a.f.label.localeCompare(b.f.label, 'zh'));

    const renderFolder = (fNode, key) => {
      const isCollapsed = collapsedFolders.has(key);
      html += '<div class="tree-folder flex items-center gap-1 px-2 py-1 cursor-pointer hover:opacity-80" draggable="true" data-type="folder" data-folder="' + esc(key) + '" title="' + esc(key) + '" style="' + (fNode.depth > 1 ? 'padding-left:' + (8 + (fNode.depth - 1) * 24) + 'px;' : '') + 'color: var(--note-ink);">'
        + '<i data-lucide="' + (isCollapsed ? 'chevron-right' : 'chevron-down') + '" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-ink-3);"></i>'
        + '<i data-lucide="folder-open" class="w-4 h-4 shrink-0" style="color: var(--note-brand-400);"></i>'
        + '<span class="truncate font-medium">' + esc(fNode.label) + '</span>'
        + '<span class="ml-auto text-[10px] nums" style="color: var(--note-ink-3);">' + (filesByFolder.get(key) || []).length + '</span>'
        + '</div>';
      if (isCollapsed) return;
      // 子文件夹
      const children = [];
      folderNodes.forEach((cf, ckey) => { if (cf.parent === key) children.push({ key: ckey, f: cf }); });
      children.sort((a, b) => a.f.label.localeCompare(b.f.label, 'zh'));
      children.forEach(c => renderFolder(c.f, c.key));
      // 文件（跳过纯目录项）
      (filesByFolder.get(key) || []).forEach(n => {
        if (n.isFolder) return;
        const active = n.path === edCurrent;
        html += '<div class="tree-file flex items-center gap-1.5 pr-2 py-1 cursor-pointer" draggable="true" data-type="note" data-path="' + esc(n.path) + '" data-name="' + esc(n.name) + '" title="' + esc(n.path) + '" style="' + (fNode.depth ? 'padding-left:' + (24 + fNode.depth * 24) + 'px;' : 'padding-left:24px;') + (active ? 'background: var(--note-brand-600); color: #FFFFFF;' : 'color: var(--note-ink-2);') + '">'
          + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: ' + (active ? '#FFFFFF' : 'var(--note-ink-3)') + ';"></i>'
          + '<span class="flex-1 truncate">' + esc(n.name) + '</span>'
          + '<span class="text-[10px] shrink-0" style="color: ' + (active ? 'rgba(255,255,255,0.7)' : 'var(--note-ink-3)') + ';">' + relDate(n.mtime) + '</span>'
          + '</div>';
      });
    };
    rootFolders.forEach(r => renderFolder(r.f, r.key));
    // 顶层文件（folder 为空；跳过纯目录项）
    (filesByFolder.get('') || []).forEach(n => {
      if (n.isFolder) return;
      const active = n.path === edCurrent;
      html += '<div class="tree-file flex items-center gap-1.5 pl-6 pr-2 py-1 cursor-pointer" draggable="true" data-type="note" data-path="' + esc(n.path) + '" data-name="' + esc(n.name) + '" title="' + esc(n.path) + '" style="' + (active ? 'background: var(--note-brand-600); color: #FFFFFF;' : 'color: var(--note-ink-2);') + '">'
        + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: ' + (active ? '#FFFFFF' : 'var(--note-ink-3)') + ';"></i>'
        + '<span class="flex-1 truncate">' + esc(n.name) + '</span>'
        + '<span class="text-[10px] shrink-0" style="color: ' + (active ? 'rgba(255,255,255,0.7)' : 'var(--note-ink-3)') + ';">' + relDate(n.mtime) + '</span>'
        + '</div>';
    });
    tree.innerHTML = html;
    refreshIcons();
    // 库统计
    const stat = $('vault-stat'); if (stat) stat.textContent = '共 ' + notes.length + ' 篇笔记' + (noteStore.isMock() ? ' · 网页演示' : '');
    const sizeEl = $('vault-size');
    if (sizeEl) { const kb = notes.reduce((s, n) => s + (n.size || 0), 0) / 1024; sizeEl.textContent = (kb < 1024 ? kb.toFixed(1) : (kb / 1024).toFixed(1)) + (kb < 1024 ? ' KB' : ' MB'); }
  }

  /* 绑定文件树拖拽移动：事件委托在 #file-tree 上，处理 HTML5 dragstart / dragover / drop / dragend
   * 支持：笔记拖入目录 → 移入；笔记/目录拖入根 → 移出；禁止把目录拖入自身子目录
   * 作者: 火 冰 */
  function bindFileTreeDrag() {
    const root = $('file-tree');
    if (!root) return;
    let dragSrc = null;   /* 正在被拖的元素 */
    let dragType = null;  /* 'note' | 'folder' */
    let dragPath = null;  /* 正在被拖的 path */

    // 根容器空白区作为「拖入根目录」的放置目标
    root.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    });
    root.addEventListener('dragleave', e => {
      if (e.target === root) root.classList.remove('drop-root-active');
    });
    root.addEventListener('drop', async e => {
      // 落在具体笔记/目录节点上：交给下方“委派到节点”的 drop 处理，
      // 避免空白区“拖入根目录”逻辑误拦截（否则根目录笔记拖到目录会误报“原地拖放无变化”）。
      if (e.target.closest && e.target.closest('.tree-file, .tree-folder')) return;
      e.preventDefault();
      root.classList.remove('drop-root-active');
      if (!dragSrc) return;
      // 目标：根目录（root 自身的空白区）
      const newParent = '';
      await handleFileTreeDrop(dragType, dragPath, newParent, null);
      clearDragVisual();
    });

    // 委托：每个条目自身作为 draggable 源 & 放置目标
    root.addEventListener('dragstart', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      if (!node) return;
      dragSrc = node;
      dragType = node.dataset.type;                /* 'note' | 'folder' */
      dragPath = node.dataset.type === 'folder' ? node.dataset.folder : node.dataset.path;
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', dragPath); } catch (_) {}
      node.style.opacity = '0.4';
    });
    root.addEventListener('dragend', e => {
      clearDragVisual();
    });

    root.addEventListener('dragover', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      // 根容器兜底
      if (!node || node === dragSrc) {
        if (dragSrc && !dragSrc.contains(e.target)) root.classList.add('drop-root-active');
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // 放置目标：目录 → 移入；文件 → 同目录追加（简单起见也移入它的父目录）
      node.classList.add('is-drop-target');
    });

    root.addEventListener('dragleave', e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      if (node) node.classList.remove('is-drop-target');
      root.classList.remove('drop-root-active');
    });

    root.addEventListener('drop', async e => {
      const node = e.target.closest('.tree-file, .tree-folder');
      e.preventDefault();
      root.classList.remove('drop-root-active');
      if (!dragSrc || !node) return;
      // 不能拖到自己或自己的子目录里
      if (node === dragSrc) { clearDragVisual(); return; }
      if (dragType === 'folder' && node.dataset.type === 'folder') {
        const targetDir = node.dataset.folder;
        if ((targetDir + '/').startsWith(dragPath.replace(/[\\/]+$/, '') + '/')) {
          showToast('不能把目录拖入它自己的子目录');
          clearDragVisual();
          return;
        }
      }
      // 目标父目录：拖到 file 用其父目录；拖到 folder 用该 folder
      let newParent = '';
      if (node.dataset.type === 'folder') newParent = node.dataset.folder;
      else newParent = (node.dataset.path || '').includes('/') ? (node.dataset.path || '').slice(0, (node.dataset.path || '').lastIndexOf('/')) : '';

      await handleFileTreeDrop(dragType, dragPath, newParent, node);
      clearDragVisual();
    });

    /* 清除拖拽视觉态（源节点透明度、目标高亮、根容器高亮） */
    function clearDragVisual() {
      if (dragSrc) dragSrc.style.opacity = '';
      dragSrc = dragType = dragPath = null;
      root.classList.remove('drop-root-active');
      root.querySelectorAll('.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    }
  }

  /* 执行一次拖拽移动/排序：note → noteStore.move；folder → noteStore.moveDir。
 * 若 newPath === dragPath 且有目标笔记 → 用 noteStore.swap 实现同目录排序
 * （交换两个文件的名字，保留内容不变，链接 [[A]] / [[B]] 指向正确内容）。
 * 内部会根据移动结果刷新文件树、处理当前打开笔记路径同步。
 * 作者: 火 冰 */
  async function handleFileTreeDrop(dragType, dragPath, newParent, targetEl) {
    if (!dragPath) return;
    if (dragType === 'note') {
      const name = dragPath.split('/').pop();
      const newPath = (newParent ? newParent + '/' : '') + name;
      // 同目录排序：newPath === dragPath，且有明确目标笔记 → swap
      if (newPath === dragPath) {
        if (!targetEl || targetEl.dataset.type !== 'note') {
          showToast('原地拖放无变化');
          return;
        }
        const targetPath = targetEl.dataset.path;
        if (!targetPath || targetPath === dragPath) { showToast('原地拖放无变化'); return; }
        try {
          const ok = await noteStore.swap(dragPath, targetPath);
          if (!ok) { showToast('同目录排序失败'); return; }
          showToast('已交换顺序：' + dragPath.split('/').pop() + ' ↔ ' + targetPath.split('/').pop());
        } catch (e) { showToast('排序失败：' + (e && e.message || e)); return; }
        // swap 可能涉及当前打开笔记 → 重开
        if (dragPath === edCurrent || targetPath === edCurrent) {
          const other = dragPath === edCurrent ? targetPath : dragPath;
          edCurrent = other;
          await openNote(other);
          renderTabs();
        }
        await refreshTreeAfterChange();
        return;
      }
      await actMoveNote(dragPath, newPath);
    } else if (dragType === 'folder') {
      if (newParent === dragPath || (newParent + '/').startsWith(dragPath.replace(/[\\/]+$/, '') + '/')) {
        showToast('不能把目录拖入它自己的子目录');
        return;
      }
      await actMoveDir(dragPath, newParent || '');
    }
  }

  /* 文件树就地重命名笔记：把该行文件名替换为输入框，Enter/失焦提交、Esc 取消。
   * 提交后仅修改文件名（不动正文标题，正文由 vditor 管理），带同名冲突校验与全部宿主状态同步。
   * 由文件树右键「重命名」与「双击文件名」共用。作者: 火 冰 */
  async function renameNoteFile(path) {
    if (!path) return;
    const row = Array.prototype.find.call(document.querySelectorAll('.tree-file'),
      function (f) { return f.dataset.path === path; });
    if (!row) return;
    const nameSpan = row.querySelector('span.flex-1.truncate');
    if (!nameSpan) return;
    const oldName = nameSpan.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = oldName.replace(/\.md$/i, '');
    input.className = 'w-full outline-none text-[13px]';
    input.style.cssText = 'background:transparent; color:var(--note-ink); border-bottom:1px solid var(--note-brand-400); min-width:0;';
    nameSpan.replaceWith(input);
    input.focus(); input.select();

    // 结束输入：取消时还原；提交时执行重命名
    const restore = function () { if (input.parentNode) input.parentNode.replaceChild(nameSpan, input); };
    async function commit() {
      if (input.dataset.closed) return; input.dataset.closed = '1';
      const v = input.value.trim().replace(/\.md$/i, '');
      if (!v || v === oldName) { restore(); return; }
      const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const newPath = (dir ? dir + '/' : '') + v + '.md';
      if (newPath === path) { restore(); return; }
      // 同名冲突拦截（同一文件树中已存在其它路径同名）
      if (edNotes.some(function (n) { return n.path === newPath; })) { showToast('已存在同名笔记「' + v + '」，无法重命名'); restore(); return; }
      try {
        // 该文件当前打开且存在未保存内容时，先落盘再移动，避免 read→delete 丢失内存改动
        if (edOutdated[path] != null) await noteStore.save(path, edOutdated[path]);
        const ok = await noteStore.move(path, newPath);
        if (!ok) { showToast('重命名失败：未执行'); restore(); return; }
        // 更新内存状态：未保存内容、路径、锁定、未保存标记、tab、文件树、当前笔记
        if (edOutdated[path] != null) { edOutdated[newPath] = edOutdated[path]; delete edOutdated[path]; }
        const i = edOpenTabs.indexOf(path);
        if (i !== -1) edOpenTabs[i] = newPath;
        if (edPinned.has(path)) { edPinned.delete(path); edPinned.add(newPath); }
        if (edDirty.has(path)) { edDirty.delete(path); edDirty.add(newPath); }
        edNotes = edNotes.map(function (n) { return n.path === path ? Object.assign({}, n, { path: newPath, name: v + '.md' }) : n; });
        if (edCurrent === path) edCurrent = newPath;
        renderFileTree(edNotes); renderTabs(); renderArticle(); persistRecentTabs();
        showToast('已重命名为「' + v + '」');
      } catch (err) {
        showToast('重命名失败：' + ((err && err.message) || err));
        restore();
      }
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'Escape') { e.preventDefault(); input.dataset.closed = '1'; restore(); }
      e.stopPropagation();
    });
    input.addEventListener('blur', commit);
    input.addEventListener('dblclick', function (e) { e.stopPropagation(); });
  }

  /* 新建笔记
   * 参数 targetDir：目标目录相对路径（空字符串=根目录）。文件树右键传入的目录/同级目录。默认根目录。
   * 作者: 火 冰 */
  async function doNewNote(targetDir) {
    const dir = targetDir || '';
    const name = (await window.inputModal({ title: '新笔记名称', value: '新笔记-' + new Date().getDate() + '-' + (new Date().getHours()) + (new Date().getMinutes()) })) || '';
    if (!name || !name.trim()) return;
    let rel;
    try { rel = await noteStore.create(name, dir); }
    catch (err) { alert('新建失败：' + err.message); return; }
    const meta = await noteStore.list();
    const n = meta.find(x => x.path === rel) || { path: rel, name: rel.split('/').pop(), folder: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '', mtime: Date.now(), size: (edOutdated[rel] || '').length };
    edNotes = meta.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    await openNote(n.path);
    renderFileTree(edNotes);
    setEditorMode('edit');
    // 聚焦当前可见的编辑元素（源码 textarea 或所见即所得）
    const visEl = edSource ? $('ed-edit') : $('ed-wysiwyg');
    if (visEl) visEl.focus();
  }

  /* 新建目录：提示输入目录名，创建后刷新文件树
   * 参数 parentDir：父目录相对路径（空字符串=根目录）。文件树右键时传入当前目录。默认根目录。
   * 作者: 火 冰 */
  async function doNewFolder(parentDir) {
    const parent = parentDir || '';
    const name = (await window.inputModal({ title: '新建目录名', placeholder: '支持子目录，用 / 分隔' })) || '';
    if (!name || !name.trim()) return;
    const full = parent ? parent.replace(/[\\/]+$/, '') + '/' + name : name;
    let rel;
    try { rel = await noteStore.createDir(full); }
    catch (err) { alert('新建目录失败：' + err.message); return; }
    // 重新列笔记并重绘文件树，使新目录即时显示
    const meta = await noteStore.list();
    edNotes = meta.sort((a, b) => a.path.localeCompare(b.path, 'zh'));
    renderFileTree(edNotes);
    showToast('已创建目录 ' + rel);
  }

  /* 侧边面板折叠 */
  function bindCollapse() {
    document.querySelectorAll('.collapse-head').forEach(head => {
      head.addEventListener('click', function () {
        const body = this.nextElementSibling;
        if (!body) return;
        const chevron = this.querySelector('i[data-lucide="chevron-down"]');
        if (body.style.display === 'none') {
          body.style.display = ''; if (chevron) chevron.setAttribute('data-lucide', 'chevron-down');
        } else {
          body.style.display = 'none'; if (chevron) chevron.setAttribute('data-lucide', 'chevron-right');
        }
        refreshIcons();
      });
    });
    const expandAll = document.querySelector('[data-action="expand-all"]');
    if (expandAll) expandAll.addEventListener('click', function () {
      document.querySelectorAll('#right-panel .collapse-head').forEach(head => {
        const body = head.nextElementSibling;
        if (body) body.style.display = '';
        const chevron = head.querySelector('i[data-lucide="chevron-right"]');
        if (chevron) chevron.setAttribute('data-lucide', 'chevron-down');
      });
      refreshIcons();
    });
  }