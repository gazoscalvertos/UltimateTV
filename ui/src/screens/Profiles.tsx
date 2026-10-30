// "Who's watching?" Picking a profile with a PIN asks for it first.

import { createResource, For, Show } from "solid-js";
import type { Profile } from "@ultimatetv/shared";
import { ApiError, hub, session } from "../api";
import { askPin } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { useKeys } from "../keys";
import { askForMoreTime, kidsProfileEntered } from "../kidstime";
import { loadChannels } from "../player";
import { errorToast, nav, setProfile } from "../store";

export async function enterProfile(p: Profile): Promise<boolean> {
  try {
    // Time's up on this Kids profile: an adult's PIN gives more, or it stays on the picker.
    if (!(await askForMoreTime(p))) return false;
    let token: string | null = null;
    if (p.hasPin) {
      const ok = await askPin(`Enter the PIN for ${p.name}`, async (pin) => {
        try {
          token = (await hub.unlock(p.id, pin)).token;
          return null;
        } catch (err) {
          return err instanceof ApiError && err.status === 403 ? "That PIN isn't right. Try again." : String(err);
        }
      });
      if (!ok) return false;
    } else {
      token = (await hub.unlock(p.id)).token;
    }
    session.set(p.id, token);
    setProfile(p);
    await loadChannels().catch(() => undefined);
    nav.reset({ name: "home" });
    if (p.kind === "kids") kidsProfileEntered();
    return true;
  } catch (err) {
    errorToast(err);
    return false;
  }
}

export function Profiles() {
  const [data] = createResource(() => hub.profiles());
  useKeys((a) => a === "back"); // Nowhere to go back to.
  return (
    <div class="screen profiles-screen" data-layer>
      <h1 class="profiles-title">Who's watching?</h1>
      <Show when={data()} fallback={<div class="spinner" />}>
        <div class="profiles" data-focus-group>
          <For each={data()!.profiles}>
            {(p, i) => (
              <button class="profile" data-focus data-autofocus={(session.profileId ? p.id === session.profileId : i() === 0) ? "" : undefined} onClick={() => void enterProfile(p)}>
                <span class="avatar" style={{ "--c": p.colour }}>
                  {p.name.slice(0, 1)}
                  <Show when={p.hasPin}>
                    <span class="avatar-lock">
                      <Icon name="lock" />
                    </span>
                  </Show>
                </span>
                <span class="profile-name">{p.name}</span>
                <Show when={p.kind === "kids"}>
                  <span class="profile-kind">Kids · up to {p.maxCertification}</span>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
