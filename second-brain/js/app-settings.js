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
    '常规': ['常规', '通用偏好与应用行为'],
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

  /* 文件类型 → 默认打开方式 映射表（后缀由插件注册，openers 来自命中 Provider）
   * 界面采用主从布局：左侧文件类型列表，右侧当前选中类型的识别模式与默认打开方式。
   * 作者: 火 冰 */
  function fileTypesHtml() {
    const pm = (typeof pluginManager !== 'undefined' && pluginManager) ? pluginManager : null;
    const exts = (pm && pm.getEditorExtensions) ? pm.getEditorExtensions() : [];
    if (!exts.length) {
      return '<div class="text-caption" style="color:var(--note-ink-3);">暂无可配置的文件类型（由插件注册编辑器后缀后出现）。</div>';
    }
    // 左侧文件类型列表项（首个默认选中）
    const items = exts.map(function (ext, i) {
      const on = i === 0 ? ' active' : '';
      return '<button type="button" class="ft-item' + on + '" data-ext="' + ext + '" style="display:block;width:100%;text-align:left;' + (on ? 'background:var(--note-brand-600);color:#FFF;' : 'color:var(--note-ink);') + '">'
        + '<span class="font-mono">*.' + ext + '</span></button>';
    }).join('');
    return '<div class="ft-panel flex gap-3">'
      + '<div class="ft-list w-44 shrink-0 rounded-lg border overflow-hidden" data-ft-list style="border-color:var(--note-border);">' + items + '</div>'
      + '<div class="ft-detail flex-1 rounded-lg border p-4" data-ft-detail style="border-color:var(--note-border);">' + renderFtDetail(exts[0]) + '</div>'
      + '</div>';
  }

  /* 渲染某个文件类型在右侧的详情：识别模式 + 来源 + 默认打开方式
   * @param {string} ext 文件后缀（不含点）
   * @returns {string} 详情 HTML */
  function renderFtDetail(ext) {
    const pm = (typeof pluginManager !== 'undefined' && pluginManager) ? pluginManager : null;
    const provs = (pm && pm.getEditorProviders) ? pm.getEditorProviders(ext) : [];
    const prov = provs[0];
    const openers = (prov && prov.openers) ? prov.openers : [];
    const src = (prov && prov.name) ? prov.name : '—';
    const saved = restoreS('openAs:' + ext, '');
    const opts = ['<option value="">跟随默认</option>'] // 空=跟随默认；首个 openable 常为「跟随默认」选择类型
      .concat(openers.map(function (o) {
        return '<option value="' + o.id + '"' + (String(o.id) === String(saved) ? ' selected' : '') + '>' + o.label + '</option>';
      })).join('');
    return '<div class="text-[14px] font-semibold mb-3" style="color:var(--note-ink);">文件类型：<span class="font-mono">*.' + esc(ext) + '</span></div>'
      + '<div class="text-caption mb-1.5" style="color:var(--note-ink-3);">识别扩展名模式</div>'
      + '<div class="font-mono text-[13px] rounded-md px-3 py-2 mb-4" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">*.' + esc(ext) + '</div>'
      + '<div class="flex items-center justify-between gap-4"><div class="flex-1"><div class="text-[13px]" style="color:var(--note-ink);">默认打开方式</div><div class="text-caption" style="color:var(--note-ink-3);">来源：' + esc(src) + '</div></div>'
      + '<select class="select-box shrink-0 ft-openSel" data-skey="openAs:' + esc(ext) + '">' + opts + '</select></div>';
  }

  /* ============================
   * 版本历史（设置-关于）
   * 数据源：js/changelog.js 暴露的全局 CHANGELOG（新→旧）。
   * ============================ */

  /** 全局版本历史数组（js/changelog.js 注入），无则回退空数组 */
  function changelog() {
    return (typeof window !== 'undefined' && window.CHANGELOG && window.CHANGELOG.length)
      ? window.CHANGELOG
      : [];
  }

  /** 当前版本号：取版本历史最新一条；无历史则回退默认 */
  function currentVersion() {
    const log = changelog();
    return (log.length ? log[0].version : '0.0.1');
  }

  /* 渲染版本历史时间线（新→旧），最大高度内可滚动 */
  function versionHistoryHtml() {
    const log = changelog();
    if (!log.length) return '<p class="text-caption" style="color:var(--note-ink-3);">暂无版本记录</p>';
    return '<div class="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">'
      + log.map(function (v) {
        const items = (v.items || []).map(function (it) {
          return '<li class="flex gap-2"><span class="shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full" style="background:var(--note-ink-3);"></span>'
            + '<span class="text-caption leading-relaxed" style="color:var(--note-ink-2);">' + esc(it) + '</span></li>';
        }).join('');
        const head = (v.title ? ' · ' + esc(v.title) : '');
        return '<div class="rounded-lg border p-3" style="border-color:var(--note-border);">'
          + '<div class="flex items-center justify-between gap-2 mb-1"><span class="text-[13px] font-semibold nums" style="color:var(--note-brand-600);">v' + esc(v.version) + head + '</span>'
          + '<span class="text-caption nums shrink-0" style="color:var(--note-ink-3);">' + esc(v.date || '') + '</span></div>'
          + '<ul class="flex flex-col gap-1">' + items + '</ul></div>';
      }).join('')
      + '</div>';
  }

  /* 各分类面板 HTML */
  function settingsPanelHtml(cat) {
    // 是否具备 Ollama 运行状态管理能力（桌面桥接才有），用于生成模型刷新频率等 UI
    const canManage = typeof (window.noteDesktop && window.noteDesktop.ai && window.noteDesktop.ai.manageOllamaModel) === 'function';
    if (cat === '常规') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group">'
        + '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">关闭按钮行为</div><div class="text-caption" style="color:var(--note-ink-3);">点击右上角 × 后，是退出程序、缩小到托盘，还是每次弹框选择</div></div><div class="relative"><select class="select-box" id="close-action" data-skey="closeAction"><option value="confirm">每次询问</option><option value="quit">直接退出</option><option value="tray">缩小到托盘</option></select></div></div>'
        + '</section>');
    }
    if (cat === '编辑器') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group"><h3 class="text-body font-semibold mb-4" style="color:var(--note-ink);">编辑基础</h3>'
        + '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">默认编辑模式</div><div class="text-caption" style="color:var(--note-ink-3);">打开笔记时的初始模式</div></div><div class="relative"><select class="select-box" data-skey="edMode"><option>编辑</option><option>预览</option></select></div></div>'
        + tgRow('自动保存', '编辑后自动写入磁盘', true, 'edAutoSave')
        + tgRow('显示行号', '编辑区左侧显示行号', true, 'lineNumbers')
        + tgRow('智能列表延续', '回车自动延续列表缩进', true, 'smartList')
        + '</section>'
        + '<section class="settings-group"><h3 class="text-body font-semibold mb-4" style="color:var(--note-ink);">文件类型</h3>'
        + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">不同后缀文件的默认打开方式（由插件注册）</div>'
        + fileTypesHtml()
        + '</section>');
    }
    if (cat === '快捷键') {
      return settingsPanel(cat, CATS[cat], shortcutPanelHTML());
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
        ? installed.map(pluginMgrItemHTML).join('')
        : '<p class="text-[13px] p-4" style="color:var(--note-ink-3);">尚未安装任何插件</p>';
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group"><div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">已安装插件</h3><span class="text-[11px] nums" style="color:var(--note-ink-3);">' + installed.length + ' 个</span></div>'
        + '<div class="rounded-lg border" style="border-color:var(--note-border);">' + list + '</div></section>');
    }
    if (cat === '关于') {
      const cl = changelog();
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group flex items-center gap-4"><div class="w-14 h-14 rounded-xl flex items-center justify-center" style="background:var(--note-brand-600);"><i data-lucide="brain" class="w-7 h-7" style="color:#FFFFFF;"></i></div>'
        + '<div><div class="text-h3 font-semibold" style="color:var(--note-ink);">第二脑</div><div class="text-caption" style="color:var(--note-ink-3);">版本 ' + esc(currentVersion()) + ' · Electron 桌面版</div></div></section>'
        + '<section class="settings-group"><p class="text-caption leading-relaxed" style="color:var(--note-ink-2);">一个本地优先的 Markdown 第二大脑，专注于快速记录、双向链接与知识图谱的流通。</p></section>'
        + '<section class="settings-group"><div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">版本历史</h3><span class="text-[11px] nums" style="color:var(--note-ink-3);">共 ' + cl.length + ' 个版本</span></div>' + versionHistoryHtml() + '</section>');
    }
    if (cat === 'AI 问答') {
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group" id="ai-sec-local">'
        + '<div class="flex items-center justify-between mb-4"><h3 class="text-body font-semibold" style="color:var(--note-ink);">本地模型</h3>'
        + '<span id="ai-cfg-status" class="text-[11px] px-2 py-0.5 rounded-full border" style="border-color:var(--note-border); color:var(--note-ink-3); background:var(--note-surface-2);">未加载</span></div>'
        // 模型下载目录：嵌入模型仓库下载落盘位置（默认 userData/models）
        + '<div class="border-t py-3" style="border-color:var(--note-border);">'
        + '<div class="text-[14px]" style="color:var(--note-ink);">模型下载目录</div>'
        + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">嵌入模型仓库下载落盘位置。默认：应用程序数据目录 / models</div>'
        + '<div class="flex items-center gap-2">'
        + '<input type="text" data-ai-cfg="modelDir" placeholder="应用程序数据目录 / models" class="flex-1 rounded-md px-3 py-2 text-[13px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">'
        + '<button data-model-ai="pick" class="flex items-center gap-1 px-2.5 py-2 rounded-md text-[12px] font-medium shrink-0" style="border:1px solid var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);"><i data-lucide="folder-open" class="w-3.5 h-3.5"></i>选择</button>'
        + '<button data-model-ai="reveal" class="flex items-center gap-1 px-2.5 py-2 rounded-md text-[12px] font-medium shrink-0" style="border:1px solid var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);"><i data-lucide="external-link" class="w-3.5 h-3.5"></i>打开</button>'
        + '</div></div>'
        // 嵌入式模型库：默认 4 个可下载模型
        + '<div class="border-t pt-4 mt-1" style="border-color:var(--note-border);">'
        + '<div class="text-[14px]" style="color:var(--note-ink);">嵌入式模型库</div>'
        + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">常用中文向量化模型，可下载到上方目录后点「使用」设为嵌入模型。</div>'
        + '<div id="ai-model-lib" class="flex flex-col gap-2"></div>'
        + '</div>'
        // 重排序模型库：默认 1 个可下载模型
        + '<div class="border-t pt-4 mt-1" style="border-color:var(--note-border);">'
        + '<div class="text-[14px]" style="color:var(--note-ink);">重排序模型库</div>'
        + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">用于检索结果精排，可下载到上方目录后点「使用」设为重排序模型。</div>'
        + '<div id="ai-rerank-lib" class="flex flex-col gap-2"></div>'
        + '</div>'
        + '<div class="rounded-lg border px-3 py-2.5 my-2.5 flex items-center justify-between gap-4" style="border-color:var(--note-border); background:var(--note-surface-2);">'
        + '<div><div class="text-[14px]" style="color:var(--note-ink);">自动加载</div>'
        + '<div class="text-caption" style="color:var(--note-ink-3);">应用启动时自动加载嵌入模型</div></div>'
        + '<label class="ai-switch shrink-0" title="应用启动时自动加载嵌入模型"><input type="checkbox" data-ai-cfg="autoLoadEmbedding"><span class="ai-switch-slider"></span></label></div>'
        + aiPathField('嵌入模型路径', '模型库点「使用」会以 {modelDir}/模型 变量填入；也可手动选择本地模型目录。{modelDir} 指上方下载目录，加载时自动展开为实际路径', 'embedModelPath', DEFAULT_AI_FIELDS.embedModelPath)
        + aiPathField('重排序模型路径', '模型库点「使用」会以 {modelDir}/模型 变量填入；也可手动选择本地模型目录。{modelDir} 指上方下载目录', 'rerankModelPath', DEFAULT_AI_FIELDS.rerankModelPath)
        + '<div class="border-t pt-4 mt-2" style="border-color:var(--note-border);">'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full" data-ai-saction="load" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="cpu" class="w-4 h-4"></i>加载嵌入模型</button></div>'
        + '</section>'
        + '<section class="settings-group" id="ai-sec-gen">'
        + '<div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">生成模型</h3>'
        + '<div class="flex items-center gap-2">'
        + (canManage ? '<label class="flex items-center gap-1 text-[11px] shrink-0" style="color:var(--note-ink-3);" title="自动刷新各组模型的运行状态（加载/卸载按钮随状态显示）">刷新频率<input type="number" min="1" max="3600" data-ai-cfg="modelRefreshSec" class="w-14 px-1.5 py-1 text-[11px] nums text-center rounded-md outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);">秒</label>' : '')
        + '<button class="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-medium" data-ai-saction="add" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="plus" class="w-3.5 h-3.5"></i>添加模型</button>'
        + '</div></div>'
        + '<div id="ai-model-list" class="rounded-lg border divide-y" style="border-color:var(--note-border);"></div>'
        + '<p class="text-caption mt-2" style="color:var(--note-ink-3);">支持配置多个生成模型（本地 Ollama / 远程 OpenAI 兼容），在问答页顶部切换。列表展示供应商与模型名称。</p>'
        + '</section>'
        + '<section class="settings-group" id="ai-sec-index">'
        + '<div class="flex items-center justify-between mb-3"><h3 class="text-body font-semibold" style="color:var(--note-ink);">知识库索引</h3><span id="ai-index-status" class="text-[11px] nums" style="color:var(--note-ink-3);">0 片段</span></div>'
        + '<p class="text-caption mb-4" style="color:var(--note-ink-3);">把笔记库全部 Markdown 切分并向量化，供语义检索使用。</p>'
        + '<div class="border-t pt-3 mb-1"><div class="text-[14px]" style="color:var(--note-ink);">索引分块默认参数</div><div class="text-caption mb-2" style="color:var(--note-ink-3);">未单独设置的笔记，按此参数生成索引块。</div>'
        + '<div class="grid grid-cols-2 gap-2">'
        + '<div><div class="text-caption mb-1" style="color:var(--note-ink-3);">块大小（字符）</div><input type="number" min="1" data-ai-cfg="blockSize" class="w-full rounded-md px-3 py-2 text-[13px] nums outline-none" placeholder="200" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '<div><div class="text-caption mb-1" style="color:var(--note-ink-3);">相邻重叠（字符）</div><input type="number" min="0" data-ai-cfg="overlap" class="w-full rounded-md px-3 py-2 text-[13px] nums outline-none" placeholder="40" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '</div>'
        + '<div class="mt-2 grid grid-cols-2 gap-2">'
        + '<div><div class="text-caption mb-1" style="color:var(--note-ink-3);">单块长度上限（字符）</div><input type="number" min="0" data-ai-cfg="maxChunkSize" class="w-full rounded-md px-3 py-2 text-[13px] nums outline-none" placeholder="300" title="全局统一；0 或留空表示不限制；>0 时每块的宽度不超过块大小与该值的较小者，避免单块过长" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>'
        + '</div></div>'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full" data-ai-saction="rebuild" style="background:var(--note-brand-600); color:#FFFFFF;"><i data-lucide="refresh-cw" class="w-4 h-4"></i>重建索引</button>'
        + '<button class="flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium w-full border mt-2" data-ai-saction="save" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);"><i data-lucide="save" class="w-4 h-4"></i>保存配置</button>'
        + '</section>');
    }
    return '';
  }

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
    // Ribbon 最大显示数量（仅 RibbonManager 存在时生效）
    var ribbonSlider = document.getElementById('ribbon-max-slider');
    var ribbonLabel = document.getElementById('ribbon-max-label');
    if (ribbonSlider && typeof RibbonManager !== 'undefined' && RibbonManager) {
      // 恢复保存的值
      ribbonSlider.value = RibbonManager.getMaxButtons();
      if (ribbonLabel) ribbonLabel.textContent = ribbonSlider.value;
      ribbonSlider.addEventListener('input', function () {
        var n = parseInt(this.value, 10);
        if (ribbonLabel) ribbonLabel.textContent = n;
        RibbonManager.setMaxButtons(n);
      });
    } else if (ribbonSlider) {
      // 降级：纯 DOM 行为
      ribbonSlider.addEventListener('input', function () {
        if (ribbonLabel) ribbonLabel.textContent = this.value;
      });
    }
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
    if (key.indexOf('openAs:') === 0) { const ext = key.slice(7); return ext ? '默认打开方式已更新：' + ext : null; }
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
    // 输入控件（checkbox / select / range）——文件类型明细区的 select 由 bindFileTypes 单独绑定
    box.querySelectorAll('[data-skey]').forEach(el => {
      if (el.classList.contains('density-opt')) return;
      if (el.classList.contains('ft-openSel')) return;
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
    // 文件类型主从布局：左侧切换 + 右侧打开方式保存
    bindFileTypes(box);
  }

  /* 绑定「关闭按钮行为」下拉（#close-action）：
   * 值由 Electron 主进程持久化并裁决（渲染进程 localStorage 主进程读不到），
   * 因此渲染时从主进程读取填充，变更时写回主进程。web 模式无主进程则静默降级。
   * @param {HTMLElement} content 设置面板容器
   * @author 火 冰 */
  function bindCloseAction(content) {
    const sel = content && content.querySelector ? content.querySelector('#close-action') : null;
    if (!sel) return;
    const nd = window.noteDesktop || {};
    if (nd && nd.getCloseAction) {
      nd.getCloseAction().then(function (v) {
        if (['confirm', 'quit', 'tray'].indexOf(v) === -1) v = 'confirm';
        sel.value = v;
      }).catch(function () { /* 主进程不可用则保持默认 confirm */ });
    }
    sel.addEventListener('change', function () {
      const v = sel.value;
      if (nd && nd.setCloseAction) {
        nd.setCloseAction(v).then(function (ok) {
          if (ok) showToast('关闭按钮行为已更新');
          else showToast('保存失败');
        }).catch(function () { /* web 模式忽略 */ });
      } else {
        showToast('桌面版才能调整关闭按钮行为');
      }
    });
  }

  /* 文件类型（编辑器分类）主从交互：左侧选择后缀 → 重建右侧明细，
   * 明细内打开方式下拉单独绑定保存（openAs:<ext>）。
   * @param {HTMLElement} box 设置面板容器 */
  function bindFileTypes(box) {
    const list = (box && box.querySelector) ? box.querySelector('.ft-list') : null;
    const detail = (box && box.querySelector) ? box.querySelector('.ft-detail') : null;
    if (!list || !detail) return;
    // 绑定明细内打开方式下拉：恢复已存值 + 变更保存 + 副作用提示
    const bindSel = function (sel) {
      if (!sel) return;
      const key = sel.dataset.skey;
      sel.value = restoreS(key, sel.value);
      sel.addEventListener('change', function () {
        saveS(key, this.value);
        const m = settingsSideEffect(key, this.value);
        if (m) showToast(m);
      });
    };
    bindSel(detail.querySelector('.ft-openSel'));
    // 左侧列表点击切换
    const items = list.querySelectorAll('.ft-item');
    Array.prototype.forEach.call(items, function (item) {
      item.addEventListener('click', function () {
        if (item.classList.contains('active')) return;
        Array.prototype.forEach.call(items, function (i) { i.classList.remove('active'); });
        item.classList.add('active');
        item.style.background = 'var(--note-brand-600)';
        item.style.color = '#FFF';
        Array.prototype.forEach.call(items, function (i) {
          if (!i.classList.contains('active')) { i.style.background = 'transparent'; i.style.color = 'var(--note-ink)'; }
        });
        detail.innerHTML = renderFtDetail(item.dataset.ext);
        bindSel(detail.querySelector('.ft-openSel'));
      });
    });
  }

  /* 渲染快捷键分类面板：内置+插件命令列表（注册表驱动），每行含当前键位 + 设置/清除 */
  function shortcutPanelHTML() {
    let binds = [];
    if (typeof kbGetBinds === 'function') binds = kbGetBinds();
    let rows = '';
    binds.forEach(function (b) {
      const badge = b.pluginId ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-medium ml-2 shrink-0" style="background:var(--note-surface); color:var(--note-brand);">' + esc(b.pluginId) + '</span>' : '';
      rows += '<div class="flex items-center justify-between px-4 py-3 border-t" style="border-color:var(--note-border);">'
        + '<div class="flex items-center gap-2 min-w-0"><span class="text-[13px] truncate" style="color:var(--note-ink);">' + esc(b.label) + '</span>' + badge + '</div>'
        + '<div class="flex items-center gap-2 shrink-0 ml-3">'
        + '<kbd data-kb-kbd="' + esc(b.id) + '" class="text-[11px] px-2 py-1 rounded font-mono" style="background:var(--note-surface-2); color:var(--note-ink-2);">' + esc(b.combo || '未设置') + '</kbd>'
        + (b.keybindable
          ? '<button data-kb-record="' + esc(b.id) + '" class="px-2 py-1 rounded-md text-caption border hover:opacity-80" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">设置</button>'
            + '<button data-kb-clear="' + esc(b.id) + '" class="px-2 py-1 rounded-md text-caption border hover:opacity-80" style="border-color:var(--note-border); color:var(--note-ink-3); background:transparent;">清除</button>'
          : '')
        + '</div></div>';
    });
    if (!binds.length) {
      rows = '<div class="px-4 py-6 text-center text-caption" style="color:var(--note-ink-3);">暂无可用命令。</div>';
    }
    return '<section class="settings-group"><div class="flex items-center justify-between mb-2"><h3 class="text-body font-semibold" style="color:var(--note-ink);">快捷键</h3><button class="px-3 py-1.5 rounded-md text-caption border hover:opacity-80" data-saction="reset-shortcuts" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">恢复默认</button></div>'
      + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">点击「设置」后按下新组合键（建议带 Ctrl/Alt/Shift）；「清除」恢复默认。</div>'
      + '<div class="rounded-lg border overflow-hidden" style="border-color:var(--note-border);">' + rows + '</div></section>';
  }

  /* 绑定快捷键面板的「设置/清除」交互：设置进入捕获态，监听一次 keydown 后写入注册表 */
  function bindShortcuts(root) {
    const box = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!box || typeof kbSetBind !== 'function' || typeof kbClearBind !== 'function') return;
    box.querySelectorAll('[data-kb-record]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.kbRecord;
        const oldText = btn.textContent;
        btn.textContent = '按下组合键…';
        const done = function (e) {
          // 捕获任意按键，但过滤纯修饰键（Ctrl/Alt/Shift 单独按下无意义）
          const pure = e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta';
          if (pure) { e.preventDefault(); return; }
          // 组装组合串：优先主键大写形式
          const keyPart = (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.key);
          const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + keyPart;
          const r = kbSetBind(id, combo);
          if (r && r.ok) showToast('已绑定：' + combo);
          else if (r && r.conflictId) showToast('快捷键已被其它命令占用');
          else showToast('绑定失败');
          btn.textContent = oldText;
          document.removeEventListener('keydown', done, true);
          refreshShortcutKbd(id);
          switchSettings('快捷键'); // 刷新列表展示
        };
        document.addEventListener('keydown', done, true);
      });
    });
    box.querySelectorAll('[data-kb-clear]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.kbClear;
        kbClearBind(id);
        showToast('已清除，恢复默认');
        switchSettings('快捷键');
      });
    });
  }

  /* 刷新单条命令的键位 <kbd> 文案 */
  function refreshShortcutKbd(id) {
    const kbd = document.querySelector('[data-kb-kbd="' + id + '"]');
    if (kbd && typeof kbResolveBind === 'function') kbd.textContent = kbResolveBind(id) || '未设置';
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
        else if (act === 'reset-shortcuts') {
          if (typeof kbResetAll === 'function') kbResetAll();
          showToast('快捷键已恢复默认');
          switchSettings('快捷键'); // 重新渲染生效列表
        }
        else if (act === 'uninstall') {
          const name = btn.dataset.uninstall;
          const p = pluginData.find(x => x.name === name);
          if (p) { p.installed = false; showToast('已卸载插件：' + name); switchSettings('插件管理'); }
        }
      });
    });
  }

  /* ---------- 插件管理：二级展开 + 独立设置 ---------- */

  /**
   * 根据插件 manifest 声明的 settings 模式生成配置表单 HTML（含初始值）
   * 支持类型：toggle（开关）/ select（下拉）/ text（输入框，默认兜底）
   * @param {string} pid 插件 id
   * @param {Array<{key:string,label:string,type:string,sub?:string,options?:Array,default?:*}>} fields 设置模式
   * @returns {string} 表单 HTML
   */
  function renderSchemaForm(pid, fields) {
    if (!Array.isArray(fields) || fields.length === 0) return '';
    return fields.map(function (f) {
      const s = localStorage.getItem('plugin:' + pid + ':' + f.key);
      const base = 'data-pid="' + esc(pid) + '" data-pkey="' + esc(f.key) + '"';
      const sub = f.sub ? '<div class="text-caption" style="color:var(--note-ink-3);">' + f.sub + '</div>' : '';
      if (f.type === 'toggle') {
        const on = s === null ? !!f.default : (s === 'true');
        return '<div class="flex items-center justify-between py-3 border-t" style="border-color:var(--note-border);"><div class="flex-1 pr-4"><div class="text-[13px]" style="color:var(--note-ink);">' + f.label + '</div>' + sub + '</div><label class="toggle shrink-0"><input type="checkbox" ' + base + (on ? ' checked' : '') + '><span class="toggle-track"></span></label></div>';
      }
      if (f.type === 'select') {
        const val = s === null ? (f.default || '') : s;
        const opts = (f.options || []).map(function (o) { return '<option' + (String(o) === String(val) ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
        return '<div class="flex items-center justify-between gap-4 py-3 border-t" style="border-color:var(--note-border);"><div class="flex-1 pr-4"><div class="text-[13px]" style="color:var(--note-ink);">' + f.label + '</div>' + sub + '</div><select class="select-box shrink-0" ' + base + '>' + opts + '</select></div>';
      }
      if (f.type === 'color') {
        const val = s === null ? (f.default || '#000000') : s;
        const shown = /^#[0-9a-fA-F]{3,8}$/.test(val) ? val : '#000000';
        return '<div class="flex items-center justify-between gap-4 py-3 border-t" style="border-color:var(--note-border);"><div class="flex-1 pr-4"><div class="text-[13px]" style="color:var(--note-ink);">' + f.label + '</div>' + sub + '</div><input type="color" ' + base + ' value="' + esc(shown) + '" class="shrink-0 rounded-md" title="' + esc(val) + '" style="width:44px;height:30px;padding:2px;background:var(--note-surface-2);border:1px solid var(--note-border);cursor:pointer;"></div>';
      }
      // 默认：text 输入框
      const val = s === null ? (f.default || '') : s;
      return '<div class="py-3 border-t" style="border-color:var(--note-border);"><div class="text-[13px] mb-1" style="color:var(--note-ink);">' + f.label + '</div>' + sub
        + '<input type="text" ' + base + ' value="' + esc(val) + '" class="w-full rounded-md px-3 py-2 text-[13px] outline-none" style="background:var(--note-surface-2); border:1px solid var(--note-border); color:var(--note-ink);"></div>';
    }).join('');
  }

  /**
   * 生成一个已安装插件在「插件管理」中的二级展开条目 HTML：
   *   头部 = 图标 + 名称 + 状态徽章（冲突/异常）+ 启用开关（可点击展开）
   *   展开 = 基本设置（启用信息 / 显示位置 / 卸载）+ 插件独立设置（settings 模式）
   * @param {Object} p 已安装插件对象（含 settings 模式、__conflicts 等）
   * @returns {string} 条目 HTML
   */
  function pluginMgrItemHTML(p) {
    const enabled = isPluginEnabled(p.id);
    const conflicts = p.__conflicts || [];
    const errMsg = errorForPlugin(p.id);
    let badge = '';
    if (p.system) badge += '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" style="background:var(--note-brand-600); color:#FFF;">系统</span>';
    if (conflicts.length) badge += '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" title="' + esc(conflicts.map(function (c) { return c.b + ' 同时占用 ' + c.key; }).join('\n')) + '" style="background:rgba(245,158,11,0.15); color:#F59E0B;">冲突×' + conflicts.length + '</span>';
    if (errMsg) badge += '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" title="' + esc(errMsg) + '" style="background:rgba(239,68,68,0.15); color:#EF4444;">异常</span>';
    if (p.version) badge += '<span class="text-[10px] px-1.5 py-0.5 rounded-full shrink-0" title="插件版本" style="background:var(--note-surface-2); color:var(--note-ink-2); border:1px solid var(--note-border);">v' + esc(p.version) + '</span>';
    const locParts = [];
    if (p.toolbar) locParts.push('顶栏按钮');
    if (p.ribbon) locParts.push('侧栏图标');
    /* 权限信息：显示位置 + 扩展点申请（命令 / 右键菜单 / 编辑器扩展） */
    const permRows = [];
    if (locParts.length) permRows.push(['显示位置', locParts.join('、')]);
    const cm = p.contextMenus ? Object.keys(p.contextMenus) : [];
    if (cm.length) permRows.push(['右键菜单', cm.join('、')]);
    if (p.editor && p.editor.extensions && p.editor.extensions.length) permRows.push(['编辑器扩展', p.editor.extensions.join('、')]);
    if (!permRows.length && !(p.commands && p.commands.length)) permRows.push(['扩展点', '命令面板 / 右键菜单']);
    /* 命令：可折叠列表，默认收起（行含条数 + chevron，点击展开命令详情） */
    let cmdsHtml = '';
    if (p.commands && p.commands.length) {
      cmdsHtml = '<div class="border-t" style="border-color:var(--note-border);">'
        + '<button type="button" data-pm-cmd-toggle data-pid="' + esc(p.id) + '" class="flex w-full items-center justify-between py-2.5 gap-4 text-left hover:opacity-80" aria-expanded="false">'
        + '<span class="text-[13px]" style="color:var(--note-ink);">命令</span>'
        + '<span class="flex items-center gap-1.5"><span class="text-caption" style="color:var(--note-ink-3);">' + p.commands.length + ' 条</span><i data-lucide="chevron-down" class="pm-cmd-caret w-4 h-4 transition-transform" style="color:var(--note-ink-3);"></i></span>'
        + '</button>'
        + '<div class="pm-cmdlist hidden" data-pm-cmdlist data-pid="' + esc(p.id) + '">'
        + p.commands.map(function (c) {
          return '<div class="flex items-center gap-2 py-1.5 pl-1"><i data-lucide="' + esc(c.icon || 'command') + '" class="w-3.5 h-3.5 shrink-0" style="color:var(--note-ink-3);"></i><span class="text-[12px]" style="color:var(--note-ink-2);user-select:text;">' + esc(c.label || c.actionKey || '') + '</span></div>';
        }).join('')
        + '</div></div>';
    }
    const hasScheme = Array.isArray(p.settings) && p.settings.length;
    return '<div class="border-t" style="border-color:var(--note-border);">'
      + '<div class="flex items-center gap-2.5 px-4 py-3">'
      + '<button type="button" data-pm-expand data-pid="' + esc(p.id) + '" class="flex items-center gap-2.5 shrink-0 text-left hover:opacity-90" title="展开/收起设置">'
      + '<i data-lucide="chevron-right" class="pm-caret w-4 h-4 shrink-0 transition-transform" style="color:var(--note-ink-3);"></i>'
      + '<div class="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style="background:' + p.color + '; border-radius: var(--note-radius-md);"><i data-lucide="' + p.icon + '" class="w-4 h-4" style="color:#FFFFFF;"></i></div>'
      + '</button>'
      + '<span class="flex-1 min-w-0" title="' + esc(p.name) + '"><span class="block text-[13px] truncate" style="color:var(--note-ink);user-select:text;">' + p.name + '</span>'
      + '<span class="block text-caption truncate" style="color:var(--note-ink-3);user-select:text;">' + esc(p.desc) + '</span></span>'
      + badge
      + '<label class="toggle shrink-0" title="启用/停用插件"><input type="checkbox" data-pm-enable data-pid="' + esc(p.id) + '"' + (enabled ? ' checked' : '') + (p.system ? ' disabled' : '') + '><span class="toggle-track"></span></label>'
      + '</div>'
      + '<div class="pm-body hidden px-4 pb-4" data-pm-body="' + esc(p.id) + '">'
      + '<section class="rounded-lg border px-4" style="border-color:var(--note-border);">'
      + '<div class="text-[13px] font-semibold pt-3" style="color:var(--note-ink);">基本信息</div>'
      + '<div class="py-2.5 border-t" style="border-color:var(--note-border);"><div class="text-[13px] mb-0.5" style="color:var(--note-ink);">插件描述</div><div class="text-caption leading-relaxed" style="color:var(--note-ink-3);">' + esc(p.desc || '—') + '</div></div>'
      + '<div class="flex items-center justify-between py-2.5 border-t gap-4" style="border-color:var(--note-border);"><div class="text-[13px] shrink-0" style="color:var(--note-ink);">插件版本</div><span class="text-caption nums text-right" style="color:var(--note-ink-3);">' + (p.version ? 'v' + esc(p.version) : '—') + '</span></div>'
      + permRows.map(function (r) { return '<div class="flex items-center justify-between py-2.5 border-t gap-4" style="border-color:var(--note-border);"><div class="text-[13px] shrink-0" style="color:var(--note-ink);">' + r[0] + '</div><span class="text-caption truncate text-right" style="color:var(--note-ink-3);">' + esc(String(r[1])) + '</span></div>'; }).join('')
      + cmdsHtml
      + '<div class="flex items-center justify-between py-2.5 border-t" style="border-color:var(--note-border);"><div class="text-[13px]" style="color:var(--note-ink);">启用状态</div><span class="text-caption nums" style="color:' + (enabled ? 'var(--state-success)' : 'var(--note-ink-3)') + ';">' + (enabled ? '已启用' : '已停用') + '</span></div>'
      + (p.system
        ? '<div class="flex items-center justify-center gap-1.5 py-2 rounded-md text-[12px] my-3" style="background:var(--note-surface-2); color:var(--note-ink-3); border:1px dashed var(--note-border);"><i data-lucide="shield-check" class="w-4 h-4"></i>系统内置插件，不可卸载</div>'
        : '<button data-pm-uninstall data-pid="' + esc(p.id) + '" class="flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium w-full my-3" style="background:var(--note-surface-2); color:var(--note-ink-2); border:1px solid var(--note-border);"><i data-lucide="trash-2" class="w-4 h-4"></i>卸载插件</button>')
      + '</section>'
      + (hasScheme
        ? '<section class="rounded-lg border px-4 mt-3" style="border-color:var(--note-border);"><div class="text-[13px] font-semibold pt-3" style="color:var(--note-ink);">插件设置</div>' + renderSchemaForm(p.id, p.settings) + '<div class="h-2"></div></section>'
        : '')
      + '</div></div>';
  }

  /**
   * 绑定「插件管理」面板交互：
   *   - 二级展开/收起（data-pm-expand + data-pm-body）
   *   - 启用/停用开关（data-pm-enable，含沙箱过滤刷新）
   *   - 卸载按钮（data-pm-uninstall，联动 pluginManager）
   *   - schema 设置项变更（data-pid + data-pkey → PluginAPI.setSetting）
   * @param {Element|string} root 面板根节点或选择器
   */
  function bindPluginManager(root) {
    const box = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!box) return;
    if (typeof refreshIcons === 'function') refreshIcons();

    box.querySelectorAll('[data-pm-expand]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const pid = btn.dataset.pid;
        const body = box.querySelector('[data-pm-body="' + pid + '"]');
        if (!body) return;
        const open = body.classList.toggle('hidden');
        const caret = btn.querySelector('.pm-caret');
        if (caret) caret.style.transform = open ? '' : 'rotate(90deg)';
      });
    });

    box.querySelectorAll('[data-pm-enable]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        setPluginEnabled(cb.dataset.pid, cb.checked);
        showToast(cb.checked ? '已启用插件' : '已停用插件');
      });
    });

    box.querySelectorAll('[data-pm-cmd-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const pid = btn.dataset.pid;
        const list = box.querySelector('[data-pm-cmdlist][data-pid="' + pid + '"]');
        if (!list) return;
        const open = !list.classList.contains('hidden');
        list.classList.toggle('hidden');
        const caret = btn.querySelector('.pm-cmd-caret');
        if (caret) caret.style.transform = open ? '' : 'rotate(180deg)';
        btn.setAttribute('aria-expanded', String(!open));
      });
    });

    box.querySelectorAll('[data-pm-uninstall]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const pid = btn.dataset.pid;
        const p = pluginData.find(function (x) { return x.id === pid; });
        if (!p) return;
        p.installed = false;
        if (typeof pluginManager !== 'undefined' && pluginManager) pluginManager.uninstall(pid);
        showToast('已卸载插件：' + p.name);
        switchSettings('插件管理');
      });
    });

    box.querySelectorAll('[data-pid][data-pkey]').forEach(function (el) {
      el.addEventListener('change', function () {
        const val = (el.type === 'checkbox') ? el.checked : el.value;
        if (typeof PluginAPI !== 'undefined' && PluginAPI && PluginAPI.setSetting) {
          PluginAPI.setSetting(el.dataset.pid, el.dataset.pkey, val);
          showToast('已保存插件设置');
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
    if (cat === '插件管理') bindPluginManager(content);
    bindKeyedControls(content);
    bindCloseAction(content);
    bindActionButtons(content);
    bindShortcuts(content);
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

    // 初始分类高亮：视图标记 data-active="1" 的分类默认选中（无则不高亮任何分类）
    document.querySelectorAll('.settings-cat[data-active="1"]').forEach(c => c.classList.add('active'));

    // 分类切换：未激活分类点击 → 切换面板并展开其子菜单（若有）；已激活分类再点击 → 仅展开/收起二级菜单，不刷新内容
    document.querySelectorAll('.settings-cat').forEach(cat => {
      cat.addEventListener('click', function () {
        const isActive = this.classList.contains('active');
        const subs = document.querySelectorAll('.settings-subcat[data-cat="' + this.dataset.cat + '"]');
        if (!isActive) {
          document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
          document.querySelectorAll('.settings-subcat').forEach(s => s.classList.remove('active'));
          this.classList.add('active');
          // 切换时收起其余分类已展开的子菜单
          document.querySelectorAll('.settings-cat.sub-open').forEach(c => {
            if (c !== this) {
              document.querySelectorAll('.settings-subcat[data-cat="' + c.dataset.cat + '"]').forEach(s => s.classList.add('hidden'));
              c.classList.remove('sub-open');
            }
          });
          if (subs.length) {
            subs.forEach(s => s.classList.remove('hidden'));
            this.classList.add('sub-open');
          }
          switchSettings(this.dataset.cat);
        } else if (subs.length) {
          // 已激活且含子菜单：仅 toggle 展开/收起，不重复渲染内容区
          const anyVisible = [...subs].some(s => !s.classList.contains('hidden'));
          subs.forEach(s => s.classList.toggle('hidden', anyVisible));
          this.classList.toggle('sub-open', !anyVisible);
        }
      });
    });

    // 二级子菜单：切换到所属分类并平滑滚动定位到对应区块
    document.querySelectorAll('.settings-subcat').forEach(sub => {
      sub.addEventListener('click', function () {
        document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.settings-subcat').forEach(s => s.classList.remove('active'));
        this.classList.add('active');
        const main = document.querySelector('.settings-cat[data-cat="' + this.dataset.cat + '"]');
        if (main) main.classList.add('active');
        // 点击子项时确保其所属子菜单展开
        document.querySelectorAll('.settings-subcat[data-cat="' + this.dataset.cat + '"]').forEach(s => s.classList.remove('hidden'));
        if (main) main.classList.add('sub-open');
        switchSettings(this.dataset.cat);
        // 定位到锚点区块：目标区块上方可滚动空间足够（区块下方剩余高度 ≥ 可视高度）则对齐区块顶部；
        // 剩余不足则滚到底（scrollTop = 全部高度 - 可视高度），不依赖底部占位撑高。
        // 以 200ms 间隔持续校正（共 12 次 ≈2.4s，覆盖内容异步撑高）；滚到底或已贴近顶部即提前结束
        const scrollToTarget = function () {
          const target = document.getElementById(sub.dataset.scroll);
          const cont = document.getElementById('settings-content');
          if (!target || !cont) return false;
          const maxScrollTop = cont.scrollHeight - cont.clientHeight;
          const y = target.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop;
          const want = Math.max(0, y - 32); // 区块对齐容器顶部所需滚动偏移（32 = 内容顶部 padding）
          if (want >= maxScrollTop) { cont.scrollTop = maxScrollTop; return true; } // 剩余不足 → 滚到底
          cont.scrollTop = want;
          const top = target.getBoundingClientRect().top - cont.getBoundingClientRect().top;
          return top >= 0 && top < 60;
        };
        scrollToTarget();
        let retry = 0;
        const timer = setInterval(function () {
          retry++;
          if (scrollToTarget()) { clearInterval(timer); return; }
          if (retry >= 12) clearInterval(timer);
        }, 200);
      });
    });

    bindAppearance();
    // 初次显示的外观面板也需绑定通用控件与动作按钮（其余分类由 switchSettings 绑定）
    bindKeyedControls(document.querySelector('#settings-content > div'));
    bindActionButtons(document.querySelector('#settings-content > div'));
  }
