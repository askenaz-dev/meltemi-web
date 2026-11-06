import { isDocsAiOwner } from "../administration.js";
import type { Ctx, Route } from "../context.js";
import { checkAccountForm, csrfToken } from "../forms.js";
import { redirect } from "../http.js";
import { administrationMessages, type AdministrationMessages } from "../messages/administration.js";
import { applyAppPreferences, renderAppPage, type ProductRole } from "../pages/app.js";
import { esc, simpleError } from "../pages/layout.js";
import type { AccountPreferences } from "../preferences.js";
import {
  productAction,
  productAccount,
  productAdministration,
  productContext,
  productEnvironment,
  appPath,
  validAccount,
  validEmail,
  type AccountPermission,
  type AdminPerson,
  type AdminRef,
  type AdminView,
  type ProductContext,
  type ProductOutcome,
} from "../product-admin.js";
import { currentSession, type CurrentSession } from "../session.js";

const SECTIONS = ["access", "permissions", "sponsorships", "publications", "activity"] as const;
type Section = (typeof SECTIONS)[number];
interface Visitor {
  readonly ctx: Ctx;
  readonly current: CurrentSession;
  readonly preferences: AccountPreferences;
  readonly owner: boolean;
}
type Ready = Visitor & { readonly product: ProductContext; readonly view: AdminView | null };
const sectionOf = (ctx: Ctx): Section | undefined =>
  SECTIONS.find((section) => ctx.url.pathname === `/admin/diagrams/${section}`);
const at = appPath;
const sectionPath = (ctx: Ctx, section: Section) => at(ctx, `/admin/diagrams/${section}`);
const mOf = (visitor: Visitor) => administrationMessages(visitor.ctx.lang);

function notFound(ctx: Ctx): Response {
  const m = administrationMessages(ctx.lang);
  const response = simpleError(ctx, 404, "not-found", m.workspace, m.notFound);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function visitor(ctx: Ctx): Promise<Visitor | Response> {
  if (productEnvironment(ctx) === undefined) {
    const m = administrationMessages(ctx.lang);
    const response = simpleError(ctx, 400, "request.invalid", m.invalidEnvironment, m.invalid);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const current = await currentSession(ctx);
  if (!current) {
    const path =
      ctx.url.pathname === "/admin/" || ctx.url.pathname === "/admin"
        ? "/admin/"
        : `/admin/diagrams/${sectionOf(ctx) ?? "access"}`;
    return redirect(
      `/login?lang=${ctx.lang}&return_to=${encodeURIComponent(`${ctx.config.issuer}${at(ctx, path)}`)}`,
    );
  }
  const preferences = await ctx.deps.store.getAccountPreferences(current.user.id);
  return {
    ctx: applyAppPreferences(ctx, preferences),
    current,
    preferences,
    owner: isDocsAiOwner(ctx.env, current.user.id),
  };
}

function page(
  v: Visitor,
  active: string,
  body: string,
  role: ProductRole = "none",
  status = 200,
): Response {
  const m = mOf(v);
  return renderAppPage(v.ctx, {
    title: active === "overview" ? m.overview : m[active as Section],
    body,
    user: v.current.user,
    owner: v.owner,
    active,
    preferences: v.preferences,
    productRole: role,
    status,
  });
}

function problem(
  v: Visitor,
  section: Section | "overview",
  code: string,
  status: number,
  role: ProductRole = "none",
): Response {
  const m = mOf(v);
  const text =
    code === "product.unavailable"
      ? m.productUnavailable
      : code === "request.forbidden"
        ? m.forbidden
        : code === "request.invalid"
          ? m.invalid
          : code === "account.ambiguous"
            ? m.ambiguous
            : code === "admin.already"
              ? m.already
              : code === "admin.limit"
                ? m.limit
                : code === "not-found"
                  ? m.notFound
                  : m.failed;
  const path = section === "overview" ? at(v.ctx, "/admin/") : sectionPath(v.ctx, section);
  return page(
    v,
    section,
    `<div class="app-message problem" role="alert"><p>${esc(text)}</p><code>${esc(code)}</code></div><a class="btn" href="${esc(path)}">${esc(m.retry)}</a>`,
    role,
    status,
  );
}

async function ready(v: Visitor, section: Section): Promise<Ready | Response> {
  const context = await productContext(v.ctx, v.current);
  if (!context.ok) return problem(v, section, context.code, context.status);
  if (context.value.role === "none") return notFound(v.ctx);
  if (context.value.role === "invitee") {
    return section === "access" ? { ...v, product: context.value, view: null } : notFound(v.ctx);
  }
  const view = await productAdministration(v.ctx, v.current);
  if (!view.ok) return problem(v, section, view.code, view.status, context.value.role);
  if ((view.value.role === "owner" ? "owner" : "admin") !== context.value.role)
    return problem(v, section, "product.unavailable", 503, context.value.role);
  return { ...v, product: context.value, view: view.value };
}

function hidden(fields: Readonly<Record<string, string>>): string {
  return Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)
    .join("");
}
function form(
  ctx: Ctx,
  section: Section,
  csrf: string,
  action: string,
  fields: Readonly<Record<string, string>>,
  contents: string,
  className = "app-form",
): string {
  return `<form method="post" class="${className}" action="${esc(sectionPath(ctx, section))}">${hidden({ csrf, action, ...fields })}${contents}</form>`;
}
function button(label: string, variant = ""): string {
  return `<button class="btn${variant ? ` ${variant}` : ""}" type="submit">${esc(label)}</button>`;
}
function confirmation(label: string): string {
  return `<label class="app-confirm"><input type="checkbox" name="confirm" value="yes" required><span>${esc(label)}</span></label>`;
}
function nameOf(p: AdminRef | AdminPerson, m: AdministrationMessages): string {
  return "deleted" in p && p.deleted
    ? m.deleted
    : p.sub === "github-sponsors"
      ? m.githubSponsors
      : p.name || ("email" in p ? p.email : "") || p.sub;
}
function person(p: AdminPerson, m: AdministrationMessages): string {
  return `<div class="app-person"><strong>${esc(nameOf(p, m))}</strong>${p.handle ? `<span>@${esc(p.handle)}</span>` : ""}${p.email ? `<small>${esc(p.email)}</small>` : ""}<small>${esc(p.sub)}</small></div>`;
}
function when(ctx: Ctx, value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat(ctx.lang, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(value));
}
function table(
  label: string,
  headings: readonly string[],
  rows: readonly string[],
  m: AdministrationMessages,
): string {
  if (rows.length === 0) return `<p class="app-note">${esc(m.noChanges)}</p>`;
  return `<div class="app-table-scroll" role="region" aria-label="${esc(label)}" tabindex="0"><table class="app-table"><thead><tr>${headings.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}
function permissionName(id: string, m: AdministrationMessages): string {
  return id === "unbranded-exports" ? m.unbranded : `${m.unknownPermission}: ${id}`;
}

function access(v: Ready, csrf: string): string {
  const m = mOf(v),
    ctx = v.ctx;
  if (v.product.role === "invitee") {
    const invite = v.product.invitation!;
    return `<section class="app-section"><h2>${esc(m.invitationTitle)}</h2><p class="app-note">${esc(m.invitationIntro)}</p><dl class="app-record"><dt>${esc(m.invitedBy)}</dt><dd>${esc(invite.invitedBy.name)}</dd><dt>${esc(m.expires)}</dt><dd>${esc(when(ctx, invite.expiresAt))}</dd></dl><div class="actions">${form(ctx, "access", csrf, "accept", { invitation: invite.id }, button(m.accept, "primary"))}${form(ctx, "access", csrf, "decline", { invitation: invite.id }, button(m.decline))}</div></section>`;
  }
  const view = v.view!;
  const rows = [
    ...view.owners.map(
      (owner) =>
        `<li class="app-row">${person(owner, m)}<span class="badge">${esc(m.owner)}</span></li>`,
    ),
    ...view.administrators.map((admin) => {
      const self = admin.sub === v.current.user.id;
      const canRemove = view.role === "owner" || self;
      const details = `<div>${person(admin, m)}<p class="app-note">${esc(m.invitedBy)}: ${esc(nameOf(admin.invitedBy, m))} · ${esc(m.since)} ${esc(when(ctx, admin.since))}</p></div>`;
      return `<li class="app-row">${details}${canRemove ? form(ctx, "access", csrf, "remove", { sub: admin.sub }, `${confirmation(m.confirmRemove)}${button(self ? m.leave : m.remove, "danger")}`) : `<span class="badge">${esc(m.admin)}</span>`}</li>`;
    }),
  ];
  const invites =
    view.role === "owner"
      ? `<section class="app-section"><h2>${esc(m.invitations)}</h2><p class="app-note">${esc(m.inviteHint)}</p>${form(ctx, "access", csrf, "invite", {}, `<label>${esc(m.email)}<input type="email" name="email" maxlength="254" autocomplete="off" required></label>${button(m.invite, "primary")}`)}${table(
          m.invitations,
          [m.email, m.invitedBy, m.expires, m.actions],
          view.invitations.map(
            (i) =>
              `<tr><td>${esc(i.email)}</td><td>${esc(nameOf(i.invitedBy, m))}</td><td>${esc(when(ctx, i.expiresAt))}</td><td>${form(ctx, "access", csrf, "revoke-invitation", { invitation: i.id }, button(m.revokeInvitation), "inline")}</td></tr>`,
          ),
          m,
        )}<p class="app-note">${esc(m.limits)}</p></section>`
      : "";
  return `<p class="app-note">${esc(m.accessIntro)}</p><section class="app-section"><h2>${esc(m.administrators)}</h2><ul class="app-rows">${rows.join("")}</ul></section>${invites}`;
}

function accountLookup(v: Ready, csrf: string, account = ""): string {
  const m = mOf(v);
  const permissions = v.view!.permissions;
  return form(
    v.ctx,
    "permissions",
    csrf,
    "lookup",
    {},
    `<label>${esc(m.accountIdentifier)}<input type="text" name="account" value="${esc(account)}" maxlength="254" autocomplete="off" spellcheck="false" required></label><p class="app-note">${esc(m.accountHint)}</p><label>${esc(m.permission)}<select name="permission">${permissions.map((p) => `<option value="${esc(p.id)}">${esc(permissionName(p.id, m))}</option>`).join("")}</select></label>${button(m.lookup, "primary")}`,
  );
}

function permissions(v: Ready, csrf: string, selected?: AccountPermission): string {
  const m = mOf(v),
    view = v.view!,
    ctx = v.ctx;
  const explicit = selected?.permission;
  const implied = selected
    ? [...view.owners, ...view.administrators].some((p) => p.sub === selected.sub)
    : false;
  const resolved =
    selected && explicit
      ? `<section class="app-section" id="resolved-account"><h2>${esc(m.account)}</h2>${person(selected, m)}<dl class="app-record"><dt>${esc(m.permission)}</dt><dd>${esc(permissionName(explicit.id, m))}</dd><dt>${esc(m.explicit)}</dt><dd>${esc(explicit.granted ? m.granted : m.notGranted)}</dd><dt>${esc(m.effective)}</dt><dd>${esc(implied ? m.implied : explicit.granted ? m.granted : m.notGranted)}</dd><dt>${esc(m.grantor)}</dt><dd>${esc(explicit.by === "github-sponsors" ? m.githubSponsors : (explicit.by ?? "—"))}</dd><dt>${esc(m.at)}</dt><dd>${esc(when(ctx, explicit.at))}</dd></dl>${form(ctx, "permissions", csrf, "permission", { account: selected.sub, permission: explicit.id, granted: explicit.granted ? "false" : "true" }, button(explicit.granted ? m.revoke : m.grant, explicit.granted ? "" : "primary"))}</section>`
      : "";
  const holders = view.permissions
    .map(
      (p) =>
        `<section class="app-section"><h2>${esc(permissionName(p.id, m))}</h2><p class="app-note">${esc(m.holders)}</p>${table(
          permissionName(p.id, m),
          [m.person, m.grantor, m.at, m.actions],
          p.holders.map(
            (h) =>
              `<tr><td>${person(h, m)}</td><td>${esc(h.by === null ? "—" : nameOf(h.by, m))}</td><td>${esc(when(ctx, h.at))}</td><td>${form(ctx, "permissions", csrf, "permission", { account: h.sub, permission: p.id, granted: "false" }, button(m.revoke), "inline")}</td></tr>`,
          ),
          m,
        )}</section>`,
    )
    .join("");
  return `<p class="app-note">${esc(m.permissionIntro)}</p><p class="app-note">${esc(m.implicitHint)}</p>${accountLookup(v, csrf)}${resolved}${holders}`;
}

function sponsorships(v: Ready, csrf: string): string {
  const m = mOf(v),
    ctx = v.ctx;
  const rows = v.view!.sponsorships.map((s) => {
    const status =
      s.status === "active"
        ? m.active
        : s.status === "cancelled"
          ? m.cancelled
          : m.pendingCancellation;
    const amount = new Intl.NumberFormat(ctx.lang, { style: "currency", currency: "USD" }).format(
      s.amountCents / 100,
    );
    return `<tr><td><strong>${esc(s.login)}</strong>${s.type === "Organization" ? `<br><span class="badge">${esc(m.organization)}</span>` : ""}${s.privacy === "private" ? `<br><span class="badge">${esc(m.private)}</span>` : ""}</td><td>${esc(amount)}<br>${esc(s.oneTime ? m.oneTime : m.monthly)}</td><td>${esc(status)}</td><td>${s.claimedBy ? person(s.claimedBy, m) : `<span>${esc(m.unclaimed)}</span><details><summary>${esc(m.manualGrant)}</summary><p class="app-note">${esc(m.sponsorGrantHint)}</p>${form(ctx, "permissions", csrf, "lookup", { permission: "unbranded-exports" }, `<label>${esc(m.accountIdentifier)}<input type="text" name="account" maxlength="254" autocomplete="off" required></label>${button(m.lookup)}`)}</details>`}</td><td>${esc(when(ctx, s.createdAt))}</td></tr>`;
  });
  return `<p class="app-note">${esc(m.sponsorIntro)}</p><p class="app-note">${esc(m.retainedGrant)}</p>${table(m.sponsorships, [m.sponsor, `${m.amount} / ${m.frequency}`, m.status, m.claimedBy, m.at], rows, m)}`;
}

function publications(v: Ready, csrf: string): string {
  const m = mOf(v);
  return `<p class="app-note">${esc(m.publicationIntro)}</p><dl class="app-record"><dt>${esc(m.publishingHost)}</dt><dd>${esc(v.view!.publishHost ?? m.notConfigured)}</dd></dl>${form(v.ctx, "publications", csrf, "takedown", {}, `<label>${esc(m.publicationAddress)}<input type="text" name="publication" maxlength="2048" autocomplete="off" spellcheck="false" required></label><p class="app-note">${esc(m.publicationHint)}</p><label>${esc(m.reason)}<textarea name="reason" maxlength="500" rows="3"></textarea></label>${confirmation(m.confirmTakedown)}${button(m.takedown, "danger")}`)}<p class="app-note">${esc(m.noPublicationDirectory)}</p>`;
}

function activity(v: Ready): string {
  const m = mOf(v);
  const actions: Readonly<Record<string, string>> = {
    invite: m.logInvite,
    "revoke-invitation": m.logRevokeInvitation,
    accept: m.logAccept,
    decline: m.logDecline,
    remove: m.logRemove,
    leave: m.logLeave,
    grant: m.logGrant,
    revoke: m.logRevoke,
    takedown: m.logTakedown,
  };
  return `<p class="app-note">${esc(m.activityIntro)}</p>${table(
    m.activity,
    [m.at, m.actor, m.action, m.target, m.detail],
    v.view!.log.map(
      (entry) =>
        `<tr><td>${esc(when(v.ctx, entry.at))}</td><td>${esc(nameOf(entry.by, m))}</td><td>${esc(actions[entry.action] ?? entry.action)}</td><td>${esc(entry.target === null ? "—" : "email" in entry.target ? entry.target.email : nameOf(entry.target, m))}</td><td>${esc(entry.detail)}</td></tr>`,
    ),
    m,
  )}`;
}

async function render(v: Ready, section: Section, selected?: AccountPermission): Promise<Response> {
  const csrf = await csrfToken(v.ctx, v.current.session.sid);
  const content =
    section === "access"
      ? access(v, csrf)
      : section === "permissions"
        ? permissions(v, csrf, selected)
        : section === "sponsorships"
          ? sponsorships(v, csrf)
          : section === "publications"
            ? publications(v, csrf)
            : activity(v);
  const notice =
    v.ctx.url.searchParams.get("saved") === "1"
      ? `<p class="app-message success" role="status">${esc(mOf(v).saved)}</p>`
      : "";
  return page(v, section, notice + content, v.product.role);
}

/** Central orientation remains available to owners even while the product service is down. */
export const adminPage: Route = async (ctx) => {
  const v = await visitor(ctx);
  if (v instanceof Response) return v;
  const context = await productContext(v.ctx, v.current);
  if (!v.owner && (!context.ok || context.value.role === "none"))
    return context.ok ? notFound(v.ctx) : problem(v, "overview", context.code, context.status);
  const m = mOf(v);
  let enabled: boolean | undefined;
  if (v.owner) {
    try {
      enabled = await v.ctx.deps.store.getDocsAi();
    } catch {
      /* A failed state read is not enabled. */
    }
  }
  const docs = v.owner
    ? `<section class="app-service-row"><div><h2>${esc(m.docs)}</h2><p>${esc(enabled === true ? m.enabled : enabled === false ? m.disabled : m.unavailable)}</p><span class="badge">${esc(m.global)}</span></div><p class="app-note">${esc(m.docsIntro)}</p><a class="btn" href="${esc(at(v.ctx, "/admin/docs-ai"))}">${esc(m.manage)}</a></section>`
    : "";
  const product = context.ok
    ? `<section class="app-service-row"><div><h2>${esc(m.diagrams)}</h2><p>${esc(m[context.value.role])}</p></div><p class="app-note">${esc(context.value.role === "none" ? m.productDenied : m.diagramsIntro)}</p>${context.value.role !== "none" ? `<a class="btn" href="${esc(sectionPath(v.ctx, "access"))}">${esc(m.manage)}</a>` : ""}</section>`
    : `<section class="app-section"><h2>${esc(m.diagrams)}</h2><p class="app-message problem">${esc(m.productUnavailable)}</p><a class="btn" href="${esc(at(v.ctx, "/admin/"))}">${esc(m.retry)}</a></section>`;
  return page(
    v,
    "overview",
    `<h2>${esc(m.serviceState)}</h2>${docs}${product}<p class="app-note">${esc(m.localIde)}</p>`,
    context.ok ? context.value.role : "none",
  );
};

export const diagramsAdminPage: Route = async (ctx) => {
  const section = sectionOf(ctx);
  if (!section) return notFound(ctx);
  const v = await visitor(ctx);
  if (v instanceof Response) return v;
  const data = await ready(v, section);
  return data instanceof Response ? data : render(data, section);
};

/** Only the URL-encoded forms this application emits; bounded before parsing. */
async function boundedForm(request: Request): Promise<FormData | undefined> {
  if (
    !/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(
      request.headers.get("Content-Type") ?? "",
    )
  )
    return undefined;
  if (Number(request.headers.get("Content-Length")) > 8_192) return undefined;
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 8_192) {
        void reader.cancel().catch(() => {});
        return undefined;
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const form = new FormData();
    for (const [key, value] of new URLSearchParams(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ))
      form.append(key, value);
    return form;
  } catch {
    return undefined;
  }
}

const ACTION_FIELDS: Readonly<
  Record<string, { readonly section: Section; readonly fields: readonly string[] }>
> = {
  invite: { section: "access", fields: ["email"] },
  "revoke-invitation": { section: "access", fields: ["invitation"] },
  remove: { section: "access", fields: ["sub", "confirm"] },
  accept: { section: "access", fields: ["invitation"] },
  decline: { section: "access", fields: ["invitation"] },
  lookup: { section: "permissions", fields: ["account", "permission"] },
  permission: { section: "permissions", fields: ["account", "permission", "granted"] },
  takedown: { section: "publications", fields: ["publication", "reason", "confirm"] },
};

/** A publication address must name exactly the product's configured host or a bare handle/slug. */
export function publicationAt(
  value: string,
  publishHost: string | null,
): { handle: string; slug: string } | undefined {
  let path = value.trim();
  if (!/^[a-z0-9-]+\/[a-z0-9-]+\/?$/.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return undefined;
    }
    if (
      url.protocol !== "https:" ||
      publishHost === null ||
      url.host !== publishHost ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return undefined;
    path = url.pathname.replace(/^\//, "");
  }
  const [handle = "", slug = "", ...rest] = path.replace(/\/$/, "").split("/");
  return rest.length === 0 && /^[a-z0-9-]{3,30}$/.test(handle) && /^[a-z0-9-]{1,60}$/.test(slug)
    ? { handle, slug }
    : undefined;
}

export const diagramsAdminPost: Route = async (ctx) => {
  const section = sectionOf(ctx);
  if (!section) return notFound(ctx);
  const v = await visitor(ctx);
  if (v instanceof Response) return v;
  const form = await boundedForm(ctx.request);
  if (
    !form ||
    ctx.request.headers.get("Origin") !== new URL(ctx.config.issuer).origin ||
    (await checkAccountForm(v.ctx, v.current, form))
  )
    return problem(v, section, "request.forbidden", 403);
  const action = form.get("action"),
    spec = typeof action === "string" ? ACTION_FIELDS[action] : undefined;
  if (!spec || spec.section !== section) return problem(v, section, "request.invalid", 400);
  const fields = ["csrf", "action", ...spec.fields];
  if (
    [...form.keys()].some((key) => !fields.includes(key)) ||
    fields.some((key) => form.getAll(key).length !== 1)
  )
    return problem(v, section, "request.invalid", 400);
  const get = (key: string) => String(form.get(key) ?? "").trim();
  // Reject malformed targets and missing confirmations before any private request.
  if (
    (action === "invite" && !validEmail(get("email"))) ||
    (["accept", "decline", "revoke-invitation"].includes(String(action)) &&
      !/^[0-9a-f]{32}$/.test(get("invitation"))) ||
    (action === "remove" && (!validAccount(get("sub")) || get("sub").length > 200)) ||
    (["lookup", "permission"].includes(String(action)) &&
      (!validAccount(get("account")) || !/^[a-z][a-z0-9-]{0,99}$/.test(get("permission")))) ||
    (["remove", "takedown"].includes(String(action)) && get("confirm") !== "yes") ||
    (action === "permission" && get("granted") !== "true" && get("granted") !== "false")
  )
    return problem(v, section, "request.invalid", 400);
  const data = await ready(v, section);
  if (data instanceof Response) return data;
  const productRole = data.product.role;
  if ((action === "invite" || action === "revoke-invitation") && productRole !== "owner")
    return notFound(v.ctx);
  if (action === "accept" || action === "decline") {
    if (productRole !== "invitee" || data.product.invitation?.id !== get("invitation"))
      return notFound(v.ctx);
  } else if (productRole === "invitee") return notFound(v.ctx);
  if (
    action === "remove" &&
    (data.view!.owners.some((p) => p.sub === get("sub")) ||
      !data.view!.administrators.some((p) => p.sub === get("sub")) ||
      (productRole !== "owner" && get("sub") !== v.current.user.id))
  )
    return notFound(v.ctx);
  if (action === "lookup" || action === "permission") {
    if (!data.view!.permissions.some((p) => p.id === get("permission")))
      return problem(v, section, "request.invalid", 400, productRole);
    if (action === "lookup") {
      const result = await productAccount(v.ctx, v.current, get("account"), get("permission"));
      return result.ok
        ? render(data, "permissions", result.value)
        : problem(v, section, result.code, result.status, productRole);
    }
    // Saves target a resolved account ID, never an email or an inferred GitHub login.
    if (get("account").includes("@"))
      return problem(v, section, "request.invalid", 400, productRole);
  }
  let result: ProductOutcome<null>;
  switch (action) {
    case "invite":
      result = await productAction(v.ctx, v.current, { kind: "invite", email: get("email") });
      break;
    case "revoke-invitation":
      result = await productAction(v.ctx, v.current, {
        kind: "revokeInvitation",
        id: get("invitation"),
      });
      break;
    case "remove":
      result = await productAction(v.ctx, v.current, { kind: "remove", sub: get("sub") });
      break;
    case "accept":
    case "decline":
      result = await productAction(v.ctx, v.current, { kind: action, id: get("invitation") });
      break;
    case "permission":
      result = await productAction(v.ctx, v.current, {
        kind: "permission",
        account: get("account"),
        permission: get("permission"),
        granted: get("granted") === "true",
      });
      break;
    case "takedown": {
      const target = publicationAt(get("publication"), data.view!.publishHost);
      const reason = get("reason");
      if (
        !target ||
        Array.from(reason).length > 500 ||
        /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u.test(reason.replace(/[\n\t]/g, ""))
      )
        return problem(v, section, "request.invalid", 400, productRole);
      result = await productAction(v.ctx, v.current, { kind: "takedown", ...target, reason });
      break;
    }
    default:
      return problem(v, section, "request.invalid", 400, productRole);
  }
  if (!result.ok) return problem(v, section, result.code, result.status, productRole);
  const next =
    (action === "remove" && get("sub") === v.current.user.id) || action === "decline"
      ? at(v.ctx, "/account")
      : sectionPath(v.ctx, section);
  return redirect(`${next}${next.includes("?") ? "&" : "?"}saved=1`, [], 303);
};
