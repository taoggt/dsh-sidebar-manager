#!/usr/bin/env node
/**
 * dsh-sidebar-manager —— 冒烟测试（零依赖，不需要 dsh 运行时）。
 *
 * 做法：用一份**按真实语义实现**的假 slot 账本（list 槽：同 id 同 priority 冲突、
 * 低 priority 遮蔽、entries/entriesOfSlot/subscribe 行为）加载 `lib/client.js`，
 * 确认「列条目 → 隐藏 → 遮蔽 → 撤回 → 持久化 → 重启恢复」整条链路。
 *
 * 用法：node test/smoke.mjs
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

const rows = []

/**
 * 跑一条断言。
 * @param {string} name - 用例名。
 * @param {() => void} body - 断言体。
 * @returns {void}
 */
function it(name, body) {
  try {
    body()
    rows.push(['✓', name])
  } catch (error) {
    rows.push(['✗', name + '  →  ' + error.message])
  }
}

/**
 * 抛错式断言。
 * @param {unknown} condition - 条件。
 * @param {string} message - 失败信息。
 * @returns {void}
 */
function assert(condition, message) {
  if (!condition) throw new Error(message)
}

/**
 * 深比较。
 * @param {unknown} actual - 实际值。
 * @param {unknown} expected - 期望值。
 * @param {string} message - 失败信息。
 * @returns {void}
 */
function equal(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}（实际 ${JSON.stringify(actual)}）`)
}

// ---------------------------------------------------------------------------
// 假环境：window / document / React / primitives
// ---------------------------------------------------------------------------

/**
 * 造一个假 window（带 localStorage）。
 * @param {Map<string, string>} storage - 共享存储。
 * @returns {object} window。
 */
function createWindow(storage) {
  return {
    localStorage: {
      getItem(key) {
        return storage.has(key) ? storage.get(key) : null
      },
      setItem(key, value) {
        storage.set(key, String(value))
      },
      removeItem(key) {
        storage.delete(key)
      },
    },
  }
}

/**
 * 造一个假 document（只要能接住 style 注入）。
 * @returns {object} document。
 */
function createDocument() {
  const styles = []
  return {
    styles,
    head: {
      appendChild(element) {
        element.isConnected = true
        styles.push(element)
      },
    },
    createElement() {
      return {
        dataset: {},
        textContent: '',
        isConnected: false,
        remove() {
          this.isConnected = false
        },
      }
    },
    querySelector() {
      return null
    },
  }
}

/** 假 React：测试只驱动插件 API，不渲染组件。 */
const fakeReact = {
  createElement: () => null,
  Fragment: Symbol.for('react.fragment'),
  useSyncExternalStore: () => 0,
}

/** 假 primitives。 */
const fakePrimitives = {
  Modal: function Modal() {
    return null
  },
  Switch: function Switch() {
    return null
  },
}

// ---------------------------------------------------------------------------
// 假 slot 账本（按 @deepseek-ai/dsh-client-ui-slots 的真实语义实现）
// ---------------------------------------------------------------------------

class FakeSlots {
  /**
   * @param {Array<[string, string]>} declared - [槽名, kind] 列表。
   */
  constructor(declared) {
    this.specs = new Map(declared)
    this.records = new Map()
    this.listeners = new Map()
    this.registerCount = 0
  }

  /**
   * 取（必要时创建）一个槽的记录。
   * @param {string} name - 槽名。
   * @returns {any[]} 条目数组。
   */
  record(name) {
    if (!this.records.has(name)) this.records.set(name, [])
    return this.records.get(name)
  }

  /**
   * 触发槽监听。
   * @param {string} name - 槽名。
   * @returns {void}
   */
  emit(name) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener()
  }

  /**
   * 注册条目（复刻真实实现的冲突与排序规则）。
   * @param {object} options - 注册选项。
   * @param {Function} component - 组件。
   * @returns {() => void} disposer。
   */
  register(options, component) {
    const kind = this.specs.get(options.name)
    if (kind === undefined) throw new Error(`slot "${options.name}" is not declared`)
    const priority = options.priority ?? 0
    const list = this.record(options.name)
    const conflict = list.find((entry) => {
      if ((entry.options.priority ?? 0) !== priority) return false
      if (kind === 'single') return true
      if (kind === 'keyed') return entry.options.key === options.key
      return entry.options.id === options.id
    })
    if (conflict !== undefined) {
      throw new Error(`slot "${options.name}" 同 id 同 priority 注册冲突`)
    }
    const entry = { options: { ...options }, component }
    list.push(entry)
    list.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0))
    this.registerCount += 1
    this.emit(options.name)
    return () => {
      const current = this.record(options.name)
      const index = current.indexOf(entry)
      if (index >= 0) current.splice(index, 1)
      this.emit(options.name)
    }
  }

  /**
   * 全量条目。
   * @param {string} name - 槽名。
   * @returns {any[]} 条目。
   */
  entries(name) {
    return this.record(name)
  }

  /**
   * 每个 id 的胜出者（list：按 priority 取第一个）。
   * @param {string} name - 槽名。
   * @returns {any[]} 胜出条目。
   */
  entriesOfSlot(name) {
    const kind = this.specs.get(name)
    if (kind === undefined) return []
    const seen = new Set()
    const heads = []
    for (const entry of this.record(name)) {
      const cell = kind === 'list' ? entry.options.id : undefined
      if (seen.has(cell)) continue
      seen.add(cell)
      heads.push(entry)
    }
    return heads
  }

  /**
   * 订阅槽变化。
   * @param {string} name - 槽名。
   * @param {() => void} listener - 回调。
   * @returns {() => void} 取消订阅。
   */
  subscribe(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
    return () => this.listeners.get(name).delete(listener)
  }

  /**
   * 席位声明后回调。
   * @param {string} name - 槽名。
   * @param {() => any} callback - 回调。
   * @returns {any} 回调结果（未声明时为空 disposer）。
   */
  inject(name, callback) {
    if (!this.specs.has(name)) return () => {}
    return callback()
  }

  /**
   * 便捷：按 id 找胜出条目。
   * @param {string} name - 槽名。
   * @param {string} id - 条目 id。
   * @returns {any} 条目或 undefined。
   */
  winner(name, id) {
    return this.entriesOfSlot(name).find((entry) => entry.options.id === id)
  }
}

// ---------------------------------------------------------------------------
// 加载产物
// ---------------------------------------------------------------------------

/**
 * 加载一次插件产物（相当于页面刷新一次）。
 * @param {object} options - 环境。
 * @param {Map<string, string>} options.storage - localStorage 后端。
 * @returns {{ api: any, slots: FakeSlots, doc: object, ctx: any }} 加载结果。
 */
function loadPlugin({ storage }) {
  const win = createWindow(storage)
  const doc = createDocument()
  let captured

  const run = new Function('window', 'document', 'console', BUNDLE)
  run({ ...win, __ModuleLoader__: { load: (mod) => { captured = mod } } }, doc, console)

  assert(captured !== undefined, '产物没有调用 __ModuleLoader__.load')
  equal(captured.id, 'dsh-sidebar-manager', 'ModuleLoader 注册的模块 id 应为包名')

  const fakeRequire = (spec) => {
    if (spec === 'react') return fakeReact
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return fakePrimitives
    throw new Error('测试未准备模块：' + spec)
  }
  // 外壳内部自己维护 module/exports，返回值就是插件导出面
  const api = captured.factory(fakeRequire)
  assert(typeof api.apply === 'function', '产物缺少 apply')
  equal(api.inject, ['slots', 'locale'], 'inject 应声明 slots/locale')

  const slots = new FakeSlots([
    ['sidebar.panellist', 'list'],
    ['sidebar.footer.action', 'list'],
    ['sidebar.settings', 'single'],
  ])

  let revision = 0
  const localeListeners = new Set()
  const locale = {
    register() {
      return () => {}
    },
    bind() {
      return (key, params) => {
        const template = DICT[key] ?? key
        if (params === undefined) return template
        return template.replace(/\{(\w+)\}/g, (m, name) => (name in params ? String(params[name]) : m))
      }
    },
    subscribe(listener) {
      localeListeners.add(listener)
      return () => localeListeners.delete(listener)
    },
    getSnapshot() {
      return { active: 'zh', revision }
    },
  }

  const effects = []
  const ctx = {
    slots,
    locale,
    get: () => undefined,
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
  }

  api.apply(ctx)

  return { api, slots, doc, ctx, effects }
}

/** 测试用中文字典（与 src/client.js 的 zh 一致的最小集合）。 */
const DICT = {
  'entry.label': '侧边栏管理',
  'row.settings': '设置与账户',
  'row.locked': '侧边栏的主要入口，始终显示',
  'row.noLabel': '插件未提供显示名称',
  'group.panels': '导航面板',
  'group.footers': '底部区域',
  'group.pinned': '固定项',
  'status.hidden': '已隐藏 {n} 项',
  'status.none': '全部显示中',
}

// ---------------------------------------------------------------------------
// 假条目组件（模拟「别的插件」）
// ---------------------------------------------------------------------------

const glyphSchedules = function SchedulesGlyph() {
  return null
}
const glyphContext = function ContextGlyph() {
  return null
}
const glyphSkills = function SkillsGlyph() {
  return null
}
const cardCost = function CostMeterCard() {
  return null
}
const rowBridge = function ConnectionEntry() {
  return null
}
const rowSettings = function SettingsRow() {
  return null
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

const storage = new Map()
const first = loadPlugin({ storage })
const api = first.api
const internals = api.__internals
const slots = first.slots

// 模拟「其他插件先装好」的两个导航面板 + 底部设置行
slots.register({ name: 'sidebar.panellist', id: 'schedules', order: 10, label: () => '自动化任务' }, glyphSchedules)
slots.register({ name: 'sidebar.panellist', id: 'context', order: 20, label: () => '上下文洞察' }, glyphContext)
slots.register({ name: 'sidebar.settings', id: 'account', label: () => '账户' }, rowSettings)

it('本插件在底部区域注册了「侧边栏管理」入口（order 900）', () => {
  const entry = slots.winner('sidebar.footer.action', 'sidebar-manager')
  assert(entry !== undefined, '没有找到 sidebar-manager 条目')
  equal(entry.options.order, 900, 'order 应为 900（排在底部条目最后）')
  assert(entry.component === internals.ManagerEntry, '组件应为 ManagerEntry')
})

it('条目清单：2 个导航面板 + 1 个固定项', () => {
  const snap = internals.getSnapshot()
  equal(
    snap.items.map((item) => item.key),
    ['panel:schedules', 'panel:context', 'settings'],
    'items 不符合预期',
  )
  equal(snap.items[2].locked, true, '设置入口应锁定')
  equal(snap.hiddenCount, 0, '初始隐藏数应为 0')
})

it('后加载的插件条目会被自动纳入清单（订阅生效）', () => {
  slots.register({ name: 'sidebar.panellist', id: 'skills', order: 30, label: () => '技能中心' }, glyphSkills)
  slots.register({ name: 'sidebar.footer.action', id: 'cost-meter', order: 0 }, cardCost)
  slots.register({ name: 'sidebar.footer.action', id: 'agents-anywhere-next', order: 26, label: () => '远程控制' }, rowBridge)
  const keys = internals.getSnapshot().items.map((item) => item.key)
  equal(
    keys,
    ['panel:schedules', 'panel:context', 'panel:skills', 'footer:cost-meter', 'footer:agents-anywhere-next', 'settings'],
    '条目顺序应为 面板(order) → 底部(order) → 固定项',
  )
})

it('隐藏导航面板：同 id 极低 priority 遮蔽，胜出者变成空 glyph', () => {
  internals.setHidden('panel:skills', true)
  const winner = slots.winner('sidebar.panellist', 'skills')
  assert(winner !== undefined, 'skills 槽位消失了')
  assert(winner.component === internals.HiddenPanelGlyph, '胜出者应为 HiddenPanelGlyph')
  equal(winner.options.priority, internals.SHADOW_PRIORITY, '遮蔽 priority 不符')
  equal(winner.options.order, 30, '遮蔽项应沿用原条目 order，避免可见行顺序抖动')
  equal(winner.options.label, internals.MARKER_PREFIX + 'skills', '遮蔽项 label 应为唯一标记串')
  // 原注册仍在账本里（没有破坏别的插件）
  const originals = slots.entries('sidebar.panellist').filter((entry) => entry.options.id === 'skills')
  equal(originals.length, 2, '账本里应同时存在原条目与遮蔽项')
})

it('生成隐标记 CSS 规则（只命中标记串，不影响别的行）', () => {
  const style = first.doc.styles[first.doc.styles.length - 1]
  const text = style.textContent
  assert(text.includes('button[aria-label="\u200bdsm:hidden:skills"]{display:none!important}'), '缺少 skills 的隐藏规则')
  assert(!text.includes('自动化任务'), 'CSS 不应依赖其他插件的文案')
})

it('偏好已落盘', () => {
  const raw = storage.get('dsh.sidebar-manager.v1')
  assert(raw !== undefined, 'localStorage 里没有写入偏好')
  equal(JSON.parse(raw).hidden, ['panel:skills'], '落盘内容不符')
  equal(internals.getSnapshot().hiddenCount, 1, '快照里的隐藏计数不符')
})

it('隐藏底部条目：空组件遮蔽（不动 CSS）', () => {
  const before = first.doc.styles[first.doc.styles.length - 1].textContent
  internals.setHidden('footer:cost-meter', true)
  const winner = slots.winner('sidebar.footer.action', 'cost-meter')
  assert(winner.component === internals.HiddenFooter, '胜出者应为 HiddenFooter')
  equal(first.doc.styles[first.doc.styles.length - 1].textContent, before, '底部条目的隐藏不该新增 CSS 规则')
  equal(internals.getSnapshot().hiddenCount, 2, '隐藏计数应为 2')
})

it('撤销隐藏：遮蔽项被 dispose，原条目重新胜出', () => {
  internals.setHidden('panel:skills', false)
  const winner = slots.winner('sidebar.panellist', 'skills')
  assert(winner.component === glyphSkills, '原组件应重新胜出')
  assert(!internals.shadows.has('panel:skills'), 'shadows 里不该残留记录')
  const text = first.doc.styles[first.doc.styles.length - 1].textContent
  assert(!text.includes('dsm:hidden:skills'), 'CSS 规则应随之移除')
})

it('全部显示：清空所有隐藏状态', () => {
  internals.showAll()
  equal(internals.getSnapshot().hiddenCount, 0, '隐藏数应归零')
  equal(internals.shadows.size, 0, '不该残留任何遮蔽项')
  equal(JSON.parse(storage.get('dsh.sidebar-manager.v1')).hidden, [], '落盘应为空数组')
})

it('重启恢复：新会话读到旧偏好并自动重新遮蔽', () => {
  internals.setHidden('panel:context', true)
  internals.setHidden('footer:agents-anywhere-next', true)
  const second = loadPlugin({ storage })
  second.slots.register({ name: 'sidebar.panellist', id: 'context', order: 20, label: () => '上下文洞察' }, glyphContext)
  second.slots.register({ name: 'sidebar.footer.action', id: 'agents-anywhere-next', order: 26, label: () => '远程控制' }, rowBridge)
  const snap = second.api.__internals.getSnapshot()
  equal(snap.hiddenCount, 2, '重启后隐藏数应恢复为 2')
  assert(second.slots.winner('sidebar.panellist', 'context').component === second.api.__internals.HiddenPanelGlyph, '重启后导航行未遮蔽')
  assert(second.slots.winner('sidebar.footer.action', 'agents-anywhere-next').component === second.api.__internals.HiddenFooter, '重启后底部条目未遮蔽')
})

it('插件被卸载时清理干净（disposer 生效）', () => {
  const third = loadPlugin({ storage })
  for (const dispose of third.effects) if (typeof dispose === 'function') dispose()
  equal(third.slots.winner('sidebar.footer.action', 'sidebar-manager'), undefined, '入口条目应被移除')
  equal(third.api.__internals.shadows.size, 0, '遮蔽项应全部回收')
})

// ---------------------------------------------------------------------------
// 输出
// ---------------------------------------------------------------------------

let failed = 0
for (const [mark, name] of rows) {
  if (mark === '✗') failed += 1
  console.log(`${mark} ${name}`)
}
console.log('')
console.log(failed === 0 ? `✓ 全部通过（${rows.length} 项）` : `✗ ${failed}/${rows.length} 项失败`)
if (failed > 0) process.exitCode = 1
