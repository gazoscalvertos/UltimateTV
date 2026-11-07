// Settings › Sources: the Providers screen (issue #218). Every provider is a row built from the
// generic list in ../sources.ts (id, label, kind, status, "next step"); OK opens its setup, using
// the remote and an on-screen keyboard. The phone's QR code stays beside the list as the quicker
// way to type. Setting up needs an adult profile (the Hub also insists on its PIN).
//
// To add a provider (Emby, Nuvio, a second Jellyfin…): add it to `providerList` in sources.ts and
// give it a handler in `setups` below. To give rows an Options menu (test, pause, remove,
// reorder: issue #219) fill in `rowOptions`; a row with options opens that menu on the Info key
// and OK keeps doing setup.

import { createSignal, For, onCleanup, Show } from "solid-js";
import type { PublicSettings } from "@ultimatetv/shared";
import { ApiError, hub, session } from "../api";
import { acceptRemoteText, askPin, choose, confirm, DialogFrame } from "../components/Dialog";
import { Row, Status } from "../components/SettingRow";
import { useKeys } from "../keys";
import { openSourceOptions, sourceName } from "../sourceOptions";
import { pairStamp } from "../pairing";
import { errorToast, openDialog, profile, toast } from "../store";
import { canSetUpSources, cleanAddonUrl, cleanServerUrl, providerList, withAddon, type ProviderInfo } from "../sources";

// ---------------------------------------------------------------------------
// The on-screen keyboard for addresses, logins and keys

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DIGITS = "1234567890".split("");
const SYMBOLS = [":", "/", ".", "-", "_", "@", "?", "=", "&", "%", "+", "#", "~", ","];

interface LineOptions {
  hint?: string;
  initial?: string;
  /** Shown as dots (a password or key). */
  secret?: boolean;
  /** One-press starts, like "https://". */
  shortcuts?: string[];
  /** Whether empty is an answer. */
  allowEmpty?: boolean;
}

/** Asks for a line of text (a web address, a login) with a keyboard that has the punctuation they need. */
export function askLine(title: string, o: LineOptions = {}): Promise<string | undefined> {
  return openDialog<string>((close) => {
    const [text, setText] = createSignal(o.initial ?? "");
    const [upper, setUpper] = createSignal(false);
    const [shown, setShown] = createSignal(!o.secret);
    // A link or key is far easier pasted on the phone remote than typed here.
    onCleanup(acceptRemoteText((t) => setText(t.trim())));
    const type = (k: string) => setText((t) => t + k);
    const letter = (k: string) => (upper() ? k.toUpperCase() : k);
    const done = () => {
      const v = o.secret ? text() : text().trim();
      if (v || o.allowEmpty) close(v);
    };
    return (
      <DialogFrame close={() => close()} class="text-dialog line-dialog" wide>
        <h2>{title}</h2>
        <p class="hint">{o.hint ?? "Or send it from the phone remote."}</p>
        <div class="text-value">{(shown() ? text() : "•".repeat(text().length)) || " "}</div>
        <Show when={o.shortcuts?.length}>
          <div class="line-shortcuts">
            <For each={o.shortcuts}>
              {(s) => (
                <button class="key key-wide" data-focus onClick={() => type(s)}>
                  {s}
                </button>
              )}
            </For>
          </div>
        </Show>
        <div class="keyboard keyboard-compact">
          <For each={[...LETTERS]}>
            {(k, i) => (
              <button class="key" data-focus data-autofocus={i() === 0 ? "" : undefined} onClick={() => type(letter(k))}>
                {letter(k)}
              </button>
            )}
          </For>
          <For each={DIGITS}>
            {(k) => (
              <button class="key" data-focus onClick={() => type(k)}>
                {k}
              </button>
            )}
          </For>
          <For each={SYMBOLS}>
            {(k) => (
              <button class="key" data-focus onClick={() => type(k)}>
                {k}
              </button>
            )}
          </For>
          <button class="key key-wide" data-focus onClick={() => setUpper((u) => !u)}>
            {upper() ? "abc" : "ABC"}
          </button>
          <button class="key key-wide" data-focus onClick={() => setText((t) => t.slice(0, -1))}>
            Delete
          </button>
          <button class="key key-wide" data-focus onClick={() => setText("")}>
            Clear
          </button>
          <Show when={o.secret}>
            <button class="key key-wide" data-focus onClick={() => setShown((s) => !s)}>
              {shown() ? "Hide" : "Show"}
            </button>
          </Show>
          <button class="key key-wide key-done" data-focus onClick={done}>
            Done
          </button>
        </div>
      </DialogFrame>
    );
  });
}

// ---------------------------------------------------------------------------
// A code on the TV that the household approves elsewhere (Plex PIN, Jellyfin Quick Connect)

/**
 * Shows `code` and asks `check` every few seconds whether it has been approved. `check` returns
 * true when done, false to keep waiting, or throws to give up with its message. Back cancels.
 */
function showCode(o: { title: string; steps: string; code: string; check: () => Promise<boolean>; everyMs?: number; giveUpMs?: number }): Promise<boolean> {
  return openDialog<boolean>((close) => {
    const [error, setError] = createSignal("");
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      try {
        if (await o.check()) return close(true);
      } catch (err) {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
        return;
      }
      if (Date.now() - started > (o.giveUpMs ?? 5 * 60_000)) return setError("That code ran out of time. Start again to get a new one.");
      timer = window.setTimeout(() => void tick(), o.everyMs ?? 2500);
    };
    let timer = window.setTimeout(() => void tick(), o.everyMs ?? 2500);
    onCleanup(() => {
      stopped = true;
      clearTimeout(timer);
    });
    return (
      <DialogFrame close={() => close(false)} class="code-dialog">
        <h2>{o.title}</h2>
        <p class="dialog-message">{o.steps}</p>
        <div class="code-big">{o.code}</div>
        <p class="hint">{error() || "Waiting for you… this closes by itself once it's approved."}</p>
        <div class="dialog-options">
          <button class="btn" data-focus data-autofocus onClick={() => close(false)}>
            Cancel
          </button>
        </div>
      </DialogFrame>
    );
  }).then((v) => v === true);
}

// ---------------------------------------------------------------------------
// The screen

/** Runs `fn`; if the Hub wants the profile's PIN first, asks for it and tries once more. */
export async function withPin<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const p = profile();
    if (!(err instanceof ApiError) || err.code !== "pin" || !p) throw err;
    let token: string | null = null;
    const ok = await askPin(`Enter the PIN for ${p.name}`, async (pin) => {
      try {
        token = (await hub.unlock(p.id, pin)).token;
        return null;
      } catch (e) {
        return e instanceof ApiError && e.status === 403 ? "That PIN isn't right. Try again." : String(e);
      }
    });
    if (!ok) throw new Error("Cancelled");
    session.set(p.id, token);
    return fn();
  }
}

/** The Options keys (see sourceOptions.ts) a provider row covers; an IPTV row can cover several sources. */
function optionKeys(settings: PublicSettings, id: string): string[] {
  if (id === "iptv" || id === "xtream") return settings.iptv.filter((x) => (id === "xtream" ? x.kind === "xtream" : x.kind === "m3u")).map((x) => `iptv:${x.id}`);
  if (id === "jellyfin") return settings.jellyfin ? ["jellyfin"] : [];
  if (id === "plex") return settings.plex ? ["plex"] : [];
  if (id === "torbox") return settings.torbox ? ["torbox"] : [];
  if (id === "addons") return settings.addons.map((a) => a.id);
  return [];
}

export function SourcesSection(props: { settings: PublicSettings; onSettings: (s: PublicSettings) => void; demo?: boolean; channels?: number; programmes?: number; setupUrl: string }) {
  const [busy, setBusy] = createSignal(false);
  const allowed = () => canSetUpSources(profile());
  const providers = () => providerList(props.settings, { demo: Boolean(props.demo), channels: props.channels ?? 0, programmes: props.programmes ?? 0 });

  /** Runs a setup step: PIN if the Hub asks, a fresh read of the settings afterwards, errors as toasts. */
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    if (busy()) return;
    setBusy(true);
    try {
      await withPin(fn);
      props.onSettings(await hub.settings());
      if (done) toast(done, "good");
    } catch (err) {
      if (!(err instanceof Error && err.message === "Cancelled")) errorToast(err);
    } finally {
      setBusy(false);
    }
  };

  // Which servers answer on the home network: a pick-list with "type an address" as the way out.
  const pickServer = async (kind: "jellyfin" | "plex", extra: { label: string; detail: string; value: string }[] = []): Promise<string | undefined> => {
    toast("Looking for servers on your network…");
    const found = (await hub.discoverServers().catch(() => ({ servers: [] }))).servers.filter((s) => s.kind === kind);
    if (found.length === 0 && extra.length === 0) return typeAddress(kind);
    const pick = await choose<string>({
      title: found.length > 0 ? `${kind === "plex" ? "Plex" : "Jellyfin"} servers found` : `No ${kind === "plex" ? "Plex" : "Jellyfin"} server answered`,
      message: found.length > 0 ? "Pick yours, or type its address." : "Type its address, or let plex.tv find it.",
      options: [...found.map((s) => ({ label: s.name, value: `url:${s.url}`, detail: s.url })), ...extra.map((e) => ({ label: e.label, value: e.value, detail: e.detail })), { label: "Type an address", value: "type", icon: "edit" }],
    });
    if (!pick) return undefined;
    if (pick === "type") return typeAddress(kind);
    return pick.startsWith("url:") ? pick.slice(4) : pick;
  };

  const typeAddress = async (kind: "jellyfin" | "plex"): Promise<string | undefined> => {
    const typed = await askLine(`${kind === "plex" ? "Plex" : "Jellyfin"} server address`, { hint: kind === "plex" ? "Like 192.168.0.20:32400" : "Like 192.168.0.20:8096", shortcuts: ["http://", "https://"] });
    if (!typed) return undefined;
    const url = cleanServerUrl(typed);
    if (!url) toast("That doesn't look like an address", "bad");
    return url ?? undefined;
  };

  // --- IPTV: M3U playlist or Xtream Codes -----------------------------------------------------
  const manageIptv = async (kind: "m3u" | "xtream", p: ProviderInfo) => {
    const mine = props.settings.iptv.filter((s) => s.kind === kind);
    if (mine.length > 0) {
      const pick = await choose<string>({
        title: p.label,
        options: [{ label: kind === "m3u" ? "Add another playlist" : "Add another login", value: "add", icon: "plus" }, ...mine.map((s) => ({ label: `Remove ${s.name}`, value: s.id, icon: "trash", tone: "danger" as const, detail: s.host })), { label: "Cancel", value: "" }],
      });
      if (!pick) return;
      if (pick !== "add") {
        if (!(await confirm(`Remove ${mine.find((s) => s.id === pick)?.name ?? "this source"}?`, "Its channels leave the list.", "Remove", true))) return;
        return run(() => hub.removeIptv(pick), "Removed");
      }
    }
    if (kind === "m3u") {
      const url = await askLine("Playlist address (M3U)", { hint: "The link your provider gave you, ending in .m3u or get.php", shortcuts: ["http://", "https://"] });
      if (!url) return;
      return run(() => hub.addIptv({ kind: "m3u", url }), "Added. The Hub is loading the channels; this takes a minute or two.");
    }
    const server = await askLine("Xtream Codes server", { hint: "The server address, like http://provider.example:8080", shortcuts: ["http://", "https://"] });
    if (!server) return;
    const username = await askLine("Username");
    if (!username) return;
    const password = await askLine("Password", { secret: true });
    if (!password) return;
    return run(() => hub.addIptv({ kind: "xtream", url: cleanServerUrl(server) ?? server, username, password }), "Added. The Hub is loading the channels; this takes a minute or two.");
  };

  // --- Jellyfin -------------------------------------------------------------------------------
  const signInJellyfin = async (p: ProviderInfo) => {
    if (props.settings.jellyfin) {
      const pick = await choose<string>({ title: p.label, message: `Signed in to ${props.settings.jellyfin.serverName ?? props.settings.jellyfin.url}.`, options: [{ label: "Sign in to a different server", value: "again" }, { label: "Sign out", value: "out", tone: "danger", icon: "trash" }, { label: "Cancel", value: "" }] });
      if (!pick) return;
      if (pick === "out") return run(() => hub.removeJellyfin(), "Signed out of Jellyfin");
    }
    const url = await pickServer("jellyfin");
    if (!url) return;
    const how = await choose<string>({ title: "How do you want to sign in?", options: [{ label: "Quick Connect", value: "qc", detail: "A code shows here; approve it in the Jellyfin app on your phone" }, { label: "Username and password", value: "password" }] });
    if (how === "qc") {
      let started: { code: string; secret: string };
      try {
        started = await withPin(() => hub.jellyfinQuickConnect(url));
      } catch (err) {
        if (!(err instanceof Error && err.message === "Cancelled")) errorToast(err);
        return;
      }
      const ok = await showCode({
        title: "Quick Connect",
        steps: "On your phone, open the Jellyfin app, then Settings › Quick Connect, and type this code.",
        code: started.code,
        check: async () => (await hub.jellyfinQuickConnectCheck(started.secret, url)).authenticated,
      });
      if (ok) {
        props.onSettings(await hub.settings());
        toast("Signed in to Jellyfin", "good");
      }
    } else if (how === "password") {
      const username = await askLine("Jellyfin username");
      if (!username) return;
      const password = await askLine("Jellyfin password", { secret: true, allowEmpty: true });
      if (password === undefined) return;
      await run(() => hub.jellyfinLogin(url, username, password), "Signed in to Jellyfin");
    }
  };

  // --- Plex -----------------------------------------------------------------------------------
  const signInPlex = async (p: ProviderInfo) => {
    if (props.settings.plex) {
      const pick = await choose<string>({ title: p.label, message: `Signed in to ${props.settings.plex.serverName ?? props.settings.plex.url}.`, options: [{ label: "Sign in again", value: "again" }, { label: "Sign out", value: "out", tone: "danger", icon: "trash" }, { label: "Cancel", value: "" }] });
      if (!pick) return;
      if (pick === "out") return run(() => hub.removePlex(), "Signed out of Plex");
    }
    // Servers on this network first; plex.tv's own list is the fallback when none answer.
    const url = await pickServer("plex", [{ label: "Let plex.tv choose", detail: "Uses the first server on your Plex account", value: "auto" }]);
    if (!url) return;
    const server = url === "auto" ? undefined : url;
    let pin: { id: number; code: string };
    try {
      pin = await withPin(() => hub.plexPin());
    } catch (err) {
      if (!(err instanceof Error && err.message === "Cancelled")) errorToast(err);
      return;
    }
    const ok = await showCode({
      title: "Sign in to Plex",
      steps: "On your phone or computer, go to plex.tv/link and type this code.",
      code: pin.code,
      check: async () => (await hub.plexPinCheck(pin.id, server)).authenticated,
    });
    if (ok) {
      props.onSettings(await hub.settings());
      toast("Signed in to Plex", "good");
    }
  };

  // --- Stremio add-ons, TorBox ----------------------------------------------------------------
  const manageAddons = async (p: ProviderInfo) => {
    const urls = props.settings.addons.map((a) => a.url);
    const pick =
      urls.length === 0
        ? "add"
        : await choose<string>({ title: p.label, options: [{ label: "Add an add-on", value: "add", icon: "plus" }, ...props.settings.addons.map((a) => ({ label: `Remove ${a.name || a.url}`, value: `rm:${a.url}`, icon: "trash", tone: "danger" as const })), { label: "Cancel", value: "" }] });
    if (!pick) return;
    if (pick.startsWith("rm:")) return run(() => hub.saveSources({ addonUrls: urls.filter((u) => u !== pick.slice(3)) }), "Add-on removed");
    const typed = await askLine("Add-on address", { hint: "The manifest link, https:// or stremio://", shortcuts: ["https://", "stremio://"] });
    if (!typed) return;
    const url = cleanAddonUrl(typed);
    if (!url) return void toast("That doesn't look like an address", "bad");
    const next = withAddon(urls, url);
    if (!next) return void toast("That add-on is already added");
    return run(() => hub.saveSources({ addonUrls: next }), "Add-on added");
  };

  const manageTorbox = async (p: ProviderInfo) => {
    if (props.settings.torbox) {
      const pick = await choose<string>({ title: p.label, options: [{ label: "Use a different key", value: "again" }, { label: "Remove the key", value: "out", tone: "danger", icon: "trash" }, { label: "Cancel", value: "" }] });
      if (!pick) return;
      if (pick === "out") return run(() => hub.saveSources({ torboxApiKey: "" }), "TorBox key removed");
    }
    const key = await askLine("TorBox API key", { hint: "From torbox.app › Settings. Easier to send from the phone remote.", secret: true });
    if (!key) return;
    return run(() => hub.saveSources({ torboxApiKey: key }), "TorBox connected");
  };

  const phoneOnly = () => toast("Set this up on your phone: scan the code on the right", "info");

  /** What OK does on each row, by provider id. */
  const setups: Record<string, (p: ProviderInfo) => Promise<void> | void> = {
    iptv: (p) => manageIptv("m3u", p),
    xtream: (p) => manageIptv("xtream", p),
    jellyfin: signInJellyfin,
    plex: signInPlex,
    addons: manageAddons,
    torbox: manageTorbox,
  };

  const open = (p: ProviderInfo) => {
    if (!allowed()) return;
    void (setups[p.id] ?? phoneOnly)(p);
  };

  // Info key: a row's Options (test, pause, order, remove: issue #219).
  useKeys((a) => {
    if (a !== "info") return false;
    const el = document.activeElement as HTMLElement | null;
    const id = el?.closest<HTMLElement>("[data-provider]")?.dataset.provider;
    if (!id || !allowed()) return false;
    const keys = optionKeys(props.settings, id);
    if (keys.length === 0) return false;
    void (async () => {
      let key = keys[0]!;
      if (keys.length > 1) {
        const pick = await choose<string>({ title: "Which one?", options: [...keys.map((k) => ({ label: sourceName(props.settings, k), value: k })), { label: "Cancel", value: "" }] });
        if (!pick) return;
        key = pick;
      }
      await openSourceOptions(key, props.onSettings);
    })();
    return true;
  });

  return (
    <>
      <h2>Sources</h2>
      <div class="sources">
        <div class="sources-list">
          <Show when={allowed()} fallback={<p class="hint">Sources are set up from a grown-up's profile.</p>}>
            <p class="hint">Press OK on a source to set it up or change it, and the Info key for Options (test, pause, order, remove). Typing is quicker on your phone: scan the code.</p>
          </Show>
          <For each={providers()}>
            {(p) => (
              <div data-provider={p.id}>
                <Row label={p.label} hint={p.hint} value={<Status ok={p.ok} text={p.status} />} onSelect={() => open(p)} />
              </div>
            )}
          </For>
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
            <span class="muted">{props.setupUrl}</span>
          </p>
        </div>
      </div>
    </>
  );
}
