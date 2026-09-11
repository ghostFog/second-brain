/* ============================================
 * 第二脑 — 设置视图·基础与通用控件
 * 作者: 火 冰
 * 功能: 设置分类映射(CATS)、面板外壳/行控件生成、持久化(sState/saveS/restoreS)、
 *       Toast 提示、设置侧效应、通用键值控件/关闭按钮行为/文件类型绑定
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）
 * ============================================ */

'use strict';

  /* ============================
   * 设置视图交互
   * ============================ */

  const CATS = {
    '常规': ['常规', '外观、通用偏好与应用行为'],
    '编辑器': ['编辑器', '调整编辑器的行为与显示'],
    '快捷键': ['快捷键', '管理应用中的快捷键'],
    '同步与备份': ['同步与备份', '管理云端同步与本地备份'],
    '隐私与安全': ['隐私与安全', '管理你的隐私与安全选项'],
    '插件管理': ['插件管理', '安装与管理插件'],
    'AI 问答': ['AI 问答', '配置本地模型与远程大模型'],
    '关于': ['关于', '版本信息与反馈'],
  };

  /* 生成设置面板外壳：标题 + 副标题 + 内容体 */
  function settingsPanel(cat, titles, bodyHtml) {
    return '<div class="mb-8"><h1 id="settings-title" class="text-h2" style="color:var(--note-ink);">' + titles[0] + '</h1><p id="settings-sub" class="text-caption mt-1.5" style="color:var(--note-ink-3);">' + titles[1] + '</p></div>' + bodyHtml;
  }

  /* 生成一行设置项（标题 + 副标题 + 开关） */
  function tgRow(title, sub, on, skey) {
    return '<div class="flex items-center justify-between py-3"><div class="flex-1 pr-4"><div class="text-[14px]" style="color:var(--note-ink);">' + title + '</div><div class="text-caption" style="color:var(--note-ink-3);">' + sub + '</div></div><label class="toggle"><input type="checkbox" data-skey="' + skey + '"' + (on ? ' checked' : '') + '><span class="toggle-track"></span></label></div>';
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
