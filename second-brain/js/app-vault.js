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
    // 用 vault:get 返回的 kind 字段判断当前窗口模式（比 sbProject.isProjectMode 更可靠）
    const projMode = !!(vaultInfo && vaultInfo.kind === 'project');
    const curPath = pathOfVault; // 项目模式下是项目路径，知识库模式下是库路径
    const curKey = curPath ? curPath.toLowerCase() : '';

    // 「一般项目」列表（最近打开的非知识库工作区）与「最近打开」临时文件（全局跨知识库）
    let projects = [], tempRec = [];
    if (window.noteDesktop) {
      try { const r = await window.noteDesktop.project.listRecent(); if (Array.isArray(r)) projects = r; } catch (_) { projects = []; }
      try { const t = await window.noteDesktop.tempRecent.load(); if (Array.isArray(t)) tempRec = t.slice(0, 10); } catch (_) { tempRec = []; }
    }

    const rect = anchor.getBoundingClientRect();
    const dd = document.createElement('div');
    dd.id = 'vault-dropdown';
    dd.className = 'vault-dropdown';
    dd.style.left = Math.max(8, rect.left) + 'px';
    dd.style.top = (rect.bottom + 6) + 'px';

    // 其他知识库：默认知识库 + 历史库合并为一个列表（**包含当前库**，按路径去重）
    // 当前打开的知识库条目加 is-active 高亮类，与默认库的 is-default-vault 可叠加
    const defaultPath = (vaultInfo && vaultInfo.defaultPath) || '';
    const otherList = [];
    const seenPath = {};
    const pushOther = function (p, n) {
      if (!p || seenPath[p]) return;
      seenPath[p] = true;
      otherList.push({ path: p, name: n });
    };
    pushOther(defaultPath, '我的笔记库');
    history.forEach(function (h) { pushOther(h.path, h.name); });

    /* 默认知识库判断：路径与 defaultPath 比对（大小写不敏感），默认库条目用 star 图标 */
    const isDefaultPath = function (p) { return !!p && !!defaultPath && p.toLowerCase() === defaultPath.toLowerCase(); };
    /* 当前条目判断：路径与 curKey 比对（大小写不敏感），命中则加 is-active 高亮 */
    const isCurPath = function (p) { return !!p && !!curKey && p.toLowerCase() === curKey; };

    // 顶部不再单独渲染「当前知识库/当前项目」头部项——左上角标题栏已显示；
    // 当前打开的知识库/项目直接在各自列表中以 is-active 高亮呈现。作者: 火 冰
    let html = '';
    // 分组按需渲染：其他知识库/一般项目/最近打开——无数据时整块隐藏（标题与分割线均不出现）。
    // 最近打开为「悬浮二级菜单」：无临时文件不显示；有则悬浮 head 展开文件列表（见下方 dup append 后的 hover 绑定）。
    if (otherList.length) {
      html += '<div class="vault-dropdown-head" data-vault-hist-head><i data-lucide="library" class="w-4 h-4" style="color:var(--note-ink-3)"></i>'
        + '<span style="color:var(--note-ink-3)">知识库</span></div>';
      otherList.forEach(function (h) {
        const isCur = !projMode && isCurPath(h.path); // 知识库模式下才在知识库列表高亮当前
        const isDef = isDefaultPath(h.path);
        // 旧默认库退化：记录时名称可能残留「我的笔记库」（当时是默认库），若当前已非默认库则显示真实目录名
        const dispName = (h.name === '我的笔记库' && !isDef) ? (h.path.split(/[\\/]/).pop() || h.path) : h.name;
        const rowCls = 'vault-dropdown-item vault-history-item'
          + (isCur ? ' is-active' : '')
          + (isDef ? ' is-default-vault' : '');
        html += '<div class="' + rowCls + '" data-vault-act="switch" data-vault-path="' + h.path + '" title="' + h.path + '">'
          + '<i data-lucide="' + (isDef ? 'star' : (isCur ? 'check-circle' : 'file-archive')) + '" class="w-4 h-4"></i>'
          + '<span class="vault-h-name">' + dispName + '</span>'
          + (isDef ? '<span class="vault-def-badge">默认</span>' : '')
          + '<i data-lucide="ellipsis" class="vault-h-more w-5 h-5"></i>'
          + '</div>';
      });
    }
    // 一般项目：非知识库 git 项目工作区
    if (projects.length) {
      if (html) html += '<div class="vault-dropdown-sep"></div>';
      html += '<div class="vault-dropdown-head" data-vault-hist-head><i data-lucide="folder-git-2" class="w-4 h-4" style="color:var(--note-ink-3)"></i>'
        + '<span style="color:var(--note-ink-3)">一般项目</span></div>';
      projects.forEach(function (pj) {
        const pn = pj.customName || pj.name || pj.path.split(/[\\/]/).pop() || pj.path;
        const isCur = projMode && isCurPath(pj.path); // 项目模式下才在项目列表高亮当前
        const rowCls = 'vault-dropdown-item vault-project-item' + (isCur ? ' is-active' : '');
        html += '<div class="' + rowCls + '" data-vault-act="open-project-path" data-project-path="' + esc(pj.path) + '" title="' + esc(pj.path) + '">'
          + '<i data-lucide="' + (isCur ? 'check-circle' : 'briefcase') + '" class="w-4 h-4"></i>'
          + '<span class="vault-h-name">' + esc(pn) + '</span>'
          + '<i data-lucide="ellipsis" class="vault-h-more w-5 h-5" data-project-path="' + esc(pj.path) + '"></i></div>';
      });
    }
    // 最近打开：全局跨知识库临时文件（最多 10 条）；选项作为二次菜单由悬浮 head 展开。
    // 「最近打开」是可展开入口，颜色与「打开项目…」等动作项一致，不特意置灰。
    if (tempRec.length) {
      if (html) html += '<div class="vault-dropdown-sep"></div>';
      html += '<div class="vault-dropdown-head vault-temp-head" data-vault-hist-head><i data-lucide="clock-3" class="w-4 h-4"></i>'
        + '<span>最近打开</span></div>';
    }
    /* 动作项：打开项目 / 打开知识库 */
    html += '<div class="vault-dropdown-sep"></div>'
      + '<div class="vault-dropdown-item" data-vault-act="open-project"><i data-lucide="folder-plus" class="w-4 h-4"></i><span>打开项目…</span></div>'
      + '<div class="vault-dropdown-item" data-vault-act="open"><i data-lucide="folder-open" class="w-4 h-4"></i><span>打开知识库…</span></div>';
    dd.innerHTML = html;

    // 最近打开：悬浮 head 展开临时文件二级菜单；选项复用 dd 点击委托走 open-temp 动作。
    // 收起采用「延迟关闭 + 头/菜单互bridge」：头与二级菜单之间有 6px 空隙，直接 mouseleave 会瞬时闪关，
    // 故离开头/菜单先延迟再关，二级菜单 mouseenter 取消延迟，实现头↔菜单连续悬停、移往其它项/下拉外才关闭。作者: 火 冰
    const tempHead = dd.querySelector('.vault-temp-head');
    if (tempRec.length && tempHead) {
      let tempTimer = null;
      const closeTempMenu = function () {
        const t = document.getElementById('vault-tempmenu');
        if (t) t.remove();
      };
      const scheduleTempClose = function () {
        clearTimeout(tempTimer);
        tempTimer = setTimeout(closeTempMenu, 220);
      };
      const cancelTempClose = function () { clearTimeout(tempTimer); };
      tempHead.addEventListener('mouseenter', function () {
        cancelTempClose();
        const oldT = document.getElementById('vault-tempmenu');
        if (oldT) oldT.remove();
        const tm = document.createElement('div');
        tm.id = 'vault-tempmenu';
        tm.className = 'vault-submenu';
        let th = '';
        tempRec.forEach(function (t) {
          th += '<div class="vault-dropdown-item vault-temp-item" data-vault-act="open-temp" data-temp-path="' + esc(t.path) + '" title="' + esc(t.path) + '">'
            + '<i data-lucide="file-clock" class="w-4 h-4"></i><span class="vault-h-name">' + esc(t.name || t.path) + '</span></div>';
        });
        // 「清除最近打开」置于二级菜单最末；清空后该组消失（列表为空时不再显示二级菜单）。作者: 火 冰
        th += '<div class="vault-dropdown-sep"></div>'
          + '<div class="vault-dropdown-item vault-temp-item vault-temp-clear" data-vault-act="clear-temp">'
          + '<i data-lucide="trash-2" class="w-4 h-4"></i><span style="color:var(--note-ink-2)">清除最近打开</span></div>';
        tm.innerHTML = th;
        const r = tempHead.getBoundingClientRect();
        tm.style.top = r.top + 'px';
        let lp = r.right + 6;
        if (lp + 160 > window.innerWidth) lp = r.left - 160 - 6;
        tm.style.left = lp + 'px';
        dd.appendChild(tm);
        // 二级菜单自身悬停取消关闭（桥接头菜单间隙），离开再延迟收起
        tm.addEventListener('mouseenter', cancelTempClose);
        tm.addEventListener('mouseleave', scheduleTempClose);
        refreshIcons();
      });
      tempHead.addEventListener('mouseleave', scheduleTempClose);
      // 移出整个下拉兜底：延迟收起（不立即关，避免穿越头↔菜单间隙被误关）
      dd.addEventListener('mouseleave', scheduleTempClose);
    }

    // 距底部不足时改向上展开（高度随其他知识库项数估算）
    const estH = 150 + otherList.length * 36;
    if (rect.bottom + 6 + estH > window.innerHeight) dd.style.top = Math.max(8, rect.top - estH - 6) + 'px';

    const overlay = document.createElement('div');
    overlay.id = 'vault-dropdown-backdrop';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:119;';
    overlay.addEventListener('click', closeVaultDropdown);

    // 事件委托：lucide 会把 <i data-lucide> 替换为 <svg>，直接绑定在 <i> 上会丢失监听，
    // 故统一委托到下拉容器——先处理二级菜单的展开/关闭，再处理动作项；二级菜单 append 在 dd 内以复用委托
    const closeSubmenu = function () {
      const mm = document.getElementById('vault-submenu');
      if (mm) mm.remove();
    };
    // 生成二级菜单 HTML：isCurrent（是否是当前库）控制「删除」；isDefault（是否默认库）控制「设置默认」
    const buildSubItems = function (vpath) {
      const isCurrent = vpath === pathOfVault;
      const isDef = isDefaultPath(vpath);
      let s = '';
      s += '<div class="vault-submenu-item" data-vault-sub="rename"><i data-lucide="pencil" class="w-4 h-4"></i><span>改名</span></div>';
      if (!isCurrent) {
        s += '<div class="vault-submenu-item" data-vault-sub="del"><i data-lucide="trash-2" class="w-4 h-4"></i><span>删除</span></div>';
      }
      s += '<div class="vault-submenu-item" data-vault-sub="migrate"><i data-lucide="folder-sync" class="w-4 h-4"></i><span>迁移</span></div>';
      if (!isDef) {
        s += '<div class="vault-submenu-item" data-vault-sub="default"><i data-lucide="star" class="w-4 h-4"></i><span>设置默认</span></div>';
      }
      return s;
    };
    dd.addEventListener('click', function (e) {
      const more = e.target && e.target.closest ? e.target.closest('.vault-h-more') : null;
      if (more) {
        // ⋯ 展开/切换该条目的二级菜单；已展开则收起
        e.stopPropagation();
        const item = more.closest('.vault-dropdown-head, .vault-dropdown-item');
        closeSubmenu();
        // 判断是项目条目还是知识库条目：项目条目上有 data-project-path
        const projPath = more.getAttribute('data-project-path') || (item && item.getAttribute && item.getAttribute('data-project-path')) || '';
        const vpath = (item && (item.getAttribute('data-vault-path') || (item.querySelector('[data-vault-path]') && item.querySelector('[data-vault-path]').getAttribute('data-vault-path')))) || '';
        let sub = document.createElement('div');
        sub.id = 'vault-submenu';
        sub.className = 'vault-submenu';
        let menuHtml = '';
        if (projPath) {
          // 项目条目二级菜单：改名 + 移除
          sub.setAttribute('data-project-path', projPath);
          menuHtml = '<div class="vault-submenu-item" data-project-sub="rename"><i data-lucide="pencil" class="w-4 h-4"></i><span>改名</span></div>'
            + '<div class="vault-submenu-item" data-project-sub="del"><i data-lucide="trash-2" class="w-4 h-4"></i><span>移除</span></div>';
        } else if (vpath) {
          // 知识库条目二级菜单
          sub.setAttribute('data-vault-path', vpath);
          menuHtml = buildSubItems(vpath);
        } else {
          return;
        }
        sub.innerHTML = menuHtml;
        // 定位：相对所属条目右侧展开；右缘超界时改向左/向上
        const r = more.getBoundingClientRect();
        sub.style.top = r.top + 'px';
        let leftPos = r.right + 6;
        if (leftPos + 150 > window.innerWidth) leftPos = r.left - 150 - 6;
        if (sub.style.top.replace('px', '') * 1 + 132 > window.innerHeight) sub.style.top = (window.innerHeight - 132) + 'px';
        sub.style.left = leftPos + 'px';
        // 挂到 dd 内（fixed 定位不受影响），使点击冒泡进上方委托处理二级操作
        dd.appendChild(sub);
        refreshIcons();
        return;
      }
      // 知识库二级菜单操作：删除/改名/迁移/设置默认
      const subItem = e.target && e.target.closest ? e.target.closest('[data-vault-sub]') : null;
      if (subItem) {
        const sub = subItem.closest('.vault-submenu');
        const p = sub && sub.getAttribute && sub.getAttribute('data-vault-path');
        const subAct = subItem.dataset.vaultSub;
        closeSubmenu();
        if (!p) return;
        runVaultSubAction(subAct, p);
        return;
      }
      // 项目二级菜单操作：移除/改名
      const projSubItem = e.target && e.target.closest ? e.target.closest('[data-project-sub]') : null;
      if (projSubItem) {
        const sub = projSubItem.closest('.vault-submenu');
        const p = sub && sub.getAttribute && sub.getAttribute('data-project-path');
        const subAct = projSubItem.dataset.projectSub;
        closeSubmenu();
        if (!p) return;
        runProjectSubAction(subAct, p);
        return;
      }
      const act = e.target && e.target.closest ? e.target.closest('[data-vault-act]') : null;
      if (act) {
        closeSubmenu();
        const a = act.dataset.vaultAct;
        // 清除「最近打开」列表：清空后该组消失
        if (a === 'clear-temp') { clearTempRecent(); return; }
        // 项目/临时文件动作单独分流（需要元素上的路径属性），其余走知识库动作
        if (a === 'open-project' || a === 'open-project-path' || a === 'open-temp') openProjectAction(a, act);
        else onVaultAction.call(act, e);
      }
    });
    // 点击二级菜单外的任意区域关闭
    document.addEventListener('mousedown', function subCloseHandler(ev) {
      if (ev.target && ev.target.closest && ev.target.closest('#vault-submenu, .vault-h-more')) return;
      closeSubmenu();
      document.removeEventListener('mousedown', subCloseHandler);
    });

    document.body.appendChild(overlay);
    document.body.appendChild(dd);
    refreshIcons();
  }

  /* 清空「最近打开」临时文件列表：调主进程置空并关闭下拉（该分组随即消失，列表为空时不再显示二级菜单）。
   * 作者: 火 冰 */
  async function clearTempRecent() {
    try { if (window.noteDesktop && window.noteDesktop.tempRecent) await window.noteDesktop.tempRecent.clear(); } catch (_) { /* 忽略 */ }
    showToast('已清除最近打开');
    closeVaultDropdown();
  }

  /* 处理知识库条目二级菜单操作：对指定库路径执行
   * rename（设置自定义别名）/ del（从历史/列表移除，不删文件）/ migrate（迁移默认知识库）/ default（设为新的默认库，不迁移）
   * 迁移成功后关闭下拉并交由主进程重载提示；删除/改名仅同步主进程历史并刷新列表。 */
  async function runVaultSubAction(subAct, vpath) {
    const bridge = window.noteDesktop;
    if (!bridge) return;
    if (subAct === 'rename') {
      // 改名：弹输入框让用户输入新名称（支持输入空串清除别名）
      const row = document.querySelector('#vault-dropdown [data-vault-path="' + CSS.escape(vpath) + '"]');
      const labelEl = row && (row.querySelector('.vault-h-name') || row.querySelector('.vault-current'));
      const curName = labelEl ? labelEl.textContent : '';
      const inputTitle = curName ? ('重命名知识库「' + curName + '」（留空恢复原名）') : '输入知识库名称';
      let newName = '';
      try {
        // 优先用 window.inputModal（项目内建的自绘弹窗），回退 window.prompt
        if (typeof window.inputModal === 'function') {
          newName = (await window.inputModal({ title: inputTitle, value: curName })) || '';
        } else {
          newName = window.prompt(inputTitle, curName) || '';
        }
      } catch (_) { newName = window.prompt(inputTitle, curName) || ''; }
      if (newName === null) return; // 用户取消
      const res = await bridge.setVaultAlias(vpath, newName);
      if (res && res.ok) {
        showToast(newName ? '已改名为「' + newName + '」' : '已恢复默认名称');
        // 如果改的是当前打开的库，同步更新左上角标题
        if (res.path && window.noteDesktop) {
          try {
            const cur = await window.noteDesktop.getVault();
            if (cur && cur.path && cur.path.toLowerCase() === res.path.toLowerCase()) {
              const nameEl = document.getElementById('vault-name');
              if (nameEl) nameEl.textContent = res.name;
            }
          } catch (_) { /* 忽略 */ }
        }
      } else if (res && res.error) {
        showToast(res.error);
      }
      toggleVaultDropdown(document.querySelector('[data-dom-id="vault-picker"]'));
      return;
    }
    if (subAct === 'del') {
      const row = document.querySelector('#vault-dropdown [data-vault-path="' + CSS.escape(vpath) + '"]');
      // 显示名：历史库用 .vault-h-name；当前库用 .vault-current
      const labelEl = row && (row.querySelector('.vault-h-name') || row.querySelector('.vault-current'));
      const label = labelEl ? labelEl.textContent : '该知识库';
      if (!confirm('确定从列表中删除知识库「' + label + '」吗？')) return;
      await bridge.removeVault(vpath).catch(function () { /* 忽略 */ });
      toggleVaultDropdown(document.querySelector('[data-dom-id="vault-picker"]')); // 重新渲染列表
      return;
    }
    if (subAct === 'migrate') {
      // 迁移默认知识库：主进程负责选目录/确认/移动，成功后在重载页提示
      const res = await bridge.migrateVault();
      if (res && res.error) { showToast(res.error); return; }
      if (!res || res.canceled) return;
      sessionStorage.setItem('vaultMigrated', '1'); // 重载后 initVaultPicker 提示
      window.location.reload();
      return;
    }
    if (subAct === 'default') {
      // 设置默认：把该库设为新的默认库（不迁移文件），成功后刷新列表
      const res = await bridge.setDefaultVault(vpath);
      if (res && res.error) { showToast(res.error); return; }
      if (!res || res.canceled) return;
      showToast('已将知识库设为默认库');
      toggleVaultDropdown(document.querySelector('[data-dom-id="vault-picker"]'));
    }
  }

  /* 处理项目条目二级菜单操作：对指定项目路径执行
   * del（从最近打开列表移除，不改打开中的窗口）/ rename（设置自定义别名）。
   * 作者: 火 冰 */
  async function runProjectSubAction(subAct, ppath) {
    const bridge = window.noteDesktop;
    if (!bridge || !bridge.project) return;
    if (subAct === 'del') {
      const row = document.querySelector('#vault-dropdown .vault-project-item[data-project-path="' + CSS.escape(ppath) + '"]');
      const labelEl = row && row.querySelector('.vault-h-name');
      const label = labelEl ? labelEl.textContent : '该项目';
      if (!confirm('确定从列表中移除项目「' + label + '」吗？\n（已打开的项目窗口不受影响）')) return;
      await bridge.project.remove(ppath).catch(function () { /* 忽略 */ });
      showToast('已从列表移除');
      toggleVaultDropdown(document.querySelector('[data-dom-id="vault-picker"]'));
      return;
    }
    if (subAct === 'rename') {
      const row = document.querySelector('#vault-dropdown .vault-project-item[data-project-path="' + CSS.escape(ppath) + '"]');
      const labelEl = row && row.querySelector('.vault-h-name');
      const curName = labelEl ? labelEl.textContent : '';
      const inputTitle = curName ? ('重命名项目「' + curName + '」（留空恢复原名）') : '输入项目名称';
      let newName = '';
      try {
        if (typeof window.inputModal === 'function') {
          newName = (await window.inputModal({ title: inputTitle, value: curName })) || '';
        } else {
          newName = window.prompt(inputTitle, curName) || '';
        }
      } catch (_) { newName = window.prompt(inputTitle, curName) || ''; }
      if (newName === null) return; // 用户取消
      const res = await bridge.project.setAlias(ppath, newName);
      if (res && res.ok) {
        showToast(newName ? '已改名为「' + newName + '」' : '已恢复默认名称');
        // 如果改的是当前打开的项目，同步更新左上角标题
        if (res.path && window.noteDesktop) {
          try {
            const cur = await window.noteDesktop.getVault();
            if (cur && cur.path && cur.path.toLowerCase() === res.path.toLowerCase()) {
              const nameEl = document.getElementById('vault-name');
              if (nameEl) nameEl.textContent = res.name;
            }
          } catch (_) { /* 忽略 */ }
        }
      } else if (res && res.error) {
        showToast(res.error);
      }
      toggleVaultDropdown(document.querySelector('[data-dom-id="vault-picker"]'));
    }
  }

  /* 处理库下拉动作：切换/打开/恢复默认库由主进程在新窗口打开目标库（或聚焦已有窗口），
   * 当前窗口保持原知识库不变，无需重载；仅迁移默认库成功后发起窗口重载并提示（主进程已同步刷新其他窗口）。 */
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
      return; // 主进程已新开窗口显示目标库，当前窗口保持原知识库
    }
    closeVaultDropdown();
    const res = (act === 'open') ? await bridge.chooseVault() : null;
    if (!res || res.canceled) return;
    // 主进程已新开窗口显示目标库（或聚焦已有窗口），当前窗口保持原知识库，无需重载
  }

  /* 打开项目动作分流：open-project=弹目录选择器；open-project-path=按历史路径打开/聚焦。
   * 均在主进程另开项目窗口，当前窗口保持原知识库不变。作者: 火 冰 */
  async function openProjectAction(act, el) {
    const bridge = window.noteDesktop;
    if (!bridge || !bridge.project) return;
    if (act === 'open-project') {
      const res = await bridge.project.open();
      if (!res || res.canceled) { /* 用户取消 */ }
      return;
    }
    if (act === 'open-project-path') {
      const p = el ? el.getAttribute('data-project-path') : '';
      if (!p) return;
      await bridge.project.openPath(p);
      return;
    }
    if (act === 'open-temp') {
      const p = el ? el.getAttribute('data-temp-path') : '';
      if (!p) return;
      // 临时打开需要编辑器视图：先切到编辑器，待装载后再打开
      const toEditor = (location.hash !== '#/editor') || (document.getElementById('view-root') && !document.getElementById('view-root').querySelector('#file-tree'));
      if (toEditor) {
        if (location.hash !== '#/editor') location.hash = '#/editor';
        setTimeout(function () { if (window.sbTempFiles) window.sbTempFiles.openTemp(p); }, 300);
      } else if (window.sbTempFiles) {
        await window.sbTempFiles.openTemp(p);
      }
    }
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

  /* 笔记库加密解锁（ENC-03）：当前库已启用笔记加密且本地无缓存密钥（locked）时，
   * 显示 #enc-unlock-screen 遮罩要求输入笔记加密密码；验证通过（能正常解密库根隐藏文件密文）
   * 才进入，失败提示密码错误。网页版无桌面桥接静默跳过。
   * 时序：锁屏未解锁时主进程 enc.getState 返回 locked=false（盐未定），此处只隐藏遮罩；
   * 锁屏解锁成功后由 app-security 调 window.SBEncUnlock.recheck() 重新判定（盐=应用密码明文）。
   * 作者: 火 冰 */
  function initVaultEncUnlock() {
    const nd = window.noteDesktop;
    if (!nd || !nd.enc || !nd.enc.getState) return;
    const screen = document.getElementById('enc-unlock-screen');
    if (!screen) return;
    const pwd = document.getElementById('enc-unlock-pwd');
    const err = document.getElementById('enc-unlock-err');
    const btn = document.getElementById('enc-unlock-btn');
    const close = document.getElementById('enc-unlock-close');
    const show = function () {
      screen.style.display = 'flex';
      document.body.classList.add('enc-locked'); // 隐藏主视图防内容泄露（CSS body.enc-locked .app-main）
      if (pwd) { pwd.value = ''; pwd.focus(); }
      if (err) err.textContent = '';
    };
    const hide = function () {
      screen.style.display = 'none';
      document.body.classList.remove('enc-locked');
    };
    const doUnlock = function () {
      const v = pwd ? pwd.value : '';
      if (!v) { if (err) err.textContent = '请输入笔记加密密码'; return; }
      nd.enc.verify(v).then(function (r) {
        if (r && r.ok) { hide(); return; }
        if (err) err.textContent = (r && r.reason === 'no_config') ? '该笔记库未启用加密' : '密码错误，无法解密笔记';
        if (pwd) { pwd.value = ''; pwd.focus(); }
      }).catch(function () { if (err) err.textContent = '解锁失败'; });
    };
    // 检测（可重入）：已加密且本地无缓存密钥 → 显示遮罩；否则隐藏。锁屏解锁后经 SBEncUnlock.recheck 重新判定
    const check = function () {
      nd.enc.getState().then(function (cfg) {
        if (cfg && cfg.locked) show(); else hide();
      }).catch(function () { /* 主进程不可用忽略 */ });
    };
    check();
    if (btn) btn.addEventListener('click', doUnlock);
    if (pwd) pwd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doUnlock(); });
    if (close) close.addEventListener('click', function () { if (nd && nd.close) nd.close(); });
    // 暴露重检接口：锁屏解锁成功后（应用密码明文已进主进程内存作为盐）重新判定是否需输入笔记密码
    if (typeof window !== 'undefined') window.SBEncUnlock = { recheck: check };
  }

  /* 单篇密文笔记修复（ENC-04 异常处理）：编辑器打开笔记发现内容为密文（当前 keyring 解不开，可能用旧密码加密）时，
   * 显示 #enc-repair-screen 遮罩，用户输入该笔记的（旧）加密密码 → 主进程解密成功用当前主密钥重新加密落盘并更新列表
   * → 清内容缓存后重新装载该笔记（磁盘已是当前主密钥加密，重新读取即明文）；密码错误提示重输。
   * 事件只绑定一次（loadView 反复调用 initVaultEncUnlock），SBEncRepair.tryRepair 供 editor-host 检测密文后调用。
   * 作者: 火 冰 */
  let encRepairBound = false;
  function initEncRepair() {
    const nd = window.noteDesktop;
    if (!nd || !nd.enc || !nd.enc.repairNote || encRepairBound) return;
    const screen = document.getElementById('enc-repair-screen');
    if (!screen) return;
    encRepairBound = true;
    const pwd = document.getElementById('enc-repair-pwd');
    const err = document.getElementById('enc-repair-err');
    const btn = document.getElementById('enc-repair-btn');
    const close = document.getElementById('enc-repair-close');
    let pendingPath = '';
    const show = function (rel) {
      pendingPath = rel;
      screen.style.display = 'flex';
      if (pwd) { pwd.value = ''; pwd.focus(); }
      if (err) err.textContent = '';
    };
    const hide = function () { screen.style.display = 'none'; pendingPath = ''; };
    const doRepair = function () {
      const v = pwd ? pwd.value : '';
      if (!v) { if (err) err.textContent = '请输入密码'; return; }
      if (!pendingPath) { hide(); return; }
      nd.enc.repairNote(pendingPath, v).then(function (r) {
        if (r && r.ok) {
          hide();
          // 修复成功：清内容缓存并重新装载该笔记（磁盘已是当前主密钥加密，重新读取即明文）
          if (typeof edOutdated !== 'undefined' && edOutdated && pendingPath in edOutdated) delete edOutdated[pendingPath];
          if (typeof openNote === 'function') openNote(pendingPath);
          else if (typeof reloadNote === 'function') reloadNote(pendingPath);
          return;
        }
        if (err) err.textContent = (r && r.reason === 'missing') ? '笔记文件不存在' : '密码错误，无法解密该笔记';
        if (pwd) { pwd.value = ''; pwd.focus(); }
      }).catch(function () { if (err) err.textContent = '修复失败'; });
    };
    if (btn) btn.addEventListener('click', doRepair);
    if (pwd) pwd.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') doRepair(); });
    if (close) close.addEventListener('click', hide);
    // 暴露给编辑器宿主：打开笔记发现密文时调用（传相对路径）
    if (typeof window !== 'undefined') window.SBEncRepair = { tryRepair: show };
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

