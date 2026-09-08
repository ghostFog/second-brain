/* ============================================
 * 第二脑 — 文件树右键菜单（统一覆盖目录 / 笔记 / 空白区三种场景）
 * 作者: 火 冰
 * 功能:
 *   - 目录右键：在资源管理器打开 / 新建目录(该目录下) / 新建笔记(该目录下) / 删除 / 移动
 *   - 笔记右键：在资源管理器打开 / 新建笔记(同级目录下) / 删除 / 移动
 *   - 空白区右键：新建目录(根目录下) / 新建笔记(根目录下) / 显示/隐藏隐藏目录
 *   - 所有场景命中后 stopPropagation，阻断冒泡到 document，避免与 app-vault.js 旧菜单重复
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

/* 列出全部非空目录（不含 .md 文件），用于「移动到…」子菜单 / 根目录下新建的父选择
 * 作者: 火 冰 */
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

/* 资源管理器定位桌面文件/目录；网页版提示仅桌面版可用。
 * main.js 的 notes:reveal 底层用 shell.showItemInFolder，对文件/目录都支持，
 * 所以统一调 revealNote 即可（参数路径若是目录，Electron 也能正确定位）。
 * 作者: 火 冰 */
function openInExplorer(path) {
  const bridge = window.noteDesktop;
  if (!bridge) { showToast('该功能仅桌面版可用'); return; }
  if (bridge.revealNote) bridge.revealNote(path).catch(() => {});
  else { showToast('资源管理器定位失败'); }
}

/* 删除笔记路径对应的标签页 + 缓存；若 edCurrent 正好被删 → 切换到下一个打开笔记
 * 作者: 火 冰 */
function handleDeleteOfCurrent(path) {
  if (path !== edCurrent) return;
  edOpenTabs = edOpenTabs.filter(p => p !== path);
  delete edOutdated[path];
  edCurrent = edOpenTabs[edOpenTabs.length - 1] || null;
  renderTabs();
  if (edCurrent) renderArticle();
  else if (typeof vdSetValue === 'function') vdSetValue('');
}

/* 右键菜单 动作：删除笔记 */
async function actDeleteNote(path) {
  if (!confirm('确定删除笔记「' + path.split('/').pop() + '」吗？\n（同时清理该笔记的 AI 索引）')) return;
  try {
    await noteStore.remove(path);
    showToast('已删除：' + path.split('/').pop());
  } catch (e) { showToast('删除失败：' + (e && e.message || e)); return; }
  handleDeleteOfCurrent(path);
  await refreshTreeAfterChange();
}

/* 右键菜单 动作：删除目录（递归删所有下级笔记 + 索引） */
async function actDeleteDir(dir) {
  if (!confirm('确定删除目录「' + dir + '」及其下所有笔记吗？\n（每篇笔记的 AI 索引将一并清理）')) return;
  try {
    const removed = await noteStore.removeDir(dir);
    showToast('已删除目录下 ' + removed + ' 篇笔记');
  } catch (e) { showToast('删除失败：' + (e && e.message || e)); return; }
  if (edCurrent && edCurrent.startsWith(dir.replace(/[\\/]+$/, '') + '/')) {
    handleDeleteOfCurrent(edCurrent);
  }
  await refreshTreeAfterChange();
}

/* 右键菜单 动作：移动笔记到新父目录（跨目录移动；若新父目录下已存在同名笔记则失败） */
async function actMoveNote(oldPath, newPath) {
  if (oldPath === newPath) return;
  try {
    const ok = await noteStore.move(oldPath, newPath);
    if (!ok) { showToast('移动失败：目标可能已存在'); return; }
    showToast('已移动：' + oldPath.split('/').pop());
  } catch (e) { showToast('移动失败：' + (e && e.message || e)); return; }
  if (oldPath === edCurrent) {
    edCurrent = newPath;
    edOpenTabs = edOpenTabs.map(p => p === oldPath ? newPath : p);
    if (edOutdated[oldPath] != null) { edOutdated[newPath] = edOutdated[oldPath]; delete edOutdated[oldPath]; }
    await openNote(newPath);
    renderTabs();
  }
  await refreshTreeAfterChange();
}

/* 右键菜单 动作：移动目录（整体搬到新父目录下，保留内部相对路径；禁止拖入自身子目录） */
async function actMoveDir(oldDir, newParent) {
  if ((newParent + '/').startsWith(oldDir.replace(/[\\/]+$/, '') + '/')) {
    showToast('不能把目录移动到它自己的子目录里');
    return;
  }
  try {
    const moved = await noteStore.moveDir(oldDir, newParent);
    showToast('已移动目录「' + oldDir.split('/').pop() + '」' + (moved ? '（含 ' + moved + ' 篇笔记）' : ''));
  } catch (e) { showToast('移动失败：' + (e && e.message || e)); return; }
  // 同步当前打开笔记路径
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

/* 变更后统一刷新文件树 + 笔记列表缓存
 * 作者: 火 冰 */
async function refreshTreeAfterChange() {
  edNotes = (await noteStore.list()).sort((a, b) => a.path.localeCompare(b.path, 'zh'));
  renderFileTree(edNotes);
  refreshIcons();
}

/* 构建单个菜单项（支持二级子菜单 / 分隔线 / 禁用态） */
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

/* 显示右键菜单（自动靠边翻转，避免溢出） */
function showFileTreeContextMenu(x, y, schema) {
  closeFileTreeContextMenu();
  const menu = document.createElement('div');
  menu.id = 'tree-ctx-menu';
  menu.className = 'edit-ctx';
  menu.style.minWidth = '180px';
  schema.forEach(s => menu.appendChild(buildTreeCtxItem(s)));
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = Math.min(Math.max(8, x), Math.max(8, vw - r.width));
  let top = Math.min(Math.max(8, y), Math.max(8, vh - r.height));
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  // 遮罩：点击 / 右键 / 滚动 关闭
  const overlay = document.createElement('div');
  overlay.id = 'tree-ctx-backdrop';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:122;';
  overlay.addEventListener('contextmenu', e => { e.preventDefault(); closeFileTreeContextMenu(); });
  overlay.addEventListener('click', closeFileTreeContextMenu);
  overlay.addEventListener('scroll', closeFileTreeContextMenu, true);
  document.body.appendChild(overlay);
  refreshIcons();
}

/* 笔记右键「打开」二级子菜单：在资源管理器打开 + 各 Provider 支持的打开方式
 * 依据该文件后缀，取 pluginManager.getEditorProviders(ext) 命中的 Provider 的 openers；
 * 无 Provider（仅兜底）时仍给出纯文本编辑；生成异常时仅保留资源管理器定位。
 * 作者: 火 冰 */
function buildOpenChildren(path) {
  const children = [treeSpec('在资源管理器打开', 'folder-open', () => openInExplorer(path))];
  try {
    const ext = (typeof fileExtension === 'function') ? fileExtension(path) : '';
    const pm = (typeof pluginManager !== 'undefined' && pluginManager && pluginManager.getEditorProviders) ? pluginManager : null;
    const prov = (pm ? pm.getEditorProviders(ext) : [])[0];
    if (prov && prov.openers) {
      prov.openers.forEach(o => {
        children.push(treeSpec(o.label, o.icon || 'file-type', () => openNote(path, { mode: o.id })));
      });
    }
  } catch (_) { /* 忽略：失败时仅保留资源管理器打开 */ }
  return children;
}

/* 绑定文件树右键：在 #file-tree 上做委托，统一处理目录 / 笔记 / 空白区三种场景
 * 所有匹配场景命中后 stopPropagation，阻断冒泡到 document，确保只弹一份菜单。
 * 作者: 火 冰 */
function bindFileTreeContextMenu() {
  const root = document.getElementById('file-tree');
  if (!root) return;

  root.addEventListener('contextmenu', async e => {
    e.preventDefault();
    e.stopPropagation();                            // ★ 关键：阻断到 document，防止 app-vault.js 旧菜单再弹一份
    const folderNode = e.target.closest('.tree-folder');
    const noteNode = e.target.closest('.tree-file');

    if (folderNode) {
      // ===== 目录菜单 =====
      const targetDir = folderNode.dataset.folder || '';
      const dirs = await listDirs();
      // 移动到… 子菜单：根目录 + 全部目录，过滤自身
      const moveChildren = [
        treeSpec('根目录', 'folder', () => actMoveDir(targetDir, '')),
        ...dirs.filter(d => d !== targetDir).map(d => treeSpec(d, 'folder', () => actMoveDir(targetDir, d))),
      ];
      showFileTreeContextMenu(e.clientX, e.clientY, [
        treeSpec('在资源管理器打开', 'folder-open', () => openInExplorer(targetDir)),
        '-',
        treeSpec('新建目录', 'folder-plus', () => doNewFolder(targetDir)),
        treeSpec('新建笔记', 'file-plus', () => doNewNote(targetDir)),
        '-',
        { label: '移动到…', icon: 'move-right', children: moveChildren },
        '-',
        treeSpec('删除目录', 'trash-2', () => actDeleteDir(targetDir)),
      ]);
      return;
    }

    if (noteNode) {
      // ===== 笔记菜单 =====
      const targetPath = noteNode.dataset.path || '';
      const siblingDir = targetPath.includes('/') ? targetPath.slice(0, targetPath.lastIndexOf('/')) : '';
      const dirs = await listDirs();
      const moveChildren = [
        treeSpec('根目录', 'folder', () => actMoveNote(targetPath, targetPath.split('/').pop())),
        ...dirs.map(d => treeSpec(d, 'folder', () => actMoveNote(targetPath, (d ? d + '/' : '') + targetPath.split('/').pop()))),
      ];
      showFileTreeContextMenu(e.clientX, e.clientY, [
        { label: '打开', icon: 'folder-open', children: buildOpenChildren(targetPath) },
        '-',
        treeSpec('新建笔记', 'file-plus', () => doNewNote(siblingDir)),
        '-',
        { label: '移动到…', icon: 'move-right', children: moveChildren },
        treeSpec('重命名', 'edit-3', () => renameNoteFile(targetPath)),
        '-',
        treeSpec('删除笔记', 'trash-2', () => actDeleteNote(targetPath)),
      ]);
      return;
    }

    // ===== 空白区菜单 =====
    const showHidden = restoreS('showHidden', false);
    showFileTreeContextMenu(e.clientX, e.clientY, [
      treeSpec('新建目录', 'folder-plus', () => doNewFolder('')),
      treeSpec('新建笔记', 'file-plus', () => doNewNote('')),
      '-',
      treeSpec((showHidden ? '隐藏隐藏目录' : '显示隐藏目录'), showHidden ? 'eye-off' : 'eye', () => toggleHiddenFiles()),
    ]);
  });

  // 全局 Escape 兜底关闭（与 edit-ctx.js / vault 菜单各自独立）
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFileTreeContextMenu();
  });
}
