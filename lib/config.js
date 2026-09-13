import z from '@deepseek-ai/schemastery'

/** 本插件拥有的 settings document namespace。 */
export const SETTINGS_NAMESPACE = 'prompt-persona'

/** 面向用户的配置；所有字段在 schema 边界给默认值。 */
export const Config = z.object({
  /** 自定义 persona 文本（模板，支持 {{model}} / {{cwd}} / {{provider}}）。 */
  persona: z.string().default(''),
  /** replace=替换 deployment:persona-prefix；append=追加；off=不注入。 */
  mode: z.union(['replace', 'append', 'off']).default('replace'),
})

/** 解析并归一化配置（非法 mode 回落为 replace）。 */
export function resolveConfig(config = {}) {
  const persona = typeof config?.persona === 'string' ? config.persona.trim() : ''
  const mode = config?.mode === 'append' || config?.mode === 'off' ? config.mode : 'replace'
  return { persona, mode }
}
