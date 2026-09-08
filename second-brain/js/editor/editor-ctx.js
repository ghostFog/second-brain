/* ============================================
 * 第二脑 — 编辑器宿主·右键菜单通用 UI
 * 作者: 火 冰
 * 功能: 编辑区右键菜单通用项构建/关闭/子菜单展开（承载后续 md 右键菜单的通用构建函数）
 * 说明: 本文件仅承载「与 Provider 无关」的通用右键菜单 UI 与宿主空白右键骨架；
 *       md 语法相关的菜单（bindEditorContextMenu/showEditorContextMenu/buildEdCtxSchema/
 *       buildEdWysiwygSchema）保留在 app-editor-ctx.js，本文件不搬。
 * ============================================ */

'use strict';

  /* 转义正则元字符 */
  function escapeRe(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /* 关闭编辑区右键菜单 */
  function closeEditorContextMenu() {
    const m = document.getElementById('ed-ctx-menu');
    const ov = document.getElementById('ed-ctx-backdrop');
    if (m) m.remove();
    if (ov) ov.remove();
    if (edCtxSubTimer) { clearTimeout(edCtxSubTimer); edCtxSubTimer = null; }
  }

  /* 把指定菜单项的子菜单置为展开/收起；展开前关闭同菜单其它已展开子菜单
   * @param {Element} itemEl 带子菜单的菜单项元素
   * @param {boolean} open 是否展开
   * 作者: 火 冰 */
  function setEdCtxSubmenu(itemEl, open) {
    if (!itemEl) return;
    const sub = itemEl.querySelector(':scope > .ctx-submenu');
    if (!sub) return;
    if (open) {
      (itemEl.closest('.edit-ctx') || document).querySelectorAll('.edit-ctx-item .ctx-submenu.show')
        .forEach(function (s) { s.classList.remove('show'); });
    }
    sub.classList.toggle('show', open);
  }

  /* 构建单个菜单项；支持二级子菜单 / 分隔线 / 禁用 / 选中标记 */
  function buildEdCtxItem(spec) {
    const el = document.createElement('div');
    if (spec === '-') { el.className = 'edit-ctx-sep'; return el; }
    el.className = 'edit-ctx-item' + (spec.disabled ? ' is-disabled' : '') + (spec.checked ? ' is-checked' : '');
    const icon = spec.icon ? '<i data-lucide="' + spec.icon + '" class="w-3.5 h-3.5 shrink-0"></i>' : '';
    const check = spec.checked ? '<i data-lucide="check" class="w-3.5 h-3.5 shrink-0"></i>' : '';
    const caret = spec.children ? '<i data-lucide="chevron-right" class="ctxcaret w-3.5 h-3.5"></i>' : '';
    el.innerHTML = icon + '<span class="flex-1">' + esc(spec.label) + '</span>' + check + caret;
    if (spec.children) {
      const sub = document.createElement('div');
      sub.className = 'ctx-submenu';
      spec.children.forEach(function (cs) { sub.appendChild(buildEdCtxItem(cs)); });
      el.appendChild(sub);
      // 悬停展开/收起子菜单：延迟收起，桥接父项→子菜单之间可能存在的空隙
      el.addEventListener('mouseenter', function () {
        if (edCtxSubTimer) { clearTimeout(edCtxSubTimer); edCtxSubTimer = null; }
        setEdCtxSubmenu(el, true);
      });
      el.addEventListener('mouseleave', function () {
        if (edCtxSubTimer) { clearTimeout(edCtxSubTimer); edCtxSubTimer = null; }
        edCtxSubTimer = setTimeout(function () { setEdCtxSubmenu(el, false); edCtxSubTimer = null; }, 250);
      });
      sub.addEventListener('mouseenter', function () { if (edCtxSubTimer) { clearTimeout(edCtxSubTimer); edCtxSubTimer = null; } });
      sub.addEventListener('mouseleave', function () { setEdCtxSubmenu(el, false); });
    }
    if (!spec.disabled && !spec.children) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        closeEditorContextMenu();
        if (spec.action) spec.action();
      });
    }
    return el;
  }

  /* 便捷：构造一个普通菜单项 */
  function specItem(label, icon, action, disabled, checked) {
    return { label: label, icon: icon, action: action, disabled: !!disabled, checked: !!checked };
  }

  /* 取编辑区右键菜单 schema：优先经当前 Provider 契约（buildContextMenu），
   * 未实现/未命中时回退全局 md 装配函数（由 markdown-editor 插件 common/features 提供）。
   * @param {boolean} source true=源码模式，false=所见即所得
   * @param {Object} [hit] 所见即所得命中块 {type,block,link}
   * @returns {Object[]} 菜单项 schema
   * 作者: 火 冰 */
  function resolveEditorCtxSchema(source, hit) {
    if (edProvider && typeof edProvider.buildContextMenu === 'function') {
      const s = edProvider.buildContextMenu(source ? 'source' : 'wys', hit || null);
      if (s && s.length) return s;
    }
    // Provider 未就绪/未命中时回退宿主旧链：把命中信息同步到全局 edCtxHit，
    // 供 buildEdWysiwygSchema 依据块类型生成差分菜单（否则恒为段落菜单，代码/表格菜单丢失）
    if (hit && typeof edCtxHit !== 'undefined') edCtxHit = hit;
    if (source && typeof buildEdCtxSchema === 'function') return buildEdCtxSchema(document.getElementById('ed-edit'));
    if (!source && typeof buildEdWysiwygSchema === 'function') return buildEdWysiwygSchema();
    return [];
  }

  /* 显示编辑区右键菜单（自动靠近边缘时翻转，避免溢出屏幕）；按编辑模式选择操作集：
   * edSource=true=源码 markdown 语法菜单；false=所见即所得富文本菜单。
   * @param {number} x 鼠标 X
   * @param {number} y 鼠标 Y
   * @param {Object} [hit] 所见即所得右键命中的块信息（供差异化菜单）
   * 作者: 火 冰 */
  function showEditorContextMenu(x, y, hit) {
    closeEditorContextMenu();
    const schema = resolveEditorCtxSchema(edSource, hit || null);
    const menu = document.createElement('div');
    menu.id = 'ed-ctx-menu';
    menu.className = 'edit-ctx';
    schema.forEach(function (s) { menu.appendChild(buildEdCtxItem(s)); });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, x), Math.max(8, vw - r.width));
    let top = Math.min(Math.max(8, y), Math.max(8, vh - r.height));
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    // 遮罩：点击 / 右键 / 滚动 关闭
    const overlay = document.createElement('div');
    overlay.id = 'ed-ctx-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:122;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeEditorContextMenu(); });
    overlay.addEventListener('click', closeEditorContextMenu);
    overlay.addEventListener('scroll', closeEditorContextMenu, true);
    document.body.appendChild(overlay);
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  /* 全局右键委托：编辑区(Markdown) 内右键时弹出菜单；仅当打开的是 .md 笔记。
   * edSource=true=源码 textarea（markdown 语法菜单）；false=所见即所得 contenteditable（富文本菜单）。
   * 所见即所得下先解析命中块类型，传给 Provider.buildContextMenu 生成差异化菜单。
   * 作者: 火 冰 */
  function bindEditorContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      const editor = e.target && e.target.closest ? e.target.closest('#ed-edit, #ed-wysiwyg') : null;
      if (editor && edCurrent && /\.md$/i.test(edCurrent)) {
        e.preventDefault();
        closeEditorContextMenu();
        // 所见即所得模式下先解析右键命中的块，供差分菜单使用
        let hit = null;
        if (!edSource && typeof resolveWysHit === 'function') {
          try { hit = resolveWysHit(e.target); } catch (_) { /* 忽略解析异常 */ }
        }
        showEditorContextMenu(e.clientX, e.clientY, hit);
      }
    });
  }