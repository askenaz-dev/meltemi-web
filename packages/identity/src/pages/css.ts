// The stylesheet of every page: the site's tokens, copied from the IDE repository's
// `site/tokens.css` (commit 463c34e8cda2043536abd85ccab67314b3289cca), then the rules of the pages.
// The tokens are the IDE desktop client's; `pnpm site:tokens` compares the site's copy with the
// client, and this copy follows the site's. Do not edit a token value here.

const TOKENS = `/* SPDX-License-Identifier: Apache-2.0 */
:root {
  --mel-aegean: #2563eb;
  --mel-wind: #22d3ee;
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #eef2f7;
  --panel: #f1f5f9;
  --hair: #e2e8f0;
  --text: #0f172a;
  --text-muted: #475569;
  --text-faint: #64748b;
  --border: #cbd5e1;
  --accent: #2563eb;
  --focus: #1d4ed8;
  --ok: #15803d;
  --warn: #b45309;
  --danger: #b91c1c;
  --info: #0e7490;
  --tint-ok: #dcfce7;
  --tint-warn: #fef3c7;
  --tint-danger: #fee2e2;
  --tint-info: #cffafe;
  --font-ui: "Inter", "Segoe UI", "SF Pro Text", Roboto, system-ui, sans-serif;
  --font-mono: "Cascadia Mono", "SF Mono", "JetBrains Mono", Consolas, monospace;
  --fs-caption: 0.75rem;
  --fs-dense: 0.8125rem;
  --fs-body: 0.875rem;
  --fs-section: 1rem;
  --fs-view: 1.25rem;
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-6: 24px;
  --sp-8: 32px;
  --row-h: 32px;
  --cell-pad: var(--sp-2);
  --panel-pad: var(--sp-4);
  --touch-min: 44px;
  --radius-control: 4px;
  --radius-panel: 8px;
  --shadow-overlay: 0 4px 16px rgb(0 0 0 / 0.18);
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0b1220;
    --surface: #111a2e;
    --surface-2: #1a2540;
    --panel: #0e1526;
    --hair: #1a2540;
    --text: #e2e8f0;
    --text-muted: #94a3b8;
    --text-faint: #5b6b8c;
    --border: #2c3a57;
    --accent: #60a5fa;
    --focus: #22d3ee;
    --ok: #4ade80;
    --warn: #fbbf24;
    --danger: #f87171;
    --info: #67e8f9;
    --tint-ok: #0f2e22;
    --tint-warn: #3a2a12;
    --tint-danger: #3b1618;
    --tint-info: #0c3a45;
  }
}
`;

const PAGES = `
*, *::before, *::after { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  padding: var(--sp-6) var(--sp-4);
  background: var(--bg);
  color: var(--text);
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.card {
  width: min(520px, 100%);
  padding: var(--sp-6);
  background: var(--surface);
  border: 1px solid var(--hair);
  border-radius: var(--radius-panel);
}
.brand { margin: 0 0 var(--sp-3); font-weight: 600; letter-spacing: 0.01em; color: var(--text-muted); }
h1 { margin: 0 0 var(--sp-3); font-size: var(--fs-view); line-height: 1.25; }
h2 { margin: var(--sp-6) 0 var(--sp-2); font-size: var(--fs-section); }
p { margin: 0 0 var(--sp-3); }
a { color: var(--accent); }
a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
code { font-family: var(--font-mono); font-size: var(--fs-dense); }
.code { color: var(--text-muted); font-size: var(--fs-dense); }
.muted { color: var(--text-muted); }
.legal { font-size: var(--fs-caption); color: var(--text-faint); }
.legal a { color: inherit; }
.actions { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-top: var(--sp-4); }
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: var(--touch-min);
  padding: 0 var(--sp-4);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-size: var(--fs-dense);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
.btn:hover { border-color: var(--focus); }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #ffffff; }
.btn.danger { border-color: var(--danger); color: var(--danger); }
.providers { display: flex; flex-direction: column; gap: var(--sp-2); margin: var(--sp-4) 0; }
.providers .btn { justify-content: flex-start; }
.who { display: flex; align-items: center; gap: var(--sp-3); margin-bottom: var(--sp-4); }
.avatar { width: 48px; height: 48px; border-radius: 50%; background: var(--surface-2); }
.list { width: 100%; border-collapse: collapse; margin-bottom: var(--sp-3); }
.list th, .list td { padding: var(--cell-pad); border-bottom: 1px solid var(--hair); text-align: left; vertical-align: middle; }
.list th { font-size: var(--fs-caption); font-weight: 600; color: var(--text-muted); }
.badge {
  display: inline-block;
  padding: 0 var(--sp-2);
  border-radius: var(--radius-control);
  background: var(--tint-info);
  color: var(--info);
  font-size: var(--fs-caption);
}
.notice { padding: var(--sp-3); border-radius: var(--radius-control); background: var(--tint-warn); color: var(--text); margin-bottom: var(--sp-3); }
form.inline { display: inline; margin: 0; }
form.stack { display: flex; flex-direction: column; gap: var(--sp-2); margin-bottom: var(--sp-3); }
label { font-size: var(--fs-dense); color: var(--text-muted); }
input[type="text"] {
  min-height: var(--touch-min);
  padding: 0 var(--sp-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-control);
  background: var(--surface);
  color: var(--text);
  font: inherit;
}
.danger-zone { border-top: 1px solid var(--hair); margin-top: var(--sp-6); padding-top: var(--sp-2); }
.back { margin: 0 0 var(--sp-4); }
.list td.row-action { text-align: right; }
`;

// Explicit application themes use the exact canonical declarations above, without a second palette.
const LIGHT = TOKENS.match(/:root \{([\s\S]+?)\}/)![1]!;
const DARK = TOKENS.match(/@media[\s\S]+?:root \{([\s\S]+?)\}/)![1]!;
const APP = `
:root[data-theme="light"] { ${LIGHT} color-scheme: light; }
:root[data-theme="dark"] { ${DARK} color-scheme: dark; }
.app-body { display: block; padding: 0; min-height: 100vh; background: var(--surface); }
.app-shell { display: grid; grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: auto 1fr; min-height: 100vh; min-height: 100svh; }
.app-header { grid-column: 1 / -1; display: grid; grid-template-columns: 240px minmax(0, 1fr) minmax(0, auto); align-items: center; min-height: 72px; border-bottom: 1px solid var(--hair); background: var(--surface); position: sticky; top: 0; z-index: 10; }
.app-brand { display: inline-flex; gap: var(--sp-2); align-items: center; min-height: var(--touch-min); padding: 0 var(--sp-6); font-size: 1.25rem; font-weight: 650; letter-spacing: -0.03em; color: var(--text); text-decoration: none; }
.app-mark { flex: none; }
.app-context { color: var(--text-muted); padding-left: var(--sp-8); }
.app-account { position: relative; margin-right: var(--sp-6); min-width: 0; }
.app-account summary { min-height: var(--touch-min); display: flex; align-items: center; gap: var(--sp-2); border-radius: var(--radius-control); padding: var(--sp-1) var(--sp-2); cursor: pointer; list-style: none; }
.app-account summary::-webkit-details-marker { display: none; }
.app-account summary:hover, .app-account[open] summary { background: var(--surface-2); }
.app-avatar { display: grid; place-items: center; width: 30px; height: 30px; flex: none; background: var(--surface-2); border: 1px solid var(--border); border-radius: 50%; font-weight: 600; color: var(--text); }
.app-account-name { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-chevron { transition: transform 140ms ease; }
.app-account[open] .app-chevron { transform: rotate(180deg); }
.app-account-links { position: absolute; top: calc(100% + 8px); right: 0; width: min(296px, calc(100vw - 32px)); padding: var(--sp-2); border: 1px solid var(--border); border-radius: var(--radius-panel); background: var(--surface); box-shadow: var(--shadow-overlay); }
.app-account-links a { display: flex; align-items: center; min-height: var(--touch-min); padding: var(--sp-2) var(--sp-3); border-radius: var(--radius-control); color: var(--text); text-decoration: none; }
.app-account-links a:hover { background: var(--surface-2); }
.app-menu-name { display: block; overflow-wrap: anywhere; padding: var(--sp-2) var(--sp-3) var(--sp-3); margin-bottom: var(--sp-1); border-bottom: 1px solid var(--hair); color: var(--text-muted); }
.app-sidebar { padding: var(--sp-6) var(--sp-4) var(--sp-4); background: var(--bg); border-right: 1px solid var(--hair); display: flex; flex-direction: column; gap: var(--sp-8); }
.app-nav-group { margin-bottom: var(--sp-6); }
.app-nav-group p { margin: 0 var(--sp-3) var(--sp-2); color: var(--text-muted); font-weight: 600; font-size: var(--fs-caption); }
.app-nav-group a { display: flex; align-items: center; min-height: var(--touch-min); margin-bottom: var(--sp-1); padding: var(--sp-2) var(--sp-3); color: var(--text-muted); text-decoration: none; border-radius: var(--radius-control); transition: background 120ms ease, color 120ms ease; }
.app-nav-group a:hover { background: var(--surface-2); color: var(--text); }
.app-nav-group a[aria-current="page"] { background: var(--surface-2); color: var(--text); font-weight: 600; box-shadow: inset 2px 0 var(--accent); }
.app-environment-options { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--sp-1); }
.app-environment-options a { justify-content: center; padding-left: var(--sp-1); padding-right: var(--sp-1); font-size: var(--fs-dense); }
.app-environment-options a[aria-current="true"] { background: var(--surface); color: var(--text); box-shadow: inset 0 0 0 1px var(--border); font-weight: 600; }
.app-environment-label { color: var(--text-muted); margin: var(--sp-2) 0 0; font-size: var(--fs-dense); }
.app-legal { margin-top: auto; display: flex; gap: var(--sp-3); padding: 0 var(--sp-3); color: var(--text-muted); font-size: var(--fs-caption); }
.app-legal a { color: inherit; }
.app-main { min-width: 0; padding: var(--sp-8) clamp(20px, 3.5vw, 64px) 64px; }
.app-main h1 { font-size: 1.6rem; letter-spacing: -0.025em; }
.app-page-header { padding-bottom: var(--sp-6); border-bottom: 1px solid var(--hair); margin-bottom: var(--sp-6); }
.app-page-header h1 { margin: 0; }
.app-main h2 { margin-top: 0; }
.app-main .btn.primary { background: var(--mel-aegean); border-color: var(--mel-aegean); color: #fff; }
.app-main button:disabled { opacity: 0.6; cursor: default; }
.app-main input:not([type="hidden"]):not([type="checkbox"]), .app-main select, .app-main textarea { width: 100%; min-height: var(--touch-min); padding: var(--sp-2) var(--sp-3); border: 1px solid var(--border); border-radius: var(--radius-control); background: var(--surface); color: var(--text); font: inherit; }
.app-main textarea { min-height: 104px; resize: vertical; }
.app-main label { color: var(--text); }
.app-form { display: grid; gap: var(--sp-3); max-width: 680px; margin: var(--sp-4) 0; }
.app-form label:not(.app-confirm) { display: grid; gap: var(--sp-2); }
.app-form .btn { justify-self: start; }
.app-main .section-intro, .app-main .field-help { max-width: 76ch; color: var(--text-muted); }
.app-main .settings-section { padding-bottom: var(--sp-6); margin-bottom: var(--sp-6); border-bottom: 1px solid var(--hair); }
.app-main .settings-form { max-width: 680px; display: grid; gap: var(--sp-4); margin: var(--sp-4) 0; }
.app-main .field { display: grid; gap: var(--sp-2); }
.app-main .form-actions { display: flex; gap: var(--sp-2); flex-wrap: wrap; }
.app-main .saved-notice { border-left: 3px solid var(--ok); padding: var(--sp-3) var(--sp-4); background: var(--tint-ok); margin-bottom: var(--sp-6); }
.app-main .settings-dl { display: grid; grid-template-columns: minmax(100px, 180px) minmax(0, 1fr); gap: var(--sp-2) var(--sp-6); }
.app-main .settings-dl dt { color: var(--text-muted); }
.app-main .settings-dl dd { margin: 0; overflow-wrap: anywhere; }
.app-confirm { display: flex; gap: var(--sp-2); align-items: flex-start; padding: var(--sp-2) 0; }
.app-confirm input { flex: none; width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--mel-aegean); }
.app-note { max-width: 76ch; color: var(--text-muted); }
.app-section { padding: 0 0 var(--sp-6); margin-bottom: var(--sp-6); border-bottom: 1px solid var(--hair); }
.app-section:last-child { border-bottom: 0; }
.app-service-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(0, 2fr) auto; gap: var(--sp-6); align-items: center; padding: var(--sp-6) 0; border-bottom: 1px solid var(--hair); }
.app-service-row h2, .app-service-row p { margin: 0 0 var(--sp-1); }
.app-table-scroll { width: 100%; overflow-x: auto; margin: var(--sp-4) 0; }
.app-table { width: 100%; border-collapse: collapse; font-size: var(--fs-dense); }
.app-table th, .app-table td { text-align: left; vertical-align: top; padding: var(--sp-3) var(--sp-3) var(--sp-3) 0; border-bottom: 1px solid var(--hair); }
.app-table th { color: var(--text-muted); font-weight: 500; white-space: nowrap; }
.app-table td { min-width: 110px; max-width: 360px; overflow-wrap: anywhere; }
.app-table td:last-child { padding-right: 0; }
.app-person { display: grid; gap: var(--sp-1); overflow-wrap: anywhere; }
.app-person small { color: var(--text-muted); }
.app-rows { list-style: none; margin: 0; padding: 0; }
.app-row { display: flex; gap: var(--sp-6); align-items: flex-start; justify-content: space-between; padding: var(--sp-4) 0; border-bottom: 1px solid var(--hair); }
.app-row > :first-child { min-width: 0; }
.app-row form { margin: 0; }
.app-row .app-confirm { max-width: 300px; }
.app-record { margin: var(--sp-4) 0; display: grid; grid-template-columns: minmax(100px, 180px) minmax(0, 1fr); gap: var(--sp-2) var(--sp-6); }
.app-record dt { color: var(--text-muted); }
.app-record dd { margin: 0; overflow-wrap: anywhere; }
.app-message { padding: var(--sp-3) var(--sp-4); border-left: 3px solid var(--info); background: var(--tint-info); margin: 0 0 var(--sp-6); }
.app-message.problem { border-color: var(--danger); background: var(--tint-danger); }
.app-message.success { border-color: var(--ok); background: var(--tint-ok); }
.app-skip { position: fixed; left: 16px; top: -120px; z-index: 30; background: var(--surface); border: 1px solid var(--border); padding: var(--sp-3); }
.app-skip:focus { top: 8px; }
.app-body :is(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline: 2px solid var(--focus); outline-offset: 3px; }
.app-mobile-nav { display: none; }
@media (max-width: 800px) {
  .app-shell { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto auto 1fr; }
  .app-header { grid-template-columns: auto minmax(0, 1fr); min-height: 64px; }
  .app-brand { padding: 0 var(--sp-4); font-size: 1.1rem; }
  .app-context { display: none; }
  .app-account { justify-self: end; max-width: 100%; margin-right: var(--sp-3); }
  .app-account-name { max-width: min(180px, 27vw); }
  .app-sidebar { border-right: 0; border-bottom: 1px solid var(--hair); padding: var(--sp-2) var(--sp-4); gap: var(--sp-2); }
  .app-desktop-nav { display: none; }
  .app-mobile-nav { display: block; }
  .app-mobile-nav > summary { display: flex; align-items: center; min-height: var(--touch-min); cursor: pointer; color: var(--text-muted); }
  .app-mobile-nav > summary::after { content: "⌄"; margin-left: auto; transition: transform 140ms ease; }
  .app-mobile-nav[open] > summary::after { transform: rotate(180deg); }
  .app-mobile-nav nav { padding: var(--sp-3) 0; }
  .app-nav-group a { margin-right: var(--sp-2); }
  .app-legal { display: none; }
  .app-main { padding: var(--sp-6) var(--sp-4) var(--sp-8); }
  .app-service-row { grid-template-columns: minmax(0, 1fr); gap: var(--sp-3); }
  .app-service-row .btn { justify-self: start; }
  .app-row { flex-direction: column; gap: var(--sp-3); }
  .app-row form, .app-row .app-confirm { max-width: 100%; }
  .app-record { grid-template-columns: minmax(0, 1fr); gap: var(--sp-1); }
  .app-record dd { margin-bottom: var(--sp-3); }
  .app-main .settings-dl { grid-template-columns: minmax(0, 1fr); }
}
@media (prefers-reduced-motion: reduce) { .app-body *, .app-body *::before, .app-body *::after { transition: none !important; scroll-behavior: auto !important; } }
`;

/** The body of `GET /identity.css`. */
export const IDENTITY_CSS: string = TOKENS + PAGES + APP;

// Cache identity for stylesheet URLs, not a security digest. Existing app tabs may retain CSS
// for an hour, so new server-rendered markup must request the matching stylesheet bytes.
let stylesheetRevision = 2166136261;
for (let i = 0; i < IDENTITY_CSS.length; i++) {
  stylesheetRevision = Math.imul(stylesheetRevision ^ IDENTITY_CSS.charCodeAt(i), 16777619);
}
export const IDENTITY_CSS_REVISION = (stylesheetRevision >>> 0).toString(16);
