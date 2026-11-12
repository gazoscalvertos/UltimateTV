// Requesting a film or series that isn't in the library (issue #225). A title with no source shows
// a Request button; the Hub hands it to Jellyseerr/Overseerr, or straight to Radarr and Sonarr,
// follows it until it arrives and tells the TV and the phone. A Kids or Guest profile can only ask:
// an adult approves first, the same way as Ask a parent.

import type { TitleKind, TitleRef } from "./domain.js";

/** Where a request is up to. "awaiting" is a Kids or Guest request that no adult has answered yet. */
export type RequestStatus = "awaiting" | "requested" | "downloading" | "ready" | "declined" | "failed";

export interface TitleRequest {
  id: string;
  /** The title's id (`tmdb:movie:603`). */
  titleId: string;
  kind: TitleKind;
  name: string;
  year?: number;
  poster?: string;
  /** Who asked; `null` is the household's phone, which isn't a profile. */
  profileId: string | null;
  profileName: string;
  profileKind: "adult" | "kids" | "guest" | "phone";
  at: number;
  status: RequestStatus;
  updatedAt: number;
  /** Set when it failed or an adult said no, in words for the screen. */
  note?: string;
}

/** Which program takes the requests. */
export type RequestVia = "jellyseerr" | "arr";

export interface RequestsView {
  /** False until Jellyseerr/Overseerr or Radarr/Sonarr is set up: the TV hides Request completely. */
  configured: boolean;
  via?: RequestVia;
  /** This profile's own requests (an adult sees everyone's), newest first. */
  requests: TitleRequest[];
  /** Kids and Guest requests waiting for a grown-up: only filled in for an adult. */
  awaiting: TitleRequest[];
}

/** What the details page needs to know about requesting this title. */
export interface TitleRequestState {
  /** Requests are set up and the title isn't in the library, so Request is offered. */
  requestable: boolean;
  /** The latest request for it, if there is one. */
  request?: Pick<TitleRequest, "id" | "status" | "profileName" | "at">;
}

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  awaiting: "Waiting for a grown-up",
  requested: "Requested",
  downloading: "Downloading",
  ready: "Ready",
  declined: "Not this time",
  failed: "Couldn't request it",
};

/** A request still in progress: it can't be asked for again, and the Hub keeps following it. */
export const requestActive = (s: RequestStatus): boolean => s === "awaiting" || s === "requested" || s === "downloading";

/** Most Kids/Guest requests that can wait for an adult at once, per profile. */
export const REQUEST_AWAITING_LIMIT = 8;
/** How long a request stays in the list once it's ready, declined or failed. */
export const REQUEST_KEEP_DAYS = 30;

/** `tmdb:movie:603` or `tmdb:series:1399` as a TMDB id and kind; null for any other kind of id. */
export function tmdbOfTitleId(id: string): { kind: "movie" | "series"; tmdbId: number } | null {
  const m = /^tmdb:(movie|series):(\d+)$/.exec(id);
  return m ? { kind: m[1] as "movie" | "series", tmdbId: Number(m[2]) } : null;
}

export const requestTitleRef = (r: TitleRequest): TitleRef => ({ id: r.titleId, kind: r.kind, name: r.name, ...(r.year ? { year: r.year } : {}), ...(r.poster ? { poster: r.poster } : {}), badges: [REQUEST_STATUS_LABEL[r.status]] });

/** The Hub's settings for the programs that take requests. A key left out of the form keeps the one saved. */
export interface RequestSettings {
  jellyseerr?: { url: string; apiKey: string };
  radarr?: { url: string; apiKey: string; qualityProfileId?: number; rootFolder?: string };
  sonarr?: { url: string; apiKey: string; qualityProfileId?: number; rootFolder?: string };
}

/** The settings as the UI sees them: keys replaced by "set". */
export interface PublicRequestSettings {
  configured: boolean;
  via?: RequestVia;
  jellyseerr?: { url: string };
  radarr?: { url: string };
  sonarr?: { url: string };
}

/** What Test found out about one program. */
export interface RequestTestResult {
  app: "jellyseerr" | "radarr" | "sonarr";
  ok: boolean;
  /** "Jellyseerr 2.1.0", "Radarr 5.9". */
  detail?: string;
  error?: string;
  ms: number;
}
