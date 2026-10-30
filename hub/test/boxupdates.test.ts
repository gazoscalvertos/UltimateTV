// The alert the Hub raises when the box's update goes wrong (tools/box/healthcheck.sh, rollback.sh).

import { describe, expect, it } from "vitest";
import { boxUpdateAlert } from "../src/alerts.js";

const OLD = "1111111111111111111111111111111111111111";
const NEW = "2222222222222222222222222222222222222222";

describe("the Hub's alert about the box's updates", () => {
  const rollback = { at: "2026-11-02T04:11:00Z", reason: "After the update mpv couldn't play a test clip", from: NEW, to: OLD, how: "snapshot" as const, manual: false, ok: true };

  it("tells someone about an automatic roll back, but not one asked for", () => {
    expect(boxUpdateAlert({ updating: false, rollback })).toMatchObject({ id: "rollback:2026-11-02T04:11:00Z", alert: { key: "box-update", level: "warn" } });
    expect(boxUpdateAlert({ updating: false, rollback: { ...rollback, manual: true } })).toBeNull();
    expect(boxUpdateAlert({ updating: false, rollback: { ...rollback, ok: false } })?.alert.level).toBe("bad");
    expect(boxUpdateAlert({ updating: false })).toBeNull();
  });

  it("tells someone about a failed check left in place (AUTO_ROLLBACK=0)", () => {
    const a = boxUpdateAlert({ updating: false, canRollBack: true, health: { status: "failed", at: "2026-11-09T04:10:00Z", summary: "After the update the CEC adapter has gone" }, rollback });
    expect(a).toMatchObject({ id: "health:2026-11-09T04:10:00Z", alert: { level: "bad", title: "The box's update failed its check" } });
  });
});
