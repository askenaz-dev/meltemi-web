import { isDocsAiOwner } from "../administration.js";
import type { Ctx, Route } from "../context.js";
import { checkAccountForm, csrfToken, forbiddenPage } from "../forms.js";
import { redirect } from "../http.js";
import { signJwt } from "../jwt.js";
import { personalizationEn, personalizationEs } from "../messages/personalization.js";
import { applyAppPreferences, renderAppPage } from "../pages/app.js";
import { errorPage, esc } from "../pages/layout.js";
import {
  isAccountLanguage,
  isAccountTheme,
  personalizedUser,
  readDisplayName,
} from "../preferences.js";
import { currentSession, sessionCookie, type CurrentSession } from "../session.js";
import { productContext, productEnvironment, workspacePath } from "../product-admin.js";

const words = (ctx: Ctx) => (ctx.lang === "es" ? personalizationEs : personalizationEn);
const pathOf = (ctx: Ctx, section: "profile" | "preferences") =>
  workspacePath(ctx, `/account/${section}`);

function signIn(ctx: Ctx, section: "profile" | "preferences"): Response {
  const target = `${ctx.config.issuer}${pathOf(ctx, section)}`;
  return redirect(`/login?lang=${ctx.lang}&return_to=${encodeURIComponent(target)}`);
}

/** These forms contain no files and have a small, streamed body cap. */
async function boundedForm(request: Request): Promise<FormData | undefined> {
  if (
    !/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get("Content-Type") ?? "")
  )
    return undefined;
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) {
      await reader.cancel().catch(() => {});
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return undefined;
  }
  const form = new FormData();
  for (const [key, value] of new URLSearchParams(text)) form.append(key, value);
  return form;
}

function fieldsAre(form: FormData, fields: readonly string[]): boolean {
  return (
    [...form.keys()].every((key) => fields.includes(key)) &&
    fields.every((key) => form.getAll(key).length === 1)
  );
}

function failure(ctx: Ctx, status: number, code: string): Response {
  const m = words(ctx);
  const invalid = status === 400;
  const response = errorPage(ctx, {
    status,
    code,
    title: invalid ? m.invalidTitle : m.unavailableTitle,
    message: invalid ? m.invalidBody : m.unavailableBody,
    actions: [{ href: "/account", label: m.back, primary: true }],
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

async function action(
  ctx: Ctx,
  section: "profile" | "preferences",
): Promise<{ current: CurrentSession; form: FormData } | { response: Response }> {
  const current = await currentSession(ctx);
  if (!current) return { response: signIn(ctx, section) };
  const form = await boundedForm(ctx.request);
  const back = { href: pathOf(ctx, section), label: words(ctx).back, primary: true };
  if (!form) return { response: forbiddenPage(ctx, back) };
  const refused = await checkAccountForm(ctx, current, form);
  return refused ? { response: refused } : { current, form };
}

/** Personal profile and preferences use the same workspace as administration. */
async function personalPage(ctx: Ctx, section: "profile" | "preferences"): Promise<Response> {
  const current = await currentSession(ctx);
  if (!current) return signIn(ctx, section);
  const preferences = await ctx.deps.store.getAccountPreferences(current.user.id);
  ctx = applyAppPreferences(ctx, preferences);
  const product = await productContext(ctx, current);
  const m = words(ctx);
  const csrf = await csrfToken(ctx, current.session.sid);
  const notice =
    ctx.url.searchParams.get("saved") === "1"
      ? `<p class="saved-notice" role="status">${esc(m.saved)}</p>`
      : "";
  let body: string;
  if (section === "profile") {
    const original = await ctx.deps.store.userById(current.user.id);
    body = `<p class="section-intro">${esc(m.profileIntro)}</p>${notice}
<section class="settings-section"><form method="post" action="${esc(pathOf(ctx, section))}" class="settings-form">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="field"><label for="display-name">${esc(m.displayName)}</label>
<input id="display-name" name="displayName" type="text" value="${esc(preferences.displayName ?? "")}" maxlength="160" autocomplete="nickname" aria-describedby="name-help">
<p class="field-help" id="name-help">${esc(m.nameHelp)}</p></div>
<dl class="settings-dl"><dt>${esc(m.providerName)}</dt><dd>${esc(original?.name ?? "")}</dd></dl>
<div class="form-actions"><button class="btn primary" type="submit">${esc(m.saveProfile)}</button></div>
</form></section>`;
  } else {
    const options = (choices: readonly [string, string][], chosen: string) =>
      choices
        .map(
          ([value, label]) =>
            `<option value="${esc(value)}"${chosen === value ? " selected" : ""}>${esc(label)}</option>`,
        )
        .join("");
    body = `<p class="section-intro">${esc(m.preferencesIntro)}</p>${notice}
<section class="settings-section"><form method="post" action="${esc(pathOf(ctx, section))}" class="settings-form">
<input type="hidden" name="csrf" value="${esc(csrf)}">
<div class="field"><label for="account-theme">${esc(m.theme)}</label><select id="account-theme" name="theme">${options(
      [
        ["system", m.themeSystem],
        ["light", m.themeLight],
        ["dark", m.themeDark],
      ],
      preferences.theme,
    )}</select></div>
<div class="field"><label for="account-language">${esc(m.language)}</label><select id="account-language" name="language">${options(
      [
        ["system", m.languageSystem],
        ["en", m.english],
        ["es", m.spanish],
      ],
      preferences.language,
    )}</select></div>
<p class="field-help">${esc(m.preferencesHelp)}</p><div class="form-actions"><button class="btn primary" type="submit">${esc(m.savePreferences)}</button></div>
</form></section>`;
  }
  return renderAppPage(ctx, {
    title: section === "profile" ? m.profile : m.preferences,
    body,
    user: current.user,
    owner: isDocsAiOwner(ctx.env, current.user.id),
    active: section,
    preferences,
    productRole: product.ok ? product.value.role : "none",
  });
}

export const profilePage: Route = (ctx) => personalPage(ctx, "profile");
export const preferencesPage: Route = (ctx) => personalPage(ctx, "preferences");

export const profilePost: Route = async (ctx) => {
  const guarded = await action(ctx, "profile");
  if ("response" in guarded) return guarded.response;
  const { current, form } = guarded;
  const name = readDisplayName(form.get("displayName"));
  if (!fieldsAre(form, ["csrf", "displayName"]) || name === undefined)
    return failure(ctx, 400, "profile.invalid");
  try {
    const original = await ctx.deps.store.userById(current.user.id);
    if (!original) return failure(ctx, 503, "profile.unavailable");
    const preferences = await ctx.deps.store.getAccountPreferences(current.user.id);
    const user = personalizedUser(original, { ...preferences, displayName: name });
    // Sign before writing: a signing failure cannot leave an acknowledged-but-unrefreshed profile.
    const token = await signJwt(ctx.deps.keys, { ...current.claims, name: user.name });
    await ctx.deps.store.setDisplayName(current.user.id, name);
    const remaining = Math.max(0, current.claims.exp - Math.floor(ctx.deps.now().getTime() / 1000));
    return redirect(
      `${pathOf(ctx, "profile")}&saved=1`,
      [sessionCookie(ctx.config, token, remaining)],
      303,
    );
  } catch {
    return failure(ctx, 503, "profile.unavailable");
  }
};

export const preferencesPost: Route = async (ctx) => {
  const guarded = await action(ctx, "preferences");
  if ("response" in guarded) return guarded.response;
  const { form, current } = guarded;
  const theme = form.get("theme"),
    language = form.get("language");
  if (
    !fieldsAre(form, ["csrf", "theme", "language"]) ||
    !isAccountTheme(theme) ||
    !isAccountLanguage(language)
  )
    return failure(ctx, 400, "preferences.invalid");
  try {
    await ctx.deps.store.setAccountAppearance(current.user.id, { theme, language });
  } catch {
    return failure(ctx, 503, "preferences.unavailable");
  }
  const query = new URLSearchParams({ saved: "1" });
  if (ctx.url.searchParams.has("environment")) query.set("environment", productEnvironment(ctx)!);
  if (language !== "system") query.set("lang", language);
  return redirect(`/account/preferences?${query}`, [], 303);
};
