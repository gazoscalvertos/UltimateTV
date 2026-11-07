// "Ask a parent" (issue #224). A Kids or Guest profile that opens something it isn't allowed gets
// an Ask a parent button; the request lands as a pop-up on the TV when an adult profile is on, and
// on paired phones. The first adult answer wins and the child sees "Yes" or "Not now".

import { createSignal, onCleanup, Show } from "solid-js";
import type { KidsAllowKind, KidsAsk } from "@ultimatetv/shared";
import { ApiError, hub } from "./api";
import { choose } from "./components/Dialog";
import { Icon } from "./components/Icon";
import { onHubEvent } from "./events";
import { errorToast, isLimited, toast } from "./store";

/** What the Hub names a title that was out of bounds, from the 403 it answered with. */
export function askableOf(err: unknown): { id: string; kind: KidsAllowKind; name: string } | null {
  if (!(err instanceof ApiError) || err.code !== "profile") return null;
  const a = err.body.askable as { id?: unknown; kind?: unknown; name?: unknown } | undefined;
  if (!a || typeof a.id !== "string" || typeof a.name !== "string") return null;
  const kind: KidsAllowKind = a.kind === "series" || a.kind === "channel" ? a.kind : "movie";
  return { id: a.id, kind, name: a.name };
}

/** The button, and what it says once an adult has answered. */
export function AskParent(props: { title: { id: string; kind: KidsAllowKind; name: string }; onYes: () => void }) {
  const [ask, setAsk] = createSignal<KidsAsk | null>(null);
  const [busy, setBusy] = createSignal(false);
  let timer: number | undefined;
  onCleanup(() => window.clearInterval(timer));

  const watch = (id: string) => {
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      void hub.kidsAsks().then(
        (r) => {
          const mine = r.asks.find((a) => a.id === id);
          if (!mine || mine.status === "pending") return;
          window.clearInterval(timer);
          setAsk(mine);
          if (mine.status !== "no") props.onYes();
        },
        () => undefined,
      );
    }, 3000);
  };
  const send = async () => {
    setBusy(true);
    try {
      const { ask: made } = await hub.askParent(props.title);
      setAsk(made);
      if (made.status === "pending") watch(made.id);
      else if (made.status !== "no") props.onYes();
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="ask-parent">
      <Show when={ask()?.status !== "pending" && ask()?.status !== "no"}>
        <button class="btn btn-large btn-primary" data-focus data-autofocus disabled={busy()} onClick={() => void send()}>
          <Icon name="lock" /> Ask a parent
        </button>
      </Show>
      <Show when={ask()?.status === "pending"}>
        <p class="ask-parent-status" role="status">Asked. Waiting for a grown-up to say yes…</p>
      </Show>
      <Show when={ask()?.status === "no"}>
        <p class="ask-parent-status" role="status">Not now. Maybe ask again later.</p>
      </Show>
    </div>
  );
}

/** The pop-up an adult profile gets on the TV when a child asks. */
export function startAskParentPopups(): () => void {
  const answering = new Set<string>();
  return onHubEvent(async (e) => {
    if (e.type !== "kids.ask" || e.ask.status !== "pending" || isLimited() || answering.has(e.ask.id)) return;
    const ask = e.ask;
    answering.add(ask.id);
    const canAlways = ask.profileKind === "kids";
    const pick = await choose<"once" | "always" | "no">({
      title: `${ask.profileName} is asking to watch ${ask.name}`,
      message: "The first grown-up to answer decides.",
      options: [
        { label: "Allow once", value: "once", icon: "play" },
        ...(canAlways ? [{ label: "Always allow", value: "always" as const, icon: "check" as const }] : []),
        { label: "No", value: "no" },
      ],
    });
    answering.delete(ask.id);
    // Backing out leaves it for a phone to answer.
    if (!pick) return;
    try {
      await hub.answerKidsAsk(ask.id, pick);
      toast(pick === "no" ? `Told ${ask.profileName} not now` : pick === "once" ? `${ask.name} is allowed for ${ask.profileName} for this evening` : `${ask.name} is always allowed for ${ask.profileName}`, "good");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) toast("Someone else has already answered", "bad");
      else errorToast(err);
    }
  });
}
