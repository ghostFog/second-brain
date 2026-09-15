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
    chat.scrollTop = chat.scrollHeight;
  }

  /** 新建一个问答组容器（一组 = 一次完整问答），右上角 hover 显示「删除本组」按钮。
   * @returns {HTMLElement} 组容器元素
   * @author 火 冰 */
  function aiCreateGroup() {
    const chat = document.getElementById('ai-chat');
    if (!chat) return null;
    const g = document.createElement('div');
    g.className = 'ai-qa-group relative group';
    const del = document.createElement('button');
    del.className = 'flex items-center justify-center w-6 h-6 rounded-md transition-colors opacity-0 group-hover:opacity-100 absolute right-2 top-2';
    del.style.cssText = 'color: var(--note-ink-3); background: transparent;';
    del.title = '删除本组问答';
    del.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>';
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      aiRemoveGroup(g);
    });
    g.appendChild(del);
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
    wrap.className = 'flex ' + (isUser ? 'justify-end' : 'justify-start') + ' px-5 py-2.5';
    const bubble = document.createElement('div');
    bubble.className = 'max-w-[78%] rounded-2xl px-4 py-3 text-[13.5px] leading-relaxed shadow-sm';
    if (isUser) {
      bubble.style.cssText = 'background: var(--note-brand-600); color: #FFFFFF; border-top-right-radius: 4px; white-space: pre-wrap; word-break: break-word;';
      bubble.textContent = text;
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

  /** 在助手气泡尾部追加回答统计行（模型 / 首 token 时长 / 总耗时 / 打断标记） */
  function aiAppendMeta(bubble, meta) {
    if (!bubble || !meta) return;
    const parts = [];
    if (meta.model) parts.push('模型 ' + esc(meta.model));
    if (meta.firstTokenMs != null) parts.push('首token ' + (meta.firstTokenMs / 1000).toFixed(1) + 's');
    if (meta.totalMs != null) parts.push('总耗时 ' + (meta.totalMs / 1000).toFixed(1) + 's');
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
        model: aiCurModel, firstTokenMs: aiFirstMs, totalMs: totalMs, stopped: !!stopped,
      });
      aiPersistSession(sess);
    }
    if (aiCurBubble) {
      aiAppendMeta(aiCurBubble, { model: aiCurModel, firstTokenMs: aiFirstMs, totalMs: totalMs, stopped: !!stopped });
      aiRenderSources(aiCurBubble, sources || []);
      aiSetStatus(stopped ? '已停止' : (text ? '就绪' : '无回答'), stopped ? 'var(--warning)' : (text ? 'var(--state-success)' : 'var(--state-danger)'));
    }
    aiCurText = '';
    aiCurBubble = null;
    aiCurModel = '';
    aiFirstMs = null;
    aiT0 = 0;
    aiStopFlag = false;
    refreshIcons();
    aiUpdateSendButton();
  }

  /** 渲染检索来源区（点击打开对应笔记） */
  function aiRenderSources(container, sources) {
    if (!sources || !sources.length) return;
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
        + '<span class="text-[10px] nums px-1 py-0.5 rounded" style="background: rgba(124,58,237,0.12); color: var(--note-brand-400);">' + (s.sim != null ? (s.sim * 100).toFixed(0) + '%' : '') + '</span>';
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
    const modelSel = document.getElementById('ai-model');
    const modelOpt = modelSel && modelSel.selectedOptions && modelSel.selectedOptions[0];
    aiCurModel = (modelOpt && modelOpt.textContent ? modelOpt.textContent.trim() : '').replace(/^加载模型…$/, '');
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
    ai.ask(q, carry, agentId).catch(function () { /* 错误经 ai:ask-error 事件处理 */ });
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
      aiCurText += t;
      const md = aiCurBubble.querySelector('.ai-md');
      if (md) md.innerHTML = renderMarkdown(aiCurText);
      chat.scrollTop = chat.scrollHeight;
    });
    // 回答完成：统一走 aiFinish 写入历史与统计
    ai.onDone(function (p) { aiFinish(false, (p && p.sources) || []); });
    // 回答出错：若为主动打断（aiStopFlag=true）则走 aiFinish（视为完成，保留已生成内容并记统计）；否则按错误渲染
    ai.onError(function (err) {
      if (aiStopFlag) { aiFinish(true); return; }
      aiGenerating = false;
      aiSetStatus('出错', 'var(--state-danger)');
      if (aiCurBubble) {
        aiCurBubble.innerHTML = '<div class="ai-md"><p style="color: var(--note-ink-2);">回答失败：' + esc((err && err.message) || '未知错误') + '</p></div>';
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

    // 模型选择器（底部输入区）：从配置的生成模型列表填充（value=模型 id），切换保存 currentModelId
    const modelSel = document.getElementById('ai-model');
    if (modelSel && ai.listModels) {
      const fillModels = function (data) {
        modelSel.innerHTML = '';
        const all = (data && data.models) || [];
        // 仅展示可用模型：远程 OpenAI 始终可用；本地 Ollama 仅展示正在运行的（由引擎按 /api/ps 判定）
        const list = all.filter(function (m) { return m.running; });
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
          o.title = (m.provider === 'openai' ? '远程大模型' : '本地 Ollama') + ' · ' + m.model;
          modelSel.appendChild(o);
        });
        // 当前所选模型不可用且不在可用列表时回落首个可用
        const cur = (data && data.currentModelId) || '';
        modelSel.value = list.some(function (x) { return x.id === cur; }) ? cur : list[0].id;
      };
      ai.listModels().then(fillModels).catch(function () {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '模型列表不可用';
        modelSel.appendChild(opt);
      });
      modelSel.addEventListener('change', function () {
        const id = modelSel.value;
        if (!id) return;
        ai.saveConfig({ currentModelId: id }).then(function (cfg) {
          const m = ((cfg && cfg.models) || []).find(function (x) { return x.id === id; });
          aiSetStatus('已切换 · ' + (m ? m.model : ''), 'var(--state-success)');
        }).catch(function () {});
      });
    }

    // Agent 选择器（底部输入区）：从配置的 agents 列表填充（value=agent id），切换保存 currentAgentId
    const agentSel = document.getElementById('ai-agent');
    if (agentSel && ai.getConfig) {
      ai.getConfig().then(function (cfg) {
        const agents = ((cfg && cfg.agents) || []).slice();
        agentSel.innerHTML = '<option value="">默认助手</option>'
          + agents.map(function (a) {
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
          aiSetStatus('已切换 · ' + (id ? name : '默认助手'), 'var(--state-success)');
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
