// The secrets of the Worker: in production they are Secrets Store bindings named `<NAME>_STORE`,
// read once per isolate; in development and in the tests they are the strings of `.dev.vars`,
// which always win. `resolveSecrets` turns the first into the second at the Worker's entry.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetSecrets, resolveSecrets, type StoredSecret } from "../src/secrets.js";
import worker from "../src/worker.js";
import { testEnv } from "./support/index.js";
import type { Env } from "../src/env.js";

/** A store binding that counts its calls, answering `value` or failing when it is undefined. */
function stored(value: string | undefined): StoredSecret & { calls: number } {
  const binding = {
    calls: 0,
    get() {
      binding.calls += 1;
      return value === undefined
        ? Promise.reject(new Error("secret not found"))
        : Promise.resolve(value);
    },
  };
  return binding;
}

let errors: string[];

beforeEach(() => {
  forgetSecrets();
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    errors.push(parts.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveSecrets", () => {
  it("returns a development string and never calls its binding", async () => {
    const binding = stored("from-the-store");
    const env = await resolveSecrets({
      STATE_SECRET: "from-dev-vars",
      STATE_SECRET_STORE: binding,
    });
    expect(env.STATE_SECRET).toBe("from-dev-vars");
    expect(binding.calls).toBe(0);
  });

  it("reads a secret from its binding when the string is not set", async () => {
    const binding = stored("from-the-store");
    const env = await resolveSecrets<{ STATE_SECRET?: string; STATE_SECRET_STORE: StoredSecret }>({
      STATE_SECRET_STORE: binding,
    });
    expect(env.STATE_SECRET).toBe("from-the-store");
  });

  it("reads a binding when the string is empty, as an unset variable of CI is", async () => {
    const env = await resolveSecrets({ STATE_SECRET: "", STATE_SECRET_STORE: stored("stored") });
    expect(env.STATE_SECRET).toBe("stored");
  });

  it("reads each binding once in the isolate, however many requests ask", async () => {
    const binding = stored("once");
    for (let i = 0; i < 3; i++) {
      const env = await resolveSecrets<{ X_SECRET?: string; X_SECRET_STORE: StoredSecret }>({
        X_SECRET_STORE: binding,
      });
      expect(env.X_SECRET).toBe("once");
    }
    expect(binding.calls).toBe(1);
  });

  it("reads the events secret of any product the same way", async () => {
    const env = await resolveSecrets<Record<string, unknown>>({
      EVENTS_SECRET_DIAGRAMS_STORE: stored("events"),
    });
    expect(env["EVENTS_SECRET_DIAGRAMS"]).toBe("events");
  });

  it("leaves every other binding and variable as it was", async () => {
    const db = { prepare: () => undefined };
    const env = await resolveSecrets<Record<string, unknown>>({
      DB: db,
      ISSUER: "https://id.meltemi.dev",
      STATE_SECRET_STORE: stored("stored"),
    });
    expect(env["DB"]).toBe(db);
    expect(env["ISSUER"]).toBe("https://id.meltemi.dev");
  });

  it("names a secret its binding cannot give, never a value, and asks again next time", async () => {
    const failing = stored(undefined);
    const env = await resolveSecrets<Record<string, unknown>>({ STATE_SECRET_STORE: failing });
    expect(env["STATE_SECRET"]).toBeUndefined();
    expect(errors.join("\n")).toContain("STATE_SECRET");
    await resolveSecrets<Record<string, unknown>>({ STATE_SECRET_STORE: failing });
    expect(failing.calls).toBe(2);
  });

  it("ignores a key that ends in _STORE but is not a binding", async () => {
    const env = await resolveSecrets<Record<string, unknown>>({ OBJECT_STORE: "a string" });
    expect(env["OBJECT"]).toBeUndefined();
  });
});

describe("the Worker's entry", () => {
  const request = () => new Request("https://id.meltemi.dev/.well-known/jwks.json");

  it("answers 500 and names STATE_SECRET in the log when no source gives it", async () => {
    const env = testEnv({ STATE_SECRET: "" }) as Env & Record<string, unknown>;
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).toBe("The service is not configured.");
    expect(body).not.toContain("STATE_SECRET");
    expect(errors.join("\n")).toContain("STATE_SECRET is not set");
  });

  it("answers 500 and names SESSION_PRIVATE_KEY when its binding cannot give it", async () => {
    const env = {
      ...testEnv({ SESSION_PRIVATE_KEY: "" }),
      SESSION_PRIVATE_KEY_STORE: stored(undefined),
    } as Env & Record<string, unknown>;
    const response = await worker.fetch(request(), env);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("SESSION_PRIVATE_KEY");
    expect(errors.join("\n")).toContain("SESSION_PRIVATE_KEY");
  });
});
