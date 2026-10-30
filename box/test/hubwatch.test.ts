import { describe, expect, it } from "vitest";
import { hubAnswers, HubWatch } from "../src/hubwatch.js";

function setup(opts: { busy?: boolean } = {}) {
  const shown: string[] = [];
  const state = { up: true, busy: opts.busy ?? false };
  const watch = new HubWatch({
    probe: async () => state.up,
    showOffline: (reason) => shown.push(`offline: ${reason}`),
    showApp: () => shown.push("app"),
    busy: () => state.busy,
    log: () => undefined,
  });
  return { watch, shown, state };
}

describe("watching the Hub", () => {
  it("shows the box's own screen after a minute of misses, and the app again when the Hub answers", async () => {
    const { watch, shown, state } = setup();
    expect(await watch.check()).toBe(true);
    state.up = false;
    await watch.check();
    await watch.check();
    expect(shown).toEqual([]);
    expect(watch.since).toBeTypeOf("number");
    await watch.check();
    expect(shown).toEqual(["offline: The Hub stopped answering"]);
    expect(watch.mode).toBe("offline");
    await watch.check();
    expect(shown).toHaveLength(1);
    state.up = true;
    await watch.check();
    expect(shown).toEqual(["offline: The Hub stopped answering", "app"]);
    expect(watch.mode).toBe("app");
    expect(watch.since).toBeUndefined();
  });

  it("leaves whatever is playing alone, either way", async () => {
    const { watch, shown, state } = setup({ busy: true });
    state.up = false;
    for (let i = 0; i < 5; i++) await watch.check();
    expect(shown).toEqual([]);
    // A download playing from the box's screen when the Hub comes back.
    watch.wentOffline();
    state.up = true;
    await watch.check();
    expect(shown).toEqual([]);
    state.busy = false;
    await watch.check();
    expect(shown).toEqual(["app"]);
    watch.stop();
  });

  it("asks the Hub's health check", async () => {
    const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await hubAnswers("http://hub", answer({ ok: true }))).toBe(true);
    expect(await hubAnswers("http://hub", answer({ error: "x" }, 502))).toBe(false);
    expect(await hubAnswers("http://hub", (async () => Promise.reject(new Error("ECONNREFUSED"))) as unknown as typeof fetch)).toBe(false);
  });
});
