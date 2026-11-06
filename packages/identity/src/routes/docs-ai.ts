import { isDocsAiOwner } from "../administration.js";
import type { Ctx, Route } from "../context.js";
import { checkAccountForm, csrfToken, forbiddenPage, readForm } from "../forms.js";
import { redirect } from "../http.js";
import { messages } from "../messages/index.js";
import { errorPage, esc, simpleError } from "../pages/layout.js";
import { applyAppPreferences, renderAppPage } from "../pages/app.js";
import { currentSession } from "../session.js";
import { workspacePath } from "../product-admin.js";

/** The canonical return address keeps the chosen language, never a caller-supplied target. */
export function docsAiAdminPath(ctx: Pick<Ctx, "lang" | "url">): string {
  return workspacePath(ctx, "/admin/docs-ai");
}

/** An anonymous administrator returns directly here after the existing identity sign-in. */
function signIn(ctx: Ctx): Response {
  const returnTo = `${ctx.config.issuer}${docsAiAdminPath(ctx)}`;
  return redirect(`/login?lang=${ctx.lang}&return_to=${encodeURIComponent(returnTo)}`);
}

function notFound(ctx: Ctx): Response {
  const m = messages(ctx.lang).common;
  const response = simpleError(ctx, 404, "not-found", m.notFoundTitle, m.notFoundBody);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

/** A public, uncacheable boolean only. Errors must never look like permission to run AI. */
export const docsAiStatus: Route = async (ctx) => {
  const enabled = await ctx.deps.store.getDocsAi();
  const available = typeof enabled === "boolean";
  return new Response(JSON.stringify(available ? { enabled } : { reason: "unavailable" }), {
    status: available ? 200 : 503,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
};

/** Owner-only, server-rendered controls; the live session is checked on every read and write. */
export const docsAiAdmin: Route = async (ctx) => {
  const current = await currentSession(ctx);
  if (!current) return signIn(ctx);
  if (!isDocsAiOwner(ctx.env, current.user.id)) return notFound(ctx);
  const preferences = await ctx.deps.store.getAccountPreferences(current.user.id);
  ctx = applyAppPreferences(ctx, preferences);
  const enabled = await ctx.deps.store.getDocsAi();
  const m = messages(ctx.lang).docsAi;
  if (typeof enabled !== "boolean") {
    const response = errorPage(ctx, {
      status: 503,
      code: "docs-ai.unavailable",
      title: m.unavailableTitle,
      message: m.unavailableBody,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const csrf = await csrfToken(ctx, current.session.sid);
  const form = (
    value: boolean,
    label: string,
  ) => `<form method="post" action="${esc(docsAiAdminPath(ctx))}">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<input type="hidden" name="enabled" value="${value}">
<button class="btn${value ? " primary" : " danger"}" type="submit"${enabled === value ? " disabled" : ""}>${esc(label)}</button>
</form>`;
  const body = `<p class="section-intro">${esc(m.intro)}</p>
<section class="settings-section"><p role="status"><strong>${esc(enabled ? m.enabled : m.disabled)}</strong></p>
<p>${esc(m.effect)}</p>
<div class="actions">${form(true, m.enable)}${form(false, m.disable)}</div></section>`;
  return renderAppPage(ctx, {
    title: m.title,
    body,
    user: current.user,
    owner: true,
    active: "docs-ai",
    preferences,
  });
};

/** Explicit assignments are safe to repeat; there is no stale-page toggle. */
export const docsAiPost: Route = async (ctx) => {
  const current = await currentSession(ctx);
  if (!current) return signIn(ctx);
  if (!isDocsAiOwner(ctx.env, current.user.id)) return notFound(ctx);
  const back = {
    href: docsAiAdminPath(ctx),
    label: messages(ctx.lang).docsAi.title,
    primary: true,
  };
  const form = await readForm(ctx.request);
  if (!form) {
    const response = forbiddenPage(ctx, back);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const refused = await checkAccountForm(ctx, current, form);
  if (refused) {
    refused.headers.set("Cache-Control", "no-store");
    return refused;
  }
  const value = form.get("enabled");
  const fields = [...form.keys()];
  if (
    (value !== "true" && value !== "false") ||
    form.getAll("enabled").length !== 1 ||
    form.getAll("csrf").length !== 1 ||
    fields.some((field) => field !== "enabled" && field !== "csrf")
  ) {
    const m = messages(ctx.lang).docsAi;
    const response = errorPage(ctx, {
      status: 400,
      code: "docs-ai.invalid",
      title: m.invalidTitle,
      message: m.invalidBody,
      actions: [back],
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  await ctx.deps.store.setDocsAi(value === "true");
  return redirect(docsAiAdminPath(ctx), [], 303);
};
