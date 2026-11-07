// The remote's own shell, kept on the phone so it opens instantly and survives a flaky Wi-Fi.
// Nothing under /api/ is cached: the keys you press must always reach the Hub, and a stale answer
// about what's playing on the TV would be a lie.
//
// Bump SHELL whenever the remote's HTML, its script or its icons change. The new worker installs a
// fresh cache and the old one is deleted on activate, so a Hub update can't leave an old page behind.
const SHELL = "utv-remote-v3";

// Everything the page needs to draw itself before the Hub has answered.
const FILES = [
  "/remote/",
  "/remote/index.html",
  "/remote/phone.js",
  "/remote/pair.js",
  "/remote/manifest.webmanifest",
  "/remote/icon-180.png",
  "/remote/icon-192.png",
  "/remote/icon-512.png",
];

// The Hub writes the TV's name into the manifest, so a renamed TV would keep the old name on the
// phone forever if this were cached like the rest. It is fetched fresh; the cached copy is only
// there for when the network is down.
const ALWAYS_FRESH = ["/remote/manifest.webmanifest"];

/** Fetches a request, refreshing the cache on a good answer. */
const fromNetwork = (request, pathname) =>
  fetch(request).then((response) => {
    // Fill in anything the install didn't have: a new icon, a share link's query string.
    if (response.ok && !ALWAYS_FRESH.includes(pathname)) {
      const copy = response.clone();
      caches.open(SHELL).then((cache) => cache.put(request, copy));
    }
    return response;
  });

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL)
      // One missing file must not fail the whole install, or the phone would keep the older shell.
      .then((cache) => Promise.all(FILES.map((file) => cache.add(file).catch(() => {}))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== SHELL).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only this Hub's own pages, only plain reads of them, and only the remote's own files. Anything
  // else — the Hub's API, another app's pages — is left to the browser.
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/remote/") || url.pathname.startsWith("/api/")) return;

  e.respondWith(
    caches.match(e.request).then((hit) => {
      // Nothing cached: the network is the only answer.
      if (!hit) return fromNetwork(e.request, url.pathname);
      // Cached: answer straight away, and refresh in the background so the next open is current.
      e.waitUntil(fromNetwork(e.request, url.pathname).catch(() => {}));
      return hit;
    }),
  );
});
