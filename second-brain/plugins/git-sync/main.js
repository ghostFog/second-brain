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
    updateUi();
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

  /* 单文件版本历史弹框（GIT-10）：列出影响该文件的提交，可查看该文件差异 / 还原该文件到版本 */
  async function fileLogModal(relPath) {
    const s = await probe();
    if (!s || !s.isRepo) { showToast('当前知识库尚未初始化 Git；请先初始化'); return; }
    showToast('正在读取文件历史…');
    const r = await git(['log', '--format=%x1e%H%x1f%s%x1f%ad%x1f%an', '-20', '--', relPath]);
    if (r.exit !== 0) { showToast('读取历史失败：' + r.stderr.trim()); return; }
    const blocks = (r.stdout || '').split('\x1e').filter(function (b) { return b.trim(); });
    let rows = '';
    if (!blocks.length) rows = '<div class="gitsync-row gitsync-empty">该文件暂无提交历史</div>';
    blocks.forEach(function (b) {
      const it = parseLogBlock(b);
      if (!it) return;
      rows += '<div class="gitsync-row gitsync-commit" data-hash="' + it.hash + '">'
        + '<div class="gitsync-commit-main"><span class="gitsync-hash">' + it.hash.slice(0, 7) + '</span>'
        + '<span class="gitsync-subj">' + escapeHtml(it.subj) + '</span></div>'
        + '<div class="gitsync-meta">' + escapeHtml(it.date) + ' · ' + escapeHtml(it.author) + '</div>'
        + '<div class="gitsync-actions">'
        + '<button data-cmd="diff" title="查看此文件在该版本的改动">Diff</button>'
        + '<button data-cmd="revert" class="danger" title="把此文件还原到该版本的内容">还原此文件</button>'
        + '</div></div>';
    });
    openModal('文件历史 · ' + relPath, rows, function (m) {
      m.addEventListener('click', function (e) {
        const row = e.target.closest('[data-hash]');
        if (!row) return;
        const hash = row.getAttribute('data-hash');
        const cmd = e.target.closest('[data-cmd]');
        if (cmd && cmd.getAttribute('data-cmd') === 'diff') fileDiffModal(hash, relPath);
        else if (cmd && cmd.getAttribute('data-cmd') === 'revert') confirmRevert(hash, false, relPath);
      });
    });
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

  /* ------------------ Git 状态指示 + 目录树着色（GIT-13/14） ------------------ */

  var statusEl = null;   // 常驻状态条元素
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

  /* 目录树状态着色（GIT-14，对齐 IDEA 深色）：未跟踪=红橙 / 暂存=绿 / 修改=蓝 */
  async function applyTreeColoring() {
    if (!document.querySelector('.tree-file')) return;
    const g = await collectGitState();
    const nodes = document.querySelectorAll('.tree-file[data-path]');
    const dirtyFolders = new Set();
    g.untracked.forEach(addFolder); g.staged.forEach(addFolder); g.modified.forEach(addFolder);
    function addFolder(p) { const i = p.indexOf('/'); if (i > 0) dirtyFolders.add(p.slice(0, i)); }
    nodes.forEach(function (n) {
      // 已打开(高亮)节点保持原样式，避免绿底上的彩色文字难读
      if ((n.style.cssText || '').indexOf('note-brand-600') !== -1) return;
      const p = n.getAttribute('data-path') || '';
      n.classList.remove('gs-untracked', 'gs-staged', 'gs-modified');
      if (g.untracked.has(p)) n.classList.add('gs-untracked');
      else if (g.staged.has(p)) n.classList.add('gs-staged');
      else if (g.modified.has(p)) n.classList.add('gs-modified');
    });
    document.querySelectorAll('.tree-folder[data-folder]').forEach(function (f) {
      f.classList.toggle('gs-dirty', dirtyFolders.has(f.getAttribute('data-folder') || ''));
    });
  }

  /* 常驻状态条创建（懒加载） */
  function ensureStatusBar() {
    if (statusEl && statusEl.parentNode) return statusEl;
    statusEl = document.createElement('button');
    statusEl.id = 'gitsync-statusbar';
    statusEl.type = 'button';
    statusEl.addEventListener('click', function () { statusToast(); });
    document.body.appendChild(statusEl);
    return statusEl;
  }
  function showStatus(text) { ensureStatusBar().textContent = text; statusEl.style.display = 'inline-flex'; }
  function hideStatusBar() { if (statusEl) statusEl.style.display = 'none'; }

  /* 刷新常驻状态条（分支 · 待提交数）并触发目录树着色；失败降级隐藏计数不影响默认样式 */
  async function refreshStatusBar() {
    if (statusBusy) return;
    statusBusy = true;
    try {
      const p = await refreshVault();
      const s = p ? await probe() : null;
      if (!s || !s.installed) { hideStatusBar(); return; }
      if (!s.isRepo) { showStatus('Git · 未初始化'); return; }
      await git(['config', 'core.quotepath', 'false']);
      const g = await collectGitState();
      const dirty = g.untracked.size + g.staged.size + g.modified.size;
      showStatus('Git · ' + (s.branch || '无分支') + (dirty ? ' · 变更 ' + dirty : ''));
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
    refreshStatusBar();
  })();

  /* 向宿主注册全部 actionKey 回调 */
  PluginAPI.register(pluginId, {
    'git-status': statusToast,
    'git-commit': function () { commitNow(false); },
    'git-log': historyModal,
    'git-revert': historyModal,
    'git-file-log': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } fileLogModal(p); },
    'git-file-revert': function () { const p = resolveFileTarget(); if (!p) { showToast('请先右键选择一篇笔记，或打开当前笔记'); return; } fileLogModal(p); },
    'git-sync-now': function () { commitNow(true); },
    'git-auto': toggleAutoCommit,
    'git-clone': cloneGit,
    'git-settings': settingsModal,
  });
})(PluginAPI, pluginId);