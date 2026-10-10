/* ============================================
 * 第二脑 — Code Editor 插件（CodeMirror 5 底座）
 * 作者: 火 冰
 * 功能:
 *   - 注册 .sql/.js/.py/.bat/.json 等代码文件的编辑器 Provider
 *   - 提供语法高亮、可选行号、自动换行、复制
 *   - 未支持的后缀由宿主 fallback → 系统默认打开
 * 说明: CodeMirror 5 已通过 npm install codemirror@5 安装，
 *       插件运行时动态加载 lib/codemirror.js + 语言 mode 文件
 * ============================================ */
'use strict';

/* CodeMirror 实例（单例，每次打开新文件重建） */
let cmInstance = null;
/* 当前编辑的绝对文件路径（供 getMd 时上下文使用） */
let cmCurrentPath = '';
/* CodeMirror 加载状态标记 */
let cmLoaded = false;

/* 后缀 → CodeMirror mode 映射表（含别名归一）
 * CodeMirror 5 的 mode 文件位于 node_modules/codemirror/mode/<name>/<name>.js
 * 作者: 火 冰 */
const CM_MODES = {
  sql: 'sql', mysql: 'sql', postgres: 'sql', sqlite: 'sql',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'javascript', tsx: 'javascript', jsx: 'javascript',
  json: 'javascript',
  py: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  bat: 'clike', cmd: 'clike', ps1: 'powershell', psm1: 'powershell',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', html: 'xml', htm: 'xml',
  css: 'css', scss: 'css', less: 'css',
  java: 'clike', c: 'clike', h: 'clike', cpp: 'clike', cc: 'clike', hpp: 'clike', hh: 'clike',
  cs: 'clike', go: 'clike', rs: 'clike', php: 'php',
  rb: 'ruby', pl: 'perl', lua: 'lua',
  scala: 'clike', kt: 'clike',
  ini: 'properties', conf: 'properties', cfg: 'properties', properties: 'properties',
  toml: 'toml',
  r: 'r', swift: 'swift', m: 'clike', mm: 'clike',
};

/* 根据后缀取 CodeMirror mode 名
 * @param {string} path 文件路径
 * @returns {string} mode 名（CodeMirror mode 目录名），未匹配返回 'clike' 兜底
 * 作者: 火 冰 */
function cmModeOf(path) {
  const m = /\.([a-z0-9]+)$/i.exec(String(path || ''));
  if (!m) return 'clike';
  const key = m[1].toLowerCase();
  return CM_MODES[key] || 'clike';
}

/* 动态加载 CodeMirror 脚本（lib + 语言 mode + 主题）
 * 用 <script> 注入 DOM，等脚本加载完成后 resolve Promise。
 * 幂等：已加载过直接 resolve。
 * @returns {Promise<void>}
 * 作者: 火 冰 */
function cmLoadScripts() {
  if (cmLoaded) return Promise.resolve();
  const paths = [
    'node_modules/codemirror/lib/codemirror.js',
    'node_modules/codemirror/addon/edit/matchbrackets.js',
    'node_modules/codemirror/addon/selection/active-line.js',
  ];
  function loadNext(i) {
    if (i >= paths.length) { cmLoaded = true; return Promise.resolve(); }
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = paths[i]; s.onload = function () { res(loadNext(i + 1)); }; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  return loadNext(0);
}

/* 加载指定 CodeMirror 语言 mode
 * @param {string} mode 语言 mode 名（如 'sql'、'python'）
 * @returns {Promise<void>}
 * 作者: 火 冰 */
function cmLoadMode(mode) {
  const key = 'cm-mode-' + mode;
  if (document.getElementById(key)) return Promise.resolve();
  const src = 'node_modules/codemirror/mode/' + mode + '/' + mode + '.js';
  return new Promise(function (res, rej) {
    const s = document.createElement('script');
    s.id = key; s.src = src;
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* 加载 CodeMirror CSS（核心 + 主题）
 * @returns {Promise<void>}
 * 作者: 火 冰 */
function cmLoadCss() {
  const keyCore = 'cm-css-core';
  const keyTheme = 'cm-css-theme';
  function inject(href, id) {
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.id = id;
    document.head.appendChild(l);
  }
  inject('node_modules/codemirror/lib/codemirror.css', keyCore);
  // 用宿主主题色（可后续切换）；先用默认主题保证可见
  inject('node_modules/codemirror/theme/dracula.css', keyTheme);
  return Promise.resolve();
}

/* 初始化/重建 CodeMirror 实例
 * 宿主在 .sb-provider-dom 容器里渲染 <div id="cm-host"></div> 后调用本函数。
 * 使用 CodeMirror(div) 直接创建实例，完全不依赖 textarea（避免 fromTextArea 对隐藏元素的初始化失败）。
 * CodeMirror 高度需由外层 .sb-provider-dom 控制（position:absolute; inset:0），内部用 height:100% 撑满。
 * @param {string} path 文件路径（用于推断语言）
 * @param {string} content 文件原始内容
 * 作者: 火 冰 */
async function cmInit(path, content) {
  cmCurrentPath = path || '';
  const mode = cmModeOf(path);

  // 确保脚本/CSS 已加载
  await cmLoadCss();
  await cmLoadScripts();
  await cmLoadMode(mode);

  const hostDiv = document.getElementById('cm-host');
  if (!hostDiv) return;

  // 清理旧实例（CodeMirror(div) 没有 toTextArea，手动移除 wrapper）
  if (cmInstance) {
    const wrapper = cmInstance.getWrapperElement();
    if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
    cmInstance = null;
  }

  // 持久化设置读取
  const lineNums = !!(typeof restoreS === 'function' ? restoreS('cmLineNumbers', true) : true);
  const wrap = !!(typeof restoreS === 'function' ? restoreS('cmWrap', false) : false);

  // 创建实例：直接在 div 上渲染（div 已由 .sb-provider-dom 撑满容器）
  cmInstance = CodeMirror(hostDiv, {
    mode: mode,
    theme: 'dracula',
    lineNumbers: lineNums,
    lineWrapping: wrap,
    matchBrackets: true,
    styleActiveLine: true,
    indentUnit: 4,
    tabSize: 4,
    value: content || '',
  });

  // 输入事件桥接：触发宿主的 onEdInput 去抖保存
  cmInstance.on('change', function () {
    if (typeof cmNotifyChange === 'function') {
      try { cmNotifyChange(cmInstance.getValue()); } catch (_) {}
    }
  });

  // 撑满容器高度：CodeMirror wrapper 需要 height:100% 才能填满 .sb-provider-dom
  const wrapper = cmInstance.getWrapperElement();
  if (wrapper) {
    wrapper.style.height = '100%';
    // CodeMirror 内部滚动容器也需要撑满
    const scroller = wrapper.querySelector('.CodeMirror-scroll');
    if (scroller) scroller.style.height = '100%';
  }

  // 自适应高度（容器就绪后刷新，确保尺寸正确）
  setTimeout(function () { cmInstance.refresh(); }, 50);
}

/* 工具栏按钮动作：切换行号 */
function cmToggleLineNumbers() {
  if (!cmInstance) return;
  const on = !cmInstance.getOption('lineNumbers');
  cmInstance.setOption('lineNumbers', on);
  if (typeof saveS === 'function') saveS('cmLineNumbers', on);
  cmInstance.refresh();
}

/* 工具栏按钮动作：切换自动换行 */
function cmToggleWrap() {
  if (!cmInstance) return;
  const on = !cmInstance.getOption('lineWrapping');
  cmInstance.setOption('lineWrapping', on);
  if (typeof saveS === 'function') saveS('cmWrap', on);
  cmInstance.refresh();
}

/* 工具栏按钮动作：复制全部 */
function cmCopyAll() {
  if (!cmInstance) return;
  try {
    const text = cmInstance.getValue();
    navigator.clipboard.writeText(text).then(function () {
      if (typeof toast === 'function') toast('已复制 ' + text.length + ' 字符');
    }, function () {
      cmInstance.execCommand('selectAll');
      document.execCommand('copy');
      if (typeof toast === 'function') toast('已复制');
    });
  } catch (_) {}
}

/* 宿主回调桥接：CodeMirror change → 宿主保存入口
 * 宿主在 open 时注入此函数，避免插件直接依赖宿主的内部事件名。
 * 作者: 火 冰 */
let cmNotifyChange = null;

/* ============================================
 * 注册 Provider + Commands
 * ============================================ */
if (typeof PluginAPI !== 'undefined' && PluginAPI.registerEditorProvider) {
  try {
    PluginAPI.registerEditorProvider({
      id: 'code-editor',
      name: 'Code Editor',
      extensions: [
        '.sql', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
        '.json', '.py', '.sh', '.bash',
        '.bat', '.cmd', '.ps1', '.psm1',
        '.yml', '.yaml', '.xml', '.html', '.htm', '.css', '.scss', '.less',
        '.java', '.c', '.h', '.cpp', '.cc', '.hpp', '.hh', '.cs',
        '.go', '.rs', '.rb', '.php', '.pl', '.lua', '.scala', '.kt',
        '.ini', '.conf', '.cfg', '.toml', '.properties', '.env',
        '.r', '.swift', '.m', '.mm',
      ],
      open: function (path, content, notifyChange) {
        cmNotifyChange = notifyChange || null;
        return cmInit(path, content || '');
      },
      /* 返回 CodeMirror 挂载 div：宿主把它插到 .sb-provider-dom 容器后，open 调用 cmInit(div 模式) */
      renderWysiwyg: function () {
        return '<div id="cm-host" style="width:100%;height:100%"></div>';
      },
      getMd: function () {
        return cmInstance ? cmInstance.getValue() : '';
      },
      /* 更新宿主缓存（宿主调用，保持 cmInstance 内容同步） */
      syncValue: function (md) {
        if (cmInstance) cmInstance.setValue(md || '');
      },
      /* 工具栏按钮动作路由 */
      toolAction: function (actionId) {
        switch (actionId) {
          case 'toggle-lineno': cmToggleLineNumbers(); break;
          case 'toggle-wrap':   cmToggleWrap(); break;
          case 'copy':          cmCopyAll(); break;
        }
      },
      /* 销毁当前实例（切文件时调用）：CodeMirror(div) 没有 toTextArea，手动移除 wrapper */
      destroy: function () {
        if (cmInstance) {
          const wrapper = cmInstance.getWrapperElement();
          if (wrapper && wrapper.parentNode) wrapper.parentNode.removeChild(wrapper);
          cmInstance = null;
        }
      },
    });
  } catch (_) { /* 装配异常由宿主沙箱兜底 */ }
}

/* 注册工具栏按钮命令（宿主 toolbar.button 通过 data-actionKey 调用） */
if (typeof PluginAPI !== 'undefined' && PluginAPI.register) {
  PluginAPI.register('code-editor', {
    'code-editor-toggle-lineno': cmToggleLineNumbers,
    'code-editor-toggle-wrap':   cmToggleWrap,
    'code-editor-copy':          cmCopyAll,
  });
}
