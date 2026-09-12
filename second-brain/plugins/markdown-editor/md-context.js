/* ============================================
 * 第二脑 — Markdown Editor 插件·上下文件模块
 * 作者: 火 冰
 * 功能: 右键「插入图片 / 上传附件 / 在上方插入空行」的纯逻辑与上传分发。
 * 说明: vditor 实例相关（vdInst/sync2Host）由宿主传入，本模块不直接触碰 vditor 私有闭包。
 * ============================================ */
'use strict';

(function () {
  /* 按右键插入类型解析文件选择 accept（图片只选 image/*；附件只选非图片扩展名）。
   * @param {string} type 'image'|'attachment'
   * @returns {string} 文件选择 accept
   * 作者: 火 冰 */
  function sbUploadAccept(type) {
    return (type === 'image')
      ? 'image/*'
      : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.md,.txt,.sh,.bat,.cmd,.ps1,.csv,.zip,.rar,.7z';
  }

  /* HTML 转义（插入文本防注入）
   * @param {string} s 原始文本
   * @returns {string} 转义后文本
   * 作者: 火 冰 */
  function wysEsc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* 图片/附件上传后按类型生成可往返的 DOM 块 HTML（图片→`![名](url)` 段落；附件→`> [!attach]` 引用块）。
   *  纯函数，暴露到 window.sbWysUploadBlockHtml 供宿主与回归断言使用。
   * @param {string} name 真实文件名
   * @param {string} url  note://vault_res/... 地址
   * @param {boolean} isImg 是否图片
   * @returns {string} 待插入的块 HTML
   * 作者: 火 冰 */
  function wysUploadBlockHtml(name, url, isImg) {
    return isImg
      ? '<p style="color: var(--note-ink);">![' + wysEsc(name) + '](' + wysEsc(url) + ')</p>'
      : '<blockquote class="my-3 pl-4 py-1 border-l-2" style="border-color: var(--note-brand-600); color: var(--note-ink-2);"><p style="font-style: italic;">[!attach] ' + wysEsc(name) + ' ' + wysEsc(url) + '</p></blockquote>';
  }

  /* 逐文件上传到 .resources 并按类型生成 DOM 块 HTML 交给 insertFn 插入（WYSIWYG 自定义 DOM 路径）。
   * @param {Array<File>} files 上传的文件
   * @param {Function} insertFn 插入回调
   * 作者: 火 冰 */
  async function handleWysPickFiles(files, insertFn) {
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f) continue;
      try {
        const buf = await f.arrayBuffer();
        const res = await window.noteDesktop.uploadResource(f.name, buf);
        if (!res || !res.url) continue;
        const name = res.name || f.name;
        const url = res.url;
        const isImg = (window.__vdRes && typeof window.__vdRes.isImageName === 'function')
          ? window.__vdRes.isImageName(name)
          : /\.(png|jpe?g|gif|webp|bmp|ico)$/i.test(name);
        insertFn(wysUploadBlockHtml(name, url, isImg));
      } catch (err) { console.error('[markdown-editor] 所见即所得上传失败:', f.name, err); }
    }
  }

  /* 弹出文件选择并上传：右键「插入图片/上传附件」共用入口（WYSIWYG 自定义 DOM 路径）。
   * @param {string} type 'image'|'attachment'
   * @param {Function} insertFn 生成的块 HTML 插入编辑区并同步
   * 作者: 火 冰 */
  let _wysPickInput = null;
  let _wysInsertFn = null;
  function insWysPickUpload(type, insertFn) {
    if (!window.noteDesktop || typeof window.noteDesktop.uploadResource !== 'function') {
      console.warn('[markdown-editor] 上传仅桌面版支持');
      return;
    }
    _wysInsertFn = insertFn;
    if (!_wysPickInput) {
      _wysPickInput = document.createElement('input');
      _wysPickInput.type = 'file';
      _wysPickInput.style.display = 'none';
      _wysPickInput.multiple = true;
      document.body.appendChild(_wysPickInput);
      _wysPickInput.addEventListener('change', async function () {
        const files = _wysPickInput.files ? Array.prototype.slice.call(_wysPickInput.files) : [];
        const fn = _wysInsertFn;
        _wysPickInput.value = '';
        if (files.length && fn) await handleWysPickFiles(files, fn);
      });
    }
    _wysPickInput.accept = sbUploadAccept(type);
    _wysPickInput.click();
  }

  /* 在目标块根前插入一个空段落（IR 模式「在上方插入空行」核心算法，不依赖 vditor 私有闭包）。
   *  由宿主传入 vditor 实例 vd 与命中块元素；仅做 DOM 插入与光标定位，宿主负责后续 getValue 同步。
   * @param {Object} vd vditor 实例（含 .vditor / .getValue）
   * @param {HTMLElement} blockEl 命中块内的任意元素（表格/代码块）
   * 作者: 火 冰 */
  function irInsertAbove(vd, blockEl) {
    if (!vd || !blockEl) return;
    // 归一到带 data-block="0" 的块根；无则用原元素兜底
    const root = (typeof blockEl.closest === 'function' && blockEl.closest('[data-block="0"]')) || blockEl;
    const p = document.createElement('p');
    p.setAttribute('data-block', '0');
    p.appendChild(document.createTextNode('\u200b')); // ZWSP：保证空段占位非空、序列化后为空行
    const wbr = document.createElement('wbr');
    p.appendChild(wbr);
    root.parentNode.insertBefore(p, root);
    // 光标定位到新空段（vditor IR 以 <wbr> 锚定光标）；失败则仅聚焦，用户可点击进入
    try {
      const range = document.createRange();
      range.setStart(wbr, 0);
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      if (vd.vditor && vd.vditor.ir && vd.vditor.ir.element) vd.vditor.ir.element.focus();
    } catch (_) { /* 忽略光标异常 */ }
  }

  // 暴露到 window：宿主/测试经全局名调用；同时登记进 sbMdBridge.context
  const api = {
    sbUploadAccept: sbUploadAccept, wysEsc: wysEsc, wysUploadBlockHtml: wysUploadBlockHtml,
    handleWysPickFiles: handleWysPickFiles, insWysPickUpload: insWysPickUpload, irInsertAbove: irInsertAbove,
  };
  window.sbUploadAccept = sbUploadAccept;
  window.sbWysUploadBlockHtml = wysUploadBlockHtml;
  window.insWysPickUpload = insWysPickUpload;
  window.handleWysPickFiles = handleWysPickFiles;
  window.irInsertAbove = function (vd, blockEl) { irInsertAbove(vd, blockEl); };
  window.sbMdBridge = window.sbMdBridge || {};
  window.sbMdBridge.context = api;
})();