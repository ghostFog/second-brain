/* ============================================
 * 第二脑 — Markdown Editor 插件·块编辑模块
 * 作者: 火 冰
 * 功能: 代码块语言选择器 + WYSIWYG 块级编辑（整块选中/清除、末尾补段）。
 * 说明: 模块级状态（mdeCodePre/mdeCodeEl/edBlockSel）与 CODE_LANGS 常量仍由宿主
 *       editor-core 持有（全局词法作用域），本模块以逻辑函数读写之。
 * ============================================ */
'use strict';

(function () {
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

  // 暴露到 window：宿主/测试经全局名调用；同时登记进 sbMdBridge
  const api = {
    wysBlockTags: wysBlockTags, clearWysBlock: clearWysBlock, anchorCodeLangPicker: anchorCodeLangPicker,
    filterCodeLangs: filterCodeLangs, renderCodeLangList: renderCodeLangList, applyCodeLang: applyCodeLang,
    ensureCodeLangPicker: ensureCodeLangPicker, showCodeLangPicker: showCodeLangPicker, hideCodeLangPicker: hideCodeLangPicker,
    selectWysBlock: selectWysBlock, placeCaretAtEnd: placeCaretAtEnd, appendWysTrailingP: appendWysTrailingP,
  };
  Object.keys(api).forEach(function (k) { window[k] = api[k]; });
  window.sbMdBridge = window.sbMdBridge || {};
  window.sbMdBridge.blocks = api;
})();