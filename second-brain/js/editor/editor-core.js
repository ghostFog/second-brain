/* ============================================
 * 第二脑 — 编辑器宿主·核心状态与通用工具
 * 作者: 火 冰
 * 功能: 编辑器全局状态（let/const 顶层绑定，跨 js/editor/*.js 共享）、常用工具函数
 * ============================================ */

'use strict';

  /* ============================
   * 编辑器视图交互（真实数据驱动）
   * ============================ */

  let edNotes = [];          // 当前笔记库列表
  let edCurrent = null;      // 当前打开笔记的相对路径
  let edSel = null;          // 右侧面板当前选中的目录：{type:'folder', path}；打开笔记时重置为 null
  let edOutdated = {};       // 已加载内容缓存 path->text，未保存标记
  let edOpenTabs = [];       // 打开中的标签 path 列表（自然顺序，含锁定）
  let edPinned = new Set();  // 已锁定（固定）标签 path 集合：固定显示在 tab 栏左端固定区、无关闭按钮
  let edDirty = new Set();   // 有未保存更改的标签 path 集合（用于「关闭所有未修改」等判定）
  let edDragFrom = null;     // tab 拖拽：当前被拖动的 path
  let edDragTarget = null;   // tab 拖拽：当前悬浮的目标 path
  let edBlockSel = null;     // 所见即所得：当前被选中的顶层块元素（pre/blockquote/table/hr）——保留（editor-md.js 死代码仍引用，vditor 接管后不再生效）
  let collapsedFolders = new Set(); // 已折叠的文件夹键集合
  let edMode = 'edit';        // edit | preview | split（默认编辑；可被设置「默认编辑模式」覆盖）
  let edSource = false;       // 源码模式开关：true=编辑区显示源码 textarea；false=所见即所得（渲染可编辑）
  let edExt = '';             // 当前打开文件的后缀（含点，小写）：由插件注册的编辑器能力路由
  let edProvider = null;      // 当前文件命中的编辑器能力 Provider（md → markdown-editor，无匹配 → 内置兜底）
  let edClickPath = null;     // 文件树最近一次单击的文件路径（用于双击判定，renameNoteFile）
  let edClickTime = 0;        // 文件树最近一次单击的时间戳
  let edTextFallback = false; // 纯文本兜底：无 Provider 匹配时以 textarea 只读渲染（保证任意后缀可打开）
  let edSaveTimer = null;
  let edLineNum = true;       // 行号显示开关（initEditor 时从设置恢复）
  let findOpen = false;       // 查找/替换条是否打开
  let edFindQ = '';           // 当前查找关键词
  let edFindMatches = [];     // 匹配位置 [{start,end}]
  let edFindIdx = -1;         // 当前匹配索引（0 起）
  let mdeCodePre = null;      // 代码块语言选择器：当前选中的 <pre> 代码块（保留：editor-md.js 死代码仍引用）
  let mdeCodeEl = null;       // 代码块语言选择器：浮动容器（chip + 下拉）（保留：editor-md.js 死代码仍引用）

  /* 常用代码语言表：name 写入 data-lang；搜索时按 name 与 aliases 不区分大小写命中 */
  const CODE_LANGS = [
    { name: 'text', aliases: ['plain', 'plaintext'] },
    { name: 'bash', aliases: ['sh', 'shell', 'zsh'] },
    { name: 'python', aliases: ['py'] },
    { name: 'javascript', aliases: ['js', 'node'] },
    { name: 'typescript', aliases: ['ts', 'tsx'] },
    { name: 'java', aliases: [] },
    { name: 'c', aliases: ['h'] },
    { name: 'cpp', aliases: ['c++', 'cc', 'hpp'] },
    { name: 'csharp', aliases: ['c#', 'cs'] },
    { name: 'go', aliases: ['golang'] },
    { name: 'rust', aliases: ['rs'] },
    { name: 'swift', aliases: [] },
    { name: 'kotlin', aliases: ['kt'] },
    { name: 'ruby', aliases: ['rb'] },
    { name: 'php', aliases: [] },
    { name: 'perl', aliases: [] },
    { name: 'lua', aliases: [] },
    { name: 'objective-c', aliases: ['objc'] },
    { name: 'html', aliases: ['htm'] },
    { name: 'css', aliases: [] },
    { name: 'scss', aliases: ['sass'] },
    { name: 'less', aliases: [] },
    { name: 'json', aliases: [] },
    { name: 'yaml', aliases: ['yml'] },
    { name: 'toml', aliases: [] },
    { name: 'xml', aliases: [] },
    { name: 'sql', aliases: ['mysql', 'postgresql'] },
    { name: 'markdown', aliases: ['md'] },
    { name: 'dockerfile', aliases: ['docker'] },
    { name: 'makefile', aliases: ['make'] },
    { name: 'powershell', aliases: ['ps1', 'pwsh'] },
    { name: 'r', aliases: [] },
    { name: 'dart', aliases: [] },
    { name: 'matlab', aliases: [] },
    { name: 'graphql', aliases: ['gql'] },
    { name: 'ini', aliases: ['config'] },
    { name: 'git', aliases: ['gitignore'] },
  ];

  const $ = (id) => document.getElementById(id);

  /* 统计字数（去空白） */
  function countChars(text) { return String(text || '').replace(/\s/g, '').length; }

  /* 从 markdown 提取标签 */
  function extractTags(md) {
    const tags = [];
    (String(md || '').match(/#[\u4e00-\u9fa5A-Za-z0-9_-]+/g) || []).forEach(t => {
      if (t.length > 1 && tags.indexOf(t) === -1) tags.push(t);
    });
    return tags;
  }

  /* 从 markdown 提取标题（大纲） */
  function extractOutline(md) {
    const out = [];
    (String(md || '').match(/^#{1,3}\s+.*$/gm) || []).forEach(line => {
      const m = line.match(/^(#{1,3})\s+(.*)$/);
      out.push({ level: m[1].length, text: m[2] });
    });
    return out;
  }

  /* 将相对日期格式化 */
  function relDate(mtime) {
    const d = new Date(mtime);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((start - t) / 86400000);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    return days + '天前';
  }

  /* 正则转义：把用户输入的原样当作字面文本搜索 */
  function escapeReg(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }