#!/usr/bin/env node
/**
 * dsh-sidebar-manager —— 渲染测试（可选，需要 react / react-dom）。
 *
 * 冒烟测试只驱动插件 API，不碰 React；本文件补上「组件真的能渲染出来」这一层：
 * 用真实的 React 把「侧边栏入口行 + 管理面板」渲染成静态 HTML，检查
 * 名称、来源 id、开关状态与统计文案是否随状态变化。
 *
 * 产物里的 `Modal` / `Switch` 换成等价的最小实现（不进 portal），这样无需 DOM 也能渲染。
 *
 * 用法：
 *   npm i --no-save react@18 react-dom@18    # 或在任意目录装好后设置 NODE_PATH
 *   node test/render.mjs
 */

import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = await readFile(join(ROOT, 'lib', 'client.js'), 'utf8')

const require = createRequire(import.meta.url)

let React
let renderToStaticMarkup
try {
  React = require('react')
  renderToStaticMarkup = require('react-dom/server').renderToStaticMarkup
} catch {
  console.log('… 跳过渲染测试：未找到 react / react-dom（npm i --no-save react@18 react-dom@18）')
  process.exit(0)
}

const h = React.createElement

// ---------------------------------------------------------------------------
// 最小 primitives 替身（形态与合约对齐真实组件）
// ---------------------------------------------------------------------------

/**
 * 面板：真实 Modal 走 portal，这里直接内联渲染，便于 SSR。
 * @param {object} props - 与真实 Modal 相同的字段。
 * @returns {object|null} 节点。
 */
function Modal(props) {
  if (props.open !== true) return null
  return h(
    'div',
    { className: 'mock-modal', role: 'dialog', 'aria-label': props.title },
    h('h2', { className: 'mock-title' }, props.title),
    props.description !== undefined ? h('p', { className: 'mock-desc' }, props.description) : null,
    h('div', { className: 'mock-body' }, props.children),
    h('div', { className: 'mock-footer' }, props.footer),
  )
}

/**
 * 开关。
 * @param {object} props - checked / onChange / label。
 * @returns {object} 节点。
 */
function Switch(props) {
  return h('button', {
    type: 'button',
    role: 'switch',
    'aria-checked': props.checked,
    'aria-label': props.label,
    onClick: () => props.onChange(!props.checked),
  })
}

/**
 * 造一个假图标。
 * @returns {object} 节点。
 */
function Glyph() {
  return h('svg', { viewBox: '0 0 16 16' })
}

const primitives = {
  Modal,
  Switch,
  IconSlidersTwoOutlineRegular: Glyph,
  IconPanelLeftOutlineRegular: Glyph,
  IconFlatListOutlineRegular: Glyph,
  IconSettingsOutlineRegular: Glyph,
  IconShieldOutlineRegular: Glyph,
}

// ---------------------------------------------------------------------------
// 假 slot 账本（与 test/smoke.mjs 同一份语义，此处只保留需要的部分）
// ---------------------------------------------------------------------------

class FakeSlots {
  constructor() {
    this.records = new Map()
    this.listeners = new Map()
  }

  record(name) {
    if (!this.records.has(name)) this.records.set(name, [])
    return this.records.get(name)
  }

  emit(name) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener()
  }

  register(options, component) {
    const list = this.record(options.name)
    const entry = { options: { ...options }, component }
    list.push(entry)
    list.sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0) || (a.options.order ?? 0) - (b.options.order ?? 0))
    this.emit(options.name)
    return () => {
      const index = this.record(options.name).indexOf(entry)
      if (index >= 0) this.record(options.name).splice(index, 1)
      this.emit(options.name)
    }
  }

  entries(name) {
    return this.record(name)
  }

  entriesOfSlot(name) {
    const seen = new Set()
    const heads = []
    for (const entry of this.record(name)) {
      if (seen.has(entry.options.id)) continue
      seen.add(entry.options.id)
      heads.push(entry)
    }
    return heads
  }

  subscribe(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set())
    this.listeners.get(name).add(listener)
    return () => this.listeners.get(name).delete(listener)
  }

  inject(name, callback) {
    return callback()
  }
}

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

const storage = new Map()
const win = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
}
const doc = {
  head: { appendChild() {} },
  createElement() {
    return { dataset: {}, textContent: '', isConnected: true, remove() {} }
  },
  querySelector() {
    return null
  },
}

let captured
new Function('window', 'document', 'console', BUNDLE)(
  { ...win, __ModuleLoader__: { load: (mod) => { captured = mod } } },
  doc,
  console,
)
const api = captured.factory((spec) => {
  if (spec === 'react') return React
  if (spec === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('未准备模块：' + spec)
})

const slots = new FakeSlots()
const locale = {
  register: () => () => {},
  bind: () => (key, params) => {
    const dict = {
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
      'empty.all': '侧边栏里还没有可管理的功能项。',
    }
    const template = dict[key] ?? key
    return params === undefined ? template : template.replace(/\{(\w+)\}/g, (m, name) => String(params[name] ?? m))
  },
  subscribe: () => () => {},
  getSnapshot: () => ({ active: 'zh', revision: 1 }),
}
const ctx = { slots, locale, get: () => undefined, effect: (fn) => { const dispose = fn(); return dispose } }

api.apply(ctx)

// 三个导航面板 + 一个底部卡片 + 设置行
const glyph = () => null
slots.register({ name: 'sidebar.panellist', id: 'schedules', order: 10, label: () => '自动化任务' }, glyph)
slots.register({ name: 'sidebar.panellist', id: 'context', order: 20, label: () => '上下文洞察' }, glyph)
slots.register({ name: 'sidebar.panellist', id: 'skill-explorer', order: 30, label: () => '技能中心' }, glyph)
slots.register({ name: 'sidebar.footer.action', id: 'cost-meter', order: 0 }, glyph)
slots.register({ name: 'sidebar.settings', id: 'account', label: () => '账户' }, glyph)

// ---------------------------------------------------------------------------
// 断言
// ---------------------------------------------------------------------------

const rows = []

function renderEntry() {
  return renderToStaticMarkup(h(api.__internals.ManagerEntry, { wide: true }))
}

function it(name, body) {
  try {
    body()
    rows.push(['✓', name])
  } catch (error) {
    rows.push(['✗', name + '  →  ' + error.message])
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

it('入口行渲染：图标 + 名称 + 无角标（未隐藏任何项）', () => {
  const html = renderEntry()
  assert(html.includes('dsm-entry'), '缺少 dsm-entry 类名')
  assert(html.includes('侧边栏管理'), '缺少入口文案')
  assert(html.includes('aria-label="侧边栏管理"'), '缺少 aria-label')
  assert(!html.includes('dsm-entry-badge'), '未隐藏时不该出现角标')
})

it('关闭态不渲染面板', () => {
  const html = renderEntry()
  assert(!html.includes('mock-modal'), '面板不该在关闭态出现')
})

it('打开面板：标题、说明、分组、条目、开关、页脚统计齐全', () => {
  api.__internals.openManager()
  const html = renderEntry()
  assert(html.includes('自定义侧边栏'), '缺少标题')
  assert(html.includes('导航面板') && html.includes('底部区域') && html.includes('固定项'), '缺少分组标题')
  assert(html.includes('自动化任务') && html.includes('上下文洞察') && html.includes('技能中心'), '缺少导航条目')
  assert(html.includes('schedules') && html.includes('skill-explorer'), '缺少来源 id')
  assert(html.includes('role="switch"'), '缺少开关控件')
  assert(html.includes('全部显示中'), '缺少页脚状态文案')
  assert(html.includes('3/3'), '导航分组计数应为 3/3')
})

it('隐藏一项后：行变灰、统计更新、角标出现', () => {
  api.__internals.setHidden('panel:skill-explorer', true)
  const html = renderEntry()
  assert(html.includes('dsm-row--off'), '隐藏行应有 dsm-row--off')
  assert(html.includes('已隐藏 1 项'), '页脚统计应更新')
  assert(html.includes('2/3'), '分组计数应为 2/3')
  assert(html.includes('dsm-entry-badge'), '入口行应出现角标')
})

it('固定项渲染锁而非开关', () => {
  const html = renderEntry()
  assert(html.includes('设置与账户'), '缺少固定项')
  assert(html.includes('侧边栏的主要入口，始终显示'), '缺少锁定说明')
})

it('「全部显示」恢复后统计归零', () => {
  api.__internals.showAll()
  const html = renderEntry()
  assert(html.includes('全部显示中'), '应回到全部显示')
  assert(!html.includes('dsm-row--off'), '不该残留变灰的行')
})

let failed = 0
for (const [mark, name] of rows) {
  if (mark === '✗') failed += 1
  console.log(`${mark} ${name}`)
}
console.log('')
console.log(failed === 0 ? `✓ 渲染测试全部通过（${rows.length} 项）` : `✗ ${failed}/${rows.length} 项失败`)
if (failed > 0) process.exitCode = 1
