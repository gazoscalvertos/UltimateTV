// A film or series: artwork, review scores, the trailer, the best version ready to play, every
// other version (library, IPTV, TorBox via AIOStreams), seasons and episodes, More like this, Add
// to queue, Favourite (Blue; one set per profile), Save to NAS (kept for good and added to Jellyfin; Red in Versions saves that exact
// version), and Download to box (onto the box's own disk, to watch away from home).

import { createEffect, createResource, createSignal, For, Show } from "solid-js";
import type { Episode, TitleDetails, TitleRef, TitleScore } from "@ultimatetv/shared";
import { durationLabel, episodeLabel, formatBytes } from "@ultimatetv/shared";
import { hub, type StreamRow } from "../api";
import { choose, DialogFrame } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { Progress, RailRow } from "../components/Rail";
import { TopBar } from "../components/TopBar";
import { useHints } from "../hints";
import { useKeys } from "../keys";
import { play, playLink } from "../player";
import { addToQueue } from "../queue";
import { allEpisodes, canDownload, downloadLabel, downloadOf, downloadToBox, episodeRequest, episodesOf, filmRequest } from "../downloads";
import { canSave, saveEpisodes, saveToNas } from "../save";
import { isFavouriteTitle, toggleFavouriteTitle } from "../favourites";
import { errorToast, isKids, openDialog, toast } from "../store";

const SOURCE_NAMES: Record<string, string> = { jellyfin: "Jellyfin", nas: "Your library", recording: "Recording", xtream: "IPTV", addon: "Online", torbox: "TorBox" };

function refOf(d: TitleDetails): TitleRef {
  const ref: TitleRef = { id: d.id, kind: d.kind, name: d.name };
  if (d.year) ref.year = d.year;
  if (d.poster) ref.poster = d.poster;
  if (d.backdrop) ref.backdrop = d.backdrop;
  if (d.genres.length) ref.genres = d.genres;
  if (d.certification) ref.certification = d.certification;
  return ref;
}

/** Every way to play it, best first, with what makes each one different. */
export function chooseVersion(title: TitleDetails, episodeId?: string): Promise<void> {
  return openDialog<void>((close) => {
    const [streams] = createResource(() => hub.streams(title.id, episodeId));
    // Red saves the version the remote is on to the NAS (and so into Jellyfin), without playing it.
    const [focused, setFocused] = createSignal<StreamRow | null>(null);
    const name = `${title.name}${episodeId ? ` ${episodeId.toUpperCase()}` : ""}`;
    const onKey = (a: string) => {
      const s = focused();
      if (a !== "red" || !s?.downloadable || !canSave()) return false;
      close();
      void saveToNas({ titleId: title.id, ...(episodeId ? { episodeId } : {}), streamId: s.id }, name).catch(errorToast);
      return true;
    };
    return (
      <DialogFrame close={() => close()} wide class="versions" onKey={onKey}>
        <h2>Choose a version</h2>
        <p class="dialog-message">
          The best one is picked for you when you press Play. Ready means it starts straight away.
          <Show when={canSave() && streams()?.streams.some((s) => s.downloadable)}>
            {" "}
            <kbd class="key-red" /> Save the one you're on to the NAS and Jellyfin.
          </Show>
        </p>
        <Show when={streams()} fallback={<div class="spinner" />}>
          <Show when={streams()!.streams.length} fallback={<p class="empty">No versions found yet.</p>}>
            <div class="version-list" data-scroll-y="8">
              <For each={streams()!.streams}>
                {(s: StreamRow, i) => (
                  <button
                    class="version"
                    data-focus
                    data-autofocus={i() === 0 ? "" : undefined}
                    onFocus={() => setFocused(s)}
                    onClick={() => {
                      close();
                      void play({ kind: "title", id: title.id, streamId: s.id, ...(episodeId ? { episodeId } : {}) }, { title: refOf(title) });
                    }}
                  >
                    <span class="version-source">{s.label || SOURCE_NAMES[s.kind]}</span>
                    <span class="version-badges">
                      <For each={s.badges}>{(b) => <span class="badge">{b}</span>}</For>
                    </span>
                    <span class="version-detail">{s.detail}</span>
                    <span class="version-size">{s.quality.sizeBytes ? formatBytes(s.quality.sizeBytes) : ""}</span>
                    <span class="version-ready" classList={{ ready: s.ready }}>
                      {s.ready ? "Ready" : "Needs fetching"}
                      {s.downloadable && canSave() ? " · Red to save" : ""}
                    </span>
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

/** A score's colour: green when it's good, amber in the middle, red when it isn't. */
const scoreTone = (s: TitleScore) => (s.pct >= 70 ? "good" : s.pct >= 50 ? "mid" : "low");

export function Details(props: { id: string }) {
  const [d] = createResource(() => props.id, (id) => hub.title(id));
  // The trailer, scores and More like this come after the page, as they can take a moment.
  const [extras] = createResource(() => props.id, (id) => hub.extras(id).catch(() => null));
  const playTrailer = () => {
    const t = extras()?.trailer;
    if (t) void playLink(t.url, t.name);
  };
  const [streams] = createResource(
    () => (d()?.kind === "movie" ? d()!.id : null),
    (id) => hub.streams(id).catch(() => ({ streams: [] as StreamRow[] })),
  );
  const [season, setSeason] = createSignal<number | null>(null);
  // Save for later (the watchlist, one per profile).
  const [saved, { mutate: setSaved }] = createResource(
    () => props.id,
    (id) => hub.watchlist().then((w) => w.items.find((i) => i.title?.id === id || i.id === id) ?? null, () => null),
  );
  const toggleSaved = async () => {
    const t = d();
    if (!t) return;
    try {
      const item = saved();
      if (item) {
        await hub.unsave(item.id);
        setSaved(null);
        toast(`Took ${t.name} off Saved for later`);
      } else {
        const r = await hub.saveForLater({ title: { id: t.id, kind: t.kind, name: t.name, ...(t.year ? { year: t.year } : {}), ...(t.poster ? { poster: t.poster } : {}), ...(t.backdrop ? { backdrop: t.backdrop } : {}) } });
        setSaved(r.item);
        toast(`${t.name} saved for later: it's on Home`, "good");
      }
    } catch (err) {
      errorToast(err);
    }
  };
  createEffect(() => {
    const s = d()?.seasons;
    if (s?.length && season() === null) setSeason(s.find((x) => x.season > 0)?.season ?? s[0]!.season);
  });
  const [episodes] = createResource(
    () => (d() && season() !== null ? { id: d()!.id, n: season()! } : null),
    async (k) => {
      const local = d()!.seasons?.find((s) => s.season === k.n);
      if (local?.episodes.length) return local.episodes;
      return (await hub.season(k.id, k.n).catch(() => null))?.episodes ?? [];
    },
  );

  // What Play will use: the Hub picks the first ready version, else the best one.
  const primary = () => streams()?.streams.find((s) => s.ready) ?? streams()?.streams[0];
  const badges = () => primary()?.badges ?? [];
  const playMain = (fromStart = false) => {
    const title = d()!;
    if (title.kind === "series") {
      const eps = episodes() ?? [];
      const ep = eps.find((e) => !e.watched) ?? eps[0];
      if (ep) playEpisode(ep);
      return;
    }
    void play({ kind: "title", id: title.id }, { title: refOf(title), fromStart });
  };
  // The episode Play starts (the first unwatched), and the one the remote is on, for Versions.
  const nextEpisode = () => {
    const eps = episodes() ?? [];
    return eps.find((e) => !e.watched) ?? eps[0];
  };
  const [focusedEpisode, setFocusedEpisode] = createSignal<Episode | null>(null);
  const episodeVersions = (e: Episode | undefined | null) => {
    if (e) void chooseVersion(d()!, `s${e.season}e${e.episode}`);
  };
  const playEpisode = (e: Episode) => void play({ kind: "title", id: d()!.id, episodeId: `s${e.season}e${e.episode}` }, { title: refOf(d()!) });

  // Queue the film, or an episode (the next one to watch, or the one the remote is on with Green).
  const queueIt = (e?: Episode | null) => {
    const t = d()!;
    if (t.kind === "series") {
      if (!e) return;
      const still = e.still ?? t.backdrop ?? t.poster;
      void addToQueue({
        req: { kind: "title", id: t.id, episodeId: `s${e.season}e${e.episode}` },
        title: refOf(t),
        name: t.name,
        subtitle: [episodeLabel(e.season, e.episode), e.name].filter(Boolean).join(" · "),
        ...(still ? { image: still } : {}),
      });
      return;
    }
    const art = t.backdrop ?? t.poster;
    void addToQueue({ req: { kind: "title", id: t.id }, title: refOf(t), name: t.name, ...(t.year ? { subtitle: String(t.year) } : {}), ...(art ? { image: art } : {}) });
  };

  // Download to the box: the film, or an episode, a series' worth or the lot.
  const downloadIt = async () => {
    const t = d()!;
    try {
      if (t.kind === "movie") {
        await downloadToBox([filmRequest(t)], t.name);
        return;
      }
      const e = focusedEpisode() ?? nextEpisode();
      const n = season();
      const seasonEps = n !== null ? await episodesOf(t, n) : [];
      const seasonName = t.seasons?.find((s) => s.season === n)?.name ?? `Series ${n}`;
      const pick = await choose({
        title: `Download ${t.name} to the box`,
        message: "It plays from the box, even away from home. Episodes download one after another.",
        options: [
          ...(e ? [{ label: `${episodeLabel(e.season, e.episode)} · ${e.name}`, value: "episode" as const, icon: "download" }] : []),
          ...(seasonEps.length ? [{ label: `All of ${seasonName}`, value: "season" as const, icon: "download", detail: `${seasonEps.length} episodes` }] : []),
          ...((t.seasons?.filter((s) => s.season > 0).length ?? 0) > 1 ? [{ label: "Every series", value: "all" as const, icon: "download" }] : []),
        ],
      });
      if (pick === "episode" && e) await downloadToBox([episodeRequest(t, e)], `${t.name} ${episodeLabel(e.season, e.episode)}`);
      if (pick === "season") await downloadToBox(seasonEps.map((x) => episodeRequest(t, x)), `${seasonName} of ${t.name}`);
      if (pick === "all") {
        const eps = await allEpisodes(t);
        await downloadToBox(eps.map((x) => episodeRequest(t, x)), `${eps.length} episodes of ${t.name}`);
      }
    } catch (err) {
      errorToast(err);
    }
  };
  const filmDownload = () => (d()?.kind === "movie" ? downloadOf({ kind: "title", id: d()!.id }) : undefined);
  const episodeDownload = (e: Episode) => downloadOf({ kind: "title", id: d()!.id, episodeId: `s${e.season}e${e.episode}` });

  // Save to NAS: kept for good on the NAS and added to Jellyfin. A film, or an episode or a series' worth.
  const save = async () => {
    const t = d()!;
    try {
      if (t.kind === "movie") {
        await saveToNas({ titleId: t.id }, t.name);
        return;
      }
      const e = focusedEpisode() ?? nextEpisode();
      const n = season();
      const seasonEps = n !== null ? await episodesOf(t, n) : [];
      const seasonName = t.seasons?.find((s) => s.season === n)?.name ?? `Series ${n}`;
      const pick = await choose({
        title: `Save ${t.name} to the NAS`,
        message: "It's kept on the NAS and added to Jellyfin, so it plays from your library from then on.",
        options: [
          ...(e ? [{ label: `${episodeLabel(e.season, e.episode)} · ${e.name}`, value: "episode" as const, icon: "download" }] : []),
          ...(seasonEps.length ? [{ label: `All of ${seasonName}`, value: "season" as const, icon: "download", detail: `${seasonEps.length} episodes` }] : []),
        ],
      });
      if (pick === "episode" && e) await saveToNas({ titleId: t.id, episodeId: `s${e.season}e${e.episode}` }, `${t.name} ${episodeLabel(e.season, e.episode)}`);
      if (pick === "season") await saveEpisodes(t, seasonEps, `${seasonName} of ${t.name}`);
    } catch (err) {
      errorToast(err);
    }
  };

  const liked = () => isFavouriteTitle(d()?.id);
  const toggleLiked = () => {
    const t = d();
    if (t) toggleFavouriteTitle(refOf(t));
  };
  useHints(() => [
    { key: "red", label: saved() ? "Remove from saved" : "Save for later" },
    { key: "green", label: "Add to queue" },
    { key: "yellow", label: "Versions" },
    { key: "blue", label: liked() ? "Unfavourite" : "Favourite" },
    { key: "play", label: "Play" },
  ]);
  useKeys((a) => {
    if (a === "red" && d()) {
      void toggleSaved();
      return true;
    }
    if (a === "blue" && d()) {
      toggleLiked();
      return true;
    }
    if (a === "yellow" && d()) {
      if (d()!.kind === "series") episodeVersions(focusedEpisode() ?? nextEpisode());
      else void chooseVersion(d()!);
      return true;
    }
    if (a === "green" && d()) {
      queueIt(d()!.kind === "series" ? (focusedEpisode() ?? nextEpisode()) : null);
      return true;
    }
    if (a === "play" && d()) {
      playMain();
      return true;
    }
    return false;
  });

  return (
    <div class="screen details" data-layer>
      <Show when={d()} fallback={<div class="spinner" />}>
        {(t) => (
          <>
            <div class="details-bg">
              <Show when={t().backdrop ?? t().poster}>
                <img src={t().backdrop ?? t().poster} alt="" />
              </Show>
            </div>
            <TopBar />
            <div class="page" data-scroll-y="120">
              <section class="details-main" data-row>
                <Show when={t().logo} fallback={<h1 class="details-title">{t().name}</h1>}>
                  <img class="details-logo" src={t().logo} alt={t().name} />
                </Show>
                <p class="details-meta">
                  <For each={[t().year, t().certification, t().runtimeMin ? durationLabel(t().runtimeMin! * 60_000) : null, t().kind === "series" && t().seasons?.some((s) => s.season > 0) ? `${t().seasons!.filter((s) => s.season > 0).length} series` : null, t().genres.slice(0, 3).join(", ")].filter(Boolean)}>
                    {(m) => <span>{m}</span>}
                  </For>
                  <Show when={t().rating && !extras()?.scores.length}>
                    <span class="rating">
                      <Icon name="star" /> {t().rating}
                    </span>
                  </Show>
                </p>
                <Show when={extras()?.scores.length}>
                  <p class="details-scores">
                    <For each={extras()!.scores}>
                      {(sc) => (
                        <span class={`score score-${sc.source} score-${scoreTone(sc)}`}>
                          <b>{sc.label}</b> {sc.value}
                        </span>
                      )}
                    </For>
                  </p>
                </Show>
                <p class="details-badges">
                  <Show when={primary()}>
                    {(p) => (
                      <span class={`badge badge-source badge-${p().kind}`}>
                        <Icon name="play" /> From {p().label || SOURCE_NAMES[p().kind]}
                        {p().ready ? "" : " · needs fetching"}
                      </span>
                    )}
                  </Show>
                  <For each={badges()}>{(b) => <span class="badge">{b}</span>}</For>
                  <Show when={t().inLibrary}>
                    <span class="badge badge-library">In your library</span>
                  </Show>
                  <Show when={downloadLabel(filmDownload())}>
                    {(label) => (
                      <span class="badge badge-library">
                        <Icon name="download" /> {label()}
                      </span>
                    )}
                  </Show>
                </p>
                <Show when={t().overview}>
                  <p class="details-overview">{t().overview}</p>
                </Show>
                <Show when={t().cast.length}>
                  <p class="details-cast">Starring {t().cast.slice(0, 4).join(", ")}</p>
                </Show>
                <div class="details-actions" data-focus-group>
                  <button class="btn btn-primary btn-large" data-focus data-autofocus onClick={() => playMain()}>
                    <Icon name="play" /> {t().resumeMs ? `Resume (${durationLabel(t().resumeMs!)})` : "Play"}
                  </button>
                  <Show when={t().resumeMs}>
                    <button class="btn btn-large" data-focus onClick={() => playMain(true)}>
                      <Icon name="restart" /> Start again
                    </button>
                  </Show>
                  <Show when={extras()?.trailer}>
                    <button class="btn btn-large" data-focus onClick={playTrailer}>
                      <Icon name="trailer" /> Trailer
                    </button>
                  </Show>
                  <Show when={t().kind === "movie"}>
                    <button class="btn btn-large" data-focus onClick={() => void chooseVersion(t())}>
                      <Icon name="list" /> Versions
                    </button>
                  </Show>
                  <Show when={t().kind === "series" && nextEpisode()}>
                    {(e) => (
                      <button class="btn btn-large" data-focus onClick={() => episodeVersions(e())}>
                        <Icon name="list" /> Versions of {episodeLabel(e().season, e().episode)}
                      </button>
                    )}
                  </Show>
                  <Show when={t().kind === "movie"}>
                    <button class="btn btn-large" data-focus onClick={() => queueIt()}>
                      <Icon name="plus" /> Add to queue
                    </button>
                  </Show>
                  <Show when={t().kind === "series" && nextEpisode()}>
                    {(e) => (
                      <button class="btn btn-large" data-focus onClick={() => queueIt(e())}>
                        <Icon name="plus" /> Queue {episodeLabel(e().season, e().episode)}
                      </button>
                    )}
                  </Show>
                  <button class="btn btn-large" classList={{ selected: Boolean(saved()) }} data-focus onClick={() => void toggleSaved()}>
                    <Icon name={saved() ? "bookmarked" : "bookmark"} /> {saved() ? "Saved" : "Save for later"}
                  </button>
                  <button class="btn btn-large btn-favourite" classList={{ selected: liked() }} data-focus aria-pressed={liked()} onClick={toggleLiked}>
                    <Icon name={liked() ? "hearted" : "heart"} /> {liked() ? "Favourite" : "Add to Favourites"}
                  </button>
                  <Show when={canDownload() && !isKids() && !(t().kind === "movie" && filmDownload())}>
                    <button class="btn btn-large" data-focus onClick={() => void downloadIt()}>
                      <Icon name="download" /> Download to box
                    </button>
                  </Show>
                  <Show when={canSave() && (t().kind === "series" ? Boolean(nextEpisode()) : !t().inLibrary && streams()?.streams.some((s) => s.downloadable))}>
                    <button class="btn btn-large" data-focus onClick={() => void save()}>
                      <Icon name="download" /> Save to NAS
                    </button>
                  </Show>
                </div>
              </section>

              <Show when={t().kind === "series" && t().seasons?.length}>
                <section class="seasons" data-row>
                  <div class="season-tabs" data-focus-group data-scroll-x="96">
                    <For each={t().seasons}>
                      {(s) => (
                        <button class="chip" classList={{ active: season() === s.season }} data-focus onFocus={() => setSeason(s.season)} onClick={() => setSeason(s.season)}>
                          {s.name}
                        </button>
                      )}
                    </For>
                  </div>
                  <p class="details-hint">
                    <kbd class="key-green" /> Add the episode you're on to your queue
                  </p>
                </section>
                <section class="rail" data-row>
                  <div class="rail-track episodes" data-scroll-x="96" data-focus-group>
                    <Show when={episodes()} fallback={<div class="spinner" />}>
                      <For each={episodes()}>
                        {(e) => (
                          <button class="card card-wide card-episode" data-focus onFocus={() => setFocusedEpisode(e)} onBlur={() => setFocusedEpisode(null)} onClick={() => playEpisode(e)}>
                            <div class="card-art">
                              <Show when={e.still} fallback={<div class="card-fallback">{episodeLabel(e.season, e.episode)}</div>}>
                                <img src={e.still} alt="" loading="lazy" />
                              </Show>
                              <Show when={e.watched}>
                                <span class="card-badge">
                                  <Icon name="check" /> Watched
                                </span>
                              </Show>
                              <Show when={downloadLabel(episodeDownload(e))}>
                                {(label) => (
                                  <span class="card-badge card-badge-download">
                                    <Icon name="download" /> {label()}
                                  </span>
                                )}
                              </Show>
                              <Show when={e.progress}>
                                <Progress value={e.progress!} class="card-progress" />
                              </Show>
                            </div>
                            <div class="card-label">
                              <span class="card-title">
                                {e.episode}. {e.name}
                              </span>
                              <span class="card-sub card-overview">{e.overview ?? ""}</span>
                            </div>
                          </button>
                        )}
                      </For>
                    </Show>
                  </div>
                </section>
              </Show>

              <Show when={extras()?.similar.length}>
                <RailRow rail={{ id: "similar", title: "More like this", kind: "titles", items: extras()!.similar }} />
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}
