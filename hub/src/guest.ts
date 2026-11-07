// What a Guest may do. A Guest is for visitors and babysitters: adult-rated up to a limit of its
// own, its own pick of the sections, and no settings, recordings or downloads at all. The limits
// are enforced here and in the routes (hub/src/server.ts), not just in the UI.
//
// "Nothing it watches is kept" is the other half: POST /api/progress is dropped for a Guest, so
// no progress row is written and Jellyfin is never told, and Home leaves out its history rails.

import { guestAllows, type FeatureId, type Profile } from "@ultimatetv/shared";

// The sections themselves live in shared (shared/src/guest.ts), so the TV hides exactly what the
// Hub refuses. What is here is the API side: which path belongs to which section.
export { GUEST_NEVER, GUEST_SECTIONS, guestAllows, guestSections, isGuestProfile } from "@ultimatetv/shared";

/** The API paths that are fine for any Guest: signing in, picking a profile, the box's own checks. */
const ALWAYS = ["/api/profiles", "/api/home", "/api/progress", "/api/offline/allowed", "/api/play", "/api/play/prefetch", "/api/stream", "/api/art", "/api/status", "/api/hello", "/api/health", "/api/system"];

/** The API paths a Guest is kept away from whatever sections it was given. */
const NEVER = ["/api/settings", "/api/recordings", "/api/downloads", "/api/series-links", "/api/reminders", "/api/continue", "/api/watchlist", "/api/favourites", "/api/search/history", "/api/queue", "/api/offline", "/api/backup", "/api/software", "/api/refresh", "/api/jellyfin", "/api/plex", "/api/emby", "/api/ha", "/api/alerts", "/api/adskip", "/api/subtitles/download", "/api/features", "/api/devices", "/api/pair"];

/** The sections a Guest may be given, and the API paths each one covers. */
const SECTIONS: [string, FeatureId][] = [
  ["/api/guide", "live"],
  ["/api/guides", "live"],
  ["/api/channels", "live"],
  ["/api/programmes", "live"],
  ["/api/live", "live"],
  ["/api/music", "music"],
  ["/api/search", "search"],
  ["/api/cast", "cast"],
  ["/api/weather", "weather"],
  ["/api/mix", "mix"],
  ["/api/mix-channels", "mix"],
  ["/api/clips", "clips"],
];

/** "/api/x" is under "/api/x" and "/api/x/…", but "/api/xy" is not. */
function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Which section an API path belongs to; "never" for the parts of the Hub no Guest may reach, and
 * null for paths that aren't sectioned (Home, playback, signing in). Concrete and :param paths
 * both work, so the same answer comes from the route table and from a test.
 */
export function guestRouteSection(route: string): FeatureId | "never" | null {
  const path = (route.split("?")[0] ?? route).replace(/\/+$/, "");
  if (ALWAYS.some((prefix) => under(path, prefix))) return null;
  if (NEVER.some((prefix) => under(path, prefix))) return "never";
  // Films and TV shows are the same route with a different kind.
  if (under(path, "/api/browse")) {
    const kind = path.split("/")[3];
    return kind === "movie" ? "films" : kind === "series" ? "shows" : null;
  }
  for (const [prefix, section] of SECTIONS) if (under(path, prefix)) return section;
  return null;
}

/** True when a Guest must be kept away from this API path (or told a section is switched off). */
export function guestBlocks(profile: Pick<Profile, "guestFeatures"> | null | undefined, route: string): boolean {
  const section = guestRouteSection(route);
  return section === "never" || (section !== null && !guestAllows(profile, section));
}

/** The section a piece of playback needs, by what it is: a recording is out, a channel is live. */
export function guestPlaybackSection(kind: "channel" | "catchup" | "recording" | "title" | "stream", titleKind?: "movie" | "series"): FeatureId | "never" | null {
  if (kind === "recording") return "never";
  if (kind === "channel" || kind === "catchup") return "live";
  if (titleKind === "series") return "shows";
  if (titleKind === "movie") return "films";
  return null;
}
