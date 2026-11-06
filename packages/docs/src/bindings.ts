// The portal's Worker's bindings (design decision 5): every request is the static assets' but
// `/api/ask` and its operational status; this module builds their dependencies from the bindings. The
// entry, `worker.ts`, exports only the handler, as a Worker module must.
//
// `ASK_STUB = "fixture"` in `.dev.vars` swaps Workers AI for the offline embedder and the stub
// model, so `wrangler dev` answers questions on the fixture build with no account and no network.
// Production declares no such variable.

import { ask, ASK_MODEL, fakeAnswer, MAX_TOKENS, type AskDeps } from "./ask.js";
import { decodeIndex, EMBEDDING_MODEL, FAKE_MODEL, fakeEmbed, type AskIndex } from "./ask-index.js";
import { readAiControl, type AiControlState } from "./ai-control.js";
import { accountMenu } from "./account-menu.js";

export interface Env {
  readonly ASSETS: { fetch(request: Request): Promise<Response> };
  readonly AI?: { run(model: string, input: unknown): Promise<unknown> };
  readonly ASK_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  readonly ASK_STUB?: string;
  readonly IDENTITY?: { fetch(request: Request): Promise<Response> };
}

export const INDEX_PATH = "/ask/index.bin";

/** The index, read once per isolate; a failed read is tried again by the next question. */
let loaded: Promise<AskIndex> | undefined;

function indexOf(env: Env, request: Request): Promise<AskIndex> {
  loaded ??= (async () => {
    const response = await env.ASSETS.fetch(new Request(new URL(INDEX_PATH, request.url)));
    if (!response.ok) throw new Error(`the index answered ${response.status}`);
    return decodeIndex(await response.arrayBuffer());
  })().catch((error: unknown) => {
    loaded = undefined;
    throw error;
  });
  return loaded;
}

/** Forgets the index read by this isolate (the tests load several). */
export function forgetIndex(): void {
  loaded = undefined;
}

/** The text of a Workers AI answer, whichever shape the model gives it in. */
export function answerText(output: unknown): string {
  if (typeof output === "string") return output;
  const o = output as {
    response?: unknown;
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const text = typeof o?.response === "string" ? o.response : o?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || text.trim() === "") throw new Error("Workers AI gave no answer");
  return text;
}

/** The vector of a Workers AI embedding. */
export function embeddingOf(output: unknown): number[] {
  const data = (output as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || !Array.isArray(data[0]))
    throw new Error("Workers AI gave no embedding");
  return data[0] as number[];
}

export function depsFor(env: Env, request: Request): AskDeps {
  const stub = env.ASK_STUB === "fixture";
  const limit = async (key: string) =>
    env.ASK_LIMIT ? (await env.ASK_LIMIT.limit({ key })).success : true;
  const index = () => indexOf(env, request);
  if (stub) {
    return {
      model: FAKE_MODEL,
      embed: async (text) => fakeEmbed(text),
      answer: fakeAnswer,
      limit,
      index,
      control: async () => "enabled",
    };
  }
  const ai = env.AI;
  return {
    model: EMBEDDING_MODEL,
    async embed(text) {
      if (!ai) throw new Error("no AI binding");
      return embeddingOf(await ai.run(EMBEDDING_MODEL, { text: [text] }));
    },
    async answer({ system, user }) {
      if (!ai) throw new Error("no AI binding");
      // GLM-4.7-Flash thinks before it answers unless told not to, and its thinking counts against
      // the completion's tokens: with thinking on, 400 tokens end before the answer begins.
      const output = await ai.run(ASK_MODEL, {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_completion_tokens: MAX_TOKENS,
        chat_template_kwargs: { enable_thinking: false },
      });
      return answerText(output);
    },
    limit,
    index,
    control: () => controlFor(env),
  };
}

/** Offline fixtures are explicit; production never authorizes a missing service binding. */
export async function controlFor(env: Env): Promise<AiControlState> {
  if (env.ASK_STUB === "fixture") return "enabled";
  if (!env.IDENTITY) return "unavailable";
  return readAiControl((request) => env.IDENTITY!.fetch(request));
}

/** The Worker's `fetch`. */
export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/account-menu" || url.pathname === "/api/account-menu/")
    return accountMenu(request, env);
  if (url.pathname === "/api/ask/status" || url.pathname === "/api/ask/status/") {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    };
    if (request.method !== "GET")
      return new Response(JSON.stringify({ reason: "method" }), {
        status: 405,
        headers: { ...headers, Allow: "GET" },
      });
    const control = await controlFor(env);
    return new Response(
      JSON.stringify(
        control === "unavailable"
          ? { enabled: false, reason: "control" }
          : { enabled: control === "enabled" },
      ),
      { status: control === "unavailable" ? 503 : 200, headers },
    );
  }
  if (url.pathname === "/api/ask" || url.pathname === "/api/ask/") {
    try {
      return await ask(request, depsFor(env, request));
    } catch {
      // Nothing of the request is written: not its body, not the error's message.
      console.error("ask: unexpected failure");
      return new Response(JSON.stringify({ reason: "error" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }
  return env.ASSETS.fetch(request);
}
