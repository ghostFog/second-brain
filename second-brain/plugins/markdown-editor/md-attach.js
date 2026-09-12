/* ============================================
 * 第二脑 — Markdown Editor 插件·附件块模块
 * 作者: 火 冰
 * 功能: 把 `> [!attach] 名称 url` 引言块渲染为非编辑附件卡片（整体插入/删除，
 *       不可编辑内部内容），类似 Vditor table 的块级处理。
 * 原理: 保持 blockquote 原始 DOM 内容不变（供 Vditor IR 序列化 VditorIRDOM2Md 使用），
 *       用 CSS 隐藏原文、叠加非编辑卡片 UI（contenteditable=false），
 *       拦截键盘事件防止编辑内部，Backspace 在块边界删除整块。
 * ============================================ */
'use strict';

(function () {
  /* ---------- 常量 ---------- */
  var ATTACH_CLASS = 'sb-attach-block';
  var CARD_CLASS = 'sb-attach-card';
  var HIDDEN_CLASS = 'sb-attach-orig-hidden';
  var DEBOUNCE_MS = 120;

  /* ---------- 状态 ---------- */
  var observer = null;
  var debounceTimer = null;

  /* ---------- 工具函数 ---------- */

  /* HTML 转义 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 判断节点是否为附件 callout（`> [!attach]`） */
  function isAttachCallout(node) {
    if (!node) return false;
    var p = node.querySelector('p');
    var t = p ? p.textContent : '';
    if (!t.trim()) t = node.textContent;
    return /^\s*\[!attach\]/.test(t || '');
  }

  /* 从 blockquote 文本内容解析出 name 和 url
   *  格式: [!attach] 真实名 note://vault_res/uuid.ext
   *  注意：此函数在卡片增强前调用（无卡片 UI 文本干扰），直接用 textContent 即可
   *  @returns {{name:string, url:string}|null} */
  function parseAttachContent(bq) {
    var text = String(bq.textContent || '').trim();
    if (text.indexOf('[!attach]') !== 0) return null;
    var body = text.slice('[!attach]'.length).trim();
    if (!body) return null;
    var sp = body.lastIndexOf(' ');
    var url = body.slice(sp + 1).trim();
    var name = (sp > 0 ? body.slice(0, sp) : url).trim() || url;
    if (!/^note:\/\/vault_res\/[^?#]+$/.test(url)) return null;
    return { name: name, url: url };
  }

  /* 获取编辑区根元素（IR 或 WYSIWYG） */
  function getEditorRoot() {
    if (typeof window.vdInst === 'undefined' || !window.vdInst) {
      /* 尝试通过 vditor 实例获取 */
      var el = document.querySelector('.vditor-ir') || document.querySelector('.vditor-wysiwyg');
      return el || null;
    }
    return null;
  }

  /* 查找所有编辑区中的附件 blockquote */
  function findAllAttachBlocks() {
    var roots = [];
    var irEl = document.querySelector('.vditor-ir');
    var wysEl = document.querySelector('.vditor-wysiwyg');
    if (irEl) roots.push(irEl);
    if (wysEl) roots.push(wysEl);
    var blocks = [];
    for (var i = 0; i < roots.length; i++) {
      var bqs = roots[i].querySelectorAll('blockquote, [data-type="blockquote"]');
      for (var j = 0; j < bqs.length; j++) {
        if (isAttachCallout(bqs[j]) && parseAttachContent(bqs[j])) {
          blocks.push(bqs[j]);
        }
      }
    }
    return blocks;
  }

  /* ---------- 卡片渲染 ---------- */

  /* 把单个附件 blockquote 增强为非编辑卡片
   * 不修改 blockquote 的原始内容（供序列化），仅:
   * 1. 添加 class 标记
   * 2. 隐藏原始 <p> 内容
   * 3. 插入非编辑卡片 UI */
  function enhanceBlock(bq) {
    if (bq.classList.contains(ATTACH_CLASS)) return; /* 已增强 */
    var info = parseAttachContent(bq);
    if (!info) return;

    bq.classList.add(ATTACH_CLASS);

    /* 隐藏原始内容（不删除，保留供序列化） */
    var children = bq.children;
    for (var i = 0; i < children.length; i++) {
      if (children[i].classList && children[i].classList.contains(CARD_CLASS)) continue;
      children[i].classList.add(HIDDEN_CLASS);
    }

    /* 创建卡片 UI */
    var card = document.createElement('div');
    card.className = CARD_CLASS;
    card.setAttribute('contenteditable', 'false');
    card.setAttribute('data-sb-res-url', esc(info.url));
    card.setAttribute('data-sb-res-name', esc(info.name));

    /* 扩展名徽标 */
    var m = String(info.url).match(/\.([0-9a-z]+)(?:$|[?#])/i);
    var label = (m ? m[1] : 'file').toUpperCase().slice(0, 8);

    card.innerHTML =
      '<span class="sb-attach-card-icon" data-lucide="file-text"></span>'
      + '<div class="sb-attach-card-info">'
      + '<span class="sb-attach-card-name">' + esc(info.name) + '</span>'
      + '<span class="sb-attach-card-meta">' + esc(label) + '</span>'
      + '</div>'
      + '<button type="button" class="sb-attach-card-delete" title="删除附件" data-lucide="trash-2"></button>';

    bq.appendChild(card);

    /* 刷新图标 */
    if (typeof window.refreshIcons === 'function') {
      try { window.refreshIcons(); } catch (_) { /* 忽略 */ }
    }
  }

  /* 移除卡片增强（恢复原始 blockquote） */
  function restoreBlock(bq) {
    if (!bq.classList.contains(ATTACH_CLASS)) return;
    bq.classList.remove(ATTACH_CLASS);
    var card = bq.querySelector('.' + CARD_CLASS);
    if (card) card.remove();
    var hidden = bq.querySelectorAll('.' + HIDDEN_CLASS);
    for (var i = 0; i < hidden.length; i++) {
      hidden[i].classList.remove(HIDDEN_CLASS);
    }
  }

  /* 增强所有附件块 */
  function enhanceAll() {
    var blocks = findAllAttachBlocks();
    for (var i = 0; i < blocks.length; i++) {
      enhanceBlock(blocks[i]);
    }
  }

  /* ---------- 删除处理 ---------- */

  /* 删除附件块并同步 markdown + 删除物理文件
   *  @param {HTMLElement} bq 附件 blockquote 元素
   *  @author 火 冰 */
  function deleteAttachBlock(bq) {
    if (!bq) return;
    var root = bq.parentNode;
    if (!root) return;

    /* 删除前先获取资源 URL：优先从卡片 data-sb-res-url 取，回退到 parseAttachContent */
    var resUrl = '';
    var card = bq.querySelector('.' + CARD_CLASS);
    if (card) {
      resUrl = card.getAttribute('data-sb-res-url') || '';
    }
    if (!resUrl) {
      /* 回退：临时移除卡片后解析原始 blockquote 文本 */
      var info = parseAttachContent(bq);
      resUrl = info ? info.url : '';
    }

    /* 在 blockquote 后插入一个空段落（便于继续编辑） */
    var nextP = document.createElement('p');
    nextP.setAttribute('data-block', '0');
    nextP.innerHTML = '\u200b'; /* ZWSP */

    /* 删除 blockquote */
    bq.remove();

    /* 插入空段落并定位光标 */
    root.appendChild(nextP);
    try {
      var range = document.createRange();
      range.setStart(nextP, 0);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    } catch (_) { /* 忽略 */ }

    /* 触发 input 事件同步到 markdown */
    var editor = document.querySelector('.vditor-ir') || document.querySelector('.vditor-wysiwyg');
    if (editor) {
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }

    /* 删除 .resources 中的物理文件 */
    if (resUrl && window.noteDesktop && typeof window.noteDesktop.deleteResource === 'function') {
      try { window.noteDesktop.deleteResource(resUrl); } catch (_) { /* 忽略 */ }
    }
  }

  /* ---------- 键盘事件拦截 ---------- */

  /* 拦截附件块内的键盘事件：
   * - Backspace 在块边界 → 删除整块
   * - 方向键 → 跳过块
   * - 其他键 → 阻止编辑 */
  function onKeydown(e) {
    var bq = e.target && e.target.closest ? e.target.closest('.' + ATTACH_CLASS) : null;
    if (!bq) return;

    /* Backspace: 如果光标在块开头，删除整块 */
    if (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      var range = window.getSelection().getRangeAt(0);
      if (range.collapsed) {
        /* 检查光标是否在块开头 */
        var blockRect = bq.getBoundingClientRect();
        var rangeRect = range.getBoundingClientRect();
        if (!rangeRect.width || rangeRect.top <= blockRect.top + 2) {
          e.preventDefault();
          e.stopPropagation();
          deleteAttachBlock(bq);
          return;
        }
      }
      /* 块内 Backspace 也删除整块 */
      e.preventDefault();
      e.stopPropagation();
      deleteAttachBlock(bq);
      return;
    }

    /* Delete: 删除整块 */
    if (e.key === 'Delete' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      deleteAttachBlock(bq);
      return;
    }

    /* 方向键: 让 Vditor 默认处理（导航出块） */
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      return; /* 不拦截，让 Vditor 处理导航 */
    }

    /* Enter: 在块后插入新行 */
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      var root = bq.parentNode;
      var p = document.createElement('p');
      p.setAttribute('data-block', '0');
      p.innerHTML = '\u200b';
      bq.insertAdjacentElement('afterend', p);
      try {
        var r2 = document.createRange();
        r2.setStart(p, 0);
        r2.collapse(true);
        var s2 = window.getSelection();
        s2.removeAllRanges();
        s2.addRange(r2);
      } catch (_) { /* 忽略 */ }
      return;
    }

    /* 其他键: 阻止编辑 */
    if (e.key.length === 1 || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /* ---------- 右键菜单 ---------- */

  /* 附件块右键菜单 */
  function onContextmenu(e) {
    var bq = e.target && e.target.closest ? e.target.closest('.' + ATTACH_CLASS) : null;
    if (!bq) return;

    var info = parseAttachContent(bq);
    if (!info) return;

    e.preventDefault();
    e.stopPropagation();

    var menu = document.createElement('div');
    menu.className = 'sb-attach-menu';
    menu.style.cssText = 'position:fixed;z-index:200;min-width:160px;'
      + 'background:var(--note-surface-2,#fff);border:1px solid var(--note-border,#e0e0e0);'
      + 'border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:4px 0;';

    /* 打开附件 */
    var openItem = document.createElement('button');
    openItem.type = 'button';
    openItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
      + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
      + 'font-size:13px;text-align:left;cursor:pointer;';
    openItem.innerHTML = '<i data-lucide="external-link" class="w-4 h-4"></i><span>打开</span>';
    openItem.addEventListener('click', function () {
      if (window.noteDesktop && typeof window.noteDesktop.openResource === 'function') {
        var stored = String(info.url).match(/^note:\/\/vault_res\/([^?#]+)/);
        if (stored) {
          try { window.noteDesktop.openResource(stored[1]); } catch (_) { /* 忽略 */ }
        }
      }
      menu.remove();
    });

    /* 下载附件 */
    var dlItem = document.createElement('button');
    dlItem.type = 'button';
    dlItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
      + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
      + 'font-size:13px;text-align:left;cursor:pointer;';
    dlItem.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i><span>下载</span>';
    dlItem.addEventListener('click', function () {
      if (typeof downloadResource === 'function') {
        downloadResource(info.url, info.name);
      }
      menu.remove();
    });

    /* 删除附件 */
    var delItem = document.createElement('button');
    delItem.type = 'button';
    delItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
      + 'padding:6px 12px;border:none;background:transparent;color:var(--note-danger,#dc2626);'
      + 'font-size:13px;text-align:left;cursor:pointer;';
    delItem.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>删除</span>';
    delItem.addEventListener('click', function () {
      deleteAttachBlock(bq);
      menu.remove();
    });

    menu.appendChild(openItem);
    menu.appendChild(dlItem);
    menu.appendChild(delItem);
    document.body.appendChild(menu);

    if (typeof window.refreshIcons === 'function') {
      try { window.refreshIcons(); } catch (_) { /* 忽略 */ }
    }

    var rect = menu.getBoundingClientRect();
    menu.style.left = Math.min(Math.max(8, e.clientX), Math.max(8, window.innerWidth - rect.width)) + 'px';
    menu.style.top = Math.min(Math.max(8, e.clientY), Math.max(8, window.innerHeight - rect.height)) + 'px';

    var closeMenu = function () {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(function () {
      document.addEventListener('click', closeMenu);
    }, 0);
  }

  /* ---------- 卡片内点击事件 ---------- */

  /* 卡片内按钮点击 */
  function onCardClick(e) {
    var deleteBtn = e.target && e.target.closest ? e.target.closest('.sb-attach-card-delete') : null;
    if (deleteBtn) {
      var bq = deleteBtn.closest('.' + ATTACH_CLASS);
      if (bq) {
        e.preventDefault();
        e.stopPropagation();
        deleteAttachBlock(bq);
      }
      return;
    }

    /* 点击卡片主体 → 打开附件 */
    var card = e.target && e.target.closest ? e.target.closest('.' + CARD_CLASS) : null;
    if (card) {
      var url = card.getAttribute('data-sb-res-url');
      if (url && window.noteDesktop && typeof window.noteDesktop.openResource === 'function') {
        var stored = String(url).match(/^note:\/\/vault_res\/([^?#]+)/);
        if (stored) {
          e.preventDefault();
          e.stopPropagation();
          try { window.noteDesktop.openResource(stored[1]); } catch (_) { /* 忽略 */ }
        }
      }
    }
  }

  /* ---------- 防抖增强 ---------- */

  /* 防抖执行 enhanceAll */
  function scheduleEnhance() {
    if (debounceTimer) return;
    debounceTimer = setTimeout(function () {
      debounceTimer = null;
      enhanceAll();
    }, DEBOUNCE_MS);
  }

  /* ---------- 初始化 ---------- */

  function init() {
    /* 监听键盘事件（捕获阶段，优先于 Vditor） */
    document.addEventListener('keydown', onKeydown, true);

    /* 监听右键菜单 */
    document.addEventListener('contextmenu', onContextmenu, true);

    /* 监听卡片点击 */
    document.addEventListener('click', onCardClick, true);

    /* MutationObserver: 监听编辑区变化，防抖增强 */
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(function () { scheduleEnhance(); });
      var root = document.documentElement || document.body;
      if (root) {
        try {
          observer.observe(root, { childList: true, subtree: true });
        } catch (_) { /* 忽略 */ }
      }
    }

    /* 初始增强 */
    scheduleEnhance();

    /* 定期增强（兜底，防止 MutationObserver 遗漏） */
    setInterval(function () { enhanceAll(); }, 2000);
  }

  /* ---------- 暴露 API ---------- */

  var api = {
    enhanceAll: enhanceAll,
    enhanceBlock: enhanceBlock,
    restoreBlock: restoreBlock,
    deleteAttachBlock: deleteAttachBlock,
    parseAttachContent: parseAttachContent,
    isAttachCallout: isAttachCallout,
  };

  window.sbMdAttach = api;
  window.sbMdBridge = window.sbMdBridge || {};
  window.sbMdBridge.attach = api;

  /* 自动初始化 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();