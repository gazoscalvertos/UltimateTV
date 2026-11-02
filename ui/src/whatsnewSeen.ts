// What's new is remembered for each profile, so everyone in the house gets the pop-up once after an
// update rather than only whoever turned the TV on first (issue #111).

/** What it used to be: one record for the whole TV, before profiles had their own. */
export const LEGACY_SEEN_KEY = "utv-changelog-seen";

/** Where a profile's newest shown change is kept. */
export function seenKey(profileId: string): string {
  return `${LEGACY_SEEN_KEY}:${profileId}`;
}

/** The least localStorage needs: the same shape, so a test can stand in for it. */
export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The newest change this profile was shown, or null when it has never looked. */
export function readSeen(storage: Storage, profileId: string): string | null {
  try {
    const own = storage.getItem(seenKey(profileId));
    if (own) return own;
    // A TV that was last used before profiles had their own record: the household has seen that
    // much, so the first profile to ask carries it over and the rest still get the pop-up.
    const legacy = storage.getItem(LEGACY_SEEN_KEY);
    if (!legacy) return null;
    storage.setItem(seenKey(profileId), legacy);
    return legacy;
  } catch {
    return null;
  }
}

/** Remembers it for this profile. No storage means it shows again, which is harmless. */
export function writeSeen(storage: Storage, profileId: string, changeId: string): void {
  try {
    storage.setItem(seenKey(profileId), changeId);
  } catch {
    // Nothing to remember it with.
  }
}
