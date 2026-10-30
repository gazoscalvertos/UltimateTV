// Phone voice control: turns what was said ("watch BBC One", "pause", "down three times",
// "search for Dune") into remote keys, a channel to switch to, or a search on the TV.

import type { Channel } from "@ultimatetv/shared";

export type VoiceCommand =
  | { kind: "keys"; actions: string[]; say: string }
  | { kind: "channel"; channelId: string; say: string }
  | { kind: "search"; text: string; say: string }
  | { kind: "stats"; on: boolean; say: string }
  | { kind: "reload"; say: string }
  | { kind: "save"; name: string; say: string }
  | { kind: "sleep"; minutes: number | "end" | "off"; say: string }
  | { kind: "weather"; say: string }
  | { kind: "none"; say: string };

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, to: 2, too: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, once: 1, twice: 2,
};

/** Simple keys, by the words people use for them. Longer phrases are matched first. */
const KEYS: [RegExp, string, string][] = [
  [/^(go )?home( screen)?$|^main menu$/, "home", "Home"],
  [/^(open |show )?(the )?(tv )?guide$|^epg$/, "guide", "Guide"],
  [/^(go )?back$|^exit$/, "back", "Back"],
  [/^(ok|okay|select|enter|choose( that| this| it)?|press ok)$/, "ok", "OK"],
  [/^(pause|pause (it|that|this))$/, "pause", "Pause"],
  [/^(play|resume|carry on|continue|unpause|play (it|that|this))$/, "play", "Play"],
  [/^stop( (it|that|this|playing|watching))?$/, "stop", "Stop"],
  [/^(fast forward|forward|skip( ahead| forward)?)$/, "fastForward", "Fast forward"],
  [/^(rewind|go back a bit|skip back)$/, "rewind", "Rewind"],
  [/^(record( (it|this|that))?)$/, "record", "Record"],
  [/^(info|information|details|what'?s on)$/, "info", "Info"],
  [/^options$/, "yellow", "Options"],
  [/^(channel up|next channel)$/, "channelUp", "Channel up"],
  [/^(channel down|previous channel|last channel)$/, "channelDown", "Channel down"],
  [/^(red|green|yellow|blue)( button)?$/, "", ""],
];

const ARROW = /^(move |go |press )?(up|down|left|right)(?: (\w+)(?: times?)?)?$/;

/** Lower case, numbers as digits, no punctuation: "BBC One HD" and "bbc 1" both become "bbc1". */
export function normaliseName(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9+]+/)
    .filter(Boolean)
    .map((w) => (w in NUMBER_WORDS && w !== "to" && w !== "too" && w !== "for" && w !== "once" && w !== "twice" ? String(NUMBER_WORDS[w]) : w))
    .join("")
    .replace(/(fhd|uhd|hd|sd|4k)$/, "")
    .replace(/^the/, "");
}

function count(word: string | undefined): number {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? 1;
}

/** "one oh one" → "101", "channel 1 0 1" → "101". */
function spokenNumber(text: string): string | null {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  let out = "";
  for (const w of words) {
    if (/^\d+$/.test(w)) out += w;
    else if (w in NUMBER_WORDS && NUMBER_WORDS[w]! < 10 && w !== "once" && w !== "twice") out += String(NUMBER_WORDS[w]);
    else return null;
  }
  return out || null;
}

export function findChannel(name: string, channels: Channel[]): Channel | undefined {
  const want = normaliseName(name);
  if (!want) return undefined;
  const scored = channels.map((c) => ({ c, n: normaliseName(c.name) })).filter((x) => x.n);
  return (
    scored.find((x) => x.n === want)?.c ??
    // "BBC One" said, "BBC One London" listed; shortest name wins so "Sky Sports" isn't "Sky Sports News".
    scored.filter((x) => x.n.startsWith(want)).sort((a, b) => a.n.length - b.n.length)[0]?.c
  );
}

export function parseVoice(said: string, channels: Channel[]): VoiceCommand {
  const text = said
    .toLowerCase()
    .replace(/[.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(please |can you |could you |hey tv |ok tv )+/, "")
    .replace(/ please$/, "");
  if (!text) return { kind: "none", say: "Didn't catch that" };

  for (const [re, action, label] of KEYS) {
    const m = re.exec(text);
    if (!m) continue;
    if (!action) {
      const colour = text.split(" ")[0]!;
      return { kind: "keys", actions: [colour], say: `${colour[0]!.toUpperCase()}${colour.slice(1)} button` };
    }
    return { kind: "keys", actions: [action], say: label };
  }

  const arrow = ARROW.exec(text);
  if (arrow) {
    const n = Math.min(20, Math.max(1, count(arrow[3])));
    return { kind: "keys", actions: Array.from({ length: n }, () => arrow[2]!), say: n > 1 ? `${arrow[2]} ×${n}` : arrow[2]! };
  }

  const stats = /^(show|hide|turn on|turn off|switch on|switch off) (the )?(playback )?stats$|^(playback )?stats (on|off)$/.exec(text);
  if (stats) {
    const on = /show|on/.test(stats[1] ?? stats[5] ?? "");
    return { kind: "stats", on, say: on ? "Showing playback stats" : "Hiding playback stats" };
  }
  if (/^(reload|restart|refresh) (the )?(tv )?(app|screen)$/.test(text)) return { kind: "reload", say: "Reloading the TV app" };

  // "save Dune for later", "add The Bear to my list", "put Dune on the watchlist"
  const save = /^(?:save|add|put|remember)\s+(.+?)\s+(?:for later|to (?:my |the )?(?:list|watch ?list)|on (?:my |the )?(?:list|watch ?list))$/.exec(text) ?? /^(?:save for later|watch later)\s+(.+)$/.exec(text);
  if (save) return { kind: "save", name: save[1]!, say: `Saved “${save[1]}” for later` };

  // "what's the weather like", "weather forecast", "will it rain tomorrow", "is it cold out"
  if (/^(?:(?:what'?s|what is|how'?s|show(?: me)?|open|check)\s+)?(?:the\s+)?(?:weather|forecast)(?:\s+forecast)?(?:\s+(?:like|today|tomorrow|this week|for (?:today|tomorrow|the week)))*$|^(?:is it|will it)\s+(?:going to\s+)?(?:be\s+)?(?:rain|raining|snow|snowing|cold|warm|hot|sunny|windy)\b/.test(text))
    return { kind: "weather", say: "Here's the weather" };

  // "sleep in 30 minutes", "sleep timer an hour", "turn off at the end of this", "cancel the sleep timer"
  if (/^(cancel|stop|turn off) (the )?sleep( timer)?$|^sleep( timer)? off$/.test(text)) return { kind: "sleep", minutes: "off", say: "Sleep timer off" };
  const sleepy = /^(?:sleep timer|sleep|turn (?:the tv )?off|switch (?:the tv )?off|go to sleep)\s+(?:in |after |for )?(.+)$/.exec(text);
  if (sleepy) {
    const when = sleepy[1]!;
    if (/end|finish/.test(when)) return { kind: "sleep", minutes: "end", say: "Sleeping at the end of this" };
    const hours = /^(an?|one|\d+(?:\.\d+)?|half an?) hours?$/.exec(when);
    const mins = /^(\w+) min(?:ute)?s?$/.exec(when);
    const n = hours ? (hours[1]!.startsWith("half") ? 0.5 : /^(an?|one)$/.test(hours[1]!) ? 1 : Number(hours[1])) * 60 : mins ? count(mins[1]) : NaN;
    if (Number.isFinite(n) && n > 0 && n <= 600) return { kind: "sleep", minutes: Math.round(n), say: `Sleeping in ${Math.round(n)} minutes` };
  }

  // "channel 101", "go to channel one oh one", "101"
  const numbered = /^(?:(?:go to|switch to|change to|put on|turn to|watch) )?(?:channel )?(.+)$/.exec(text);
  const digits = numbered && (/^(go to|switch to|change to|put on|turn to|watch|channel)\b/.test(text) || /^\d+$/.test(text)) ? spokenNumber(numbered[1]!) : null;
  if (digits) {
    const c = channels.find((ch) => String(ch.number) === String(Number(digits)));
    if (c) return { kind: "channel", channelId: c.id, say: `${c.number} ${c.name}` };
    // "Channel 5" is a name as well as a number.
    const named = findChannel(text.replace(/^(go to|switch to|change to|put on|turn to|watch) /, ""), channels);
    if (named) return { kind: "channel", channelId: named.id, say: `${named.number} ${named.name}` };
    return { kind: "keys", actions: [...digits.slice(0, 4)].map((d) => `digit${d}`), say: `Channel ${digits}` };
  }

  const search = /^(?:search(?: for)?|find(?: me)?|look for|look up|show me|i want to watch|let'?s watch)\s+(.+)$/.exec(text);
  if (search) return { kind: "search", text: search[1]!, say: `Searching for “${search[1]}”` };

  // "watch BBC One", "put on Sky News", "play Dune": a channel when one has that name, otherwise search.
  const watch = /^(?:watch|put on|switch to|change to|go to|turn to|tune to|play)\s+(.+)$/.exec(text);
  const target = watch ? watch[1]! : text;
  const c = findChannel(target, channels);
  if (c) return { kind: "channel", channelId: c.id, say: `${c.number} ${c.name}` };
  return { kind: "search", text: target, say: `Searching for “${target}”` };
}
