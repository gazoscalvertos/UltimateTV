// The channel lists the guide can show: all channels, favourites, each category, and custom
// guides the household builds by hand (its own choice and order of channels). Each profile can
// pick one as the list its guide opens on.

import type { Channel, ChannelCategory, CustomGuide, GuideChoice } from "@ultimatetv/shared";
import type { Db } from "./db.js";
import { newId } from "./db.js";

const CATEGORY_LABELS: [ChannelCategory, string][] = [
  ["entertainment", "Entertainment"],
  ["films", "Films"],
  ["sport", "Sport"],
  ["news", "News"],
  ["documentaries", "Documentaries"],
  ["kids", "Kids"],
  ["music", "Music"],
  ["other", "Other"],
];

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

export class CustomGuideStore {
  constructor(private db: Db) {}

  list(): CustomGuide[] {
    return this.db.getKv<CustomGuide[]>("custom-guides") ?? [];
  }

  get(id: string): CustomGuide | undefined {
    return this.list().find((g) => g.id === id);
  }

  create(input: { name?: string; channels?: string[] }): CustomGuide {
    const list = this.list();
    const guide: CustomGuide = { id: newId("g"), name: cleanName(input.name) || `My guide ${list.length + 1}`, channels: cleanChannels(input.channels) };
    this.db.setKv("custom-guides", [...list, guide]);
    return guide;
  }

  update(id: string, patch: { name?: string; channels?: string[] }): CustomGuide | undefined {
    const list = this.list();
    const guide = list.find((g) => g.id === id);
    if (!guide) return undefined;
    if (patch.name !== undefined) guide.name = cleanName(patch.name) || guide.name;
    if (patch.channels !== undefined) guide.channels = cleanChannels(patch.channels);
    this.db.setKv("custom-guides", list);
    return guide;
  }

  remove(id: string): boolean {
    const list = this.list();
    if (!list.some((g) => g.id === id)) return false;
    this.db.setKv("custom-guides", list.filter((g) => g.id !== id));
    return true;
  }

  /** Narrows `channels` (already filtered for the profile) to one list, in that list's order. */
  channelsFor(choice: string | undefined, channels: Channel[]): Channel[] {
    if (!choice || choice === "all") return channels;
    if (choice === "favourites") return channels.filter((c) => c.favourite);
    if (choice === "uhd") return channels.filter((c) => c.maxHeight >= 2160);
    const custom = this.get(choice);
    if (custom) {
      const byId = new Map(channels.map((c) => [c.id, c]));
      return custom.channels.map((id) => byId.get(id)).filter((c): c is Channel => c !== undefined);
    }
    if (CATEGORY_LABELS.some(([cat]) => cat === choice)) return channels.filter((c) => c.category === choice);
    // A deleted custom guide, or a list this Hub doesn't know: show everything rather than nothing.
    return channels;
  }

  /** The lists worth offering this profile: empty categories and favourites are left out. */
  choices(channels: Channel[]): GuideChoice[] {
    const out: GuideChoice[] = [{ id: "", label: "All channels", kind: "all", count: channels.length }];
    const favourites = channels.filter((c) => c.favourite).length;
    if (favourites) out.push({ id: "favourites", label: "Favourites", kind: "favourites", count: favourites });
    // A custom guide with nothing this profile can see (a Kids profile and a grown-up's guide) is left out.
    for (const g of this.list()) {
      const count = this.channelsFor(g.id, channels).length;
      if (count) out.push({ id: g.id, label: g.name, kind: "custom", count });
    }
    for (const [cat, label] of CATEGORY_LABELS) {
      const count = channels.filter((c) => c.category === cat).length;
      if (count) out.push({ id: cat, label, kind: "category", count });
    }
    return out;
  }

  /** A profile's default, or all channels when that list has gone (a deleted custom guide). */
  resolveDefault(choice: string | undefined, channels: Channel[]): string {
    if (!choice) return "";
    return this.choices(channels).some((c) => c.id === choice) ? choice : "";
  }
}

function cleanName(name: string | undefined): string {
  return String(name ?? "").trim().slice(0, 40);
}

function cleanChannels(ids: string[] | undefined): string[] {
  if (ids !== undefined && !Array.isArray(ids)) throw badRequest("channels must be a list of channel ids");
  return [...new Set((ids ?? []).map(String))].slice(0, 2000);
}
