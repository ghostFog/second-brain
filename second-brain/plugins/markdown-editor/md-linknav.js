/* ============================================
 * 第二脑 — Markdown Editor 插件·链接导航
 * 作者: 火 冰
 * 功能:
 *   - 编辑区内链接点击 → 判断目标是否本库笔记 → openNote 新开页签
 *   - 相对路径按链接所在笔记的路径解析（./ ../ 同目录 / 开头从库根）
 *   - 未命中的疑似 .md 链接 preventDefault 防 note:// 404 弹窗
 *   - 外链/资源协议放行
 *   - 同步支持 Vditor 三模式：WYSIWYG（<a href>）/ IR（[data-type=a] + .vditor-ir__marker--link）/ SV（textarea 源码解析）
 * 宿主配合点: PluginAPI.editor.openNote（打开笔记）/ listNotes（列笔记）/ getState（当前笔记路径）
 * ============================================ */
'use strict';

(function () {
  if (window.__sbMdLinkNavBound) return;
  window.__sbMdLinkNavBound = true;

  /** 以基准目录解析相对路径（./ ../ 同目录 sub/ 等），返回归一后的正斜杠相对路径。
   *  @param {string} baseDir 基准目录相对路径（如 '日记/2024年'，根目录为 ''）
   *  @param {string} rel 待解析的相对路径（如 './09-02.md'、'../08-31.md'、'sibling.md'）
   *  @returns {string} 归一后的路径（如 '日记/08-31.md'）
   *  作者: 火 冰 */
  function resolveRelPath(baseDir, rel) {
    var r = String(rel || '').replace(/^\.\//, '');
    var parts = baseDir ? String(baseDir).split('/').filter(Boolean) : [];
    var segs = r.split('/');
    for (var i = 0; i < segs.length; i++) {
      if (segs[i] === '..') parts.pop();
      else if (segs[i] === '.') continue;
      else if (segs[i]) parts.push(segs[i]);
    }
    return parts.join('/');
  }

  /** 按链接目标查找本库笔记路径：完整路径 → 相对路径解析（基准=链接所在笔记目录）→ 全局文件名兜底。
   *  含编码兼容：Vditor/Lute 预览面板可能对中文 href 进行 URL 编码（encodeURIComponent），
   *  需对 href 解码后匹配 + 用 encodeURIComponent(note.path) 反向匹配。
   *  @param {string} target 链接目标（wiki 名 / 相对路径 / 完整路径）
   *  @param {Array} notes 笔记列表（含 path/name）
   *  @param {string} currentPath 链接所在笔记的完整路径（用于解析相对路径）
   *  @returns {string|null} 命中笔记的完整路径，未命中返回 null
   *  作者: 火 冰 */
  function findNoteByLink(target, notes, currentPath) {
    var t = String(target || '').trim();
    if (!t) return null;
    /* 尝试解码（Vditor/Lute 预览面板可能对中文 href 进行 URL 编码） */
    var decoded = t;
    try { var d = decodeURIComponent(t); if (d !== t) decoded = d; } catch (_) {}
    /* 用原始 + 解码后的候选值都尝试匹配 */
    var candidates = [t];
    if (decoded !== t) candidates.push(decoded);
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var tn = c.replace(/\.md$/i, '');
      /* 1. 完整路径匹配 */
      var hit = notes.find(function (n) { return n.path === c; });
      if (hit) return hit.path;
      hit = notes.find(function (n) { return n.path === tn; });
      if (hit) return hit.path;
      /* 2. 相对路径解析（以链接所在笔记的路径为基准）：./ ../ sub/ 及同目录文件名；/ 开头视为从库根 */
      var isPath = c.indexOf('/') >= 0 || c.indexOf('\\') >= 0 || /^\.\.?[/\\]/.test(c);
      if (isPath && currentPath) {
        var slash = currentPath.lastIndexOf('/');
        var cwd = slash >= 0 ? currentPath.slice(0, slash) : '';
        var clean = c.replace(/^[/\\]+/, '');
        var resolved = /^[/\\]/.test(c) ? clean : resolveRelPath(cwd, clean);
        if (resolved && resolved !== c) {
          hit = notes.find(function (n) { return n.path === resolved; });
          if (hit) return hit.path;
          hit = notes.find(function (n) { return n.path === resolved + '.md'; });
          if (hit) return hit.path;
        }
      }
      /* 3. 全局文件名匹配（wiki 链接 [[笔记名]] 兜底） */
      hit = notes.find(function (n) { return (n.name || '').replace(/\.md$/i, '') === tn; });
      if (hit) return hit.path;
      hit = notes.find(function (n) { return n.name === c || n.name === tn + '.md'; });
      if (hit) return hit.path;
    }
    /* 4. 反向编码匹配：用 encodeURIComponent(note.path/name) 匹配 target（覆盖非标准编码） */
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i];
      try {
        if (encodeURIComponent(n.path) === t) return n.path;
        if (encodeURIComponent(n.name || '') === t) return n.path;
        if (encodeURIComponent((n.name || '').replace(/\.md$/i, '')) === tn) return n.path;
      } catch (_) {}
    }
    return null;
  }

  /* 笔记列表缓存（异步预加载 + openNote 后刷新） */
  var notesCache = [];
  function refreshNotes() {
    var api = (typeof PluginAPI !== 'undefined' && PluginAPI && PluginAPI.editor) ? PluginAPI.editor : null;
    if (api && api.listNotes) {
      api.listNotes().then(function (list) { notesCache = list || []; }).catch(function () { /* 列表刷新失败不阻塞 */ });
    }
  }
  refreshNotes(); /* 预加载 */

  /** 从源码文本的指定位置解析出所在的链接（[text](url) 或 [[wiki]]）。
   *  @param {string} text 源码全文
   *  @param {number} pos 光标位置（selectionStart）
   *  @returns {{url:string,wiki:boolean}|null} 命中返回 {url, wiki}，未命中返回 null
   *  作者: 火 冰 */
  function parseLinkAtPos(text, pos) {
    if (!text || pos < 0 || pos > text.length) return null;
    /* [[wiki]] 链接 */
    var wikiRe = /\[\[([^\]]+)\]\]/g;
    var m;
    while ((m = wikiRe.exec(text)) !== null) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        return { url: m[1].trim(), wiki: true };
      }
    }
    /* [text](url) 链接 */
    var linkRe = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    while ((m = linkRe.exec(text)) !== null) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        return { url: m[2].trim(), wiki: false };
      }
    }
    return null;
  }

  /** 统一处理链接点击：命中本库笔记 → openNote 新开页签；未命中疑似 .md → preventDefault 防 404；外链放行。
   *  @param {string} href 链接目标 URL
   *  @param {string} wiki wiki 链接名（非空表示 wiki 链接）
   *  @param {string} currentPath 链接所在笔记的完整路径
   *  @param {Array} notes 笔记列表
   *  @param {object} api PluginAPI.editor
   *  @param {Event} e 点击事件
   *  @returns {boolean} 是否已处理（true 表示已拦截/放行，调用方不再继续）
   *  作者: 火 冰 */
  function handleLink(href, wiki, currentPath, notes, api, e) {
    console.log('[md-linknav] handleLink: href="' + href + '", wiki="' + wiki + '", currentPath="' + currentPath + '", notes=' + (notes ? notes.length : 'null'));
    /* 缓存未就绪：阻止默认导航（防 404）并触发加载，下次点击生效 */
    if (!notes || !notes.length) { console.log('[md-linknav] notesCache empty, refreshNotes'); e.preventDefault(); refreshNotes(); return true; }
    if (wiki) {
      var hw = findNoteByLink(wiki, notes, currentPath);
      console.log('[md-linknav] wiki findNoteByLink: ' + (hw || 'null'));
      if (hw) { e.preventDefault(); e.stopPropagation(); api.openNote(hw); refreshNotes(); }
      return true;
    }
    if (!href || href === '#' || href.charAt(0) === '#') return false;
    /* 外链 http/https：用系统默认浏览器打开（主进程 shell.openExternal） */
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault(); e.stopPropagation();
      var nd = window.noteDesktop || {};
      if (nd.openExternal) nd.openExternal(href);
      return true;
    }
    /* 排除其他资源协议（note:/mailto:/tel:/ftp:/file:/data:）放行 */
    if (/^(note:|mailto:|tel:|ftp:|file:|javascript:|data:)/i.test(href)) return false;
    var hit = findNoteByLink(href, notes, currentPath);
    console.log('[md-linknav] findNoteByLink: ' + (hit || 'null'));
    if (hit) { e.preventDefault(); e.stopPropagation(); api.openNote(hit); refreshNotes(); return true; }
    /* 未命中但疑似内部 .md 链接：阻止默认导航，避免 note:// 404 弹窗 */
    if (/\.md$/i.test(href) || href.indexOf('.') === -1) { e.preventDefault(); return true; }
    return false;
  }

  /* 编辑区内链接点击（document 捕获阶段，先于 vditor 内部 handler）：
   *  同步支持 Vditor 三模式——
   *    WYSIWYG/预览：<a href> 标准链接元素
   *    IR：<span data-type="a"> 内含 .vditor-ir__marker--link（URL 在 textContent）
   *    SV：<textarea class="vditor-sv"> 源码模式，从 selectionStart 解析链接
   *  作者: 火 冰 */
  document.addEventListener('click', function (e) {
    if (!e.target || !e.target.closest) return;
    if (!e.target.closest('#ed-vditor')) return;
    var api = (typeof PluginAPI !== 'undefined' && PluginAPI && PluginAPI.editor) ? PluginAPI.editor : null;
    if (!api) return;
    var state = (api.getState && api.getState()) || {};
    var currentPath = state.current || '';
    var notes = notesCache;

    console.log('[md-linknav] click: tag=' + e.target.tagName + ', class=' + (e.target.className || '').slice(0, 60));

    /* 1. WYSIWYG / 预览模式：<a href> 标准链接 */
    var a = e.target.closest('a[href]');
    if (a) {
      console.log('[md-linknav] mode=<a>, href="' + a.getAttribute('href') + '"');
      handleLink(a.getAttribute('href') || '', a.dataset.wikilink || '', currentPath, notes, api, e);
      return;
    }

    /* 2. IR 模式：<span data-type="a"> 内含 .vditor-ir__marker--link */
    var irLink = e.target.closest('[data-type="a"]');
    if (irLink) {
      /* 展开编辑状态（vditor-ir__node--expand）不触发导航，让用户正常编辑链接 */
      if (irLink.classList.contains('vditor-ir__node--expand')) { console.log('[md-linknav] IR expand state, skip'); return; }
      var marker = irLink.querySelector('.vditor-ir__marker--link');
      if (marker) {
        console.log('[md-linknav] mode=IR, url="' + marker.textContent.trim() + '"');
        handleLink(marker.textContent.trim(), '', currentPath, notes, api, e);
        return;
      }
    }

    /* 3. SV 模式：<textarea class="vditor-sv"> 源码模式，从光标位置解析链接
     *    用 closest('.vditor-sv') 放宽检测（覆盖 textarea 子元素/叠加层点击）；
     *    setTimeout(0) 确保 selectionStart 已更新到点击位置（Chromium 中 click 时通常已更新，但保险起见异步读取）。
     *    作者: 火 冰 */
    var svTa = e.target.closest('.vditor-sv');
    if (svTa && svTa.tagName === 'TEXTAREA') {
      console.log('[md-linknav] mode=SV textarea');
      var ta = svTa;
      var apiRef = api;
      var cp = currentPath;
      setTimeout(function () {
        var pos = ta.selectionStart;
        var text = ta.value || '';
        var link = parseLinkAtPos(text, pos);
        console.log('[md-linknav] SV: pos=' + pos + ', textLen=' + text.length + ', link=' + (link ? link.url : 'null'));
        if (link) {
          var sn = notesCache;
          if (!sn || !sn.length) { refreshNotes(); return; }
          var hit = findNoteByLink(link.url, sn, cp);
          console.log('[md-linknav] SV findNoteByLink: ' + (hit || 'null') + ', notes=' + sn.length);
          if (hit) { apiRef.openNote(hit); refreshNotes(); }
        }
      }, 0);
      return;
    }
  }, true);

  /* 暴露给宿主/测试（与 md-serialize/blocks/context 同构） */
  window.sbMdBridge = window.sbMdBridge || {};
  window.sbMdBridge.linknav = { resolveRelPath: resolveRelPath, findNoteByLink: findNoteByLink, parseLinkAtPos: parseLinkAtPos };
})();