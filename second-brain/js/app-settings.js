/* ============================================
 * 第二脑 — 设置视图
 * 作者: 火 冰
 * 功能: 设置面板渲染、AI 与外观绑定、状态持久化(sState/restoreS)、Toast 与设置侧效应
 * ============================================ */

'use strict';


  /* ============================
   * 设置视图交互
   * ============================ */

  const CATS = {
    '外观': ['外观', '自定义你的编辑器外观'],
    '编辑器': ['编辑器', '调整编辑器的行为与显示'],
    '快捷键': ['快捷键', '管理应用中的快捷键'],
    '同步与备份': ['同步与备份', '管理云端同步与本地备份'],
    '隐私与安全': ['隐私与安全', '管理你的隐私与安全选项'],
    '插件管理': ['插件管理', '安装与管理插件'],
    'AI 问答': ['AI 问答', '配置本地模型与远程大模型'],
    '关于': ['关于', '版本信息与反馈'],
  };

  let settingsShellInn = null;   // 外观面板模板（首次加载后缓存）

  /* 生成设置面板内层（含标题/副标题 + 正文容器）；外层 .max-w-3xl 由持久容器提供 */
  function settingsPanel(cat, titles, bodyHtml) {
    return '<div class="mb-8"><h1 id="settings-title" class="text-h1" style="color: var(--note-ink);">' + titles[0] + '</h1>'
      + '<p id="settings-sub" class="text-body mt-1" style="color: var(--note-ink-2);">' + titles[1] + '</p></div>'
      + bodyHtml;
  }

  /* 单行「标题+说明+开关」（skey 用于持久化与副作用） */
  function tgRow(title, sub, on, skey) {
    return '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">' + title + '</div>'
      + '<div class="text-caption" style="color:var(--note-ink-3);">' + sub + '</div></div>'
      + '<label class="toggle"><input type="checkbox"' + (skey ? ' data-skey="' + skey + '"' : '') + (on ? ' checked' : '') + '><span class="toggle-track"></span></label></div>';
  }

  /* 各分类面板 HTML */
  function settingsPanelHtml(cat) {
    if (cat === '编辑器') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group"><h3 class="text-body font-semibold mb-4" style="color:var(--note-ink);">常规</h3>'
        + '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">默认编辑模式</div><div class="text-caption" style="color:var(--note-ink-3);">打开笔记时的初始模式</div></div><div class="relative"><select class="select-box" data-skey="edMode"><option>编辑</option><option>预览</option></select></div></div>'
        + tgRow('自动保存', '编辑后自动写入磁盘', true, 'edAutoSave')
        + tgRow('显示行号', '编辑区左侧显示行号', true, 'lineNumbers')
        + tgRow('智能列表延续', '回车自动延续列表缩进', true, 'smartList')
        + '</section>');
    }
    if (cat === '快捷键') {
      const rows = [['新建笔记', 'Ctrl+N'], ['打开笔记', 'Ctrl+O'], ['搜索笔记', 'Ctrl+F'], ['打开图谱视图', 'Ctrl+G'], ['命令面板', 'Ctrl+P']];
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group"><div class="flex items-center justify-between mb-4"><h3 class="text-body font-semibold" style="color:var(--note-ink);">快捷键</h3><button class="px-3 py-1.5 rounded-md text-caption border hover:opacity-80" data-saction="reset-shortcuts" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">恢复默认</button></div>'
        + '<div class="rounded-lg border overflow-hidden" style="border-color:var(--note-border);">'
        + rows.map((r, i) => '<div class="flex items-center justify-between px-4 py-3' + (i ? ' border-t' : '') + '" style="' + (i ? 'border-color:var(--note-border);' : '') + '"><span class="text-[13px]" style="color:var(--note-ink);">' + r[0] + '</span><kbd class="text-[11px] px-2 py-1 rounded font-mono" style="background:var(--note-surface-2); color:var(--note-ink-2);">' + r[1] + '</kbd></div>').join('')
        + '</div></section>');
    }
    if (cat === '同步与备份') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group">'
        + tgRow('自动同步', '笔记变更后自动云端同步', true, 'autoSync')
        + '<div class="border-t flex items-center justify-between py-3" style="border-color:var(--note-border);"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">同步间隔</div><div class="text-caption" style="color:var(--note-ink-3);">云端同步检查频率</div></div><div class="relative"><select class="select-box" data-skey="syncInterval"><option>每 5 分钟</option><option>每 10 分钟</option><option>每 30 分钟</option></select></div></div>'
        + '<div class="border-t pt-4" style="border-color:var(--note-border);"><button class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium" data-saction="sync-now" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="refresh-cw" class="w-4 h-4"></i>立即同步</button></div></section>'
        + '<section class="settings-group"><div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">本地备份</h3><button class="px-3 py-1.5 rounded-md text-caption border hover:opacity-80" data-saction="backup" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">备份到本地</button></div><p class="text-caption" style="color:var(--note-ink-3);">备份目录：笔记库根目录 /backups</p></section>');
    }
    if (cat === '隐私与安全') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group">'
        + tgRow('插件沙箱', '隔离插件权限，降低风险', true, 'pluginSandbox')
        + tgRow('应用通知', '允许应用发送系统通知', false, 'appNotify')
        + tgRow('崩溃报告', '匿名提交崩溃与错误报告', false, 'crashReport')
        + '</section>');
    }
    if (cat === '插件管理') {
      const installed = (pluginData || []).filter(p => p.installed);
      const list = installed.length
        ? installed.map(p => '<div class="flex items-center justify-between px-4 py-3 border-t" style="border-color:var(--note-border);"><div class="flex items-center gap-2.5"><div class="w-7 h-7 rounded-md flex items-center justify-center" style="background:' + p.color + '; border-radius: var(--note-radius-md);"><i data-lucide="' + p.icon + '" class="w-4 h-4" style="color:#FFFFFF;"></i></div><span class="text-[13px]" style="color:var(--note-ink);">' + p.name + '</span></div><button class="install-btn text-[11px] px-2.5 py-1 rounded border" data-saction="uninstall" data-uninstall="' + esc(p.name) + '" style="border-color:var(--note-border); color:var(--note-ink-3); background:var(--note-surface-2);">卸载</button></div>').join('')
        : '<p class="text-[13px]" style="color:var(--note-ink-3);">尚未安装任何插件</p>';
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group"><div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">已安装插件</h3><span class="text-[11px] nums" style="color:var(--note-ink-3);">' + installed.length + ' 个</span></div>'
        + '<div class="rounded-lg border" style="border-color:var(--note-border);">' + list + '</div></section>');
    }
    if (cat === '关于') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group flex items-center gap-4"><div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:var(--note-brand-600);"><i data-lucide="brain" class="w-7 h-7" style="color:#FFFFFF;"></i></div>'
        + '<div><div class="text-h3 font-semibold" style="color:var(--note-ink);">第二脑</div><div class="text-caption" style="color:var(--note-ink-3);">版本 0.1.0 · Electron 桌面版</div></div></section>'
        + '<section class="settings-group"><p class="text-caption leading-relaxed" style="color:var(--note-ink-2);">一个本地优先的 Markdown 第二大脑，专注于快速记录、双向链接与知识图谱的流通。</p></section>');
    }
    if (cat === 'AI 问答') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group">'
        + '<div class="flex items-center justify-between mb-4"><h3 class="text-body font-semibold" style="color:var(--note-ink);">本地模型</h3>'
        + '<span id="ai-cfg-status" class="text-[11px] px-2 py-0.5 rounded-full border" style="border-color:var(--note-border); color:var(--note-ink-3); background:var(--note-surface-2);">未加载</span></div>'
        + aiField('嵌入模型路径', '向量化笔记的本地模型（ONNX，支持中文多语言）', 'embedModelPath', DEFAULT_AI_FIELDS.embedModelPath)
        + aiField('重排序模型路径', '检索结果精排的本地模型（bge-reranker）', 'rerankModelPath', DEFAULT_AI_FIELDS.rerankModelPath)
        + '<div class="border-t pt-4 mt-2" style="border-color:var(--note-border);">'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full" data-ai-saction="load" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="cpu" class="w-4 h-4"></i>加载嵌入模型</button></div>'
        + '</section>'
        + '<section class="settings-group">'
        + '<div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">生成模型</h3>'
        + '<button class="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium" data-ai-saction="add" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="plus" class="w-3.5 h-3.5"></i>添加模型</button></div>'
        + '<div id="ai-model-list" class="rounded-lg border divide-y" style="border-color:var(--note-border);"></div>'
        + '<p class="text-caption mt-2" style="color:var(--note-ink-3);">支持配置多个生成模型（本地 Ollama / 远程 OpenAI 兼容），在问答页顶部切换。列表展示供应商与模型名称。</p>'
        + '</section>'
        + '<section class="settings-group">'
        + '<div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">知识库索引</h3><span id="ai-index-status" class="text-[11px] nums" style="color:var(--note-ink-3);">0 片段</span></div>'
        + '<p class="text-caption mb-4" style="color:var(--note-ink-3);">把笔记库全部 Markdown 切分并向量化，供语义检索使用。</p>'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full" data-ai-saction="rebuild" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="refresh-cw" class="w-4 h-4"></i>重建索引</button>'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full border mt-2" data-ai-saction="save" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);"><i data-lucide="save" class="w-4 h-4"></i>保存配置</button>'
        + '</section>');
    }
    return '';
  }

  /* AI 设置表单字段默认值（与主进程引擎默认一致） */
  const DEFAULT_AI_FIELDS = {
    embedModelPath: 'D:/BaiduSyncdisk/work/ai/ai-second-brain/models/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    rerankModelPath: 'D:/BaiduSyncdisk/work/ai/ai-second-brain/models/bge-reranker-v2-m3',
    baseUrl: 'http://127.0.0.1:11434',
    apiKey: '',
    model: 'qwen2.5:7b',
  };

  /** 生成 AI 设置表单字段 HTML（label + 说明 + 输入框） */
  function aiField(label, desc, key, def, isPassword) {
    return '<div class="border-t py-3" style="border-color:var(--note-border);">'
      + '<div class="text-[14px]" style="color:var(--note-ink);">' + label + '</div>'
      + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">' + desc + '</div>'
      + '<input type="' + (isPassword ? 'password' : 'text') + '" data-ai-cfg="' + key + '" placeholder="' + def + '"'
      + ' class="w-full rounded-md px-3 py-2 text-[13px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">'
      + '</div>';
  }

  /** 绑定 AI 问答设置面板：本地模型字段 + 生成模型列表（添加/编辑/删除/保存） */
  function bindAiSettings() {
    const ai = window.noteDesktop && window.noteDesktop.ai;
    const root = document.querySelector('#settings-content > div');
    if (!ai || !root) return;
    const stEl = document.getElementById('ai-cfg-status');
    const idxEl = document.getElementById('ai-index-status');
    let aiModels = [];        // 生成模型列表状态
    let currentModelId = '';  // 当前选中模型 id
    const PROV_LABEL = { ollama: '本地 Ollama', openai: '远程大模型' };

    const collectLocal = function () {
      const cfg = {};
      root.querySelectorAll('[data-ai-cfg]').forEach(function (el) { cfg[el.dataset.aiCfg] = el.value; });
      return cfg;
    };
    const fillLocal = function (cfg) {
      if (!cfg) return;
      root.querySelectorAll('[data-ai-cfg]').forEach(function (el) {
        const k = el.dataset.aiCfg;
        if (k in cfg) el.value = cfg[k] == null ? '' : String(cfg[k]);
      });
    };

    /* 渲染生成模型列表（供应商 + 模型名称 + 当前标记 + 编辑/删除） */
    const renderModelList = function () {
      const box = document.getElementById('ai-model-list');
      if (!box) return;
      if (!aiModels.length) {
        box.innerHTML = '<div class="px-4 py-6 text-center text-caption" style="color:var(--note-ink-3);">尚未配置生成模型，点击「添加模型」开始</div>';
        return;
      }
      box.innerHTML = aiModels.map(function (m) {
        const active = m.id === currentModelId;
        return '<div class="ai-model-row flex items-center gap-2 px-3 py-2.5" draggable="true" data-mid="' + esc(m.id) + '" style="border-color:var(--note-border); cursor:grab;">'
          + '<i data-lucide="grip-vertical" class="w-4 h-4 shrink-0" style="color:var(--note-ink-3);"></i>'
          + '<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:' + (active ? 'var(--state-success)' : 'var(--note-ink-3)') + ';"></span>'
          + '<div class="flex-1 min-w-0"><div class="text-[13px] truncate" style="color:var(--note-ink);">' + esc(m.model) + '</div>'
          + '<div class="text-caption truncate" style="color:var(--note-ink-3);">' + (PROV_LABEL[m.provider] || m.provider) + ' · ' + esc(m.baseUrl) + '</div></div>'
          + (active ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style="background:rgba(124,58,237,0.15); color:var(--note-brand-400);">当前</span>' : '')
          + '<button class="ai-model-edit w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" data-mid="' + esc(m.id) + '" title="编辑"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>'
          + '<button class="ai-model-del w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" data-mid="' + esc(m.id) + '" title="删除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>'
          + '</div>';
      }).join('');
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
    };

    /* 持久化：本地字段 + 模型列表 + 当前模型 */
    const persist = function (extra) {
      return ai.saveConfig(Object.assign({}, collectLocal(), { models: aiModels, currentModelId }, extra || {})).then(function (c) {
        aiModels = (c && c.models) || aiModels;
        currentModelId = (c && c.currentModelId) || currentModelId;
        renderModelList();
        return c;
      });
    };

    /* 打开添加/编辑生成模型弹层 */
    const openModelForm = function (item) {
      const isEdit = !!item;
      const ov = document.createElement('div');
      ov.id = 'ai-model-overlay';
      ov.className = 'fixed inset-0 z-50 flex items-center justify-center';
      ov.style.cssText = 'background:rgba(0,0,0,0.45);';
      ov.innerHTML =
        '<div class="w-[420px] max-w-[92vw] rounded-xl border p-5" style="background:var(--note-surface); border-color:var(--note-border); box-shadow:0 12px 40px rgba(0,0,0,0.35);">'
        + '<div class="flex items-center justify-between mb-4"><h3 class="text-[15px] font-semibold" style="color:var(--note-ink);">' + (isEdit ? '编辑生成模型' : '添加生成模型') + '</h3>'
        + '<button class="ai-form-close w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80" style="color:var(--note-ink-3);"><i data-lucide="x" class="w-4 h-4"></i></button></div>'
        + '<div class="space-y-3">'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">模型提供方</div>'
        + '<div class="relative"><select class="select-box w-full" data-ai-form="provider"><option value="ollama">本地 Ollama</option><option value="openai">远程大模型（OpenAI 兼容）</option></select>'
        + '<i data-lucide="chevron-down" class="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color:var(--note-ink-3);"></i></div></div>'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">接口地址</div>'
        + '<input type="text" data-ai-form="baseUrl" class="w-full rounded-md px-3 py-2 text-[13px] outline-none" placeholder="http://127.0.0.1:11434 / https://api.xxx.com/v1" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">API Key</div>'
        + '<input type="password" data-ai-form="apiKey" class="w-full rounded-md px-3 py-2 text-[13px] outline-none" placeholder="远程大模型鉴权密钥（Ollama 可留空）" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">模型名称</div>'
        + '<input type="text" data-ai-form="model" class="w-full rounded-md px-3 py-2 text-[13px] outline-none" placeholder="如 qwen2.5:7b / gpt-4o-mini" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '</div>'
        + '<div class="flex justify-end gap-2 mt-5">'
        + '<button class="ai-form-cancel px-4 py-2 rounded-md text-[13px] border" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">取消</button>'
        + '<button class="ai-form-save px-4 py-2 rounded-md text-[13px] font-medium" style="background:var(--note-brand-600); color:#FFFFFF;">保存</button>'
        + '</div></div>';
      document.body.appendChild(ov);
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
      if (item) {
        ov.querySelector('[data-ai-form="provider"]').value = item.provider || 'ollama';
        ov.querySelector('[data-ai-form="baseUrl"]').value = item.baseUrl || '';
        ov.querySelector('[data-ai-form="apiKey"]').value = item.apiKey || '';
        ov.querySelector('[data-ai-form="model"]').value = item.model || '';
      }
      const close = function () { ov.remove(); };
      ov.querySelector('.ai-form-close').addEventListener('click', close);
      ov.querySelector('.ai-form-cancel').addEventListener('click', close);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.ai-form-save').addEventListener('click', function () {
        const m = {
          id: item ? item.id : ('m' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)),
          provider: ov.querySelector('[data-ai-form="provider"]').value,
          baseUrl: ov.querySelector('[data-ai-form="baseUrl"]').value.trim(),
          apiKey: ov.querySelector('[data-ai-form="apiKey"]').value.trim(),
          model: ov.querySelector('[data-ai-form="model"]').value.trim(),
        };
        if (!m.model) { showToast('请填写模型名称'); return; }
        if (item) {
          aiModels = aiModels.map(function (x) { return x.id === m.id ? m : x; });
        } else {
          aiModels.push(m);
          if (!currentModelId) currentModelId = m.id;
        }
        close();
        persist().then(function () { showToast(isEdit ? '模型已更新' : '模型已添加'); })
          .catch(function () { showToast('保存失败'); });
      });
    };

    /* 删除模型（当前模型被删则回退到第一个） */
    const removeModel = function (id) {
      aiModels = aiModels.filter(function (m) { return m.id !== id; });
      if (currentModelId === id) currentModelId = aiModels.length ? aiModels[0].id : '';
      persist().then(function () { showToast('模型已删除'); }).catch(function () { showToast('保存失败'); });
    };

    // 读取配置并渲染本地字段 + 模型列表
    ai.getConfig().then(function (cfg) {
      if (!cfg) return;
      fillLocal(cfg);
      aiModels = (cfg.models && cfg.models.slice()) || [];
      currentModelId = cfg.currentModelId || (aiModels.length ? aiModels[0].id : '');
      renderModelList();
    }).catch(function () {});
    ai.getStatus().then(function (st) {
      if (idxEl) idxEl.textContent = ((st && st.chunks) || 0) + ' 片段';
      if (stEl) stEl.textContent = st && st.embeddingLoaded ? '已加载' : '未加载';
    }).catch(function () {});

    // 模型列表事件委托（编辑/删除）
    const listBox = document.getElementById('ai-model-list');
    if (listBox) {
      listBox.addEventListener('click', function (e) {
        const editBtn = e.target.closest('.ai-model-edit');
        const delBtn = e.target.closest('.ai-model-del');
        if (editBtn) {
          const it = aiModels.find(function (m) { return m.id === editBtn.dataset.mid; });
          if (it) openModelForm(it);
        } else if (delBtn) {
          removeModel(delBtn.dataset.mid);
        }
      });

      /* 生成模型列表拖拽排序（HTML5 原生拖拽） */
      const rows = function () { return listBox.querySelectorAll('.ai-model-row'); };
      let dragId = null;
      const cleanDragUI = function () {
        rows().forEach(function (r) { r.style.opacity = ''; r.style.background = ''; });
      };
      listBox.addEventListener('dragstart', function (e) {
        const row = e.target.closest('.ai-model-row');
        if (!row) { e.preventDefault(); return; }
        dragId = row.dataset.mid;
        row.style.opacity = '0.4';
      });
      listBox.addEventListener('dragover', function (e) {
        const row = e.target.closest('.ai-model-row');
        if (!row) return;
        e.preventDefault(); // 允许放置
        rows().forEach(function (r) { r.style.background = r === row ? 'var(--note-surface-2)' : ''; });
      });
      listBox.addEventListener('drop', function (e) {
        e.preventDefault();
        const row = e.target.closest('.ai-model-row');
        if (!row || !dragId || row.dataset.mid === dragId) { cleanDragUI(); return; }
        const from = aiModels.findIndex(function (m) { return m.id === dragId; });
        const to = aiModels.findIndex(function (m) { return m.id === row.dataset.mid; });
        if (from >= 0 && to >= 0) {
          const moved = aiModels.splice(from, 1)[0];
          aiModels.splice(to, 0, moved);
          renderModelList();
          persist().then(function () { showToast('模型顺序已更新'); }).catch(function () { showToast('保存失败'); });
        }
        cleanDragUI();
      });
      listBox.addEventListener('dragend', function () {
        dragId = null;
        cleanDragUI();
      });
    }

    // 工具栏按钮（添加模型 / 保存 / 加载嵌入 / 重建索引）
    root.querySelectorAll('[data-ai-saction]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const act = btn.dataset.aiSaction;
        if (act === 'add') openModelForm(null);
        else if (act === 'save') {
          persist().then(function () { showToast('AI 配置已保存'); }).catch(function () { showToast('保存失败'); });
        } else if (act === 'load') {
          persist().then(function () { return ai.loadEmbedding(); }).then(function (st) {
            if (stEl) stEl.textContent = st && st.embeddingLoaded ? '已加载' : '加载失败';
            showToast(st && st.embeddingLoaded ? '嵌入模型已加载' : '嵌入模型加载失败');
          }).catch(function (e) { showToast('加载失败：' + ((e && e.message) || e)); });
        } else if (act === 'rebuild') {
          persist().then(function () {
            if (stEl) stEl.textContent = '索引中…';
            return ai.rebuildIndex();
          }).then(function (r) {
            const n = (r && r.chunks) || 0;
            if (idxEl) idxEl.textContent = n + ' 片段';
            showToast(n ? '索引完成：' + n + ' 片段' : '索引为空');
          }).catch(function (e) { showToast('索引失败：' + ((e && e.message) || e)); });
        }
      });
    });
  }

  /* 外观面板控件绑定 */
  function bindAppearance() {
    // 主题模式
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', function () { setTheme(this.dataset.themeMode, true); });
    });
    // 强调色
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', function () { setAccent(this.dataset.accent); refreshIcons(); });
    });
    // 字体大小
    const slider = document.getElementById('font-size-slider');
    if (slider) slider.addEventListener('input', function () { applyFontSize(parseInt(this.value, 10)); });
    // 字体族
    const fam = document.getElementById('font-family-select');
    if (fam) fam.addEventListener('change', function () { applyFontFamily(this.value); });
    // 代码字体
    const mono = document.getElementById('font-mono-select');
    if (mono) mono.addEventListener('change', function () { applyFontMono(this.value); });
  }

  /* 设置项持久化存储（localStorage） */
  let sState = {};
  try { sState = JSON.parse(localStorage.getItem('note-app:settings') || '{}'); } catch (e) { /* 忽略解析失败 */ }
  function saveS(k, v) { sState[k] = v; try { localStorage.setItem('note-app:settings', JSON.stringify(sState)); } catch (e) { /* 忽略 */ } }
  function restoreS(k, d) { return (k in sState) ? sState[k] : d; }

  /* 轻量提示浮层（设置操作反馈） */
  let _toastTimer = null;
  function showToast(msg) {
    let t = document.getElementById('set-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'set-toast';
      t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:999;padding:8px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;background:var(--note-ink);color:var(--note-background);box-shadow:0 4px 16px rgba(0,0,0,.25);';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 1800);
  }

  /* 设置项副作用映射：返回已应用文案，无副作用返回 null */
  function settingsSideEffect(key, val) {
    const on = val === true || val === 'true' || val === 1 || val === '1';
    if (key === 'lineNumbers') { setLineNumbers(on); return on ? '行号已开启' : '行号已关闭'; }
    if (key === 'edMode') { const v = (val === '预览' || val === 'preview') ? 'preview' : 'edit'; setEditorMode(v); return '默认编辑模式：' + val; }
    if (key === 'edAutoSave') return on ? '自动保存已开启' : '自动保存已关闭';
    if (key === 'smartList') return on ? '智能列表延续已开启' : '智能列表延续已关闭';
    if (key === 'wrap') { setEditorWrap(on); return on ? '自动换行已开启' : '自动换行已关闭'; }
    if (key === 'reduceMotion') { applyReduceMotion(on); return on ? '减少动画已开启' : '减少动画已关闭'; }
    if (key === 'density') { applyDensity(val); return '界面密度：' + val; }
    return null;
  }

  /* 通用绑定带 data-skey 的控件：恢复已存值、变更保存、应用副作用 */
  function bindKeyedControls(root) {
    const box = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!box) return;
    // 界面密度（div 单选组）
    box.querySelectorAll('.density-opt[data-skey]').forEach(opt => {
      const saved = restoreS('density', null);
      if (saved) opt.classList.toggle('active', opt.dataset.value === saved);
      opt.addEventListener('click', function () {
        const all = box.querySelectorAll('.density-opt[data-skey]');
        all.forEach(o => o.classList.remove('active'));
        this.classList.add('active');
        saveS('density', this.dataset.value);
        const m = settingsSideEffect('density', this.dataset.value);
        if (m) showToast(m);
      });
    });
    // 输入控件（checkbox / select / range）
    box.querySelectorAll('[data-skey]').forEach(el => {
      if (el.classList.contains('density-opt')) return;
      const key = el.dataset.skey;
      if (el.type === 'checkbox') el.checked = !!restoreS(key, el.checked);
      else if (el.tagName === 'SELECT') el.value = restoreS(key, el.value);
      else if (el.type === 'range') el.value = restoreS(key, el.value);
      const ev = (el.type === 'range') ? 'input' : 'change';
      el.addEventListener(ev, function () {
        const val = (el.type === 'checkbox') ? el.checked : el.value;
        saveS(key, val);
        const m = settingsSideEffect(key, val);
        if (m) showToast(m);
      });
    });
  }

  /* 绑定设置面板动作按钮（data-saction） */
  function bindActionButtons(root) {
    const box = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!box) return;
    box.querySelectorAll('[data-saction]').forEach(btn => {
      btn.addEventListener('click', function () {
        const act = btn.dataset.saction;
        if (act === 'sync-now') { showToast('正在同步…'); }
        else if (act === 'backup') { showToast('已备份到本地 /backups'); }
        else if (act === 'reset-shortcuts') { showToast('快捷键已恢复默认'); }
        else if (act === 'uninstall') {
          const name = btn.dataset.uninstall;
          const p = pluginData.find(x => x.name === name);
          if (p) { p.installed = false; showToast('已卸载插件：' + name); switchSettings('插件管理'); }
        }
      });
    });
  }

  /* 切换到指定设置分类 */
  function switchSettings(cat) {
    const content = document.querySelector('#settings-content > div');
    if (!content) return;
    const title = document.getElementById('settings-title');
    const sub = document.getElementById('settings-sub');
    const info = CATS[cat] || CATS['外观'];
    if (title) title.textContent = info[0];
    if (sub) sub.textContent = info[1];
    let html;
    if (cat === '外观') {
      html = settingsShellInn;
    } else {
      html = settingsPanelHtml(cat);
      if (!html) html = settingsPanel(cat, info, '<p class="text-caption" style="color:var(--note-ink-3);">该分类设置暂未开放，敬请期待。</p>');
    }
    content.innerHTML = html;
    refreshIcons();
    if (cat === '外观') bindAppearance();
    if (cat === 'AI 问答') bindAiSettings();
    bindKeyedControls(content);
    bindActionButtons(content);
  }

  function bindSettings() {
    // 缓存外观面板模板
    const shell = document.querySelector('#settings-content > div');
    if (shell) settingsShellInn = shell.innerHTML;
    // 恢复已持久化的 UI 状态（主题/强调色/字体下拉）
    const savedTheme = window.__savedTheme || 'dark';
    const savedAccent = window.__savedAccent || '#7C3AED';
    const savedFont = window.__savedFontSize || 15;
    const savedFamily = window.__savedFontFamily || 'Inter';
    const savedMono = window.__savedFontMono || 'JetBrains Mono';
    setTheme(savedTheme, false);
    setAccent(savedAccent);
    const famSel = document.getElementById('font-family-select');
    if (famSel) famSel.value = savedFamily;
    const monoSel = document.getElementById('font-mono-select');
    if (monoSel) monoSel.value = savedMono;
    const sizeSel = document.getElementById('font-size-slider');
    if (sizeSel) sizeSel.value = savedFont;
    applyFontSize(savedFont);

    // 分类切换
    document.querySelectorAll('.settings-cat').forEach(cat => {
      cat.addEventListener('click', function () {
        document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
        this.classList.add('active');
        switchSettings(this.dataset.cat);
      });
    });

    bindAppearance();
    // 初次显示的外观面板也需绑定通用控件与动作按钮（其余分类由 switchSettings 绑定）
    bindKeyedControls(document.querySelector('#settings-content > div'));
    bindActionButtons(document.querySelector('#settings-content > div'));
  }
