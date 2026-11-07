// X-Ray: who is in what you're watching. Press Info while a film or episode plays to see the cast
// with photos and character names; OK on someone shows their bio. Prime Video's version knows who
// is on screen at each second, but that data isn't published anywhere, so this lists everyone in
// the film (or episode, with its guest stars) instead and says so.

import { createResource, For, Show } from "solid-js";
import type { PersonDetails } from "@ultimatetv/shared";
import { hub } from "./api";
import { DialogFrame } from "./components/Dialog";
import { Icon } from "./components/Icon";
import { nowPlaying } from "./player";
import { errorToast, openDialog } from "./store";

const year = (d: string | undefined) => d?.slice(0, 4);

function PersonCard(props: { person: PersonDetails; close: () => void }) {
  const p = () => props.person;
  return (
    <DialogFrame close={props.close} class="xray-person">
      <div class="xray-person-body">
        <Show when={p().photo}>
          <img class="xray-photo-big" src={p().photo} alt="" />
        </Show>
        <div>
          <h2>{p().name}</h2>
          <p class="xray-meta">
            {[p().born ? `Born ${year(p().born)}${p().died ? ` · died ${year(p().died)}` : ""}` : "", p().birthplace].filter(Boolean).join(" · ")}
          </p>
          <Show when={p().bio} fallback={<p>No biography on file.</p>}>
            <p class="xray-bio">{p().bio}</p>
          </Show>
          <Show when={p().knownFor.length}>
            <p class="xray-known">
              <strong>Known for</strong> {p().knownFor.join(" · ")}
            </p>
          </Show>
        </div>
      </div>
      <button class="option" data-focus onClick={() => props.close()}>
        Back to the cast
      </button>
    </DialogFrame>
  );
}

/** The Info key while a film or episode plays. */
export function openXray(): void {
  const np = nowPlaying();
  if (!np || np.req.kind !== "title") return;
  const titleId = np.req.id;
  const episodeId = np.req.episodeId;
  const name = np.title?.name ?? np.info.title;
  void openDialog((close) => {
    const [cast] = createResource(() => hub.cast(titleId, episodeId));
    const open = async (id: number) => {
      try {
        const person = await hub.person(id);
        await openDialog((back) => <PersonCard person={person} close={() => back()} />);
      } catch (e) {
        errorToast(e);
      }
    };
    return (
      <DialogFrame close={() => close()} class="xray" wide>
        <h2>
          <Icon name="info" /> In {name}
          <Show when={np.info.subtitle}> · {np.info.subtitle}</Show>
        </h2>
        <Show when={!cast.loading} fallback={<p>Looking up the cast…</p>}>
          <Show when={cast()?.cast.length} fallback={<p>No cast list for this one. Add a TMDB key in the Hub to get photos and characters.</p>}>
            <div class="xray-grid">
              <For each={cast()!.cast}>
                {(m) => (
                  <button class="xray-card" data-focus disabled={!m.id} onClick={() => m.id && void open(m.id)}>
                    <Show when={m.photo} fallback={<div class="xray-photo xray-nophoto">{m.name.slice(0, 1)}</div>}>
                      <img class="xray-photo" src={m.photo} alt="" loading="lazy" />
                    </Show>
                    <span class="xray-name">{m.name}</span>
                    <Show when={m.character}>
                      <span class="xray-character">{m.character}</span>
                    </Show>
                    <Show when={m.guest}>
                      <span class="xray-guest">Guest star</span>
                    </Show>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
        <p class="xray-note">Everyone in this {episodeId ? "episode" : "film"}, not just who is on screen this second: no free source has that. OK opens a bio, Back returns to the picture.</p>
      </DialogFrame>
    );
  });
}
