// The registrar step, against a stub of Dynadot's api3: it changes a domain only when its
// nameservers differ, adds hosts the account does not know first, refuses what Dynadot refuses,
// and never lets the key reach a message.

import { describe, expect, it } from "vitest";
import { pointNameservers, readDesired, RegistrarError } from "../scripts/dynadot-nameservers.mjs";

const KEY = "secret-key-123";

interface Call {
  readonly command: string;
  readonly parameters: Record<string, string>;
}

/** A stub of the api3 JSON API: the domains' nameservers and the account's servers, in memory. */
function dynadot(state: { ns: Record<string, string[]>; servers: string[]; refuse?: string }) {
  const calls: Call[] = [];
  const doFetch = async (input: string) => {
    const url = new URL(input);
    expect(url.searchParams.get("key")).toBe(KEY);
    const command = url.searchParams.get("command")!;
    const parameters = Object.fromEntries(
      [...url.searchParams].filter(([name]) => name !== "key" && name !== "command"),
    );
    calls.push({ command, parameters });
    const ok = (name: string, content: Record<string, unknown> = {}) =>
      new Response(JSON.stringify({ [name]: { ResponseCode: 0, Status: "success", ...content } }));
    if (state.refuse === command) {
      return new Response(
        JSON.stringify({ X: { ResponseCode: -1, Status: "error", Error: `bad key ${KEY}` } }),
      );
    }
    switch (command) {
      case "get_ns": {
        const hosts = state.ns[parameters["domain"]!] ?? [];
        return ok("GetNsResponse", {
          NsContent: Object.fromEntries(hosts.map((host, i) => [`Host${i}`, host])),
        });
      }
      case "server_list":
        return ok("ServerListResponse", {
          ServerList: state.servers.map((name, i) => ({ ServerId: i, ServerName: name })),
        });
      case "add_ns":
        state.servers.push(parameters["host"]!);
        return ok("AddNsResponse");
      case "set_ns": {
        const hosts = Object.keys(parameters)
          .filter((name) => /^ns\d+$/.test(name))
          .sort()
          .map((name) => parameters[name]!);
        state.ns[parameters["domain"]!] = hosts;
        return ok("SetNsResponse");
      }
      default:
        throw new Error(`unexpected command ${command}`);
    }
  };
  return { calls, fetch: doFetch as unknown as typeof fetch };
}

const CLOUDFLARE = ["amy.ns.cloudflare.com", "lynn.ns.cloudflare.com"];

describe("pointNameservers", () => {
  it("points a domain at the zone's nameservers, adding the hosts the account lacks", async () => {
    const state = {
      ns: { "meltemi.dev": ["ns1.dyna-ns.net", "ns2.dyna-ns.net"] },
      servers: ["ns1.dyna-ns.net"],
    };
    const api = dynadot(state);
    const lines: string[] = [];
    const result = await pointNameservers({
      desired: { "meltemi.dev": CLOUDFLARE },
      key: KEY,
      fetch: api.fetch,
      log: (line: string) => lines.push(line),
    });
    expect(result).toEqual({ "meltemi.dev": "changed" });
    expect(state.ns["meltemi.dev"]).toEqual(CLOUDFLARE);
    expect(
      api.calls.filter((c) => c.command === "add_ns").map((c) => c.parameters["host"]),
    ).toEqual(CLOUDFLARE);
    expect(lines.join("\n")).toContain(
      "now points at amy.ns.cloudflare.com, lynn.ns.cloudflare.com",
    );
    expect(lines.join("\n")).not.toContain(KEY);
  });

  it("changes nothing when the domain already points there, whatever the case or trailing dot", async () => {
    const state = {
      ns: { "meltemi.page": ["AMY.ns.cloudflare.com.", "lynn.ns.cloudflare.com"] },
      servers: [],
    };
    const api = dynadot(state);
    const result = await pointNameservers({
      desired: { "meltemi.page": CLOUDFLARE },
      key: KEY,
      fetch: api.fetch,
      log: () => {},
    });
    expect(result).toEqual({ "meltemi.page": "unchanged" });
    expect(api.calls.map((c) => c.command)).toEqual(["get_ns"]);
  });

  it("only reports with --dry-run", async () => {
    const state = { ns: { "meltemi.dev": ["ns1.dyna-ns.net"] }, servers: [] };
    const api = dynadot(state);
    const result = await pointNameservers({
      desired: { "meltemi.dev": CLOUDFLARE },
      key: KEY,
      fetch: api.fetch,
      log: () => {},
      dryRun: true,
    });
    expect(result).toEqual({ "meltemi.dev": "would change" });
    expect(api.calls.map((c) => c.command)).toEqual(["get_ns"]);
    expect(state.ns["meltemi.dev"]).toEqual(["ns1.dyna-ns.net"]);
  });

  it("handles both domains of the family in one run", async () => {
    const state = {
      ns: { "meltemi.dev": ["ns1.dyna-ns.net"], "meltemi.page": ["ns1.dyna-ns.net"] },
      servers: [],
    };
    const api = dynadot(state);
    const result = await pointNameservers({
      desired: {
        "meltemi.dev": CLOUDFLARE,
        "meltemi.page": ["bob.ns.cloudflare.com", "lynn.ns.cloudflare.com"],
      },
      key: KEY,
      fetch: api.fetch,
      log: () => {},
    });
    expect(result).toEqual({ "meltemi.dev": "changed", "meltemi.page": "changed" });
    expect(api.calls.filter((c) => c.command === "server_list")).toHaveLength(1);
  });

  it("fails on Dynadot's refusal, naming the command and never the key", async () => {
    const api = dynadot({
      ns: { "meltemi.dev": ["ns1.dyna-ns.net"] },
      servers: CLOUDFLARE,
      refuse: "set_ns",
    });
    const failure = pointNameservers({
      desired: { "meltemi.dev": CLOUDFLARE },
      key: KEY,
      fetch: api.fetch,
      log: () => {},
    });
    await expect(failure).rejects.toThrow(RegistrarError);
    await expect(failure).rejects.toThrow(/^set_ns: Dynadot refused: bad key <key>$/);
  });

  it("refuses to run without a key, before any call", async () => {
    const api = dynadot({ ns: {}, servers: [] });
    await expect(
      pointNameservers({
        desired: { "meltemi.dev": CLOUDFLARE },
        key: "",
        fetch: api.fetch,
        log: () => {},
      }),
    ).rejects.toThrow("DYNADOT_API_KEY is not set");
    expect(api.calls).toEqual([]);
  });

  it("refuses a domain with fewer than two nameservers", async () => {
    const api = dynadot({ ns: {}, servers: [] });
    await expect(
      pointNameservers({
        desired: { "meltemi.dev": ["one.ns.cloudflare.com"] },
        key: KEY,
        fetch: api.fetch,
        log: () => {},
      }),
    ).rejects.toThrow("at least two nameservers");
  });
});

describe("readDesired", () => {
  it("reads terraform output -json nameservers", () => {
    expect(readDesired('{"meltemi.dev":["a.ns.cloudflare.com","b.ns.cloudflare.com"]}')).toEqual({
      "meltemi.dev": ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
    });
  });

  it("refuses anything else", () => {
    expect(() => readDesired("[]")).toThrow(RegistrarError);
    expect(() => readDesired('{"meltemi.dev":"a.ns.cloudflare.com"}')).toThrow("not a list");
  });
});
