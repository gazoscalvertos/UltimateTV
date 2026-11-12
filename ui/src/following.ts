// Following series (issue #226): the Follow button on a series page and the pop-up when a followed
// episode arrives. The lists themselves (Coming up, New episodes) come from the Hub.

import { createResource } from "solid-js";
import type { FollowingView, TitleRef } from "@ultimatetv/shared";
import { hub } from "./api";
import { onHubEvent } from "./events";
import { profile, toast } from "./store";
import { nav } from "./store";

const [view, { refetch, mutate }] = createResource<FollowingView | null>(() => hub.following().catch(() => null));
export { view as followingView, refetch as refetchFollowing };

/** Whether a series is on the profile's list (by choice or by itself). */
export const isFollowing = (id: string | undefined): boolean => Boolean(id && view()?.followed.some((f) => f.title.id === id));

export async function setFollowing(title: TitleRef, on: boolean): Promise<void> {
  mutate(on ? await hub.follow(title) : await hub.unfollow(title));
  toast(on ? `Following ${title.name}: new episodes show on Home and Coming up` : `Stopped following ${title.name}`, on ? "good" : undefined);
}

/** Starts listening: a followed series' new episode pops up for the profile that follows it. Returns the unsubscribe. */
export function startEpisodePopups(): () => void {
  return onHubEvent((e) => {
    if (e.type === "following.changed") void refetch();
    if (e.type !== "episode.new") return;
    const me = profile();
    if (!me || (e.profileId !== null && e.profileId !== me.id)) return;
    // A household-wide list is for the grown-ups: a Kids profile or a Guest isn't told.
    if (e.profileId === null && (me.kind === "kids" || me.kind === "guest")) return;
    toast(e.message, "good");
    void refetch();
  });
}

export const openComingUp = () => nav.push({ name: "coming-up" });
