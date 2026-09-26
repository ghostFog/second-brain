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
    if (t) t.remove();
    t = document.createElement('div');
    t.id = 'set-toast';
    t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:999;padding:8px 16px;border-radius:8px;font-size:13px;opacity:1;transition:opacity .2s;background:var(--note-ink);color:var(--note-background);box-shadow:0 4px 16px rgba(0,0,0,.25);';
    t.textContent = msg;
    document.body.appendChild(t);
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(function () { t.remove(); }, 1800);
  }

  /* 设置项副作用映射：返回已应用文案，无副作用返回 null */
  function settingsSideEffect(key, val) {
    const on = val === true || val === 'true' || val === 1 || val === '1';
    if (key === 'edMode') { const v = (val === '预览' || val === 'preview') ? 'preview' : 'edit'; setEditorMode(v); return '默认编辑模式：' + val; }
    if (key === 'edAutoSave') return on ? '自动保存已开启' : '自动保存已关闭';
    if (key === 'smartList') return on ? '智能列表延续已开启' : '智能列表延续已关闭';
    if (key.indexOf('openAs:') === 0) { const ext = key.slice(7); return ext ? '默认打开方式已更新：' + ext : null; }
    if (key === 'wrap') { setEditorWrap(on); return on ? '自动换行已开启' : '自动换行已关闭'; }
    if (key === 'reduceMotion') { applyReduceMotion(on); return on ? '减少动画已开启' : '减少动画已关闭'; }
    if (key === 'devMode') return on ? '开发者模式已开启' : '开发者模式已关闭';
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

  /* 绑定「日志目录」输入（#gen-logdir）：
   * 初值从主进程读取当前日志文件路径填充，点「保存目录」写回主进程持久化。
   * web 模式无主进程则静默降级。
   * @param {HTMLElement} content 设置面板容器
   * @author 火 冰 */
  function bindLogDir(content) {
    const input = content && content.querySelector ? content.querySelector('#gen-logdir') : null;
    if (!input) return;
    const nd = window.noteDesktop || {};
    // 从主进程读取当前日志文件路径，回填输入框（点「保存目录」由 bindActionButtons 写回主进程）
    if (nd && nd.getLogDir) {
      nd.getLogDir().then(function (v) { if (input && v) input.value = v; })
        .catch(function () { /* 主进程不可用保持空 */ });
    }
    // 回填单日志文件大小上限（MB）到 #gen-logmax 输入框（点「保存」由 bindActionButtons 写回主进程）
    const maxInput = content && content.querySelector ? content.querySelector('#gen-logmax') : null;
    if (maxInput && nd && nd.getLogMaxMB) {
      nd.getLogMaxMB().then(function (v) { if (maxInput && v) maxInput.value = v; })
        .catch(function () { /* 主进程不可用保持默认 */ });
    }
  }

  /* 生成一个主题化按钮（密码弹框底部操作：确定/取消），带悬停微交互。
   * @param {string} text 按钮文字
   * @param {string} bg 背景色
   * @param {string} fg 前景(文字)色
   * @param {string} border 边框样式（'0' 表示无边框）
   * @returns {HTMLElement} 按钮元素
   * @author 火 冰 */
  function pwdBtn(text, bg, fg, border) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.style.cssText = 'padding:7px 16px;border:' + border + ';border-radius:8px;font:500 13px/1 system-ui,sans-serif;cursor:pointer;background:' + bg + ';color:' + fg + ';';
    b.addEventListener('mouseenter', function () { b.style.opacity = '.85'; });
    b.addEventListener('mouseleave', function () { b.style.opacity = '1'; });
    return b;
  }

  /* 通用密码输入弹框（应用密码 / 笔记加密的 设置/修改/取消 共用）：
   * 按 fields 组合输入字段（old=当前密码 / new=新密码 / confirm=确认新密码），
   * 弹框内完成基础校验（当前密码非空、新密码至少 4 位、两次一致），确定返回字段值；取消/关闭返回 null。
   * @param {object} opts { title, fields, pwdLabel, okText, okColor }
   *   fields: ['old','new','confirm'] 子集，按需组合（默认 ['new','confirm']）
   * @returns {Promise<{next:string, old:string}|null>} 确定返回 {next, old}；取消/关闭返回 null
   * @author 火 冰 */
  function pwdModal(opts) {
    return new Promise(function (resolve) {
      const o = opts || {};
      const fields = Array.isArray(o.fields) && o.fields.length ? o.fields : ['new', 'confirm'];
      // 遮罩
      const ov = document.createElement('div');
      ov.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;';
      // 卡片
      const card = document.createElement('div');
      card.style.cssText = 'width:min(380px,92vw);border-radius:12px;overflow:hidden;background:var(--note-popover);border:1px solid var(--note-border);box-shadow:0 16px 48px rgba(0,0,0,.3);';
      // 标题
      const title = document.createElement('div');
      title.style.cssText = 'padding:14px 16px;font:600 14px/1.3 system-ui,sans-serif;color:var(--note-ink);border-bottom:1px solid var(--note-border);';
      title.textContent = o.title || '密码';
      // 字段区
      const body = document.createElement('div');
      body.style.cssText = 'padding:14px 16px 0;';
      const inputs = {};
      fields.forEach(function (f) {
        const lab = document.createElement('div');
        lab.style.cssText = 'font:600 12px/1.3 system-ui,sans-serif;color:var(--note-ink-2);margin:0 0 4px;';
        if (f === 'old') lab.textContent = '当前密码';
        else if (f === 'new') lab.textContent = o.pwdLabel || '新密码';
        else lab.textContent = '确认' + (o.pwdLabel || '新密码');
        const inp = document.createElement('input');
        inp.type = 'password';
        inp.autocomplete = 'off';
        inp.placeholder = f === 'old' ? '请输入当前密码' : (f === 'new' ? '请输入' + (o.pwdLabel || '新密码') : '再次输入确认');
        inp.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--note-border);border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:var(--note-ink);background:var(--note-surface-2);outline:none;margin-bottom:10px;';
        body.appendChild(lab); body.appendChild(inp);
        inputs[f] = inp;
      });
      // 内联错误提示（校验失败时显示）
      const err = document.createElement('div');
      err.style.cssText = 'display:none;color:#dc2626;font:12px/1.4 system-ui,sans-serif;margin:-2px 0 10px;';
      body.appendChild(err);
      // 按钮行
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px;border-top:1px solid var(--note-border);';
      const btnCancel = pwdBtn('取消', 'var(--note-surface-2)', 'var(--note-ink-2)', '1px solid var(--note-border)');
      const btnOk = pwdBtn(o.okText || '确定', o.okColor || 'var(--note-brand-600)', '#FFFFFF', '0');
      btns.appendChild(btnCancel); btns.appendChild(btnOk);
      card.appendChild(title); card.appendChild(body); card.appendChild(btns);
      ov.appendChild(card); document.body.appendChild(ov);
      // 弹框内基础校验：返回错误文案，空串=通过
      const validate = function () {
        const old = inputs.old ? inputs.old.value : '';
        const next = inputs.new ? inputs.new.value : '';
        const conf = inputs.confirm ? inputs.confirm.value : '';
        if (fields.indexOf('old') !== -1 && !old) return '请输入当前密码';
        if (fields.indexOf('new') !== -1 && next.length < 4) return (o.pwdLabel || '新密码') + '至少 4 位';
        if (fields.indexOf('confirm') !== -1 && next !== conf) return '两次输入的密码不一致';
        return '';
      };
      const collect = function () {
        return { next: inputs.new ? inputs.new.value : '', old: inputs.old ? inputs.old.value : '' };
      };
      const submit = function () {
        const v = validate();
        if (v) { err.textContent = v; err.style.display = 'block'; return; }
        close(collect());
      };
      let finished = false;
      const close = function (val) {
        if (finished) return; finished = true;
        document.removeEventListener('keydown', onKey);
        document.body.removeChild(ov);
        resolve(val);
      };
      const onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); close(null); }
        else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      };
      document.addEventListener('keydown', onKey);
      btnCancel.addEventListener('click', function () { close(null); });
      btnOk.addEventListener('click', submit);
      ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(null); });
      const first = inputs[fields[0]];
      if (first) first.focus();
    });
  }

  /* 绑定「隐私与安全 → 应用密码」区块（SEC-01/02）：
   * 从主进程读安全状态回填；设置/修改/移除密码经密码弹框写回主进程（scrypt 校验）；
   * 超时锁定开关与分钟数持久化到主进程。web 模式无主进程则静默降级并提示。
   * @param {HTMLElement} content 设置面板容器
   * @author 火 冰 */
  function bindSecurity(content) {
    const g = (id) => (content && content.querySelector) ? content.querySelector(id) : null;
    const status = g('#sec-status'), actEl = g('#sec-actions');
    const chk = g('#sec-lock-enable'), minEl = g('#sec-lock-min');
    const nd = window.noteDesktop || {};
    if (!status && !chk) return; // 区块未渲染
    const showToast = function (msg) { try { window.showToast && window.showToast(msg); } catch (e) {} };
    const seg = nd && nd.security;
    /* 密码弹框 → 写回主进程：set=新密码+确认；change=当前+新+确认；remove=仅当前密码
     * @param {string} action set|change|remove */
    const commit = function (action) {
      if (!seg || !seg.setPassword) { showToast('桌面版才能设置启动密码'); return; }
      pwdModal({
        title: action === 'set' ? '设置应用密码' : (action === 'change' ? '修改应用密码' : '移除应用密码'),
        fields: action === 'set' ? ['new', 'confirm'] : (action === 'change' ? ['old', 'new', 'confirm'] : ['old']),
        pwdLabel: '新密码',
        okText: action === 'remove' ? '移除' : '确定',
        okColor: action === 'remove' ? '#dc2626' : 'var(--note-brand-600)',
      }).then(function (res) {
        if (!res) return; // 用户取消
        const data = (action === 'set') ? { next: res.next } : ((action === 'change') ? { old: res.old, next: res.next } : { old: res.old, next: '' });
        seg.setPassword(data).then(function (r) {
          if (r && r.ok) {
            showToast(action === 'remove' ? '已移除密码' : '密码已保存');
            seg.getState().then(refresh).catch(function () {});
          } else {
            const reason = r && r.reason;
            showToast(reason === 'wrong_old' ? '当前密码错误' : (reason === 'too_short' ? '新密码至少 4 位' : '操作失败'));
          }
        }).catch(function () { showToast('操作失败'); });
      });
    };
    /* 按状态渲染操作按钮：未启用→「设置密码」；已启用→「修改密码｜移除密码」（修改在左）
     * @param {boolean} hasPwd 是否已设置应用密码 */
    const renderActions = function (hasPwd) {
      if (!actEl) return;
      actEl.innerHTML = hasPwd
        ? '<div class="flex gap-2">'
          + '<button data-act="sec-change" class="flex-1 py-2 rounded-md text-[13px] font-medium" style="border:1px solid var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">修改密码</button>'
          + '<button data-act="sec-remove" class="flex-1 py-2 rounded-md text-[13px] font-medium" style="border:1px solid var(--note-border); color:#dc2626; background:var(--note-surface-2);">移除密码</button>'
          + '</div>'
        : '<button data-act="sec-set" class="w-full py-2.5 rounded-md text-[13px] font-medium" style="background:var(--note-brand-600); color:#FFFFFF;">设置密码</button>';
      const set = actEl.querySelector('[data-act="sec-set"]');
      if (set) set.addEventListener('click', function () { commit('set'); });
      const chg = actEl.querySelector('[data-act="sec-change"]');
      if (chg) chg.addEventListener('click', function () { commit('change'); });
      const rem = actEl.querySelector('[data-act="sec-remove"]');
      if (rem) rem.addEventListener('click', function () { commit('remove'); });
    };
    // 读取安全状态回填
    const refresh = function (cfg) {
      if (cfg && typeof cfg.hasPwd === 'boolean') {
        if (status) { status.textContent = cfg.hasPwd ? '已启用' : '未启用'; status.style.color = cfg.hasPwd ? 'var(--state-success)' : 'var(--note-ink-3)'; }
        document.querySelector('#sec-group').style.opacity = '1';
        renderActions(cfg.hasPwd);
      }
      if (chk && cfg && typeof cfg.lockEnabled === 'boolean') chk.checked = cfg.lockEnabled;
      if (minEl && cfg && typeof cfg.lockMinutes === 'number') minEl.value = cfg.lockMinutes;
    };
    if (seg && seg.getState) seg.getState().then(refresh).catch(function () { if (status) status.textContent = '不可用'; });
    else if (status) status.textContent = '网页版不可用';
    // 超时锁定开关与分钟数持久化
    if (chk && seg && seg.setLockConfig) {
      chk.addEventListener('change', function () {
        seg.setLockConfig({ enabled: chk.checked }).catch(function () {});
        if (chk.checked && (!minEl || !minEl.value)) { minEl && (minEl.value = 10); }
      });
    }
    if (minEl && seg && seg.setLockConfig) {
      minEl.addEventListener('change', function () {
        let v = parseInt(minEl.value, 10);
        if (isNaN(v)) v = 10; if (v < 1) v = 1; if (v > 120) v = 120;
        minEl.value = v;
        seg.setLockConfig({ minutes: v }).catch(function () {});
      });
    }
  }

  /* 绑定「隐私与安全 → 笔记加密」区块（ENC-02）：
   * 从主进程读当前库加密状态回填；设置/修改/取消笔记加密密码写回主进程（组合算法加密存储）。
   * web 模式无主进程则静默降级并提示。
   * @param {HTMLElement} content 设置面板容器
   * @author 火 冰 */
  function bindEncryption(content) {
    const g = (id) => (content && content.querySelector) ? content.querySelector(id) : null;
    const status = g('#enc-status'), saltEl = g('#enc-salt'), actEl = g('#enc-actions');
    const enc = (window.noteDesktop && window.noteDesktop.enc) || null;
    if (!status && !enc) return; // 区块未渲染
    const showToast = function (msg) { try { window.showToast && window.showToast(msg); } catch (e) {} };
    /* 密码弹框 → 写回主进程：set=新密码+确认；change=当前+新+确认；remove=仅当前密码
     * @param {string} action set|change|remove */
    const commit = function (action) {
      if (!enc || !enc.setPassword) { showToast('桌面版才能设置笔记加密密码'); return; }
      pwdModal({
        title: action === 'set' ? '开启笔记加密' : (action === 'change' ? '修改笔记加密密码' : '取消笔记加密'),
        fields: action === 'set' ? ['new', 'confirm'] : (action === 'change' ? ['old', 'new', 'confirm'] : ['old']),
        pwdLabel: '笔记加密密码',
        okText: action === 'remove' ? '取消加密' : '确定',
        okColor: action === 'remove' ? '#dc2626' : 'var(--note-brand-600)',
      }).then(function (res) {
        if (!res) return; // 用户取消
        const data = (action === 'set') ? { next: res.next } : ((action === 'change') ? { old: res.old, next: res.next } : { old: res.old, next: '' });
        enc.setPassword(data).then(function (r) {
          if (r && r.ok) {
            showToast(action === 'remove' ? '已取消笔记加密密码' : '笔记加密密码已保存');
            enc.getState().then(refresh).catch(function () {});
          } else {
            const reason = r && r.reason;
            showToast(reason === 'wrong_old' ? '当前密码错误' : (reason === 'too_short' ? '密码至少 4 位' : '操作失败'));
          }
        }).catch(function () { showToast('操作失败'); });
      });
    };
    /* 按状态渲染操作按钮：未启用→「开启加密」；已启用→「修改密码｜取消密码」（修改在左）
     * @param {boolean} enabled 本库是否已启用笔记加密 */
    const renderActions = function (enabled) {
      if (!actEl) return;
      actEl.innerHTML = enabled
        ? '<div class="flex gap-2">'
          + '<button data-act="enc-change" class="flex-1 py-2 rounded-md text-[13px] font-medium" style="border:1px solid var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">修改密码</button>'
          + '<button data-act="enc-remove" class="flex-1 py-2 rounded-md text-[13px] font-medium" style="border:1px solid var(--note-border); color:#dc2626; background:var(--note-surface-2);">取消密码</button>'
          + '</div>'
        : '<button data-act="enc-set" class="w-full py-2.5 rounded-md text-[13px] font-medium" style="background:var(--note-brand-600); color:#FFFFFF;">开启加密</button>';
      const set = actEl.querySelector('[data-act="enc-set"]');
      if (set) set.addEventListener('click', function () { commit('set'); });
      const chg = actEl.querySelector('[data-act="enc-change"]');
      if (chg) chg.addEventListener('click', function () { commit('change'); });
      const rem = actEl.querySelector('[data-act="enc-remove"]');
      if (rem) rem.addEventListener('click', function () { commit('remove'); });
    };
    // 读取加密状态回填（enabled + saltMode）
    const refresh = function (cfg) {
      if (status && cfg && typeof cfg.enabled === 'boolean') {
        status.textContent = cfg.enabled ? '已启用' : '未启用';
        status.style.color = cfg.enabled ? 'var(--state-success)' : 'var(--note-ink-3)';
        renderActions(cfg.enabled);
      }
      if (saltEl && cfg) saltEl.textContent = cfg.saltMode === 'app' ? '应用密码' : '固定盐 (shr25.com)';
    };
    if (enc && enc.getState) enc.getState().then(refresh).catch(function () { if (status) status.textContent = '不可用'; });
    else if (status) status.textContent = '网页版不可用';
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
