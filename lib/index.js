import { PERSONA_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { Config, SETTINGS_NAMESPACE, resolveConfig } from './config.js'
import { PromptPersonaWebBackend, installPromptPersonaWeb } from './web.js'

export const name = '@xilin3/dsh-prompt-persona'

/** 依赖的服务：settings（持久化）与 systemPrompt（注入）。 */
export const inject = ['settings', 'systemPrompt']

/**
 * 宿主插件入口。
 * 1. 注册 settings namespace（写入 settings.yaml，设置页可编辑）。
 * 2. 在 system-prompt/assemble waterfall 里把 persona 注入 deployment:persona。
 * 3. 挂一个同源 HTTP 路由给浏览器设置页（当前提示词 / 预览 / 保存）。
 */
export function apply(ctx, config = {}) {
  const settings = ctx.settings.register(SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => { resolveConfig(value) },
  })

  // 每次 prompt 组装后，把 settings 里的 persona 写进 deployment:persona。
  // untagged 的全局 listener 会被 scopeTarget 放行，覆盖所有 agent scope。
  const disposeAssembly = ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const assembled = await next()
    const { persona, mode } = resolveConfig(settings.get())
    if (mode === 'off' || persona.length === 0) return assembled
    for (const section of assembled.sections) {
      if (section.name !== PERSONA_SECTION) continue
      if (mode === 'replace') {
        section.text = persona
      } else {
        const current = typeof section.text === 'string' && section.text.length > 0 ? section.text : ''
        section.text = (current ? current + '\n\n' : '') + persona
      }
    }
    return assembled
  })

  const backend = new PromptPersonaWebBackend(ctx, settings)
  installPromptPersonaWeb(ctx, backend)

  return () => { disposeAssembly() }
}
