// The Android apps are signed with a key that is not in this repository (#93).
//
// Until 3 November 2026 a keystore lived at android/remote.keystore with its password written in
// both build.gradle files. It was a home app installed by hand, so the reasoning went, a public key
// didn't matter — but the password was in the repo too, so anyone who could read the code could sign
// an update that every phone in the house would accept. The key now lives in the repository's
// secrets and Gradle reads it from the environment.
//
// This test is the guard rail. It cannot check that the secrets are set (they're not visible from a
// checkout), so it checks the two things that would undo the change silently: a keystore file
// creeping back into the tree, and a build.gradle pointing at a keystore path that's in the repo.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url).pathname;
const android = path.join(root, "android");
const ci = readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");

/** Every keystore or JKS file in the checkout, so a stray one anywhere is caught. */
function keystores(dir = root, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Not worth walking: build outputs can hold a copy Gradle just made, node_modules is noise, and
    // .scratch is the developer's own toolchain — excluded from git, and gigabytes of it.
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "build", ".gradle", ".worktrees", "dist", ".scratch"].includes(entry.name)) continue;
      keystores(path.join(dir, entry.name), found);
    } else if (/\.(keystore|jks)$/i.test(entry.name)) {
      found.push(path.relative(root, path.join(dir, entry.name)));
    }
  }
  return found;
}

describe("the Android apps' signing key", () => {
  it("is not in the repository", () => {
    expect(keystores()).toEqual([]);
  });

  it("is kept out of git even if someone drops a file in", () => {
    const ignore = readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(ignore).toMatch(/^\*\.keystore$/m);
    expect(ignore).toMatch(/^\*\.jks$/m);
  });

  it("comes from the environment, so a build with no secrets still compiles", () => {
    for (const file of ["app/build.gradle", "client/build.gradle"]) {
      const gradle = readFileSync(path.join(android, file), "utf8");
      // The four names CI sets. A typo here would mean a silent unsigned release build.
      for (const name of ["ANDROID_KEYSTORE_PATH", "ANDROID_KEYSTORE_PASSWORD", "ANDROID_KEY_ALIAS", "ANDROID_KEY_PASSWORD"]) {
        expect(gradle, `${file} doesn't read ${name}`).toContain(name);
      }
      // The old shape: a keystore path with no environment variable in front of it.
      expect(gradle, `${file} still points at a keystore in the repo`).not.toMatch(/storeFile\s+rootProject\.file\(\s*"remote\.keystore"/);
      // Debug builds must not need the key: that's what makes a fork's pull request work.
      expect(gradle, `${file}'s debug build is signed with the release key`).not.toMatch(/debug\s*\{\s*signingConfig\s+signingConfigs\.(shared|release)/);
    }
  });

  it("is only published by a build that used it", () => {
    // A debug-signed APK on the release would be one Android refuses to install over, so every
    // phone would be stuck until the next release-signed build. The publish step must refuse.
    for (const job of ["android-remote", "android-client"]) {
      const at = ci.indexOf(`  ${job}:`);
      expect(at, `${job} is not in ci.yml`).toBeGreaterThan(-1);
      const block = ci.slice(at, ci.indexOf("\n  # ", at) === -1 ? undefined : ci.indexOf("\n  # ", at));
      expect(block, `${job} doesn't check which APK it publishes`).toContain("*-release.apk");
      expect(block, `${job} doesn't read the signing secrets`).toContain("secrets.ANDROID_KEYSTORE_BASE64");
    }
  });

  it("tells an app too old to install over to uninstall first", () => {
    // Android won't install over a different key, so the version the Hub offers has to say which
    // builds are on the old key. Without it the household only sees "App not installed".
    // uninstallBelow stays at the first build on the new key; later builds install over it.
    for (const [file, code, below] of [
      ["hub/public/remote/app-version.json", 8, 8],
      ["hub/public/setup/client-app.json", 13, 12],
    ] as const) {
      const version = JSON.parse(readFileSync(path.join(root, file), "utf8")) as { versionCode: number; uninstallBelow?: number };
      expect(version.versionCode, `${file} isn't the version this test expects — update it`).toBe(code);
      expect(version.uninstallBelow, `${file} has no uninstallBelow`).toBe(below);
    }
    const banner = readFileSync(path.join(root, "hub/public/remote/index.html"), "utf8");
    expect(banner, "the remote's update banner doesn't warn about the uninstall").toContain("uninstallBelow");
  });

  it("has the key it uses written down, so it can be checked and replaced", () => {
    // The certificate's fingerprint, in the doc: whoever has the keystore can confirm a release APK
    // really came from it. A missing fingerprint means nobody can tell which key signed what.
    const doc = path.join(root, "docs/android-signing.md");
    expect(existsSync(doc), "docs/android-signing.md is gone").toBe(true);
    const text = readFileSync(doc, "utf8");
    expect(text).toMatch(/F5:BC:C3:7E/);
    // Committing the keystore in a doc's code block would be the same mistake with extra steps.
    expect(text).not.toMatch(/BEGIN (RSA |EC )?PRIVATE KEY/);
  });

  it("has no keystore in the git index either, which is what actually gets cloned", () => {
    // The filesystem check above could pass with a keystore still tracked but deleted on disk.
    let tracked = "";
    try {
      tracked = execFileSync("git", ["ls-files", "*.keystore", "*.jks"], { cwd: root, encoding: "utf8" });
    } catch {
      // No git (a source tarball): the checks above still held.
      return;
    }
    expect(tracked.trim()).toBe("");
  });
});
