// Which Home rows a profile shows, and in what order (issue #99). Kept on the Hub in the settings
// database, one list per profile (and one for the household, for a TV with no profile picked). A
// row that's switched off is never fetched, so Home loads faster; Everything puts every row back.

import { HOME_ROWS, SIMPLE_HOME_ROWS, type HomeRowId, type HomeRowState, type HomeRowsPreset, type HomeRowsView } from "@ultimatetv/shared";
import type { Db } from "./db.js";

/** What the store saved: only what differs from "everything, in the usual order". */
interface StoredRows {
  /** The rows this profile has moved to the front, in order; the rest follow in the usual order. */
  order?: HomeRowId[];
  /** Rows switched off. */
  hidden?: HomeRowId[];
  /** "simple" while the Simple Home preset is on; absent (or "everything") means the usual list. */
  preset?: "simple";
}

interface RowsEvents {
  emit(event: { type: "home.rows.changed"; profileId: string | null }): void;
}

const ALL = HOME_ROWS.map((r) => r.id);

export class HomeRows {
  constructor(
    private readonly db: Db,
    private readonly events: RowsEvents,
  ) {}

  /** Where a profile's list lives. The household (no profile) is its own list. */
  private key(profileId: string | null): string {
    return `home-rows:${profileId ?? "default"}`;
  }

  /** What was saved for a profile, ignoring anything in the database that isn't a list we wrote. */
  private stored(profileId: string | null): StoredRows {
    const raw = this.db.getKv<unknown>(this.key(profileId));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const o = raw as Record<string, unknown>;
    const out: StoredRows = {};
    const order = clean(o.order);
    if (order.length) out.order = order;
    const hidden = clean(o.hidden);
    if (hidden.length) out.hidden = hidden;
    if (o.preset === "simple") out.preset = "simple";
    return out;
  }

  /** Every row, in this profile's order, with whether it's on. */
  view(profileId: string | null): HomeRowsView {
    return this.shape(this.stored(profileId));
  }

  /**
   * Changes a profile's list and returns the result. Sending only some fields leaves the others
   * as they were; the "simple" and "everything" presets replace the whole list.
   */
  set(profileId: string | null, patch: { order?: unknown; hidden?: unknown; preset?: unknown }): HomeRowsView {
    const now = this.stored(profileId);
    let next: StoredRows;
    if (patch.preset === "simple") {
      next = { preset: "simple" };
    } else if (patch.preset === "everything") {
      next = {};
    } else {
      // A hand-made list: the order and the hidden rows as they now stand. Naming a row in the
      // order (or hiding one) makes it a custom list, so the Simple Home preset is off again.
      next = {};
      const order = clean(patch.order !== undefined ? patch.order : now.order);
      if (order.length) next.order = order;
      const hidden = clean(patch.hidden !== undefined ? patch.hidden : now.hidden);
      if (hidden.length) next.hidden = hidden;
    }
    this.db.setKv(this.key(profileId), Object.keys(next).length ? next : null);
    this.events.emit({ type: "home.rows.changed", profileId });
    return this.shape(next);
  }

  /** A deleted profile's list goes with it. */
  forget(profileId: string | null): void {
    this.db.setKv(this.key(profileId), null);
    this.events.emit({ type: "home.rows.changed", profileId });
  }

  /** The rows switched on for a profile, in its order: what Home should fetch and show. */
  visible(profileId: string | null): HomeRowId[] {
    return this.shape(this.stored(profileId))
      .rows.filter((r) => r.on)
      .map((r) => r.id);
  }

  /** Whether a row is switched on for a profile (a row nobody has touched is on). */
  on(profileId: string | null, id: HomeRowId): boolean {
    return this.visible(profileId).includes(id);
  }

  /** Turns a saved list (or nothing) into the whole view. */
  private shape(stored: StoredRows): HomeRowsView {
    const simple = stored.preset === "simple";
    const order = simple ? SIMPLE_HOME_ROWS : (stored.order ?? ALL);
    const hidden = new Set<HomeRowId>(simple ? ALL.filter((id) => !SIMPLE_HOME_ROWS.includes(id)) : (stored.hidden ?? []));
    // The rows asked for first, then everything else in the order Home has always had.
    const front = order.filter((id, i) => ALL.includes(id) && order.indexOf(id) === i);
    const ids = [...front, ...ALL.filter((id) => !front.includes(id))];
    const rows: HomeRowState[] = ids.map((id) => {
      const info = HOME_ROWS.find((r) => r.id === id)!;
      return { ...info, on: !hidden.has(id) };
    });
    const preset: HomeRowsPreset = simple ? "simple" : stored.order || stored.hidden ? "custom" : "everything";
    return { rows, preset };
  }
}

/** Row ids from the database or a request: known ones only, each once, in order. */
function clean(raw: unknown): HomeRowId[] {
  const seen = new Set<string>();
  const out: HomeRowId[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id !== "string" || !ALL.includes(id as HomeRowId) || seen.has(id)) continue;
    seen.add(id);
    out.push(id as HomeRowId);
  }
  return out;
}
