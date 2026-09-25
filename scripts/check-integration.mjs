#!/usr/bin/env node
/**
 * 集成自检（可选）：把本插件挂进**真实的 DSH 提示词注册表**跑一遍。
 *
 * `check-adaptation.mjs` 用假 ctx 验证插件自己的逻辑；本脚本更进一步，用真实的
 * `@deepseek-ai/cordis` + `@deepseek-ai/dsh-system-prompt` 起一个最小 app，验证：
 *   1. `replace` 注入真的能改到 `deployment:persona-prefix`（真实 waterfall）
 *   2. **volatile 就地更新**：只改 volatile 字段时 cordis-plugin-loader 不重挂插件，
 *      而是 `updateVolatile()` 写进同一个引用 —— 插件必须每次现读 `config.x.get()`
 *   3. 遮蔽守卫：别的 scope 改写了该 section 时插件放手
 *   4. `off` / `append` 语义
 *
 * 需要能读到 DSH 宿主的包目录：
 *   DSH_HARNESS_PACKAGES=/path/to/node_modules/@deepseek-ai node scripts/check-integration.mjs
 * 未设置（或目录不可用）时打印一句说明后退出 0，不阻塞 CI。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 找 DSH 的 @deepseek-ai 目录：显式环境变量优先，其次本插件已链接的 node_modules。 */
function scopeDir() {
  const explicit = process.env.DSH_HARNESS_PACKAGES
  if (explicit && fs.existsSync(join(explicit, 'cordis', 'package.json'))) return explicit
  const linked = join(PKG_ROOT, 'node_modules', '@deepseek-ai')
  if (fs.existsSync(join(linked, 'dsh-system-prompt', 'package.json'))) return linked
  return undefined
}

const scope = scopeDir()
const required = ['cordis', 'dsh-system-prompt', 'cosmokit']
const missing = scope === undefined ? required : required.filter((name) => !fs.existsSync(join(scope, name, 'package.json')))

if (scope === undefined || missing.length > 0) {
  console.log('[check-integration] 跳过：需要真实的 DSH 包目录（缺 %s）。', missing.join(', ') || 'DSH_HARNESS_PACKAGES')
  console.log('[check-integration] 设 DSH_HARNESS_PACKAGES=<...>/node_modules/@deepseek-ai 后重跑。')
  process.exit(0)
}

const url = (specifier) => pathToFileURL(join(scope, specifier)).href
const { Context, Service } = await import(url('cordis/lib/index.js'))
const { createVolatile, updateVolatile } = await import(url('cosmokit/lib/index.js'))
const { default: SystemPrompt, PERSONA_PREFIX_SECTION } = await import(url('dsh-system-prompt/lib/index.js'))
const plugin = await import(pathToFileURL(join(PKG_ROOT, 'lib', 'index.js')).href)

const personaOf = (assembly) => assembly.sections.find((s) => s.name === PERSONA_PREFIX_SECTION).text
const withPersona = (assembly, text) => ({
  ...assembly,
  sections: assembly.sections.map((s) => (s.name === PERSONA_PREFIX_SECTION ? { ...s, text } : s)),
})

const DEPLOY = 'DEPLOY-PERSONA'

/** 真实宿主里必然存在的 loader 服务（插件本身也是它加载的）；只回答注册表那条 entry 的配置。 */
class FakeLoader extends Service {
  constructor(ctx) {
    super(ctx, 'loader')
  }
  entries() {
    return [{ options: { name: '@deepseek-ai/dsh-system-prompt', config: { personaPrefix: DEPLOY } } }]
  }
}

/** 起一个只装了 loader + 提示词注册表（+ 可选插件）的最小 app。 */
async function makeApp(config) {
  const app = new Context()
  await app.plugin(FakeLoader).await()
  await app.plugin(SystemPrompt, { personaPrefix: DEPLOY }).await()
  const fiber = config === undefined ? undefined : app.plugin(plugin, config)
  if (fiber !== undefined) await fiber.await()
  return { app, fiber }
}

let passed = 0
function ok(name) {
  passed += 1
  console.log(`  ok   ${name}`)
}

console.log('prompt-persona · 真实 DSH 提示词注册表集成自检')
console.log(`  使用包目录：${scope}\n`)

const { app } = await makeApp()
const before = await app.systemPrompt.assemble()
assert.equal(personaOf(before), DEPLOY, '基线应是部署原文')
assert.ok(before.sections.some((s) => s.name === 'harness:identity'), '注册表应带上 harness:identity')
ok('真实注册表装配出 deployment:persona-prefix / -suffix / harness:identity')

assert.equal(plugin.deploymentPersonaPrefix(app), DEPLOY, '遮蔽守卫应能读到部署原文')
ok("deploymentPersonaPrefix(ctx) 读到部署层原文")

const replaceFiber = app.plugin(plugin, { persona: 'CUSTOM-PERSONA', mode: 'replace' })
await replaceFiber.await()
const after = await app.systemPrompt.assemble()
assert.equal(personaOf(after), 'CUSTOM-PERSONA')
assert.deepEqual(after.sections.map((s) => s.name), before.sections.map((s) => s.name), 'section 顺序不变')
ok('replace：真实 waterfall 下改写 deployment:persona-prefix')

updateVolatile(replaceFiber.config.persona, createVolatile('LIVE-UPDATED'))
assert.equal(personaOf(await app.systemPrompt.assemble()), 'LIVE-UPDATED')
ok('volatile 就地更新：不重挂插件也能读到新值（必须是引用现读）')

const offListener = app.on('system-prompt/assemble', async (assembly, _context, next) => withPersona(await next(), 'PRESET-PERSONA'))
const guarded = await app.systemPrompt.assemble()
offListener()
assert.equal(personaOf(guarded), 'PRESET-PERSONA')
ok('遮蔽守卫：别的 scope 改写了该 section 时放手')

const offApp = await makeApp({ persona: 'IGNORED', mode: 'off' })
assert.equal(personaOf(await offApp.app.systemPrompt.assemble()), DEPLOY)
ok('mode=off：保留部署原文')

const appendApp = await makeApp({ persona: 'TAIL', mode: 'append' })
assert.equal(personaOf(await appendApp.app.systemPrompt.assemble()), `${DEPLOY}\n\nTAIL`)
ok('mode=append：追加到部署原文之后')

console.log(`\n${passed} 通过`)
