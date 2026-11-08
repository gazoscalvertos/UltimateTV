import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SCREENSAVER, type ScreensaverSettings } from "@ultimatetv/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ArtGallery, searchAic, searchCma, searchMet, type ArtCandidate } from "../src/art.js";

const quiet = { debug() {}, info() {}, warn() {}, error() {} } as never;
let dir: string;
beforeEach(async () => void (dir = await mkdtemp(path.join(os.tmpdir(), "art-"))));
afterEach(() => rm(dir, { recursive: true, force: true }));

const jpeg = (n = 60_000) => new Response(new Uint8Array(n).fill(7), { headers: { "content-type": "image/jpeg" } });
const cand = (source: ArtCandidate["source"], id: string, title = "Water Lilies"): ArtCandidate => ({ source, sourceId: id, title, artist: "Claude Monet", date: "1906", page: `https://example/${id}`, imageUrl: `https://img/${source}/${id}.jpg` });

function gallery(settings: Partial<ScreensaverSettings>, searchers: ConstructorParameters<typeof ArtGallery>[0]["searchers"], fetchImpl?: typeof fetch) {
  return new ArtGallery({ dir, fetchImpl: fetchImpl ?? ((async () => jpeg()) as never), log: quiet, settings: () => ({ ...DEFAULT_SCREENSAVER, ...settings }), searchers });
}

describe("art gallery", () => {
  it("fetches into the chosen collections, keeps them, and serves them by id", async () => {
    const g = gallery({ artCollections: ["impressionism"], artCount: 3 }, { aic: async () => [cand("aic", "1"), cand("aic", "2", "The Bathers")], cma: async () => [cand("cma", "3")], met: async () => [] });
    await g.refill();
    const status = await g.status();
    expect(status.cached).toBe(3);
    expect((await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort()).toEqual(["aic-1.jpg", "aic-2.jpg", "cma-3.jpg"]);
    const all = await g.list();
    expect(all.map((i) => i.id).sort()).toEqual(["aic-1", "aic-2", "cma-3"]);
    expect(all.find((i) => i.id === "aic-1")).toMatchObject({ artist: "Claude Monet", collections: ["impressionism"], kids: true });
    // Kids mode drops the title that isn't suitable.
    expect((await g.list({ kids: true })).map((i) => i.id).sort()).toEqual(["aic-1", "cma-3"]);
    // A fresh gallery on the same folder remembers them (works with no internet).
    const again = gallery({ artCollections: ["impressionism"], artCount: 3 }, {});
    expect((await again.list()).length).toBe(3);
  });

  it("only lists the collections chosen now", async () => {
    const searchers = { aic: async (t: string) => [cand("aic", t.includes("Monet") ? "1" : "9")], cma: async () => [], met: async () => [] };
    const g = gallery({ artCollections: ["impressionism"], artCount: 2 }, searchers);
    await g.refill();
    const other = gallery({ artCollections: ["flowers"] }, {});
    expect(await other.list()).toEqual([]);
  });

  it("stays within the target, skips bad downloads and survives a failing museum", async () => {
    let n = 0;
    const g = gallery(
      { artCollections: ["flowers"], artCount: 2 },
      { aic: async () => { throw new Error("down"); }, cma: async () => [cand("cma", "a"), cand("cma", "b"), cand("cma", "c"), cand("cma", "d")], met: async () => [] },
      (async () => (++n === 1 ? new Response("nope", { status: 500 }) : jpeg())) as never,
    );
    await g.refill();
    const s = await g.status();
    expect(s.cached).toBe(2);
    expect(s.lastError).toContain("down");
  });

  it("shrinks big pictures and drops tiny ones", async () => {
    let shrunk = 0;
    const g = new ArtGallery({
      dir,
      log: quiet,
      settings: () => ({ ...DEFAULT_SCREENSAVER, artCollections: ["flowers"], artCount: 5 }),
      fetchImpl: (async (url: string) => (url.includes("tiny") ? jpeg(100) : jpeg(7 * 1024 * 1024))) as never,
      shrink: async (_in, out) => {
        shrunk++;
        const { writeFile } = await import("node:fs/promises");
        await writeFile(out, Buffer.alloc(80_000));
        return true;
      },
      searchers: { aic: async () => [{ ...cand("aic", "tiny"), imageUrl: "https://img/tiny.jpg" }, cand("aic", "big")], cma: async () => [], met: async () => [] },
    });
    await g.refill();
    expect(shrunk).toBeGreaterThan(0);
    expect((await g.list()).map((i) => i.id)).toEqual(["aic-big"]);
    expect((await g.status()).bytes).toBe(80_000);
  });

  it("clears everything", async () => {
    const g = gallery({ artCollections: ["flowers"], artCount: 2 }, { aic: async () => [cand("aic", "1")], cma: async () => [], met: async () => [] });
    await g.refill();
    await g.clear();
    expect((await g.status()).cached).toBe(0);
    expect((await readdir(dir)).filter((f) => f.endsWith(".jpg"))).toEqual([]);
  });
});

describe("museum searches", () => {
  const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "content-type": "application/json" } });

  it("Art Institute of Chicago: public-domain paintings with an image, as 4K-fit IIIF links", async () => {
    let url = "";
    const f = (async (u: string) => {
      url = u;
      return json({ data: [{ id: 27992, title: "A Sunday on La Grande Jatte", artist_title: "Georges Seurat", date_display: "1884–86", image_id: "abc", artwork_type_title: "Painting", is_public_domain: true }, { id: 2, title: "Vase", image_id: "x", artwork_type_title: "Vase", is_public_domain: true }, { id: 3, title: "Copyrighted", image_id: "y", artwork_type_title: "Painting", is_public_domain: false }] });
    }) as never;
    const out = await searchAic("Seurat", 1, f);
    expect(url).toContain("is_public_domain");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ sourceId: "27992", artist: "Georges Seurat", imageUrl: "https://www.artic.edu/iiif/2/abc/full/!3840,2160/0/default.jpg" });
  });

  it("Cleveland: prefers the print image and trims the artist's details", async () => {
    const f = (async () => json({ data: [{ id: 1, title: "Water Lilies", creators: [{ description: "Claude Monet (French, 1840–1926)" }], creation_date: "1914", url: "https://www.clevelandart.org/art/1", images: { print: { url: "https://p/1.jpg" }, web: { url: "https://w/1.jpg" } } }, { id: 2, title: "No image", images: {} }] })) as never;
    const out = await searchCma("Monet", 1, f);
    expect(out).toEqual([{ source: "cma", sourceId: "1", title: "Water Lilies", artist: "Claude Monet", date: "1914", page: "https://www.clevelandart.org/art/1", imageUrl: "https://p/1.jpg" }]);
  });

  it("the Met: looks each object up and keeps public-domain paintings with an image", async () => {
    const f = (async (u: string) => {
      if (u.includes("/search?")) return json({ objectIDs: [10, 11, 12] });
      if (u.endsWith("/10")) return json({ objectID: 10, isPublicDomain: true, primaryImage: "https://m/10.jpg", title: "Wheat Field", artistDisplayName: "Van Gogh", objectDate: "1889", classification: "Paintings", objectURL: "https://met/10" });
      if (u.endsWith("/11")) return json({ objectID: 11, isPublicDomain: false, primaryImage: "https://m/11.jpg", classification: "Paintings" });
      return json({ objectID: 12, isPublicDomain: true, primaryImage: "", classification: "Paintings" });
    }) as never;
    expect(await searchMet("Van Gogh", 1, f)).toEqual([{ source: "met", sourceId: "10", title: "Wheat Field", artist: "Van Gogh", date: "1889", page: "https://met/10", imageUrl: "https://m/10.jpg" }]);
  });
});
