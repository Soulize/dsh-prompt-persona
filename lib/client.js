window.__ModuleLoader__.load({ id: "@xilin3/dsh-prompt-persona", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const React = require("react");
const { useState, useEffect, useCallback } = React;
const h = React.createElement;

const ROUTE = "/_dsh/prompt-persona/settings";
/** 与本插件 host 半身 Config 相同的 profile entry id（settings 命名空间）。 */
const SETTINGS_NAMESPACE = "prompt-persona";

async function api(action, payload) {
  const init = action === undefined
    ? { credentials: "same-origin" }
    : {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ action }, payload)),
      };
  const res = await fetch(ROUTE, init);
  let body;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error("宿主半身未响应（HTTP " + res.status + "）：请确认插件 host 已加载");
  }
  if (!res.ok || !body.ok) {
    throw new Error((body && body.error && body.error.message) || ("request failed " + res.status));
  }
  return body.value;
}

const CSS = [
  ".pp-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".pp-header{display:grid;gap:4px;padding:8px 2px}",
  ".pp-header h2{font-size:24px;letter-spacing:-.025em;margin:0}",
  ".pp-header p{max-width:640px;margin:4px 0 0;color:var(--dsw-alias-fg-muted,#77736d);font-size:13px;line-height:1.55}",
  ".pp-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#6758d4;font-weight:700}",
  ".pp-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:0 1px 1px rgba(0,0,0,.02)}",
  ".pp-panel-title h3{font-size:14px;margin:0}",
  ".pp-field{display:grid;gap:6px}",
  ".pp-field label{font-size:12px;font-weight:600;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".pp-field select,.pp-field textarea{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px}",
  ".pp-field textarea{resize:vertical;min-height:120px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;line-height:1.5}",
  ".pp-actions{display:flex;gap:8px;flex-wrap:wrap}",
  ".pp-btn{display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font-size:13px;font-weight:600;cursor:pointer}",
  ".pp-btn.primary{background:#6758d4;border-color:#6758d4;color:#fff}",
  ".pp-btn:disabled{opacity:.55;cursor:default}",
  ".pp-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5}",
  ".pp-alert.error{background:rgba(205,72,72,.1);color:#aa3939}",
  ".pp-alert.success{background:rgba(48,154,100,.1);color:#267d52}",
  ".pp-alert.info{background:rgba(103,88,212,.1);color:#4b3fa8}",
  ".pp-pre{margin:0;padding:12px;border-radius:9px;background:var(--dsw-alias-bg-layer-2,#f7f5f1);border:1px solid var(--dsw-alias-border-subtle,#dedbd5);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto}",
].join("\n");

function PromptPersonaSection() {
  const [draft, setDraft] = useState({ persona: "", mode: "replace" });
  const [snapshot, setSnapshot] = useState(undefined);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const snap = await api();
      setSnapshot(snap);
      setDraft({
        persona: (snap.settings && snap.settings.value && snap.settings.value.persona) || "",
        mode: (snap.settings && snap.settings.value && snap.settings.value.mode) || "replace",
      });
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (patch) => setDraft((cur) => Object.assign({}, cur, patch));

  const doPreview = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await api("preview", { persona: draft.persona, mode: draft.mode });
      setPreview(r.previewPrompt);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const rev = snapshot && snapshot.settings ? snapshot.settings.revision : 0;
      const r = await api("save", { persona: draft.persona, mode: draft.mode, expectedRevision: rev });
      setSnapshot(r);
      setPreview("");
      setMessage("已保存并生效（对下一次请求生效）。");
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // settings 未挂载（或本条目不接受写入）时，表单保持可读但不可写。
  const readOnly = !!snapshot && snapshot.settings && snapshot.settings.writable === false;

  return h("div", { className: "pp-settings" }, [
    h("header", { className: "pp-header" }, [
      h("span", { className: "pp-kicker" }, "system-prompt · deployment:persona-prefix"),
      h("h2", null, "系统提示词"),
      h("p", null, "自定义 Agent 的部署 persona（方法 1 —— 改部署 persona）。写入 system prompt 的 deployment:persona-prefix section；文本是模板，支持 {{model}}、{{cwd}}、{{provider}} 变量；保存后对下一次请求生效。agent preset 自带的 persona 优先级更高，不会被覆盖。"),
    ]),
    h("section", { className: "pp-panel" }, [
      h("div", { className: "pp-field" }, [
        h("label", null, "注入模式"),
        h("select", { value: draft.mode, disabled: busy, onChange: (e) => update({ mode: e.target.value }) }, [
          h("option", { value: "replace" }, "替换 deployment persona"),
          h("option", { value: "append" }, "追加到 persona 之后"),
          h("option", { value: "off" }, "关闭（不注入）"),
        ]),
      ]),
      h("div", { className: "pp-field" }, [
        h("label", null, "自定义提示词"),
        h("textarea", {
          rows: 8,
          value: draft.persona,
          disabled: busy,
          placeholder: "例如：你是一个专注于数据分析的助手。工作目录是 {{cwd}}，模型是 {{model}}。",
          onChange: (e) => update({ persona: e.target.value }),
        }),
      ]),
      h("div", { className: "pp-actions" }, [
        h("button", { className: "pp-btn primary", disabled: busy || readOnly, onClick: doSave }, busy ? "处理中…" : "保存并应用"),
        h("button", { className: "pp-btn", disabled: busy, onClick: doPreview }, "预览效果"),
      ]),
    ]),
    error ? h("div", { className: "pp-alert error" }, error) : null,
    readOnly ? h("div", { className: "pp-alert info" }, "本部署的设置为只读：可以预览，但无法保存。") : null,
    message ? h("div", { className: "pp-alert success" }, message) : null,
    h("section", { className: "pp-panel" }, [
      h("div", { className: "pp-panel-title" }, h("h3", null, "当前提示词")),
      h("pre", { className: "pp-pre" }, snapshot ? snapshot.currentPrompt : "加载中…"),
    ]),
    preview ? h("section", { className: "pp-panel" }, [
      h("div", { className: "pp-panel-title" }, h("h3", null, "添加效果（预览）")),
      h("pre", { className: "pp-pre" }, preview),
    ]) : null,
  ]);
}

/**
 * DSH 0.1.7：设置页由 client 插件注册到 `settings.section` slot。
 * `configForms` 是设置域的读取面，用它的 `whileServed()` 跟随本条目：
 * host 没有挂 settings 服务（或本条目未生效）时，页面上不留任何痕迹。
 */
const inject = ["slots", "configForms"];

function apply(ctx) {
  ctx.effect(() => {
    const id = "@xilin3/dsh-prompt-persona/client";
    if (document.querySelector('style[data-plugin-css="' + id + '"]')) return () => {};
    const style = document.createElement("style");
    style.dataset.plugin = "@xilin3/dsh-prompt-persona";
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, "prompt-persona: styles");

  ctx.effect(() => ctx.configForms.whileServed([SETTINGS_NAMESPACE], () => ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "prompt-persona",
    order: 40,
    label: () => "系统提示词",
  }, PromptPersonaSection))), "prompt-persona: settings page");
}

exports.apply = apply;
exports.inject = inject;

return module.exports;
}});
