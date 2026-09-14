/* ============================================
 * Git Sync 插件主实现
 * 作者: 火 冰
 * 功能: 为知识库提供 Git 版本控制同步能力：
 *   - 仅管理历史版本（不管理分支）：自动提交生成历史版本、查看版本历史、还原到版本
 *   - 同步到仓库：手动/自动提交，可配置推送
 *   - 从 Git 打开知识库：克隆远程仓库为独立知识库并打开
 * 说明: 本脚本由宿主以 (function(PluginAPI, pluginId){...})(PluginAPI, 'git-sync')
 *       注入渲染进程沙箱执行；git 操作经 window.noteDesktop.git 桥接到主进程白名单执行。
 * ============================================ */
(function (PluginAPI, pluginId) {
  'use strict';

  /* 当前知识库根（cached，供 git 命令 cwd 使用） */
  var vaultPath = '';

  /* ------------------ 设置存取（localStorage） ------------------ */

  /* 读取设置项：key 为核心键，默认返回 def */
  function gset(key, def) {
    try {
      var raw = localStorage.getItem('plugin:' + pluginId + ':' + key);
      if (raw === null || raw === '') return def;
      return JSON.parse(raw);
    } catch (e) { return def; }
  }
  /* 写入设置项：val 序列化为 JSON */
  function sset(key, val) {
    try { localStorage.setItem('plugin:' + pluginId + ':' + key, JSON.stringify(val)); }
    catch (e) { /* 忽略 */ }
  }

  /* ------------------ 通用工具 ------------------ */

  /* 获取当前知识库根（桌面版）；失败返回 '' */
  async function refreshVault() {
    try {
      const v = await window.noteDesktop.getVault();
      if (v && v.path) vaultPath = v.path;
    } catch (e) { vaultPath = ''; }
    return vaultPath;
  }

  /* 探测 git 环境与库状态：{installed, isRepo, branch, remote}；无桥或未安装返回 null */
  async function probe() {
    if (!window.noteDesktop || !window.noteDesktop.git) { showToast('Git Sync 仅桌面版可用'); return null; }
    return await window.noteDesktop.git.check();
  }

  /* 执行一条 git 命令（cwd 固定为当前知识库根）；返回 {exit, stdout, stderr} */
  async function git(args) {
    return await window.noteDesktop.git.run({ cwd: vaultPath, args: args });
  }

  /* 更新状态栏式提示：显示当前分支等（无独立状态栏，用 toast 提示） */
  async function statusToast() {
    const p = await refreshVault();
    if (!p) return;
    const s = await probe();
    if (!s) return;
    if (!s.installed) { showToast('未检测到 Git'); return; }
    const st = await git(['status', '--porcelain']);
    let dirty = 0;
    if (st.exit === 0) dirty = st.stdout.trim() ? st.stdout.trim().split('\n').length : 0;
    const bits = ['Git', s.isRepo ? (s.branch || '无分支') : '未初始化'];
    if (dirty) bits.push('变更 ' + dirty);
    if (s.remote) bits.push(s.remote.split('/').pop());
    showToast(bits.join(' · '));
  }

  /* 初始化当前知识库为 Git 仓库（git init） */
  async function initRepo() {
    await refreshVault();
    const r = await git(['init']);
    if (r.exit !== 0) { showToast('初始化失败：' + r.stderr.trim()); return; }
    showToast('已初始化 Git 仓库');
  }

  /* 提交一次变更（可含推送）：执行 add → commit →（可选）push */
  async function commitNow(doPush) {
    await refreshVault();
    const st = await git(['status', '--porcelain']);
    if (st.exit !== 0 || !st.stdout.trim()) {
      // 无变更：仍提示
      showToast('没有可提交的变更');
      // 若要求推送且无变更也尝试推送
      if (doPush) await pushNow(false);
      return;
    }
    const add = await git(['add', '.']);
    if (add.exit !== 0) { showToast('git add 失败：' + add.stderr.trim()); return; }
    const now = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    const msg = 'auto: update ' + now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate())
      + ' ' + two(now.getHours()) + ':' + two(now.getMinutes());
    const cm = await git(['commit', '-m', msg]);
    if (cm.exit !== 0) { showToast('提交失败：' + cm.stderr.trim()); return; }
    showToast('已提交：' + (cm.stdout.trim() || msg));
    if (doPush) await pushNow(false);
  }

  /* 推送到远程（origin）；失败仅提示不回滚 */
  async function pushNow(silent) {
    const r = await git(['push', 'origin', 'HEAD']);
    if (r.exit !== 0) {
      if (!silent) showToast('推送失败：' + r.stderr.trim());
      return false;
    }
    showToast('已推送到远程');
    return true;
  }

  /* 拉取远程（供设置页手动使用，Git-04 保留） */
  async function pullNow() {
    const r = await git(['pull', '--ff-only']);
    if (r.exit !== 0) { showToast('拉取失败：' + r.stderr.trim()); return false; }
    showToast('已拉取最新');
    return true;
  }

  /* ------------------ 弹框 UI ------------------ */

  var modalEl = null; // 当前打开的弹框根元素

  /* 关闭当前弹框 */
  function closeModal() {
    if (modalEl && modalEl.parentNode) modalEl.parentNode.removeChild(modalEl);
    modalEl = null;
  }

  /* 打开一个弹框：bodyHTML 为内容，onBuild(modal)=可选初始化；返回 modal 容器 */
  function openModal(title, bodyHTML, onBuild) {
    closeModal();
    const ov = document.createElement('div');
    ov.className = 'gitsync-overlay';
    ov.innerHTML = '<div class="gitsync-modal">'
      + '<div class="gitsync-modal-head"><span>' + title + '</span>'
      + '<button class="gitsync-close" data-act="close">×</button></div>'
      + '<div class="gitsync-modal-body">' + bodyHTML + '</div>'
      + '</div>';
    document.body.appendChild(ov);
    modalEl = ov;
    ov.addEventListener('click', function (e) {
      const c = e.target.closest ? e.target.closest('[data-act="close"]') : null;
      if (c) closeModal();
    });
    if (onBuild) onBuild(ov.querySelector('.gitsync-modal'));
    return ov;
  }

  /* 版本历史弹框：列出最近 commit，支持查看 diff、还原到版本 */
  async function historyModal() {
    await refreshVault();
    const s = await probe();
    if (!s) return;
    if (!s.isRepo) { showToast('当前知识库尚未初始化 Git；请先初始化'); return; }
    const lg = await git(['log', '--format=%H%x1f%s%x1f%ad%x1f%an', '--date=format:%Y-%m-%d %H:%M', '-20']);
    showToast('正在读取版本历史…');
    if (lg.exit !== 0) { showToast('读取历史失败：' + lg.stderr.trim()); return; }
    const lines = lg.stdout.trim() ? lg.stdout.trim().split('\n') : [];
    let rows = '';
    if (!lines.length) rows = '<div class="gitsync-row gitsync-empty">暂无版本，请先提交</div>';
    lines.forEach(function (ln) {
      const parts = ln.split('\x1f');
      const hash = parts[0] || '', subj = parts[1] || '', date = parts[2] || '', author = parts[3] || '';
      rows += '<div class="gitsync-row gitsync-commit" data-hash="' + hash + '">'
        + '<div class="gitsync-commit-main"><span class="gitsync-hash">' + (hash.slice(0, 7)) + '</span>'
        + '<span class="gitsync-subj">' + subj + '</span></div>'
        + '<div class="gitsync-meta">' + date + ' · ' + author + '</div>'
        + '<div class="gitsync-actions">'
        + '<button data-cmd="diff" title="查看此版本相对上一版本的改动">Diff</button>'
        + '<button data-cmd="revert" class="danger" title="用此版本内容覆盖工作区（不动历史）">还原到此</button>'
        + '</div></div>';
    });
    openModal('版本历史', rows, function (m) {
      m.addEventListener('click', function (e) {
        const row = e.target.closest('[data-hash]');
        if (!row) return;
        const hash = row.getAttribute('data-hash');
        const cmd = e.target.closest('[data-cmd]');
        if (cmd && cmd.getAttribute('data-cmd') === 'diff') { diffModal(hash); }
        else if (cmd && cmd.getAttribute('data-cmd') === 'revert') { revertVersion(hash); }
      });
    });
  }

  /* Diff 弹框：显示指定版本相对其父版本的文本差异（截断展示） */
  async function diffModal(hash) {
    const d = await git(['diff', hash + '^', hash, '--stat']);
    const full = await git(['diff', hash + '^', hash]);
    let stat = d.exit === 0 ? d.stdout.trim() : '';
    let body = '';
    if (full.exit === 0) {
      body = '<pre class="gitsync-diff">' + escapeHtml(full.stdout.slice(0, 6000))
        + (full.stdout.length > 6000 ? '\n…（差异过长已截断）' : '') + '</pre>';
    }
    openModal('版本对比 ' + hash.slice(0, 7), '<div class="gitsync-stat">' + escapeHtml(stat) + '</div>' + body);
  }

  /* 还原到某版本：git checkout <hash> -- . 覆盖工作区（不移动 HEAD/历史，不管理分支） */
  async function revertVersion(hash) {
    if (!confirm('确定用版本 ' + hash.slice(0, 7) + ' 的内容覆盖当前工作区吗？\n该版本之后的修改将以覆盖方式被其内容替代。')) return;
    closeModal();
    await refreshVault();
    const r = await git(['checkout', hash, '--', '.']);
    if (r.exit !== 0) { showToast('还原失败：' + r.stderr.trim()); return; }
    showToast('已还原到版本 ' + hash.slice(0, 7));
  }

  /* Git 设置弹框：自动提交开关/间隔、自动推送、远程地址、初始化/拉取 */
  function settingsModal() {
    const autoCommit = gset('autoCommit', true);
    const intervalMin = gset('intervalMin', 10);
    const autoPush = gset('autoPush', false);
    openModal('Git Sync 设置',
      '<div class="gitsync-form">'
      + '<label class="gitsync-field"><input type="checkbox" id="gs-auto" ' + (autoCommit ? 'checked' : '') + '> 启用自动提交</label>'
      + '<label class="gitsync-field">间隔（分钟）<input type="number" id="gs-min" min="1" max="1440" value="' + intervalMin + '"></label>'
      + '<label class="gitsync-field"><input type="checkbox" id="gs-push" ' + (autoPush ? 'checked' : '') + '> 自动提交后自动推送远程</label>'
      + '<div class="gitsync-field">远程地址<input type="text" id="gs-remote" value="' + (window.__gsRemote || '') + '" placeholder="https:// 或 git@ 仓库地址"></div>'
      + '<div class="gitsync-form-actions">'
      + '<button data-act="set-remote">设置远程</button>'
      + '<button data-act="init">初始化仓库</button>'
      + '<button data-act="pull">拉取</button>'
      + '<button data-act="save" class="primary">保存</button>'
      + '</div></div>',
      function (m) {
        m.addEventListener('click', async function (e) {
          const actBtn = e.target.closest('[data-act]');
          if (!actBtn) return;
          const act = actBtn.getAttribute('data-act');
          if (act === 'save') {
            sset('autoCommit', m.querySelector('#gs-auto').checked);
            sset('intervalMin', Math.max(1, parseInt(m.querySelector('#gs-min').value || '10', 10)));
            sset('autoPush', m.querySelector('#gs-push').checked);
            saveRemote(m.querySelector('#gs-remote').value.trim());
            window.__gsAuto = m.querySelector('#gs-auto').checked;
            startTimer(); // 重启定时器以应用新的开关/间隔
            showToast('设置已保存');
            closeModal();
          } else if (act === 'set-remote') { saveRemote(m.querySelector('#gs-remote').value.trim()); }
          else if (act === 'init') { await initRepo(); statusToast(); }
          else if (act === 'pull') { await pullNow(); }
        });
      });
  }

  /* 设置/更新远程 origin 地址 */
  async function saveRemote(url) {
    await refreshVault();
    if (!url) { showToast('请输入远程仓库地址'); return; }
    const existing = await git(['remote', 'get-url', 'origin']);
    const args = existing.exit === 0
      ? ['remote', 'set-url', 'origin', url]
      : ['remote', 'add', 'origin', url];
    const r = await git(args);
    if (r.exit !== 0) { showToast('设置远程失败：' + r.stderr.trim()); return; }
    window.__gsRemote = url;
    showToast('远程地址已设置');
  }

  /* 从 Git 打开知识库：输入仓库 URL → 主进程克隆为独立知识库并打开 */
  async function cloneGit() {
    if (!window.noteDesktop || !window.noteDesktop.cloneGit) { showToast('仅桌面版可用'); return; }
    const url = prompt('请输入 Git 仓库地址（http/https/ssh/git@）\n将克隆为独立知识库并打开：');
    if (!url || !url.trim()) return;
    showToast('正在克隆，请稍候…');
    const res = await window.noteDesktop.cloneGit(url.trim());
    if (res && res.error) { showToast(res.error); return; }
    if (res && res.canceled) return;
    if (res && res.name) showToast('已打开知识库：' + res.name);
  }

  /* 切换自动提交开关（命令面板调用） */
  function toggleAutoCommit() {
    const now = !gset('autoCommit', true);
    sset('autoCommit', now);
    showToast(now ? '自动提交已开启（每 ' + gset('intervalMin', 10) + ' 分钟）' : '自动提交已关闭');
    window.__gsAuto = now;
  }

  /* HTML 转义，防注入弹框 */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ------------------ 自动提交定时器 ------------------ */

  var timer = null;

  /* 启动/重启自动提交定时器；每次读取最新设置（间隔变化自动生效） */
  function startTimer() {
    if (timer) { clearInterval(timer); timer = null; }
    if (!gset('autoCommit', true)) return;
    const min = Math.max(1, parseInt(gset('intervalMin', 10), 10) || 10);
    timer = setInterval(async function () {
      if (!gset('autoCommit', true)) { clearInterval(timer); timer = null; return; }
      await refreshVault();
      if (!vaultPath) return;
      const s = await probe();
      if (!s || !s.installed || !s.isRepo) return;
      await commitNow(gset('autoPush', false));
    }, min * 60 * 1000);
  }

  /* ------------------ 初始化 ------------------ */

  /* 启动初始化：记录初始开关状态、探测并预填远程、启动定时器 */
  (async function () {
    window.__gsAuto = gset('autoCommit', true);
    await refreshVault();
    const s = await probe();
    if (s && s.installed && s.isRepo && s.remote) window.__gsRemote = s.remote;
    startTimer();
  })();

  /* 向宿主注册全部 actionKey 回调 */
  PluginAPI.register(pluginId, {
    'git-status': statusToast,
    'git-commit': function () { commitNow(false); },
    'git-log': historyModal,
    'git-revert': historyModal,
    'git-sync-now': function () { commitNow(true); },
    'git-auto': toggleAutoCommit,
    'git-clone': cloneGit,
    'git-settings': settingsModal,
  });
})(PluginAPI, pluginId);