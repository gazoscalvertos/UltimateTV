// Settings on the TV: profiles and the PIN, picture and sound, recording, and the state of each
// source. Typing-heavy setup (logins, URLs) happens on the phone via the QR code.

import { createResource, createSignal, For, Show, type JSX } from "solid-js";
import type { Certification, SubtitleMode, SubtitleStyle, TvAppsMethod, ClipSeason, ClipTheme, MixChannelInfo, NasListing, PairedDevice, PendingScreen, Profile, PublicSettings, ScareSettings, ScreensaverSettings, ScreensaverThemeId, ThemeName } from "@ultimatetv/shared";
import { CERTIFICATIONS, CLIP_THEME_NAMES, CLIP_THEMES, clipSeasonFor, formatBytes, mixTheme, resolveTheme, SCREENSAVER_THEMES, seasonalTheme, themeInfo, THEMES, TV_APPS_METHODS, DEFAULT_SUBTITLE_STYLE } from "@ultimatetv/shared";
import { agent, agentHas } from "../agent";
import { hub } from "../api";
import { askPin, askText, choose, confirm } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { TopBar } from "../components/TopBar";
import { onHubEvent } from "../events";
import { previewScreensaver } from "../idle";
import { pairStamp } from "../pairing";
import { appName, errorToast, setAppName, nav, previewTheme, setShowStats, setTheme, showStats, toast } from "../store";
import { onCleanup } from "solid-js";
import { Row, Status } from "../components/SettingRow";
import { AdvertRows, AlertsSection, CastSection, SeasonalSection, WeatherSection, WhatsNewSection } from "./SettingsMore";

/** "ABCDEFGH" as "ABCD-EFGH", easier to read off the screen. */
const spaced = (code: string) => code.replace(/^(.{4})(.+)$/, "$1-$2");
const ago = (t: number) => {
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)} hours ago`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};
/** "Today 03:30", "Yesterday 03:30", "28 Oct 03:30". */
const whenAgo = (at: number) => {
  const d = new Date(at);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `Today ${time}` : days === 1 ? `Yesterday ${time}` : `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${time}`;
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const SUB_LABELS: Record<SubtitleStyle["size"], string> = { small: "Small", medium: "Medium", large: "Large", huge: "Huge" };
const MODE_LABELS: Record<SubtitleMode, string> = { off: "Off", on: "On", foreign: "Only for other languages" };
const TV_APPS_LABELS: Record<TvAppsMethod, string> = { both: "Step down, then Home", inactive: "Step down only", home: "Press Home only" };
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
  // The Hub's nightly backup, read when About is opened.
  const [backup, { mutate: setBackup }] = createResource(
    () => section() === "about",
    (open) => (open ? hub.backup().catch(() => null) : Promise.resolve(null)),
  );
  const backupState = () => {
    const b = backup();
    if (!b) return backup.loading ? "Checking…" : "Couldn't check";
    if (b.running) return "Backing up now…";
    if (b.error) return <Status ok={false} text="Last one failed" />;
    if (!b.enabled) return "Turned off";
    return b.last ? `${whenAgo(b.last.at)} · ${formatBytes(b.last.bytes)}` : "None yet";
  };
  const backupHint = () => {
    const b = backup();
    if (!b) return "A copy of the Hub's settings, profiles and recordings list, every night";
    const parts = [b.error ? b.error.message : "", `${b.backups.length} kept${b.onNas ? " on the NAS" : " beside the Hub (the NAS isn't mounted in the Hub)"}`, b.enabled ? `every night at ${b.time}` : ""];
    return `${parts.filter(Boolean).join(" · ")}. Select to back up now; restore from the phone or tools/hub/restore.sh`;
  };
  const backupNow = async () => {
    if (backup()?.running) return;
    toast("Backing up the Hub…");
    try {
      setBackup(await hub.backupNow());
      toast("The Hub is backed up", "good");
    } catch (err) {
      errorToast(err);
    }
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

  const [scares, { mutate: mutateScares, refetch: refetchScares }] = createResource(
    () => section() === "scares",
    (open) => (open ? hub.scares().catch(() => null) : Promise.resolve(null)),
  );
  onCleanup(
    onHubEvent((e) => {
      if (e.type === "scares.changed" && section() === "scares") void refetchScares();
    }),
  );
  /** Installs every starter pack that isn't here yet. */
  const addStarters = async () => {
    try {
      const lib = await hub.clipLibrary();
      const missing = lib.starter.filter((p) => !p.installed);
      for (const p of missing) mutateScares(await hub.installClipPack(p.id, "starter"));
      toast(missing.length ? `Added ${missing.length} pack${missing.length === 1 ? "" : "s"}` : "They're all here already");
    } catch (e) {
      errorToast(e);
    }
  };
  const saveScares = async (patch: Partial<ScareSettings>) => {
    try {
      mutateScares(await hub.saveScares(patch));
    } catch (err) {
      errorToast(err);
    }
  };

  /**
   * The theme is kept on the Hub, so the phone remote and the web pages wear it too. Moving over a
   * tile tries it on the whole app; OK keeps it; moving away without pressing OK puts back the one
   * being worn.
   */
  const chooseTheme = async (name: ThemeName) => {
    await save({ theme: name });
    const now = resolveTheme(settings()!);
    setTheme(now);
    toast(now === name ? `${themeInfo(name).name} theme on` : `Saved. ${themeInfo(now).name} stays on while it's the season.`, "good");
  };
  const toggleSeasonal = async () => {
    await save({ seasonal: !settings()!.seasonal });
    setTheme(resolveTheme(settings()!));
  };
  const season = () => seasonalTheme();

  const save = async (patch: Partial<Pick<PublicSettings, "recording" | "playback" | "theme" | "seasonal">>) => {
    try {
      mutate(await hub.saveSettings(patch));
    } catch (err) {
      errorToast(err);
    }
  };
  const playback = () => settings()!.playback;
  const subStyle = () => playback().subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;
  // Changed while something plays, the subtitles on screen change too.
  const saveSubStyle = async (patch: Partial<SubtitleStyle>) => {
    const style = { ...subStyle(), ...patch };
    await save({ playback: { ...playback(), subtitleStyle: style } });
    if (agentHas("setSubtitleStyle")) await agent.setSubtitleStyle(style).catch(() => undefined);
  };

  // Dimming and the screensaver.
  const saver = () => settings()!.screensaver;
  const [saverInfo, { refetch: refetchSaverInfo }] = createResource(
    () => section() === "screensaver",
    (open) => (open ? hub.screensaver().catch(() => null) : Promise.resolve(null)),
  );
  const saveSaver = async (patch: Partial<ScreensaverSettings>) => {
    try {
      mutate(await hub.saveSettings({ screensaver: patch }));
      if (patch.photosPath !== undefined) await refetchSaverInfo();
    } catch (err) {
      errorToast(err);
    }
  };
  const minutes = (n: number) => (n ? (n >= 60 ? `After ${n / 60} hour${n === 60 ? "" : "s"}` : `After ${n} min`) : "Never");
  const themeName = (id: ScreensaverThemeId) => SCREENSAVER_THEMES.find((t) => t.id === id)?.name ?? id;
  const pickTheme = async () => {
    const id = await choose<ScreensaverThemeId>({
      title: "Screensaver",
      options: SCREENSAVER_THEMES.map((t) => ({ label: t.name, value: t.id, detail: t.months ? `${t.detail} · in Shuffle in ${t.months.map((m) => new Date(2000, m - 1).toLocaleString("en-GB", { month: "long" })).join(", ")}` : t.detail, ...(t.id === saver().theme ? { icon: "check" } : {}) })),
    });
    if (!id) return;
    await saveSaver({ theme: id });
    if (id === "photos" && !saver().photosPath) await pickFolder();
  };
  const pickFolder = async () => {
    let dir: string | undefined = saver().photosPath || undefined;
    for (;;) {
      let l: NasListing;
      try {
        l = await hub.browsePhotos(dir);
      } catch (err) {
        // The saved folder has gone: start from the shares.
        if (dir) {
          dir = undefined;
          continue;
        }
        errorToast(err);
        return;
      }
      const pick = await choose<string>({
        title: l.dir || "Where are your photos?",
        message: l.dir ? `${l.files.length} photo${l.files.length === 1 ? "" : "s"} and video${l.files.length === 1 ? "" : "s"} here, and the folders inside count too.` : "Pick the NAS share your photos are on, then the folder.",
        options: [
          ...(l.dir ? [{ label: "Use this folder", value: "use", icon: "check" }, { label: "Up a folder", value: "up", icon: "prev" }] : []),
          ...l.folders.slice(0, 80).map((f) => ({ label: f.name, value: `dir:${f.path}`, icon: "list" })),
        ],
      });
      if (pick === undefined) return;
      if (pick === "use") {
        await saveSaver({ photosPath: l.dir, ...(saver().theme === "off" ? { theme: "photos" as const } : {}) });
        toast("Photos folder set", "good");
        return;
      }
      dir = pick === "up" ? l.parent : pick.slice(4);
    }
  };
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
        { label: `Subtitles: ${p.subtitles ? MODE_LABELS[p.subtitles] : `as the household (${settings()?.playback.subtitlesByDefault ? "on" : "off"})`}`, value: "subtitles", icon: "subtitles" },
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
      if (pick === "subtitles") {
        const mode = await choose<SubtitleMode | "household">({
          title: `Subtitles for ${p.name}`,
          message: "Films without subtitles get some from OpenSubtitles when it's set up.",
          options: [
            { label: "On", value: "on", detail: "Whenever there are any" },
            { label: "Only for other languages", value: "foreign", detail: "When the speech isn't in English, and for signs and short foreign bits" },
            { label: "Off", value: "off" },
            { label: "As the household", value: "household", detail: "Settings › Picture and sound" },
          ],
        });
        if (mode) await hub.updateProfile(p.id, { subtitles: mode === "household" ? null : mode } as Partial<Profile>);
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

  /** The Hub's address as phones on the home Wi-Fi reach it. */
  const hubAddress = () => settings()?.setupUrl.replace(/\/setup\/?$/, "") ?? "";

  const SECTIONS = [
    { id: "profiles", label: "Profiles and PIN" },
    { id: "playback", label: "Picture and sound" },
    { id: "theme", label: "Theme" },
    { id: "screensaver", label: "Screensaver" },
    { id: "weather", label: "Weather" },
    { id: "recording", label: "Recording" },
    { id: "music", label: "Music channels" },
    { id: "scares", label: "Projected clips" },
    { id: "seasonal", label: "Seasonal clips" },
    { id: "cast", label: "Cast and games" },
    { id: "alerts", label: "Alerts" },
    { id: "sources", label: "Sources" },
    { id: "remote", label: "Phones and remotes" },
    { id: "apps", label: "Android apps" },
    { id: "whatsnew", label: "What's new" },
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
              <Row label="Subtitles" hint="Turn on automatically when available, for profiles that haven't chosen (Profiles › a profile › Subtitles)" value={playback().subtitlesByDefault ? "On" : "Off"} onSelect={() => void save({ playback: { ...playback(), subtitlesByDefault: !playback().subtitlesByDefault } })} />
              <Row label="Subtitle size" hint="Large reads best across the room on a big screen" value={SUB_LABELS[subStyle().size]} onSelect={() => void saveSubStyle({ size: cycle(["small", "medium", "large", "huge"] as const, subStyle().size) })} />
              <Row label="Subtitle background" hint="A dark box behind the words is easiest to read over snow and bright skies" value={subStyle().background === "box" ? "Dark box" : "Outline"} onSelect={() => void saveSubStyle({ background: subStyle().background === "box" ? "outline" : "box" })} />
              <Row label="Subtitle colour" value={subStyle().colour === "yellow" ? "Yellow" : "White"} onSelect={() => void saveSubStyle({ colour: subStyle().colour === "yellow" ? "white" : "yellow" })} />
              <Row label="Subtitle position" hint="Raised keeps them clear of the bottom of the picture" value={subStyle().position === "raised" ? "Raised" : "Bottom"} onSelect={() => void saveSubStyle({ position: subStyle().position === "raised" ? "bottom" : "raised" })} />
              <Show when={!settings()!.openSubtitles?.configured}>
                <Row label="Subtitles from OpenSubtitles" hint="For films that come without any: add a free key on the phone's setup page (Scores and subtitles)" value="Not set up" />
              </Show>
              <Row label="Audio language" value={playback().preferredAudioLang.toUpperCase()} onSelect={() => void save({ playback: { ...playback(), preferredAudioLang: cycle(["eng", "spa", "fra", "deu", "ita", "pol"], playback().preferredAudioLang) } })} />
              <Row label="Play the next episode automatically" value={playback().autoplayNext ? "On" : "Off"} onSelect={() => void save({ playback: { ...playback(), autoplayNext: !playback().autoplayNext } })} />
              <Row label="When the TV turns on" value={playback().startOn === "live" ? "Live TV" : "Home"} onSelect={() => void save({ playback: { ...playback(), startOn: playback().startOn === "live" ? "home" : "live" } })} />
              <Row label="Playback stats" hint="Show the stream, picture and sound details over the video. The blue button turns them on and off while watching" value={showStats() ? "On" : "Off"} onSelect={() => setShowStats(!showStats())} />
              <Row
                label="TV apps button"
                hint="How the box hands the screen to the TV's own apps over HDMI-CEC. Try another if the TV stays on this app"
                value={TV_APPS_LABELS[playback().tvAppsMethod ?? "both"]}
                onSelect={() => void save({ playback: { ...playback(), tvAppsMethod: cycle(TV_APPS_METHODS, playback().tvAppsMethod ?? "both") } })}
              />
              <Row label="Largest file to stream" hint="Bigger versions are moved down the list" value={`${playback().maxSizeGb} GB`} onSelect={() => void save({ playback: { ...playback(), maxSizeGb: cycle([20, 40, 60, 100], playback().maxSizeGb) } })} />
            </Show>

            <Show when={section() === "theme"}>
              <h2>Theme</h2>
              <p class="hint">The look of the TV, the phone remote and the setup pages. Move over a theme to try it, and press OK to keep it.</p>
              <div
                class="theme-grid"
                onFocusOut={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) previewTheme(null);
                }}
              >
                <For each={THEMES}>
                  {(t) => (
                    <button
                      class="theme-tile"
                      classList={{ chosen: settings()!.theme === t.id }}
                      data-focus
                      style={{
                        "--t-bg": `linear-gradient(160deg, ${t.palette["--bg-2"]}, ${t.palette["--bg"]})`,
                        "--t-fg": t.palette["--fg"],
                        "--t-panel": t.palette["--panel"],
                        "--t-muted": t.palette["--muted"],
                        "--t-accent": t.palette["--accent"],
                        "--t-accent-2": t.palette["--accent-2"],
                        "--t-on-accent": t.palette["--on-accent"],
                      }}
                      onFocus={() => previewTheme(t.id)}
                      onClick={() => void chooseTheme(t.id)}
                    >
                      <span class="theme-swatch">
                        <i />
                        <b />
                      </span>
                      <span class="theme-name">
                        {t.name}
                        <small>{t.season ? `Seasonal · ${t.season}` : t.detail}</small>
                      </span>
                    </button>
                  )}
                </For>
              </div>
              <Row
                label="Seasonal themes"
                value={settings()!.seasonal ? "On" : "Off"}
                hint={
                  settings()!.seasonal && season() && season() !== settings()!.theme
                    ? `${themeInfo(season()!).name} is on today; ${themeInfo(settings()!.theme).name} comes back after`
                    : "Halloween, Christmas, Easter and Valentine's take over on their days, then your theme comes back"
                }
                icon="star"
                onSelect={() => void toggleSeasonal()}
              />
            </Show>

            <Show when={section() === "screensaver"}>
              <h2>Screensaver</h2>
              <p class="hint">When the TV's left with nothing playing, the screen dims and later a screensaver starts. Any button brings it back without doing anything else. Paused video counts as nothing playing.</p>
              <Row label="Dim the screen" value={minutes(saver().dimAfterMin)} onSelect={() => void saveSaver({ dimAfterMin: cycle([0, 2, 5, 10, 15, 30, 60], saver().dimAfterMin) })} />
              <Row label="How dark" value={`${saver().dimPercent}%`} onSelect={() => void saveSaver({ dimPercent: cycle([50, 70, 85], saver().dimPercent) })} />
              <Row label="Screensaver" value={themeName(saver().theme)} hint={SCREENSAVER_THEMES.find((t) => t.id === saver().theme)?.detail} onSelect={() => void pickTheme()} />
              <Show when={saver().theme !== "off"}>
                <Row label="Start the screensaver" value={minutes(saver().startAfterMin)} onSelect={() => void saveSaver({ startAfterMin: cycle([0, 5, 10, 15, 20, 30, 60, 120], saver().startAfterMin) })} />
              </Show>
              <Row
                label="Your photos"
                icon="list"
                hint={saver().photosPath ? (saverInfo()?.photoError ?? (saverInfo()?.photoCount !== undefined ? `${saverInfo()!.photoCount} photos and videos` : "")) : "Choose a folder on the NAS for the Your photos screensaver"}
                value={saver().photosPath || "Not set"}
                onSelect={() => void pickFolder()}
              />
              <Row label="Each picture for" value={`${saver().photoSeconds} s`} hint="Photos, landscapes and art" onSelect={() => void saveSaver({ photoSeconds: cycle([10, 20, 30, 60], saver().photoSeconds) })} />
              <Row label="Show the clock" value={saver().clock ? "On" : "Off"} onSelect={() => void saveSaver({ clock: !saver().clock })} />
              <Show when={saver().theme !== "off"}>
                <Row label="Try it now" icon="play" hint="Press any button to come back" onSelect={() => previewScreensaver()} />
              </Show>
            </Show>

            <Show when={section() === "recording"}>
              <h2>Recording</h2>
              <Row label="Start early by" value={`${recording().paddingBeforeMin} min`} onSelect={() => void save({ recording: { ...recording(), paddingBeforeMin: cycle([0, 1, 2, 5, 10], recording().paddingBeforeMin) } })} />
              <Row label="Carry on after by" value={`${recording().paddingAfterMin} min`} onSelect={() => void save({ recording: { ...recording(), paddingAfterMin: cycle([0, 2, 5, 10, 15, 30], recording().paddingAfterMin) } })} />
              <Row label="Use catch-up when it can" hint="Saves programmes from catch-up afterwards, keeping your connection free to watch" value={recording().preferCatchup ? "On" : "Off"} onSelect={() => void save({ recording: { ...recording(), preferCatchup: !recording().preferCatchup } })} />
              <Row label="Delete watched recordings" value={recording().autoDeleteWatchedDays ? `After ${recording().autoDeleteWatchedDays} days` : "Never"} onSelect={() => void save({ recording: { ...recording(), autoDeleteWatchedDays: cycle([0, 7, 30, 90], recording().autoDeleteWatchedDays) } })} />
              <AdvertRows />
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
                            hint={[`${c.counts.ready} of ${c.goal ?? c.target} videos downloaded (${formatBytes(c.readyBytes)})`, waiting ? `${waiting} to download` : "", c.enabled ? "" : "turned off", c.error ?? ""].filter(Boolean).join(" · ")}
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

            <Show when={section() === "scares"}>
              <h2>Projected clips</h2>
              <p class="hint">
                Cuts a short clip in over whatever is on, now and then: a jump scare at Halloween, a snowman walking along the bottom at Christmas, a bunny
                hopping across at Easter. Only the occasion's clips come up. Add packs, build your own and share them from the phone remote's Clips tab.
                Never on a Kids profile.
              </p>
              <Show when={scares()} fallback={<div class="spinner" />}>
                {(sc) => {
                  const s = () => sc().settings;
                  const season = () => sc().season ?? clipSeasonFor(s().season);
                  const forSeason = () => (sc().mixes ?? []).filter((m) => mixTheme(m) === season());
                  return (
                    <>
                      <Row
                        label="Occasion"
                        value={s().season === "auto" ? `Auto (${CLIP_THEME_NAMES[season()]})` : CLIP_THEME_NAMES[s().season as ClipTheme]}
                        hint="Auto goes by the date: Halloween week, Bonfire Night, Christmas, New Year, Valentine's and Easter. Pick Birthday on the day."
                        onSelect={() => void saveScares({ season: cycle(["auto", ...CLIP_THEMES] as ClipSeason[], s().season) })}
                      />
                      <Row label="Random clips" value={s().enabled ? "On" : "Off"} hint={forSeason().length ? `${forSeason().length} for ${CLIP_THEME_NAMES[season()]}` : season() === "halloween" ? "With no clips uploaded, the TV draws (and screams) its own" : `Nothing for ${CLIP_THEME_NAMES[season()]} yet: add the starter packs below`} onSelect={() => void saveScares({ enabled: !s().enabled })} />
                      <Row label="At most one every" value={`${s().minGapMinutes} min`} onSelect={() => void saveScares({ minGapMinutes: cycle([10, 20, 30, 45, 60, 120], s().minGapMinutes) })} />
                      <Row label="How likely" hint="The chance of a clip in each minute once that gap has passed" value={`${s().chancePercent}%`} onSelect={() => void saveScares({ chancePercent: cycle([5, 10, 25, 50, 100], s().chancePercent) })} />
                      <Row label="On screen for" hint="For clips that don't say; walking and flying ones take as long as they need" value={`${s().seconds} sec`} onSelect={() => void saveScares({ seconds: cycle([2, 3, 4, 6, 10], s().seconds) })} />
                      <Row label="How loud" value={`${Math.round(s().volume * 100)}%`} onSelect={() => void saveScares({ volume: cycle([0, 0.3, 0.5, 0.7, 1], s().volume) })} />
                      <Row label="During live TV too" hint="Off means only films, episodes and recordings get clips" value={s().duringLive ? "On" : "Off"} onSelect={() => void saveScares({ duringLive: !s().duringLive })} />
                      <Row label="Only while something is playing" hint="Off lets a clip land on the menus as well" value={s().whilePlayingOnly ? "On" : "Off"} onSelect={() => void saveScares({ whilePlayingOnly: !s().whilePlayingOnly })} />
                      <Row label="Packs" value={(sc().packs ?? []).length ? String(sc().packs!.length) : "None yet"} hint={(sc().packs ?? []).map((p) => p.name).join(" · ") || "Christmas, Easter, Valentine's, birthday, Halloween and fireworks come with the app"} />
                      <Row label="Add the starter packs" icon="plus" hint="Every occasion's starter pack that isn't here yet" onSelect={() => void addStarters()} />
                      <Row label="Clips" value={sc().clips.length ? `${sc().clips.length} · ${formatBytes(sc().clips.reduce((a, c) => a + c.sizeBytes, 0))}` : "None yet"} hint="Upload your own from the phone remote's Clips tab" />
                      <Row label="Built clips" value={(sc().mixes ?? []).length ? String(sc().mixes.length) : "None yet"} hint={forSeason().map((m) => m.name).join(" · ") || "Build them on the phone remote's Clips tab: a picture or GIF and a sound, placed where you like, perhaps walking across"} />
                      <Row label="Show one now" icon="play" hint={`One of ${CLIP_THEME_NAMES[season()]}'s, on this TV straight away`} onSelect={() => void hub.scareNow().catch(errorToast)} />
                      <Row label="Play them one after another" icon="play" hint="Like a window projector: the occasion's clips on a loop until you press Back" onSelect={() => void hub.startClipLoop().catch(errorToast)} />
                    </>
                  );
                }}
              </Show>
            </Show>

            <Show when={section() === "seasonal"}>
              <SeasonalSection />
            </Show>

            <Show when={section() === "cast"}>
              <CastSection />
            </Show>

            <Show when={section() === "weather"}>
              <WeatherSection />
            </Show>

            <Show when={section() === "alerts"}>
              <AlertsSection />
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

            <Show when={section() === "apps"}>
              <h2>Android apps</h2>
              <div class="sources">
                <div class="sources-list">
                  <p class="hint">Scan a code with the phone's camera to download the app, then open the download to install it (allow installs from Chrome if Android asks). Downloads work on the home Wi-Fi only. The app pairs itself with the TV when you first open it.</p>
                  <Row label={`${appName()} for Android`} hint={`Watch everything the TV has on a phone or tablet, and download it for trips · ${hubAddress()}/api/client/app.apk`} icon="download" onSelect={() => toast("Scan the left code with the phone's camera")} />
                  <Row label={`${appName()} Remote`} hint={`The phone remote, with voice control and the volume keys for channels · ${hubAddress()}/api/remote/app.apk`} icon="download" onSelect={() => toast("Scan the right code with the phone's camera")} />
                </div>
                <div class="app-qrs">
                  <div class="qr-card">
                    <img src="/api/apps/client/qr.svg" alt="" />
                    <p>{appName()} for Android</p>
                  </div>
                  <div class="qr-card">
                    <img src="/api/apps/remote/qr.svg" alt="" />
                    <p>{appName()} Remote</p>
                  </div>
                </div>
              </div>
            </Show>

            <Show when={section() === "whatsnew"}>
              <WhatsNewSection />
            </Show>

            <Show when={section() === "about"}>
              <h2>About</h2>
              <Row label="App name" value={appName()} hint="Rename the app on the TV, the phone remote and Spotify" icon="edit" onSelect={() => void rename()} />
              <Row label="Hub" value={`${appName()} ${status()?.version ?? ""}${status()?.commit ? ` · ${status()!.commit}` : ""}${status()?.builtAt ? ` · ${shortDate(status()!.builtAt!)}` : ""}${status()?.demo ? " · demo mode" : ""}`} />
              <Row label="Update the Hub" value={hubState()} hint={hubChanges() || "Checks GitHub for the latest code"} icon="download" onSelect={() => void updateHub()} />
              <Row label="Hub backup" value={backupState()} hint={backupHint()} icon="download" onSelect={() => void backupNow()} />
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
