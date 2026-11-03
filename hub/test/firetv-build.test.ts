// The Android build for a Fire TV or Fire stick (#183). A stick runs Fire OS, which has no Google
// Play services, so the app that worked on a phone crashed at launch there: the Play services
// barcode scanner the phone uses puts components in the merged manifest that the system starts
// before any of our code runs, and on a Fire TV those classes don't exist. So there are two builds
// from one source tree, and the Fire TV one must not carry the scanner at all.
//
// This reads the build files rather than building the APK: the APK needs the Android SDK, and what
// actually goes wrong here (a dependency back in the wrong place, a launcher entry removed, the
// banner deleted) is visible in the files. Building both flavours is what CI does.
//
// What it can't cover: that Fire OS installs the APK, and that the remote's keys arrive. Those need
// a Fire stick.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const gradle = () => read("android/client/build.gradle");
const manifest = () => read("android/client/src/firetv/AndroidManifest.xml");

describe("the Fire TV build", () => {
  it("is a build of its own, beside the phone one, from the same source", () => {
    const g = gradle();
    expect(g, "no store flavours, so there is only one APK").toContain('flavorDimensions "store"');
    expect(g, "the phone build is gone").toMatch(/google\s*\{/);
    // The phone build stays the default: a `gradle :client:assembleDebug` with no flavour named
    // must keep building what it built before, or every existing instruction in the docs breaks.
    expect(g, "the google flavour is not the default").toMatch(/google\s*\{[^}]*isDefault true/);
    expect(g, "the Fire TV build is gone").toMatch(/firetv\s*\{/);
    // Both share an application id, so installing one replaces the other: a stick and a phone may
    // not both be told to install "tv.ultimate.client" and fight over it.
    expect(g.match(/applicationId/g)?.length ?? 0, "a second applicationId would make two apps").toBe(1);
  });

  it("has no Google Play services in it", () => {
    const g = gradle();
    // The scanner is the only Play services dependency, and the whole reason for the second build.
    const scanner = g.split("\n").filter((l) => l.includes("play-services-code-scanner"));
    expect(scanner.length, "the scanner dependency is missing entirely").toBeGreaterThan(0);
    for (const line of scanner) {
      expect(line.trim().startsWith("googleImplementation"), `"${line.trim()}" would put Play services in the Fire TV build too`).toBe(true);
    }
    // The one place the scanner is called has to go through something the Fire TV build can replace.
    const more = read("android/client/src/main/java/tv/ultimate/client/ui/MoreScreens.kt");
    expect(more, "MoreScreens still imports Play services directly").not.toContain("com.google.mlkit");
    expect(more, "MoreScreens doesn't ask whether this device can scan").toContain("canScanQr()");
  });

  it("has a scanner for the phone and a plain one for the Fire TV", () => {
    // Each flavour supplies the same two functions. The phone one hands over to Play services; the
    // Fire TV one says there is no camera, which is true of every stick and box.
    const phone = "android/client/src/google/java/tv/ultimate/client/ui/QrScanner.kt";
    const tv = "android/client/src/firetv/java/tv/ultimate/client/ui/QrScanner.kt";
    for (const file of [phone, tv]) expect(existsSync(path.join(root, file)), `${file} is missing`).toBe(true);
    expect(read(phone), "the phone build can't scan").toContain("GmsBarcodeScanning");
    expect(read(phone), "the phone build says it can't scan").toContain("fun canScanQr(): Boolean = true");
    expect(read(tv), "the Fire TV build pulls in Play services").not.toContain("com.google.android.gms");
    expect(read(tv), "the Fire TV build offers a scanner it can't run").toContain("fun canScanQr(): Boolean = false");
    expect(read(tv), "the Fire TV build doesn't say why").toContain("no camera");
  });

  it("appears in the Fire TV home row, with a picture rather than a square icon", () => {
    const m = manifest();
    // Without the leanback category the app installs but is invisible on a Fire TV.
    expect(m, "no leanback launcher entry, so it never appears on the home row").toContain("android.intent.category.LEANBACK_LAUNCHER");
    expect(m, "no banner, so the home row shows a phone icon").toMatch(/<application[^>]*android:banner="@drawable\/banner"/);
    // Android hides an app from a device when it needs hardware the device hasn't got. A TV has no
    // touchscreen, so saying nothing means it is filtered out of the store and the home row.
    expect(m, "the app doesn't say a touchscreen is optional").toMatch(/android\.hardware\.touchscreen"\s*\n?\s*android:required="false"/);
    expect(m, "the app doesn't say leanback is optional").toMatch(/android\.software\.leanback"\s*\n?\s*android:required="false"/);
  });

  it("has a banner of the size Amazon asks for", () => {
    const file = path.join(root, "android/client/src/firetv/res/drawable-xhdpi/banner.png");
    expect(existsSync(file), "the banner itself is missing").toBe(true);
    const png = readFileSync(file);
    // 320x180 at xhdpi, in a colour type the launcher accepts, written by tools/android/make-banner.mjs.
    expect(png.subarray(1, 4).toString(), "that isn't a PNG").toBe("PNG");
    expect(png.readUInt32BE(16), "the banner is the wrong width").toBe(320);
    expect(png.readUInt32BE(20), "the banner is the wrong height").toBe(180);
    // It lives in the Fire TV source set only: a phone build has no use for it, and keeping it out
    // of `main` is what stops it being shipped twice.
    expect(existsSync(path.join(root, "android/client/src/main/res/drawable-xhdpi/banner.png")), "the banner is also in the phone build").toBe(false);
  });

  it("answers the remote's keys in the player", () => {
    // A Fire TV remote sends select, back, play/pause, rewind and fast forward as keys, never as
    // touches. Without this the player is unusable on a TV: the film plays but nothing controls it.
    const player = read("android/client/src/main/java/tv/ultimate/client/PlayerActivity.kt");
    expect(player, "the player ignores the remote").toContain("override fun dispatchKeyEvent(");
    for (const [key, why] of [
      ["KEYCODE_MEDIA_PLAY_PAUSE", "play/pause does nothing"],
      ["KEYCODE_DPAD_CENTER", "select does nothing"],
      ["KEYCODE_BACK", "back doesn't leave the player"],
      ["KEYCODE_MEDIA_REWIND", "rewind doesn't work"],
      ["KEYCODE_MEDIA_FAST_FORWARD", "fast forward doesn't work"],
      ["KEYCODE_MEDIA_NEXT", "next episode doesn't work"],
    ] as const) {
      expect(player, `the player never looks at ${key}: ${why}`).toContain(key);
    }
    // Select has to reach the player rather than the on-screen controller's buttons.
    expect(player, "select is handled after the controller, so it presses a button instead of pausing").toMatch(/override fun dispatchKeyEvent\(/);
  });

  it("puts something in focus when a screen opens, or the arrow keys do nothing", () => {
    // Compose on a phone is driven by touch, so nothing needs focus; on a TV the first arrow press
    // has to land somewhere. This is the one piece of the D-pad work that can be checked from here.
    const helper = "android/client/src/main/java/tv/ultimate/client/ui/TvFocus.kt";
    expect(existsSync(path.join(root, helper)), `${helper} is missing`).toBe(true);
    const focus = read(helper);
    expect(focus, "the helper doesn't check for a TV").toContain("FEATURE_LEANBACK");
    expect(focus, "the helper does nothing on a phone either").toContain("focusRequester(");
    const main = read("android/client/src/main/java/tv/ultimate/client/ui/MainActivity.kt");
    expect(main, "no screen asks for focus, so a TV remote has nothing to move from").toContain("tvLanding(");
  });

  it("offers its own version and download, not the phone's", () => {
    // "Check for updates" on a stick must fetch the Fire TV build. Sending it the phone APK would
    // install an app that crashes at launch, over a working one.
    const g = gradle();
    expect(g, "both builds check the phone's version file").toMatch(/firetv\s*\{[^}]*UPDATE_PAGE[^}]*firetv-app\.json/);
    expect(g, "both builds download the phone's APK").toMatch(/firetv\s*\{[^}]*UPDATE_PATH[^}]*\/api\/firetv\/app\.apk/);
    expect(g, "the phone build lost its own update path").toMatch(/google\s*\{[^}]*UPDATE_PATH[^}]*\/api\/client\/app\.apk/);
    // And the words on screen: "UltimateTV for Android" on a Fire TV would be wrong.
    expect(read("android/client/src/main/java/tv/ultimate/client/ui/MoreScreens.kt"), "the version line doesn't name the device").toContain("BuildConfig.DEVICE_LABEL");
  });

  it("is built and published by CI, beside the phone build", () => {
    const ci = read(".github/workflows/ci.yml");
    const at = ci.indexOf("  android-client:");
    expect(at, "android-client is not in ci.yml").toBeGreaterThan(-1);
    const block = ci.slice(at);
    expect(block, "CI doesn't build the Fire TV flavour").toContain(":client:assembleFiretv");
    expect(block, "CI stopped building the phone flavour, so phones get no update").toContain(":client:assembleGoogle");
    // The Hub serves it from a release of its own; a phone and a stick must not share one file.
    expect(block, "CI doesn't publish a Fire TV release").toContain("gh release upload firetv-app");
    // Debug builds must never be published, same rule as the other two apps (#93).
    expect(block, "the publish step lost its debug guard").toContain("*-release.apk");
    // And the Hub's version files have to keep up, or a stick never learns an update exists.
    expect(block, "CI no longer checks the version files", ).toContain("hub/public/setup/firetv-app.json");
  });
});
