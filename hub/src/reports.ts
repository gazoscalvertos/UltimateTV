import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProbeReport } from "@ultimatetv/shared";

export interface ReportSummary {
  id: string;
  createdAt: string;
  label?: string;
  chromiumVersion: string | null;
}

const ID_PATTERN = /^[0-9TZ-]+(?:-[a-z0-9]{4})?$/;

/** Probe reports stored as one JSON file each, so they are easy to copy off the server and diff. */
export class ReportStore {
  constructor(private readonly dir: string) {}

  async save(report: ProbeReport): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = `${stamp}-${Math.random().toString(36).slice(2, 6).padEnd(4, "0")}`;
    await writeFile(this.file(id), JSON.stringify(report, null, 2));
    return id;
  }

  async get(id: string): Promise<ProbeReport | null> {
    if (!ID_PATTERN.test(id)) return null;
    try {
      return JSON.parse(await readFile(this.file(id), "utf8")) as ProbeReport;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async list(): Promise<ReportSummary[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).sort().reverse();
    const summaries: ReportSummary[] = [];
    for (const id of ids) {
      const report = await this.get(id);
      if (!report) continue;
      summaries.push({ id, createdAt: report.createdAt, label: report.label, chromiumVersion: report.device.chromiumVersion });
    }
    return summaries;
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }
}
