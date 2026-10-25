// A machine's health for the phone's Stats page: CPU, GPU clock, memory, temperatures, disks and
// network. The box and the Hub (inside its container) both use it. Node only, so it's imported as
// "@ultimatetv/shared/host" and never reaches the TV app's bundle. Every probe tolerates a missing file.

import { readdir, readFile, statfs } from "node:fs/promises";
import os from "node:os";
import type { HostStats } from "./domain.js";

const read = (file: string) => readFile(file, "utf8").then((s) => s.trim(), () => null);
const num = async (file: string) => {
  const v = Number(await read(file));
  return Number.isFinite(v) && v > 0 ? v : undefined;
};

function cpuTimes(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/** Usage and network rates are measured since the previous call (the first call waits a moment). */
export class HostMonitor {
  private lastCpu = cpuTimes();
  private lastNet = new Map<string, { rx: number; tx: number; at: number }>();
  private calls = 0;

  constructor(private readonly root = "/sys") {}

  async stats(disks: { label: string; path: string }[]): Promise<HostStats> {
    if (this.calls++ === 0) {
      await this.netRates();
      await new Promise((r) => setTimeout(r, 300));
    }
    const cpus = os.cpus();
    const now = cpuTimes();
    const dTotal = now.total - this.lastCpu.total;
    const usagePct = dTotal > 0 ? Math.round(100 * (1 - (now.idle - this.lastCpu.idle) / dTotal)) : undefined;
    this.lastCpu = now;

    const meminfo = (await read("/proc/meminfo")) ?? "";
    const memKb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(meminfo)?.[1]);
    const availableKb = memKb("MemAvailable");

    const stats: HostStats = {
      hostname: os.hostname(),
      kernel: os.release(),
      uptimeS: Math.round(os.uptime()),
      load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      cpu: { model: cpus[0]?.model.replace(/\s+/g, " ").trim() ?? "unknown", cores: cpus.length, ...(usagePct !== undefined ? { usagePct } : {}) },
      memory: { totalMb: Math.round(os.totalmem() / 2 ** 20), availableMb: Math.round(Number.isFinite(availableKb) ? availableKb / 1024 : os.freemem() / 2 ** 20) },
      temperatures: await this.temperatures(),
      disks: await this.disks(disks),
      network: await this.netRates(),
    };
    const gpu = await this.gpu();
    if (gpu) stats.gpu = gpu;
    return stats;
  }

  private async gpu(): Promise<HostStats["gpu"] | undefined> {
    const drm = `${this.root}/class/drm`;
    for (const card of (await readdir(drm).catch(() => [] as string[])).filter((c) => /^card\d+$/.test(c))) {
      const dir = `${drm}/${card}`;
      const vendor = await read(`${dir}/device/vendor`);
      if (!vendor) continue;
      const name = vendor === "0x8086" ? "Intel graphics" : vendor === "0x1002" ? "AMD graphics" : vendor === "0x10de" ? "NVIDIA graphics" : `GPU ${vendor}`;
      // i915 puts the clocks on the card; the newer xe driver under its tile.
      const cur = (await num(`${dir}/gt_cur_freq_mhz`)) ?? (await num(`${dir}/device/tile0/gt0/freq0/act_freq`));
      const max = (await num(`${dir}/gt_max_freq_mhz`)) ?? (await num(`${dir}/device/tile0/gt0/freq0/max_freq`));
      return { name, ...(cur ? { freqMhz: cur } : {}), ...(max ? { maxFreqMhz: max } : {}) };
    }
    return undefined;
  }

  private async temperatures(): Promise<HostStats["temperatures"]> {
    const dir = `${this.root}/class/thermal`;
    const out: HostStats["temperatures"] = [];
    for (const zone of (await readdir(dir).catch(() => [] as string[])).filter((z) => z.startsWith("thermal_zone"))) {
      const [type, milli] = await Promise.all([read(`${dir}/${zone}/type`), num(`${dir}/${zone}/temp`)]);
      if (type && milli && !out.some((t) => t.name === type)) out.push({ name: type, celsius: Math.round(milli / 1000) });
    }
    return out.slice(0, 8);
  }

  private async disks(list: { label: string; path: string }[]): Promise<HostStats["disks"]> {
    const out: HostStats["disks"] = [];
    for (const d of list) {
      const fs = await statfs(d.path).catch(() => null);
      if (!fs) continue;
      const gb = (blocks: number) => Math.round((blocks * fs.bsize) / 1e9);
      out.push({ ...d, totalGb: gb(fs.blocks), freeGb: gb(fs.bavail) });
    }
    return out;
  }

  private async netRates(): Promise<HostStats["network"]> {
    const out: HostStats["network"] = [];
    const now = Date.now();
    for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
      const v4 = addrs?.find((a) => a.family === "IPv4" && !a.internal);
      if (!v4 || /^(docker|br-|veth|virbr)/.test(name)) continue;
      const entry: HostStats["network"][number] = { name, address: v4.address };
      const speed = await num(`${this.root}/class/net/${name}/speed`);
      if (speed) entry.speedMbps = speed;
      const rx = Number(await read(`${this.root}/class/net/${name}/statistics/rx_bytes`));
      const tx = Number(await read(`${this.root}/class/net/${name}/statistics/tx_bytes`));
      const last = this.lastNet.get(name);
      if (last && Number.isFinite(rx) && now > last.at) {
        const secs = (now - last.at) / 1000;
        entry.rxKbps = Math.max(0, Math.round(((rx - last.rx) * 8) / 1000 / secs));
        entry.txKbps = Math.max(0, Math.round(((tx - last.tx) * 8) / 1000 / secs));
      }
      if (Number.isFinite(rx)) this.lastNet.set(name, { rx, tx, at: now });
      out.push(entry);
    }
    return out;
  }
}
