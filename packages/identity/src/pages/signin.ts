// The pages of the sign-in flow: the chooser, the refusals and the account-exists page. Every value
// goes through `esc`; every word comes from the catalog (`messages/signin.ts`), looked up when the
// page is made.

import type { Ctx } from "../context.js";
import { messages } from "../messages/index.js";
import type { Provider } from "../types.js";
import { errorPage, esc, renderPage, type PageAction } from "./layout.js";

/** `/login` with an optional provider and return address, the address URL-encoded. */
export function loginHref(options: {
  readonly provider?: Provider;
  readonly returnTo?: string | undefined;
}): string {
  const query: string[] = [];
  if (options.provider) query.push(`provider=${options.provider}`);
  if (options.returnTo) query.push(`return_to=${encodeURIComponent(options.returnTo)}`);
  return query.length > 0 ? `/login?${query.join("&")}` : "/login";
}

/** The chooser: the providers as links (never forms), carrying the return address when given. */
export function chooserPage(ctx: Ctx, returnTo: string | undefined): Response {
  const m = messages(ctx.lang).signin;
  const link = (provider: Provider) =>
    `<a href="${esc(loginHref({ provider, returnTo }))}" class="btn">${esc(m.continueWith(m.providers[provider]))}</a>`;
  const body = `<h1>${esc(m.chooserTitle)}</h1>
<p>${esc(m.chooserIntro)}</p>
<div class="providers">
${link("github")}
${link("google")}
</div>
<p class="muted">${esc(m.chooserNote)}</p>`;
  return renderPage(ctx, { title: m.chooserTitle, body });
}

interface Refusal {
  /** Cookies to set on the answer (the callback clears `meltemi_oauth`). */
  readonly setCookies?: readonly string[] | undefined;
}

export function returnToInvalidPage(ctx: Ctx, options: Refusal = {}): Response {
  const m = messages(ctx.lang).signin;
  return errorPage(ctx, {
    code: "return_to.invalid",
    status: 400,
    title: m.returnToInvalidTitle,
    message: m.returnToInvalidBody,
    actions: [{ href: loginHref({}), label: m.chooseAgain, primary: true }],
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

export function providerUnknownPage(ctx: Ctx, returnTo: string | undefined): Response {
  const m = messages(ctx.lang).signin;
  return errorPage(ctx, {
    code: "provider.unknown",
    status: 400,
    title: m.unknownProviderTitle,
    message: m.unknownProviderBody,
    actions: [{ href: loginHref({ returnTo }), label: m.chooseAgain, primary: true }],
  });
}

export function stateMismatchPage(
  ctx: Ctx,
  options: Refusal & { readonly returnTo?: string | undefined },
): Response {
  const m = messages(ctx.lang).signin;
  return errorPage(ctx, {
    code: "state.mismatch",
    status: 400,
    title: m.stateMismatchTitle,
    message: m.stateMismatchBody,
    actions: [
      { href: loginHref({ returnTo: options.returnTo }), label: m.chooseAgain, primary: true },
    ],
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

/** The person declined at the provider: try again, or go back where they came from. */
export function providerDeniedPage(
  ctx: Ctx,
  options: Refusal & { readonly provider: Provider; readonly returnTo: string },
): Response {
  const m = messages(ctx.lang).signin;
  return errorPage(ctx, {
    code: "provider.denied",
    status: 400,
    title: m.deniedTitle,
    message: m.deniedBody(m.providers[options.provider]),
    actions: [
      { href: loginHref({ returnTo: options.returnTo }), label: m.tryAgain, primary: true },
      { href: options.returnTo, label: m.goBack },
    ],
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

/** The provider failed or did not answer; nothing was created. */
export function providerUnavailablePage(
  ctx: Ctx,
  options: Refusal & { readonly provider: Provider; readonly returnTo?: string | undefined },
): Response {
  const m = messages(ctx.lang).signin;
  const label = m.providers[options.provider];
  const actions: PageAction[] = [
    {
      href: loginHref({ provider: options.provider, returnTo: options.returnTo }),
      label: m.tryProviderAgain(label),
      primary: true,
    },
    { href: loginHref({ returnTo: options.returnTo }), label: m.chooseAgain },
  ];
  return errorPage(ctx, {
    code: "provider.unavailable",
    status: 502,
    title: m.unavailableTitle(label),
    message: m.unavailableBody(label),
    actions,
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

/** The link flow met an identity that belongs to someone else: nothing changed. */
export function identityTakenPage(
  ctx: Ctx,
  options: Refusal & { readonly provider: Provider; readonly returnTo: string },
): Response {
  const m = messages(ctx.lang).signin;
  return errorPage(ctx, {
    code: "identity.taken",
    status: 409,
    title: m.takenTitle,
    message: m.takenBody(m.providers[options.provider]),
    actions: [{ href: options.returnTo, label: m.goBack, primary: true }],
    ...(options.setCookies ? { setCookies: options.setCookies } : {}),
  });
}

/**
 * The person is signed in with a new account, and another one already holds their verified email
 * from too long ago to be joined on its own: say so, offer the older provider, the account page
 * and the way on.
 */
export function accountExistsPage(
  ctx: Ctx,
  options: {
    readonly name: string;
    readonly email: string;
    /** The provider the person just signed in with. */
    readonly provider: Provider;
    /** The provider of the older identity that holds the email. */
    readonly existingProvider: Provider;
    readonly returnTo: string;
    readonly windowDays: number;
    readonly setCookies: readonly string[];
  },
): Response {
  const m = messages(ctx.lang).signin;
  const current = m.providers[options.provider];
  const existing = m.providers[options.existingProvider];
  const body = `<h1>${esc(m.existsTitle)}</h1>
<p>${esc(m.existsIntro(current, existing, options.email, options.windowDays))}</p>
<p class="muted">${esc(m.signedInAs)} <strong>${esc(options.name)}</strong> · <code>${esc(options.email)}</code></p>
<p>${esc(m.existsOptions(existing, current))}</p>
<p class="actions">
<a class="btn primary" href="${esc(loginHref({ provider: options.existingProvider, returnTo: options.returnTo }))}">${esc(m.signInWith(existing))}</a>
<a class="btn" href="/account">${esc(m.openAccount)}</a>
<a class="btn" href="${esc(options.returnTo)}">${esc(m.continue)}</a>
</p>`;
  return renderPage(ctx, {
    title: m.existsTitle,
    body,
    personal: true,
    setCookies: options.setCookies,
  });
}
