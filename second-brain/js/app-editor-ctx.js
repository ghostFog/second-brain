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
  }

  /* 显示编辑区右键菜单（自动靠近边缘时翻转，避免溢出屏幕） */
  function showEditorContextMenu(x, y) {
    closeEditorContextMenu();
    const ta = document.getElementById('ed-edit');
    const menu = document.createElement('div');
    menu.id = 'ed-ctx-menu';
    menu.className = 'edit-ctx';
    buildEdCtxSchema(ta).forEach(function (s) { menu.appendChild(buildEdCtxItem(s)); });
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

  /* 全局右键委托：编辑区(Markdown) 内右键时弹出菜单；仅当打开的是 .md 笔记 */
  function bindEditorContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      const editor = e.target && e.target.closest ? e.target.closest('#ed-edit') : null;
      if (editor && edCurrent && /\.md$/i.test(edCurrent)) {
        e.preventDefault();
        closeEditorContextMenu();
        showEditorContextMenu(e.clientX, e.clientY);
      }
    });
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

  /* 插入内部链接（[[名称]]）或外部链接（[选中](url)）：带选区则用选区，否则用剪贴板/提示 */
  function mdExternalLink(ta, internal) {
    if (!ta) return;
    ta.focus();
    const s = ta.selectionStart, e = ta.selectionEnd;
    const sel = ta.value.slice(s, e);
    if (internal) {
      const label = sel || prompt('链接文字：') || '';
      const target = prompt('目标笔记名（不含 .md）：') || label;
      const next = '[[' + target + ']' + (label && label !== target ? '|' + label : '') + ']';
      replaceSel(ta, s, e, next);
      return;
    }
    const label = sel || prompt('链接文字：') || '链接';
    const url = prompt('URL：', 'https://') || '';
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
