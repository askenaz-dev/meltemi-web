import { describe, expect, it, vi } from "vitest";
import { readAiControl, DOCS_AI_CONTROL_URL } from "../src/ai-control.js";
import { handle } from "../src/bindings.js";

describe("fresh operational control", () => {
  it.each([true, false])("reads the boolean %s without personal headers", async (enabled) => {
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.url).toBe(DOCS_AI_CONTROL_URL);
      expect(request.method).toBe("GET");
      expect(request.cache).toBe("no-store");
      expect([...request.headers]).toEqual([["accept", "application/json"]]);
      expect(await request.text()).toBe("");
      return Response.json({ enabled });
    });
    expect(await readAiControl(fetcher)).toBe(enabled ? "enabled" : "disabled");
    expect(await readAiControl(fetcher)).toBe(enabled ? "enabled" : "disabled");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([null, [], {}, { enabled: "true" }, { enabled: true, extra: 1 }])(
    "fails closed on malformed state %j",
    async (value) => {
      expect(await readAiControl(async () => Response.json(value))).toBe("unavailable");
    },
  );

  it("fails closed on status errors, rejected reads and bad JSON", async () => {
    for (const read of [
      async () => Response.json({ enabled: true }, { status: 503 }),
      async () => {
        throw new Error("offline");
      },
      async () => new Response("<html>broken</html>"),
    ])
      expect(await readAiControl(read)).toBe("unavailable");
  });

  it("bounds a control request even when the binding ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const reading = readAiControl(() => new Promise(() => {}));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await reading).toBe("unavailable");
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("status and static assets", () => {
  it("reports disabled without calling AI and serves guides and search assets unchanged", async () => {
    const ai = vi.fn();
    const assets = vi.fn(async (request: Request) => new Response(new URL(request.url).pathname));
    const env = {
      AI: { run: ai },
      ASSETS: { fetch: assets },
      IDENTITY: { fetch: async () => Response.json({ enabled: false }) },
    };
    for (const path of ["/api/ask/status", "/api/ask/status/"]) {
      const response = await handle(new Request(`https://docs.meltemi.dev${path}`), env);
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({ enabled: false });
    }
    for (const path of ["/es/diagrams/local-compose/", "/pagefind/pagefind.js"]) {
      expect(await (await handle(new Request(`https://docs.meltemi.dev${path}`), env)).text()).toBe(
        path,
      );
    }
    expect(ai).not.toHaveBeenCalled();
    expect(assets).toHaveBeenCalledTimes(2);
  });

  it("fails closed without a binding and refuses mutation methods", async () => {
    const env = { ASSETS: { fetch: vi.fn() } };
    const url = "https://docs.meltemi.dev/api/ask/status";
    const response = await handle(new Request(url), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ enabled: false, reason: "control" });
    expect((await handle(new Request(url, { method: "POST" }), env)).status).toBe(405);
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });
});
