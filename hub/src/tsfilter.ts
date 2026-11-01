// MPEG-TS with only the picture: what the desktop app's guide preview plays in the page (issue
// #131, ui/src/components/LivePreview.tsx). A browser can't decode some channels' sound (AC-3,
// MPEG audio in some cases), and one track it can't play stops the whole stream, so the sound,
// subtitles and teletext come out here; mpv plays the sound anyway. No ffmpeg: packets are dropped
// by PID and the programme map is rewritten to list only the video, which costs next to nothing.

import { Transform, type TransformCallback } from "node:stream";

const PACKET = 188;
const SYNC = 0x47;

/** Stream types that are video: MPEG-1/2, MPEG-4 part 2, H.264, H.265, AVS and friends. */
const VIDEO_TYPES = new Set([0x01, 0x02, 0x10, 0x1b, 0x20, 0x24, 0x42, 0xd1, 0xea]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

/** The CRC that ends every PSI section (MPEG-2's CRC-32: not reflected, no final XOR). */
export function crc32mpeg(data: Uint8Array, start = 0, end = data.length): number {
  let crc = 0xffffffff;
  for (let i = start; i < end; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]!) & 0xff]!) >>> 0;
  return crc >>> 0;
}

const pidOf = (p: Uint8Array, o: number) => ((p[o + 1]! & 0x1f) << 8) | p[o + 2]!;

/** Where a packet's payload starts, or -1 if it has none. */
function payloadStart(p: Uint8Array, o: number): number {
  const afc = (p[o + 3]! >> 4) & 0x3;
  if (afc === 0 || afc === 2) return -1;
  const start = afc === 3 ? o + 5 + p[o + 4]! : o + 4;
  return start < o + PACKET ? start : -1;
}

/**
 * Keeps the video of a transport stream and drops everything else. Also exported for tests: feed
 * it packets (any chunking) and it passes on whole packets.
 */
export class VideoOnly extends Transform {
  private rest: Buffer = Buffer.alloc(0);
  private pmtPids = new Set<number>();
  private dropped = new Set<number>();

  override _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    const buf = this.rest.length ? Buffer.concat([this.rest, chunk]) : chunk;
    // Find the sync byte if the stream starts part-way through a packet.
    let o = 0;
    while (o < buf.length && buf[o] !== SYNC) o++;
    const out: Buffer[] = [];
    for (; o + PACKET <= buf.length; o += PACKET) {
      if (buf[o] !== SYNC) {
        // Lost sync: look for the next packet start.
        let n = o + 1;
        while (n < buf.length && buf[n] !== SYNC) n++;
        o = n - PACKET;
        continue;
      }
      const pid = pidOf(buf, o);
      if (pid === 0) this.readPat(buf, o);
      if (this.pmtPids.has(pid)) {
        out.push(this.rewritePmt(buf.subarray(o, o + PACKET)));
        continue;
      }
      if (this.dropped.has(pid)) continue;
      out.push(buf.subarray(o, o + PACKET));
    }
    this.rest = Buffer.from(buf.subarray(o));
    if (out.length) this.push(Buffer.concat(out));
    done();
  }

  private readPat(p: Buffer, o: number): void {
    if (!(p[o + 1]! & 0x40)) return;
    const s = payloadStart(p, o);
    if (s < 0) return;
    const t = s + 1 + p[s]!;
    if (t + 8 > o + PACKET || p[t] !== 0x00) return;
    const length = ((p[t + 1]! & 0x0f) << 8) | p[t + 2]!;
    const end = Math.min(t + 3 + length - 4, o + PACKET);
    for (let i = t + 8; i + 4 <= end; i += 4) {
      const program = (p[i]! << 8) | p[i + 1]!;
      if (program !== 0) this.pmtPids.add(((p[i + 2]! & 0x1f) << 8) | p[i + 3]!);
    }
  }

  /** The programme map with only its video streams; their PIDs are remembered for dropping. */
  private rewritePmt(packet: Buffer): Buffer {
    const p = Buffer.from(packet);
    // Only a section that starts and ends in this packet (nearly always so) is rewritten.
    if (!(p[1]! & 0x40)) return p;
    const s = payloadStart(p, 0);
    if (s < 0) return p;
    const t = s + 1 + p[s]!;
    if (t + 12 > PACKET || p[t] !== 0x02) return p;
    const length = ((p[t + 1]! & 0x0f) << 8) | p[t + 2]!;
    const end = t + 3 + length;
    if (end > PACKET) return p;
    const infoLength = ((p[t + 10]! & 0x0f) << 8) | p[t + 11]!;
    const esStart = t + 12 + infoLength;
    const kept: Buffer[] = [];
    for (let i = esStart; i + 5 <= end - 4; ) {
      const type = p[i]!;
      const pid = ((p[i + 1]! & 0x1f) << 8) | p[i + 2]!;
      const esInfo = ((p[i + 3]! & 0x0f) << 8) | p[i + 4]!;
      const entry = p.subarray(i, i + 5 + esInfo);
      if (VIDEO_TYPES.has(type)) kept.push(Buffer.from(entry));
      else this.dropped.add(pid);
      i += 5 + esInfo;
    }
    const body = Buffer.concat([p.subarray(t + 3, esStart), ...kept]);
    const newLength = body.length + 4;
    p[t + 1] = (p[t + 1]! & 0xf0) | ((newLength >> 8) & 0x0f);
    p[t + 2] = newLength & 0xff;
    body.copy(p, t + 3);
    const crcAt = t + 3 + body.length;
    p.writeUInt32BE(crc32mpeg(p, t, crcAt), crcAt);
    p.fill(0xff, crcAt + 4);
    return p;
  }
}
