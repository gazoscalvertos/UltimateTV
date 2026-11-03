// The desktop app's download files (#127 Windows, #128 Mac), named in one place.
//
// Three parts of the project have to agree on these names, or a download link goes nowhere:
//
//   tools/desktop/electron-builder.yml   the artifactName patterns that produce the files;
//   the CI job in docs/ci-desktop-jobs.md   the `gh release upload` that publishes them;
//   the Hub and the box                  the links, the QR codes and the update check.
//
// So the mapping lives here, in the package all of them already import, and the tests pin it:
// shared/test/desktop.test.ts checks every name here, and hub/test/desktop-downloads.test.ts
// checks the Hub serves and draws exactly these. The patterns are also written out in
// tools/desktop/electron-builder.yml; the comment there says where this file is.
//
// The "desktop-app" release is one release with every desktop build on it; ultimatetv-desktop.json
// beside them says which commit they were built from (box/src/appimage-updates.ts reads it).

/** Which desktop build a download is for. The same names the Hub's routes and QR codes use. */
export type DesktopKind = "windows" | "macos" | "linux";

/** Everything the Hub and the app need to know about one platform's download. */
export interface DesktopDownload {
  kind: DesktopKind;
  /** What to call it to a person: "Windows", "Mac", "Linux". */
  label: string;
  /** The release asset per architecture, exactly as electron-builder names it. */
  assets: { x64: string; arm64: string };
  /** Which of the two a browser of this platform most likely wants (Mac: Apple Silicon). */
  usual: "x64" | "arm64";
  /** How the file should be described in a download link. */
  contentType: string;
  /** What the person does with it after downloading, in one line. */
  how: string;
}

/** GitHub's release for every desktop build: the AppImage, the Windows installer and the Mac .dmg. */
export const DESKTOP_RELEASE = "desktop-app";

/** The JSON beside them naming the commit they were built from. */
export const DESKTOP_BUILD_FILE = "ultimatetv-desktop.json";

/**
 * The build description for one platform's installer.
 *
 * The shared file above says which commit the AppImage was built from, and all three desktop jobs
 * run on the same push so it is usually the same commit. It can be wrong for one platform: if the
 * Windows job fails while the other two succeed, the shared file moves on and a Windows app would
 * download an installer that is still the old build. So each installer has its own description, and
 * the app reads its platform's one first (box/src/desktop-app-updates.ts), falling back to the
 * shared file when a release predates it.
 */
export function desktopBuildFile(kind: DesktopKind): string {
  return `ultimatetv-${kind}.json`;
}

/**
 * The release asset for one platform and architecture.
 *
 * These have to match tools/desktop/electron-builder.yml exactly: the AppImage keeps Linux's
 * x86_64 spelling of x64, the Windows build is a per-user Setup .exe, and the Mac gets one .dmg per
 * architecture rather than a universal binary.
 */
export function desktopAsset(kind: DesktopKind, arch: string): string {
  // Only the two architectures electron-builder is asked for; anything else becomes x64, so a link
  // is still made instead of a broken name.
  const wanted = arch === "arm64" ? "arm64" : "x64";
  if (kind === "windows") return `UltimateTV-Setup-${wanted}.exe`;
  if (kind === "macos") return `UltimateTV-${wanted}.dmg`;
  return `UltimateTV-${wanted === "x64" ? "x86_64" : "arm64"}.AppImage`;
}

/**
 * The desktop build a platform runs, so the app and the Hub agree which file is "the update".
 *
 * `platform` is a parameter rather than a default of `process.platform` because this module is
 * compiled for the browser too (the probe reads it), where `process` does not exist. The callers
 * that care pass Node's value: box/src/platform.ts and box/src/desktop-app-updates.ts.
 */
export function desktopKind(platform: string): DesktopKind {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/** What the Hub offers: the two new installers and the AppImage that was already there. */
export function desktopDownloads(): DesktopDownload[] {
  return [
    {
      kind: "windows",
      label: "Windows",
      assets: { x64: desktopAsset("windows", "x64"), arm64: desktopAsset("windows", "arm64") },
      usual: "x64",
      contentType: "application/vnd.microsoft.portable-executable",
      how: "Open the download, then the installer. It installs for you alone: no administrator.",
    },
    {
      kind: "macos",
      label: "Mac",
      assets: { x64: desktopAsset("macos", "x64"), arm64: desktopAsset("macos", "arm64") },
      usual: "arm64",
      contentType: "application/x-apple-diskimage",
      how: "Open the .dmg, drag UltimateTV to Applications, then right-click it and choose Open.",
    },
    {
      kind: "linux",
      label: "Linux",
      assets: { x64: desktopAsset("linux", "x64"), arm64: desktopAsset("linux", "arm64") },
      usual: "x64",
      contentType: "application/x-executable",
      how: "Make the download executable and run it. It needs mpv from your distribution.",
    },
  ];
}

/** One platform's entry from the list above. */
export function desktopDownload(kind: DesktopKind): DesktopDownload {
  const found = desktopDownloads().find((d) => d.kind === kind);
  if (!found) throw new Error(`No desktop download for ${kind}`);
  return found;
}

/**
 * Which file to hand someone, from an `?arch=` value.
 *
 * Macs don't say whether they are Intel or Apple Silicon — a browser can't be asked, and Rosetta
 * reports Intel on Apple Silicon — so nothing here is told apart by User-Agent. With no arch asked
 * for this is the usual one for the platform (Apple Silicon for Mac, x64 for Windows and Linux),
 * and the other is offered beside it.
 */
export function downloadAsset(kind: DesktopKind, arch?: string | null): string {
  const d = desktopDownload(kind);
  return arch === "arm64" ? d.assets.arm64 : arch === "x64" ? d.assets.x64 : d.assets[d.usual];
}

/** The other architecture's file for a platform, for the "on an older PC / an Intel Mac" line. */
export function otherAsset(kind: DesktopKind, arch?: string | null): { arch: "x64" | "arm64"; asset: string } {
  const pick: "x64" | "arm64" = arch === "x64" ? "arm64" : arch === "arm64" ? "x64" : desktopDownload(kind).usual === "x64" ? "arm64" : "x64";
  return { arch: pick, asset: desktopDownload(kind).assets[pick] };
}

/**
 * Whether a download is plausibly the file it claims to be, so a GitHub error page, a proxy's
 * "not found" or a half-written file is never offered as "the new version" or as an app to install.
 *
 * The Hub checks this before it caches a download (hub/src/remoteapp.ts) and the app checks it
 * before it opens an installer (box/src/desktop-app-updates.ts), so the two agree.
 *
 *   windows  a Windows executable starts "MZ", and an NSIS installer is megabytes, not a stub.
 *   macos    a UDIF disk image ends with a 512-byte trailer that begins "koly".
 *   linux    the AppImage is an ELF file, and never the tiny placeholder some proxies serve.
 *
 * `head` is the file's first bytes and `tail` its last (up to 512 of each), so the check doesn't
 * need the whole download in memory.
 */
export function looksLikeDesktopDownload(kind: DesktopKind, head: Uint8Array, tail: Uint8Array, size: number): boolean {
  if (kind === "windows") return size > 100_000 && head.length >= 2 && head[0] === 0x4d && head[1] === 0x5a;
  if (kind === "macos") return size > 1_000_000 && tail.length >= 4 && tail[0] === 0x6b && tail[1] === 0x6f && tail[2] === 0x6c && tail[3] === 0x79;
  return size > 20 * 1024 * 1024 && head.length >= 4 && head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
}
