// More than one TV box (issue #103). A "box" is a screen running the TV app, which is a paired
// device of kind "tv": it already has a name and an id, and the Hub already knows when it is
// connected. What was missing was letting the rest of the Hub say *which* box it means: a key press
// from the bedroom phone, a pop-up, the sleep timer, and whose film is playing.

/** One TV box, as the phone and the setup page see it. */
export interface TvBox {
  /** The paired device's id: the same key the Hub uses for features and unpairing. */
  id: string;
  /** The name given in Settings › Phones and remotes ("Living room"). */
  name: string;
  /** A TV app is connected right now. */
  online: boolean;
  /** How many TV apps are connected as this box (normally one, more if it reconnected). */
  connections: number;
  /** When it was last connected, in milliseconds. */
  lastSeenAt: number;
  /** The address it last called from. */
  ip?: string;
}

/** Who an action is for: one box, every box, or (null) whichever box the Hub treats as the main one. */
export type BoxTarget = string | "all" | null;

export const BOX_ALL = "all";

/**
 * Reads a box target from a request or a message. Anything unrecognised is null, which means "the
 * only box, or the first one": the behaviour before a second box existed.
 */
export function cleanBoxTarget(raw: unknown): BoxTarget {
  if (raw && typeof raw === "object") raw = (raw as { box?: unknown; boxId?: unknown }).box ?? (raw as { boxId?: unknown }).boxId;
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v) return null;
  if (v.toLowerCase() === BOX_ALL) return BOX_ALL;
  // A target is either a paired device id (12 lowercase hex characters, see pairing.ts) or the name
  // people gave the box: "Living room", "Kids' room", "Bedroom TV". Any printable word is accepted
  // and the registry decides whether it knows it, so a box name with a space works like any other.
  return /^[\p{L}\p{N}][\p{L}\p{N} '\-_.&()]{0,39}$/u.test(v) ? v : null;
}

/** True when `target` means this box. */
export function boxMatches(target: BoxTarget, boxId: string | null | undefined): boolean {
  if (target === BOX_ALL) return true;
  if (target === null) return true;
  return target === boxId;
}

/** Sort: online first, then by name, so the phone's picker lists the usable one at the top. */
export function sortBoxes(boxes: readonly TvBox[]): TvBox[] {
  return [...boxes].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  });
}

/** The box an action should go to when the caller didn't say: the only one, or the first online. */
export function pickBox(boxes: readonly TvBox[]): TvBox | null {
  const sorted = sortBoxes(boxes);
  return sorted.find((b) => b.online) ?? sorted[0] ?? null;
}

/** "Living room" or, with none, "the TV". */
export function boxName(boxes: readonly TvBox[], id?: string | null): string {
  const found = id ? boxes.find((b) => b.id === id) : undefined;
  return found?.name ?? (id ? "that TV" : boxes.length ? boxes[0]!.name : "the TV");
}

/** What a notice or a webhook should say about where it went. */
export function boxTargetLabel(boxes: readonly TvBox[], target: BoxTarget): string {
  if (target === BOX_ALL) return boxes.length > 1 ? "every TV" : "the TV";
  return boxName(boxes, target);
}
