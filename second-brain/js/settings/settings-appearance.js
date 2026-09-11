/* ============================================
 * 第二脑 — 设置视图·外观绑定
 * 作者: 火 冰
 * 功能: 「常规」面板内外观控件（主题模式/强调色/字体大小/字体族/代码字体/Ribbon 最大数量）事件绑定
 * 说明: 与 js/settings/*.js 共享全局词法作用域（顶层声明跨文件可见）
 * ============================================ */

'use strict';

  /* 外观面板控件绑定（原「外观」分类内容已并入「常规」，由 switchSettings('常规') 调用） */
  function bindAppearance() {
    // 主题模式
    document.querySelectorAll('.theme-card').forEach(card => {
      card.addEventListener('click', function () { setTheme(this.dataset.themeMode, true); });
    });
    // 强调色
    document.querySelectorAll('.color-dot').forEach(dot => {
      dot.addEventListener('click', function () { setAccent(this.dataset.accent); refreshIcons(); });
    });
    // 字体大小
    const slider = document.getElementById('font-size-slider');
    if (slider) slider.addEventListener('input', function () { applyFontSize(parseInt(this.value, 10)); });
    // 字体族
    const fam = document.getElementById('font-family-select');
    if (fam) fam.addEventListener('change', function () { applyFontFamily(this.value); });
    // 代码字体
    const mono = document.getElementById('font-mono-select');
    if (mono) mono.addEventListener('change', function () { applyFontMono(this.value); });
    // Ribbon 最大显示数量（仅 RibbonManager 存在时生效）
    var ribbonSlider = document.getElementById('ribbon-max-slider');
    var ribbonLabel = document.getElementById('ribbon-max-label');
    if (ribbonSlider && typeof RibbonManager !== 'undefined' && RibbonManager) {
      // 恢复保存的值
      ribbonSlider.value = RibbonManager.getMaxButtons();
      if (ribbonLabel) ribbonLabel.textContent = ribbonSlider.value;
      ribbonSlider.addEventListener('input', function () {
        var n = parseInt(this.value, 10);
        if (ribbonLabel) ribbonLabel.textContent = n;
        RibbonManager.setMaxButtons(n);
      });
    } else if (ribbonSlider) {
      // 降级：纯 DOM 行为
      ribbonSlider.addEventListener('input', function () {
        if (ribbonLabel) ribbonLabel.textContent = this.value;
      });
    }
  }
