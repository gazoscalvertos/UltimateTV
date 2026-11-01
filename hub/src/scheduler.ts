// Runs the recording schedule: keeps series links planned against the guide, starts live
// recordings on time, fetches catch-up recordings when the connection is free, fires reminders
// and tidies old recordings.

import { rm } from "node:fs/promises";
import type { Channel, Conflict, Programme, Recording, Reminder, SeriesLink } from "@ultimatetv/shared";
import type { ChannelStore } from "./channels.js";
import type { ConnectionGuard } from "./connections.js";
import { newId } from "./db.js";
import type { GuideStore } from "./epg.js";
import type { EventBus } from "./events.js";
import type { Logger } from "./log.js";
import type { Recorder } from "./recorder.js";
import type { RecordingStore } from "./recordings.js";
import { LiveRelay } from "./relay.js";
import { episodeKeyOf, findConflicts, methodFor, planSeriesLinks, recordingWindow } from "./serieslink.js";
import type { SettingsStore } from "./settings.js";

export interface SchedulerDeps {
  store: RecordingStore;
  guide: GuideStore;
  channels: ChannelStore;
  recorder: Recorder;
  guard: ConnectionGuard;
  settings: SettingsStore;
  events: EventBus;
  log: Logger;
  now?: () => number;
}

/** How long after a programme ends before its catch-up copy is complete on the provider. */
const CATCHUP_SETTLE_MS = 15 * 60_000;
const WARN_BEFORE_MS = 2 * 60_000;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private warned = new Set<string>();
  private catchupRunning = false;
  private lastHousekeeping = 0;
  /** When the loop last ran. /api/health reads it to tell a working Hub from a stuck one (#96). */
  lastTickAt: number | undefined;

  constructor(private d: SchedulerDeps) {}

  private now(): number {
    return (this.d.now ?? Date.now)();
  }

  /** Whether the clock is running: a Hub standing by after a move-out has never started it. */
  get running(): boolean {
    return this.timer !== null;
  }

  start(intervalMs = 10_000): void {
    this.timer ??= setInterval(() => void this.tick().catch((err) => this.d.log.error({ err: String(err) }, "Scheduler tick failed")), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private channelMap(): Map<string, Channel> {
    return new Map(this.d.channels.list(true).map((c) => [c.id, c]));
  }

  // -------------------------------------------------------------------------
  // User actions

  recordProgramme(programmeId: string): Recording {
    const p = this.d.guide.get(programmeId);
    if (!p) throw new Error("That programme is no longer in the guide");
    const existing = this.d.store.forProgramme(programmeId);
    if (existing) return existing;
    return this.createRecording(p, undefined);
  }

  private createRecording(p: Programme, link: SeriesLink | undefined, method?: Recording["method"]): Recording {
    const s = this.d.settings.get().recording;
    const channel = this.d.channels.get(p.channelId);
    const now = this.now();
    const window = recordingWindow(p, link?.paddingBeforeMin ?? s.paddingBeforeMin, link?.paddingAfterMin ?? s.paddingAfterMin);
    // A programme already on air is recorded live from now; catch-up could fetch it from the start
    // later, so prefer that when available.
    const m = method ?? methodFor(p, channel, s.preferCatchup, now);
    const rec: Recording = {
      id: newId("r"),
      programme: p,
      channelId: p.channelId,
      channelName: channel?.name ?? p.channelId,
      status: m === "catchup" && p.end <= now ? "waiting-catchup" : "scheduled",
      method: m,
      ...window,
      incomplete: false,
      watched: false,
      positionMs: 0,
      createdAt: now,
    };
    if (link) rec.seriesLinkId = link.id;
    this.d.store.save(rec);
    this.d.events.emit({ type: "recordings.changed" });
    return rec;
  }

  createSeriesLink(programmeId: string, options: Partial<Pick<SeriesLink, "scope" | "newOnly" | "keepLatest">> = {}): SeriesLink {
    const p = this.d.guide.get(programmeId);
    if (!p?.seriesKey) throw new Error("This programme isn't part of a series");
    const existing = this.d.store.linkForSeries(p.seriesKey);
    if (existing) return existing;
    const s = this.d.settings.get().recording;
    const channel = this.d.channels.get(p.channelId);
    const link: SeriesLink = {
      id: newId("l"),
      seriesKey: p.seriesKey,
      title: p.title,
      channelId: p.channelId,
      channelName: channel?.name ?? p.channelId,
      scope: options.scope ?? "any",
      newOnly: options.newOnly ?? false,
      keepLatest: options.keepLatest ?? 0,
      paddingBeforeMin: s.paddingBeforeMin,
      paddingAfterMin: s.paddingAfterMin,
      createdAt: this.now(),
    };
    this.d.store.saveLink(link);
    // The airing the user pressed Record on is always recorded, even if it's a repeat.
    if (!this.d.store.forProgramme(programmeId) && p.end > this.now()) this.createRecording(p, link);
    this.replan();
    return link;
  }

  updateSeriesLink(id: string, patch: Partial<Pick<SeriesLink, "scope" | "newOnly" | "keepLatest" | "paddingBeforeMin" | "paddingAfterMin">>): SeriesLink | undefined {
    const link = this.d.store.link(id);
    if (!link) return undefined;
    const next = { ...link, ...patch };
    this.d.store.saveLink(next);
    this.replan(true);
    return next;
  }

  deleteSeriesLink(id: string): void {
    for (const r of this.d.store.forLink(id)) {
      if (r.status === "scheduled" || r.status === "waiting-catchup") this.d.store.save({ ...r, status: "cancelled" });
    }
    this.d.store.deleteLink(id);
    this.d.events.emit({ type: "recordings.changed" });
  }

  cancelRecording(id: string): Recording | undefined {
    const r = this.d.store.get(id);
    if (!r) return undefined;
    if (this.d.recorder.isActive(id)) this.d.recorder.stop(id);
    const next = { ...r, status: "cancelled" as const };
    this.d.store.save(next);
    this.d.events.emit({ type: "recordings.changed" });
    return next;
  }

  async deleteRecording(id: string): Promise<void> {
    const r = this.d.store.get(id);
    if (!r) return;
    if (this.d.recorder.isActive(id)) this.d.recorder.stop(id);
    if (r.path) {
      await rm(r.path, { force: true });
      await rm(r.path.replace(/\.(mkv|ts)$/, ".nfo"), { force: true });
    }
    // Keep a cancelled stub for series-linked episodes so the planner doesn't record them again.
    if (r.seriesLinkId) {
      const { path: _path, ...rest } = r;
      this.d.store.save({ ...rest, status: "cancelled" });
    } else {
      this.d.store.delete(id);
    }
    this.d.events.emit({ type: "recordings.changed" });
  }

  addReminder(programmeId: string): Reminder {
    const p = this.d.guide.get(programmeId);
    if (!p) throw new Error("That programme is no longer in the guide");
    const r: Reminder = { id: p.id, programme: p, channelId: p.channelId, channelName: this.d.channels.get(p.channelId)?.name ?? "" };
    this.d.store.saveReminder(r);
    return r;
  }

  conflicts(): Conflict[] {
    const names = this.channelMap();
    return findConflicts(this.d.store.list(), this.d.settings.connectionLimit(), this.now(), (id) => names.get(id)?.name ?? id);
  }

  // -------------------------------------------------------------------------
  // Planning

  /**
   * Re-plans every series link against the current guide. Future recordings follow schedule
   * changes: a programme that moved is re-timed, one that vanished is cancelled and re-planned.
   */
  replan(resetFuture = false): void {
    const now = this.now();
    const channels = this.channelMap();
    const links = this.d.store.links();

    for (const r of this.d.store.withStatus("scheduled")) {
      if (r.start <= now) continue;
      if (resetFuture && r.seriesLinkId) {
        this.d.store.save({ ...r, status: "cancelled" });
        continue;
      }
      const current = this.d.guide.get(r.programme.id);
      if (current) {
        if (current.end !== r.programme.end || current.title !== r.programme.title) this.retime(r, current);
        continue;
      }
      const moved = this.findMoved(r);
      if (moved) this.retime(r, moved);
      else this.d.store.save({ ...r, status: "cancelled", error: "Removed from the guide" });
    }

    if (links.length > 0) {
      const airings = links.flatMap((l) => this.d.guide.airings(l.seriesKey, now - 3 * 3_600_000));
      const plan = planSeriesLinks({
        links,
        airings,
        recordings: this.d.store.list(),
        channels,
        connectionLimit: this.d.settings.connectionLimit(),
        preferCatchup: this.d.settings.get().recording.preferCatchup,
        now,
      });
      for (const add of plan.add) {
        if (!this.d.store.forProgramme(add.programme.id)) this.createRecording(add.programme, add.link, add.method);
      }
    }
    this.d.events.emit({ type: "recordings.changed" });
  }

  private retime(r: Recording, p: Programme): void {
    const link = r.seriesLinkId ? this.d.store.link(r.seriesLinkId) : undefined;
    const s = this.d.settings.get().recording;
    const window = recordingWindow(p, link?.paddingBeforeMin ?? s.paddingBeforeMin, link?.paddingAfterMin ?? s.paddingAfterMin);
    this.d.store.save({ ...r, programme: p, ...window });
  }

  /** The same episode on the same channel within an hour of where it was (schedule drift). */
  private findMoved(r: Recording): Programme | undefined {
    const key = episodeKeyOf(r.programme);
    const around = this.d.guide.onChannel(r.channelId, r.programme.start - 3_600_000, 20);
    return around.find(
      (p) => Math.abs(p.start - r.programme.start) <= 3_600_000 && (episodeKeyOf(p) === key || (p.title === r.programme.title && !key.startsWith("prog:"))),
    );
  }

  // -------------------------------------------------------------------------
  // The clock

  async tick(): Promise<void> {
    const now = this.now();
    this.lastTickAt = now;

    for (const r of this.d.store.withStatus("scheduled")) {
      if (r.method === "catchup") {
        if (r.programme.end <= now) this.d.store.save({ ...r, status: "waiting-catchup" });
        continue;
      }
      if (r.start - WARN_BEFORE_MS <= now && now < r.start && !this.warned.has(r.id)) {
        this.warned.add(r.id);
        this.warnIfViewerAffected(r);
      }
      if (r.start <= now && now < r.end && !this.d.recorder.isActive(r.id)) {
        void this.d.recorder.recordLive(r).catch((err) => this.d.log.error({ id: r.id, err: String(err) }, "Recording crashed"));
      } else if (r.end <= now && !this.d.recorder.isActive(r.id)) {
        // Missed (the Hub was down). Fall back to catch-up if the channel has it.
        const channel = this.d.channels.get(r.channelId);
        if (channel && channel.catchupDays > 0) this.d.store.save({ ...r, method: "catchup", status: "waiting-catchup" });
        else this.d.store.save({ ...r, status: "failed", error: "The Hub wasn't running when this was on" });
        this.d.events.emit({ type: "recordings.changed" });
      }
    }

    if (!this.catchupRunning && this.d.guard.idle()) {
      const next = this.d.store.withStatus("waiting-catchup").find((r) => r.programme.end + CATCHUP_SETTLE_MS <= now);
      if (next) {
        this.catchupRunning = true;
        void this.d.recorder
          .recordCatchup(next)
          .catch((err) => this.d.log.error({ id: next.id, err: String(err) }, "Catch-up recording crashed"))
          .finally(() => (this.catchupRunning = false));
      }
    }

    for (const reminder of this.d.store.reminders()) {
      if (reminder.programme.start - WARN_BEFORE_MS <= now) {
        if (reminder.programme.end > now) this.d.events.emit({ type: "reminder", reminder });
        this.d.store.deleteReminder(reminder.id);
      }
    }

    if (now - this.lastHousekeeping > 3_600_000) {
      this.lastHousekeeping = now;
      await this.housekeeping();
    }
  }

  /** With every connection in use by the TV, a live recording will take it over: say so first. */
  private warnIfViewerAffected(r: Recording): void {
    const verdict = this.d.guard.check(LiveRelay.key(r.channelId), "record");
    if (verdict.ok || verdict.preempts.length === 0) return;
    const watching = verdict.preempts.some((l) => [...l.holders.values()].includes("view"));
    if (!watching) return;
    const at = new Date(r.programme.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    this.d.events.emit({
      type: "connection.conflict",
      recording: r,
      message: `${r.programme.title} starts recording on ${r.channelName} at ${at}. The TV will switch to ${r.channelName} so it can record.`,
    });
  }

  private async housekeeping(): Promise<void> {
    const now = this.now();
    for (const link of this.d.store.links()) {
      if (link.keepLatest <= 0) continue;
      const done = this.d.store.forLink(link.id).filter((r) => r.status === "completed").sort((a, b) => b.programme.start - a.programme.start);
      for (const old of done.slice(link.keepLatest)) await this.deleteRecording(old.id);
    }
    const days = this.d.settings.get().recording.autoDeleteWatchedDays;
    if (days > 0) {
      for (const r of this.d.store.withStatus("completed")) {
        if (r.watched && r.programme.end < now - days * 86_400_000) await this.deleteRecording(r.id);
      }
    }
  }
}
