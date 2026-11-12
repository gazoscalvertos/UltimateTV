// Following series (issue #226): the Coming up screen, the Home row "New episodes" and the pop-up
// when a followed episode arrives. A profile follows a series on purpose (Follow on its page) and
// the Hub also follows the ones it can tell the profile cares about: Saved for later, Continue
// watching, a series link, the play queue. Taking one off is remembered, so it stays off.

import type { NextAiring } from "./household.js";
import type { TitleRef } from "./domain.js";

/** Why a series is on the list. */
export type FollowReason = "followed" | "saved" | "watching" | "link" | "queue";

export interface FollowedSeries {
  title: TitleRef;
  reason: FollowReason;
}

/** An episode that hasn't aired yet. */
export interface ComingUpEpisode {
  title: TitleRef;
  season: number;
  episode: number;
  /** The episode's name, when TMDB has it. */
  name?: string;
  /** The air date, `2026-11-14`. */
  airDate: string;
  /** Midnight of the air date (the Hub's local time), for sorting. */
  airsAt: number;
  /** "Tomorrow", "Sat 14 Nov". */
  when: string;
  /** When it is on the household's channels, when the guide has it: one-press Remind and Record. */
  next?: NextAiring;
}

/** An episode that has just arrived. */
export interface NewEpisode {
  title: TitleRef;
  /** `s2e5`. */
  episodeId: string;
  season: number;
  episode: number;
  name?: string;
  /** When it aired, or when the media server added it. */
  at: number;
  /** In a media server library now, so it plays at once. */
  inLibrary: boolean;
}

export interface FollowingView {
  followed: FollowedSeries[];
  comingUp: ComingUpEpisode[];
  newEpisodes: NewEpisode[];
  /** Pop up on the TV the day a followed episode arrives. */
  popups: boolean;
  /** False when TMDB isn't set up, so air dates can't be known (the library's new episodes still show). */
  schedule: boolean;
}

/** "S2 E5 · The Name", the way cards and pop-ups say it. */
export function newEpisodeLabel(e: { season: number; episode: number; name?: string }): string {
  return `S${e.season} E${e.episode}${e.name ? ` · ${e.name}` : ""}`;
}
