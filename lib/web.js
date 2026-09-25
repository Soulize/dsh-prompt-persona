import { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SETTINGS_NAMESPACE, resolveConfig } from './config.js'

/** 浏览器设置页使用的主路由。 */
export const SETTINGS_ROUTE = '/_dsh/prompt-persona/settings'

/**
 * 取 settings 服务（可选依赖）。
 *
 * DSH 0.1.7：非硬依赖的服务要用 `ctx.get(name)` 读（硬依赖才有 `ctx.settings`）。
 * @returns settings 服务，或未挂载时的 `undefined`。
 */
function settingsOf(ctx) {
  try {
    if (typeof ctx.get === 'function') return ctx.get('settings')
  } catch {
    // 服务不存在时 cordis 的 get 会抛错，按「未挂载」处理。
  }
  return ctx.settings
}

/** 把草稿 persona 应用到一份 sections 副本（不改原对象）。 */
function applyDraft(sections, draft) {
  const { persona, mode } = resolveConfig(draft)
  if (mode === 'off' || persona.length === 0) return sections
  return sections.map((section) => {
    if (section.name !== PERSONA_PREFIX_SECTION) return section
    if (mode === 'replace') return { ...section, text: persona }
    const current = typeof section.text === 'string' && section.text.length > 0 ? section.text : ''
    return { ...section, text: (current ? current + '\n\n' : '') + persona }
  })
}

/** 渲染一份 assembly 为完整提示词文本，补全 model/cwd/provider 变量。 */
function renderAssembly(assembly, ctx) {
  let selection
  try {
    // 0.1.7：默认模型改由 agentDefaultModel 服务回答
    // （settings 命名空间 'agent-default-model' 已不存在）。
    selection = ctx.get?.('agentDefaultModel')?.currentSelection()
  } catch {
    // 未挂载该服务（例如纯 SDK 装配）不应让预览整体失败。
  }
  const variables = {
    ...assembly.variables,
    provider: assembly.variables.provider ?? selection?.provider ?? '(provider)',
    model: assembly.variables.model ?? selection?.model ?? '(model)',
    cwd: assembly.variables.cwd ?? process.cwd(),
  }
  try {
    return renderPrompt({ ...assembly, variables })
  } catch {
    // 降级：若出现别的未注册变量导致严格插值失败，手动替换已知变量。
    const v = variables
    const repl = (s) => String(s)
      .replace(/\{\{\s*model\s*\}\}/g, v.model)
      .replace(/\{\{\s*cwd\s*\}\}/g, v.cwd)
      .replace(/\{\{\s*provider\s*\}\}/g, v.provider)
    return assembly.sections.map((s) => repl(s.text)).filter((t) => t.length > 0).join('\n\n')
  }
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

async function readBody(req, maxBytes = 256 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError('request body too large')
    chunks.push(part)
  }
  if (chunks.length === 0) throw new TypeError('empty body')
  return Buffer.concat(chunks).toString('utf8')
}

/** 同源 Settings/预览 handler。 */
export class PromptPersonaWebBackend {
  constructor(ctx, config = {}) {
    this.ctx = ctx
    this.config = config
  }

  /**
   * 本条目在 settings 文档里的描述符（0.1.7：键是 profile entry id）。
   * @returns 该条目的一行，或 settings 未挂载/条目未生效时的 `undefined`。
   */
  settingsRow() {
    const settings = settingsOf(this.ctx)
    if (settings === undefined) return undefined
    return settings.describe({ redactSecrets: true }).find((row) => row.ns === SETTINGS_NAMESPACE)
  }

  async currentPromptText() {
    const assembly = await this.ctx.systemPrompt.assemble()
    return renderAssembly(assembly, this.ctx)
  }

  async snapshot() {
    const row = this.settingsRow()
    return {
      settings: {
        // 描述符里的 value 是投影后的 volatile 表单值；settings 不可用时
        // 回落成插件自己的 Config 引用（配置来自 profile patch 的场景）。
        value: resolveConfig(row?.value ?? this.config),
        revision: row?.revision ?? 0,
        applies: row?.applies ?? 'live',
        writable: settingsOf(this.ctx)?.writable ?? false,
      },
      currentPrompt: await this.currentPromptText(),
    }
  }

  async preview(draft) {
    const assembly = await this.ctx.systemPrompt.assemble()
    const sections = applyDraft(assembly.sections.map((s) => ({ ...s })), draft)
    return { previewPrompt: renderAssembly({ ...assembly, sections }, this.ctx) }
  }

  async save(draft, expectedRevision) {
    const settings = settingsOf(this.ctx)
    if (settings === undefined) throw new Error('settings service is unavailable in this deployment')
    if (!settings.writable) throw new Error('settings provider is read-only')
    const { persona, mode } = resolveConfig(draft)
    // update（而非 replace）：只改 persona/mode 两个键，条目里其它历史字段原样保留。
    // 0.1.7 的 write() 会校验这两个字段确实是 volatile（见 config.js）。
    await settings.update(SETTINGS_NAMESPACE, { persona, mode }, expectedRevision)
    return this.snapshot()
  }

  responseJson(res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body))
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(status)
    res.end(bytes)
  }

  async handle(req, res) {
    if (req.method === 'GET') {
      try {
        this.responseJson(res, 200, { ok: true, value: await this.snapshot() })
      } catch (error) {
        this.responseJson(res, 503, { ok: false, error: { code: 'unavailable', message: messageOf(error) } })
      }
      return
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      this.responseJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Use GET or POST' } })
      return
    }
    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch (error) {
      this.responseJson(res, 400, { ok: false, error: { code: 'invalid-request', message: messageOf(error) } })
      return
    }
    try {
      if (body?.action === 'preview') {
        this.responseJson(res, 200, { ok: true, value: await this.preview(body) })
      } else if (body?.action === 'save') {
        if (!Number.isSafeInteger(body.expectedRevision)) throw new Error('expectedRevision must be a non-negative integer')
        this.responseJson(res, 200, { ok: true, value: await this.save(body, body.expectedRevision) })
      } else {
        this.responseJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'unsupported action' } })
      }
    } catch (error) {
      const conflict = error?.code === 'SETTINGS_CONFLICT'
      this.responseJson(res, conflict ? 409 : 400, {
        ok: false,
        error: { code: conflict ? 'settings-conflict' : 'rejected', message: messageOf(error) },
      })
    }
  }
}

/** 有 webServer 服务时挂载同源路由；返回可选的整体 disposer。 */
export function installPromptPersonaWeb(ctx, backend) {
  const dispose = ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const off = webCtx.webServer.register({
        kind: 'exact',
        path: SETTINGS_ROUTE,
        handler: (req, res) => backend.handle(req, res),
      })
      return () => off()
    }, 'prompt-persona: web route')
  })
  return typeof dispose === 'function' ? dispose : undefined
}
