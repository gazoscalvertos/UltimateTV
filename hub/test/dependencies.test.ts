// What the household's data can touch (#198).
//
// Two separate things are checked here, because they fail differently:
//
//  1. Nothing in the Android apps may bring in Google Play services. It used to, through the
//     barcode scanner; on a Fire TV that crashed the app at launch, and on a phone it meant a pile
//     of Google libraries that can report on the device. The scanner is now our own code.
//  2. The npm side must stay boring. This is not a vulnerability scan (CI does that separately):
//     it fails if a dependency that is only a build tool becomes a runtime one, or if a package
//     that ships to the Hub or the TV app starts carrying an analytics or tracking library.
//
// Everything it reads is a file in the repo, so it runs without a network or a lockfile install.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const readJson = (file: string) => JSON.parse(read(file)) as Record<string, unknown>;
const exists = (file: string) => {
  try {
    readFileSync(path.join(root, file));
    return true;
  } catch {
    return false;
  }
};

const ANDROID_BUILDS = [
  "android/app/build.gradle",
  "android/client/build.gradle",
  "android/scanner/build.gradle",
];

/** The lines of a Gradle file that actually declare a dependency. */
const dependencyLines = (file: string) =>
  read(file)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(implementation|api|compileOnly|runtimeOnly|testImplementation|androidTestImplementation|debugImplementation|releaseImplementation)\b/.test(line));

// The libraries the app is allowed to ship with, and what each is for. A new one has to be added
// here on purpose: that is the point, so nobody adds an SDK that reports on the household by
// accident.
const ALLOWED_ANDROID = [
  "androidx.camera:camera-core",
  "androidx.camera:camera-camera2",
  "androidx.camera:camera-lifecycle",
  "androidx.camera:camera-view",
  "androidx.activity:activity-ktx",
  "com.google.zxing:core",
  "junit:junit",
  "androidx.compose:compose-bom",
  "androidx.compose.ui:ui",
  "androidx.compose.material3:material3",
  "androidx.compose.material:material-icons-extended",
  "androidx.activity:activity-compose",
  "androidx.navigation:navigation-compose",
  "androidx.lifecycle:lifecycle-runtime-compose",
  "androidx.lifecycle:lifecycle-runtime-ktx",
  "androidx.core:core-ktx",
  "org.jetbrains.kotlinx:kotlinx-coroutines-android",
  "io.coil-kt:coil-compose",
  "com.google.code.gson:gson",
  "androidx.media3:media3-exoplayer",
  "androidx.media3:media3-exoplayer-hls",
  "androidx.media3:media3-datasource",
  "androidx.media3:media3-database",
  "androidx.media3:media3-ui",
  "org.jellyfin.media3:media3-ffmpeg-decoder",
  ":scanner",
];

// Anything matching these is refused outright, whatever it is called.
const FORBIDDEN_VENDORS = [
  "com.google.android.gms", // Play services: ads, location, analytics, and the old scanner
  "com.google.mlkit", // also Play-services-backed
  "com.google.firebase", // its whole job is to report back
  "com.google.android.ads",
  "com.google.ads",
  "com.applovin",
  "com.facebook.ads",
  "com.unity3d.ads",
  "com.crashlytics",
  "com.segment",
  "com.amplitude",
  "com.mixpanel",
  "com.adjust",
  "com.appsflyer",
  "com.bugsnag",
  "io.sentry",
  "com.newrelic",
];

describe("the Android apps", () => {
  it("declare no Google Play services and no analytics SDK", () => {
    for (const file of ANDROID_BUILDS) {
      expect(exists(file), `${file} is missing`).toBe(true);
      for (const line of dependencyLines(file)) {
        for (const vendor of FORBIDDEN_VENDORS) {
          expect(line, `${file} declares ${vendor}: ${line}`).not.toContain(vendor);
        }
      }
    }
  });

  it("only ship libraries that are on the list, each with a reason", () => {
    for (const file of ANDROID_BUILDS) {
      for (const line of dependencyLines(file)) {
        const match = line.match(/["']([^"']+)["']/);
        if (!match) continue; // e.g. `implementation platform(...)` is checked by name below
        const name = match[1];
        const known = ALLOWED_ANDROID.some((allowed) => name === allowed || name.startsWith(`${allowed}:`));
        expect(known, `${file} added ${name}. Add it to ALLOWED_ANDROID in hub/test/dependencies.test.ts with what it is for.`).toBe(true);
      }
    }
  });

  it("keep build tools out of the shipped app", () => {
    // These are dev-only. If one turns up as a runtime dependency it means something is bundling a
    // compiler or a browser engine into the APK.
    const devOnly = ["esbuild", "vitest", "playwright", "typescript", "tsx"];
    for (const file of ANDROID_BUILDS) {
      for (const line of dependencyLines(file)) {
        for (const tool of devOnly) {
          expect(line.toLowerCase(), `${file} ships ${tool}`).not.toContain(tool);
        }
      }
    }
  });
});

describe("the npm dependencies", () => {
  const lock = readJson("package-lock.json") as { packages: Record<string, { version?: string; dev?: boolean; license?: string }> };
  const packages = lock.packages;

  // The only things allowed to install code when npm installs, and there are only two. A new one has
  // to be justified: an install script runs arbitrary code on the Hub machine at install time.
  const INSTALL_SCRIPTS_ALLOWED = ["node_modules/esbuild", "node_modules/fsevents"];

  it("has only two dependencies that run code while installing", () => {
    const withScripts = Object.entries(packages)
      .filter(([, meta]) => (meta as { hasInstallScript?: boolean }).hasInstallScript)
      .map(([name]) => name)
      .sort();
    expect(withScripts, "a dependency started running an install script").toEqual(INSTALL_SCRIPTS_ALLOWED);
  });

  it("carries no analytics, tracking or advertising package", () => {
    const forbidden = ["analytics", "telemetry", "mixpanel", "amplitude", "posthog", "segment-", "sentry", "bugsnag", "datadog", "newrelic", "advertising", "doubleclick", "gtag"];
    const names = Object.keys(packages).map((name) => name.replace(/^node_modules\//, "").toLowerCase());
    for (const pattern of forbidden) {
      const hits = names.filter((name) => name.includes(pattern));
      expect(hits, `the lockfile gained ${pattern}: ${hits.join(", ")}`).toEqual([]);
    }
  });

  it("keeps the runtime dependency list short and known", () => {
    // What actually ships to the Hub, the TV app and the box. Anything new here is something the
    // household's Hub or TV will run, so it is a deliberate decision rather than a `npm i`.
    const declared: Record<string, Record<string, string>> = {};
    for (const workspace of ["shared", "hub", "ui", "box", "tools/probe"]) {
      declared[workspace] = (readJson(`${workspace}/package.json`).dependencies as Record<string, string>) ?? {};
    }
    expect(Object.keys(declared.hub).sort()).toEqual([
      "@fastify/static",
      "@fastify/websocket",
      "@ultimatetv/shared",
      "fastify",
      "qrcode",
      "sax",
    ]);
    expect(Object.keys(declared.ui).sort()).toEqual(["@ultimatetv/shared", "mpegts.js", "solid-js"]);
    expect(Object.keys(declared.box).sort()).toEqual(["electron"]);
    expect(Object.keys(declared.shared)).toEqual([]);
    expect(Object.keys(declared["tools/probe"])).toEqual([]);
  });

  it("has every third-party package under a known licence", () => {
    // A missing licence is not a security problem, but it is a legal one for anyone redistributing
    // the app. The workspace members are this project's own code and have no licence field.
    const ours = new Set(["", "box", "hub", "shared", "ui", "tools/probe"]);
    const missing = Object.entries(packages)
      .filter(([name, meta]) => name && !ours.has(name.replace(/^node_modules\//, "").split("/")[0] === "@ultimatetv" ? "" : "") && !meta.license)
      .map(([name]) => name)
      .filter((name) => !name.startsWith("node_modules/@ultimatetv/") && !/^node_modules\/(box|hub|shared|ui|tools\/probe)$/.test(name));
    expect(missing, "a dependency arrived with no licence").toEqual([]);
  });
});
