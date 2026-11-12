// Your requests (issue #225): what this profile asked for and where each got to. An adult also
// sees the Kids and Guest requests waiting for a yes, and everyone else's.

import { Index, onMount, Show } from "solid-js";
import { dayLabel, REQUEST_STATUS_LABEL, requestActive } from "@ultimatetv/shared";
import type { TitleRequest } from "@ultimatetv/shared";
import { choose } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { answerRequest, refetchRequests, requestsView } from "../requests";
import { isLimited, nav } from "../store";

async function pick(r: TitleRequest): Promise<void> {
  const awaiting = r.status === "awaiting" && !isLimited();
  const choice = await choose<"approve" | "decline" | "open" | "back">({
    title: r.name,
    message: `${REQUEST_STATUS_LABEL[r.status]}. Asked by ${r.profileName}, ${dayLabel(r.at)}.${r.note ? ` ${r.note}.` : ""}`,
    options: [
      ...(awaiting ? [{ label: "Approve", value: "approve" as const, icon: "check" as const }, { label: "Not this time", value: "decline" as const }] : []),
      { label: "Open the title", value: "open", icon: "info" },
      { label: "Back", value: "back" },
    ],
  });
  if (choice === "approve" || choice === "decline") await answerRequest(r, choice);
  if (choice === "open") nav.push({ name: "details", id: r.titleId });
}

function Rows(props: { items: TitleRequest[]; first: boolean }) {
  return (
    <div class="list">
      <Index each={props.items}>
        {(r, i) => (
          <button class="list-row" data-row data-focus data-autofocus={props.first && i === 0 ? "" : undefined} onClick={() => void pick(r())}>
            <Show when={r().poster} fallback={<div class="list-art card-fallback" />}>
              <img class="list-art" src={r().poster} alt="" />
            </Show>
            <span class="list-main">
              <span class="list-title">
                {r().name}
                {r().year ? ` (${r().year})` : ""} <span class="flag" classList={{ "flag-good": r().status === "ready" }}>{REQUEST_STATUS_LABEL[r().status]}</span>
              </span>
              <span class="list-sub">
                {r().kind === "series" ? "Series" : "Film"} · {r().profileName} · {dayLabel(r().at)}
                {r().note ? ` · ${r().note}` : ""}
              </span>
            </span>
            <Icon name={requestActive(r().status) ? "download" : r().status === "ready" ? "check" : "info"} class="list-icon" />
          </button>
        )}
      </Index>
    </div>
  );
}

export function RequestsScreen() {
  const v = () => requestsView();
  onMount(() => void refetchRequests());
  return (
    <div class="screen planner requests" data-layer>
      <TopBar />
      <div class="page" data-scroll-y="160">
        <div class="planner-head" data-row>
          <h1 class="page-title">Your requests</h1>
          <p class="muted">Films and series that aren't in the library yet. Ask for one from its page or in search; you'll be told when it is ready.</p>
        </div>
        <Show when={v()} fallback={<p class="empty">Looking…</p>}>
          {(view) => (
            <>
              <Show when={view().awaiting.length}>
                <h3 class="rail-title" data-row>Waiting for a grown-up</h3>
                <Rows items={view().awaiting} first />
              </Show>
              <Show
                when={view().requests.length}
                fallback={
                  <p class="empty" data-row>
                    {view().configured ? "Nothing requested yet. Open a title that isn't in your library and choose Request." : "Requests aren't set up. Add Jellyseerr, Radarr or Sonarr on the phone's setup page."}
                  </p>
                }
              >
                <h3 class="rail-title" data-row>{isLimited() ? "Asked for" : "Requests"}</h3>
                <Rows items={view().requests} first={!view().awaiting.length} />
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}
