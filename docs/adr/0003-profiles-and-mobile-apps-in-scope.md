# ADR 0003: Profiles and mobile apps are in scope

- Status: accepted (2026-11-01)
- Decider: Gary

## Context

[PLAN.md](../PLAN.md) (draft v5, 2026-10-24) put three things out of scope for v1: multi-user profiles with parental PINs, mobile apps, and casting. That was written before the box was built and before there was a family to share the TV with.

All three then turned out to be wanted, and were built alongside the features they support:

- **Profiles**, because the TV is watched by adults and children, and the Kids profile is how the app keeps children to their channels, films up to PG, their own TV time and bedtime, and nothing in Settings ([profiles.md](../profiles.md)).
- **Mobile apps**, because a phone is the remote that is always in reach, and because a phone or tablet is the screen in the other room. There are two apps: the remote (`android/app`) and a watching client that plays live TV, catch-up, recordings and downloads on the home Wi-Fi ([android-client.md](../android-client.md)).
- **Casting**, because a laptop, a phone and a link are how things get onto the TV from outside the app ([casting-and-games.md](../casting-and-games.md)).

The word "mobile apps" in the original plan meant a companion remote in Phase 4. That one app became two, and the watching client is a bigger change: it is a second client of the Hub, with its own pairing, its own profile and its own rule about not taking the TV's IPTV connection.

## Decision

- Profiles with optional PINs, a locked-down Kids profile and per-profile favourites stay part of the product, not a later version. The Hub enforces what a profile may see and change.
- Both Android apps stay: the phone remote and the watching client. The Hub serves them at `/api/remote/app.apk` and `/api/client/app.apk`.
- Casting stays: AirPlay and screen share on the box, phone links and photos, and games.
- PLAN.md is kept as the historical design record and is marked as such. [FEATURES.md](../FEATURES.md), [ARCHITECTURE.md](../ARCHITECTURE.md) and [ROADMAP.md](../ROADMAP.md) describe the app as it is now.

## Consequences

- The Hub carries more than the TV app: profile checks run on the server, so the phone, the Android client and the TV all follow the same rules.
- There are two APKs to build, sign and publish, and CI builds both ([ci.yml](../../.github/workflows/ci.yml)).
- The "out of scope" line in PLAN.md is wrong on purpose and stays there, because PLAN.md is a record of what was decided in October 2026, not a description of the app today.
