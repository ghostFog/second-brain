/* ============================================
 * 第二脑 — 选中文本悬浮工具栏（ED-40）
 * 作者: 火 冰
 * 功能: 所见即所得编辑区选中文本时，选区上方弹出悬浮工具栏，提供与右键格式菜单
 *       完全一致的格式动作（字体/字号/颜色/背景色/加粗/斜体/下划线/删除线/数学/段落）。
 *       底层共用 editor-format.js 的 wysTextFmtGroup / wysParaFmtGroup / wrapWysInline，
 *       仅触发形式为「选中文本弹出」。
 * 说明: 以 body 级单例浮层 #wys-sel-tool（position:fixed）呈现，不污染 #ed-wysiwyg DOM。
 *       bindWysSelToolbar 独立可测（仿 bindWysCopyButton）。
 * ============================================ */

'use strict';

  /* 生成工具栏内的一个按钮元素（叶子项点击执行 action；带 children 的展开子面板）
   * @param {Object} item {label, icon, action?, children?}
   * @returns {HTMLButtonElement|HTMLDivElement} 按钮/分组元素
   * 作者: 火 冰 */
  function createWysToolButton(item) {
    if (item.children) {
      // 分组项：主按钮 + 下拉面板
      const wrap = document.createElement('button');
      wrap.className = 'wys-sel-tool-btn';
      wrap.type = 'button';
      wrap.title = item.label || '';
      wrap.innerHTML = '<i data-lucide="' + item.icon + '" class="w=3.5 h=3.5"></i><i data-lucide="chevron-down" class="w=3 h=3"></i>';
      const panel = createWysToolPanel(item.children);
      wrap.appendChild(panel);
      wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        // 关闭其它已展开面板，再切换本面板
        document.querySelectorAll('#wys-sel-tool .wys-tool-panel').forEach(function (p) { if (p !== panel) p.hidden = true; });
        panel.hidden = !panel.hidden;
      });
      return wrap;
    }
    // 叶子项
    const btn = document.createElement('button');
    btn.className = 'wys-sel-tool-btn';
    btn.type = 'button';
    btn.title = item.label || '';
    btn.innerHTML = (item.icon === 'circle')
      ? '<i class="wys-swatch" style="background: var(--note-brand-400); width:14px;height:14px;border-radius:3px;"></i>'
      : '<i data-lucide="' + item.icon + '" class="w=3.5 h=3.5"></i>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof item.action === 'function') {
        try { item.action(); } catch (_) { /* 动作异常不阻断收起 */ }
      }
      hideWysSelToolbar(document.getElementById('wys-sel-tool'));
    });
    return btn;
  }

  /* 生成工具面板内的一个条目元素（叶子项执行 action；分组项递归子面板）
   * @param {Object} item 条目 {label, icon, action?, children?}
   * @returns {HTMLDivElement} 面板条目
   * 作者: 火 冰 */
  function createWysToolPanelItem(item) {
    const div = document.createElement('div');
    div.className = 'wys-panel-item';
    div.title = item.label || '';
    if (item.children) {
      div.innerHTML = '<i data-lucide="' + item.icon + '" class="w=3.5 h=3.5"></i>' + item.label + '<i data-lucide="chevron-right" class="w=3 h=3"></i>';
      const sub = createWysToolPanel(item.children);
      sub.style.left = '100%';
      sub.style.top = '0';
      div.appendChild(sub);
      div.addEventListener('mouseenter', function () { sub.style.display = 'block'; });
      div.addEventListener('mouseleave', function () { sub.style.display = 'none'; });
      return div;
    }
    div.innerHTML = (item.icon === 'circle')
      ? '<i class="wys-swatch" style="background: var(--note-brand-400); width:12px;height:12px;border-radius:3px;"></i>' + item.label
      : '<i data-lucide="' + item.icon + '" class="w=3.5 h=3.5"></i>' + item.label;
    div.addEventListener('click', function (e) {
      e.stopPropagation();
      if (typeof item.action === 'function') {
        try { item.action(); } catch (_) { /* 忽略 */ }
      }
      hideWysSelToolbar(document.getElementById('wys-sel-tool'));
    });
    return div;
  }

  /* 生成工具下拉面板：把一组 children 渲染成条目列表（'-' 为分隔线）
   * @param {Array} children 子项数组
   * @returns {HTMLDivElement} 面板容器（hidden=true 初始隐藏）
   * 作者: 火 冰 */
  function createWysToolPanel(children) {
    const panel = document.createElement('div');
    panel.className = 'wys-tool-panel';
    panel.style.cssText = 'position:absolute;top:100%;left:0;background:var(--note-popover);border:1px solid var(--note-border);border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);padding:4px;z-index:132;min-width:120px;';
    panel.hidden = true;
    (children || []).forEach(function (item) {
      if (item === '-') {
        const sep = document.createElement('div');
        sep.className = 'wys-panel-sep';
        sep.style.cssText = 'height:1px;background:var(--note-border);margin:4px 0;';
        panel.appendChild(sep);
      } else {
        panel.appendChild(createWysToolPanelItem(item));
      }
    });
    return panel;
  }

  /* 生成单例悬浮工具栏容器（body 级，不随光标重渲染）
   * @returns {HTMLDivElement} #wys-sel-tool 容器
   * 作者: 火 冰 */
  function ensureWysSelToolbar() {
    let tool = document.getElementById('wys-sel-tool');
    if (tool) return tool;
    tool = document.createElement('div');
    tool.id = 'wys-sel-tool';
    tool.hidden = true;
    tool.style.cssText = 'position:fixed;z-index:131;display:flex;gap:4px;padding:4px;background:var(--note-popover);border:1px solid var(--note-border);border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.15);';
    const textFmt = (typeof wysTextFmtGroup === 'function') ? wysTextFmtGroup() : null;
    const paraFmt = (typeof wysParaFmtGroup === 'function') ? wysParaFmtGroup(function () { insTaskBlock(); }) : null;
    const addGroup = function (group) {
      if (!group) return;
      (group.children || []).forEach(function (item) {
        if (item === '-') {
          const sep = document.createElement('div');
          sep.className = 'wys-tool-sep';
          sep.style.cssText = 'width:1px;background:var(--note-border);';
          tool.appendChild(sep);
        } else {
          tool.appendChild(createWysToolButton(item));
        }
      });
    };
    addGroup(textFmt);
    if (textFmt && paraFmt) {
      const sep = document.createElement('div');
      sep.className = 'wys-tool-sep';
      sep.style.cssText = 'width:1px;background:var(--note-border);';
      tool.appendChild(sep);
    }
    addGroup(paraFmt);
    // 外部点击（含面板条目标识 btn 除外）无 action 的冒泡在容器 mousedown 处理，此处容器不拦截；
    // 工具栏内 mousedown 阻止默认以保住选区
    tool.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); });
    document.body.appendChild(tool);
    if (typeof refreshIcons === 'function') refreshIcons();
    return tool;
  }

  /* 隐藏悬浮工具栏
   * @param {HTMLDivElement|null} tool 工具栏容器（缺省取单例）
   * @returns {void}
   * 作者: 火 冰 */
  function hideWysSelToolbar(tool) {
    const t = tool || document.getElementById('wys-sel-tool');
    if (t) t.hidden = true;
  }

  /* 锚定工具栏到当前选中文本选区上方居中；顶缘放不下翻到下方，左右 clamp 视口
   * @param {Element} wys #ed-wysiwyg 容器
   * @param {HTMLDivElement} tool 工具栏容器
   * @returns {void}
   * 作者: 火 冰 */
  function anchorWysSelToolbar(wys, tool) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let rect;
    try { rect = sel.getRangeAt(0).getBoundingClientRect(); } catch (_) { return; }
    if (!rect || (!rect.width && !rect.height)) {
      // 选区 rect 有时为空：退化为范围所在块 rect
      const el = sel.anchorNode && (sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentNode : sel.anchorNode);
      rect = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      if (!rect) return;
    }
    tool.style.visibility = 'hidden';
    tool.style.display = 'flex';
    const tw = tool.offsetWidth || 240;
    const th = tool.offsetHeight || 30;
    tool.style.display = 'flex';
    tool.style.visibility = '';
    const cx = rect.left + rect.width / 2;
    let left = cx - tw / 2;
    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
    if (left < 8) left = 8;
    if (left + tw > vw - 8) left = vw - tw - 8;
    let top = rect.top - th - 8;
    if (top < 8) top = rect.bottom + 8;   // 顶缘放不下 → 翻到选区下方
    tool.style.left = left + 'px';
    tool.style.top = top + 'px';
  }

  /* 显示悬浮工具栏并锚定到当前选区
   * @param {Element} wys #ed-wysiwyg 容器
   * @return {void}
   * 作者: 火 冰 */
  function showWysSelToolbar(wys) {
    const tool = ensureWysSelToolbar();
    tool.hidden = false;
    anchorWysSelToolbar(wys, tool);
    if (typeof refreshIcons === 'function') refreshIcons();
  }

  /* 求选区签名，用于去抖：避免 selectionchange 高频触发重复重绘
   * @param {Selection} sel 当前选区
   * @returns {string} 签名
   * 作者: 火 冰 */
  function wysSelSignature(sel) {
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return 'none';
    const r = sel.getRangeAt(0);
    const sc = r.startContainer, ec = r.endContainer;
    const sId = (sc && sc.nodeType === 1 ? sc.id : '') || (sc && sc.nodeType === 3 ? ('t#' + sc.parentNode.id) : '');
    return (sId || sc) + ':' + r.startOffset + '-' + (ec || '') + ':' + r.endOffset;
  }

  /* 评估当前选区，决定悬浮工具栏显隐并锚定
   * @param {Element} wys #ed-wysiwyg 容器
   * @param {HTMLDivElement} tool 工具栏容器
   * @returns {boolean} 是否显示
   * 作者: 火 冰 */
  function evalWysSelToolbar(wys, tool) {
    if (!wys || !tool) { return false; }
    // 源码模式 / 编辑区隐藏时不显示
    if (wys.hidden) { hideWysSelToolbar(tool); return false; }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed || !sel.toString()) {
      hideWysSelToolbar(tool); return false;
    }
    // 选择必须落在 #ed-wysiwyg 内，且不落在特殊块（PRE/BLOCKQUOTE/TABLE/HR/.sb-math）
    const r = sel.getRangeAt(0);
    const sc = r.startContainer, ec = r.endContainer;
    let inWys = false;
    for (let n = (sc.nodeType === 3 ? sc.parentNode : sc); n && n !== document; n = n.parentNode) {
      if (n === wys) { inWys = true; break; }
    }
    if (!inWys) { hideWysSelToolbar(tool); return false; }
    if (sc.nodeType === 1) {
      if (sc.closest && sc.closest('pre, blockquote, table, hr, .sb-math')) { hideWysSelToolbar(tool); return false; }
    } else if (sc.parentNode && sc.parentNode.closest && sc.parentNode.closest('pre, blockquote, table, hr, .sb-math')) {
      hideWysSelToolbar(tool); return false;
    }
    // 去抖：选区未变化且已显示则仅重锚
    const sig = wysSelSignature(sel);
    if (tool.__sig === sig && !tool.hidden) { anchorWysSelToolbar(wys, tool); return true; }
    tool.__sig = sig;
    showWysSelToolbar(wys);
    return true;
  }

  /* 绑定 #ed-wysiwyg 的选中文本悬浮工具栏：绑定选区监测事件，返回单例工具栏。
   * 可测：注入本文件后在 jsdom 中调用，返回 #wys-sel-tool。
   * @param {Element} wys #ed-wysiwyg 容器
   * @returns {HTMLDivElement} #wys-sel-tool 工具栏容器
   * 作者: 火 冰 */
  function bindWysSelToolbar(wys) {
    if (!wys) return null;
    if (wys.getAttribute('data-wys-sel-tool')) return document.getElementById('wys-sel-tool');
    wys.setAttribute('data-wys-sel-tool', '1');
    const tool = ensureWysSelToolbar();
    // RAF 合并 selectionchange/mouseup/keyup，避免高频重绘
    let rafQueued = false;
    const evalTool = function () {
      if (rafQueued) return;
      rafQueued = true;
      (window.requestAnimationFrame || function (fn) { fn(); })(function () {
        rafQueued = false;
        evalWysSelToolbar(wys, tool);
      });
    };
    document.addEventListener('selectionchange', evalTool);
    wys.addEventListener('mouseup', evalTool);
    wys.addEventListener('keyup', evalTool);
    // 工具栏外部 mousedown：收起（点工具栏内已 stopPropagation，不影响）
    document.addEventListener('mousedown', function (e) {
      if (!tool.contains(e.target)) hideWysSelToolbar(tool);
    });
    // 滚动时重锚/隐藏
    document.addEventListener('scroll', function () {
      if (!tool.hidden) anchorWysSelToolbar(wys, tool);
    }, { capture: true, passive: true });
    // Esc 收起
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideWysSelToolbar(tool);
    });
    return tool;
  }