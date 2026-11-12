// Requesting a title that isn't in the library (issue #225): the Request button on a title's page,
// the pop-ups ("X is ready", and an adult being asked to approve a child's request) and the list.

import { createResource } from "solid-js";
import type { RequestsView, TitleDetails, TitleRequest } from "@ultimatetv/shared";
import { hub } from "./api";
import { choose } from "./components/Dialog";
import { onHubEvent } from "./events";
import { errorToast, isLimited, nav, profile, toast } from "./store";

const [view, { refetch, mutate }] = createResource<RequestsView | null>(() => hub.requests().catch(() => null));
export { view as requestsView, refetch as refetchRequests, mutate as mutateRequests };

/** Requests are set up on the Hub: until then every part of this stays out of sight. */
export const requestsOn = (): boolean => Boolean(view()?.configured);

export const openRequests = () => nav.push({ name: "requests" });

/** Asks for a title. An adult's goes to Jellyseerr/Radarr/Sonarr now; a child's waits for a grown-up. */
export async function requestTitle(d: Pick<TitleDetails, "id" | "kind" | "name" | "year" | "poster">): Promise<TitleRequest | null> {
  try {
    const { request } = await hub.request({ id: d.id, kind: d.kind, name: d.name, ...(d.year ? { year: d.year } : {}), ...(d.poster ? { poster: d.poster } : {}) });
    toast(request.status === "awaiting" ? `Asked a grown-up for ${d.name}` : `Requested ${d.name}: you'll be told when it's ready`, "good");
    void refetch();
    return request;
  } catch (err) {
    errorToast(err);
    return null;
  }
}

/** An adult answers a child's request, from the TV. */
export async function answerRequest(r: TitleRequest, answer: "approve" | "decline"): Promise<void> {
  try {
    await hub.answerRequest(r.id, answer);
    toast(answer === "approve" ? `Requested ${r.name} for ${r.profileName}` : `Told ${r.profileName} not this time`, "good");
    void refetch();
  } catch (err) {
    errorToast(err);
  }
}

export async function askAboutRequest(r: TitleRequest): Promise<void> {
  const pick = await choose<"approve" | "decline" | "later">({
    title: `${r.profileName} would like ${r.name}`,
    message: "Approving sends it to be downloaded. The first grown-up to answer decides.",
    options: [
      { label: "Approve", value: "approve", icon: "check" },
      { label: "Not this time", value: "decline" },
      { label: "Later", value: "later" },
    ],
  });
  if (pick === "approve" || pick === "decline") await answerRequest(r, pick);
}

/** Listens for arrivals and for a child's request. Returns the unsubscribe. */
export function startRequestPopups(): () => void {
  const asking = new Set<string>();
  return onHubEvent((e) => {
    if (e.type === "requests.changed") void refetch();
    const me = profile();
    if (e.type === "request.ready") {
      // The profile that asked is told; a request from the household's phone is for the grown-ups.
      const mine = e.profileId === null ? !me || !isLimited() : me?.id === e.profileId;
      if (mine) toast(e.message, "good");
    }
    if (e.type === "request.awaiting" && me && !isLimited() && !asking.has(e.request.id)) {
      asking.add(e.request.id);
      void askAboutRequest(e.request).finally(() => asking.delete(e.request.id));
    }
  });
}
