// 一次性拆分脚本：doc/开发进度.md → 主文件(未完结+导航) + 各模块子文件(已完结) + 工程记录
const fs = require('fs');
const path = require('path');
const DIR = 'd:/project/aiCode/second-brain/doc';
const MAIN = '开发进度.md';
const src = fs.readFileSync(path.join(DIR, MAIN), 'utf8');
const lines = src.split(/\r?\n/);

/* 章节标题 → [{module, filename, keepMain}]  keepMain=true 表示该节保留在主文件(常用命令/架构重构) */
function classify(title) {
  if (/^## /.test(title) === false) return null;
  const t = title.replace(/^##\s+/, '');
  if (/^1\.|全局框架/.test(t)) return { m: '全局框架', f: '进度-全局框架.md' };
  if (/^2\.|编辑器|2\.1|2\.2|2\.3/.test(t)) return { m: '编辑器', f: '进度-编辑器.md' };
  if (/^3\.|命令面板/.test(t)) return { m: '命令面板', f: '进度-命令面板.md' };
  if (/^4\.|图谱/.test(t)) return { m: '图谱视图', f: '进度-图谱视图.md' };
  if (/^5\.|插件市场/.test(t)) return { m: '插件', f: '进度-插件.md' };
  if (/^6\.|设置/.test(t)) return { m: '设置', f: '进度-设置.md' };
  if (/^6\.3|AI 问答/.test(t)) return { m: 'AI 问答', f: '进度-AI问答.md' };
  if (/^8\.|应用安全/.test(t)) return { m: '平台规划', f: '进度-平台规划.md' };
  if (/^9\.|加密插件/.test(t)) return { m: '平台规划', f: '进度-平台规划.md' };
  if (/^10\.|Git 同步/.test(t)) return { m: '平台规划', f: '进度-平台规划.md' };
  if (/^11\.|示例插件/.test(t)) return { m: '插件', f: '进度-插件.md' };
  if (/常用命令/.test(t)) return { m: null, f: null, keepMain: true };
  if (/架构重构/.test(t)) return { m: null, f: null, keepMain: true };
  if (/^7\./.test(t)) return { m: 'AI 问答', f: '进度-AI问答.md' };
  return { m: '其他', f: '进度-工程记录.md' };
}

const uncompleted = []; // {module, row}
const archive = {};     // moduleFile -> [rows]
const mainBlocks = [];  // free-text blocks kept in main (常用命令/架构重构)
const eng = [];         // free-text blocks to 工程记录

let cur = null;       // current classify
let curRows = [];     // free-text buffer for current mainKeep or eng decision
let inFence = false;
const fenceBuf = [];

function flushFree() {
  const blob = fenceBuf.join('\n');
  if (!blob.trim()) return;
  if (cur && cur.keepMain) mainBlocks.push(blob);
  else if (cur && !cur.f) mainBlocks.push(blob);
  else eng.push(blob);
  fenceBuf.length = 0;
}

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = raw.trim();

  if (/^##\s+/.test(line)) {
    flushFree();
    cur = classify(line);
    continue;
  }
  if (/^```/.test(line)) { inFence = !inFence; fenceBuf.push(raw); continue; }
  if (!cur) continue;

  // 表格数据行：以 | 开头且非表头/分隔
  if (line.startsWith('|')) {
    const parts = line.split('|').map(s => s.trim());
    const isHeader = parts.some(p => p === '编号');
    const isSep = parts.every(p => /^:?-+:?$/.test(p) || p === '');
    if (isHeader || isSep) { continue; }
    // 状态列 = 索引4
    const status = (parts[4] || '').trim();
    const done = /^(测试完成|完成)$/.test(status);
    if (cur.keepMain) continue;
    if (cur.f) {
      if (!done) uncompleted.push({ module: cur.m, row: raw });
      else (archive[cur.f] = archive[cur.f] || []).push(raw);
    }
    continue;
  }

  // 游离正文/转义表行 → 暂存（完结历史归工程记录）
  fenceBuf.push(raw);
}
flushFree();

/* 写子文件（已完结归档） */
for (const [f, rows] of Object.entries(archive)) {
  const fpath = path.join(DIR, f);
  const header = `# ${f.replace('进度-', '').replace('.md', '')} · 已完结进度\n\n> 仅归档已完结条目；进行中/未完结请见主文件 \`doc/开发进度.md\`（未完结看板）。\n\n| 编号 | 功能点 | 功能点详情 | 状态 | 开始时间 | 完成时间 | 记录 |\n| ---- | ---- | ---- | ---- | ---- | ---- | ---- |\n`;
  const body = rows.join('\n') + '\n';
  fs.writeFileSync(fpath, header + body, 'utf8');
  console.log('已生成:', f, '条目', rows.length);
}

/* 工程记录文件（游离块 + 完结但无模块的历史附加记录） */
if (eng.length) {
  fs.writeFileSync(path.join(DIR, '进度-工程记录.md'),
    '# 工程与运行记录\n\n> 拆分时未归入具体模块的历史正文/附加记录（含日志落盘、运行期排查、超长/转义的历史表行等）。\n\n' + eng.join('\n\n') + '\n', 'utf8');
  console.log('已生成 进度-工程记录.md 块数', eng.length);
}

/* 主文件 */
const rowsByMod = {};
uncompleted.forEach(u => { (rowsByMod[u.module] = rowsByMod[u.module] || []).push(u.row); });
let nav = '';
for (const mod of ['全局框架', '编辑器', '命令面板', '图谱视图', '插件', '设置', 'AI 问答', '平台规划']) {
  const f = { '全局框架': '进度-全局框架.md', '编辑器': '进度-编辑器.md', '命令面板': '进度-命令面板.md', '图谱视图': '进度-图谱视图.md', '插件': '进度-插件.md', '设置': '进度-设置.md', 'AI 问答': '进度-AI问答.md', '平台规划': '进度-平台规划.md' }[mod];
  nav += `- [${f}](${f}) — ${mod} 已完结进度（此模块未完结见上方看板）\n`;
}

let main = `# 第二脑 · 开发进度跟踪表

> 用途：按模块跟踪每个功能点状态。
> 状态取值：计划 -> 设计 -> 编码 -> 开发完成 -> 测试完成 -> 完成。
> 维护约定：**已完结历史已归档到 \`进度-<模块>.md\`，本文件只保留未完结条目**与模块导航。
> 新增功能点：先登记到下方「未完结看板」，完成后再移入对应模块子文件。

***

## 未完结进度（看板）

| 模块 | 编号 | 功能点 | 状态 | 记录 |
| ---- | ---- | ---- | ---- | ---- |
`;
for (const [mod, rows] of Object.entries(rowsByMod)) {
  for (const r of rows) {
    const p = r.split('|').map(s => s.trim());
    const id = p[1] || '', name = p[2] || '', status = p[4] || '', rec = (p[7] || '').replace(/\|/g, '\\|').trim();
    main += `| ${mod} | ${id} | ${name} | ${status} | ${rec} |\n`;
  }
}

main += `
***

## 已完结历史（按模块归档）

${nav}
## 常用命令速查（在 second-brain 内）

| 操作 | 命令 |
| ---- | ---- |
| 启动桌面版 | npm start 或双击 start-desktop.bat |
| 网页版调试 | 双击 start-server.bat，访问 http://127.0.0.1:8000/index.html |
| 打包 exe | npm run dist（产物在 second-brain/dist/） |

***

## 架构重构记录

${mainBlocks.join('\n\n')}

<br />
`;
fs.writeFileSync(path.join(DIR, MAIN), main, 'utf8');
console.log('主文件已重写，未完结条目', uncompleted.length);