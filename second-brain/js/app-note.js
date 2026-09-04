/* ============================================
 * 第二脑 — 笔记数据层与 Markdown
 * 作者: 火 冰
 * 功能: 网页版内存笔记库 MOCK_NOTES、noteStore、Markdown 渲染与通用文本工具
 * ============================================ */

'use strict';


  /* ============================
   * 笔记数据层（noteStore）
   * 桌面端走 window.noteDesktop（真实文件），网页端降级为内存 mock。
   * ============================ */

  /* 网页版降级用的内存笔记库（内容与主进程 seed 一致） */
  const MOCK_NOTES = {
    '日记/2024年/09月/09-01.md': ['# 2024年9月1日 周日', '', '今天沿河边跑了五公里，整理了本周工作计划。', '', '## 今日计划', '', '- [x] 整理上周会议记录并归档', '- [ ] 完成项目文档初稿', '- [x] 回复客户邮件，确认下周会议时间', '- [ ] 阅读《深度工作》第三章并做笔记', '- [ ] 准备明天晨会的分享材料', '', '## 学习笔记', '', '今天学习了 **深度工作** 的核心理念，使用 `time-blocking` 规划时间。', '', '> "你的一天是什么样的，你的人生就是什么样的。"', '', '## 反思', '', '整体效率不错，明天加强 **time-blocking** 的执行力度。', '', '#日记 #计划 #学习 #深度工作'].join('\n'),
    '日记/2024年/09月/09-02.md': ['# 2024年9月2日 周一', '', '延续 [[09-01]] 的深度工作计划。', '', '## 完成', '- [x] 完成项目文档初稿', '- [x] 阅读《深度工作》第三章', '', '#日记 #深度工作'].join('\n'),
    '日记/2024年/09月/09-03.md': ['# 2024年9月3日 周二', '', '整理了 [[技术栈整理]]，参与 [[React学习]] 讨论。', '', '#日记 #技术'].join('\n'),
    '学习笔记/深度工作.md': ['# 深度工作（Deep Work）', '', '作者 Cal Newport。', '', '## 四种哲学', '- 禁欲式：完全隔离', '- 双峰式：固定时段', '- 节奏式：每日固定时间（我适合）', '- 新闻记者式：随时切入', '', '#学习 #读书'].join('\n'),
    '模板/日记模板.md': ['# YYYY年MM月DD日 周X', '', '#日记', '## 今日计划', '## 学习笔记', '## 反思'].join('\n'),
    '模板/晨间日记.md': ['# 晨间日记', '', '写三件感恩的事、今天最重要的一件事。', '#日记'].join('\n'),
    '周总结-第35周.md': ['# 周总结 · 第35周', '', '尝试 [[09-01]] 的节奏式深度工作法。', '#日记 #学习'].join('\n'),
    '周回顾.md': ['# 周回顾', '', '回顾 [[9月目标]]。', '#日记 #计划'].join('\n'),
    '学习计划.md': ['# 学习计划', '', '围绕 [[React学习]] 与 [[深度工作]]。', '#计划 #学习'].join('\n'),
    'React学习.md': ['# React 学习', '', '组件化、Hooks、状态管理，关联 [[技术栈整理]]。', '#技术 #学习'].join('\n'),
    '技术栈整理.md': ['# 技术栈整理', '', '包含 [[React学习]] 的方向取舍。', '#技术'].join('\n'),
    '9月目标.md': ['# 9月目标', '', '完成 [[深度工作]]、[[React学习]] 第一阶段。', '#计划 #目标'].join('\n'),
    '习惯追踪.md': ['# 习惯追踪', '', '记录晨跑与深度工作，关联 [[9月目标]]。', '#习惯'].join('\n'),
  };

  const noteStore = (function () {
    const bridge = window.noteDesktop || null;
    let mockData = Object.assign({}, MOCK_NOTES);

    /* 桌面端删除某篇笔记的 AI 索引（bridge.ai.deleteIndex），网页 mock 跳过
     * 作者: 火 冰 */
    async function removeIndex(path) {
      const ai = bridge && bridge.ai;
      if (ai && ai.deleteIndex) {
        try { await ai.deleteIndex(path); } catch (_) { /* 忽略：索引不存在或后端拒绝 */ }
      }
    }
    /* 桌面端为新路径重建 AI 索引；网页 mock 跳过
     * 作者: 火 冰 */
    async function rebuildIndexFor(path) {
      const ai = bridge && bridge.ai;
      if (ai && ai.rebuildIndexFor) {
        try { await ai.rebuildIndexFor(path); } catch (_) { /* 忽略 */ }
      }
    }

    return {
      /** 是否为降级的内存 mock（网页版） */
      isMock: () => !bridge,
      /** 根路径（真实桌面）或空 */
      rootLabel: () => bridge ? '' : '（网页演示数据）',
      /** 列出全部笔记 [{path,name,folder,mtime,size}] */
      async list() {
        if (bridge) return await bridge.listNotes();
        return Object.keys(mockData).map(p => ({
          path: p, name: p.split('/').pop(), folder: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '',
          mtime: Date.now(), size: mockData[p].length,
        }));
      },
      /** 读取单篇笔记原文 */
      async read(path) {
        if (bridge) return await bridge.readNote(path);
        const c = mockData[path];
        return c == null ? '' : c;
      },
      /** 保存单篇笔记 */
      async save(path, content) {
        if (bridge) return await bridge.saveNote(path, content);
        mockData[path] = content != null ? content : '';
        return true;
      },
      /** 新建笔记，返回相对路径 */
      async create(name, dir) {
        if (bridge) return await bridge.createNote(name, dir);
        const clean = (name || '').trim();
        const fn = clean.toLowerCase().endsWith('.md') ? clean : clean + '.md';
        const rel = dir ? dir.replace(/[\\/]+$/, '') + '/' + fn : fn;
        mockData[rel] = '# ' + fn.replace(/\.md$/, '') + '\n';
        return rel;
      },
      /** 删除笔记；清理对应 AI 索引（若启用） */
      async remove(path) {
        if (bridge) {
          const ok = await bridge.deleteNote(path);
          await removeIndex(path);     // 桌面端同步清理该笔记索引
          return ok;
        }
        delete mockData[path];
        await removeIndex(path);        // 网页 mock 同样尝试清理（真实桌面端才生效）
        return true;
      },
      /** 删除目录：递归删除该目录下所有笔记（含子目录），每删一篇同步清理索引
       * 作者: 火 冰 */
      async removeDir(dir) {
        const list = await this.list();
        const prefix = dir.replace(/[\\/]+$/, '') + '/';
        const targets = list.filter(n => n.path.startsWith(prefix));
        // 从深到浅删，避免并发 save 被覆盖
        for (const n of targets) {
          await this.remove(n.path);
        }
        return targets.length;
      },
      /** 移动/重命名笔记：旧路径 → 新路径。
       * 桌面端：read→save→delete；索引自动从旧 path 删并为新 path 重建。
       * 网页 mock：直接替换 key。
       * 作者: 火 冰 */
      async move(oldPath, newPath) {
        if (oldPath === newPath) return false;
        if (!newPath.endsWith('.md')) return false;
        if (bridge) {
          const content = await bridge.readNote(oldPath);
          await bridge.saveNote(newPath, content || '');
          await bridge.deleteNote(oldPath);
          await removeIndex(oldPath);
          await rebuildIndexFor(newPath);
        } else {
          const c = mockData[oldPath];
          if (c == null) return false;
          delete mockData[oldPath];
          mockData[newPath] = c;
        }
        return true;
      },
      /** 移动目录：把一个目录整体搬到新父目录下（保留内部相对路径）。
       * 内部递归调用 this.move 处理每篇笔记；索引随笔记移动自动重绑定。
       * 作者: 火 冰 */
      async moveDir(oldDir, newParent) {
        const list = await this.list();
        const oldPrefix = oldDir.replace(/[\\/]+$/, '') + '/';
        const newPrefix = (newParent || '').replace(/[\\/]+$/, '') + '/' + oldDir.split('/').pop();
        const targets = list.filter(n => n.path.startsWith(oldPrefix));
        let moved = 0;
        for (const n of targets) {
          const rel = n.path.slice(oldPrefix.length);        // 目录内相对路径
          const newPath = newPrefix + '/' + rel;
          const ok = await this.move(n.path, newPath);
          if (ok) moved++;
        }
        return moved;
      },
      /** 交换两个笔记文件的名字（保留各自内容不变）。
       * 用途：同目录内拖拽排序时，把 A 和 B 的文件名互换实现排序；链接 [[A]] / [[B]] 指向正确内容。
       * 作者: 火 冰 */
      async swap(pathA, pathB) {
        if (!pathA || !pathB || pathA === pathB) return false;
        if (bridge) {
          const cA = await bridge.readNote(pathA);
          const cB = await bridge.readNote(pathB);
          // 用临时路径避免覆盖：pathA → .swap-tmp → pathB，pathB → pathA
          const tmp = pathA + '.swap-tmp-' + Date.now();
          await bridge.saveNote(tmp, cA || '');
          await bridge.saveNote(pathA, cB || '');
          await bridge.saveNote(pathB, cA || '');
          await bridge.deleteNote(tmp);
          // 索引清理：A/B 原路径删 → 各自新路径（=对方原路径）重建
          await removeIndex(pathA);
          await removeIndex(pathB);
          await rebuildIndexFor(pathA);
          await rebuildIndexFor(pathB);
        } else {
          const cA = mockData[pathA];
          const cB = mockData[pathB];
          if (cA == null || cB == null) return false;
          mockData[pathA] = cB;
          mockData[pathB] = cA;
        }
        return true;
      },
      /** 新建目录，返回相对路径 */
      async createDir(dir) {
        if (bridge) return await bridge.createDir(dir);
        return dir.replace(/^[\\/]+|[\\/]+$/g, '');
      },
    };
  })();

  /* ============================
   * Markdown 轻量渲染（预览模式用）
   * ============================ */

  /* 转义 HTML 特殊字符，防注入 */
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* 行内语法：加粗/行内代码/内链/链接 */
  function inline(md) {
    return esc(md)
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color: var(--note-brand-300);">$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 rounded font-mono text-[12.5px]" style="background: var(--note-surface-2); color: var(--note-brand-300);">$1</code>')
      .replace(/\[\[([^\]]+)\]\]/g, '<a href="#" data-wikilink="$1" class="underline decoration-dotted underline-offset-2" style="color: var(--note-brand-400);">$1</a>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" class="underline decoration-dotted underline-offset-2" style="color: var(--note-brand-400);">$1</a>');
  }

  /* 由 Markdown 渲染为 HTML（预览与反链预览共用） */
  function renderMarkdown(source) {
    if (!source) return '<p class="text-caption" style="color: var(--note-ink-3);">（空笔记）</p>';
    const lines = String(source).split('\n');
    let html = '';
    let inCode = false; let codeBuf = [];
    const flushCode = () => {
      if (codeBuf.length) {
        html += '<pre class="my-5 rounded-lg overflow-x-auto p-4 font-mono text-[13px] leading-relaxed" style="background: var(--note-surface-2); border: 1px solid var(--note-border); color: var(--note-ink); white-space: pre;">' + esc(codeBuf.join('\n')) + '</pre>';
        codeBuf = [];
      }
    };
    const head = (txt) => {
      const m = txt.match(/^(#{1,3})\s+(.*)$/);
      if (!m) return null;
      const level = m[1].length;
      const size = level === 1 ? '26px' : (level === 2 ? '20px' : '16px');
      return '<h' + level + ' class="mt-6 mb-2 font-semibold" style="font-size: ' + size + '; color: var(--note-ink);">' + inline(m[2]) + '</h' + level + '>';
    };
    for (const raw of lines) {
      const line = raw;
      if (line.startsWith('```')) { if (inCode) flushCode(); inCode = !inCode; continue; }
      if (inCode) { codeBuf.push(line); continue; }
      const h = head(line);
      if (h) { flushCode(); html += h; continue; }
      if (line.startsWith('>')) { flushCode(); html += '<blockquote class="my-3 pl-4 py-1 border-l-2" style="border-color: var(--note-brand-600); color: var(--note-ink-2);"><p style="font-style: italic;">' + inline(line.replace(/^>\s?/, '')) + '</p></blockquote>'; continue; }
      const todo = line.match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
      if (todo) {
        flushCode();
        const done = /x/i.test(todo[1]);
        const icon = done ? 'check-square' : 'square';
        const color = done ? 'var(--state-success)' : 'var(--note-ink-3)';
        const tDeco = done ? 'text-decoration: line-through; color: var(--note-ink-3);' : 'color: var(--note-ink);';
        html += '<div class="flex items-start gap-2.5 my-1.5"><i data-lucide="' + icon + '" class="w-4 h-4 mt-0.5 shrink-0" style="color: ' + color + ';"></i><span style="' + tDeco + '">' + inline(todo[2]) + '</span></div>';
        continue;
      }
      const li = line.match(/^\s*[-*]\s+(.*)$/);
      if (li) { flushCode(); html += '<div class="flex items-start gap-2 my-1 pl-1"><span class="w-1 h-1 mt-2 rounded-full shrink-0" style="background: var(--note-brand-400);"></span><span style="color: var(--note-ink);">' + inline(li[1]) + '</span></div>'; continue; }
      const li2 = line.match(/^\s*\d+\.\s+(.*)$/);
      if (li2) { flushCode(); html += '<div class="flex items-start gap-2 my-1 pl-1"><span class="text-caption mt-0.5 shrink-0" style="color: var(--note-ink-3);">•</span><span style="color: var(--note-ink);">' + inline(li2[1]) + '</span></div>'; continue; }
      if (!line.trim()) { flushCode(); continue; }
      if (/^#{4,}/.test(line)) continue;
      flushCode();
      html += '<p class="my-1.5" style="font-size: var(--note-text-body); line-height: 1.7; color: var(--note-ink);">' + inline(line) + '</p>';
    }
    flushCode();
    return html;
  }

