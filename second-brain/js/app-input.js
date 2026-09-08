/* ============================================
 * 第二脑 — 输入模态框 & confirm 垫片
 * 作者: 火 冰
 * 功能:
 *   - window.inputModal({title, placeholder, value}) -> Promise<string|null>
 *     提供 DOM 输入框，替换 Electron 中不支持的 window.prompt。
 *   - 覆盖 window.confirm：桌面端走 noteDesktop.confirm（主进程原生对话框，同步返回）；
 *     网页端降级为原生 confirm；均不存在时返回 false，避免删除等确认静默失效。
 * 说明: 本模块不依赖业务脚本，置于 index.html 脚本区最前（app-log.js 之后）。
 * ============================================ */

(function () {
  'use strict';

  /* 生成一个通用按钮（模态框底部操作：确定/取消），带悬停微交互。
   * @param {string} text 按钮文字
   * @param {string} bg 背景色
   * @param {string} fg 前景(文字)色
   * @returns {HTMLElement} 按钮元素
   * 作者: 火 冰 */
  function docButton(text, bg, fg) {
    var b = document.createElement('button');
    b.textContent = text;
    b.style.cssText = 'padding:6px 14px;border:0;border-radius:8px;font:500 13px/1 system-ui,sans-serif;cursor:pointer;background:' + bg + ';color:' + fg + ';';
    b.addEventListener('mouseenter', function () { b.style.opacity = '.85'; });
    b.addEventListener('mouseleave', function () { b.style.opacity = '1'; });
    return b;
  }

  /* 生成一个单行文本输入模态框，返回用户输入；取消/关闭返回 null
   * @param {object} opts { title, placeholder, value }
   * @returns {Promise<string|null>}
   * 作者: 火 冰 */
  function inputModal(opts) {
    return new Promise(function (resolve) {
      // 覆盖层
      var ov = document.createElement('div');
      ov.id = 'sb-input-ov';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9996;background:rgba(15,16,20,.45);display:flex;align-items:center;justify-content:center;';
      // 卡片
      var card = document.createElement('div');
      card.style.cssText = 'width:340px;max-width:calc(100vw-32px);background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.28);padding:18px 20px 16px;';
      var title = document.createElement('div');
      title.style.cssText = 'font:600 14px/1.2 system-ui,sans-serif;color:#1f2328;margin-bottom:12px;';
      title.textContent = (opts && opts.title) || '请输入';
      var input = document.createElement('input');
      input.type = 'text';
      input.value = (opts && opts.value) || '';
      if (opts && opts.placeholder) input.placeholder = opts.placeholder;
      input.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;font:14px/1.4 system-ui,sans-serif;color:#1f2328;outline:none;background:#fff;margin-bottom:14px;';
      input.addEventListener('focus', function () { this.select(); });
      // 按钮行
      var btns = document.createElement('div');
      btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
      var btnCancel = docButton('取消', '#eff1f3', '#1f2328');
      var btnOk = docButton('确定', '#2563eb', '#fff');
      btns.appendChild(btnCancel); btns.appendChild(btnOk);

      card.appendChild(title); card.appendChild(input); card.appendChild(btns);
      ov.appendChild(card); document.body.appendChild(ov);

      var done = false;
      function close(val) {
        if (done) return; done = true;
        document.body.removeChild(ov);
        resolve(val);
      }
      btnCancel.addEventListener('click', function () { close(null); });
      btnOk.addEventListener('click', function () { close(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') close(input.value);
        else if (e.key === 'Escape') close(null);
      });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(null); });
      input.focus();
    });
  }

  /* 安装 confirm 垫片：桌面端用主进程原生对话框（同步），网页端保持原生 confirm
   * 作者: 火 冰 */
  function installConfirm() {
    try {
      if (window.noteDesktop && typeof window.noteDesktop.confirm === 'function') {
        window.confirm = function (msg) { return window.noteDesktop.confirm(msg); };
      } else {
        // 网页端：原生 confirm 可用则保留；否则返回 false（仅防崩溃，不做假弹窗）
        if (typeof window.confirm !== 'function' && typeof window.alert === 'function') {
          window.confirm = function () { return false; };
        }
      }
    } catch (_) { /* 垫片失败不影响启动 */ }
  }

  /* 生成一个双输入模态框（链接文字 + URL），返回确定值；取消/关闭返回 null
   * @param {object} opts { title, text, value, placeholder }
   * @returns {Promise<{text:string,url:string}|null>} 确定返回 {text,url}（url 为空视为取消）；取消返回 null
   * 作者: 火 冰 */
  function inputLinkModal(opts) {
    return new Promise(function (resolve) {
      // 覆盖层（与 inputModal 一致的 z-index/背景）
      const ov = document.createElement('div');
      ov.id = 'sb-link-ov';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9997;background:rgba(15,16,20,.45);display:flex;align-items:center;justify-content:center;';
      // 卡片
      const card = document.createElement('div');
      card.style.cssText = 'width:340px;max-width:calc(100vw-32px);background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.28);padding:18px 20px 16px;';
      const title = document.createElement('div');
      title.style.cssText = 'font:600 14px/1.2 system-ui,sans-serif;color:#1f2328;margin-bottom:12px;';
      title.textContent = (opts && opts.title) || '插入链接';
      // 两个输入框：链接文字 + URL
      const mkInput = function (val, ph) {
        const i = document.createElement('input');
        i.type = 'text';
        i.value = val || '';
        if (ph) i.placeholder = ph;
        i.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d0d7de;border-radius:8px;font:14px/1.4 system-ui,sans-serif;color:#1f2328;outline:none;background:#fff;margin-bottom:10px;';
        i.addEventListener('focus', function () { this.select(); });
        return i;
      };
      const inputText = mkInput(opts && opts.text, '链接文字');
      const inputUrl = mkInput((opts && opts.value) || 'https://', '链接地址（URL）');
      // 按钮行
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
      const btnCancel = docButton('取消', '#eff1f3', '#1f2328');
      const btnOk = docButton('确定', '#2563eb', '#fff');
      btns.appendChild(btnCancel); btns.appendChild(btnOk);

      card.appendChild(title); card.appendChild(inputText); card.appendChild(inputUrl); card.appendChild(btns);
      ov.appendChild(card); document.body.appendChild(ov);

      var done = false;
      function close(val) {
        if (done) return; done = true;
        document.body.removeChild(ov);
        resolve(val);
      }
      btnCancel.addEventListener('click', function () { close(null); });
      btnOk.addEventListener('click', function () {
        const url = inputUrl.value.trim();
        if (!url) return close(null);            // url 为空视为取消
        close({ text: inputText.value.trim(), url: url });
      });
      inputUrl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { const url = inputUrl.value.trim(); if (!url) return close(null); close({ text: inputText.value.trim(), url: url }); }
        else if (e.key === 'Escape') close(null);
      });
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(null); });
      inputText.focus();
    });
  }

  // 挂到全局（后续模块统一用 window.inputModal / inputLinkModal 替代 window.prompt）
  window.inputModal = inputModal;
  window.inputLinkModal = inputLinkModal;
  installConfirm();
})();