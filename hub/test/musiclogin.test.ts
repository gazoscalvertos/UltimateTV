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
});
