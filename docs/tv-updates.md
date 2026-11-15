# Updating the Samsung and LG apps

The Samsung and LG apps are installed on the TV from a computer, but **their screens come from the Hub**.
What you install is a small shell. Each time the app starts it asks the Hub which version of the screens it
has, downloads them if they changed, and runs them. So after you update the Hub (`tools/hub/update.sh`),
**closing and reopening the app on the TV is the whole update**. No computer, no cable, no reinstall.

**Not tested on a real TV.** It was run in a desktop browser against a Hub, including the fallbacks below.
Whether a Samsung or LG set lets the shell run downloaded code the same way is what the first install
will show. **Settings › About** names where the screens came from: `Hub <version>` or `packaged`.

## How it works

1. The shell (`boot.js`, in the package) reads the Hub address the app already knows.
2. It asks `/tv/samsung/manifest.json` (or `/tv/lg/`). The answer lists the files and a version that
   changes whenever any file does. The files are `samsung/` or `lg/` in this repository: the Hub image
   carries a copy.
3. Same version as the copy it saved last time: it runs the saved copy and downloads nothing. A new
   version: it downloads the files (a few hundred KB), saves them in the TV app's storage and runs them.
4. **The Hub isn't reachable** (away from home, Hub restarting): it runs the last saved copy. With
   nothing saved, it runs the screens packaged in the install. A TV that can't see the Hub still opens.
5. **A version that won't start** is remembered as bad on that TV, and the packaged screens run instead,
   so a broken update can't leave the TV on a blank screen. Fix it and push a new version: it is tried again.

## What still needs a reinstall

The shell only carries the screens. Reinstall from a computer ([samsung.md](samsung.md),
[lg.md](lg.md)) when one of these changes, which is rare:

- `boot.js`, `index.html`, the icon, `config.xml` (Samsung) or `appinfo.json` (LG), including privileges.
- Samsung's **certificate expiring**, and LG's **Developer Mode session running out** (see
  [lg.md](lg.md)): both are about the install itself, not the screens.

## Staying safe

- The Hub only serves the screens at `/tv/samsung/` and `/tv/lg/`, read-only, and everything the app does
  after that still needs the paired device token. Anyone who can reach the Hub can read those files, and
  the app has no secrets in it.
- An app installed as a package has no web address, so the browser engine would refuse to let it call the
  Hub. Samsung allows it in `config.xml`. For LG the Hub now answers those requests (`Origin: null` or
  `file://`) with permissive CORS headers on `/api/` and `/tv/`, and for nothing else. Normal web pages
  get none.
