# Amazon Fire TV

There is a Fire TV app. It is the Android app built as a second, separate APK with **no Google Play
services** in it, because a Fire TV runs Fire OS, which has none. The old single APK did install on
an Amazon stick, and then crashed at launch: the QR scanner's Play-services components are declared
in the manifest, so they are started as the process comes up, and on a device with no Play services
that is the end of it. The `firetv` flavour drops them, so the app starts.

The APK declares a **leanback** launcher entry, so it appears in the Fire TV home row like any
other app, with a 320×180 banner, and it declares the touchscreen optional so a TV doesn't filter
it out as an app for phones.

**Not tested on real hardware.** The APK builds and its manifest has been checked here; nobody has
run it on a Fire TV stick. Treat the first install as an experiment, and see
[If it won't start](#if-it-wont-start).

## Which devices work

**Works:** a Fire TV Stick or any other device running **Fire OS 7 or Fire OS 8**. Those are Android
underneath — Fire OS 7 is the Android 11 era and Fire OS 8 the Android 12 era, so every device on
either is Android 11 or newer, well above the app's Android 8 floor. Every Fire TV Stick is 32-bit
ARM, and the APK's decoder library is built for every ABI, so that is what runs.

**Doesn't work: Vega OS.** Amazon's newer devices — the **Fire TV Stick 4K Select** and sticks
released from 2026 on — run **Vega OS**, which is not Android. It will not run an Android APK, and
it **blocks sideloading** apps from unknown sources except on devices registered as developer
devices. Fire OS 8 devices do **not** block sideloading; Vega OS ones do. If the device says Vega
OS, this page has nothing for it.

**Doesn't work:** anything that is not Android at all, and a Fire TV on Fire OS 5 or 6 (the
Android 5 and 7 era), which is below the app's minimum.

## 1. Install the APK

The Hub serves the Fire TV build at `/api/firetv/app.apk`:

```
http://192.168.0.19:8095/api/firetv/app.apk
```

Put your own Hub's address in that. The setup page (`/setup/`) links it too. There are two ways to
get it onto the stick.

**With the Downloader app.** Install **Downloader** from the Amazon app store, open it, and let it
have the address. The first time, Amazon asks you to allow apps from unknown sources — for
Downloader — before it will install anything:

1. Settings › My Fire TV › Developer Options › **Install unknown apps**, and turn Downloader on. On
   some models the same switch is under Settings › Applications.
2. In Downloader, type the address above. It downloads the APK and offers to install it.
3. Accept the install, then open **UltimateTV** from the home row.

**Over the network, with `adb`.** Enable **ADB debugging** in Settings › My Fire TV › Developer
Options first, then from a computer on the same network — the address is the **stick's**, found in
Settings › My Fire TV › About › Network:

```sh
curl -O http://192.168.0.19:8095/api/firetv/app.apk
adb connect 192.168.0.50:5555
adb install -r app.apk
```

The stick asks you to accept the computer's key the first time; say yes. A later build is the same
`adb install -r`, or a download from the Hub over the top.

## 2. Pair it

The app pairs with the TV the same way the Android app does, with one difference: a Fire TV has
**no camera**, so the "Scan the TV's code" button is hidden. Type the 8-character code the TV is
showing instead (TV Settings › Phones and remotes shows it), and the TV lets the stick in. Pick a
profile as on any other device; profiles with a PIN ask for it, and a Kids profile only sees what
it sees on the TV ([pairing.md](pairing.md)).

## The remote

The Fire TV remote's keys do what they do everywhere else:

| Key | What it does |
|-----|--------------|
| D-pad | Moves the focus from card to card, button to button |
| Select | Picks what's focused |
| Back | Goes back a screen. In the player it hides the on-screen controls first, then leaves |
| Play/Pause | Starts and pauses playback |
| Rewind | Steps back 10 seconds |
| Fast forward | Steps on 30 seconds |
| Next | Plays the next episode, when one is queued |

## What's missing

- **No casting.** A Fire TV Stick is not a Chromecast and this app has no Google Cast support, so
  the phone's Cast button won't find it ([casting-and-games.md](casting-and-games.md)).
- **No Play Store, so no Play Store updates.** There is no store listing, and the APK is not signed
  for one. Updates come from the Hub: download the new APK from the Hub's setup page (or the same
  address as above) and install it over the top. Your profile, the Hub's address and any downloads
  are kept.
- **No Google Play services at all**, which is the point: no sign-in, no location, no Play
  services crash at launch.
- **The phone remote is separate.** Pairing the stick with the TV does not make it a remote for the
  TV; that is [phone-remote.md](phone-remote.md).

## If it won't start

- **"App not installed"** when installing: an older copy signed with a different key is already
  there. Uninstall **UltimateTV** from Settings › Applications › Manage installed applications, then
  install again. Downloads saved on the stick are kept.
- **It installs and closes straight away**: check the model. A **Fire TV Stick 4K Select** or a
  stick from 2026 on is **Vega OS**, not Android, and this APK cannot run there.
- **It isn't in the home row**: it is under Settings › Applications › Manage installed applications
  as **UltimateTV**. Open it once from there and it should appear in the row afterwards. A very old
  launcher may need a restart of the stick.
- **"The Hub didn't answer"**: the address is wrong, or the stick is on a different network. The app
  looks for the Hub at `http://192.168.0.19:8095`; put your own in Settings. A guest Wi-Fi network
  that isolates clients from each other will do it too.
- **The remote's buttons do nothing**: press Back to wake the app, then try again; D-pad and Select
  are what move the focus, and nothing else does.
- **It plays with no sound, or stutters**: the stick's own audio and picture settings are the first
  place to look — Settings › Display & Sounds. The box's advice in
  [diagnostics.md](diagnostics.md) does not all apply to the stick, and a 4K stick decoding a 4K
  remux is doing well to manage it at all.
- **Anything else:** the Hub's `/api/diagnostics?format=text` says what the Hub saw of the stick,
  and [android-client.md](android-client.md) covers the parts the two builds share.
