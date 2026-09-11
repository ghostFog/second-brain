/* ============================================
 * 第二脑 — 设置视图·面板 HTML
 * 作者: 火 冰
 * 功能: 各分类设置面板 HTML 生成（常规/编辑器/快捷键/同步与备份/隐私与安全/插件管理/关于/AI 问答）、
 *       文件类型主从明细、版本历史（设置-关于）
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）；
 *       依赖 settings-shortcuts 的 shortcutPanelHTML、settings-plugins 的 pluginMgrItemHTML、
 *       settings-ai 的 aiPathField/AI_EMBED_LIB/AI_RERANK_LIB/DEFAULT_AI_FIELDS
 * ============================================ */

'use strict';

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
      // 「外观」内容已并入「常规」（ST-33）：主题/强调色/字体/密度/Ribbon/其他 + 关闭按钮行为
      return settingsPanel(cat, CATS[cat],
        '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">通用</h3>'
        + '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">关闭按钮行为</div><div class="text-caption" style="color:var(--note-ink-3);">点击右上角 × 后，是退出程序、缩小到托盘，还是每次弹框选择</div></div><div class="relative"><select class="select-box" id="close-action" data-skey="closeAction"><option value="confirm">每次询问</option><option value="quit">直接退出</option><option value="tray">缩小到托盘</option></select></div></div>'
        + '</section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">主题模式</h3>'
        + '<div class="grid grid-cols-3 gap-3">'
        + '<div class="theme-card" data-theme-mode="dark"><div class="mb-3"><div class="w-full h-16 rounded-md overflow-hidden flex" style="border: 1px solid var(--note-border);"><div class="flex-1" style="background: #1E1E2E;"></div><div style="width: 30%; background: #2D2D3F;"></div></div></div><div class="flex items-center justify-between"><span class="text-[14px]" style="color: var(--note-ink);">深色</span><i data-lucide="check" class="theme-card-check w-4 h-4" style="color: var(--note-brand-600);"></i></div></div>'
        + '<div class="theme-card" data-theme-mode="light"><div class="mb-3"><div class="w-full h-16 rounded-md overflow-hidden flex" style="border: 1px solid var(--note-border);"><div class="flex-1" style="background: #FFFFFF;"></div><div style="width: 30%; background: #F7F7FA;"></div></div></div><div class="flex items-center justify-between"><span class="text-[14px]" style="color: var(--note-ink-2);">浅色</span><i data-lucide="check" class="theme-card-check w-4 h-4" style="color: var(--note-brand-600); display: none;"></i></div></div>'
        + '<div class="theme-card" data-theme-mode="auto"><div class="mb-3"><div class="w-full h-16 rounded-md overflow-hidden flex" style="border: 1px solid var(--note-border);"><div class="flex-1" style="background: linear-gradient(90deg, #1E1E2E 50%, #FFFFFF 50%);"></div><div style="width: 30%; background: linear-gradient(90deg, #2D2D3F 50%, #F7F7FA 50%);"></div></div></div><div class="flex items-center justify-between"><span class="text-[14px]" style="color: var(--note-ink-2);">跟随系统</span><i data-lucide="check" class="theme-card-check w-4 h-4" style="color: var(--note-brand-600); display: none;"></i></div></div>'
        + '</div></section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">强调色</h3>'
        + '<p class="text-caption mb-4" style="color: var(--note-ink-3);">选择应用主色调，影响按钮、链接和高亮元素。</p>'
        + '<div class="flex items-center gap-4 flex-wrap">'
        + '<div class="color-dot" data-accent="#7C3AED" style="background: #7C3AED;"></div>'
        + '<div class="color-dot" data-accent="#3B82F6" style="background: #3B82F6;"></div>'
        + '<div class="color-dot" data-accent="#22C55E" style="background: #22C55E;"></div>'
        + '<div class="color-dot" data-accent="#F97316" style="background: #F97316;"></div>'
        + '<div class="color-dot" data-accent="#EF4444" style="background: #EF4444;"></div>'
        + '<div class="color-dot" data-accent="#EC4899" style="background: #EC4899;"></div>'
        + '</div></section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">字体设置</h3>'
        + '<div class="mb-6"><div class="flex items-center justify-between mb-3"><div><div class="text-[14px]" style="color: var(--note-ink);">字体大小</div><div class="text-caption" style="color: var(--note-ink-3);">调整编辑器正文的字号</div></div><span id="font-size-label" class="text-mono nums px-2 py-0.5 rounded" style="background: var(--note-surface-2); color: var(--note-ink);">15px</span></div>'
        + '<div class="flex items-center gap-3"><span class="text-caption" style="color: var(--note-ink-3);">14</span><input id="font-size-slider" type="range" min="14" max="18" value="15" class="range-slider flex-1"><span class="text-caption" style="color: var(--note-ink-3);">18</span></div></div>'
        + '<div class="mb-4"><div class="flex items-center justify-between gap-4 flex-wrap"><div class="flex-1 min-w-[120px]"><div class="text-[14px]" style="color: var(--note-ink);">字体族</div><div class="text-caption" style="color: var(--note-ink-3);">编辑器正文使用的字体</div></div><div class="relative"><select id="font-family-select" class="select-box"><option>Inter</option><option>Noto Sans SC</option><option>系统默认</option></select><i data-lucide="chevron-down" class="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--note-ink-3);"></i></div></div></div>'
        + '<div><div class="flex items-center justify-between gap-4 flex-wrap"><div class="flex-1 min-w-[120px]"><div class="text-[14px]" style="color: var(--note-ink);">代码字体</div><div class="text-caption" style="color: var(--note-ink-3);">代码块使用的等宽字体</div></div><div class="relative"><select id="font-mono-select" class="select-box"><option>JetBrains Mono</option><option>Fira Code</option><option>Cascadia Code</option></select><i data-lucide="chevron-down" class="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style="color: var(--note-ink-3);"></i></div></div></div>'
        + '</section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">界面密度</h3>'
        + '<p class="text-caption mb-4" style="color: var(--note-ink-3);">调整界面元素的间距与紧凑程度。</p>'
        + '<div class="grid grid-cols-3 gap-3">'
        + '<div class="density-opt" data-skey="density" data-value="紧凑"><div class="flex items-center gap-2 mb-1"><span class="density-radio"></span><span class="text-[14px]" style="color: var(--note-ink);">紧凑</span></div><p class="text-caption" style="color: var(--note-ink-3);">更小的间距，适合小屏幕</p></div>'
        + '<div class="density-opt" data-skey="density" data-value="标准" data-active="1"><div class="flex items-center gap-2 mb-1"><span class="density-radio"></span><span class="text-[14px]" style="color: var(--note-ink);">标准</span></div><p class="text-caption" style="color: var(--note-ink-3);">平衡的间距与可读性</p></div>'
        + '<div class="density-opt" data-skey="density" data-value="舒适"><div class="flex items-center gap-2 mb-1"><span class="density-radio"></span><span class="text-[14px]" style="color: var(--note-ink);">舒适</span></div><p class="text-caption" style="color: var(--note-ink-3);">更宽松的间距，缓解视觉疲劳</p></div>'
        + '</div></section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">Ribbon 导航栏</h3>'
        + '<p class="text-caption mb-4" style="color: var(--note-ink-3);">左侧导航按钮支持拖拽排序和置顶，设置按钮始终固定在最后。超过最大数量的按钮会折叠到三点菜单中，点击可展开查看并切换。排序和置顶会自动保存，下次启动保持不变。</p>'
        + '<div class="mb-6"><div class="flex items-center justify-between mb-3"><div><div class="text-[14px]" style="color: var(--note-ink);">最大显示数量</div><div class="text-caption" style="color: var(--note-ink-3);">含设置按钮，范围 7-15</div></div><span id="ribbon-max-label" class="text-mono nums px-2 py-0.5 rounded" style="background: var(--note-surface-2); color: var(--note-ink);">7</span></div>'
        + '<div class="flex items-center gap-3"><span class="text-caption" style="color: var(--note-ink-3);">7</span><input id="ribbon-max-slider" type="range" min="7" max="15" value="7" class="range-slider flex-1"><span class="text-caption" style="color: var(--note-ink-3);">15</span></div></div>'
        + '<div class="text-caption" style="color: var(--note-ink-3);"><strong style="color: var(--note-ink-2);">操作提示：</strong>拖拽按钮图标可重新排序，右键按钮可置顶 / 取消置顶，设置按钮不可移动。</div>'
        + '</section>'
        + '<section class="settings-group">'
        + '<h3 class="text-body font-semibold mb-4" style="color: var(--note-ink);">其他</h3>'
        + '<div class="flex flex-col gap-1">'
        + '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color: var(--note-ink);">减少动画</div><div class="text-caption" style="color: var(--note-ink-3);">降低界面过渡与动画强度</div></div><label class="toggle"><input type="checkbox" data-skey="reduceMotion"><span class="toggle-track"></span></label></div>'
        + '</div>'
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
