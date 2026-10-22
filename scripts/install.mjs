#!/usr/bin/env node
/**
 * dsh-sidebar-manager —— 安装 / 卸载脚本。
 *
 * 安装 = 做两件事（与 `dsh plugin add file:` 等价）：
 *  1. 用 **DSH 自带的 pnpm** 把本目录以 `link:` 依赖装进 profile
 *     → 生成 `<profile>/node_modules/dsh-sidebar-manager` 符号链接（改完 build 重启即生效）
 *     → 写进 `dependencies` 与 `pnpm-lock.yaml`（声明式依赖，后续 pnpm 操作不会当“多余目录”清掉）
 *  2. 把 `dsh-sidebar-manager` 追加进 `dsh.profile.bundles`（改之前备份 package.json / pnpm-lock.yaml）
 *
 * 找不到自带 pnpm 时退化为「junction + 只改 bundles」：能跑，但后续 pnpm 操作可能清掉它。
 *
 * 默认 **dry-run**：只打印将要做什么。加 `--yes` 才执行。
 *
 * 用法：
 *   node scripts/install.mjs                      # 预览
 *   node scripts/install.mjs --yes                # 安装到 desktop profile
 *   node scripts/install.mjs --profile web --yes  # 指定 profile
 *   node scripts/install.mjs --uninstall --yes    # 卸载
 */

import { cp, copyFile, lstat, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(await readFile(join(PLUGIN_DIR, 'package.json'), 'utf8'))
const PLUGIN_NAME = PKG.name

/** 退化安装（没有 pnpm 时）要带进 profile 的文件/目录。 */
const SHIP = ['lib', 'package.json', 'cordis.patch.yml', 'README.md']

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)

/**
 * 读一个 `--key value` 形式的参数。
 * @param {string} key - 参数名（含 --）。
 * @param {string} fallback - 默认值。
 * @returns {string} 值。
 */
function option(key, fallback) {
  const index = argv.indexOf(key)
  if (index < 0) return fallback
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? fallback : value
}

const apply = argv.includes('--yes')
const uninstall = argv.includes('--uninstall')
const force = argv.includes('--force')
const profileName = option('--profile', 'desktop')
const dshHome = process.env.DSH_HOME !== undefined && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const profileDir = join(dshHome, 'profiles', profileName)
const profilePkgPath = join(profileDir, 'package.json')
const target = join(profileDir, 'node_modules', PLUGIN_NAME)

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/**
 * 打印一步操作（dry-run 时加前缀）。
 * @param {string} text - 描述。
 * @returns {void}
 */
function step(text) {
  console.log(`  ${apply ? '·' : '[预览]'} ${text}`)
}

/**
 * 找 DSH 自带的运行时（node + pnpm）。
 * @returns {{ node: string, pnpm: string }|null} 路径，找不到为 null。
 */
function findRuntime() {
  const runtimesDir = join(dshHome, 'dsh-runtimes')
  if (!existsSync(runtimesDir)) return null
  let names = []
  try {
    names = readdirSync(runtimesDir)
  } catch {
    return null
  }
  for (const name of names) {
    const deps = join(runtimesDir, name, 'dependencies')
    const node = join(deps, 'node', 'bin', 'node.exe')
    const pnpm = join(deps, 'pnpm', 'bin', 'pnpm.cjs')
    if (existsSync(node) && existsSync(pnpm)) return { node, pnpm }
  }
  return null
}

/**
 * 在 profile 目录里跑一次 pnpm（输出直接透传）。
 * @param {{ node: string, pnpm: string }} runtime - 运行时。
 * @param {string[]} args - pnpm 参数。
 * @returns {boolean} 是否成功。
 */
function runPnpm(runtime, args) {
  console.log(`  $ pnpm ${args.join(' ')}`)
  const result = spawnSync(runtime.node, [runtime.pnpm, ...args], {
    cwd: profileDir,
    stdio: 'inherit',
    windowsHide: true,
  })
  return result.status === 0
}

/**
 * 安全删除一个落地项：符号链接只删链接本身，绝不递归删到源目录。
 * @param {string} path - 目标路径。
 * @returns {Promise<void>}
 */
async function removeEntry(path) {
  try {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      await unlink(path)
      return
    }
    await rm(path, { recursive: true, force: true })
  } catch {
    /* 不存在就算了 */
  }
}

/**
 * 读 profile 的 package.json。
 * @returns {Promise<object>} 内容。
 */
async function readProfilePackage() {
  return JSON.parse(await readFile(profilePkgPath, 'utf8'))
}

/**
 * 备份 profile 的 package.json / pnpm-lock.yaml（各留一份，不覆盖已有备份）。
 * @returns {Promise<void>}
 */
async function backupProfile() {
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const from = join(profileDir, name)
    const to = from + '.bak'
    if (!existsSync(from) || existsSync(to)) continue
    step(`备份 ${name} → ${basename(to)}`)
    if (apply) await copyFile(from, to)
  }
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

/**
 * 安装。
 * @returns {Promise<void>}
 */
async function install() {
  if (!existsSync(profileDir)) {
    console.error(`✗ 找不到 profile 目录：${profileDir}`)
    console.error('  用 --profile 指定正确的 profile（常见：desktop / web）')
    process.exitCode = 1
    return
  }

  console.log(`插件：${PLUGIN_NAME}@${PKG.version}`)
  console.log(`来源：${PLUGIN_DIR}`)
  console.log(`目标：${profileDir}`)
  console.log('')

  const runtime = findRuntime()
  await backupProfile()

  // 1) 装进 node_modules
  if (runtime !== null) {
    if (apply) {
      const ok = runPnpm(runtime, ['add', `link:${PLUGIN_DIR}`, '--reporter=append-only'])
      if (!ok) {
        console.error('✗ pnpm add 失败：未改动 bundles，profile 保持原样。')
        console.error(`  可改用 --force 走手工联接：node scripts/install.mjs --profile ${profileName} --yes --force`)
        process.exitCode = 1
        return
      }
      step(`已以 link: 依赖装入 profile（node_modules 里是指向本目录的链接）`)
    } else {
      step(`pnpm add "link:${PLUGIN_DIR}"  → 写 dependencies / pnpm-lock.yaml / node_modules 链接`)
    }
  } else {
    step('没找到 DSH 自带的 pnpm，改用手工联接（后续 pnpm 操作可能清掉它，到时重跑本脚本）')
    const existing = existsSync(target) ? await lstat(target) : null
    if (existing !== null && !existing.isSymbolicLink() && !force) {
      console.error(`✗ 目标位置已有同名目录且不是链接：${target}（确认要覆盖请加 --force）`)
      process.exitCode = 1
      return
    }
    if (apply) {
      await removeEntry(target)
      await mkdir(dirname(target), { recursive: true })
      try {
        await symlink(PLUGIN_DIR, target, 'junction')
        step(`建 junction：${target} → ${PLUGIN_DIR}`)
      } catch {
        await mkdir(target, { recursive: true })
        for (const name of SHIP) {
          await cp(join(PLUGIN_DIR, name), join(target, name), { recursive: true }).catch(function ignore() {})
        }
        step(`junction 不可用，已复制 ${SHIP.join(' / ')}`)
      }
    } else {
      step(`建 junction：${target} → ${PLUGIN_DIR}`)
    }
  }

  // 2) 登记到 dsh.profile.bundles（pnpm 可能刚重写过 package.json，这里重新读）
  const profilePkg = await readProfilePackage()
  profilePkg.dsh = profilePkg.dsh ?? {}
  profilePkg.dsh.profile = profilePkg.dsh.profile ?? {}
  const bundles = Array.isArray(profilePkg.dsh.profile.bundles) ? profilePkg.dsh.profile.bundles : []
  if (bundles.includes(PLUGIN_NAME)) {
    step(`dsh.profile.bundles 已包含 ${PLUGIN_NAME}，跳过`)
  } else {
    bundles.push(PLUGIN_NAME)
    profilePkg.dsh.profile.bundles = bundles
    if (apply) await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
    step(`dsh.profile.bundles += "${PLUGIN_NAME}"（共 ${bundles.length} 项）`)
  }

  console.log('')
  if (apply) {
    console.log('✓ 安装完成，重启 DSH NEXT 生效。')
    console.log('  侧边栏底部「设置与账户」上方会出现「⚙ 侧边栏管理」。')
  } else {
    console.log('以上为预览。确认无误后加 --yes 执行：')
    console.log(`  node scripts/install.mjs --profile ${profileName} --yes`)
  }
}

/**
 * 卸载。
 * @returns {Promise<void>}
 */
async function uninstallFlow() {
  if (!existsSync(profileDir)) {
    console.error(`✗ 找不到 profile 目录：${profileDir}`)
    process.exitCode = 1
    return
  }
  console.log(`卸载：${PLUGIN_NAME}`)
  console.log(`目标：${profileDir}`)
  console.log('')

  await backupProfile()

  const runtime = findRuntime()
  if (runtime !== null) {
    if (apply) runPnpm(runtime, ['remove', PLUGIN_NAME, '--reporter=append-only'])
    else step(`pnpm remove ${PLUGIN_NAME}`)
  }
  if (apply) {
    await removeEntry(target)
    step(`清理 ${target}`)
  } else if (!existsSync(target)) {
    step('node_modules 里没有该插件')
  }

  const profilePkg = await readProfilePackage()
  const bundles = profilePkg.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(PLUGIN_NAME)) {
    profilePkg.dsh.profile.bundles = bundles.filter((name) => name !== PLUGIN_NAME)
    if (apply) await writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n', 'utf8')
    step(`dsh.profile.bundles -= "${PLUGIN_NAME}"`)
  } else {
    step('dsh.profile.bundles 里没有该项，跳过')
  }

  console.log('')
  console.log(apply ? '✓ 卸载完成，重启 DSH NEXT 生效。' : '以上为预览。确认后加 --yes 执行。')
}

if (uninstall) await uninstallFlow()
else await install()
