import { describe, expect, it } from "vitest";
import { crc32mpeg, VideoOnly } from "../src/tsfilter.js";

/** One 188-byte packet carrying a PSI section (PAT or PMT) that starts in it. */
function psiPacket(pid: number, section: number[]): Buffer {
  const p = Buffer.alloc(188, 0xff);
  p[0] = 0x47;
  p[1] = 0x40 | ((pid >> 8) & 0x1f);
  p[2] = pid & 0xff;
  p[3] = 0x10;
  p[4] = 0; // pointer field
  const body = Buffer.from(section);
  body.copy(p, 5);
  p.writeUInt32BE(crc32mpeg(p, 5, 5 + body.length), 5 + body.length);
  return p;
}

/** A section: table id, then the rest; the length counts the CRC that psiPacket adds. */
function section(tableId: number, rest: number[]): number[] {
  const length = rest.length + 4;
  return [tableId, 0xb0 | ((length >> 8) & 0x0f), length & 0xff, ...rest];
}

const pat = () => psiPacket(0, section(0x00, [0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | 0x10, 0x00]));
// Programme 1: PCR on 0x100, H.264 on 0x100, AC-3 on 0x101 (with a descriptor), DVB subtitles on 0x102.
const pmt = () =>
  psiPacket(
    0x1000,
    section(0x02, [0x00, 0x01, 0xc1, 0x00, 0x00, 0xe1, 0x00, 0xf0, 0x00, 0x1b, 0xe1, 0x00, 0xf0, 0x00, 0x81, 0xe1, 0x01, 0xf0, 0x03, 0x0a, 0x01, 0x65, 0x06, 0xe1, 0x02, 0xf0, 0x00]),
  );

function pes(pid: number, fill: number): Buffer {
  const p = Buffer.alloc(188, fill);
  p[0] = 0x47;
  p[1] = 0x40 | ((pid >> 8) & 0x1f);
  p[2] = pid & 0xff;
  p[3] = 0x10;
  return p;
}

async function run(chunks: Buffer[]): Promise<Buffer> {
  const f = new VideoOnly();
  const out: Buffer[] = [];
  f.on("data", (d: Buffer) => out.push(d));
  const done = new Promise((r) => f.on("end", r));
  for (const c of chunks) f.write(c);
  f.end();
  await done;
  return Buffer.concat(out);
}

const pidOf = (p: Buffer) => ((p[1]! & 0x1f) << 8) | p[2]!;

describe("video-only transport stream (guide preview on a desktop)", () => {
  it("computes MPEG-2's CRC-32", () => {
    // The well-known check value for CRC-32/MPEG-2.
    expect(crc32mpeg(Buffer.from("123456789"))).toBe(0x0376e6e7);
  });

  it("keeps the picture, drops the sound and subtitles, and rewrites the programme map", async () => {
    const input = Buffer.concat([pat(), pmt(), pes(0x100, 0xaa), pes(0x101, 0xbb), pes(0x102, 0xcc), pes(0x100, 0xdd)]);
    // Any chunking: split part-way through packets.
    const out = await run([input.subarray(0, 100), input.subarray(100, 500), input.subarray(500)]);
    expect(out.length % 188).toBe(0);
    const packets = Array.from({ length: out.length / 188 }, (_, i) => out.subarray(i * 188, i * 188 + 188));
    expect(packets.map(pidOf)).toEqual([0, 0x1000, 0x100, 0x100]);
    const map = packets[1]!;
    const t = 5;
    const length = ((map[t + 1]! & 0x0f) << 8) | map[t + 2]!;
    // Header (9 bytes after the length) + one 5-byte video entry + CRC.
    expect(length).toBe(9 + 5 + 4);
    expect(map[t + 12]).toBe(0x1b);
    expect(crc32mpeg(map, t, t + 3 + length - 4)).toBe(map.readUInt32BE(t + 3 + length - 4));
    expect(packets[2]![4]).toBe(0xaa);
    expect(packets[3]![4]).toBe(0xdd);
  });

  it("finds its place when it starts part-way through a packet", async () => {
    const input = Buffer.concat([Buffer.from([1, 2, 3]), pat(), pmt(), pes(0x101, 0xbb), pes(0x100, 0xaa)]);
    const out = await run([input]);
    expect(out.length).toBe(3 * 188);
    expect(pidOf(out.subarray(376))).toBe(0x100);
  });
});
