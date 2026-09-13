# @xilin3/dsh-prompt-persona

[![license](https://img.shields.io/badge/license-MIT-6758d4.svg)](./LICENSE)
[![topic](https://img.shields.io/badge/topic-dsh--plugin-6758d4.svg)](https://github.com/topics/dsh-plugin)

一个 **DeepSeek Harness（DSH）插件**：在 Web 设置页里可视化编辑系统提示词（部署 persona），并实时预览改动效果。即「给 Harness 加系统提示词」的**方法 1 —— 改部署 persona**。

> 在 Harness 的系统提示词组装模型里，部署 persona 是唯一一段「由配置/部署作者撰写」的片段（order `0`）。本插件接管这段片段，把它变成设置页里可直接编辑、可预览、可持久化的内容，而无需改动 Harness 本体或手写 `cordis.patch.yml`。

**当前版本：0.2.0 — 已适配 DSH `0.1.5-rc.1`。** 兼容性改动见下方「版本适配」。

---

## 版本适配（0.1.5-rc.1）

上游把单个 `deployment:persona` section 拆成了 prefix / suffix 两段，并重命名了一批包。本版本据此改写：

| 断裂点 | 旧版（≤ 0.1.x 早期） | 现版本（0.1.5-rc.1） | 本插件的处理 |
| --- | --- | --- | --- |
| persona section | `PERSONA_SECTION = 'deployment:persona'` | 拆成 `deployment:persona-prefix`（order 0，身份）与 `deployment:persona-suffix`（order 10200，收尾） | 只接管 **prefix**（suffix 由部署配置保留，例如 `Your working directory is {{cwd}}.`） |
| schema 包 | `schemastery` | `@deepseek-ai/schemastery` | 改 import |
| settings 写入 | `settings.replace(ns, section)` | `replace` 会整段覆盖；`update` 只合并补丁 | 改用 `settings.update`，**非破坏性**：用户 section 里其它历史字段（如旧版留下的 `prompts` 数组）原样保留 |
| client 依赖声明 | `dsh.client.inject` 含 `@deepseek-ai/dsh-client-runtime`、`dsh-client-ui-slots` | 这两个包已不存在 | 收敛为 `["@deepseek-ai/dsh-client-ui-settings"]` |
| 运行时依赖解析 | 依赖 profile 的 node_modules | profile 的 `node_modules/@deepseek-ai/` 是空的 | 包内自带 `node_modules` junction（`scripts/link-deps.mjs`） |
| agent preset 冲突 | 不存在 | preset 可用同名 section 在 scope 内**遮蔽**部署 persona | 加了遮蔽守卫：只有当该 section 的文本等于部署层自己的配置值时才会被改写 |

其余行为（注入模式、预览、乐观锁、HTTP API）与旧版一致。

---

## 特性

- 🎛️ **可视化编辑**：设置页新增「系统提示词」区块，直接写 persona 文本。
- 🔀 **三种注入模式**：`replace`（替换）/ `append`（追加）/ `off`（关闭）。
- 👁️ **当前提示词**：实时显示当前生效的**完整系统提示词**（persona + harness 身份 + 工具引导等所有 section）。
- ✨ **添加效果（预览）**：把草稿应用到一份副本上，点「预览效果」即可看到**保存后的完整提示词**，不落盘、不污染当前状态。
- 💾 **乐观并发保存**：基于 settings revision 的冲突检测（`SETTINGS_CONFLICT` → HTTP 409），避免覆盖他人同时的修改。
- 🧩 **模板变量**：persona 支持 `{{model}}` / `{{cwd}}` / `{{provider}}` 严格插值。
- 🛡️ **不抢别人的 persona**：agent preset / 子 agent 在 scope 内遮蔽了 `deployment:persona-prefix` 时，本插件不覆盖它。

---

## 界面

设置页（Settings）里会多出一个「系统提示词」section，包含：

| 区块 | 说明 |
| --- | --- |
| 注入模式 | 下拉选择 替换 / 追加 / 关闭 |
| 自定义提示词 | 多行文本域，persona 内容，支持模板变量 |
| 保存并应用 / 预览效果 | 持久化到 `settings.yaml`；或仅预览草稿效果 |
| 当前提示词 | 当前生效的完整系统提示词（只读） |
| 添加效果（预览） | 草稿应用后的完整提示词（点击「预览效果」后出现） |

---

## 工作原理

```text
settings.yaml                    HTTP 路由
  prompt-persona ──────────────► /_dsh/prompt-persona/settings
       │  (persona, mode)              ▲
       ▼                               │ GET snapshot / POST preview|save
system-prompt/assemble waterfall ──────┘
       │  把 persona 写入 deployment:persona-prefix section
       ▼
完整系统提示词（每步动态组装）
```

1. **宿主插件**（`lib/index.js`）注册 settings namespace `prompt-persona`，并监听全局 `system-prompt/assemble` waterfall；每次组装完成后，把设置里的 persona 按 mode 写入 `deployment:persona-prefix` section。
   - 写入前先读一次提示词注册表自己的 composition config（`personaPrefix`）：若装配结果里该 section 的文本与之不符，说明它被更高优先级的 scope 遮蔽了（agent preset / 子 agent persona），此时**放弃改写**。
2. **HTTP 后端**（`lib/web.js`）在同源挂一个路由，向浏览器提供当前提示词、预览、保存三个能力。
3. **浏览器插件**（`lib/client.js`）通过 `settings.section` slot 注入 React 设置面板。

---

## 安装

### 方式 A：dsh-super-injector 运行时注入（本机开发推荐）

```js
dev_inject_plugin({ dir: 'C:\\Users\\<你>\\.dsh\\profiles\\web\\dsh-prompt-persona' })
```

注入即生效（不重启），清单持久化在 `~/.dsh/super-injector/registry.json`，重启后自动恢复。

### 方式 B：bundle 装配（生产态，需重启）

**方法 B1：命令行**

```bash
dsh plugin --profile web add github:xilin3/dsh-prompt-persona
```

然后把 `@xilin3/dsh-prompt-persona` 追加到该 profile `package.json` 的 `dsh.profile.bundles` 里（见 B2 的示例），最后重启 `dsh web`。

**方法 B2：手动编辑 profile 的 `package.json`**

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@xilin3/dsh-prompt-persona"
      ]
    }
  },
  "dependencies": {
    "@xilin3/dsh-prompt-persona": "github:xilin3/dsh-prompt-persona"
  }
}
```

然后在 profile 目录执行 `pnpm install`，最后重启 `dsh web`（前端/Host 改动**不会**热更新，必须重启进程并刷新浏览器）。

### 方式 C：本地目录挂载

把仓库放到 profile 目录（例如 `~/.dsh/profiles/web/dsh-prompt-persona`），在 profile `package.json` 里写 `"@xilin3/dsh-prompt-persona": "file:dsh-prompt-persona"` 并加进 `bundles`。

### 装完必做：链接宿主依赖

宿主半身 `import` 了 `@deepseek-ai/dsh-system-prompt` 与 `@deepseek-ai/schemastery`，而 profile 的 `node_modules/@deepseek-ai/` 通常是空的 —— 依赖必须能从**插件包自己的 `node_modules`** 解析出来：

```bash
cd <插件目录>
node scripts/link-deps.mjs        # 自动探测 DSH checkout（或设 DSH_CHECKOUT）
```

脚本会在 `<插件>/node_modules/@deepseek-ai/` 下建 junction（Windows 下等价于 `mklink /J`）。漏掉这一步的典型报错：

```text
Cannot find package '@deepseek-ai/dsh-system-prompt'
```

---

## 注入语义

`mode` 决定 persona 如何作用于 `deployment:persona-prefix` section（该 section 的部署原文记为 **当前 persona**）：

### `replace`（默认）

整段替换（会覆盖部署配置里的身份句）：

```text
当前 persona:
  You are a coding agent powered by the {{model}} model.

保存 persona:
  你是一名资深数据分析师，工作目录是 {{cwd}}。

结果 deployment:persona-prefix:
  你是一名资深数据分析师，工作目录是 {{cwd}}。
```

### `append`

追加到现有 persona 之后（空行分隔），部署身份句保留：

```text
当前 persona:
  You are a coding agent powered by the {{model}} model.

保存 persona:
  请始终用简体中文回答。

结果 deployment:persona-prefix:
  You are a coding agent powered by the {{model}} model.

  请始终用简体中文回答。
```

### `off`

不注入，保留 deployment 默认 persona。

> `deployment:persona-suffix`（默认 `Your working directory is {{cwd}}.`）不属于本插件的管辖范围，始终保持部署配置。

---

## 模板变量

persona 是模板，保存/渲染时执行**严格插值**（未注册的变量会报错）。可用变量：

| 变量 | 含义 |
| --- | --- |
| `{{model}}` | 当前模型（agent-default-model 或运行时变量） |
| `{{provider}}` | 当前 provider |
| `{{cwd}}` | 进程工作目录 |

---

## 配置参考

持久化在 `$DSH_HOME/settings.yaml`，namespace 为 `prompt-persona`：

```yaml
prompt-persona:
  persona: |
    你是一名资深数据分析师。
    工作目录是 {{cwd}}，模型是 {{model}}。
  mode: replace        # replace | append | off
```

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `persona` | string | `""` | 自定义 persona 文本（模板） |
| `mode` | enum | `"replace"` | `replace` / `append` / `off` |

非法 `mode` 会被 schema 拒绝（写入侧）/ 归一化为 `replace`（读取侧）；`persona` 会做 `trim`。

> 保存走 `settings.update`：只写 `persona` / `mode` 两个键，section 里其它字段不会被删除（历史版本可能留下 `prompts` 等数组）。

---

## HTTP API

浏览器设置页使用的同源路由 `/_dsh/prompt-persona/settings`：

| 方法 | 请求体 | 说明 |
| --- | --- | --- |
| `GET` | — | 返回 `{ settings: {value, revision, applies}, currentPrompt }` |
| `POST` | `{ action: "preview", persona, mode }` | 返回 `{ previewPrompt }` |
| `POST` | `{ action: "save", persona, mode, expectedRevision }` | 保存；返回新的 snapshot |

保存带 `expectedRevision`（乐观锁）：revision 不匹配时返回 HTTP `409`（`code: "settings-conflict"`），客户端需重新加载后重试。

---

## 目录结构

```text
dsh-prompt-persona/
├── package.json          # dual-face 包：dsh.bundle.patch + dsh.client.inject
├── cordis.patch.yml      # bundle patch：把插件插入 profile layer 栈
├── scripts/link-deps.mjs # 链接宿主依赖（@deepseek-ai/dsh-system-prompt / schemastery）
├── lib/
│   ├── index.js          # host 插件：settings 注册 + waterfall 注入 + 遮蔽守卫
│   ├── config.js         # settings schema（@deepseek-ai/schemastery）
│   ├── web.js            # HTTP 后端（snapshot / preview / save）
│   └── client.js         # 浏览器设置 UI（CommonJS + window.__ModuleLoader__）
├── README.md
└── LICENSE
```

无构建步骤：`lib/client.js` 是手写的 CommonJS 模块，由 DSH 客户端模块加载器（`window.__ModuleLoader__`）直接装载。

---

## 依赖（peerDependencies，由 DSH 宿主提供）

| 包 | 用途 |
| --- | --- |
| `@deepseek-ai/dsh-settings` | settings namespace 注册 / 读写 / revision 并发控制 |
| `@deepseek-ai/dsh-system-prompt` | `PERSONA_PREFIX_SECTION`、`renderPrompt`、assemble waterfall |
| `@deepseek-ai/dsh-host-webserver`（可选） | 挂载同源 HTTP 路由 |
| `@deepseek-ai/dsh-client-ui-settings` | 浏览器端 `settings.section` slot 声明 |
| `@deepseek-ai/schemastery` | 配置 schema |
| `@deepseek-ai/cordis` / `react` | 运行时由宿主注入 |

---

## 已知问题

- **Node 解析缓存会记住失败的解析**：若进程内第一次解析 `@xilin3/dsh-prompt-persona` 时 profile 的 `node_modules/@xilin3/dsh-prompt-persona` junction 是坏的（空目录、悬空），这次失败会被缓存到进程结束 —— 之后即使修好 junction，同一进程内的 `dev_inject_plugin` 仍会失败。**重启 `dsh web` 即自愈**（注入器按 registry 用包名恢复）。同一进程内需要立刻恢复时，可用相对路径挂 entry（`name: './dsh-prompt-persona/lib/index.js'`）。
- **HTTP 路由不在 Web 鉴权闸门之后**：`/_dsh/prompt-persona/settings` 能读到完整系统提示词并改写 persona。默认只监听 `127.0.0.1`；若把 `dsh-host-webserver` 的 `host` 改为 `0.0.0.0`，请自行评估暴露面。

---

## License

[MIT](./LICENSE) © 2026 xilin3
