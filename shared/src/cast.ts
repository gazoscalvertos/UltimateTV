// Putting other screens on the TV: an iPhone, iPad or Mac mirrored over AirPlay (UxPlay on the
// box), any laptop's screen shared from its browser (WebRTC, through the Hub), a link or a photo
// sent from a phone, and games (RetroArch, Moonlight, Steam Link, GeForce NOW) launched from the
// app. While one of them has the screen, the TV app steps aside; it comes back when they end.

/** Apps the box can launch full screen in place of the TV app. */
export type GameAppId = "retroarch" | "moonlight" | "steamlink" | "geforcenow" | "steam";

export interface GameApp {
  id: GameAppId;
  name: string;
  /** One line on what it's for. */
  detail: string;
  installed: boolean;
  /** How to get it when it isn't installed. */
  howTo: string;
  /** Needs a game controller (RetroArch works with the TV remote too). */
  controller: boolean;
}

export const GAME_APPS: readonly Omit<GameApp, "installed">[] = [
  { id: "retroarch", name: "Retro games", detail: "RetroArch: classic consoles from your own game files on the NAS", howTo: "Installed by the box installer (GAMES=1)", controller: false },
  { id: "moonlight", name: "Games from your PC", detail: "Moonlight: play the games on a gaming PC running Sunshine, over the home network", howTo: "Installed by the box installer (GAMES=1); install Sunshine on the PC", controller: true },
  { id: "steamlink", name: "Steam Link", detail: "Play your Steam library from a PC in the house", howTo: "flatpak install flathub com.valvesoftware.SteamLink", controller: true },
  { id: "geforcenow", name: "GeForce NOW", detail: "Cloud gaming: your Steam, Epic and Xbox games, run by NVIDIA", howTo: "NVIDIA's GeForce NOW Flatpak (the box installer adds it with GAMES=1)", controller: true },
  { id: "steam", name: "Steam Big Picture", detail: "Steam itself, to play the games the box can run", howTo: "pacman -S steam (needs the multilib repository)", controller: true },
];

export interface AirPlayState {
  /** UxPlay is on the box. */
  installed: boolean;
  /** Turned on in the app (on unless turned off). */
  enabled: boolean;
  /** The receiver is running and can be found on the network. */
  running: boolean;
  /** Something is connected and showing its screen (or playing its sound). */
  connected: boolean;
  /** The name an iPhone or Mac sees in its Screen Mirroring list. */
  name: string;
  error?: string;
}

export interface CastState {
  airplay: AirPlayState;
  apps: GameApp[];
  /** What has the screen in place of the TV app, or null. */
  foreground: { kind: "airplay" | "app"; id: string; name: string; since: number } | null;
}

/** The Hub's casting settings: who may use what. */
export interface CastSettings {
  /** Laptops may share their screen from the browser (the TV still asks before showing it). */
  screenShare: boolean;
  /** Paired phones may send links and photos to play. */
  links: boolean;
  /** The Kids profile may open the games (casting is never allowed there). */
  gamesForKids: boolean;
}

export const DEFAULT_CAST_SETTINGS: CastSettings = { screenShare: true, links: true, gamesForKids: false };

export function cleanCastSettings(patch: Partial<CastSettings>, base: CastSettings = DEFAULT_CAST_SETTINGS): CastSettings {
  const bool = (v: unknown, fallback: boolean) => (v === undefined ? fallback : Boolean(v));
  return { screenShare: bool(patch.screenShare, base.screenShare), links: bool(patch.links, base.links), gamesForKids: bool(patch.gamesForKids, base.gamesForKids) };
}

/** A laptop asking to share its screen: its WebRTC offer, gathered complete (no trickle). */
export interface ShareOffer {
  id: string;
  /** What the laptop called itself ("Chrome on Windows", or a name typed on the page). */
  name: string;
  sdp: string;
  at: number;
  /** The share asked for a single window or tab rather than a whole screen. */
  surface?: "monitor" | "window" | "browser";
}

export type ShareStatus = "waiting" | "accepted" | "refused" | "ended";

/** A screen share as the laptop's page polls it. */
export interface ShareSession {
  id: string;
  status: ShareStatus;
  /** The TV's answer, once it accepts. */
  answer?: string;
  /** Why it was refused or ended, in words for the laptop's page. */
  reason?: string;
}

/** A link from a phone to play on the TV: a video file, a stream, or a YouTube page (the box's mpv uses yt-dlp). */
export interface CastLink {
  url: string;
  title?: string;
  from?: string;
}

/** Checks a link is something the TV can be asked to open: http(s) only, of a sane length. */
export function cleanCastUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const text = input.trim();
  // A share from a phone app often wraps the link in words: "Watch this! https://youtu.be/…".
  const found = /https?:\/\/\S+/i.exec(text)?.[0] ?? text;
  if (found.length > 2000) return null;
  try {
    const u = new URL(found);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** A name for a link the sender didn't name: the site and the last part of the path. */
export function linkTitle(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(u.hostname)) return "YouTube";
    const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() ?? "");
    return last ? `${last.slice(0, 60)} (${u.hostname})` : u.hostname;
  } catch {
    return "Link";
  }
}
