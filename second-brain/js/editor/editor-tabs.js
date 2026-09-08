/* ============================================
 * 第二脑 — 编辑器宿主·标签页栏
 * 作者: 火 冰
 * 功能: 多标签排序/锁定/关闭、溢出滚动、拖拽排序、右键菜单
 * ============================================ */

'use strict';

  /* 锁定优先的 tab 显示顺序：锁定（固定）tab 恒定排在左端固定区，未锁定在后 */
  function tabDisplayOrder() {
    const pin = edOpenTabs.filter(function (p) { return edPinned.has(p); });
    const rest = edOpenTabs.filter(function (p) { return !edPinned.has(p); });
    return pin.concat(rest);
  }

  /* 切换某标签的锁定状态（固定↔普通）并重绘 */
  function toggleTabPin(p) {
    if (edPinned.has(p)) edPinned.delete(p); else edPinned.add(p);
    renderTabs();
    persistRecentTabs();
  }

  /* 把某标签滚动进 tab 栏可见区（openNote / render 后调用，保证当前打开的文件能在 tab 栏上看到） */
  function ensureTabVisible(p) {
    const box = $('editor-tabs'); if (!box) return;
    const el = box.querySelector('.editor-tab[data-path="' + CSS.escape(p) + '"]');
    if (!el) return;
    const br = box.getBoundingClientRect(), er = el.getBoundingClientRect();
    const absLeft = box.scrollLeft + (er.left - br.left);
    const absRight = absLeft + el.offsetWidth;
    if (absLeft < box.scrollLeft) box.scrollLeft = absLeft;
    else if (absRight > box.scrollLeft + box.clientWidth) box.scrollLeft = absRight - box.clientWidth;
  }

  /* 按 tab 内容是否溢出显示/隐藏滚动按钮，并刷新左右按钮不可滚动端淡显 */
  function updateTabScroll() {
    const box = $('editor-tabs'); if (!box) return;
    const wrap = $('tabs-scroll');
    if (wrap) wrap.style.display = (box.scrollWidth > box.clientWidth + 2) ? '' : 'none';
    const l = box.parentNode && box.parentNode.querySelector('[data-action="tabs-scroll-left"]');
    const r = box.parentNode && box.parentNode.querySelector('[data-action="tabs-scroll-right"]');
    if (l) l.style.opacity = box.scrollLeft > 2 ? '1' : '0.3';
    if (r) r.style.opacity = (box.scrollLeft + box.clientWidth < box.scrollWidth - 2) ? '1' : '0.3';
  }

  /* 横向滚动 tab 栏查看越界页签：dir=±1 */
  function scrollTabs(dir) {
    const box = $('editor-tabs'); if (!box) return;
    box.scrollLeft += dir * Math.round(box.clientWidth * 0.8);
    updateTabScroll();
  }

  /* 关闭一组标签；列表为空则忽略。当前被关时激活切换到剩余列表的末位（若尚未加载则补读一次）。 */
  async function closeTabs(list) {
    if (!list || !list.length) return;
    const closing = new Set(list);
    const closedCurrent = closing.has(edCurrent);
    edOpenTabs = edOpenTabs.filter(function (p) { return !closing.has(p); });
    list.forEach(function (p) { delete edOutdated[p]; edPinned.delete(p); edDirty.delete(p); });
    if (closedCurrent) edCurrent = edOpenTabs[edOpenTabs.length - 1] || null;
    const p = edCurrent;
    renderTabs();
    if (p) {
      if (!(p in edOutdated)) { try { edOutdated[p] = await noteStore.read(p); } catch (_) { /* 读取失败保持空 */ } }
      renderArticle();
      // 关闭页签切换文档后，按记忆统一编辑模式恢复 vditor 布局，清除分屏/预览残留导致的编辑区异常变窄。
      // 记忆与实际布局一致时幂等无副作用；不一致时拉回记忆布局（如 IR 编辑态全宽）
      applyEditorMode(lastEditorMode());
    } else if (typeof vdSetValue === 'function') vdSetValue('');
    renderFileProps();
    persistRecentTabs();
  }

  /* 渲染标签栏：锁定 tab 固定左端 + 钉/锁图标（点击锁定/解锁）+ 可拖拽排序 + 激活态 */
  function renderTabs() {
    const box = $('editor-tabs'); if (!box) return;
    const order = tabDisplayOrder();
    let html = order.map(p => {
      const name = p.split('/').pop();
      const active = p === edCurrent;
      const pinned = edPinned.has(p);
      // 固定区 tab：无关闭按钮，锁图标可点击解锁；普通 tab：× 左侧放钉图标可锁定
      const pinIcon = pinned
        ? '<i data-lucide="lock" data-action="pin-toggle" data-path="' + esc(p) + '" title="解除锁定" class="w-3 h-3 shrink-0" style="cursor:pointer; color:var(--note-brand-400);"></i>'
        : '<i data-lucide="pin" data-action="pin-toggle" data-path="' + esc(p) + '" title="锁定（固定到左端）" class="w-3 h-3 shrink-0" style="opacity:.5; cursor:pointer;"></i>';
      const closeIcon = pinned
        ? ''
        : '<i data-lucide="x" data-action="close-tab" data-path="' + esc(p) + '" title="关闭" class="w-3 h-3 shrink-0" style="opacity:.5; cursor:pointer;"></i>';
      const dragState = (edDragFrom && edDragFrom === p) ? ' opacity:.35;'
        : (edDragTarget && edDragTarget === p) ? ' box-shadow: inset 0 -2px 0 var(--note-brand-400);' : '';
      return '<div class="editor-tab h-full flex items-center gap-2 pl-2.5 pr-3 border-r cursor-pointer whitespace-nowrap" draggable="true" data-path="' + esc(p) + '" title="' + esc(p) + '" style="border-color: var(--note-border); background: ' + (active ? 'var(--note-background)' : (pinned ? 'rgba(124,58,237,.06)' : 'transparent')) + '; color: ' + (active ? 'var(--note-ink)' : 'var(--note-ink-3)') + ';' + dragState + '">'
        + '<i data-lucide="file-text" class="w-3.5 h-3.5 shrink-0" style="color: var(--note-brand-400);"></i>'
        + '<span class="text-[13px]">' + esc(name) + '</span>'
        + pinIcon + closeIcon
        + '</div>';
    }).join('');
    box.innerHTML = html;
    refreshIcons();
    updateTabScroll();
    ensureTabVisible(edCurrent);
  }

  /* 关闭 tab 右键菜单 */
  function closeTabContextMenu() {
    const m = document.getElementById('tab-ctx-menu');
    const ov = document.getElementById('tab-ctx-backdrop');
    if (m) m.remove(); if (ov) ov.remove();
  }

  /* 构建单个 tab 菜单项：支持二级子菜单 / 分隔线（复用编辑区菜单样式 edit-ctx-item/ctx-submenu）。
   * @param {object|string} spec 菜单描述（- 为分隔线）
   * @param {Function} close 关闭菜单（点击后调用）
   * @author 火 冰 */
  function buildTabCtxItem(spec, close) {
    const el = document.createElement('div');
    if (spec === '-') { el.className = 'edit-ctx-sep'; return el; }
    el.className = 'edit-ctx-item';
    const icon = spec.icon ? '<i data-lucide="' + spec.icon + '" class="w-3.5 h-3.5 shrink-0"></i>' : '';
    const caret = spec.children ? '<i data-lucide="chevron-right" class="ctxcaret w-3.5 h-3.5"></i>' : '';
    el.innerHTML = icon + '<span class="flex-1">' + esc(spec.label) + '</span>' + caret;
    if (spec.children) {
      const sub = document.createElement('div');
      sub.className = 'ctx-submenu';
      spec.children.forEach(function (cs) { sub.appendChild(buildTabCtxItem(cs, close)); });
      el.appendChild(sub);
    }
    if (!spec.disabled && !spec.children) {
      el.addEventListener('click', function (e) { e.stopPropagation(); close(); if (spec.action) spec.action(); });
    }
    return el;
  }

  /* 在鼠标位置显示 tab 右键菜单：锁定/解锁、关闭、关闭多个标签（二级）、资源管理器中显示 */
  function showTabContextMenu(x, y, p) {
    closeTabContextMenu();
    const pinned = edPinned.has(p);
    const order = tabDisplayOrder();
    const idx = order.indexOf(p);
    const left = idx > 0 ? order.slice(0, idx) : [];
    const right = (idx >= 0 && idx < order.length - 1) ? order.slice(idx + 1) : [];
    const unpin = function (arr) { return arr.filter(function (q) { return !edPinned.has(q); }); };
    const other = unpin(order.filter(function (q) { return q !== p; }));          // 保留当前、保留锁定
    const leftT = unpin(left), rightT = unpin(right);
    const allUnpinned = edOpenTabs.filter(function (q) { return !edPinned.has(q); });
    const unmodified = edOpenTabs.filter(function (q) { return !edPinned.has(q) && !edDirty.has(q) && q !== p; });
    const schema = [
      { label: pinned ? '解除锁定' : '锁定（固定到左端）', icon: pinned ? 'lock' : 'pin', action: function () { toggleTabPin(p); } },
      '-',
      { label: '关闭「' + esc(p.split('/').pop()) + '」', icon: 'x', action: function () { closeTabs([p]); renderFileTree(edNotes); } },
      { label: '关闭多个标签', icon: 'layers', children: [
        { label: '关闭其他标签', icon: 'file-minus', action: function () { closeTabs(other); } },
        { label: '除锁定标签全部关闭', icon: 'lock', action: function () { closeTabs(allUnpinned); } },
        '-',
        { label: '关闭左侧所有标签', icon: 'chevron-left', action: function () { closeTabs(leftT); } },
        { label: '关闭右侧所有标签', icon: 'chevron-right', action: function () { closeTabs(rightT); } },
        { label: '关闭所有未修改', icon: 'check', action: function () { closeTabs(unmodified); } },
      ] },
      '-',
      { label: '在资源管理器中显示', icon: 'folder-open', action: function () {
        if (window.noteDesktop) { window.noteDesktop.revealNote(p).catch(function () { }); }
        else { showToast('该功能仅桌面版可用'); }
      } },
    ];
    const menu = document.createElement('div');
    menu.id = 'tab-ctx-menu';
    menu.className = 'edit-ctx';
    schema.forEach(function (s) { menu.appendChild(buildTabCtxItem(s, closeTabContextMenu)); });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(Math.max(8, x), Math.max(8, vw - r.width)) + 'px';
    menu.style.top = Math.min(Math.max(8, y), Math.max(8, vh - r.height)) + 'px';
    const overlay = document.createElement('div');
    overlay.id = 'tab-ctx-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:122;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeTabContextMenu(); });
    overlay.addEventListener('click', closeTabContextMenu);
    overlay.addEventListener('scroll', closeTabContextMenu, true);
    document.body.appendChild(overlay);
    refreshIcons();
  }

  /* 拖拽排序：把 from 标签插入到 to 标签之前（固定/普通同区由 dragover 判定担保） */
  function reorderTab(from, to) {
    const fi = edOpenTabs.indexOf(from);
    const ti = edOpenTabs.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    const item = edOpenTabs[fi];
    edOpenTabs.splice(fi, 1);
    edOpenTabs.splice(edOpenTabs.indexOf(to), 0, item);
    renderTabs();
    persistRecentTabs();
  }