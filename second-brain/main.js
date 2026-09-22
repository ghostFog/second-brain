/* ============================================
 * 第二脑 桌面版 — Electron 主进程
 * 作者: 火 冰
 * 功能: 创建主窗口、注册自定义协议 note:// 以支持
 *       在 file 环境通过 fetch 加载本地视图文件
 * ============================================ */
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, session, Tray, nativeImage, screen, powerMonitor } = require('electron');
const { AsyncLocalStorage } = require('node:async_hooks'); // 多窗口：IPC 请求链内按窗口解析知识库根
const path = require('path');
const fs = require('fs');
const { randomUUID, scrypt, randomBytes, timingSafeEqual } = require('crypto'); // randomUUID: 上传资源重命名；scrypt/randomBytes/timingSafeEqual: 应用安全（SEC-01/02）密码哈希与校验
const { execFile } = require('child_process'); // Git 同步插件：以非 shell 方式执行 git 命令，避免注入
const grayMatter = require('gray-matter'); // 解析笔记 frontmatter（获取 id / tags 元数据）
const { default: SnowflakeId } = require('snowflake-id'); // 雪花算法：生成全局唯一文档 id，方便索引/元数据稳定定位
const { AiEngine, chunkConfigured } = require('./ai-engine');

/* 主进程 console 日志桥接到渲染进程（F12 控制台 / 日志面板可见）：
 * 「打印完整提示词」等主进程调试日志保留终端输出，同时转发给所有窗口 webContents
 * （渲染进程 app-log.js 监听 main:log → SBLog.info + console.log） */
(function bridgeMainConsole() {
  const rawLog = console.log.bind(console);
  console.log = function () {
    rawLog.apply(console, arguments);
    try {
      const text = Array.prototype.map.call(arguments, String).join(' ');
      BrowserWindow.getAllWindows().forEach(function (w) {
        if (!w.isDestroyed()) w.webContents.send('main:log', text);
      });
    } catch (_) { /* 转发失败不影响主进程 */ }
  };
})();

/* 项目根目录（即本文件所在目录） */
const ROOT = __dirname;

/** 单实例锁：防止多个实例并发启动。
 * 现象：若用户在托盘（窗口隐藏但进程存活）或上次异常退出残留时再次双击启动，会出现两个
 * 实例同时运行，渲染进程争用磁盘 IO/CPU，导致第二个实例「第一次启动要十几秒」。
 * 加锁后：新实例发现已有实例，直接让旧实例的窗口恢复并聚焦，随后自身退出，避免并发争用。
 * @author 火 冰 */
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit(); // 已有实例在运行：本实例直接退出
}
else {
  // 已有实例收到用户再次启动的请求（双击图标/托盘恢复/系统「打开方式」传入文件等）：
  // 恢复并聚焦主窗口；若 commandLine 携带外部文件，则作为临时文件打开
  app.on('second-instance', function (_e, commandLine) {
    const abs = pickOpenWithArg(commandLine);
    if (abs) { openWithFile(abs); return; }
    showMainWindow();
  });
}

/* 在 app 就绪前声明 note 协议为 standard/secure，并启用 fetch 与跨源，
 * 否则页面内的相对 URL、fetch 和脚本加载会被安全策略拦截 */
protocol.registerSchemesAsPrivileged([
  { scheme: 'note', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/* 常见扩展名到 Content-Type 的映射 */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  // vditor 依赖的字体与 sourcemap 资源：避免 note:// 协议下返回 octet-stream / 控制台告警
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.map': 'application/json; charset=utf-8',
  // 上传资源（图片/附件）可能涉及的其它类型，避免 note:// 协议下以 octet-stream 返回
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

/* ---------- 自定义协议：note:// ---------- */

/**
 * 将 note:// 协议请求映射为磁盘上的本地文件并返回内容。
 * 这样页面中的 fetch('views/vault.html') 在桌面环境下也能正常工作，
 * 无需改动前端路由逻辑。
 */
function registerNoteProtocol() {
  protocol.handle('note', async (request) => {
    const url = new URL(request.url);
    // 解码并规范化路径片段，防御路径穿越
    const pathname = decodeURIComponent(url.pathname);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.includes('..')) return new Response('Forbidden', { status: 403 });

    // vault_res 主机 → 映射到知识库隐藏资源目录 .resources（上传的图片/附件，UUID 命名）
    // 其余主机（local 等）→ 映射到应用根目录（视图/依赖资源）
    const baseDir = (url.hostname === 'vault_res') ? path.join(vaultRoot(), RESOURCE_DIR) : ROOT;
    const filePath = path.join(baseDir, ...segments);
    try {
      const data = await fs.promises.readFile(filePath);
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      // 显式禁用缓存：避免拆分/升级后渲染进程命中旧 HTML/JS，导致界面空白与功能失效
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { 'Content-Type': type, 'Cache-Control': 'no-store', 'Pragma': 'no-cache' },
      });
    } catch (err) {
      return new Response('Not Found: ' + filePath, { status: 404 });
    }
  });
}

/* ---------- 创建主窗口 ---------- */
let mainWin = null; // 最近创建/聚焦的窗口（兼容引用；多窗口下每个库一个窗口）

/* 多窗口状态：每个窗口绑定自己的知识库根（null=跟随默认库「我的笔记库」）。
 * winVaults: webContentsId → 库根|null；vaultWinId: 库key(小写绝对路径) → winId（单库单窗口约束）；
 * activeVault: 最近聚焦窗口的库根（null=默认库），供 note:// 协议等无窗口上下文解析资源。 */
const winVaults = new Map();
const vaultWinId = new Map();
let activeVault = null;
const vaultCtx = new AsyncLocalStorage(); // IPC 请求上下文：链内 vaultRoot() 按发起窗口解析

/* 项目窗口状态：webContentsId → 项目根路径。项目为「非知识库工作区」，
 * 不建笔记索引/向量索引，文件树展示项目内全部文本文件，可编辑 + git 状态。 */
const winProjects = new Map();

/* 从 IPC event 定位发起窗口（renderer → BrowserWindow），取不到返回 null */
function winFromEvent(event) {
  const wc = event && event.sender;
  if (!wc || wc.isDestroyed()) return null;
  try { return BrowserWindow.fromWebContents(wc); } catch (e) { return null; }
}

/* 发起窗口绑定的知识库：null=跟随默认库，非 null=显式库根（不存在返回默认库根） */
function vaultRootForEvent(event) {
  const win = winFromEvent(event);
  const vp = win ? winVaults.get(win.webContents.id) : undefined;
  if (vp !== undefined) return vp || defaultVaultRoot();
  return defaultVaultRoot();
}

/* 窗口绑定的原始值（null 或库路径），供 vault:get 区分显示名「我的笔记库」 */
function windowVaultBinding(event) {
  const win = winFromEvent(event);
  return win ? (winVaults.get(win.webContents.id) ?? null) : null;
}

/* 库路径 → 去重键（Windows 忽略大小写） */
function vaultKey(root) { return path.resolve(root).toLowerCase(); }

/* 全量重建 库key → winId 映射，保证单库单窗口约束（窗口创建/关闭/迁移后调用） */
function syncVaultWinMap() {
  vaultWinId.clear();
  for (const [winId, vp] of winVaults) {
    const w = BrowserWindow.fromId(winId);
    if (!w || w.isDestroyed()) continue;
    const key = vaultKey(vp || defaultVaultRoot());
    if (!vaultWinId.has(key)) vaultWinId.set(key, winId);
  }
}

/* 显示并聚焦窗口：恢复任务栏显示 → 还原最小化 → show + focus */
function showWindow(w) {
  if (!w || w.isDestroyed()) return;
  try { w.setSkipTaskbar(false); } catch (_) { /* 个别平台该方法不可用则忽略 */ }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
}

/* 隐藏指定窗口到托盘：移出任务栏（skipTaskbar=true）再隐藏，不弹气泡 */
function hideWindowToTray(w) {
  if (!w || w.isDestroyed()) return;
  try { w.setSkipTaskbar(true); } catch (_) { /* 忽略 */ }
  w.hide();
}

/* 打开（或切换/恢复）知识库：目标库已有窗口则聚焦旧窗口，否则新开窗口。
 * 每个知识库只允许占用一个主窗口。返回窗口或 null（已聚焦旧窗口）。 */
function openVaultWindow(target) {
  return createWindow(target || null);
}

/* 级联偏移：新窗口相对最近可见窗口向右下错位，避免「完整遮挡旧窗口」。
 * 多窗口（多知识库/项目）场景，新开窗口逐次偏移；超出当前显示器工作区则折返左上重排。
 * 无可见锚点窗口（如程序启动首窗）时返回 null，交给系统居中定位。
 * @param {number} width  新窗口宽
 * @param {number} height 新窗口高
 * @returns {{x:number,y:number}|null} 偏移到工作区内的窗口坐标
 * @author 火 冰 */
function computeCascadePos(width, height) {
  const anchor = BrowserWindow.getAllWindows().find(function (w) {
    return w && !w.isDestroyed() && w.isVisible();
  });
  if (!anchor) return null;
  const bp = anchor.getBounds(); // 锚点窗口位置与尺寸
  const STEP = 28; // 每次偏移量（px）
  const disp = screen.getDisplayMatching(bp); // 锚点窗口所在显示器
  const wa = disp.workArea; // 该显示器工作区
  const maxX = wa.x + wa.width - width; // x 允许最大值（避免右沿出屏）
  const maxY = wa.y + wa.height - height; // y 允许最大值
  // 锚点位置 + 1 档偏移；越界则折返到工作区左上角继续排
  let x = bp.x + STEP;
  let y = bp.y + STEP;
  if (x > maxX || y > maxY) {
    x = wa.x + STEP;
    y = wa.y + STEP;
  }
  return { x: Math.max(wa.x, Math.min(x, maxX)), y: Math.max(wa.y, Math.min(y, maxY)) };
}

/* IPC handler 包装：在请求链内注入「发起窗口的库根」，使 vaultRoot() 按窗口解析。
 * 所有 ipcMain.handle 均改走本包装，内部工具函数与 aiEngine 无需感知窗口。 */
function vaultHandle(channel, fn) {
  ipcMain.handle(channel, function (event, ...args) {
    return vaultCtx.run({ root: vaultRootForEvent(event) }, function () {
      return fn(event, ...args);
    });
  });
}

/* 创建主窗口。vaultPath 为可选知识库路径：null/undefined=跟随默认库「我的笔记库」。
 * opts 可传 { project }：以「项目工作区」模式打开（非知识库，不建索引）。
 * 同库/同项目已有窗口时不重复创建（聚焦旧窗口并返回 null）。 */
function createWindow(vaultPath, opts) {
  const projectPath = (opts && typeof opts.project === 'string' && opts.project) ? path.resolve(opts.project) : null;
  // 窗口绑定自己的知识库（null=跟随默认库）；切到默认库路径时也归一为 null（显示「我的笔记库」）
  const bindingRaw = (projectPath || vaultPath == null || vaultPath === '') ? null : path.resolve(vaultPath);
  const binding = (bindingRaw && bindingRaw.toLowerCase() === defaultVaultRoot().toLowerCase()) ? null : bindingRaw;
  // 项目窗口独立于知识库单窗口映射：按项目根去重（复用 vaultKey 忽略大小写）
  const projKey = projectPath ? ('proj::' + vaultKey(projectPath)) : null;
  if (projKey) {
    for (const [winId, pp] of winProjects) {
      if (pp && vaultKey(pp) === projKey) {
        const ex = BrowserWindow.fromId(winId);
        if (ex && !ex.isDestroyed()) { showWindow(ex); return null; }
        winProjects.delete(winId);
      }
    }
  }
  // 单库单窗口：无论默认库还是命名库都按「库 key」查已开窗口，命中则聚焦旧窗口（Bug-058 修复默认库也会新开窗口的回归）
  // 默认库 key 与 syncVaultWinMap 登记口径一致：null → vaultKey(defaultVaultRoot())
  const key = vaultKey(binding || defaultVaultRoot());
  const existId = vaultWinId.get(key);
  if (!projectPath && existId !== undefined) {
    const ex = BrowserWindow.fromId(existId);
    if (ex && !ex.isDestroyed()) { showWindow(ex); return null; }
    vaultWinId.delete(existId);
  }
  const cascade = computeCascadePos(1280, 820); // 多窗口级联偏移：避免新窗口完整遮挡旧窗口
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    ...(cascade ? { x: cascade.x, y: cascade.y } : {}), // 有锚点窗口时向右下错位显示，否则系统居中
    minWidth: 900,
    minHeight: 600,
    title: '第二脑 · ' + (projectPath ? ('项目：' + path.basename(projectPath)) : (binding ? path.basename(binding) : '我的笔记库')), // 项目/库名用于标题、任务栏区分
    backgroundColor: '#1E1E2E',
    show: false,             // 待首帧渲染完成后才显示窗口，避免先露出深色窗口背景（Bug-041 消除首屏闪烁）
    frame: false,            // 移除系统标题栏，由前端自绘 Windows 风格标题栏
    titleBarStyle: 'hidden',
    // 统一应用图标：窗口/托盘同源脑图标（assets/icon | tray.png），大小不同而已
    // 窗口打开时照常显示在任务栏；仅当最小化/缩小到托盘时才移出任务栏（见 hideWindowToTray）
    skipTaskbar: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: {
      // 安全默认：隔离上下文、禁用 Node 集成，仅通过 preload 暴露窗口控制
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      // 关闭后台渲染节流：避免窗口最小化/缩托盘后异步锁定消息（app:locked）被节流延迟，
      // 到窗口恢复可见才执行 → 先闪过已解锁内容再弹密码框。关闭后锁定在隐藏阶段立即生效（SEC-01）。
      backgroundThrottling: false,
    },
  });
  _slog('browserwindow_created');

  // 登记窗口 ↔ 知识库/项目绑定（null=默认库），并刷新单库单窗口映射
  // 提前缓存 webContents.id：窗口销毁后（closed 回调里）webContents 已不可访问，
  // 直接访问会抛「Object has been destroyed」（Bug-053），故一律使用缓存的 wcId。
  const wcId = win.webContents.id;
  if (projectPath) {
    winProjects.set(wcId, projectPath); // 项目窗口独立登记，不参与知识库单窗口映射
  } else {
    winVaults.set(wcId, binding);
    syncVaultWinMap();
  }

  // 通过自定义协议加载首页；query 携带库/项目路径（信息性，渲染端仍以 vault:get / ?project= 为准）
  const qp = projectPath ? ('?project=' + encodeURIComponent(projectPath))
    : (binding ? '?vault=' + encodeURIComponent(binding) : '');
  win.loadURL('note://local/index.html' + qp);

  // 窗口就绪后再显示：后台加载渲染完成首帧后才 show()，
  // 不再让深色 backgroundColor 抢在浅色 body（首屏同步脚本已设 html.light）之前露出（Bug-041 窗口层根因）。
  // 作者: 火 冰
  win.once('ready-to-show', function () {
    if (!win.isDestroyed()) win.show();
  });
  // 每次窗口「重新显示」（从托盘召回最小化/隐藏的窗口、或 restore 最小化窗口）且已设启动密码时，
  // 重置该窗口解锁并推送锁定事件，需重新输入密码才能查看内容（SEC-01 窗口级锁定）。
  // 窗口全程保持显示、仅正常前置时不触发，不打断已解锁的窗口使用。
  win.on('show', function () { secRequireLock(win); });
  win.on('restore', function () { secRequireLock(win); });
  // 最小化/缩托盘瞬间即锁定工作区（窗口已隐藏，锁定过程不可见）：召回显示时遮罩已在，
  // 直接呈现密码界面，彻底规避「先闪内容再弹密码框」。
  win.on('minimize', function () { secRequireLock(win); });
  win.on('hide', function () { secRequireLock(win); });
  // 兜底：渲染异常/过慢时强制显示，避免白窗/黑屏卡死；首帧渲染完成即取消兜底
  var _sbShowTimer = setTimeout(function () {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 4000);
  win.webContents.once('did-finish-load', function () { clearTimeout(_sbShowTimer); });

  // 保留 Ctrl+Shift+I 全局开/关开发者工具（不参与快捷键注册表，作为标准兜底）。
  // F12 已纳入用户可重绑的「设置-快捷键」注册表（cmd:devtools），由渲染进程 keydown → IPC 路由，
  // 故此处不再拦截 F12，避免抢占用户重绑的组合。
  // 作者: 火 冰
  win.webContents.on('before-input-event', function (event, input) {
    if (input.type !== 'keyDown') return;
    const ctrlShiftI = input.control && input.shift && (input.key === 'I' || input.key === 'i');
    if (ctrlShiftI) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // 渲染端 console 全量转发落盘：把渲染进程的 console.log/warn/error（含 window.onerror 之外、
  // vditor 等第三方库的日志）桥接到 userData/logs/app.log，便于排查界面空白/编辑区异常。
  // 作者: 火 冰
  // 启动耗时打点：渲染进程 DOM/脚本加载完成时机，用于判断「十几秒」在渲染端还是主进程端
  win.webContents.on('did-finish-load', function () { _slog('renderer_did_finish_load'); });
  win.webContents.on('console-message', function (_e, level, message, line, sourceId) {
    const lv = { 0: 'log', 1: 'warn', 2: 'error', 3: 'debug' }[level] || 'log';
    appendLog({ level: lv, msg: '[console] ' + String(message),
      detail: 'at ' + String(sourceId || '') + ':' + String(line || '') });
  });

  // 导航安全兜底：链接点击若未在前端拦截成功（如 vditor 内部 window.open / 默认导航），
  // 一律拒绝新窗口创建并阻止窗口内导航，避免相对链接按 note:// 基址解析到应用目录触发 404 弹窗。
  // 内部笔记跳转统一由前端 openNote 处理（编辑区新开页签）；外链/资源由前端按协议分流。
  // 作者: 火 冰
  win.webContents.setWindowOpenHandler(function () {
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', function (e) {
    e.preventDefault();
  });

  // 窗口关闭：释放窗口 ↔ 库/项目绑定，刷新单库单窗口映射。
  // 注意：closed 触发时窗口已销毁，webContents 不可访问（会抛「Object has been destroyed」Bug-053），
  // 必须用创建时缓存的 wcId 而非 win.webContents.id。
  win.on('closed', function () {
    winVaults.delete(wcId);
    winProjects.delete(wcId);
    syncVaultWinMap();
    if (mainWin === win) mainWin = null;
    refreshTrayMenu(); // 窗口关闭后刷新托盘知识库/项目列表
  });
  // 窗口聚焦：记录为最近活动库/项目（供 note:// 协议等无窗口上下文解析）
  win.on('focus', function () {
    activeVault = winProjects.has(wcId) ? winProjects.get(wcId) : (winVaults.get(wcId) || null);
  });
  mainWin = win;
  refreshTrayMenu(); // 窗口创建后刷新托盘知识库/项目列表（启动时 createTray 前调用会被 if(!tray) 安全跳过）
  return win;
}

/* ---------- 窗口控制 IPC（供前端标题栏按钮调用；多窗口下各按钮只作用于发起窗口） ---------- */
ipcMain.on('win:minimize', (e) => { hideWindowToTray(winFromEvent(e)); }); // 最小化：仅隐藏当前窗口到托盘
ipcMain.on('win:maximize', (e) => {
  const w = winFromEvent(e);
  if (!w) return;
  if (w.isMaximized()) w.unmaximize(); else w.maximize();
});
/* 切换整个窗口全屏（F11 快捷键 / 设置-快捷键注册表 cmd:fullscreen），等价系统级全屏 */
ipcMain.on('win:fullscreen', (e) => {
  const w = winFromEvent(e);
  if (!w) return;
  w.setFullScreen(!w.isFullScreen());
});
/* 开/关开发者工具（设置-快捷键注册表 cmd:devtools，默认 F12；Ctrl+Shift+I 仍走 before-input-event 兜底） */
ipcMain.on('win:devtools', (e) => {
  const w = winFromEvent(e);
  if (w) w.webContents.toggleDevTools();
});
/* 关闭按钮(×)行为分派（窗口级生命周期）：
 * - 多窗口：关闭按钮 = 只关闭当前窗口（窗口级），无论 closeAction 设置如何；
 *   最后一个窗口关闭后由 window-all-closed 退出程序。
 * - 单窗口：保持原有关闭按钮行为：仅首次（closeAsked=false）弹一次并记住选择，
 *   之后按 closeAction 执行（quit=直接退出；tray=缩小到托盘；confirm=设置里选的「每次询问」）。
 * 作者: 火 冰 */
ipcMain.on('win:close', (e) => {
  const win = winFromEvent(e) || mainWin;
  if (!win) return;
  const alive = BrowserWindow.getAllWindows().filter(function (w) { return !w.isDestroyed(); });
  if (alive.length > 1) { // 多窗口：只关闭当前窗口，不退出程序（Bug-054 修复前 closeAction='quit' 会 app.quit 关掉全部窗口）
    win.close();
    return;
  }
  if (!closeAsked) { // 首次询问一次并记住
    for (const w of BrowserWindow.getAllWindows()) w.setEnabled(false); // 禁用窗口防重复弹框
    dialog.showMessageBox(win, {
      type: 'question',
      title: '关闭第二脑',
      message: '关闭后希望执行什么操作？',
      buttons: ['直接退出', '缩小到托盘', '取消'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    }).then(function (r) {
      for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.setEnabled(true); }
      closeAsked = true; // 已询问过：之后从设置维护，不再弹首次询问
      if (r.response === 0) { closeAction = 'quit'; saveConfig(); app.quit(); }
      else if (r.response === 1) { closeAction = 'tray'; saveConfig(); hideWindowToTray(win); }
      else { saveConfig(); } // response === 2：取消，保持窗口打开；仍记住已询问
    }).catch(function () {
      for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.setEnabled(true); }
    });
    return;
  }
  if (closeAction === 'quit') { app.quit(); return; }
  if (closeAction === 'tray') { hideWindowToTray(win); return; }
  // confirm：用户在设置里手动选择「每次询问」
  for (const w of BrowserWindow.getAllWindows()) w.setEnabled(false); // 禁用窗口防重复弹框
  dialog.showMessageBox(win, {
    type: 'question',
    title: '关闭第二脑',
    message: '关闭后希望执行什么操作？',
    buttons: ['退出程序', '缩小到托盘', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }).then(function (r) {
    for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.setEnabled(true); }
    if (r.response === 0) app.quit();                 // 退出程序
    else if (r.response === 1) hideWindowToTray(win); // 缩小到托盘
    // response === 2：取消，保持窗口打开
  }).catch(function () {
    for (const w of BrowserWindow.getAllWindows()) { if (!w.isDestroyed()) w.setEnabled(true); }
  });
});

/* 读取/设置关闭按钮行为（供设置页「常规 → 关闭按钮行为」调整并持久化到 settings.json） */
vaultHandle('win:getCloseAction', () => closeAction);
vaultHandle('win:setCloseAction', (_e, val) => {
  if (['confirm', 'quit', 'tray'].indexOf(val) === -1) return false;
  closeAction = val;
  closeAsked = true; // 手动在设置里调整即视为已首次确认，不再弹首次询问
  saveConfig();
  return true;
});

/* ---------- 系统托盘（G-12） ----------
 * 窗口开启 skipTaskbar 不占用任务栏，仅保留系统托盘图标。
 * 最小化 = 隐藏窗口；单击/双击托盘图标恢复窗口；右键菜单：显示主窗口 / 退出。
 * 作者: 火 冰 */
let tray = null;

/** 恢复并聚焦所有窗口（托盘点击时调用）；无窗口则重建默认库窗口。 */
function showMainWindow() {
  const wins = BrowserWindow.getAllWindows().filter(function (w) { return !w.isDestroyed(); });
  if (wins.length === 0) { createWindow(); return; }
  wins.forEach(showWindow);
}

/* ==================== 系统「打开方式」传入文件 → 临时文件 ==================== */

/* 系统「打开方式」（OS 右键→打开方式→第二脑）可承载的临时文件扩展名 */
const OPEN_WITH_EXTS = ['.md', '.markdown', '.txt'];

/* 从命令行参数 argv 中检出第一个存在的可临时打开文件路径（.md/.markdown/.txt），无则返回 null。
 * argv 形如 [exePath, filePath, ...]（Windows 首次启动）或 second-instance 的 commandLine。作者: 火 冰 */
function pickOpenWithArg(argv) {
  if (!argv) return null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a || typeof a !== 'string' || a.charAt(0) === '-') continue;
    if (OPEN_WITH_EXTS.indexOf(path.extname(a).toLowerCase()) === -1) continue;
    const abs = path.resolve(a);
    try { if (fs.existsSync(abs)) return abs; } catch (_) { /* 忽略 */ }
  }
  return null;
}

/* 待窗口就绪后把外部文件绝对路径推给渲染端（经 'open-file' 事件 → sbTempFiles.openTemp 以 temp:// 临时打开）。
 * 窗口仍在加载时挂 did-finish-load，避免先到的事件丢失。作者: 火 冰 */
function forwardOpenFile(win, abs) {
  if (!win || win.isDestroyed() || !abs) return;
  const wc = win.webContents;
  const send = function () { try { wc.send('open-file', abs); } catch (_) { /* 窗口已销毁等忽略 */ } };
  if (win.isLoading()) wc.once('did-finish-load', send);
  else send();
}

/* 处理系统「打开方式」传入的文件：聚焦一个窗口（无则新建默认库窗口）并按临时文件打开。作者: 火 冰 */
function openWithFile(abs) {
  if (!abs) return;
  let w = null;
  const wins = BrowserWindow.getAllWindows().filter(function (x) { return !x.isDestroyed(); });
  w = wins[wins.length - 1] || null; // 最近一个可见窗口
  if (!w) { try { w = createWindow(); } catch (_) { w = null; } }
  if (!w) return;
  showWindow(w);
  forwardOpenFile(w, abs);
}

/** 创建系统托盘图标与菜单：菜单动态刷新（refreshTrayMenu），含全部知识库列表 */
function createTray() {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(ROOT, 'assets', 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('第二脑');
  refreshTrayMenu();
  // 单击/双击恢复主窗口（Windows 托盘单击通常恢复窗口）
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

/** 刷新托盘右键菜单：列出全部知识库（默认库 + 当前各窗口打开的库 + 历史库，去重）与
 * 「一般项目」（winProjects 中打开的非知识库工作区）。
 * 点击库/项目在对应窗口打开（已存在则该类窗口聚焦旧窗口）；尾部为「显示主窗口/退出」。
 * 在启动、窗口创建/关闭、库切换/迁移/移除时调用，保证列表实时与当前一致。
 * 作者: 火 冰 */
function refreshTrayMenu() {
  if (!tray) return;
  const items = [];
  const seen = new Set();
  const pushVault = function (p, name) {
    const k = (p == null || vaultKey(p) === defaultVaultRoot().toLowerCase()) ? '__default__' : vaultKey(p);
    if (seen.has(k)) return;
    seen.add(k);
    items.push({
      label: name || (p ? path.basename(p) : '我的笔记库'),
      click: function () { openVaultWindow(p); },
    });
  };
  // 1) 默认库「我的笔记库」固定置于顶部（跟随默认库的窗口也归一于此）
  pushVault(null, '我的笔记库');
  // 2) 当前各窗口打开的库（winVaults 中去重）
  for (const [, vp] of winVaults) {
    if (vp) pushVault(vp, path.basename(vp));
  }
  // 3) 历史库（最近打开，目录仍存在才列出）
  (vaultHistory || []).forEach(function (h) {
    if (h && typeof h.path === 'string' && fs.existsSync(h.path)) pushVault(h.path, h.name || path.basename(h.path));
  });
  // 4) 一般项目（非知识库工作区）：二级子菜单展开，点击聚焦/新开项目窗口
  const projWins = [];
  for (const [winId, pp] of winProjects) {
    const w = BrowserWindow.fromId(winId);
    if (pp && w && !w.isDestroyed()) projWins.push({ winId: winId, pp: pp });
  }
  if (projWins.length) {
    if (items.length) items.push({ type: 'separator' });
    items.push({
      label: '一般项目',
      submenu: projWins.map(function (pw) {
        return {
          label: path.basename(pw.pp) || pw.pp,
          click: function () { const w = BrowserWindow.fromId(pw.winId); if (w && !w.isDestroyed()) showWindow(w); },
        };
      }),
    });
  }
  if (items.length) items.push({ type: 'separator' });
  items.push({ label: '显示主窗口', click: showMainWindow });
  items.push({ type: 'separator' });
  items.push({ label: '退出', click: function () { app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

/* ---------- 运行日志落盘 ---------- */
/* 前端 window.onerror / unhandledrejection 以及主动日志统一经 IPC 落到运行日志
 * （默认 userData/logs，可在设置中自定义日志目录）：普通日志 app.log、错误日志
 * error.log 分开落盘，便于「日志查看」弹框分别切换查看与排障。
 * 作者: 火 冰 */
let logMaxMB = 5; // 单日志文件上限（MB），超限自动轮换为 .1；可在设置中配置，默认 5
const LOG_MAX_BYTES = function () { return logMaxMB * 1024 * 1024; }; // 计算当前单文件字节阈值
let logDir = ''; // 运行日志目录：默认 userData/logs，可在设置中自定义（空=默认；仅目录，不含文件名）
/* 返回日志目录（可配置，空回退默认）；此目录同时承载 app.log 与 error.log */
function logBaseDir() {
  return (logDir && String(logDir).trim()) ? String(logDir).trim() : path.join(app.getPath('userData'), 'logs');
}
/* 普通运行日志文件（info/warn） */
function logFile() { return path.join(logBaseDir(), 'app.log'); }
/* 错误日志文件（error/fatal，单独落盘便于切换查看） */
function logErrorFile() { return path.join(logBaseDir(), 'error.log'); }
/* 追加一行日志到指定文件（含目录创建与超限轮换） */
function writeLogLine(f, line) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f) && fs.statSync(f).size > LOG_MAX_BYTES()) {
    try { fs.renameSync(f, f + '.1'); } catch (_) { /* 轮换冲突时忽略，继续追加 */ }
  }
  fs.appendFileSync(f, line, 'utf8');
}
function appendLog(payload) {
  try {
    const t = new Date();
    const p2 = n => String(n).padStart(2, '0');
    const ts = t.getFullYear() + '-' + p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' '
      + p2(t.getHours()) + ':' + p2(t.getMinutes()) + ':' + p2(t.getSeconds()) + '.' + String(t.getMilliseconds()).padStart(3, '0');
    const level = String((payload && payload.level) || 'info');
    const line = '[' + ts + '] [' + level + '] ' + ((payload && payload.msg) || '')
      + ((payload && payload.detail) ? ('\n  detail: ' + payload.detail) : '') + '\n';
    // error/fatal 错误流单独落盘；其余写入普通日志
    writeLogLine((level === 'error' || level === 'fatal') ? logErrorFile() : logFile(), line);
  } catch (_) { /* 日志落盘失败不阻断主进程 */ }
}
ipcMain.on('app:log', (_e, p) => { appendLog(p || {}); });

/* ---------- 主进程未捕获异常：写日志 + 可复制错误弹窗 ----------
 * Electron 默认的主进程错误弹窗（A JavaScript error occurred in the main process）
 * 不落日志、文本不可复制。这里统一接管：异常先落盘 userData/logs/app.log，
 * 再弹可复制窗口（textarea 只读文本，支持右键/全选复制），附日志路径与「打开日志目录」。
 * 作者: 火 冰 */
let errWin = null; // 错误弹窗单例（重复异常仅聚焦已有弹窗）

/** 打开运行日志目录（错误弹窗「打开日志目录」按钮触发） */
ipcMain.handle('shell:openLogDir', async () => {
  try { await shell.openPath(path.dirname(logFile())); } catch (_) { /* 打开失败忽略 */ }
  return true;
});

/* 获取当前日志目录（设置页展示用；仅目录，不含文件名） */
ipcMain.handle('app:getLogDir', (_e) => logBaseDir());
/* 设置自定义日志目录：保存并持久化到 settings.json；返回当前日志目录 */
ipcMain.handle('app:setLogDir', (_e, dir) => {
  const d = (dir && typeof dir === 'string') ? String(dir).trim() : '';
  logDir = d; // 空串回退默认目录
  saveConfig();
  return logBaseDir();
});
/* 读取某份日志内容：type = 'info' | 'error'；返回末段文本（末 N 行），文件不存在返回空串。
 * 复选框/实时/筛选均在渲染端完成，主进程只做按需读取。 */
ipcMain.handle('app:readLog', (_e, type) => {
  const f = (type === 'error') ? logErrorFile() : logFile();
  try {
    if (!fs.existsSync(f)) return '';
    const raw = fs.readFileSync(f, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines.slice(-500).join('\n'); // 只取末段，避免弹超大文本
  } catch (_) { return ''; }
});
/* ---------- 日志查看浮窗（独立 frameless 窗口，可拖出主窗口） ----------
 * 日志查看原本是设置页内的 DOM 弹框，被主窗口边界裁剪无法拖出。
 * 这里改建成独立无边框窗口，自绘标题栏用 -webkit-app-region: drag 实现系统级拖拽，
 * 可自由移动到主窗口外，实时滚动查看日志。作者: 火 冰 */
let logViewerWin = null; // 日志查看浮窗单例（重复打开仅聚焦）

/* 打开（或聚焦）日志查看浮窗：已存在则 show+focus，不存在则新建独立 frameless 窗口 */
function openLogViewer() {
  try {
    if (logViewerWin && !logViewerWin.isDestroyed()) { logViewerWin.show(); logViewerWin.focus(); return true; }
    logViewerWin = new BrowserWindow({
      width: 760, height: 560, minWidth: 480, minHeight: 320,
      title: '第二脑 · 运行日志',
      backgroundColor: '#1E1E2E',
      show: false,
      frame: false,            // 无系统边框，自绘标题栏 → 可自由拖出主窗口外
      titleBarStyle: 'hidden',
      icon: path.join(ROOT, 'assets', 'icon.png'),
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload.js'),
      },
    });
    logViewerWin.loadURL('note://local/logview.html');
    logViewerWin.once('ready-to-show', function () { if (!logViewerWin.isDestroyed()) logViewerWin.show(); });
    var _lvShowTimer = setTimeout(function () { if (!logViewerWin.isDestroyed() && !logViewerWin.isVisible()) logViewerWin.show(); }, 3000);
    logViewerWin.webContents.once('did-finish-load', function () { clearTimeout(_lvShowTimer); });
    logViewerWin.webContents.setWindowOpenHandler(function () { return { action: 'deny' }; });
    logViewerWin.webContents.on('will-navigate', function (e) { e.preventDefault(); });
    logViewerWin.on('closed', function () { logViewerWin = null; });
    return true;
  } catch (_) { return false; }
}
ipcMain.handle('app:openLogViewer', () => openLogViewer());
/* 关闭日志查看浮窗 */
ipcMain.handle('app:closeLogViewer', () => {
  try { if (logViewerWin && !logViewerWin.isDestroyed()) logViewerWin.close(); } catch (_) {}
  return true;
});
/* 获取单日志文件大小上限（MB） */
ipcMain.handle('app:getLogMaxMB', () => logMaxMB);
/* 设置单日志文件大小上限（MB）：校验为正数后持久化到 settings.json，返回新值 */
ipcMain.handle('app:setLogMaxMB', (_e, mb) => {
  const n = Number(mb);
  if (!(n >= 1 && n <= 1024)) return logMaxMB; // 非法值不生效，返回当前
  logMaxMB = Math.round(n);
  saveConfig();
  return logMaxMB;
});
/* 清空指定日志文件内容（type = 'info' | 'error'）：只清空文件文本，不删除文件、不删除 .1 拆分历史 */
ipcMain.handle('app:clearLogFile', (_e, type) => {
  const f = (type === 'error') ? logErrorFile() : logFile();
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '', 'utf8');
    return true;
  } catch (_) { return false; }
});

/* 用系统目录选择器挑选日志目录：返回选中的目录路径，取消返回空串 */
ipcMain.handle('app:chooseLogDir', async (event) => {
  try {
    const r = await dialog.showOpenDialog(winFromEvent(event), {
      title: '选择日志目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    return (r && !r.canceled && r.filePaths && r.filePaths[0]) ? r.filePaths[0] : '';
  } catch (_) { return ''; }
});

/** 展示可复制错误弹窗：只读 textarea 支持右键复制错误信息，附日志路径 + 打开日志目录。
 * @param {string} title 弹窗标题
 * @param {string} text  错误详情（含堆栈）
 * @author 火 冰 */
function showErrorDialog(title, text) {
  try {
    if (errWin && !errWin.isDestroyed()) { errWin.focus(); return; }
    errWin = new BrowserWindow({
      width: 700, height: 480, resizable: true, minimizable: false, maximizable: false,
      title: '第二脑 · ' + String(title || '错误'), show: true, autoHideMenuBar: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
    });
    errWin.on('closed', function () { errWin = null; });
    const esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
      + '<style>body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:16px;background:#f5f5f7;color:#222;}'
      + 'h2{margin:0 0 8px;font-size:15px;}p.hint{margin:0 0 8px;font-size:12px;color:#666;word-break:break-all;}'
      + 'textarea{width:100%;height:300px;box-sizing:border-box;font:12px/1.5 Consolas,monospace;padding:8px;'
      + 'border:1px solid #ccc;border-radius:6px;background:#fff;resize:vertical;color:#c00;}'
      + '.row{display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;}'
      + 'button{padding:6px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;}'
      + 'button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}</style></head><body>'
      + '<h2>' + esc(title) + '</h2>'
      + '<p class="hint">错误信息已写入日志：' + esc(logErrorFile()) + '</p>'
      + '<textarea readonly spellcheck="false" onfocus="this.select()" id="err">' + esc(text) + '</textarea>'
      + '<div class="row"><button onclick="doCopy()">复制错误信息</button>'
      + '<button id="openlog" class="primary">打开日志目录</button>'
      + '<button onclick="window.close()">关闭</button></div>'
      + '<script>function doCopy(){var t=document.getElementById("err");t.focus();t.select();'
      + 'try{var ok=document.execCommand("copy");if(!ok)alert("复制失败，请手动全选文本复制");}catch(e){alert("复制失败："+e);}}'
      + 'document.getElementById("openlog").addEventListener("click",function(){'
      + 'try{window.noteDesktop&&window.noteDesktop.openLogDir&&window.noteDesktop.openLogDir();}catch(e){alert("无法打开日志目录："+e);}});</script>'
      + '</body></html>';
    errWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } catch (_) { /* 错误弹窗自身失败不阻断（异常已写日志） */ }
}

/* 主进程未捕获异常：落盘 + 可复制弹窗（替换 Electron 默认不可复制的错误弹窗） */
process.on('uncaughtException', function (err) {
  try {
    const text = (err && (err.stack || err.message)) ? (err.stack || String(err.message)) : String(err);
    appendLog({ level: 'error', msg: '[uncaughtException] ' + text });
    showErrorDialog('主进程异常（Uncaught Exception）', text);
  } catch (_) { /* 兜底：不再抛出 */ }
});

/* 主进程未处理的 Promise 拒绝：仅落盘，不弹窗（避免非致命告警频繁打扰） */
process.on('unhandledRejection', function (reason) {
  try {
    const text = (reason && (reason.stack || reason.message)) ? (reason.stack || String(reason.message)) : String(reason);
    appendLog({ level: 'error', msg: '[unhandledRejection] ' + text });
  } catch (_) { /* 兜底 */ }
});

/* 同步确认对话框（confirm）：
 * 渲染进程的 window.confirm 在 Electron 中不支持且返回 false，会让删除等确认静默失效。
 * 这里用原生对话框同步返回选择结果。作者: 火 冰 */
ipcMain.on('dialog:confirm', (e, msg) => {
  try {
    const idx = dialog.showMessageBoxSync(winFromEvent(e), {
      type: 'question', buttons: ['确定', '取消'], defaultId: 0, cancelId: 1,
      message: String(msg || '确定吗？'), noLink: true,
    });
    e.returnValue = idx === 0;
  } catch (_) { e.returnValue = false; }
});

/* ============================================
 * 笔记库（真实文件系统）IPC
 * 笔记存放于 userData/vault，首次启动用 seed 初始化。
 * 所有接口以「相对路径」作为 key，拼接进 vault 后做前缀校验，防路径穿越。
 * ============================================ */

/* 数据目录下的默认笔记库根路径：默认 userData/vault；
 * 用户可通过「迁移默认知识库」把默认库迁到自定义目录，迁后该目录即新的默认库（defaultVaultPath 持久化） */
let defaultVaultPath = null;
function defaultVaultRoot() { return defaultVaultPath || path.join(app.getPath('userData'), 'vault'); }

/* 当前知识库根：优先取 IPC 请求链内「发起窗口」绑定的库（vaultCtx），
 * 无窗口上下文（note:// 协议、AI 引擎兜底等）取最近聚焦窗口的库 activeVault，
 * 再退化为默认库。currentVault 仅用于启动时恢复「上次打开的库」。 */
function vaultRoot() {
  const store = vaultCtx.getStore();
  if (store && store.root) return store.root;
  return activeVault || defaultVaultRoot();
}
let currentVault = null;
/* 打开过的笔记库历史（最近在前），用于下拉列表展示与快速切换 */
let vaultHistory = [];

/* 用户配置文件：持久化当前笔记库 + 默认库路径 + 历史库列表 + 关闭按钮行为，重启后保持 */
function configFile() { return path.join(app.getPath('userData'), 'settings.json'); }
/* 关闭按钮(×)行为：quit=直接退出 / tray=缩小到托盘 / confirm=设置里手动选的「每次询问」 */
let closeAction = 'quit';
/* 是否已向用户询问过「关闭后希望执行的操作」（只问一次，之后在设置「常规 → 关闭按钮行为」里维护） */
let closeAsked = false;
function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (j && typeof j.defaultVaultPath === 'string' && j.defaultVaultPath) defaultVaultPath = j.defaultVaultPath;
    if (j && typeof j.vaultPath === 'string' && j.vaultPath) currentVault = j.vaultPath;
    if (Array.isArray(j && j.vaultHistory)) vaultHistory = j.vaultHistory
      .filter(function (h) { return h && typeof h.path === 'string'; })
      .slice(0, 12);
    if (j && typeof j.closeAction === 'string' && ['confirm', 'quit', 'tray'].indexOf(j.closeAction) !== -1) closeAction = j.closeAction;
    if (j && typeof j.closeAsked === 'boolean') closeAsked = j.closeAsked;
    if (j && typeof j.logDir === 'string' && j.logDir) logDir = j.logDir;
    if (j && typeof j.logMaxMB === 'number' && j.logMaxMB > 0) logMaxMB = j.logMaxMB;
  } catch (e) { /* 配置不存在或损坏时回退默认库 */ }
}
function saveConfig() {
  try {
    fs.writeFileSync(configFile(), JSON.stringify(
      { defaultVaultPath: defaultVaultPath, vaultPath: currentVault || null, vaultHistory: vaultHistory, closeAction: closeAction, closeAsked: closeAsked, logDir: logDir, logMaxMB: logMaxMB },
      null, 2), 'utf8');
  } catch (e) { /* 写入失败不阻塞 */ }
}

/* 记录一次打开的库：按绝对路径去重（Windows 忽略大小写）、置顶、上限 12 条；返回规范化对象 */
function recordHistory(dir) {
  if (!dir) return null;
  const clean = path.resolve(dir);
  const key = clean.toLowerCase(); // Windows 路径大小写不敏感，用统一小写做去重键
  const isDefault = key === defaultVaultRoot().toLowerCase(); // 默认库显示名「我的笔记库」
  vaultHistory = vaultHistory.filter(function (h) { return String(h.path).toLowerCase() !== key; });
  vaultHistory.unshift({ path: clean, name: isDefault ? '我的笔记库' : path.basename(clean), ts: Date.now() });
  if (vaultHistory.length > 12) vaultHistory.length = 12;
  return vaultHistory[0];
}

/* 初始笔记库 seed：相对路径 + Markdown 原文 */
const SEED_NOTES = [
  { rel: '日记/2024年/09月/09-01.md', content: [
    '# 2024年9月1日 周日',
    '',
    '今天是九月的第一天，天气晴朗。早上沿河边跑了五公里，精神状态很好。回来后整理了本周的工作计划，准备开始新的一个月。',
    '',
    '## 今日计划',
    '',
    '- [x] 整理上周会议记录并归档',
    '- [ ] 完成项目文档初稿，提交给团队评审',
    '- [x] 回复客户邮件，确认下周会议时间',
    '- [ ] 阅读《深度工作》第三章并做笔记',
    '- [ ] 准备明天晨会的分享材料',
    '',
    '## 学习笔记',
    '',
    '今天学习了 **深度工作** 的核心理念。作者 Cal Newport 认为，在注意力碎片化的时代，能够长时间专注于高难度认知任务是一种稀缺能力。关键方法是使用 `time-blocking` 来规划每一小时的时间。',
    '',
    '书中提到了四种深度工作哲学：禁欲式、双峰式、节奏式和新闻记者式。我个人比较适合 **节奏式**，即每天固定时间进入深度工作状态。',
    '',
    '```bash',
    '# 每天固定时间进入深度工作',
    'export DEEP_WORK_START="09:00"',
    'export DEEP_WORK_END="11:30"',
    '```',
    '',
    '> "你的一天是什么样的，你的人生就是什么样的。"',
    '',
    '## 反思',
    '',
    '今天整体效率不错，完成了大部分计划内的事项。上午专注度较高，完成了文档初稿。下午处理了一些杂事，注意力有所分散，明天需要加强 **time-blocking** 的执行力度。',
    '',
    '#日记 #计划 #学习 #深度工作',
  ].join('\n') },
  { rel: '日记/2024年/09月/09-02.md', content: [
    '# 2024年9月2日 周一',
    '',
    '延续 [[09-01]] 的深度工作计划，今天上午进入 [[深度工作]] 状态，完成了时间块规划。',
    '',
    '## 完成',
    '- [x] 完成项目文档初稿',
    '- [x] 阅读《深度工作》第三章',
    '',
    '> 节奏式深度工作法需要长期坚持。',
    '',
    '#日记 #深度工作',
  ].join('\n') },
  { rel: '日记/2024年/09月/09-03.md', content: [
    '# 2024年9月3日 周二',
    '',
    '今天整理了 [[技术栈整理]]，并参与了 [[React学习]] 的小组讨论。',
    '',
    '#日记 #技术',
  ].join('\n') },
  { rel: '学习笔记/深度工作.md', content: [
    '# 深度工作（Deep Work）',
    '',
    '作者 Cal Newport。核心：在无干扰状态下深度专注的认知活动，是高价值产出的关键。',
    '',
    '## 四种哲学',
    '- 禁欲式：完全隔离',
    '- 双峰式：固定时段',
    '- 节奏式：每日固定时间（我适合）',
    '- 新闻记者式：随时切入',
    '',
    '## 相关',
    '- 见 [[09-01]] 实践记录',
    '',
    '#学习 #读书',
  ].join('\n') },
  { rel: '模板/日记模板.md', content: [
    '# YYYY年MM月DD日 周X',
    '',
    '#日记',
    '## 今日计划',
    '## 学习笔记',
    '## 反思',
  ].join('\n') },
  { rel: '模板/晨间日记.md', content: [
    '# 晨间日记',
    '',
    '写三件感恩的事、今天最重要的一件事。',
    '#日记',
  ].join('\n') },
  { rel: '周总结-第35周.md', content: [
    '# 周总结 · 第35周',
    '',
    '本周开始尝试 [[09-01]] 中提到的节奏式深度工作法，反馈良好。',
    '#日记 #学习',
  ].join('\n') },
  { rel: '周回顾.md', content: [
    '# 周回顾',
    '',
    '回顾 [[9月目标]] 的达成情况，并规划下周。',
    '#日记 #计划',
  ].join('\n') },
  { rel: '学习计划.md', content: [
    '# 学习计划',
    '',
    '围绕 [[React学习]] 与 [[深度工作]] 建立每周节奏。目标见 [[9月目标]]。',
    '#计划 #学习',
  ].join('\n') },
  { rel: 'React学习.md', content: [
    '# React 学习',
    '',
    '组件化、Hooks、状态管理。与 [[技术栈整理]] 关联。',
    '#技术 #学习',
  ].join('\n') },
  { rel: '技术栈整理.md', content: [
    '# 技术栈整理',
    '',
    '包含 [[React学习]]、Electron、K8s 等方向的取舍记录。',
    '#技术',
  ].join('\n') },
  { rel: '9月目标.md', content: [
    '# 9月目标',
    '',
    '完成 [[深度工作]]、[[React学习]] 两个主线的第一阶段。',
    '#计划 #目标',
  ].join('\n') },
  { rel: '习惯追踪.md', content: [
    '# 习惯追踪',
    '',
    '记录每日晨跑、阅读与深度工作时段，关联 [[9月目标]]。',
    '#习惯',
  ].join('\n') },
];

/* 把相对路径安全解析为 vault 内绝对路径，越界则抛错 */
function resolveVaultPath(rel) {
  const root = path.resolve(vaultRoot());
  const abs = path.resolve(root, rel || '');
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('笔记路径越界: ' + rel);
  return abs;
}

/* 确保 vault 存在；首次为空则写入 seed 示例笔记库 */
async function ensureVault() {
  const root = vaultRoot();
  await fs.promises.mkdir(root, { recursive: true });
  const existing = await fs.promises.readdir(root).catch(() => []);
  if (existing.length > 0) return;
  for (const n of SEED_NOTES) {
    const abs = resolveVaultPath(n.rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, n.content, 'utf8');
  }
}

/* 递归扫描 vault，收集 .md 的基础信息（相对路径用 / 分隔），空目录也作为目录项返回
 * 返回值：该目录下含 .md 后代的数量（用于判定空目录） */
async function walkNotes(dir, base, out) {
  let items;
  try { items = await fs.promises.readdir(dir, { withFileTypes: true }); }
  catch { return 0; }
  let count = 0;
  for (const it of items) {
    if (it.name === META_DIR || it.name === RESOURCE_DIR) continue; // 跳过内部元数据目录 .second-brain 与上传资源目录 .resources，不进入笔记列表
    if (it.name.startsWith('.')) continue; // 跳过 .git/.obsidian/.github 等点开头隐藏项，避免目录被当笔记打开/进最近打开（见 Bug-065）
    const abs = path.join(dir, it.name);
    const rel = base ? base + '/' + it.name : it.name;
    if (it.isDirectory()) {
      const sub = await walkNotes(abs, rel, out);
      count += sub;
      // 空目录（无 .md 后代）输出目录项，便于文件树展示新建的空目录
      if (sub === 0) out.push({ path: rel, name: it.name, folder: rel, isFolder: true, mtime: Date.now(), size: 0 });
    } else if (it.isFile() && it.name.toLowerCase().endsWith('.md')) {
      const st = await fs.promises.stat(abs);
      out.push({ path: rel, name: it.name, folder: base || '', mtime: st.mtimeMs, size: st.size });
      count++;
    }
  }
  return count;
}

/* ============================================
 * 知识库元数据（.second-brain）
 * 在知识库目录下维护一个隐藏的 .second-brain 目录，
 * 每个目录一个 _meta.json 记录：笔记个数 / 占用大小 / 每篇笔记属性（id、字数、标签、大小、mtime）。
 * 在新建/保存/删除/移动目录或笔记时同步重建（scheduleMetaRefresh）。
 * 作者: 火 冰
 * ============================================ */

/** 知识库存放元数据的隐藏目录名 */
const META_DIR = '.second-brain';

/** 上传资源（图片/附件）的统一隐藏资源目录名（位于知识库根，UUID 重命名落盘） */
const RESOURCE_DIR = '.resources';

/** 雪花 id 生成器：为新建笔记分配全局唯一文档 id（mid 取 1，进程内单例保证递增唯一）。 */
const snowflake = new SnowflakeId({ mid: 1 });

/** 从笔记 frontmatter 提取属性：id / tags / 字数（去空白）。
 * @param {string} text 笔记全文
 * @param {string} name 笔记文件名（无 id 时的回退）
 * @param {string} [srcPath] 笔记完整相对路径（透传给 extractOutlinks 解析相对路径链接）
 * @returns {{noteId:string, tags:string[], wordCount:number, attachments:Array, outlinks:Array}}
 * @author 火 冰 */
function parseNoteMeta(text, name, srcPath) {
  let d = {};
  try { d = grayMatter(String(text || '')).data || {}; } catch (e) { /* frontmatter 解析失败按空处理 */ }
  const idAttr = (typeof d.id === 'string' && d.id.trim()) ? d.id.trim() : '';
  const rawTags = Array.isArray(d.tags) ? d.tags : [];
  const wordCount = String(text || '').replace(/\s+/g, '').length;
  const attachments = extractAttachments(text);
  const outlinks = extractOutlinks(text, srcPath);
  return { noteId: idAttr, tags: rawTags.map(String).filter(Boolean), wordCount, attachments, outlinks };
}

/** 图片扩展名集合（用于区分图片与普通附件） */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.svg', '.ico', '.tif', '.tiff']);

/** 从 Markdown 文本中提取附件/图片列表。
 *  识别三种语法:
 *    1. 图片: ![name](note://vault_res/uuid.ext)
 *    2. 附件引言: > [!attach] name note://vault_res/uuid.ext
 *    3. 普通链接附件: [name](note://vault_res/uuid.ext)
 *  @param {string} text 笔记全文
 *  @returns {Array<{name:string, url:string, type:string}>} 附件列表（type 为 'image' 或 'attachment'）
 *  @author 火 冰 */
function extractAttachments(text) {
  var result = [];
  var src = String(text || '');
  var seen = new Set();

  /* 图片: ![name](note://vault_res/uuid.ext) */
  var imgRe = /!\[([^\]]*)\]\((note:\/\/vault_res\/[^)\s]+)\)/g;
  var m;
  while ((m = imgRe.exec(src)) !== null) {
    var url = m[2];
    if (seen.has(url)) continue;
    seen.add(url);
    var ext = path.extname(url.split('/').pop() || '').toLowerCase();
    result.push({ name: m[1] || url.split('/').pop(), url: url, type: 'image' });
  }

  /* 附件引言: > [!attach] name note://vault_res/uuid.ext */
  var attachRe = />\s*\[!attach\]\s+(.+?)\s+(note:\/\/vault_res\/[^\s]+)/gi;
  while ((m = attachRe.exec(src)) !== null) {
    var url2 = m[2];
    if (seen.has(url2)) continue;
    seen.add(url2);
    result.push({ name: m[1].trim(), url: url2, type: 'attachment' });
  }

  /* 普通链接附件: [name](note://vault_res/uuid.ext)（排除已被图片匹配的 ![] 语法） */
  var linkRe = /(?<!\!)\[([^\]]*)\]\((note:\/\/vault_res\/[^)\s]+)\)/g;
  while ((m = linkRe.exec(src)) !== null) {
    var url3 = m[2];
    if (seen.has(url3)) continue;
    seen.add(url3);
    var ext3 = path.extname(url3.split('/').pop() || '').toLowerCase();
    result.push({ name: m[1] || url3.split('/').pop(), url: url3, type: IMAGE_EXTS.has(ext3) ? 'image' : 'attachment' });
  }

  return result;
}

/** 以基准目录解析相对路径（./ ../ 同目录 sub/ 等），返回归一后的正斜杠相对路径。
 *  @param {string} baseDir 基准目录相对路径（如 '日记/2024年'，根目录为 ''）
 *  @param {string} rel 待解析的相对路径（如 './09-02.md'、'../08-31.md'、'sibling.md'）
 *  @returns {string} 归一后的路径（如 '日记/08-31.md'）
 *  @author 火 冰 */
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

/** 从 Markdown 文本中提取正向链接（该笔记链接到的其他笔记）。
 *  识别两种语法:
 *    1. Wiki 链接: [[笔记名]] 或 [[笔记名|显示文本]]（按笔记名匹配，不解析相对路径）
 *    2. 相对路径链接: [text](路径.md)（非 note:// 和非 http 开头）；按源笔记所在目录解析为完整路径归一
 *  @param {string} text 笔记全文
 *  @param {string} [srcPath] 源笔记完整相对路径（用于解析相对路径链接，如 '日记/2024年/09-01.md'）
 *  @returns {Array<{path:string, name:string}>} 正向链接列表
 *  @author 火 冰 */
function extractOutlinks(text, srcPath) {
  var result = [];
  var src = String(text || '');
  var seen = new Set();
  /* 源笔记所在目录，用于解析相对路径链接 */
  var baseDir = '';
  if (srcPath) {
    var si = String(srcPath).lastIndexOf('/');
    baseDir = si >= 0 ? String(srcPath).slice(0, si) : '';
  }
  var ABS_RE = /^[/\\]/;   // 以 / 或 \ 开头 = 从库根写的完整路径

  /* 判断链接目标是否含路径结构（含分隔符或以 ./ ../ 开头），纯笔记名不含 */
  function pathLike(p) {
    return p.indexOf('/') >= 0 || p.indexOf('\\') >= 0 || /^\.\.?[/\\]/.test(p);
  }

  /* 按源笔记路径归一链接目标：/ 开头视为从库根完整路径；否则按源笔记所在目录解析相对路径 */
  function normalize(p) {
    var cleaned = String(p).replace(/^[/\\]+/, '');
    if (ABS_RE.test(String(p))) return cleaned;
    return resolveRelPath(baseDir, cleaned);
  }

  /* Wiki 链接: [[笔记名]] 或 [[笔记名|显示文本]]；纯笔记名保持全局匹配，含路径时按源笔记路径解析 */
  var wikiRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  var m;
  while ((m = wikiRe.exec(src)) !== null) {
    var target = m[1].trim();
    var targetPath = target.toLowerCase().endsWith('.md') ? target : target + '.md';
    var finalPath = pathLike(targetPath) ? normalize(targetPath) : targetPath;
    if (seen.has(finalPath)) continue;
    seen.add(finalPath);
    result.push({ path: finalPath, name: target });
  }

  /* 相对路径链接: [text](路径.md)（排除 note:// 和 http(s):// 开头）；一律按源笔记路径解析为完整路径归一 */
  var relRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((m = relRe.exec(src)) !== null) {
    var url = m[2].trim();
    if (/^(note:|https?:|mailto:|tel:|ftp:)/i.test(url)) continue;
    if (!url.toLowerCase().endsWith('.md')) continue;
    var resolved = normalize(url);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    var linkName = resolved.split('/').pop().replace(/\.md$/i, '');
    result.push({ path: resolved, name: linkName });
  }

  return result;
}

/** 从笔记 frontmatter 中移除 `id:` 字段，使 md 文件保持干净（id 改由 .second-brain 元数据追踪）。
 * 仅按行精确剔除 id 键，其它 frontmatter 与正文内容原样保留。
 * @param {string} src 笔记全文
 * @returns {{text:string, removed:boolean}} 处理后的全文 + 是否移除了 id
 * @author 火 冰 */
function stripMetaId(src) {
  const s = String(src || '').replace(/^\uFEFF/, '');
  // 匹配首个 frontmatter 块：开标签 --- / 块体 / 闭标签 --- / 之后全部正文内容
  const m = s.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*---[ \t]*(?:\r?\n)?([\s\S]*)$/);
  if (!m) return { text: s, removed: false };
  const body = m[1];
  const content = m[2]; // 闭标签后剩余全部（正文等）
  const filtered = [];
  let removed = false;
  // 按行切分 frontmatter，剔除孤立的 id 键行（可带缩进）
  const lines = body.split(/\r\n|\r|\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!removed && /^\s*id\s*:/.test(lines[i])) { removed = true; continue; }
    filtered.push(lines[i]);
  }
  if (!removed) return { text: s, removed: false };
  // 剔除 id 行后，收发端多余空行作轻量收敛
  while (filtered.length > 0 && filtered[0] === '') filtered.shift();
  while (filtered.length > 0 && filtered[filtered.length - 1] === '') filtered.pop();
  // id 是 frontmatter 唯一字段时，整块删空、直接保留正文，使 md 完全干净
  if (!filtered.some(function (l) { return l.trim() !== ''; })) return { text: content, removed: true };
  const text = '---\n' + filtered.join('\n') + '\n---' + (content ? '\n' + content : '\n');
  return { text, removed: true };
}

/** 确保笔记拥有唯一稳定雪花 id，但**不写入 md frontmatter**（md 保持干净）。
 * id 由 .second-brain/_meta.json 的 noteId 追踪；新笔记在首次元数据扫描时生成一次，之后复用。
 * @param {string} text 笔记全文（用于提取已存在的 frontmatter id 作为迁移回退）
 * @param {object} gen 雪花 id 生成器（单例）
 * @param {string} prevId 元数据中已有的稳定 id（优先复用）
 * @returns {string} 唯一雪花 id
 * @author 火 冰 */
function ensureNoteId(text, gen, prevId) {
  if (prevId) return prevId;
  try { const d = grayMatter(String(text || '')).data || {}; return (typeof d.id === 'string' && d.id.trim()) ? d.id.trim() : gen.generate(); }
  catch (e) { return gen.generate(); }
}

/** 递归扫描 vault（跳过 .second-brain），逐目录生成元数据记录。
 * 每条记录：dir / noteCount(直接 .md 数) / dirCount(直接子目录数) / size(递归占用字节) / totalNotes(递归笔记数)
 *          / notes[](直接笔记属性) / children[](子目录列表 type:'dir'，各带 size、mtime) / updatedAt。
 * @returns {Promise<Map<string, object>>} 目录相对路径('' 表示根) -> 记录
 * @author 火 冰 */
async function scanVaultMeta() {
  const records = new Map();
  await walkDirMeta('', records);
  /* 第二遍：根据全库正向链接计算反向链接 */
  try { computeBacklinks(records); } catch (e) { /* 反链计算失败不阻断重建 */ }
  return records;
}

/** 从指定目录 dirRel 起始，递归扫描并构建该目录（子树）的元数据记录到 records（可复用：''=全库）。
 *  保留旧记录中的「索引分块覆盖配置」(chunk) / 「稳定雪花 id」(noteId) / 索引时间(indexTime)。
 *  只读入磁盘与旧 _meta.json，不写任何目录镜像（写入由调用方决定）。
 *  @author 火 冰 */
async function walkDirMeta(dirRel, records) {
  const root = vaultRoot();
  const walk = async (dirRel2) => {
    const abs = dirRel2 ? path.join(root, dirRel2) : root;
    let items = [];
    try { items = await fs.promises.readdir(abs, { withFileTypes: true }); } catch (e) { return { bytes: 0, notes: 0 }; }
    const rec = { dir: dirRel2, noteCount: 0, dirCount: 0, size: 0, totalNotes: 0, totalSize: 0, notes: [], children: [], updatedAt: Date.now() };
    records.set(dirRel2, rec);
    const prevOverrides = {};
    const prevNoteIds = {};
    const prevIndexTimes = {};
    try {
      const prev = JSON.parse(await fs.promises.readFile(path.join(root, META_DIR, ...(dirRel2 ? dirRel2.split('/') : []), '_meta.json'), 'utf8'));
      if (prev && Array.isArray(prev.notes)) prev.notes.forEach(function (n) { if (n && n.chunk) prevOverrides[n.name] = n.chunk; if (n && n.noteId) prevNoteIds[n.name] = n.noteId; if (n && n.indexTime) prevIndexTimes[n.name] = n.indexTime; });
    } catch (e) { /* 无旧记录 */ }
    let subBytes = 0, subNotes = 0;
    const dirKids = [];   // children 只记录子目录
    for (const it of items) {
      if (it.name.startsWith('.')) continue;                                              // 跳过所有隐藏目录/文件（.git/.obsidian/.second-brain/.resources 等），不记录到元数据
      const childAbs = path.join(abs, it.name);
      const childRel = (dirRel2 ? dirRel2 + '/' : '') + it.name;
      if (it.isDirectory()) {
        rec.dirCount++;
        const r = await walk(childRel);
        subBytes += r.bytes;
        subNotes += r.notes;
        let st = null; try { st = await fs.promises.stat(childAbs); } catch (e) { /* 忽略 */ }
        dirKids.push({ name: it.name, type: 'dir', size: (records.get(childRel) || {}).totalSize || 0, mtime: st ? st.mtimeMs : 0 });
      } else if (it.isFile() && it.name.toLowerCase().endsWith('.md')) {
        let st = null;
        try { st = await fs.promises.stat(childAbs); } catch (e) { continue; }
        let text = '';
        try { text = await fs.promises.readFile(childAbs, 'utf8'); } catch (e) { /* 读失败仅记录元信息 */ }
        const noteId = ensureNoteId(text, snowflake, prevNoteIds[it.name]);
        const clean = stripMetaId(text);
        if (clean.removed) { try { await fs.promises.writeFile(childAbs, clean.text, 'utf8'); } catch (e) { /* 清理失败不阻断 */ } text = clean.text; }
        const pm = parseNoteMeta(text, it.name, childRel);
        rec.notes.push({ name: it.name, path: childRel, noteId: noteId, wordCount: pm.wordCount, tags: pm.tags, size: st.size, created: st.birthtimeMs, mtime: st.mtimeMs, chunk: prevOverrides[it.name] || undefined, indexTime: prevIndexTimes[it.name] || Date.now(), attachments: pm.attachments || [], outlinks: pm.outlinks || [] });
        rec.noteCount++;
        rec.size += st.size;
      }
    }
    rec.size += subBytes;         // 占用大小 = 目录下全部文件递归合计
    rec.totalNotes = rec.noteCount + subNotes;   // 笔记个数 = 直接 + 子孙
    rec.totalSize = rec.size;
    dirKids.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    rec.children = dirKids;
    return { bytes: rec.size, notes: rec.totalNotes };
  };
  await walk(dirRel);
}

/** 根据正向链接（outlinks）计算反向链接（backlinks）并回填到每篇笔记。
 *  遍历所有笔记的 outlinks，将 (源笔记 → 目标笔记) 的关系反转为 (目标笔记 → 源笔记)。
 *  @param {Map<string, object>} records scanVaultMeta 的产物
 *  @author 火 冰 */
function computeBacklinks(records) {
  const data = Array.isArray(records) ? records : Array.from(records.values());
  const srcSet = new Set();
  for (const rec of data) if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { srcSet.add(n); });
  computeBacklinksFor(records, srcSet);
}

/** 作用域反链回填：只为 records 中每篇笔记计算 backlinks（目标都在 records 内），
 *  反链「来源」取自 srcSet（可扩展到全库来源），这样重命名某目录后，
 *  外部目录指向该目录内笔记的反链也能同步更新，且不触碰外部目录的记录。
 *  @author 火 冰 */
function computeBacklinksFor(records, srcSet) {
  const data = Array.isArray(records) ? records : Array.from(records.values());
  const targets = new Map();
  for (const rec of data) {
    if (!rec || !Array.isArray(rec.notes)) continue;
    for (const t of rec.notes) { t.backlinks = []; targets.set(t.path, t); targets.set(t.name, t); }
  }
  for (const src of srcSet) {
    if (!src || !Array.isArray(src.outlinks)) continue;
    for (const link of src.outlinks) {
      const target = targets.get(link.path) || targets.get(link.name + '.md') || targets.get(link.name);
      if (target && target.path !== src.path) {
        // 去重：旧路径缓存来源与最新扫描来源可能指向同一实际笔记，避免反链重复
        if (!target.backlinks.some(function (b) { return b.path === src.path; })) {
          target.backlinks.push({ path: src.path, name: src.name.replace(/\.md$/i, '') });
        }
      }
    }
  }
}

/** 加载全库笔记 outlinks 快照（只读 .second-brain 下各目录 _meta.json 缓存，不重扫 md），
 *  并叠加当前已在 records 中最新扫描的笔记（其 outlinks 为权威来源），供作用域反链回填使用。
 *  @returns {Promise<Set<object>>} 笔记对象集合
 *  @author 火 冰 */
async function loadCachedSourceSet(records) {
  const srcSet = new Set();
  for (const rec of Array.from(records.values())) if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { srcSet.add(n); });
  const root = vaultRoot();
  const walk = async (dirRel) => {
    const metaAbs = path.join(root, META_DIR, ...(dirRel ? dirRel.split('/') : []), '_meta.json');
    let rec = null; try { rec = JSON.parse(await fs.promises.readFile(metaAbs, 'utf8')); } catch (e) { /* 无记录 */ }
    if (rec && Array.isArray(rec.notes)) rec.notes.forEach(function (n) { srcSet.add(n); });
    if (rec && Array.isArray(rec.children)) for (const c of rec.children) if (c.type === 'dir') await walk(dirRel ? dirRel + '/' + c.name : c.name);
  };
  await walk('');
  return srcSet;
}

/** 作用域写入：仅把 records 中（某目录子树）的镜像 _meta.json 落盘，并从 startRel 镜像起清理子树内已不存在的残留，不动其它目录镜像。
 *  @author 火 冰 */
async function writeDirMeta(records, startRel) {
  const metaRoot = path.join(vaultRoot(), META_DIR);
  for (const [dir, rec] of Array.from(records.entries())) {
    const trim = dir ? (dir.split('/').map(function (s) { return s.trim(); }).filter(Boolean).join('/')) : '';
    const mirrorAbs = path.join(metaRoot, ...(trim ? trim.split('/') : []));
    try {
      await fs.promises.mkdir(mirrorAbs, { recursive: true });
      await fs.promises.writeFile(path.join(mirrorAbs, '_meta.json'), JSON.stringify(rec, null, 2), 'utf8');
    } catch (e) { /* 单个目录元数据写入失败不阻断 */ }
  }
  if (startRel) await pruneDirMeta(metaRoot, records, startRel);
}

/** 仅从 startRel 镜像子树开始，清理磁盘上已不存在的残留目录镜像（只清理该子树内）。
 *  不会触碰 startRel 之外的任何镜像目录。根级（''）不清理。作者: 火 冰 */
async function pruneDirMeta(metaRoot, records, startRel) {
  if (!startRel) return;
  const startAbs = path.join(metaRoot, ...startRel.split('/'));
  const walk = async (mirrorAbs, rel) => {
    let items = []; try { items = await fs.promises.readdir(mirrorAbs, { withFileTypes: true }); } catch (e) { return; }
    for (const it of items) {
      const abs = path.join(mirrorAbs, it.name);
      const childRel = rel ? rel + '/' + it.name : it.name;
      if (it.isDirectory()) {
        if (records.has(childRel)) await walk(abs, childRel);
        else { try { await fs.promises.rm(abs, { recursive: true, force: true }); } catch (e) { /* 忽略 */ } }
      } else if (it.isFile() && it.name === '_meta.json') {
        if (!records.has(rel)) { try { await fs.promises.rm(abs, { force: true }); } catch (e) { /* 忽略 */ } }
      }
    }
  };
  await walk(startAbs, startRel);
}

/** 重建指定目录子树的元数据（不重建全库）：仅索引该目录(及其祖先父级以更新 children)的笔记信息，
 *  并同步调整与其关联的反向链接（来自全库既有 outlinks 缓存）。
 *  scopeParent=true（目录重命名场景）时同时重建其父目录记录以刷新 children 子目录列表；
 *  scopeParent=false（文件重命名场景）时只重建该目录本身。
 *  返回 { dirs, notes }。作者: 火 冰 */
vaultHandle('notes:refreshDirMeta', async (_e, rel, scopeParent) => {
  await ensureVault();
  const clean = String(rel || '').trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
  const startRel = scopeParent && clean.includes('/') ? clean.slice(0, clean.lastIndexOf('/')) : clean;
  const records = new Map();
  await walkDirMeta(startRel, records);
  // 反链：以全库既有 outlinks 缓存为来源，只对目标位于本(子)树内的笔记回填 backlinks
  const srcSet = await loadCachedSourceSet(records);
  computeBacklinksFor(records, srcSet);
  await writeDirMeta(records, startRel);
  let notes = 0; for (const rec of records.values()) if (rec.notes) notes += rec.notes.length;
  return { dirs: records.size, notes: notes };
});

/** 将元数据记录逐目录写入 .second-brain/<dir>/_meta.json，并清理不对应现存目录的镜像残留。
 * @param {Map<string, object>} records scanVaultMeta 的产物
 * @returns {Promise<void>}
 * @author 火 冰 */
async function writeVaultMeta(records) {
  const root = vaultRoot();
  const metaRoot = path.join(root, META_DIR);
  for (const [dir, rec] of records) {
    const trim = dir ? (dir.split('/').map(function (s) { return s.trim(); }).filter(Boolean).join('/')) : '';
    const mirrorAbs = path.join(metaRoot, ...(trim ? trim.split('/') : []));
    try {
      await fs.promises.mkdir(mirrorAbs, { recursive: true });
      await fs.promises.writeFile(path.join(mirrorAbs, '_meta.json'), JSON.stringify(rec, null, 2), 'utf8');
    } catch (e) { /* 单个目录元数据写入失败不阻断整体重建 */ }
  }
  try { await pruneMeta(metaRoot, records, ''); } catch (e) { /* 清理残留镜像失败不阻断 */ }
}

/** 清理 .second-brain 中不对应现存目录的镜像（目录被改名/删除/移动后同步移除残留记录文件）。
 * @author 火 冰 */
async function pruneMeta(metaRoot, records, baseRel) {
  let items = [];
  try { items = await fs.promises.readdir(metaRoot, { withFileTypes: true }); } catch (e) { return; }
  for (const it of items) {
    const abs = path.join(metaRoot, it.name);
    const rel = baseRel ? baseRel + '/' + it.name : it.name;
    if (it.isDirectory()) {
      if (records.has(rel)) await pruneMeta(abs, records, rel);   // 目录仍存在 → 递归清理其子树
      else await fs.promises.rm(abs, { recursive: true, force: true });  // 目录已不存在 → 删除整个镜像
    } else if (it.isFile() && it.name === '_meta.json') {
      if (!records.has(baseRel)) await fs.promises.rm(abs, { force: true }); // 根/子目录镜像多余 → 删除
    }
  }
}

/** 后台重建 .second-brain 元数据（异步、失败不阻塞主流程）。 */
function scheduleMetaRefresh() {
  scanVaultMeta().then(writeVaultMeta).catch(function () { /* 元数据刷新失败不阻塞 */ });
}

/* 手动重建元数据（返回概览） */
vaultHandle('notes:refreshMeta', async () => {
  await ensureVault();
  const records = await scanVaultMeta();
  await writeVaultMeta(records);
  return { dirs: records.size, updatedAt: Date.now() };
});

/* 读取某篇笔记所在目录的元数据记录 + 该笔记自身属性；缺失时自动重建后重读。
 * 返回 { dir, noteName, meta, note }。 */
vaultHandle('notes:fileMeta', async (_e, rel) => {
  await ensureVault();
  const r = String(rel || '').replace(/^\/+/, '');
  const i = r.lastIndexOf('/');
  const dir = i > 0 ? r.slice(0, i) : '';
  const name = i > 0 ? r.slice(i + 1) : r;
  const metaAbs = path.join(vaultRoot(), META_DIR, ...(dir ? dir.split('/') : []), '_meta.json');
  const readRecord = async () => { try { return JSON.parse(await fs.promises.readFile(metaAbs, 'utf8')); } catch (e) { return null; } };
  let rec = await readRecord();
  if (!rec) { // 记录缺失（首次进入或目录操作后）：同步重建后重读
    const records = await scanVaultMeta();
    await writeVaultMeta(records);
    rec = await readRecord();
  }
  const note = rec && Array.isArray(rec.notes) ? (rec.notes.find(function (n) { return n.name === name; }) || null) : null;
  return { dir, noteName: name, meta: rec, note };
});

/* 读取某目录的元数据记录（目录属性：文件列表 children + 总大小等）；缺失时自动重建后重读。
 * dir 为目录相对路径，'' 表示根目录。返回该目录记录对象。 */
vaultHandle('notes:dirMeta', async (_e, dir) => {
  await ensureVault();
  const clean = String(dir || '').trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\\/g, '/');
  const metaAbs = path.join(vaultRoot(), META_DIR, ...(clean ? clean.split('/') : []), '_meta.json');
  const readRecord = async () => { try { return JSON.parse(await fs.promises.readFile(metaAbs, 'utf8')); } catch (e) { return null; } };
  let rec = await readRecord();
  if (!rec) { // 记录缺失（首次进入或变更后）：同步重建后重读
    const records = await scanVaultMeta();
    await writeVaultMeta(records);
    rec = await readRecord();
  }
  // 附加目录实体在磁盘上的创建/修改时间（'' 为根目录→对库根 stat）
  try {
    const dirAbs = clean ? resolveVaultPath(clean) : vaultRoot();
    const st = await fs.promises.stat(dirAbs);
    rec = Object.assign({}, rec, { created: st.birthtimeMs || Date.now(), mtime: st.mtimeMs || Date.now() });
  } catch (e) { /* 目录已不存在时保持缺省时间 */ }
  return rec || { dir: clean, noteCount: 0, dirCount: 0, size: 0, totalNotes: 0, totalSize: 0, notes: [], children: [], updatedAt: 0 };
});

/** 读取全库链接索引（outlinks/backlinks 摘要）供图谱视图与反向链接消费。
 *  只读现有 _meta.json，不触发重建；递归遍历所有目录记录收集每篇笔记的 outlinks/backlinks。
 *  @returns {Promise<Array<{path:string,name:string,outlinks:Array,backlinks:Array}>>}
 *  @author 火 冰 */
vaultHandle('notes:linksIndex', async () => {
  await ensureVault();
  const root = vaultRoot();
  const result = [];
  const walk = async (dirRel) => {
    const metaAbs = path.join(root, META_DIR, ...(dirRel ? dirRel.split('/') : []), '_meta.json');
    let rec = null;
    try { rec = JSON.parse(await fs.promises.readFile(metaAbs, 'utf8')); } catch (e) { /* 无记录 */ }
    if (rec && Array.isArray(rec.notes)) {
      for (const n of rec.notes) {
        result.push({ path: n.path, name: n.name, outlinks: Array.isArray(n.outlinks) ? n.outlinks : [], backlinks: Array.isArray(n.backlinks) ? n.backlinks : [] });
      }
    }
    if (rec && Array.isArray(rec.children)) {
      for (const c of rec.children) {
        if (c.type === 'dir') await walk(dirRel ? dirRel + '/' + c.name : c.name);
      }
    }
  };
  await walk('');
  return result;
});

/* 最近打开笔记的记录文件（存放于 .second-brain 根目录，多条路径按最近在前） */
function recentMetaFile() { return path.join(vaultRoot(), META_DIR, 'recent.json'); }

/* 读取最近打开的笔记路径列表（.second-brain/recent.json）；兼容旧版纯数组与新版 {tabs,pinned}。
 * 过滤掉已不存在/非 .md 的项；锁定集合也仅保留仍存在且仍打开的项。
 * @returns {Promise<{tabs:string[], pinned:string[]}>} 相对路径数组（最近在前） + 锁定 path 集合 */
vaultHandle('notes:recentLoad', async () => {
  try {
    const raw = JSON.parse(await fs.promises.readFile(recentMetaFile(), 'utf8'));
    let tabs = [], pinned = [];
    if (Array.isArray(raw)) tabs = raw;                                            // 旧格式：纯路径数组
    else if (raw && Array.isArray(raw.tabs)) { tabs = raw.tabs; pinned = Array.isArray(raw.pinned) ? raw.pinned : []; }
    else return { tabs: [], pinned: [] };
    const out = [];
    for (const p of tabs) {
      if (typeof p !== 'string' || !p.trim()) continue;
      const rel = String(p).replace(/^[\\/]+/, '');
      if (!rel.toLowerCase().endsWith('.md')) continue;
      try {
        const st = await fs.promises.stat(resolveVaultPath(rel));
        if (st.isFile()) out.push(rel);
      } catch (e) { /* 文件被删除则跳过 */ }
    }
    const pinOut = pinned.filter(function (p) { return typeof p === 'string' && out.indexOf(p) !== -1; });
    return { tabs: out, pinned: pinOut };
  } catch (e) { return { tabs: [], pinned: [] }; } // 无记录文件视为首次使用
});

/* 保存最近打开的笔记路径列表（.second-brain/recent.json），含锁定集合。
 * @param {string[]|{tabs:string[], pinned:string[]}} paths 兼容旧版传入纯数组 */
vaultHandle('notes:recentSave', async (_e, paths) => {
  try {
    let tabs = [], pinned = [];
    if (Array.isArray(paths)) tabs = paths;                                        // 旧格式：纯数组
    else if (paths && typeof paths === 'object') { tabs = Array.isArray(paths.tabs) ? paths.tabs : []; pinned = Array.isArray(paths.pinned) ? paths.pinned : []; }
    tabs = tabs.filter(function (p) { return typeof p === 'string' && p.trim(); });
    pinned = pinned.filter(function (p) { return typeof p === 'string' && p.trim(); });
    await fs.promises.mkdir(path.dirname(recentMetaFile()), { recursive: true });
    await fs.promises.writeFile(recentMetaFile(), JSON.stringify({ tabs, pinned }, null, 2), 'utf8');
  } catch (e) { /* 记录保存失败不阻断 */ }
});

/* 保存某篇笔记的「索引分块」覆盖配置（块大小 / 相邻重叠 / 可选显式偏移值）。
 * chunk = { blockSize, overlap, offsets? }；传入 chunk={reset:true} 清除覆盖、改按全局默认生成。
 * 写入该笔记所在目录 .second-brain/_meta.json 的笔记记录 chunk 字段。
 * @returns {Promise<{ok:boolean}>} */
vaultHandle('notes:saveNoteChunk', async (_e, rel, chunk) => {
  await ensureVault();
  const r = String(rel || '').replace(/^\/+/, '');
  const i = r.lastIndexOf('/');
  const dir = i > 0 ? r.slice(0, i) : '';
  const name = i > 0 ? r.slice(i + 1) : r;
  const metaAbs = path.join(vaultRoot(), META_DIR, ...(dir ? dir.split('/') : []), '_meta.json');
  try {
    const rec = JSON.parse(await fs.promises.readFile(metaAbs, 'utf8'));
    const note = rec && Array.isArray(rec.notes) ? rec.notes.find(function (n) { return n.name === name; }) : null;
    if (!note) return { ok: false };
    const c = chunk || {};
    if (c.reset) { delete note.chunk; }
    else {
      const offs = Array.isArray(c.offsets) && c.offsets.length
        ? c.offsets.map(Number).filter(function (v) { return isFinite(v) && v >= 0; }).sort(function (a, b) { return a - b; })
        : null;
      const val = {
        blockSize: Math.max(1, Math.floor(Number(c.blockSize) || 200)),
        overlap: Math.max(0, Math.floor(Number(c.overlap) || 0)),
        strategy: c.strategy === 'semantic' ? 'semantic' : 'fixed',   // 单笔记分块策略覆盖（默认固定字符）
      };
      if (offs) val.offsets = offs;
      note.chunk = val;
    }
    await fs.promises.writeFile(metaAbs, JSON.stringify(rec, null, 2), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

/* 预览某篇笔记按给定分块配置生成的索引分块（供「属性 → 索引分块」面板编辑时实时展示）。
 * size/overlap/offsets 为用户在面板填写/调整的值（maxChunkSize 为单块长度上限，0=不限制）；从磁盘读取笔记原文切分。
 * @returns {Promise<{ok:boolean, textLen?:number, blocks?:Array<{text,start,end}>}>} */
vaultHandle('ai:previewChunk', async (_e, rel, size, overlap, offsets, maxChunkSize, strategy, fileName) => {
  await ensureVault();
  const abs = path.join(vaultRoot(), String(rel || '').replace(/^\/+/, ''));
  let text = '';
  try { text = await fs.promises.readFile(abs, 'utf8'); } catch (e) { return { ok: false }; }
  const blocks = chunkConfigured(text, size, overlap, (Array.isArray(offsets) && offsets.length) ? offsets.map(Number) : null, maxChunkSize, strategy, fileName || path.basename(rel || ''));
  return { ok: true, textLen: text.replace(/\r\n/g, '\n').length, blocks };
});

/* 列出笔记库全部笔记 */
vaultHandle('notes:list', async () => {
  await ensureVault();
  const out = [];
  await walkNotes(vaultRoot(), '', out);
  return out;
});

/* 读取单篇笔记原文 */
vaultHandle('notes:read', async (_e, rel) => {
  await ensureVault();
  const abs = resolveVaultPath(rel);
  const st = await fs.promises.lstat(abs).catch(() => null);   // 目录当作文件读会抛裸 EISDIR，先判定给清晰错误
  if (st && st.isDirectory()) {
    throw new Error('EISDIR: 目标是目录而非笔记文件，无法读取: ' + rel);
  }
  return await fs.promises.readFile(abs, 'utf8');
});

/* 保存单篇笔记（自动建父目录）；保存后增量更新该笔记的索引块 */
vaultHandle('notes:save', async (_e, rel, content) => {
  const abs = resolveVaultPath(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content || '', 'utf8');
  aiEngine.updateNote(rel).catch(function () { /* 单篇增量索引更新失败不阻塞保存 */ });
  scheduleMetaRefresh();
  return true;
});

/* 新建笔记：dir 为所在目录（相对路径），返回规范化的相对路径 */
vaultHandle('notes:create', async (_e, name, dir) => {
  await ensureVault();
  const clean = (name || '').trim();
  if (!clean) throw new Error('笔记名不能为空');
  const fileName = clean.toLowerCase().endsWith('.md') ? clean : clean + '.md';
  const rel = (dir && dir.trim()) ? dir.replace(/[\\/]+$/, '') + '/' + fileName : fileName;
  const abs = resolveVaultPath(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) {
    // 新建笔记不写入任何内容（md 保持干净，不预置标题）。标题由编辑器顶部标题区
    // 显示（默认取文件名），双击可改并同步文件名与正文。雪花 id 由 .second-brain/_meta.json
    // 的 noteId 追踪：首次扫描时生成一次、之后复用，重命名不变更 id。已有文件不覆写。
    await fs.promises.writeFile(abs, '', 'utf8');
  }
  aiEngine.updateNote(rel).catch(function () { /* 新建笔记后续索引更新失败不阻塞 */ });
  scheduleMetaRefresh();
  return rel;
});

/* 新建目录：dir 为目标目录相对路径（支持多级如 a/b），返回规范化的相对路径 */
vaultHandle('notes:createDir', async (_e, dir) => {
  await ensureVault();
  const clean = (dir || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
  if (!clean) throw new Error('目录名不能为空');
  const rel = clean.replace(/\\/g, '/');
  await fs.promises.mkdir(resolveVaultPath(rel), { recursive: true });
  scheduleMetaRefresh();
  return rel;
});

/* 删除单篇笔记：先清理笔记内引用的资源文件（图片/附件），再删除 .md 文件并移除索引。
 * @param {string} rel 笔记相对路径
 * @returns {Promise<boolean>} 是否删除成功
 * @author 火 冰 */
vaultHandle('notes:delete', async (_e, rel) => {
  const abs = resolveVaultPath(rel);
  /* 删除前先清理笔记内引用的资源文件 */
  try {
    if (fs.existsSync(abs)) {
      const text = await fs.promises.readFile(abs, 'utf8');
      const attachments = extractAttachments(text);
      const resDir = path.join(vaultRoot(), RESOURCE_DIR);
      for (var i = 0; i < attachments.length; i++) {
        var m = String(attachments[i].url).match(/^note:\/\/vault_res\/([^?#]+)/);
        if (m) {
          var resAbs = path.join(resDir, m[1]);
          try { if (fs.existsSync(resAbs)) await fs.promises.unlink(resAbs); } catch (e) { /* 资源删除失败不阻断 */ }
        }
      }
    }
  } catch (e) { /* 读取/解析失败不阻断删除 */ }
  if (fs.existsSync(abs)) { await fs.promises.unlink(abs); }
  aiEngine.removeNote(rel).catch(function () { /* 移除索引失败不阻塞删除 */ });
  scheduleMetaRefresh();
  return true;
});

/* 在系统文件管理器中显示该笔记（右键菜单） */
vaultHandle('notes:reveal', async (_e, rel) => {
  const abs = resolveVaultPath(rel);
  if (!fs.existsSync(abs)) return false;
  shell.showItemInFolder(abs);
  return true;
});

/* 上传资源（图片/附件）：落盘到知识库隐藏资源目录 .resources，用 UUID 重命名并保留扩展名，
 * 返回 { url, name }；url 为 note://vault_res/<uuid.ext>，name 为原始真实文件名（笔记链接文本用）。
 * @param {string}   fileName 原始文件名（用于保留扩展名 + 返回真实名）
 * @param {ArrayBuffer|Uint8Array} dataBuf 文件二进制内容
 * @author 火 冰 */
vaultHandle('notes:uploadResource', async (_e, fileName, dataBuf) => {
  const name = String(fileName || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  if (!name) throw new Error('文件名为空');
  const ext = path.extname(name).toLowerCase();
  const stored = randomUUID() + ext;              // 落盘用 UUID 名，笔记内始终引用真实名
  const resDir = path.join(vaultRoot(), RESOURCE_DIR);
  await fs.promises.mkdir(resDir, { recursive: true });
  await fs.promises.writeFile(path.join(resDir, stored), Buffer.from(dataBuf));
  return { url: 'note://vault_res/' + stored, name: name };
});

/* 用系统默认程序打开上传的资源文件（附件点击，如 pdf/zip/sh/bat/doc/xls/html）。
 * @param {string} stored 资源存储名（uuid.ext，取自 note://vault_res/ 路径）
 * @author 火 冰 */
vaultHandle('notes:openResource', async (_e, stored) => {
  const clean = String(stored || '');
  const segs = clean.split('/').filter(Boolean);
  if (!clean || segs.includes('..')) return false;   // 防路径穿越：仅允许 .resources 内的平级文件
  const abs = path.join(vaultRoot(), RESOURCE_DIR, ...segs);
  if (!fs.existsSync(abs)) return false;
  shell.openPath(abs);
  return true;
});

/* 用系统默认浏览器打开外部 URL（http/https 链接）。
 * @param {string} url 外部链接 URL（必须 http/https 协议）
 * @returns {Promise<boolean>} 是否成功调用
 * @author 火 冰 */
vaultHandle('notes:openExternal', async (_e, url) => {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;   // 仅允许 http/https
  await shell.openExternal(u);
  return true;
});

/* 删除上传的资源文件（图片/附件）：从 .resources 目录物理删除，并刷新元数据。
 * @param {string} url note://vault_res/uuid.ext 资源地址或存储名
 * @returns {Promise<boolean>} 是否删除成功
 * @author 火 冰 */
vaultHandle('notes:deleteResource', async (_e, url) => {
  var stored = String(url || '');
  /* 支持传入完整 note://vault_res/uuid.ext 或纯存储名 uuid.ext */
  var m = stored.match(/^note:\/\/vault_res\/([^?#]+)/);
  if (m) stored = m[1];
  const segs = stored.split('/').filter(Boolean);
  if (!stored || segs.includes('..')) return false;
  const abs = path.join(vaultRoot(), RESOURCE_DIR, ...segs);
  try {
    if (fs.existsSync(abs)) await fs.promises.unlink(abs);
  } catch (e) { /* 删除失败不阻断 */ }
  scheduleMetaRefresh();
  return true;
});

/* 移动目录：把 oldDir 整体搬到 newParent 下（保留内部相对结构 + 空目录）。
 * 同卷用 fs.rename，跨卷失败则复制后删除源，确保源目录被彻底移除。
 * 移动后为目录内全部 .md 重绑 AI 索引（旧路径清除 + 新路径重建）。
 * 返回 { dir, moved }：dir 为移动后相对路径，moved 为移动的 .md 篇数。
 * 作者: 火 冰 */
vaultHandle('notes:moveDir', async (_e, oldDir, newParent) => {
  const oldClean = String(oldDir || '').replace(/[\\/]+$/, '');
  if (!oldClean) throw new Error('目录不能为空');
  const srcAbs = resolveVaultPath(oldClean);
  if (!fs.existsSync(srcAbs)) throw new Error('源目录不存在: ' + oldClean);

  const name = oldClean.split('/').pop();
  const newBase = String(newParent || '').replace(/[\\/]+$/, '');
  const dstRel = newBase ? newBase + '/' + name : name;
  // 禁止移动到自身子目录内
  if (dstRel.startsWith(oldClean + '/')) {
    throw new Error('不能把目录移动到它自己的子目录里');
  }
  const dstAbs = resolveVaultPath(dstRel);
  if (dstAbs === srcAbs) {
    // 原地：相对路径未变（如根级目录拖回根空白区），无实际移动，直接返回
    const out0 = [];
    await walkNotes(srcAbs, oldClean, out0);
    return { dir: oldClean, moved: out0.filter(function (n) { return !n.isFolder; }).length };
  }
  if (fs.existsSync(dstAbs)) {
    const exist = await fs.promises.readdir(dstAbs).catch(() => []);
    if (exist.length > 0) throw new Error('目标目录已存在，无法移动');
  }
  await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  try {
    await fs.promises.rename(srcAbs, dstAbs);          // 同卷：秒级原子移动
  } catch (e) {                                        // 跨卷：复制后删源，源目录被移除
    await fs.promises.cp(srcAbs, dstAbs, { recursive: true });
    await fs.promises.rm(srcAbs, { recursive: true, force: true });
  }
  // 重建目录内全部笔记的 AI 索引：旧相对路径清除、新相对路径重建
  const out = [];
  await walkNotes(dstAbs, dstRel, out);
  const files = out.filter(function (n) { return !n.isFolder; });
  for (const n of files) {
    const oldRel = oldClean + n.path.slice(dstRel.length);
    aiEngine.removeNote(oldRel).catch(function () {});
    aiEngine.updateNote(n.path).catch(function () {});
  }
  scheduleMetaRefresh();
  return { dir: dstRel, moved: files.length };
});

/* 重命名目录：把 oldDir 的末级目录名改为 newName（父级不变，保留内部相对结构 + 空目录）。
 * 与 notes:moveDir 同卷用 fs.rename、跨卷复制后删源；重命名后为目录内全部 .md 重绑 AI 索引。
 * 并对全库元数据排程重建，确保该目录及其全部子孙目录的 _meta.json 数据更新。
 * 返回 { dir, moved }：dir 为重命名后的相对路径，moved 为目录内的 .md 篇数。
 * 作者: 火 冰 */
vaultHandle('notes:renameDir', async (_e, oldDir, newName) => {
  const oldClean = String(oldDir || '').replace(/[\\/]+$/, '');
  if (!oldClean) throw new Error('目录不能为空');
  const name = String(newName || '').trim();
  if (!name || name.includes('/') || name.includes('\\')) throw new Error('目录名不合法');
  const srcAbs = resolveVaultPath(oldClean);
  if (!fs.existsSync(srcAbs)) throw new Error('源目录不存在: ' + oldClean);
  // 同名无事可做：直接统计目录内笔记数返回
  if (name === oldClean.split('/').pop()) {
    const out0 = [];
    await walkNotes(srcAbs, oldClean, out0);
    return { dir: oldClean, moved: out0.filter(function (n) { return !n.isFolder; }).length };
  }
  const parent = oldClean.includes('/') ? oldClean.slice(0, oldClean.lastIndexOf('/')) : '';
  const dstRel = parent ? parent + '/' + name : name;
  const dstAbs = resolveVaultPath(dstRel);
  if (fs.existsSync(dstAbs)) {
    const exist = await fs.promises.readdir(dstAbs).catch(() => []);
    if (exist.length > 0) throw new Error('目标目录已存在，无法重命名');
  }
  await fs.promises.mkdir(path.dirname(dstAbs), { recursive: true });
  try {
    await fs.promises.rename(srcAbs, dstAbs);          // 同卷：秒级原子移动
  } catch (e) {                                        // 跨卷：复制后删源，源目录被移除
    await fs.promises.cp(srcAbs, dstAbs, { recursive: true });
    await fs.promises.rm(srcAbs, { recursive: true, force: true });
  }
  // 重建目录内全部笔记的 AI 索引：旧相对路径清除、新相对路径重建
  const out = [];
  await walkNotes(dstAbs, dstRel, out);
  const files = out.filter(function (n) { return !n.isFolder; });
  for (const n of files) {
    const oldRel = oldClean + n.path.slice(dstRel.length);
    aiEngine.removeNote(oldRel).catch(function () {});
    aiEngine.updateNote(n.path).catch(function () {});
  }
  scheduleMetaRefresh();
  return { dir: dstRel, moved: files.length };
});

/* 删除目录：递归删除该目录（连同所有笔记、子目录与空目录本身），并清理目录内 .md 的 AI 索引。
 * 返回删除的 .md 篇数。作者: 火 冰 */
vaultHandle('notes:removeDir', async (_e, dir) => {
  const clean = String(dir || '').replace(/[\\/]+$/, '');
  if (!clean) throw new Error('目录不能为空');
  const abs = resolveVaultPath(clean);
  if (!fs.existsSync(abs)) return 0;
  // 先清理目录内全部 .md 的 AI 索引，再删除目录实体
  const out = [];
  await walkNotes(abs, clean, out);
  const files = out.filter(function (n) { return !n.isFolder; });
  for (const n of files) aiEngine.removeNote(n.path).catch(function () {});
  await fs.promises.rm(abs, { recursive: true, force: true });
  scheduleMetaRefresh();
  return files.length;
});

/* ---------- 笔记库选择 IPC（标题栏库选择器） ---------- */

/* 获取当前笔记库信息：绝对路径 + 显示名（默认库显示「我的笔记库」）+ 默认库路径（按发起窗口解析） */
vaultHandle('vault:get', async (event) => {
  const p = vaultRoot();
  scheduleMetaRefresh(); // 打开知识库时后台构建全库（当前目录及全部子目录）的属性数据
  const binding = windowVaultBinding(event);
  return { path: p, name: binding ? path.basename(p) : '我的笔记库', defaultPath: defaultVaultRoot(), history: vaultHistory.slice() };
});

/* 打开目录选择器：选中即在**新主窗口**打开该知识库（当前窗口不变）。
 * 目标库已有窗口时聚焦已有窗口（单库单窗口），记入历史并持久化下次启动库。 */
vaultHandle('vault:choose', async (event) => {
  const r = await dialog.showOpenDialog(winFromEvent(event), {
    title: '选择或新建笔记库目录',
    buttonLabel: '打开此目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const target = path.resolve(r.filePaths[0]);
  recordHistory(vaultRoot()); // 把当前窗口的库记入最近打开
  recordHistory(target);
  currentVault = target; // 持久化：下次启动主窗口打开该库
  saveConfig();
  openVaultWindow(target); // 新开窗口 / 聚焦已有窗口
  refreshTrayMenu(); // 库列表变化后刷新托盘菜单
  return { canceled: false, opened: true };
});

/* 切换库（历史库列表点击）：在**新主窗口**打开目标库（当前窗口不变）。
 * 目录不存在或无历史路径时拒绝；目标库已有窗口时聚焦已有窗口。 */
vaultHandle('vault:switch', async (event, dir) => {
  if (!dir || typeof dir !== 'string') return { canceled: true };
  if (!fs.existsSync(dir)) return { canceled: true };
  const target = path.resolve(dir);
  recordHistory(vaultRoot()); // 把当前窗口的库记入最近打开
  recordHistory(target);
  currentVault = target; // 持久化：下次启动主窗口打开该库
  saveConfig();
  openVaultWindow(target); // 新开窗口 / 聚焦已有窗口
  refreshTrayMenu(); // 库列表变化后刷新托盘菜单
  return { canceled: false, opened: true };
});

/* 从历史列表移除某库（仅移出历史，不改当前窗口） */
vaultHandle('vault:remove', async (event, dir) => {
  if (!dir) return { history: vaultHistory.slice() };
  const delKey = vaultKey(dir);
  // 检测并同步关闭绑定该知识库的已打开窗口（含跟随默认库即绑定 null 但默认库路径等于目标库的情况）
  for (const [winId, vp] of winVaults) {
    const w = BrowserWindow.fromId(winId);
    if (!w || w.isDestroyed()) continue;
    const wKey = (vp || defaultVaultRoot()) && vaultKey(vp || defaultVaultRoot());
    // 发起删除的窗口允许保留（渲染端删除后自行关闭下拉，无需关闭发起窗口）；跳过发起窗口
    if (w.webContents.id === (event.sender && event.sender.id)) continue;
    if (wKey === delKey) w.close();
  }
  vaultHistory = vaultHistory.filter(function (h) { return String(h.path).toLowerCase() !== delKey; });
  saveConfig();
  syncVaultWinMap(); // 删除后重建 库→窗口 映射
  refreshTrayMenu(); // 历史变化后刷新托盘菜单
  return { history: vaultHistory.slice() };
});

/* 恢复默认笔记库（userData/vault 或已迁移后的新默认库）：在新主窗口打开默认库（当前窗口不变） */
vaultHandle('vault:reset', async () => {
  recordHistory(vaultRoot()); // 把当前窗口的库记入最近打开
  currentVault = null; // 持久化：下次启动主窗口打开默认库
  saveConfig();
  openVaultWindow(defaultVaultRoot()); // 新开窗口 / 聚焦已有默认库窗口
  refreshTrayMenu(); // 库列表变化后刷新托盘菜单
  return { canceled: false, opened: true };
});

/* ============================================
 * 插件目录 IPC
 * 每个插件是一个独立目录：plugins/<id>/manifest.json + main.js
 * 主进程负责扫描目录清单（渲染进程通过 note:// fetch 加载插件代码）
 * ============================================ */

/* 插件根目录（应用根目录下的 plugins/） */
function pluginsRoot() { return path.join(ROOT, 'plugins'); }

/**
 * 扫描插件目录：读取每个子目录的 manifest.json，返回插件清单
 * @returns {Promise<{id:string, dir:string, manifest:Object, hasMain:boolean}[]>}
 */
async function scanPlugins() {
  const root = pluginsRoot();
  const out = [];
  let entries = [];
  try { entries = await fs.promises.readdir(root, { withFileTypes: true }); }
  catch (e) { return out; } // 目录不存在视为无插件
  for (const it of entries) {
    if (!it.isDirectory()) continue;
    const dir = path.join(root, it.name);
    const mf = path.join(dir, 'manifest.json');
    let manifest = null;
    try { manifest = JSON.parse(await fs.promises.readFile(mf, 'utf8')); }
    catch (e) { continue; } // manifest 缺失或损坏的目录跳过
    if (!manifest || !manifest.id) continue;
    out.push({ id: manifest.id, dir: dir, manifest: manifest, hasMain: fs.existsSync(path.join(dir, 'main.js')) });
  }
  return out;
}

/* 返回插件目录清单（供渲染进程启动时加载） */
vaultHandle('plugins:list', async () => {
  const plugins = await scanPlugins();
  return { plugins: plugins, dir: pluginsRoot() };
});

/* 在系统文件管理器中打开插件目录（供用户查看/放置插件） */
vaultHandle('plugins:reveal', async () => {
  const root = pluginsRoot();
  await fs.promises.mkdir(root, { recursive: true });
  await shell.openPath(root);
  return true;
});

/* ============================================
 * Git 同步：子命令白名单 IPC（Git Sync 插件消费）
 * 说明：
 *   - Git Sync 插件在渲染进程运行，无 Node 权限，git 操作经此桥接在主进程执行。
 *   - 「不管理分支」：只开放提交/历史/还原/远程同步等子命令，不开放 branch/merge 等分支管理。
 *   - 以 execFile 直接调用 git 可执行文件 + 参数数组，不经 shell，参数不参与命令拼接，天然规避注入；
 *     仍按子命令白名单收口，防止渲染进程请求任意命令。
 *   - cwd 收口为发起窗口当前知识库根（含默认库），插件只能操作自己所在的知识库。
 * 作者: 火 冰
 * ============================================ */

/* Git 允许执行的子命令白名单（缺失在前置位，args[0] 必须命中） */
const GIT_ALLOWED_SUBCMDS = new Set([
  'init', 'status', 'add', 'commit', 'log', 'show', 'diff',
  'remote', 'push', 'pull', 'rev-parse', 'ls-files', 'ls-remote', 'config', 'checkout', 'clean', 'reset',
]);

/* 每个知识库根的 git 执行串行队列（value=前序 promise）：保证同一仓库的 git 命令
 * 排队串行执行，避免实时提交/手动提交等并发触发「cannot lock ref」锁冲突。作者: 火 冰 */
const GIT_QUEUES = new Map();
/* 判断 git stderr 是否为「锁文件已存在」类冲突（残留 .lock 或并发占锁） */
function gitLockConflict(stderr) {
  return /\.lock'?]\s*File exists|cannot lock ref|Unable to create .*\.lock/i.test(String(stderr || ''));
}
/* 清理某仓库 .git 目录下残留的锁文件（refs/HEAD/index 等 .lock），
 * 仅当判定为锁冲突且无并发写入时才调用（配合串行队列），杜绝手动删除导致损坏。
 * 作者: 火 冰 */
function removeStaleGitLocks(cwd) {
  const gitDir = path.join(cwd, '.git');
  if (!fs.existsSync(gitDir)) return;
  const walk = function (dir) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return []; }
    entries.forEach(function (ent) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.lock$/.test(ent.name)) {
        try { fs.unlinkSync(p); } catch (e) { /* 忽略删除失败 */ }
      }
    });
  };
  walk(gitDir);
}
/* 按 cwd 串行化一块 git 任务（task 为 async 函数），返回该任务结果 */
function gitEnqueue(cwd, task) {
  const prev = GIT_QUEUES.get(cwd) || Promise.resolve();
  const run = prev.then(function () { return task(); }, function () { return task(); });
  GIT_QUEUES.set(cwd, run.catch(function () { /* 队列链不因单次失败中断 */ }));
  return run;
}
/* 实际执行一次 git 命令（含锁冲突清理并重试一次、失败的日志记录开关）
 * @param {string} cwd 工作目录
 * @param {string[]} args git 参数
 * @param {boolean} logFailure 非零退出是否记录错误日志（探测类 false 噪音小）
 * @author 火 冰 */
async function gitExecOnce(cwd, args, logFailure) {
  const out = await new Promise(function (resolve) {
    execFile('git', args, { cwd: cwd, timeout: 120000 }, function (err, stdout, stderr) {
      const code = (err && typeof err.code === 'number') ? err.code : (err ? 1 : 0);
      resolve({ exit: code, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
    });
  });
  // 锁冲突（残留 .lock）：清理后重试一次
  if (out.exit !== 0 && gitLockConflict(out.stderr)) {
    removeStaleGitLocks(cwd);
    const retry = await new Promise(function (resolve) {
      execFile('git', args, { cwd: cwd, timeout: 120000 }, function (err, stdout, stderr) {
        const code = (err && typeof err.code === 'number') ? err.code : (err ? 1 : 0);
        resolve({ exit: code, stdout: String(stdout || ''), stderr: String(stderr || (err && err.message) || '') });
      });
    });
    if (retry.exit === 0) return retry;
    out.exit = retry.exit; out.stdout = retry.stdout; out.stderr = retry.stderr;
  }
  // git 操作失败（非零退出）记录到运行日志，便于排查同步/推送失败
  if (out.exit !== 0 && logFailure) {
    appendLog({ level: 'error', msg: 'git 操作失败: git ' + args.join(' '), detail: 'cwd=' + cwd + (out.stderr ? '\nstderr: ' + out.stderr : '') });
  }
  return out;
}

/* 校验并执行一条 git 命令：req = { cwd, args }。返回 { exit, stdout, stderr }。
 * 任一校验失败返回 { exit: -1, stderr: 描述 }，不抛给渲染进程裸异常。 */
async function gitRun(req) {
  const cwdRaw = req && req.cwd;
  const args = Array.isArray(req && req.args) ? req.args : [];
  if (!cwdRaw || typeof cwdRaw !== 'string') return { exit: -1, stderr: '缺少工作目录' };
  // cwd 收口：只能等于发起窗口知识库根（或默认库根）
  const cwd = path.resolve(cwdRaw);
  const v = vaultRoot() ? path.resolve(vaultRoot()) : '';
  const d = defaultVaultRoot() ? path.resolve(defaultVaultRoot()) : '';
  if (cwd !== v && cwd !== d) return { exit: -1, stderr: '不允许在知识库根之外执行 git 操作' };
  if (!args.length || typeof args[0] !== 'string' || !GIT_ALLOWED_SUBCMDS.has(args[0])) {
    return { exit: -1, stderr: 'git 子命令不在白名单内: ' + (args[0] || '') };
  }
  // 参数做基础净化：杜绝换行/空字节等异常字符
  for (const a of args) {
    if (typeof a !== 'string') return { exit: -1, stderr: 'git 参数非法' };
    if (/[\0\n\r]/.test(a)) return { exit: -1, stderr: 'git 参数含非法字符' };
  }
  // reset 仅允许软/混合回退（不动工作区），禁止 --hard 以免丢失工作区改动
  if (args[0] === 'reset' && args.includes('--hard')) return { exit: -1, stderr: 'git reset 不允许 --hard（拒绝危险回退）' };
  // 校验通过：进入该仓库的串行队列执行；logFailure 默认为 true（探测类命令传 false 避免噪音）
  const logFailure = req.logFailure !== false;
  return await gitEnqueue(cwd, function () { return gitExecOnce(cwd, args, logFailure); });
}

/* Git Sync 插件：执行一条 git 命令（白名单收口 + cwd 锁定到知识库根） */
vaultHandle('git:run', (_e, req) => gitRun(req));

/* 探测 git 环境与知识库状态：{ installed, isRepo, branch, remote } */
vaultHandle('git:check', async (event) => {
  const cwd = vaultRoot();
  // 探测 git 是否安装：git --version
  const ver = await new Promise(function (resolve) {
    execFile('git', ['--version'], { timeout: 10000 }, function (err, stdout) {
      resolve(err ? '' : String(stdout || '').trim());
    });
  });
  if (!ver) return { installed: false, isRepo: false };
  // 非仓库时 status 返回非 0；以 status 结果为准（仓库已有 .git 但首无提交也视为 isRepo）。
  // 探测类命令传 logFailure:false：无远程/无分支等属预期状态，不当作错误记日志。
  const status = await gitRun({ cwd: cwd, args: ['status'], logFailure: false });
  // 非仓库时 status 返回非 0；以 status 结果为准（仓库已有 .git 但首无提交也视为 isRepo）
  const repoOk = status.exit === 0;
  let branch = '', remote = '';
  if (repoOk) {
    const b = await gitRun({ cwd: cwd, args: ['rev-parse', '--abbrev-ref', 'HEAD'], logFailure: false });
    branch = b.exit === 0 ? b.stdout.trim() : '';
    const r = await gitRun({ cwd: cwd, args: ['remote', 'get-url', 'origin'], logFailure: false });
    remote = r.exit === 0 ? r.stdout.trim() : '';
  }
  return { installed: true, isRepo: repoOk, branch: branch, remote: remote };
});

/* 从 Git 仓库打开知识库：渲染侧传 URL，主进程选保存目录 → 克隆为独立知识库 → 注册并新开窗口
 * 返回 { canceled, path, name, error } */
vaultHandle('vault:cloneGit', async (event, url) => {
  if (!url || typeof url !== 'string' || !/^https?:\/\/|^git@|^[^@\s]+@[^:\s]+:/.test(url)) {
    return { canceled: false, error: '仓库地址不合法' };
  }
  const win = winFromEvent(event);
  const picked = await dialog.showOpenDialog(win, {
    title: '选择克隆目标目录（将在其下创建仓库文件夹）',
    buttonLabel: '克隆到此',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const parent = path.resolve(picked.filePaths[0]);
  // 从 URL 推断仓库名（取去 .git 后缀的末段）
  const base = String(url).replace(/\.git\s*$/, '').split('/').pop().split(':').pop();
  const name = base || 'cloned-vault';
  const target = path.join(parent, name);
  const cl = await gitRun({ cwd: parent, args: ['clone', url, target] });
  if (cl.exit !== 0) return { canceled: false, error: '克隆失败：' + cl.stderr.trim() };
  recordHistory(target);
  currentVault = target; // 持久化：下次启动主窗口打开该库
  saveConfig();
  openVaultWindow(target);
  return { canceled: false, path: target, name: name };
});

/* ============================================
 * 「打开项目」工作区（非知识库）：窗口=boot 时经 ?project= 进入项目模式
 * 说明：
 *   - 项目是普通 git 项目目录，作为只读/可编辑工作区打开，**不建笔记索引/向量索引**。
 *   - 文件树列出项目内全部文本文件（非仅 .md）；点击文件→project:read 读内容、编辑→project:save 写回。
 *   - git 状态经 project:gitStatus 拉取（status --porcelain 解析），复用 GIT_ALLOWED_SUBCMDS 白名单。
 * 作者: 火 冰
 * ============================================ */

/* 项目文件树最大递归层数 / 单目录项上限，避免超大项目卡死召回 */
const PROJECT_MAX_DEPTH = 12;
const PROJECT_MAX_ITEMS = 20000;
const PROJECT_READ_MAX_BYTES = 5 * 1024 * 1024; // 单文本文件读取上限 5MB

/* 项目打开历史：userData/recent-projects.json，供库下拉「一般项目」分组与托盘引用 */
function recentProjectsFile() { return path.join(app.getPath('userData'), 'recent-projects.json'); }
function loadRecentProjects() {
  try {
    const j = JSON.parse(fs.readFileSync(recentProjectsFile(), 'utf8'));
    if (Array.isArray(j)) return j.filter(function (x) { return x && typeof x.path === 'string' && fs.existsSync(x.path); });
  } catch (_) { /* 文件缺失/损坏返回空 */ }
  return [];
}
let recentProjects = loadRecentProjects();
function persistRecentProjects() {
  try { fs.writeFileSync(recentProjectsFile(), JSON.stringify(recentProjects, null, 2), 'utf8'); } catch (_) { /* 忽略写失败 */ }
}
/* 登记一个项目到「最近打开」（去重置顶，保留无上限；供库下拉列出全部已打开项目） */
function recordRecentProject(p) {
  recentProjects = recentProjects.filter(function (x) { return x.path !== p; });
  recentProjects.unshift({ path: p, name: path.basename(p) || p });
  persistRecentProjects();
}

/* 递归收集项目目录文件树（跳过 .git 与常见元数据目录、二进制文件标 isBinary）
 * @returns {Array<{rel,name,folder,size,mtime,isBinary}>} */
async function walkProject(root) {
  const out = [];
  const seen = new Set();
  async function walk(dir, rel, depth) {
    if (depth > PROJECT_MAX_DEPTH || out.length >= PROJECT_MAX_ITEMS) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    entries.sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); });
    for (const it of entries) {
      if (out.length >= PROJECT_MAX_ITEMS) return;
      const name = it.name;
      if (it.isDirectory()) {
        if (name === '.git' || name === '.second-brain' || name === 'node_modules' || name === '.idea' || name === '.vscode') continue;
        const r = rel ? (rel + '/' + name) : name;
        out.push({ rel: r, name: name, folder: true, size: 0, mtime: 0, isBinary: false });
        seen.add(r.toLowerCase());
        await walk(path.join(dir, name), r, depth + 1);
      } else if (it.isFile()) {
        const r = rel ? (rel + '/' + name) : name;
        let stat = null;
        try { stat = await fs.promises.stat(path.join(dir, name)); } catch (_) { /* 忽略 */ }
        out.push({ rel: r, name: name, folder: false, size: stat ? stat.size : 0, mtime: stat ? Math.floor(stat.mtimeMs) : 0, isBinary: false });
      }
    }
  }
  await walk(root, '', 0);
  // 标记二进制（只探测文本文件，遇 null 字节视为二进制）
  for (const f of out) {
    if (f.folder) continue;
    try {
      const fd = await fs.promises.open(path.join(root, ...f.rel.split('/')), 'r');
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fd.read(buf, 0, 4096, 0);
      await fd.close();
      if (bytesRead > 0 && buf.slice(0, bytesRead).includes(0)) f.isBinary = true;
    } catch (_) { f.isBinary = true; }
  }
  return out;
}

/* 校验项目相对路径在项目根内，防止 ../ 越权 */
function resolveProjectRel(projectRoot, rel) {
  const base = path.resolve(projectRoot);
  const target = path.resolve(base, ...String(rel || '').split('/'));
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

/* 选择项目目录并作为项目工作区打开（返回 { canceled, path, name }） */
vaultHandle('project:open', async (event) => {
  const win = winFromEvent(event);
  const picked = await dialog.showOpenDialog(win, {
    title: '选择要打开的项目目录（git 项目工作区，非知识库）',
    buttonLabel: '打开项目',
    properties: ['openDirectory'],
  });
  if (picked.canceled || !picked.filePaths[0]) return { canceled: true };
  const p = path.resolve(picked.filePaths[0]);
  recordRecentProject(p);
  refreshTrayMenu(); // 项目登记后刷新托盘「一般项目」列表
  const w = createWindow(null, { project: p });
  return { canceled: false, path: p, name: path.basename(p) || p, windowOpened: !!w };
});

/* 返回最近打开的项目列表（库下拉「一般项目」分组 + 托盘引用） */
vaultHandle('project:listRecent', async () => recentProjects);

/* 按绝对路径打开（或聚焦）一个项目窗口：库下拉「一般项目」历史项点击用。
 * 路径非空则记录并托盘刷新；已在某个项目窗口打开时聚焦之，否则新开窗口。作者: 火 冰 */
vaultHandle('project:openPath', async (event, p) => {
  if (typeof p !== 'string' || !p.trim()) return { ok: false, error: '无效路径' };
  const abs = path.resolve(p.trim());
  recordRecentProject(abs);
  refreshTrayMenu();
  // 已在该项目窗口打开则聚焦，否则新建
  let w = null;
  const all = BrowserWindow.getAllWindows();
  for (const [wid, proot] of winProjects) {
    const bw = all.find(b => b && !b.isDestroyed() && b.webContents && b.webContents.id === wid);
    if (proot === abs && bw) { w = bw; break; }
  }
  if (!w) w = createWindow(null, { project: abs });
  if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.focus(); }
  return { ok: !!w, path: abs, name: path.basename(abs) || abs, windowOpened: !!w };
});

/* 返回当前窗口项目根（渲染端判定项目模式）；非项目窗口返回 null */
vaultHandle('project:current', async (event) => {
  const win = winFromEvent(event);
  return win ? (winProjects.get(win.webContents.id) ?? null) : null;
});

/* 返回项目文件树（相对项目根） */
vaultHandle('project:list', async (event) => {
  const root = winProjects.get(winFromEvent(event)?.webContents?.id) || null;
  if (!root) return [];
  return await walkProject(root);
});

/* 读取项目文本文件内容：{ rel } → { ok, content, binary, name } */
vaultHandle('project:read', async (event, rel) => {
  const root = winProjects.get(winFromEvent(event)?.webContents?.id) || null;
  if (!root) return { ok: false, error: '非项目窗口' };
  const abs = resolveProjectRel(root, rel);
  if (!abs) return { ok: false, error: '非法的项目文件路径' };
  try {
    const st = await fs.promises.stat(abs);
    if (st.isDirectory()) return { ok: false, error: '不能打开目录' };
    if (st.size > PROJECT_READ_MAX_BYTES) return { ok: false, error: '文件超过 ' + Math.round(PROJECT_READ_MAX_BYTES / 1024 / 1024) + 'MB 限制' };
    const buf = await fs.promises.readFile(abs);
    const binary = buf.includes(0);
    return { ok: true, content: binary ? '' : buf.toString('utf8'), binary: binary, name: path.basename(rel) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

/* 保存项目文本文件内容：{ rel, content } → { ok, error }（禁止写二进制/越权路径） */
vaultHandle('project:save', async (event, req) => {
  const root = winProjects.get(winFromEvent(event)?.webContents?.id) || null;
  if (!root) return { ok: false, error: '非项目窗口' };
  const rel = req && req.rel;
  const content = (req && typeof req.content === 'string') ? req.content : null;
  if (!rel || content == null) return { ok: false, error: '参数缺失' };
  const abs = resolveProjectRel(root, rel);
  if (!abs) return { ok: false, error: '非法的项目文件路径' };
  try {
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, content, 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

/* 项目 git 状态：status --porcelain 解析为 文件相对路径 → 状态码（增/改/删/未跟踪）。
 * 复用 GIT_ALLOWED_SUBCMDS 白名单，但 cwd=项目根（不经既有 git:run 的知识库锁）。 */
vaultHandle('project:gitStatus', async (event) => {
  const root = winProjects.get(winFromEvent(event)?.webContents?.id) || null;
  if (!root) return { ok: false, repo: false };
  const r = await gitRun({ cwd: root, args: ['status', '--porcelain'] });
  if (r.exit !== 0) return { ok: true, repo: false, status: {} };
  const map = {};
  const lines = String(r.stdout || '').split('\n');
  for (const ln of lines) {
    if (!ln.trim()) continue;
    const code = ln.slice(0, 2).trim();
    const p = ln.slice(3).replace(/^"|"$/g, '').replace(/^([^ ]+) -> /, '');
    if (p) map[p] = code;
  }
  return { ok: true, repo: true, status: map };
});

/* 在资源管理器显示项目文件 */
vaultHandle('project:reveal', async (event, rel) => {
  const root = winProjects.get(winFromEvent(event)?.webContents?.id) || null;
  if (!root) return false;
  const abs = resolveProjectRel(root, rel);
  if (!abs) return false;
  await shell.openPath(abs);
  return true;
});

/* ============================================
 * MD-03：文件拖拽临时打开（只读桥接）
 * 说明：外部文件拖入窗口→渲染端取绝对路径→本桥接只读文件内容（≤5MB）。
 * 不写盘、不建索引、不纳入知识库。临时文件的全局「最近打开」记录见下方 temp:* 。
 * 作者: 火 冰
 * ============================================ */

/* 读取外部临时文件内容：{ absPath } → { ok, path, name, content, binary, error } */
vaultHandle('notes:readFileExternal', async (_e, req) => {
  const absPath = req && typeof req.absPath === 'string' ? req.absPath : null;
  if (!absPath) return { ok: false, error: '缺少文件路径' };
  try {
    const st = await fs.promises.stat(absPath);
    if (st.isDirectory()) return { ok: false, error: '不能打开目录' };
    if (st.size > PROJECT_READ_MAX_BYTES) return { ok: false, error: '文件超过 5MB 限制' };
    const buf = await fs.promises.readFile(absPath);
    return { ok: true, path: absPath, name: path.basename(absPath), content: buf.toString('utf8'), binary: buf.includes(0) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

/* 在资源管理器显示外部临时文件 */
vaultHandle('notes:revealExternal', async (_e, absPath) => {
  if (!absPath || typeof absPath !== 'string') return false;
  await shell.openPath(absPath);
  return true;
});

/* 写回外部临时文件内容：{ absPath, content } → 直接 UTF-8 写盘（可编辑保存）。
 * 安全边界：仅允许写「最近打开」记录中已登记的临时文件绝对路径（白名单），
 * 阻止渲染端任意路径写盘；返回 { ok, path, error }。作者: 火 冰 */
vaultHandle('notes:writeFileExternal', async (_e, req) => {
  const absPath = req && typeof req.absPath === 'string' ? req.absPath : null;
  const content = req && typeof req.content === 'string' ? req.content : null;
  if (!absPath || content === null) return { ok: false, error: '缺少文件路径或内容' };
  const listed = recentTemp.some(function (x) { return x.path === absPath; });
  if (!listed) return { ok: false, error: '仅支持写回已打开的临时文件' };
  try {
    const st = await fs.promises.stat(absPath);
    if (!st.isFile()) return { ok: false, error: '目标不是文件' };
    // 额外：当前上下文知识库不应被误写，用扩展名与文本内容校验放宽（外部 md/txt 才允许）
    const ext = path.extname(absPath).toLowerCase();
    if (['.md', '.markdown', '.txt'].indexOf(ext) === -1) return { ok: false, error: '仅支持写回 .md/.txt 文件' };
    await fs.promises.writeFile(absPath, content, 'utf8');
    return { ok: true, path: absPath };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});

/* ============================================
 * 最近打开的临时文件（全局、跨知识库，最多 10 条）
 * 说明：拖拽临时打开的文件记录在此（userData/recent-temp.json），
 * 库下拉「最近打开」二级菜单展示，任意知识库窗口/项目窗口均可看到与再次打开。
 * 作者: 火 冰
 * ============================================ */
function recentTempFile() { return path.join(app.getPath('userData'), 'recent-temp.json'); }
const TEMP_RECENT_MAX = 10;
function loadRecentTemp() {
  try {
    const j = JSON.parse(fs.readFileSync(recentTempFile(), 'utf8'));
    if (Array.isArray(j)) return j.filter(function (x) { return x && typeof x.path === 'string' && fs.existsSync(x.path); });
  } catch (_) { /* 缺失返回空 */ }
  return [];
}
let recentTemp = loadRecentTemp();
function persistRecentTemp() {
  try { fs.writeFileSync(recentTempFile(), JSON.stringify(recentTemp, null, 2), 'utf8'); } catch (_) { /* 忽略 */ }
}
/* 登记一个临时文件到「最近打开」（去重置顶，超出上限截断） */
function recordRecentTemp(p) {
  recentTemp = recentTemp.filter(function (x) { return x.path !== p; });
  recentTemp.unshift({ path: p, name: path.basename(p) || p });
  if (recentTemp.length > TEMP_RECENT_MAX) recentTemp = recentTemp.slice(0, TEMP_RECENT_MAX);
  persistRecentTemp();
}
vaultHandle('temp:recentLoad', async () => recentTemp);
vaultHandle('temp:recentRecord', async (_e, absPath) => {
  if (absPath && typeof absPath === 'string') recordRecentTemp(absPath);
  return recentTemp.slice(0, TEMP_RECENT_MAX);
});
vaultHandle('temp:recentRemove', async (_e, absPath) => {
  if (absPath && typeof absPath === 'string') recentTemp = recentTemp.filter(function (x) { return x.path !== absPath; });
  persistRecentTemp();
  return recentTemp.slice(0, TEMP_RECENT_MAX);
});
/* 清空「最近打开」临时文件列表 */
vaultHandle('temp:recentClear', async () => {
  recentTemp = [];
  persistRecentTemp();
  return recentTemp;
});

/* 把默认知识库内容迁移到新目录（移动语义：复制成功后清空原默认库）。
 * 迁移成功后 defaultVaultPath 指向新目录，即新默认库；从历史中移除已失效的旧默认库路径。
 * 纯文件逻辑，独立成函数便于单测；返回 { ok, error } 或抛错。 */
async function migrateDefaultVault(src, target) {
  const srcRes = path.resolve(src);
  const dstRes = path.resolve(target);
  const srcKey = srcRes.toLowerCase();
  const dstKey = dstRes.toLowerCase();
  // 目标不能与源相同，也不能位于源内部（避免把库复制到自己里面）
  if (dstKey === srcKey) return { ok: false, error: '目标目录不能与默认知识库相同' };
  if (dstKey.startsWith(srcKey + path.sep)) return { ok: false, error: '目标目录不能位于默认知识库内部' };
  // 目标必须是空目录或不存在（避免覆盖用户已有文件）
  let existing = [];
  try { existing = await fs.promises.readdir(dstRes); } catch (e) { /* 目录不存在视为空 */ }
  if (existing.length > 0) return { ok: false, error: '目标目录非空，请选择空目录或新建目录' };

  // 保证源默认库存在且已初始化（当前库可能不是默认库，须针对源初始化，不能用基于 vaultRoot 的 ensureVault）
  await fs.promises.mkdir(srcRes, { recursive: true });
  let srcItems = [];
  try { srcItems = await fs.promises.readdir(srcRes); } catch (e) { /* 忽略 */ }
  if (srcItems.length === 0) {
    // 空默认库：写入 seed，保证迁移后新默认库开箱有数据
    for (const n of SEED_NOTES) {
      const abs = path.join(srcRes, ...n.rel.split('/'));
      await fs.promises.mkdir(path.dirname(abs), { recursive: true });
      await fs.promises.writeFile(abs, n.content, 'utf8');
    }
  }
  // 先复制、后删除源，保证中途失败时原库数据不丢
  await fs.promises.cp(srcRes, dstRes, { recursive: true });
  await fs.promises.rm(srcRes, { recursive: true, force: true });

  // 更新配置：默认库指向新目录；若当前正使用旧默认库则切回（新）默认库
  defaultVaultPath = dstRes;
  if (currentVault && String(currentVault).toLowerCase() === srcKey) currentVault = null;
  // 从历史中移除已迁走的旧默认库路径（避免残留无效切换项）
  vaultHistory = vaultHistory.filter(function (h) { return String(h.path).toLowerCase() !== srcKey; });
  recordHistory(vaultRoot()); // 把新默认库置顶记入最近打开
  saveConfig();
  return { ok: true };
}

/* 迁移默认知识库 IPC：弹目录选择器 → 二次确认 → 执行迁移 → 刷新受影响窗口（发起窗口由渲染端重载提示） */
vaultHandle('vault:migrate', async (event) => {
  const src = defaultVaultRoot();
  const r = await dialog.showOpenDialog(winFromEvent(event), {
    title: '选择迁移目标目录',
    buttonLabel: '迁移到此目录',
    message: '将默认知识库移动到所选目录（原位置内容将被清空）',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const target = path.resolve(r.filePaths[0]);
  const dstKey = target.toLowerCase();
  const srcKey = src.toLowerCase();
  // 先做一次轻量校验，非法目标直接返回（不进二次确认）
  if (dstKey === srcKey || dstKey.startsWith(srcKey + path.sep)) {
    return { canceled: true, error: '目标目录不能与默认知识库相同或位于其内部' };
  }
  // 二次确认：移动语义会清空原默认库，提示用户风险
  const c = await dialog.showMessageBox(winFromEvent(event), {
    type: 'warning',
    title: '迁移默认知识库',
    message: '确定把默认知识库移动到「' + target + '」吗？',
    detail: '迁移后该目录将成为新的默认知识库，原默认库（' + src + '）的内容将被清空。',
    buttons: ['取消', '开始迁移'],
    defaultId: 0,
    cancelId: 0,
  });
  if (c.response !== 1) return { canceled: true };

  try {
    const res = await migrateDefaultVault(src, target);
    if (!res.ok) return { canceled: true, error: res.error };
    aiEngine.activateVault(); // 迁移后重载（新）默认知识库的索引
    // 刷新受影响窗口：跟随默认库（绑定 null）或绑定旧默认路径的窗口 → 改绑定为 null（跟随新默认库）并重载；
    // 发起窗口只更新绑定不重载（由渲染端自行重载并提示迁移成功），避免旧绑定指向已删除的旧默认库目录
    const senderId = event.sender && event.sender.id;
    for (const [winId, vp] of winVaults) {
      const w = BrowserWindow.fromId(winId);
      if (!w || w.isDestroyed()) continue;
      const curKey = vp == null ? null : path.resolve(vp).toLowerCase();
      if (curKey === null || curKey === srcKey) {
        winVaults.set(winId, null); // 跟随新默认库
        if (winId !== senderId) w.webContents.reload();
      }
    }
    syncVaultWinMap();
    refreshTrayMenu(); // 迁移后默认库路径变化，刷新托盘知识库列表
    return { canceled: false, migrated: true };
  } catch (err) {
    return { canceled: true, error: String((err && err.message) || err) };
  }
});

/* 把指定知识库设置为新的默认库（不迁移文件，仅持久化默认库路径指针）。
 * 与「迁移」的区别：迁移是做文件移动并清空旧库；设置默认只是让 defaultVaultRoot() 指向该目录，
 * 现有各窗口绑定不变（仅托盘/后续启动的默认库归口变化）。返回 { canceled, defaultPath, error } */
vaultHandle('vault:setDefault', async (event, dir) => {
  if (!dir || typeof dir !== 'string') return { canceled: true, error: '参数无效' };
  const target = path.resolve(dir);
  try { await fs.promises.access(target); } catch (e) { return { canceled: true, error: '目录不存在' }; }
  // 旧默认库先判重后，再改默认库指针并依次记入历史：记录必须放在 defaultVaultPath 变更之后，
  // 否则旧库仍按「当前默认库」判断记成「我的笔记库」；变更后旧库才会以其真实目录名（basename）退化成普通库
  const oldRoot = defaultVaultRoot();
  const needKeepOld = vaultKey(oldRoot) !== vaultKey(target);
  defaultVaultPath = target; // 默认库根重定向到目标目录
  if (needKeepOld) recordHistory(oldRoot); // 旧默认库 → 记录为普通库名，保留在「其他知识库」列表（可再次打开）
  recordHistory(target);     // 新默认库 → 显示名「我的笔记库」
  saveConfig();
  // 不切换当前窗口：若发起窗口原为「跟随默认库」（绑定 null），现在默认库已换，需把其绑定
  // 固化为它真实显示的旧默认库，避免悬浮菜单把新默认库名顶到「当前知识库」头部与实际内容不符
  const win = winFromEvent(event);
  if (win && needKeepOld && (winVaults.get(win.webContents.id) ?? null) == null) {
    winVaults.set(win.webContents.id, oldRoot);
    try { win.setTitle('第二脑 · ' + path.basename(oldRoot)); } catch (_) { /* 标题更新失败不阻塞 */ }
  }
  aiEngine.activateVault();  // 重载（新）默认库索引
  syncVaultWinMap();
  refreshTrayMenu();         // 默认库归口变化后刷新托盘知识库列表
  return { canceled: false, defaultPath: defaultVaultRoot() };
});

/* ============================================
 * AI 问答 IPC（主进程 AI 引擎桥接）
 * 引擎负责本地嵌入/重排序与远程/本地大模型流式生成，
 * 渲染进程通过 preload 暴露的 noteDesktop.ai 调用。
 * ============================================ */
const aiEngine = new AiEngine();

// 退出时停止可用模型后台轮询（防残留定时器）
app.on('will-quit', () => aiEngine.stopModelPolling());

/* 初始化 AI 引擎：绑定 vault 根目录与配置/索引持久化路径（索引按知识库分文件存于 ai-index/） */
function initAiEngine() {
  aiEngine.init({
    getVaultRoot: vaultRoot,
    configFile: path.join(app.getPath('userData'), 'ai-config.json'),
    indexDir: path.join(app.getPath('userData'), 'ai-index'),
    modelDir: path.join(app.getPath('userData'), 'models'),
  });
  // 配置加载完成后启动可用模型后台轮询：立即查询一次 + 每 5 秒同步（设置-AI 与 AI 问答共用全局数据）
  aiEngine.startModelPolling(5000);
  // 注册模型数据更新钩子：每次轮询/手动刷新完成后向所有窗口推送事件，页面监听后实时刷新（类似 Vue 响应式）
  aiEngine.onModelsUpdated(function () {
    const avail = aiEngine.getAvailableModels();
    BrowserWindow.getAllWindows().forEach(function (win) {
      if (!win.isDestroyed()) win.webContents.send('ai:models-updated', avail);
    });
  });
}

/* 读取 AI 配置 */
vaultHandle('ai:getConfig', () => aiEngine.getConfig());

/* 保存 AI 配置（本地模型路径 + 远程大模型参数） */
vaultHandle('ai:saveConfig', (_e, cfg) => aiEngine.saveConfig(cfg || {}));

/* 获取模型库状态（下载目录 + 各嵌入模型是否已下载） */
vaultHandle('ai:getModelLib', () => aiEngine.getModelLib());

/* 设置模型下载目录 */
vaultHandle('ai:setModelDir', (_e, dir) => aiEngine.setModelDir(dir));

/* 下载嵌入模型（进度经 ai:modelProgress 推送） */
vaultHandle('ai:downloadModel', async (e, repo, source) => {
  return await aiEngine.downloadModel(repo, source, function (p) {
    if (!e.sender.isDestroyed()) e.sender.send('ai:modelProgress', p);
  });
});

/* 打开模型下载目录 */
vaultHandle('ai:revealModelDir', () => aiEngine.revealModelDir());

/* 弹出目录选择框，返回所选模型下载目录（取消返回 null） */
vaultHandle('ai:pickModelDir', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择模型下载目录',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: (aiEngine.getConfig() && aiEngine.getConfig().modelDir) || undefined,
  });
  return r.canceled ? null : r.filePaths[0];
});

/* 获取 AI 引擎状态（模型加载/当前库索引片段数） */
vaultHandle('ai:getStatus', () => aiEngine.getStatus());

/* 获取当前知识库索引统计与明细（供编辑区「查看索引」面板） */
vaultHandle('ai:listIndex', async () => await aiEngine.listIndex());

/* 获取当前提供方可用的生成模型列表 */
vaultHandle('ai:listModels', () => aiEngine.listModels());

/* 从 Ollama 服务拉取已安装模型列表（添加/编辑生成模型时选择用） */
vaultHandle('ai:listOllamaModels', (_e, baseUrl) => aiEngine.listOllamaModels(baseUrl));

/* 管理 Ollama 模型：加载/卸载/上下文长度（keep_alive + num_ctx） */
vaultHandle('ai:manageOllamaModel', (_e, p) => aiEngine.manageOllamaModel(p || {}));

/* 获取 Ollama 正在运行的模型列表（生成模型按运行状态显示 加载/卸载 按钮） */
vaultHandle('ai:listRunningModels', (_e, baseUrl) => aiEngine.listRunningModels(baseUrl));
vaultHandle('ai:runningMap', () => aiEngine.getRunningMap());
vaultHandle('ai:availableModels', () => aiEngine.getAvailableModels());

/* 加载本地嵌入模型（返回最新状态） */
vaultHandle('ai:loadEmbedding', async () => {
  await aiEngine.loadEmbedding();
  return aiEngine.getStatus();
});

/* 重建知识库索引（进度通过 ai:progress 事件推送） */
vaultHandle('ai:rebuildIndex', async (e) => {
  const result = await aiEngine.rebuildIndex(function (p) {
    if (!e.sender.isDestroyed()) e.sender.send('ai:progress', p);
  });
  return Object.assign({}, result, aiEngine.getStatus());
});

/* 手动重建指定单篇笔记的索引（「索引过期」补救）；只重算该文件块，不影响库内其他笔记 */
vaultHandle('ai:rebuildNoteIndex', async function (e, rel) {
  if (!rel) return { ok: false };
  await aiEngine.rebuildNoteIndex(String(rel));
  return { ok: true };
});

/* 列出索引库中所有知识库的索引概要；
 * knownRoots = 应用当前认可的知识库路径（当前库/默认库/历史库），供引擎判定「知识库是否存在」：
 * 目录已不存在 或 已从应用知识库列表移除（即使磁盘目录还在）→ 视为残留，可删除 */
vaultHandle('ai:listIndexes', async () => {
  const known = [vaultRoot(), defaultVaultRoot()].concat((vaultHistory || []).map(function (h) { return h && h.path; }));
  return aiEngine.listIndexes(known);
});

/* 重建指定知识库索引（进度通过 ai:progress 事件推送） */
vaultHandle('ai:rebuildIndexFor', async (e, vaultPath) => {
  const result = await aiEngine.rebuildIndexFor(vaultPath, function (p) {
    if (!e.sender.isDestroyed()) e.sender.send('ai:progress', p);
  });
  return Object.assign({}, result, aiEngine.getStatus());
});

/* 删除指定知识库索引文件 */
vaultHandle('ai:deleteIndex', async (_e, vaultPath) => {
  return aiEngine.deleteIndex(vaultPath);
});

/* 发起 AI 问答：检索上下文 → 流式生成，token 经 ai:token 推送；agentId 为当前选中的自定义 Agent（可空），
 * modelId 为下拉选中的模型（可为 avail: 临时 id，未传用 currentModel）；devMode 为「开发者模式」开关（可空） */
vaultHandle('ai:ask', async (e, question, history, agentId, modelId, devMode) => {
  const sender = e.sender;
  try {
    // 按 agentId 解析当前 Agent（自定义角色），未命中/未配置时为 null（走默认助手）
    const agents = aiEngine.getConfig().agents || [];
    const agent = agents.find(function (a) { return a.id === String(agentId || ''); }) || null;
    const result = await aiEngine.ask({
      question: String(question || ''),
      history: Array.isArray(history) ? history : [],
      agent: agent,
      modelId: String(modelId || ''),
      devMode: !!devMode,
      onToken: function (t) { if (!sender.isDestroyed()) sender.send('ai:token', t); },
    });
    if (!sender.isDestroyed()) sender.send('ai:ask-done', { sources: result.sources, retrieveMs: result.retrieveMs || 0 });
    return { ok: true };
  } catch (err) {
    const msg = String((err && err.message) || err);
    // 问答失败落盘（userData/logs/app.log），便于定位连续失败原因
    appendLog({ level: 'error', msg: 'AI 问答失败: ' + msg, detail: (err && err.stack) || '' });
    if (!sender.isDestroyed()) sender.send('ai:ask-error', { message: msg });
    return { ok: false, message: msg };
  }
});

/* 停止当前流式生成 */
ipcMain.on('ai:stop', () => aiEngine.stop());

/* ---------- AI 会话持久化（知识库根 .session 目录） ---------- */
/* AI 会话统一隐藏目录（位于各知识库根；每会话一个 <id>.json，另存 active.json 记录最近活动会话） */
const SESSION_DIR = '.session';

/** 当前知识库的 .session 目录绝对路径。
 * @returns {string} <vaultRoot>/.session
 * @author 火 冰 */
function sessionDir() {
  return path.join(vaultRoot(), SESSION_DIR);
}

/** 校验会话文件 id，仅允许纯字母数字（文件名前缀，防路径穿越）。
 * @param {unknown} id 会话 id
 * @returns {string} 清洗后的安全 id；非法返回空串
 * @author 火 冰 */
function safeSessionId(id) {
  const s = String(id == null ? '' : id);
  return /^[A-Za-z0-9]+$/.test(s) ? s : '';
}

/* 列出知识库内全部 AI 会话（轻量元信息，不整读消息正文），按最近更新倒序 */
vaultHandle('ai:listSessions', async () => {
  let names = [];
  try { names = await fs.promises.readdir(sessionDir()); } catch (e) { return []; }
  const items = [];
  for (const name of names) {
    if (!/^[A-Za-z0-9]+\.json$/.test(name) || name === 'active.json') continue;
    const abs = path.join(sessionDir(), name);
    try {
      const j = JSON.parse(await fs.promises.readFile(abs, 'utf8'));
      const st = await fs.promises.stat(abs);
      items.push({
        id: String(j.id == null ? '' : j.id),
        title: String(j.title == null ? '' : j.title),
        mtime: st.mtimeMs,
        msgCount: Array.isArray(j.history) && j.history.length ? j.history.length : 0,
      });
    } catch (e) { /* 单份文件损坏则跳过，不影响其余 */ }
  }
  items.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
  return items;
});

/* 读取单个 AI 会话完整内容；不存在或 id 非法返回 null */
vaultHandle('ai:readSession', async (_e, id) => {
  const safe = safeSessionId(id);
  if (!safe) return null;
  try { return JSON.parse(await fs.promises.readFile(path.join(sessionDir(), safe + '.json'), 'utf8')); }
  catch (e) { return null; }
});

/* 保存 AI 会话：data={id,title,history} 写 <id>.json；data={id,active:true} 写 active.json（幂等建目录） */
vaultHandle('ai:saveSession', async (_e, data) => {
  const isActive = !!(data && data.active);
  const safe = isActive ? 'active' : safeSessionId(data && data.id);
  if (!safe) return { ok: false };
  try {
    await fs.promises.mkdir(sessionDir(), { recursive: true });
    const payload = isActive
      ? { activeId: String((data && data.id) || '') }
      : { id: data.id, title: (data && data.title) || '', history: Array.isArray(data && data.history) ? data.history : [] };
    await fs.promises.writeFile(path.join(sessionDir(), safe + '.json'), JSON.stringify(payload), 'utf8');
    return { ok: true };
  } catch (e) { return { ok: false }; }
});

/* 删除指定 AI 会话文件（不存在静默忽略） */
vaultHandle('ai:deleteSession', async (_e, id) => {
  const safe = safeSessionId(id);
  if (!safe) return { ok: false };
  try { await fs.promises.unlink(path.join(sessionDir(), safe + '.json')); } catch (e) { /* 忽略 */ }
  return { ok: true };
});

/* 读取最近活动会话 id（active.json 中的 activeId） */
vaultHandle('ai:getActiveSession', async () => {
  try {
    const j = JSON.parse(await fs.promises.readFile(path.join(sessionDir(), 'active.json'), 'utf8'));
    return String(j && j.activeId || '');
  } catch (e) { return ''; }
});

/* ============================================
 * 应用安全（SEC-01 启动密码 / SEC-02 超时锁定）
 * 密码以 scrypt 哈希（salt+hash）存 security.json（与 settings.json 分离），
 * 校验用 timingSafeEqual 防时序侧信道。超时锁定优先走 powerMonitor 系统空闲检测。
 * 作者: 火 冰
 * ============================================ */
function securityFile() { return path.join(app.getPath('userData'), 'security.json'); }
let secPwdHash = null;    // scrypt 派生的密码哈希（hex）
let secSalt = null;       // 随机盐（hex）
let secLockEnabled = false; // 超时自动锁定开关
let secLockMinutes = 10;    // 空闲锁定阈值（分钟）
let appUnlocked = true;     // 应用整体解锁标记（未设密码时恒为 true，超时锁定用）。窗口级解锁见 secWinUnlocked
/* 按窗口记录的解锁状态（winId -> boolean）：保证从托盘新建的窗口也需各自通过启动密码后才可见 */
let secWinUnlocked = new Map();
/* 判断某窗口是否已解锁：未设密码总为 true；设了密码仅当该窗口显式解锁过才为 true。
 * @param {number|undefined} winId webContents id（undefined 视为未解锁）
 * @returns {boolean}
 * @author 火 冰 */
function secWinIsUnlocked(winId) {
  if (!secPwdHash) return true;
  return winId != null && secWinUnlocked.get(winId) === true;
}
/* 窗口重新显示（托盘召回最小化/隐藏、restore）时强制要求重新输入密码：
 * 重置该窗口解锁记录并推送锁定事件，配合渲染端弹遮罩隐藏内容。全程保持显示的窗口不触发。
 * @param {BrowserWindow} win 目标窗口
 * @author 火 冰 */
function secRequireLock(win) {
  if (!secPwdHash || !win || win.isDestroyed()) return;
  secWinUnlocked.delete(win.id);
  try { win.webContents.send('app:locked'); } catch (e) { /* 忽略 */ }
}

/* 读取 security.json 恢复安全状态；无文件（未设过密码）时保持全默认。
 * @author 火 冰 */
function loadSecurity() {
  try {
    const j = JSON.parse(fs.readFileSync(securityFile(), 'utf8'));
    secPwdHash = (j && typeof j.hash === 'string' && j.hash) ? j.hash : null;
    secSalt = (j && typeof j.salt === 'string' && j.salt) ? j.salt : null;
    secLockEnabled = !!(j && j.lockEnabled);
    secLockMinutes = (j && typeof j.lockMinutes === 'number' && j.lockMinutes >= 1 && j.lockMinutes <= 120) ? Math.round(j.lockMinutes) : 10;
  } catch (e) { /* 无文件/损坏：全默认 */ }
  appUnlocked = !secPwdHash; // 未设密码视为已解锁
}

/* 持久化安全状态到 security.json（写失败静默，不影响主流程）。
 * @author 火 冰 */
function saveSecurity() {
  try {
    fs.writeFileSync(securityFile(), JSON.stringify({ hash: secPwdHash, salt: secSalt, lockEnabled: secLockEnabled, lockMinutes: secLockMinutes }, null, 2));
  } catch (e) { /* 忽略 */ }
}

/* 用 scrypt 派生密码摘要（64 字节）。返回 Promise<Buffer>。
 * @param {string} password 明文密码
 * @param {string} saltHex  十六进制盐
 * @author 火 冰 */
function secDerive(password, saltHex) {
  return new Promise(function (resolve, reject) {
    scrypt(String(password || ''), saltHex, 64, function (err, key) {
      if (err) reject(err); else resolve(key);
    });
  });
}

/* 校验密码是否与已存哈希匹配（timingSafeEqual）。返回 Promise<boolean>。
 * @param {string} password 待校验明文
 * @author 火 冰 */
async function secVerify(password) {
  if (!secPwdHash || !secSalt) return false;
  try {
    const h = await secDerive(password, secSalt);
    const a = Buffer.from(secPwdHash, 'hex');
    const b = Buffer.from(h);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch (e) { return false; }
}

/* 向所有窗口推送锁定事件（渲染端据此弹全屏遮罩）。
 * @author 火 冰 */
function secBroadcastLocked() {
  secWinUnlocked.clear(); // 锁定后所有窗口一律需要重新验证
  BrowserWindow.getAllWindows().forEach(function (w) {
    try { if (!w.isDestroyed()) w.webContents.send('app:locked'); } catch (e) { /* 忽略 */ }
  });
}

/* 系统空闲定时器句柄 */
let secIdleTimer = null;
const SEC_POLL_MS = 15000; // 空闲检测轮询间隔 15s

/* 启动空闲锁定轮询（桌面端）：到达锁定阈值时置未解锁并向窗口推送锁定事件。
 * @author 火 冰 */
function startSecIdleMonitor() {
  if (secIdleTimer) return;
  secIdleTimer = setInterval(function () {
    if (!secLockEnabled || !secPwdHash || !appUnlocked) return; // 未开/未设密码/已锁定则跳过
    let idleS = -1;
    try { idleS = powerMonitor.getSystemIdleTime(); } catch (e) { return; }
    if (idleS >= secLockMinutes * 60) {
      appUnlocked = false;
      secBroadcastLocked();
    }
  }, SEC_POLL_MS);
}

/* 设置/修改/移除密码。data={old?, next?}：
 * next 非空 → 设置或修改（已有密码时须先通过 old 校验）；next 空 → 移除密码（须提供 old）。
 * 返回 { ok, reason? }。
 * @author 火 冰 */
ipcMain.handle('app:setPassword', async (_e, data) => {
  const d = (data && typeof data === 'object') ? data : {};
  const hasPwd = !!secPwdHash;
  const next = String(d.next || '');
  try {
    if (!next) {
      // 移除密码：未设过则直接成功；已设则须先校验旧密码
      if (hasPwd && !(await secVerify(d.old))) return { ok: false, reason: 'wrong_old' };
      secPwdHash = null; secSalt = null;
      secWinUnlocked.clear(); // 无密码后所有窗口不再锁定
      saveSecurity(); appUnlocked = true;
      return { ok: true };
    }
    // 设置/修改：已有密码须先校验旧密码
    if (hasPwd && !(await secVerify(d.old))) return { ok: false, reason: 'wrong_old' };
    if (next.length < 4) return { ok: false, reason: 'too_short' };
    secSalt = randomBytes(16).toString('hex');
    secPwdHash = (await secDerive(next, secSalt)).toString('hex');
    if (_e && _e.sender) secWinUnlocked.set(_e.sender.id, true); // 当前窗口已通过密码，标记解锁
    saveSecurity(); appUnlocked = true;
    return { ok: true };
  } catch (e) { return { ok: false, reason: 'error' }; }
});

/* 解锁校验：密码正确（或未设密码）则置已解锁并返回 true。
 * @author 火 冰 */
ipcMain.handle('app:unlock', async (event, pwd) => {
  if (!secPwdHash) { appUnlocked = true; return true; }
  const ok = await secVerify(pwd);
  if (ok) {
    appUnlocked = true;
    if (event && event.sender) secWinUnlocked.set(event.sender.id, true); // 窗口级解锁
  }
  return ok;
});

/* 读取安全状态（供设置页/遮罩层回填；绝不下发任何密码哈希或盐）。
 * unlocked 按发起窗口返回：该窗口未解锁则返回 false，供渲染端弹遮罩（覆盖托盘新开窗口）。
 * @author 火 冰 */
ipcMain.handle('app:getSecurity', (event) => ({
  hasPwd: !!secPwdHash,
  lockEnabled: secLockEnabled,
  lockMinutes: secLockMinutes,
  unlocked: secWinIsUnlocked(event && event.sender ? event.sender.id : undefined),
}));
/* 同步读取安全状态（sendSync，仅渲染端启动时用，只读不经计算）。
 * 在窗口首帧 paint 前拿到「需锁定」，渲染端立即隐藏主视图，规避启动时先闪内容再弹密码框（SEC-01）。 */
ipcMain.on('app:getSecuritySync', function (event) {
  event.returnValue = {
    hasPwd: !!secPwdHash,
    unlocked: secWinIsUnlocked(event && event.sender ? event.sender.id : undefined),
  };
});

/* 超时锁定配置：data={enabled?, minutes?}；持久化并返回最新状态。
 * @author 火 冰 */
ipcMain.handle('app:setLockConfig', (_e, data) => {
  const d = (data && typeof data === 'object') ? data : {};
  if (typeof d.enabled === 'boolean') secLockEnabled = d.enabled;
  if (typeof d.minutes === 'number' && d.minutes >= 1 && d.minutes <= 120) secLockMinutes = Math.round(d.minutes);
  saveSecurity();
  return { ok: true, lockEnabled: secLockEnabled, lockMinutes: secLockMinutes };
});

/* ---------- 应用生命周期 ---------- */
/* 启动耗时打点：记录 whenReady 各阶段与窗口加载完成耗时，便于排查「启动慢/界面空白」类问题。
 * 作者: 火 冰 */
const _t0 = Date.now();
function _slog(tag) {
  appendLog({ level: 'info', msg: `[startup] ${tag} +${Date.now() - _t0}ms` });
}
_slog('main_module_loaded');
app.whenReady().then(async () => {
  // 单实例守卫：未获得单实例锁的进程已在顶部 app.quit()，此处不再创建窗口
  if (!gotTheLock) return;
  _slog('whenReady_begin');
  // 移除默认应用菜单：frame:false 自绘标题栏本无菜单栏，且默认菜单的
  // Ctrl+R（Reload）会与编辑器的「替换」快捷键冲突，需禁用默认加速器
  Menu.setApplicationMenu(null);
  loadConfig(); // 恢复上次选择的笔记库目录
  loadSecurity(); // 恢复应用安全状态（启动密码/超时锁定，SEC-01/02）
  startSecIdleMonitor(); // 启动系统空闲锁定轮询（桌面端 powerMonitor）
  initAiEngine(); // 初始化 AI 引擎（配置/索引持久化路径）
  registerNoteProtocol();
  _slog('before_clearCache');
  // 清除历史磁盘缓存，防止拆分/升级后残留旧 HTML/JS 脚本导致界面空白
  await session.defaultSession.clearCache();
  _slog('after_clearCache');
  createWindow();
  // Windows 首次「打开方式」启动：process.argv 在 exe 后可能带外部文件路径 → 按临时文件打开（渲染端 sbTempFiles.openTemp）
  const startFile = pickOpenWithArg(process.argv);
  if (startFile) openWithFile(startFile);
  createTray(); // 创建系统托盘图标与菜单（G-12）

  // macOS：点击 Dock 图标时若无窗口则重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 除 macOS 外，所有窗口关闭即退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前销毁托盘图标，避免系统栏残留无用图标
app.on('before-quit', () => {
  if (tray) { tray.destroy(); tray = null; }
});

/* 导出内部逻辑供单测（Electron 作为主入口加载时无副作用，不影响正常启动） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { defaultVaultRoot, vaultRoot, loadConfig, saveConfig, recordHistory, migrateDefaultVault, pluginsRoot, scanPlugins };
}

