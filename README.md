# dsh-sidebar-manager · 侧边栏管理器

给 DeepSeek Harness（dsh）的左侧侧边栏做「显示开关」的插件：把装了一堆插件后挤爆的导航行
逐项关掉，把空间还给「工作区」。

- **不卸载、不禁用任何插件**：只控制「是否在侧边栏渲染」。
- **所见即所得**：开关一点就生效，不用重启。
- **偏好本地留存**：关掉应用再开，隐藏状态还在。

```
侧边栏（展开）                          自定义侧边栏
┌────────────────────────┐        ┌──────────────────────────────────┐
│  ◆ deepseek HARNESS    │        │ 自定义侧边栏                   ✕ │
│  ⊕ 新会话               │        │ 开关只控制「是否显示在侧边栏」，   │
│                        │        │ 被隐藏的插件仍在后台正常运行。      │
│  ⚙ 自动化任务     [○] │        │                                  │
│  ◷ 上下文洞察     [○] │  ←—→   │ 导航面板                    2/3  │
│  ▤ 技能中心       [●] │        │  ▣ 自动化任务        schedules  ● │
│                        │        │  ▣ 上下文洞察      dsh-context  ● │
│  工作区            ⌕ ⊕ │        │  ▣ 技能中心    skill-explorer  ○ │
│   └ dsh 运行时防休眠…  │        │                                  │
│                        │        │ 底部区域                    1/2  │
│  ┌ 今日 ¥11.72 ─────┐ │        │  ▤ 费用统计          cost-meter ● │
│  └──────────────────┘ │        │  ▤ 远程控制  agents-anywhere… ○ │
│  ⚙ 插件市场            │        │                                  │
│  ⚙ 远程控制            │        │ 固定项                           │
│  ⚙ 侧边栏管理     ②  │ ← 入口  │  ⚙ 设置与账户  侧边栏的主要入口 🔒│
│  ◉ 123****5678         │        ├──────────────────────────────────┤
└────────────────────────┘        │ 已隐藏 2 项          [ 全部显示 ] │
                                  └──────────────────────────────────┘
```

---

## 安装

插件已经构建好（`lib/` 是产物，可直接用）。三种方式，任选其一。

### 方式一：一键脚本（推荐，Windows）

```bash
# 预览将要做的改动（不改任何文件）
node scripts/install.mjs

# 真正安装到 desktop profile
node scripts/install.mjs --yes

# 卸载
node scripts/install.mjs --uninstall --yes
```

脚本复用 **DSH 自带的 pnpm**（`~/.dsh/dsh-runtimes/*/dependencies/`），等价于 `dsh plugin add file:`：

1. `pnpm add "link:<本目录>"` → 在 `<profile>/node_modules/` 生成指向本目录的**符号链接**，
   并写进 `dependencies` / `pnpm-lock.yaml`（声明式依赖，后续在插件市场装卸别的插件时不会被当
   “多余目录”清掉；改完代码重跑 `node scripts/build.mjs` 重启应用即生效，不用重新安装）；
2. 往 `<profile>/package.json` 的 `dsh.profile.bundles` 末尾追加 `dsh-sidebar-manager`
   （改动前自动备份 `package.json` / `pnpm-lock.yaml`）。

装完 **重启 DSH NEXT**（bundles 列表在启动时组装成 Cordis 组合，改了要重启才生效）。

### 方式二：官方 CLI（装了 `@deepseek-ai/dsh` 时）

```bash
dsh plugin --profile desktop add file:"<本插件的绝对路径>"
```

`file:` 方式是**复制**到 profile，之后改代码要重新 add 或手工同步产物。

### 方式三：手工

```text
1. <profile>\node_modules\ 下放入（或联接）本插件目录，名字必须是 dsh-sidebar-manager
2. <profile>\package.json 的 dsh.profile.bundles 数组里加上 "dsh-sidebar-manager"
3. 重启应用
```

其中 `<profile>` 一般是 `C:\Users\<你的用户名>\.dsh\profiles\desktop`。

---

## 使用

1. 侧边栏底部、账户行上方出现一行 **「⚙ 侧边栏管理」**（有隐藏项时右侧显示数量角标）。
2. 点开 → 三个分组：
   
   | 分组   | 内容                                                   | 能否关闭              |
   | ---- | ---------------------------------------------------- | ----------------- |
   | 导航面板 | `sidebar.panellist` 席位上的全部条目（自动化任务、上下文洞察、技能中心、插件市场…） | ✅                 |
   | 底部区域 | `sidebar.footer.action` 席位上的全部条目（费用卡、远程控制…）          | ✅                 |
   | 固定项  | 底部「设置与账户」入口                                          | ❌ 锁定（避免把自己关在设置门外） |
3. 关掉开关 → 侧边栏对应项立即消失；打开 → 立即回来。
4. 面板底部「全部显示」一键还原；`已隐藏 N 项` 是当前统计。
5. 如果关掉的正是**当前打开的面板**，会自动切回对话页（避免内容还在、入口没了）。

---

## 实现原理

### 侧边栏是「外壳 + 槽位」

dsh 没有特权内核，侧边栏本身也是插件（`@deepseek-ai/dsh-client-ui-sidebar`），它只对外暴露
7 个 slot 席位，功能项由别的插件往里填：

| 席位                                                   | kind     | 谁在填                    |
| ---------------------------------------------------- | -------- | ---------------------- |
| `sidebar.panellist`                                  | **list** | 导航行（图标由插件提供，行外壳由侧边栏渲染） |
| `sidebar.footer.action`                              | **list** | 底部条目（整块内容由插件自己渲染）      |
| `sidebar.settings`                                   | single   | 底部「设置与账户」行             |
| `sidebar.workspaces`                                 | single   | 工作区/会话浏览器              |
| `sidebar.brand.mark` / `brand.name` / `toggle.badge` | single   | 品牌、角标                  |

### 隐藏 = 在同一个槽里「遮蔽」它

`@deepseek-ai/dsh-client-ui-slots` 的 list 槽按 `priority` 升序排序，**同一个 id 取第一个存活
条目**，因此「同 id + 更低 priority」就是一个官方的遮蔽位（同 id 不同 priority 注册不会冲突）：

```js
// src/client.js —— 隐藏一条底部条目
slots.register({ name: 'sidebar.footer.action', id: 'cost-meter', priority: -1000000 }, () => null)
```

- 底部条目：空组件渲染 `null`，DOM 直接消失，**不需要 CSS**。
- 导航行：外壳自己渲染 `<button aria-label={label}>`，插件只给它 glyph；只遮蔽 glyph 会剩一个
  空行。所以遮蔽时把 `label` 换成唯一标记串 `\u200bdsm:hidden:<id>`，再补一条只命中标记串的
  CSS 把整行隐掉：

```css
button[aria-label="​dsm:hidden:skill-explorer"]{display:none!important}
```

> 上面属性值的第一个字符是**零宽空格 U+200B**（`\u200b`），肉眼不可见，作用是让这个 label 在任何
> 情况下都不会和真实文案撞车。

为什么用标记串而不是直接匹配「技能中心」这类文案：**不依赖别人的文案、不受语言切换影响、不
依赖 CSS Module 的 hash 类名**（`bJOniG_panelRow` 这种名字每次构建都会变）。

### 状态同步

只有一个同步点 `reconcile()`：读槽账本 → 让「遮蔽项」与「已隐藏集合」对齐 → 重写样式表 →
重建条目清单 → 通知 React。触发时机：`apply` 时、`ctx.slots.subscribe` 收到槽变化时、
`ctx.locale` 切语言时、用户拨开关时，外加 0/120/600/2000ms 几次追赶（别的插件可能比本插件晚注册）。

### 读条目为什么不用 `entriesOfSlot`

被隐藏的 id 的「胜出者」是本插件的遮蔽项（label 已被换成标记串）。所以清单读的是全量账本
`slots.entries(slot)`，剔除本插件自己的组件后，每个 id 取 `priority` 最小的那条：

```js
function realEntries(slotName) {
  const picked = new Map()
  for (const entry of safeEntries(slotName)) {
    if (isOwnComponent(entry.component)) continue          // 跳过自己的遮蔽项
    const id = entry.options.id
    if (typeof id !== 'string' || id === '') continue
    const previous = picked.get(id)
    if (previous === undefined || priorityOf(entry) < priorityOf(previous)) picked.set(id, entry)
  }
  return [...picked.values()].sort(byOrder)
}
```

---

## 设计取舍（以及为什么不做某些事）

| 决定              | 理由                                                                     |
| --------------- | ---------------------------------------------------------------------- |
| 不做 DOM 文本扫描/打标记 | 靠文案与位置匹配会随语言、排序、构建 hash 失效；slot 账本是权威数据源                               |
| 不覆写侧边栏外壳        | 那要重写整个侧栏（折叠、滚动条、拖拽宽度…），升级必碎                                            |
| 「设置与账户」锁定       | 它是进设置的主要入口，关掉容易把用户关在门外                                                 |
| 不管「工作区」区域       | 它不是「功能项」，而是外壳的 `flex:1` 区域——关掉导航行/底部条目，它自然变大                           |
| 只锁「显示」不做「禁用插件」  | 禁用是「设置 → 插件」的职责，本插件只动界面层级                                              |
| 零构建依赖           | 只有浏览器半边、只 require `react` 与平台自带的 primitives，80 行 Node 脚本就能包出合规产物，离线可重建 |

---

## 已知限制

- **遮蔽会卸载那条条目的展示组件**。底部条目若在自己的 React 组件里跑轮询（例如远程控制的状态
  刷新），隐藏后该组件不再挂载、轮询停止；**插件宿主端逻辑（Node 侧）不受影响**，重新显示即恢复。
- 偏好存在 **localStorage**（`dsh.sidebar-manager.v1`），按界面 origin 隔离。桌面端界面是
  `file://` 加载，origin 稳定；若将来改成随机端口的 http origin，偏好会按端口失效（可再点开关）。
- 侧边栏收起成 56px 轨道时，Windows 桌面端的底部区域整体 `display:none`，所以入口在收起态不可见
  ——展开侧栏即可（其它底部条目同理）。
- 若某商品也注册了同一 id，只会在清单里出现一次（同一个 cell，本来就是一回事）。
- 面板正在打开时卸载插件，对话框随组件一起消失（不会留下孤儿弹窗）。

---

## 开发

```bash
node scripts/build.mjs   # 打包：src/client.js → lib/client.js（ModuleLoader 外壳 + 自检）
node test/smoke.mjs      # 冒烟：假 slot 账本跑「隐藏/遮蔽/撤回/持久化/重启恢复」
node test/render.mjs     # 渲染（可选，需 react）：把入口行与面板渲染成 HTML 断言
```

```text
plugins/dsh-sidebar-manager/
├─ package.json          # 入口/exports/dsh.bundle.patch/dsh.client.platform=web
├─ cordis.patch.yml      # insert: id=ui-sidebar-manager, name=dsh-sidebar-manager
├─ src/index.js          # Node 端：纯 UI 插件，apply() 空实现
├─ src/client.js         # 浏览器端：遮蔽逻辑 + 管理面板（1026 行，含注释/样式，分 12 段）
├─ scripts/build.mjs     # 包装 window.__ModuleLoader__.load({id, factory}) + 产物自检
├─ scripts/install.mjs   # 装/卸到 profile（junction + bundles 列表）
├─ test/smoke.mjs        # 11 项：slot 语义 + 持久化 + 卸载清理
├─ test/render.mjs       # 6 项：React 渲染内容断言
├─ lib/                  # 产物（index.js / client.js），安装用这一层
└─ PLAN.md               # 开发前的设计方案与落地记录
```

改完代码：`node scripts/build.mjs` → 重启应用（junction 安装方式无需重新安装）。

`test/render.mjs` 需要 React，且**故意不写进 package.json 依赖**（产物运行在宿主里，依赖由平台
注入）。本地跑：

```bash
npm i --no-save react@18 react-dom@18
node test/render.mjs
```

---

## 卸载

```bash
node scripts/install.mjs --uninstall --yes
```

或手工：删掉 `<profile>/node_modules/dsh-sidebar-manager`，并从 `package.json` 的
`dsh.profile.bundles` 里删掉同一行，重启应用。偏好数据可顺手清掉：
`localStorage` 里的 `dsh.sidebar-manager.v1`（不删也没有副作用——键名带版本号，重装后仍可用）。
