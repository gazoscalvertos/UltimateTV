import { describe, expect, it } from "vitest";
import { physAddrFromEdid, setupArgs } from "../src/cec.js";

/** A two-block EDID whose CTA extension holds an audio block and then the HDMI vendor block. */
function edid(vsdb: number[]): Uint8Array {
  const e = new Uint8Array(256);
  e.set([0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00]);
  const blocks = [0x23, 0x09, 0x07, 0x07, ...vsdb];
  e.set([0x02, 0x03, 4 + blocks.length, 0x00, ...blocks], 128);
  return e;
}

describe("CEC setup", () => {
  it("reads the HDMI address the TV gave this input from its EDID", () => {
    expect(physAddrFromEdid(edid([0x65, 0x03, 0x0c, 0x00, 0x20, 0x00]))).toBe("2.0.0.0");
    expect(physAddrFromEdid(edid([0x65, 0x03, 0x0c, 0x00, 0x13, 0x00]))).toBe("1.3.0.0");
  });

  it("gives up on an EDID without the HDMI block", () => {
    expect(physAddrFromEdid(edid([]))).toBeNull();
    expect(physAddrFromEdid(new Uint8Array(128))).toBeNull();
  });

  it("tells the adapter its address before registering as a playback device", () => {
    expect(setupArgs("/dev/cec0", "3.0.0.0")).toEqual(["-d", "/dev/cec0", "--phys-addr", "3.0.0.0", "--playback", "--osd-name", "UltimateTV"]);
    expect(setupArgs("/dev/cec0", null)).toEqual(["-d", "/dev/cec0", "--playback", "--osd-name", "UltimateTV"]);
  });
});
