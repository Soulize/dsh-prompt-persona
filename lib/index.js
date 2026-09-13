import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { Config, SETTINGS_NAMESPACE, resolveConfig } from './config.js'
import { PromptPersonaWebBackend, installPromptPersonaWeb } from './web.js'

export const name = '@xilin3/dsh-prompt-persona'

/** 依赖的服务：settings（持久化）与 systemPrompt（注入）。 */
export const inject = ['settings', 'systemPrompt']

/** 提示词注册表自己的 loader entry 名（部署 persona 的配置来源）。 */
const SYSTEM_PROMPT_ENTRY = '@deepseek-ai/dsh-system-prompt'

/**
 * 读取「部署层」自己的 persona-prefix 文本。
 *
 * 提示词注册表把 `deployment:persona-prefix` 注册为全局 section，文本取自它
 * 自己的 composition config（`personaPrefix`）。agent preset / 子 agent 会用
 * 同名 section 在自己的 scope 里**遮蔽**它——拿到这段原文，才能区分
 * 「这段 persona 是部署层的」还是「这段 persona 是别人的」。
 *
 * @returns 部署层 prefix 文本；找不到注册表 entry 时返回 `undefined`（表示无法判定）。
 */
export function deploymentPersonaPrefix(ctx) {
  try {
    for (const entry of ctx.loader.entries()) {
      if (entry?.options?.name !== SYSTEM_PROMPT_ENTRY) continue
      const configured = entry.options.config?.personaPrefix
      return typeof configured === 'string' ? configured : ''
    }
  } catch {
    // loader 不可用（或 entry 形态变化）时退化为「不判定」，功能不因此失效。
  }
  return undefined
}

/**
 * 把一份已解析配置作用到 section 列表上。
 * @param sections - 原件（不被修改）。
 * @param resolved - `resolveConfig` 的结果。
 * @param shadowed - 该 section 是否被更高优先级的 scope 遮蔽（遮蔽时不动它）。
 * @returns 新的 section 列表；无改动时原样返回。
 */
export function applyPersona(sections, resolved, shadowed) {
  const { persona, mode } = resolved
  if (mode === 'off' || persona.length === 0) return sections
  let changed = false
  const next = sections.map((section) => {
    if (section.name !== PERSONA_PREFIX_SECTION) return section
    if (shadowed) return section
    changed = true
    if (mode === 'replace') return { ...section, text: persona }
    const current = typeof section.text === 'string' ? section.text : ''
    return { ...section, text: current.length > 0 ? `${current}\n\n${persona}` : persona }
  })
  return changed ? next : sections
}

/**
 * 宿主插件入口。
 * 1. 注册 settings namespace（写入 settings.yaml，设置页可编辑）。
 * 2. 在 system-prompt/assemble waterfall 里把 persona 注入 `deployment:persona-prefix`。
 * 3. 挂一个同源 HTTP 路由给浏览器设置页（当前提示词 / 预览 / 保存）。
 */
export function apply(ctx, config = {}) {
  const settings = ctx.settings.register(SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => { resolveConfig(value) },
  })

  // 每次 prompt 组装后，把 settings 里的 persona 写进 deployment:persona-prefix。
  // untagged 的全局 listener 会被 scope dispatch 放行，覆盖所有 agent scope。
  const disposeAssembly = ctx.on('system-prompt/assemble', async (assembly, _context, next) => {
    const assembled = await next()
    const resolved = resolveConfig(settings.get())
    if (resolved.mode === 'off' || resolved.persona.length === 0) return assembled
    const deployment = deploymentPersonaPrefix(ctx)
    const current = assembled.sections.find((section) => section.name === PERSONA_PREFIX_SECTION)
    // 部署层之外的贡献（agent preset / 子 agent persona）遮蔽了这段 section：
    // 那份 persona 不归本插件管，不要覆盖它。
    const shadowed = deployment !== undefined && current !== undefined && current.text !== deployment
    const sections = applyPersona(assembled.sections, resolved, shadowed)
    return sections === assembled.sections ? assembled : { ...assembled, sections }
  })

  const backend = new PromptPersonaWebBackend(ctx, settings)
  const disposeWeb = installPromptPersonaWeb(ctx, backend)

  return () => {
    disposeAssembly()
    disposeWeb?.()
  }
}
