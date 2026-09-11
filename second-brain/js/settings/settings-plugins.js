/* ============================================
 * 第二脑 — 设置视图·插件管理
 * 作者: 火 冰
 * 功能: 设置面板动作按钮（data-saction）绑定、插件 schema 设置表单/插件条目 HTML 生成、
 *       插件管理面板交互（展开/启用/卸载/设置变更）
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）；
 *       插件宿主能力（pluginData/pluginManager/PluginAPI/isPluginEnabled/errorForPlugin/setPluginEnabled）由 js/app-plugins.js 提供
 * ============================================ */

'use strict';

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
