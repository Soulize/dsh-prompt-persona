# @xilin3/dsh-prompt-persona

在 DSH 设置页可视化编辑**系统提示词（deployment persona）**的插件，即“方法 1”。

- 后端注册一个 settings namespace `prompt-persona`，并通过 `system-prompt/assemble` waterfall 把设置里的 persona 动态注入 `deployment:persona` section。
- 前端通过 `settings.section` slot 在设置页新增一个「系统提示词」区块：
  - 编辑 persona 文本 + 注入模式（替换 / 追加 / 关闭）
  - 实时查看**当前提示词**（当前生效的完整系统提示词）
  - 点击「预览效果」查看**添加效果**（草稿应用后的完整提示词）
  - 「保存并应用」持久化到 `settings.yaml`，对下一次请求生效

## 注入语义

- `replace`：把 `deployment:persona` 整段替换为你的文本（方法 1 的“改 persona”）。
- `append`：在现有 persona 之后追加你的文本。
- `off`：不注入，保留 deployment 默认 persona。

persona 文本是模板，支持 `{{model}}`、`{{cwd}}` 变量（严格插值）。

## 挂载

把本插件加入 web profile（`$DSH_HOME/profiles/web/package.json`，即 `C:\Users\惜零\.dsh\profiles\web\package.json`）：

```json
{
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "@xilin3/dsh-prompt-persona"]
    }
  },
  "dependencies": {
    "@xilin3/dsh-prompt-persona": "github:xilin3/dsh-prompt-persona"
  }
}
```

然后在 profile 目录执行 `pnpm install`（或 `dsh plugin --profile web install`），最后重启 `dsh web`。

## 文件

- `lib/index.js` — host 插件：settings 注册 + waterfall 注入。
- `lib/config.js` — settings schema。
- `lib/web.js` — HTTP 后端（`/_dsh/prompt-persona/settings`）。
- `lib/client.js` — 浏览器端设置 UI（CommonJS + `window.__ModuleLoader__`）。
