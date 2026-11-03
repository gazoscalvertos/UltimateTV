# Signing the Android apps

The two Android apps — the [phone remote](phone-remote.md) and the [watching client](android-client.md)
— are installed by hand from the Hub, and Android only installs an update over an app signed with the
**same key**. So every APK the Hub hands out has to be signed the same way, forever.

The key is the household's own. It is **not in this repository**: it lives in the repository secrets
and is written out only for the few seconds a CI build needs it. That is what #93 changed — until then
a keystore was committed at `android/remote.keystore` with the password `android` in both
`android/app/build.gradle` and `android/client/build.gradle`, which meant anyone who could read the
repo could sign an update for the household's phones.

## Where the key lives

| Thing | Where |
| --- | --- |
| The keystore file | Secret `ANDROID_KEYSTORE_BASE64` (the file, base64-encoded) |
| Its store password | Secret `ANDROID_KEYSTORE_PASSWORD` |
| The key's alias | Secret `ANDROID_KEY_ALIAS` (currently `release`) |
| That key's password | Secret `ANDROID_KEY_PASSWORD` |

Settings › Secrets and variables › Actions › Secrets in the repository. CI decodes the base64 into
`android/release.keystore` (ignored by git — `*.keystore` and `*.jks` are in `.gitignore`), builds a
**release** APK, then the runner is thrown away with the key on it.

Gradle reads four environment variables, in `android/app/build.gradle` and
`android/client/build.gradle`:

- `ANDROID_KEYSTORE_PATH` — the keystore, relative to `android/`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

With no key set, a **release** build comes out unsigned (Gradle doesn't fail — the point is that
`gradle :app:assembleRelease` still tells you the code compiles) and a **debug** build is signed with
the runner's own throwaway debug key. That is deliberate: a pull request from a fork has no secrets,
and it still has to compile and be installable for testing.

## Making the key yourself

Losing the keystore means the phones have to be uninstalled and reinstalled once — there is no way to
recover it. Keep a copy somewhere that is not this repo (a password manager, or a USB stick in a
drawer), and **back it up before changing anything here**.

```bash
keytool -genkeypair \
  -keystore ultimatetv-release.keystore \
  -alias release \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=UltimateTV, OU=Apps, O=UltimateTV, L=Home, C=GB"

# What the APKs are checked against:
keytool -list -v -keystore ultimatetv-release.keystore -alias release | grep SHA256

base64 -w0 ultimatetv-release.keystore   # what goes in ANDROID_KEYSTORE_BASE64
```

The key in use now is `CN=UltimateTV, OU=Apps, O=UltimateTV, L=Home, C=GB`, RSA 4096, valid until
2054, with certificate SHA-256
`F5:BC:C3:7E:5B:B1:BC:0E:B1:E5:0B:73:3D:E4:DA:7F:28:62:DA:48:D5:C4:60:28:80:2D:61:F7:53:AA:F2:3A`.
Every APK the Hub publishes should print that digest:

```bash
apksigner verify --print-certs app-release.apk | grep SHA-256
```

CI prints it in the `Say what signed it` step, so a workflow log shows which key built an APK.

## The one-time move off the committed key

The build the household is running (0.7.0 or older on the remote, 0.5.0 or older on the client) is
signed with the key that used to be in the repo. Android will **not** install the new one over it,
because the signature is different. So the move is once, per phone:

1. Uninstall the old app. On most phones: long-press the icon → App info → Uninstall. Downloads the
   client saved on the phone survive in shared storage; the app's settings and the pairing do not.
2. Install the new build from the Hub — the update banner, `http://<hub>:8095/api/remote/app.apk`
   (remote) or `/api/client/app.apk` (client), the setup page's download links, or Chrome.
3. Pair again: scan the TV's pairing code (Settings › Phones and remotes), or type the code.

Both apps say this themselves rather than leaving the household to find out from Android's "App not
installed" message:

- The phone remote's update banner reads `app-version.json`'s `uninstallBelow` and, when the app on
  the phone is older than that, says to uninstall first and pair again.
- The client's Settings › Check for updates reads `client-app.json`'s `uninstallBelow` and puts the
  same warning in the confirm box before it opens the download.

`uninstallBelow` is the first `versionCode` signed with the new key (8 for the remote, 12 for the
client). It is not "the latest version": an app built from now on has it too, and the banner uses it
only to decide whether to warn.

## What still works

- The **Hub's update banner** keeps working. It reads the version from
  `hub/public/remote/app-version.json` (and `hub/public/setup/client-app.json` for the client), which
  CI cross-checks against `versionCode` in `build.gradle`, and it serves the APK from the
  `remote-app` / `client-app` release. A release-signed APK means tapping the banner installs.
- **CI still builds debug APKs for pull requests** with no secrets: the `Put the release key in place`
  step does nothing and the build makes `app-debug.apk`. The artifact is uploaded all the same.
- Publishing from main **refuses** a debug APK: if a main build ever runs without the secrets it fails
  rather than putting a debug-signed APK on the release, because a phone that installed it would have
  to be uninstalled again.
