// Sport tonight (issue #231): the list from the Hub and what OK on a game offers.

import { createResource } from "solid-js";
import type { SportMatch, SportView } from "@ultimatetv/shared";
import { hub } from "./api";
import { choose } from "./components/Dialog";
import { openProgramme } from "./components/ProgrammeCard";
import { onHubEvent } from "./events";
import { errorToast, nav, toast } from "./store";

const [view, { refetch, mutate }] = createResource<SportView | null>(() => hub.sport().catch(() => null));
export { view as sportView, refetch as refetchSport };

onHubEvent((e) => {
  if (e.type === "sport.changed" || e.type === "recordings.changed") void refetch();
});

export const openSport = () => nav.push({ name: "sport" });

export async function sportCall(call: () => Promise<SportView>): Promise<void> {
  try {
    mutate(await call());
  } catch (err) {
    errorToast(err);
  }
}

export async function addTeam(name: string): Promise<void> {
  await sportCall(() => hub.sportAddTeam(name));
  toast(`Following ${name}: a reminder is set when they're on`, "good");
}

/** OK on a game: its card (Watch, Record, Remind), or follow a side in it. */
export async function pickMatch(m: SportMatch): Promise<void> {
  const mine = (view()?.teams ?? []).map((t) => t.toLowerCase());
  const follow = m.teams.filter((t) => !mine.includes(t.toLowerCase()));
  const stop = m.favourite;
  const pick = await choose<string>({
    title: m.programme.title,
    message: `${m.live ? "Live now" : m.when} · ${m.channelName}`,
    ...(m.programme.image ? { image: m.programme.image } : {}),
    options: [
      { label: m.live ? "Watch, record or details" : "Remind, record or details", value: "open", icon: "info" },
      ...follow.map((t) => ({ label: `Follow ${t}`, value: `follow:${t}`, icon: "heart" })),
      ...(stop ? [{ label: `Stop following ${stop}`, value: "stop" }] : []),
      { label: "Back", value: "back" },
    ],
  });
  if (pick === "open") {
    await openProgramme(m.programme);
    void refetch();
  }
  else if (pick?.startsWith("follow:")) await addTeam(pick.slice(7));
  else if (pick === "stop" && stop) {
    await sportCall(() => hub.sportRemoveTeam(stop));
    toast(`Stopped following ${stop}`);
  }
}
