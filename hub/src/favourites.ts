// Favourites, one set per profile: the films and TV shows each profile likes, and its own guide
// channels. Starred from a title's page, the player, the guide, the phone remote or the Android
// app. The guide's Favourites list, the "Live now" row and the Favourites row on Home follow
// the profile watching.
//
// Channel favourites used to belong to the household (`favourite` on each channel, set from the
// phone's channel settings). The first time the Hub starts with this, every profile gets a copy
// of the household's, so nothing is lost. With no profile chosen (the phone settings page, a
// script) the household's star still applies; profiles made later start with none.
//
// Everything lives in the Hub's database, so the nightly backup has it.

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FavouriteInput, FavouriteResult, Favourites, FavouriteTitle, TitleRef } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { ContentFilter } from "./profiles.js";

const MAX_TITLES = 500;
const MAX_CHANNELS = 2000;
const MIGRATED = "favourites-migrated";

export class FavouriteError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

interface Stored {
  titles: FavouriteTitle[];
  channels: string[];
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** The parts of a title worth keeping (no progress bars or badges). */
export function favouriteRef(t: Partial<TitleRef> | undefined): TitleRef | null {
  if (!t) return null;
  const id = text(t.id, 300);
  const name = text(t.name, 160);
  if (!id || !name || (t.kind !== "movie" && t.kind !== "series")) return null;
  const ref: TitleRef = { id, kind: t.kind, name };
  if (typeof t.year === "number") ref.year = t.year;
  for (const k of ["poster", "backdrop", "logo", "certification"] as const) {
    const v = text(t[k], 1000);
    if (v) ref[k] = v;
  }
  if (Array.isArray(t.genres)) ref.genres = t.genres.filter((g): g is string => typeof g === "string").slice(0, 8);
  return ref;
}

/** The household's channel star, which the no-profile case still uses. */
export interface HouseholdChannels {
  list(includeHidden?: boolean): { id: string; favourite: boolean }[];
  update(id: string, patch: { favourite?: boolean }): unknown;
}

export class FavouriteStore {
  constructor(
    private readonly db: Db,
    private readonly events: EventBus,
    private readonly household: HouseholdChannels,
  ) {}

  private key(profileId: string | null) {
    return `favourites:${profileId ?? "default"}`;
  }

  private stored(profileId: string | null): Stored {
    const s = this.db.getKv<Partial<Stored>>(this.key(profileId));
    return { titles: Array.isArray(s?.titles) ? s!.titles : [], channels: Array.isArray(s?.channels) ? s!.channels : [] };
  }

  private save(profileId: string | null, s: Stored): void {
    this.db.setKv(this.key(profileId), s);
    this.events.emit({ type: "favourites.changed", profileId });
  }

  /**
   * Once: copies the household's favourite channels to every profile that has no favourites of
   * its own yet. Returns how many profiles got them.
   */
  migrate(profileIds: string[]): number {
    if (this.db.getKv<boolean>(MIGRATED)) return 0;
    const household = this.household.list(true).filter((c) => c.favourite).map((c) => c.id);
    // Nothing starred yet (a new Hub): nothing to copy, so look again next start.
    if (!household.length) return 0;
    let n = 0;
    for (const id of profileIds) {
      if (this.db.getKv(this.key(id))) continue;
      this.db.setKv(this.key(id), { titles: [], channels: household });
      n++;
    }
    this.db.setKv(MIGRATED, true);
    return n;
  }

  /** A profile's favourites; with no profile, the household's channels and its own titles. */
  get(profileId: string | null): Favourites {
    const s = this.stored(profileId);
    const channels = profileId === null ? this.household.list(true).filter((c) => c.favourite).map((c) => c.id) : s.channels;
    return { titles: s.titles, channels };
  }

  /** The profile's favourite channel ids, for the guide; undefined means "use the household's star". */
  channelSet(profileId: string | null): ReadonlySet<string> | undefined {
    return profileId === null ? undefined : new Set(this.stored(profileId).channels);
  }

  hasTitle(profileId: string | null, titleId: string): boolean {
    return this.stored(profileId).titles.some((f) => f.title.id === titleId);
  }

  /** Marks or unmarks a film or show; `on` left out flips it. Returns whether it's a favourite now. */
  setTitle(profileId: string | null, title: TitleRef, on?: boolean, now = Date.now()): boolean {
    const s = this.stored(profileId);
    const had = s.titles.some((f) => f.title.id === title.id);
    const want = on ?? !had;
    if (want === had) {
      // Starring it again keeps its place but freshens the artwork.
      if (want) {
        s.titles = s.titles.map((f) => (f.title.id === title.id ? { ...f, title } : f));
        this.db.setKv(this.key(profileId), s);
      }
      return want;
    }
    if (want) {
      if (s.titles.length >= MAX_TITLES) throw new FavouriteError(`Favourites hold ${MAX_TITLES} films and shows. Take some off first.`);
      s.titles = [{ title, addedAt: now }, ...s.titles];
    } else {
      s.titles = s.titles.filter((f) => f.title.id !== title.id);
    }
    this.save(profileId, s);
    return want;
  }

  /** Marks or unmarks a guide channel; `on` left out flips it. Returns whether it's a favourite now. */
  setChannel(profileId: string | null, channelId: string, on?: boolean): boolean {
    if (profileId === null) {
      const c = this.household.list(true).find((x) => x.id === channelId);
      if (!c) throw new FavouriteError("No such channel", 404);
      const want = on ?? !c.favourite;
      if (want !== c.favourite) {
        this.household.update(channelId, { favourite: want });
        this.events.emit({ type: "favourites.changed", profileId: null });
        this.events.emit({ type: "guide.updated" });
      }
      return want;
    }
    const s = this.stored(profileId);
    const had = s.channels.includes(channelId);
    const want = on ?? !had;
    if (want === had) return want;
    if (want && s.channels.length >= MAX_CHANNELS) throw new FavouriteError("That's too many favourite channels");
    s.channels = want ? [...s.channels, channelId] : s.channels.filter((id) => id !== channelId);
    this.save(profileId, s);
    return want;
  }

  /** A deleted profile's favourites go with it. */
  forget(profileId: string): void {
    this.db.setKv(this.key(profileId), null);
  }
}

/** Kids see only the titles and channels their profile allows. */
function visible(f: Favourites, filter: ContentFilter, channelOk: (id: string) => boolean): Favourites {
  return {
    titles: filter.kids ? f.titles.filter((t) => filter.ref(t.title)) : f.titles,
    channels: f.channels.filter(channelOk),
  };
}

export function registerFavourites(
  app: FastifyInstance,
  favourites: FavouriteStore,
  who: (req: FastifyRequest) => { profileId: string | null; admin: boolean; filter: ContentFilter },
  channelOk: (id: string, filter: ContentFilter) => boolean,
): void {
  const state = (req: FastifyRequest) => {
    const { profileId, filter } = who(req);
    return visible(favourites.get(profileId), filter, (id) => channelOk(id, filter));
  };

  app.get("/api/favourites", async (req): Promise<Favourites> => state(req));

  app.post("/api/favourites", async (req: FastifyRequest<{ Body: FavouriteInput }>, reply) => {
    const { profileId, admin, filter } = who(req);
    const body = req.body ?? {};
    const on = typeof body.on === "boolean" ? body.on : undefined;
    try {
      let now: boolean;
      if (body.title) {
        const ref = favouriteRef(body.title);
        if (!ref) return reply.code(400).send({ error: "Say which film or show" });
        if (filter.kids && !filter.ref(ref)) return reply.code(403).send({ error: "That isn't available on this profile" });
        now = favourites.setTitle(profileId, ref, on);
      } else if (typeof body.channel === "string" && body.channel) {
        if (!channelOk(body.channel, filter)) return reply.code(404).send({ error: "No such channel" });
        // With no profile chosen, the star is the household's, which only a grown-up may change.
        if (profileId === null && !admin) return reply.code(403).send({ error: "Choose a profile first", code: "admin" });
        now = favourites.setChannel(profileId, body.channel, on);
      } else {
        return reply.code(400).send({ error: "Say which film, show or channel" });
      }
      const result: FavouriteResult = { on: now, ...state(req) };
      return result;
    } catch (err) {
      if (err instanceof FavouriteError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
