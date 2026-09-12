/* ============================================
 * 第二脑 — 编辑区右键与块级 Markdown 工具
 * 作者: 火 冰
 * 功能: 编辑区右键菜单、选区替换、块格式、表格插入与粘贴处理
 * ============================================ */

'use strict';


  /* ============================
   * 编辑区右键菜单（Markdown 编辑器）
   * 说明：仅当打开的是 .md 笔记且在编辑区 (textarea#ed-edit) 内右键时弹出，
   *       支持二级子菜单，覆盖行内格式、块级格式、插入与剪贴板操作。
   * 作者: 火 冰
   * ============================ */

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

  // 二级子菜单浮动管理：同一时刻只展开一个；延迟关闭以桥接父项与子菜单之间的空隙
  let edCtxSubTimer = null;

  // 所见即所得右键命中的块信息（随每次右键更新）：{type:'paragraph'|'heading'|'list'|'link'|'code'|'table'|'quote'|'hr', block, link}
  let edCtxHit = null;

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

  /* 构造编辑区右键菜单数据描述（按当前选区状态生成） */
  function buildEdCtxSchema(ta) {
    const hasSel = ta && ta.selectionStart != null && ta.selectionStart < ta.selectionEnd;
    const wrapFmt = function (o, c) { return function () { mdWrap(ta, o, c); }; };
    const blockFmt = function (f) { return function () { mdBlockFormat(ta, f); }; };
    return [
      specItem('新增链接', 'link', function () { mdExternalLink(ta, true); }),
      specItem('新增外部链接', 'external-link', function () { mdExternalLink(ta, false); }),
      { label: '文本格式', icon: 'type', children: [
        specItem('加粗', 'bold', wrapFmt('**', '**')),
        specItem('倾斜', 'italic', wrapFmt('*', '*')),
        specItem('删除线', 'strikethrough', wrapFmt('~~', '~~')),
        specItem('高亮', 'highlighter', wrapFmt('==', '==')),
        specItem('代码', 'code', wrapFmt('`', '`')),
        specItem('数学', 'sigma', wrapFmt('$', '$')),
        specItem('注释', 'percent', wrapFmt('%%', '%%')),
        '-',
        specItem('清除格式', 'eraser', function () { mdClearFormat(ta); }),
      ]},
      { label: '段落设置', icon: 'pilcrow', children: [
        specItem('无序列表', 'list', blockFmt('bullet')),
        specItem('有序列表', 'list-ordered', blockFmt('order')),
        specItem('任务列表', 'square-check-big', blockFmt('task')),
        '-',
        specItem('1级标题', 'heading-1', blockFmt('h1')),
        specItem('2级标题', 'heading-2', blockFmt('h2')),
        specItem('3级标题', 'heading-3', blockFmt('h3')),
        specItem('4级标题', 'heading-4', blockFmt('h4')),
        specItem('5级标题', 'heading-5', blockFmt('h5')),
        specItem('6级标题', 'heading-6', blockFmt('h6')),
        specItem('正文', 'pilcrow', blockFmt('paragraph'), false, true),
        specItem('引用', 'quote', blockFmt('quote')),
      ]},
      { label: '插入', icon: 'plus', children: [
        specItem('脚注', 'footprints', function () { mdInsertAtCursor(ta, '[^1] '); }),
        specItem('表格', 'table', function () { mdInsertTable(ta); }),
        specItem('标注', 'message-square', function () { mdInsertBlockAtCursor(ta, '\n> [!note] 标注\n> '); }),
        specItem('分隔线', 'minus', function () { mdInsertBlockAtCursor(ta, '\n\n---\n\n'); }),
        '-',
        specItem('代码块', 'code', function () { mdInsertBlockAtCursor(ta, '\n```text\n\n```\n'); }),
        specItem('数学块', 'sigma', function () { mdInsertBlockAtCursor(ta, '\n$$\n\n$$\n'); }),
        specItem('新建数据库', 'database', function () { mdInsertBlockAtCursor(ta, '\n```dataview\nlist where file.name = this.file.name\n```\n'); }),
      ]},
      '-',
      specItem('剪切', 'scissors', function () { edClipboard(ta, 'cut'); }, !hasSel),
      specItem('复制', 'copy', function () { edClipboard(ta, 'copy'); }, !hasSel),
      specItem('粘贴', 'clipboard-paste', function () { edPaste(ta, false); }),
      specItem('以纯文本形式粘贴', 'text', function () { edPaste(ta, true); }),
      specItem('全选', 'select', function () { if (ta) { ta.focus(); ta.select(); } }),
    ];
    // PL-11: 追加插件声明的编辑区右键菜单项
    if (typeof pluginManager !== 'undefined') {
      const pluginItems = pluginManager.getContextMenus('editor');
      if (pluginItems.length > 0) {
        schema.push('-');
        pluginItems.forEach(function (m) { schema.push(m); });
      }
    }
    return schema;
  }

  /* 显示编辑区右键菜单（自动靠近边缘时翻转，避免溢出屏幕）；按编辑模式选择操作集：
 * edSource=true=源码 markdown 语法菜单；false=所见即所得富文本菜单 */
  function showEditorContextMenu(x, y) {
    closeEditorContextMenu();
    const schema = edSource ? buildEdCtxSchema(document.getElementById('ed-edit')) : buildEdWysiwygSchema();
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
    refreshIcons();
  }

  /* 全局右键委托：编辑区(Markdown) 内右键时弹出菜单；仅当打开的是 .md 笔记。
   * eSource=true=源码 textarea（使用 markdown 语法菜单）；false=所见即所得 contenteditable（使用富文本菜单）。
   * 所见即所得下先解析命中块类型，供 buildEdWysiwygSchema 生成差异化菜单。 */
  function bindEditorContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      const editor = e.target && e.target.closest ? e.target.closest('#ed-edit, #ed-wysiwyg') : null;
      if (editor && edCurrent && /\.md$/i.test(edCurrent)) {
        e.preventDefault();
        closeEditorContextMenu();
        // 所见即所得模式下先解析右键命中的块，供差分菜单使用
        if (!edSource) edCtxHit = resolveWysHit(e.target);
        showEditorContextMenu(e.clientX, e.clientY);
      }
    });
  }

  /* 在所见即所得区域执行某个富文本命令并同步：改为系统选区后执行 execCommand，
   * 再派发 input 事件，由 #ed-wysiwyg 的 input 监听 → onEdInput(domToMd) 自动还原为 Markdown 保存/同步预览。
   * @param {string} cmd  execCommand 命令名
   * @param {string} [value] 命令参数（如链接地址/块标签），可为空
   * 作者: 火 冰 */
  function execWys(cmd, value) {
    const wys = document.getElementById('ed-wysiwyg');
    if (!wys) return;
    wys.focus();
    try { document.execCommand(cmd, false, value || ''); }
    catch (_) { /* 个别命令/环境不支持时静默忽略 */ }
    wys.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 在所见即所得光标处插入一个(或多个)顶层块，并把光标放到末尾节点里，随后派发 input 同步 markdown。
   * 插入的块结构与 renderMarkdown 输出一致，供 domToMd 正确还原。
   * 关键：块级元素一律作为 #ed-wysiwyg 的直接子级插入（紧跟当前顶层块之后），
   * 否则会因光标停留在段落内而把 <pre>/<table> 嵌进 <p>，domToMd 只识别顶层块，导致还原错乱/丢失。
   * @param {string} html  待插入的块 HTML
   * @param {Element} [anchor] 可选：插入锚点（右键命中的块），插入到该块之后；缺省时按光标顶层块定位
   * 作者: 火 冰 */
  function insertWysBlock(html, anchor) {
    const wys = document.getElementById('ed-wysiwyg');
    if (!wys) return;
    wys.focus();
    clearWysBlock();
    const sel = window.getSelection();
    const range = (sel && sel.rangeCount && sel.getRangeAt(0)) || null;
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    // 收集并移动顶层子节点（必须边移边取，否则 firstChild 恒存在会死循环）
    const nodes = [];
    while (wrap.firstChild) { nodes.push(wrap.firstChild); wrap.removeChild(wrap.firstChild); }
    const frag = document.createDocumentFragment();
    nodes.forEach(function (n) { frag.appendChild(n); });
    // 插入锚点：优先用传入 anchor（右键命中的块，插入到其后，解决「右键插入跑到首行」）；
    // 否则回退光标所在顶层块之后，避免嵌套进内容器
    const anchorBlk = (anchor && anchor.parentNode === wys) ? anchor : (range ? topLevelWysBlock(range.startContainer, wys) : null);
    if (anchorBlk && anchorBlk !== wys) {
      anchorBlk.parentNode.insertBefore(frag, anchorBlk.nextSibling);
    } else if (range && range.collapsed) {
      wys.appendChild(frag);
    } else if (range) {
      range.deleteContents(); range.insertNode(frag);
    } else {
      wys.appendChild(frag);
    }
    const last = nodes[nodes.length - 1];
    if (last && last.nodeType === 1) { try { placeCaretAtEnd(last); } catch (_) { } }
    // 插入的块若落在末尾（如代码块），补齐末尾空段落，保证块后仍可回车新增一行
    if (typeof appendWysTrailingP === 'function') appendWysTrailingP(wys);
    wys.dispatchEvent(new Event('input', { bubbles: true }));
    refreshIcons();
  }

  /* 从节点向上找到 #ed-wysiwyg 的直接子级（顶层块）；用于把块级插入点锚定到顶层而非段内。
   * @param {Node} node  光标所在节点（文本或元素）
   * @param {Element} root wys 容器
   * @returns {Node} 顶层块（root 的直接子级），锚点即为 root 时返回 root
   * 作者: 火 冰 */
  function topLevelWysBlock(node, root) {
    let cur = node && node.nodeType === 3 ? node.parentNode : node;
    while (cur && cur !== root && cur.parentNode && cur.parentNode !== root) cur = cur.parentNode;
    return cur && cur !== root ? cur : (root || null);
  }

  /* 解析所见即所得右键命中的块类型与块元素，供差异化右键菜单使用。
   * 命中优先级：行内链接 > 顶层特殊块(PRE/TABLE/BLOCKQUOTE/HR) > 普通顶层块(段落/标题/列表)。
   * @param {Element} target 右键事件的目标元素
   * @returns {{type:string, block:Element|null, link:Element|null}}
   * 作者: 火 冰 */
  function resolveWysHit(target) {
    const wys = document.getElementById('ed-wysiwyg');
    const hit = { type: 'paragraph', block: null, cell: null, link: null };
    if (!wys || !target || !target.closest) return hit;
    const link = target.closest('a');
    if (link) hit.link = link;
    const special = target.closest('PRE, BLOCKQUOTE, TABLE, HR');
    if (special && special.parentNode === wys) {
      hit.block = special;
      hit.type = special.nodeName === 'PRE' ? 'code'
        : special.nodeName === 'TABLE' ? 'table'
        : special.nodeName === 'BLOCKQUOTE' ? 'quote' : 'hr';
      // 表格额外记下右键命中的单元格，供「行/列增删」按被点格子所在行列操作而非最左/首行
      if (special.nodeName === 'TABLE') hit.cell = target.closest('td, th') || null;
      return hit;
    }
    const blk = topLevelWysBlock(target, wys);
    if (blk && blk !== wys) {
      hit.block = blk;
      const n = blk.nodeName;
      if (n === 'UL' || n === 'OL' || n === 'LI') hit.type = 'list';
      else if (/^H[1-6]$/.test(n)) hit.type = 'heading';
      else hit.type = 'paragraph';
    }
    return hit;
  }

  /* 取删除块的相邻「内容块」（跳过 .code-lang 语言标签等非内容兄弟），供删除后放置光标。
   * @param {Element} blk 被删的顶层块
   * @param {string} dir 'prev'=取 `previousElementSibling`，'next'=`nextElementSibling`
   * @returns {Element|null} 相邻内容块；没有（含相邻是语言标签或无兄弟）返回 null
   * 作者: 火 冰 */
  function wysAdjacentContent(blk, dir) {
    if (!blk || !blk.parentNode) return null;
    const sib = dir === 'prev' ? blk.previousElementSibling : blk.nextElementSibling;
    if (!sib || sib.parentNode !== blk.parentNode) return null;
    // 语言标签是代码块的内容伴侣（兄弟节点），不视为独立相邻内容块
    return (sib.classList && sib.classList.contains('code-lang')) ? null : sib;
  }

  /* 把光标放到容器最开头（删除首个可编辑块、无相邻内容块时的兜底）。 */
  function placeCaretAtWysStart(wys) {
    try {
      const range = document.createRange();
      range.setStart(wys, 0); range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
    } catch (_) { /* 忽略定位异常 */ }
  }

  /* 删除所见即所得的一个顶层块并同步 markdown（把光标放到相邻内容块；无则放回容器开头）。
   * 代码块会连同其前置 .code-lang 语言标签一起删除，避免残留空标签与外链漂移。
   * @param {Element} blk 待删除的顶层块
   * 作者: 火 冰 */
  function deleteWysBlock(blk) {
    const wys = document.getElementById('ed-wysiwyg');
    if (!wys || !blk || blk.parentNode !== wys) return;
    const prev = wysAdjacentContent(blk, 'prev');
    const next = wysAdjacentContent(blk, 'next');
    // 代码块：一并删除其前置语言标签（<div class="code-lang">）
    const langTag = (blk.nodeName === 'PRE' && blk.previousElementSibling
      && blk.previousElementSibling.classList && blk.previousElementSibling.classList.contains('code-lang'))
      ? blk.previousElementSibling : null;
    if (langTag) langTag.remove();
    blk.remove();
    if (typeof hideCodeLangPicker === 'function') hideCodeLangPicker();
    const wasSel = (typeof edBlockSel !== 'undefined') ? edBlockSel : null;
    if (wasSel === blk && typeof clearWysBlock === 'function') clearWysBlock();
    wys.dispatchEvent(new Event('input', { bubbles: true }));
    if (prev && prev.parentNode === wys && typeof placeCaretAtEnd === 'function') placeCaretAtEnd(prev);
    else if (next && next.parentNode === wys && typeof placeCaretAtEnd === 'function') placeCaretAtEnd(next);
    else placeCaretAtWysStart(wys);
  }

  /* 复制一个所见即所得块的纯文本到剪贴板。
   * 优先走异步 Clipboard API；在 Electron / note:// 协议下 writeText 常被拒绝
   * （NotAllowedError），此时回退 document.execCommand 选区复制，并给出成功/失败提示，
   * 避免「复制代码」静默无反应（与 markdown-editor 插件 code.js 保持一致）。
   * @param {Element} blk 目标块
   * 作者: 火 冰 */
  function wysCopyBlock(blk) {
    if (!blk) return;
    const txt = blk.innerText || blk.textContent || '';
    const toast = function (msg) { if (typeof showToast === 'function') showToast(msg); };
    const fallback = function () {
      try {
        const range = document.createRange();
        range.selectNodeContents(blk);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        toast(ok ? '已复制' : '复制失败');
      } catch (_) { toast('复制失败'); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { toast('已复制'); }).catch(fallback);
    } else {
      fallback();
    }
  }

  /* 移除所见即所得里的一个链接（保留其文字内容），并同步 markdown。
   * @param {Element} aEl 链接元素
   * 作者: 火 冰 */
  function wysRemoveLink(aEl) {
    if (!aEl) return;
    const wys = document.getElementById('ed-wysiwyg');
    try {
      const txt = aEl.textContent || '';
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode(txt));
      aEl.parentNode.replaceChild(frag, aEl);
      if (wys) wys.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (_) { /* 忽略 */ }
  }

  /* 表格行/列增删（手动 DOM 操作，不依赖 execCommand）并同步 markdown。
   * @param {HTMLTableElement} table 目标表格
   * @param {string} op  'row-before'|'row-after'|'row-delete'|'col-before'|'col-after'|'col-delete'
   * @param {Element} [refCell] 可选：右键命中的单元格(td/th)，行列增删以它所在行/列为目标
   * 作者: 火 冰 */
  function wysTableOp(table, op, refCell) {
    if (!table || table.nodeName !== 'TABLE') return;
    const cells = function (tr) { return Array.prototype.slice.call(tr.children).filter(function (c) { return /^T[DH]$/.test(c.nodeName); }); };
    /* 定位参考单元格：优先右键命中的单元格 → 选区单元格 → null。
     * getSelection 在右键时不含命中位置，仅作无 refCell 时的兜底。 */
    const pickRefCell = function () {
      if (refCell && refCell.closest('table') === table) return refCell;
      const selTd = (document.getSelection && document.getSelection().anchorNode) ? (document.getSelection().anchorNode.closest ? document.getSelection().anchorNode.closest('td, th') : null) : null;
      return (selTd && selTd.closest('table') === table) ? selTd : null;
    };
    /* 行操作：rows 增删。参考行定位同列操作一致（右键命中行优先，容错首数据行）。 */
    if (op === 'row-before' || op === 'row-after' || op === 'row-delete') {
      const ref = pickRefCell();
      const refTr = ref ? ref.closest('tr') : ((table.tBodies[0] && table.tBodies[0].rows[0]) ? table.tBodies[0].rows[0] : null);
      if (!refTr) return;
      if (op === 'row-delete') {
        // 删除行：至少保留「表头行 + 1 数据行」才合法（首行会被当作表头、其后需分隔行）
        if (table.querySelectorAll('tr').length <= 2) return;
        refTr.remove();
        table.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      const isHead = refTr.parentNode && refTr.parentNode.nodeName === 'THEAD';
      const newTr = document.createElement('tr');
      const ns = cells(refTr).length;
      for (let i = 0; i < ns; i++) {
        const td = document.createElement(isHead ? 'th' : 'td');
        td.className = 'px-2 py-1';
        if (!isHead) td.style.cssText = 'border:1px solid var(--note-border);';
        td.innerHTML = '<br>';
        newTr.appendChild(td);
      }
      if (op === 'row-before') refTr.parentNode.insertBefore(newTr, refTr);
      else refTr.parentNode.insertBefore(newTr, refTr.nextSibling);
      table.dispatchEvent(new Event('input', { bubbles: true }));
    } else { // 列操作：col-before|col-after|col-delete，对每行在目标列插/删一个单元格
      const ref = pickRefCell();
      const firstTr = table.querySelector('tr');
      const headCells = firstTr ? cells(firstTr) : [];
      let idx = ref ? Array.prototype.indexOf.call(ref.parentNode.children, ref) : 0;
      if (idx < 0 || idx >= headCells.length) idx = 0;
      Array.prototype.forEach.call(table.querySelectorAll('tr'), function (tr) {
        const cs = cells(tr);
        if (op === 'col-delete') {
          // 删除列：该行至少保留 1 列才删，避免整行清空
          if (cs.length <= 1 || idx >= cs.length) return;
          cs[idx].remove();
        } else {
          if (idx >= cs.length) return;
          if (op === 'col-before') { cs[idx].insertAdjacentHTML('beforebegin', '<td class="px-2 py-1" style="border:1px solid var(--note-border);"><br></td>'); }
          else { cs[idx].insertAdjacentHTML('afterend', '<td class="px-2 py-1" style="border:1px solid var(--note-border);"><br></td>'); }
        }
      });
      table.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /* 所见即所得右键「插入图片/上传附件」的共享文件选择与上传逻辑
   * （WYSIWYG 是自定义 DOM 而非 vditor 模式，不能用 editor-vditor 的 handleVdUpload；
   *   上传仍走同一桥接 uploadResource 落盘到 .resources，再按类型生成可往返的 DOM 块）。
   * 说明：
   *   - 图片 → `<p>![名](url)</p>`（富文本编辑区不渲染 <img>，预览/阅读正常显示图片）；
   *   - 附件 → `<blockquote>[!attach] 名 url</blockquote>`（= 卡片引言，预览/阅读渲染完整卡片）。
   * 作者: 火 冰 */
  /* 上传与块生成（insWysPickUpload / handleWysPickFiles / wysUploadBlockHtml / wysEsc）
   * 真实逻辑已迁入 markdown-editor 插件的 md-context.js，本宿主通过 window.insWysPickUpload
   * 调用；网页版无目录插件时为 undefined，由调用方按需降级提示。 */

  /* 构建「所见即所得」编辑区右键菜单：富文本原生操作（execCommand 可实现），
   * markdown 专用的表格/脚注/数学块等在富文本里不提供，避免选中语义错乱。 */
  function buildEdWysiwygSchema() {
    const selTxt = (window.getSelection ? (window.getSelection().toString() || '') : '');
    const hasSel = selTxt.length > 0;
    const fmt = function (cmd, v) { return function () { execWys(cmd, v); }; };
    // 插入代码块：直接插入一个只有单个空白行的空代码块（不弹语言输入框），
    // 语言由点击代码块右下角的语言选择器设定；结构/data-lang 与 renderMarkdown、domToMd 一致。
    const evHitAnchor = function () { return (edCtxHit && edCtxHit.block) || null; };
    const insCode = function () {
      insertWysBlock('<pre data-lang="" style="background: var(--note-surface-2); border: 1px solid var(--note-border); color: var(--note-ink); white-space: pre; font-family: var(--note-font-mono); padding: 1rem; border-radius: 8px; margin-top: 0.75rem; margin-bottom: 0.75rem; overflow-x: auto; min-height: 3rem;"><br></pre>', evHitAnchor());
    };
    const insQuote = function () {
      insertWysBlock('<blockquote class="my-3 pl-4 py-1 border-l-2" style="border-color: var(--note-brand-600); color: var(--note-ink-2);"><p style="font-style: italic;"><br></p></blockquote>', evHitAnchor());
    };
    // 插入表格：默认 3 列 × 3 行（表头 1 行 + 2 行数据），插入后光标落在首个 td 内（直接在表中定位编辑）
    const insTable = function () {
      const tblHtml = '<table class="my-3 w-full border-collapse text-[13px]" style="border: 1px solid var(--note-border);">'
        + '<thead><tr>'
        + '<th class="px-2 py-1 text-left font-semibold" style="border:1px solid var(--note-border); background: var(--note-surface-2);">列1</th>'
        + '<th class="px-2 py-1 text-left font-semibold" style="border:1px solid var(--note-border); background: var(--note-surface-2);">列2</th>'
        + '<th class="px-2 py-1 text-left font-semibold" style="border:1px solid var(--note-border); background: var(--note-surface-2);">列3</th>'
        + '</tr></thead><tbody>'
        + '<tr><td class="px-2 py-1"><br></td><td class="px-2 py-1"><br></td><td class="px-2 py-1"><br></td></tr>'
        + '<tr><td class="px-2 py-1"><br></td><td class="px-2 py-1"><br></td><td class="px-2 py-1"><br></td></tr>'
        + '</tbody></table>';
      insertWysBlock(tblHtml, evHitAnchor());
      // 光标落到表格首个 td 内，方便直接输入
      const wys = document.getElementById('ed-wysiwyg');
      const firstTd = wys && wys.querySelector('table td');
      if (firstTd && typeof placeCaretAtEnd === 'function') { try { placeCaretAtEnd(firstTd); } catch (_) { } }
    };
    const insTask = function () {
      insertWysBlock('<div class="flex items-start gap-2.5 my-1.5"><i data-lucide="square" class="w-4 h-4 mt-0.5 shrink-0" style="color: var(--note-ink-3);"></i><span style="color: var(--note-ink);"><br></span></div>', evHitAnchor());
    };
    // 插入脚注：markdown 语法 `[^1]`（行内上标引用），往返还原为 `[^1]` 文本
    const insFoot = function () {
      insertWysBlock('<span class="wys-foot" style="vertical-align: super; font-size: 0.8em; color: var(--note-brand-400);">[^1]</span>', evHitAnchor());
    };
    // 插入数学块：markdown 语法 `$$ 内容 $$`（块级），往返还原为 `$$  $$`
    const insMath = function () {
      insertWysBlock('<div class="wys-math" style="text-align: center; background: var(--note-surface-2); border: 1px solid var(--note-border); border-radius: 8px; padding: 1rem; margin: 0.75rem 0; color: var(--note-ink);">$$ <br> $$</div>', evHitAnchor());
    };
    // 插入链接：基于选中文本或光标处插入链；有选区用 execWys('createLink') 包裹，无选区插入空链
    const insLink = async function () {
      const selT = window.getSelection ? window.getSelection().toString() : '';
      const res = await window.inputLinkModal({ title: '插入链接', text: selT || '' });
      if (!res) return;
      if (selT && typeof execWys === 'function') {
        execWys('createLink', res.url);
        const wys = document.getElementById('ed-wysiwyg');
        const a = wys && wys.querySelector('a[href="' + res.url.replace(/&/g, '&amp;') + '"]');
        if (a) a.textContent = res.text || res.url; // 应用所选文字
      } else {
        const wys = document.getElementById('ed-wysiwyg');
        if (!wys) return;
        wys.focus();
        const rng = (window.getSelection && window.getSelection().getRangeAt) ? window.getSelection().getRangeAt(0) : null;
        const a = document.createElement('a');
        a.href = res.url;
        a.target = '_blank';
        a.className = 'underline decoration-dotted underline-offset-2';
        a.style.color = 'var(--note-brand-400)';
        a.textContent = res.text || res.url;
        if (rng && rng.collapsed) { rng.insertNode(a); try { placeCaretAtEnd(a); } catch (_) { } }
        else if (rng) { rng.deleteContents(); rng.insertNode(a); }
        else wys.appendChild(a);
        wys.dispatchEvent(new Event('input', { bubbles: true }));
        refreshIcons();
      }
    };

    // 共通文本格式段（字体/字号/颜色/背景色/数学 由共享组提供，与悬浮工具栏同源）
    const textFmt = (typeof wysTextFmtGroup === 'function') ? wysTextFmtGroup() : { label: '文本格式', icon: 'type', children: [] };
    // 共通段落设置段（与悬浮工具栏同源）
    const paraFmt = (typeof wysParaFmtGroup === 'function') ? wysParaFmtGroup(insTask) : { label: '段落设置', icon: 'pilcrow', children: [] };
    // 共通插入段
    const insSeg = {
      label: '插入', icon: 'plus', children: [
        specItem('链接', 'link', insLink),
        specItem('图片', 'image', function () {
          const pick = (typeof window.insWysPickUpload === 'function') ? window.insWysPickUpload : function () { console.warn('[markdown-editor] 上传仅桌面版支持'); };
          pick('image', function (html) { insertWysBlock(html, evHitAnchor()); });
        }),
        specItem('附件', 'paperclip', function () {
          const pick = (typeof window.insWysPickUpload === 'function') ? window.insWysPickUpload : function () { console.warn('[markdown-editor] 上传仅桌面版支持'); };
          pick('attachment', function (html) { insertWysBlock(html, evHitAnchor()); });
        }),
        specItem('脚注', 'superscript', insFoot),
        specItem('表格', 'table', insTable),
        specItem('标注', 'quote', insQuote),
        specItem('分割线', 'minus', fmt('insertHorizontalRule')),
        specItem('代码块', 'code', insCode),
        specItem('数学块', 'sigma', insMath),
      ],
    };
    // 共通尾段：剪贴板 + 全选
    const tail = [
      specItem('剪切', 'scissors', function () { execWys('cut'); }, !hasSel),
      specItem('复制', 'copy', function () { execWys('copy'); }, !hasSel),
      specItem('粘贴', 'clipboard-paste', function () { execWys('paste', null); }),
      specItem('以纯文本形式粘贴', 'text', function () {
        if (navigator.clipboard && navigator.clipboard.readText) {
          navigator.clipboard.readText().then(function (txt) { execWys('insertText', txt || ''); }).catch(function () { execWys('paste', null); });
        } else { execWys('paste', null); }
      }),
      specItem('全选', 'select', function () {
        const wys = document.getElementById('ed-wysiwyg');
        if (!wys) return;
        wys.focus();
        const r = document.createRange();
        r.selectNodeContents(wys);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(r);
      }),
    ];

    // 按右键命中的块类型生成差异化菜单；未命中(默认)为段落场景
    const hit = edCtxHit || { type: 'paragraph', block: null, link: null };
    const blk = hit.block;
    const linkEl = hit.link;
    const deleteItem = blk ? specItem('删除本块', 'trash-2', function () { deleteWysBlock(blk); }) : null;
    const syncInput = function () {
      const wys = document.getElementById('ed-wysiwyg');
      if (wys) wys.dispatchEvent(new Event('input', { bubbles: true }));
    };

    let menu;
    switch (hit.type) {
      case 'code':   // 代码块：改语言 / 复制 / 删除
        menu = [
          specItem('设置语言', 'code', function () { if (typeof showCodeLangPicker === 'function' && blk) { if (typeof selectWysBlock === 'function') selectWysBlock(blk); else showCodeLangPicker(blk); } }),
          specItem('复制代码', 'copy', function () { wysCopyBlock(blk); }),
          deleteItem,
          '-',
        ].concat(tail);
        break;
      case 'table':  // 表格：行/列增删、删除表格
        menu = [
          specItem('在上方插入行', 'arrow-up', function () { wysTableOp(blk, 'row-before', hit.cell); }),
          specItem('在下方插入行', 'arrow-down', function () { wysTableOp(blk, 'row-after', hit.cell); }),
          specItem('在左侧插入列', 'arrow-left', function () { wysTableOp(blk, 'col-before', hit.cell); }),
          specItem('在右侧插入列', 'arrow-right', function () { wysTableOp(blk, 'col-after', hit.cell); }),
          '-',
          specItem('删除该行', 'unlink', function () { wysTableOp(blk, 'row-delete', hit.cell); }),
          specItem('删除该列', 'columns', function () { wysTableOp(blk, 'col-delete', hit.cell); }),
          deleteItem,
          '-',
        ].concat(tail);
        break;
      case 'quote':  // 标注：转为正文、插入、删除
        menu = [
          specItem('转为正文', 'pilcrow', fmt('formatBlock', 'p')),
          '-',
          insSeg,
          deleteItem,
          '-',
        ].concat(tail);
        break;
      case 'link':   // 链接：编辑 / 移除 + 文本格式
        menu = [
          specItem('编辑链接', 'link', async function () {
            const res = await window.inputLinkModal({ title: '编辑链接', text: (linkEl && linkEl.textContent) || '', value: (linkEl && linkEl.href) || 'https://' });
            if (res && linkEl) { linkEl.href = res.url; if (res.text) linkEl.textContent = res.text; syncInput(); }
          }),
          specItem('移除链接', 'unlink', function () { wysRemoveLink(linkEl); }),
          '-',
          textFmt,
          '-',
        ].concat(tail);
        break;
      case 'hr':     // 分隔线：删除
        menu = [deleteItem, '-'].concat(tail);
        break;
      case 'list':   // 列表：段落设置、插入、删除
        menu = [
          paraFmt,
          insSeg,
          deleteItem,
          '-',
        ].concat(tail);
        break;
      case 'heading':
      default:        // 段落 / 标题：完整菜单；有选中文本且非链接时提供「链接」转链
        menu = [
          textFmt,
          paraFmt,
          insSeg,
          (hasSel && !hit.link) ? specItem('链接', 'link', insLink) : null,
          deleteItem,
          '-',
        ].concat(tail);
        break;
    }
    // 过滤掉空项（无命中块时删除项为 null）
    return menu.filter(function (m) { return m != null; });
  }

  /* 行内包裹：对选区应用打开/闭合标记；已包裹则撤销；无选区则插入空标记并放置光标 */
  function mdWrap(ta, open, close) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    let text = val.slice(s, e);
    const re = new RegExp('^' + escapeRe(open) + '([\\s\\S]*?)' + escapeRe(close) + '$');
    const m = text.match(re);
    const next = m ? m[1] : (open + text + close);
    const start = m ? s + open.length : s;
    const end = start + next.length;
    ta.value = val.slice(0, s) + next + val.slice(e);
    ta.focus();
    ta.setSelectionRange(start, end);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 插入内部链接（[[名称]]）或外部链接（[选中](url)）：带选区则用选区，否则用输入框提示
   * 说明：Electron 不支持 window.prompt，改用 window.inputModal 异步输入。作者: 火 冰 */
  async function mdExternalLink(ta, internal) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    if (internal) {
      const label = sel || (await window.inputModal({ title: '链接文字' })) || '';
      const target = (await window.inputModal({ title: '目标笔记名', placeholder: '不含 .md' })) || label;
      const next = '[[' + target + ']' + (label && label !== target ? '|' + label : '') + ']';
      replaceSel(ta, s, e, next);
      return;
    }
    const label = sel || (await window.inputModal({ title: '链接文字' })) || '链接';
    const url = (await window.inputModal({ title: 'URL', value: 'https://' })) || '';
    replaceSel(ta, s, e, '[' + label + '](' + url + ')');
  }

  /* 以新值替换选区并触发 input 事件 */
  function replaceSel(ta, s, e, next) {
    ta.value = ta.value.slice(0, s) + next + ta.value.slice(e);
    ta.focus();
    ta.setSelectionRange(s + next.length, s + next.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 对光标所在行应用块级格式（列表/引用/标题/正文）；多行选区整体处理首尾行 */
  function mdBlockFormat(ta, fmt) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    const ls = val.lastIndexOf('\n', s - 1) + 1;
    let le = val.indexOf('\n', e);
    if (le === -1) le = val.length;
    let text = val.slice(ls, le);
    const out = applyBlockLine(text, fmt);
    ta.value = val.slice(0, ls) + out + val.slice(le);
    ta.focus();
    ta.setSelectionRange(ls, ls + out.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 对单行文本应用块级格式，返回新行文本（同格式再次点击为切换撤销） */
  function applyBlockLine(text, fmt) {
    if (fmt === 'bullet') return toggleLinePrefix(text, /^- /, '- ');
    if (fmt === 'task') return toggleLinePrefix(text, /^- \[[ xX]\] /, '- [ ] ');
    if (fmt === 'quote') return toggleLinePrefix(text, /^> /, '> ');
    if (fmt === 'order') return toggleLinePrefix(text, /^\d+[.、] /, '1. ');
    if (fmt === 'paragraph') return text.replace(/^(#{1,6}\s+|[-*>+]\s+|>\s+|\d+[.、]\s+|-\s\[[ xX]\]\s+)/, '');
    if (/^h[1-6]$/.test(fmt)) {
      const level = +fmt[1];
      const m = text.match(/^(#{1,6})\s+/);
      if (m && m[1].length === level) return text.slice(m[0].length);
      return '#'.repeat(level) + ' ' + text.replace(/^#{1,6}\s+/, '');
    }
    return text;
  }

  /* 通用：若行首匹配给定前缀则移除，否则添加 */
  function toggleLinePrefix(text, re, prefix) {
    const stripped = text.replace(re, '');
    return stripped === text ? prefix + text : stripped;
  }

  /* 清除选区/整行的 Markdown 标记（行内包裹与块级前缀） */
  function mdClearFormat(ta) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    let mono = /(\*\*|\*|~~|==|`|\$\$|\$|%%)/gi;
    let text = val.slice(s, e);
    if (s === e) {
      const ls = val.lastIndexOf('\n', s - 1) + 1;
      let le = val.indexOf('\n', e);
      if (le === -1) le = val.length;
      text = val.slice(ls, le);
      const out = applyBlockLine(text, 'paragraph').replace(mono, '');
      ta.value = val.slice(0, ls) + out + val.slice(le);
      ta.setSelectionRange(ls, ls + out.length);
    } else {
      const out = text.replace(/(\*\*|\*|~~|==|`|\$\$|\$|%%)/g, '');
      ta.value = val.slice(0, s) + out + val.slice(e);
      ta.setSelectionRange(s, s + out.length);
    }
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /* 在光标处插入文本（不换行包裹） */
  function mdInsertAtCursor(ta, text) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    replaceSel(ta, s, e, text);
  }

  /* 在光标处插入块级元素（前后补空白行） */
  function mdInsertBlockAtCursor(ta, block) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const val = ta.value;
    const head = (s > 0 && val[s - 1] !== '\n' && val[s - 1] !== ' ') ? '\n' : '';
    replaceSel(ta, s, e, head + block);
  }

  /* 在光标处插入一个 Markdown 表格骨架 */
  function mdInsertTable(ta) {
    if (!ta) return;
    ta.focus();
    const block = '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n';
    mdInsertBlockAtCursor(ta, block);
  }

  /* 剪贴板操作：cut / copy（基于选区；无选区则禁用项不会触发） */
  function edClipboard(ta, op) {
    if (!ta) return;
    ta.focus();
    if (ta.selectionStart === ta.selectionEnd) return;
    try { document.execCommand(op); showToast(op === 'cut' ? '已剪切' : '已复制'); }
    catch (err) { showToast('操作失败'); }
  }

  /* 粘贴（纯文本模式直接插入无格式文本），基于系统剪贴板异步读取 */
  async function edPaste(ta, plain) {
    if (!ta) return;
    ta.focus();
    let text = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText();
      else { document.execCommand('paste'); return; }
    } catch (err) { document.execCommand('paste'); return; }
    if (!text) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    if (plain) text = text.replace(/(\r\n|\r|\n)/g, '\n');
    ta.value = ta.value.slice(0, s) + text + ta.value.slice(e);
    ta.focus();
    ta.setSelectionRange(s + text.length, s + text.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
