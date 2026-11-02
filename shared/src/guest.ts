// What a Guest profile may use (issue #101). A Guest is for visitors and babysitters: rated up to
// a limit of its own, its own pick of the sections, and no settings, recordings or downloads at
// all. The Hub enforces this on its routes; the TV hides what it can't reach.

import type { Profile } from "./domain.js";
import { cleanFeatureList, type FeatureId } from "./features.js";

/**
 * The sections a Guest gets when it hasn't been given any of its own. Settings are not a section:
 * no Guest has them. Recordings and downloads are never in here either, whatever else is allowed.
 */
export const GUEST_SECTIONS: FeatureId[] = ["live", "films", "shows", "music", "search", "cast", "weather", "mix", "clips"];

/** The sections a Guest can never have. */
export const GUEST_NEVER: FeatureId[] = ["recordings", "downloads"];

/** A Guest's sections: its own list, cleaned, if it has one; otherwise the usual ones. */
export function guestSections(profile: Pick<Profile, "guestFeatures"> | null | undefined): FeatureId[] {
  const asked = cleanFeatureList(profile?.guestFeatures).filter((id) => !GUEST_NEVER.includes(id));
  return asked.length ? asked : [...GUEST_SECTIONS];
}

/** Whether this Guest may use that section. */
export function guestAllows(profile: Pick<Profile, "guestFeatures"> | null | undefined, section: FeatureId): boolean {
  return guestSections(profile).includes(section);
}

/** Whether this profile is a Guest at all. */
export function isGuestProfile(profile: Pick<Profile, "kind"> | null | undefined): boolean {
  return profile?.kind === "guest";
}
