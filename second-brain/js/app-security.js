/* ============================================
 * 第二脑 — 应用安全（SEC-01 启动密码 / SEC-02 超时锁定）
 * 作者: 火 冰
 * 功能: 全屏遮罩 #lock-screen 的显示/隐藏；启动时若已设密码且未解锁则
 *       锁定主界面（body.locked 隐藏主视图防内容泄露）；解锁成功后恢复。
 *       桌面端锁定事件经 noteDesktop.security.onLocked 由主进程推送；
 *       网页版（无主进程）用本地空闲计时器兜底触发锁定。
 * 说明: 依赖 index.html 中的 #lock-screen 与 #lock-unlock/#lock-pwd。
 *       被 loadView 等启动即执行；设置页经 window.SBSecurity 访问本模块。
 * ============================================ */
(function () {
  const nd = (typeof window !== 'undefined' && window.noteDesktop) || null;

  /* 取遮罩相关 DOM 节点（每次即时查询，避免 DOM 重建后引用失效）。
   * @returns {Object} 遮罩与输入元素引用 */
  function els() {
    return {
      screen: document.getElementById('lock-screen'),
      pwd: document.getElementById('lock-pwd'),
      btn: document.getElementById('lock-unlock'),
      err: document.getElementById('lock-err'),
    };
  }

  let inited = false;
  let idleTimer = null;       // 网页版空闲计时器句柄
  let idleSeconds = 0;        // 网页版累计空闲秒数
  const IDLE_POLL_MS = 10000; // 网页版空闲轮询（10s），对照锁定阈值按分钟换算
  let needLock = false;       // 本窗口是否处于「需锁定」态（主进程/可见性恢复置位，解锁成功后复位）

  const S = {
    /* 当前是否显示遮罩 */
    get visible() { const e = els().screen; return !!(e && e.style.display !== 'none'); },
  };

  // 启动同步锁（SEC-01）：preload 用 sendSync 在窗口首帧 paint 前拿到「需锁定」，
  // 立即对主视图加 body.locked 隐藏工作区，并在 DOM 就绪后显示遮罩，
  // 规避启动/托盘召回时「先闪内容再弹密码框」。相比 init 里的异步 getState，此为同步首帧前置。
  //  @author 火 冰
  (function () {
    const sc = (nd && nd.security && typeof nd.security.getStateSync === 'function')
      ? nd.security.getStateSync() : null;
    if (sc && sc.hasPwd && !sc.unlocked) {
      needLock = true;
      const mark = function () { if (document.body) document.body.classList.add('locked'); };
      if (document.body) mark(); else document.addEventListener('DOMContentLoaded', mark, { once: true });
      document.addEventListener('DOMContentLoaded', function () { showLock(); }, { once: true });
    }
  })();

  /* 展示遮罩：隐藏主视图（body.locked 由 CSS 控制），清空密码输入，聚焦输入框。
   * @author 火 冰 */
  function showLock() {
    const e = els();
    if (!e.screen) return;
    e.screen.style.display = 'flex';
    document.body.classList.add('locked');
    if (e.err) e.err.textContent = '';
    if (e.pwd) { e.pwd.value = ''; try { e.pwd.focus(); } catch (_) {} }
  }

  /* 隐藏遮罩并恢复主界面。
   * @author 火 冰 */
  function hideLock() {
    const e = els();
    if (e.screen) e.screen.style.display = 'none';
    document.body.classList.remove('locked');
    if (e.pwd) e.pwd.value = '';
  }

  /* 尝试解锁：调用主进程解锁（无主进程则视作已解锁）。成功隐藏遮罩，失败提示。
   * @param {string} pwd 用户输入密码
   * @returns {Promise<boolean>} 是否解锁成功
   * @author 火 冰 */
  async function tryUnlock(pwd) {
    if (nd && nd.security && nd.security.unlock) {
      try { return !!(await nd.security.unlock(pwd)); }
      catch (e) { if (window.SBLog) window.SBLog.warn('[security] unlock: ' + e); return false; }
    }
    return true; // 网页版无主进程：直接放行
  }

  /* 绑定遮罩解锁按钮与回车确认。
   * @author 火 冰 */
  function bindLockActions() {
    const e = els();
    if (!e.screen || !e.btn) return;
    const doUnlock = async function () {
      const ok = await tryUnlock(e.pwd ? e.pwd.value : '');
      if (ok) {
        needLock = false; // 解锁成功：本窗口不再需要锁定
        resetIdle(); // 解锁成功重置网页版空闲计时
        hideLock();
        // 锁屏解锁成功（应用密码明文已进主进程内存作为笔记加密组合解密的盐）：
        // 触发笔记加密解锁重检——锁屏前误判 locked 的库，此时盐已定，可自动解锁则不弹笔记密码遮罩
        if (typeof window !== 'undefined' && window.SBEncUnlock && typeof window.SBEncUnlock.recheck === 'function') {
          try { window.SBEncUnlock.recheck(); } catch (e) { /* 忽略重检异常 */ }
        }
        // 锁屏解锁成功（盐=应用密码明文已定）：当前打开的笔记若因「盐未定」显示密文，重载它以自动解密
        // （能解开则显示明文；仍解不开=旧密码加密，由 openNote 密文检测在已解锁状态下弹修复框）。作者: 火 冰
        try {
          const cur = (typeof edCurrent !== 'undefined') ? edCurrent : null;
          const cache = (typeof edOutdated !== 'undefined') ? edOutdated : null;
          const curRaw = (cur && cache && cur in cache) ? cache[cur] : null;
          if (cur && typeof curRaw === 'string' && curRaw.indexOf('ENC1:') === 0) {
            if (typeof reloadNote === 'function') reloadNote(cur);
            else if (typeof openNote === 'function') openNote(cur);
          }
        } catch (e) { /* 重载失败不影响解锁流程 */ }
      } else if (e.err) {
        e.err.textContent = '密码错误，请重试';
        if (e.pwd) { e.pwd.value = ''; try { e.pwd.focus(); } catch (_) {} }
      }
    };
    e.btn.addEventListener('click', doUnlock);
    if (e.pwd) e.pwd.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') doUnlock();
    });
    // 关闭按钮：不输入密码也可关闭窗口（是否退出/缩托盘由「设置-关闭行为」控制）
    const cc = document.getElementById('lock-close');
    if (cc) cc.addEventListener('click', function () { if (nd && nd.close) nd.close(); });
  }

  /* 重置网页版空闲计时（任何用户活动信号触发）。
   * @author 火 冰 */
  function resetIdle() { idleSeconds = 0; }

  /* 网页版空闲兜底：主进程不可用时，本地轮询累计空闲秒数，达到阈值且满足锁定条件则锁定。
   * @author 火 冰 */
  function startWebIdleTimer() {
    if (idleTimer || (nd && nd.security)) return; // 桌面优先由主进程 powerMonitor 负责
    const acts = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'wheel'];
    acts.forEach(function (t) { window.addEventListener(t, resetIdle, { passive: true }); });
    idleTimer = setInterval(async function () {
      let cfg = null;
      try { cfg = nd && nd.security ? await nd.security.getState() : null; } catch (_) {}
      if (!cfg) return;
      if (!cfg.hasPwd || cfg.visible || !cfg.lockEnabled) return; // 未设密码/已锁/未开则不锁
      idleSeconds += IDLE_POLL_MS / 1000;
      if (idleSeconds >= (cfg.lockMinutes || 10) * 60) { idleSeconds = 0; showLock(); }
    }, IDLE_POLL_MS);
  }

  /* 初始化：绑定解锁交互、订阅桌面锁定推送、启动网页版空闲兜底、执行启动检查、
   * 并监听可见性变化兜底锁定，消除「托盘还原/最小化恢复时先闪现内容再弹密码框」的闪烁。
   * @author 火 冰 */
  async function init() {
    if (inited) return; inited = true;
    bindLockActions();
    // 桌面端订阅主进程锁定推送（powerMonitor 超时 / 托盘召回）
    if (nd && nd.security && nd.security.onLocked) {
      nd.security.onLocked(function () { needLock = true; showLock(); });
    }
    startWebIdleTimer();
    // 窗口由隐藏/最小化恢复可见（托盘召回）：设了密码则立即锁定。
    // visibilitychange 在渲染新帧前触发，先于工作区内容 paint，避免「先显示内容再出密码框」的闪烁
    document.addEventListener('visibilitychange', function () {
      resetIdle();
      if (document.visibilityState !== 'visible') return;
      if (needLock) { showLock(); return; }
      if (nd && nd.security && nd.security.getState) {
        nd.security.getState().then(function (cfg) {
          if (cfg && cfg.hasPwd && !cfg.unlocked) { needLock = true; showLock(); }
        }).catch(function () {});
      }
    });
    // 启动检查：已设密码且未解锁则先锁主界面
    if (nd && nd.security && nd.security.getState) {
      try {
        const cfg = await nd.security.getState();
        if (cfg && cfg.hasPwd && !cfg.unlocked) { needLock = true; showLock(); }
      } catch (_) { /* 主进程暂不可用则放行 */ }
    }
    // 供设置页/测试访问，暴露可控的最小接口
    if (typeof window !== 'undefined') window.SBSecurity = { showLock: showLock, hideLock: hideLock, resetIdle: resetIdle, visible: S.visible };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', function () {
      try { init(); } catch (e) { if (window.SBLog) window.SBLog.warn('[security] init: ' + e); }
    });
  }
})();