import { describe, expect, it } from "vitest";
import { physAddrFromEdid, powerFrom, powerFromReply, setupArgs, tvPowerOn } from "../src/cec.js";

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

describe("TV power", () => {
  it("reads every pwr-state cec-ctl prints", () => {
    expect(tvPowerOn("on (0x00)")).toBe(true);
    expect(tvPowerOn("standby (0x01)")).toBe(false);
    expect(tvPowerOn("in transition standby to on (0x02)")).toBe(true);
    expect(tvPowerOn("in transition on to standby (0x03)")).toBe(false);
    expect(tvPowerOn("standby")).toBe(false);
    expect(tvPowerOn("something else")).toBeNull();
  });

  it("finds the TV's answer to a power status request", () => {
    const reply = [
      "Transmit from Playback Device 1 to TV (4 to 0):",
      "GIVE_DEVICE_POWER_STATUS (0x8f)",
      "\tSequence: 12 Tx Timestamp: 1234.567s",
      "\tReceived from TV (0 to 4): REPORT_POWER_STATUS (0x90):",
      "\t\tpwr-state: standby (0x01)",
    ].join("\n");
    expect(powerFromReply(reply)).toBe(false);
    expect(powerFromReply(reply.replace("standby (0x01)", "on (0x00)"))).toBe(true);
    expect(powerFromReply("Transmit from Playback Device 1 to TV (4 to 0):\n\tTx, Not Acknowledged (4), Max Retries")).toBeNull();
  });

  it("only takes a power report as the TV going off", () => {
    expect(powerFrom({ opcode: "REPORT_POWER_STATUS", from: "TV", status: "standby (0x01)" }, "1.0.0.0")).toBe(false);
    expect(powerFrom({ opcode: "REPORT_POWER_STATUS", from: "TV", status: "in transition standby to on (0x02)" }, "1.0.0.0")).toBeNull();
    expect(powerFrom({ opcode: "REPORT_POWER_STATUS", from: "TV", status: "on (0x00)" }, "1.0.0.0")).toBeNull();
  });
});
