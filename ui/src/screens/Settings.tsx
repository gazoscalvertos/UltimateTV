// Settings on the TV: profiles and the PIN, picture and sound, recording, and the state of each
// source. Typing-heavy setup (logins, URLs) happens on the phone via the QR code.

import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import type { Certification, Profile, PublicSettings } from "@ultimatetv/shared";
import { CERTIFICATIONS } from "@ultimatetv/shared";
import { agent, agentHas } from "../agent";
import { hub } from "../api";
import { askPin, askText, choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { errorToast, setShowStats, showStats, toast } from "../store";
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

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const cycle = <T,>(list: readonly T[], value: T): T => list[(list.indexOf(value) + 1) % list.length]!;

export function Settings() {
  const [settings, { mutate }] = createResource(() => hub.settings());
  const [profiles, { refetch: refetchProfiles }] = createResource(() => hub.profiles());
  const [status] = createResource(() => hub.status());
  const [box] = createResource(() => agent.info());
  const [section, setSection] = createSignal("profiles");
  // The box's software, checked against GitHub when About is opened.
  const [software, { refetch: refetchSoftware }] = createResource(
    () => section() === "about",
    (open) => (open && agentHas("software") ? agent.software(true).catch(() => null) : Promise.resolve(null)),
  );
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
    { id: "sources", label: "Sources" },
    { id: "remote", label: "Phone remote" },
    { id: "about", label: "About" },
  ];

  return (
    <div class="screen settings" data-layer>
      <TopBar />
      <div class="settings-layout">
        <nav class="settings-nav" data-focus-group>
          <For each={SECTIONS}>
            {(s, i) => (
              <button class="settings-nav-item" classList={{ active: section() === s.id }} data-focus data-autofocus={i() === 0 ? "" : undefined} onFocus={() => setSection(s.id)} onClick={() => setSection(s.id)}>
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
                  <img src="/api/setup/qr.svg" alt="" />
                  <p>
                    Scan with your phone to set up sources
                    <br />
                    <span class="muted">{settings()!.setupUrl}</span>
                  </p>
                </div>
              </div>
            </Show>

            <Show when={section() === "remote"}>
              <h2>Phone remote</h2>
              <div class="sources">
                <div class="sources-list">
                  <p class="hint">Use your Android phone as the remote: scan the code, then choose Add to Home screen (or Install app) in Chrome. It works over your Wi-Fi with arrows, OK, Back, colour keys, numbers, channel up and down, and typing for search.</p>
                  <p class="hint">The TV's own remote takes over once the Pulse-Eight adapter is plugged in, and the phone remote keeps working alongside it.</p>
                </div>
                <div class="qr-card">
                  <img src="/api/remote/qr.svg" alt="" />
                  <p>
                    Scan to open the remote
                    <br />
                    <span class="muted">{settings()!.setupUrl.replace(/\/setup\/?$/, "/remote/")}</span>
                  </p>
                </div>
              </div>
            </Show>

            <Show when={section() === "about"}>
              <h2>About</h2>
              <Row label="Hub" value={`UltimateTV ${status()?.version ?? ""}${status()?.commit ? ` · ${status()!.commit}` : ""}${status()?.builtAt ? ` · ${shortDate(status()!.builtAt!)}` : ""}${status()?.demo ? " · demo mode" : ""}`} />
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
              <Row label="Reload the app" icon="restart" onSelect={() => void agent.reload()} />
            </Show>
          </Show>
        </div>
      </div>
    </div>
  );
}
