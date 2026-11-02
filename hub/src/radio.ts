// Radio: a list of stations the TV and the phone can start, plus the household's own.
//
// The presets are plain data — the addresses were checked by hand against the live
// streams, since a station that has moved is better fixed in one line here than
// discovered by someone pressing it. Nothing here fetches anything at startup: a
// preset is only tried when someone asks for it.
//
// "Now playing" comes from the stream itself. Most commercial stations send ICY
// metadata (a song title every few seconds); the BBC's do not, so those simply have
// no line. Asking costs one short-lived connection, so an answer is kept for a while.

import type { RadioAddInput, RadioNow, RadioStation } from "@ultimatetv/shared";
import { newId } from "./db.js";
import type { Db } from "./db.js";

/** Stations that ship with the Hub. Kids see only the ones marked for them. */
const PRESETS: RadioStation[] = [
  { id: "radio:bbc-radio-1", name: "BBC Radio 1", url: "https://as-hls-ww-live.akamaized.net/pool_01505109/live/ww/bbc_radio_one/bbc_radio_one.isml/bbc_radio_one-audio%3d128000.norewind.m3u8", genre: "New music", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_one/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-1xtra", name: "BBC Radio 1Xtra", url: "https://as-hls-ww-live.akamaized.net/pool_92079267/live/ww/bbc_1xtra/bbc_1xtra.isml/bbc_1xtra-audio%3d128000.norewind.m3u8", genre: "Urban", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_1xtra/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-2", name: "BBC Radio 2", url: "https://as-hls-ww-live.akamaized.net/pool_74208725/live/ww/bbc_radio_two/bbc_radio_two.isml/bbc_radio_two-audio%3d128000.norewind.m3u8", genre: "Easy listening", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_two/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-3", name: "BBC Radio 3", url: "https://as-hls-ww-live.akamaized.net/pool_23461179/live/ww/bbc_radio_three/bbc_radio_three.isml/bbc_radio_three-audio%3d128000.norewind.m3u8", genre: "Classical", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_three/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-4", name: "BBC Radio 4", url: "https://as-hls-ww-live.akamaized.net/pool_55057080/live/ww/bbc_radio_fourfm/bbc_radio_fourfm.isml/bbc_radio_fourfm-audio%3d128000.norewind.m3u8", genre: "Talk", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_four/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-4-extra", name: "BBC Radio 4 Extra", url: "https://as-hls-ww-live.akamaized.net/pool_26173715/live/ww/bbc_radio_four_extra/bbc_radio_four_extra.isml/bbc_radio_four_extra-audio%3d128000.norewind.m3u8", genre: "Comedy and drama", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_four_extra/colour_default.svg", source: "preset" },
  { id: "radio:bbc-radio-5", name: "BBC Radio 5 Live", url: "https://as-hls-ww-live.akamaized.net/pool_89021708/live/ww/bbc_radio_five_live/bbc_radio_five_live.isml/bbc_radio_five_live-audio%3d128000.norewind.m3u8", genre: "News and sport", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_radio_five_live/colour_default.svg", source: "preset" },
  { id: "radio:bbc-6music", name: "BBC Radio 6 Music", url: "https://as-hls-ww-live.akamaized.net/pool_81827798/live/ww/bbc_6music/bbc_6music.isml/bbc_6music-audio%3d128000.norewind.m3u8", genre: "Albums and oddities", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_6music/colour_default.svg", source: "preset" },
  { id: "radio:bbc-asian-network", name: "BBC Asian Network", url: "https://as-hls-ww-live.akamaized.net/pool_22108647/live/ww/bbc_asian_network/bbc_asian_network.isml/bbc_asian_network-audio%3d128000.norewind.m3u8", genre: "Asian music and talk", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_asian_network/colour_default.svg", source: "preset" },
  { id: "radio:bbc-world-service", name: "BBC World Service", url: "https://a.files.bbci.co.uk/media/live/manifesto/audio/simulcast/hls/nonuk/sbr_low/ak/bbc_world_service.m3u8", genre: "World news", logo: "https://sounds.files.bbci.co.uk/3.9.4/networks/bbc_world_service/colour_default.svg", source: "preset" },
  { id: "radio:fun-kids", name: "Fun Kids", url: "https://listen-funkids.sharp-stream.com/funkids.mp3", genre: "For children", logo: "https://www.funkidslive.com/favicon.ico", source: "preset", kidsOnly: true },
  { id: "radio:fun-kids-junior", name: "Fun Kids Junior", url: "https://listen-funkids.sharp-stream.com/funkidsjunior.mp3", genre: "For little ones", logo: "https://www.funkidslive.com/favicon.ico", source: "preset", kidsOnly: true },
  { id: "radio:classic-fm", name: "Classic FM", url: "https://media-ice.musicradio.com/ClassicFMMP3", genre: "Classical", logo: "https://www.classicfm.com/assets_v4r/classic/img/favicon-196x196.png", source: "preset" },
  { id: "radio:classic-fm-calm", name: "Classic FM Calm", url: "https://media-ice.musicradio.com/ClassicFMCalmMP3", genre: "Calm classical", logo: "https://www.classicfm.com/assets_v4r/classic/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-london", name: "Heart London", url: "https://media-ice.musicradio.com/HeartLondonMP3", genre: "Pop", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-dance", name: "Heart Dance", url: "https://media-ice.musicradio.com/HeartDanceMP3", genre: "Dance", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-70s", name: "Heart 70s", url: "https://media-ice.musicradio.com/Heart70sMP3", genre: "Seventies", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-80s", name: "Heart 80s", url: "https://media-ice.musicradio.com/Heart80sMP3", genre: "Eighties", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-90s", name: "Heart 90s", url: "https://media-ice.musicradio.com/Heart90sMP3", genre: "Nineties", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-00s", name: "Heart 00s", url: "https://media-ice.musicradio.com/Heart00sMP3", genre: "Noughties", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:heart-musicals", name: "Heart Musicals", url: "https://media-ice.musicradio.com/HeartMusicalsMP3", genre: "Show tunes", logo: "https://www.heart.co.uk/assets_v4r/heart/img/favicon-196x196.png", source: "preset" },
  { id: "radio:smooth-london", name: "Smooth London", url: "https://media-ice.musicradio.com/SmoothLondonMP3", genre: "Easy listening", logo: "https://www.smoothradio.com/assets_v4r/smooth/img/favicon-196x196.png", source: "preset" },
  { id: "radio:smooth-chill", name: "Smooth Chill", url: "https://media-ice.musicradio.com/SmoothChillMP3", genre: "Chillout", logo: "https://www.smoothradio.com/assets_v4r/smooth/img/favicon-196x196.png", source: "preset" },
  { id: "radio:capital", name: "Capital FM", url: "https://media-ice.musicradio.com/CapitalMP3", genre: "Pop", logo: "https://www.capitalfm.com/assets_v4r/capital/img/favicon-196x196.png", source: "preset" },
  { id: "radio:radio-x", name: "Radio X", url: "https://media-ice.musicradio.com/RadioXUK", genre: "Rock and talk", logo: "https://www.radiox.co.uk/assets_v4r/xfm/img/favicon-196x196.png", source: "preset" },
  { id: "radio:radio-x-classic-rock", name: "Radio X Classic Rock", url: "https://media-ice.musicradio.com/RadioXClassicRockMP3", genre: "Classic rock", logo: "https://www.radiox.co.uk/assets_v4r/xfm/img/favicon-196x196.png", source: "preset" },
  { id: "radio:gold", name: "Gold Radio", url: "https://media-ice.musicradio.com/GoldMP3", genre: "Oldies", logo: "https://www.goldradio.com/assets_v4r/gold/img/favicon-196x196.png", source: "preset" },
  { id: "radio:lbc", name: "LBC", url: "https://media-ice.musicradio.com/LBCUK", genre: "Phone-in talk", logo: "https://www.lbc.co.uk/apple-touch-icon.png", source: "preset" },
  { id: "radio:radio-paradise", name: "Radio Paradise", url: "https://stream.radioparadise.com/mp3-128", genre: "Eclectic", logo: "https://radioparadise.com/favicon.ico", source: "preset" },
  { id: "radio:radio-paradise-rock", name: "Radio Paradise Rock", url: "https://stream.radioparadise.com/rock-128", genre: "Rock", logo: "https://radioparadise.com/favicon.ico", source: "preset" },
  { id: "radio:radio-paradise-mellow", name: "Radio Paradise Mellow", url: "https://stream.radioparadise.com/mellow-128", genre: "Mellow", logo: "https://radioparadise.com/favicon.ico", source: "preset" },
];

const CUSTOM_KEY = "radio-custom";
const MAX_CUSTOM = 40;
const NAME_MAX = 80;
const URL_MAX = 2000;

/** How long a now-playing answer is reused before the stream is asked again. */
const NOW_TTL_MS = 20_000;
/** The stream is only given a moment: this is a nicety, never worth a stall. */
const NOW_TIMEOUT_MS = 5000;
/** Enough of the stream to reach the first metadata block. */
const MAX_METADATA_BYTES = 512 * 1024;

/** Something the household can fix by typing a different address (so: a 400, not a 500). */
export class RadioError extends Error {
  readonly statusCode = 400;
}

const cleanName = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "");

/** Only plain web addresses: this is handed to a player, so nothing else will do. */
export function cleanStreamUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const url = raw.trim().slice(0, URL_MAX);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * The song or programme a stream is playing, from its ICY metadata.
 *
 * A stream sends audio in blocks of `icy-metaint` bytes, each followed by a length
 * byte and that many 16-byte metadata chunks. We only need the first one, and the
 * connection is dropped the moment we have it. Streams without ICY (the BBC's, for
 * one) answer with no `icy-metaint` and we say nothing about them.
 */
export async function icyNowPlaying(fetchImpl: typeof fetch, url: string): Promise<string | undefined> {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), NOW_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      headers: { "Icy-MetaData": "1", "User-Agent": "UltimateTV" },
      redirect: "manual",
      signal: stop.signal,
    });
    const metaInt = Number(res.headers.get("icy-metaint"));
    if (!Number.isFinite(metaInt) || metaInt <= 0 || !res.body) return undefined;
    const reader = res.body.getReader();
    let seen = 0;
    let buffered = new Uint8Array(0);
    while (seen < MAX_METADATA_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      const joined = new Uint8Array(buffered.length + value.length);
      joined.set(buffered);
      joined.set(value, buffered.length);
      buffered = joined;
      seen = buffered.length;
      const at = metaInt;
      if (buffered.length <= at) continue;
      const length = buffered[at]! * 16;
      if (length === 0) return undefined;
      if (buffered.length < at + 1 + length) continue;
      const text = new TextDecoder().decode(buffered.subarray(at + 1, at + 1 + length));
      const match = /StreamTitle='([^']*)'/.exec(text);
      const title = match?.[1]?.trim();
      return title ? title : undefined;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    stop.abort();
  }
}

export class Radio {
  private readonly now = new Map<string, RadioNow>();

  constructor(
    private readonly db: Db,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** The household's own stations, newest first. */
  custom(): RadioStation[] {
    const stored = this.db.getKv<unknown>(CUSTOM_KEY);
    if (!Array.isArray(stored)) return [];
    const out: RadioStation[] = [];
    for (const raw of stored) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Partial<RadioStation>;
      const url = cleanStreamUrl(row.url);
      const name = cleanName(row.name);
      if (!url || !name || typeof row.id !== "string" || !row.id) continue;
      out.push({
        id: row.id,
        name,
        url,
        ...(typeof row.genre === "string" && row.genre.trim() ? { genre: row.genre.trim().slice(0, 40) } : {}),
        source: "custom",
        ...(row.kidsOnly === true ? { kidsOnly: true } : {}),
      });
    }
    return out.slice(0, MAX_CUSTOM);
  }

  /** Every station this profile may see: presets first, then the household's own. */
  stations(kids = false): RadioStation[] {
    const presets = kids ? PRESETS.filter((s) => s.kidsOnly) : PRESETS;
    const custom = this.custom().filter((s) => (kids ? s.kidsOnly === true : true));
    return [...presets, ...custom];
  }

  get(id: string, kids = false): RadioStation | undefined {
    return this.stations(kids).find((s) => s.id === id);
  }

  add(input: RadioAddInput): RadioStation {
    const name = cleanName(input?.name);
    const url = cleanStreamUrl(input?.url);
    if (!name) throw new RadioError("Give the station a name.");
    if (!url) throw new RadioError("That doesn't look like a stream address. It should start with http:// or https://.");
    const all = this.custom();
    if (all.some((s) => s.url === url)) throw new RadioError("That station is already in the list.");
    if (all.length >= MAX_CUSTOM) throw new RadioError(`That's as many stations as will fit (${MAX_CUSTOM}). Remove one first.`);
    const station: RadioStation = { id: newId("radio"), name, url, source: "custom" };
    this.db.setKv(CUSTOM_KEY, [...all, { id: station.id, name, url, source: "custom" }]);
    return station;
  }

  remove(id: string): boolean {
    const all = this.custom();
    const left = all.filter((s) => s.id !== id);
    if (left.length === all.length) return false;
    this.db.setKv(CUSTOM_KEY, left.length ? left : null);
    this.now.delete(id);
    return true;
  }

  /** A station's now-playing line, reusing a recent answer rather than asking again. */
  async nowPlaying(id: string, station: RadioStation | undefined, at = Date.now()): Promise<RadioNow> {
    if (!station) return { stationId: id, at };
    const cached = this.now.get(id);
    if (cached && at - cached.at < NOW_TTL_MS) return cached;
    const title = await icyNowPlaying(this.fetchImpl, station.url);
    const answer: RadioNow = { stationId: id, at, ...(title ? { now: title } : {}) };
    this.now.set(id, answer);
    return answer;
  }
}
