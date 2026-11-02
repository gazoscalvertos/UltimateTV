// The box looking at the TV app itself (box/src/uicheck.ts).
//
// On 2 November the TV app threw while loading and drew nothing, while the Hub answered
// /api/health happily. The box had no way to notice a blank page: it only watched the Hub. These
// tests pin down what it does now.

import { describe, expect, it } from "vitest";
import { UiCheck } from "../src/uicheck.js";

function setup(opts: { drawn?: boolean; busy?: boolean; tries?: number } = {}) {
  const calls: string[] = [];
  const state = { drawn: opts.drawn ?? false, busy: opts.busy ?? false };
  const check = new UiCheck({
    drawn: async () => state.drawn,
    reload: async () => void calls.push("reload"),
    busy: () => state.busy,
    showOffline: (reason) => calls.push(`offline: ${reason}`),
    log: () => undefined,
    tries: opts.tries ?? 3,
    retryMs: 40,
  });
  return { check, calls, state };
}

describe("looking at the TV app", () => {
  it("says nothing when the page drew something, and forgets earlier blanks", async () => {
    const { check, calls, state } = setup();
    await check.check();
    expect(check.state.blanks).toBe(1);
    state.drawn = true;
    expect(await check.check()).toBe("drawn");
    expect(check.state).toEqual({ blanks: 0, givenUp: false });
    expect(calls).toEqual(["reload"]);
  });

  it("loads the app again when it is blank, then shows the box's own screen", async () => {
    const { check, calls } = setup({ tries: 3 });
    expect(await check.check()).toBe("reload");
    expect(await check.check()).toBe("reload");
    expect(calls).toEqual(["reload", "reload"]);
    expect(await check.check()).toBe("offline");
    expect(calls[2]).toContain("offline: The TV app didn't draw anything");
    expect(check.state.givenUp).toBe(true);
  });

  it("says it once, and tries the app again after the wait rather than over and over", async () => {
    const { check, calls } = setup({ tries: 1 });
    expect(await check.check()).toBe("offline");
    expect(calls).toHaveLength(1);
    // The retry timer came round: try the app again.
    expect(await check.check()).toBe("reload");
    expect(calls).toEqual([expect.stringContaining("offline:"), "reload"]);
  });

  it("leaves something that is playing alone", async () => {
    const { check, calls, state } = setup({ busy: true });
    expect(await check.check()).toBe("busy");
    expect(await check.check()).toBe("busy");
    expect(calls).toEqual([]);
    expect(check.state.blanks).toBe(0);
    // Once it has stopped, a blank page is looked at properly.
    state.busy = false;
    expect(await check.check()).toBe("reload");
  });

  it("does not look twice at once, so a slow page cannot be reloaded under itself", async () => {
    const { check } = setup();
    const a = check.check();
    const b = check.check();
    expect(await b).toBe("waiting");
    expect(await a).toBe("reload");
  });

  it("counts a look that failed as blank rather than throwing on the TV", async () => {
    const calls: string[] = [];
    const check = new UiCheck({
      drawn: async () => {
        throw new Error("the page has gone");
      },
      reload: async () => void calls.push("reload"),
      busy: () => false,
      showOffline: (reason) => calls.push(`offline: ${reason}`),
      log: () => undefined,
      tries: 2,
      retryMs: 40,
    });
    expect(await check.check()).toBe("reload");
    expect(await check.check()).toBe("offline");
    expect(calls).toEqual(["reload", expect.stringContaining("offline:")]);
  });
});
