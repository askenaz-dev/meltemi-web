// The pages of the account routes: the sign-out confirmation, the account page and the page that
// says an account is gone. Every value goes through `esc`; every word comes from the catalog of the
// page's language, looked up when the page is made.

import type { Ctx } from "../context.js";
import { messages, type Messages } from "../messages/index.js";
import {
  PROVIDERS,
  type Identity,
  type Lang,
  type Provider,
  type Session,
  type User,
} from "../types.js";
import { esc, renderPage } from "./layout.js";

type AccountMessages = Messages["account"];

const DASH = "—";

// ---------------------------------------------------------------------------------------------
// Pieces

function hiddenFields(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("\n");
}

interface PostForm {
  readonly action: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly label: string;
  readonly formClass?: string;
  readonly buttonClass?: string;
}

/** A form that posts to the service itself; the button is the only thing a person sees. */
function postForm(form: PostForm): string {
  return `<form class="${form.formClass ?? "inline"}" method="post" action="${esc(form.action)}">
${hiddenFields(form.fields)}
<button class="${form.buttonClass ?? "btn"}" type="submit">${esc(form.label)}</button>
</form>`;
}

/** The picture's address when it is an `https:` one without credentials; otherwise nothing. */
function avatarUrl(picture: string): string | undefined {
  try {
    const url = new URL(picture);
    const plain = url.username === "" && url.password === "";
    return url.protocol === "https:" && plain ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function providerName(m: AccountMessages, provider: Provider): string {
  return provider === "github" ? m.providerGithub : m.providerGoogle;
}

/** What identifies a linked account to its owner: the provider's handle, else the email. */
function accountOf(identity: Identity): string {
  return identity.handle !== "" ? identity.handle : identity.email !== "" ? identity.email : DASH;
}

/**
 * The coarse label the service stores (`Edge on Windows`) in the page's language. A label that
 * does not have that shape is shown as it is.
 */
function sessionLabel(label: string, m: AccountMessages): string {
  const parts = /^(.+?) on (.+)$/.exec(label);
  if (!parts) return label;
  const browser = parts[1] === "Other browser" ? m.otherBrowser : parts[1];
  const system = parts[2] === "Other system" ? m.otherSystem : parts[2];
  return `${browser} ${m.labelJoin} ${system}`;
}

interface Clock {
  date(iso: string): string;
  dateTime(iso: string): string;
}

/** Dates in the language of the page, always in UTC so that a page says the same wherever it is read. */
function clock(lang: Lang): Clock {
  const date = new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
  const dateTime = new Intl.DateTimeFormat(lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
  const show = (format: Intl.DateTimeFormat, iso: string): string => {
    const time = new Date(iso);
    return Number.isNaN(time.getTime()) ? iso : format.format(time);
  };
  return { date: (iso) => show(date, iso), dateTime: (iso) => show(dateTime, iso) };
}

// ---------------------------------------------------------------------------------------------
// The sign-out confirmation

/** The page behind `GET /logout`: one form that posts to `/logout` with the return address. */
export function logoutConfirmPage(ctx: Ctx, returnTo: string): Response {
  const m = messages(ctx.lang).account;
  const body = `<h1>${esc(m.logoutTitle)}</h1>
<p>${esc(m.logoutBody)}</p>
<div class="actions">
${postForm({
  action: `/logout?lang=${ctx.lang}`,
  fields: { return_to: returnTo },
  label: m.logoutButton,
  buttonClass: "btn primary",
})}
<a class="btn" href="${esc(returnTo)}">${esc(m.logoutStay)}</a>
</div>`;
  return renderPage(ctx, { title: m.logoutTitle, body, personal: true });
}

// ---------------------------------------------------------------------------------------------
// The account page

export interface AccountView {
  readonly user: User;
  readonly identities: readonly Identity[];
  /** The live sessions, newest first. */
  readonly sessions: readonly Session[];
  readonly currentSid: string;
  /** The `csrf` token of the current session. */
  readonly csrf: string;
}

function identitiesSection(ctx: Ctx, m: AccountMessages, view: AccountView, time: Clock): string {
  const canUnlink = view.identities.length > 1;
  const rows = view.identities
    .map((identity) => {
      const name = providerName(m, identity.provider);
      const action = canUnlink
        ? postForm({
            action: `/account/unlink?lang=${ctx.lang}`,
            fields: { csrf: view.csrf, provider: identity.provider },
            label: `${m.unlinkButton} ${name}`,
            buttonClass: "btn danger",
          })
        : "";
      return `<tr>
<td>${esc(name)}</td>
<td>${esc(accountOf(identity))}</td>
<td>${esc(time.date(identity.linkedAt))}</td>
<td>${action}</td>
</tr>`;
    })
    .join("\n");
  const note = canUnlink ? "" : `<p class="muted">${esc(m.onlyIdentityNote)}</p>`;
  return `<h2>${esc(m.identitiesHeading)}</h2>
<table class="list">
<thead><tr><th>${esc(m.colProvider)}</th><th>${esc(m.colAccount)}</th><th>${esc(m.colLinked)}</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${note}`;
}

/** The links that start linking a provider the person has not linked yet. */
function linkSection(ctx: Ctx, m: AccountMessages, view: AccountView): string {
  const linked = new Set<Provider>(view.identities.map((identity) => identity.provider));
  const returnTo = encodeURIComponent(`${ctx.config.issuer}/account`);
  const links = PROVIDERS.filter((provider) => !linked.has(provider))
    .map((provider) => {
      const label = provider === "github" ? m.linkGithub : m.linkGoogle;
      const href = `/login?provider=${provider}&link=1&return_to=${returnTo}`;
      return `<a class="btn" href="${esc(href)}">${esc(label)}</a>`;
    })
    .join("\n");
  return links === ""
    ? ""
    : `<h2>${esc(m.linkHeading)}</h2>
<div class="actions">
${links}
</div>`;
}

function sessionsSection(m: AccountMessages, view: AccountView, time: Clock): string {
  const rows = view.sessions
    .map((session) => {
      const badge =
        session.sid === view.currentSid ? ` <span class="badge">${esc(m.thisSession)}</span>` : "";
      return `<tr>
<td>${esc(sessionLabel(session.label, m))}${badge}</td>
<td>${esc(time.dateTime(session.createdAt))}</td>
<td>${esc(time.dateTime(session.lastSeen))}</td>
</tr>`;
    })
    .join("\n");
  return `<h2>${esc(m.sessionsHeading)}</h2>
<table class="list">
<thead><tr><th>${esc(m.colDevice)}</th><th>${esc(m.colSignedIn)}</th><th>${esc(m.colLastSeen)}</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`;
}

function deleteSection(ctx: Ctx, m: AccountMessages, view: AccountView): string {
  return `<div class="danger-zone">
<h2>${esc(m.deleteHeading)}</h2>
<p>${esc(m.deleteBody)}</p>
<form class="stack" method="post" action="${esc(`/account/delete?lang=${ctx.lang}`)}">
${hiddenFields({ csrf: view.csrf })}
<label for="confirm">${esc(m.deleteConfirmBefore)} <code>${esc(m.deleteWord)}</code> ${esc(m.deleteConfirmAfter)}</label>
<input id="confirm" type="text" name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<button class="btn danger" type="submit">${esc(m.deleteButton)}</button>
</form>
</div>`;
}

/** `GET /account` for a signed-in person. Never cached: it shows personal data. */
export function accountPage(ctx: Ctx, view: AccountView): Response {
  const m = messages(ctx.lang).account;
  const time = clock(ctx.lang);
  const picture = avatarUrl(view.user.picture);
  const avatar = picture
    ? `<img class="avatar" src="${esc(picture)}" alt="" width="48" height="48">`
    : "";
  const body = `<h1>${esc(m.accountTitle)}</h1>
<div class="who">
${avatar}
<div><strong>${esc(view.user.name)}</strong><br><span class="muted">${esc(m.accountIntro)}</span></div>
</div>
${identitiesSection(ctx, m, view, time)}
${linkSection(ctx, m, view)}
${sessionsSection(m, view, time)}
<div class="actions">
${postForm({
  action: `/account/sessions/revoke-others?lang=${ctx.lang}`,
  fields: { csrf: view.csrf },
  label: m.revokeOthersButton,
})}
${postForm({
  action: `/logout?lang=${ctx.lang}`,
  fields: { return_to: ctx.config.siteUrl },
  label: m.signOutButton,
})}
</div>
<p class="muted">${esc(m.revokeOthersNote)}</p>
${deleteSection(ctx, m, view)}`;
  return renderPage(ctx, { title: m.accountTitle, body, personal: true });
}

// ---------------------------------------------------------------------------------------------
// After a deletion

/** The page that says the account is gone; it also carries the cookie that ends the session. */
export function deletedPage(ctx: Ctx, setCookies: readonly string[]): Response {
  const m = messages(ctx.lang).account;
  const body = `<h1>${esc(m.deletedTitle)}</h1>
<p>${esc(m.deletedBody)}</p>
<div class="actions">
<a class="btn primary" href="${esc(ctx.config.siteUrl)}">${esc(m.deletedLink)}</a>
</div>`;
  return renderPage(ctx, { title: m.deletedTitle, body, personal: true, setCookies });
}
