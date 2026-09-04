/* ============================================
 * 第二脑 桌面版 — Electron 主进程
 * 作者: 火 冰
 * 功能: 创建主窗口、注册自定义协议 note:// 以支持
 *       在 file 环境通过 fetch 加载本地视图文件
 * ============================================ */
const { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { AiEngine } = require('./ai-engine');

/* 项目根目录（即本文件所在目录） */
const ROOT = __dirname;

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
};

/* ---------- 自定义协议：note:// ---------- */

/**
 * 将 note:// 协议请求映射为磁盘上的本地文件并返回内容。
 * 这样页面中的 fetch('views/editor.html') 在桌面环境下也能正常工作，
 * 无需改动前端路由逻辑。
 */
function registerNoteProtocol() {
  protocol.handle('note', async (request) => {
    const url = new URL(request.url);
    // 解码并规范化路径片段，防御路径穿越
    const pathname = decodeURIComponent(url.pathname);
    const segments = pathname.split('/').filter(Boolean);
    if (segments.includes('..')) return new Response('Forbidden', { status: 403 });

    const filePath = path.join(ROOT, ...segments);
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
let mainWin = null;

function createWindow() {
  mainWin = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: '第二脑',
    backgroundColor: '#1E1E2E',
    frame: false,            // 移除系统标题栏，由前端自绘 Windows 风格标题栏
    titleBarStyle: 'hidden',
    webPreferences: {
      // 安全默认：隔离上下文、禁用 Node 集成，仅通过 preload 暴露窗口控制
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 通过自定义协议加载首页，相对 fetch 自动沿用 note:// 协议
  mainWin.loadURL('note://local/index.html');

  mainWin.on('closed', () => { mainWin = null; });
  return mainWin;
}

/* ---------- 窗口控制 IPC（供前端标题栏按钮调用） ---------- */
ipcMain.on('win:minimize', () => { if (mainWin) mainWin.minimize(); });
ipcMain.on('win:maximize', () => {
  if (!mainWin) return;
  if (mainWin.isMaximized()) mainWin.unmaximize(); else mainWin.maximize();
});
ipcMain.on('win:close', () => { if (mainWin) mainWin.close(); });

/* ============================================
 * 笔记库（真实文件系统）IPC
 * 笔记存放于 userData/vault，首次启动用 seed 初始化。
 * 所有接口以「相对路径」作为 key，拼接进 vault 后做前缀校验，防路径穿越。
 * ============================================ */

/* 数据目录下的默认笔记库根路径：默认 userData/vault；
 * 用户可通过「迁移默认知识库」把默认库迁到自定义目录，迁后该目录即新的默认库（defaultVaultPath 持久化） */
let defaultVaultPath = null;
function defaultVaultRoot() { return defaultVaultPath || path.join(app.getPath('userData'), 'vault'); }

/* 当前笔记库根路径：默认 userData/vault，用户可通过「库选择器」切换到任意目录 */
function vaultRoot() { return currentVault || defaultVaultRoot(); }
let currentVault = null;
/* 打开过的笔记库历史（最近在前），用于下拉列表展示与快速切换 */
let vaultHistory = [];

/* 用户配置文件：持久化当前笔记库 + 默认库路径 + 历史库列表，重启后保持 */
function configFile() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (j && typeof j.defaultVaultPath === 'string' && j.defaultVaultPath) defaultVaultPath = j.defaultVaultPath;
    if (j && typeof j.vaultPath === 'string' && j.vaultPath) currentVault = j.vaultPath;
    if (Array.isArray(j && j.vaultHistory)) vaultHistory = j.vaultHistory
      .filter(function (h) { return h && typeof h.path === 'string'; })
      .slice(0, 12);
  } catch (e) { /* 配置不存在或损坏时回退默认库 */ }
}
function saveConfig() {
  try {
    fs.writeFileSync(configFile(), JSON.stringify(
      { defaultVaultPath: defaultVaultPath, vaultPath: currentVault || null, vaultHistory: vaultHistory },
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

/* 列出笔记库全部笔记 */
ipcMain.handle('notes:list', async () => {
  await ensureVault();
  const out = [];
  await walkNotes(vaultRoot(), '', out);
  return out;
});

/* 读取单篇笔记原文 */
ipcMain.handle('notes:read', async (_e, rel) => {
  await ensureVault();
  return await fs.promises.readFile(resolveVaultPath(rel), 'utf8');
});

/* 保存单篇笔记（自动建父目录）；保存后增量更新该笔记的索引块 */
ipcMain.handle('notes:save', async (_e, rel, content) => {
  const abs = resolveVaultPath(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  await fs.promises.writeFile(abs, content || '', 'utf8');
  aiEngine.updateNote(rel).catch(function () { /* 单篇增量索引更新失败不阻塞保存 */ });
  return true;
});

/* 新建笔记：dir 为所在目录（相对路径），返回规范化的相对路径 */
ipcMain.handle('notes:create', async (_e, name, dir) => {
  await ensureVault();
  const clean = (name || '').trim();
  if (!clean) throw new Error('笔记名不能为空');
  const fileName = clean.toLowerCase().endsWith('.md') ? clean : clean + '.md';
  const rel = (dir && dir.trim()) ? dir.replace(/[\\/]+$/, '') + '/' + fileName : fileName;
  const abs = resolveVaultPath(rel);
  await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) await fs.promises.writeFile(abs, '# ' + path.basename(fileName, '.md') + '\n', 'utf8');
  aiEngine.updateNote(rel).catch(function () { /* 新建笔记后续索引更新失败不阻塞 */ });
  return rel;
});

/* 新建目录：dir 为目标目录相对路径（支持多级如 a/b），返回规范化的相对路径 */
ipcMain.handle('notes:createDir', async (_e, dir) => {
  await ensureVault();
  const clean = (dir || '').trim().replace(/^[\\/]+|[\\/]+$/g, '');
  if (!clean) throw new Error('目录名不能为空');
  const rel = clean.replace(/\\/g, '/');
  await fs.promises.mkdir(resolveVaultPath(rel), { recursive: true });
  return rel;
});

/* 删除单篇笔记（移入回收站）；删除后从索引移除该笔记全部块 */
ipcMain.handle('notes:delete', async (_e, rel) => {
  const abs = resolveVaultPath(rel);
  if (fs.existsSync(abs)) { await fs.promises.unlink(abs); }
  aiEngine.removeNote(rel).catch(function () { /* 移除索引失败不阻塞删除 */ });
  return true;
});

/* 在系统文件管理器中显示该笔记（右键菜单） */
ipcMain.handle('notes:reveal', async (_e, rel) => {
  const abs = resolveVaultPath(rel);
  if (!fs.existsSync(abs)) return false;
  shell.showItemInFolder(abs);
  return true;
});

/* ---------- 笔记库选择 IPC（标题栏库选择器） ---------- */

/* 获取当前笔记库信息：绝对路径 + 显示名（默认库显示「我的笔记库」）+ 默认库路径 */
ipcMain.handle('vault:get', async () => {
  const p = vaultRoot();
  return { path: p, name: currentVault ? path.basename(p) : '我的笔记库', defaultPath: defaultVaultRoot(), history: vaultHistory.slice() };
});

/* 打开目录选择器：选中即切换为当前笔记库（createDirectory 允许新建，即「打开新库」），并记入历史 */
ipcMain.handle('vault:choose', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    title: '选择或新建笔记库目录',
    buttonLabel: '打开此目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  recordHistory(vaultRoot()); // 切走前把当前库（含默认「我的笔记库」）记入最近打开
  currentVault = r.filePaths[0];
  recordHistory(currentVault);
  saveConfig();
  aiEngine.activateVault(); // 切换后重载对应知识库的索引
  return { canceled: false, path: currentVault, name: path.basename(currentVault), history: vaultHistory.slice() };
});

/* 切换库：按历史库路径切换（无需弹选择器）。目录不存在或无历史路径时拒绝 */
ipcMain.handle('vault:switch', async (_e, dir) => {
  if (!dir || typeof dir !== 'string') return { canceled: true };
  if (!fs.existsSync(dir)) return { canceled: true };
  recordHistory(vaultRoot()); // 切走前把当前库（含默认「我的笔记库」）记入最近打开
  // 切回默认库路径时按默认库处理（currentVault=null），保证显示名「我的笔记库」
  const isDefault = path.resolve(dir).toLowerCase() === defaultVaultRoot().toLowerCase();
  currentVault = isDefault ? null : dir;
  recordHistory(currentVault);
  saveConfig();
  aiEngine.activateVault(); // 切换后重载对应知识库的索引
  return { canceled: false, path: vaultRoot(), name: currentVault ? path.basename(currentVault) : '我的笔记库', history: vaultHistory.slice() };
});

/* 从历史列表移除某库（仅移出历史，不改当前库） */
ipcMain.handle('vault:remove', async (_e, dir) => {
  vaultHistory = vaultHistory.filter(function (h) { return h.path !== dir; });
  saveConfig();
  return { history: vaultHistory.slice() };
});

/* 恢复默认笔记库（userData/vault 或已迁移后的新默认库） */
ipcMain.handle('vault:reset', async () => {
  recordHistory(vaultRoot()); // 恢复默认前把当前库记入最近打开
  currentVault = null;
  saveConfig();
  aiEngine.activateVault(); // 切换后重载对应知识库的索引
  const p = vaultRoot();
  return { path: p, name: '我的笔记库', history: vaultHistory.slice() };
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

/* 迁移默认知识库 IPC：弹目录选择器 → 二次确认 → 执行迁移 → 返回新库信息 */
ipcMain.handle('vault:migrate', async () => {
  const src = defaultVaultRoot();
  const r = await dialog.showOpenDialog(mainWin, {
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
  const c = await dialog.showMessageBox(mainWin, {
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
    return {
      canceled: false,
      path: vaultRoot(),
      name: currentVault ? path.basename(currentVault) : '我的笔记库',
      history: vaultHistory.slice(),
    };
  } catch (err) {
    return { canceled: true, error: String((err && err.message) || err) };
  }
});

/* ============================================
 * AI 问答 IPC（主进程 AI 引擎桥接）
 * 引擎负责本地嵌入/重排序与远程/本地大模型流式生成，
 * 渲染进程通过 preload 暴露的 noteDesktop.ai 调用。
 * ============================================ */
const aiEngine = new AiEngine();

/* 初始化 AI 引擎：绑定 vault 根目录与配置/索引持久化路径（索引按知识库分文件存于 ai-index/） */
function initAiEngine() {
  aiEngine.init({
    getVaultRoot: vaultRoot,
    configFile: path.join(app.getPath('userData'), 'ai-config.json'),
    indexDir: path.join(app.getPath('userData'), 'ai-index'),
  });
}

/* 读取 AI 配置 */
ipcMain.handle('ai:getConfig', () => aiEngine.getConfig());

/* 保存 AI 配置（本地模型路径 + 远程大模型参数） */
ipcMain.handle('ai:saveConfig', (_e, cfg) => aiEngine.saveConfig(cfg || {}));

/* 获取 AI 引擎状态（模型加载/当前库索引片段数） */
ipcMain.handle('ai:getStatus', () => aiEngine.getStatus());

/* 获取当前知识库索引统计与明细（供编辑区「查看索引」面板） */
ipcMain.handle('ai:listIndex', async () => await aiEngine.listIndex());

/* 获取当前提供方可用的生成模型列表 */
ipcMain.handle('ai:listModels', () => aiEngine.listModels());

/* 加载本地嵌入模型（返回最新状态） */
ipcMain.handle('ai:loadEmbedding', async () => {
  await aiEngine.loadEmbedding();
  return aiEngine.getStatus();
});

/* 重建知识库索引（进度通过 ai:progress 事件推送） */
ipcMain.handle('ai:rebuildIndex', async (e) => {
  const result = await aiEngine.rebuildIndex(function (p) {
    if (!e.sender.isDestroyed()) e.sender.send('ai:progress', p);
  });
  return Object.assign({}, result, aiEngine.getStatus());
});

/* 列出索引库中所有知识库的索引概要 */
ipcMain.handle('ai:listIndexes', async () => {
  return aiEngine.listIndexes();
});

/* 重建指定知识库索引（进度通过 ai:progress 事件推送） */
ipcMain.handle('ai:rebuildIndexFor', async (e, vaultPath) => {
  const result = await aiEngine.rebuildIndexFor(vaultPath, function (p) {
    if (!e.sender.isDestroyed()) e.sender.send('ai:progress', p);
  });
  return Object.assign({}, result, aiEngine.getStatus());
});

/* 删除指定知识库索引文件 */
ipcMain.handle('ai:deleteIndex', async (_e, vaultPath) => {
  return aiEngine.deleteIndex(vaultPath);
});

/* 发起 AI 问答：检索上下文 → 流式生成，token 经 ai:token 推送 */
ipcMain.handle('ai:ask', async (e, question, history) => {
  const sender = e.sender;
  try {
    const { sources } = await aiEngine.ask({
      question: String(question || ''),
      history: Array.isArray(history) ? history : [],
      onToken: function (t) { if (!sender.isDestroyed()) sender.send('ai:token', t); },
    });
    if (!sender.isDestroyed()) sender.send('ai:ask-done', { sources });
    return { ok: true };
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (!sender.isDestroyed()) sender.send('ai:ask-error', { message: msg });
    return { ok: false, message: msg };
  }
});

/* 停止当前流式生成 */
ipcMain.on('ai:stop', () => aiEngine.stop());

/* ---------- 应用生命周期 ---------- */
app.whenReady().then(async () => {
  // 移除默认应用菜单：frame:false 自绘标题栏本无菜单栏，且默认菜单的
  // Ctrl+R（Reload）会与编辑器的「替换」快捷键冲突，需禁用默认加速器
  Menu.setApplicationMenu(null);
  loadConfig(); // 恢复上次选择的笔记库目录
  initAiEngine(); // 初始化 AI 引擎（配置/索引持久化路径）
  registerNoteProtocol();
  // 清除历史磁盘缓存，防止拆分/升级后残留旧 HTML/JS 脚本导致界面空白
  await session.defaultSession.clearCache();
  createWindow();

  // macOS：点击 Dock 图标时若无窗口则重建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// 除 macOS 外，所有窗口关闭即退出应用
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* 导出内部逻辑供单测（Electron 作为主入口加载时无副作用，不影响正常启动） */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { defaultVaultRoot, vaultRoot, loadConfig, saveConfig, recordHistory, migrateDefaultVault };
}