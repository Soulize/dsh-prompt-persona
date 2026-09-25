import z from '@deepseek-ai/schemastery'
import { isVolatile } from '@deepseek-ai/cosmokit'

/**
 * 本插件拥有的 settings 命名空间。
 *
 * DSH 0.1.7 起：settings 命名空间不再是插件自报的字符串，而是 profile 里
 * 这条 loader entry 的 **id**——即 `cordis.patch.yml` 里 `insert.id` 的值。
 * 本常量必须与那个 id 保持一致，`settings.update()` 才能找到本条目。
 */
export const SETTINGS_NAMESPACE = 'prompt-persona'

/**
 * 面向用户的配置（即本条目自己的 Config）。
 *
 * DSH 0.1.7 起 settings 表单只投影 **volatile 字段**（`@deepseek-ai/dsh-settings`
 * 的 `volatileForm()`），并且只有 volatile 字段允许经 `settings.update()` 写回
 * profile patch。volatile 字段在插件代码里以**稳定引用**送达
 * （`config.persona.get()`），写入是原地更新、不重挂插件，因此设置页改完立即
 * 对下一次请求生效。
 */
export const Config = z.object({
  /** 自定义 persona 文本（模板，支持 {{model}} / {{cwd}} / {{provider}}）。 */
  persona: z.string().default('').volatile(),
  /** replace=替换 deployment:persona-prefix；append=追加；off=不注入。 */
  mode: z.union(['replace', 'append', 'off']).default('replace').volatile(),
})

/**
 * 取 volatile 引用的当前快照。
 *
 * 配置来自 profile/配置文件时值就是普通数据（没有引用），原样返回；
 * 来自 settings 表单时才是有 `.get()` 的引用。
 * @param value - 配置字段的当前值，可能是 volatile 引用。
 * @returns 该字段的普通数据。
 */
export function live(value) {
  return isVolatile(value) ? value.get() : value
}

/** 解析并归一化配置（非法 mode 回落为 replace）。 */
export function resolveConfig(config = {}) {
  const persona = live(config?.persona)
  const mode = live(config?.mode)
  return {
    persona: typeof persona === 'string' ? persona.trim() : '',
    mode: mode === 'append' || mode === 'off' ? mode : 'replace',
  }
}
