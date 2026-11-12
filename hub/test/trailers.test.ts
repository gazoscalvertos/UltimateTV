import { describe, expect, it, vi } from "vitest";
import { TrailerStreams } from "../src/trailers.js";
import type { YtDlp } from "../src/ytdlp.js";

const yt = (urls: string[]) => ({ streamUrl: vi.fn(async () => urls.shift() ?? "https://v/x") }) as unknown as YtDlp & { streamUrl: ReturnType<typeof vi.fn> };
const video = (status = 200) => new Response("data", { status, headers: { "content-type": "video/mp4", "content-length": "4" } });

describe("trailer streams (#240)", () => {
  it("refuses a key that isn't a YouTube id", async () => {
    const t = new TrailerStreams(yt([]), vi.fn());
    await expect(t.open("../etc")).rejects.toMatchObject({ statusCode: 404 });
  });
  it("says so when yt-dlp isn't installed", async () => {
    await expect(new TrailerStreams(null, vi.fn()).open("abcDEF12345")).rejects.toMatchObject({ statusCode: 503 });
  });
  it("passes the range on and keeps the address for the next ask", async () => {
    const y = yt(["https://v/a"]);
    const f = vi.fn(async () => video(206));
    const t = new TrailerStreams(y, f as never);
    const r = await t.open("abcDEF12345", "bytes=0-3");
    expect(r.status).toBe(206);
    expect(f).toHaveBeenCalledWith("https://v/a", { headers: { range: "bytes=0-3" } });
    await t.open("abcDEF12345");
    expect(y.streamUrl).toHaveBeenCalledTimes(1);
  });
  it("asks again once when the address has expired", async () => {
    const y = yt(["https://v/old", "https://v/new"]);
    const f = vi.fn(async (u: string) => (u === "https://v/old" ? video(403) : video()));
    const r = await new TrailerStreams(y, f as never).open("abcDEF12345");
    expect(r.status).toBe(200);
    expect(y.streamUrl).toHaveBeenCalledTimes(2);
  });
});
