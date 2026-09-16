/* ============================================
 * 第二脑 — AI 问答
 * 作者: 火 冰
 * 功能: 会话列表、消息流式渲染、来源展开与发送逻辑
 * ============================================ */

'use strict';


  /* ============================
   * AI 问答视图交互
   * ============================ */

  let aiSessions = [];           // 会话列表 [{id, title, history:[{role, content, model, firstTokenMs, totalMs, stopped}]}]
  let aiActiveSessionId = null;  // 当前活动会话 id
  let aiCurGroupEl = null;       // 当前问答组容器（一组 = 一次完整问答：user 提问 + 其后的 assistant 回答）
  let aiRetrieveMs = 0;          // 本次问答检索上下文耗时（毫秒，由引擎 ask 返回；开发者模式下展示）

  /** 读取「开发者模式」开关（设置-常规-通用，持久化于 localStorage note-app:settings.devMode）。
   *  开启时：AI 问答显示 检索时长/首token/每秒token 与资料相关度，并自动打印完整提示词。
   * @returns {boolean} 是否开启开发者模式
   * @author 火 冰 */
  function aiDevMode() {
    try {
      return !!(JSON.parse(localStorage.getItem('note-app:settings') || '{}').devMode);
    } catch (e) { return false; }
  }

  /** 会话持久化 IO：仅在桌面桥可用（具备 listSessions 等）时返回 ai 对象，网页版降级为内存态。
   * @returns {{saveSession:Function, deleteSession:Function, listSessions:Function, readSession:Function, getActiveSession:Function}|null}
   * @author 火 冰 */
  function aiSessionIO() {
    const ai = window.noteDesktop && window.noteDesktop.ai;
    return (ai && typeof ai.saveSession === 'function' && typeof ai.listSessions === 'function') ? ai : null;
  }

  /** 持久化单个会话到磁盘（含 id/title/history）；非桌面桥静默跳过。
   * @param {object} s 会话对象 {id,title,history}
   * @author 火 冰 */
  function aiPersistSession(s) {
    const io = aiSessionIO();
    if (!io || !s || !s.id) return;
    io.saveSession({ id: s.id, title: s.title || '', history: s.history || [] }).catch(function () {});
  }

  /** 记录最近活动会话 id（写 active.json）。
   * @param {string} id 会话 id
   * @author 火 冰 */
  function aiMarkActive(id) {
    const io = aiSessionIO();
    if (!io || !id) return;
    io.saveSession({ id: id, active: true }).catch(function () {});
  }

  /** 删除会话磁盘文件。
   * @param {string} id 会话 id
   * @author 火 冰 */
  function aiDeletePersist(id) {
    const io = aiSessionIO();
    if (!io || !id) return;
    io.deleteSession(id).catch(function () {});
  }

  /** 后台运行恢复：切走再切回时重建进行中的助手气泡，使后续 ai.token 能渲染到新节点。
   * @author 火 冰 */
  function aiRebuildGeneratingBubble() {
    const chat = document.getElementById('ai-chat');
    if (!aiGenerating || !chat) return;
    aiCurBubble = aiAddMessage('assistant', aiCurText || '…');
    const md = aiCurBubble && aiCurBubble.querySelector('.ai-md');
    if (md) md.innerHTML = renderMarkdown(aiCurText || '');
    chat.scrollTop = chat.scrollHeight;
  }

  /** 启动时从 .session 恢复会话：加载列表，定位上次活动或最近会话并整读渲染；异步完成后刷新 UI。
   *  无持久化能力（网页版）或目录为空/失败时回落为新建空会话。
   * @author 火 冰 */
  function aiRestoreSessions() {
    const io = aiSessionIO();
    if (!io) { if (!aiSessions.length) aiNewSession(); renderSessionSidebar(); renderSessionChat(aiActiveSession()); return; }
    io.listSessions().then(function (list) {
      return io.getActiveSession().then(function (activeId) {
        list = list || [];
        let pick = list.find(function (x) { return x.id === activeId; });
        if (!pick && list.length) pick = list[0];
        const reads = list.map(function (x) {
          return io.readSession(x.id).then(function (full) {
            return (full && full.id)
              ? { id: full.id, title: full.title || x.title, history: Array.isArray(full.history) ? full.history : [] }
              : null;
          });
        });
        return Promise.all(reads).then(function (fulls) {
          aiSessions = fulls.filter(Boolean);
          if (!aiSessions.length) { aiNewSession(); }
          else {
            aiActiveSessionId = (pick && pick.id) || aiSessions[0].id;
            if (!aiSessions.some(function (s) { return s.id === aiActiveSessionId; })) aiActiveSessionId = aiSessions[0].id;
          }
          renderSessionSidebar();
          renderSessionChat(aiActiveSession());
          aiRebuildGeneratingBubble();
          aiUpdateSendButton();
          refreshIcons();
        });
      });
    }).catch(function () {
      if (!aiSessions.length) aiNewSession();
      renderSessionSidebar();
      renderSessionChat(aiActiveSession());
      aiRebuildGeneratingBubble();
      aiUpdateSendButton();
      refreshIcons();
    });
  }
  let aiGenerating = false;      // 是否正在生成
  let aiCurBubble = null;        // 当前流式输出的助手气泡元素
  let aiCurText = '';            // 当前流式文本缓冲
  let aiStatusTimer = null;
  let aiStopFlag = false;        // 是否主动打断了本次生成（区分「停止」与「出错」）
  let aiT0 = 0;                  // 本次生成开始时间戳（计算首 token 与总耗时）
  let aiFirstMs = null;          // 首 token 耗时（毫秒），首次 token 到达时记录
  let aiCurModel = '';           // 本次生成使用的模型显示名
  let aiTokCount = 0;            // 本次生成累计 token 数（onToken 调用次数：Ollama 每 chunk 一个 token）
  let aiTokLastUi = 0;           // 上次刷新速率 UI 的时间戳（节流 ~500ms，避免每 token 重绘状态栏）

  /** 设置顶部状态徽标（文本 + 指示点颜色） */
  function aiSetStatus(text, color) {
    const t = document.getElementById('ai-status-text');
    const d = document.getElementById('ai-status-dot');
    if (t) t.textContent = text;
    if (d) d.style.background = color || 'var(--note-ink-3)';
  }

  /** 渲染空态引导 */
  function aiRenderEmpty() {
    const chat = document.getElementById('ai-chat');
    if (!chat) return;
    chat.innerHTML = '<div class="h-full flex flex-col items-center justify-center gap-3 text-center px-6">'
      + '<div class="w-14 h-14 rounded-2xl flex items-center justify-center" style="background: rgba(124,58,237,0.12);"><i data-lucide="brain" class="w-7 h-7" style="color: var(--note-brand-400);"></i></div>'
      + '<div class="text-[15px] font-semibold" style="color: var(--note-ink);">输入问题，从你的笔记库中寻找答案</div>'
      + '<div class="text-[12px] max-w-sm leading-relaxed" style="color: var(--note-ink-3);">首次使用请先点击右上角「重建索引」，把笔记库向量化后再提问，回答会附带可点击的检索来源。</div>'
      + '</div>';
    refreshIcons();
  }

  /** 新建一个空会话并设为当前，返回会话对象 */
  function aiNewSession() {
    const s = { id: 's' + Date.now(), title: '新会话', history: [] };
    aiSessions.unshift(s);
    aiActiveSessionId = s.id;
    aiCurGroupEl = null;
    aiMarkActive(s.id);
    renderSessionSidebar();
    return s;
  }

  /** 获取当前活动会话对象（无会话时自动新建一个） */
  function aiActiveSession() {
    let s = aiSessions.find(function (x) { return x.id === aiActiveSessionId; });
    if (!s) s = aiNewSession();
    return s;
  }

  /** 渲染会话列表侧栏（标题 + 活跃高亮 + 悬浮删除） */
  function renderSessionSidebar() {
    const list = document.getElementById('ai-session-list');
    const count = document.getElementById('ai-session-count');
    if (count) count.textContent = aiSessions.length ? String(aiSessions.length) : '';
    if (!list) return;
    list.innerHTML = '';
    if (!aiSessions.length) {
      list.innerHTML = '<div class="px-3 py-6 text-center text-[12px]" style="color: var(--note-ink-3);">暂无会话<br>发送问题将自动新建</div>';
      return;
    }
    aiSessions.forEach(function (s) {
      const active = s.id === aiActiveSessionId;
      const row = document.createElement('div');
      row.className = 'group flex items-center gap-2 mx-1.5 my-0.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors' + (active ? '' : ' hover:opacity-85');
      row.style.cssText = (active ? 'background: rgba(124,58,237,0.14); color: var(--note-brand-400);' : 'color: var(--note-ink-2);');
      const icon = document.createElement('i');
      icon.className = 'w-3.5 h-3.5 shrink-0';
      icon.dataset.lucide = 'message-circle';
      icon.style.cssText = 'color: var(--note-ink-3);';
      const label = document.createElement('span');
      label.className = 'text-[12px] truncate flex-1';
      label.textContent = s.title;
      const del = document.createElement('button');
      del.className = 'w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity shrink-0';
      del.style.cssText = 'color: var(--note-ink-3);';
      del.title = '删除会话';
      del.innerHTML = '<i data-lucide="x" class="w-3 h-3"></i>';
      del.addEventListener('click', function (e) {
        e.stopPropagation();
        removeSession(s.id);
      });
      row.appendChild(icon);
      row.appendChild(label);
      row.appendChild(del);
      row.addEventListener('click', function () {
        aiActiveSessionId = s.id;
        aiMarkActive(s.id);
        renderSessionSidebar();
        renderSessionChat(s);
      });
      list.appendChild(row);
    });
    refreshIcons();
  }

  /** 删除指定会话；若删除的是当前会话则切换到剩余首个或新建空会话 */
  function removeSession(id) {
    const ai = window.noteDesktop && window.noteDesktop.ai;
    const idx = aiSessions.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    if (aiGenerating) { if (ai) ai.stop(); aiGenerating = false; aiCurBubble = null; aiCurText = ''; aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false; aiUpdateSendButton(); }
    aiSessions.splice(idx, 1);
    aiDeletePersist(id);
    aiCurGroupEl = null;
    if (aiActiveSessionId === id) {
      const next = aiSessions[0] || aiNewSession();
      aiActiveSessionId = next.id;
      aiMarkActive(next.id);
      renderSessionChat(next);
    }
    renderSessionSidebar();
  }

  /** 渲染某个会话的完整历史对话（来源片段不持久化，不在此重绘） */
  function renderSessionChat(session) {
    const chat = document.getElementById('ai-chat');
    if (!chat) return;
    chat.innerHTML = '';
    aiCurGroupEl = null;
    if (!session.history.length) { aiRenderEmpty(); return; }
    session.history.forEach(function (m) { aiAddMessage(m.role, m.content, m); });
    // 重绘后刷新 lucide 图标（组删除按钮等新插入的 data-lucide 依赖 createIcons 替换）
    refreshIcons();
    chat.scrollTop = chat.scrollHeight;
  }

  /** 新建一个问答组容器（一组 = 一次完整问答）。删除按钮随用户消息气泡创建（对齐气泡中心线）。
   * @returns {HTMLElement} 组容器元素
   * @author 火 冰 */
  function aiCreateGroup() {
    const chat = document.getElementById('ai-chat');
    if (!chat) return null;
    const g = document.createElement('div');
    g.className = 'ai-qa-group relative group';
    chat.appendChild(g);
    return g;
  }

  /** 按组删除：删除第 gidx 组（组序号按 DOM 中 .ai-qa-group 顺序），即该组 user 提问
   * 及其后直到下一个 user 之前的所有 assistant 回答；删除后持久化并重绘。
   * @param {HTMLElement} g 组容器元素
   * @author 火 冰 */
  function aiRemoveGroup(g) {
    const chat = document.getElementById('ai-chat');
    if (!g || !chat || !g.parentElement) return;
    const s = aiActiveSession();
    if (!s) return;
    const groups = chat.querySelectorAll('.ai-qa-group');
    const gidx = Array.prototype.indexOf.call(groups, g);
    if (gidx < 0) return;
    // 定位该组在 history 中的区间：[start, end)，end = 下一个 user 或数组末尾
    let start = -1, seen = 0, i;
    for (i = 0; i < s.history.length; i++) {
      if (s.history[i].role === 'user') {
        if (seen === gidx) { start = i; break; }
        seen++;
      }
    }
    if (start < 0) return;
    let end = s.history.length;
    for (i = start + 1; i < s.history.length; i++) {
      if (s.history[i].role === 'user') { end = i; break; }
    }
    // 删除的若是生成中的组，先停止（stop 后 aiFinish 因 aiCurText 已清空不会再写历史）
    if (aiGenerating && aiCurGroupEl === g) {
      const ai = window.noteDesktop && window.noteDesktop.ai;
      if (ai) ai.stop();
      aiGenerating = false; aiCurBubble = null; aiCurText = ''; aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false; aiUpdateSendButton();
    }
    s.history.splice(start, end - start);
    if (aiCurGroupEl === g) aiCurGroupEl = null;
    aiPersistSession(s);
    renderSessionChat(s);
    aiRebuildGeneratingBubble();
    aiSetStatus('已删除本组问答', 'var(--note-ink-3)');
    // 提示短暂展示后恢复默认状态（避免徽标一直残留「已删除」）
    if (!aiGenerating) {
      setTimeout(function () { aiSetStatus('就绪', 'var(--state-success)'); }, 2000);
    }
  }

  /** 追加一条消息气泡（user 右对齐 / assistant 左对齐）；meta 为助手消息附带统计信息（模型/首token时长/总耗时/打断标记）。
   *  消息按「问答组」归组：user 开启新组，assistant 归入当前组。 */
  function aiAddMessage(role, text, meta) {
    const chat = document.getElementById('ai-chat');
    if (!chat) return;
    const empty = chat.querySelector('.h-full');
    if (empty) chat.innerHTML = '';
    // 分组：user 开启新组；assistant 归入当前组（无组则补建，兜底异常数据）
    let g = aiCurGroupEl;
    if (role === 'user' || !g || !g.parentElement) {
      g = aiCreateGroup();
      aiCurGroupEl = g;
    }
    const isUser = role === 'user';
    const wrap = document.createElement('div');
    // 右内边距 pr-8 为右侧删除图标留出空间；用户消息 wrap 内嵌删除按钮（相对定位）
    wrap.className = 'flex ' + (isUser ? 'justify-end' : 'justify-start') + ' py-2.5 pl-5 pr-8' + (isUser ? ' relative group' : '');
    const bubble = document.createElement('div');
    bubble.className = 'max-w-[78%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm';
    if (isUser) {
      bubble.style.cssText = 'background: var(--note-brand-600); color: #FFFFFF; border-top-right-radius: 4px; white-space: pre-wrap; word-break: break-word;';
      bubble.textContent = text;
      // 删除按钮：悬浮到气泡上显示，始终红色，垂直中心线与本组绿色气泡中心对齐（right-1 位于气泡右内边距留出的空隙）
      const del = document.createElement('button');
      del.className = 'ai-del-btn flex items-center justify-center w-6 h-6 rounded-md transition-colors opacity-0 group-hover:opacity-100 absolute right-1 top-1/2 -translate-y-1/2';
      del.style.cssText = 'color: #ef4444; background: transparent;';
      del.title = '删除本组问答';
      del.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
      del.addEventListener('click', function (e) { e.stopPropagation(); aiRemoveGroup(g); });
      wrap.appendChild(del);
    } else {
      bubble.style.cssText = 'background: var(--note-surface-2); color: var(--note-ink); border: 1px solid var(--note-border); border-top-left-radius: 4px;';
      bubble.innerHTML = '<div class="ai-md">' + renderMarkdown(text) + '</div>';
      if (meta && meta.model) aiAppendMeta(bubble, meta);
    }
    wrap.appendChild(bubble);
    if (g) g.appendChild(wrap); else chat.appendChild(wrap);
    chat.scrollTop = chat.scrollHeight;
    return bubble;
  }

  /** 生成中切换发送按钮为「停止」、空闲为「发送」 */
  function aiUpdateSendButton() {
    const btn = document.querySelector('[data-ai="send"]');
    if (!btn) return;
    const span = btn.querySelector('span') || btn;
    span.textContent = aiGenerating ? '停止' : '发送';
    btn.title = aiGenerating ? '停止生成（打断）' : '发送（Enter）';
  }

  /** 在助手气泡尾部追加回答统计行（检索时长 / 首 token / 总耗时 / 每秒 tokens / 打断标记）。
   *  仅「开发者模式」开启时展示（非开发者模式为普通用户隐藏调试统计）。 */
  function aiAppendMeta(bubble, meta) {
    if (!bubble || !meta) return;
    if (!aiDevMode()) return;   // 非开发者模式：隐藏回答统计行
    const parts = [];
    if (meta.model) parts.push('模型 ' + esc(meta.model));
    // 首 token 拆分为「检索时长」与「真正的首 token」：检索检索上下文所耗，首token 为剔除检索后的首个 token 生成耗时
    const retrieveSec = meta.retrieveMs != null ? meta.retrieveMs / 1000 : null;
    if (retrieveSec != null) parts.push('检索 ' + retrieveSec.toFixed(2) + 's');
    if (meta.firstTokenMs != null) {
      let first = meta.firstTokenMs / 1000;
      if (meta.retrieveMs != null) first = Math.max(0, first - meta.retrieveMs / 1000);
      parts.push('首token ' + first.toFixed(2) + 's');
    }
    if (meta.totalMs != null) parts.push('总耗时 ' + (meta.totalMs / 1000).toFixed(1) + 's');
    if (meta.tokens && meta.tokSec > 0) parts.push((meta.tokens / meta.tokSec).toFixed(1) + ' tok/s');
    if (meta.stopped) parts.push('已打断');
    if (!parts.length) return;
    const div = document.createElement('div');
    div.className = 'mt-2 text-[10.5px] nums';
    div.style.cssText = 'color: var(--note-ink-3);';
    div.textContent = parts.join(' · ');
    bubble.appendChild(div);
  }

  /** 回答完成的统一出口：把结果/部分结果与统计写入会话历史，并在气泡尾部展示统计（onDone / 主动打断共用） */
  function aiFinish(stopped, sources) {
    aiGenerating = false;
    const totalMs = aiT0 ? (Date.now() - aiT0) : 0;
    const text = aiCurText;
    if (text) {
      const sess = aiActiveSession();
      sess.history.push({
        role: 'assistant', content: text,
        model: aiCurModel, firstTokenMs: aiFirstMs, totalMs: totalMs, retrieveMs: aiRetrieveMs, stopped: !!stopped,
      });
      aiPersistSession(sess);
    }
    if (aiCurBubble) {
      const tokSec = totalMs ? (totalMs / 1000) : 0;
      aiAppendMeta(aiCurBubble, { model: aiCurModel, firstTokenMs: aiFirstMs, totalMs: totalMs, retrieveMs: aiRetrieveMs, tokens: aiTokCount, tokSec: tokSec, stopped: !!stopped });
      aiRenderSources(aiCurBubble, sources || []);
      aiSetStatus(stopped ? '已停止' : (text ? '就绪' : '无回答'), stopped ? 'var(--warning)' : (text ? 'var(--state-success)' : 'var(--state-danger)'));
    }
    aiCurText = '';
    aiCurBubble = null;
    aiCurModel = '';
    aiFirstMs = null;
    aiT0 = 0;
    aiRetrieveMs = 0;
    aiStopFlag = false;
    refreshIcons();
    aiUpdateSendButton();
  }

  /** 关闭「查看索引块」弹窗（若无则空操作）。
   * @author 火 冰 */
  function closeAiSourceModal() {
    const m = document.getElementById('ai-source-modal');
    if (m) m.remove();
  }

  /** 弹出「查看索引块完整内容」弹窗：覆盖层 + 居中卡片，pre 展示 fullText（纯文本防注入）。
   *  仅供开发者模式下的参考资料「查看近内容」按钮调用。
   * @param {{path:string,fullText:string,text:string}} s 来源项（含完整块文本）
   * @author 火 冰 */
  function aiShowSourceModal(s) {
    closeAiSourceModal();
    const overlay = document.createElement('div');
    overlay.id = 'ai-source-modal';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:200;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,0.6);backdrop-filter:blur(3px);';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeAiSourceModal(); });
    const card = document.createElement('div');
    card.style.cssText = 'max-width:720px;width:100%;max-height:80vh;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;background:var(--note-surface-2, var(--note-bg));border:1px solid rgba(255,255,255,0.16);box-shadow:0 10px 40px rgba(0,0,0,0.5);';
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.04);';
    head.innerHTML = (s.sim != null
        ? '<span class="text-[10px] nums px-1.5 py-0.5 rounded shrink-0" style="background:rgba(124,58,237,0.16);color:var(--note-brand-400);">相关度 ' + (s.sim * 100).toFixed(0) + '%</span>'
        : '')
      + '<span class="flex-1 text-[12px] truncate" style="color:var(--note-ink);">索引块 · ' + esc(s.path || '') + '</span>'
      + '<button data-ai-close class="w-6 h-6 flex items-center justify-center rounded hover:opacity-80" style="color:var(--note-ink-3);"><i data-lucide="x" class="w-4 h-4"></i></button>';
    const body = document.createElement('pre');
    body.style.cssText = 'flex:1;overflow:auto;padding:14px 16px;margin:0;font-family:var(--font-mono,monospace);font-size:12px;line-height:1.7;white-space:pre-wrap;word-break:break-word;color:var(--note-ink);background:rgba(255,255,255,0.03);';
    body.textContent = s.fullText || s.text || '';
    card.appendChild(head);
    card.appendChild(body);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    const closeBtn = overlay.querySelector('[data-ai-close]');
    if (closeBtn) closeBtn.addEventListener('click', closeAiSourceModal);
    refreshIcons();
  }

  function aiRenderSources(container, sources) {
    if (!sources || !sources.length) return;
    // 相关度分数 + 「查看完整索引块」按钮仅「开发者模式」展示（普通用户只看到来源列表，不暴露调试数值）
    const showSim = aiDevMode();
    const box = document.createElement('div');
    box.className = 'mt-3 pt-2.5 border-t';
    box.style.cssText = 'border-color: var(--note-border);';
    const head = document.createElement('div');
    head.className = 'text-[10px] font-semibold uppercase tracking-wider mb-1.5';
    head.style.cssText = 'color: var(--note-ink-3);';
    head.textContent = '来源 · ' + sources.length + ' 条';
    box.appendChild(head);
    sources.forEach(function (s) {
      const item = document.createElement('div');
      item.className = 'flex items-center gap-2 py-1 cursor-pointer hover:opacity-80';
      item.title = '打开 ' + s.path;
      item.addEventListener('click', function () {
        if (!s.path) return;
        window.__openGraphPath = s.path;
        location.hash = '#/editor';
      });
      item.innerHTML = '<i data-lucide="file-text" class="w-3 h-3 shrink-0" style="color: var(--note-brand-400);"></i>'
        + '<span class="text-[11.5px] truncate flex-1" style="color: var(--note-ink-2);">' + esc(s.path) + '</span>'
        + (showSim ? '<button data-ai-view-src title="查看完整索引块" class="w-4 h-4 flex items-center justify-center rounded hover:opacity-80 shrink-0" style="color:var(--note-ink-3);"><i data-lucide="stretch-horizontal" class="w-3 h-3"></i></button>' : '')
        + (showSim ? '<span class="text-[10px] nums px-1 py-0.5 rounded" style="background: rgba(124,58,237,0.12); color: var(--note-brand-400);">' + (s.sim != null ? (s.sim * 100).toFixed(0) + '%' : '') + '</span>' : '');
      const vbtn = item.querySelector('[data-ai-view-src]');
      if (vbtn) vbtn.addEventListener('click', function (e) { e.stopPropagation(); aiShowSourceModal(s); });
      box.appendChild(item);
    });
    refreshIcons();
    container.appendChild(box);
  }

  /** 发送问题：追加消息 → 流式接收回答 */
  function aiSend() {
    const input = document.getElementById('ai-input');
    const ai = window.noteDesktop && window.noteDesktop.ai;
    if (!input || !ai || aiGenerating) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    aiAutoResize();
    aiAddMessage('user', q);
    const s = aiActiveSession();
    s.history.push({ role: 'user', content: q });
    if (s.title === '新会话') { s.title = q.length > 20 ? q.slice(0, 20) + '…' : q; renderSessionSidebar(); }
    aiPersistSession(s);
    aiGenerating = true;
    aiStopFlag = false;
    aiT0 = Date.now();
    aiFirstMs = null;
    aiTokCount = 0;      // 本次生成 token 计数复位（每次发送清零，残留不影响）
    aiTokLastUi = 0;
    aiRetrieveMs = 0;    // 本次检索耗时复位
    const modelSel = document.getElementById('ai-model');
    const modelOpt = modelSel && modelSel.selectedOptions && modelSel.selectedOptions[0];
    aiCurModel = (modelOpt && modelOpt.textContent ? modelOpt.textContent.trim() : '').replace(/^加载模型…$/, '');
    // 发送时携带下拉选中的模型 id（可为 avail: 临时 id，引擎从可用模型缓存构造）；未选则引擎用 currentModel
    const modelId = (modelSel && modelSel.value) ? modelSel.value : '';
    aiCurText = '';
    aiCurBubble = aiAddMessage('assistant', '…');
    aiSetStatus('生成中', 'var(--note-brand-400)');
    aiUpdateSendButton();
    // 当前选中的 Agent id（无配置/未选中时为空串 → 引擎走默认助手）
    const agentSel = document.getElementById('ai-agent');
    const agentId = (agentSel && agentSel.value) ? agentSel.value : '';
    // 顶栏「携带历史数据」开关：关闭时每轮只发送当前问题（不带上文对话历史）
    const carryEl = document.getElementById('ai-carry-history');
    const carry = (carryEl && !carryEl.checked) ? [] : s.history.slice(0, -1);
    // 当前是否开发者模式：开启时引擎自动打印完整提示词（调试用）
    const dev = aiDevMode();
    ai.ask(q, carry, agentId, modelId, dev).catch(function () { /* 错误经 ai:ask-error 事件处理 */ });
  }

  /** 输入框高度自适应 */
  function aiAutoResize() {
    const input = document.getElementById('ai-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  /** 初始化 AI 问答视图 */
  function initAi() {
    const ai = window.noteDesktop && window.noteDesktop.ai;
    const chat = document.getElementById('ai-chat');
    const input = document.getElementById('ai-input');
    if (!ai || !chat || !input) return;

    // 流式回调：token 逐字追加到当前助手气泡；首 token 到达时记录耗时
    ai.onToken(function (t) {
      if (!aiCurBubble) return;
      if (aiFirstMs === null) aiFirstMs = Date.now() - aiT0;
      aiTokCount += 1;
      aiCurText += t;
      const md = aiCurBubble.querySelector('.ai-md');
      if (md) md.innerHTML = renderMarkdown(aiCurText);
      chat.scrollTop = chat.scrollHeight;
      // 实时速率：生成中节流（~500ms）更新顶部状态为「生成中 · X.X tok/s」
      const now = Date.now();
      if (now - aiTokLastUi >= 500) {
        aiTokLastUi = now;
        const sec = (now - aiT0) / 1000;
        if (sec > 0) aiSetStatus('生成中 · ' + (aiTokCount / sec).toFixed(1) + ' tok/s', 'var(--note-brand-400)');
      }
    });
    // 回答完成：先记录检索耗时，再统一走 aiFinish 写入历史与统计（检索时长供开发者模式拆分首token）
    ai.onDone(function (p) {
      if (p && typeof p.retrieveMs === 'number') aiRetrieveMs = p.retrieveMs;
      aiFinish(false, (p && p.sources) || []);
    });
    // 回答出错：若为主动打断（aiStopFlag=true）则走 aiFinish（视为完成，保留已生成内容并记统计）；否则按错误渲染
    ai.onError(function (err) {
      if (aiStopFlag) { aiFinish(true); return; }
      aiGenerating = false;
      const msg = (err && err.message) || '未知错误';
      aiSetStatus('出错', 'var(--state-danger)');
      // 失败落盘（日志面板 + userData/logs/app.log），便于定位连续失败原因
      if (window.SBLog) window.SBLog.error('AI 问答失败: ' + msg);
      if (aiCurBubble) {
        aiCurBubble.innerHTML = '<div class="ai-md"><p style="color: var(--note-ink-2);">回答失败：' + esc(msg) + '</p></div>';
      }
      aiCurText = ''; aiCurBubble = null;
      aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false;
      refreshIcons();
      aiUpdateSendButton();
    });
    // 索引重建进度
    ai.onProgress(function (p) {
      if (p && p.total) aiSetStatus('索引中 ' + p.done + '/' + p.total, 'var(--note-brand-400)');
    });

    // 恢复/初始化状态
    ai.getStatus().then(function (st) {
      if (!st) return;
      if (st.chunks > 0) {
        aiSetStatus('已就绪 · ' + st.chunks + ' 片段', 'var(--state-success)');
      } else if (st.embeddingLoaded) {
        aiSetStatus('待重建索引', 'var(--warning)');
      } else {
        aiSetStatus('待加载模型', 'var(--note-ink-3)');
      }
    }).catch(function () {});

    // 模型选择器（底部输入区）：已配置可用模型 + 全局「可用模型」缓存实时合并填充，切换保存 currentModelId
    const modelSel = document.getElementById('ai-model');
    if (modelSel && ai.listModels) {
      const fillModels = function (data) {
        const configured = (data && data.models) || [];
        // 已配置且可用（远程 OpenAI 始终可用；本地 Ollama 仅运行中）
        const running = configured.filter(function (m) { return m.running; });
        const byName = {};
        running.forEach(function (m) { byName[m.model] = true; });
        const all = running.slice();
        const renderOptions = function (list) {
          if (!modelSel) return;
          modelSel.innerHTML = '';
          if (!list.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = all.length ? '暂无可用模型 · 请先加载' : '暂无模型 · 去设置添加';
            modelSel.appendChild(opt);
            return;
          }
          list.forEach(function (m) {
            const o = document.createElement('option');
            o.value = m.id;
            o.textContent = m.model;
            o.title = (m.provider === 'openai' ? '远程大模型' : '本地 Ollama') + ' · ' + m.model + (m.avail ? '（已加载到内存）' : '');
            modelSel.appendChild(o);
          });
          // 当前所选模型不可用且不在列表时回落首个
          const cur = (data && data.currentModelId) || '';
          modelSel.value = list.some(function (x) { return x.id === cur; }) ? cur : list[0].id;
        };
        // 先立即渲染已配置且运行中的模型（本地 Ollama 运行中即显示，不依赖「运行状态」IPC），
        // 再异步合并「已加载到内存」的模型：从引擎运行状态缓存（/api/ps 后台轮询）取所有运行中模型，
        // 未配置但已加载的也进下拉（avail: 临时 id，发送时引擎从可用模型缓存构造）
        renderOptions(all);
        if (ai.getRunningMap) {
          ai.getRunningMap().then(function (rm) {
            Object.keys(rm || {}).forEach(function (k) {
              const i = k.indexOf('\u0000');
              const baseUrl = i >= 0 ? k.slice(0, i) : k;
              const name = i >= 0 ? k.slice(i + 1) : '';
              if (!name || byName[name]) return;
              byName[name] = true;
              all.push({ id: 'avail:' + baseUrl + ':ollama:' + name, model: name, provider: 'ollama', avail: true });
            });
            renderOptions(all);
          }).catch(function () { /* 运行状态缓存不可达：保留已渲染的配置运行中模型 */ });
        }
      };
      const refreshOnce = function () { ai.listModels().then(fillModels).catch(function () { /* 网络失败静默 */ }); };
      refreshOnce();
      // 钩子实时刷新：主进程每次轮询/手动刷新完成后推送 ai:models-updated 事件，页面立即重刷下拉（类似 Vue 响应式，不等 5 秒兜底）
      if (ai.onModelsUpdated) ai.onModelsUpdated(function () { if (document.getElementById('ai-model')) refreshOnce(); });
      // 全局实时同步：每 5 秒刷新一次下拉（问答页挂载时；生成中不打断选择）
      if (!window.__aiModelSyncTimer) {
        window.__aiModelSyncTimer = setInterval(function () {
          if (document.getElementById('ai-model') && !aiGenerating) refreshOnce();
        }, 5000);
      }
      modelSel.addEventListener('change', function () {
        const id = modelSel.value;
        if (!id) return;
        ai.saveConfig({ currentModelId: id }).then(function (cfg) {
          const m = ((cfg && cfg.models) || []).find(function (x) { return x.id === id; });
          aiSetStatus('已切换 · ' + (m ? m.model : ''), 'var(--state-success)');
        }).catch(function () {});
      });
    }

    // Agent 选择器（顶部工具栏）：从配置的 agents 列表填充（value=agent id），切换保存 currentAgentId
    // （默认「知识库助手」由引擎内置兜底，agents 列表为空时仍可用）
    const agentSel = document.getElementById('ai-agent');
    if (agentSel && ai.getConfig) {
      ai.getConfig().then(function (cfg) {
        const agents = ((cfg && cfg.agents) || []).slice();
        agentSel.innerHTML = agents.map(function (a) {
          return '<option value="' + esc(a.id) + '">' + esc(a.name || '未命名') + '</option>';
        }).join('');
        const cur = (cfg && cfg.currentAgentId) || '';
        if (agents.some(function (x) { return x.id === cur; })) agentSel.value = cur;
      }).catch(function () {});
      agentSel.addEventListener('change', function () {
        const id = agentSel.value;
        const name = agentSel.selectedOptions && agentSel.selectedOptions[0]
          ? agentSel.selectedOptions[0].textContent : '';
        ai.saveConfig({ currentAgentId: id }).then(function () {
          aiSetStatus('已切换 · ' + (name || '知识库助手'), 'var(--state-success)');
        }).catch(function () {});
      });
    }

    // 「携带历史数据」开关（顶栏）：回填 cfg.carryHistory（默认携带），切换即持久化
    const carryEl = document.getElementById('ai-carry-history');
    if (carryEl && ai.getConfig) {
      ai.getConfig().then(function (cfg) {
        carryEl.checked = cfg.carryHistory !== false;
      }).catch(function () {});
      carryEl.addEventListener('change', function () {
        ai.saveConfig({ carryHistory: carryEl.checked }).then(function () {
          aiSetStatus(carryEl.checked ? '已开启：携带历史数据' : '已关闭：每轮仅发送当前问题', 'var(--state-success)');
        }).catch(function () {});
      });
    }

    // 顶栏「相关度阈值」：回填当前配置，变更即保存（低于该值的索引块不作为参考资料）
    const minSimEl = document.getElementById('ai-min-sim');
    if (minSimEl && ai.getConfig) {
      ai.getConfig().then(function (cfg) {
        const v = (cfg && cfg.minSimilarity != null) ? Number(cfg.minSimilarity) : 0;
        minSimEl.value = v;
      }).catch(function () {});
      minSimEl.addEventListener('change', function () {
        const v = Math.max(0, Math.min(100, parseInt(minSimEl.value, 10) || 0));
        minSimEl.value = v;
        ai.saveConfig({ minSimilarity: v }).then(function () {
          aiSetStatus(v > 0 ? '相关度阈值：' + v + '%（低于该值不作为参考资料）' : '相关度阈值：0（不过滤）', 'var(--state-info)');
        }).catch(function () {});
      });
    }

    // 索引库下拉：底部「重建当前知识库」入口（保留原单按钮能力）
    function aiFooterRow() {
      return '<button data-vault-run="rebuild-current" class="w-full mt-1 px-2.5 py-2 rounded-md text-[12px] font-medium transition-colors hover:opacity-90" style="color: var(--note-brand-300);">重建当前知识库索引</button>';
    }

    /* 渲染索引库下拉列表：每个有索引的知识库一行，
     * 目录仍存在 → 「重建」；目录已移除但残留索引 → 「删除」。
     * @author 火 冰 */
    function aiRenderIndexMenu() {
      const body = document.getElementById('ai-index-menu-body');
      if (!body) return;
      const ai = window.noteDesktop && window.noteDesktop.ai;
      if (!ai || !ai.listIndexes) { body.innerHTML = '<div class="px-2 py-3 text-[12px]" style="color:var(--note-ink-3);">当前环境未启用索引</div>'; return; }
      body.innerHTML = '<div class="px-2 py-3 text-[12px]" style="color:var(--note-ink-3);">读取索引库…</div>';
      ai.listIndexes().then(function (list) {
        list = list || [];
        if (!list.length) {
          body.innerHTML = '<div class="px-2 py-3 text-[12px]" style="color:var(--note-ink-3);">索引库为空，暂无已建索引的知识库。</div>'
            + '<div class="mx-2 my-1.5" style="height:1px;background:var(--note-border);"></div>'
            + aiFooterRow();
          return;
        }
        body.innerHTML = list.map(function (it) {
          const name = esc(it.vaultName || '未知知识库');
          const sub = it.exists
            ? '<span class="nums">' + it.blocks + ' 块</span> · ' + new Date(it.builtAt).toLocaleString('zh-CN', { hour12: false })
            : '已从知识库移除 · 残留索引 ' + it.blocks + ' 块';
          const act = it.exists
            ? '<button data-vault-run="rebuild" data-path="' + esc(it.vaultPath) + '" class="shrink-0 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors hover:opacity-90" style="background:var(--note-brand-600);color:#fff;">重建</button>'
            : '<button data-vault-run="delete" data-path="' + esc(it.vaultPath) + '" class="shrink-0 px-2.5 py-1 rounded-md text-[12px] font-medium transition-colors hover:opacity-90" style="background:var(--state-danger);color:#fff;">删除</button>';
          return '<div class="flex items-center gap-2 px-2.5 py-2 rounded-md">'
            + '<div class="flex-1 min-w-0"><div class="truncate text-[12px] font-medium" style="color:var(--note-ink);">' + name + '</div>'
            + '<div class="truncate text-[11px] mt-0.5" style="color:var(--note-ink-3);">' + sub + '</div></div>' + act + '</div>';
        }).join('') + '<div class="mx-2 my-1.5" style="height:1px;background:var(--note-border);"></div>' + aiFooterRow();
        body.querySelectorAll('[data-vault-run]').forEach(function (b) {
          b.addEventListener('click', function (ev) {
            ev.stopPropagation();
            aiVaultAction(b.getAttribute('data-vault-run'), b.getAttribute('data-path') || '');
          });
        });
      }).catch(function () { body.innerHTML = '<div class="px-2 py-3 text-[12px]" style="color:var(--state-danger);">读取索引库失败</div>'; });
    }

    /* 索引库动作：重建指定库 / 删除残留 / 重建当前库
     * @param {string} act 动作类型
     * @param {string} path 目标知识库路径
     * @author 火 冰 */
    function aiVaultAction(act, path) {
      const ai = window.noteDesktop && window.noteDesktop.ai;
      if (!ai) return;
      if (aiGenerating) { ai.stop(); aiGenerating = false; aiCurBubble = null; aiCurText = ''; aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false; aiUpdateSendButton(); }
      if (act === 'delete') {
        if (!window.confirm('确定删除该知识库的残留索引吗？')) return;
        aiSetStatus('正在删除…', 'var(--note-brand-400)');
        ai.deleteIndex(path).then(function (ok) {
          aiSetStatus(ok ? '已删除残留索引' : '未找到索引文件', ok ? 'var(--state-success)' : 'var(--warning)');
          aiRenderIndexMenu();
        }).catch(function () { aiSetStatus('删除失败', 'var(--state-danger)'); });
      } else if (act === 'rebuild') {
        aiSetStatus('正在重建索引…', 'var(--note-brand-400)');
        ai.rebuildIndexFor(path).then(function (r) {
          const n = (r && r.chunks) || 0;
          aiSetStatus(n ? '重建完成 · ' + n + ' 片段' : '索引为空', n ? 'var(--state-success)' : 'var(--warning)');
          aiRenderIndexMenu();
        }).catch(function () { aiSetStatus('重建失败', 'var(--state-danger)'); });
      } else if (act === 'rebuild-current') {
        aiSetStatus('正在重建当前库索引…', 'var(--note-brand-400)');
        ai.rebuildIndex().then(function (r) {
          const n = (r && r.chunks) || 0;
          aiSetStatus(n ? '重建完成 · ' + n + ' 片段' : '索引为空', n ? 'var(--state-success)' : 'var(--warning)');
          aiRenderIndexMenu();
        }).catch(function () { aiSetStatus('重建失败', 'var(--state-danger)'); });
      }
    }

    // 工具栏按钮
    document.querySelectorAll('[data-ai]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const act = btn.dataset.ai;
        if (act === 'new') {
          if (aiGenerating) { ai.stop(); aiGenerating = false; aiCurBubble = null; aiCurText = ''; aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false; }
          aiUpdateSendButton();
          aiNewSession();
          aiRenderEmpty();
          ai.getStatus().then(function (st) {
            aiSetStatus(st && st.chunks > 0 ? '已就绪 · ' + st.chunks + ' 片段' : '待重建索引', st && st.chunks > 0 ? 'var(--state-success)' : 'var(--warning)');
          }).catch(function () {});
        } else if (act === 'rebuild') {
          if (aiGenerating) { ai.stop(); aiGenerating = false; aiCurBubble = null; aiCurText = ''; aiCurModel = ''; aiFirstMs = null; aiT0 = 0; aiStopFlag = false; }
          aiUpdateSendButton();
          aiSetStatus('正在加载嵌入模型…', 'var(--note-brand-400)');
          ai.rebuildIndex().then(function (r) {
            const n = (r && r.chunks) || 0;
            aiSetStatus(n ? '索引完成 · ' + n + ' 片段' : '索引为空', n ? 'var(--state-success)' : 'var(--warning)');
            if (aiStatusTimer) clearTimeout(aiStatusTimer);
            aiStatusTimer = setTimeout(function () { aiSetStatus('已就绪 · ' + n + ' 片段', 'var(--state-success)'); }, 2500);
          }).catch(function (e) {
            aiSetStatus('索引失败', 'var(--state-danger)');
          });
        } else if (act === 'collapse-side') {
          const sidebar = document.getElementById('ai-sidebar');
          const sideOpen = document.getElementById('ai-sidebar-open');
          if (sidebar) sidebar.classList.add('collapsed');
          if (sideOpen) sideOpen.classList.add('show');
        } else if (act === 'index-menu-toggle') {
          const menu = document.getElementById('ai-index-menu');
          if (!menu) return;
          if (menu.style.display === 'none') { menu.style.display = 'block'; aiRenderIndexMenu(); }
          else menu.style.display = 'none';
        } else if (act === 'index-menu-close') {
          const menu = document.getElementById('ai-index-menu');
          if (menu) menu.style.display = 'none';
        } else if (act === 'send') {
          // 生成中点「停止」打断；空闲时发送
          if (aiGenerating) { aiStopFlag = true; ai.stop(); }
          else aiSend();
        }
      });
    });

    // 索引库下拉：点击菜单外任意处关闭
    document.addEventListener('click', function (e) {
      const dd = document.getElementById('ai-index-dd');
      const menu = document.getElementById('ai-index-menu');
      if (!dd || !menu) return;
      if (menu.style.display !== 'none' && !dd.contains(e.target)) menu.style.display = 'none';
    });

    // 输入框交互：Enter 发送 / Shift+Enter 换行 / 自适应高度
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        aiSend();
      }
    });
    input.addEventListener('input', aiAutoResize);
    input.addEventListener('focus', function () {
      // 初次进入若有输入焦点，清空提示状态
    });

    // 会话侧栏：展开把手展开侧栏
    const sidebar = document.getElementById('ai-sidebar');
    const sideOpen = document.getElementById('ai-sidebar-open');
    if (sideOpen) sideOpen.addEventListener('click', function () {
      if (sidebar) sidebar.classList.remove('collapsed');
      sideOpen.classList.remove('show');
    });

    // 恢复会话并渲染会话列表与对话（持久化到 .session；异步完成后重建进行中气泡）
    aiRestoreSessions();
    aiUpdateSendButton();
    refreshIcons();
  }
