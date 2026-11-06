import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  FAKE_MODEL,
  decodeIndex,
  encodeIndex,
  fakeEmbed,
  rank,
} from "../src/ask-index.js";
import {
  ask,
  contextPassages,
  CONTEXT_EXTRA_LIMIT,
  CONTEXT_PAGE_LIMIT,
  type Prompt,
} from "../src/ask.js";

type Entry = readonly [page: number, text: string, vector?: ArrayLike<number>];
const indexOf = (entries: readonly Entry[], lang: "en" | "es" = "en") => {
  const prefix = lang === "es" ? "/es" : "";
  return decodeIndex(
    encodeIndex({
      model: FAKE_MODEL,
      dimensions: DIMENSIONS,
      pages: [
        { section: "web", title: "Account", url: `${prefix}/web/account/`, lang },
        { section: "web", title: "Administration", url: `${prefix}/web/admin/`, lang },
        { section: "ide", title: "IDE account", url: `${prefix}/ide/account/`, lang },
        { section: "web", title: "Other page", url: `${prefix}/web/other/`, lang },
      ],
      passages: entries.map(([page, text, vector]) => ({
        page,
        text,
        vector: vector ?? fakeEmbed("context"),
      })),
    }),
  );
};
const post = (question: string, lang: "en" | "es") =>
  new Request("https://docs.meltemi.dev/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, lang, section: "web" }),
  });

describe("bounded context from selected pages", () => {
  it.each(["en", "es"] as const)(
    "includes missing session instructions after unlink/delete hits in %s",
    async (lang) => {
      for (const heading of ["Link or unlink a sign-in", "Delete your account"]) {
        const question =
          lang === "en" ? "How do I sign out other sessions?" : "¿Cómo cierro las otras sesiones?";
        const vector = fakeEmbed(question);
        const opposite = Float32Array.from(vector, (value) => -value);
        const logout =
          lang === "en"
            ? "Check devices and sign out\nSign out of other devices."
            : "Revisar dispositivos y cerrar sesión\nCerrar sesión en los otros dispositivos.";
        const index = indexOf(
          [
            [0, `Account: ${heading}\nRELATED_OPERATION`, vector],
            [0, `Account: ${logout}\nLOGOUT_INSTRUCTIONS`, opposite],
            ...Array.from({ length: 7 }, (_, i): Entry => [1, `Administration ${i}`, vector]),
            [2, "IDE_ONLY", vector],
            [3, "UNSELECTED_WEB_PAGE", opposite],
          ],
          lang,
        );
        const original = rank(index, vector, { section: "web" }).map((hit) => hit.passage);
        expect(original).toHaveLength(8);
        expect(original).not.toContain(1);
        const prompts: Prompt[] = [];
        const response = await ask(post(question, lang), {
          model: FAKE_MODEL,
          index: async () => index,
          embed: async () => vector,
          control: async () => "enabled",
          limit: async () => true,
          answer: async (prompt) => (prompts.push(prompt), "Read the account guide [1]."),
        });
        const body = (await response.json()) as { sources: { url: string }[] };
        expect(response.status).toBe(200);
        expect(response.headers.get("X-Meltemi-Ask-Outcome")).toBe("answered");
        expect(prompts).toHaveLength(1);
        expect(prompts[0]!.user).toContain("LOGOUT_INSTRUCTIONS");
        expect(prompts[0]!.user).not.toContain("IDE_ONLY");
        expect(prompts[0]!.user).not.toContain("UNSELECTED_WEB_PAGE");
        expect(body.sources.map((source) => source.url)).toEqual([
          `${lang === "es" ? "/es" : ""}/web/account/`,
        ]);
      }
    },
  );

  it("keeps original hits first, deduplicates indices and completes pages by best-hit order", () => {
    const index = indexOf([
      [0, "intro"],
      [0, "link"],
      [0, "logout"],
      [1, "intro"],
      [1, "logout"],
      [3, "unselected"],
    ]);
    expect(contextPassages(index, [4, 1, 4])).toEqual([4, 1, 3, 0, 2]);
    expect(contextPassages(index, [])).toEqual([]);
  });

  it("does not complete a long page or lose its original oversized hit", () => {
    const index = indexOf([
      [0, "x".repeat(CONTEXT_PAGE_LIMIT + 1)],
      [0, "missing"],
      [1, "hit"],
      [1, "extra"],
    ]);
    expect(contextPassages(index, [0, 2])).toEqual([0, 2, 3]);
  });

  it("skips an entire addition that exceeds the remaining budget and can still fit a later page", () => {
    const index = indexOf([
      [0, "a"],
      [0, "x".repeat(4000)],
      [1, "b"],
      [1, "x".repeat(500)],
      [1, "x".repeat(2000)],
      [2, "c"],
      [2, "x".repeat(1000)],
    ]);
    const selected = contextPassages(index, [0, 2, 5]);
    expect(selected).toEqual([0, 2, 5, 1, 6]);
    expect(
      selected.slice(3).reduce((sum, passage) => sum + index.text(passage).length + 6, 0),
    ).toBeLessThanOrEqual(CONTEXT_EXTRA_LIMIT);
  });

  it("counts prompt delimiters and accepts exactly the extra-character budget", () => {
    const index = indexOf([
      [0, "a"],
      [0, "x".repeat(2494)],
      [1, "b"],
      [1, "x".repeat(3494)],
      [2, "c"],
      [2, "x"],
    ]);
    const selected = contextPassages(index, [0, 2, 4]);
    expect(selected).toEqual([0, 2, 4, 1, 3]);
    expect(
      selected.slice(3).reduce((sum, passage) => sum + index.text(passage).length + 6, 0),
    ).toBe(CONTEXT_EXTRA_LIMIT);
  });

  it("identifies an empty model answer without exposing retrieval data", async () => {
    const index = indexOf([[0, "Account instructions", fakeEmbed("account")]]);
    const response = await ask(post("account", "en"), {
      model: FAKE_MODEL,
      index: async () => index,
      embed: async () => fakeEmbed("account"),
      control: async () => "enabled",
      limit: async () => true,
      answer: async () => "",
    });
    expect(await response.json()).toEqual({
      answer: "The documentation does not cover this.",
      sources: [],
    });
    expect(response.headers.get("X-Meltemi-Ask-Outcome")).toBe("not-covered");
    expect([...response.headers.keys()].filter((name) => name.startsWith("x-meltemi-ask"))).toEqual(
      ["x-meltemi-ask-outcome"],
    );
  });
});
