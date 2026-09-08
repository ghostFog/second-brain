/* ============================================
 * 第二脑 — 全局运行日志与错误捕获
 * 作者: 火 冰
 * 功能:
 *   - 在应用最早执行，注册 window.onerror / unhandledrejection 全局捕获
 *   - 提供 window.SBLog 日志接口（info/warn/error），供任意模块记录关键事件
 *   - 桌面端经 noteDesktop.log 落盘到 userData/logs/app.log；网页端降级写 localStorage 环形缓冲
 *   - 出现未捕获错误时在页面角落显示红色计数徽标（点击弹出最近日志），避免"界面空白却看不到报错"
 * 说明: 本模块不依赖任何后续加载的脚本，放在 index.html 脚本区最前。
 * ============================================ */

(function () {
  'use strict';

  var MAX_KEPT = 200;              // localStorage 环形日志上限条数
  var LS_KEY = 'sb:log';           // 网页端日志存储键
  var errorCount = 0;              // 当前会话未捕获错误计数
  var recent = [];                 // 本会话日志环形缓冲（内存），便于徽标点开时展示

  /* 添加一条日志
   * @param {string} level info|warn|error|fatal
   * @param {string} msg    日志正文
   * @param {string} detail 可选堆栈/补充信息
   * 作者: 火 冰 */
  function log(level, msg, detail) {
    try {
      if (level === 'error' || level === 'fatal') errorCount++;
      recent.push({ level: level, msg: msg, detail: detail || '' });
      if (recent.length > MAX_KEPT) recent.splice(0, recent.length - MAX_KEPT);
      // 记录原始 detail 堆栈（跨行）时压缩为单行便于落盘
      const one = String(detail || '').replace(/\n/g, ' | ');
      // 桌面端：经 IPC 落盘；网页端：localStorage 环形
      if (window.noteDesktop && window.noteDesktop.log) {
        try { window.noteDesktop.log(level, msg, one); } catch (_) { /* 忽略 */ }
      } else {
        try {
          const arr = (JSON.parse(localStorage.getItem(LS_KEY) || '[]'));
          arr.push({ t: Date.now(), level: level, msg: msg, detail: one });
          while (arr.length > MAX_KEPT) arr.shift();
          localStorage.setItem(LS_KEY, JSON.stringify(arr));
        } catch (_) { /* 忽略 */ }
      }
      if (level === 'error' || level === 'fatal') showBadge();
    } catch (_) { /* 日志系统自身异常不得外抛 */ }
  }

  /* 页面角落错误徽标：未捕获错误时显示红色计数，点击弹出最近日志
   * 作者: 火 冰 */
  function showBadge() {
    try {
      let badge = document.getElementById('sb-log-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.id = 'sb-log-badge';
        badge.style.cssText = 'position:fixed;right:10px;bottom:10px;z-index:9999;background:#DC2626;color:#fff;font:12px/1 system-ui,sans-serif;padding:4px 9px;border-radius:999px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.35);opacity:.92;';
        badge.title = '查看运行日志';
        badge.addEventListener('click', function () { showLogPanel(); });
        (document.body || document.documentElement).appendChild(badge);
      }
      badge.textContent = errorCount + ' 个错误';
    } catch (_) { /* 忽略 */ }
  }

  /* 自绘日志查看面板：Electron 不支持 window.prompt，改用 DOM 浮层展示本会话日志
   * 作者: 火 冰 */
  function showLogPanel() {
    try {
      var ov = document.createElement('div');
      ov.id = 'sb-log-panel-ov';
      ov.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(15,16,20,.45);display:flex;align-items:center;justify-content:center;';
      var card = document.createElement('div');
      card.style.cssText = 'width:520px;max-width:calc(100vw - 40px);background:#fff;border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.28);padding:16px 18px;box-sizing:border-box;';
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;';
      var ti = document.createElement('div');
      ti.style.cssText = 'font:600 14px/1.2 system-ui,sans-serif;color:#1f2328;';
      ti.textContent = '运行日志（本会话）';
      var closeBtn = document.createElement('button');
      closeBtn.textContent = '关闭';
      closeBtn.style.cssText = 'padding:5px 12px;border:0;border-radius:7px;font:500 12px/1 system-ui,sans-serif;cursor:pointer;background:#eff1f3;color:#1f2328;';
      head.appendChild(ti); head.appendChild(closeBtn);
      var ta = document.createElement('textarea');
      ta.readOnly = true;
      ta.value = recent.map(function (r) {
        return '[' + r.level + '] ' + r.msg + (r.detail ? '  ' + r.detail : '');
      }).join('\n');
      ta.style.cssText = 'width:100%;box-sizing:border-box;height:300px;resize:vertical;padding:10px;border:1px solid #d0d7de;border-radius:8px;font:12px/1.5 Consolas,monospace;color:#1f2328;background:#f6f8fa;outline:none;white-space:pre;overflow:auto;';
      card.appendChild(head); card.appendChild(ta); ov.appendChild(card); document.body.appendChild(ov);
      function close() { if (ov.parentNode) ov.parentNode.removeChild(ov); }
      closeBtn.addEventListener('click', close);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    } catch (_) { /* 面板失败不影响应用 */ }
  }

  /* 全局错误捕获：脚本加载/运行期未捕获异常均记录到日志
   * 作者: 火 冰 */
  function hookGlobal() {
    window.addEventListener('error', function (e) {
      const msg = e && (e.message || e.error && e.error.message) || '未知脚本错误';
      const loc = (e && e.message && e.filename) ? (' @ ' + e.filename + (e.lineno ? ':' + e.lineno : '')) : '';
      const stack = e && e.error && e.error.stack || '';
      log('error', '未捕获错误: ' + msg + loc, stack);
    });
    window.addEventListener('unhandledrejection', function (e) {
      const r = e && e.reason;
      const msg = (r && (r.message || r)) || '未知 Promise 异常';
      const stack = (r && r.stack) || '';
      log('error', '未处理 Promise 异常: ' + msg, stack);
    });
  }

  // 暴露日志接口（挂到全局，供后续模块随时调用）
  window.SBLog = {
    info: function (msg, detail) { log('info', msg, detail); },
    warn: function (msg, detail) { log('warn', msg, detail); },
    error: function (msg, detail) { log('error', msg, detail); },
    fatal: function (msg, detail) { log('fatal', msg, detail); },
    getLogs: function () { return recent.slice(); },
    errorCount: function () { return errorCount; },
  };

  hookGlobal();
})();