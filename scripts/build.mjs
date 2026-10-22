#!/usr/bin/env node
/**
 * dsh-sidebar-manager —— 零依赖构建脚本。
 *
 * 做三件事：
 *  1. `src/client.js`（CJS 模块体）→ 包上 `window.__ModuleLoader__.load({ id, factory })`
 *     外壳 → `lib/client.js`（dsh 浏览器端只认这个形状，且必须是单文件）；
 *  2. `src/index.js` → `lib/index.js`（宿主端 ESM 入口，原样复制）；
 *  3. 产物自检：单文件、无动态 import、require 只落在平台模块表白名单内。
 *
 * 用法：node scripts/build.mjs
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIB = join(ROOT, 'lib')

/** dsh web 外壳注入的平台模块表（见 @deepseek-ai/dsh-web-frontend 的模块表）。 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

/**
 * 检查客户端源码里不允许出现的东西。
 * @param {string} code - 源码。
 * @returns {string[]} 问题列表。
 */
function inspectClientSource(code) {
  const problems = []
  if (/\bimport\s*\(/.test(code)) problems.push('源码里出现了动态 import()（浏览器端禁止）')
  if (/\bfrom\s+['"]node:/.test(code)) problems.push('源码里 import 了 node: 内置模块')
  for (const match of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = match[1]
    if (spec.startsWith('.')) {
      problems.push(`出现了相对路径 require(${spec})：浏览器端产物必须单文件`)
      continue
    }
    if (!PLATFORM_MODULES.includes(spec)) problems.push(`require(${spec}) 不在平台模块表白名单内`)
  }
  return problems
}

/**
 * 检查打包后的客户端产物。
 * @param {string} code - 产物代码。
 * @param {string} pluginId - 期望的模块 id。
 * @returns {string[]} 问题列表。
 */
function inspectBundle(code, pluginId) {
  const problems = []
  if (!code.startsWith('window.__ModuleLoader__.load({')) problems.push('产物缺少 __ModuleLoader__ 外壳')
  if (!code.includes(`id: ${JSON.stringify(pluginId)}`)) problems.push('产物的模块 id 与包名不一致')
  if (!code.trimEnd().endsWith('});')) problems.push('产物外壳没有正常闭合')
  if (/\bimport\s*\(/.test(code)) problems.push('产物里出现了动态 import()')
  for (const match of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!PLATFORM_MODULES.includes(match[1])) problems.push(`产物 require(${match[1]}) 不在白名单内`)
  }
  return problems
}

/**
 * 构建。
 * @returns {Promise<void>}
 */
async function main() {
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  const pluginId = pkg.name

  const clientSource = await readFile(join(ROOT, 'src', 'client.js'), 'utf8')
  const sourceProblems = inspectClientSource(clientSource)
  if (sourceProblems.length > 0) {
    console.error('✗ 源码自检失败：')
    for (const problem of sourceProblems) console.error('  - ' + problem)
    process.exitCode = 1
    return
  }

  const banner = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(pluginId)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
    '',
  ].join('\n')
  const footer = ['', '\t\treturn module.exports;', '\t}', '});', ''].join('\n')
  const bundle = banner + clientSource + footer

  const bundleProblems = inspectBundle(bundle, pluginId)
  if (bundleProblems.length > 0) {
    console.error('✗ 产物自检失败：')
    for (const problem of bundleProblems) console.error('  - ' + problem)
    process.exitCode = 1
    return
  }

  await rm(LIB, { recursive: true, force: true })
  await mkdir(LIB, { recursive: true })
  await writeFile(join(LIB, 'client.js'), bundle, 'utf8')
  await writeFile(join(LIB, 'index.js'), await readFile(join(ROOT, 'src', 'index.js'), 'utf8'), 'utf8')

  const files = await readdir(LIB)
  const expected = ['client.js', 'index.js']
  const extra = files.filter((file) => !expected.includes(file))
  if (extra.length > 0) {
    console.error('✗ lib/ 里出现了预期外的文件（浏览器端必须单文件）：' + extra.join(', '))
    process.exitCode = 1
    return
  }

  console.log(`✓ ${pluginId} 构建完成（零依赖，无 npm install）`)
  console.log(`  lib/client.js  ${(Buffer.byteLength(bundle) / 1024).toFixed(1)} KB（含 ModuleLoader 外壳）`)
  console.log(`  lib/index.js   宿主端空实现`)
  console.log('  自检：单文件 ✓  无动态 import ✓  require 白名单 ✓')
}

await main()
