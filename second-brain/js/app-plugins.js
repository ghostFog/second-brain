/* ============================================
 * 第二脑 — 插件市场
 * 作者: 火 冰
 * 功能: 插件网格渲染、分类/排序/搜索与插件详情抽屉
 * ============================================ */

'use strict';


  /* ============================
   * 插件市场视图交互
   * ============================ */

  let pluginData = [];
  let installedOnly = false;   // 「管理已安装插件」过滤

  function renderPlugins(filterCat, filterText, sortBy) {
    const grid = document.getElementById('plugin-grid');
    if (!grid) return;
    let list = pluginData.slice();
    if (installedOnly) list = list.filter(p => p.installed);
    else if (filterCat && filterCat !== 'all') list = list.filter(p => p.cat === filterCat);
    const q = (filterText || '').trim().toLowerCase();
    if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || p.author.toLowerCase().includes(q) || p.desc.includes(q));
    // 排序
    if (sortBy === 'rating') list.sort((a, b) => b.rating - a.rating);
    else if (sortBy === 'latest') list.sort((a, b) => b.downloads - a.downloads);
    else list.sort((a, b) => b.downloads - a.downloads);

    if (list.length === 0) { grid.innerHTML = '<p class="text-caption p-4" style="color: var(--note-ink-3);">未找到匹配的插件</p>'; return; }

    grid.innerHTML = list.map(p => {
      const btnClass = p.installed
        ? 'style="background: var(--note-surface-2); color: var(--note-ink-3); border: 1px solid var(--note-border);"'
        : 'style="background: var(--note-brand-600); color: #FFFFFF;"';
      const btnInner = p.installed
        ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>已安装'
        : '安装';
      return '<div class="plugin-card rounded-lg border p-4 flex flex-col" data-card="' + esc(p.name) + '" style="cursor:pointer; background: var(--note-surface); border-color: var(--note-border); border-radius: var(--note-radius-lg);">'
        + '<div class="flex items-start gap-3 mb-3">'
        + '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background: ' + p.color + '; border-radius: var(--note-radius-md);">'
        + '<i data-lucide="' + p.icon + '" class="w-5 h-5" style="color: #FFFFFF;"></i></div>'
        + '<div class="min-w-0 flex-1"><h3 class="text-body font-semibold leading-tight" style="color: var(--note-ink);">' + p.name + '</h3>'
        + '<p class="text-caption mt-0.5" style="color: var(--note-ink-3);">by ' + p.author + '</p></div></div>'
        + '<p class="text-caption mb-4 leading-relaxed" style="color: var(--note-ink-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">' + p.desc + '</p>'
        + '<div class="flex items-center justify-between mt-auto"><div class="flex items-center gap-3 text-caption nums" style="color: var(--note-ink-3);">'
        + '<span class="flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>' + (p.downloads / 1000).toFixed(1).replace(/\.0$/, '') + 'k</span>'
        + '<span class="flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5" style="color: var(--state-warning);"></i>' + p.rating + '</span></div>'
        + '<button class="install-btn flex items-center gap-1 px-3 py-1.5 rounded-md text-caption font-medium" data-install="' + p.name + '" ' + btnClass + '>' + btnInner + '</button>'
        + '</div></div>';
    }).join('');
    refreshIcons();

    // 安装/卸载按钮
    grid.querySelectorAll('[data-install]').forEach(btn => {
      btn.addEventListener('click', function (e) {
        e.stopPropagation(); // 避免触发卡片打开抽屉
        const name = this.dataset.install;
        const p = pluginData.find(x => x.name === name);
        if (p) { p.installed = !p.installed; renderPlugins(currentCat, searchInput.value, sortSelect.value); }
      });
    });
    // 点击卡片 -> 打开详情抽屉
    grid.querySelectorAll('.plugin-card').forEach(card => {
      card.addEventListener('click', function () { openPluginDrawer(this.dataset.card); });
    });
  }

  let currentCat = 'all';
  const searchInput = document.getElementById('plugin-search');
  const sortSelect = document.getElementById('plugin-sort');

  /* 渲染并打开插件详情抽屉 */
  function openPluginDrawer(name) {
    const drawer = document.getElementById('plugin-drawer');
    if (!drawer) return;
    const p = pluginData.find(x => x.name === name);
    if (!p) { closePluginDrawer(); return; }
    drawer.innerHTML = ''
      + '<div class="p-4 border-b shrink-0 flex items-center justify-between" style="border-color: var(--note-border);">'
      + '<span class="text-[13px] font-semibold tracking-wide" style="color: var(--note-ink);">插件详情</span>'
      + '<button data-action="pm-close" class="w-7 h-7 flex items-center justify-center rounded hover:opacity-70" style="color: var(--note-ink-3);" title="关闭"><i data-lucide="x" class="w-4 h-4"></i></button></div>'
      + '<div class="p-4 border-b" style="border-color: var(--note-border);">'
      + '<div class="flex items-start gap-3"><div class="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0" style="background:' + p.color + '; border-radius: var(--note-radius-md);"><i data-lucide="' + p.icon + '" class="w-6 h-6" style="color:#FFFFFF;"></i></div>'
      + '<div class="flex-1 min-w-0"><h3 class="text-body font-semibold leading-tight" style="color: var(--note-ink);">' + p.name + '</h3>'
      + '<p class="text-caption mt-0.5" style="color: var(--note-ink-3);">by ' + p.author + '</p></div></div>'
      + '<div class="flex items-center gap-4 mt-4 text-caption nums" style="color: var(--note-ink-3);">'
      + '<span class="flex items-center gap-1"><i data-lucide="download" class="w-3.5 h-3.5"></i>' + p.downloads.toLocaleString() + '</span>'
      + '<span class="flex items-center gap-1"><i data-lucide="star" class="w-3.5 h-3.5" style="color: var(--state-warning);"></i>' + p.rating + '</span>'
      + '</div></div>'
      + '<div class="p-4 border-b flex-1 overflow-y-auto" style="border-color: var(--note-border);"><p class="text-caption leading-relaxed" style="color: var(--note-ink-2);">' + p.desc + '</p></div>'
      + '<div class="p-4 border-t shrink-0" style="border-color: var(--note-border);">'
      + '<button data-action="pm-toggle" data-name="' + esc(p.name) + '" class="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md text-[13px] font-medium transition-colors hover:opacity-90" style="background:' + (p.installed ? 'var(--note-surface-2); color: var(--note-ink-3); border:1px solid var(--note-border);' : 'var(--note-brand-600); color:#FFFFFF;') + ';">'
      + '<i data-lucide="' + (p.installed ? 'trash-2' : 'download') + '" class="w-4 h-4"></i>' + (p.installed ? '卸载插件' : '安装插件') + '</button></div>';
    drawer.style.width = '320px';
    drawer.classList.add('open');
    refreshIcons();
    drawer.querySelector('[data-action="pm-close"]').addEventListener('click', closePluginDrawer);
    drawer.querySelector('[data-action="pm-toggle"]').addEventListener('click', function () {
      const inst = pluginData.find(x => x.name === this.dataset.name);
      if (inst) { inst.installed = !inst.installed; openPluginDrawer(inst.name); renderPlugins(currentCat, searchInput.value, sortSelect.value); }
    });
  }

  function closePluginDrawer() {
    const drawer = document.getElementById('plugin-drawer');
    if (drawer) { drawer.style.width = '0'; drawer.classList.remove('open'); drawer.innerHTML = ''; }
  }

  function bindPlugins() {
    const chips = document.getElementById('plugin-chips');
    if (!chips) return;
    // 搜索 / 排序
    if (searchInput) searchInput.addEventListener('input', function () { renderPlugins(currentCat, this.value, sortSelect ? sortSelect.value : ''); });
    if (sortSelect) sortSelect.addEventListener('change', function () { renderPlugins(currentCat, searchInput ? searchInput.value : '', this.value); });
    // 管理已安装
    document.querySelectorAll('[data-action="toggle-installed"]').forEach(btn => {
      btn.addEventListener('click', function () {
        installedOnly = !installedOnly;
        this.style.background = installedOnly ? 'var(--note-brand-600)' : 'var(--note-surface-2)';
        this.style.color = installedOnly ? '#FFFFFF' : 'var(--note-ink-2)';
        if (installedOnly) closePluginDrawer();
        renderPlugins(installedOnly ? 'all' : currentCat, searchInput ? searchInput.value : '', sortSelect ? sortSelect.value : '');
      });
    });
    if (!chips) return;
    chips.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      if (installedOnly) return;
      currentCat = btn.dataset.cat;
      chips.querySelectorAll('[data-cat]').forEach(c => {
        c.style.background = c === btn ? 'var(--note-brand-600)' : 'var(--note-background)';
        c.style.color = c === btn ? '#FFFFFF' : 'var(--note-ink-2)';
        c.style.borderColor = c === btn ? 'var(--note-brand-600)' : 'var(--note-border)';
      });
      renderPlugins(currentCat, searchInput ? searchInput.value : '', sortSelect ? sortSelect.value : '');
    });
  }
