import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SelfUpdate } from "../src/selfupdate.js";

const LATEST = "b".repeat(40);

function fakeGitHub(compare: unknown) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    if (url.endsWith("/commits/main")) return new Response(LATEST);
    if (url.includes("/compare/")) return Response.json(compare);
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const commit = (sha: string, message: string) => ({ sha, commit: { message, committer: { date: "2026-10-25T12:00:00Z" } } });

describe("SelfUpdate", () => {
  it("lists the pull requests on main that the Hub hasn't got, newest first", async () => {
    const gh = fakeGitHub({
      ahead_by: 5,
      commits: [
        commit("1", "Add a thing"),
        commit("2", "Merge pull request #25 from x/y\n\nPhone remote: now playing, Watch tab and Stats page"),
        commit("3", "Merge main into the branch"),
        commit("4", "Merge pull request #26 from x/z\n\nPhone remote: arrows work in TV Settings"),
      ],
    });
    const su = new SelfUpdate(await mkdtemp(path.join(os.tmpdir(), "utv-su-")), { commit: "aaaaaaa" }, gh.fetchImpl);
    const sw = await su.status(true);
    expect(sw.latest).toBe(LATEST);
    expect(sw.behind).toBe(5);
    expect(sw.changes?.map((c) => [c.pr, c.title])).toEqual([
      [26, "Phone remote: arrows work in TV Settings"],
      [25, "Phone remote: now playing, Watch tab and Stats page"],
    ]);
    expect(gh.calls.some((u) => u.includes("/compare/aaaaaaa..." + LATEST))).toBe(true);
    // Asked again: answered from the cache.
    await su.status(true);
    expect(gh.calls.filter((u) => u.includes("/compare/"))).toHaveLength(1);
  });

  it("falls back to commit subjects without pull requests, and says 0 when up to date", async () => {
    const gh = fakeGitHub({ ahead_by: 1, commits: [commit("1", "Fix the guide\n\nLonger text")] });
    const dir = await mkdtemp(path.join(os.tmpdir(), "utv-su-"));
    const behind = await new SelfUpdate(dir, { commit: "aaaaaaa" }, gh.fetchImpl).status(true);
    expect(behind.changes).toEqual([{ sha: "1", title: "Fix the guide", date: "2026-10-25T12:00:00Z" }]);
    const current = await new SelfUpdate(dir, { commit: LATEST.slice(0, 7) }, gh.fetchImpl).status(true);
    expect(current.behind).toBe(0);
    expect(current.changes).toBeUndefined();
  });
});

describe("SelfUpdate when GitHub stops answering", () => {
  it("keeps the last answer, shares a check in flight, and falls back to git's endpoint", async () => {
    const calls: string[] = [];
    let api = true;
    let git = true;
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      await new Promise((r) => setTimeout(r, 5));
      if (url.endsWith("/commits/main")) return api ? new Response(LATEST) : new Response("rate limited", { status: 403 });
      if (url.includes("/info/refs")) return git ? new Response(`001e# service=git-upload-pack\n003f${"c".repeat(40)} refs/heads/main\n`) : new Response("", { status: 500 });
      if (url.includes("/compare/")) return Response.json({ ahead_by: 1, commits: [] });
      return new Response("", { status: 404 });
    }) as typeof fetch;
    const su = new SelfUpdate(await mkdtemp(path.join(os.tmpdir(), "utv-su-")), { commit: "aaaaaaa" }, fetchImpl);
    // Three checks at once ask GitHub once.
    const all = await Promise.all([su.status(true), su.status(true), su.status(true)]);
    expect(all.map((s) => s.latest)).toEqual([LATEST, LATEST, LATEST]);
    expect(calls.filter((u) => u.endsWith("/commits/main"))).toHaveLength(1);
    // A status without a check still has the answer (the phone page reloads that way).
    expect((await su.status(false)).latest).toBe(LATEST);

    // Five minutes on, the API is rate limited: git's endpoint answers instead.
    const real = Date.now;
    try {
      Date.now = () => real() + 6 * 60_000;
      api = false;
      expect((await su.status(true)).latest).toBe("c".repeat(40));
      // Both fail later on: the last answer stays, with when it was got.
      Date.now = () => real() + 12 * 60_000;
      git = false;
      const sw = await su.status(true);
      expect(sw.latest).toBe("c".repeat(40));
      expect(sw.checkedAt).toBeDefined();
      // And it doesn't ask again straight away.
      const n = calls.length;
      await su.status(true);
      expect(calls.length).toBe(n);
    } finally {
      Date.now = real;
    }
  });
});
