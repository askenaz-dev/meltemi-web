// The Ask dialog in the browser (design decision 7). It sends one question at a time to
// `/api/ask`, shows the answer as text (never as HTML: every node is made with `textContent`), turns
// each `[n]` into a link to the page it names, and lists the sources. When answers are paused,
// limited or unavailable it says so and offers the search, which always works.

import { isProduct } from "../search-scope.js";

interface Words {
  readonly lang: string;
  readonly limit: number;
  readonly counter: string;
  readonly thinking: string;
  readonly checking: string;
  readonly notCovered: string;
  readonly allowance: string;
  readonly disabled: string;
  readonly control: string;
  readonly rateLimit: string;
  readonly index: string;
  readonly invalid: string;
  readonly error: string;
  readonly source: string;
  readonly sections: Record<string, string>;
}

export interface Source {
  readonly n: number;
  readonly title: string;
  readonly url: string;
  readonly lang: string;
}

/** A source's address, if it is a page of the portal: nothing else is ever linked. */
export function safeUrl(url: string): string | undefined {
  return /^\/[a-z0-9._~/%#-]*$/i.test(url) && !url.startsWith("//") ? url : undefined;
}

/** The answer's paragraphs as nodes: text, and a link for each `[n]` that names a source. */
export function answerNodes(
  doc: Document,
  answer: string,
  sources: readonly Source[],
  words: Pick<Words, "source">,
): HTMLParagraphElement[] {
  const byNumber = new Map(sources.map((s) => [s.n, s]));
  return answer
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const p = doc.createElement("p");
      for (const part of text.split(/(\[\d+\])/)) {
        const cited = /^\[(\d+)\]$/.exec(part);
        const source = cited ? byNumber.get(Number(cited[1])) : undefined;
        const href = source && safeUrl(source.url);
        if (source && href) {
          const a = doc.createElement("a");
          a.className = "ask-cite";
          a.href = href;
          a.textContent = part;
          a.setAttribute("aria-label", `${words.source} ${source.n}: ${source.title}`);
          a.title = source.title;
          p.append(a);
        } else if (part) {
          p.append(doc.createTextNode(part));
        }
      }
      return p;
    });
}

type Problem = "allowance" | "disabled" | "control" | "limit" | "index" | "invalid" | "error";

/** What the dialog says for an answer that is not one. */
export function problemOf(status: number, reason: string | undefined): Problem {
  if (status === 400) return "invalid";
  if (status === 429) return "limit";
  if (status === 503 && reason === "disabled") return "disabled";
  if (status === 503 && reason === "control") return "control";
  if (status === 503 && reason === "index") return "index";
  if (status === 503) return "allowance";
  return "error";
}

class MeltemiAsk extends HTMLElement {
  #controller: AbortController | undefined;

  connectedCallback(): void {
    const words = JSON.parse(this.dataset["words"] ?? "{}") as Words;
    const open = this.querySelector<HTMLButtonElement>("[data-open]")!;
    const dialog = this.querySelector<HTMLDialogElement>("dialog")!;
    const close = this.querySelector<HTMLButtonElement>("[data-close]")!;
    const form = this.querySelector<HTMLFormElement>("form")!;
    const scope = this.querySelector<HTMLSelectElement>("[data-scope-select]")!;
    const field = this.querySelector<HTMLTextAreaElement>("textarea")!;
    const counter = this.querySelector<HTMLElement>(".ask-counter")!;
    const submit = this.querySelector<HTMLButtonElement>(".ask-submit")!;
    const result = this.querySelector<HTMLElement>(".ask-result")!;
    const status = this.querySelector<HTMLElement>(".ask-status")!;
    const statusText = status.querySelector<HTMLElement>("[data-status-text]")!;
    const answer = this.querySelector<HTMLElement>(".ask-answer")!;
    const sourcesBox = this.querySelector<HTMLElement>(".ask-sources")!;
    const list = sourcesBox.querySelector("ol")!;
    const problem = this.querySelector<HTMLElement>(".ask-problem")!;
    const problemText = problem.querySelector("p")!;
    const search = this.querySelector<HTMLButtonElement>("[data-search]")!;
    let enabled = false;
    let working = false;

    const count = () => {
      const used = [...field.value].length;
      counter.textContent = words.counter
        .replace("{used}", String(used))
        .replace("{limit}", String(words.limit));
      counter.classList.toggle("ask-counter-full", used >= words.limit);
    };
    const reset = () => {
      status.hidden = true;
      answer.hidden = true;
      answer.replaceChildren();
      sourcesBox.hidden = true;
      list.replaceChildren();
      problem.hidden = true;
    };
    const busy = (on: boolean, message = words.thinking) => {
      working = on;
      result.setAttribute("aria-busy", String(on));
      submit.disabled = on || !enabled;
      if (on) statusText.textContent = message;
      status.hidden = !on;
    };
    const fail = (kind: Problem) => {
      if (kind === "disabled" || kind === "control") enabled = false;
      problemText.textContent = {
        allowance: words.allowance,
        disabled: words.disabled,
        control: words.control,
        limit: words.rateLimit,
        index: words.index,
        invalid: words.invalid,
        error: words.error,
      }[kind];
      problem.hidden = false;
      problem.dataset["kind"] = kind;
    };
    const refreshStatus = async () => {
      this.#controller?.abort();
      const controller = new AbortController();
      this.#controller = controller;
      enabled = false;
      reset();
      busy(true, words.checking);
      try {
        const response = await fetch("/api/ask/status", {
          cache: "no-store",
          credentials: "omit",
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => ({}))) as { enabled?: unknown };
        if (this.#controller !== controller || !dialog.open) return;
        if (!response.ok || typeof body.enabled !== "boolean") fail("control");
        else if (!body.enabled) fail("disabled");
        else enabled = true;
      } catch (error) {
        if (this.#controller === controller && (error as Error).name !== "AbortError") {
          fail("control");
        }
      } finally {
        if (this.#controller === controller) busy(false);
      }
    };

    open.hidden = false;
    open.addEventListener("click", () => {
      dialog.showModal();
      field.focus();
      void refreshStatus();
    });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      this.#controller?.abort();
      this.#controller = undefined;
      busy(false);
    });
    field.addEventListener("input", count);
    scope.addEventListener("change", () => {
      this.#controller?.abort();
      this.#controller = undefined;
      reset();
      busy(false);
      if (!enabled) void refreshStatus();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
    search.addEventListener("click", () => {
      dialog.close();
      const searchScope = document.querySelector<HTMLSelectElement>(
        "site-search [data-scope-select]",
      );
      if (searchScope) {
        searchScope.value = scope.value;
        searchScope.dispatchEvent(new Event("change"));
      }
      // Open the other modal after this click and this dialog's close event have finished.
      setTimeout(
        () =>
          document.querySelector<HTMLButtonElement>("site-search button[data-open-modal]")?.click(),
        0,
      );
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!enabled || working) return;
      const question = field.value.trim();
      reset();
      if (!question || [...question].length > words.limit) {
        fail("invalid");
        return;
      }
      this.#controller?.abort();
      const controller = new AbortController();
      this.#controller = controller;
      busy(true);
      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            lang: words.lang,
            ...(isProduct(scope.value) ? { section: scope.value } : {}),
          }),
          signal: controller.signal,
          credentials: "omit",
        });
        const body = (await response.json().catch(() => ({}))) as {
          answer?: string;
          sources?: Source[];
          reason?: string;
        };
        if (this.#controller !== controller || !dialog.open) return;
        if (!response.ok || typeof body.answer !== "string") {
          fail(problemOf(response.status, body.reason));
          return;
        }
        const sources = Array.isArray(body.sources) ? body.sources : [];
        answer.replaceChildren(...answerNodes(document, body.answer, sources, words));
        answer.hidden = false;
        for (const source of sources) {
          const href = safeUrl(source.url);
          if (!href) continue;
          const item = document.createElement("li");
          const link = document.createElement("a");
          link.href = href;
          link.textContent = source.title;
          const section = document.createElement("span");
          section.className = "ask-source-section";
          const key = href.replace(/^\/es\//, "/").split("/")[1] ?? "";
          section.textContent = words.sections[key] ?? "";
          item.append(link, section);
          list.append(item);
        }
        sourcesBox.hidden = sources.length === 0;
      } catch (error) {
        if (this.#controller === controller && (error as Error).name !== "AbortError")
          fail("error");
      } finally {
        if (this.#controller === controller) busy(false);
      }
    });
    count();
  }
}

/** Registers `<meltemi-ask>`, once. */
export function defineAsk(): void {
  if (!customElements.get("meltemi-ask")) customElements.define("meltemi-ask", MeltemiAsk);
}
