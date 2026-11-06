import { csrfToken } from "../src/forms.js";
import type { AdminView, ProductContext } from "../src/product-admin.js";
import { harness, signedInPerson } from "./support/index.js";

export const AT = "2026-10-14T12:00:00.000Z";
export const INVITATION = "a".repeat(32);
export const owner = { sub: "owner-1", name: "Owner", handle: "owner", email: "owner@example.com" };
export const administrator = {
  sub: "admin-1",
  name: "Admin",
  handle: "admin",
  email: "admin@example.com",
  invitedBy: { sub: owner.sub, name: owner.name },
  since: AT,
};
export const account = {
  sub: "account-1",
  name: "Person <script>bad()</script>",
  handle: "person",
  email: "person@example.com",
};
export const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

export function adminView(role: "owner" | "administrator" = "owner"): AdminView {
  return {
    role,
    owners: [owner],
    administrators: [administrator],
    invitations:
      role === "owner"
        ? [
            {
              id: INVITATION,
              email: "invitee@example.com",
              invitedBy: { sub: owner.sub, name: owner.name },
              createdAt: AT,
              expiresAt: "2026-10-21T12:00:00.000Z",
            },
          ]
        : [],
    permissions: [
      {
        id: "unbranded-exports",
        holders: [{ ...account, by: { sub: "github-sponsors", name: "GitHub Sponsors" }, at: AT }],
      },
    ],
    log: [
      {
        at: AT,
        by: { sub: owner.sub, name: owner.name },
        action: "takedown",
        target: null,
        detail: "person/page: <img src=x onerror=bad()>",
      },
    ],
    publishHost: "meltemi.page",
    sponsorships: [
      {
        login: "github-person",
        type: "Organization",
        oneTime: false,
        amountCents: 1234,
        status: "cancelled",
        createdAt: AT,
        privacy: "private",
        claimedBy: null,
      },
    ],
  };
}

export async function adminFixture(
  role: ProductContext["role"] = "owner",
  familyOwner = role === "owner",
) {
  const calls: { request: Request; body: string }[] = [];
  let context: ProductContext = {
    role,
    invitation:
      role === "invitee"
        ? { id: INVITATION, invitedBy: { name: "Owner" }, expiresAt: "2026-10-21T12:00:00.000Z" }
        : null,
  };
  let view = adminView(role === "owner" ? "owner" : "administrator");
  const resolved = {
    ...account,
    permission: {
      id: "unbranded-exports",
      granted: false,
      by: null as string | null,
      at: null as string | null,
    },
  };
  let override: ((request: Request) => Response | Promise<Response> | undefined) | undefined;
  const binding = {
    fetch: async (request: Request): Promise<Response> => {
      const body = await request.clone().text();
      calls.push({ request, body });
      const intercepted = await override?.(request);
      if (intercepted) return intercepted;
      const path = new URL(request.url).pathname;
      if (path === "/context") return json(context);
      if (path === "/api/admin" && request.method === "GET") return json(view);
      if (path === "/account-permission") return json(resolved);
      if (path === "/api/admin/invitations" && request.method === "POST")
        return json(
          {
            ...view.invitations[0],
            email: String((JSON.parse(body) as { email: string }).email).toLowerCase(),
          },
          201,
        );
      if (/^\/api\/admin\/accounts\//.test(path) && request.method === "PUT") {
        const granted = (JSON.parse(body) as { granted: boolean }).granted;
        return json({
          ...resolved,
          permission: { ...resolved.permission, granted, by: "owner-1", at: AT },
        });
      }
      return new Response(null, { status: 204 });
    },
  };
  const h = await harness({
    env: { ADMIN_SUBS: familyOwner ? "owner-1" : "", DIAGRAMS_ADMIN: binding },
  });
  const person = await signedInPerson(h, {
    id: role === "owner" || familyOwner ? "owner-1" : role === "admin" ? "admin-1" : "ordinary-1",
  });
  const csrf = await csrfToken({ env: h.env }, person.session.sid);
  const read = (section: string, lang = "en") =>
    h.request(`${section.startsWith("/") ? section : `/admin/diagrams/${section}`}?lang=${lang}`, {
      headers: { Cookie: person.cookie },
    });
  const post = (
    section: string,
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    h.request(`/admin/diagrams/${section}?lang=en`, {
      method: "POST",
      headers: {
        Cookie: person.cookie,
        Origin: h.env.ISSUER,
        "Content-Type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams({ csrf, ...fields }),
    });
  return {
    h,
    person,
    csrf,
    calls,
    read,
    post,
    setContext: (value: ProductContext) => {
      context = value;
    },
    setView: (value: AdminView) => {
      view = value;
    },
    intercept: (value: typeof override) => {
      override = value;
    },
  };
}
