import { describe, expect, it } from "vitest";
import { tvAppsCommands } from "../src/cec.js";
import { subtitleModeProps, subtitleProps } from "../src/player.js";

describe("TV apps over CEC", () => {
  it("steps down as the source, then presses the TV's Home key", () => {
    expect(tvAppsCommands("both", "1.0.0.0")).toEqual([
      ["--to", "0", "--inactive-source", "phys-addr=1.0.0.0"],
      ["--to", "0", "--user-control-pressed", "ui-cmd=root-menu"],
      ["--to", "0", "--user-control-released"],
    ]);
  });

  it("does just one of them when asked", () => {
    expect(tvAppsCommands("inactive", "2.0.0.0")).toEqual([["--to", "0", "--inactive-source", "phys-addr=2.0.0.0"]]);
    expect(tvAppsCommands("home", "2.0.0.0").map((c) => c[3])).toEqual(["ui-cmd=root-menu", undefined]);
  });

  it("can't step down without knowing its address, so presses Home", () => {
    expect(tvAppsCommands("inactive", null)).toEqual([]);
    expect(tvAppsCommands("both", null)).toHaveLength(2);
  });
});

describe("subtitles in mpv", () => {
  const props = (s: Parameters<typeof subtitleProps>[0]) => Object.fromEntries(subtitleProps(s));

  it("makes the text bigger, boxed, yellow or raised", () => {
    expect(props({ size: "large", background: "outline", colour: "white", position: "bottom" })).toMatchObject({ "sub-scale": 1.25, "sub-border-style": "outline-and-shadow", "sub-color": "#FFFFFFFF", "sub-pos": 100 });
    expect(props({ size: "huge", background: "box", colour: "yellow", position: "raised" })).toMatchObject({ "sub-scale": 1.55, "sub-border-style": "background-box", "sub-back-color": "#C0000000", "sub-color": "#FFFFE14D", "sub-pos": 90 });
  });

  it("turns subtitles on, off, or on only for other languages", () => {
    expect(subtitleModeProps("off")).toEqual([["sid", "no"]]);
    expect(Object.fromEntries(subtitleModeProps("on"))).toMatchObject({ sid: "auto", "subs-with-matching-audio": "yes" });
    expect(Object.fromEntries(subtitleModeProps("foreign"))).toMatchObject({ sid: "auto", "subs-with-matching-audio": "forced", "subs-fallback-forced": "yes" });
  });
});
