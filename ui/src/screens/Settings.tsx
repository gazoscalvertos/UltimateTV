// Settings on the TV: profiles and the PIN, picture and sound, recording, and the state of each
// source. Typing-heavy setup (logins, URLs) happens on the phone via the QR code.

import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import type { Certification, MixChannelInfo, PairedDevice, PendingScreen, Profile, PublicSettings } from "@ultimatetv/shared";
import { CERTIFICATIONS, formatBytes } from "@ultimatetv/shared";
import { agent, agentHas } from "../agent";
import { hub } from "../api";
import { askPin, askText, choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { pairStamp } from "../pairing";
import { appName, errorToast, setAppName, nav, setShowStats, showStats, toast } from "../store";
import { onCleanup } from "solid-js";

function Row(props: { label: string; value?: JSX.Element; hint?: string; onSelect?: () => void; icon?: string }) {
  return (
    <button class="setting-row" data-focus onClick={() => props.onSelect?.()}>
      <Show when={props.icon}>
        <Icon name={props.icon!} class="setting-icon" />
      </Show>
      <span class="setting-label">
        {props.label}
        <Show when={props.hint}>
          <small>{props.hint}</small>
        </Show>
      </span>
      <span class="setting-value">{props.value}</span>
    </button>
  );
}

function Status(props: { ok: boolean; text: string }) {
  return (
    <span class="status" classList={{ ok: props.ok }}>
      <Show when={props.ok} fallback={<span class="status-dot" />}>
        <Icon name="check" />
      </Show>
      {props.text}
    </span>
  );
}

/** "ABCDEFGH" as "ABCD-EFGH", easier to read off the screen. */
const spaced = (code: string) => code.replace(/^(.{4})(.+)$/, "$1-$2");
const ago = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} hours ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]!;

export function Settings(props: { section?: string }) {
  const [settings, { mutate }] = createResource(() => hub.settings());
  const [profiles, { refetch: refetchProfiles }] = createResource(() => hub.profiles());
  const [status] = createResource(() => hub.status());
  const [box] = createResource(() => agent.info());
  const [section, setSection] = createSignal(props.section ?? "profiles");
  const [mix, { refetch: refetchMix }] = createResource(
    () => section() === "music" || section() === "about",
    (open) => (open ? hub.mixChannels().catch(() => null) : Promise.resolve(null)),
  );
  let mixTimer: number | undefined;
  onCleanup(
    onHubEvent((e) => {
      if (e.type !== "mix.changed" || section() !== "music" || mixTimer) return;
      // Downloads report often; a refresh every few seconds is plenty.
      mixTimer = window.setTimeout(() => {
        mixTimer = undefined;
        void refetchMix();
      }, 3000);
    }),
  );
  onCleanup(() => clearTimeout(mixTimer));
  const openMix = (c: MixChannelInfo) => {
    // Back from the channel comes back to this section.
    nav.replace({ name: "settings", section: "music" });
    nav.push({ name: "mix-channel", id: c.id });
  };
  const createMix = async () => {
    const name = await askText("Name the channel");
    if (!name) return;
    const brief = await askText("What should it play? Artists, genres or decades, with commas between");
    if (!brief) return;
    try {
      const c = await hub.createMix({ name, brief });
      toast(`${c.name} is on channel ${c.number}. The Hub is finding videos for it now.`, "good");
      await refetchMix();
    } catch (err) {
      errorToast(err);
    }
  };
  // The box's software, checked against GitHub when About is opened.
  const [software, { refetch: refetchSoftware }] = createResource(
    () => section() === "about",
    (open) => (open && agentHas("software") ? agent.software(true).catch(() => null) : Promise.resolve(null)),
  );
  // The Hub's software, checked against GitHub when About is opened and every 5 minutes after.
  const [hubSw, { refetch: refetchHubSw }] = createResource(
    () => section() === "about",
    (open) => (open ? hub.hubSoftware().catch(() => null) : Promise.resolve(null)),
  );
  const hubTimer = window.setInterval(() => section() === "about" && void refetchHubSw(), 5 * 60_000);
  onCleanup(() => window.clearInterval(hubTimer));
  const hubState = () => {
    const sw = hubSw();
    if (!sw) return hubSw.loading ? "Checking…" : "Couldn't check";
    if (sw.updating) return "Updating now…";
    if (!sw.latest) return "Couldn't check";
    if (sw.commit && sw.latest.startsWith(sw.commit)) return "Up to date";
    return sw.behind ? `${sw.behind} change${sw.behind === 1 ? "" : "s"} to get` : "Update available";
  };
  const hubChanges = () => (hubSw()?.changes ?? []).slice(0, 3).map((c) => c.title).join(" · ");
  const updateHub = async () => {
    const sw = hubSw();
    if (!sw || sw.updating) return;
    if (!sw.canUpdate) {
      toast("To update the Hub from here, run sudo bash tools/hub/update.sh --phone-updates on the server once.", "bad");
      return;
    }
    const n = sw.changes?.length ?? 0;
    const ok = await confirm(
      "Update the Hub now?",
      `${n ? `New: ${hubChanges()}${n > 3 ? ` and ${n - 3} more` : ""}. ` : ""}The Hub restarts at the end, so the TV pauses for a minute while it comes back.`,
      "Update now",
    );
    if (!ok) return;
    try {
      await hub.updateHub();
      toast("Updating the Hub. It takes a few minutes.", "good");
      window.setTimeout(() => void refetchHubSw(), 5000);
    } catch (err) {
      errorToast(err);
    }
  };
  const updateState = () => {
    const sw = software();
    if (!sw) return software.loading ? "Checking…" : "";
    if (sw.updating) return "Updating now…";
    if (!sw.latest) return "Couldn't check";
    return sw.latest === sw.commit ? "Up to date" : "Update available";
  };
  const updateBox = async () => {
    const sw = software();
    if (!sw || sw.updating) return;
    const upToDate = Boolean(sw.latest && sw.latest === sw.commit);
    const ok = await confirm(
      upToDate ? "Update anyway?" : "Update the box now?",
      `${upToDate ? "The app is up to date, but this also installs the latest system updates. " : ""}It takes a few minutes. The TV goes blank for a moment at the end while the app restarts.`,
      "Update now",
    );
    if (!ok) return;
    try {
      await agent.update();
      toast("Updating the box. The app restarts by itself when it's done.", "good");
      window.setTimeout(() => void refetchSoftware(), 3000);
    } catch (err) {
      errorToast(err);
    }
  };
  onCleanup(onHubEvent((e) => (e.type === "profiles.changed" ? void refetchProfiles() : undefined)));

  // Phones and screens paired with the TV, and the code that pairs another.
  const [devices, { refetch: refetchDevices }] = createResource(
    () => (section() === "remote" ? pairStamp() + 1 : 0),
    (open) => (open ? hub.devices().catch(() => null) : Promise.resolve(null)),
  );
  const [pairCode] = createResource(
    () => (section() === "remote" ? pairStamp() + 1 : 0),
    (open) => (open ? hub.pairCode().catch(() => null) : Promise.resolve(null)),
  );
  const deviceMenu = async (d: PairedDevice) => {
    const me = d.id === devices()?.me;
    const pick = await choose({
      title: d.name,
      message: `${d.kind === "tv" ? "A TV screen" : "A phone"}, paired ${ago(d.pairedAt)} and last used ${ago(d.lastSeenAt)}${d.ip ? ` from ${d.ip}` : ""}.`,
      options: [
        { label: "Rename", value: "rename", icon: "edit" },
        { label: me ? "Unpair this screen" : "Remove", value: "remove", icon: "trash", tone: "danger" as const },
      ],
    });
    try {
      if (pick === "rename") {
        const name = await askText("Name", d.name);
        if (name?.trim()) await hub.renameDevice(d.id, name);
      }
      if (pick === "remove" && (await confirm(`Remove ${d.name}?`, me ? "This screen stops getting updates from the Hub until a paired phone lets it back in." : "It will have to scan the code again to work the TV.", "Remove", true))) {
        await hub.removeDevice(d.id);
        toast(`${d.name} removed`, "good");
        if (me) location.reload();
      }
      await refetchDevices();
    } catch (err) {
      errorToast(err);
    }
  };
  const pendingMenu = async (p: PendingScreen) => {
    const pick = await choose({
      title: `Let ${p.name} in?`,
      message: `Only if that screen shows the code ${p.code}${p.ip ? ` (it's at ${p.ip})` : ""}.`,
      options: [
        { label: "Let it in", value: "yes", icon: "check" },
        { label: "Turn it away", value: "no", tone: "danger" as const },
      ],
    });
    try {
      if (pick === "yes") {
        await hub.letScreenIn(p.id);
        toast(`${p.name} paired`, "good");
      }
      if (pick === "no") await hub.turnScreenAway(p.id);
      await refetchDevices();
    } catch (err) {
      errorToast(err);
    }
  };
  const showApiKey = async () => {
    try {
      const { key } = await hub.apiKey();
      const pick = await choose({
        title: "Key for Home Assistant",
        message: `${key}  ·  Sent as the X-Api-Key header, it lets Home Assistant or a script show pop-ups, news flashes and press keys, and nothing else. It's easier to copy from the phone: the Hub's settings page, under Phones.`,
        options: [
          { label: "Done", value: "done" },
          { label: "Make a new key", value: "new", icon: "restart" },
        ],
      });
      if (pick === "new" && (await confirm("Make a new key?", "Anything using the old one stops working until you give it the new one.", "New key", true))) {
        await hub.apiKey(true);
        toast("New key made. See it on the phone's settings page.", "good");
      }
    } catch (err) {
      errorToast(err);
    }
  };

  const rename = async () => {
    const name = await askText("Call the app", appName());
    if (name === undefined || name.trim() === appName()) return;
    try {
      const saved = await hub.saveSettings({ appName: name });
      setAppName(saved.appName);
      toast(`Renamed to ${saved.appName}`, "good");
    } catch (e) {
      errorToast(e);
    }
  };

  const save = async (patch: Partial<Pick<PublicSettings, "recording" | "playback">>) => {
    try {
      mutate(await hub.saveSettings(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const playback = () => settings()!.playback;
  const recording = () => settings()!.recording;

  const pinFor = async (p: Profile) => {
    let first = "";
    const ok = await askPin(`New PIN for ${p.name}`, async (pin) => {
      first = pin;
      return null;
    });
    if (!ok) return;
    const confirmed = await askPin("Enter it again", async (pin) => (pin === first ? null : "Those don't match. Try again."));
    if (!confirmed) return;
    try {
      await hub.updateProfile(p.id, { pin: first });
      toast(`PIN set for ${p.name}`, "good");
      await refetchProfiles();
    } catch (err) {
      errorToast(err);
    }
  };

  const profileMenu = async (p: Profile) => {
    const pick = await choose({
      title: p.name,
      message: p.kind === "kids" ? `Kids profile: kids' channels and titles rated up to ${p.maxCertification}.` : "Adult profile: sees everything and can change settings.",
      options: [
        { label: "Rename", value: "rename", icon: "list" },
        ...(p.kind === "kids" ? [{ label: `Ratings allowed: up to ${p.maxCertification}`, value: "cert", icon: "lock" }] : []),
        { label: p.hasPin ? "Change PIN" : "Set a PIN", value: "pin", icon: "lock" },
        ...(p.hasPin ? [{ label: "Remove PIN", value: "nopin" }] : []),
        { label: "Delete profile", value: "delete", icon: "trash", tone: "danger" as const },
      ],
    });
    try {
      if (pick === "rename") {
        const name = await askText("Profile name", p.name);
        if (name) await hub.updateProfile(p.id, { name });
      }
      if (pick === "cert") {
        const cert = await choose<Certification>({ title: "Highest rating allowed", options: CERTIFICATIONS.filter((c) => c !== "18").map((c) => ({ label: c === "12A" ? "12A" : c, value: c })) });
        if (cert) await hub.updateProfile(p.id, { maxCertification: cert });
      }
      if (pick === "pin") await pinFor(p);
      if (pick === "nopin" && (await confirm("Remove the PIN?", "Anyone will be able to use this profile.", "Remove PIN", true))) await hub.updateProfile(p.id, { pin: null });
      if (pick === "delete" && (await confirm(`Delete ${p.name}?`, "Their Continue Watching list goes too. Recordings are kept.", "Delete", true))) await hub.deleteProfile(p.id);
      await refetchProfiles();
    } catch (err) {
      errorToast(err);
    }
  };

  const addProfile = async () => {
    const kind = await choose<Profile["kind"]>({
      title: "Add a profile",
      options: [
        { label: "Kids", value: "kids", detail: "Kids' channels and family titles only" },
        { label: "Adult", value: "adult", detail: "Everything" },
      ],
    });
    if (!kind) return;
    const name = await askText("Their name");
    if (!name) return;
    try {
      await hub.createProfile(name, kind);
      await refetchProfiles();
      toast(`${name} added`, "good");
    } catch (err) {
      errorToast(err);
    }
  };

  const SECTIONS = [
    { id: "profiles", label: "Profiles and PIN" },
    { id: "playback", label: "Picture and sound" },
    { id: "recording", label: "Recording" },
    { id: "music", label: "Music channels" },
    { id: "sources", label: "Sources" },
    { id: "remote", label: "Phones and remotes" },
    { id: "about", label: "About" },
  ];

  return (
    <div class="screen settings" data-layer>
      <TopBar />
      <div class="settings-layout">
        <nav class="settings-nav" data-focus-group>
          <For each={SECTIONS}>
            {(s, i) => (
              <button class="settings-nav-item" classList={{ active: section() === s.id }} data-focus data-autofocus={s.id === (props.section ?? "profiles") ? "" : undefined} onFocus={() => setSection(s.id)} onClick={() => setSection(s.id)}>
                {s.label}
              </button>
            )}
          </For>
        </nav>
        <div class="settings-panel page" data-scroll-y="40" data-focus-group>
          <Show when={settings() && profiles()} fallback={<div class="spinner" />}>
            <Show when={section() === "profiles"}>
              <h2>Profiles and PIN</h2>
              <p class="hint">A Kids profile only sees kids' channels and titles up to its rating. Set a PIN on the adult profiles so the children can't switch out of Kids or change settings.</p>
              <For each={profiles()!.profiles}>
                {(p) => (
                  <Row
                    label={p.name}
                    hint={p.kind === "kids" ? `Kids · up to ${p.maxCertification}` : "Adult"}
                    value={
                      <>
                        <span class="avatar avatar-small" style={{ "--c": p.colour }}>
                          {p.name.slice(0, 1)}
                        </span>
                        <Show when={p.hasPin}>
                          <Icon name="lock" />
                        </Show>
                      </>
                    }
                    onSelect={() => void profileMenu(p)}
                  />
                )}
              </For>
              <Row label="Add a profile" icon="plus" onSelect={() => void addProfile()} />
            </Show>

            <Show when={section() === "playback"}>
              <h2>Picture and sound</h2>
              <p class="hint">The box switches the TV to each film's frame rate and sends HDR, and passes Dolby Digital Plus (with Atmos) straight to the TV's speakers.</p>
              <Row label="Subtitles" hint="Turn on automatically when available" value={playback().subtitlesByDefault ? "On" : "Off"} onSelect={() => void save({ playback: { ...playback(), subtitlesByDefault: !playback().subtitlesByDefault } })} />
              <Row label="Audio language" value={playback().preferredAudioLang.toUpperCase()} onSelect={() => void save({ playback: { ...playback(), preferredAudioLang: cycle(["eng", "spa", "fra", "deu", "ita", "pol"], playback().preferredAudioLang) } })} />
              <Row label="Play the next episode automatically" value={playback().autoplayNext ? "On" : "Off"} onSelect={() => void save({ playback: { ...playback(), autoplayNext: !playback().autoplayNext } })} />
              <Row label="When the TV turns on" value={playback().startOn === "live" ? "Live TV" : "Home"} onSelect={() => void save({ playback: { ...playback(), startOn: playback().startOn === "live" ? "home" : "live" } })} />
              <Row label="Playback stats" hint="Show the stream, picture and sound details over the video. The blue button turns them on and off while watching" value={showStats() ? "On" : "Off"} onSelect={() => setShowStats(!showStats())} />
              <Row label="Largest file to stream" hint="Bigger versions are moved down the list" value={`${playback().maxSizeGb} GB`} onSelect={() => void save({ playback: { ...playback(), maxSizeGb: cycle([20, 40, 60, 100], playback().maxSizeGb) } })} />
            </Show>

            <Show when={section() === "recording"}>
              <h2>Recording</h2>
              <Row label="Start early by" value={`${recording().paddingBeforeMin} min`} onSelect={() => void save({ recording: { ...recording(), paddingBeforeMin: cycle([0, 1, 2, 5, 10], recording().paddingBeforeMin) } })} />
              <Row label="Carry on after by" value={`${recording().paddingAfterMin} min`} onSelect={() => void save({ recording: { ...recording(), paddingAfterMin: cycle([0, 2, 5, 10, 15, 30], recording().paddingAfterMin) } })} />
              <Row label="Use catch-up when it can" hint="Saves programmes from catch-up afterwards, keeping your connection free to watch" value={recording().preferCatchup ? "On" : "Off"} onSelect={() => void save({ recording: { ...recording(), preferCatchup: !recording().preferCatchup } })} />
              <Row label="Delete watched recordings" value={recording().autoDeleteWatchedDays ? `After ${recording().autoDeleteWatchedDays} days` : "Never"} onSelect={() => void save({ recording: { ...recording(), autoDeleteWatchedDays: cycle([0, 7, 30, 90], recording().autoDeleteWatchedDays) } })} />
            </Show>

            <Show when={section() === "music"}>
              <h2>Music channels</h2>
              <p class="hint">Channels the Hub makes itself from music videos it downloads to the NAS in HD or 4K. Every pass through a channel's videos is shuffled afresh, so it never plays them in the same order twice. They're in the guide under Music.</p>
              <Show when={mix()} fallback={<div class="spinner" />}>
                {(m) => (
                  <>
                    <Row
                      label="Downloader"
                      hint={m().working ?? (m().downloader.ok ? "Idle" : undefined)}
                      value={<Status ok={m().downloader.ok} text={m().downloader.ok ? `yt-dlp ${m().downloader.version ?? ""}` : (m().downloader.error ?? "Not working")} />}
                    />
                    <Row
                      label="Downloaded"
                      hint={m().diskFreeBytes !== undefined ? `${formatBytes(m().diskFreeBytes!)} free on the NAS` : undefined}
                      value={`${m().totals.ready} video${m().totals.ready === 1 ? "" : "s"} · ${formatBytes(m().totals.bytes)}`}
                    />
                    <For each={m().channels}>
                      {(c) => {
                        const waiting = c.counts.queued + c.counts.downloading;
                        return (
                          <Row
                            label={`${c.number}  ${c.name}`}
                            icon="music"
                            hint={[`${c.counts.ready} of ${c.target} videos downloaded (${formatBytes(c.readyBytes)})`, waiting ? `${waiting} to download` : "", c.enabled ? "" : "turned off", c.error ?? ""].filter(Boolean).join(" · ")}
                            value={<Status ok={c.enabled && c.counts.ready > 0} text={c.counts.ready ? "On air" : waiting ? "Filling up" : "No videos"} />}
                            onSelect={() => openMix(c)}
                          />
                        );
                      }}
                    </For>
                    <Row label="Create a channel" icon="plus" hint="Name it and say what it should play; the Hub finds the videos" onSelect={() => void createMix()} />
                  </>
                )}
              </Show>
            </Show>

            <Show when={section() === "sources"}>
              <h2>Sources</h2>
              <div class="sources">
                <div class="sources-list">
                  <Row label="IPTV" value={<Status ok={settings()!.iptv.length > 0 || Boolean(status()?.demo)} text={settings()!.iptv.map((s) => `${s.name} (${s.connections} connection${s.connections === 1 ? "" : "s"})`).join(", ") || (status()?.demo ? "Demo channels" : "Not set up")} />} />
                  <Row label="TV guide" value={<Status ok={(status()?.programmes ?? 0) > 0} text={`${status()?.channels ?? 0} channels, ${status()?.programmes ?? 0} programmes`} />} />
                  <Row label="Jellyfin" value={<Status ok={Boolean(settings()!.jellyfin)} text={settings()!.jellyfin?.serverName ?? (settings()!.jellyfin ? "Connected" : "Not connected")} />} />
                  <Row label="Film and TV info (TMDB)" value={<Status ok={settings()!.tmdb} text={settings()!.tmdb ? "Connected" : "Not set up"} />} />
                  <Row label="AIOStreams and add-ons" value={<Status ok={settings()!.addons.length > 0} text={settings()!.addons.map((a) => a.name).join(", ") || "None"} />} />
                  <Row label="TorBox" value={<Status ok={settings()!.torbox} text={settings()!.torbox ? "Connected" : "Not set up"} />} />
                  <Row
                    label="Refresh channels and guide now"
                    icon="restart"
                    onSelect={() =>
                      void hub
                        .refresh()
                        .then(() => toast("Refreshing. This takes a minute or two."))
                        .catch(errorToast)
                    }
                  />
                </div>
                <div class="qr-card">
                  <img src={`/api/setup/qr.svg?v=${pairStamp()}`} alt="" />
                  <p>
                    Scan with your phone to set up sources
                    <br />
                    <span class="muted">{settings()!.setupUrl}</span>
                  </p>
                </div>
              </div>
            </Show>

            <Show when={section() === "remote"}>
              <h2>Phones and remotes</h2>
              <div class="sources">
                <div class="sources-list">
                  <p class="hint">Only paired phones can work the TV. Scan the code with the phone's camera (or the {appName()} Remote app) and it pairs by itself; on Android, choose Add to Home screen afterwards. Remove anything you don't recognise.</p>
                  <For each={devices()?.pending ?? []}>
                    {(p) => <Row label={`${p.name} wants to join`} hint={`Let it in only if it shows ${p.code}`} icon="lock" value={<Status ok={false} text="Waiting" />} onSelect={() => void pendingMenu(p)} />}
                  </For>
                  <For each={devices()?.devices ?? []}>
                    {(d) => (
                      <Row
                        label={d.name}
                        hint={`${d.kind === "tv" ? "TV screen" : "Phone"} · last used ${ago(d.lastSeenAt)}`}
                        value={d.id === devices()?.me ? "This screen" : ""}
                        onSelect={() => void deviceMenu(d)}
                      />
                    )}
                  </For>
                  <Show when={devices() && !devices()!.enforced}>
                    <Row label="Pairing is off" hint="The Hub was started with PAIRING=off, so anything on the network can work the TV" value={<Status ok={false} text="Off" />} />
                  </Show>
                  <Row label="Home Assistant key" hint="For pop-ups, news flashes and key presses from Home Assistant or a script" icon="lock" onSelect={() => void showApiKey()} />
                </div>
                <div class="qr-card">
                  <img src={`/api/remote/qr.svg?v=${pairStamp()}`} alt="" />
                  <p>
                    Scan to pair a phone, or type
                    <span class="pair-code">{pairCode() ? spaced(pairCode()!.code) : "…"}</span>
                    <span class="muted">at {settings()!.setupUrl.replace(/\/setup\/?$/, "/remote/")}</span>
                  </p>
                </div>
              </div>
            </Show>

            <Show when={section() === "about"}>
              <h2>About</h2>
              <Row label="App name" value={appName()} hint="Rename the app on the TV, the phone remote and Spotify" icon="edit" onSelect={() => void rename()} />
              <Row label="Hub" value={`${appName()} ${status()?.version ?? ""}${status()?.commit ? ` · ${status()!.commit}` : ""}${status()?.builtAt ? ` · ${shortDate(status()!.builtAt!)}` : ""}${status()?.demo ? " · demo mode" : ""}`} />
              <Row label="Update the Hub" value={hubState()} hint={hubChanges() || "Checks GitHub for the latest code"} icon="download" onSelect={() => void updateHub()} />
              <Row label="Box" value={box() ? `${box()!.hostname ?? box()!.kind} · ${box()!.version}` : ""} />
              <Show when={box()?.kind === "box" && !agentHas("software")}>
                <Row label="Box software" value="Needs a one-off update" hint="This box's software is too old to update itself from here. Over SSH, run: cd /opt/ultimatetv && sudo git pull && sudo bash tools/box/install.sh" />
              </Show>
              <Show when={software()?.commit && status()?.commit && !software()!.commit!.startsWith(status()!.commit!)}>
                <Row label="Versions" value="The box and Hub differ" hint="Update whichever is older: the box here, the Hub with tools/hub/update.sh on the server" />
              </Show>
              <Show when={box()?.display}>
                <Row label="Display" value={`${box()!.display!.name} · ${box()!.display!.width}×${box()!.display!.height} @ ${box()!.display!.refreshHz} Hz${box()!.display!.hdr ? " · HDR" : ""}`} />
              </Show>
              <Show when={software()}>
                {(sw) => (
                  <>
                    <Row label="Box software" value={`${sw().commit ? sw().commit!.slice(0, 7) : "unknown"}${sw().date ? ` · ${shortDate(sw().date!)}` : ""}${sw().branch && sw().branch !== "main" ? ` · ${sw().branch}` : ""}`} />
                    <Row
                      label="Update the box"
                      hint={sw().lastUpdate ? `Last update ${new Date(sw().lastUpdate!.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${sw().lastUpdate!.ok ? "" : " (it failed)"}. It also updates itself every Monday at 4 am` : "It also updates itself every Monday at 4 am"}
                      value={updateState()}
                      icon="download"
                      onSelect={() => void updateBox()}
                    />
                  </>
                )}
              </Show>
              <Row label="TV remote (HDMI-CEC)" value={<Status ok={Boolean(box()?.cec?.connected)} text={box()?.cec?.connected ? "Connected" : "Not connected"} />} />
              <Show when={status()?.diskTotalBytes}>
                <Row label="NAS space" value={`${Math.round((status()!.diskFreeBytes ?? 0) / 1024 ** 3)} GB free of ${Math.round(status()!.diskTotalBytes! / 1024 ** 3)} GB`} />
              </Show>
              <Show when={mix()}>
                {(m) => <Row label="Music videos" hint={m().channels.map((c) => `${c.name} ${c.counts.ready} (${formatBytes(c.readyBytes)})`).join(" · ")} value={`${m().totals.ready} · ${formatBytes(m().totals.bytes)}`} />}
              </Show>
              <Row label="Reload the app" icon="restart" onSelect={() => void agent.reload()} />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
