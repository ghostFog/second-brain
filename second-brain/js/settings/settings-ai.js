/* ============================================
 * 第二脑 — 设置视图·AI 问答
 * 作者: 火 冰
 * 功能: AI 设置表单字段/模型库常量、字段 HTML 生成、AI 问答面板绑定
 *       （本地模型 + 生成模型列表 + 运行状态轮询 + 模型库下载/使用）
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）
 * ============================================ */

'use strict';

  /* AI 设置表单字段默认值（与主进程引擎默认一致） */
  const DEFAULT_AI_FIELDS = {
    embedModelPath: '',
    rerankModelPath: '',
    baseUrl: 'http://127.0.0.1:11434',
    apiKey: '',
    model: 'qwen2.5:7b',
  };

  /* 嵌入式模型库（默认 4 个可下载模型）：repo 与主进程 EMBED_MODEL_LIB 一致，其余为展示与说明 */
  const AI_EMBED_LIB = [
    { id: 'paraphrase-multilingual-MiniLM-L12-v2', repo: 'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
      speed: '快', mem: '~190MB', rec: '❌ 纯中文不要用', cos: '0.55–0.65',
      note: 'max_seq=128，中文弱，片段稍长向量失效；仅多语言场景' },
    { id: 'bge-small-zh-v1.5', repo: 'Xenova/bge-small-zh-v1.5',
      speed: '最快', mem: '~100MB', rec: '✅ 首选大批量 CPU 预处理', cos: '0.70–0.76',
      note: 'CPU 吞吐量很高；普通文档语义断点够用；复杂文档会有少量切分不准' },
    { id: 'bge-base-zh-v1.5', repo: 'Xenova/bge-base-zh-v1.5',
      speed: '中等', mem: '~410MB', rec: '✅ CPU 生产稳妥选择，优先测试', cos: '0.72–0.78',
      note: 'CPU 可以跑，速度大概是 small 的 2.5-3 倍；语义边界识别明显优于 small；合同、技术文档更好' },
    { id: 'bge-large-zh-v1.5', repo: 'Xenova/bge-large-zh-v1.5',
      speed: '很慢', mem: '~1.3GB', rec: '❌ CPU 不建议上', cos: '0.74–0.80',
      note: 'CPU 推理延迟很高，批量文档预处理会非常耗时间，不适合流水线' },
    { id: 'all-MiniLM-L6-v2', repo: 'Xenova/all-MiniLM-L6-v2',
      speed: '最快', mem: '~80MB', rec: '❌ 中文不要用，仅英文原型', cos: '0.50–0.62',
      dim: '384', token: '≤200', zh: '❌很差（英文模型）', zhRec: '❌ 中文不要用，仅英文原型',
      note: '纯英文很强；中文语义区分混乱；中文文档容易出现该切不切、乱切；Apache2.0 商用许可' },
    { id: 'all-MiniLM-L12-v2', repo: 'Xenova/all-MiniLM-L12-v2',
      speed: '很快', mem: '~120MB', rec: '❌ 中文不要用', cos: '0.52–0.64',
      dim: '384', token: '≤200', zh: '❌较差（英文模型）', zhRec: '❌ 中文不要用',
      note: 'L12 比 L6 略好，但中文依旧不行；本质还是英文训练底座' },
  ];

  /* 重排序模型库（两个可选）：与主进程 RERANK_MODEL_LIB 一致 */
  const AI_RERANK_LIB = [
    { id: 'bge-reranker-base', repo: 'Xenova/bge-reranker-base',
      speed: '中', mem: '~1.1GB', rec: '✅ 中文可跑（中英多语种）', cos: '—',
      note: 'transformers.js 官方转换的多语种重排序 ONNX 模型，用于检索后列表精排；Xenova 官方维护，源稳定' },
    { id: 'bge-reranker-v2-m3-ONNX', repo: 'BGLAW/bge-reranker-v2-m3-onnx',
      speed: '中', mem: '~1.3GB', rec: '✅ 推荐中文精排', cos: '—',
      note: 'bge-reranker-v2-m3 的 ONNX 转换版（BGLAW），含 onnx/model.onnx + tokenizer.json，与本地 ORT 加载器匹配' },
  ];

  /** 生成 AI 设置表单字段 HTML（label + 说明 + 输入框） */
  function aiField(label, desc, key, def, isPassword) {
    return '<div class="border-t py-3" style="border-color:var(--note-border);">'
      + '<div class="text-[14px]" style="color:var(--note-ink);">' + label + '</div>'
      + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">' + desc + '</div>'
      + '<input type="' + (isPassword ? 'password' : 'text') + '" data-ai-cfg="' + key + '" placeholder="' + def + '"'
      + ' class="w-full rounded-md px-3 py-2 text-[13px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">'
      + '</div>';
  }

  /* 模型路径输入框：输入框 + 「选择目录」按钮。支持 {modelDir} 变量（模型库「使用」填入），也可手动选择本地目录 */
  function aiPathField(label, desc, key, def) {
    return '<div class="border-t py-3" style="border-color:var(--note-border);">'
      + '<div class="text-[14px]" style="color:var(--note-ink);">' + label + '</div>'
      + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">' + desc + '</div>'
      + '<div class="flex items-center gap-2">'
      + '<input type="text" data-ai-cfg="' + key + '" data-ai-path="' + key + '" placeholder="' + def + '"'
      + ' class="flex-1 rounded-md px-3 py-2 text-[13px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">'
      + '<button data-ai-cfg-pick="' + key + '" class="flex items-center gap-1 px-2.5 py-2 rounded-md text-[12px] font-medium shrink-0" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink-2);" title="选择本地模型目录"><i data-lucide="folder-open" class="w-3.5 h-3.5"></i>选择</button>'
      + '</div>'
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
    // Ollama 运行状态表：key = baseUrl + '\u0000' + model 名，value=true 表示正在运行
    // 由 refreshOne/refreshAllGroups 按刷新频率（modelRefreshSec）轮询 /api/ps 更新
    let runningMap = {};
    const PROV_LABEL = { ollama: '本地 Ollama', openai: '远程大模型' };
    // 是否具备 Ollama 加载/卸载/上下文管理能力（桌面桥接才有）
    const canManage = typeof ai.manageOllamaModel === 'function';
    // 是否具备运行状态查询能力（桌面桥接才有）
    const canTrack = typeof ai.listRunningModels === 'function';

    const collectLocal = function () {
      const cfg = {};
      root.querySelectorAll('[data-ai-cfg]').forEach(function (el) {
        if (el.type === 'checkbox') cfg[el.dataset.aiCfg] = el.checked;
        else cfg[el.dataset.aiCfg] = el.value;
      });
      return cfg;
    };
    const fillLocal = function (cfg) {
      if (!cfg) return;
      root.querySelectorAll('[data-ai-cfg]').forEach(function (el) {
        const k = el.dataset.aiCfg;
        if (!(k in cfg)) return;
        if (el.type === 'checkbox') el.checked = !!cfg[k];
        else el.value = cfg[k] == null ? '' : String(cfg[k]);
      });
    };

    /* 生成唯一模型 id（添加/复制弹层共用） */
    const genModelId = function () {
      return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    };

    /* 渲染生成模型列表（按 baseUrl 分组：组头显示地址与模型数；行内 当前标记 + 复制/编辑/删除，
     * Ollama 模型另带 加载/卸载/上下文 操作），整行 draggable 支持拖拽排序（HTML5 原生拖拽） */
    const renderModelList = function () {
      const box = document.getElementById('ai-model-list');
      if (!box) return;
      if (!aiModels.length) {
        box.innerHTML = '<div class="px-4 py-6 text-center text-caption" style="color:var(--note-ink-3);">尚未配置生成模型，点击「添加模型」开始</div>';
        return;
      }
      // 按 baseUrl 分组（保持首次出现顺序）
      const groups = [];
      const groupIndex = {};
      aiModels.forEach(function (m) {
        const key = m.baseUrl || '(未设置地址)';
        if (!(key in groupIndex)) { groupIndex[key] = groups.length; groups.push({ key: key, items: [] }); }
        groups[groupIndex[key]].items.push(m);
      });
      const rowHtml = function (m) {
        const active = m.id === currentModelId;
        const isOllama = m.provider === 'ollama';
        // 运行中：显示 卸载 按钮；未运行：显示 加载 按钮（由 /api/ps 轮询驱动 runningMap）
        const isRunning = isOllama && !!runningMap[String(m.baseUrl || '') + '\u0000' + m.model];
        return '<div class="ai-model-row flex items-center gap-2 px-3 py-2.5" draggable="true" data-mid="' + esc(m.id) + '" style="border-color:var(--note-border); cursor:grab;">'
          + '<i data-lucide="grip-vertical" class="w-4 h-4 shrink-0" style="color:var(--note-ink-3);"></i>'
          + '<span class="w-1.5 h-1.5 rounded-full shrink-0" title="' + (isRunning ? '运行中' : (active ? '当前使用' : '')) + '" style="background:' + ((isRunning || active) ? 'var(--state-success)' : 'var(--note-ink-3)') + ';"></span>'
          + '<div class="flex-1 min-w-0"><div class="text-[13px] truncate" style="color:var(--note-ink);">' + esc(m.model) + '</div>'
          + '<div class="text-caption truncate" style="color:var(--note-ink-3);">' + (PROV_LABEL[m.provider] || m.provider) + (isRunning ? ' · 运行中' : '') + '</div></div>'
          + (active ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style="background:rgba(124,58,237,0.15); color:var(--note-brand-400);">当前</span>' : '')
          + (isOllama && canManage ? '<input type="number" min="0" class="ai-model-ctx w-16 px-1 py-1 text-[11px] nums text-center rounded-md outline-none shrink-0" draggable="false" data-mid="' + esc(m.id) + '" value="' + (m.numCtx ? Number(m.numCtx) : '') + '" placeholder="ctx" title="上下文长度 num_ctx（留空=模型默认）" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink-3);">'
            + (isRunning
                ? '<button class="ai-model-unload w-7 h-7 flex items-center justify-center rounded-md shrink-0" draggable="false" data-mid="' + esc(m.id) + '" title="卸载模型（释放内存）" style="color:#FFFFFF; background:var(--state-warning, #d97706);"><i data-lucide="power" class="w-3.5 h-3.5"></i></button>'
                : '<button class="ai-model-load w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" draggable="false" data-mid="' + esc(m.id) + '" title="加载模型（常驻内存）"><i data-lucide="play" class="w-3.5 h-3.5"></i></button>')
            : '')
          + '<button class="ai-model-copy w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" draggable="false" data-mid="' + esc(m.id) + '" title="复制"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>'
          + '<button class="ai-model-edit w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" draggable="false" data-mid="' + esc(m.id) + '" title="编辑"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>'
          + '<button class="ai-model-del w-7 h-7 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" draggable="false" data-mid="' + esc(m.id) + '" title="删除"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>'
          + '</div>';
      };
      box.innerHTML = groups.map(function (g) {
        return '<div class="ai-model-group">'
          + '<div class="ai-model-group-head flex items-center justify-between px-3 py-1.5 text-[11px] font-medium" style="background:var(--note-surface-2); color:var(--note-ink-3); border-color:var(--note-border);">'
          + '<span class="truncate"><i data-lucide="server" class="w-3 h-3 inline mr-1"></i>' + esc(g.key) + '</span>'
          + '<span class="flex items-center shrink-0 ml-2"><span class="nums">' + g.items.length + ' 个模型</span>'
          + (canTrack && g.items.some(function (x) { return x.provider === 'ollama'; })
              ? '<button class="ai-model-refresh w-6 h-6 flex items-center justify-center rounded hover:opacity-80" data-base-url="' + esc(g.key) + '" title="手动刷新该组运行状态"><i data-lucide="refresh-cw" class="w-3 h-3"></i></button>' : '')
          + '</span></div>'
          + g.items.map(rowHtml).join('')
          + '</div>';
      }).join('');
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
    };

    /* ---------- Ollama 运行状态刷新（按 baseUrl 分组轮询 GET /api/ps） ---------- */
    /* 查询单个 Ollama 服务运行中的模型并更新 runningMap；服务不可达返回 false（保留旧状态） */
    const refreshOne = function (baseUrl) {
      if (!baseUrl || !canTrack) return Promise.resolve(false);
      return ai.listRunningModels(baseUrl).then(function (r) {
        const list = (r && Array.isArray(r.models)) ? r.models : [];
        // 先清空该组旧状态，再按本次结果标记
        const prefix = String(baseUrl) + '\u0000';
        Object.keys(runningMap).forEach(function (k) { if (k.indexOf(prefix) === 0) delete runningMap[k]; });
        list.forEach(function (md) { if (md && md.name) runningMap[prefix + md.name] = true; });
        return true;
      }).catch(function () { return false; }); // 服务不可达/超时：保留旧状态，静默
    };
    /* 刷新全部 Ollama 组（去重 baseUrl），完成后若列表仍挂载则重绘（运行中→卸载/未运行→加载） */
    const refreshAllGroups = function () {
      const urls = [];
      aiModels.forEach(function (m) {
        if (m.provider === 'ollama' && m.baseUrl && urls.indexOf(m.baseUrl) === -1) urls.push(m.baseUrl);
      });
      if (!urls.length) return Promise.resolve();
      return Promise.all(urls.map(refreshOne)).then(function () {
        if (document.getElementById('ai-model-list')) renderModelList();
      });
    };
    /* 启动/重启自动刷新定时器（频率 = modelRefreshSec 秒，默认 10）；面板切走后自动停止 */
    const startAutoRefresh = function () {
      if (window.__aiRefreshTimer) { clearInterval(window.__aiRefreshTimer); window.__aiRefreshTimer = null; }
      const sec = Math.max(1, parseInt(document.querySelector('[data-ai-cfg="modelRefreshSec"]').value, 10) || 10);
      const tick = function () {
        if (!document.getElementById('ai-model-list')) { // 已切到其他分类：停止轮询
          clearInterval(window.__aiRefreshTimer);
          window.__aiRefreshTimer = null;
          return;
        }
        refreshAllGroups();
      };
      tick(); // 进入面板立即刷新一次
      window.__aiRefreshTimer = setInterval(tick, sec * 1000);
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

    /* ---------- 嵌入式模型库（下载 / 使用 / 说明） ---------- */
    const libBox = document.getElementById('ai-model-lib');
    const rerankBox = document.getElementById('ai-rerank-lib');
    let modelLib = { modelDir: '', defaultModelDir: '', models: [], rerankModels: [] };
    let libRunning = {}; // repo -> true

    // 按 repo 定位模型卡片（跨嵌入/重排序两个容器；repo 含斜杠，避免属性选择器转义问题）
    const cardOf = function (repo) {
      let found = null;
      [libBox, rerankBox].forEach(function (box) {
        if (found || !box) return;
        box.querySelectorAll('.ai-embed-card').forEach(function (el) {
          if (el.dataset.repo === repo) found = el;
        });
      });
      return found;
    };

    // 当前模型目录输入框的值（优先取用户输入，未填则用已解析的 modelLib.modelDir）
    const modelDirValue = function () {
      const d = root.querySelector('[data-ai-cfg="modelDir"]');
      return (d && d.value.trim()) || modelLib.modelDir || '';
    };

    /* 读取某个配置路径输入框当前值（归一化正斜杠、去尾斜杠），并展开 {modelDir} 变量，
     * 用于判定模型是否正在使用（与实际 localPath 比较前替换为真实目录） */
    const cfgPathValue = function (key) {
      const el = root.querySelector('[data-ai-cfg="' + key + '"]');
      let v = (el && el.value) ? String(el.value).replace(/\\/g, '/').replace(/\/+$/, '') : '';
      if (v.indexOf('{modelDir}') === 0) {
        // 展开 {modelDir}：优先取输入框/模型库里的下载目录，缺省回落默认目录
        const md = (modelDirValue() || modelLib.modelDir || '').replace(/\\/g, '/').replace(/\/+$/, '');
        v = md + v.slice('{modelDir}'.length);
      }
      return v;
    };

    /* 通用渲染一个模型库容器：状态点 + 源下拉 + 下载/已下载 + 使用 + 说明展开
     * type = 'emb'|'rerank'，分别对应嵌入/重排序模型路径输入框 */
    const renderLibBox = function (libList, box, libModels, type, cfgKey) {
      if (!box) return;
      const activePath = cfgPathValue(cfgKey);
      const useTitle = (type === 'rerank') ? '设为重排序模型路径' : '设为嵌入模型路径';
      box.innerHTML = libList.map(function (m) {
        const found = (libModels || []).find(function (x) { return x.repo === m.repo; });
        const localPath = (found && found.localPath) ? String(found.localPath).replace(/\\/g, '/').replace(/\/+$/, '') : '';
        const local = !!localPath;                       // 本地实际存在该模型目录
        const running = !!libRunning[m.repo];
        const inUse = local && activePath === localPath; // 对应路径与该模型实际目录一致 → 已使用
        // 「使用」按钮：未下载不显示；已使用置灰禁用显示「已使用」；已下载未使用才显示可点的「使用」
        let useBtn = '';
        if (local) {
          useBtn = inUse
            ? '<button data-model-use disabled class="px-2 py-1 rounded-md text-[11px] font-medium shrink-0" style="border:1px solid var(--note-border); color:var(--note-ink-3); opacity:0.6; cursor:not-allowed;" title="当前正在使用此模型">已使用</button>'
            : '<button data-model-use class="px-2 py-1 rounded-md text-[11px] font-medium shrink-0" style="border:1px solid var(--note-border); color:var(--note-ink-2);" title="' + useTitle + '">使用</button>';
        }
        const dot = local ? 'var(--state-success)' : (running ? 'var(--note-brand-400)' : 'var(--note-ink-3)');
        return '<div class="ai-embed-card rounded-lg border px-3 py-2.5" data-repo="' + esc(m.repo) + '" style="border-color:var(--note-border); background:var(--note-surface);">'
          + '<div class="flex items-center gap-2">'
          + '<span class="w-2 h-2 rounded-full shrink-0" style="background:' + dot + ';"></span>'
          + '<div class="flex-1 min-w-0"><div class="text-[13px] truncate" style="color:var(--note-ink);">' + esc(m.id) + '</div>'
          + '<div class="text-caption truncate" style="color:var(--note-ink-3);">' + esc(m.repo) + '</div></div>'
          + '<div class="flex items-center gap-1.5 shrink-0">'
          + (running
            ? '<div class="w-24 h-1.5 rounded-full overflow-hidden" style="background:var(--note-surface-2);"><div class="model-progress h-full" style="width:0%; background:var(--note-brand-600);"></div></div>'
            : (local
              ? '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style="background:rgba(22,163,74,0.15); color:var(--state-success);">已下载</span>'
              : '<select data-model-source class="px-1.5 py-1 rounded text-[11px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink-2);">'
                + '<option value="auto" selected>自动检测</option><option value="modelscope">ModelScope</option><option value="huggingface-mirror">HF 镜像(国内)</option><option value="huggingface">HuggingFace</option></select>'
                + '<button data-model-dl class="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium shrink-0" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="download" class="w-3 h-3"></i>下载</button>'))
          + useBtn
          + '<button data-model-toggle class="w-6 h-6 flex items-center justify-center rounded-md hover:opacity-80 shrink-0" style="color:var(--note-ink-3);" title="查看说明"><i data-lucide="chevron-down" class="w-3.5 h-3.5"></i></button>'
          + '</div></div>'
          + '<div class="ai-embed-desc hidden mt-2 pt-2 border-t grid grid-cols-1 gap-1.5 text-[12px]" style="border-color:var(--note-border); color:var(--note-ink-2);">'
          + '<div><span style="color:var(--note-ink-3);">CPU 速度：</span>' + esc(m.speed) + '　<span style="color:var(--note-ink-3);">内存：</span>' + esc(m.mem) + '</div>'
          + (m.dim ? '<div><span style="color:var(--note-ink-3);">维度：</span>' + esc(m.dim) + '　<span style="color:var(--note-ink-3);">最大片段：</span>' + esc(m.token || '—') + '　<span style="color:var(--note-ink-3);">中文能力：</span>' + esc(m.zh || '—') + '</div>' : '')
          + '<div><span style="color:var(--note-ink-3);">推荐 cos 阈值：</span><b style="color:var(--note-brand-400);">' + esc(m.cos) + '</b></div>'
          + '<div><span style="color:var(--note-ink-3);">CPU 语义分块：</span>' + esc(m.rec) + '</div>'
          + '<div style="color:var(--note-ink-3);">CPU 下实际表现：' + esc(m.note) + '</div>'
          + (m.zhRec ? '<div style="color:#ef4444;">CPU 中文业务推荐：' + esc(m.zhRec) + '</div>' : '')
          + '</div>'
          + '</div>';
      }).join('');
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
    };

    /* 渲染嵌入 / 重排序模型库 */
    const renderModelLib = function () {
      renderLibBox(AI_EMBED_LIB, libBox, modelLib.models, 'emb', 'embedModelPath');
    };
    const renderRerankLib = function () {
      renderLibBox(AI_RERANK_LIB, rerankBox, modelLib.rerankModels, 'rerank', 'rerankModelPath');
    };
    const renderAllLib = function () { renderModelLib(); renderRerankLib(); };

    /* 刷新模型库本地状态（getModelLib）并更新目录输入框 */
    const loadModelLib = function () {
      if (!ai || typeof ai.getModelLib !== 'function') return Promise.resolve(null); // 网页版无桌面桥接
      return ai.getModelLib().then(function (lib) {
        if (!lib) return;
        modelLib = lib;
        renderAllLib();
        const d = root.querySelector('[data-ai-cfg="modelDir"]');
        if (d && !d.value.trim()) d.value = lib.modelDir || '';
        return lib;
      }).catch(function () {});
    };

    /* 下载模型到当前目录（源取自该行下拉） */
    const downloadModel = function (repo) {
      if (!ai || typeof ai.setModelDir !== 'function' || typeof ai.downloadModel !== 'function') {
        showToast('模型下载管理仅桌面版可用');
        return;
      }
      const card = cardOf(repo);
      const sel = card && card.querySelector('[data-model-source]');
      const source = (sel && sel.value) || 'auto'; // auto：下载前自动检测并按序选可用源
      const dir = modelDirValue();
      if (!dir) { showToast('请先设置模型下载目录'); return; }
      libRunning[repo] = true;
      renderAllLib();
      // 下载前先把目录写入配置，确保落盘到用户当前输入的目录（无需先点保存）
      ai.setModelDir(dir).then(function () {
        return ai.downloadModel(repo, source);
      }).then(function (r) {
        libRunning[repo] = false;
        const srcLabel = { modelscope: 'ModelScope', 'huggingface-mirror': 'HF 镜像(国内)', huggingface: 'HuggingFace' }[r && r.source] || (r && r.source) || '';
        if (r && r.ok) showToast('模型已下载完成' + (srcLabel ? '（' + srcLabel + '）' : ''));
        else showToast('下载失败' + (srcLabel ? '（' + srcLabel + '）' : '') + '：' + ((r && r.error) || '请检查网络或查看日志 userData/logs/ai-engine.log'));
        return loadModelLib();
      }).catch(function (e) {
        libRunning[repo] = false;
        showToast('下载失败：' + ((e && e.message) || e));
        return loadModelLib();
      });
    };

    /* 「使用」：把所选模型以 {modelDir}/<repo> 变量形式填入对应（嵌入/重排序）路径 */
    const useModel = function (repo) {
      const inEmbed = (modelLib.models || []).some(function (x) { return x.repo === repo; });
      const list = inEmbed ? (modelLib.models || []) : (modelLib.rerankModels || []);
      const m = list.find(function (x) { return x.repo === repo; });
      if (!m) { showToast('未找到该模型'); return; }
      if (!m.localPath) { showToast('该模型尚未下载，请先点击「下载」'); return; }
      // 用实际本地目录相对下载目录的路径（前缀可能与 repo 名不同，如 sentence-transformers/…），
      // 以 {modelDir} 变量保存，加载时展开为真实目录，且与「已使用」判定完全一致。
      const base = (modelLib.modelDir || modelDirValue() || '').replace(/\\/g, '/').replace(/\/+$/, '');
      let rel = String(m.localPath).replace(/\\/g, '/');
      rel = base && rel.indexOf(base) === 0 ? rel.slice(base.length) : ('/' + m.repo);
      const p = '{modelDir}' + rel; // 形如 {modelDir}/Xenova/bge-small-zh-v1.5 或 {modelDir}/sentence-transformers/…
      fillLocal(inEmbed ? { embedModelPath: p } : { rerankModelPath: p });
      renderAllLib();        // 立即刷新使该模型「使用」按钮变为「已使用」（基于输入框新值）
      persist().catch(function () {}); // 持久化，避免切换设置页后被旧配置覆盖还原
      showToast('已设为' + (inEmbed ? '嵌入' : '重排序') + '模型路径（变量 {modelDir}），请点击「加载嵌入模型」生效');
    };

    // 模型库卡片事件委托（下载 / 使用 / 说明展开，覆盖嵌入与重排序两个容器）
    root.addEventListener('click', function (e) {
      const dl = e.target.closest('[data-model-dl]');
      const use = e.target.closest('[data-model-use]');
      const tg = e.target.closest('[data-model-toggle]');
      // repo 从所在卡片读取（按钮 data-* 仅作匹配标记，不存值，避免空字符串）
      const card = e.target.closest('.ai-embed-card');
      const repo = card && card.dataset.repo;
      if (dl && repo) { downloadModel(repo); return; }
      if (use && repo) { useModel(repo); return; }
      if (tg) {
        const desc = card && card.querySelector('.ai-embed-desc');
        if (desc) desc.classList.toggle('hidden');
      }
    });

    // 模型下载进度回调（按 repo 更新进度条）
    if (ai && typeof ai.onModelProgress === 'function') {
      ai.onModelProgress(function (p) {
        const card = cardOf(p && p.repo);
        const bar = card && card.querySelector('.model-progress');
        if (bar) {
          // transformers 的 progress 已是 0-100 百分比，直接使用并夹紧，避免溢出
          const pct = (p && typeof p.progress === 'number') ? Math.max(0, Math.min(100, p.progress)) : 0;
          bar.style.width = pct + '%';
        }
      });
    }

    // 嵌入/重排序模型路径的「选择本地目录」按钮：弹出目录选择，并把所选目录填入对应路径（不套 {modelDir}，因为可能是自定义目录）
    root.querySelectorAll('[data-ai-cfg-pick]').forEach(function (b) {
      if (!ai || typeof ai.pickModelDir !== 'function') return;
      b.addEventListener('click', function () {
        const key = b.dataset.aiCfgPick;
        ai.pickModelDir().then(function (dir) {
          if (!dir) return;
          const inp = root.querySelector('[data-ai-cfg="' + key + '"]');
          if (inp) inp.value = dir.replace(/\\/g, '/');
          renderAllLib(); // 刷新「使用/已使用」状态（自定义目录一般不会命中库内模型）
          showToast('已选择本地模型目录');
        }).catch(function () {});
      });
    });

    // 目录选择 / 打开按钮（网页版无桌面 IPC，忽略绑定）
    root.querySelectorAll('[data-model-ai]').forEach(function (b) {
      if (!ai || typeof ai.pickModelDir !== 'function' || typeof ai.revealModelDir !== 'function') return;
      b.addEventListener('click', function () {
        const act = b.dataset.modelAi;
        if (act === 'pick') {
          ai.pickModelDir().then(function (dir) {
            if (!dir) return null;
            const d = root.querySelector('[data-ai-cfg="modelDir"]');
            if (d) d.value = dir;
            return ai.setModelDir(dir);
          }).then(function () { showToast('模型下载目录已更新'); return loadModelLib(); }).catch(function () {});
        } else if (act === 'reveal') {
          ai.revealModelDir();
        }
      });
    });

    // 初始化模型库
    loadModelLib();

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
        // Ollama：从服务拉取模型列表（下拉选择）
        + '<div data-ai-form="ollama-pick" class="ai-ollama-pick hidden">'
        + '<div class="flex items-center justify-between mb-1.5"><div class="text-[13px]" style="color:var(--note-ink);">从 Ollama 获取模型</div>'
        + '<button type="button" data-ai-form="fetch" class="px-2.5 py-1 rounded-md text-[11px] font-medium shrink-0" style="background:var(--note-brand-600); color:#FFFFFF;">获取模型列表</button></div>'
        + '<div class="relative"><select data-ai-form="ollama-list" class="select-box w-full" disabled><option value="">先点击上方按钮拉取</option></select>'
        + '<i data-lucide="chevron-down" class="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color:var(--note-ink-3);"></i></div></div>'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">模型名称</div>'
        + '<input type="text" data-ai-form="model" class="w-full rounded-md px-3 py-2 text-[13px] outline-none" placeholder="如 qwen2.5:7b / gpt-4o-mini" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '<div><div class="text-[13px] mb-1.5" style="color:var(--note-ink);">上下文长度（num_ctx）</div>'
        + '<input type="number" min="0" data-ai-form="numCtx" class="w-full rounded-md px-3 py-2 text-[13px] nums outline-none" placeholder="留空=模型默认（如 4096/8192）" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '</div>'
        + '<div class="flex justify-end gap-2 mt-5">'
        + '<button class="ai-form-cancel px-4 py-2 rounded-md text-[13px] border" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">取消</button>'
        + '<button class="ai-form-save px-4 py-2 rounded-md text-[13px] font-medium" style="background:var(--note-brand-600); color:#FFFFFF;">保存</button>'
        + '</div></div>';
      document.body.appendChild(ov);
      if (window.lucide && window.lucide.createIcons) window.lucide.createIcons({});
      const provSel = ov.querySelector('[data-ai-form="provider"]');
      const baseUrlInput = ov.querySelector('[data-ai-form="baseUrl"]');
      const pickBox = ov.querySelector('.ai-ollama-pick');
      const pickList = ov.querySelector('[data-ai-form="ollama-list"]');
      const fetchBtn = ov.querySelector('[data-ai-form="fetch"]');
      // 仅 Ollama 提供方且具备桌面桥接时显示「从 Ollama 获取模型」区（远程大模型用 API Key + 手填模型名）
      const canOllamaPick = typeof ai.listOllamaModels === 'function';
      const syncOllamaPick = function () { pickBox.classList.toggle('hidden', !(canOllamaPick && provSel.value === 'ollama')); };
      provSel.addEventListener('change', syncOllamaPick);
      // 拉取 Ollama 已安装模型列表并填充下拉
      fetchBtn.addEventListener('click', function () {
        const base = baseUrlInput.value.trim();
        if (!base) { showToast('请先填写接口地址'); return; }
        fetchBtn.disabled = true;
        fetchBtn.textContent = '拉取中…';
        ai.listOllamaModels(base).then(function (r) {
          const models = (r && r.models) || [];
          pickList.innerHTML = '<option value="">请选择模型（共 ' + models.length + ' 个）</option>'
            + models.map(function (m) { return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>'; }).join('');
          pickList.disabled = !models.length;
          showToast(models.length ? '已获取 ' + models.length + ' 个 Ollama 模型' : '该 Ollama 服务暂无模型');
        }).catch(function (e) {
          pickList.innerHTML = '<option value="">获取失败，请检查地址与服务</option>';
          pickList.disabled = true;
          showToast('获取失败：' + ((e && e.message) || e));
        }).finally(function () {
          fetchBtn.disabled = false;
          fetchBtn.textContent = '获取模型列表';
        });
      });
      // 选中下拉项 → 填入模型名称输入框
      pickList.addEventListener('change', function () {
        if (pickList.value) ov.querySelector('[data-ai-form="model"]').value = pickList.value;
      });
      if (item) {
        provSel.value = item.provider || 'ollama';
        baseUrlInput.value = item.baseUrl || '';
        ov.querySelector('[data-ai-form="apiKey"]').value = item.apiKey || '';
        ov.querySelector('[data-ai-form="model"]').value = item.model || '';
        ov.querySelector('[data-ai-form="numCtx"]').value = item.numCtx ? Number(item.numCtx) : '';
      }
      syncOllamaPick();
      const close = function () { ov.remove(); };
      ov.querySelector('.ai-form-close').addEventListener('click', close);
      ov.querySelector('.ai-form-cancel').addEventListener('click', close);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
      ov.querySelector('.ai-form-save').addEventListener('click', function () {
        const m = {
          id: item ? item.id : genModelId(),
          provider: ov.querySelector('[data-ai-form="provider"]').value,
          baseUrl: ov.querySelector('[data-ai-form="baseUrl"]').value.trim(),
          apiKey: ov.querySelector('[data-ai-form="apiKey"]').value.trim(),
          model: ov.querySelector('[data-ai-form="model"]').value.trim(),
          numCtx: ov.querySelector('[data-ai-form="numCtx"]').value.trim() || '',
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

    /* 复制模型：克隆该模型配置（新 id）插入到原项之后，方便快速派生同供应商/同接口的新模型 */
    const duplicateModel = function (id) {
      const idx = aiModels.findIndex(function (m) { return m.id === id; });
      if (idx < 0) return;
      const src = aiModels[idx];
      const copy = Object.assign({}, src, { id: genModelId() });
      aiModels.splice(idx + 1, 0, copy);
      persist().then(function () { showToast('模型已复制：' + copy.model); }).catch(function () { showToast('保存失败'); });
    };

    // 读取配置并渲染本地字段 + 模型列表
    ai.getConfig().then(function (cfg) {
      if (!cfg) return;
      fillLocal(cfg);
      aiModels = (cfg.models && cfg.models.slice()) || [];
      currentModelId = cfg.currentModelId || (aiModels.length ? aiModels[0].id : '');
      renderModelList();
      // 配置加载完成（含持久化的刷新频率）后重启自动轮询定时器
      if (canTrack) startAutoRefresh();
      // 「自动加载」开关：切换时即时加载/卸载嵌入模型（持久化 + 立即生效）
      const autoEl = root.querySelector('[data-ai-cfg="autoLoadEmbedding"]');
      if (autoEl) {
        autoEl.addEventListener('change', function () {
          const on = autoEl.checked;
          persist().then(function () {
            if (!on) {
              // 关闭：saveConfig 已释放模型（this.embedder 置空），更新状态即可
              if (stEl) stEl.textContent = '未加载';
              showToast('启动自动加载已关闭，嵌入模型已卸载');
              return;
            }
            if (stEl) stEl.textContent = '加载中…';
            return ai.loadEmbedding().then(function (st) {
              if (stEl) stEl.textContent = st && st.embeddingLoaded ? '已加载' : '未加载';
              showToast(st && st.embeddingLoaded ? '嵌入模型已加载' : '嵌入模型加载失败');
            });
          }).catch(function (e) { showToast('保存失败：' + ((e && e.message) || e)); });
        });
      }
    }).catch(function () {});
    ai.getStatus().then(function (st) {
      if (idxEl) idxEl.textContent = ((st && st.chunks) || 0) + ' 片段';
      if (stEl) stEl.textContent = st && st.embeddingLoaded ? '已加载' : '未加载';
    }).catch(function () {});

    // 模型列表事件委托（加载/卸载/复制/编辑/删除 + 上下文修改）
    const listBox = document.getElementById('ai-model-list');
    if (listBox) {
      // 修改行内 num_ctx（change 事件不冒泡到 click，单独委托）
      listBox.addEventListener('change', function (e) {
        const ctxInp = e.target.closest('.ai-model-ctx');
        if (!ctxInp) return;
        const id = ctxInp.dataset.mid;
        const it = aiModels.find(function (m) { return m.id === id; });
        if (!it) return;
        const v = ctxInp.value.trim();
        it.numCtx = v ? Number(v) : '';
        persist().then(function () { showToast('上下文长度已更新'); }).catch(function () { showToast('保存失败'); });
      });
      listBox.addEventListener('click', function (e) {
        const refBtn = e.target.closest('.ai-model-refresh');
        const loadBtn = e.target.closest('.ai-model-load');
        const unloadBtn = e.target.closest('.ai-model-unload');
        const copyBtn = e.target.closest('.ai-model-copy');
        const editBtn = e.target.closest('.ai-model-edit');
        const delBtn = e.target.closest('.ai-model-del');
        if (refBtn) {
          const key = refBtn.dataset.baseUrl;
          const baseUrl = key === '(未设置地址)' ? '' : key;
          if (!baseUrl) { showToast('该组未设置接口地址'); return; }
          refreshOne(baseUrl).then(function (ok) {
            if (ok) {
              showToast('已刷新运行状态');
              if (document.getElementById('ai-model-list')) renderModelList();
            } else {
              showToast('刷新失败，请检查接口地址');
            }
          });
        } else if (loadBtn) {
          const it = aiModels.find(function (m) { return m.id === loadBtn.dataset.mid; });
          if (!it) return;
          showToast('正在加载模型：' + it.model + '…');
          ai.manageOllamaModel({ baseUrl: it.baseUrl, model: it.model, action: 'load', numCtx: it.numCtx })
            .then(function (r) {
              showToast((r && r.action === 'load' ? '模型已加载（常驻内存）' : '模型加载完成') + '：' + it.model);
              refreshOne(it.baseUrl).then(function () { if (document.getElementById('ai-model-list')) renderModelList(); });
            })
            .catch(function (e) { showToast('加载失败：' + ((e && e.message) || e)); });
        } else if (unloadBtn) {
          const it = aiModels.find(function (m) { return m.id === unloadBtn.dataset.mid; });
          if (!it) return;
          ai.manageOllamaModel({ baseUrl: it.baseUrl, model: it.model, action: 'unload' })
            .then(function () {
              showToast('模型已卸载（释放内存）：' + it.model);
              refreshOne(it.baseUrl).then(function () { if (document.getElementById('ai-model-list')) renderModelList(); });
            })
            .catch(function (e) { showToast('卸载失败：' + ((e && e.message) || e)); });
        } else if (copyBtn) {
          duplicateModel(copyBtn.dataset.mid);
        } else if (editBtn) {
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

    // 刷新频率变更：重启自动刷新定时器（值随「保存配置」按钮持久化到配置）
    const freqInp = root.querySelector('[data-ai-cfg="modelRefreshSec"]');
    if (freqInp) {
      freqInp.addEventListener('change', function () {
        const v = Math.max(1, parseInt(this.value, 10) || 10);
        this.value = v;
        startAutoRefresh();
      });
    }
    // 进入 AI 问答面板：立即刷新并启动自动轮询（无运行状态查询能力时跳过）
    if (canTrack) startAutoRefresh();
  }
