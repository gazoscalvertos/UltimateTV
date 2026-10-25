// Household profiles. Adults see everything; a Kids profile sees only kids' channels and titles
// rated up to its limit, can't change settings or delete recordings, and leaving it needs a PIN.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Certification, Channel, ChannelCategory, Profile, Programme, TitleDetails, TitleRef } from "@ultimatetv/shared";
import { CERTIFICATIONS } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import { newId } from "./db.js";

interface StoredProfile extends Profile {
  pinHash?: string;
  pinSalt?: string;
}

const COLOURS = ["#4f8cff", "#f2b33d", "#35c27a", "#ff6b9a", "#a77bff", "#2ec4d6"];

/** Genres that make an unrated title acceptable for a Kids profile. Animation alone isn't enough (adult cartoons). */
const KIDS_GENRES = /\b(family|kids|children|children's)\b/i;

/** TV and US ratings mapped onto the UK scale, so Jellyfin's OfficialRating can be compared. */
const RATING_MAP: Record<string, Certification> = {
  U: "U", UC: "U", G: "U", "TV-Y": "U", "TV-Y7": "U", "TV-G": "U", "0": "U", "6": "U",
  PG: "PG", "TV-PG": "PG", "12": "12", "12A": "12A", "PG-13": "12A", "TV-14": "15", "15": "15", "16": "15", R: "18", "18": "18", "NC-17": "18", "TV-MA": "18", R18: "18",
};

export function certificationRank(rating: string | undefined): number | null {
  if (!rating) return null;
  const key = rating.toUpperCase().replace(/^GB-|^UK-|^US-/, "").trim();
  const cert = RATING_MAP[key];
  return cert ? CERTIFICATIONS.indexOf(cert) : null;
}

export class ProfileStore {
  constructor(private db: Db) {
    if (this.all().length === 0) {
      this.saveAll([
        { id: "family", name: "Family", kind: "adult", colour: COLOURS[0]!, hasPin: false, maxCertification: "18", channelCategories: [], allowedChannels: [] },
        { id: "kids", name: "Kids", kind: "kids", colour: COLOURS[1]!, hasPin: false, maxCertification: "PG", channelCategories: ["kids"], allowedChannels: [] },
      ]);
    }
  }

  /** Unlock tokens: a profile with a PIN is only usable with one of these. Kept in the database so a Hub restart doesn't lock the TV. */
  private tokens(): Record<string, { profileId: string; expires: number }> {
    return this.db.getKv<Record<string, { profileId: string; expires: number }>>("profile-tokens") ?? {};
  }

  private issue(profileId: string, now: number): string {
    const token = randomBytes(18).toString("base64url");
    const live = Object.fromEntries(Object.entries(this.tokens()).filter(([, t]) => t.expires > now));
    live[token] = { profileId, expires: now + 30 * 86_400_000 };
    this.db.setKv("profile-tokens", live);
    return token;
  }

  private all(): StoredProfile[] {
    return this.db.getKv<StoredProfile[]>("profiles") ?? [];
  }

  private saveAll(list: StoredProfile[]): void {
    this.db.setKv("profiles", list);
  }

  list(): Profile[] {
    return this.all().map((p) => this.pub(p));
  }

  get(id: string): Profile | undefined {
    const p = this.all().find((x) => x.id === id);
    return p ? this.pub(p) : undefined;
  }

  /** Public view; `hasPin` tells the TV to ask for a PIN before switching to this profile. */
  private pub(p: StoredProfile): Profile {
    return { ...publicProfile(p), hasPin: this.needsPin(p) };
  }

  /** True when any adult profile has a PIN, so the household has turned the lock on. */
  locked(): boolean {
    return this.all().some((p) => p.kind === "adult" && p.pinHash);
  }

  create(input: { name: string; kind: Profile["kind"] }): Profile {
    const list = this.all();
    const p: StoredProfile = {
      id: newId("p"),
      name: input.name.trim() || "Profile",
      kind: input.kind,
      colour: COLOURS[list.length % COLOURS.length]!,
      hasPin: false,
      maxCertification: input.kind === "kids" ? "PG" : "18",
      channelCategories: input.kind === "kids" ? ["kids"] : [],
      allowedChannels: [],
    };
    this.saveAll([...list, p]);
    return this.pub(p);
  }

  update(id: string, patch: Partial<Pick<Profile, "name" | "colour" | "maxCertification" | "channelCategories" | "allowedChannels" | "defaultGuide">> & { pin?: string | null }): Profile | undefined {
    const list = this.all();
    const p = list.find((x) => x.id === id);
    if (!p) return undefined;
    if (patch.name !== undefined) p.name = patch.name.trim() || p.name;
    if (patch.colour) p.colour = patch.colour;
    if (patch.maxCertification && CERTIFICATIONS.includes(patch.maxCertification)) p.maxCertification = patch.maxCertification;
    if (patch.channelCategories) p.channelCategories = patch.channelCategories;
    if (patch.allowedChannels) p.allowedChannels = patch.allowedChannels;
    if (patch.defaultGuide !== undefined) {
      if (patch.defaultGuide) p.defaultGuide = String(patch.defaultGuide);
      else delete p.defaultGuide;
    }
    if (patch.pin === null) {
      delete p.pinHash;
      delete p.pinSalt;
    } else if (patch.pin !== undefined) {
      if (!/^\d{4}$/.test(patch.pin)) throw Object.assign(new Error("A PIN is four digits"), { statusCode: 400 });
      p.pinSalt = randomBytes(16).toString("hex");
      p.pinHash = scryptSync(patch.pin, p.pinSalt, 32).toString("hex");
    }
    p.hasPin = Boolean(p.pinHash);
    this.saveAll(list);
    return this.pub(p);
  }

  remove(id: string): void {
    const list = this.all();
    if (list.filter((p) => p.kind === "adult").length <= 1 && list.find((p) => p.id === id)?.kind === "adult") {
      throw Object.assign(new Error("Keep at least one adult profile"), { statusCode: 400 });
    }
    if (!list.some((p) => p.id === id)) throw Object.assign(new Error("No such profile"), { statusCode: 404 });
    this.saveAll(list.filter((p) => p.id !== id));
  }

  /** Checks the PIN and returns a token the TV sends with every request while on this profile. */
  unlock(id: string, pin: string | undefined, now = Date.now()): string {
    const p = this.all().find((x) => x.id === id);
    if (!p) throw Object.assign(new Error("No such profile"), { statusCode: 404 });
    if (this.needsPin(p) && !(pinMatches(p, pin) || (p.kind === "adult" && !p.pinHash && this.householdPin(pin)))) {
      throw Object.assign(new Error("That PIN isn't right"), { statusCode: 403 });
    }
    return this.issue(id, now);
  }

  /** Once any adult has a PIN, every adult profile needs one (its own, or any adult's if it has none). */
  private needsPin(p: StoredProfile): boolean {
    return Boolean(p.pinHash) || (p.kind === "adult" && this.locked());
  }

  private householdPin(pin: string | undefined): StoredProfile | undefined {
    return this.all().find((x) => x.kind === "adult" && pinMatches(x, pin));
  }

  /** For the phone setup page: any adult PIN unlocks settings. */
  unlockAdmin(pin: string | undefined, now = Date.now()): string {
    const adult = this.locked() ? this.householdPin(pin) : this.all().find((p) => p.kind === "adult");
    if (!adult) throw Object.assign(new Error("That PIN isn't right"), { statusCode: 403 });
    return this.issue(adult.id, now);
  }

  /**
   * Works out who's asking. A profile with a PIN needs its token; a profile without one is taken
   * at its word. With no profile at all (the phone setup page, scripts) the caller counts as an
   * adult unless the household has set a PIN.
   */
  resolve(profileId: string | undefined, token: string | undefined, now = Date.now()): { profile: Profile | null; admin: boolean } {
    if (token) {
      const t = this.tokens()[token];
      if (t && t.expires > now) {
        const p = this.get(t.profileId);
        if (p) return { profile: p, admin: p.kind === "adult" };
      }
    }
    if (profileId) {
      const stored = this.all().find((x) => x.id === profileId);
      // A PIN-protected profile without a valid token falls back to the safest profile.
      if (stored && !this.needsPin(stored)) return { profile: this.pub(stored), admin: stored.kind === "adult" };
      const kids = this.all().find((x) => x.kind === "kids");
      return { profile: kids ? this.pub(kids) : null, admin: false };
    }
    return { profile: null, admin: !this.locked() };
  }
}

function pinMatches(p: StoredProfile, pin: string | undefined): boolean {
  if (!p.pinHash || !p.pinSalt) return false;
  return timingSafeEqual(scryptSync(pin ?? "", p.pinSalt, 32), Buffer.from(p.pinHash, "hex"));
}

function publicProfile(p: StoredProfile): Profile {
  const { pinHash: _h, pinSalt: _s, ...rest } = p;
  return { ...rest, hasPin: Boolean(p.pinHash) };
}

// ---------------------------------------------------------------------------
// Filtering for Kids profiles

export class ContentFilter {
  constructor(readonly profile: Profile | null) {}

  get kids(): boolean {
    return this.profile?.kind === "kids";
  }

  private get maxRank(): number {
    return CERTIFICATIONS.indexOf(this.profile?.maxCertification ?? "18");
  }

  channel(c: Channel): boolean {
    if (!this.kids) return true;
    const cats: ChannelCategory[] = this.profile!.channelCategories.length ? this.profile!.channelCategories : ["kids"];
    return cats.includes(c.category) || this.profile!.allowedChannels.includes(c.id);
  }

  channels(list: Channel[]): Channel[] {
    return this.kids ? list.filter((c) => this.channel(c)) : list;
  }

  programme(_p: Programme, channel: Channel | undefined): boolean {
    return !this.kids || (channel !== undefined && this.channel(channel));
  }

  /** Titles need a rating within the limit, or a family/animation genre when unrated. */
  title(d: Pick<TitleDetails, "certification" | "genres">): boolean {
    if (!this.kids) return true;
    const rank = certificationRank(d.certification);
    if (rank !== null) return rank <= this.maxRank;
    return d.genres.some((g) => KIDS_GENRES.test(g));
  }

  /** For lists where only references are known: keep those tagged as suitable. */
  ref(r: TitleRef): boolean {
    if (!this.kids) return true;
    return this.title({ genres: r.genres ?? [], ...(r.certification ? { certification: r.certification } : {}) });
  }

  /** Jellyfin's MaxOfficialRating query value for this profile. */
  jellyfinMaxRating(): string | undefined {
    return this.kids ? this.profile!.maxCertification : undefined;
  }
}

/** Everything allowed: adults, the phone setup page and background jobs. */
export const NO_FILTER = new ContentFilter(null);
