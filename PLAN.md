# 侧边栏管理器（dsh-sidebar-manager）设计方案

> 目标：为 DeepSeek Harness（dsh）开发一款**侧边栏自定义管理插件**，让用户查看左侧侧边栏中的全部功能项，并逐项开关其显示状态。
> 本文是执行前的计划书；实现完成后同一目录下有 `README.md` 记录最终形态。

---

## 1. 需求拆解

用户痛点（截图）：安装的插件变多后，侧边栏从上到下被塞满——`新会话` / `自动化任务` / `上下文洞察` / `技能中心` / `工作区` / `费用卡` / `插件市场` / `远程控制` / `账户`，其中「工作区」这个真正高频的区域只剩约三分之一可视高度。

把诉求拆成三条可验收的功能点：

| # | 功能 | 验收标准 |
|---|------|----------|
| F1 | **查看全部功能项** | 打开管理面板，能看到侧边栏当前所有可管理的功能项，含名称与来源插件 ID，并按「导航面板 / 底部区域」分组 |
| F2 | **逐项开关显示** | 每项一个开关，切换后侧边栏**立即**变化（无需刷新、无需重启） |
| F3 | **偏好持久化** | 关掉应用再开，隐藏状态仍在；提供「全部显示」一键还原 |

非目标（明确不做，避免范围蔓延）：拖拽排序、分组归并、把工作区/会话区整块隐藏、按插件批量禁用（那是「设置 → 插件」的职责）。

---

## 2. 技术调研结论（先搞清楚能挂在哪）

dsh 是「无特权内核 + Cordis 插件容器」，侧边栏本身也是插件（`@deepseek-ai/dsh-client-ui-sidebar`）。拆包（`app.asar`）后确认它对外只暴露 7 个 **slot 席位**：

| 席位 | kind | 谁在填 |
|------|------|--------|
| `sidebar.brand.mark` / `sidebar.brand.name` | single | 品牌 |
| `sidebar.panellist` | **list** | 导航行：自动化任务、上下文洞察、技能中心、插件市场… |
| `sidebar.workspaces` | single | 工作区/会话浏览器 |
| `sidebar.settings` | single | 底部「设置与账户」行 |
| `sidebar.footer.action` | **list** | 底部条目：费用卡、远程控制、插件市场… |
| `sidebar.toggle.badge` | single | 收起态角标 |

关键机制（读 `@deepseek-ai/dsh-client-ui-slots` 源码确认）：

- `ctx.slots.entries(key)` 拿到**全部**注册条目（含被遮蔽的），`ctx.slots.entriesOfSlot(key)` 拿到**每个 id 的胜出者**。
- list 槽按 `priority` 升序 + `order` 升序排序，`entriesOfSlot` 对**同一 id 取第一个存活条目** → **低 priority 遮蔽（shadow）高 priority**，且同 id 不同 priority 注册不会冲突抛错。
- `ctx.slots.subscribe(key, fn)` 监听条目变化，`ctx.slots.inject(key, cb)` 等席位被父级声明后再注册。

**结论**：不需要 fork 源码，也不需要 DOM 文本匹配；「隐藏」可以用**遮蔽注册**实现——用同一个 `id`、更低的 `priority` 注册一个空组件，把目标条目从渲染中顶掉；撤销隐藏 = dispose 掉自己的遮蔽条目，原插件条目自动回归。

---

## 3. 核心机制

### 3.1 底部条目（footer）：遮蔽即消失

`sidebar.footer.action` 是 list 槽，条目由**自己渲染整块内容**，所以用空组件遮蔽后 DOM 直接消失，无需任何 CSS。

```
原条目: {id:'agents-anywhere-next', priority:0,  component: ConnectionEntry}
遮蔽项: {id:'agents-anywhere-next', priority:-1000000, component: HiddenFooter}  // 渲染 null
```

### 3.2 导航行（panellist）：遮蔽图标 + 标记 label + 一条 CSS

导航行是**外壳渲染的**：`<button aria-label={label}><glyph/><title/></button>`，插件只提供 glyph。遮蔽后按钮壳仍在（会留个空行）。

对策：遮蔽条目把自己的 `label` 设成**唯一标记串** `\u200bdsm:hidden:<id>`（零宽空格开头，正常不可见，也不污染可访问名），再为它生成一条 CSS：

```css
button[aria-label="\u200bdsm:hidden:skill-explorer"]{display:none!important}
```

- 标记串由**本插件**提供，因此不依赖其他插件的文案、不受语言切换影响、不依赖 hashed class 名（`bJOniG_panelRow` 这类名字会随构建变）。
- 隐藏后行高、gap、tooltip 全部消失；撤销隐藏时 CSS 规则一并移除。

### 3.3 不可隐藏项

`sidebar.settings`（底部「设置与账户」行）在面板里**只读展示 + 锁图标**：它是设置面板的主要入口，隐藏后容易把用户关在门外。

### 3.4 一致性补偿

若被隐藏的导航面板正是**当前打开的面板**，顺手 `ctx.layout.selectPanel(null)` 回到对话页，避免「内容还在、入口没了」的死角。

---

## 4. 交互设计

**入口**：在下部区域（`sidebar.footer.action`，`order: 900`，排在最后一行）注册一行
`⚙ 侧边栏管理`（带 `已隐藏 N` 角标）；侧栏收起为 56px 轨道时退化为 36px 图标按钮。

**面板**：居中 Modal（复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal` + `Switch`，与全站视觉一致）

```
┌ 自定义侧边栏 ─────────────────────────── ✕ ┐
│ 开关只控制「是否显示在侧边栏」，被隐藏的插件仍在后台正常运行。   │
│                                            │
│ 导航面板                            3/5   │
│  ▣ 自动化任务            schedules    [●] │
│  ▣ 上下文洞察            dsh-context  [●] │
│  ▣ 技能中心      skill-explorer       [○] │
│                                            │
│ 底部区域                            1/3   │
│  ▤ 费用统计              cost-meter   [●] │
│                                            │
│ 固定项                                     │
│  ⚙ 设置与账户        设置与账户入口，始终显示  🔒 │
├────────────────────────────────────────────┤
│ 已隐藏 2 项                    [ 全部显示 ] │
└────────────────────────────────────────────┘
```

状态即时生效、即时落盘，无「保存」按钮。

---

## 5. 数据与持久化

```jsonc
// localStorage["dsh.sidebar-manager.v1"]
{ "v": 1, "hidden": ["panel:skill-explorer", "footer:cost-meter"] }
```

- key 规则：`panel:<条目id>` / `footer:<条目id>`，与展示名解耦（改文案/换语言不影响）。
- 选 `localStorage` 的依据：桌面端 dsh 用 `file://` 加载界面（`~/.dsh/electron-user-data/Local Storage` 已存在且被写入），origin 稳定；`dsh-cost-meter`、`dsh-community-market` 等插件也用它存偏好。
- 读写全部 try/catch 包裹（隐私模式/配额异常时退化为内存态，不抛错中断插件）。

---

## 6. 工程结构（零构建依赖）

```
plugins/dsh-sidebar-manager/
├─ package.json          # main=lib/index.js, exports./client, dsh.bundle.patch, dsh.client.platform=web
├─ cordis.patch.yml      # insert: id=ui-sidebar-manager, name=dsh-sidebar-manager
├─ src/
│  ├─ index.js           # Node 端：纯 UI 插件，apply() 空实现
│  └─ client.js          # 浏览器端（CJS 模块体，1026 行含注释，分 12 段）
├─ scripts/build.mjs     # 包装 window.__ModuleLoader__ + 自检（131 行）
├─ scripts/install.mjs   # 装/卸到 profile（junction + bundles 列表，260 行）
├─ test/smoke.mjs        # 假 slot 账本跑通「隐藏 → 遮蔽 → 撤回」全链路（11 项）
├─ test/render.mjs       # 真实 React 渲染断言（6 项，可选依赖）
├─ lib/                  # 构建产物：index.js / client.js
├─ PLAN.md / README.md
```

**为什么不用 tsdown**：本插件只有浏览器半边、只 require `react` 与平台自带的 `@deepseek-ai/dsh-client-ui-primitives`，用 80 行 Node 脚本包一层 `window.__ModuleLoader__.load({id, factory})` 就够，零 npm 依赖、离线可重建（`node scripts/build.mjs`），避免版本/网络带来的构建不确定性。

---

## 7. 风险与边界

| 风险 | 影响 | 处理 |
|------|------|------|
| 遮蔽会**卸载**目标条目的 React 组件 | 底部条目若在组件里跑轮询/连接，可能停掉（如远程控制的状态刷新） | 只影响「界面层的展示组件」，插件宿主端逻辑不受影响；README 明示 |
| 未来 dsh 改动 slot 语义（如遮蔽不再取最低 priority） | 隐藏失效 | `entries`/`entriesOfSlot`/`priority` 是当前公开契约；失效时退化为「仅列表面板」而不崩溃（register 抛错被 catch） |
| 其他插件也用负 priority 遮蔽 | 同 id 同 priority 注册冲突抛错 | 用 `-1000000` 这种极端值；冲突时 catch + console.warn，不影响启动 |
| 面板全部隐藏后导航区留 8px 外边距 | 轻微留白 | 可接受；不为此加脆弱的结构选择器 |
| 条目 id 重复（不同插件都用 `cost-meter`） | 会互相遮蔽 | 同 id 本就是同一个 cell（dsh 契约），只需列一次 |

---

## 8. 交付与验收

1. `node scripts/build.mjs` 通过：产出 `lib/index.js` + `lib/client.js`，自检（单文件、无 `import()`、require 白名单）全绿。
2. `node test/smoke.mjs` 通过：遮蔽/撤回/持久化/锁定项 4 组断言。
3. **不自动安装**。交付后由用户决定是否执行：

```bash
dsh plugin --profile desktop add file:"<本插件的绝对路径>"
```

4. 用户装好后自测路径：侧边栏底部出现「⚙ 侧边栏管理」→ 关掉「技能中心」→ 导航行立即消失 → 重启应用仍在 → 点「全部显示」还原 → 卸载 `dsh plugin --profile desktop remove dsh-sidebar-manager`。

---

## 9. 落地记录（计划 vs 实际）

| 项 | 计划 | 实际 | 原因 |
|----|------|------|------|
| 读条目 | 同时用 `entries` + `entriesOfSlot` 判胜出者 | 只用 `entries`（剔除自身组件后按 id 取最小 priority） | 逻辑等价但少一次跨服务调用，且不依赖「胜出者」语义 |
| 导航行隐藏 | 标记串 + `nav button[...]` 作用域 | 标记串已全局唯一，去掉 `nav` 作用域 | 少依赖一层结构，选择器更稳 |
| 安装 | 只给 `dsh plugin add file:` 命令 | 追加 `scripts/install.mjs`：复用 `~/.dsh/dsh-runtimes/*/dependencies` 里的 **pnpm** 执行 `pnpm add link:<本目录>` + 改 `dsh.profile.bundles` | 本机没有 `dsh` CLI（只有桌面端 exe）；`file:` 会复制、改代码要重装，`link:` 是符号链接且被写进 lockfile，后续在插件市场装卸别的插件时不会被清掉 |
| 测试 | 纯函数 + 冒烟 | 冒烟 11 项 + 额外 `test/render.mjs` 6 项（真实 React 渲染断言） | 组件树/hook 用法没法靠逻辑测试覆盖；用临时装的 react@18 渲染成 HTML 断言 |
| 持久化 | localStorage 待验证 | 已验证：桌面端 `file://` origin 下 localStorage 可用（`~/.dsh/electron-user-data/Local Storage/leveldb` 里能读到 cost-meter/community-market 的键） | —— |

构建与测试结果（Node 22.22.2）：

```
✓ dsh-sidebar-manager 构建完成（零依赖，无 npm install）
  lib/client.js  34.6 KB（含 ModuleLoader 外壳）
  自检：单文件 ✓  无动态 import ✓  require 白名单 ✓
✓ 冒烟测试 11/11 通过
✓ 渲染测试 6/6 通过
```

