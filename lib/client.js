window.__ModuleLoader__.load({
	id: "dsh-sidebar-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
/**
 * dsh-sidebar-manager —— 浏览器端半侧（CJS 模块体）。
 *
 * 本文件由 `scripts/build.mjs` 原样包进
 * `window.__ModuleLoader__.load({ id, factory: (require) => { ... } })` 外壳，
 * 因此这里可以直接使用 `require` / `module` / `exports`，且只能 require 平台模块表里的
 * 模块（react / react-dom / @deepseek-ai/dsh-client-*）。
 *
 * ## 实现原理（一句话）
 * 侧边栏是「外壳 + 槽位（slot）」结构，导航行与底部条目分别来自 list 槽
 * `sidebar.panellist` / `sidebar.footer.action`。本插件不删别人的注册，而是在**同一个
 * 槽里用同一个 id、极低的 priority 再注册一个空组件**，把目标条目从胜出者里顶掉
 * （slot 的遮蔽语义：低 priority 遮高高 priority）；撤销隐藏就是 dispose 掉自己的遮蔽项。
 *
 * - 底部条目：空组件渲染 null，DOM 直接消失，无需 CSS。
 * - 导航行：外壳自己渲染 `<button aria-label={label}>`，只把 glyph 交给插件。所以遮蔽时
 *   把 label 换成唯一标记串 `\u200bdsm:hidden:<id>`，再生成一条
 *   `button[aria-label="…"]{display:none!important}` 把整行隐掉。
 *
 * 详细设计与取舍见 README.md / PLAN.md。
 */

const React = require('react')
const PRIMITIVES = require('@deepseek-ai/dsh-client-ui-primitives')

// ---------------------------------------------------------------------------
// 0. 图标：primitives 的图标集合随版本增减，取不到时退化为空组件而不是整页崩溃
// ---------------------------------------------------------------------------

/** 空 glyph（用作遮蔽条目 / 图标缺失时的兜底）。 */
function NullGlyph() {
  return null
}

/**
 * 从 primitives 里安全取一个图标组件。
 * @param {string} name - 导出名，例如 `IconSlidersTwoOutlineRegular`。
 * @returns {Function} 图标组件（缺失时为 NullGlyph）。
 */
function iconOf(name) {
  const candidate = PRIMITIVES !== null && typeof PRIMITIVES === 'object' ? PRIMITIVES[name] : undefined
  return typeof candidate === 'function' ? candidate : NullGlyph
}

const IconSliders = iconOf('IconSlidersTwoOutlineRegular')
const IconPanel = iconOf('IconPanelLeftOutlineRegular')
const IconFlatList = iconOf('IconFlatListOutlineRegular')
const IconSettings = iconOf('IconSettingsOutlineRegular')
const IconShield = iconOf('IconShieldOutlineRegular')

const Modal = typeof PRIMITIVES.Modal === 'function' ? PRIMITIVES.Modal : null
const Switch = typeof PRIMITIVES.Switch === 'function' ? PRIMITIVES.Switch : null

// ---------------------------------------------------------------------------
// 1. 常量
// ---------------------------------------------------------------------------

/** 插件 id（与 package.json 的 name 一致，ModuleLoader 用它注册模块）。 */
const PLUGIN_ID = 'dsh-sidebar-manager'
/** 语言命名空间。 */
const NS = 'sidebar-manager'
/** localStorage 键（v1：`{ v: 1, hidden: ["panel:<id>", ...] }`）。 */
const PREFS_KEY = 'dsh.sidebar-manager.v1'
/** 遮蔽条目使用的 priority：取一个极端值，确保压过任何正常注册。 */
const SHADOW_PRIORITY = -1000000
/** 遮蔽导航行时写进 label 的唯一标记前缀（零宽空格开头，肉眼不可见）。 */
const MARKER_PREFIX = '\u200bdsm:hidden:'
/** 本插件自己那一行（底部「侧边栏管理」）的条目 id。 */
const MANAGER_ENTRY_ID = 'sidebar-manager'
/** 样式表标记，避免重复注入（沿用官方插件的 data-plugin-css 约定）。 */
const STYLE_TAG_ID = PLUGIN_ID + '/manager.css'

/** 侧边栏席位。 */
const PANEL_SLOT = 'sidebar.panellist'
const FOOTER_SLOT = 'sidebar.footer.action'
const SETTINGS_SLOT = 'sidebar.settings'

/** 可管理的两类条目。 */
const KINDS = ['panel', 'footer']

const KIND_META = {
  panel: { slot: PANEL_SLOT, groupKey: 'group.panels' },
  footer: { slot: FOOTER_SLOT, groupKey: 'group.footers' },
}

// ---------------------------------------------------------------------------
// 2. 文案（zh 为键集基准，en 兜底）
// ---------------------------------------------------------------------------

const zh = {
  'entry.label': '侧边栏管理',
  'entry.tooltip': '自定义侧边栏显示的功能项',
  'dialog.title': '自定义侧边栏',
  'dialog.desc': '开关只控制「是否显示在侧边栏」，被隐藏的插件仍在后台正常运行。',
  'group.panels': '导航面板',
  'group.footers': '底部区域',
  'group.pinned': '固定项',
  'row.settings': '设置与账户',
  'row.locked': '侧边栏的主要入口，始终显示',
  'row.noLabel': '插件未提供显示名称',
  'action.showAll': '全部显示',
  'action.close': '关闭',
  'status.none': '全部显示中',
  'status.hidden': '已隐藏 {n} 项',
  'badge.more': '已隐藏 {n} 项',
  'empty.all': '侧边栏里还没有可管理的功能项。',
}

const en = {
  'entry.label': 'Sidebar manager',
  'entry.tooltip': 'Choose what shows in the sidebar',
  'dialog.title': 'Customize sidebar',
  'dialog.desc': 'Switches only control what the sidebar shows. Hidden plugins keep running in the background.',
  'group.panels': 'Navigation panels',
  'group.footers': 'Bottom area',
  'group.pinned': 'Pinned',
  'row.settings': 'Settings & account',
  'row.locked': 'Primary sidebar entry, always visible',
  'row.noLabel': 'No display name provided by the plugin',
  'action.showAll': 'Show all',
  'action.close': 'Close',
  'status.none': 'Everything is visible',
  'status.hidden': '{n} item(s) hidden',
  'badge.more': '{n} hidden',
  'empty.all': 'No manageable items in the sidebar yet.',
}

/** 当前翻译函数（apply 时绑定到 locale 服务；之前退化为中文）。 */
let translate = function fallbackTranslate(key) {
  return zh[key] ?? key
}

/**
 * 取一条文案。
 * @param {string} key - 键。
 * @param {Record<string, unknown>} [params] - `{name}` 占位参数。
 * @returns {string} 当前语言下的文案。
 */
function t(key, params) {
  try {
    return translate(key, params)
  } catch {
    return zh[key] ?? key
  }
}

// ---------------------------------------------------------------------------
// 3. 运行时引用（apply 时填充）
// ---------------------------------------------------------------------------

/** @type {{ slots?: any, locale?: any, get?: (name: string) => any } | undefined} */
let ctxRef
/** @type {any} slots 服务。 */
let slotsRef
/** @type {any} locale 服务（重新渲染的订阅源）。 */
let localeFace
/** key → 遮蔽项的 disposer。 */
const shadows = new Map()
/** 本插件施加的 CSS 规则（遮蔽导航行用）。 */
let styleTag
/** 延迟重跑的定时器 id。 */
const timers = []
/** 重入保护。 */
let reconciling = false
/** 是否需要在当前这一轮 reconcile 结束后再来一轮。 */
let dirtyAgain = false

// ---------------------------------------------------------------------------
// 4. 偏好持久化
// ---------------------------------------------------------------------------

/**
 * 读取已经隐藏的条目 key。
 * @returns {string[]} 形如 `["panel:skills", "footer:cost-meter"]`。
 */
function readHiddenKeys() {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY)
    if (raw === null) return []
    const parsed = JSON.parse(raw)
    const list = parsed !== null && typeof parsed === 'object' && Array.isArray(parsed.hidden) ? parsed.hidden : []
    return list.filter(function pick(key) {
      return typeof key === 'string' && key.length > 0
    })
  } catch {
    return []
  }
}

/**
 * 落盘当前隐藏集合（失败时静默：内存态继续可用）。
 * @returns {void}
 */
function writeHiddenKeys() {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 1, hidden: Array.from(state.hidden) }))
  } catch {
    /* 隐私模式 / 配额异常：保持内存态，不打断交互 */
  }
}

// ---------------------------------------------------------------------------
// 5. 状态仓库（给 React 用 useSyncExternalStore 订阅）
// ---------------------------------------------------------------------------

const state = {
  /** 管理面板是否打开。 */
  open: false,
  /** 被隐藏的条目 key 集合。 */
  hidden: new Set(readHiddenKeys()),
  /** 当前侧边栏条目快照（每次 reconcile 重建）。 */
  items: [],
}

let version = 0
let snapshot = null
const listeners = new Set()

/**
 * 组装一次不可变快照并通知订阅者。
 * @returns {void}
 */
function publish() {
  version += 1
  const hiddenCount = state.items.reduce(function count(acc, item) {
    return !item.locked && state.hidden.has(item.key) ? acc + 1 : acc
  }, 0)
  snapshot = Object.freeze({
    version,
    open: state.open,
    items: state.items,
    hidden: state.hidden,
    hiddenCount,
  })
  for (const listener of Array.from(listeners)) {
    try {
      listener()
    } catch (error) {
      console.warn('[sidebar-manager] listener failed:', error)
    }
  }
}

/**
 * 订阅状态变化。
 * @param {() => void} listener - 变化回调。
 * @returns {() => void} 取消订阅。
 */
function subscribeStore(listener) {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}

/**
 * 取当前快照（引用稳定，只在 publish 时变化）。
 * @returns {object} 快照。
 */
function getSnapshot() {
  return snapshot
}

// 首屏：让 getSnapshot 从一开始就有值（React 首次渲染在 apply 之前也可能发生）
publish()

// ---------------------------------------------------------------------------
// 6. 样式表
// ---------------------------------------------------------------------------

const STATIC_CSS = [
  /* 底部署名入口（侧边栏里的那一行） */
  '.dsm-entry{display:flex;align-items:center;gap:8px;box-sizing:border-box;width:100%;flex:none;align-self:stretch;height:32px;margin:2px 0;padding:0 8px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary,#5f6368);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;overflow:hidden}',
  '.dsm-entry:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1a1a1a)}',
  '.dsm-entry:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary,#4d6bfe));outline-offset:-2px}',
  '.dsm-entry>svg{flex:none}',
  '.dsm-entry-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsm-entry-badge{flex:none;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-border-l3,rgba(0,0,0,.1));color:var(--dsw-alias-label-secondary,#5f6368);font-size:11px;line-height:17px;text-align:center;font-variant-numeric:tabular-nums}',
  '.dsm-entry.dsm-entry--rail{width:36px;height:36px;margin:0;padding:0;justify-content:center}',
  /* 管理面板 */
  '.dsm-dialog{width:560px;max-width:100%;max-height:100%}',
  '.dsm-body{display:flex;flex-direction:column;gap:18px;max-height:min(58vh,520px);overflow-y:auto;overscroll-behavior:contain}',
  '.dsm-group{display:flex;flex-direction:column;gap:2px}',
  '.dsm-group-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 8px 4px}',
  '.dsm-group-title{font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--dsw-alias-label-secondary,#5f6368)}',
  '.dsm-group-count{font-size:11px;color:var(--dsw-alias-label-secondary,#5f6368);opacity:.75;font-variant-numeric:tabular-nums}',
  '.dsm-row{display:flex;align-items:center;gap:10px;padding:8px;border-radius:var(--dsw-radius-md,8px)}',
  '.dsm-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}',
  '.dsm-row-glyph{flex:none;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:calc(var(--dsw-radius-md,8px) - 1px);background:var(--dsw-alias-interactive-bg-secondary,rgba(0,0,0,.04));color:var(--dsw-alias-label-secondary,#5f6368)}',
  '.dsm-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
  '.dsm-row-label{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsm-row-id{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary,#5f6368);opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dsm-row--off .dsm-row-label{color:var(--dsw-alias-label-secondary,#5f6368)}',
  '.dsm-row--off .dsm-row-glyph{opacity:.5}',
  '.dsm-lock{flex:none;display:flex;align-items:center;color:var(--dsw-alias-label-secondary,#5f6368);opacity:.75}',
  '.dsm-empty{padding:12px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary,#5f6368)}',
  '.dsm-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%}',
  '.dsm-foot-status{font-size:12px;color:var(--dsw-alias-label-secondary,#5f6368);font-variant-numeric:tabular-nums}',
  '.dsm-btn{height:32px;padding:0 14px;border-radius:var(--dsw-radius-md,8px);border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:var(--dsw-alias-button-elevated-fill,#fff);color:var(--dsw-alias-label-primary,#1a1a1a);font:inherit;font-size:13px;cursor:pointer}',
  '.dsm-btn:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover,rgba(0,0,0,.04))}',
  '.dsm-btn:disabled{opacity:.45;cursor:default}',
].join('\n')

/**
 * 转义成 CSS 字符串字面量。
 * @param {string} value - 原始值。
 * @returns {string} 带引号的 CSS 字符串。
 */
function cssString(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
}

/**
 * 重写样式表内容（静态规则 + 每个隐藏导航行的隐标记规则）。
 * @returns {void}
 */
function applyStyles() {
  const rules = [STATIC_CSS]
  for (const key of shadows.keys()) {
    if (key.slice(0, 6) !== 'panel:') continue
    const id = key.slice(6)
    rules.push('button[aria-label=' + cssString(MARKER_PREFIX + id) + ']{display:none!important}')
  }
  const text = rules.join('\n')
  try {
    if (styleTag === undefined || styleTag === null || !styleTag.isConnected) {
      if (typeof document === 'undefined' || document.head === null) return
      const existing = document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]')
      if (existing !== null) {
        styleTag = existing
      } else {
        styleTag = document.createElement('style')
        styleTag.dataset.plugin = PLUGIN_ID
        styleTag.dataset.pluginCss = STYLE_TAG_ID
        document.head.appendChild(styleTag)
      }
    }
    if (styleTag.textContent !== text) styleTag.textContent = text
  } catch (error) {
    console.warn('[sidebar-manager] style injection failed:', error)
  }
}

/** 移除样式表（插件卸载时）。 */
function removeStyles() {
  try {
    if (styleTag !== undefined && styleTag !== null) styleTag.remove()
  } catch {
    /* ignore */
  }
  styleTag = undefined
}

// ---------------------------------------------------------------------------
// 7. 读账本：把 slot 里的条目整理成「真正属于别的插件的条目」
// ---------------------------------------------------------------------------

/**
 * 本插件自己投进槽里的组件（列条目时必须排除，否则会自我循环）。
 * @param {any} component - 条目的组件。
 * @returns {boolean} 是否属于本插件。
 */
function isOwnComponent(component) {
  return component === HiddenPanelGlyph || component === HiddenFooter || component === ManagerEntry
}

/**
 * 取某个 list 槽里「每个 id 的真实条目」。
 *
 * 不能直接用 `entriesOfSlot`：被隐藏的 id 的胜出者是本插件的遮蔽项，label 已被换成
 * 标记串。所以读 `entries`（全量账本）→ 剔除本插件自己的组件 → 每个 id 取 priority
 * 最小的那条（若别的插件也遮蔽过，它才是当前真正生效的条目）。
 *
 * @param {string} slotName - 槽名。
 * @returns {any[]} 条目数组，按 order 升序。
 */
function realEntries(slotName) {
  const picked = new Map()
  for (const entry of safeEntries(slotName)) {
    if (entry === undefined || entry === null) continue
    if (isOwnComponent(entry.component)) continue
    const id = entry.options !== undefined && entry.options !== null ? entry.options.id : undefined
    if (typeof id !== 'string' || id === '') continue
    const previous = picked.get(id)
    // 同一 id 可能被别的插件也遮蔽过：取 priority 最小的那条作为「真实条目」
    if (previous === undefined || priorityOf(entry) < priorityOf(previous)) picked.set(id, entry)
  }
  const list = Array.from(picked.values())
  list.sort(function byOrder(a, b) {
    const delta = orderOf(a) - orderOf(b)
    if (delta !== 0) return delta
    return String(a.options.id) < String(b.options.id) ? -1 : 1
  })
  return list
}

/**
 * 安全读取槽内全量条目。
 * @param {string} slotName - 槽名。
 * @returns {any[]} 条目数组（读不到时为空）。
 */
function safeEntries(slotName) {
  try {
    const list = slotsRef !== undefined && slotsRef !== null ? slotsRef.entries(slotName) : null
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

/**
 * 条目的 priority。
 * @param {any} entry - 条目。
 * @returns {number} priority（缺省 0）。
 */
function priorityOf(entry) {
  const value = entry.options !== undefined && entry.options !== null ? entry.options.priority : undefined
  return typeof value === 'number' ? value : 0
}

/**
 * 条目的 order。
 * @param {any} entry - 条目。
 * @returns {number} order（缺省 0）。
 */
function orderOf(entry) {
  const value = entry.options !== undefined && entry.options !== null ? entry.options.order : undefined
  return typeof value === 'number' ? value : 0
}

/**
 * 解析条目 label（字符串或 `() => string`），失败时退回 id。
 * @param {any} entry - 条目。
 * @returns {{ label: string, hasLabel: boolean }} 显示名与「是否为插件自报名字」。
 */
function labelOf(entry) {
  const raw = entry.options !== undefined && entry.options !== null ? entry.options.label : undefined
  try {
    const text = typeof raw === 'function' ? raw() : raw
    if (typeof text === 'string' && text.trim() !== '') return { label: text, hasLabel: true }
  } catch {
    /* 别的插件的 t() 可能还没就绪 —— 退回 id */
  }
  return { label: String(entry.options.id), hasLabel: false }
}

/**
 * 重建 item 列表（供管理面板渲染）。
 * @returns {void}
 */
function rebuildItems() {
  const items = []
  for (const kind of KINDS) {
    for (const entry of realEntries(KIND_META[kind].slot)) {
      const id = String(entry.options.id)
      const named = labelOf(entry)
      items.push({
        key: kind + ':' + id,
        kind,
        id,
        label: named.label,
        hasLabel: named.hasLabel,
        order: orderOf(entry),
        locked: false,
      })
    }
  }
  // 固定项：底部「设置与账户」入口（只展示，不可隐藏）
  if (safeEntries(SETTINGS_SLOT).length > 0) {
    items.push({
      key: 'settings',
      kind: 'settings',
      id: 'settings',
      label: t('row.settings'),
      hasLabel: true,
      order: Number.MAX_SAFE_INTEGER,
      locked: true,
    })
  }
  state.items = items
}

// ---------------------------------------------------------------------------
// 8. 遮蔽（隐藏）与撤销
// ---------------------------------------------------------------------------

/**
 * 导航行的遮蔽 glyph：什么都不画。
 * @returns {null} 空渲染。
 */
function HiddenPanelGlyph() {
  return null
}

/**
 * 底部条目的遮蔽组件：什么都不画。
 * @returns {null} 空渲染。
 */
function HiddenFooter() {
  return null
}

/**
 * 为一条真实条目注册遮蔽项。
 * @param {'panel'|'footer'} kind - 条目类别。
 * @param {any} entry - 被遮蔽的真实条目。
 * @returns {void}
 */
function registerShadow(kind, entry) {
  const id = String(entry.options.id)
  const key = kind + ':' + id
  const options = {
    name: KIND_META[kind].slot,
    id,
    order: orderOf(entry),
    priority: SHADOW_PRIORITY,
  }
  if (kind === 'panel') {
    // 外壳会把 label 渲染成 aria-label：换成唯一标记串，供 CSS 精确命中整行
    options.label = MARKER_PREFIX + id
  }
  const dispose = slotsRef.register(options, kind === 'panel' ? HiddenPanelGlyph : HiddenFooter)
  shadows.set(key, function release() {
    try {
      dispose()
    } catch (error) {
      console.warn('[sidebar-manager] dispose shadow failed:', error)
    }
  })
}

/**
 * 撤销一条遮蔽。
 * @param {string} key - 条目 key。
 * @returns {void}
 */
function disposeShadow(key) {
  const dispose = shadows.get(key)
  if (dispose === undefined) return
  shadows.delete(key)
  dispose()
}

/**
 * 让遮蔽项与「已隐藏集合」对齐，然后刷新样式与条目列表。
 *
 * 这是本插件唯一的状态同步点：槽位变化、开始应用、切换开关都会走到这里。
 * 全部包在 try/catch 里 —— 外部插件的异常不能把 dsh 的启动/界面带崩。
 *
 * @returns {void}
 */
function reconcile() {
  if (slotsRef === undefined || slotsRef === null) return
  if (reconciling) {
    dirtyAgain = true
    return
  }
  reconciling = true
  try {
    for (const kind of KINDS) {
      const entries = realEntries(KIND_META[kind].slot)
      const present = new Set()
      for (const entry of entries) {
        const key = kind + ':' + String(entry.options.id)
        present.add(key)
        if (state.hidden.has(key)) {
          if (!shadows.has(key)) registerShadow(kind, entry)
        } else if (shadows.has(key)) {
          disposeShadow(key)
        }
      }
      for (const key of Array.from(shadows.keys())) {
        if (key.slice(0, kind.length + 1) !== kind + ':') continue
        if (!present.has(key)) disposeShadow(key)
      }
    }
    applyStyles()
    rebuildItems()
    publish()
  } catch (error) {
    console.warn('[sidebar-manager] reconcile failed:', error)
  } finally {
    reconciling = false
    if (dirtyAgain) {
      dirtyAgain = false
      setTimeout(function rerun() {
        reconcile()
      }, 0)
    }
  }
}

/**
 * 槽位变化回调（注册/注销/语言切换都会触发）。
 * @returns {void}
 */
function onLedgerChange() {
  reconcile()
}

// ---------------------------------------------------------------------------
// 9. 动作
// ---------------------------------------------------------------------------

/**
 * 隐藏某个导航面板时，如果它正是当前打开的面板，就回到对话页，
 * 避免出现「内容还在、入口没了」的死角。
 * @param {string} panelId - 面板 id。
 * @returns {void}
 */
function maybeLeavePanel(panelId) {
  try {
    if (ctxRef === undefined || typeof ctxRef.get !== 'function') return
    const layout = ctxRef.get('layout')
    if (layout === undefined || layout === null) return
    const info = layout.panelInfo
    const current = info !== undefined && info !== null && typeof info.getSnapshot === 'function' ? info.getSnapshot() : undefined
    const activePanelId = current !== undefined && current !== null ? current.activePanelId : undefined
    if (activePanelId === panelId && typeof layout.selectPanel === 'function') layout.selectPanel(null)
  } catch {
    /* layout 不可用时只影响体验，不影响隐藏本身 */
  }
}

/**
 * 切换某一项的显示状态（立即生效 + 立即落盘）。
 * @param {string} key - 条目 key。
 * @param {boolean} hidden - true 表示隐藏。
 * @returns {void}
 */
function setHidden(key, hidden) {
  if (hidden) state.hidden.add(key)
  else state.hidden.delete(key)
  writeHiddenKeys()
  reconcile()
  if (hidden && key.slice(0, 6) === 'panel:') maybeLeavePanel(key.slice(6))
}

/**
 * 全部恢复显示。
 * @returns {void}
 */
function showAll() {
  state.hidden.clear()
  writeHiddenKeys()
  reconcile()
}

/** 打开管理面板。 */
function openManager() {
  if (state.open) return
  state.open = true
  reconcile()
}

/** 关闭管理面板。 */
function closeManager() {
  if (!state.open) return
  state.open = false
  publish()
}

// ---------------------------------------------------------------------------
// 10. Hooks
// ---------------------------------------------------------------------------

/**
 * 订阅仓库快照。
 * @returns {object} 快照。
 */
function useStore() {
  return React.useSyncExternalStore(subscribeStore, getSnapshot, getSnapshot)
}

/**
 * locale 变化时重渲染（文案随语言切换即时更新）。
 * @returns {number} 当前语言版本号。
 */
function useLocaleRevision() {
  return React.useSyncExternalStore(subscribeLocale, getLocaleRevision, getLocaleRevisionFallback)
}

/**
 * 订阅 locale 变化。
 * @param {() => void} listener - 变化回调。
 * @returns {() => void} 取消订阅。
 */
function subscribeLocale(listener) {
  try {
    if (localeFace !== undefined && localeFace !== null && typeof localeFace.subscribe === 'function') {
      return localeFace.subscribe(listener)
    }
  } catch {
    /* ignore */
  }
  return function noop() {}
}

/**
 * 取 locale 版本号。
 * @returns {number} revision。
 */
function getLocaleRevision() {
  try {
    if (localeFace !== undefined && localeFace !== null && typeof localeFace.getSnapshot === 'function') {
      const snap = localeFace.getSnapshot()
      if (snap !== undefined && snap !== null && typeof snap.revision === 'number') return snap.revision
    }
  } catch {
    /* ignore */
  }
  return 0
}

/** 服务端快照兜底（无 SSR，仅为 useSyncExternalStore 签名完整）。 */
function getLocaleRevisionFallback() {
  return 0
}

// ---------------------------------------------------------------------------
// 11. 组件
// ---------------------------------------------------------------------------

/**
 * 侧边栏底部那一行入口（`sidebar.footer.action` 席位）。
 * @param {{ wide?: boolean }} props - 外壳给的宽窄标志。
 * @returns {object} 行按钮 + 管理面板。
 */
function ManagerEntry(props) {
  const wide = props !== undefined && props !== null && props.wide === true
  const snap = useStore()
  useLocaleRevision()
  const label = t('entry.label')
  const badge = wide && snap.hiddenCount > 0 ? String(snap.hiddenCount) : null

  const button = React.createElement(
    'button',
    {
      type: 'button',
      className: 'dsm-entry' + (wide ? '' : ' dsm-entry--rail'),
      title: t('entry.tooltip'),
      'aria-label': label,
      onClick: openManager,
    },
    React.createElement(IconSliders, { key: 'glyph', size: wide ? 16 : 18 }),
    wide ? React.createElement('span', { key: 'label', className: 'dsm-entry-label' }, label) : null,
    badge !== null ? React.createElement('span', { key: 'badge', className: 'dsm-entry-badge' }, badge) : null,
  )

  return React.createElement(React.Fragment, null, button, React.createElement(ManagerDialog, { key: 'dialog' }))
}

/**
 * 管理面板（居中对话框）。
 * @returns {object|null} 对话框。
 */
function ManagerDialog() {
  const snap = useStore()
  useLocaleRevision()
  if (Modal === null) return null

  const panels = snap.items.filter(function isPanel(item) {
    return item.kind === 'panel'
  })
  const footers = snap.items.filter(function isFooter(item) {
    return item.kind === 'footer'
  })
  const pinned = snap.items.filter(function isPinned(item) {
    return item.kind === 'settings'
  })

  const sections = []
  if (panels.length > 0) sections.push(renderGroup('panel', panels, snap.hidden))
  if (footers.length > 0) sections.push(renderGroup('footer', footers, snap.hidden))
  if (pinned.length > 0) sections.push(renderPinned(pinned))

  const body =
    sections.length === 0
      ? React.createElement('p', { className: 'dsm-empty' }, t('empty.all'))
      : React.createElement('div', { className: 'dsm-body' }, sections)

  const footer = React.createElement(
    'div',
    { className: 'dsm-foot' },
    React.createElement(
      'span',
      { className: 'dsm-foot-status' },
      snap.hiddenCount > 0 ? t('status.hidden', { n: snap.hiddenCount }) : t('status.none'),
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dsm-btn',
        disabled: snap.hiddenCount === 0,
        onClick: showAll,
      },
      t('action.showAll'),
    ),
  )

  return React.createElement(
    Modal,
    {
      open: snap.open,
      onClose: closeManager,
      title: t('dialog.title'),
      closeLabel: t('action.close'),
      description: t('dialog.desc'),
      className: 'dsm-dialog',
      footer,
    },
    body,
  )
}

/**
 * 渲染一个分组（导航面板 / 底部区域）。
 * @param {'panel'|'footer'} kind - 分组类别。
 * @param {any[]} items - 分组内的条目。
 * @param {Set<string>} hiddenSet - 当前隐藏集合。
 * @returns {object} 分组节点。
 */
function renderGroup(kind, items, hiddenSet) {
  let visible = 0
  for (const item of items) if (!hiddenSet.has(item.key)) visible += 1
  const rows = items.map(function toRow(item) {
    return React.createElement(ItemRow, { key: item.key, item, hidden: hiddenSet.has(item.key) })
  })
  return React.createElement(
    'section',
    { className: 'dsm-group', key: kind },
    React.createElement(
      'div',
      { className: 'dsm-group-head' },
      React.createElement('span', { className: 'dsm-group-title' }, t(KIND_META[kind].groupKey)),
      React.createElement('span', { className: 'dsm-group-count' }, visible + '/' + items.length),
    ),
    rows,
  )
}

/**
 * 渲染固定项（不可隐藏的底部设置入口）。
 * @param {any[]} items - 固定项。
 * @returns {object} 分组节点。
 */
function renderPinned(items) {
  const rows = items.map(function toRow(item) {
    return React.createElement(ItemRow, { key: item.key, item, hidden: false })
  })
  return React.createElement(
    'section',
    { className: 'dsm-group', key: 'pinned' },
    React.createElement(
      'div',
      { className: 'dsm-group-head' },
      React.createElement('span', { className: 'dsm-group-title' }, t('group.pinned')),
    ),
    rows,
  )
}

/**
 * 一行：glyph + 名称 + 来源 id + 开关。
 * @param {{ item: any, hidden: boolean }} props - 条目及其隐藏状态。
 * @returns {object} 行节点。
 */
function ItemRow(props) {
  const item = props.item
  const hidden = props.hidden === true
  const glyph = item.kind === 'panel' ? IconPanel : item.kind === 'footer' ? IconFlatList : IconSettings
  const subtitle = item.locked ? t('row.locked') : item.hasLabel ? item.id : t('row.noLabel')

  const lock = React.createElement('span', { className: 'dsm-lock', title: t('row.locked') }, React.createElement(IconShield, { size: 14 }))
  let control = lock
  if (!item.locked && Switch !== null) {
    control = React.createElement(Switch, {
      checked: !hidden,
      onChange: function onToggle(next) {
        setHidden(item.key, !next)
      },
      label: item.label,
    })
  }

  return React.createElement(
    'div',
    { className: 'dsm-row' + (hidden ? ' dsm-row--off' : '') },
    React.createElement('span', { className: 'dsm-row-glyph' }, React.createElement(glyph, { size: 15 })),
    React.createElement(
      'span',
      { className: 'dsm-row-main' },
      React.createElement('span', { className: 'dsm-row-label' }, item.label),
      React.createElement('span', { className: 'dsm-row-id' }, subtitle),
    ),
    control,
  )
}

// ---------------------------------------------------------------------------
// 12. 插件入口
// ---------------------------------------------------------------------------

/** 依赖的客户端服务：槽位注册表 + 语言。 */
const inject = ['slots', 'locale']

/**
 * 挂载侧边栏管理器。
 * @param {any} ctx - 客户端根上下文。
 * @returns {void}
 */
function apply(ctx) {
  ctxRef = ctx
  slotsRef = ctx.slots
  localeFace = ctx.locale

  // --- 语言词典（HMR 重载时重复注册会抛错，吞掉即可）
  try {
    ctx.effect(function localeDicts() {
      return ctx.locale.register(NS, { zh, en })
    }, 'sidebar-manager: locale')
  } catch (error) {
    console.warn('[sidebar-manager] locale registration failed:', error)
  }
  try {
    translate = ctx.locale.bind(NS)
  } catch (error) {
    console.warn('[sidebar-manager] locale bind failed:', error)
  }

  // --- 跟随槽位变化（别的插件装/卸、语言切换都会走到这里）
  const offs = []
  for (const slotName of [PANEL_SLOT, FOOTER_SLOT, SETTINGS_SLOT]) {
    try {
      const off = ctx.slots.subscribe(slotName, onLedgerChange)
      if (typeof off === 'function') offs.push(off)
    } catch (error) {
      console.warn('[sidebar-manager] subscribe failed for ' + slotName + ':', error)
    }
  }
  try {
    const off = ctx.locale.subscribe(function onLocale() {
      translate = ctx.locale.bind(NS)
      reconcile()
    })
    if (typeof off === 'function') offs.push(off)
  } catch (error) {
    console.warn('[sidebar-manager] locale subscribe failed:', error)
  }

  // --- 首屏 + 追赶：其他插件可能在本次 apply 之后才注册条目
  reconcile()
  for (const delay of [120, 600, 2000]) {
    timers.push(
      setTimeout(function kick() {
        reconcile()
      }, delay),
    )
  }

  // --- 在侧边栏底部注册「侧边栏管理」入口
  ctx.effect(function managerEntry() {
    return ctx.slots.inject(FOOTER_SLOT, function registerEntry() {
      return ctx.slots.register(
        {
          name: FOOTER_SLOT,
          id: MANAGER_ENTRY_ID,
          order: 900,
          label: function entryLabel() {
            return t('entry.label')
          },
        },
        ManagerEntry,
      )
    })
  }, 'sidebar-manager: sidebar entry')

  // --- 卸载清理
  ctx.effect(function teardown() {
    return function dispose() {
      for (const off of offs.splice(0)) {
        try {
          off()
        } catch {
          /* ignore */
        }
      }
      for (const timer of timers.splice(0)) clearTimeout(timer)
      for (const key of Array.from(shadows.keys())) disposeShadow(key)
      state.open = false
      removeStyles()
    }
  }, 'sidebar-manager: teardown')
}

exports.inject = inject
exports.apply = apply

/**
 * 内部接口：仅供 `test/smoke.mjs` 驱动（Cordis 只读 apply / inject，多余导出无副作用）。
 */
exports.__internals = {
  PLUGIN_ID,
  PREFS_KEY,
  PANEL_SLOT,
  FOOTER_SLOT,
  SETTINGS_SLOT,
  SHADOW_PRIORITY,
  MARKER_PREFIX,
  MANAGER_ENTRY_ID,
  setHidden,
  showAll,
  reconcile,
  realEntries,
  openManager,
  closeManager,
  getSnapshot,
  state,
  shadows,
  HiddenPanelGlyph,
  HiddenFooter,
  ManagerEntry,
  readHiddenKeys,
  writeHiddenKeys,
}

		return module.exports;
	}
});
