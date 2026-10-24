# Getting the app onto the VIDAA home screen

Phase 0 tries both routes on the real TV and records which one works on this firmware.

## Route 1: browser bookmark (always works)

1. Open the VIDAA **Browser** app.
2. Go to `http://<server-ip>:8080/` (the probe now, the app later).
3. Add a bookmark. Some VIDAA versions let you pin a bookmark to the home screen.

Downsides: it opens inside the browser, so the browser's own bar may show, and the Back key may be caught by the browser.

## Route 2: vidaa-edge launcher icon (looks like a real app, but fragile)

The community *vidaa-edge* project installs a hosted web app as a proper launcher icon. You temporarily point the TV's DNS at a helper running on your network, open `vidaahub.com` on the TV, and add the app's URL. Steps change between releases, so follow the project's current README rather than a copy here.

Things to note during the test:

- VIDAA version (*Settings → Support → System Info*) and whether the icon appears.
- Whether the app opens full screen with no browser bar.
- Whether the Back key reaches the app (the probe's *Remote keys* step shows this).
- Set the TV's DNS back to automatic afterwards, and check the icon still works.

Record the outcome in `docs/phase0/capability-matrix.md`. Re-test after each VIDAA firmware update.
