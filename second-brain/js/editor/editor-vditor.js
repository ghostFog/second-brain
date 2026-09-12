/* ============================================
 * 第二脑 — Markdown 编辑引擎 vditor 桥接 + .md Provider
 * 作者: 火 冰
 * 功能:
 *   - 引入开源引擎 vditor（node_modules/vditor/dist，npm 运行时依赖）作为 Markdown 编辑区唯一渲染/编辑实现，
 *     整体承接原自研「源码 textarea + 所见即所得 + 预览」三套 DOM 与全部自研编辑增强。
 *   - 以宿主桥接函数（vdInit / vdSyncValue / vdSetMode / vdSetSource / vdToggleSource / vdGetValue / vdSetValue）驱动 vditor。
 *   - 模式映射：宿主 编辑→ir、分屏→sv(+both)、预览→preview。
 *   - 静态注册 .md/.markdown 的编辑器 Provider（桌面版与网页版共用，保证双端一致）。
 * 说明:
 *   - 依赖 create/ further host globals：edOutdated / edCurrent / restoreS / onEdInput / renderMarkdown / registerEditorProvider。
 *   - renderMarkdown(app-note.js) 仅保留给 AI 问答等非编辑区展示，此处仅作 Provider 契约薄实现。
 * ============================================ */
'use strict';

(function () {
  /** @type {Object|null} vditor 实例（懒创建，首次进入编辑区才 new） */
  let vdInst = null;
  /** @type {string} vditor 编辑节点模式：'ir'(即时渲染) | 'wysiwyg'(所见即所得) | 'sv'(源码分屏) */
  let vdMode = 'ir';
  /** @type {string} 编辑子节点偏好（「编辑」按钮冒泡子菜单选中的编辑节点）：'ir' | 'wysiwyg'，默认 IR */
  let vdEditorNode = 'ir';
  /** @type {string} vditor 视图布局：'editor'(仅编辑) | 'both'(分屏) | 'preview'(纯预览) */
  let vdPreview = 'editor';
  /** @type {string} 实例未创建时的内容暂存缓冲（切换/重建时保内容不丢） */
  let vdBuffer = '';
  /** @type {boolean} vditor 是否已完成首帧异步渲染（options.after 后置为 true）；
   *  未就绪时 vdSyncValue 的内容先暂存 vdPending，避免被首发渲染重启清空 */
  let vdReady = false;
  /** @type {string|null} 待 vditor 异步渲染完成后补渲的内容（启动/快速切换时序缓冲） */
  let vdPending = null;
  /** @type {number} 构建序号自增：标记「当前最新一次 buildVditor」，供异步 after 判断是否本实例，防止旧实例乱序抢占 */
  let vdBuildSeq = 0;
  /** @type {string[]} 工具栏精简项：承接原自研格式/表格/代码/数学能力，含原生搜索、大纲、导出；
   *  upload 为 vditor 内置上传按钮，支持图片与附件（accept/上传逻辑见 buildVditor 的 upload 配置） */
  const VDTOOLBAR = [
    'undo', 'redo', '|', 'headings', 'bold', 'italic', 'strike', '|',
    'list', 'ordered-list', 'check', 'outdent', 'indent', '|',
    'quote', 'line', 'code', 'inline-code', '|', 'table', 'link', 'upload', '|',
    'outline', 'export',
  ];

  /* ---------- 资源上传（图片/附件）助手 ---------- */

  /** 是否图片类文件名（决定插入为 `![名](url)` 还是 `[名](url)`）
   * @param {string} name 原始文件名
   * @returns {boolean} 是否为图片
   * @author 火 冰 */
  function isImageName(name) {
    return /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(String(name || ''));
  }

  /** 生成资源插入 markdown：图片 → `![真实名](url)`，附件 → `[真实名](url)`（笔记内使用真实名）。
   *  暴露到 window 供 jsdom 回归断言调用。
   * @param {string} name 原始真实文件名
   * @param {string} url  note://vault_res/... 资源地址
   * @returns {string} 待插入片段
   * @author 火 冰 */
  function sbResMarkdown(name, url) {
    return isImageName(name) ? '![' + name + '](' + url + ')' : '[' + name + '](' + url + ')';
  }
  window.sbResMarkdown = sbResMarkdown;

  /** 生成附件卡片插入 markdown（Obsidian 风格引言，供 `[!attach]` 语法渲染成卡片）：
   *  `> [!attach] 真实名 note://vault_res/uuid.ext`，使上传的附件在编辑区显示为「醒目指示块」、
   *  预览/阅读渲染为「完整附件卡片」。图片不经过此函数（保持 `![真实名](url)` 行内预览）。
   *  暴露到 window 供 jsdom 回归断言调用。
   * @param {string} name 原始真实文件名
   * @param {string} url  note://vault_res/... 资源地址
   * @returns {string} 待插入的附件卡片引言片段
   * @author 火 冰 */
  function sbAttachMarkdown(name, url) {
    return '> [!attach] ' + name + ' ' + url;
  }
  window.sbAttachMarkdown = sbAttachMarkdown;

  /** 从 note://vault_res/ 地址抽取资源存储名（uuid.ext）；非该协议地址返回空串。
   *  暴露到 window 供 jsdom 回归断言调用。
   * @param {string} url 资源地址
   * @returns {string} 存储名，或空串
   * @author 火 冰 */
  function resolveVaultResUrl(url) {
    if (typeof url !== 'string') return '';
    const m = String(url).match(/^note:\/\/vault_res\/([^?#]+)/);
    return m ? String(m[1]).replace(/^\/+/, '') : '';
  }
  window.resolveVaultResUrl = resolveVaultResUrl;

  /** 上传一批文件到知识库资源目录：每个文件读二进制 → IPC 落盘（UUID 重命名）→ 回填真实名链接。
   *  作为 vditor options.upload.handler；仅桌面版有桥接时生效，网页版提示不支持。
   *  上传成功后将所有片段按序一次性插入光标处。
   * @param {File[]} fileList 待上传文件数组（vditor 已按 accept/mutiple/max 过滤）
   * @returns {Promise<string|void>} 返回错误文案则 vditor 提示，否则静默
   * @author 火 冰 */
  async function handleVdUpload(fileList) {
    if (!fileList || !fileList.length) return;
    const bridge = window.noteDesktop;
    if (!bridge || typeof bridge.uploadResource !== 'function') {
      try { if (vdInst && vdInst.tip) vdInst.tip.show('上传仅桌面版支持'); } catch (_) { /* 忽略提示异常 */ }
      return;
    }
    const snippets = [];
    for (let i = 0; i < fileList.length; i++) {
      const f = fileList[i];
      if (!f) continue;
      try {
        const buf = await f.arrayBuffer();                    // 读取原始二进制
        const res = await bridge.uploadResource(f.name, buf); // 桌面端落盘 .resources，UUID 命名
        if (res && res.url) {
          // 图片保持行内预览；附件插入 `> [!attach] 名 url` 引言，供编辑区指示块/预览卡片渲染
          snippets.push(isImageName(f.name)
            ? sbResMarkdown(res.name || f.name, res.url)
            : sbAttachMarkdown(res.name || f.name, res.url));
        }
      } catch (e) { console.error('[vditor] 上传失败:', f.name, e); }
    }
    if (snippets.length && vdInst) {
      try { vdInst.insertValue(snippets.join('\n')); } catch (_) { /* 插入失败忽略 */ }
    }
  }

  /** HTML 转义（卡片/上下文菜单文本防注入）
   * @param {string} s 原始文本
   * @returns {string} 转义后文本
   * @author 火 冰 */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** HTML 属性转义（与 escapeHtml 一致，供属性值使用）
   * @param {string} s 原始文本
   * @returns {string} 转义后文本
   * @author 火 冰 */
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  /** 附件卡片 HTML（预览/阅读视图）：扩展名徽标 + 真实名 + 下载按钮。
   *  卡片携带 data-sb-res-url / data-sb-res-name，供点击打开、右键下载、复制链接复用。
   *  暴露到 window 供 jsdom 回归断言调用。
   * @param {string} name 原始真实文件名
   * @param {string} url  note://vault_res/... 资源地址
   * @returns {string} 卡片 HTML
   * @author 火 冰 */
  function sbAttachCardHTML(name, url) {
    const m = String(url).match(/\.([0-9a-z]+)(?:$|[?#])/i);
    const label = (m ? m[1] : 'file').toUpperCase().slice(0, 8);
    const safeName = escapeAttr(name || '下载');
    return '<div class="sb-res-card" data-sb-res-url="' + escapeAttr(url) + '" data-sb-res-name="' + safeName + '">'
      + '<span class="sb-res-card-ext">' + escapeHtml(label) + '</span>'
      + '<div class="sb-res-card-main">'
      + '<span class="sb-res-card-name">' + escapeHtml(name || url) + '</span>'
      + '<span class="sb-res-card-url">' + escapeHtml(url) + '</span>'
      + '</div>'
      + '<button type="button" class="sb-res-card-dl" title="下载 ' + safeName + '"></button>'
      + '</div>';
  }
  window.sbAttachCardHTML = sbAttachCardHTML;

  /** 预览/阅读 HTML 变换：把 Obsidian 风格附件引言 `> [!attach] 真实名 note://vault_res/uuid.ext`
   *  渲染成附件卡片（下载/右键菜单），其余内容原样返回。
   *  作为 vditor options.preview.transform；仅识别 note://vault_res 附件，防止误改普通引言。
   *  暴露到 window 供 jsdom 回归断言调用。
   * @param {string} html md2html 输出的 HTML
   * @returns {string} 变换后的 HTML
   * @author 火 冰 */
  function transformPreviewHtml(html) {
    if (!html || String(html).indexOf('[!attach]') === -1) return html;
    const tpl = document.createElement('div');
    tpl.innerHTML = html;
    const qs = Array.prototype.slice.call(tpl.querySelectorAll('blockquote, [data-type="blockquote"]'));
    for (let i = 0; i < qs.length; i++) {
      if (!isAttachCallout(qs[i])) continue;
      let text = String(qs[i].textContent || '').trim();
      if (text.indexOf('[!attach]') !== 0) continue;
      const body = text.slice('[!attach]'.length).trim();
      if (!body) continue;
      const sp = body.lastIndexOf(' ');                 // 最后一段空白切出 url，前面为真实名（允许名含空格）
      const url = body.slice(sp + 1).trim();
      const name = (sp > 0 ? body.slice(0, sp) : url).trim() || url;
      if (!/^note:\/\/vault_res\/[^?#]+$/.test(url)) continue;
      const wrap = document.createElement('div');
      wrap.innerHTML = sbAttachCardHTML(name, url);
      const node = wrap.firstChild;
      if (node) qs[i].parentNode.replaceChild(node, qs[i]);
    }
    return tpl.innerHTML;
  }
  window.sbTransformPreviewHtml = transformPreviewHtml;

  /** 通过 note:// 资源地址下载到本地（fetch→blob→临时链接触发浏览器下载，以真实名保存）。
   *  暴露到 window 供回归断言/复用。
   * @param {string} url  note://vault_res/... 资源地址
   * @param {string} name 保存文件名（真实名）
   * @author 火 冰 */
  async function downloadResource(url, name) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objUrl;
      a.download = name || 'download';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { try { URL.revokeObjectURL(objUrl); } catch (_) { /* 忽略 */ } }, 10000);
    } catch (e) { console.error('[res] 下载失败:', url, e); }
  }
  window.sbDownloadResource = downloadResource;

  /* ---------- 编辑器/卡片右键菜单 ---------- */

  let sbMenuEl = null;     // 当前展示的右键菜单元素

  /** 关闭右键菜单 */
  function hideSbMenu() { if (sbMenuEl) { sbMenuEl.remove(); sbMenuEl = null; } }
  window.sbHideMenu = hideSbMenu;

  /** 在指定坐标展示一个右键菜单（body 级固定浮层，可防溢出）。
   * @param {Array<{label:string,onClick:Function}>} items 菜单项
   * @param {number} x 视口横坐标
   * @param {number} y 视口纵坐标
   * @author 火 冰 */
  function showSbMenu(items, x, y) {
    hideSbMenu();
    const el = document.createElement('div');
    el.className = 'sb-ctx';
    el.setAttribute('role', 'menu');
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sb-ctx-item';
      b.textContent = it.label;
      b.setAttribute('role', 'menuitem');
      (function (onClick) {
        b.addEventListener('click', function (ev) {
          ev.stopPropagation();
          hideSbMenu();
          if (typeof onClick === 'function') { try { onClick(); } catch (_) { /* 忽略菜单回调异常 */ } }
        });
      })(it.onClick);
      el.appendChild(b);
    }
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    let px = x; let py = y;
    if (px + rect.width > window.innerWidth - 8) px = Math.max(8, window.innerWidth - rect.width - 8);
    if (py + rect.height > window.innerHeight - 8) py = Math.max(8, window.innerHeight - rect.height - 8);
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    sbMenuEl = el;
    setTimeout(function () {
      const onDoc = function (ev) { if (!el.contains(ev.target)) hideSbMenu(); document.removeEventListener('mousedown', onDoc, true); };
      document.addEventListener('mousedown', onDoc, true);
    }, 0);
    const onKey = function (ev) { if (ev.key === 'Escape') { hideSbMenu(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
  }

  /** 把光标放到指定视口坐标处（右键时把插入点定位到鼠标位置）。
   * @param {number} x 视口横坐标
   * @param {number} y 视口纵坐标
   * @author 火 冰 */
  function placeCaretAtPoint(x, y) {
    try {
      const r = document.caretRangeFromPoint(x, y);
      if (!r) return;
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      if (vdInst && vdInst.vditor) {
        const v = vdInst.vditor;
        const el = (vdMode === 'sv' && v.sv) ? v.sv.element
          : ((vdMode === 'wysiwyg' && v.wysiwyg) ? v.wysiwyg.element : (v.ir ? v.ir.element : null));
        if (el) el.focus();
      }
    } catch (_) { /* 忽略光标定位异常 */ }
  }

  let sbPickInput = null;   // 惰性创建的隐藏文件选择框（右键「插入图片/上传附件」复用）

  /* 文件选择 accept 由 markdown-editor 插件的 md-context.js 提供（window.sbUploadAccept，
   * 图片 `image/*`、附件非图片扩展名白名单）；此处仅取用并保证无插件时安全回落。 */
  function sbUploadAccept(type) {
    return (typeof window.sbUploadAccept === 'function')
      ? window.sbUploadAccept(type)
      : (type === 'image' ? 'image/*' : '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.md,.txt,.sh,.bat,.cmd,.ps1,.csv,.zip,.rar,.7z,.asc');
  }

  /** 弹出文件选择，选中文件经 handleVdUpload 在光标处上传并插入（复用上传/落盘与分流逻辑）。
   *  handleVdUpload 按 isImageName 判断：图片插行内 `![名](url)`、附件插 `> [!attach]` 卡片引言；
   *  故此处仅需按 type 过滤 accept，分流由 handleVdUpload 完成。
   * @param {string} type 'image' 只选图片 | 'attachment' 只选非图片附件
   * @author 火 冰 */
  function pickAndUploadAtCaret(type) {
    if (!window.noteDesktop || typeof window.noteDesktop.uploadResource !== 'function') {
      try { if (vdInst && vdInst.tip) vdInst.tip.show('上传仅桌面版支持'); } catch (_) { /* 忽略提示异常 */ }
      return;
    }
    if (!sbPickInput) {
      sbPickInput = document.createElement('input');
      sbPickInput.type = 'file';
      sbPickInput.style.display = 'none';
      sbPickInput.multiple = true;
      document.body.appendChild(sbPickInput);
      sbPickInput.addEventListener('change', async function () {
        const files = sbPickInput.files ? Array.prototype.slice.call(sbPickInput.files) : [];
        sbPickInput.value = '';
        if (files.length && vdInst) await handleVdUpload(files);
      });
    }
    sbPickInput.accept = sbUploadAccept(type);
    sbPickInput.click();
  }

  /** 编辑器/卡片右键处理：卡片 → 下载/复制链接；编辑区 → 插入图片/上传附件菜单。
   *  （卡片只在预览/阅读出现，卡片右键用下载菜单；IR 表格/代码块右键由专属菜单接管，此处不叠加）
   *  @param {MouseEvent} e 右键事件
   *  @author 火 冰 */
  function onEditorContextMenu(e) {
    const card = e.target && e.target.closest ? e.target.closest('.sb-res-card') : null;
    if (card) {
      const url = card.getAttribute('data-sb-res-url') || '';
      const name = card.getAttribute('data-sb-res-name') || '下载';
      if (url) {
        e.preventDefault();
        e.stopPropagation();
        showSbMenu([
          { label: '下载', onClick: function () { downloadResource(url, name); } },
          { label: '复制链接', onClick: function () { try { navigator.clipboard.writeText(url); } catch (_) { /* 忽略复制异常 */ } } },
        ], e.clientX, e.clientY);
      }
      return;
    }
    // 命中判断用 vditor 内容容器 vdInst.vditor.element（编辑区/预览所在），
    // 不能用 vdInst.element——Vditor 实例从不挂该字段，恒为 undefined，会导致右键菜单永不触发。
    const vdRoot = (vdInst && vdInst.vditor) ? vdInst.vditor.element : (vdEl() || null);
    if (vdInst && e.target && vdRoot && vdRoot.contains(e.target)) {
      // IR 表格/代码块右键交给 showIrTableMenu/showIrCodeMenu 专属菜单，避免两组菜单叠加。
      // 注意不能用 closest('pre')：vditor IR 整个编辑区被一个 <pre class="vditor-reset"> 包裹，
      // 普通文字也会命中 pre，导致通用右键被误短路（Bug-049，见 irCodeAtRightClick）。
      if (vdMode === 'ir') {
        const tg = e.target;
        const el = tg.nodeType === 1 ? tg : (tg.parentElement || null);
        if (el && typeof el.closest === 'function'
          && (el.closest('table') || el.closest('[data-type="code-block"]'))) return;
      }
      e.preventDefault();
      placeCaretAtPoint(e.clientX, e.clientY);
      showSbMenu([
        { label: '插入图片', onClick: function () { pickAndUploadAtCaret('image'); } },
        { label: '上传附件', onClick: function () { pickAndUploadAtCaret('attachment'); } },
      ], e.clientX, e.clientY);
    }
  }
  document.addEventListener('contextmenu', onEditorContextMenu);

  /* ---------- 编辑区附件引言指示块（Obsidian `> [!attach]` 语法） ---------- */

  /** 判断一个块是否为 `> [!attach]` 附件引言：正文取首个 <p> 文本，无 <p> 则用块自身文本，
   *  以行首 `[!attach]` 判定（覆盖 IR/WYSIWYG 原生 blockquote 与 SV 源码 data-type 结构）。
   * @param {HTMLElement} node 块节点
   * @returns {boolean} 是否为附件引言
   * @author 火 冰 */
  function isAttachCallout(node) {
    if (!node) return false;
    let t = '';
    const p = node.querySelector('p');
    t = p ? p.textContent : '';
    if (!t.trim()) t = node.textContent;
    return /^\s*\[!attach\]/.test(t || '');
  }

  /** 标记编辑区中 `> [!attach] ...` 行为的引言块为 `sb-attach-callout`，
   *  仅切换 class（不改 DOM/不动 markdown），供 CSS 显示成醒目附件指示块。
   *  @param {HTMLElement} root 编辑区根
   *  @author 火 冰 */
  function markAttachCallouts(root) {
    if (!root) return;
    const qs = root.querySelectorAll('blockquote, [data-type="blockquote"]');
    for (let i = 0; i < qs.length; i++) {
      qs[i].classList.toggle('sb-attach-callout', isAttachCallout(qs[i]));
    }
  }
  window.sbMarkAttachCallouts = markAttachCallouts;

  let sbCalloutTimer = null;
  /** 防抖标记：编辑内容变后，仅扫描 IR/WYSIWYG 编辑区并加指示类 */
  function scheduleCalloutMark() {
    if (sbCalloutTimer) return;
    sbCalloutTimer = setTimeout(function () {
      sbCalloutTimer = null;
      if (!vdInst || !vdInst.vditor) return;
      const v = vdInst.vditor;
      if (v.ir) markAttachCallouts(v.ir.element);
      if (v.wysiwyg) markAttachCallouts(v.wysiwyg.element);
    }, 120);
  }

  /** 挂载 MutationObserver 监听文档结构变化，防抖触发指示块标记（重建/切换后自动覆盖）。
   *  观察 documentElement（始终存在，不受脚本加载位置/body 就绪时机影响）。
   *  @author 火 冰 */
  function watchAttachCallouts() {
    const root = document && document.documentElement ? document.documentElement : (document ? document.body : null);
    if (!root || typeof MutationObserver !== 'function') return;
    try {
      const ob = new MutationObserver(function () { scheduleCalloutMark(); });
      ob.observe(root, { childList: true, subtree: true });
    } catch (_) { /* 忽略观察异常 */ }
  }

  // 启动即监听：编辑区 `> [!attach]` 引言实时加指示块样式（防抖，仅切 class，不改内容）
  watchAttachCallouts();

  // 冒泡阶段拦截：卡片下载按钮 → 下载；点卡片主体 → 系统默认程序打开（不导航窗口）
  document.addEventListener('click', function (e) {
    const dl = e.target && e.target.closest ? e.target.closest('.sb-res-card-dl') : null;
    if (dl) {
      const card = dl.closest('.sb-res-card');
      const url = card && card.getAttribute('data-sb-res-url');
      const name = card && card.getAttribute('data-sb-res-name');
      if (url) { e.preventDefault(); e.stopPropagation(); downloadResource(url, name || 'download'); }
      return;
    }
    const card = e.target && e.target.closest ? e.target.closest('.sb-res-card') : null;
    if (card && e.target === card) {
      const url = card.getAttribute('data-sb-res-url');
      const stored = resolveVaultResUrl(url);
      e.preventDefault();
      e.stopPropagation();
      if (stored && window.noteDesktop && typeof window.noteDesktop.openResource === 'function') {
        try { window.noteDesktop.openResource(stored); } catch (_) { /* 忽略打开异常 */ }
      }
    }
  }, false);

  // 资源上传助手全量原样导出到 window，供 jsdom 回归断言调用
  window.__vdRes = {
    isImageName: isImageName,
    sbResMarkdown: sbResMarkdown,
    sbAttachMarkdown: sbAttachMarkdown,
    resolveVaultResUrl: resolveVaultResUrl,
    sbAttachCardHTML: sbAttachCardHTML,
    transformPreviewHtml: transformPreviewHtml,
    markAttachCallouts: markAttachCallouts,
  };

  // 捕获阶段拦截：点击上传附件（note://vault_res 链接）不再导致窗口整体导航，
  // 改用系统默认程序打开；图片链接（vditor 自身的点击预览）放行不拦截。
  document.addEventListener('click', function (e) {
    const src = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!src) return;
    const stored = resolveVaultResUrl(src.getAttribute('href'));
    if (!stored || isImageName(stored)) return;
    e.preventDefault();
    e.stopPropagation();
    const bridge = window.noteDesktop;
    if (bridge && typeof bridge.openResource === 'function') {
      try { bridge.openResource(stored); } catch (_) { /* 打开异常忽略 */ }
    }
  }, true);

  /** 应用当前是否为暗色主题（用于 vditor theme 选项跟随宿主）。
   *  读取全局已解析的 `html[data-theme]`（设置-外观-主题模式 dark/light/auto 的最终结果），
   *  auto 时由 app-core setTheme 已解析为 dark/light
   * author 火 冰 */
  function isDarkTheme() {
    return document.documentElement && document.documentElement.getAttribute('data-theme') === 'dark';
  }

  /** 收集插件注册的「编辑器主题解析器」，归并出 vditor 应应用的 { theme, extraCss }。
   *  解析器由插件经 PluginAPI.registerEditorThemeResolver 注册；取首个合法结果。
   *  无解析器时编辑器按宿主明暗应用 vditor 自带深/浅主题（配色只做外壳，不向编辑器数值映射）。
   *  作者: 火 冰 */
  function resolveVdTheme() {
    const hint = { dark: isDarkTheme() };
    const resolvers = window.__hostThemeResolvers || [];
    for (let i = 0; i < resolvers.length; i++) {
      if (typeof resolvers[i] !== 'function') continue;
      let r = null;
      try { r = resolvers[i](hint); } catch (_) { r = null; }
      if (r && (r.theme === 'dark' || r.theme === 'light')) {
        return { theme: r.theme, extraCss: typeof r.extraCss === 'string' ? r.extraCss : '' };
      }
    }
    return { theme: hint.dark ? 'dark' : 'light', extraCss: '' };
  }
  window.vdResolveVdTheme = resolveVdTheme;

  /** 注入/刷新编辑器额外主题 CSS（插件生成的自定义覆盖样式，持久 <style>，复用同一元素避免堆积）
   *  @param {string} css 可选，为空则清空既有注入
   *  作者: 火 冰 */
  function applyVdExtraCss(css) {
    const id = 'host-vditor-theme-extra';
    let style = document.getElementById(id);
    if (css) {
      if (!style) { style = document.createElement('style'); style.id = id; }
      style.textContent = css;
      // 每次应用都重新 appendChild 到 <head> 末尾（已存在时会移动节点），
      // 确保晚于 vditor 运行时动态注入的主题 <link>，让覆盖样式在级联中胜出。
      document.head.appendChild(style);
    } else if (style) {
      style.textContent = '';
    }
  }

  /** 将 vditor 主题应用到编辑区：先解析（插件可插拔源），再 setTheme + 注入额外 CSS。
   *  已构建实例即时 setTheme；未构建则仅缓存额外 CSS，由 buildVditor 用 resolveVdTheme() 兜底。
   *  作者: 火 冰 */
  function syncVdTheme() {
    const r = resolveVdTheme();
    if (vdInst) {
      try { vdInst.setTheme(r.theme); } catch (_) { /* 忽略同步异常 */ }
    }
    applyVdExtraCss(r.extraCss);
  }
  window.vdSyncTheme = syncVdTheme;

  /** 确定性接管 vditor 三个编辑视图 + 预览窗的显隐（不依赖 vditor 自身的 setPreviewMode，
   *  后者强制把 sv 源码 textarea 置为 display:block，会污染 IR/WYSIWYG 编辑态导致源码区残留挤压）。
   *  依据 vditor 内部元素结构：sv=textarea，ir/wysiwyg 用其外层容器，preview 用预览窗。
   *  - vdMode='sv'（SV 基础）：按 vdPreview 决定 both/editor/preview 三种布局
   *  - vdMode='ir'|'wysiwyg'（编辑节点）：仅显示对应编辑区，源码与预览一律隐藏
   * 作者: 火 冰 */
  function applyVdVisibility() {
    if (!vdInst || !vdInst.vditor) return;
    const v = vdInst.vditor;
    if (!v.sv || !v.ir || !v.wysiwyg || !v.preview) return;
    const sv = v.sv.element;
    const prev = v.preview.element;
    const ir = v.ir.element.parentElement;
    const wy = v.wysiwyg.element.parentElement;
    if (vdMode === 'sv') {
      sv.style.display = (vdPreview === 'preview') ? 'none' : 'block';
      prev.style.display = (vdPreview === 'both' || vdPreview === 'preview') ? 'block' : 'none';
      ir.style.display = 'none';
      wy.style.display = 'none';
      // 展示预览窗时确保其已渲染当前内容（vditor 构建时不一定触发）
      if (prev.style.display === 'block') { try { v.preview.render(v); } catch (_) { /* 忽略渲染异常 */ } }
    } else {
      sv.style.display = 'none';
      prev.style.display = 'none';
      ir.style.display = (vdMode === 'ir') ? 'block' : 'none';
      wy.style.display = (vdMode === 'wysiwyg') ? 'block' : 'none';
    }
  }

  /** 取视觉锚点元素（vditor 挂载容器） */
  function vdEl() {
    return document.getElementById('ed-vditor');
  }

  /** 安全取当前实例内容：实例未就绪（异步首帧渲染未完成）或 getValue 内部抛错时返回 undefined，
   *  由调用方回退暂存缓冲 vdBuffer。修复 fixValue 崩溃见 Bug 登记，作者: 火 冰 */
  function safeGetValue() {
    if (!vdInst) return undefined;
    try { return vdInst.getValue(); } catch (_) { return undefined; /* 忽略未就绪异常 */ }
  }

  /** 取当前实例内容：有实例用 getValue，否则用暂存缓冲 */
  function vdGetValue() {
    const v = vdInst ? safeGetValue() : vdBuffer;
    return (v === undefined) ? vdBuffer : v;
  }

  /** 内容变更回传给宿主：vditor input/blur 回调统一入口
   * @param {string} v 最新 markdown 源文本 */
  function sync2Host(v) {
    if (typeof onEdInput === 'function') {
      try { onEdInput(v); } catch (_) { /* 回调异常忽略 */ }
    }
  }

  /* ============================================================
   * IR 模式表格右键菜单（IR 表格操作）
   * vditor 原生「表格浮层工具栏」只在 wysiwyg.popover（仅所见即所得出现）。
   * 本模块给 ir 模式补一个等价入口：在表格单元格内**右键**弹出「插入行/列、删除行/列」菜单。
   * 关键同步思路：IR 模式下 vditor 的 getValue/getMarkdown 恒按当前
   * ir.element.innerHTML 实时推导（见 vditor getMarkdown: ir→VditorIRDOM2Md(innerHTML)），
   * 因此直接在 ir.element 的真实 <table> DOM 上增删行/列后，调用 vdInst.getValue()
   * 即得正确 markdown 并 sync2Host 保存，无需触发 vditor 内部重渲染，光标不跳转。
   * 作者: 火 冰
   * ============================================================ */

  /** @type {{table:HTMLElement,tr:HTMLElement,td:HTMLElement}|null} IR 表格右键命中的单元格 */
  let irCtxHit = null;
  /** @type {HTMLElement|null} IR 代码块右键命中的块级包装元素（.vditor-ir__node 等） */
  let irCtxCode = null;

  /** 在目标块级元素前插入一个空段落（修复「表格/代码块作为首元素时无法在其前插入内容」）。
   *  真实算法（DOM 插入 + 光标定位）已迁入 markdown-editor 插件的 md-context.js（window.irInsertAbove），
   *  本宿主仅注入 vdInst 实例并负责 getValue 同步回宿主。
   * @param {HTMLElement} blockEl 命中块内的任意元素（表格/代码块）
   * 作者: 火 冰 */
  function irInsertAbove(blockEl) {
    if (!vdInst || !blockEl) return;
    if (typeof window.irInsertAbove === 'function') window.irInsertAbove(vdInst, blockEl);
    try { sync2Host(vdInst.getValue()); } catch (_) { /* 忽略同步异常 */ }
  }

  /** 判断一个块级元素是否为「空行」（段落 p 且去掉 ZWSP 后无可见文本、无嵌套块）。
   *  空行即 irInsertAbove 插入的 `<p data-block="0">ZWSP<wbr></p>`，Backspace/Delete 上应删除整行。
   * @param {HTMLElement|null} el 待判元素
   * @returns {boolean} 是否为空行
   * 作者: 火 冰 */
  function isEmptyLine(el) {
    if (!el || el.nodeType !== 1 || el.tagName !== 'P') return false;
    if (el.querySelector('[data-block="0"]')) return false; // 含嵌套块不是空行
    return (el.textContent || '').replace(/\u200b/g, '').trim() === '';
  }

  /** 取光标位置所在的最顶层块根（带 `data-block="0"`），无则返回原元素兜底。
   * @param {Node} node 光标起点（文本节点或元素）
   * @returns {HTMLElement|null} 块根
   * 作者: 火 冰 */
  function blockRootOf(node) {
    if (!node) return null;
    let n = node;
    while (n && n.nodeType === 1) {
      if (n.getAttribute('data-block') === '0') return n;
      n = n.parentNode;
    }
    return null;
  }

  /** 判断光标是否位于块的最前面（块首可见文本之前，忽略 ZWSP）。
   * @param {HTMLElement} root 块根
   * @param {Range} range 当前选区
   * @returns {boolean} 光标是否在块最前
   * 作者: 火 冰 */
  function caretAtBlockStart(root, range) {
    try {
      const r2 = document.createRange();
      r2.setStartBefore(root.firstChild || root);
      r2.setEnd(range.startContainer, range.startOffset);
      return r2.toString().replace(/\u200b/g, '').trim() === '';
    } catch (_) { return false; }
  }

  /** 把选区光标放置到某块内（末尾或开头），并聚焦编辑区。
   * @param {HTMLElement} block 目标块
   * @param {boolean} atEnd true=末尾 | false=开头
   * 作者: 火 冰 */
  function placeCaret(block, atEnd) {
    if (!block || block.nodeType !== 1 || !vdInst || !vdInst.vditor.ir) return;
    try {
      const r = document.createRange();
      r.selectNodeContents(block);
      r.collapse(atEnd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      vdInst.vditor.ir.element.focus();
    } catch (_) { /* 忽略光标异常 */ }
  }

  /** 删除一个空行块，并把光标定位到相邻块（Backspace→上一块末尾，Delete→下一块开头）；
   *  若未占位到相邻块则聚焦编辑区让用户自行点击；保证删除后编辑器至少留一个块。
   * @param {HTMLElement} root  空行块根
   * @param {string} key  触发的按键（'Backspace' | 'Delete'）
   * 作者: 火 冰 */
  function removeEmptyLine(root, key) {
    if (!vdInst || !root) return;
    const v = vdInst.vditor;
    const prev = root.previousElementSibling;
    const next = root.nextElementSibling;
    root.remove();
    // 防止编辑器被完全清空（vditor 需要一个占位块）
    if (!v.ir.element.firstChild) {
      v.ir.element.insertAdjacentHTML('afterbegin', '<p data-block="0">\u200b<wbr></p>');
    }
    const target = (key === 'Backspace') ? prev : next;
    if (target && target.nodeType === 1) placeCaret(target, key !== 'Backspace');
    else if (v.ir.element) { try { v.ir.element.focus(); } catch (_) { /* 忽略 */ } }
    try { sync2Host(v.getValue()); } catch (_) { /* 忽略同步异常 */ }
  }

  /** 捕获阶段 Backspace/Delete 处理器：修正 IR 模式空行与块前跳转。
   *  规则一：光标在空行上，Backspace/Delete 都删除该空行。
   *  规则二：光标在块（表格/代码块等）最前面按 Backspace，若上一行是空行则删除空行；
   *          若非空行则放行给 vditor 原生（其会跳到上一元素末尾）。
   *  以捕获阶段拦截并在命中时 preventDefault，避免与 vditor 原生 keydown 冲突。
   * @param {KeyboardEvent} e 键盘事件
   * 作者: 火 冰 */
  function handleIrDeleteKeydown(e) {
    const key = e.key;
    if (key !== 'Backspace' && key !== 'Delete') return;
    if (!vdInst || vdMode !== 'ir') return;
    const v = vdInst.vditor;
    const el = v && v.ir ? v.ir.element : null;
    if (!el || !el.contains(e.target)) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount !== 1) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return; // 有选区交给 vditor 原生处理删除
    const root = blockRootOf(range.startContainer);
    if (!root) return;
    // 规则一：空行删除
    if (isEmptyLine(root)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      removeEmptyLine(root, key);
      return;
    }
    // 规则二：块最前 Backspace，上一行是空行则删除之
    if (key === 'Backspace' && caretAtBlockStart(root, range)) {
      const prev = root.previousElementSibling;
      if (prev && isEmptyLine(prev)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        prev.remove();
        if (v.ir && v.ir.element) { try { v.ir.element.focus(); } catch (_) { /* 忽略 */ } }
        try { sync2Host(v.getValue()); } catch (_) { /* 忽略同步异常 */ }
      }
    }
  }

  /* 暴露纯 DOM 块级插入/删除助手到 window.__vdBlock（jsdom 回归断言用），不改业务路径 */
  window.__vdBlock = {
    irInsertAbove: irInsertAbove,
    isEmptyLine: isEmptyLine,
    blockRootOf: blockRootOf,
    caretAtBlockStart: caretAtBlockStart,
    handleIrDeleteKeydown: handleIrDeleteKeydown,
  };

  /** 取单元格在其所在行中的列索引
   * @param {HTMLElement} row   行元素（tr）
   * @param {HTMLElement} cell  td/th
   * @returns {number} */
  function irTableCellIndex(row, cell) {
    return Array.prototype.indexOf.call(row.children, cell);
  }

  /** 在当前行上/下方插入一行（行内单元格数与参考行一致；表头行用 th，数据行用 td）
   * 边界：表头行(th)下方插入时，新行必须落到 `|---|` 分隔线之下（tbody 首行），
   * 否则会串进 thead 变成第二行表头，序列化后出现在分隔线上方。
   * @param {HTMLElement} table   表格
   * @param {HTMLElement} refRow  参考行
   * @param {boolean} before      true=上方插入 | false=下方插入
   * @returns {HTMLElement} 新行 */
  function irInsertRow(table, refRow, before) {
    const isHeader = refRow.parentNode && refRow.parentNode.nodeName === 'THEAD';
    // 新插入的行一律是数据行（td）。注意：绝不往 thead 里插新表头行，
    // 否则序列化会出现「分隔线上方」的假表头。
    const tr = document.createElement('tr');
    const n = refRow.cells ? refRow.cells.length : 0;
    for (let i = 0; i < n; i++) {
      const cell = document.createElement('td');
      cell.innerHTML = '\u00a0<br>';
      tr.appendChild(cell);
    }
    if (isHeader) {
      // 表头下方插行：作为首条数据行放到 tbody（分隔线之下）
      let tb = table.querySelector('tbody');
      if (!tb) { tb = document.createElement('tbody'); table.appendChild(tb); }
      tb.insertBefore(tr, tb.firstChild || null);
    } else if (before) {
      refRow.parentNode.insertBefore(tr, refRow);
    } else if (refRow.nextSibling) {
      refRow.parentNode.insertBefore(tr, refRow.nextSibling);
    } else {
      refRow.parentNode.appendChild(tr);
    }
    return tr;
  }

  /** 在参考列左/右侧插入一列（对每一行实行插入单元格；表头行用 th，数据行用 td）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 参考行（取列数基准）
   * @param {number} idx         参考列索引
   * @param {boolean} before     true=左侧 | false=右侧
   */
  function irInsertCol(table, refRow, idx, before) {
    const rows = table.rows || [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.cells || row.cells.length <= idx) continue;
      const tag = (row.parentNode && row.parentNode.nodeName === 'THEAD') ? 'th' : 'td';
      const cell = document.createElement(tag);
      cell.innerHTML = '\u00a0<br>';
      if (before) {
        row.cells[idx].parentNode.insertBefore(cell, row.cells[idx]);
      } else {
        row.cells[idx].insertAdjacentElement('afterend', cell);
      }
    }
  }

  /** 删除参考行（边界：表头行不可删，否则失去表头；仅数据行可删，且保留至少一行避免整表被清空）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 待删行 */
  function irDeleteRow(table, refRow) {
    const isHeader = refRow.parentNode && refRow.parentNode.nodeName === 'THEAD';
    if (isHeader) return; // 表头行不可删除
    if ((table.rows || []).length > 1) refRow.parentNode.removeChild(refRow);
  }

  /** 删除参考列（每行仅当列数 >1 才删）
   * @param {HTMLElement} table  表格
   * @param {HTMLElement} refRow 参考行
   * @param {number} idx         待删列索引 */
  function irDeleteCol(table, refRow, idx) {
    const rows = table.rows || [];
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      if (!row.cells || row.cells.length <= idx || row.cells.length <= 1) continue;
      row.removeChild(row.cells[idx]);
    }
  }

  /* 暴露纯 DOM 表格助手到 window.__vdTable（jsdom 回归断言用），不改业务路径 */
  window.__vdTable = {
    irInsertRow: irInsertRow,
    irInsertCol: irInsertCol,
    irDeleteRow: irDeleteRow,
    irDeleteCol: irDeleteCol,
    irTableCellIndex: irTableCellIndex,
  };

  /** 构建表格右键菜单单项
   * @param {string} label 文案
   * @param {string} icon  lucide 图标名
   * @param {Function} action 点击回调 */
  function irTableMenuItem(label, icon, action) {
    const item = document.createElement('button');
    item.type = 'button';
    item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
      + 'padding:6px 10px;border:none;background:transparent;color:var(--note-ink,#333);'
      + 'font-size:13px;text-align:left;cursor:pointer;border-radius:4px;';
    item.addEventListener('mouseover', function () { item.style.background = 'rgba(0,0,0,.06)'; });
    item.addEventListener('mouseout', function () { item.style.background = 'transparent'; });
    item.innerHTML = '<i data-lucide="' + icon + '" class="w-4 h-4"></i><span>' + label + '</span>';
    item.addEventListener('mousedown', function (e) { e.preventDefault(); }); // 不抢走编辑器光标
    item.addEventListener('click', function () { closeIrTableMenu(); action(); });
    return item;
  }

  /** 关闭 IR 右键菜单（表格/代码块共用同一菜单容器元素） */
  function closeIrTableMenu() {
    const menu = document.getElementById('ed-ir-table-menu');
    if (menu) menu.remove();
    const backdrop = document.getElementById('ed-ir-table-backdrop');
    if (backdrop) backdrop.remove();
  }

  /** 通用 IR 右键菜单展示（定位 + 遮罩 + 图标刷新；靠近边缘自动翻转防溢出）
   * @param {number} x 鼠标 X
   * @param {number} y 鼠标 Y
   * @param {Array<{label:string,icon:string,action:Function}>} items 菜单项 */
  function showIrMenu(x, y, items) {
    closeIrTableMenu();
    const menu = document.createElement('div');
    menu.id = 'ed-ir-table-menu';
    menu.style.cssText = 'position:fixed;z-index:180;min-width:160px;padding:6px;'
      + 'background:var(--note-surface-2,#fff);border:1px solid var(--note-border,#e0e0e0);'
      + 'border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.16);';
    items.forEach(function (it) { menu.appendChild(irTableMenuItem(it.label, it.icon, it.action)); });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(Math.max(8, x), Math.max(8, window.innerWidth - r.width)) + 'px';
    menu.style.top = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - r.height)) + 'px';
    // 遮罩：点击 / 右键 / 滚动 关闭
    const overlay = document.createElement('div');
    overlay.id = 'ed-ir-table-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:179;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeIrTableMenu(); });
    overlay.addEventListener('click', closeIrTableMenu);
    overlay.addEventListener('scroll', closeIrTableMenu, true);
    document.body.appendChild(overlay);
    if (typeof refreshIcons === 'function') { try { refreshIcons(); } catch (_) { /* 忽略 */ } }
  }

  /** 显示 IR 表格右键菜单（靠近边缘自动翻转防溢出）
   * @param {number} x 鼠标 X
   * @param {number} y 鼠标 Y
   * @param {boolean} isHeader 是否光标在表头行（表头行不提供「上方插入行」「删除该行」） */
  function showIrTableMenu(x, y, isHeader) {
    const items = [];
    const defs = [
      ['在上方插入空行', 'arrow-up-to-line', 'block', 'before'],
      ['在上方插入行', 'arrow-up', 'row', 'before'],
      ['在下方插入行', 'arrow-down', 'row', 'after'],
      ['在左侧插入列', 'arrow-left', 'col', 'before'],
      ['在右侧插入列', 'arrow-right', 'col', 'after'],
      ['删除该行', 'unlink', 'row', 'delete'],
      ['删除该列', 'columns', 'col', 'delete'],
    ];
    defs.forEach(function (d) {
      if (isHeader && (d[2] + ':' + d[3] === 'row:before')) return; // 表头行不可在上方插入
      if (isHeader && (d[2] + ':' + d[3] === 'row:delete')) return; // 表头行不可删除
      items.push({ label: d[0], icon: d[1], action: function () { irTableBarAction(d[2], d[3]); } });
    });
    showIrMenu(x, y, items);
  }

  /** 显示 IR 代码块右键菜单（当前仅「在上方插入空行」）
   * @param {number} x 鼠标 X
   * @param {number} y 鼠标 Y */
  function showIrCodeMenu(x, y) {
    showIrMenu(x, y, [{
      label: '在上方插入空行',
      icon: 'arrow-up-to-line',
      action: function () { irInsertAbove(irCtxCode); },
    }]);
  }

  /** 右键命中探测：落在 ir 编辑区某表格单元格内
   * @param {Event}  e 右键事件
   * @param {Object} v vditor 内部对象（vdInst.vditor）
   * @returns {{table:HTMLElement,tr:HTMLElement,td:HTMLElement}|null} */
  function irTableAtRightClick(e, v) {
    const node = e.target;
    if (!node || !v.ir || !v.ir.element || !v.ir.element.contains(node)) return null;
    const td = (node.nodeType === 1) ? node.closest('td,th')
      : (node.parentElement && node.parentElement.closest('td,th'));
    if (!td) return null;
    const tr = td.parentNode;
    const table = tr && tr.closest ? tr.closest('table') : null;
    return table ? { table: table, tr: tr, td: td } : null;
  }

  /** 右键命中探测：落在 ir 编辑区某代码块（.vditor-ir__node[data-type="code-block"] 内的 <pre><code>）中。
   *  注意不能用 closest('pre') 判定——vditor IR 会把整个编辑区内容包在一个 <pre class="vditor-reset"> 里，
   *  普通文字也命中 pre 而被误判为代码块（Bug-049）；须以代码块节点 data-type 区分。
   * @param {Event}  e 右键事件
   * @param {Object} v vditor 内部对象（vdInst.vditor）
   * @returns {HTMLElement|null} 代码块块级元素 */
  function irCodeAtRightClick(e, v) {
    const node = e.target;
    if (!node || !v.ir || !v.ir.element || !v.ir.element.contains(node)) return null;
    const el = (node.nodeType === 1) ? node : (node.parentElement || null);
    if (!el || typeof el.closest !== 'function') return null;
    // 真实代码块：外层带 data-type="code-block" 的 .vditor-ir__node（内含 <pre><code>）
    const blk = el.closest('[data-type="code-block"]');
    if (!blk || !v.ir.element.contains(blk)) return null;
    return blk;
  }

  /** 执行行/列操作并同步保存（右键菜单动作）
   * @param {string} axis 'row'|'col'|'block'
   * @param {string} op   'before'|'after'|'delete' */
  function irTableBarAction(axis, op) {
    if (!irCtxHit || !vdInst) return;
    const hit = irCtxHit;
    if (axis === 'block') {
      irCtxHit = null;
      irInsertAbove(hit.table);   // 在上方插入空行（含同步保存）
      return;
    }
    const v = vdInst.vditor;
    const idx = irTableCellIndex(hit.tr, hit.td);
    if (axis === 'row') {
      if (op === 'delete') irDeleteRow(hit.table, hit.tr);
      else irInsertRow(hit.table, hit.tr, op === 'before');
    } else {
      if (op === 'delete') irDeleteCol(hit.table, hit.tr, idx);
      else irInsertCol(hit.table, hit.tr, idx, op === 'before');
    }
    // IR 下 getValue 实时由 ir.element.innerHTML 推导，改完直接回传宿主保存
    try { sync2Host(vdInst.getValue()); } catch (_) { /* 忽略同步异常 */ }
    irCtxHit = null;
    if (v.ir && v.ir.element) { try { v.ir.element.focus(); } catch (_) { /* 忽略 */ } }
  }

  /* IR 右键：落在表格单元格内弹表格菜单；落在代码块内弹代码块菜单；其余（切 IR 或非块）放行默认 */
  document.addEventListener('contextmenu', function (e) {
    if (!vdInst || vdMode !== 'ir') { irCtxHit = null; irCtxCode = null; return; }
    const v = vdInst.vditor;
    const hit = irTableAtRightClick(e, v);
    if (hit) {
      e.preventDefault();
      irCtxHit = hit; irCtxCode = null;
      const isHeader = hit.tr && hit.tr.parentNode && hit.tr.parentNode.nodeName === 'THEAD';
      showIrTableMenu(e.clientX, e.clientY, isHeader);
      return;
    }
    const code = irCodeAtRightClick(e, v);
    if (code) {
      e.preventDefault();
      irCtxCode = code; irCtxHit = null;
      showIrCodeMenu(e.clientX, e.clientY);
      return;
    }
    irCtxHit = null; irCtxCode = null;
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeIrTableMenu(); });
  // 捕获阶段拦截 IR 光标下的 Backspace/Delete，修正「空行删不掉」与「块前删除空行」问题
  document.addEventListener('keydown', handleIrDeleteKeydown, true);

  /** 构建 vditor 实例（核心装配）。在 vdInst 存在时先销毁保留内容。
   * 说明：edit/split/preview 用 setPreviewMode 切换，无需重建；仅 ir↔sv 切换才重建。 */
  function buildVditor() {
    const el = vdEl();
    // 重建前保底取当前内容：实例存在时 try 取 getValue，失败（异步首帧未完成/销毁中途，此时
    // vditor 内部 this.Vditor 尚未就绪，IR 下 getValue 访问 VditorIRDOM2Md 会抛 Undefined，
    // 导致启动/快速重建时编辑区空白）则回退暂存缓冲 vdBuffer。作者: 火 冰
    const cur = vdInst ? safeGetValue() : undefined;
    const value = (cur != null) ? cur : vdBuffer;
    if (vdInst) { try { vdInst.destroy(); } catch (_) { /* 忽略销毁异常 */ } }
    vdInst = null;
    vdReady = false;   // 重建后视为未就绪，待 after 回调确认首帧渲染完成
    if (!el || typeof window.Vditor !== 'function') {
      vdBuffer = value;   // vditor 不可用（如 jsdom/无依赖）时保留缓冲，保障宿主不崩
      return;
    }
    /* 闭包捕获待创建实例：vditor 的 after 回调是平调用（this 不指向实例），
     * 且可能在 new 返回前触发，故用 inst 变量在构造后立即填充，供回调取用。 */
    let inst = null;
    const seq = ++vdBuildSeq;   // 本次构建序号：after 据此识别是否为当前最新实例，防并发乱序
    const opts = {
      mode: vdMode,
      value: value,
      cache: false,
      // 资源直接走 node_modules/vditor/dist（npm 运行时依赖，随包分发，含官方 dist 目录结构），
      // 避免从 unpkg.com 拉 i18n/lute/主题/icons 造成弱网下编辑区十几秒才渲染（Bug-029），
      // 也避免在仓库内 vendor 复制 vditor 导致 dist 迁移占用/历史膨胀（Bug-031）。
      cdn: 'node_modules/vditor',
      theme: resolveVdTheme().theme,
      lineNumber: !!(typeof restoreS === 'function' ? restoreS('lineNumbers', true) : true),
      toolbar: VDTOOLBAR,
      preview: { delay: 50, cdn: '', mode: (vdPreview === 'both') ? 'both' : 'editor', transform: transformPreviewHtml },
      // 上传图片/附件：accept 覆盖图片与常用附件（pdf/office/脚本/压缩包等），
      // handler 由桌面端 IPC 落盘 .resources（UUID 重命名），笔记内链接使用真实名。
      upload: {
        max: 50 * 1024 * 1024,
        multiple: true,
        accept: 'image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.htm,.md,.txt,.sh,.bat,.cmd,.ps1,.csv,.zip,.rar,.7z,.asc',
        filename: function (name) { return name; },
        handler: handleVdUpload,
      },
      input: function (v) { sync2Host(v); },
      blur: function () { sync2Host(vdGetValue()); },
      /* vditor 首帧异步渲染完成后的回调：把 init 期间积压的待渲内容补进编辑器，
       * 修复启动/快速切换时「工具栏渲染正常但内容区空白」的时序问题。
       * 注意回调内 this 不指向实例，必须用 inst/vdInst 显式引用。
       * 作者: 火 冰 */
      after: function () {
        // 仅最新一次构建的实例才消费暂存内容/接管显隐：启动/快速切换时 vdInit 先以
        // 默认 IR 构建一次，恢复记忆模式（如 WYSIWYG）再重建一次，两次异步 after 可能乱序。
        // 若旧实例的 after 先触发，会抢占共享 vdPending 并把内容 setValue 到已销毁实例上，
        // 使当前活动实例渲染后空白（Bug-050 启动编辑器闪烁后空白）。故 seq 不匹配旧实例则放行。
        if (seq !== vdBuildSeq) return;
        vdReady = true;
        const target = inst || vdInst;
        const pending = (vdPending != null) ? vdPending : '';
        vdPending = null;
        if (pending !== '' && target) {
          try { target.setValue(pending); console.log('[vditor] 首帧渲染完成，已补渲 ' + pending.length + ' 字符'); }
          catch (e) { console.warn('[vd-after] setValue error: ' + e); }
        }
        // 异步首帧渲染后，vditor 可能按默认 preview 布局重置各视图显隐；
        // 再确定性覆盖一次，确保进入「仅源码/仅预览」等布局时其它视图不残留。
        applyVdVisibility();
      },
    };
    try {
      inst = new window.Vditor(el, opts);
      vdInst = inst;
      vdBuffer = '';
      // 构建后应用解析出的额外主题 CSS（插件注入的编辑器覆盖样式）
      applyVdExtraCss(resolveVdTheme().extraCss);
      // 构建后确定性应用当前模式对应的视图显隐（sv 三种布局 / ir / wysiwyg），
      // 取代 vditor setPreviewMode（其对 'preview' 无效且会强制 sv 源码可见）
      applyVdVisibility();
    } catch (err) {
      vdInst = null;
      vdBuffer = value;
      console.error('[vditor] 初始化失败：', err);
    }
  }

  /** 确保实例存在并返回（懒创建）；vditor 不可用时返回 null */
  function ensureVd() {
    if (!vdInst) buildVditor();
    return vdInst;
  }

  /* ---------- 宿主桥接函数（暴露到 globalThis，供 editor-host.js 与插件 action 调用） ---------- */

  /** 初始化：懒创建 vditor 实例（首次渲染实际内容见 vdSyncValue） */
  window.vdInit = function () {
    vdPreview = 'editor';
    ensureVd();
  };

  /** 把某篇笔记内容同步进编辑区（首次打开懒创建实例）；内容会覆盖编辑器当前内容并重置为保存态
   * 说明：分屏(both)布局下 vditor 运行期 setValue 只刷新右侧预览、左侧源码面板不同步，会呈现
   * 「左大片空白 + 右侧窄条」；故分屏态改为销毁重建实例，让两侧面板都用新内容填充。
   * @param {string} md markdown 源文本 */
  window.vdSyncValue = function (md) {
    vdBuffer = String(md == null ? '' : md);
    if (!vdInst) { buildVditor(); return; }
    // 实例尚未完成异步渲染（vditor 的 mode 首帧渲染是异步的，见 options.after）：
    // 立即 setValue 会因首发渲染后重置而被丢弃，导致启动/快速切换时编辑区空白。
    // 故未就绪时先暂存，待 after 回调再补渲染进去。
    if (!vdReady) { vdPending = vdBuffer; return; }
    if (vdPreview === 'both') {
      // 分屏视图：重建实例以完整刷新左源码/右预览，避免 setValue 在分屏下的内容不同步窄条
      try { vdInst.destroy(); } catch (_) { /* 忽略销毁异常 */ }
      vdInst = null;
      buildVditor();
      return;
    }
    try { vdInst.setValue(vdBuffer); } catch (_) { /* 忽略 */ }
  };

  /** 仅在暂存缓冲层面设置内容（无实例时用于清空/占位，例如删除当前笔记后）
   * @param {string} md markdown 源文本 */
  window.vdSetValue = function (md) {
    vdBuffer = String(md == null ? '' : md);
    if (vdInst) { try { vdInst.setValue(vdBuffer); } catch (_) { /* 忽略 */ } }
  };

  /** 获取编辑区当前内容 */
  window.vdGetValue = vdGetValue;

  /** 切换编辑/预览/分屏三态：绑定 vditor 能力
   *  - 'edit'    → 编辑（编辑节点由 vdEditorNode 决定：ir 即时渲染 / wysiwyg 所见即所得），只显示编辑区
   *  - 'split'   → 分屏（SV 源码分屏：左源码右预览）
   *  - 'preview' → 预览（SV 纯预览，只展示整幅渲染结果）
   * 说明：不再调用 vditor setPreviewMode('editor')（它会把 sv 源码 textarea 置为 display:block，
   *       污染 IR/WYSIWYG 编辑态、残留挤压编辑区——修复切换页签/新开笔记编辑区变窄 Bug）。
   *       视图显隐统一由 applyVdVisibility 确定性接管。
   * @param {string} mode 'edit' | 'split' | 'preview'
   * author 火 冰 */
  window.vdSetMode = function (mode) {
    if (mode === 'preview') {
      // 纯预览 = SV 模式 + preview.mode=preview（整幅渲染，不含源码）
      vdMode = 'sv';
      vdPreview = 'preview';
      applyVdOrRebuild();
      return;
    }
    if (mode === 'split') {
      // 分屏 = SV 源码分屏：重建实例使源码/预览左右并排
      vdMode = 'sv';
      vdPreview = 'both';
      applyVdOrRebuild();
      return;
    }
    // 编辑：单选已由 vdSetEditorNode 写入 vdMode(ir/wysiwyg)；保证处于编辑节点且仅显示编辑区
    if (vdMode === 'sv') {
      // 从分屏/预览退回编辑：恢复上次编辑节点，需重建实例使编辑节点生效
      vdMode = vdEditorNode;
      vdPreview = 'editor';
      buildVditor();
      return;
    }
    // 非 SV 态（ir/wysiwyg 已就位）：仅需确定性隐藏源码/预览、显示当前编辑节点
    vdPreview = 'editor';
    applyVdVisibility();
  };

  /** 在 SV 源码分屏基础上直接切换到指定预览布局（both 源码+预览 / editor 仅源码 / preview 仅预览）。
   *  这是「分屏」按钮悬浮直选与「预览」按钮的统一入口，也承载分屏「点击循环」。
   *  - 已处于 SV 视图且实例就绪（currentMode==='sv'）：直接切换显隐，避免重建闪烁、保留内容
   *  - 否则重建实例（含从编辑态进入分屏）
   * @param {'both'|'editor'|'preview'} pm 预览布局
   * author 火 冰 */
  window.vdSetPreviewMode = function (pm) {
    if (['both', 'editor', 'preview'].indexOf(pm) === -1) pm = 'both';
    vdMode = 'sv';
    vdPreview = pm;
    applyVdOrRebuild();
  };

  /** 内部：已处于 SV 视图（vditor currentMode==='sv'）直接切显隐，否则重建实例进入 SV。
   * author 火 冰 */
  function applyVdOrRebuild() {
    if (vdInst && vdInst.vditor && vdInst.vditor.currentMode === 'sv') {
      applyVdVisibility();
      return;
    }
    buildVditor();
  }

  /** 选择编辑子节点（供「编辑」按钮冒泡子菜单调用）：即时渲染 / 所见即所得
   * @param {'ir'|'wysiwyg'} node 编辑节点类型 */
  window.vdSetEditorNode = function (node) {
    vdEditorNode = (node === 'wysiwyg') ? 'wysiwyg' : 'ir';
    // 非编辑态（预览/分屏）仅记录偏好，不改 vdMode（编辑态由 vdMode 承载实例节点）
    if (vdPreview === 'editor') {
      if (vdMode === vdEditorNode) return;
      vdMode = vdEditorNode;
      buildVditor();      // 重建以应用新编辑节点
    }
  };

  /** 读取当前编辑子节点偏好（供宿主展示「编辑 · 所见即所得 / 即时渲染」）
   * @returns {'ir'|'wysiwyg'} */
  window.vdGetEditorNode = function () { return vdEditorNode; };

  /** 切换源码/即时渲染（插件 mde-toggle-source 直接调用，翻转当前编辑节点模式） */
  window.vdToggleSource = function () {
    vdMode = vdMode === 'sv' ? 'ir' : 'sv';
    buildVditor();
  };

  /** 销毁实例（切库/卸载编辑器时释放资源） */
  window.vdDestroy = function () {
    if (vdInst) { try { vdInst.destroy(); } catch (_) { /* 忽略 */ } }
    vdInst = null;
  };

  /* ---------- 宿主自接管全屏（舍弃 vditor 内置 fullscreen，其还原在宿主下不可靠） ---------- */

  /** 是否处于宿主全屏态 */
  let vdHf = false;

  /** 切换宿主全屏：给 body 加 ed-fs-active（隐藏外围 UI，编辑区独占撑满），并显示/隐藏浮动「退出全屏」按钮
   * 说明: 不再依赖 fixed 铺满（transform 包裹元素会劫持 containing block 导致铺不满视口），
   *      改为隐藏左文件树/右面板/顶栏/状态栏后由编辑区 flex 占满。作者: 火 冰 */
  function vdHostFullscreen(on) {
    vdHf = on;
    document.body.classList.toggle('ed-fs-active', on);
    document.documentElement.classList.toggle('ed-fs-active', on);
    let b = document.getElementById('vd-fs-exit');
    if (on) {
      if (!b) {
        b = document.createElement('button');
        b.id = 'vd-fs-exit';
        b.type = 'button';
        b.title = '退出全屏（Esc）';
        b.textContent = '退出全屏 ✕';
        b.style.cssText = 'position:fixed; top:52px; right:16px; z-index:99999; height:30px; padding:0 12px; border:none; border-radius:6px; background:rgba(124,58,237,.92); color:#fff; font-size:12px; cursor:pointer; display:flex; align-items:center; justify-content:center;';
        b.addEventListener('click', function () { vdHostFullscreen(false); });
      }
      b.style.display = 'flex';
      document.body.appendChild(b);
    } else if (b) {
      b.style.display = 'none';
    }
  }

  /** 面板上「全屏」按钮入口：切换宿主全屏 */
  window.vdToggleFullscreen = function () {
    vdHostFullscreen(!vdHf);
  };

  /** Esc 退出生效的全屏 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && vdHf) vdHostFullscreen(false);
  });

  /* ---------- 注册 .md/.markdown 编辑器 Provider ---------- */

  // 全局主题变更（设置-外观-主题模式 / 命令面板切换主题）→ 即时同步 vditor 主题。
  // app-core setTheme 每次都会更新 html[data-theme]（dark/light/auto 的已解析结果），以此为唯一信号源。
  if (window.MutationObserver) {
    const themeObs = new MutationObserver(function () { syncVdTheme(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /** 注册编辑器 Provider：宿主 openNote 按后缀路由到本引擎（.md/.markdown）。
   * 用模块级标记防重复注册（宿主注册 + 可能的插件残留都可能再调）。 */
  function registerVdProvider() {
    if (typeof registerEditorProvider !== 'function') return;
    if (window.__vdProviderRegistered) return;
    window.__vdProviderRegistered = 1;
    registerEditorProvider({
      id: 'markdown-editor',
      name: 'Markdown Editor',
      extensions: ['.md', '.markdown'],
      openers: [
        { id: 'edit', label: '编辑', icon: 'pencil' },
        { id: 'preview', label: '预览', icon: 'eye' },
        { id: 'split', label: '分屏', icon: 'columns-2' },
      ],
      toolbar: [],
      sidebar: [
        { id: 'props', label: '属性' },
        { id: 'outline', label: '大纲' },
        { id: 'backlinks', label: '反向链接' },
        { id: 'tags', label: '标签' },
      ],
      open: function () { return Promise.resolve(); },
      /* 编辑区渲染已由 vditor 全权承担（vdInit/vdSetMode 驱动）——
         renderWysiwyg 仅保留契约空实现，避免宿主回退调用 app-note.js 的 renderMarkdown，
         保证 markdown 轻量渲染模块与编辑区彻底解耦。 */
      renderWysiwyg: function () { return ''; },
      getMd: function () { return vdGetValue(); },
      buildContextMenu: function () { return []; },
      renderSidebar: function () { return Promise.resolve(); },
    });
  }

  // 脚本已晚于 app-plugins.js 加载，直接注册；额外兜底 DOM 就绪后再注册一次（防顺序异常）
  registerVdProvider();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerVdProvider);
  } else {
    registerVdProvider();
  }
})();