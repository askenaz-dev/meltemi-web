/** Only the operational boolean crosses this boundary, never a question or session cookie. */
export const DOCS_AI_CONTROL_URL = "https://id.meltemi.dev/api/docs-ai";
export type AiControlState = "enabled" | "disabled" | "unavailable";
export type ControlFetch = (request: Request) => Promise<Response>;

/** A fresh, bounded read. A malformed, missing or failing control never authorizes AI. */
export async function readAiControl(fetcher: ControlFetch): Promise<AiControlState> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<AiControlState>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("unavailable");
    }, 3000);
  });
  const read = async (): Promise<AiControlState> => {
    try {
      const response = await fetcher(
        new Request(DOCS_AI_CONTROL_URL, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "manual",
          signal: controller.signal,
        }),
      );
      if (response.status !== 200) return "unavailable";
      const body: unknown = await response.json();
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        Object.keys(body).length !== 1 ||
        typeof (body as { enabled?: unknown }).enabled !== "boolean"
      )
        return "unavailable";
      return (body as { enabled: boolean }).enabled ? "enabled" : "disabled";
    } catch {
      return "unavailable";
    }
  };
  try {
    return await Promise.race([read(), timeout]);
  } finally {
    clearTimeout(timer!);
  }
}
