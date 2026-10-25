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
