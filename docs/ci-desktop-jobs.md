# The Windows and Mac desktop jobs for CI (#127 and #128)

The AppImage job in `.github/workflows/ci.yml` already does for Linux what these two do for Windows
and Mac: build the app, put it on the `desktop-app` GitHub release, and let the app update itself
from there. This file is the exact YAML for the two missing jobs, and where each part goes.

**Why it is a file and not a commit to `ci.yml`:** the git token this work was done with has no
`workflow` scope, so GitHub rejects any push touching `.github/workflows/`. `ci.yml` is therefore
byte-for-byte unchanged, and this is the copy to paste in. **Nothing here is live until it is.**

Everything the jobs call is in this branch already: `tools/desktop/build-win.sh`,
`tools/desktop/build-macos.sh`, `tools/desktop/fetch-mpv.sh`, and the `win`/`mac` sections of
`tools/desktop/electron-builder.yml`.

---

## 1. Where the jobs go

Both are new jobs in `.github/workflows/ci.yml`, beside `desktop-appimage` (which starts at the
comment `# The TV app as an AppImage for Linux desktops`). Paste them immediately after that job's
last step, before `android-remote:`.

## 2. The repository variables they need

The installers have to carry an mpv, and no mpv binary is committed (they are tens of megabytes, and
belong to other projects). Set these under **Settings → Secrets and variables → Actions →
Variables**:

| Variable | What it is |
| --- | --- |
| `MPV_WIN_URL` | A `.zip` of a Windows x64 mpv: `mpv.exe` and its `.dll` files at the top of the archive. [shinchiro's builds](https://github.com/shinchiro/mpv-winbuild-cmake/releases) are the usual source; take `mpv-x86_64-*.7z`, unpack it, and re-zip the contents (or upload them somewhere the runner can reach). |
| `MPV_MAC_URL` | A `.zip` or `.tar.xz` of a macOS **arm64** mpv that can be moved: `mpv` and its `.dylib` files, with install names rewritten to `@executable_path` ("Bundling mpv" in docs/desktop.md has the loop). |
| `MPV_WIN_ARM64_URL` | Optional: the same for a Windows ARM PC. Without it the arm64 Windows files are skipped. |
| `MPV_MAC_X64_URL` | Needed for the Intel `.dmg` that #128 asks for: the same for an **x86_64** mpv. An Intel mpv runs on Apple Silicon through Rosetta but not the reverse, so pointing this at the arm64 file does not work. |

Both jobs fetch through `tools/desktop/fetch-mpv.sh`, which also refuses a Mac build still pointing
at `/opt/homebrew` or `/usr/local`. The build scripts then stop if `tools/desktop/vendor/mpv` has no
binary, before electron-builder would fail on the missing `extraResources` source.

**Until these exist, there is nothing to publish.** If the intention is to publish installers that
open but cannot play (an app with no mpv), add `ALLOW_NO_MPV: "1"` to the build step's `env` and
delete the fetch step; docs/desktop.md says so in "What still isn't done".

## 3. The jobs

```yaml
  # The TV app as a Windows installer (#127). NSIS, installed for the current user, so it needs no
  # administrator. docs/desktop.md has the Windows section.
  desktop-windows:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      # Every step that runs a shell script says shell: bash: a Windows runner's default is
      # PowerShell, which would mangle it. bash there is Git Bash, which is what the scripts are
      # written for.
      - name: Put mpv inside the installer
        shell: bash
        env:
          MPV_WIN_URL: ${{ vars.MPV_WIN_URL }}
        run: bash tools/desktop/fetch-mpv.sh win
      - name: Build the x64 installer
        shell: bash
        env:
          BRANCH: main
          ARCH: x64
        run: bash tools/desktop/build-win.sh
      # Each build deletes tools/desktop/out before it starts (stage-app.sh), so this
      # architecture's files are moved out of the way first. The folder is beside out, not inside
      # it, or the second build would delete them too.
      - name: Keep the x64 output
        shell: bash
        run: |
          mkdir -p tools/desktop/kept
          mv tools/desktop/out/UltimateTV-Setup-x64.exe tools/desktop/out/UltimateTV-x64.zip \
            tools/desktop/out/ultimatetv-windows.json tools/desktop/out/ultimatetv-desktop.json tools/desktop/kept/
      # Windows on ARM is a small share of PCs: skipped rather than failed when no ARM mpv is set.
      - name: Put the ARM mpv in
        if: vars.MPV_WIN_ARM64_URL != ''
        shell: bash
        env:
          MPV_WIN_URL: ${{ vars.MPV_WIN_ARM64_URL }}
        run: |
          rm -rf tools/desktop/vendor/mpv
          bash tools/desktop/fetch-mpv.sh win
      - name: Build the arm64 installer
        if: vars.MPV_WIN_ARM64_URL != ''
        shell: bash
        env:
          BRANCH: main
          ARCH: arm64
        run: bash tools/desktop/build-win.sh
      - name: Gather the output
        shell: bash
        run: |
          mv tools/desktop/kept/* tools/desktop/out/
          rmdir tools/desktop/kept
      - uses: actions/upload-artifact@v7
        with:
          name: ultimatetv-desktop-windows
          path: |
            tools/desktop/out/UltimateTV-Setup-x64.exe
            tools/desktop/out/UltimateTV-Setup-arm64.exe
            tools/desktop/out/UltimateTV-x64.zip
            tools/desktop/out/UltimateTV-arm64.zip
            tools/desktop/out/ultimatetv-windows.json
            tools/desktop/out/ultimatetv-desktop.json
          if-no-files-found: error
      - name: Publish the installers
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        shell: bash
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release view desktop-app > /dev/null 2>&1 || gh release create desktop-app --title "Desktop app (latest)" --notes "The TV app for Windows, macOS and Linux desktops, built from main by CI. See docs/desktop.md. The app updates itself from here (Settings › About)." --latest=false
          # Only what this run built: the ARM files are absent when that leg was skipped.
          for f in UltimateTV-Setup-x64.exe UltimateTV-Setup-arm64.exe UltimateTV-x64.zip UltimateTV-arm64.zip; do
            if [ -f "tools/desktop/out/$f" ]; then gh release upload desktop-app "tools/desktop/out/$f" --clobber; fi
          done
          # The build descriptions last, so an app that sees a new commit always finds its installer.
          # ultimatetv-windows.json is this platform's own: if the Mac or Linux job fails while this
          # one succeeds, the shared file lags behind, and the app compares against its own first.
          gh release upload desktop-app tools/desktop/out/ultimatetv-windows.json --clobber
          gh release upload desktop-app tools/desktop/out/ultimatetv-desktop.json --clobber

  # The TV app as a Mac disk image (#128), one per architecture. It has to run on macOS: the .app is
  # assembled with Apple's codesign and the disk image with hdiutil. docs/desktop.md has the Mac
  # section.
  desktop-macos:
    runs-on: macos-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - name: Put mpv inside the app
        env:
          MPV_MAC_URL: ${{ vars.MPV_MAC_URL }}
        run: bash tools/desktop/fetch-mpv.sh mac
      - name: Build the Apple Silicon disk image
        env:
          BRANCH: main
          ARCH: arm64
        run: bash tools/desktop/build-macos.sh
      # Beside out, not inside it: the Intel build deletes out before it starts.
      - name: Keep the Apple Silicon output
        run: |
          mkdir -p tools/desktop/kept
          mv tools/desktop/out/UltimateTV-arm64.dmg \
            tools/desktop/out/ultimatetv-macos.json tools/desktop/out/ultimatetv-desktop.json tools/desktop/kept/
      # The Intel build needs an Intel mpv, so the vendor folder is replaced for it.
      - name: Put the Intel mpv in
        if: vars.MPV_MAC_X64_URL != ''
        env:
          MPV_MAC_URL: ${{ vars.MPV_MAC_X64_URL }}
        run: |
          rm -rf tools/desktop/vendor/mpv
          bash tools/desktop/fetch-mpv.sh mac
      - name: Build the Intel disk image
        if: vars.MPV_MAC_X64_URL != ''
        env:
          BRANCH: main
          ARCH: x64
        run: bash tools/desktop/build-macos.sh
      - name: Gather the disk images
        run: |
          mv tools/desktop/kept/* tools/desktop/out/
          rmdir tools/desktop/kept
      - uses: actions/upload-artifact@v7
        with:
          name: ultimatetv-desktop-macos
          path: |
            tools/desktop/out/UltimateTV-arm64.dmg
            tools/desktop/out/UltimateTV-x64.dmg
            tools/desktop/out/ultimatetv-macos.json
            tools/desktop/out/ultimatetv-desktop.json
          if-no-files-found: error
      - name: Publish the disk images
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release view desktop-app > /dev/null 2>&1 || gh release create desktop-app --title "Desktop app (latest)" --notes "The TV app for Windows, macOS and Linux desktops, built from main by CI. See docs/desktop.md. The app updates itself from here (Settings › About)." --latest=false
          for f in UltimateTV-arm64.dmg UltimateTV-x64.dmg; do
            if [ -f "tools/desktop/out/$f" ]; then gh release upload desktop-app "tools/desktop/out/$f" --clobber; fi
          done
          gh release upload desktop-app tools/desktop/out/ultimatetv-macos.json --clobber
          gh release upload desktop-app tools/desktop/out/ultimatetv-desktop.json --clobber
```

## 4. What to check on the first run

- **`shell: bash` on every Windows step that runs a script.** A Windows runner's default is
  PowerShell, which would mangle the loop in the publish step. This is the most likely first-push
  failure.
- **`gh release upload` needs a file that exists.** The `if [ -f … ]` guard is what makes the
  optional architectures safe: with a skipped leg the release simply doesn't get those files,
  instead of `gh` failing the job after it had already uploaded the others.
- **The build scripts delete `tools/desktop/out`** at the start (`stage-app.sh`), which is why each
  job moves the first architecture's files to `tools/desktop/kept` — beside `out`, not inside it —
  before building the second.
- **`electron-builder` on a Linux host for Windows needs Wine.** Not an issue with
  `windows-latest`, but it is why `build-win.sh` can't just be added to the existing Ubuntu job.
- **Nothing is signed.** The Windows installer shows SmartScreen's "publisher unknown" and the Mac
  app needs right-click → Open. docs/desktop.md, "Signing", says what a paid certificate changes and
  which four settings a notarised build would need.
- **The three jobs write to one release.** `desktop-appimage` keeps working exactly as it does
  today; these two only add files to the same release. Each app compares its own build against the
  shared `ultimatetv-desktop.json` (`box/src/desktop-app-updates.ts`), and the file names it looks
  for are in `shared/src/desktop.ts`.

## 5. After that

Nothing else in `ci.yml` has to change. The `test` job already runs the whole `vitest` suite, which
includes `shared/test/desktop.test.ts` (the file names), `box/test/platform.test.ts` and
`box/test/desktop-app-updates.test.ts` (paths, the mpv lookup, the installer checks) and
`hub/test/desktop-downloads.test.ts` (the Hub's routes and QR codes serve exactly those names), so a
name changed in one place and not the others fails the build.
