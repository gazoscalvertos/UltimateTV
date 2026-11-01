// Features switched off per paired client (issue #124). Kept in the Hub's database under
// "client-features", keyed by paired-device id, so they survive restarts and app updates and go
// into the nightly backup with everything else. A device with no entry has everything on.
//
//   GET /api/features?client=box|desktop|browser|android|remote   this device's list
//   GET /api/features/devices                                     every paired device's list
//   PUT /api/features/:id { off: [...] }                          change one (settings PIN)

import { cleanFeatureList, isClientKind, remoteFeatures, type ClientKind, type DeviceFeatures, type FeatureId, type PairedDevice } from "@ultimatetv/shared";
import type { Db } from "./db.js";

const KV = "client-features";

interface Entry {
  off: FeatureId[];
  client?: ClientKind;
}

export class ClientFeatures {
  constructor(
    private readonly db: Db,
    private readonly onChange: (device: string) => void = () => undefined,
  ) {}

  private load(): Record<string, Entry> {
    return this.db.getKv<Record<string, Entry>>(KV) ?? {};
  }

  private save(all: Record<string, Entry>): void {
    this.db.setKv(KV, all);
  }

  off(id: string): FeatureId[] {
    return cleanFeatureList(this.load()[id]?.off);
  }

  client(id: string): ClientKind | null {
    const c = this.load()[id]?.client;
    return isClientKind(c) ? c : null;
  }

  set(id: string, raw: unknown): FeatureId[] {
    const all = this.load();
    const off = cleanFeatureList(raw);
    all[id] = { ...all[id], off };
    this.save(all);
    this.onChange(id);
    return off;
  }

  /** Remembers what app a device runs, so the Hub page offers the right switches. */
  noteClient(id: string, raw: unknown): void {
    if (!isClientKind(raw)) return;
    const all = this.load();
    if (all[id]?.client === raw) return;
    all[id] = { off: all[id]?.off ?? [], client: raw };
    this.save(all);
  }

  forget(id: string): void {
    const all = this.load();
    if (!(id in all)) return;
    delete all[id];
    this.save(all);
  }

  /**
   * What the phone remote hides: what's off on every TV it controls. Phone commands go to the
   * TV box (the desktop app ignores them), so desktops are left out unless there's nothing else.
   */
  forRemote(devices: PairedDevice[]): FeatureId[] {
    const tvs = devices.filter((d) => d.kind === "tv");
    const boxes = tvs.filter((d) => this.client(d.id) !== "desktop");
    return remoteFeatures((boxes.length ? boxes : tvs).map((d) => this.off(d.id)));
  }

  list(devices: PairedDevice[]): DeviceFeatures[] {
    return devices.map((d) => ({ id: d.id, name: d.name, kind: d.kind, client: this.client(d.id), off: this.off(d.id) }));
  }
}
