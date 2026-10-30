// What's new: CHANGELOG.md read into releases and entries the apps can list. The Hub parses the
// file it was built with and serves it at /api/changelog; each app remembers the newest entry it
// has shown and pops up the ones after it once an update lands.

export interface ChangeEntry {
  /** Stable while the date and title stay the same: "2026-10-30/weather". */
  id: string;
  title: string;
  /** The rest of the bullet as plain text (no Markdown). May be empty. */
  text: string;
  /** The pull requests it came from. */
  prs: number[];
  /** The guide in docs/ it links to, if any. */
  doc?: string;
}

export interface ChangeRelease {
  /** "2026-10-30" or "0.2.0". */
  id: string;
  /** ISO date (YYYY-MM-DD) when the heading has one. */
  date?: string;
  version?: string;
  /** A line under the heading before its bullets ("The first install on the real box."). */
  note?: string;
  entries: ChangeEntry[];
}

export interface Changelog {
  releases: ChangeRelease[];
  /** The newest entry's id: what an app stores once it has shown the pop-up. */
  latest?: string;
  /** With /api/changelog?seen=<id>: the entries after that one (see unseenChanges). */
  unseen?: ChangeEntry[];
  /** The commit the Hub was built from. */
  commit?: string;
}

const DATE = /^(\d{4}-\d{2}-\d{2})$/;
const VERSION = /^v?(\d+\.\d+\.\d+)(?:\s*\((\d{4}-\d{2}-\d{2})\))?$/;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");

/** Markdown to plain text: links keep their words, bold and code lose their marks. */
export function plainText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseEntry(raw: string, releaseId: string): Omit<ChangeEntry, "id"> & { key: string } {
  let body = raw.replace(/\s+/g, " ").trim();
  const prs: number[] = [];
  const refs = /\s*\((#\d+(?:\s*,\s*#\d+)*)\)\s*\.?$/.exec(body);
  if (refs) {
    for (const n of refs[1]!.matchAll(/#(\d+)/g)) prs.push(Number(n[1]));
    body = body.slice(0, refs.index).trim();
  }
  let title: string;
  let doc: string | undefined;
  const bold = /^\*\*(.+?)\*\*\s*/.exec(body);
  if (bold) {
    title = bold[1]!.replace(/[.:]$/, "");
    body = body.slice(bold[0].length);
    // "**Title** ([docs/x.md](docs/x.md)):" or "**Title** (`/api/x`, [docs/x.md](docs/x.md)):"
    const paren = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*/.exec(body);
    if (paren && /\]\(|`/.test(paren[1]!)) {
      doc = /\]\((docs\/[^)#\s]+)/.exec(paren[1]!)?.[1];
      body = body.slice(paren[0].length);
    }
    body = body.replace(/^[:.]\s*/, "");
  } else {
    const plain = plainText(body);
    const lead = /^([^:.]{3,60}): (.*)$/.exec(plain);
    if (lead) {
      title = lead[1]!;
      body = lead[2]!;
    } else if (plain.length <= 90) {
      title = plain.replace(/\.$/, "");
      body = "";
    } else {
      const sentence = /^(.{10,90}?[.!?])\s/.exec(plain);
      title = sentence ? sentence[1]!.replace(/\.$/, "") : `${plain.slice(0, 80).replace(/\s+\S*$/, "")}…`;
      body = sentence ? plain.slice(sentence[0].length) : plain;
    }
  }
  title = plainText(title);
  let text = plainText(body);
  if (text) text = text[0]!.toUpperCase() + text.slice(1);
  return { key: `${releaseId}/${slug(title) || "change"}`, title, text, prs, ...(doc ? { doc } : {}) };
}

/** Reads CHANGELOG.md. Only `## date` and `## version` sections count; the newest comes first in the file. */
export function parseChangelog(md: string): Changelog {
  const releases: ChangeRelease[] = [];
  let release: ChangeRelease | undefined;
  let bullet: string[] | undefined;
  const seen = new Set<string>();
  const flush = () => {
    if (!release || !bullet) return;
    const { key, ...entry } = parseEntry(bullet.join(" "), release.id);
    let id = key;
    for (let n = 2; seen.has(id); n++) id = `${key}-${n}`;
    seen.add(id);
    release.entries.push({ id, ...entry });
    bullet = undefined;
  };
  for (const line of md.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading || /^#\s/.test(line)) {
      flush();
      release = undefined;
      if (!heading) continue;
      const h = heading[1]!.replace(/\s+[—–-]\s+.*$/, "");
      const d = DATE.exec(h);
      const v = VERSION.exec(h);
      if (d) release = { id: d[1]!, date: d[1]!, entries: [] };
      else if (v) release = { id: v[1]!, version: v[1]!, ...(v[2] ? { date: v[2] } : {}), entries: [] };
      if (release) releases.push(release);
      continue;
    }
    if (!release) continue;
    if (/^[-*]\s+/.test(line)) {
      flush();
      bullet = [line.replace(/^[-*]\s+/, "")];
    } else if (bullet && /^\s+\S/.test(line)) bullet.push(line.trim());
    else if (!line.trim()) continue;
    else {
      flush();
      if (!release.entries.length) release.note = [release.note, plainText(line)].filter(Boolean).join(" ");
    }
  }
  flush();
  const latest = releases.find((r) => r.entries.length)?.entries[0]?.id;
  return { releases, ...(latest ? { latest } : {}) };
}

/**
 * What to show after an update: the entries newer than `seen` (the id stored last time), newest
 * first. With nothing stored yet, the newest day's entries. If `seen` is no longer in the file (its
 * title was reworded), whatever is in sections dated after it.
 */
export function unseenChanges(log: Changelog, seen: string | null | undefined): ChangeEntry[] {
  const all = log.releases.flatMap((r) => r.entries.map((e) => ({ e, r })));
  if (!all.length) return [];
  if (!seen) return log.releases.find((r) => r.entries.length)!.entries;
  const at = all.findIndex((x) => x.e.id === seen);
  if (at >= 0) return all.slice(0, at).map((x) => x.e);
  const seenDate = /^(\d{4}-\d{2}-\d{2})\//.exec(seen)?.[1];
  if (!seenDate) return [];
  return all.filter((x) => x.r.date && x.r.date > seenDate).map((x) => x.e);
}

/** "30 Oct 2026", or the version when a section has no date. */
export function releaseLabel(r: ChangeRelease): string {
  const when = r.date ? new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  return r.version ? (when ? `${r.version} · ${when}` : r.version) : when;
}
