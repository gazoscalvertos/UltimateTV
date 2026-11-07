import { describe, expect, it } from "vitest";
import { tvOffAction, tvOnAction } from "../src/tvpower";

describe("TV turning off", () => {
  const film = { live: false, status: "playing" as const };
  it("pauses a film, stops live TV", () => {
    expect(tvOffAction("pause", film)).toBe("pause");
    expect(tvOffAction("pause", { live: true, status: "playing" })).toBe("stop");
    expect(tvOffAction("pause", { live: false, status: "paused" })).toBe("nothing");
  });
  it("stops, or carries on, as set", () => {
    expect(tvOffAction("stop", film)).toBe("stop");
    expect(tvOffAction(undefined, film)).toBe("stop");
    expect(tvOffAction("keep", film)).toBe("nothing");
    expect(tvOffAction("pause", null)).toBe("nothing");
  });
  it("goes back to the video when the TV comes on, unless a PIN is set", () => {
    expect(tvOnAction(true, false)).toBe("back-to-video");
    expect(tvOnAction(true, true)).toBe("start-afresh");
    expect(tvOnAction(false, false)).toBe("start-afresh");
  });
});
