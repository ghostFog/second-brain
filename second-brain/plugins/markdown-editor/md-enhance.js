/* ============================================
 * 第二脑 — Markdown Editor 插件·增强模块
 * 作者: 火 冰
 * 功能: 链接右键菜单（浏览器打开、取消链接）、图片右键菜单（下载、设置尺寸）、
 *       图片点击选中 + 拖拽调整尺寸。
 * 说明: 本模块不修改 markdown 源文件，仅通过 CSS 控制显示。
 * ============================================ */
'use strict';

(function () {
  /* ---------- 链接右键菜单 ---------- */

  /** 检测元素是否为 IR 模式链接节点（<span data-type="a">）
   *  @param {Element} el 起始元素
   *  @returns {Element|null} IR 链接节点或 null
   *  @author 火 冰 */
  function closestIRLink(el) {
    if (!el || !el.closest) return null;
    var node = el.closest('[data-type="a"]');
    console.log('[MDE] closestIRLink: el=', el?.tagName, 'data-type=', el?.getAttribute?.('data-type'), 'node=', node?.tagName, 'class=', node?.className);
    if (!node) return null;
    /* 确认是 IR 模式的链接（含 .vditor-ir__link 子元素，或本身在 .vditor-ir 容器内） */
    var hasLinkChild = node.querySelector('.vditor-ir__link');
    var inIRContainer = node.closest('.vditor-ir');
    console.log('[MDE] closestIRLink: hasLinkChild=', !!hasLinkChild, 'inIRContainer=', !!inIRContainer);
    return (hasLinkChild || inIRContainer) ? node : null;
  }

  /** 获取链接的 URL（兼容 WYSIWYG <a href> 和 IR <span data-type="a">）
   *  IR 链接 DOM 结构:
   *    <span data-type="a" class="vditor-ir__node">
   *      <span class="vditor-ir__marker--bracket">[</span>
   *      <span class="vditor-ir__link">显示文本</span>
   *      <span class="vditor-ir__marker--bracket">]</span>
   *      <span class="vditor-ir__marker--paren">(</span>
   *      <span class="vditor-ir__marker--link">https://example.com</span>
   *      <span class="vditor-ir__marker--paren">)</span>
   *    </span>
   *  URL 在 .vditor-ir__marker--link 中（参照 Vditor 源码行 12285）
   *  @param {Element} link 链接元素（<a> 或 IR span）
   *  @returns {string} URL
   *  @author 火 冰 */
  function getLinkUrl(link) {
    if (!link) return '';
    /* WYSIWYG/SV: <a href="..."> */
    if (link.tagName === 'A') return link.getAttribute('href') || '';
    /* IR: <span data-type="a"> → URL 在 .vditor-ir__marker--link 中 */
    var urlEl = link.querySelector('.vditor-ir__marker--link');
    var url = urlEl ? (urlEl.textContent || '').trim() : '';
    console.log('[MDE] getLinkUrl: urlEl=', !!urlEl, 'url=', url);
    return url;
  }

  /** 取消链接：把链接转为纯文本（兼容 WYSIWYG <a> 和 IR <span data-type="a">）
   *  @param {Element} link 链接元素（<a> 或 IR span）
   *  @author 火 冰 */
  function unlinkAtCaret(link) {
    if (!link) return;
    console.log('[MDE] unlinkAtCaret: link=', link.tagName, 'data-type=', link.getAttribute?.('data-type'), 'outerHTML=', link.outerHTML?.slice(0, 200));

    /* IR 模式：<span data-type="a"> → 取 .vditor-ir__link 的 innerHTML 作为纯文本，
     *  参照 Vditor 源码行 11698 的取消链接逻辑：aElement.outerHTML = linkText + "<wbr>" */
    if (link.getAttribute && link.getAttribute('data-type') === 'a') {
      var linkTextEl = link.querySelector('.vditor-ir__link');
      var linkText = linkTextEl ? linkTextEl.innerHTML : (link.textContent || '');
      console.log('[MDE] unlinkAtCaret IR: linkTextEl=', !!linkTextEl, 'linkText=', linkText);
      link.outerHTML = linkText + '<wbr>';
      /* 触发编辑区 input 事件，让 Vditor 重新序列化并同步 */
      var editor = document.querySelector('.vditor-ir') || document.querySelector('.vditor-wysiwyg');
      if (editor) editor.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[MDE] unlinkAtCaret IR: done, editor=', !!editor);
      return;
    }

    /* WYSIWYG/SV 模式：<a href> → 替换为纯文本节点 */
    var text = link.textContent || '';
    var parent = link.parentNode;
    if (parent) {
      var textNode = document.createTextNode(text);
      parent.replaceChild(textNode, link);
      /* 同步到 markdown */
      if (typeof sync2Host === 'function') {
        sync2Host(window.vdGetValue ? window.vdGetValue() : '');
      }
    }
  }

  /* ---------- 图片右键菜单 ---------- */

  /** 下载图片
   *  @param {string} src 图片地址
   *  @author 火 冰 */
  function downloadImage(src) {
    if (!src) return;
    if (/^note:\/\//i.test(src)) {
      const name = 'image_' + Date.now() + '.png';
      if (typeof downloadResource === 'function') {
        downloadResource(src, name);
      } else {
        const a = document.createElement('a');
        a.href = src;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } else {
      const a = document.createElement('a');
      a.href = src;
      a.download = 'image_' + Date.now() + '.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  }

  /** 从编辑区删除图片：移除 IR/WYSIWYG DOM 节点 + 删除物理文件 + 同步 markdown
   *  @param {HTMLImageElement} img 图片元素
   *  @author 火 冰 */
  function deleteImageFromEditor(img) {
    if (!img) return;
    var src = img.getAttribute('src') || '';

    /* 取消选中状态 */
    deselectImage();

    /* IR 模式：删除整个 [data-type="img"] 容器；WYSIWYG 模式：删除图片所在块 */
    var irContainer = img.closest('[data-type="img"]');
    var removeTarget = irContainer || img;
    var parent = removeTarget.parentNode;
    if (parent) {
      /* 在删除位置插入光标占位 */
      removeTarget.outerHTML = '<wbr>';
      /* 触发编辑区 input 事件，让 Vditor 重新序列化并同步 */
      var editor = document.querySelector('.vditor-ir') || document.querySelector('.vditor-wysiwyg');
      if (editor) {
        try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* 忽略 */ }
      }
    }

    /* 删除物理文件 */
    if (src && window.noteDesktop && typeof window.noteDesktop.deleteResource === 'function') {
      try { window.noteDesktop.deleteResource(src); } catch (_) { /* 忽略 */ }
    }
  }

  /** 关闭图片尺寸弹窗 */
  function closeImageSizeDialog() {
    const dialog = document.getElementById('mde-image-size-dialog');
    if (dialog) dialog.remove();
    const overlay = document.getElementById('mde-image-size-overlay');
    if (overlay) overlay.remove();
  }

  /** 打开图片尺寸设置弹窗
   *  @param {HTMLImageElement} img 图片元素
   *  @author 火 冰 */
  function openImageSizeDialog(img) {
    if (!img) return;
    closeImageSizeDialog();

    const src = img.getAttribute('src') || '';
    const naturalWidth = img.naturalWidth || 0;
    const naturalHeight = img.naturalHeight || 0;
    const currentWidth = img.offsetWidth;
    const currentHeight = img.offsetHeight;

    const dialog = document.createElement('div');
    dialog.id = 'mde-image-size-dialog';
    dialog.style.cssText = 'position:fixed;z-index:200;top:50%;left:50%;transform:translate(-50%,-50%);'
      + 'min-width:320px;background:var(--note-surface,#fff);border:1px solid var(--note-border,#e0e0e0);'
      + 'border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);padding:20px;';

    dialog.innerHTML = '<div style="font-size:15px;font-weight:600;color:var(--note-ink,#333);margin-bottom:16px;">图片尺寸设置</div>'
      + '<div style="margin-bottom:12px;">'
      + '<label style="display:block;font-size:12px;color:var(--note-ink-2,#666);margin-bottom:4px;">宽度 (px)</label>'
      + '<input type="number" id="mde-img-w" value="' + Math.round(currentWidth) + '"'
      + ' style="width:100%;padding:8px 10px;border:1px solid var(--note-border,#e0e0e0);border-radius:6px;'
      + 'font-size:14px;color:var(--note-ink,#333);outline:none;box-sizing:border-box;"'
      + ' min="1" max="9999" />'
      + '</div>'
      + '<div style="margin-bottom:16px;">'
      + '<label style="display:block;font-size:12px;color:var(--note-ink-2,#666);margin-bottom:4px;">高度 (px)</label>'
      + '<input type="number" id="mde-img-h" value="' + Math.round(currentHeight) + '"'
      + ' style="width:100%;padding:8px 10px;border:1px solid var(--note-border,#e0e0e0);border-radius:6px;'
      + 'font-size:14px;color:var(--note-ink,#333);outline:none;box-sizing:border-box;"'
      + ' min="1" max="9999" />'
      + '</div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
      + '<button type="button" id="mde-img-cancel"'
      + ' style="padding:8px 16px;border:1px solid var(--note-border,#e0e0e0);border-radius:6px;'
      + 'background:transparent;color:var(--note-ink-2,#666);font-size:13px;cursor:pointer;">取消</button>'
      + '<button type="button" id="mde-img-apply"'
      + ' style="padding:8px 16px;border:none;border-radius:6px;'
      + 'background:var(--note-brand-600,#7C3AED);color:#fff;font-size:13px;cursor:pointer;">应用</button>'
      + '</div>';

    document.body.appendChild(dialog);

    const rect = dialog.getBoundingClientRect();
    dialog.style.top = Math.max(0, (window.innerHeight - rect.height) / 2) + 'px';
    dialog.style.left = Math.max(0, (window.innerWidth - rect.width) / 2) + 'px';

    const inputW = document.getElementById('mde-img-w');
    const inputH = document.getElementById('mde-img-h');
    const btnCancel = document.getElementById('mde-img-cancel');
    const btnApply = document.getElementById('mde-img-apply');

    let lockRatio = true;
    const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;

    inputW.addEventListener('input', function () {
      if (lockRatio && naturalHeight > 0) {
        inputH.value = Math.round(parseInt(this.value, 10) / ratio);
      }
    });

    inputH.addEventListener('input', function () {
      if (lockRatio && naturalWidth > 0) {
        inputW.value = Math.round(parseInt(this.value, 10) * ratio);
      }
    });

    btnCancel.addEventListener('click', function () {
      closeImageSizeDialog();
    });

    btnApply.addEventListener('click', function () {
      const w = parseInt(inputW.value, 10);
      const h = parseInt(inputH.value, 10);
      if (w > 0 && h > 0) {
        img.style.width = w + 'px';
        img.style.height = h + 'px';
        /* 同步尺寸到 URL 参数 */
        syncImageSizeToUrl(img, w, h);
      }
      closeImageSizeDialog();
    });

    const onKey = function (e) {
      if (e.key === 'Escape') {
        closeImageSizeDialog();
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);

    const overlay = document.createElement('div');
    overlay.id = 'mde-image-size-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:199;';
    overlay.addEventListener('click', function () {
      closeImageSizeDialog();
    });
    document.body.appendChild(overlay);
  }

  /* ---------- 图片 URL 尺寸参数工具 ---------- */

  /** 从图片 URL 中解析尺寸参数 ?w=xxx&h=xxx
   *  @param {string} src 图片 URL
   *  @returns {{baseUrl:string, w:number, h:number}} 解析结果，w/h 为 0 表示无参数
   *  @author 火 冰 */
  function parseImageUrlSize(src) {
    var result = { baseUrl: src || '', w: 0, h: 0 };
    if (!src) return result;
    var qi = src.indexOf('?');
    if (qi < 0) return result;
    result.baseUrl = src.slice(0, qi);
    var query = src.slice(qi + 1);
    var params = query.split('&');
    for (var i = 0; i < params.length; i++) {
      var kv = params[i].split('=');
      if (kv[0] === 'w' || kv[0] === 'width') result.w = parseInt(kv[1], 10) || 0;
      if (kv[0] === 'h' || kv[0] === 'height') result.h = parseInt(kv[1], 10) || 0;
    }
    return result;
  }

  /** 构建带尺寸参数的图片 URL
   *  @param {string} baseUrl 基础 URL（不含尺寸参数）
   *  @param {number} w 宽度（px）
   *  @param {number} h 高度（px）
   *  @returns {string} 带 ?w=&h= 参数的 URL
   *  @author 火 冰 */
  function buildImageUrlSize(baseUrl, w, h) {
    if (!baseUrl) return '';
    if (w > 0 && h > 0) return baseUrl + '?w=' + w + '&h=' + h;
    return baseUrl;
  }

  /** 从图片 URL 中提取尺寸并应用到 img.style
   *  @param {HTMLImageElement} img 图片元素
   *  @author 火 冰 */
  function applyImageSizeFromUrl(img) {
    if (!img) return;
    var src = img.getAttribute('src') || '';
    var info = parseImageUrlSize(src);
    if (info.w > 0 && info.h > 0) {
      img.style.width = info.w + 'px';
      img.style.height = info.h + 'px';
    }
  }

  /** 同步图片尺寸到 URL 参数（修改 IR/WYSIWYG DOM 并触发 input 事件）
   *  @param {HTMLImageElement} img 图片元素
   *  @param {number} w 宽度（px）
   *  @param {number} h 高度（px）
   *  @author 火 冰 */
  function syncImageSizeToUrl(img, w, h) {
    if (!img || w <= 0 || h <= 0) return;
    var src = img.getAttribute('src') || '';
    var info = parseImageUrlSize(src);
    var newUrl = buildImageUrlSize(info.baseUrl, w, h);

    /* IR 模式：更新 .vditor-ir__marker--link 中的 URL 文本 */
    var irContainer = img.closest('[data-type="img"]');
    if (irContainer) {
      var linkEl = irContainer.querySelector('.vditor-ir__marker--link');
      if (linkEl) linkEl.textContent = newUrl;
    }

    /* 更新 img 的 src（保留参数用于持久化） */
    img.setAttribute('src', newUrl);

    /* 触发编辑区 input 事件，让 Vditor 重新序列化并同步 */
    var editor = document.querySelector('.vditor-ir') || document.querySelector('.vditor-wysiwyg');
    if (editor) {
      try { editor.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* 忽略 */ }
    }
  }

  /* ---------- 图片点击选中 + 拖拽调整尺寸 ---------- */

  let selectedImg = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartW = 0;
  let dragStartH = 0;
  let dragHandle = null;
  let isDragging = false;

  /** 选中图片（显示边框 + 右下角拖拽手柄）
   *  @param {HTMLImageElement} img 图片元素
   *  @author 火 冰 */
  function selectImage(img) {
    deselectImage();
    if (!img) return;
    selectedImg = img;
    img.classList.add('mde-img-selected');

    dragHandle = document.createElement('div');
    dragHandle.id = 'mde-img-resize-handle';
    dragHandle.style.cssText = 'position:absolute;z-index:100;'
      + 'width:12px;height:12px;'
      + 'background:var(--note-brand-600,#7C3AED);'
      + 'border:2px solid #fff;border-radius:50%;'
      + 'cursor:nwse-resize;'
      + 'box-shadow:0 1px 4px rgba(0,0,0,.3);';

    /* 圆点定位到图片右下角：用 img 相对于 offsetParent 的位置计算 */
    var offsetParent = img.offsetParent;
    if (offsetParent) {
      dragHandle.style.left = (img.offsetLeft + img.offsetWidth - 6) + 'px';
      dragHandle.style.top = (img.offsetTop + img.offsetHeight - 6) + 'px';
      offsetParent.style.position = offsetParent.style.position || 'relative';
      offsetParent.appendChild(dragHandle);
    } else {
      /* 回退：用 fixed 定位到视口右下角 */
      var rect = img.getBoundingClientRect();
      dragHandle.style.position = 'fixed';
      dragHandle.style.left = (rect.right - 6) + 'px';
      dragHandle.style.top = (rect.bottom - 6) + 'px';
      document.body.appendChild(dragHandle);
    }

    dragHandle.addEventListener('mousedown', startDrag);
    document.addEventListener('mousemove', onDrag);
    document.addEventListener('mouseup', endDrag);
  }

  /** 取消选中图片 */
  function deselectImage() {
    if (selectedImg) {
      selectedImg.classList.remove('mde-img-selected');
      selectedImg = null;
    }
    if (dragHandle) {
      dragHandle.remove();
      dragHandle = null;
    }
    document.removeEventListener('mousemove', onDrag);
    document.removeEventListener('mouseup', endDrag);
    isDragging = false;
  }

  /** 开始拖拽
   *  @param {MouseEvent} e 鼠标事件 */
  function startDrag(e) {
    if (!selectedImg) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartW = selectedImg.offsetWidth;
    dragStartH = selectedImg.offsetHeight;
    selectedImg.style.opacity = '0.7';
  }

  /** 拖拽中：更新图片尺寸和圆点位置
   *  @param {MouseEvent} e 鼠标事件 */
  function onDrag(e) {
    if (!isDragging || !selectedImg) return;
    var dx = e.clientX - dragStartX;
    var dy = e.clientY - dragStartY;
    var newW = Math.max(20, dragStartW + dx);
    var newH = Math.max(20, dragStartH + dy);
    selectedImg.style.width = newW + 'px';
    selectedImg.style.height = newH + 'px';
    /* 圆点跟随图片右下角 */
    if (dragHandle) {
      var offsetParent = selectedImg.offsetParent;
      if (offsetParent && dragHandle.offsetParent === offsetParent) {
        dragHandle.style.left = (selectedImg.offsetLeft + newW - 6) + 'px';
        dragHandle.style.top = (selectedImg.offsetTop + newH - 6) + 'px';
      } else {
        var rect = selectedImg.getBoundingClientRect();
        dragHandle.style.left = (rect.right - 6) + 'px';
        dragHandle.style.top = (rect.bottom - 6) + 'px';
      }
    }
  }

  /** 结束拖拽：同步尺寸到 URL 参数
   *  @param {MouseEvent} e 鼠标事件 */
  function endDrag(e) {
    if (!isDragging || !selectedImg) return;
    isDragging = false;
    selectedImg.style.opacity = '1';
    /* 拖拽结束后将尺寸写入 URL 参数 */
    var w = Math.round(selectedImg.offsetWidth);
    var h = Math.round(selectedImg.offsetHeight);
    syncImageSizeToUrl(selectedImg, w, h);
  }

  /** 初始化：绑定右键菜单和点击事件 */
  function init() {
    // 右键菜单处理
    document.addEventListener('contextmenu', function (e) {
      // 检测右键是否命中链接（WYSIWYG: <a href>; IR: <span data-type="a">）
      console.log('[MDE] contextmenu: target=', e.target?.tagName, 'class=', e.target?.className, 'data-type=', e.target?.getAttribute?.('data-type'));
      var link = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      var irLink = !link ? closestIRLink(e.target) : null;
      var hitLink = link || irLink;
      console.log('[MDE] contextmenu: link=', !!link, 'irLink=', !!irLink, 'hitLink=', !!hitLink);
      if (hitLink) {
        var href = getLinkUrl(hitLink);
        console.log('[MDE] contextmenu: href=', href, 'isHttp=', /^https?:\/\//i.test(href));
        if (/^https?:\/\//i.test(href)) {
          const menu = document.createElement('div');
          menu.style.cssText = 'position:fixed;z-index:200;min-width:160px;'
            + 'background:var(--note-surface-2,#fff);border:1px solid var(--note-border,#e0e0e0);'
            + 'border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:4px 0;';

          const openItem = document.createElement('button');
          openItem.type = 'button';
          openItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
            + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
            + 'font-size:13px;text-align:left;cursor:pointer;';
          openItem.innerHTML = '<i data-lucide="external-link" class="w-4 h-4"></i><span>浏览器打开</span>';
          openItem.addEventListener('click', function () {
            window.open(href, '_blank');
            menu.remove();
          });
          openItem.addEventListener('mouseover', function () { openItem.style.background = 'rgba(0,0,0,.06)'; });
          openItem.addEventListener('mouseout', function () { openItem.style.background = 'transparent'; });

          const unlinkItem = document.createElement('button');
          unlinkItem.type = 'button';
          unlinkItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
            + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
            + 'font-size:13px;text-align:left;cursor:pointer;';
          unlinkItem.innerHTML = '<i data-lucide="unlink" class="w-4 h-4"></i><span>取消链接</span>';
          unlinkItem.addEventListener('click', function () {
            unlinkAtCaret(hitLink);
            menu.remove();
          });
          unlinkItem.addEventListener('mouseover', function () { unlinkItem.style.background = 'rgba(0,0,0,.06)'; });
          unlinkItem.addEventListener('mouseout', function () { unlinkItem.style.background = 'transparent'; });

          menu.appendChild(openItem);
          menu.appendChild(unlinkItem);
          document.body.appendChild(menu);

          const rect = menu.getBoundingClientRect();
          menu.style.left = Math.min(Math.max(8, e.clientX), Math.max(8, window.innerWidth - rect.width)) + 'px';
          menu.style.top = Math.min(Math.max(8, e.clientY), Math.max(8, window.innerHeight - rect.height)) + 'px';

          e.preventDefault();
          e.stopPropagation();

          const closeMenu = function () {
            menu.remove();
            document.removeEventListener('click', closeMenu);
          };
          setTimeout(function () {
            document.addEventListener('click', closeMenu);
          }, 0);
          return;
        }
      }

      // 检测右键是否命中图片
      const img = e.target && e.target.closest ? e.target.closest('img') : null;
      if (img) {
        const src = img.getAttribute('src') || '';
        const menu = document.createElement('div');
        menu.style.cssText = 'position:fixed;z-index:200;min-width:160px;'
          + 'background:var(--note-surface-2,#fff);border:1px solid var(--note-border,#e0e0e0);'
          + 'border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.15);padding:4px 0;';

        const downloadItem = document.createElement('button');
        downloadItem.type = 'button';
        downloadItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
          + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
          + 'font-size:13px;text-align:left;cursor:pointer;';
        downloadItem.innerHTML = '<i data-lucide="download" class="w-4 h-4"></i><span>下载</span>';
        downloadItem.addEventListener('click', function () {
          downloadImage(src);
          menu.remove();
        });
        downloadItem.addEventListener('mouseover', function () { downloadItem.style.background = 'rgba(0,0,0,.06)'; });
        downloadItem.addEventListener('mouseout', function () { downloadItem.style.background = 'transparent'; });

        const sizeItem = document.createElement('button');
        sizeItem.type = 'button';
        sizeItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
          + 'padding:6px 12px;border:none;background:transparent;color:var(--note-ink,#333);'
          + 'font-size:13px;text-align:left;cursor:pointer;';
        sizeItem.innerHTML = '<i data-lucide="image" class="w-4 h-4"></i><span>设置尺寸</span>';
        sizeItem.addEventListener('click', function () {
          openImageSizeDialog(img);
          menu.remove();
        });
        sizeItem.addEventListener('mouseover', function () { sizeItem.style.background = 'rgba(0,0,0,.06)'; });
        sizeItem.addEventListener('mouseout', function () { sizeItem.style.background = 'transparent'; });

        menu.appendChild(downloadItem);
        menu.appendChild(sizeItem);

        /* 删除图片：移除编辑区 DOM + 删除物理文件 + 同步 markdown */
        const deleteItem = document.createElement('button');
        deleteItem.type = 'button';
        deleteItem.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;'
          + 'padding:6px 12px;border:none;background:transparent;color:var(--note-danger,#dc2626);'
          + 'font-size:13px;text-align:left;cursor:pointer;';
        deleteItem.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i><span>删除图片</span>';
        deleteItem.addEventListener('click', function () {
          deleteImageFromEditor(img);
          menu.remove();
        });
        deleteItem.addEventListener('mouseover', function () { deleteItem.style.background = 'rgba(0,0,0,.06)'; });
        deleteItem.addEventListener('mouseout', function () { deleteItem.style.background = 'transparent'; });
        menu.appendChild(deleteItem);

        document.body.appendChild(menu);

        const rect = menu.getBoundingClientRect();
        menu.style.left = Math.min(Math.max(8, e.clientX), Math.max(8, window.innerWidth - rect.width)) + 'px';
        menu.style.top = Math.min(Math.max(8, e.clientY), Math.max(8, window.innerHeight - rect.height)) + 'px';

        e.preventDefault();
        e.stopPropagation();

        const closeMenu = function () {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        };
        setTimeout(function () {
          document.addEventListener('click', closeMenu);
        }, 0);
        return;
      }
    }, true);

    // 点击图片选中
    document.addEventListener('click', function (e) {
      const img = e.target && e.target.closest ? e.target.closest('img') : null;
      if (img && !e.target.closest('a[href]')) {
        e.preventDefault();
        e.stopPropagation();
        selectImage(img);
      } else if (!e.target.closest('#mde-img-resize-handle')) {
        deselectImage();
      }
    }, true);

    /* 图片加载时解析 URL 参数按尺寸显示 */
    document.addEventListener('load', function (e) {
      if (e.target && e.target.tagName === 'IMG') {
        applyImageSizeFromUrl(e.target);
      }
    }, true);

    /* MutationObserver：新插入的图片解析 URL 参数 */
    if (typeof MutationObserver === 'function') {
      var imgObserver = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var added = mutations[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'IMG') {
              applyImageSizeFromUrl(node);
            } else if (node.querySelectorAll) {
              var imgs = node.querySelectorAll('img');
              for (var k = 0; k < imgs.length; k++) {
                applyImageSizeFromUrl(imgs[k]);
              }
            }
          }
        }
      });
      imgObserver.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }

    // 按 ESC 取消选中
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        deselectImage();
        closeImageSizeDialog();
      }
    });
  }

  // 暴露到全局
  window.mdeUnlinkAtCaret = unlinkAtCaret;
  window.mdeDownloadImage = downloadImage;
  window.mdeOpenImageSizeDialog = openImageSizeDialog;
  window.mdeInitEnhance = init;
  window.mdeDeleteImageFromEditor = deleteImageFromEditor;
  window.mdeParseImageUrlSize = parseImageUrlSize;
  window.mdeBuildImageUrlSize = buildImageUrlSize;
  window.mdeApplyImageSizeFromUrl = applyImageSizeFromUrl;
  window.mdeSyncImageSizeToUrl = syncImageSizeToUrl;

  // 自动初始化
  init();
})();