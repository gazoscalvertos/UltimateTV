// Share Play (issue #210): a one-off link to what the TV is playing, so someone with no app at all
// can watch along in a web browser, in step with the TV through Sync play (see watching.ts).
//
// The link is the only key: whoever opens it first gets it, nobody else can use it after them, and
// it stops working when it runs out, when it's cancelled, or when the TV moves on to something else.

/** How long a new link lasts unless the sharer says otherwise. */
export const SHARE_DEFAULT_MS = 6 * 60 * 60_000;
/** The longest a link may last. */
export const SHARE_MAX_MS = 24 * 60 * 60_000;
/** A browser that hasn't asked the Hub anything for this long has gone, and the TV carries on alone. */
export const SHARE_VIEWER_GONE_MS = 60_000;

/** A share link as the sharer sees it (POST and GET /api/share). */
export interface ShareLinkView {
  id: string;
  /** The link to send: opens the watch page in any browser. */
  url: string;
  /** The screen whose playback is shared (a TV box's device id). */
  host: string;
  hostName: string;
  name: string;
  subtitle?: string;
  createdAt: number;
  expiresAt: number;
  /** Someone has opened it: no other browser can use it now. */
  opened: boolean;
  /** What the person watching called themselves. */
  viewerName?: string;
  /** They are watching along right now. */
  watching: boolean;
}

/** What the watch page is told before it joins (GET /share/:token/info). */
export interface SharePageInfo {
  name: string;
  subtitle?: string;
  /** "/share/<token>/art", so the picture comes through the Hub. */
  artwork?: string;
  hostName: string;
  expiresAt: number;
  durationMs?: number;
  appName: string;
}

/** Why a link can't be used, for the watch page to say plainly. */
export type ShareProblem = "expired" | "taken" | "moved-on" | "stopped" | "not-shareable";

/** The words for each problem. */
export const SHARE_PROBLEMS: Record<ShareProblem, string> = {
  expired: "This link has run out. Ask for a new one.",
  taken: "This link has already been opened on another device. Ask for a new one.",
  "moved-on": "The TV has moved on to something else, so this link has finished.",
  stopped: "It isn't playing on the TV at the moment. Try again once it's playing.",
  "not-shareable": "Only films and TV episodes from the library can be shared.",
};
