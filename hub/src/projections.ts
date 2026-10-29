// Seasonal projections: friendly clips that drift across the TV for a holiday (a sleigh at
// Christmas, a bunny at Easter, fireworks at New Year), the gentle cousin of the jump scares.
// The Hub keeps the settings and works out the season; the clips are the jump scare library's,
// marked as projections; the TV decides when one appears (it knows what's playing) and draws its
// own when no clips are uploaded for the season.
//
// The community library is a JSON index of clips (by default in this project's GitHub repository,
// community/clips/index.json) that any household can download from here, and add to with a pull
// request. Downloaded clips land in the same library as uploads.

import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  activeSeason,
  cleanProjectionSettings,
  DEFAULT_PROJECTION_SETTINGS,
  parseCommunityIndex,
  projectionFrom,
  type CommunityClip,
  type CommunityIndex,
  type DrawnProjection,
  type ProjectionClip,
  type ProjectionSettings,
  type ProjectionState,
  type SeasonId,
} from "@ultimatetv/shared";
import type { HubContext } from "./context.js";
import type { ClipStore, StoredClip } from "./scares.js";

export const DEFAULT_COMMUNITY_URL = "https://raw.githubusercontent.com/gazoscalvertos/UltimateTV/main/community/clips/index.json";
/** The index is fetched at most this often. */
const INDEX_CACHE_MS = 60 * 60_000;
const MAX_DOWNLOAD = 50 * 1024 * 1024;

const asProjectionClip = (c: StoredClip): ProjectionClip => ({
  id: c.id,
  name: c.name,
  kind: c.kind,
  url: c.url,
  season: c.season ?? "any",
  motion: c.motion ?? "across-top",
  ...(c.communityId ? { communityId: c.communityId } : {}),
});

export class Projections {
  private index: { at: number; url: string; value: CommunityIndex } | null = null;

  constructor(
    private readonly ctx: HubContext,
    private readonly clips: ClipStore,
  ) {}

  settings(): ProjectionSettings {
    return cleanProjectionSettings(this.ctx.db.getKv<Partial<ProjectionSettings>>("projections") ?? {}, DEFAULT_PROJECTION_SETTINGS);
  }

  communityUrl(): string {
    return this.ctx.db.getKv<string>("community-url") || DEFAULT_COMMUNITY_URL;
  }

  save(patch: Partial<ProjectionSettings> & { communityUrl?: unknown }): ProjectionState & { communityUrl: string } {
    this.ctx.db.setKv("projections", cleanProjectionSettings(patch, this.settings()));
    if (typeof patch.communityUrl === "string") {
      const url = patch.communityUrl.trim();
      if (url && !/^https?:\/\//.test(url)) throw Object.assign(new Error("The community library address must start with http:// or https://"), { statusCode: 400 });
      this.ctx.db.setKv("community-url", url);
      this.index = null;
    }
    this.ctx.events.emit({ type: "projections.changed" });
    return this.state();
  }

  state(now = new Date()): ProjectionState & { communityUrl: string } {
    const settings = this.settings();
    return {
      settings,
      season: activeSeason(settings, now),
      clips: this.clips.all().filter((c) => c.projection).map(asProjectionClip),
      communityUrl: this.communityUrl(),
    };
  }

  /** Sends one to the TV now. */
  now(want: { clipId?: string; drawn?: DrawnProjection; season?: SeasonId }): void {
    const projection = projectionFrom(this.state(), want, true);
    if (!projection) throw Object.assign(new Error(want.clipId ? "That clip has gone" : "There's no season on, so pick one"), { statusCode: 404 });
    this.ctx.events.emit({ type: "projection", projection });
  }

  /** The community index, marked with what's already here. */
  async community(force = false, now = Date.now()): Promise<CommunityIndex> {
    const url = this.communityUrl();
    if (force || !this.index || this.index.url !== url || now - this.index.at > INDEX_CACHE_MS) {
      let value: CommunityIndex;
      try {
        const res = await this.ctx.fetchImpl(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`The library answered ${res.status}`);
        value = { source: url, clips: parseCommunityIndex(await res.json(), url) };
      } catch (err) {
        value = { source: url, clips: [], error: err instanceof Error ? err.message : String(err) };
      }
      this.index = { at: now, url, value };
    }
    const have = new Set(this.clips.all().map((c) => c.communityId).filter(Boolean));
    return { ...this.index.value, clips: this.index.value.clips.map((c) => ({ ...c, downloaded: have.has(c.id) })) };
  }

  /** Downloads a clip from the community library into this Hub's library. */
  async download(id: string): Promise<StoredClip> {
    const existing = this.clips.all().find((c) => c.communityId === id);
    if (existing) return existing;
    const clip: CommunityClip | undefined = (await this.community()).clips.find((c) => c.id === id);
    if (!clip) throw Object.assign(new Error("That clip isn't in the community library"), { statusCode: 404 });
    const res = await this.ctx.fetchImpl(clip.url, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw Object.assign(new Error(`Couldn't download it (${res.status})`), { statusCode: 502 });
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_DOWNLOAD) throw Object.assign(new Error("That clip is too big"), { statusCode: 413 });
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_DOWNLOAD) throw Object.assign(new Error("That clip is too big"), { statusCode: 413 });
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const stored = await this.clips.keep(body, /^(image|video|audio)\//.test(type) ? type : clip.type, clip.name, {
      projection: clip.use === "projection",
      season: clip.season,
      ...(clip.motion ? { motion: clip.motion } : {}),
      communityId: clip.id,
    });
    this.ctx.events.emit({ type: clip.use === "projection" ? "projections.changed" : "scares.changed" });
    return stored;
  }
}

export function registerProjections(app: FastifyInstance, projections: Projections): void {
  type Req<B> = FastifyRequest<{ Body: B; Params: { id: string }; Querystring: Record<string, string | undefined> }>;
  const body = <T>(req: FastifyRequest) => (req.body && typeof req.body === "object" ? (req.body as T) : ({} as T));
  app.get("/api/projections", async () => projections.state());
  app.put("/api/projections", async (req) => projections.save(body(req)));
  app.post("/api/projections/now", async (req: Req<{ clipId?: string; drawn?: DrawnProjection; season?: SeasonId }>) => {
    const b = body<{ clipId?: string; drawn?: DrawnProjection; season?: SeasonId }>(req);
    projections.now({ ...(b.clipId ? { clipId: b.clipId } : {}), ...(b.drawn ? { drawn: b.drawn } : {}), ...(b.season ? { season: b.season } : {}) });
    return { ok: true };
  });
  app.get("/api/community/clips", async (req: Req<unknown>) => projections.community(Boolean(req.query.refresh)));
  app.post("/api/community/clips/:id/download", async (req: Req<unknown>) => {
    const clip = await projections.download(req.params.id);
    return { clip: { id: clip.id, name: clip.name, kind: clip.kind, url: clip.url }, library: await projections.community() };
  });
}
