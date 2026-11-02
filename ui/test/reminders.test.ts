// The Reminders list (issue: reminders were write-only — you could set one in the guide and the
// only way to take it back was to find the programme again).
import { describe, expect, it } from "vitest";
import type { Reminder } from "@ultimatetv/shared";
import { reminderWhen, reminderIsDue, upcomingReminders } from "../src/reminders.js";

/** Local time, so the labels read the same in every time zone a test machine might be in. */
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();

const reminder = (id: string, title: string, start: number, end: number, channelName = "BBC One"): Reminder => ({
  id,
  channelId: `ch-${id}`,
  channelName,
  programme: {
    id,
    channelId: `ch-${id}`,
    start,
    end,
    title,
    categories: [],
    isNew: true,
    isRepeat: false,
    isFilm: false,
  },
});

const now = at(2, 20);

describe("upcomingReminders", () => {
  it("sorts what is still to come, earliest first, and drops what has finished", () => {
    const list = [
      reminder("c", "Late film", at(2, 23), at(3, 1)),
      reminder("a", "Soap", at(2, 20, 30), at(2, 21)),
      reminder("gone", "Yesterday's news", at(1, 20), at(1, 21)),
      reminder("b", "Quiz", at(2, 21), at(2, 22)),
    ];
    expect(upcomingReminders(list, now).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps a programme that is on right now, at the front", () => {
    const onNow = reminder("now", "The News", at(2, 19, 45), at(2, 20, 30));
    const later = reminder("later", "Quiz", at(2, 21), at(2, 22));
    expect(upcomingReminders([later, onNow], now).map((r) => r.id)).toEqual(["now", "later"]);
    expect(reminderIsDue(onNow, now)).toBe(true);
    expect(reminderIsDue(later, now)).toBe(false);
  });

  it("says when each one is on, in the household's words", () => {
    expect(reminderWhen(reminder("a", "Soap", at(2, 20, 30), at(2, 21)), now)).toBe("Today at 20:30");
    expect(reminderWhen(reminder("b", "Quiz", at(3, 21), at(3, 22)), now)).toBe("Tomorrow at 21:00");
    expect(reminderWhen(reminder("now", "The News", at(2, 19, 45), at(2, 20, 30)), now)).toBe("On now");
  });

  it("keeps one reminder per programme even if the list is repeated", () => {
    const one = reminder("a", "Soap", at(2, 20, 30), at(2, 21));
    expect(upcomingReminders([one, one], now)).toHaveLength(1);
  });
});
