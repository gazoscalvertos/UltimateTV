// Subtitles beyond what a file comes with: when a profile wants them and the film has none in the
// right language (TorBox and IPTV copies often don't), the Hub fetches some from OpenSubtitles and
// the box adds them. Options › Subtitles › Find more lists every match to pick from.

import { createSignal, For, Show } from "solid-js";
import type { PublicSettings, SubtitleMode, SubtitleResult } from "@ultimatetv/shared";
import { agent, agentHas } from "./agent";
import { hub } from "./api";
import { DialogFrame } from "./components/Dialog";
import { nowPlaying, playerState, type NowPlaying } from "./player";
import { errorToast, openDialog, profile, toast } from "./store";

const TWO_LETTER: Record<string, string> = { eng: "en", spa: "es", fra: "fr", fre: "fr", deu: "de", ger: "de", ita: "it", pol: "pl", por: "pt", nld: "nl", dut: "nl", swe: "sv", dan: "da", nor: "no", fin: "fi", rus: "ru", jpn: "ja", kor: "ko", chi: "zh", zho: "zh", ara: "ar", hin: "hi", tur: "tr" };
const NAMES: Record<string, string> = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pl: "Polish", pt: "Portuguese", nl: "Dutch" };

/** "eng", "en", "en-GB" and "English" all as "en". */
export function langCode(lang: string | undefined): string {
  const l = (lang ?? "").trim().toLowerCase();
  if (!l) return "";
  const named = Object.entries(NAMES).find(([, n]) => n.toLowerCase() === l)?.[0];
  return named ?? TWO_LETTER[l] ?? l.slice(0, 2);
}

export const sameLanguage = (a: string | undefined, b: string | undefined) => Boolean(langCode(a)) && langCode(a) === langCode(b);

/** OpenSubtitles is set up on the Hub (refreshed whenever something starts playing). */
const [osReady, setOsReady] = createSignal(false);
export { osReady };

/** This profile's choice, else the household's (Settings › Picture and sound). */
export function subtitleModeFor(s: PublicSettings["playback"] | undefined): SubtitleMode {
  return profile()?.subtitles ?? (s?.subtitlesByDefault ? "on" : "off");
}

/** What a playing title is called on OpenSubtitles: its title id, and the episode for a series. */
function lookupOf(np: NowPlaying | null): { titleId: string; episodeId?: string } | null {
  if (!np || np.req.kind !== "title" || np.info.live) return null;
  return { titleId: np.req.id, ...(np.req.episodeId ? { episodeId: np.req.episodeId } : {}) };
}

export const canFindSubtitles = () => osReady() && agentHas("addSubtitle") && lookupOf(nowPlaying()) !== null;

async function addFrom(r: SubtitleResult, np: NowPlaying): Promise<void> {
  const label = `${NAMES[langCode(r.lang)] ?? r.lang.toUpperCase()}${r.hearingImpaired ? " (SDH)" : ""} · OpenSubtitles`;
  const sub = await hub.subtitleDownload({ fileId: r.fileId, lang: r.lang, label });
  // Something else may have started while it downloaded.
  if (nowPlaying() !== np) return;
  await agent.addSubtitle(sub);
}

/**
 * Called as something starts: once the player knows its tracks, fetch subtitles if this profile
 * wants them and there are none in the preferred language ("foreign" only when the speech isn't
 * in that language either).
 */
export async function autoSubtitles(np: NowPlaying, s: PublicSettings | null): Promise<void> {
  setOsReady(Boolean(s?.openSubtitles?.configured));
  const mode = subtitleModeFor(s?.playback);
  const lookup = lookupOf(np);
  if (!s || mode === "off" || !lookup || !osReady() || !agentHas("addSubtitle")) return;
  for (let i = 0; i < 30 && nowPlaying() === np && playerState().status !== "playing"; i++) await new Promise((r) => setTimeout(r, 1000));
  const st = playerState();
  if (nowPlaying() !== np || st.status !== "playing") return;
  const want = s.playback.preferredSubtitleLang;
  if (st.subtitleTracks.some((t) => sameLanguage(t.lang, want))) return;
  if (mode === "foreign") {
    const speech = st.audioTracks.find((a) => a.selected)?.lang;
    if (!speech || sameLanguage(speech, want)) return;
  }
  try {
    const { results } = await hub.subtitleSearch(lookup.titleId, lookup.episodeId, want);
    const best = results.find((r) => !r.machine) ?? results[0];
    if (!best || nowPlaying() !== np) return;
    await addFrom(best, np);
    toast("Subtitles added from OpenSubtitles. Yellow › Subtitles for others");
  } catch {
    // Quietly: the film still plays, and Options › Find more says what went wrong.
  }
}

/** Options › Subtitles › Find more: every match OpenSubtitles has, to pick from. */
export function findSubtitles(): Promise<unknown> {
  const np = nowPlaying();
  const lookup = lookupOf(np);
  if (!np || !lookup) return Promise.resolve();
  return openDialog((close) => {
    const [answer, setAnswer] = createSignal<{ results: SubtitleResult[]; note?: string } | null>(null);
    hub.subtitleSearch(lookup.titleId, lookup.episodeId).then(setAnswer, (err: unknown) => setAnswer({ results: [], note: err instanceof Error ? err.message : String(err) }));
    const pick = (r: SubtitleResult) => {
      close();
      void addFrom(r, np).then(() => toast("Subtitles on", "good"), errorToast);
    };
    return (
      <DialogFrame close={() => close()} wide class="versions">
        <h2>Find subtitles</h2>
        <p class="dialog-message">From OpenSubtitles. The top ones are the most downloaded, so most likely to match this copy. If the words come early or late, try another.</p>
        <Show when={answer()} fallback={<div class="spinner" />}>
          <Show when={answer()!.results.length} fallback={<p class="empty">{answer()!.note ?? "None found"}</p>}>
            <div class="version-list" data-scroll-y="8">
              <For each={answer()!.results}>
                {(r, i) => (
                  <button class="version" data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => pick(r)}>
                    <span class="version-source">{NAMES[langCode(r.lang)] ?? r.lang.toUpperCase()}</span>
                    <span class="version-badges">
                      <Show when={r.hearingImpaired}>
                        <span class="badge">SDH</span>
                      </Show>
                      <Show when={r.machine}>
                        <span class="badge">Machine translated</span>
                      </Show>
                      <Show when={r.trusted}>
                        <span class="badge">Trusted</span>
                      </Show>
                    </span>
                    <span class="version-detail">{r.release}</span>
                    <span class="version-size">{r.downloads.toLocaleString("en-GB")} downloads</span>
                    <span class="version-ready" />
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </DialogFrame>
    );
  });
}
