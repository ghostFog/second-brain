/* ============================================
 * 第二脑 — 选中文本格式动作·共享定义
 * 作者: 火 冰
 * 功能: 定义作用于选中文本的格式动作组（文本格式/段落设置/数学行内包裹），
 *       供「选中文本悬浮工具栏」(editor-wys-toolbar.js) 与「右键格式菜单」
 *       (app-editor-ctx.js / features/context.js) 两种触发形式共用，
 *       保证底层功能一致、仅触发形式不同。
 * 说明: 字体/字号/颜色/背景色落盘为 `<font face/color/size>`、`<span style>`、
 *       `<u>`，由 md-render/inlineToMd 白名单透传持久化。本文件以全局 function 声明，
 *       宿主由 index.html 同步先加载，插件 new Function 作用域可访问。
 * ============================================ */

'use strict';

  /* 字体候选（WYSIWYG fontName 可用的中英文字体）
   * 作者: 火 冰 */
  const WYS_FONTS = ['宋体', '黑体', '微软雅黑', '楷体', '仿宋', 'Georgia', 'Consolas', 'Times New Roman'];

  /* 字号档位（execCommand fontSize 的 1..7 语义，取 2..6）
   * 作者: 火 冰 */
  const WYS_FONT_SIZES = [
    { v: '2', label: '小' },
    { v: '3', label: '正常' },
    { v: '4', label: '大' },
    { v: '5', label: '特大' },
    { v: '6', label: '超大' },
  ];

  /* 文字颜色板（12 色）
   * 作者: 火 冰 */
  const WYS_TEXT_COLORS = [
    { label: '红', v: '#ef4444' },
    { label: '橙', v: '#f97316' },
    { label: '黄', v: '#f59e0b' },
    { label: '绿', v: '#22c55e' },
    { label: '青', v: '#06b6d4' },
    { label: '蓝', v: '#3b82f6' },
    { label: '紫', v: '#8b5cf6' },
    { label: '粉', v: '#ec4899' },
    { label: '灰', v: '#64748b' },
    { label: '黑', v: '#111827' },
    { label: '白', v: '#ffffff' },
    { label: '浅青', v: '#99f6e4' },
  ];

  /* 背景色板（12 色，与文字色一致）
   * 作者: 火 冰 */
  const WYS_BG_COLORS = WYS_TEXT_COLORS;

  /* 应用某一富文本命令（execWys 可能未定义时兜底为空）
   * @param {string} cmd execCommand 命令名
   * @param {*} value 可选命令值
   * @returns {void}
   * 作者: 火 冰 */
  function wysCmd(cmd, value) {
    if (typeof execWys === 'function') execWys(cmd, value);
  }

  /* 文本格式组：加粗/斜体/下划线/删除线 + 字体/字号/颜色/背景色 + 数学 + 清除格式
   * @returns {Object} {label, icon, children} 菜单/工具栏可渲染的结构
   * 作者: 火 冰 */
  function wysTextFmtGroup() {
    return {
      label: '文本格式', icon: 'type', children: [
        specItem('加粗', 'bold', function () { wysCmd('bold'); }),
        specItem('倾斜', 'italic', function () { wysCmd('italic'); }),
        specItem('下划线', 'underline', function () { wysCmd('underline'); }),
        specItem('删除线', 'strikethrough', function () { wysCmd('strikeThrough'); }),
        '-',
        { label: '字体', icon: 'type', children: WYS_FONTS.map(function (name) {
          return specItem(name, 'font', function () { wysCmd('fontName', name); });
        }) },
        { label: '字号', icon: 'type', children: WYS_FONT_SIZES.map(function (s) {
          return specItem(s.label, 'font', function () { wysCmd('fontSize', s.v); });
        }) },
        { label: '颜色', icon: 'palette', children: WYS_TEXT_COLORS.map(function (c) {
          return specItem(c.label, 'circle', function () { wysCmd('foreColor', c.v); });
        }) },
        { label: '背景色', icon: 'paint-bucket', children: WYS_BG_COLORS.map(function (c) {
          return specItem(c.label, 'circle', function () { wysCmd('hiliteColor', c.v); });
        }) },
        '-',
        specItem('数学', 'sigma', function () { wrapWysInline('$', '$'); }),
        '-',
        specItem('清除格式', 'eraser', function () { wysCmd('removeFormat'); }),
      ],
    };
  }

  /* 段落设置组：无序/有序/任务列表/引用 + 各级标题/正文
   * @param {Function} taskFn 任务列表动作（宿主注入，插入任务块）
   * @returns {Object} {label, icon, children} 菜单/工具栏可渲染的结构
   * 作者: 火 冰 */
  function wysParaFmtGroup(taskFn) {
    return {
      label: '段落设置', icon: 'pilcrow', children: [
        specItem('无序列表', 'list', function () { wysCmd('insertUnorderedList'); }),
        specItem('有序列表', 'list-ordered', function () { wysCmd('insertOrderedList'); }),
        specItem('任务列表', 'square-check-big', (taskFn || function () {})),
        specItem('引用', 'quote', function () { wysCmd('formatBlock', 'blockquote'); }),
        '-',
        specItem('1级标题', 'heading-1', function () { wysCmd('formatBlock', 'h1'); }),
        specItem('2级标题', 'heading-2', function () { wysCmd('formatBlock', 'h2'); }),
        specItem('3级标题', 'heading-3', function () { wysCmd('formatBlock', 'h3'); }),
        specItem('4级标题', 'heading-4', function () { wysCmd('formatBlock', 'h4'); }),
        specItem('5级标题', 'heading-5', function () { wysCmd('formatBlock', 'h5'); }),
        specItem('6级标题', 'heading-6', function () { wysCmd('formatBlock', 'h6'); }),
        specItem('正文', 'pilcrow', function () { wysCmd('formatBlock', 'p'); }),
      ],
    };
  }

  /* 数学行内包裹/解包：把选区内容夹在 `open`/`close`（即 `$…$`，与源码模式一致）；
   * 若选区前/后紧邻正是 open/close 符号，则只删掉这两个边界符号解包、保留内容。
   * @param {string} open 起始符号（'$'）
   * @param {string} close 结束符号（'$'）
   * @returns {void}
   * 作者: 火 冰 */
  function wrapWysInline(open, close) {
    const wys = document.getElementById('ed-wysiwyg');
    if (!wys) return;
    wys.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const sc = range.startContainer, so = range.startOffset;
    const ec = range.endContainer, eo = range.endOffset;

    /* 找选区前紧邻的 open 符号文本节点+偏移；无则 null
     * @param {Node} startNode 起始容器
     * @param {number} startOff 起始偏移
     * @returns {Object|null} {n, o}
     * 作者: 火 冰 */
    function findOpen(startNode, startOff) {
      if (startNode.nodeType === 3 && startOff > 0 && startNode.data[startOff - 1] === open) return { n: startNode, o: startOff - 1 };
      let cur = startNode && startNode.previousSibling ? startNode.previousSibling : null;
      while (cur && cur.nodeType !== 3) cur = cur.previousSibling;
      if (cur && cur.nodeType === 3 && cur.data && cur.data.charAt(cur.data.length - 1) === open) return { n: cur, o: cur.data.length - 1 };
      return null;
    }
    /* 找选区后紧邻的 close 符号文本节点+偏移；无则 null
     * @param {Node} endNode 结束容器
     * @param {number} endOff 结束偏移
     * @returns {Object|null} {n, o}
     * 作者: 火 冰 */
    function findClose(endNode, endOff) {
      if (endNode.nodeType === 3 && endOff < endNode.data.length && endNode.data[endOff] === close) return { n: endNode, o: endOff };
      let nxt = endNode && endNode.nextSibling ? endNode.nextSibling : null;
      while (nxt && nxt.nodeType !== 3) nxt = nxt.nextSibling;
      if (nxt && nxt.nodeType === 3 && nxt.data && nxt.data.charAt(0) === close) return { n: nxt, o: 0 };
      return null;
    }

    const oPos = findOpen(sc, so);
    const cPos = findClose(ec, eo);
    if (oPos && cPos) {
      // 解包：只删除前/后两个边界符号，保留选中内容
      const delChar = function (pos) {
        const dr = document.createRange();
        dr.setStart(pos.n, pos.o); dr.setEnd(pos.n, pos.o + 1);
        dr.deleteContents();
      };
      delChar(cPos);  // 先删 close，避免偏移变化
      delChar(oPos);
      sel.removeAllRanges();
      const cr = document.createRange();
      cr.setStart(oPos.n, oPos.o); cr.collapse(true);
      sel.addRange(cr);
    } else {
      // 包裹：extract 内容 → open + 内容 + close
      if (typeof range.startContainer === 'undefined') return;
      const content = range.extractContents();
      const oT = document.createTextNode(open);
      const cT = document.createTextNode(close);
      const frag = document.createDocumentFragment();
      frag.appendChild(oT); frag.appendChild(content); frag.appendChild(cT);
      range.insertNode(frag);
      sel.removeAllRanges();
      const r2 = document.createRange();
      r2.setStartAfter(oT); r2.setEndBefore(cT);
      sel.addRange(r2);
    }
    wys.dispatchEvent(new Event('input', { bubbles: true }));
  }