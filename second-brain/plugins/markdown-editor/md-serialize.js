/* ============================================
 * 第二脑 — Markdown Editor 插件·序列化模块
 * 作者: 火 冰
 * 功能: 所见即所得 DOM ↔ Markdown 往返序列化（inlineToMd / domToMd）。
 *       本模块为 markdown 编辑器的增强核心，由插件承载，宿主经 window.sbMdBridge 委托。
 * 说明: 与宿主 js/editor/editor-md.js 的薄壳委托同名函数互相配合——桌面版插件加载后
 *       以本实现覆盖；网页版无目录插件时回落宿主薄壳。
 * ============================================ */
'use strict';

(function () {
  /* 所见即所得编辑区的行内节点逆转换：把渲染后的内联 DOM 转回 Markdown 行内语法
   * 支持：加粗/**、行内代码、[[内链]]、[链接](url)、斜体*
   * @param {Element} el 内联 DOM 节点
   * @returns {string} Markdown 行内语法
   * 作者: 火 冰 */
  function inlineToMd(el) {
    let md = '';
    el.childNodes.forEach(function (node) {
      if (node.nodeType === 3) { md += node.nodeValue; return; }  // 文本节点原样
      if (node.nodeType !== 1) return;
      const t = node.nodeName.toLowerCase();
      const inner = inlineToMd(node);
      if (t === 'strong' || t === 'b') { if (inner) md += '**' + inner + '**'; }
      else if (t === 'em' || t === 'i') { if (inner) md += '*' + inner + '*'; }
      else if (t === 'code') { md += '`' + inner + '`'; }
      else if (t === 'a') {
        const href = node.getAttribute && node.getAttribute('href');
        const wiki = node.dataset && node.dataset.wikilink;
        if (wiki) md += '[[' + inner + ']]';
        else if (href && href !== '#') md += '[' + inner + '](' + href + ')';
        else md += inner;
      }
      else if (node.classList && node.classList.contains('sb-math') && node.getAttribute && node.getAttribute('data-math')) {
        md += '$' + inner + '$';  // 数学内联块 → $…$（与 inline() 往返一致）
      }
      else if (t === 'font' || t === 'u' || (t === 'span' && node.hasAttribute && node.hasAttribute('style'))) {
        md += node.outerHTML;  // HTML 透传：字体/字号/颜色/背景色/下划线原样保留，保证往返稳定
      }
      else if (t === 'input') { md += node.checked ? '[x]' : '[ ]'; }
      else if (t === 'br') { md += '\n'; }
      else { md += inner; }
    });
    return md;
  }

  /* 所见即所得编辑区 → Markdown：遍历渲染后的整块 DOM，还原为 Markdown 源文本
   * 与 renderMarkdown 输出的结构一一对应，保证来回转换一致
   * @param {Element} root #ed-wysiwyg 根元素
   * @returns {string} Markdown 源文本
   * 作者: 火 冰 */
  function domToMd(root) {
    const lines = [];
    (root.childNodes || []).forEach(function (node) {
      if (node.nodeType === 1 && node.classList && node.classList.contains('code-lang')) return; // 语言标签仅供显示，不入 markdown
      if (node.nodeType === 3) { const t = node.nodeValue; if (t && t.trim()) lines.push(t); else lines.push(''); return; }
      if (node.nodeType !== 1) return;
      const tg = node.nodeName.toLowerCase();
      if (/^h[1-3]$/.test(tg)) { lines.push('#'.repeat(+tg[1]) + ' ' + inlineToMd(node)); return; }
      if (tg === 'pre') {
        const l = node.getAttribute && node.getAttribute('data-lang') || '';
        lines.push('```' + (l || ''));
        lines.push((node.textContent || '').replace(/\n$/, ''));
        lines.push('```'); return;
      }
      if (tg === 'blockquote') {
        const inner = node.querySelector('p, div, span');
        lines.push('> ' + (inner ? inlineToMd(inner) : inlineToMd(node)));
        return;
      }
      if (tg === 'li' || /div|p|span/.test(tg)) {
        // 待办清单：lucide 的 square/check-square 图标 + 文本
        const icon = node.querySelector && node.querySelector('i[data-lucide="square"], i[data-lucide="check-square"]');
        if (icon) {
          const done = icon.dataset && icon.dataset.lucide === 'check-square';
          const body = node.querySelector('span');
          lines.push('- [' + (done ? 'x' : ' ') + '] ' + ((body && body !== icon) ? inlineToMd(body) : inlineToMd(node)));
          return;
        }
        // 无序 / 有序列表：圆点 span 或 “•” 文本 + 内容 span
        const dot = node.querySelector && node.querySelector('span.w-1');
        if (dot) {
          const body = node.querySelector('span:not(.w-1):not(.text-caption)') || node;
          lines.push('- ' + inlineToMd(body));
          return;
        }
        const marker = node.textContent && node.textContent.trim().charAt(0) === '•';
        if (marker) {
          const body = node.querySelector('span:not(.text-caption)') || node;
          lines.push('1. ' + inlineToMd(body));  // 有序列表序号因渲染丢失，用 1. 兜底
          return;
        }
        lines.push(inlineToMd(node));
        return;
      }
      if (tg === 'hr') { lines.push('---'); return; }
      if (tg === 'table') {
        const rows = node.querySelectorAll('tr');
        Array.prototype.forEach.call(rows, function (tr, ri) {
          const cells = tr.querySelectorAll('th, td');
          // Markdown 管道表格单元格不能含换行：空占位 <br> 会序列化为 '\n'，需去掉（连同两端空白）
          const vals = Array.prototype.map.call(cells, function (c) { return inlineToMd(c).replace(/\n+/g, ' ').trim(); });
          if (vals.length) lines.push('| ' + vals.join(' | ') + ' |');
          if (ri === 0 && rows.length > 1) lines.push('| ' + vals.map(function () { return '---'; }).join(' | ') + ' |'); // 表头后补分隔行
        });
        return;
      }
      lines.push(inlineToMd(node));
    });
    // 合并尾随空行，还原原始换行（每段一行）
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    const raw = lines.join('\n');
    return raw.replace(/\n{3,}/g, '\n\n');
  }

  // 暴露到 window：宿主/测试经全局名调用；同时登记进 sbMdBridge 供宿主薄壳委托
  window.domToMd = domToMd;
  window.inlineToMd = inlineToMd;
  window.sbMdBridge = window.sbMdBridge || {};
  window.sbMdBridge.serialize = { inlineToMd: inlineToMd, domToMd: domToMd };
})();