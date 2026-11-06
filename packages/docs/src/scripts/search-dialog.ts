import { isProduct } from "../search-scope.js";

interface PagefindUI {
  triggerFilters(filters: Record<string, string[]>): void;
}
interface SearchWords {
  translations: Record<string, string>;
  button: string;
  all: string;
  inProduct: string;
  unavailable: string;
  products: Record<string, string>;
}
declare global {
  interface Window {
    PagefindUI?: new (options: Record<string, unknown>) => PagefindUI;
  }
}

let loading: Promise<void> | undefined;
function loadUI(): Promise<void> {
  if (window.PagefindUI) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/pagefind/pagefind-ui.js";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error("The search UI could not load"));
      },
      { once: true },
    );
    document.head.append(script);
  }).catch((error) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

class SiteSearch extends HTMLElement {
  #ui: PagefindUI | undefined;
  #initializing: Promise<void> | undefined;
  #events: AbortController | undefined;

  connectedCallback(): void {
    if (this.#events) return;
    this.#events = new AbortController();
    const { signal } = this.#events;
    const words = JSON.parse(this.dataset["words"] ?? "{}") as SearchWords;
    const open = this.querySelector<HTMLButtonElement>("[data-open-modal]")!;
    const dialog = this.querySelector<HTMLDialogElement>("dialog")!;
    const select = this.querySelector<HTMLSelectElement>("[data-scope-select]")!;
    const problem = this.querySelector<HTMLElement>(".search-problem")!;
    let returnFocus: HTMLElement | undefined;
    const placeholder = () =>
      isProduct(select.value)
        ? words.inProduct.replace("{product}", words.products[select.value]!)
        : words.all;
    const applyScope = () => {
      const input = this.querySelector<HTMLInputElement>("#starlight__search input");
      const label = isProduct(select.value) ? placeholder() : words.button;
      open.setAttribute("aria-label", label);
      this.querySelector(".search-label")!.textContent = label;
      // A filter without a query makes Pagefind enumerate every matching page. Keep an empty
      // search empty, and apply the selected product in the same input event as the query.
      this.#ui?.triggerFilters(
        input?.value.trim() && isProduct(select.value) ? { product: [select.value] } : {},
      );
      if (input) {
        input.placeholder = placeholder();
        input.title = placeholder();
        input.setAttribute("aria-label", placeholder());
      }
    };
    const initialize = () =>
      (this.#initializing ??= (async () => {
        await loadUI();
        if (!window.PagefindUI || !this.isConnected) throw new Error("Search is unavailable");
        this.#ui = new window.PagefindUI({
          element: "#starlight__search",
          bundlePath: "/pagefind/",
          showImages: false,
          showSubResults: true,
          translations: {
            ...words.translations,
            placeholder: placeholder(),
            search_label: placeholder(),
          },
        });
        applyScope();
      })().catch(() => {
        problem.hidden = false;
        this.#initializing = undefined;
      }));
    const show = async () => {
      if (!dialog.open) {
        const active = document.activeElement;
        returnFocus = active instanceof HTMLElement && active !== document.body ? active : open;
        dialog.showModal();
        document.body.toggleAttribute("data-search-modal-open", true);
      }
      problem.hidden = true;
      await initialize();
      if (dialog.open) this.querySelector<HTMLInputElement>("#starlight__search input")?.focus();
    };
    open.disabled = false;
    const apple = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
    this.querySelector("[data-platform-key]")!.textContent = apple ? "⌘" : "Ctrl";
    this.querySelector<HTMLElement>("kbd")!.hidden = false;
    open.setAttribute("aria-keyshortcuts", apple ? "Meta+K" : "Control+K");
    open.addEventListener("click", () => void show(), { signal });
    this.querySelector("[data-close-modal]")!.addEventListener("click", () => dialog.close(), {
      signal,
    });
    dialog.addEventListener(
      "click",
      (event) => {
        if (
          event.target === dialog ||
          (event.target instanceof Element && event.target.closest("a[href]"))
        )
          dialog.close();
      },
      { signal },
    );
    dialog.addEventListener(
      "close",
      () => {
        document.body.removeAttribute("data-search-modal-open");
        if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
      },
      { signal },
    );
    select.addEventListener("change", applyScope, { signal });
    this.addEventListener(
      "input",
      (event) => {
        if (event.target instanceof HTMLInputElement && event.target.closest("#starlight__search"))
          applyScope();
      },
      { capture: true, signal },
    );
    this.addEventListener(
      "click",
      (event) => {
        if (event.target instanceof Element && event.target.closest(".pagefind-ui__search-clear"))
          this.#ui?.triggerFilters({});
      },
      { capture: true, signal },
    );
    window.addEventListener(
      "keydown",
      (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          if (dialog.open) dialog.close();
          else void show();
        }
      },
      { signal },
    );
  }

  disconnectedCallback(): void {
    this.#events?.abort();
    this.#events = undefined;
    document.body.removeAttribute("data-search-modal-open");
  }
}

export function defineSearch(): void {
  if (!customElements.get("site-search")) customElements.define("site-search", SiteSearch);
}
