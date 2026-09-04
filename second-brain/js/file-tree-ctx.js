/* ============================================
 * 第二脑 — 文件树右键菜单
 * 作者: 火 冰
 * 功能: 文件树上右键时弹出菜单；支持删除（文档/目录）、移动到…（子菜单列目录）
 *       菜单项通过 data-path / data-folder 标识目标；删除时自动清理 AI 索引
 * ============================================ */

'use strict';

/* 关闭文件树右键菜单 */
function closeFileTreeContextMenu() {
  const m = document.getElementById('tree-ctx-menu');
  const ov = document.getElementById('tree-ctx-backdrop');
  if (m) m.remove();
  if (ov) ov.remove();
}

/* 便捷：构造一个普通菜单项 */
function treeSpec(label, icon, action, disabled) {
  return { label: label, icon: icon, action: action, disabled: !!disabled };
}

/* 列出全部非空目录（不含 .md 文件），用于「移动到…」子菜单 */
async function listDirs() {
  try {
    const list = await noteStore.list();
    const set = new Set();
    list.forEach(n => {
      const f = n.folder;
      if (f) set.add(f);
    });
    const dirs = Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
    return dirs;
  } catch (_) { return []; }
}

/* 删除当前打开笔记的安全判定：若删的是 edCurrent，需先关闭标签页 */
function handleDeleteOfCurrent(path, noteType) {
  if (path !== edCurrent) return;
  // 从标签列表移除 + 关闭编辑器
  edOpenTabs = edOpenTabs.filter(p => p !== path);
  delete edOutdated[path];
  edCurrent = edOpenTabs[edOpenTabs.length - 1] || null;
  renderTabs();
  if (edCurrent) renderArticle();
  else {
    const ta = document.getElementById('ed-edit');
    if (ta) ta.value = '';
    const pv = document.getElementById('ed-preview');
    if (pv) pv.innerHTML = '';
  }
}

/* 文件树节点右键：删除笔记 / 删除目录 / 移动到… */
async function actDeleteNote(path) {
  if (!confirm('确定删除笔记「' + path.split('/').pop() + '」吗？\n（同时清理该笔记的 AI 索引）')) return;
  try {
    await noteStore.remove(path);
    showToast('已删除：' + path.split('/').pop());
  } catch (e) { showToast('删除失败：' + (e && e.message || e)); return; }
  handleDeleteOfCurrent(path, 'note');
  await refreshTreeAfterChange();
}

async function actDeleteDir(dir) {
  if (!confirm('确定删除目录「' + dir + '」及其下所有笔记吗？\n（目录下每篇笔记的 AI 索引将一并清理）')) return;
  try {
    const removed = await noteStore.removeDir(dir);
    showToast('已删除目录下 ' + removed + ' 篇笔记');
  } catch (e) { showToast('删除失败：' + (e && e.message || e)); return; }
  // 若当前打开的笔记在被删目录下，也要关闭
  if (edCurrent && edCurrent.startsWith(dir.replace(/[\\/]+$/, '') + '/')) {
    handleDeleteOfCurrent(edCurrent, 'note');
  }
  await refreshTreeAfterChange();
}

async function actMoveNote(oldPath, newPath) {
  // 防移动到自身目录 + 同名覆盖风险
  if (!newPath.endsWith('.md')) newPath += '/' + oldPath.split('/').pop();
  try {
    const ok = await noteStore.move(oldPath, newPath);
    if (!ok) { showToast('移动失败：目标可能已存在'); return; }
    showToast('已移动：' + oldPath + ' → ' + newPath);
  } catch (e) { showToast('移动失败：' + (e && e.message || e)); return; }
  // 若移动的是当前打开的笔记 → 重新打开
  if (oldPath === edCurrent) {
    edCurrent = newPath;
    edOpenTabs = edOpenTabs.map(p => p === oldPath ? newPath : p);
    // 迁移缓存
    if (edOutdated[oldPath] != null) { edOutdated[newPath] = edOutdated[oldPath]; delete edOutdated[oldPath]; }
    await openNote(newPath);
    renderTabs();
  }
  await refreshTreeAfterChange();
}

async function actMoveDir(oldDir, newParent) {
  // 防止把目录移动到自身内部
  if ((newParent + '/').startsWith(oldDir.replace(/[\\/]+$/, '') + '/')) {
    showToast('不能把目录移动到它自己的子目录里');
    return;
  }
  try {
    const moved = await noteStore.moveDir(oldDir, newParent);
    showToast('已移动 ' + moved + ' 篇笔记');
  } catch (e) { showToast('移动失败：' + (e && e.message || e)); return; }
  // 若当前打开的笔记在被移动目录下 → 路径同步更新
  if (edCurrent && edCurrent.startsWith(oldDir.replace(/[\\/]+$/, '') + '/')) {
    const oldPrefix = oldDir.replace(/[\\/]+$/, '') + '/';
    const newDirName = oldDir.split('/').pop();
    const newPrefix = (newParent || '').replace(/[\\/]+$/, '') + '/' + newDirName + '/';
    const rel = edCurrent.slice(oldPrefix.length);
    const newPath = newPrefix + rel;
    edOpenTabs = edOpenTabs.map(p => p === edCurrent ? newPath : p);
    if (edOutdated[edCurrent] != null) { edOutdated[newPath] = edOutdated[edCurrent]; delete edOutdated[edCurrent]; }
    edCurrent = newPath;
    await openNote(newPath);
    renderTabs();
  }
  await refreshTreeAfterChange();
}

/* 变更后统一刷新文件树 + 笔记列表缓存 */
async function refreshTreeAfterChange() {
  edNotes = (await noteStore.list()).sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  renderFileTree(edNotes);
  refreshIcons();
}

/* 构建右键菜单项；支持子菜单（移动到…列目录） */
function buildTreeCtxItem(spec) {
  const el = document.createElement('div');
  if (spec === '-') { el.className = 'edit-ctx-sep'; return el; }
  el.className = 'edit-ctx-item' + (spec.disabled ? ' is-disabled' : '');
  const icon = spec.icon ? '<i data-lucide="' + spec.icon + '" class="w-3.5 h-3.5 shrink-0"></i>' : '';
  const caret = spec.children ? '<i data-lucide="chevron-right" class="ctxcaret w-3.5 h-3.5"></i>' : '';
  el.innerHTML = icon + '<span class="flex-1">' + esc(spec.label) + '</span>' + caret;
  if (spec.children) {
    const sub = document.createElement('div');
    sub.className = 'ctx-submenu';
    spec.children.forEach(cs => sub.appendChild(buildTreeCtxItem(cs)));
    el.appendChild(sub);
  }
  if (!spec.disabled && !spec.children) {
    el.addEventListener('click', e => {
      e.stopPropagation();
      closeFileTreeContextMenu();
      try { spec.action && spec.action(); } catch (_) {}
    });
  }
  return el;
}

/* 显示文件树右键菜单（自动靠边翻转） */
async function showFileTreeContextMenu(x, y, node) {
  closeFileTreeContextMenu();
  const isFolder = !!node.dataset.folder;
  const targetPath = node.dataset.path || node.dataset.folder || '';
  const menu = document.createElement('div');
  menu.id = 'tree-ctx-menu';
  menu.className = 'edit-ctx';           /* 复用编辑区右键菜单样式 */
  menu.style.minWidth = '180px';

  const dirs = await listDirs();
  const moveChildren = dirs
    .filter(d => !isFolder || d !== targetPath)   /* 目录：过滤自身 */
    .map(d => treeSpec(d || '根目录', 'folder', () => {
      if (isFolder) actMoveDir(targetPath, d); else actMoveNote(targetPath, (d ? d + '/' : '') + targetPath.split('/').pop());
    }));
  moveChildren.unshift(treeSpec('根目录', 'folder', () => {
    if (isFolder) actMoveDir(targetPath, ''); else actMoveNote(targetPath, targetPath.split('/').pop());
  }));

  const schema = isFolder ? [
    treeSpec('新建笔记', 'file-plus', () => { closeFileTreeContextMenu(); doNewNote(); }),
    treeSpec('新建子目录', 'folder-plus', () => { closeFileTreeContextMenu(); doNewFolder(); }),
    '-',
    { label: '移动到…', icon: 'move-right', children: moveChildren },
    '-',
    treeSpec('删除目录', 'trash-2', () => actDeleteDir(targetPath)),
  ] : [
    treeSpec('打开', 'file-text', () => openNote(targetPath)),
    '-',
    { label: '移动到…', icon: 'move-right', children: moveChildren },
    '-',
    treeSpec('删除笔记', 'trash-2', () => actDeleteNote(targetPath)),
  ];
  schema.forEach(s => menu.appendChild(buildTreeCtxItem(s)));

  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(Math.max(8, x), Math.max(8, vw - r.width));
  let top = Math.min(Math.max(8, y), Math.max(8, vh - r.height));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  // 遮罩：点击 / 右键 / 滚动 / Escape 关闭
  const overlay = document.createElement('div');
  overlay.id = 'tree-ctx-backdrop';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:122;';
  overlay.addEventListener('contextmenu', e => { e.preventDefault(); closeFileTreeContextMenu(); });
  overlay.addEventListener('click', closeFileTreeContextMenu);
  overlay.addEventListener('scroll', closeFileTreeContextMenu, true);
  document.body.appendChild(overlay);
  refreshIcons();
}

/* 绑定文件树右键：在 #file-tree 上做委托，命中 .tree-file / .tree-folder 时弹菜单并 stopPropagation
 * 阻断冒泡到 document，避免 app-vault.js 的 bindNoteContextMenu（旧的文件树菜单）再弹一份。
 * 命中空白区时不 stopPropagation，让事件继续冒泡给 document，app-vault.js 接手弹"新建笔记/目录"菜单。
 * 作者: 火 冰 */
function bindFileTreeContextMenu() {
  const root = document.getElementById('file-tree');
  if (!root) return;
  root.addEventListener('contextmenu', e => {
    const node = e.target.closest('.tree-file, .tree-folder');
    if (!node) return;                                // 空白区：不拦截，让 app-vault.js 处理
    e.preventDefault();
    e.stopPropagation();                              // 关键：阻断到 document，防止旧菜单再弹
    closeFileTreeContextMenu();
    showFileTreeContextMenu(e.clientX, e.clientY, node);
  });
  // 全局 Escape 兜底关闭（edit-ctx.js 已有自己的全局监听，我们独立）
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFileTreeContextMenu();
  });
}