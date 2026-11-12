// Which rows Home shows, and in what order, per profile (issue #99). Every profile keeps its own
// list on the Hub; a row that's switched off isn't fetched at all, so Home loads faster. Two
// presets put it back: Simple Home is the short list, Everything is every row in the usual order.

/** A row Home can show. The ids are the rail ids `/api/home` returns. */
export type HomeRowId =
  | "live"
  | "recordings"
  | "continue"
  | "watchlist"
  | "favourites"
  | "nextup"
  | "new-episodes"
  | "requests"
  | "because"
  | "kids-films"
  | "kids-series"
  | "films-tonight"
  | "sport"
  | "latest"
  | "trending"
  | "iptv-vod";

export interface HomeRowInfo {
  id: HomeRowId;
  label: string;
  /** What the row shows, in a line, for the settings page. */
  detail: string;
}

/**
 * Every row, in the order Home has always shown them. The build order in Library.home differs
 * slightly (Continue watching comes first there whenever it has anything, as it always has), so
 * this is the settings page's order and the order a list that has never been touched is shown in.
 */
export const HOME_ROWS: HomeRowInfo[] = [
  { id: "live", label: "Live now", detail: "What's on the channels you watch most, right now." },
  { id: "continue", label: "Continue watching", detail: "Films and series you're part-way through." },
  { id: "recordings", label: "Recently recorded", detail: "Recordings that are ready and not yet watched." },
  { id: "watchlist", label: "Saved for later", detail: "Titles saved with the Record button or from the phone." },
  { id: "favourites", label: "Favourites", detail: "Films and series starred on this profile." },
  { id: "nextup", label: "Next up", detail: "The next episode of series you're watching." },
  { id: "new-episodes", label: "New episodes", detail: "Brand new episodes of the series you follow (#226)." },
  { id: "requests", label: "Your requests", detail: "Films and series you asked for that aren't here yet, and the ones that just arrived (#225)." },
  { id: "because", label: "Because you watched", detail: "Picks based on the last thing played on this profile." },
  { id: "kids-films", label: "Family films", detail: "Films picked for children (a kids profile)." },
  { id: "kids-series", label: "Cartoons and kids' shows", detail: "Children's series (a kids profile)." },
  { id: "sport", label: "Sport today", detail: "Live and upcoming sport in the guide, your teams first (#231)." },
  { id: "films-tonight", label: "Films on TV today", detail: "Films in the guide this evening." },
  { id: "latest", label: "Recently added", detail: "New films in the Jellyfin library." },
  { id: "trending", label: "Trending this week", detail: "What's popular at the moment (needs a streaming addon)." },
  { id: "iptv-vod", label: "New films from your IPTV", detail: "Films your IPTV provider has added." },
];

/** The short list Simple Home leaves on: what's on, what you're watching, and what you recorded. */
export const SIMPLE_HOME_ROWS: HomeRowId[] = ["live", "continue", "recordings"];

const IDS = new Set<string>(HOME_ROWS.map((r) => r.id));

export const isHomeRowId = (v: unknown): v is HomeRowId => typeof v === "string" && IDS.has(v);

/** A list of row ids from anywhere: unknown ones dropped, each once, in the order given. */
export function cleanHomeRowList(raw: unknown): HomeRowId[] {
  const seen = new Set<string>();
  const out: HomeRowId[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (!isHomeRowId(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** What the settings page shows and the TV follows. */
export type HomeRowsPreset = "everything" | "simple" | "custom";

export interface HomeRowState extends HomeRowInfo {
  /** Switched on: the row is shown (whenever it has anything to show). */
  on: boolean;
}

export interface HomeRowsView {
  /** Every row, in this profile's order, with whether it's on. */
  rows: HomeRowState[];
  preset: HomeRowsPreset;
}

/** Whether a row is one Home builds for everyone, or only for some profiles. */
export function homeRowLabel(id: HomeRowId): string {
  return HOME_ROWS.find((r) => r.id === id)?.label ?? id;
}
