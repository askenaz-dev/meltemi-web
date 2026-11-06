import type { Ctx } from "./context.js";
import type { ProductRole } from "./pages/app.js";
import type { CurrentSession } from "./session.js";
import { parseSessionCookie } from "./verify.js";

/** A private service binding is the only transport. This destination is never caller supplied. */
export const DIAGRAMS_ADMIN_ORIGIN = "https://diagrams.meltemi.dev";
export const DIAGRAMS_ADMIN_STAGING_ORIGIN = "https://staging.diagrams.meltemi.dev";
export type ProductEnvironment = "production" | "staging";

/** The two capabilities are explicit and never fall back to each other. */
export function productEnvironment(ctx: Pick<Ctx, "url">): ProductEnvironment | undefined {
  const values = ctx.url.searchParams.getAll("environment");
  if (values.length === 0) return "production";
  return values.length === 1 && (values[0] === "production" || values[0] === "staging")
    ? values[0]
    : undefined;
}

/** Carry product context through the application without changing unrelated legacy form URLs. */
export function appPath(
  ctx: Pick<Ctx, "url" | "lang">,
  path: string,
  selected?: ProductEnvironment,
): string {
  const environment = selected ?? productEnvironment(ctx);
  const query = new URLSearchParams({ lang: ctx.lang });
  if (
    environment &&
    (path === "/admin/" ||
      path.startsWith("/admin/diagrams/") ||
      ctx.url.searchParams.has("environment"))
  )
    query.set("environment", environment);
  return `${path}?${query}`;
}

export const workspacePath = appPath;
const RESPONSE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 5_000;

export interface ProductContext {
  readonly role: ProductRole;
  readonly invitation: null | {
    readonly id: string;
    readonly invitedBy: { readonly name: string };
    readonly expiresAt: string;
  };
}

export interface AdminPerson {
  readonly sub: string;
  readonly name: string;
  readonly handle: string | null;
  readonly email: string;
}
export interface AdminRef {
  readonly sub: string;
  readonly name: string;
  readonly deleted?: true;
}
export interface AdminInvitation {
  readonly id: string;
  readonly email: string;
  readonly invitedBy: AdminRef;
  readonly createdAt: string;
  readonly expiresAt: string;
}
export interface AdminView {
  readonly role: "owner" | "administrator";
  readonly owners: readonly AdminPerson[];
  readonly administrators: readonly (AdminPerson & {
    readonly invitedBy: AdminRef;
    readonly since: string;
  })[];
  readonly invitations: readonly AdminInvitation[];
  readonly permissions: readonly {
    readonly id: string;
    readonly holders: readonly (AdminPerson & {
      readonly by: AdminRef | null;
      readonly at: string | null;
    })[];
  }[];
  readonly log: readonly {
    readonly at: string;
    readonly by: AdminRef;
    readonly action: string;
    readonly target: AdminRef | { readonly email: string } | null;
    readonly detail: string;
  }[];
  readonly publishHost: string | null;
  readonly sponsorships: readonly {
    readonly login: string;
    readonly type: string;
    readonly oneTime: boolean;
    readonly amountCents: number;
    readonly status: "active" | "pending-cancellation" | "cancelled";
    readonly createdAt: string;
    readonly privacy: "public" | "private";
    readonly claimedBy: AdminPerson | null;
  }[];
}
export interface AccountPermission extends AdminPerson {
  readonly permission: {
    readonly id: string;
    readonly granted: boolean;
    readonly by: string | null;
    readonly at: string | null;
  };
}

export type ProductOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly code: string };

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid product response");
  return value as ObjectValue;
}
function keys(
  value: ObjectValue,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw new Error("Invalid product fields");
}
function text(value: unknown, max = 2_000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid product text");
  return value;
}
function identifier(value: unknown): string {
  const result = text(value, 200);
  if (result === "" || /[\p{Cc}\p{Cs}]/u.test(result))
    throw new Error("Invalid product identifier");
  return result;
}
function date(value: unknown): string {
  const result = text(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result)))
    throw new Error("Invalid product date");
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid product boolean");
  return value;
}
function array<T>(value: unknown, read: (item: unknown) => T, max = 10_000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Invalid product list");
  return value.map(read);
}
function person(value: unknown): AdminPerson {
  const row = object(value);
  return {
    sub: identifier(row["sub"]),
    name: text(row["name"]),
    handle: row["handle"] === null ? null : text(row["handle"], 30),
    email: text(row["email"], 254),
  };
}
function ref(value: unknown): AdminRef {
  const row = object(value);
  keys(row, ["sub", "name"], ["deleted"]);
  if (row["deleted"] !== undefined && row["deleted"] !== true)
    throw new Error("Invalid deleted reference");
  return {
    sub: identifier(row["sub"]),
    name: text(row["name"]),
    ...(row["deleted"] === true ? { deleted: true as const } : {}),
  };
}
function invitation(value: unknown): AdminInvitation {
  const row = object(value);
  keys(row, ["id", "email", "invitedBy", "createdAt", "expiresAt"]);
  return {
    id: invitationId(row["id"]),
    email: text(row["email"], 254),
    invitedBy: ref(row["invitedBy"]),
    createdAt: date(row["createdAt"]),
    expiresAt: date(row["expiresAt"]),
  };
}
function invitationId(value: unknown): string {
  const result = text(value, 32);
  if (!/^[0-9a-f]{32}$/.test(result)) throw new Error("Invalid product invitation");
  return result;
}

/** No malformed row becomes a plausible empty list or default permission. */
export function parseProductContext(value: unknown): ProductContext {
  const row = object(value);
  keys(row, ["role", "invitation"]);
  const role = row["role"];
  if (role !== "owner" && role !== "admin" && role !== "invitee" && role !== "none")
    throw new Error("Invalid product role");
  const invite = row["invitation"];
  if (invite === null) {
    if (role === "invitee") throw new Error("Missing product invitation");
    return { role, invitation: null };
  }
  if (role !== "invitee") throw new Error("Unexpected product invitation");
  const i = object(invite);
  keys(i, ["id", "invitedBy", "expiresAt"]);
  const by = object(i["invitedBy"]);
  keys(by, ["name"]);
  return {
    role,
    invitation: {
      id: invitationId(i["id"]),
      invitedBy: { name: text(by["name"]) },
      expiresAt: date(i["expiresAt"]),
    },
  };
}

export function parseAdminView(value: unknown): AdminView {
  const row = object(value);
  keys(row, [
    "role",
    "owners",
    "administrators",
    "invitations",
    "permissions",
    "log",
    "publishHost",
    "sponsorships",
  ]);
  const role = row["role"];
  if (role !== "owner" && role !== "administrator") throw new Error("Invalid product role");
  const host = row["publishHost"];
  if (
    host !== null &&
    (typeof host !== "string" || !/^[a-z0-9.-]+(?::\d+)?$/.test(host) || host.length > 253)
  )
    throw new Error("Invalid publication host");
  return {
    role,
    owners: array(
      row["owners"],
      (item) => {
        const o = object(item);
        keys(o, ["sub", "name", "handle", "email"]);
        return person(o);
      },
      100,
    ),
    administrators: array(
      row["administrators"],
      (item) => {
        const o = object(item);
        keys(o, ["sub", "name", "handle", "email", "invitedBy", "since"]);
        return { ...person(o), invitedBy: ref(o["invitedBy"]), since: date(o["since"]) };
      },
      20,
    ),
    invitations: array(row["invitations"], invitation, 10),
    permissions: array(
      row["permissions"],
      (item) => {
        const o = object(item);
        keys(o, ["id", "holders"]);
        return {
          id: identifier(o["id"]),
          holders: array(o["holders"], (item) => {
            const h = object(item);
            keys(h, ["sub", "name", "handle", "email", "by", "at"]);
            return {
              ...person(h),
              by: h["by"] === null ? null : ref(h["by"]),
              at: h["at"] === null ? null : date(h["at"]),
            };
          }),
        };
      },
      100,
    ),
    log: array(
      row["log"],
      (item) => {
        const o = object(item);
        keys(o, ["at", "by", "action", "target", "detail"]);
        const target = o["target"] === null ? null : object(o["target"]);
        if (target && "email" in target) keys(target, ["email"]);
        return {
          at: date(o["at"]),
          by: ref(o["by"]),
          action: identifier(o["action"]),
          target:
            target === null
              ? null
              : "email" in target
                ? { email: text(target["email"], 254) }
                : ref(target),
          detail: text(o["detail"], 4_000),
        };
      },
      50,
    ),
    publishHost: host as string | null,
    sponsorships: array(
      row["sponsorships"],
      (item) => {
        const o = object(item);
        keys(o, [
          "login",
          "type",
          "oneTime",
          "amountCents",
          "status",
          "createdAt",
          "privacy",
          "claimedBy",
        ]);
        const status = o["status"],
          privacy = o["privacy"],
          amount = o["amountCents"];
        if (status !== "active" && status !== "pending-cancellation" && status !== "cancelled")
          throw new Error("Invalid sponsorship status");
        if (privacy !== "public" && privacy !== "private")
          throw new Error("Invalid sponsorship privacy");
        if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)
          throw new Error("Invalid sponsorship amount");
        const claimed = o["claimedBy"];
        if (claimed !== null) keys(object(claimed), ["sub", "name", "handle", "email"]);
        return {
          login: identifier(o["login"]),
          type: text(o["type"], 40),
          oneTime: bool(o["oneTime"]),
          amountCents: amount,
          status,
          createdAt: date(o["createdAt"]),
          privacy,
          claimedBy: claimed === null ? null : person(claimed),
        };
      },
      50,
    ),
  };
}

export function parseAccountPermission(value: unknown): AccountPermission {
  const row = object(value);
  keys(row, ["sub", "name", "handle", "email", "permission"]);
  const permission = object(row["permission"]);
  keys(permission, ["id", "granted", "by", "at"]);
  return {
    ...person(row),
    permission: {
      id: identifier(permission["id"]),
      granted: bool(permission["granted"]),
      by: permission["by"] === null ? null : identifier(permission["by"]),
      at: permission["at"] === null ? null : date(permission["at"]),
    },
  };
}

/** Accepted exact identifiers cannot become URL syntax, path traversal or arbitrary operations. */
export function validAccount(value: string): boolean {
  return (
    value !== "" &&
    value.length <= 254 &&
    value !== "." &&
    value !== ".." &&
    !/[\s\p{Cc}\p{Cs}/\\?#%]/u.test(value)
  );
}
export function validEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value) &&
    !/[\p{Cc}\p{Cs}]/u.test(value)
  );
}

type Operation =
  | { readonly kind: "context" | "load" }
  | { readonly kind: "invite"; readonly email: string }
  | { readonly kind: "revokeInvitation" | "accept" | "decline"; readonly id: string }
  | { readonly kind: "remove"; readonly sub: string }
  | { readonly kind: "lookup"; readonly account: string; readonly permission: string }
  | {
      readonly kind: "permission";
      readonly account: string;
      readonly permission: string;
      readonly granted: boolean;
    }
  | {
      readonly kind: "takedown";
      readonly handle: string;
      readonly slug: string;
      readonly reason: string;
    };

function destination(op: Operation): { method: string; path: string; body?: ObjectValue } {
  const id = encodeURIComponent;
  switch (op.kind) {
    case "context":
      return { method: "GET", path: "/context" };
    case "load":
      return { method: "GET", path: "/api/admin" };
    case "invite":
      if (!validEmail(op.email)) throw new Error("Invalid invitation email");
      return { method: "POST", path: "/api/admin/invitations", body: { email: op.email } };
    case "revokeInvitation":
      return { method: "DELETE", path: `/api/admin/invitations/${invitationId(op.id)}` };
    case "accept":
    case "decline":
      return { method: "POST", path: `/api/admin/invitations/${invitationId(op.id)}/${op.kind}` };
    case "remove":
      if (!validAccount(op.sub) || op.sub.length > 200) throw new Error("Invalid administrator");
      return { method: "DELETE", path: `/api/admin/administrators/${id(op.sub)}` };
    case "lookup":
    case "permission":
      if (!validAccount(op.account) || !/^[a-z][a-z0-9-]{0,99}$/.test(op.permission))
        throw new Error("Invalid permission target");
      return op.kind === "lookup"
        ? {
            method: "POST",
            path: "/account-permission",
            body: { account: op.account, permission: op.permission },
          }
        : {
            method: "PUT",
            path: `/api/admin/accounts/${id(op.account)}/permissions/${op.permission}`,
            body: { granted: op.granted },
          };
    case "takedown":
      if (
        !/^[a-z0-9-]{3,30}$/.test(op.handle) ||
        !/^[a-z0-9-]{1,60}$/.test(op.slug) ||
        Array.from(op.reason).length > 500 ||
        /[\p{Cc}\p{Zl}\p{Zp}\p{Cs}]/u.test(op.reason.replace(/[\n\t]/g, ""))
      )
        throw new Error("Invalid publication target");
      return {
        method: "DELETE",
        path: `/api/admin/publications/${op.handle}/${op.slug}`,
        body: { reason: op.reason },
      };
  }
}

async function readJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get("Content-Type") ?? ""))
    throw new Error("Invalid product content type");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing product body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > RESPONSE_BYTES) throw new Error("Product response too large");
      chunks.push(part.value);
    }
    if (signal.aborted) throw new Error("Product response timed out");
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function call<T>(
  ctx: Ctx,
  current: CurrentSession,
  op: Operation,
  parse: (value: unknown) => T,
): Promise<ProductOutcome<T>> {
  const environment = productEnvironment(ctx);
  if (environment === undefined) return { ok: false, status: 400, code: "request.invalid" };
  const binding =
    environment === "staging" ? ctx.env.DIAGRAMS_ADMIN_STAGING : ctx.env.DIAGRAMS_ADMIN;
  const origin = environment === "staging" ? DIAGRAMS_ADMIN_STAGING_ORIGIN : DIAGRAMS_ADMIN_ORIGIN;
  const token = parseSessionCookie(ctx.request.headers.get("Cookie"));
  if (!binding || !token || token.length > 4_096 || current.session.userId !== current.user.id)
    return { ok: false, status: 503, code: "product.unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = new AbortController();
  try {
    const request = destination(op);
    const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${token}` });
    if (request.body) headers.set("Content-Type", "application/json");
    const incoming = new Request(`${origin}${request.path}`, {
      method: request.method,
      headers,
      cache: "no-store",
      redirect: "manual",
      signal: abort.signal,
      ...(request.body ? { body: JSON.stringify(request.body) } : {}),
    });
    const work = (async (): Promise<ProductOutcome<T>> => {
      const response = await binding.fetch(incoming);
      if (response.redirected || (response.status >= 300 && response.status < 400))
        throw new Error("Product redirect refused");
      if (!response.ok) {
        if (response.status >= 500) return { ok: false, status: 503, code: "product.unavailable" };
        const body = object(await readJson(response, abort.signal));
        const code = text(body["code"], 100);
        if (!/^[a-z][a-z0-9.-]*$/.test(code)) throw new Error("Invalid product error");
        return { ok: false, status: response.status, code };
      }
      if (response.status === 204) return { ok: true, value: parse(null) };
      return { ok: true, value: parse(await readJson(response, abort.signal)) };
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error("Product timeout"));
      }, TIMEOUT_MS);
    });
    return await Promise.race([work, timeout]);
  } catch {
    // Neither sensitive request bodies nor product response contents belong in invocation logs.
    return { ok: false, status: 503, code: "product.unavailable" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function productContext(
  ctx: Ctx,
  current: CurrentSession,
): Promise<ProductOutcome<ProductContext>> {
  return call(ctx, current, { kind: "context" }, parseProductContext);
}
export function productAdministration(
  ctx: Ctx,
  current: CurrentSession,
): Promise<ProductOutcome<AdminView>> {
  return call(ctx, current, { kind: "load" }, parseAdminView);
}
export function productAccount(
  ctx: Ctx,
  current: CurrentSession,
  account: string,
  permission: string,
): Promise<ProductOutcome<AccountPermission>> {
  return call(ctx, current, { kind: "lookup", account, permission }, (value) => {
    const parsed = parseAccountPermission(value);
    if (parsed.permission.id !== permission) throw new Error("Unexpected resolved permission");
    return parsed;
  });
}
/** Actions are fixed operations, not a generic caller-controlled HTTP proxy. */
export function productAction(
  ctx: Ctx,
  current: CurrentSession,
  op: Exclude<Operation, { readonly kind: "context" | "load" } | { readonly kind: "lookup" }>,
): Promise<ProductOutcome<null>> {
  return call(ctx, current, op, (value) => {
    if (op.kind === "invite") {
      if (invitation(value).email !== op.email.toLowerCase())
        throw new Error("Unexpected invitation target");
    } else if (op.kind === "permission") {
      const parsed = parseAccountPermission(value);
      if (
        parsed.sub !== op.account ||
        parsed.permission.id !== op.permission ||
        parsed.permission.granted !== op.granted
      )
        throw new Error("Unexpected saved permission");
    } else if (value !== null) throw new Error("Unexpected action response");
    return null;
  });
}
