// Features each screen can switch off (issue #124). Every paired client (the TV box, the desktop
// app, the Android watching app) keeps its own list of what's switched off, on the Hub, keyed by
// its paired-device id; the phone remote follows the TV it controls. Everything is on until
// someone switches it off, so a new screen or an older Hub changes nothing.

/** A part of the app that can be switched off on one screen. */
export type FeatureId = "live" | "films" | "shows" | "music" | "recordings" | "downloads" | "search" | "cast" | "weather" | "mix" | "clips" | "notifications";

/** What sort of app a paired device is running, as it says when it asks for its features. */
export type ClientKind = "box" | "desktop" | "browser" | "android" | "remote";

export interface FeatureInfo {
  id: FeatureId;
  label: string;
  /** What switching it off hides, in a line. */
  detail: string;
  /** The apps that have this feature; it isn't offered for the others. */
  clients: ClientKind[];
}

const SCREENS: ClientKind[] = ["box", "desktop", "browser"];
const ALL: ClientKind[] = [...SCREENS, "android", "remote"];

export const FEATURES: FeatureInfo[] = [
  { id: "live", label: "Live TV and guide", detail: "The TV Guide, live channels on Home, channel up/down and the Guide button.", clients: ALL },
  { id: "films", label: "Films", detail: "The Films tab and films on Home.", clients: ALL },
  { id: "shows", label: "TV shows", detail: "The TV Shows tab and series on Home.", clients: ALL },
  { id: "music", label: "Music", detail: "The Music tab (Spotify and Deezer).", clients: [...SCREENS, "remote"] },
  { id: "recordings", label: "Recordings", detail: "The Recordings tab, recordings on Home and the red-key shortcut.", clients: ALL },
  { id: "downloads", label: "Downloads", detail: "Programmes downloaded to this box or phone to watch away from home, and their tab.", clients: ALL },
  { id: "search", label: "Search", detail: "The search button and the yellow-key shortcut.", clients: ALL },
  { id: "cast", label: "Cast & games", detail: "Casting, screen sharing, games and the blue-key shortcut.", clients: [...SCREENS, "remote"] },
  { id: "weather", label: "Weather", detail: "The weather page, the top-bar chip and the weather on Home.", clients: [...SCREENS, "remote"] },
  { id: "mix", label: "Music video channels", detail: "Clubland, House and the other music video channels in the guide.", clients: [...SCREENS, "remote"] },
  { id: "clips", label: "Projected clips", detail: "Clips and jump scares shown over the picture.", clients: [...SCREENS, "remote"] },
  { id: "notifications", label: "Pop-ups and news flashes", detail: "Doorbell pop-ups, alerts and news flashes over the picture.", clients: [...SCREENS, "remote"] },
];

const IDS = new Set<string>(FEATURES.map((f) => f.id));

export const isFeatureId = (v: unknown): v is FeatureId => typeof v === "string" && IDS.has(v);

export const isClientKind = (v: unknown): v is ClientKind => typeof v === "string" && (ALL as string[]).includes(v);

/** A list of switched-off features from anywhere: unknown names dropped, each once, in catalogue order. */
export function cleanFeatureList(raw: unknown): FeatureId[] {
  const asked = new Set(Array.isArray(raw) ? raw.filter(isFeatureId) : []);
  return FEATURES.map((f) => f.id).filter((id) => asked.has(id));
}

/** The features a kind of app has (all of them when it hasn't said what it is). */
export function featuresFor(client: ClientKind | null | undefined): FeatureInfo[] {
  return client ? FEATURES.filter((f) => f.clients.includes(client)) : FEATURES;
}

/**
 * The feature a TV-app screen belongs to, by its route name (and the browse kind), or undefined
 * for screens that are always there (Home, Settings, the player, profiles).
 */
export function featureOfRoute(route: { name: string; kind?: string }): FeatureId | undefined {
  switch (route.name) {
    case "guide":
    case "guide-edit":
      return "live";
    case "browse":
      return route.kind === "series" ? "shows" : "films";
    case "music":
    case "music-list":
      return "music";
    case "planner":
      return "recordings";
    case "downloads":
      return "downloads";
    case "search":
      return "search";
    case "cast":
      return "cast";
    case "weather":
      return "weather";
    case "mix-channel":
      return "mix";
    default:
      return undefined;
  }
}

/** The feature something played belongs to: live and music video channels, recordings, films and series. */
export function featureOfPlayback(req: { kind: string; id?: string }, title?: { kind?: string } | null): FeatureId | undefined {
  // The Hub's own music video channels are "mix:<name>".
  if (req.kind === "channel" && req.id?.startsWith("mix:")) return "mix";
  if (req.kind === "channel" || req.kind === "catchup") return "live";
  if (req.kind === "recording") return "recordings";
  if (req.kind === "title") return title?.kind === "series" ? "shows" : title?.kind === "movie" ? "films" : undefined;
  return undefined;
}

/** The features the phone remote hides: those switched off on every TV it controls. */
export function remoteFeatures(tvs: FeatureId[][]): FeatureId[] {
  if (tvs.length === 0) return [];
  return cleanFeatureList(tvs[0]!.filter((id) => tvs.every((list) => list.includes(id))));
}

/** What a client gets from GET /api/features. */
export interface ClientFeatureState {
  /** The paired device asking, or null when the Hub doesn't need pairing. */
  device: string | null;
  client: ClientKind | null;
  /** Switched off on this client (for the phone remote: on every TV it controls). */
  off: FeatureId[];
  /** The features this kind of app has, for its settings page. */
  features: FeatureInfo[];
}

/** One paired device on the Hub settings page. */
export interface DeviceFeatures {
  id: string;
  name: string;
  /** "tv" or "phone", from pairing. */
  kind: "tv" | "phone";
  client: ClientKind | null;
  off: FeatureId[];
}
