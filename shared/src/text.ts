// Small text and time helpers shared by the Hub and the UI.

/** Lower-case, strip punctuation and leading articles so "The Office (UK)" and "Office" match. */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\((?:new|uk|us|hd|\d{4})\)/g, " ")
    .replace(/\b(new|live)\s*:\s*/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

/** Channel names as providers write them ("UK: BBC One FHD", "BBC 1 HD") → "bbc one". */
export function normaliseChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^[a-z]{2,3}\s*[:|\-]\s*/, "")
    .replace(/\b(fhd|uhd|hd|sd|4k|hevc|h265|1080p?|720p?|50fps|raw|backup|vip)\b/g, " ")
    .replace(/\bbbc ?1\b/, "bbc one")
    .replace(/\bbbc ?2\b/, "bbc two")
    .replace(/\bbbc ?3\b/, "bbc three")
    .replace(/\bbbc ?4\b/, "bbc four")
    .replace(/\bitv ?1\b/, "itv1")
    .replace(/\bchannel ?4\b/, "channel 4")
    .replace(/\bchannel ?5\b|\bfive\b/, "channel 5")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Picks a feed height from a channel or stream name. */
export function heightFromName(name: string): number {
  if (/\b(uhd|4k|2160p?)\b/i.test(name)) return 2160;
  if (/\b(fhd|1080[pi]?)\b/i.test(name)) return 1080;
  if (/\bhd\b|\b720p?\b/i.test(name)) return 720;
  return 576;
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function durationLabel(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function episodeLabel(season?: number, episode?: number): string {
  if (season === undefined && episode === undefined) return "";
  if (season === undefined) return `Ep ${episode}`;
  if (episode === undefined) return `Series ${season}`;
  return `S${season} E${episode}`;
}

const DAY = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** "Today", "Tomorrow", "Yesterday" or "Sat 26 Oct". */
export function dayLabel(ms: number, now = Date.now()): string {
  const diff = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Jellyfin-style folder name: "Title (Year)" with characters Windows/SMB dislike removed. */
export function safeFileName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
}
