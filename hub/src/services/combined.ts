// Several media servers behind one MediaServer: Jellyfin and Plex (or Emby) connected at the same
// time (#217).
//
// The rest of the Hub keeps asking one MediaServer for items and handing the ids back, so the trick
// is in the ids. Everything this class returns carries the server in the item id, `<kind>~<rawId>`
// ("jellyfin~abc", "plex~1234"), so two servers' ids can never collide (Emby's and Plex's are both
// plain numbers) and any later call knows where to go. The Hub's own title ids are untouched
// ("jellyfin:abc", "plex:1234"): key() and parseKey() convert between the two forms, so progress,
// Continue watching's hidden list and Kids' allow list keep working under the same keys.
//
// One server being down never takes the others with it: lists are merged from whichever answered.

import type { Episode, TitleDetails, TitleRef, Trickplay } from "@ultimatetv/shared";
import type { ItemsQuery, JfItem, MediaImageKind, MediaProvider, MediaSegment, MediaServer, MediaServerKind } from "./media.js";

const SEP = "~";

export class CombinedMedia implements MediaServer {
  /** The first server's kind: the one the household set up first. Use kindOf() for an item. */
  readonly kind: MediaServerKind;
  readonly name: string;

  constructor(readonly servers: MediaServer[]) {
    if (!servers.length) throw new Error("CombinedMedia needs at least one server");
    this.kind = servers[0]!.kind;
    this.name = servers.map((s) => s.name).join(" + ");
  }

  // Ids --------------------------------------------------------------------

  private find(kind: string): MediaServer | undefined {
    return this.servers.find((s) => s.kind === kind);
  }

  /** The server an item id belongs to, and the server's own id for it. */
  private route(itemId: string): { server: MediaServer; raw: string } {
    const i = itemId.indexOf(SEP);
    const server = i > 0 ? this.find(itemId.slice(0, i)) : undefined;
    if (!server) throw new Error(`No connected media server for ${itemId}`);
    return { server, raw: itemId.slice(i + 1) };
  }

  private wrap(server: MediaServer, itemId: string | undefined): string | undefined {
    return itemId === undefined ? undefined : `${server.kind}${SEP}${itemId}`;
  }

  /** A server's item with every id in it made server-specific. */
  private tag(server: MediaServer, item: JfItem): JfItem {
    const out: JfItem = { ...item, Id: this.wrap(server, item.Id)! };
    for (const f of ["SeriesId", "SeasonId", "ParentBackdropItemId"] as const) {
      if (item[f] !== undefined) out[f] = this.wrap(server, item[f]);
    }
    return out;
  }

  /** The item as its own server knows it. */
  private untag(item: JfItem): { server: MediaServer; item: JfItem } {
    const { server, raw } = this.route(item.Id);
    const out: JfItem = { ...item, Id: raw };
    for (const f of ["SeriesId", "SeasonId", "ParentBackdropItemId"] as const) {
      const v = item[f];
      if (v !== undefined) out[f] = v.startsWith(`${server.kind}${SEP}`) ? v.slice(server.kind.length + 1) : v;
    }
    return { server, item: out };
  }

  key(itemId: string): string {
    const { server, raw } = this.route(itemId);
    return server.key(raw);
  }

  parseKey(id: string): string | undefined {
    for (const s of this.servers) {
      const raw = s.parseKey(id);
      if (raw !== undefined) return this.wrap(s, raw);
    }
    return undefined;
  }

  kindOf(itemId: string): MediaServerKind {
    return this.route(itemId).server.kind;
  }

  rawId(itemId: string): string {
    return this.route(itemId).raw;
  }

  // Mapping ----------------------------------------------------------------

  toTitleRef(item: JfItem): TitleRef {
    const { server, item: own } = this.untag(item);
    return server.toTitleRef(own);
  }

  toDetails(item: JfItem, episodes: JfItem[] = []): TitleDetails {
    const { server, item: own } = this.untag(item);
    return server.toDetails(own, episodes.map((e) => this.untag(e).item));
  }

  toEpisode(e: JfItem): Episode {
    const { server, item } = this.untag(e);
    return server.toEpisode(item);
  }

  image(item: JfItem, kind: MediaImageKind, maxWidth: number): string | undefined {
    const { server, item: own } = this.untag(item);
    return server.image(own, kind, maxWidth);
  }

  // Browsing ---------------------------------------------------------------

  /** Asks every server, keeps what came back, and tags it. A server that fails contributes nothing. */
  private async fromAll(ask: (s: MediaServer) => Promise<JfItem[]>): Promise<JfItem[][]> {
    return Promise.all(this.servers.map((s) => ask(s).then((items) => items.map((i) => this.tag(s, i))).catch((): JfItem[] => [])));
  }

  /** One film or show on two servers is one card: the first server's copy stays. */
  private dedupe(items: JfItem[]): JfItem[] {
    const seen = new Set<string>();
    return items.filter((i) => {
      const tmdb = i.ProviderIds?.Tmdb ?? i.ProviderIds?.tmdb;
      if (!tmdb || (i.Type !== "Movie" && i.Type !== "Series")) return true;
      const k = `${i.Type}|${tmdb}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** Round-robin across the servers, so no one server fills a short rail. */
  private interleave(lists: JfItem[][], limit: number): JfItem[] {
    const out: JfItem[] = [];
    for (let n = 0; out.length < limit && lists.some((l) => n < l.length); n++) {
      for (const l of lists) if (n < l.length && out.length < limit) out.push(l[n]!);
    }
    return out;
  }

  private newestPlayed(lists: JfItem[][], limit: number): JfItem[] {
    const at = (i: JfItem) => Date.parse(i.UserData?.LastPlayedDate ?? "") || 0;
    return lists.flat().sort((a, b) => at(b) - at(a)).slice(0, limit);
  }

  async resume(limit = 20): Promise<JfItem[]> {
    return this.newestPlayed(await this.fromAll((s) => s.resume(limit)), limit);
  }

  async nextUp(limit = 20): Promise<JfItem[]> {
    return this.interleave(await this.fromAll((s) => s.nextUp(limit)), limit);
  }

  async latest(type: "Movie" | "Episode", limit = 20): Promise<JfItem[]> {
    return this.dedupe(this.interleave(await this.fromAll((s) => s.latest(type, limit)), limit * 2)).slice(0, limit);
  }

  async played(limit = 1500): Promise<JfItem[]> {
    return (await this.fromAll((s) => (s.played ? s.played(limit) : Promise.resolve([])))).flat();
  }

  async items(params: ItemsQuery): Promise<{ items: JfItem[]; total: number }> {
    const start = params.start ?? 0;
    const limit = params.limit ?? 60;
    // Each server is asked for everything up to the end of the page, then the merge is paged.
    const totals: number[] = [];
    const lists = await Promise.all(
      this.servers.map((s) =>
        s
          .items({ ...params, start: 0, limit: start + limit })
          .then((r) => (totals.push(r.total), r.items.map((i) => this.tag(s, i))))
          .catch((): JfItem[] => []),
      ),
    );
    // By name the merge is a plain sort. Newest first has no field the servers share, so it is each
    // server's own newest-first order, interleaved.
    const ordered = params.sortBy === "DateCreated" ? this.dedupe(this.interleave(lists, (start + limit) * this.servers.length)) : this.dedupe(lists.flat().sort((a, b) => a.Name.localeCompare(b.Name)));
    return { items: ordered.slice(start, start + limit), total: totals.reduce((a, b) => a + b, 0) };
  }

  async item(id: string): Promise<JfItem> {
    const { server, raw } = this.route(id);
    return this.tag(server, await server.item(raw));
  }

  async byProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<JfItem | undefined> {
    for (const s of this.servers) {
      const item = await s.byProviderId(provider, id, type).catch(() => undefined);
      if (item) return this.tag(s, item);
    }
    return undefined;
  }

  async hasProviderId(provider: MediaProvider, id: string, type: "Movie" | "Series"): Promise<boolean> {
    const answers = await Promise.all(this.servers.map((s) => s.hasProviderId(provider, id, type).catch(() => false)));
    return answers.some(Boolean);
  }

  async seasons(seriesId: string): Promise<JfItem[]> {
    const { server, raw } = this.route(seriesId);
    return (await server.seasons(raw)).map((i) => this.tag(server, i));
  }

  async episodes(seriesId: string): Promise<JfItem[]> {
    const { server, raw } = this.route(seriesId);
    return (await server.episodes(raw)).map((i) => this.tag(server, i));
  }

  segments(itemId: string): Promise<MediaSegment[]> {
    const { server, raw } = this.route(itemId);
    return server.segments(raw);
  }

  trickplay(itemId: string, item: JfItem, mediaSourceId: string | undefined): Trickplay | undefined {
    const { server, raw } = this.route(itemId);
    return server.trickplay(raw, item, mediaSourceId);
  }

  // Playback ---------------------------------------------------------------

  streamUrl(itemId: string, mediaSourceId?: string): string {
    const { server, raw } = this.route(itemId);
    return server.streamUrl(raw, mediaSourceId);
  }

  hlsUrl(itemId: string, mediaSourceId: string | undefined, session: string, maxHeight?: number, videoBitrate?: number): string {
    const { server, raw } = this.route(itemId);
    return server.hlsUrl(raw, mediaSourceId, session, maxHeight, videoBitrate);
  }

  subtitleUrl(itemId: string, mediaSourceId: string, index: number, codec?: string): string {
    const { server, raw } = this.route(itemId);
    return server.subtitleUrl(raw, mediaSourceId, index, codec);
  }

  reportProgress(itemId: string, positionMs: number, event: "start" | "progress" | "stop", paused?: boolean): Promise<void> {
    const { server, raw } = this.route(itemId);
    return server.reportProgress(raw, positionMs, event, paused);
  }

  markPlayed(itemId: string, played: boolean): Promise<void> {
    const { server, raw } = this.route(itemId);
    return server.markPlayed(raw, played);
  }

  /** Every server is told: one that doesn't look in that folder says so, and the others still add it. */
  async mediaUpdated(paths: string[]): Promise<{ added: boolean; note: string }> {
    const answers = await Promise.all(
      this.servers.map((s) => s.mediaUpdated(paths).catch((err: unknown) => ({ added: false, note: `${s.name} couldn't be told: ${String(err)}` }))),
    );
    return { added: answers.some((a) => a.added), note: answers.map((a) => a.note).join(". ") };
  }

  async refreshLibrary(): Promise<void> {
    await Promise.all(this.servers.map((s) => s.refreshLibrary().catch(() => undefined)));
  }
}
