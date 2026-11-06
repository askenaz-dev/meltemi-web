// Only fresh private discovery reveals administration. No token, role or user is kept in storage.
interface Words {
  readonly account: string;
  readonly checking: string;
}

type Navigation = { authenticated: false } | { authenticated: true; name: string; owner: boolean };

/** Reject malformed state rather than treating truthy values as permission. */
export function readNavigation(value: unknown): Navigation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const state = value as Record<string, unknown>;
  if (state.authenticated === false && Object.keys(state).length === 1)
    return { authenticated: false };
  if (
    state.authenticated === true &&
    typeof state.name === "string" &&
    state.name.length <= 500 &&
    typeof state.owner === "boolean" &&
    Object.keys(state).length === 3
  )
    return { authenticated: true, name: state.name, owner: state.owner };
  return undefined;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/u).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => [...part][0] ?? "")
    .join("")
    .toLocaleUpperCase();
}

class MeltemiAccount extends HTMLElement {
  #controller: AbortController | undefined;
  #cleanup: (() => void) | undefined;

  connectedCallback(): void {
    this.#cleanup?.();
    const words = JSON.parse(this.dataset["words"] ?? "{}") as Words;
    const admin = this.querySelector<HTMLAnchorElement>("[data-account-admin]")!;
    const fallback = this.querySelector<HTMLAnchorElement>("[data-account-fallback]")!;
    const details = this.querySelector<HTMLDetailsElement>("[data-account-details]")!;
    const summary = details.querySelector<HTMLElement>("summary")!;
    const label = this.querySelector<HTMLElement>("[data-account-label]")!;
    const name = this.querySelector<HTMLElement>("[data-account-name]")!;
    const initials = this.querySelector<HTMLElement>("[data-account-initials]")!;
    const icon = this.querySelector<SVGElement>("[data-account-icon]")!;
    const status = this.querySelector<HTMLElement>("[data-account-status]")!;
    const events = new AbortController();
    const options = { signal: events.signal };

    const clear = () => {
      admin.hidden = true;
      name.textContent = "";
      label.textContent = words.account;
      initials.textContent = "";
      initials.hidden = true;
      icon.toggleAttribute("hidden", false);
      summary.setAttribute("aria-label", words.account);
      summary.title = words.account;
    };
    const anonymous = () => {
      const focused = details.contains(document.activeElement);
      details.open = false;
      details.hidden = true;
      fallback.hidden = false;
      status.hidden = true;
      if (focused) fallback.focus();
    };
    const refresh = async () => {
      this.#controller?.abort();
      const controller = new AbortController();
      this.#controller = controller;
      clear();
      status.textContent = words.checking;
      status.hidden = false;
      this.setAttribute("aria-busy", "true");
      const timer = setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch("/api/account-menu", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const state = readNavigation(await response.json().catch(() => undefined));
        if (this.#controller !== controller || !this.isConnected) return;
        if (!response.ok || !state?.authenticated) {
          anonymous();
          return;
        }
        const displayName = state.name.trim() || words.account;
        name.textContent = displayName;
        label.textContent = displayName;
        const letters = initialsOf(displayName);
        initials.textContent = letters;
        initials.hidden = !letters;
        icon.toggleAttribute("hidden", Boolean(letters));
        summary.setAttribute("aria-label", `${words.account}: ${displayName}`);
        summary.title = displayName;
        fallback.hidden = true;
        details.hidden = false;
        admin.hidden = !state.owner;
      } catch {
        if (this.#controller === controller && this.isConnected) anonymous();
      } finally {
        clearTimeout(timer);
        if (this.#controller === controller) {
          status.hidden = true;
          this.setAttribute("aria-busy", "false");
        }
      }
    };
    details.addEventListener(
      "toggle",
      () => {
        if (details.open) void refresh();
      },
      options,
    );
    this.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Escape" && details.open) {
          details.open = false;
          summary.focus();
          event.preventDefault();
          event.stopPropagation();
        }
      },
      options,
    );
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (details.open && !this.contains(event.target as Node)) details.open = false;
      },
      options,
    );
    details.addEventListener(
      "focusout",
      (event) => {
        if (details.open && event.relatedTarget && !details.contains(event.relatedTarget as Node))
          details.open = false;
      },
      options,
    );
    window.addEventListener(
      "focus",
      () => {
        void refresh();
      },
      options,
    );
    window.addEventListener(
      "pageshow",
      (event) => {
        if (event.persisted) void refresh();
      },
      options,
    );
    const suspend = () => {
      this.#controller?.abort();
      this.#controller = undefined;
      clear();
      status.hidden = true;
      this.setAttribute("aria-busy", "false");
    };
    window.addEventListener("pagehide", suspend, options);
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.visibilityState === "visible") void refresh();
        else suspend();
      },
      options,
    );
    this.#cleanup = () => {
      events.abort();
      this.#controller?.abort();
      this.#controller = undefined;
    };
    void refresh();
  }

  disconnectedCallback(): void {
    this.#cleanup?.();
    this.#cleanup = undefined;
  }
}

export function defineAccountMenu(): void {
  if (!customElements.get("meltemi-account"))
    customElements.define("meltemi-account", MeltemiAccount);
}
