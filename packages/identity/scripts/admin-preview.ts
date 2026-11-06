// Offline visual fixture, never bundled or deployed. Real identity handlers/sessions with a
// deliberately in-memory product service. Start: pnpm exec tsx packages/identity/scripts/admin-preview.ts
import { createServer } from "node:http";
import { readConfig } from "../src/config.js";
import { sessionFromToken } from "../src/session.js";
import type { AdminPerson, AdminView, ProductContext } from "../src/product-admin.js";
import type { AccountLanguage, AccountTheme } from "../src/preferences.js";
import { harness, signedInPerson, type SeededPerson } from "../test/support/index.js";

const port = Number(process.env["ADMIN_PREVIEW_PORT"] ?? 8891);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port");
const origin = `http://127.0.0.1:${port}`;
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
const error = (code: string, status = 404) =>
  json({ code, message: "Offline product fixture" }, status);
const people = new Map<string, AdminPerson>();
const sessions = new Map<string, SeededPerson>();
const emptyState = () => ({
  administrators: new Map<string, { invitedBy: { sub: string; name: string }; since: string }>(),
  invitations: new Map<string, AdminView["invitations"][number]>(),
  grants: new Map<string, { by: string; at: string }>(),
  log: [] as AdminView["log"][number][],
  publications: new Set(["owner/welcome", "diagrams/sample"]),
  outage: false,
});
const instances = { production: emptyState(), staging: emptyState() };
const { administrators, invitations, grants } = instances.production;
let sequence = 1;
const ownerId = "preview-owner";

const service = (environment: "production" | "staging") => ({
  fetch: async (request: Request): Promise<Response> => {
    const state = instances[environment];
    const { administrators, invitations, grants, log, publications } = state;
    if (state.outage) return error("internal", 503);
    const token = /^Bearer (\S+)$/.exec(request.headers.get("Authorization") ?? "")?.[1];
    const current = token
      ? await sessionFromToken({ config: readConfig(h.env), deps: h.deps }, token)
      : undefined;
    if (!current) return error("auth.required", 401);
    const sub = current.user.id;
    const known = people.get(sub);
    if (known) people.set(sub, { ...known, name: current.user.name });
    const role = sub === ownerId ? "owner" : administrators.has(sub) ? "admin" : "none";
    const email = current.claims.email.toLowerCase();
    const invite = current.claims.email_verified
      ? [...invitations.values()].find((i) => i.email === email)
      : undefined;
    const url = new URL(request.url);
    if (
      url.origin !==
        (environment === "staging"
          ? "https://staging.diagrams.meltemi.dev"
          : "https://diagrams.meltemi.dev") ||
      url.search
    )
      return error("not-found");
    const path = url.pathname;
    if (path === "/context" && request.method === "GET") {
      const context: ProductContext = {
        role: role !== "none" ? role : invite ? "invitee" : "none",
        invitation:
          role === "none" && invite
            ? {
                id: invite.id,
                invitedBy: { name: invite.invitedBy.name },
                expiresAt: invite.expiresAt,
              }
            : null,
      };
      return json(context);
    }
    const body: Record<string, unknown> = request.body
      ? ((await request.json()) as Record<string, unknown>)
      : {};
    const ref = (id: string) => ({ sub: id, name: people.get(id)?.name ?? "" });
    const record = (action: string, target: AdminView["log"][number]["target"], detail = "") => {
      h.clock.advance(1000);
      log.unshift({ at: h.clock.now().toISOString(), by: ref(sub), action, target, detail });
    };
    const respondInvitation = /\/api\/admin\/invitations\/([0-9a-f]{32})\/(accept|decline)$/.exec(
      path,
    );
    if (respondInvitation && request.method === "POST") {
      const pending = invitations.get(respondInvitation[1]!);
      if (!pending || pending.email !== email || !current.claims.email_verified)
        return error("not-found");
      if (respondInvitation[2] === "accept")
        administrators.set(sub, {
          invitedBy: pending.invitedBy,
          since: h.clock.now().toISOString(),
        });
      invitations.delete(pending.id);
      record(respondInvitation[2]!, ref(sub));
      return new Response(null, { status: 204 });
    }
    if (role === "none") return error("not-found");
    const resolved = (target: AdminPerson) => ({
      ...target,
      permission: {
        id: "unbranded-exports",
        granted: grants.has(target.sub),
        by: grants.get(target.sub)?.by ?? null,
        at: grants.get(target.sub)?.at ?? null,
      },
    });
    if (path === "/account-permission" && request.method === "POST") {
      if (body["permission"] !== "unbranded-exports") return error("not-found");
      const exact = String(body["account"] ?? "");
      const matches = [...people.values()].filter(
        (p) =>
          p.sub === exact ||
          `@${p.handle}` === exact ||
          p.email.toLowerCase() === exact.toLowerCase(),
      );
      return matches.length === 1
        ? json(resolved(matches[0]!))
        : error(
            matches.length > 1 ? "account.ambiguous" : "not-found",
            matches.length > 1 ? 409 : 404,
          );
    }
    if (path === "/api/admin" && request.method === "GET") {
      const view: AdminView = {
        role: role === "owner" ? "owner" : "administrator",
        owners: [people.get(ownerId)!],
        administrators: [...administrators].map(([id, metadata]) => ({
          ...people.get(id)!,
          ...metadata,
        })),
        invitations: role === "owner" ? [...invitations.values()] : [],
        permissions: [
          {
            id: "unbranded-exports",
            holders: [...grants].map(([id, metadata]) => ({
              ...people.get(id)!,
              by: ref(metadata.by),
              at: metadata.at,
            })),
          },
        ],
        log: log.slice(0, 50),
        publishHost: "meltemi.page",
        sponsorships: [
          {
            login: `${environment}-Example-Organization`,
            type: "Organization",
            oneTime: false,
            amountCents: 1500,
            status: "active",
            createdAt: h.clock.now().toISOString(),
            privacy: "private",
            claimedBy: null,
          },
        ],
      };
      return json(view);
    }
    if (path === "/api/admin/invitations" && request.method === "POST") {
      if (role !== "owner") return error("not-found");
      const email = String(body["email"] ?? "").toLowerCase();
      if ([...administrators.keys(), ownerId].some((id) => people.get(id)?.email === email))
        return error("admin.already", 409);
      const pending = [...invitations.values()].find((i) => i.email === email);
      if (pending) return json(pending);
      const createdAt = h.clock.now().toISOString();
      const invitation = {
        id: (sequence++).toString(16).padStart(32, "0"),
        email,
        invitedBy: ref(sub),
        createdAt,
        expiresAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
      };
      invitations.set(invitation.id, invitation);
      record("invite", { email });
      return json(invitation, 201);
    }
    const revoke = /^\/api\/admin\/invitations\/([0-9a-f]{32})$/.exec(path);
    if (revoke && request.method === "DELETE") {
      const target = invitations.get(revoke[1]!);
      if (role !== "owner" || !target) return error("not-found");
      invitations.delete(target.id);
      record("revoke-invitation", { email: target.email });
      return new Response(null, { status: 204 });
    }
    const remove = /^\/api\/admin\/administrators\/([^/]+)$/.exec(path);
    if (remove && request.method === "DELETE") {
      const target = decodeURIComponent(remove[1]!);
      if ((role !== "owner" && sub !== target) || !administrators.has(target))
        return error("not-found");
      administrators.delete(target);
      record(sub === target ? "leave" : "remove", ref(target));
      return new Response(null, { status: 204 });
    }
    const permission = /^\/api\/admin\/accounts\/([^/]+)\/permissions\/unbranded-exports$/.exec(
      path,
    );
    if (permission && request.method === "PUT") {
      const target = people.get(decodeURIComponent(permission[1]!));
      if (!target || typeof body["granted"] !== "boolean") return error("request.invalid", 400);
      if (body["granted"]) grants.set(target.sub, { by: sub, at: h.clock.now().toISOString() });
      else grants.delete(target.sub);
      record(body["granted"] ? "grant" : "revoke", ref(target.sub), "unbranded-exports");
      return json(resolved(target));
    }
    const publication = /^\/api\/admin\/publications\/([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(path);
    if (publication && request.method === "DELETE") {
      const address = `${publication[1]}/${publication[2]}`;
      if (!publications.delete(address)) return error("not-found");
      record("takedown", null, `${address}: ${String(body["reason"] ?? "")}`);
      return new Response(null, { status: 204 });
    }
    return error("not-found");
  },
});

const h = await harness({
  env: {
    DEV: "true",
    ISSUER: origin,
    SITE_URL: "https://meltemi.dev",
    DEV_ORIGINS: origin,
    ADMIN_SUBS: ownerId,
    DIAGRAMS_ADMIN: service("production"),
    DIAGRAMS_ADMIN_STAGING: service("staging"),
  },
});
const examples = [
  ["owner", ownerId, "Ana Montes", "ana", "owner@example.com"],
  ["admin", "preview-admin", "Administradora de Diagrams", "administrator", "admin@example.com"],
  ["invitee", "preview-invitee", "Invitada a Diagrams", "invitee", "invitee@example.com"],
  [
    "ordinary",
    "preview-ordinary",
    "Nombre largo de una persona con una cuenta personal de Meltemi",
    "ordinary",
    "ordinary@example.com",
  ],
] as const;
for (const [role, id, name, handle, email] of examples) {
  const person = await signedInPerson(h, { id, name, handle, email });
  sessions.set(role, person);
  people.set(id, { sub: id, name, handle, email });
}
administrators.set("preview-admin", {
  invitedBy: { sub: ownerId, name: "Ana Montes" },
  since: h.clock.now().toISOString(),
});
invitations.set("a".repeat(32), {
  id: "a".repeat(32),
  email: "invitee@example.com",
  invitedBy: { sub: ownerId, name: "Ana Montes" },
  createdAt: h.clock.now().toISOString(),
  expiresAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
});
grants.set("preview-ordinary", { by: ownerId, at: h.clock.now().toISOString() });
instances.staging.administrators.set("preview-ordinary", {
  invitedBy: { sub: ownerId, name: "Ana Montes" },
  since: h.clock.now().toISOString(),
});
instances.staging.grants.set("preview-admin", { by: ownerId, at: h.clock.now().toISOString() });
instances.staging.invitations.set("b".repeat(32), {
  id: "b".repeat(32),
  email: "invitee@example.com",
  invitedBy: { sub: ownerId, name: "Ana Montes" },
  createdAt: h.clock.now().toISOString(),
  expiresAt: new Date(h.clock.now().getTime() + 7 * 86400000).toISOString(),
});

const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? "/", origin);
    if (url.origin !== origin) {
      outgoing.writeHead(400).end();
      return;
    }
    if (url.pathname === "/__fixture/session") {
      const role = url.searchParams.get("role") ?? "owner";
      const person = sessions.get(role);
      if (!person) {
        outgoing.writeHead(400).end();
        return;
      }
      const askedTheme = url.searchParams.get("theme"),
        askedLanguage = url.searchParams.get("lang");
      const theme: AccountTheme =
        askedTheme === "light" || askedTheme === "dark" ? askedTheme : "system";
      const language: AccountLanguage =
        askedLanguage === "en" || askedLanguage === "es" ? askedLanguage : "system";
      await h.store.setAccountAppearance(person.user.id, { theme, language });
      const path = role === "ordinary" ? "/account/profile" : "/admin/";
      const query = new URLSearchParams({
        environment: url.searchParams.get("environment") === "staging" ? "staging" : "production",
      });
      if (language !== "system") query.set("lang", language);
      outgoing
        .writeHead(303, {
          "Set-Cookie": `${person.cookie}; Path=/; HttpOnly; SameSite=Lax`,
          Location: `${path}?${query}`,
          "Cache-Control": "no-store",
        })
        .end();
      return;
    }
    if (url.pathname === "/__fixture/outage") {
      const environment =
        url.searchParams.get("environment") === "staging" ? "staging" : "production";
      instances[environment].outage = url.searchParams.get("enabled") === "1";
      outgoing.writeHead(303, { Location: `/admin/?environment=${environment}` }).end();
      return;
    }
    if (url.pathname === "/__fixture/state") {
      const environment =
        url.searchParams.get("environment") === "staging" ? "staging" : "production";
      const { administrators, invitations, grants, publications, log, outage } =
        instances[environment];
      const response = json({
        environment,
        outage,
        administrators: [...administrators.keys()],
        invitations: [...invitations.values()],
        grants: [...grants.keys()],
        publications: [...publications],
        log,
        docsAi: await h.store.getDocsAi(),
      });
      outgoing.writeHead(200, Object.fromEntries(response.headers)).end(await response.text());
      return;
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of incoming) {
      bytes += chunk.length;
      if (bytes > 32 * 1024) {
        outgoing.writeHead(413).end();
        return;
      }
      chunks.push(chunk as Uint8Array);
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const response = await h.request(url.href, {
      method: incoming.method,
      headers,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    });
    for (const [name, value] of response.headers)
      if (name.toLowerCase() !== "set-cookie") outgoing.setHeader(name, value);
    if (response.headers.has("Set-Cookie"))
      outgoing.setHeader("Set-Cookie", response.headers.getSetCookie());
    outgoing.writeHead(response.status).end(Buffer.from(await response.arrayBuffer()));
  } catch {
    outgoing.writeHead(500, { "Content-Type": "text/plain" }).end("Offline preview request failed");
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Offline administration preview: ${origin}/__fixture/session?role=owner&lang=es&theme=light`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
