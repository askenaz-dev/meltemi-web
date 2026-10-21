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
`;

/** The body of `GET /identity.css`. */
export const IDENTITY_CSS: string = TOKENS + PAGES;
