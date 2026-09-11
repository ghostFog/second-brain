/* ============================================
 * 第二脑 — 设置视图·快捷键面板
 * 作者: 火 冰
 * 功能: 快捷键分类面板 HTML 生成（注册表驱动）、录制状态管理（kbRecording/kbExitRecord/kbRecordKeydown）、
 *       面板「设置/清除」交互绑定、单条键位刷新
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）；
 *       底层注册表能力（kbGetBinds/kbSetBind/kbClearBind/kbResolveBind/kbResetAll）由 js/app-keybinds.js 提供
 * ============================================ */

'use strict';

  /* 渲染快捷键分类面板：内置+插件命令列表（注册表驱动），每行含当前键位 + 设置/清除 */
  function shortcutPanelHTML() {
    let binds = [];
    if (typeof kbGetBinds === 'function') binds = kbGetBinds();
    let rows = '';
    binds.forEach(function (b) {
      const badge = b.pluginId ? '<span class="px-1.5 py-0.5 rounded text-[10px] font-medium ml-2 shrink-0" style="background:var(--note-surface); color:var(--note-brand);">' + esc(b.pluginId) + '</span>' : '';
      rows += '<div class="flex items-center justify-between px-4 py-3 border-t" style="border-color:var(--note-border);">'
        + '<div class="flex items-center gap-2 min-w-0"><span class="text-[13px] truncate" style="color:var(--note-ink);">' + esc(b.label) + '</span>' + badge + '</div>'
        + '<div class="flex items-center gap-2 shrink-0 ml-3">'
        + (b.keybindable
          ? '<kbd data-kb-record="' + esc(b.id) + '" data-kb-kbd="' + esc(b.id) + '" title="点击设置快捷键" class="cursor-pointer text-[11px] px-2 py-1 rounded font-mono hover:opacity-80" style="background:var(--note-surface-2); color:var(--note-ink-2);">' + esc(b.combo || '未设置') + '</kbd>'
            + '<button data-kb-clear="' + esc(b.id) + '" class="px-2 py-1 rounded-md text-caption border hover:opacity-80" style="border-color:var(--note-border); color:var(--note-ink-3); background:transparent;">清除</button>'
          : '<kbd data-kb-kbd="' + esc(b.id) + '" class="text-[11px] px-2 py-1 rounded font-mono" style="background:var(--note-surface-2); color:var(--note-ink-2);">' + esc(b.combo || '未设置') + '</kbd>')
        + '</div></div>';
    });
    if (!binds.length) {
      rows = '<div class="px-4 py-6 text-center text-caption" style="color:var(--note-ink-3);">暂无可用命令。</div>';
    }
    return '<section class="settings-group"><div class="flex items-center justify-between mb-2"><h3 class="text-body font-semibold" style="color:var(--note-ink);">快捷键</h3><button class="px-3 py-1.5 rounded-md text-caption border hover:opacity-80" data-saction="reset-shortcuts" style="border-color:var(--note-border); color:var(--note-ink-2); background:var(--note-surface-2);">恢复默认</button></div>'
      + '<div class="text-caption mb-2" style="color:var(--note-ink-3);">点击键位后按下新组合键（建议带 Ctrl/Alt/Shift）即可修改；「清除」恢复默认。</div>'
      + '<div class="rounded-lg border overflow-hidden" style="border-color:var(--note-border);">' + rows + '</div></section>';
  }

  /* ============ 快捷键录制状态管理 ============ */

  /* 当前录制中的命令信息：{ id, btn, oldText } */
  let kbRecording = null;
  /* 全局「点击别处退出录制」监听是否已挂载（幂等） */
  let kbGlobalCancelBound = false;

  /* 结束当前录制：将按钮文字还原为进入前文案，并移除键捕获监听 */
  function kbExitRecord() {
    if (!kbRecording) return;
    kbRecording.btn.textContent = kbRecording.oldText;
    document.removeEventListener('keydown', kbRecordKeydown, true);
    kbRecording = null;
  }

  /* 录制态统一按键捕获：只记录不触发（Esc 取消）；组合键绑定并阻断全局快捷键冒泡 */
  function kbRecordKeydown(e) {
    const rec = kbRecording;
    if (!rec) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); kbExitRecord(); return; }
    const pure = e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta';
    if (pure) { e.preventDefault(); return; }
    // 阻止默认行为与冒泡到全局快捷键处理器（app-layout），确保「正在设置时按键不触发功能」
    e.preventDefault(); e.stopPropagation();
    const keyPart = (/^[a-z]$/i.test(e.key) ? e.key.toUpperCase() : e.key);
    const combo = (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + keyPart;
    const result = kbSetBind(rec.id, combo);
    if (result && result.ok) showToast('已绑定：' + combo);
    else if (result && result.conflictId) showToast('快捷键已被其它命令占用');
    else showToast('绑定失败');
    kbExitRecord();
    refreshShortcutKbd(rec.id);
  }

  /* 绑定快捷键面板的「设置/清除」交互：设置进入捕获态；点击其他处或按 Esc 退出并还原显示 */
  function bindShortcuts(root) {
    const box = (typeof root === 'string') ? document.querySelector(root) : root;
    if (!box || typeof kbSetBind !== 'function' || typeof kbClearBind !== 'function') return;
    // 全局取消：点击当前录制按钮以外的任意位置即退出录制并还原（幂等挂载一次）
    if (!kbGlobalCancelBound) {
      kbGlobalCancelBound = true;
      document.addEventListener('mousedown', function (e) {
        if (kbRecording && !kbRecording.btn.contains(e.target)) kbExitRecord();
      }, true);
    }
    box.querySelectorAll('[data-kb-record]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.kbRecord;
        if (kbRecording && kbRecording.btn === btn) { kbExitRecord(); return; } // 再次点击当前项视为取消
        kbExitRecord(); // 残留录制先清理
        kbRecording = { id: id, btn: btn, oldText: btn.textContent };
        btn.textContent = '按下组合键…';
        document.addEventListener('keydown', kbRecordKeydown, true);
      });
    });
    box.querySelectorAll('[data-kb-clear]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const id = btn.dataset.kbClear;
        kbClearBind(id);
        showToast('已清除，恢复默认');
        switchSettings('快捷键');
      });
    });
  }

  /* 刷新单条命令的键位 <kbd> 文案 */
  function refreshShortcutKbd(id) {
    const kbd = document.querySelector('[data-kb-kbd="' + id + '"]');
    if (kbd && typeof kbResolveBind === 'function') kbd.textContent = kbResolveBind(id) || '未设置';
  }
