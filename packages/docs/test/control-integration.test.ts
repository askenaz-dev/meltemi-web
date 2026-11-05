// The owner form, real identity routing/store/session checks and the production Docs bindings
// share one control. Only AI and static asset bindings are fake; nothing reaches the network.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { identity } from "../../identity/src/handler.js";
import { formsOf, submitForm } from "../../identity/test/support/account.js";
import { harness, signedInPerson } from "../../identity/test/support/index.js";
import { convertSection } from "../scripts/convert.js";
import { buildIndex, fakeEmbedder } from "../scripts/index.js";
import { fixtureSources } from "../scripts/sources.js";
import { DOCS_AI_CONTROL_URL } from "../src/ai-control.js";
import { EMBEDDING_MODEL, fakeEmbed } from "../src/ask-index.js";
import { ASK_MODEL } from "../src/ask.js";
import { forgetIndex, INDEX_PATH, type Env } from "../src/bindings.js";
import worker from "../src/worker.js";

const ADMIN = "/admin/docs-ai?lang=es";
const ORIGIN = "https://docs.meltemi.dev";
const QUESTION = "How do I export a story as a video?";
let index: Uint8Array;

beforeAll(async () => {
  const pages = fixtureSources().flatMap((tree) => convertSection(tree).pages);
  index = (await buildIndex(pages, { model: EMBEDDING_MODEL, embed: fakeEmbedder().embed })).bytes;
});

beforeEach(() => {
  forgetIndex();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new Error("no integration test reaches the network");
    }),
  );
});

afterEach(() => {
  forgetIndex();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function connectedServices() {
  const id = await harness({ env: { ADMIN_SUBS: "docs-owner" } });
  const owner = await signedInPerson(id, { id: "docs-owner" });
  const controls: Request[] = [];
  const assets = new Map([
    ["/diagrams/player/", { body: "English guide", type: "text/html" }],
    ["/es/diagrams/player/", { body: "Guía en español", type: "text/html" }],
    ["/pagefind/pagefind.js", { body: "fixture search script", type: "text/javascript" }],
  ]);
  const staticFetch = vi.fn(async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === INDEX_PATH)
      return new Response(index.slice(), {
        headers: { "Content-Type": "application/octet-stream" },
      });
    const asset = assets.get(path);
    if (!asset) return new Response("not found", { status: 404 });
    return new Response(asset.body, {
      headers: { "Content-Type": asset.type, ETag: '"fixture-static"' },
    });
  });
  const run = vi.fn(async (model: string, input: unknown) => {
    if (model === EMBEDDING_MODEL) {
      const { text } = input as { text: string[] };
      return { data: [Array.from(fakeEmbed(text[0]!))] };
    }
    expect(model).toBe(ASK_MODEL);
    return { response: "Use the export command to export a story as a video [1]." };
  });
  const env: Env = {
    ASSETS: { fetch: staticFetch },
    AI: { run },
    IDENTITY: {
      async fetch(request) {
        expect(request.url).toBe(DOCS_AI_CONTROL_URL);
        expect(request.method).toBe("GET");
        expect(request.cache).toBe("no-store");
        expect([...request.headers]).toEqual([["accept", "application/json"]]);
        expect(await request.clone().text()).toBe("");
        controls.push(request);
        return identity(request, id.env, id.deps);
      },
    },
  };
  const docs = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`${ORIGIN}${path}`, init), env);
  const ask = () =>
    docs("/api/ask", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: ORIGIN,
        Cookie: owner.cookie,
        "CF-Connecting-IP": "203.0.113.9",
      },
      body: JSON.stringify({ question: QUESTION, lang: "en" }),
    });
  const adminForm = async (enabled: boolean) => {
    const response = await id.request(ADMIN, { headers: { Cookie: owner.cookie } });
    expect(response.status).toBe(200);
    const form = formsOf(await response.text()).find(
      (candidate) => candidate.fields["enabled"] === String(enabled),
    );
    expect(form).toBeDefined();
    return form!;
  };
  const unchangedAssets = async () => {
    const reads = controls.length;
    for (const [path, asset] of assets) {
      const response = await docs(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(asset.type);
      expect(response.headers.get("ETag")).toBe('"fixture-static"');
      expect(await response.text()).toBe(asset.body);
    }
    expect(controls).toHaveLength(reads);
  };
  return { id, owner, controls, staticFetch, run, docs, ask, adminForm, unchangedAssets };
}

describe("identity owner controls enforce Docs AI immediately", () => {
  it("pauses from the real owner form and resumes the same Docs isolate without rebuilding its index", async () => {
    const services = await connectedServices();
    const { id, owner, controls, staticFetch, run, docs, ask, adminForm, unchangedAssets } =
      services;
    // Warm the actual production-model index and enabled control in this isolate first.
    expect((await ask()).status).toBe(200);
    expect(run.mock.calls.map(([model]) => model)).toEqual([EMBEDDING_MODEL, ASK_MODEL]);
    run.mockClear();

    const pause = await submitForm(id, await adminForm(false), { cookie: owner.cookie });
    expect(pause.status).toBe(303);
    expect(pause.headers.get("Location")).toBe(ADMIN);
    expect(await id.store.getDocsAi()).toBe(false);
    const status = await docs("/api/ask/status");
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ enabled: false });
    const stopped = await ask();
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toEqual({ reason: "disabled" });
    await unchangedAssets();
    expect(run).not.toHaveBeenCalled();

    const resume = await submitForm(id, await adminForm(true), { cookie: owner.cookie });
    expect(resume.status).toBe(303);
    expect(await id.store.getDocsAi()).toBe(true);
    const reads = controls.length;
    const answered = await ask();
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({
      answer: expect.stringContaining("[1]"),
      sources: [expect.objectContaining({ url: "/diagrams/language/stories/" })],
    });
    expect(run.mock.calls.map(([model]) => model)).toEqual([EMBEDDING_MODEL, ASK_MODEL]);
    expect(controls).toHaveLength(reads + 2);
    expect(
      staticFetch.mock.calls.filter(([request]) => new URL(request.url).pathname === INDEX_PATH),
    ).toHaveLength(1);
    expect(id.stub.calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("refuses a previously rendered owner form after immediate session revocation", async () => {
    const { id, owner, run, docs, ask, adminForm } = await connectedServices();
    await id.store.setDocsAi(false);
    const stale = await adminForm(true);
    await id.store.revokeSession(owner.session.sid, id.clock.now().toISOString());
    const refused = await submitForm(id, stale, { cookie: owner.cookie });
    expect(refused.status).toBe(302);
    expect(refused.headers.get("Location")).toMatch(/^\/login\?/);
    expect(await id.store.getDocsAi()).toBe(false);
    expect(await (await docs("/api/ask/status")).json()).toEqual({ enabled: false });
    const stopped = await ask();
    expect(stopped.status).toBe(503);
    expect(await stopped.json()).toEqual({ reason: "disabled" });
    expect(run).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["missing", "failed"] as const)(
    "reports control failure and performs no AI when identity's saved state is %s",
    async (failure) => {
      const { id, run, docs, ask, unchangedAssets } = await connectedServices();
      vi.spyOn(console, "error").mockImplementation(() => {});
      const read = vi.spyOn(id.store, "getDocsAi");
      if (failure === "missing") read.mockResolvedValue(undefined);
      else read.mockRejectedValue(new Error("identity database unavailable"));
      const status = await docs("/api/ask/status");
      expect(status.status).toBe(503);
      expect(status.headers.get("Cache-Control")).toBe("no-store");
      expect(await status.json()).toEqual({ enabled: false, reason: "control" });
      const stopped = await ask();
      expect(stopped.status).toBe(503);
      expect(await stopped.json()).toEqual({ reason: "control" });
      await unchangedAssets();
      expect(run).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
