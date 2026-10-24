// Streaming XMLTV parser. Provider guides can be 200 MB, so programmes are emitted one at a time.

import sax from "sax";
import { normaliseTitle } from "@ultimatetv/shared";

export interface XmltvChannel {
  id: string;
  names: string[];
  icon?: string;
}

export interface XmltvProgramme {
  channel: string;
  start: number;
  end: number;
  title: string;
  subtitle?: string;
  description?: string;
  categories: string[];
  episodeNums: { system: string; value: string }[];
  icon?: string;
  isNew: boolean;
  previouslyShown: boolean;
  year?: number;
  rating?: string;
}

export interface XmltvHandlers {
  channel?(c: XmltvChannel): void;
  programme?(p: XmltvProgramme): void;
}

/** "20261024200000 +0100" → epoch ms. A missing offset means UTC. */
export function parseXmltvTime(value: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?\s*([+-]\d{2}):?(\d{2})?/.exec(value.trim()) ?? /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(value.trim());
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", s = "0", oh, om] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!oh) return utc;
  const sign = oh.startsWith("-") ? -1 : 1;
  const offsetMin = sign * (Math.abs(Number(oh)) * 60 + Number(om ?? 0));
  return utc - offsetMin * 60_000;
}

export function parseXmltv(input: NodeJS.ReadableStream | string, handlers: XmltvHandlers): Promise<{ channels: number; programmes: number }> {
  return new Promise((resolve, reject) => {
    const parser = sax.createStream(true, { trim: true });
    let channels = 0;
    let programmes = 0;
    let channel: XmltvChannel | null = null;
    let prog: XmltvProgramme | null = null;
    let text = "";
    let epSystem = "";
    let inRating = false;

    parser.on("opentag", (node) => {
      text = "";
      const attr = (name: string) => {
        const v = node.attributes[name];
        return typeof v === "string" ? v : v?.value;
      };
      switch (node.name) {
        case "channel":
          channel = { id: attr("id") ?? "", names: [] };
          break;
        case "programme": {
          const start = parseXmltvTime(attr("start") ?? "");
          const stop = attr("stop");
          prog = {
            channel: attr("channel") ?? "",
            start,
            end: stop ? parseXmltvTime(stop) : NaN,
            title: "",
            categories: [],
            episodeNums: [],
            isNew: false,
            previouslyShown: false,
          };
          break;
        }
        case "icon": {
          const src = attr("src");
          if (src && prog) prog.icon ??= src;
          else if (src && channel) channel.icon ??= src;
          break;
        }
        case "episode-num":
          epSystem = attr("system") ?? "";
          break;
        case "new":
          if (prog) prog.isNew = true;
          break;
        case "previously-shown":
          if (prog) prog.previouslyShown = true;
          break;
        case "rating":
          inRating = true;
          break;
      }
    });

    parser.on("text", (t) => (text += t));
    parser.on("cdata", (t) => (text += t));

    parser.on("closetag", (name) => {
      const value = text.trim();
      text = "";
      if (channel && name === "display-name" && value) channel.names.push(value);
      else if (channel && name === "channel") {
        channels++;
        handlers.channel?.(channel);
        channel = null;
      } else if (prog) {
        switch (name) {
          case "title":
            if (!prog.title) prog.title = value;
            break;
          case "sub-title":
            if (!prog.subtitle && value) prog.subtitle = value;
            break;
          case "desc":
            if (!prog.description && value) prog.description = value;
            break;
          case "category":
            if (value) prog.categories.push(value);
            break;
          case "episode-num":
            if (value) prog.episodeNums.push({ system: epSystem, value });
            break;
          case "date": {
            const year = Number(value.slice(0, 4));
            if (year > 1900) prog.year = year;
            break;
          }
          case "value":
            if (inRating && value && !prog.rating) prog.rating = value;
            break;
          case "rating":
            inRating = false;
            break;
          case "programme":
            if (Number.isFinite(prog.start) && prog.title) {
              if (!Number.isFinite(prog.end)) prog.end = prog.start + 30 * 60_000;
              programmes++;
              handlers.programme?.(prog);
            }
            prog = null;
            break;
        }
      }
    });

    parser.on("error", (err) => {
      // Malformed entities are common in provider feeds; skip and carry on.
      (parser as unknown as { _parser: { error: Error | null; resume(): void } })._parser.error = null;
      (parser as unknown as { _parser: { resume(): void } })._parser.resume();
      void err;
    });
    parser.on("end", () => resolve({ channels, programmes }));

    if (typeof input === "string") {
      parser.end(input);
    } else {
      input.on("error", reject);
      input.pipe(parser);
    }
  });
}

export interface EpisodeIdentity {
  season?: number;
  episode?: number;
  seriesKey: string;
  episodeKey?: string;
}

/**
 * Works out series and episode identity from whatever the feed provides, in order of reliability:
 * CRIDs (UK broadcasters), dd_progid (Gracenote), xmltv_ns or on-screen numbering, then the title.
 */
export function episodeIdentity(p: Pick<XmltvProgramme, "title" | "subtitle" | "description" | "episodeNums">): EpisodeIdentity {
  const titleKey = `t:${normaliseTitle(p.title)}`;
  let seriesKey = titleKey;
  let episodeKey: string | undefined;
  let season: number | undefined;
  let episode: number | undefined;

  for (const { system, value } of p.episodeNums) {
    const sys = system.toLowerCase();
    if (sys === "xmltv_ns") {
      const [s, e] = value.split(".").map((x) => x.split("/")[0]?.trim());
      if (s) season = Number(s) + 1;
      if (e) episode = Number(e) + 1;
    } else if (sys === "onscreen" || sys === "sxxexx") {
      const m = /S(\d+)\s*E(\d+)/i.exec(value) ?? /Series\s*(\d+).*?Episode\s*(\d+)/i.exec(value);
      if (m) {
        season = Number(m[1]);
        episode = Number(m[2]);
      } else {
        const e = /^(?:E|Ep(?:isode)?\s*)?(\d+)$/i.exec(value.trim());
        if (e) episode = Number(e[1]);
      }
    } else if (sys === "dd_progid") {
      const m = /^([A-Z]{2}\d+)\.?(\d+)?/.exec(value);
      if (m?.[1] && (m[1].startsWith("EP") || m[1].startsWith("SH"))) {
        seriesKey = `dd:${m[1]}`;
        if (m[2] && Number(m[2]) > 0) episodeKey = `dd:${m[1]}.${m[2]}`;
      }
    } else if (sys.includes("crid")) {
      // Series CRIDs and programme CRIDs both use crid://; the series one is labelled "series" in most feeds.
      if (sys.includes("series")) seriesKey = `crid:${value.toLowerCase()}`;
      else episodeKey = `crid:${value.toLowerCase()}`;
    }
  }

  if (season !== undefined && Number.isNaN(season)) season = undefined;
  if (episode !== undefined && Number.isNaN(episode)) episode = undefined;

  if (!episodeKey) {
    if (season !== undefined && episode !== undefined) episodeKey = `${seriesKey}|s${season}e${episode}`;
    else if (p.subtitle) episodeKey = `${seriesKey}|${normaliseTitle(p.subtitle)}`;
    else if (p.description && p.description.length > 20) episodeKey = `${seriesKey}|d${hash(normaliseTitle(p.description).slice(0, 120))}`;
  }

  const result: EpisodeIdentity = { seriesKey };
  if (season !== undefined) result.season = season;
  if (episode !== undefined) result.episode = episode;
  if (episodeKey) result.episodeKey = episodeKey;
  return result;
}

export function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
