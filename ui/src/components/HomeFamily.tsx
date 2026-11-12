// "Today" on Home: the next few things for the household (calendar events, birthdays, bin day, the
// school run), under the weather. A Kids profile gets a reduced version; a Guest gets nothing.

import { For, Show } from "solid-js";
import { binNotice, whenLabel } from "@ultimatetv/shared";
import { family, familyNext, familyViewer } from "../family";
import { now } from "../store";

export function HomeFamily() {
  const st = () => {
    const f = family();
    return f?.configured && f.onHome && familyViewer() !== "guest" ? f : undefined;
  };
  return (
    <Show when={st()}>
      {(f) => {
        const items = () => familyNext(f().homeItems);
        const bin = () => binNotice(f().items, now(), 17);
        return (
          <aside class="home-family" aria-label="Today in the family">
            <h3>Coming up at home</h3>
            <Show when={bin()}>
              <div class="family-bin">{bin()}</div>
            </Show>
            <Show when={items().length} fallback={<div class="family-none">Nothing planned</div>}>
              <ul>
                <For each={items()}>
                  {(i) => (
                    <li class={`family-item kind-${i.kind}`}>
                      <span class="family-when">{whenLabel(i, now())}</span>
                      <span class="family-title">{i.title}</span>
                      <Show when={i.detail}>
                        <small>{i.detail}</small>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </aside>
        );
      }}
    </Show>
  );
}
