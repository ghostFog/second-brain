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
    // 未初始化：点击 Git 按钮直接引导初始化，避免只弹「未初始化」无法操作
    if (!s.isRepo) {
      const yes = confirm('当前知识库尚未初始化 Git 仓库。\n点击“确定”立即 git init（.md 文件进入版本控制）。');
      if (yes) await initRepo();
      return;
    }
    const st = await git(['status', '--porcelain']);
    let dirty = 0;
    if (st.exit === 0) dirty = st.stdout.trim() ? st.stdout.trim().split('\n').length : 0;
    const bits = ['Git', s.branch || '无分支'];
    if (dirty) bits.push('变更 ' + dirty);
    if (s.remote) bits.push(s.remote.split('/').pop());
    showToast(bits.join(' · '));
  }

  /* 初始化当前知识库为 Git 仓库（git init）；随后关闭路径转义（中文文件名可读） */
  async function initRepo() {
    await refreshVault();
    const r = await git(['init']);
    if (r.exit !== 0) { showToast('初始化失败：' + r.stderr.trim()); return; }
    await git(['config', 'core.quotepath', 'false']);
    showToast('已初始化 Git 仓库');
    updateUi();
  }

  /* 提交一次变更（可含推送）：执行 add → commit →（可选）push；silent=true 时无变更不提示（实时提交用） */
  async function commitNow(doPush, silent) {
    await refreshVault();
    const st = await git(['status', '--porcelain']);
    if (st.exit !== 0 || !st.stdout.trim()) {
      // 无变更：手动提交时提示，实时提交静默
      if (!silent) showToast('没有可提交的变更');
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
    showToast('已提交');
    updateUi();
    if (doPush) await pushNow(false);
  }

  /* Ribbon「同步」动作：未初始化→确认制引导 git init；已初始化→提交到仓库（并按设置推送）。作者: 火 冰 */
  async function syncNow() {
    await refreshVault();
    const s = await probe();
    if (!s) return;
    if (!s.installed) { showToast('未检测到 Git'); return; }
    if (!s.isRepo) {
      const yes = confirm('当前知识库尚未初始化 Git 仓库。\n点击“确定”立即 git init（.md 文件进入版本控制）。');
      if (yes) await initRepo();
      return;
    }
    await commitNow(gset('autoPush', false), false);
  }

  /* ------------------ 实时提交（文件变动即提交本地） ------------------ */

  var realTimeTimer = null;

  /* 文件树重绘作为「有变动」信号 → 防抖统一刷新：①目录树即时调整颜色（GIT-14）；
   * ②开启「实时提交」时静默提交本地。作者: 火 冰 */
  function scheduleFileTreeRefresh() {
    if (realTimeTimer) { clearTimeout(realTimeTimer); realTimeTimer = null; }
    realTimeTimer = setTimeout(async function () {
      realTimeTimer = null;
      await refreshVault();
      if (!vaultPath) return;
      const s = await probe();
      if (!s || !s.installed) return;
      if (s.isRepo) await applyTreeColoring(); // 文件变动后目录区即时调整颜色
      else clearTreeColoring();
      if (!gset('realTime', false)) return;    // 未开启实时提交则不提交
      if (s.isRepo) await commitNow(false, true); // 静默提交本地，无变更不打扰
    }, 1200);
  }

  /* 监听 #file-tree 重绘，作为「有变动」信号触发即时着色/实时提交；只挂载一次。作者: 火 冰 */
  var rtObserved = false;
  function bindFileTreeObserver() {
    if (rtObserved) return;
    const tree = document.getElementById('file-tree');
    if (!tree) return;
    rtObserved = true;
    try {
      new MutationObserver(scheduleFileTreeRefresh)
        .observe(tree, { childList: true, subtree: true });
    } catch (e) { /* 降级：不触发即时着色 */ }
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

  /* 解析 --name-status 块（GIT-12 历史改动文件）：块内首行为头部(%x1f 分隔)，其余为 "状态\t路径"（重命名可能还有旧路径） */
  function parseNameStatusBlock(blk) {
    const lines = blk.split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return null;
    const head = lines[0].split('\x1f');
    return {
      hash: head[0] || '', subj: head[1] || '', date: head[2] || '', author: head[3] || '',
      files: lines.slice(1).map(function (l) {
        const t = l.split('\t');
        return { status: (t[0] || ' ')[0], path: t[1] || t[0] || '' };
      }),
    };
  }

  /* 解析单文件 log 块：首行为头部字段，无 name-status 增量行 */
  function parseLogBlock(blk) {
    const lines = blk.split('\n').filter(function (l) { return l.trim(); });
    if (!lines.length) return null;
    const head = lines[0].split('\x1f');
    return { hash: head[0] || '', subj: head[1] || '', date: head[2] || '', author: head[3] || '', files: [] };
  }

  /* 目标路径解析：右键注入的 __pluginCtxNote 优先，回退当前打开笔记（edCurrent） */
  function resolveFileTarget() {
    if (window.__pluginCtxNote) return window.__pluginCtxNote;
    if (typeof window.edCurrent === 'string' && window.edCurrent) return window.edCurrent;
    return '';
  }

  /* 目标目录解析：右键注入的 __pluginCtxFolder（可能为 ''=根目录）；未右键目录时返回 null */
  function resolveDirTarget() {
    const f = window.__pluginCtxFolder;
    return (typeof f === 'string') ? f : null;
  }

  /* 版本历史弹框（库级，GIT-12：展示每次提交改动的文件清单，点文件看单文件差异） */
  async function historyModal() {
    await refreshVault();
    const s = await probe();
    if (!s) return;
    if (!s.isRepo) { showToast('当前知识库尚未初始化 Git；请先初始化'); return; }
    showToast('正在读取版本历史…');
    const r = await git(['log', '--format=%x1e%H%x1f%s%x1f%ad%x1f%an', '--name-status', '-20']);
    if (r.exit !== 0) { showToast('读取历史失败：' + r.stderr.trim()); return; }
    const blocks = (r.stdout || '').split('\x1e').filter(function (b) { return b.trim(); });
    let rows = '';
    if (!blocks.length) rows = '<div class="gitsync-row gitsync-empty">暂无版本，请先提交</div>';
    blocks.forEach(function (b) {
      const it = parseNameStatusBlock(b);
      if (!it) return;
      let filesHtml = '';
      if (it.files.length) {
        filesHtml = '<div class="gitsync-files" data-hash="' + it.hash + '">';
        it.files.forEach(function (f) {
          const stTxt = { M: 'M', A: 'A', D: 'D', R: 'R', C: 'C' }[f.status] || (f.status || ' ');
          filesHtml += '<div class="gitsync-file" data-hash="' + it.hash + '" data-path="' + escapeHtml(f.path) + '">'
            + '<span class="gitsync-file-status gs-' + stTxt.toLowerCase() + '">' + stTxt + '</span>'
            + '<span class="gitsync-filepath">' + escapeHtml(f.path) + '</span></div>';
        });
        filesHtml += '</div>';
      }
      rows += '<div class="gitsync-row gitsync-commit" data-hash="' + it.hash + '">'
        + '<div class="gitsync-commit-main"><span class="gitsync-hash">' + it.hash.slice(0, 7) + '</span>'
        + '<span class="gitsync-subj">' + escapeHtml(it.subj) + '</span></div>'
        + '<div class="gitsync-meta">' + escapeHtml(it.date) + ' · ' + escapeHtml(it.author) + '</div>'
        + filesHtml
        + '<div class="gitsync-actions">'
        + '<button data-cmd="diff" title="查看此版本相对上一版本的改动">Diff</button>'
        + '<button data-cmd="revert" class="danger" title="用此版本内容覆盖工作区（可选用清理未跟踪文件）">还原到此</button>'
        + '</div></div>';
    });
    openModal('版本历史', rows, function (m) {
      m.addEventListener('click', function (e) {
        const f = e.target.closest('.gitsync-file');
        if (f) { fileDiffModal(f.getAttribute('data-hash'), f.getAttribute('data-path')); return; }
        const row = e.target.closest('[data-hash]');
        if (!row) return;
        const hash = row.getAttribute('data-hash');
        const cmd = e.target.closest('[data-cmd]');
        if (cmd && cmd.getAttribute('data-cmd') === 'diff') diffModal(hash, null);
        else if (cmd && cmd.getAttribute('data-cmd') === 'revert') confirmRevert(hash, true, '');
      });
    });
  }

  /* 单文件版本历史弹框（GIT-10）：左右布局——左列提交列表（hash+时间+还原按钮），点击选中；
   * 右侧为对比框，顶部滑动开关切换「对比上一版本 / 对比本地文件」；
   * 该文件的历史（log）命令带 --date 短格式，便于左侧仅展示 hash 与时间。作者: 火 冰 */
  async function fileLogModal(relPath) {
    const s = await probe();
    if (!s || !s.isRepo) { showToast('当前知识库尚未初始化 Git；请先初始化'); return; }
    showToast('正在读取文件历史…');
    const r = await git(['log', '--format=%x1e%H%x1f%s%x1f%ad%x1f%an', '--date=format:%Y-%m-%d %H:%M', '-20', '--', relPath]);
    if (r.exit !== 0) { showToast('读取历史失败：' + r.stderr.trim()); return; }
    const blocks = (r.stdout || '').split('\x1e').filter(function (b) { return b.trim(); });
    if (!blocks.length) {
      openModal('文件历史 · ' + relPath, '<div class="gitsync-row gitsync-empty">该文件暂无提交历史</div>');
      return;
    }
    const items = blocks.map(function (b) { return parseLogBlock(b); }).filter(Boolean);
    let side = '';
    items.forEach(function (it) {
      side += '<div class="gsfh-item" data-hash="' + it.hash + '">'
        + '<span class="gsfh-hash">' + it.hash.slice(0, 7) + '</span>'
        + '<span class="gsfh-time">' + escapeHtml(it.date) + '</span>'
        + '<button data-cmd="revert" class="gsfh-revert" title="把此文件还原到该版本的内容">还原</button>'
        + '</div>';
    });
    openModal('文件历史 · ' + relPath,
      '<div class="gitsync-fhist">'
        + '<div class="gitsync-fhist-side" id="gsfh-side">' + side + '</div>'
        + '<div class="gitsync-fhist-main">'
          + '<div class="gsfh-mode">'
            + '<label class="gsfh-toggle" title="开启=对比本地文件；关闭=对比上一版本">'
            + '<input type="checkbox" id="gsfh-local" checked><span class="gsfh-switch"></span></label>'
            + '<span class="gsfh-mode-text">对比本地文件</span>'
          + '</div>'
          + '<pre class="gsfh-diff" id="gsfh-diff">加载中…</pre>'
        + '</div>'
      + '</div>',
      function (m) {
        m.classList.add('gitsync-modal-lg');
        const sideEl = m.querySelector('#gsfh-side');
        const toggle = m.querySelector('#gsfh-local');
        const diffEl = m.querySelector('#gsfh-diff');
        const modeText = m.querySelector('.gsfh-mode-text');
        let curHash = items[0].hash;

        /* 在右侧对比框渲染指定 hash 在当前开关模式下的 diff（开启=对比本地，关闭=对比上一版本） */
        async function loadDiff(hash) {
          modeText.textContent = toggle.checked ? '对比本地文件' : '对比上一版本';
          diffEl.textContent = '加载中…';
          const args = toggle.checked ? ['diff', hash, '--', relPath] : ['diff', hash + '^', hash, '--', relPath];
          const res = await git(args);
          diffEl.textContent = (res.exit === 0 && res.stdout.trim()) ? res.stdout : '（无差异）';
        }

        /* 选中左侧某条提交：更新高亮并刷新右侧对比框 */
        function selectItem(hash) {
          curHash = hash;
          const nodes = sideEl.querySelectorAll('.gsfh-item');
          for (let i = 0; i < nodes.length; i++) {
            nodes[i].classList.toggle('is-active', nodes[i].getAttribute('data-hash') === hash);
          }
          loadDiff(hash);
        }

        toggle.addEventListener('change', function () { loadDiff(curHash); });
        sideEl.addEventListener('click', function (e) {
          const revertBtn = e.target.closest('[data-cmd="revert"]');
          if (revertBtn) { // 还原收敛到左侧「还原」按钮
            const hash = revertBtn.closest('[data-hash]').getAttribute('data-hash');
            confirmRevert(hash, false, relPath);
            return;
          }
          const it = e.target.closest('.gsfh-item');
          if (it) selectItem(it.getAttribute('data-hash'));
        });
        selectItem(items[0].hash); // 默认选中最新一条
      });
  }

  /* 当前分支相对跟踪远端（origin/<branch>）的引用；未配置跟踪分支或异常时返回 ''。作者: 火 冰 */
  async function currentUpstream() {
    const up = await git(['rev-parse', '--abbrev-ref', '@{upstream}']);
    if (up.exit !== 0 || !up.stdout.trim()) return '';
    return up.stdout.trim();
  }

  /* 合并提交（整仓，右键空白区 Git）：把当前分支所有未推送提交压缩为一笔。
   * git reset --soft <upstream> 把提交退回暂存区（不动工作区）后再 commit，内容全保留、仅压缩历史。作者: 火 冰 */
  async function squashAll() {
    await refreshVault();
    const upstream = await currentUpstream();
    if (!upstream) { showToast('未配置跟踪远端分支，无法合并提交'); return; }
    const cnt = await git(['log', '--oneline', upstream + '..HEAD']);
    if (cnt.exit === 0 && !cnt.stdout.trim()) { showToast('没有未推送的提交'); return; }
    const n = cnt.stdout.trim().split('\n').length;
    const r = await git(['reset', '--soft', upstream]);
    if (r.exit !== 0) { showToast('合并失败：' + r.stderr.trim()); return; }
    const cm = await git(['commit', '-m', '合并 ' + n + ' 笔未推送提交']);
    if (cm.exit !== 0) { showToast('合并提交失败：' + cm.stderr.trim()); return; }
    showToast('已合并为 1 笔提交');
    updateUi();
    if (PluginAPI && PluginAPI.editor && typeof window.edCurrent === 'string' && window.edCurrent) {
      PluginAPI.editor.reloadNote(window.edCurrent);
    }
  }

  /* 合并提交（单文件，右键笔记 Git）：把该文件相对跟踪远端的未推送改动压缩为一笔仅含该文件的提交。
   * git reset <upstream>（mixed，不动工作区）撤出未推送提交 → 仅暂存该文件 → 单独 commit；
   * 其它文件的未推送改动降为工作区未暂存（内容不丢）。作者: 火 冰 */
  async function squashFile(relPath) {
    await refreshVault();
    const upstream = await currentUpstream();
    if (!upstream) { showToast('未配置跟踪远端分支，无法合并提交'); return; }
    const chk = await git(['diff', upstream, 'HEAD', '--name-only', '--', relPath]);
    if (chk.exit === 0 && !chk.stdout.trim()) { showToast('该文件在未推送提交中无变更'); return; }
    const r = await git(['reset', upstream]);
    if (r.exit !== 0) { showToast('合并失败：' + r.stderr.trim()); return; }
    const add = await git(['add', '--', relPath]);
    if (add.exit !== 0) { showToast('合并失败：' + add.stderr.trim()); return; }
    const cm = await git(['commit', '-m', '合并提交：' + relPath]);
    if (cm.exit !== 0) { showToast('合并提交失败：' + cm.stderr.trim()); return; }
    showToast('已把该文件未推送改动合并为 1 笔提交');
    updateUi();
    if (PluginAPI && PluginAPI.editor) PluginAPI.editor.reloadNote(relPath);
  }

  /* 提交该目录（右键目录 Git）：仅暂存并提交该目录下的变更到本地仓库。作者: 火 冰 */
  async function commitDir(dir) {
    await refreshVault();
    const pathArg = dir ? dir : '.';
    const st = await git(['status', '--porcelain', '--', pathArg]);
    if (st.exit !== 0 || !st.stdout.trim()) { showToast('该目录下没有可提交的变更'); return; }
    const add = await git(['add', '--', pathArg]);
    if (add.exit !== 0) { showToast('git add 失败：' + add.stderr.trim()); return; }
    const now = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    const msg = '提交目录：' + (dir || '根目录') + ' ' + now.getFullYear() + '-' + two(now.getMonth() + 1)
      + '-' + two(now.getDate()) + ' ' + two(now.getHours()) + ':' + two(now.getMinutes());
    const cm = await git(['commit', '-m', msg]);
    if (cm.exit !== 0) { showToast('提交失败：' + cm.stderr.trim()); return; }
    showToast('已提交该目录');
    updateUi();
  }

  /* 合并提交（目录，右键目录 Git）：把该目录下所有文件相对跟踪远端的未推送改动合并为一笔仅含该目录的提交。
   * reset(mixed) 撤出未推送提交（不动工作区）→ 仅暂存该目录 → 单独 commit；其它改动留工作区不丢。作者: 火 冰 */
  async function squashDir(dir) {
    await refreshVault();
    const upstream = await currentUpstream();
    if (!upstream) { showToast('未配置跟踪远端分支，无法合并提交'); return; }
    const pathArg = dir ? dir : '.';
    const chk = await git(['diff', upstream, 'HEAD', '--name-only', '--', pathArg]);
    if (chk.exit === 0 && !chk.stdout.trim()) { showToast('该目录下未推送提交中无变更'); return; }
    const r = await git(['reset', upstream]);
    if (r.exit !== 0) { showToast('合并失败：' + r.stderr.trim()); return; }
    const add = await git(['add', '--', pathArg]);
    if (add.exit !== 0) { showToast('合并失败：' + add.stderr.trim()); return; }
    const cm = await git(['commit', '-m', '合并提交目录：' + (dir || '根目录')]);
    if (cm.exit !== 0) { showToast('合并提交失败：' + cm.stderr.trim()); return; }
    showToast('已把该目录未推送改动合并为 1 笔提交');
    updateUi();
  }

  /* 对比上次提交（右键 Git 二级菜单·对比）：展示该文件工作区相对 HEAD（上次提交）的差异弹框。作者: 火 冰 */
  async function diffWorkingModal(relPath) {
    const s = await probe();
    if (!s || !s.isRepo) { showToast('当前知识库尚未初始化 Git；请先初始化'); return; }
    const r = await git(['diff', 'HEAD', '--', relPath]);
    openModal('对比上次提交 · ' + relPath,
      '<pre class="gsfh-diff">' + escapeHtml(r.exit === 0 && r.stdout ? r.stdout : '（无差异）') + '</pre>',
      function (m) { m.classList.add('gitsync-modal-lg'); });
  }

  /* 放弃修改（右键 Git 二级菜单·回滚）：把该文件工作区改动回滚到上次提交内容（git checkout -- <path>），需确认。作者: 火 冰 */
  async function revertWorkingFile(relPath) {
    if (!confirm('放弃「' + relPath + '」未提交的修改，回滚到上次提交的内容？')) return;
    await refreshVault();
    const r = await git(['checkout', '--', relPath]);
    if (r.exit !== 0) { showToast('回滚失败：' + r.stderr.trim()); return; }
    showToast('已放弃修改：' + relPath.split('/').pop());
    updateUi();
    // 磁盘已回滚，刷新编辑器到磁盘真实内容（避免旧缓存被失焦自动保存写回覆盖回滚结果）
    if (PluginAPI && PluginAPI.editor) PluginAPI.editor.reloadNote(relPath);
  }

  /* 提交该文件（右键 Git 二级菜单·提交）：仅暂存并提交指定笔记到本地仓库。作者: 火 冰 */
  async function commitFile(relPath) {
    await refreshVault();
    const add = await git(['add', '--', relPath]);
    if (add.exit !== 0) { showToast('git add 失败：' + add.stderr.trim()); return; }
    const now = new Date();
    function two(n) { return String(n).padStart(2, '0'); }
    const msg = 'auto: update ' + now.getFullYear() + '-' + two(now.getMonth() + 1) + '-' + two(now.getDate())
      + ' ' + two(now.getHours()) + ':' + two(now.getMinutes());
    const cm = await git(['commit', '-m', msg]);
    if (cm.exit !== 0) { showToast('提交失败：' + cm.stderr.trim()); return; }
    showToast('已提交：' + relPath.split('/').pop());
    updateUi();
  }

  /* Diff 弹框：fileRel=null 看整次提交；给定 fileRel 只看单个文件（GIT-10/12） */
  async function diffModal(hash, fileRel) {
    const whole = fileRel == null;
    const tail = whole ? [] : ['--', fileRel];
    const st = await git(['diff', hash + '^', hash, '--stat'].concat(tail));
    const full = await git(['diff', hash + '^', hash].concat(tail));
    let stat = st.exit === 0 ? st.stdout.trim() : '';
    let body = '';
    if (full.exit === 0) {
      body = '<pre class="gitsync-diff">' + escapeHtml(full.stdout.slice(0, 6000))
        + (full.stdout.length > 6000 ? '\n…（差异过长已截断）' : '') + '</pre>';
    }
    openModal('版本对比 ' + hash.slice(0, 7) + (fileRel ? ' · ' + fileRel : ''), '<div class="gitsync-stat">' + escapeHtml(stat) + '</div>' + body);
  }

  /* 单文件在某提交的差异（GIT-12 历史清单点文件） */
  async function fileDiffModal(hash, relPath) {
    const st = await git(['diff', hash + '^', hash, '--', relPath, '--stat']);
    const full = await git(['show', hash, '--', relPath]);
    const stat = st.exit === 0 && st.stdout.trim() ? '<div class="gitsync-stat">' + escapeHtml(st.stdout.trim()) + '</div>' : '';
    let body = '';
    if (full.exit === 0) {
      body = '<pre class="gitsync-diff">' + escapeHtml(full.stdout.slice(0, 6000))
        + (full.stdout.length > 6000 ? '\n…（差异过长已截断）' : '') + '</pre>';
    }
    openModal('文件改动 ' + relPath + ' @ ' + hash.slice(0, 7), stat + body);
  }

  /* 还原确认（GIT-10/11）：vault=true 整库还原并可选清理未跟踪文件；false 仅还原单个文件 */
  function confirmRevert(hash, vault, relPath) {
    if (vault) {
      const body = '<div class="gitsync-form">'
        + '<p style="margin:0 0 10px;color:var(--note-ink);font-size:13px;line-height:1.6;">'
        + '用版本 <b>' + escapeHtml(hash.slice(0, 7)) + '</b> 的内容覆盖当前工作区？<br>该版本之后的修改将被其内容替代（不动历史）。</p>'
        + '<label class="gitsync-field"><input type="checkbox" id="gs-clean"> '
        + '同时清理该版本之后新增的未跟踪文件与空目录（git clean -fd）</label>'
        + '<div class="gitsync-form-actions">'
        + '<button data-act="cancel">取消</button>'
        + '<button data-act="ok" class="danger">确认还原</button>'
        + '</div></div>';
      openModal('还原到版本 ' + hash.slice(0, 7), body, function (m) {
        m.addEventListener('click', async function (e) {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          const act = b.getAttribute('data-act');
          if (act === 'cancel') { closeModal(); return; }
          if (act === 'ok') {
            const clean = !!m.querySelector('#gs-clean') && m.querySelector('#gs-clean').checked;
            closeModal();
            await doRevert(hash, true, '', clean);
          }
        });
      });
    } else {
      if (!confirm('将此文件「' + relPath + '」还原为版本 ' + hash.slice(0, 7) + ' 的内容？')) return;
      closeModal();
      doRevert(hash, false, relPath, false);
    }
  }

  /* 实际执行还原：git checkout <hash> -- (路径)；整库还原可再 git clean -fd 清理未跟踪文件（GIT-11） */
  async function doRevert(hash, vault, relPath, clean) {
    await refreshVault();
    const args = vault ? ['checkout', hash, '--', '.'] : ['checkout', hash, '--', relPath];
    const r = await git(args);
    if (r.exit !== 0) { showToast('还原失败：' + r.stderr.trim()); return; }
    if (clean) {
      const c = await git(['clean', '-fd']);
      if (c.exit !== 0) { showToast('还原成功，但清理未跟踪文件失败：' + c.stderr.trim()); updateUi(); return; }
    }
    showToast('已还原到版本 ' + hash.slice(0, 7));
    updateUi();
    // 工作区已还原，当前打开的笔记也刷新到磁盘最近内容（防止旧缓存/失焦写回覆盖还原结果）
    if (PluginAPI && PluginAPI.editor && typeof window.edCurrent === 'string' && window.edCurrent) {
      PluginAPI.editor.reloadNote(window.edCurrent);
    }
  }

  /* Git 设置弹框：自动提交开关/间隔、自动推送、远程地址、初始化/拉取 */
  function settingsModal() {
    const autoCommit = gset('autoCommit', true);
    const intervalMin = gset('intervalMin', 10);
    const autoPush = gset('autoPush', false);
    const realTime = gset('realTime', false);
    openModal('Git Sync 设置',
      '<div class="gitsync-form">'
      + '<label class="gitsync-field"><input type="checkbox" id="gs-auto" ' + (autoCommit ? 'checked' : '') + '> 启用自动提交</label>'
      + '<label class="gitsync-field">间隔（分钟）<input type="number" id="gs-min" min="1" max="1440" value="' + intervalMin + '"></label>'
      + '<label class="gitsync-field"><input type="checkbox" id="gs-rt" ' + (realTime ? 'checked' : '') + '> 实时提交（文件变动即提交本地仓库）</label>'
      + '<label class="gitsync-field"><input type="checkbox" id="gs-push" ' + (autoPush ? 'checked' : '') + '> 自动提交后自动推送远程</label>'
      + '<div class="gitsync-field">远程地址<input type="text" id="gs-remote" value="' + (window.__gsRemote || '') + '" placeholder="https:// 或 git@ 仓库地址"></div>'
      + '<div class="gitsync-form-actions">'
      + '<button data-act="set-remote">设置远程</button>'
      + '<button data-act="gitignore">编辑 .gitignore</button>'
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
            sset('realTime', m.querySelector('#gs-rt').checked);
            window.__gsRealTime = m.querySelector('#gs-rt').checked;
            saveRemote(m.querySelector('#gs-remote').value.trim());
            window.__gsAuto = m.querySelector('#gs-auto').checked;
            startTimer(); // 重启定时器以应用新的开关/间隔
            showToast('设置已保存');
            closeModal();
          } else if (act === 'set-remote') { saveRemote(m.querySelector('#gs-remote').value.trim()); }
          else if (act === 'gitignore') { editGitignoreModal(); }
          else if (act === 'init') { await initRepo(); statusToast(); }
          else if (act === 'pull') { await pullNow(); }
        });
      });
  }

  /* 编辑当前知识库 .gitignore（自动提交忽略规则，GIT 过滤设置）：读库根 .gitignore 到文本域，
   * 保存写回库根。git add . 天然尊重 .gitignore，因此忽略的路径不会进入自动提交。作者: 火 冰 */
  async function editGitignoreModal() {
    await refreshVault();
    if (!vaultPath) { showToast('无法定位知识库'); return; }
    let content = '';
    try { content = await window.noteDesktop.readNote('.gitignore'); }
    catch (e) { /* 尚未创建 .gitignore，按空内容处理 */ }
    openModal('编辑 .gitignore（自动提交忽略规则）',
      '<div class="gitsync-form">'
      + '<p class="gitsync-hint">每行一条忽略规则（相对库根），被忽略的文件不会进入自动提交。'
      + '示例：<code>.obsidian/</code>、<code>downloads/</code>、<code>*.tmp</code></p>'
      + '<textarea id="gs-gitignore" class="gitsync-gitignore" spellcheck="false">' + escapeHtml(content) + '</textarea>'
      + '<div class="gitsync-form-actions">'
      + '<button data-act="cancel">取消</button>'
      + '<button data-act="save" class="primary">保存</button>'
      + '</div></div>',
      function (m) {
        m.addEventListener('click', async function (e) {
          const b = e.target.closest('[data-act]');
          if (!b) return;
          const act = b.getAttribute('data-act');
          if (act === 'cancel') { closeModal(); return; }
          if (act === 'save') {
            const text = m.querySelector('#gs-gitignore').value;
            const res = await window.noteDesktop.saveNote('.gitignore', text);
            closeModal();
            showToast('已保存 .gitignore');
            updateUi();
          }
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

  /* ------------------ 目录树状态着色（GIT-14；GIT-13 常驻状态条已取消） ------------------ */

  var statusBusy = false; // 防并发轮询
  var statusTimer = null;

  /* 拉取 status --porcelain -z，构造 { untracked, staged, modified } */
  async function collectGitState() {
    const st = await git(['status', '--porcelain', '-z']);
    const untracked = new Set(), staged = new Set(), modified = new Set();
    if (st.exit === 0 && st.stdout) {
      const recs = st.stdout.split('\0');
      for (let i = 0; i < recs.length; i++) {
        const rec = recs[i];
        if (!rec) continue;
        const x = rec.charAt(0), y = rec.charAt(1);
        if (x === '?') { untracked.add(rec.slice(2)); continue; }
        let path = rec.slice(3); // "XY PATH"
        if (x === 'R') { // 重命名：-z 下紧随的下一条是目标路径
          if (recs[i + 1]) { i++; path = recs[i].slice(3); }
        }
        if (x === ' ' && (y === 'M' || y === 'D')) modified.add(path);
        else if (x !== ' ') staged.add(path);
      }
    }
    return { untracked: untracked, staged: staged, modified: modified };
  }

  /* 把 Git 状态集写进全局着色映射 window.__gsColoring（path → 'untracked'|'staged'|'modified'）。
   * 宿主 renderFileTree 渲染 .tree-file 时直接读取拼接 class，实现「渲染即带状态色」，
   * 避免 DOM 重建后再异步补色造成闪烁。作者: 火 冰 */
  function buildColoringMap(g) {
    const map = window.__gsColoring || (window.__gsColoring = {});
    for (const k in map) delete map[k];
    g.untracked.forEach(function (p) { map[p] = 'untracked'; });
    g.staged.forEach(function (p) { map[p] = 'staged'; });
    g.modified.forEach(function (p) { map[p] = 'modified'; });
  }

  /* 目录树状态着色（GIT-14，对齐 IDEA 深色）：未跟踪=红橙 / 暂存=绿 / 修改=蓝。
   * 更新全局着色映射供宿主渲染时读取；并对已存在 DOM 就地补/改 class（首帧或宿主未重渲染时兜底）。
   * 目录不单独着色，使用宿主默认色。作者: 火 冰 */
  async function applyTreeColoring() {
    if (!document.querySelector('.tree-file')) return;
    const g = await collectGitState();
    buildColoringMap(g);
    const nodes = document.querySelectorAll('.tree-file[data-path]');
    nodes.forEach(function (n) {
      // 已打开(高亮)节点保持原样式，避免绿底上的彩色文字难读
      if ((n.style.cssText || '').indexOf('note-brand-600') !== -1) return;
      const p = n.getAttribute('data-path') || '';
      const cls = window.__gsColoring[p] || '';
      n.classList.remove('gs-untracked', 'gs-staged', 'gs-modified');
      if (cls) n.classList.add('gs-' + cls);
    });
  }

  /* 清空目录树所有状态着色并清空全局着色映射（非仓库时调用，避免残留过时颜色）。作者: 火 冰 */
  function clearTreeColoring() {
    const map = window.__gsColoring;
    if (map) { for (const k in map) delete map[k]; }
    const nodes = document.querySelectorAll('.tree-file[data-path]');
    nodes.forEach(function (n) {
      n.classList.remove('gs-untracked', 'gs-staged', 'gs-modified');
    });
  }

  /* 统一刷新目录树着色（GIT-14）：非仓库清空颜色，仓库则更新映射并就地补/改色。
   * GIT-13 常驻状态条已取消（左下贴边会遮挡目录区），状态反馈收敛到目录树状态着色。作者: 火 冰 */
  async function refreshStatusBar() {
    if (statusBusy) return;
    statusBusy = true;
    try {
      const p = await refreshVault();
      const s = p ? await probe() : null;
      if (!s || !s.installed) { clearTreeColoring(); return; }
      if (!s.isRepo) { clearTreeColoring(); return; }
      await git(['config', 'core.quotepath', 'false']);
      await applyTreeColoring();
    } catch (e) { /* 静默降级 */ }
    finally { statusBusy = false; }
  }

  /* 统一 UI 刷新入口：任何 git 动作后调用 */
  function updateUi() { refreshStatusBar(); }

  /* 启动 30s 状态轮询（与自动提交定时器相互独立） */
  function startStatusTimer() {
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    statusTimer = setInterval(function () { refreshStatusBar(); }, 30000);
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

  /* 启动初始化：记录初始开关状态、探测并预填远程、启动自动提交与状态刷新 */
  (async function () {
    window.__gsAuto = gset('autoCommit', true);
    await refreshVault();
    const s = await probe();
    if (s && s.installed && s.isRepo) {
      if (s.remote) window.__gsRemote = s.remote;
      await git(['config', 'core.quotepath', 'false']);
    }
    startTimer();
    startStatusTimer(); // 常驻状态条 + 目录树着色轮询
    bindFileTreeObserver(); // 文件变动即时调色 + 实时提交：监听文件树重绘
    refreshStatusBar();
  })();

  /* 向宿主注册全部 actionKey 回调 */
  PluginAPI.register(pluginId, {
    'git-sync': syncNow,  // Ribbon 同步：未初始化→确认初始化；已初始化→提交
    'git-status': syncNow, // 兼容旧 ribbon 若仍走 git-status，改为同步
    'git-commit': function () { commitNow(false); },
    'git-log': historyModal,
    'git-revert': historyModal,
    'git-file-log': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } fileLogModal(p); },
    'git-file-revert': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } fileLogModal(p); },
    /* 右键 Git 二级菜单（GIT-17）：目标文件来自 resolveFileTarget（右键注入） */
    'gs-ctx-diff': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } diffWorkingModal(p); },
    'gs-ctx-history': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } fileLogModal(p); },
    'gs-ctx-revert': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } revertWorkingFile(p); },
    'gs-ctx-commit': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } commitFile(p); },
    'gs-ctx-pull': function () { pullNow(); },
    'gs-ctx-push': function () { pushNow(false); },
    'gs-ctx-squash': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } squashFile(p); },
    'gs-ctx-repo-commit': function () { commitNow(false); },
    'gs-ctx-repo-squash': function () { squashAll(); },
    'gs-ctx-repo-pull': function () { pullNow(); },
    'gs-ctx-repo-push': function () { pushNow(false); },
    'gs-ctx-dir-commit': function () { const d = resolveDirTarget(); if (d === null) { showToast('请先右键选择目录'); return; } commitDir(d); },
    'gs-ctx-dir-squash': function () { const d = resolveDirTarget(); if (d === null) { showToast('请先右键选择目录'); return; } squashDir(d); },
    'gs-ctx-dir-push': function () { pushNow(false); },
    'git-sync-now': function () { commitNow(true); },
    'git-auto': toggleAutoCommit,
    'git-clone': cloneGit,
    'git-settings': settingsModal,
  });
})(PluginAPI, pluginId);