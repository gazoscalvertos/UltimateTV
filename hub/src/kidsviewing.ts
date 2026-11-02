// What a Kids profile actually played, day by day, so a parent can see the week (issue #110). The
// TV and the Android client report a title with every progress update; the Hub notes the title
// under the profile that asked, once a day. Minutes come from the Kids time records, so a title
// played for ten seconds still shows in the list while the total stays honest.

import { KIDS_VIEWING_KEEP_DAYS, MAX_KIDS_ALLOW, type KidsLockout, type KidsSummary, type KidsViewingDay, type KidsViewingTitle } from "@ultimatetv/shared";
import type { Db } from "./db.js";

/** The local date as YYYY-MM-DD; the same day boundary the time limits use. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Days back from today, as YYYY-MM-DD. */
export function daysBack(now: number, back: number): string {
  return dayKey(now - back * 86_400_000);
}

/** `profileId -> day -> titles`, in the order they were first played that day. */
type Stored = Record<string, Record<string, KidsViewingTitle[]>>;

const KINDS = new Set<string>(["movie", "series", "channel", "recording"]);

export class KidsViewing {
  constructor(private readonly db: Db) {}

  private load(): Stored {
    const raw = this.db.getKv<unknown>("kids-viewing");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Stored = {};
    for (const [profileId, days] of Object.entries(raw as Record<string, unknown>)) {
      if (!days || typeof days !== "object" || Array.isArray(days)) continue;
      const kept: Record<string, KidsViewingTitle[]> = {};
      for (const [day, titles] of Object.entries(days as Record<string, unknown>)) {
        if (!Array.isArray(titles)) continue;
        const clean = titles.filter((t): t is KidsViewingTitle => {
          const o = t as Partial<KidsViewingTitle> | null;
          return Boolean(o && typeof o.id === "string" && typeof o.name === "string" && typeof o.kind === "string" && KINDS.has(o.kind));
        });
        if (clean.length) kept[day] = clean.slice(0, MAX_KIDS_ALLOW);
      }
      if (Object.keys(kept).length) out[profileId] = kept;
    }
    return out;
  }

  private save(s: Stored): void {
    this.db.setKv("kids-viewing", Object.keys(s).length ? s : null);
  }

  /** Notes that this profile played this title today. Only the first play of the day is kept. */
  record(profileId: string, title: { id: string; kind: string; name: string }, now = Date.now()): void {
    if (!KINDS.has(title.kind) || !title.id || !title.name.trim()) return;
    const s = this.load();
    const today = dayKey(now);
    const days = (s[profileId] ??= {});
    const titles = (days[today] ??= []);
    const kind = title.kind as KidsViewingTitle["kind"];
    if (!titles.some((t) => t.kind === kind && t.id === title.id)) {
      titles.push({ id: title.id, kind, name: title.name.slice(0, 200) });
    }
    // Keep only the window the summary can reach, so the database doesn't grow for ever.
    const oldest = daysBack(now, KIDS_VIEWING_KEEP_DAYS);
    for (const day of Object.keys(days)) if (day < oldest) delete days[day];
    this.save(s);
  }

  /** What this profile played on one day, oldest first. */
  day(profileId: string, day: string): KidsViewingTitle[] {
    return this.load()[profileId]?.[day] ?? [];
  }

  /** The window a summary covers, oldest first, with the minutes the Kids time records hold. */
  summary(profileId: string, profileName: string, used: Map<string, number>, lockouts: KidsLockout[], now = Date.now(), days = 7): KidsSummary {
    const s = this.load();
    const mine = s[profileId] ?? {};
    const out: KidsViewingDay[] = [];
    const all: KidsViewingTitle[] = [];
    let totalMinutes = 0;
    for (let back = days - 1; back >= 0; back--) {
      const day = daysBack(now, back);
      const titles = mine[day] ?? [];
      const minutes = Math.max(0, Math.round((used.get(day) ?? 0) / 60_000));
      totalMinutes += minutes;
      out.push({ day, minutes, titles });
      all.push(...titles);
    }
    const seen = new Set<string>();
    const titles = all.filter((t) => {
      const key = `${t.kind}:${t.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      profileId,
      profileName,
      from: daysBack(now, days - 1),
      to: dayKey(now),
      days: out,
      titles,
      totalMinutes,
      lockouts: lockouts.filter((l) => l.profileId === profileId || l.profileId === "__admin__").slice(0, 50),
    };
  }

  /** A deleted profile takes its viewing history with it. */
  forget(profileId: string): void {
    const s = this.load();
    delete s[profileId];
    this.save(s);
  }
}
