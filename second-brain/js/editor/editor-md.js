/* ============================================
 * 第二脑 — 编辑器 markdown 专属功能（阶段2暂存）
 * 作者: 火 冰
 * 功能: Markdown 往返序列化（DOM↔Md）、所见即所得块编辑、代码块语言选择器。
 *       本文件为阶段2在宿主内暂存 md 专属功能，后续阶段 4/5 将迁入 markdown-editor 插件。
 * ============================================ */

'use strict';

  /* 所见即所得编辑区的行内节点逆转换：把渲染后的内联 DOM 转回 Markdown 行内语法
   * 支持：加粗/**、行内代码、[[内链]]、[链接](url)、斜体*
   * 作者: 火 冰 */
  function inlineToMd(el) {
    let md = '';
    el.childNodes.forEach(function (node) {
      if (node.nodeType === 3) { md += node.nodeValue; return; }  // 文本节点原样
      if (node.nodeType !== 1) return;
      const t = node.nodeName.toLowerCase();
      const inner = inlineToMd(node);
      if (t === 'strong' || t === 'b') { if (inner) md += '**' + inner + '**'; }
      else if (t === 'em' || t === 'i') { if (inner) md += '*' + inner + '*'; }
      else if (t === 'code') { md += '`' + inner + '`'; }
      else if (t === 'a') {
        const href = node.getAttribute && node.getAttribute('href');
        const wiki = node.dataset && node.dataset.wikilink;
        if (wiki) md += '[[' + inner + ']]';
        else if (href && href !== '#') md += '[' + inner + '](' + href + ')';
        else md += inner;
      }
      else if (node.classList && node.classList.contains('sb-math') && node.getAttribute && node.getAttribute('data-math')) {
        md += '$' + inner + '$';  // 数学内联块 → $…$（与 inline() 往返一致）
      }
      else if (t === 'font' || t === 'u' || (t === 'span' && node.hasAttribute && node.hasAttribute('style'))) {
        md += node.outerHTML;  // HTML 透传：字体/字号/颜色/背景色/下划线原样保留，保证往返稳定
      }
      else if (t === 'input') { md += node.checked ? '[x]' : '[ ]'; }
      else if (t === 'br') { md += '\n'; }
      else { md += inner; }
    });
    return md;
  }

  /* 所见即所得编辑区 → Markdown：遍历渲染后的整块 DOM，还原为 Markdown 源文本
   * 与 renderMarkdown 输出的结构一一对应，保证来回转换一致
   * 作者: 火 冰 */
  function domToMd(root) {
    const lines = [];
    (root.childNodes || []).forEach(function (node) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('code-lang')) return; // 语言标签仅供显示，不入 markdown
      if (node.nodeType === 3) { const t = node.nodeValue; if (t && t.trim()) lines.push(t); else lines.push(''); return; }
      if (node.nodeType !== 1) return;
      const tg = node.nodeName.toLowerCase();
      if (/^h[1-3]$/.test(tg)) { lines.push('#'.repeat(+tg[1]) + ' ' + inlineToMd(node)); return; }
      if (tg === 'pre') {
        const l = node.getAttribute && node.getAttribute('data-lang') || '';
        lines.push('```' + (l || ''));
        lines.push((node.textContent || '').replace(/\n$/, ''));
        lines.push('```'); return;
      }
      if (tg === 'blockquote') {
        const inner = node.querySelector('p, div, span');
        lines.push('> ' + (inner ? inlineToMd(inner) : inlineToMd(node)));
        return;
      }
      if (tg === 'li' || /div|p|span/.test(tg)) {
        // 待办：lucide 的 square/check-square 图标 + 文本
        const icon = node.querySelector && node.querySelector('i[data-lucide="square"], i[data-lucide="check-square"]');
        if (icon) {
          const done = icon.dataset && icon.dataset.lucide === 'check-square';
          const body = node.querySelector('span');
          lines.push('- [' + (done ? 'x' : ' ') + '] ' + ((body && body !== icon) ? inlineToMd(body) : inlineToMd(node)));
          return;
        }
        // 无序 / 有序列表：圆点 span 或 “•” 文本 + 内容 span
        const dot = node.querySelector && node.querySelector('span.w-1');
        if (dot) {
          const body = node.querySelector('span:not(.w-1):not(.text-caption)') || node;
          lines.push('- ' + inlineToMd(body));
          return;
        }
        const marker = node.textContent && node.textContent.trim().charAt(0) === '•';
        if (marker) {
          const body = node.querySelector('span:not(.text-caption)') || node;
          lines.push('1. ' + inlineToMd(body));  // 有序列表序号因渲染丢失，用 1. 兜底
          return;
        }
        lines.push(inlineToMd(node));
        return;
      }
      if (tg === 'hr') { lines.push('---'); return; }
      if (tg === 'table') {
        const rows = node.querySelectorAll('tr');
        Array.prototype.forEach.call(rows, function (tr, ri) {
          const cells = tr.querySelectorAll('th, td');
          // Markdown 管道表格单元格不能含换行：空占位 <br> 会序列化为 '\n'，需去掉（连同两端空白）
          const vals = Array.prototype.map.call(cells, function (c) { return inlineToMd(c).replace(/\n+/g, ' ').trim(); });
          if (vals.length) lines.push('| ' + vals.join(' | ') + ' |');
          if (ri === 0 && rows.length > 1) lines.push('| ' + vals.map(function () { return '---'; }).join(' | ') + ' |'); // 表头后补分隔行
        });
        return;
      }
      lines.push(inlineToMd(node));
    });
    // 合并尾随空行，还原原始换行（每段一行）
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const raw = lines.join('\n');
    return raw.replace(/\n{3,}/g, '\n\n');
  }

  /* 备注：所见即所得块编辑的顶层块选择器（代码块/引用/表格/分隔线）。 */
  function wysBlockTags() { return 'PRE, BLOCKQUOTE, TABLE, HR'; }

  /* 清除当前选中的块（若存在），恢复其可编辑性 */
  function clearWysBlock() {
    if (edBlockSel) { edBlockSel.classList.remove('sb-block-selected'); edBlockSel.removeAttribute('contenteditable'); edBlockSel = null; }
    hideCodeLangPicker();   // 取消选中同时收起代码块语言选择器
  }

  /* 定位代码块语言选择器到指定 <pre> 的右下角（fixed 定位，避免被 pre 横向滚动裁剪）
   * @param {HTMLPreElement} pre 目标代码块
   * 作者: 火 冰 */
  function anchorCodeLangPicker(pre) {
    if (!mdeCodeEl || !pre) return;
    const r = pre.getBoundingClientRect();
    mdeCodeEl.style.left = '0px';
    mdeCodeEl.style.top = '0px';
    const chipEl = mdeCodeEl.querySelector('.mde-lang-chip');
    const w = (chipEl && chipEl.offsetWidth) || mdeCodeEl.offsetWidth || 90;  // 只用 chip 宽，忽略下拉伸缩，位置不漂移
    const h = (chipEl && chipEl.offsetHeight) || mdeCodeEl.offsetHeight || 28; // 只用 chip 高，避免下拉伸缩影响 top
    if (r.bottom + h + 8 > window.innerHeight - 8) {
      // 空间不足时翻转到块下方内侧
      const x = Math.min(r.right + 4, window.innerWidth - w - 8);
      mdeCodeEl.style.left = Math.max(8, x) + 'px';
      mdeCodeEl.style.top = Math.max(8, r.top - h - 6) + 'px';
    } else {
      const x = r.right - w - 4;
      if (x < 8) { // 空间过窄则贴块右下角
        mdeCodeEl.style.left = Math.max(8, r.left + 8) + 'px';
        mdeCodeEl.style.top = Math.max(8, r.bottom + 6) + 'px';
      } else {
        mdeCodeEl.style.left = x + 'px';
        mdeCodeEl.style.top = Math.max(8, r.bottom + 6) + 'px';
      }
    }
  }

  /* 按关键词过滤常用语言，返回按命中分数排序的语言列表
   * @param {string} kw 搜索关键词
   * 作者: 火 冰 */
  function filterCodeLangs(kw) {
    const q = String(kw || '').trim().toLowerCase();
    if (!q) return CODE_LANGS.slice();
    const hit = function (lang) {
      let score = -1;
      if (lang.name === q) score = 4;
      else if (lang.name.toLowerCase() === q) score = 3;
      else if (lang.name.toLowerCase().indexOf(q) === 0) score = 2;
      else if (lang.name.toLowerCase().indexOf(q) !== -1) score = 1;
      if (score < 1) {
        const al = lang.aliases.find(function (a) { return a.toLowerCase() === q; });
        if (al) score = 2;
        else if (lang.aliases.some(function (a) { return a.toLowerCase().indexOf(q) !== -1; })) score = 1;
      }
      return score;
    };
    return CODE_LANGS.map(function (l) { return { lang: l, s: hit(l) }; })
      .filter(function (it) { return it.s >= 1; })
      .sort(function (a, b) { return b.s - a.s || a.lang.name.localeCompare(b.lang.name); })
      .map(function (it) { return it.lang; });
  }

  /* 重新渲染语言下拉列表（按当前关键词） */
  function renderCodeLangList() {
    if (!mdeCodeEl) return;
    const list = mdeCodeEl.querySelector('.mde-lang-list');
    const search = mdeCodeEl.querySelector('.mde-lang-search');
    const q = (search && search.value) || '';
    const langs = filterCodeLangs(q);
    list.innerHTML = langs.map(function (l) {
      return '<div class="mde-lang-opt' + (l.name === (mdeCodePre && mdeCodePre.getAttribute('data-lang')) ? ' is-active' : '') + '" data-lang="' + esc(l.name) + '">'
        + '<i data-lucide="' + (l.name === (mdeCodePre && mdeCodePre.getAttribute('data-lang')) ? 'check' : 'code-2') + '" class="w-3.5 h-3.5 shrink-0"></i>'
        + '<span class="flex-1 truncate" style="text-align:left;">' + esc(l.name) + '</span></div>';
    }).join('') || '<div class="mde-lang-empty">无匹配语言</div>';
    if (typeof window.refreshIcons === 'function') window.refreshIcons();
  }

  /* 应用选中的语言到当前代码块并同步 markdown（data-lang + input 派发）。
   * 语言仅写入 <pre data-lang>，不再创建可见的 .code-lang 幽灵标签（渲染已移除）。 */
  function applyCodeLang(name) {
    if (!mdeCodePre) return;
    const pre = mdeCodePre;
    const val = String(name || '').trim();
    pre.setAttribute('data-lang', val);
    // 清理历史残留的 code-lang 兄弟标签（兼容旧渲染产物），语言以 data-lang 为准
    const old = pre.previousElementSibling;
    if (old && old.classList && old.classList.contains('code-lang')) old.remove();
    const label = mdeCodeEl.querySelector('.mde-lang-chip span');
    if (label) label.textContent = val || 'text';
    renderCodeLangList();
    const chip = mdeCodeEl.querySelector('.mde-lang-drop');
    if (chip) chip.hidden = true;
    const wys = document.getElementById('ed-wysiwyg');
    if (wys) wys.dispatchEvent(new Event('input', { bubbles: true })); // 触发 domToMd 还原 markdown
  }

  /* 构建代码块语言选择器（chip + 下拉搜索），仅创建一次、复用隐藏
   * 作者: 火 冰 */
  function ensureCodeLangPicker() {
    if (mdeCodeEl) return mdeCodeEl;
    const el = document.createElement('div');
    el.className = 'mde-code-lang';
    el.innerHTML =
      '<button class="mde-lang-chip" title="切换语言">'
      + '<i data-lucide="code-2" class="w-3.5 h-3.5"></i>'
      + '<span class="mde-lang-text"></span>'
      + '<i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>'
      + '<div class="mde-lang-drop" hidden>'
      + '<div class="mde-lang-search-wrap"><i data-lucide="search" class="w-3.5 h-3.5 shrink-0"></i>'
      + '<input class="mde-lang-search" placeholder="筛选语言…"></div>'
      + '<div class="mde-lang-list"></div></div>';
    document.body.appendChild(el);
    window.getComputedStyle(el); // 强制布局，确保 offsetWidth 可用
    const chip = el.querySelector('.mde-lang-chip');
    const search = el.querySelector('.mde-lang-search');
    const drop = el.querySelector('.mde-lang-drop');
    chip.addEventListener('click', function (e) {
      e.stopPropagation();
      const wasOpen = !drop.hidden;
      drop.hidden = !drop.hidden;
      if (!drop.hidden) { renderCodeLangList(); search.value = ''; search.focus(); }
      // 打开/关闭下拉后都重新锚定：容器宽度随下拉显隐变化（chip ~80px ↔ chip+drop 210px），
      // 不重算 left 会导致关闭后 chip 视觉上左移（打开时按 210px 算的 left）
      anchorCodeLangPicker(mdeCodePre);
    });
    search.addEventListener('input', function () { renderCodeLangList(); });
    search.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { drop.hidden = true; chip.focus(); anchorCodeLangPicker(mdeCodePre); }
    });
    drop.addEventListener('click', function (e) {
      e.stopPropagation();
      const opt = e.target.closest('.mde-lang-opt');
      if (opt) applyCodeLang(opt.dataset.lang);
    });
    el.addEventListener('mousedown', function (e) { e.stopPropagation(); }); // 防止触发 wys 取消选中
    // 滚动时保持吸附到代码块右下角；点击选择器外时收起下拉
    const reanchor = function () { if (mdeCodeEl && !mdeCodeEl.hidden && mdeCodePre) anchorCodeLangPicker(mdeCodePre); };
    document.addEventListener('scroll', reanchor, true);
    document.addEventListener('mousedown', function (e) {
      if (!mdeCodeEl || mdeCodeEl.hidden) return;
      if (e.target.closest && e.target.closest('.mde-code-lang')) return;
      const drop = mdeCodeEl.querySelector('.mde-lang-drop');
      if (drop) { drop.hidden = true; anchorCodeLangPicker(mdeCodePre); } // 关闭后重锚，防止 chip 左移
    });
    mdeCodeEl = el;
    return el;
  }

  /* 显示代码块语言选择器（选中某代码块时调用）；非代码块则隐藏 */
  function showCodeLangPicker(pre) {
    if (!pre || pre.nodeName !== 'PRE') { hideCodeLangPicker(); return; }
    const el = ensureCodeLangPicker();
    mdeCodePre = pre;
    el.hidden = false;
    const label = el.querySelector('.mde-lang-text');
    const cur = (pre.getAttribute('data-lang') || '').trim();
    label.textContent = cur || 'text';
    renderCodeLangList();
    anchorCodeLangPicker(pre);
  }

  /* 隐藏代码块语言选择器并清空当前代码块引用 */
  function hideCodeLangPicker() {
    mdeCodePre = null;
    if (mdeCodeEl) mdeCodeEl.hidden = true;
  }

  /* 单击命中①顶层特殊块时整块选中（高亮、禁用块内光标编辑），②否则清除选中。
   * @param {Element} blk 命中的顶层块元素（可能为空）
   * 作者: 火 冰 */
  function selectWysBlock(blk) {
    clearWysBlock();
    if (!blk) return;
    edBlockSel = blk;
    blk.classList.add('sb-block-selected');
    blk.setAttribute('contenteditable', 'false');  // 选中期间禁编辑，双击才进入
    if (blk.nodeName === 'PRE') showCodeLangPicker(blk);  // 代码块：右下角显示语言选择器
    // 把主体光标移动到块之前，避免停留在禁用区内
    const wys = blk.parentNode;
    if (wys && wys.setAttribute) {
      try {
        const range = document.createRange();
        range.setStart(wys, Array.prototype.indexOf.call(wys.childNodes, blk));
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
      } catch (_) { /* 忽略定位异常 */ }
    }
  }

  /* 在指定元素末尾放置光标 */
  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el); range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
  }

  /* WYSIWYG 渲染后补齐末尾空段落：当最后一个顶层子节点是块(PRE/TABLE/BLOCKQUOTE/HR 或含
   * 非段落顶层块)时追加一个空 <p><br></p>，便于块后回车新增一行；该空段仅交互层存在，
   * domToMd 会剔除（while pop 尾随空行），md 源码不产生多余空行。
   * @param {Element} wys #ed-wysiwyg 容器
   * 作者: 火 冰 */
  function appendWysTrailingP(wys) {
    if (!wys) return;
    const last = wys.lastElementChild;
    if (!last) return;
    const tg = last.nodeName;
    // 已是段落类(p/div/li 等可插入光标)则视为结尾可继续编辑，不再补
    const blockish = /^(PRE|TABLE|BLOCKQUOTE|HR)$/.test(tg);
    if (!blockish) return;
    // 空段落需最小高度，避免过矮影响在块后回车
    const p = document.createElement('p');
    p.innerHTML = '<br>';
    p.style.cssText = 'min-height:1.5rem;';
    wys.appendChild(p);
  }