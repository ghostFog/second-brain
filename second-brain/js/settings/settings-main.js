/* ============================================
 * 第二脑 — 设置视图·入口
 * 作者: 火 冰
 * 功能: 设置分类切换（switchSettings）与设置视图初始化（bindSettings，由 app-layout 视图加载调用）
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）；
 *       本文件须最后引入（依赖以上各 settings 模块的顶层声明）
 * ============================================ */

'use strict';

  /* 切换到指定设置分类（「外观」已并入「常规」：常规面板含外观内容，无需静态模板分支） */
  function switchSettings(cat) {
    const content = document.querySelector('#settings-content > div');
    if (!content) return;
    const title = document.getElementById('settings-title');
    const sub = document.getElementById('settings-sub');
    const info = CATS[cat] || CATS['常规'];
    if (title) title.textContent = info[0];
    if (sub) sub.textContent = info[1];
    let html = settingsPanelHtml(cat);
    if (!html) html = settingsPanel(cat, info, '<p class="text-caption" style="color:var(--note-ink-3);">该分类设置暂未开放，敬请期待。</p>');
    content.innerHTML = html;
    refreshIcons();
    if (cat === '常规') bindAppearance();
    if (cat === 'AI 问答') bindAiSettings();
    if (cat === '插件管理') bindPluginManager(content);
    bindKeyedControls(content);
    bindCloseAction(content);
    bindActionButtons(content);
    bindShortcuts(content);
  }

  function bindSettings() {
    // 初始渲染「常规」分类面板（原「外观」内容已并入「常规」；其余分类由 switchSettings 生成）
    switchSettings('常规');
    // 恢复已持久化的 UI 状态（主题/强调色/字体下拉）
    const savedTheme = window.__savedTheme || 'dark';
    const savedAccent = window.__savedAccent || '#7C3AED';
    const savedFont = window.__savedFontSize || 15;
    const savedFamily = window.__savedFontFamily || 'Inter';
    const savedMono = window.__savedFontMono || 'JetBrains Mono';
    setTheme(savedTheme, false);
    setAccent(savedAccent);
    const famSel = document.getElementById('font-family-select');
    if (famSel) famSel.value = savedFamily;
    const monoSel = document.getElementById('font-mono-select');
    if (monoSel) monoSel.value = savedMono;
    const sizeSel = document.getElementById('font-size-slider');
    if (sizeSel) sizeSel.value = savedFont;
    applyFontSize(savedFont);

    // 初始分类高亮：视图标记 data-active="1" 的分类默认选中（无则不高亮任何分类）
    document.querySelectorAll('.settings-cat[data-active="1"]').forEach(c => c.classList.add('active'));

    // 分类切换：未激活分类点击 → 切换面板并展开其子菜单（若有）；已激活分类再点击 → 仅展开/收起二级菜单，不刷新内容
    document.querySelectorAll('.settings-cat').forEach(cat => {
      cat.addEventListener('click', function () {
        const isActive = this.classList.contains('active');
        const subs = document.querySelectorAll('.settings-subcat[data-cat="' + this.dataset.cat + '"]');
        if (!isActive) {
          document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
          document.querySelectorAll('.settings-subcat').forEach(s => s.classList.remove('active'));
          this.classList.add('active');
          // 切换时收起其余分类已展开的子菜单
          document.querySelectorAll('.settings-cat.sub-open').forEach(c => {
            if (c !== this) {
              document.querySelectorAll('.settings-subcat[data-cat="' + c.dataset.cat + '"]').forEach(s => s.classList.add('hidden'));
              c.classList.remove('sub-open');
            }
          });
          if (subs.length) {
            subs.forEach(s => s.classList.remove('hidden'));
            this.classList.add('sub-open');
          }
          switchSettings(this.dataset.cat);
        } else if (subs.length) {
          // 已激活且含子菜单：仅 toggle 展开/收起，不重复渲染内容区
          const anyVisible = [...subs].some(s => !s.classList.contains('hidden'));
          subs.forEach(s => s.classList.toggle('hidden', anyVisible));
          this.classList.toggle('sub-open', !anyVisible);
        }
      });
    });

    // 二级子菜单：切换到所属分类并平滑滚动定位到对应区块
    document.querySelectorAll('.settings-subcat').forEach(sub => {
      sub.addEventListener('click', function () {
        document.querySelectorAll('.settings-cat').forEach(c => c.classList.remove('active'));
        document.querySelectorAll('.settings-subcat').forEach(s => s.classList.remove('active'));
        this.classList.add('active');
        const main = document.querySelector('.settings-cat[data-cat="' + this.dataset.cat + '"]');
        if (main) main.classList.add('active');
        // 点击子项时确保其所属子菜单展开
        document.querySelectorAll('.settings-subcat[data-cat="' + this.dataset.cat + '"]').forEach(s => s.classList.remove('hidden'));
        if (main) main.classList.add('sub-open');
        switchSettings(this.dataset.cat);
        // 定位到锚点区块：目标区块上方可滚动空间足够（区块下方剩余高度 ≥ 可视高度）则对齐区块顶部；
        // 剩余不足则滚到底（scrollTop = 全部高度 - 可视高度），不依赖底部占位撑高。
        // 以 200ms 间隔持续校正（共 12 次 ≈2.4s，覆盖内容异步撑高）；滚到底或已贴近顶部即提前结束
        const scrollToTarget = function () {
          const target = document.getElementById(sub.dataset.scroll);
          const cont = document.getElementById('settings-content');
          if (!target || !cont) return false;
          const maxScrollTop = cont.scrollHeight - cont.clientHeight;
          const y = target.getBoundingClientRect().top - cont.getBoundingClientRect().top + cont.scrollTop;
          const want = Math.max(0, y - 32); // 区块对齐容器顶部所需滚动偏移（32 = 内容顶部 padding）
          if (want >= maxScrollTop) { cont.scrollTop = maxScrollTop; return true; } // 剩余不足 → 滚到底
          cont.scrollTop = want;
          const top = target.getBoundingClientRect().top - cont.getBoundingClientRect().top;
          return top >= 0 && top < 60;
        };
        scrollToTarget();
        let retry = 0;
        const timer = setInterval(function () {
          retry++;
          if (scrollToTarget()) { clearInterval(timer); return; }
          if (retry >= 12) clearInterval(timer);
        }, 200);
      });
    });

    // 常规面板的事件绑定（外观 + 关闭按钮行为）已由 switchSettings('常规') 完成
  }
