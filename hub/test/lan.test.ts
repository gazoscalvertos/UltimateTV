import { describe, expect, it } from "vitest";
import { lanAddress, phoneReachable } from "../src/lan.js";

const iface = (address: string, internal = false) => ({ address, family: "IPv4" as const, internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null });

describe("lan", () => {
  it("prefers the wired address over Wi-Fi, and skips Docker and VPNs", () => {
    const interfaces = {
      lo: [iface("127.0.0.1", true)],
      docker0: [iface("172.17.0.1")],
      tailscale0: [iface("100.64.1.2")],
      wlan0: [iface("10.0.0.5")],
      enp3s0: [iface("192.168.0.70")],
    };
    expect(lanAddress(interfaces)).toBe("192.168.0.70");
    expect(lanAddress({ wlan0: interfaces.wlan0, docker0: interfaces.docker0 })).toBe("10.0.0.5");
    expect(lanAddress({ lo: interfaces.lo })).toBeUndefined();
  });

  it("swaps loopback hosts for the LAN address and leaves others alone", () => {
    expect(phoneReachable("http://127.0.0.1:8095", () => "192.168.0.70")).toBe("http://192.168.0.70:8095");
    expect(phoneReachable("http://localhost:8095", () => "192.168.0.70")).toBe("http://192.168.0.70:8095");
    expect(phoneReachable("http://192.168.0.19:8095", () => "192.168.0.70")).toBe("http://192.168.0.19:8095");
    expect(phoneReachable("http://127.0.0.1:8095", () => undefined)).toBe("http://127.0.0.1:8095");
  });
});
