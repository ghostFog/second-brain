/* ============================================
 * 第二脑 — 版本变更记录（版本历史）
 * 作者: 火 冰
 * 功能: 维护各版本的变更记录，渲染到「设置-关于-版本历史」。
 * 维护约定: 打包发布时更新 package.json 的 version，
 *           并把新版本条目追加到本数组【最前】；版本号需与 package.json 保持一致。
 * ============================================ */

'use strict';

/**
 * 版本历史数组（新 → 旧）。
 * @type {{version:string, date:string, items:string[]}[]}
 */
globalThis.CHANGELOG = [
  {
    version: '0.3.0',
    date: '2026-10-19',
    title: '外部变更自动感知 · 元数据自写闭环',
    items: [
      'ED-60 外部文件变更自动感知：主进程 10s 快照监控检出资源管理器手动增删改，自动刷新文件树',
      '打开标签外部修改联动：干净文档自动同步、脏文档保留用户版本不被覆盖、删除标签标记丢失态（保存可恢复）',
      '加密库锁屏期守卫：密钥未就绪时元数据扫描跳过，解锁后首个周期自动补检出，避免锁屏期密文污染',
      'Bug-076 recent.json 幂等写入：writeIfChanged 严格比对新旧内容，相同跳过，解决每开库必写',
      'Bug-077 首读密钥竞态：解密函数先 ensureNoteKey 再取密钥缓存，消除 ENC1 密文被当明文扫描导致的字数/指纹漂移',
      'Bug-078 git-sync 状态轮询每 30s 重写 .git/config：core.quotepath 改幂等设置（先 --get 读现值，已是 false 则只读不写）',
      '元数据 scheduleMetaTouch 支持显式 root 第三参：treeWatchTick 无 IPC 上下文时正确指定库根',
      'ED-60 手动刷新按钮补齐：文件树右上角 #file-tree-refresh 补 JS click 绑定（此前 HTML 存在但无绑定，点了没反应），走统一 refreshTreeAfterChange 收口（知识库+项目模式双覆盖）',
      'ED-62 搜索框三段式增强（Obsidian 风格）：vault.html 搜索区改造为一体化 flex 容器——左下拉（range：全文/文件名/标题）+ 中 input（带搜索图标）+ 右 Aa 图标（点击弹出 popover：区分大小写 / 匹配整词开关，两开关任一开启 Aa 高亮变紫）+ 设置齿轮（弹出 popover：显示上下文长度 30/50/100 字三档）；主进程 notes:searchText handler 新增 caseSensitive / wholeWord / range / snippetLen 参数，匹配策略抽成 matcher 函数（cs/ww/都关四分支），wholeWord 走 \\b 正则；preload.searchNotes 签名改 opts 对象透传；所有设置 localStorage sb.search.settings 持久化；Aa/齿轮 popover CSS top:100%+right:0 紧贴按钮底边',
      'ED-62 修复：(1) 移除 sb-search-bar 的 overflow-hidden（之前裁剪了所有 absolute 定位的 popover 和搜索建议下拉浮层，导致下拉结果看不见）；(2) popover 锚点从 btn.parentElement（整个搜索条）改到 btn 自身（position:relative 设在按钮上），Aa popover 只在 Aa 按钮下方，设置 popover 只在齿轮按钮下方，不再互相覆盖；(3) 文件名过滤按 range 分流——range=content 时**不过滤文件树**（之前始终强制文件名过滤，用户输入后文件树只剩文件名含关键词的笔记，误以为全文搜索没生效）；(4) main.js titleMatch 时 snippet 切片用了 title 字符串索引当 content 索引（跨字符串错误），修复为 contentMatch 优先取正文上下文，仅 titleMatch 时标记"（标题匹配）"并用正文前 N 字预览；(5) Aa 文本与 settings SVG 图标加 inline-flex items-center 统一垂直对齐',
      'ED-62 二次修复（彻底方案）：三种弹出层（suggestions 下拉、Aa popover、settings popover）全部**append 到 document.body + position:fixed + getBoundingClientRect 定位**——彻底脱离祖先 aside 的 overflow-hidden 裁剪（之前所有弹出层都在 aside DOM 子树内，不管怎么设 position 都会被 aside overflow:hidden 裁剪）；document mousedown handler 显式排除 Aa/设置/range 按钮自身，彻底解决 mousedown→click race condition（mousedown 先于 click 触发，之前导致 popover 刚打开就被 document mousedown 关掉）；window resize 时重新定位 suggestions',
      'ED-61 文件树搜索升级为全文搜索 + 下拉建议：主进程 notes:searchText IPC（walkNotes + vaultReadTextSync 解密读，标题/正文双命中，标题优先早命中排序，命中 10 条早停，加密库锁屏守卫）；vaultRootForEvent 同时覆盖 winVaults + winProjects 双路，项目模式也能拿到正确根目录；渲染端 300ms 防抖 + CSS top:100% 紧贴搜索框底边的 absolute 下拉浮层，mark 关键词高亮，点击直接 openNote',
    ],
  },
  {
    version: '0.2.0',
    date: '2026-10-10',
    title: '多编辑器架构 · 代码文件 CodeMirror',
    items: [
      '多编辑器 Provider 路由：文件后缀由插件声明，宿主按 getEditorProviders() 排序选择（用户默认 → priority 降序）',
      'CodeMirror 5 插件（plugins/code-editor/）：支持 .sql/.js/.py/.bat/.json/.yml 等 49 种代码后缀，工具栏含行号开关、自动换行、全选复制',
      '持久化编辑器偏好：sbEditorProviderPrefs（localStorage）按后缀记忆默认编辑器，状态栏标签点击可切换',
      '围栏包装代码彻底删除（sbProjFenceWrap/Unwrap/PROJ_CODE_LANGS）：代码文件不再被 ```lang fence 包裹进 vditor',
      'sbEditorMode 与 sbSplitLayout 解耦：sbEditorMode 只存编辑节点偏好（ir/wysiwyg/preview），分屏布局独立由 sbSplitLayout 记忆，避免下次打开默认进空白 SV',
      '编辑/预览/分屏 按钮按 Provider 显隐：只有 Markdown Editor (vditor) 才显示模式切换按钮',
      '项目模式 ribbon 恢复插件市场按钮（hideVaultUi 移除 plugins 隐藏）',
    ],
  },
  {
    version: '0.1.1',
    date: '2026-10-10',
    title: '编辑器修复 · 代码块体验优化',
    items: [
      '编辑器：代码块行号随滚动同步修复（横向/纵向滚动时行号不再错位）',
      '编辑器：代码块工具栏新增「显示行号」和「内容换行」切换按钮',
      '安装器：支持版本降级安装（allowDowngrade），版本一致时覆盖更新',
    ],
  },
  {
    version: '0.1.0',
    date: '2026-09-20',
    title: '打开项目 · Git 同步 · 编辑器增强',
    items: [
      '打开项目：库下拉「打开项目…」选目录 → 独立项目窗口，支持相对路径读写与 Git 状态着色；已打开项目显于「一般项目」分组，托盘二级菜单同步',
      '外部文件拖入临时打开：单页签只读临时打开（不写库/不建索引），目录区取消选中、侧边面板显示空数据；库下拉「最近打开」二级显示全局跨库临时文件',
      'Git 同步：自动提交/自动推送、远程仓库配置、查看与还原版本历史、从 Git 打开知识库、编辑 .gitignore、实时提交、锁冲突自愈与无远程探测静音',
      '文件树：目录/文件就地重命名（Enter/失焦提交、Esc 取消），重命名按目录作用域重建链接索引与反链',
      '编辑器：列宽切换（固定/自适应）、宽屏模式、编辑器模式记忆（所见即所得/IR/SV/阅读）',
      '大纲移至编辑器右侧浮层（Ctrl+Shift+Q 呼出），点击标题滚动跳转、父级可折叠',
      '工具栏悬浮提示改为自绘浮层（名称+实际快捷键），消除与 vditor 原生提示的重复显示',
      '运行日志：日志目录可配置、错误日志单独落盘、独立日志查看浮窗（关键字筛选/实时轮询/清屏/清理）、单文件大小可配置',
      'AI：可用模型实时列表（后台轮询+全局缓存）、模型数据钩子实时刷新（类 Vue 响应式），超时快速失败显具体错误',
    ],
  },
  {
    version: '0.0.1',
    date: '2026-09-06',
    title: '首个测试版本',
    items: [
      'Markdown 编辑器：源代码 / 所见即所得 / 预览 三种模式',
      '笔记管理：文件树、文件夹展开折叠、标签云、库统计',
      '命令面板：新建、搜索、打开笔记，导出 PDF（设计中）',
      '图谱视图：节点过滤、脉冲动画、节点详情与标签',
      '插件系统：插件市场、插件管理、Ribbon / 顶栏 / 右键菜单扩展点',
      'AI 问答：本地嵌入与重排序模型下载、远程大模型 SSE 流式对话',
      '设置中心：外观、编辑器、快捷键、同步备份、隐私安全、关于',
    ],
  },
];