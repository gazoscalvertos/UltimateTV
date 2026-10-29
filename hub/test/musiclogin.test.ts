import { describe, expect, it } from "vitest";
import { MusicLogins } from "../src/musiclogin.js";

describe("music logins from the phone", () => {
  it("hands a login over once", () => {
    const logins = new MusicLogins();
    const id = logins.add({ email: "gary@example.com", password: "secret" }, 0);
    expect(logins.take(id, 1000)).toEqual({ email: "gary@example.com", password: "secret" });
    expect(logins.take(id, 1000)).toBeNull();
  });

  it("forgets a login after two minutes", () => {
    const logins = new MusicLogins();
    const id = logins.add({ email: "a@b.c", password: "x" }, 0);
    expect(logins.take(id, 121_000)).toBeNull();
  });

  it("tells the phone how the login went", () => {
    const logins = new MusicLogins();
    const id = logins.add({ email: "a@b.c", password: "x" }, 0);
    expect(logins.status(id, 10)).toEqual({ state: "waiting" });
    logins.take(id, 20);
    expect(logins.status(id, 30)).toEqual({ state: "working" });
    expect(logins.report(id, { result: "rejected", message: "Wrong password" }, 40)).toBe(true);
    expect(logins.status(id, 50)).toEqual({ state: "done", result: "rejected", message: "Wrong password" });
    expect(logins.report("nope", { result: "signed-in" })).toBe(false);
    expect(logins.status("nope")).toEqual({ state: "gone" });
  });

  it("gives up on a login the TV never fetched", () => {
    const logins = new MusicLogins();
    const id = logins.add({ email: "a@b.c", password: "x" }, 0);
    expect(logins.status(id, 121_000)).toEqual({ state: "gone" });
  });
});
