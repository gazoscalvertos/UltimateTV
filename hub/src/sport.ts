// Sport tonight (issue #231): live and upcoming sport from the guide, favourite teams and sports per
// profile, and an automatic reminder (and optional recording) when a favourite is in the guide.
// See docs/sport-tonight.md.
//
// Settings live in the database, one entry per profile (and one for a TV with no profile). A game is
// handled once per profile: if someone deletes the reminder it was not made again.

import type { Channel, Programme, Reminder, Recording } from "@ultimatetv/shared";
import { cleanSportTeams, clockTime, dayLabel, isSportProgramme, matchFavourite, startOfDay, teamsIn, type SportMatch, type SportSettings, type SportView } from "@ultimatetv/shared";
import type { ChannelStore } from "./channels.js";
import type { GuideStore } from "./epg.js";
import type { Db } from "./db.js";
import type { EventBus } from "./events.js";
import type { ContentFilter } from "./profiles.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** "Today" runs to 4am, so a late kick-off still counts as tonight. */
const TODAY_ENDS_HOURS = 28;
/** How far ahead favourites are watched for. */
export const FAVOURITES_AHEAD_DAYS = 7;
const MAX_TODAY = 60;

export interface SportDeps {
  db: Db;
  events: EventBus;
  guide: Pick<GuideStore, "between">;
  channels: ChannelStore;
  reminders: () => Pick<Reminder, "id">[];
  recording: (programmeId: string) => Recording | undefined;
  addReminder: (programmeId: string) => unknown;
  record: (programmeId: string) => unknown;
  profileIds: () => string[];
  /** Whether a profile is a Kids profile (no automatic recording for them). */
  isKids: (profileId: string | null) => boolean;
}

export class Sport {
  constructor(private readonly d: SportDeps) {}

  private key(profileId: string | null) {
    return `sport:${profileId ?? "default"}`;
  }

  settings(profileId: string | null): SportSettings {
    const raw = this.d.db.getKv<Partial<SportSettings>>(this.key(profileId));
    return { teams: cleanSportTeams(raw?.teams), remind: raw?.remind ?? true, record: raw?.record ?? false };
  }

  set(profileId: string | null, patch: Partial<SportSettings>): SportSettings {
    const now = this.settings(profileId);
    const next: SportSettings = {
      teams: patch.teams !== undefined ? cleanSportTeams(patch.teams) : now.teams,
      remind: patch.remind ?? now.remind,
      record: patch.record ?? now.record,
    };
    this.d.db.setKv(this.key(profileId), next);
    this.d.events.emit({ type: "sport.changed", profileId });
    return next;
  }

  addTeam(profileId: string | null, name: string): SportSettings {
    return this.set(profileId, { teams: [...this.settings(profileId).teams, name] });
  }

  removeTeam(profileId: string | null, name: string): SportSettings {
    const key = name.trim().toLowerCase();
    return this.set(profileId, { teams: this.settings(profileId).teams.filter((t) => t.toLowerCase() !== key) });
  }

  /** Sport programmes still to come or on air, on channels this profile may watch, soonest first. */
  private sportBetween(f: ContentFilter, from: number, to: number): { p: Programme; channel: Channel }[] {
    const out: { p: Programme; channel: Channel }[] = [];
    // The same game on two channels (a simulcast) shows once, on the first.
    const seen = new Set<string>();
    for (const p of this.d.guide.between(from - 6 * HOUR, to)) {
      if (p.end <= from) continue;
      const channel = this.d.channels.get(p.channelId);
      if (!channel || channel.hidden || channel.mix) continue;
      if (!isSportProgramme(p, channel) || !f.programme(p, channel)) continue;
      const dupe = `${p.title.toLowerCase()}|${p.start}`;
      if (seen.has(dupe)) continue;
      seen.add(dupe);
      out.push({ p, channel });
    }
    return out;
  }

  private match(p: Programme, channel: { name: string; logo?: string; number: number }, teams: string[], marks: { reminders: Set<string> }, now: number): SportMatch {
    const live = p.start <= now && p.end > now;
    const favourite = matchFavourite(p, teams);
    const m: SportMatch = {
      programme: p,
      channelName: channel.name,
      channelNumber: channel.number,
      live,
      when: live ? "Live now" : `${dayLabel(p.start, now) === "Today" ? "" : `${dayLabel(p.start, now)} `}${clockTime(p.start)}`,
      reminder: marks.reminders.has(p.id),
      recording: Boolean(this.d.recording(p.id)),
      teams: teamsIn(p.title),
    };
    if (channel.logo) m.channelLogo = channel.logo;
    if (favourite) m.favourite = favourite;
    return m;
  }

  /** What Home's Sport today row and the Sport screen show for a profile. */
  view(profileId: string | null, f: ContentFilter, now = Date.now()): SportView {
    const s = this.settings(profileId);
    const marks = { reminders: new Set(this.d.reminders().map((r) => r.id)) };
    const until = startOfDay(now) + TODAY_ENDS_HOURS * HOUR;
    const all = this.sportBetween(f, now, now + FAVOURITES_AHEAD_DAYS * DAY);
    const today = all.filter((x) => x.p.start < until).map((x) => this.match(x.p, x.channel, s.teams, marks, now));
    // Soonest first; on now ahead of what's to come; your teams ahead of the rest at the same time.
    today.sort((a, b) => Number(b.live) - Number(a.live) || a.programme.start - b.programme.start || Number(Boolean(b.favourite)) - Number(Boolean(a.favourite)));
    const mine = s.teams.length ? all.map((x) => this.match(x.p, x.channel, s.teams, marks, now)).filter((m) => m.favourite) : [];
    return { ...s, matches: today.slice(0, MAX_TODAY), mine: mine.slice(0, 40), available: !f.limited || all.length > 0 };
  }

  /** Home's row: today's sport, your teams first. */
  row(profileId: string | null, f: ContentFilter, now = Date.now()): SportMatch[] {
    const v = this.view(profileId, f, now);
    return [...v.matches].sort((a, b) => Number(Boolean(b.favourite)) - Number(Boolean(a.favourite)) || Number(b.live) - Number(a.live) || a.programme.start - b.programme.start).slice(0, 20);
  }

  /**
   * Sets a reminder (and records, when asked) for each favourite game in the guide that hasn't been
   * handled yet. Each game is handled once per profile.
   */
  check(filterFor: (profileId: string | null) => ContentFilter, now = Date.now()): { reminders: number; recordings: number } {
    const handled = this.d.db.getKv<Record<string, number>>("sport-handled") ?? {};
    let reminders = 0;
    let recordings = 0;
    for (const profileId of [null, ...this.d.profileIds()]) {
      const s = this.settings(profileId);
      if (!s.teams.length || (!s.remind && !s.record)) continue;
      const f = filterFor(profileId);
      if (f.guest) continue;
      for (const { p } of this.sportBetween(f, now, now + FAVOURITES_AHEAD_DAYS * DAY)) {
        if (p.start <= now || !matchFavourite(p, s.teams)) continue;
        const k = `${profileId ?? "default"}:${p.id}`;
        if (handled[k]) continue;
        handled[k] = p.end;
        try {
          if (s.remind) {
            this.d.addReminder(p.id);
            reminders++;
          }
          if (s.record && !this.d.isKids(profileId) && !this.d.recording(p.id)) {
            this.d.record(p.id);
            recordings++;
          }
        } catch {
          // The programme left the guide between the look and the call: nothing to set.
        }
      }
    }
    for (const [k, end] of Object.entries(handled)) if (end < now - DAY) delete handled[k];
    this.d.db.setKv("sport-handled", handled);
    if (reminders || recordings) this.d.events.emit({ type: "sport.changed", profileId: null });
    return { reminders, recordings };
  }
}
