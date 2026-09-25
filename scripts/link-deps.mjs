#!/usr/bin/env node
/**
 * 把插件 host 半身真正 `import` 的 DSH 包准备到本包自己的 node_modules。
 *
 * host 半身（lib/index.js / lib/web.js / lib/config.js）会 import：
 *   - @deepseek-ai/dsh-system-prompt  （PERSONA_PREFIX_SECTION / renderPrompt）
 *   - @deepseek-ai/schemastery        （本条目 Config；**必须支持 .volatile()**）
 *   - @deepseek-ai/cosmokit           （isVolatile()，读 volatile 引用）
 *
 * 这些包由 DSH 宿主提供（peerDependencies）。Node 的解析是从「本包目录」向上
 * 找 node_modules，而 profile 的 node_modules 里通常没有 @deepseek-ai/*，所以
 * 必须在本包内建链接/落盘（Windows 用 junction，免管理员权限）。
 *
 * ## 为什么还要校验版本
 *
 * DSH 0.1.7 的 settings 只投影插件 Config 里的 `.volatile()` 字段，而
 * `.volatile()` 是 schemastery 3.18.4 才有的 API（@deepseek-ai/dsh-settings
 * 0.1.7-rc.2 的 peerDependencies 明确要求 `schemastery ~3.18.4`）。如果顺手链到
 * 旧版 dsh CLI 自带的 schemastery 3.18.2，插件会在 import 期直接抛
 * `...volatile is not a function`，或者设置页整个不出现——所以这里逐个校验，
 * 不合格就换下一个来源，而不是静默链上。
 *
 * ## 来源顺序
 *
 *   1. `--asar <path>` / `$DSH_DESKTOP_ASAR`：DSH Desktop 的 app.asar
 *      （桌面版把宿主包放在 `dsh/node_modules/@deepseek-ai/*`，这里按需解出来）
 *   2. `$DSH_CHECKOUT`：deepseek-harness 源码 checkout
 *   3. Windows 桌面版安装目录（注册表 / Program Files / %LOCALAPPDATA%\Programs）
 *   4. npm 全局安装的 dsh（`npm i -g @deepseek-ai/dsh`）
 *   5. profile 自己的 node_modules（`~/.dsh/profiles/node_modules`）
 *
 * 用法：
 *   node scripts/link-deps.mjs
 *   node scripts/link-deps.mjs --asar "D:\\Deepseekharness\\resources\\app.asar"
 *   DSH_CHECKOUT=/path/to/deepseek-harness node scripts/link-deps.mjs
 */
import fs from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@deepseek-ai'
const TARGET_ROOT = join(PKG_ROOT, 'node_modules', SCOPE)

/** 需要就绪的包，以及各自的「这份拷贝可用吗」探针（对 lib/ 下的产物源码判断）。 */
const PACKAGES = [
  { name: 'dsh-system-prompt', probe: (text) => text.includes('PERSONA_PREFIX_SECTION'), why: '提示词 section 名与 renderPrompt' },
  { name: 'schemastery', probe: (text) => /prototype\.volatile\s*=/.test(text), why: 'Config 的 .volatile()（0.1.7 settings 必需）' },
  { name: 'cosmokit', probe: (text) => text.includes('isVolatile'), why: 'isVolatile() 读 volatile 引用' },
]

/* ------------------------------------------------------------------ 小工具 */

function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function readIfFile(path, max = 8 * 1024 * 1024) {
  try {
    const stat = fs.statSync(path)
    if (!stat.isFile() || stat.size > max) return ''
    return fs.readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** 把一个包 lib/ 下的构建产物拼成一份文本，用于能力探针。 */
function libText(dir) {
  const lib = join(dir, 'lib')
  let text = ''
  const walk = (current, depth) => {
    if (depth > 3 || text.length > 4 * 1024 * 1024) return
    for (const entry of safeReaddir(current)) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (/\.(mjs|cjs|js)$/.test(entry.name)) text += readIfFile(path)
    }
  }
  walk(lib, 0)
  return text
}

function versionOf(dir) {
  const raw = readIfFile(join(dir, 'package.json'))
  if (raw === '') return undefined
  try {
    return JSON.parse(raw).version
  } catch {
    return undefined
  }
}

/** 探针结果：{ ok, version, reason }。 */
function inspect(scopeDir, spec) {
  const dir = join(scopeDir, spec.name)
  if (!fs.existsSync(join(dir, 'package.json'))) {
    return { ok: false, version: undefined, reason: '不存在' }
  }
  const version = versionOf(dir)
  if (!spec.probe(libText(dir))) {
    return { ok: false, version, reason: `缺少所需 API（${spec.why}）` }
  }
  return { ok: true, version, reason: '' }
}

/* --------------------------------------------------------------- asar 读取 */

/**
 * 读取 asar 的目录索引。
 *
 * 布局：[4B 4][4B header pickle 大小][4B …][4B JSON 长度][JSON][… 数据]
 * 数据区从 `8 + header pickle 大小` 开始（4 字节对齐）。
 * @param asarPath - app.asar 路径。
 * @returns `{ dataOffset, files }`，`files` 是 `路径 -> { size, offset }`。
 */
function readAsarIndex(asarPath) {
  const fd = fs.openSync(asarPath, 'r')
  try {
    const head = Buffer.alloc(16)
    fs.readSync(fd, head, 0, 16, 0)
    const slug = head.toString('latin1', 0, 4)
    if (slug !== 'b3' && head.readUInt32LE(0) !== 4) throw new Error('不是 asar 文件')
    const jsonLength = head.readUInt32LE(12)
    if (jsonLength <= 0 || jsonLength > 64 * 1024 * 1024) throw new Error('asar 头部长度异常')
    const jsonBuf = Buffer.alloc(jsonLength)
    fs.readSync(fd, jsonBuf, 0, jsonLength, 16)
    const header = JSON.parse(jsonBuf.toString('utf8'))
    const dataOffset = 8 + head.readUInt32LE(4)
    const files = new Map()
    const walk = (node, prefix) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const path = prefix === '' ? name : `${prefix}/${name}`
        if (entry.files) walk(entry, path)
        else if (entry.offset !== undefined) files.set(path, { size: entry.size ?? 0, offset: Number(entry.offset) })
      }
    }
    walk(header, '')
    return { dataOffset, files, fd }
  } catch (error) {
    fs.closeSync(fd)
    throw error
  }
}

/** 把 asar 里的 `dsh/node_modules/@deepseek-ai/<name>` 落到目标目录。 */
function materializeFromAsar(asarPath, name) {
  const index = readAsarIndex(asarPath)
  try {
    const prefix = `dsh/node_modules/${SCOPE}/${name}/`
    const matches = [...index.files].filter(([path]) => path.startsWith(prefix))
    if (matches.length === 0) return { ok: false, reason: `asar 里没有 ${prefix}` }
    const target = join(TARGET_ROOT, name)
    fs.rmSync(target, { recursive: true, force: true })
    for (const [path, meta] of matches) {
      const dest = join(target, ...path.slice(prefix.length).split('/'))
      fs.mkdirSync(dirname(dest), { recursive: true })
      const buf = Buffer.alloc(meta.size)
      fs.readSync(index.fd, buf, 0, meta.size, index.dataOffset + meta.offset)
      fs.writeFileSync(dest, buf)
    }
    return { ok: true, files: matches.length }
  } finally {
    fs.closeSync(index.fd)
  }
}

/* --------------------------------------------------------------- 来源发现 */

function checkoutScopeDirs() {
  const checkout = process.env.DSH_CHECKOUT
  if (!checkout) return []
  return [
    join(checkout, 'node_modules', SCOPE),
    join(checkout, 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE),
    join(checkout, 'packages'),
  ]
}

function npmScopeDirs() {
  const dirs = []
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm', 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE))
  dirs.push(
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE),
    join(homedir(), '.npm-global', 'lib', 'node_modules', SCOPE, 'dsh', 'node_modules', SCOPE),
    '/usr/local/lib/node_modules/' + SCOPE + '/dsh/node_modules/' + SCOPE,
    '/usr/lib/node_modules/' + SCOPE + '/dsh/node_modules/' + SCOPE,
  )
  return dirs
}

function profileScopeDirs() {
  return [
    join(homedir(), '.dsh', 'profiles', 'node_modules', SCOPE),
    join(homedir(), '.dsh', 'node_modules', SCOPE),
  ]
}

/** Windows 桌面版安装目录（注册表 → 常见安装根目录）。 */
function desktopInstallDirs() {
  const dirs = []
  if (process.env.LOCALAPPDATA) dirs.push(join(process.env.LOCALAPPDATA, 'Programs'))
  for (const key of ['PROGRAMFILES', 'PROGRAMFILES(X86)', 'ProgramW6432']) {
    if (process.env[key]) dirs.push(process.env[key])
  }
  if (process.platform === 'win32') {
    const keys = [
      'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    ]
    for (const key of keys) {
      let out = ''
      try {
        out = execFileSync('reg', ['query', key, '/s', '/v', 'InstallLocation'], { encoding: 'utf8', timeout: 5000 })
      } catch {
        continue
      }
      for (const line of out.split(/\r?\n/)) {
        const match = /InstallLocation\s+REG_[A-Z_]+\s+(.+)$/.exec(line.trim())
        if (match && /dsh|deepseek|harness/i.test(match[1])) dirs.push(match[1].trim())
      }
    }
  }
  return dirs
}

/** 在若干安装根目录下找 resources/app.asar（深度 2 以内）。 */
function asarCandidates(explicit) {
  const found = []
  const push = (path) => {
    if (path && fs.existsSync(path) && !found.includes(path)) found.push(path)
  }
  push(explicit)
  push(process.env.DSH_DESKTOP_ASAR)
  for (const root of desktopInstallDirs()) {
    push(join(root, 'resources', 'app.asar'))
    for (const app of safeReaddir(root)) {
      if (!app.isDirectory()) continue
      push(join(root, app.name, 'resources', 'app.asar'))
      for (const inner of safeReaddir(join(root, app.name))) {
        if (!inner.isDirectory()) continue
        push(join(root, app.name, inner.name, 'resources', 'app.asar'))
      }
    }
  }
  return found.filter((asarPath) => {
    try {
      const index = readAsarIndex(asarPath)
      fs.closeSync(index.fd)
      return index.files.has(`dsh/node_modules/${SCOPE}/dsh-system-prompt/package.json`)
    } catch {
      return false
    }
  })
}

/* ------------------------------------------------------------------- 主流程 */

function parseArgs(argv) {
  const args = { asar: undefined, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--asar') args.asar = argv[++i]
    else if (argv[i] === '--help' || argv[i] === '-h') args.help = true
  }
  return args
}

function link(from, to) {
  fs.mkdirSync(dirname(to), { recursive: true })
  if (fs.existsSync(to)) {
    try {
      if (fs.realpathSync(to) === fs.realpathSync(from)) return 'kept'
    } catch {
      // 落盘拷贝（不是链接）时 realpath 不相等：删掉重建。
    }
    fs.rmSync(to, { recursive: true, force: true })
  }
  fs.symlinkSync(from, to, process.platform === 'win32' ? 'junction' : 'dir')
  return 'linked'
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(readIfFile(fileURLToPath(import.meta.url)).split('\n').slice(0, 45).join('\n'))
    return
  }

  const scopes = [...checkoutScopeDirs(), ...npmScopeDirs(), ...profileScopeDirs()]
  const report = []

  // 1) 选一个「必备包尽量齐」的来源目录。
  let scopeDir
  let bestScore = -1
  for (const candidate of scopes) {
    let score = 0
    for (const spec of PACKAGES) if (inspect(candidate, spec).ok) score += 1
    if (score > bestScore) {
      bestScore = score
      scopeDir = candidate
    }
  }

  // 2) 从选中的来源链接；不合格的包改从 app.asar 落盘。
  let asar
  for (const spec of PACKAGES) {
    const target = join(TARGET_ROOT, spec.name)
    const fromScope = scopeDir === undefined ? { ok: false, reason: '没有可用的来源目录' } : inspect(scopeDir, spec)
    if (fromScope.ok) {
      const action = link(join(scopeDir, spec.name), target)
      report.push({ name: spec.name, source: scopeDir, version: fromScope.version, action })
      continue
    }

    if (asar === undefined) asar = asarCandidates(args.asar)[0]
    if (asar !== undefined) {
      const result = materializeFromAsar(asar, spec.name)
      const after = inspect(TARGET_ROOT, spec)
      if (result.ok && after.ok) {
        report.push({ name: spec.name, source: `${asar} (解出 ${result.files} 个文件)`, version: after.version, action: 'extracted' })
        continue
      }
    }

    report.push({
      name: spec.name,
      source: scopeDir ?? '(无)',
      version: fromScope.version,
      action: `失败：${fromScope.reason}`,
    })
  }

  // 3) 汇总 + 真实 import 验证（只验最关键的一步：schemastery 的 volatile）。
  let volatileOk = false
  try {
    const z = (await import(`file://${join(TARGET_ROOT, 'schemastery', 'lib', 'index.mjs').replaceAll('\\', '/')}`)).default
    volatileOk = typeof z?.string?.().volatile === 'function'
  } catch (error) {
    report.push({ name: 'verify', source: '-', version: '-', action: `import 失败：${error.message}` })
  }

  console.log('[link-deps] 依赖来源与结果')
  for (const row of report) {
    console.log(`  ${row.name.padEnd(20)} ${String(row.version ?? '-').padEnd(12)} ${row.action}  <- ${row.source}`)
  }
  console.log(`[link-deps] schemastery volatile 验证：${volatileOk ? '通过' : '未通过'}`)

  const failed = report.filter((row) => row.action.startsWith('失败'))
  if (failed.length > 0 || !volatileOk) {
    console.error(
      [
        '',
        '[link-deps] 无法为当前 DSH 版本准备依赖。DSH 0.1.7 起插件 Config 必须用',
        '           `.volatile()`，它由 schemastery >= 3.18.4 提供。请任选一种方式：',
        '',
        '  1. 指向桌面版安装内的 app.asar：',
        '       node scripts/link-deps.mjs --asar "<安装目录>\\resources\\app.asar"',
        '     或设 DSH_DESKTOP_ASAR 环境变量。',
        '  2. 安装与宿主同版本的 CLI，再重跑：',
        '       npm i -g @deepseek-ai/dsh@0.1.7-rc.2 && node scripts/link-deps.mjs',
        '  3. 指向 deepseek-harness 源码 checkout：',
        '       DSH_CHECKOUT=/path/to/deepseek-harness node scripts/link-deps.mjs',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
}

await main()
