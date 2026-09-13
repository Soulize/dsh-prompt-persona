#!/usr/bin/env node
/**
 * 把插件运行时真正 `import` 的 DSH 包链接进本包自己的 node_modules。
 *
 * 宿主半身（lib/index.js / lib/web.js / lib/config.js）会 import：
 *   - @deepseek-ai/dsh-system-prompt  （PERSONA_PREFIX_SECTION / renderPrompt）
 *   - @deepseek-ai/schemastery        （settings namespace schema）
 * 这两个包由 DSH 宿主提供（peerDependencies），但 Node 的解析是从「本包目录」
 * 向上找 node_modules——profile 的 node_modules 里没有 @deepseek-ai/*，所以必须
 * 在本包内建链接（Windows 用 junction，免管理员权限）。
 *
 * 探测顺序：$DSH_CHECKOUT → npm 全局安装的 dsh 包内 node_modules/@deepseek-ai
 * → 常见路径。
 *
 * 用法：node scripts/link-deps.mjs
 */
import { existsSync, mkdirSync, rmSync, symlinkSync, lstatSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 需要链接的包（宿主运行时 import 的）。 */
const PACKAGES = ['@deepseek-ai/dsh-system-prompt', '@deepseek-ai/schemastery']

/** 找出 DSH checkout 里放 @deepseek-ai/* 的那个目录。 */
function findScopeDir() {
  const candidates = []
  const checkout = process.env.DSH_CHECKOUT
  if (checkout) {
    candidates.push(join(checkout, 'node_modules', '@deepseek-ai'))
    candidates.push(join(checkout, 'packages'))
    candidates.push(join(checkout, 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'))
  }
  const npmRoot = process.env.APPDATA
    ? join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai')
    : undefined
  if (npmRoot) candidates.push(npmRoot)
  candidates.push(
    join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai'),
    '/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
    '/usr/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai',
  )
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'dsh-system-prompt', 'package.json'))) return candidate
  }
  return undefined
}

const scopeDir = findScopeDir()
if (scopeDir === undefined) {
  console.error('[link-deps] 找不到 DSH checkout（可设 DSH_CHECKOUT 环境变量指向 deepseek-harness 根目录）')
  process.exit(1)
}

const targetRoot = join(PKG_ROOT, 'node_modules', '@deepseek-ai')
mkdirSync(targetRoot, { recursive: true })

let linked = 0
for (const name of PACKAGES) {
  const source = join(scopeDir, name.slice('@deepseek-ai/'.length))
  if (!existsSync(join(source, 'package.json'))) {
    console.error(`[link-deps] 跳过 ${name}：源不存在 ${source}`)
    continue
  }
  const link = join(targetRoot, name.slice('@deepseek-ai/'.length))
  if (existsSync(link)) {
    try {
      if (realpathSync(link) === realpathSync(source)) { linked += 1; continue }
    } catch {}
    rmSync(link, { recursive: true, force: true })
  }
  symlinkSync(source, link, process.platform === 'win32' ? 'junction' : 'dir')
  linked += 1
}

console.log(`[link-deps] ${scopeDir} → ${PKG_ROOT}/node_modules（${linked}/${PACKAGES.length} 已链接）`)
