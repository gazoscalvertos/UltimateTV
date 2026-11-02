// The boxes on the Hub (issue #103). A box is a paired screen of kind "tv". The Hub used to keep
// one of everything: one now-playing state, one sleep timer, one IPTV lease called "box". This
// keeps the list of boxes and answers "which box did you mean?" so the rest of the Hub can be
// per-room without every route growing a parameter.

import type { BoxTarget, PairedDevice, TvBox } from "@ultimatetv/shared";
import { cleanBoxTarget, sortBoxes } from "@ultimatetv/shared";

export interface BoxRegistryDeps {
  devices: () => PairedDevice[];
  /** How many TV apps are connected as this device right now. */
  connections: (id: string) => number;
  now?: () => number;
}

export class BoxRegistry {
  constructor(private readonly deps: BoxRegistryDeps) {}

  /** Every box, online ones first. */
  list(): TvBox[] {
    return sortBoxes(
      this.deps
        .devices()
        .filter((d) => d.kind === "tv")
        .map((d) => {
          const connections = this.deps.connections(d.id);
          return {
            id: d.id,
            name: d.name,
            online: connections > 0,
            connections,
            lastSeenAt: d.lastSeenAt,
            ...(d.ip ? { ip: d.ip } : {}),
          };
        }),
    );
  }

  get(id: string): TvBox | undefined {
    return this.list().find((b) => b.id === id);
  }

  /**
   * The box an action goes to when nobody said: the first one set up (in pairing order, not
   * alphabetical), preferring one that is on. So a house that started with the living room keeps
   * sending to the living room, and adding a box never silently moves everything elsewhere.
   */
  main(): TvBox | null {
    const byPairing = this.deps
      .devices()
      .filter((d) => d.kind === "tv")
      .map((d) => this.get(d.id))
      .filter((b): b is TvBox => Boolean(b));
    return byPairing.find((b) => b.online) ?? byPairing[0] ?? null;
  }

  /**
   * The ids a target means. `"all"` is every box; null is the main one; a name is resolved to the
   * box called that (the phone's picker sends names, since ids are invisible to people); anything
   * unknown is the main box, which is what happened before there were two.
   */
  resolve(target: BoxTarget): string[] {
    const boxes = this.list();
    if (target === "all") return boxes.map((b) => b.id);
    if (target === null) {
      const main = this.main();
      return main ? [main.id] : [];
    }
    const byId = boxes.find((b) => b.id === target);
    if (byId) return [byId.id];
    // A name, in any case: "living room" finds "Living room".
    const byName = boxes.find((b) => b.name.toLowerCase() === target.toLowerCase());
    if (byName) return [byName.id];
    const main = this.main();
    return main ? [main.id] : [];
  }

  /**
   * The one box a question should go to: the box asked for when it's on, otherwise the main box if
   * it's on, otherwise any box that is. Null only when no box is on at all.
   */
  firstOn(target: BoxTarget): string | null {
    const on = this.list().filter((b) => b.online);
    if (on.length === 0) return null;
    const wanted = this.resolve(target);
    const hit = wanted.find((id) => on.some((b) => b.id === id));
    return hit ?? on[0]!.id;
  }

  /** True when `target` reaches this box (used by the event socket). */
  reaches(target: BoxTarget, boxId: string | null | undefined): boolean {
    if (target === null || target === "all") return true;
    if (!boxId) return false;
    return this.resolve(target).includes(boxId);
  }

  /** A target as a value to put on an event: null stays null, "all" stays "all", a name becomes its id. */
  normalise(raw: unknown): BoxTarget {
    const target = cleanBoxTarget(raw);
    if (target === null || target === "all") return target;
    const ids = this.resolve(target);
    return ids.length === 1 ? ids[0]! : target;
  }
}
