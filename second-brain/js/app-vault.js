/* ============================================
 * 第二脑 — 笔记库与笔记右键菜单
 * 作者: 火 冰
 * 功能: 标题栏库切换、文件树/空白区右键菜单
 * ============================================ */

'use strict';


  /* ============================
   * 多端侧栏控制
   * ============================ */

  /* 关闭标题栏库下拉框 */
  function closeVaultDropdown() {
    const d = document.getElementById('vault-dropdown');
    const ov = document.getElementById('vault-dropdown-backdrop');
    const chev = document.getElementById('vault-chevron');
    if (d) d.remove();
    if (ov) ov.remove();
    if (chev) chev.style.transform = '';
  }

  /* 展开/收起库下拉框：当前库 + 最近打开列表 + 动作项（桌面版可用） */
  async function toggleVaultDropdown(anchor) {
    if (document.getElementById('vault-dropdown')) { closeVaultDropdown(); return; }
    if (!window.noteDesktop) { showToast('切换笔记库仅桌面版可用'); return; }
    const chev = document.getElementById('vault-chevron');
    if (chev) chev.style.transform = 'rotate(180deg)';
    let name = '我的笔记库', pathOfVault = '', history = [], vaultInfo = null;
    try {
      const v = await window.noteDesktop.getVault();
      vaultInfo = v;
      if (v && v.name) name = v.name;
      if (v && v.path) pathOfVault = v.path;
      if (v && Array.isArray(v.history)) history = v.history;
    } catch (e) { /* 忽略 */ }

    const rect = anchor.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.id = 'vault-dropdown';
    dd.className = 'vault-dropdown';
    dd.style.left = Math.max(8, rect.left) + 'px';
    dd.style.top = (rect.bottom + 6) + 'px';

    // 其他知识库：默认知识库 + 历史库合并为一个列表（剔除当前库，按路径去重）
    const defaultPath = (vaultInfo && vaultInfo.defaultPath) || '';
    const otherList = [];
    const seenPath = {};
    const pushOther = function (p, n) {
      if (!p || p === pathOfVault || seenPath[p]) return;
      seenPath[p] = true;
      otherList.push({ path: p, name: n });
    };
    pushOther(defaultPath, '我的笔记库');
    history.forEach(function (h) { pushOther(h.path, h.name); });

    let html = '<div class="vault-dropdown-head"><i data-lucide="library" class="w-4 h-4" style="color:var(--note-ink-3)"></i>'
      + '<span class="vault-current"' + (pathOfVault ? ' title="' + pathOfVault + '"' : '') + '>' + name + '</span>'
      + '<span style="font-size:11px;color:var(--note-ink-3)">当前知识库</span></div>';
    html += '<div class="vault-dropdown-sep"></div>'; // 当前知识库与「其他知识库」之间的分割线
    html += '<div class="vault-dropdown-head" data-vault-hist-head><i data-lucide="clock-3" class="w-4 h-4" style="color:var(--note-ink-3)"></i>'
      + '<span style="color:var(--note-ink-3)">其他知识库</span></div>';
    if (otherList.length) {
      otherList.forEach(function (h) {
        html += '<div class="vault-dropdown-item vault-history-item" data-vault-act="switch" data-vault-path="' + h.path + '" title="' + h.path + '">'
          + '<i data-lucide="file-archive" class="w-4 h-4"></i><span class="vault-h-name">' + (h.name || '') + '</span>'
          + (h.path === defaultPath ? '' : '<i data-lucide="x" class="vault-h-del w-5 h-5"></i>')
          + '</div>';
      });
    } else {
      // 无其他知识库：灰色占一行
      html += '<div class="vault-dropdown-item vault-history-item vault-empty-hint" style="color:var(--note-ink-3);cursor:default;">无其他知识库</div>';
    }
    html += '<div class="vault-dropdown-sep"></div>'
      + '<div class="vault-dropdown-item" data-vault-act="open"><i data-lucide="folder-open" class="w-4 h-4"></i><span>打开知识库…</span></div>'
      + '<div class="vault-dropdown-item" data-vault-act="migrate"><i data-lucide="folder-sync" class="w-4 h-4"></i><span>迁移默认知识库…</span></div>'
      + '<div class="vault-dropdown-item" data-vault-act="reset"><i data-lucide="rotate-ccw" class="w-4 h-4"></i><span>默认知识库</span></div>';
    dd.innerHTML = html;

    // 距底部不足时改向上展开（高度随其他知识库项数估算）
    const estH = 150 + otherList.length * 36;
    if (rect.bottom + 6 + estH > window.innerHeight) dd.style.top = Math.max(8, rect.top - estH - 6) + 'px';

    const overlay = document.createElement('div');
    overlay.id = 'vault-dropdown-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:119;';
    overlay.addEventListener('click', closeVaultDropdown);

    // 事件委托：lucide 会把 <i data-lucide> 替换为 <svg>，直接绑定在 <i> 上会丢失监听，
    // 故统一委托到下拉容器——先处理 × 删除，再处理动作项（切换/打开/默认）
    dd.addEventListener('click', function (e) {
      const hit = e.target && e.target.closest ? e.target.closest('.vault-h-del') : null;
      if (hit) {
        // × 删除：不切换，仅从「其他知识库」移除
        const item = hit.closest('.vault-history-item');
        const p = item && item.dataset.vaultPath;
        if (!p) return;
        // 二次确认：防止误点删除
        const nmEl = item.querySelector('.vault-h-name');
        const label = nmEl ? nmEl.textContent : '该知识库';
        if (!confirm('确定从列表中删除知识库「' + label + '」吗？')) return;
        window.noteDesktop.removeVault(p).then(function () {
          if (item) item.remove();
          const head = dd.querySelector('[data-vault-hist-head]');
          if (head && !dd.querySelector('.vault-empty-hint')) {
            const switchLeft = dd.querySelectorAll('.vault-history-item[data-vault-act="switch"]');
            if (!switchLeft.length) {
              // 无其他知识库：灰色占位行保持一行高度
              const hint = document.createElement('div');
              hint.className = 'vault-dropdown-item vault-history-item vault-empty-hint';
              hint.style.cssText = 'color:var(--note-ink-3);cursor:default;';
              hint.textContent = '无其他知识库';
              head.after(hint);
            }
          }
        }).catch(function () { /* 忽略 */ });
        return;
      }
      const act = e.target && e.target.closest ? e.target.closest('[data-vault-act]') : null;
      if (act) onVaultAction.call(act, e);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(dd);
    refreshIcons();
  }

  /* 处理库下拉动作：点击历史库切换 / 打开目录 / 迁移默认库 / 恢复默认后重载整页 */
  async function onVaultAction() {
    const act = this.dataset.vaultAct;
    const bridge = window.noteDesktop;
    if (!bridge) return;
    if (act === 'switch') {
      const p = this.dataset.vaultPath;
      closeVaultDropdown();
      if (!p) return;
      const res = await bridge.switchVault(p);
      if (!res || res.canceled) { showToast('目录不存在或不可用'); return; }
      window.location.reload();
      return;
    }
    closeVaultDropdown();
    if (act === 'migrate') {
      // 迁移默认知识库：主进程负责选目录/确认/移动，成功后在重载页提示
      const res = await bridge.migrateVault();
      if (res && res.error) { showToast(res.error); return; }
      if (!res || res.canceled) return;
      sessionStorage.setItem('vaultMigrated', '1'); // 重载后 initVaultPicker 提示
      window.location.reload();
      return;
    }
    const res = (act === 'open') ? await bridge.chooseVault() : await bridge.resetVault();
    if (!res || res.canceled) return;
    // 刷新整页以重载当前笔记库（清空旧库的标签/选中态等内存状态）
    window.location.reload();
  }

  /* 初始化标题栏库选择器：绑定点击 + 显示当前库名 */
  function initVaultPicker() {
    const nameEl = document.getElementById('vault-name');
    if (!nameEl) return;
    const btn = document.querySelector('[data-dom-id="vault-picker"]');
    if (btn) btn.addEventListener('click', function (e) { e.stopPropagation(); toggleVaultDropdown(this); });
    if (window.noteDesktop) {
      // 回填库名，并将 title 设为笔记库绝对路径（悬浮显示）
      window.noteDesktop.getVault().then(function (v) {
        if (v && v.name) nameEl.textContent = v.name;
        if (btn && v && v.path) btn.title = v.path;
        // 迁移默认知识库成功（重载页）：提示并清标记
        if (sessionStorage.getItem('vaultMigrated')) {
          sessionStorage.removeItem('vaultMigrated');
          showToast('默认知识库已迁移到 ' + v.path);
        }
      }).catch(function () { /* 忽略 */ });
    }
  }

  /* 关闭笔记右键菜单 */
  function closeNoteContextMenu() {
    const m = document.getElementById('note-ctx-menu');
    const ov = document.getElementById('note-ctx-backdrop');
    if (m) m.remove();
    if (ov) ov.remove();
  }

  /* 在鼠标位置显示笔记右键菜单（文件树 .tree-file 行）：桌面版在资源管理器显示，网页版提示 */
  function showNoteContextMenu(x, y, relPath) {
    closeNoteContextMenu();
    const dd = document.createElement('div');
    dd.id = 'note-ctx-menu';
    dd.className = 'vault-dropdown';
    dd.style.left = Math.max(8, x) + 'px';
    dd.style.top = Math.max(8, y) + 'px';
    dd.innerHTML = '<div class="vault-dropdown-item" data-note-ctx="reveal"><i data-lucide="folder-open" class="w-4 h-4"></i><span>在资源管理器中显示</span></div>';
    const overlay = document.createElement('div');
    overlay.id = 'note-ctx-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:118;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeNoteContextMenu(); });
    overlay.addEventListener('click', closeNoteContextMenu);
    dd.querySelectorAll('.vault-dropdown-item').forEach(item => {
      item.addEventListener('click', function () {
        const act = this.dataset.noteCtx;
        closeNoteContextMenu();
        if (act !== 'reveal') return;
        if (window.noteDesktop) { window.noteDesktop.revealNote(relPath).catch(function () { /* 忽略 */ }); }
        else { showToast('该功能仅桌面版可用'); }
      });
    });
    document.body.appendChild(overlay);
    document.body.appendChild(dd);
    refreshIcons();
  }

  /* 在文件树空白区显示右键菜单：新建笔记 / 新建目录 */
  function showBlankContextMenu(x, y) {
    closeNoteContextMenu();
    const dd = document.createElement('div');
    dd.id = 'note-ctx-menu';
    dd.className = 'vault-dropdown';
    dd.style.left = Math.max(8, x) + 'px';
    dd.style.top = Math.max(8, y) + 'px';
    dd.innerHTML = '<div class="vault-dropdown-item" data-note-ctx="new-note"><i data-lucide="file-plus" class="w-4 h-4"></i><span>新建笔记</span></div>'
      + '<div class="vault-dropdown-item" data-note-ctx="new-dir"><i data-lucide="folder-plus" class="w-4 h-4"></i><span>新建目录</span></div>'
      + '<div class="vault-dropdown-sep"></div>'
      + '<div class="vault-dropdown-item" data-note-ctx="toggle-hidden"><i data-lucide="' + (restoreS('showHidden', false) ? 'eye' : 'eye-off') + '" class="w-4 h-4"></i><span>' + (restoreS('showHidden', false) ? '隐藏隐藏文件' : '显示隐藏文件') + '</span></div>';
    const overlay = document.createElement('div');
    overlay.id = 'note-ctx-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:118;';
    overlay.addEventListener('contextmenu', function (e2) { e2.preventDefault(); closeNoteContextMenu(); });
    overlay.addEventListener('click', closeNoteContextMenu);
    dd.querySelectorAll('.vault-dropdown-item').forEach(item => {
      item.addEventListener('click', function () {
        const act = this.dataset.noteCtx;
        closeNoteContextMenu();
        if (act === 'new-note') doNewNote();
        else if (act === 'new-dir') doNewFolder();
        else if (act === 'toggle-hidden') toggleHiddenFiles();
      });
    });
    document.body.appendChild(overlay);
    document.body.appendChild(dd);
    refreshIcons();
  }

  /* 切换文件树是否显示以 . 开头的隐藏目录/文件，并即时重绘（作者: 火 冰） */
  function toggleHiddenFiles() {
    const now = !restoreS('showHidden', false);
    saveS('showHidden', now);
    renderFileTree(edNotes);
    showToast(now ? '已显示隐藏文件' : '已隐藏 . 开头的目录/文件');
  }

  /* 全局右键委托：文件树笔记行 → 资源管理器菜单；文件树空白区 → 新建笔记/目录（init 只绑一次） */
  function bindNoteContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      const row = e.target && e.target.closest ? e.target.closest('.tree-file') : null;
      if (row) {
        e.preventDefault();
        closeNoteContextMenu();
        showNoteContextMenu(e.clientX, e.clientY, row.getAttribute('data-path'));
        return;
      }
      // 文件树空白区
      const tree = document.getElementById('file-tree');
      if (tree && tree.contains(e.target)) {
        e.preventDefault();
        closeNoteContextMenu();
        showBlankContextMenu(e.clientX, e.clientY);
      }
      // 其余区域交还默认菜单
    });
  }
