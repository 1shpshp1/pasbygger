/* Service worker: keeps the app's own files on the phone, so it opens without a connection.
   The page itself is always fetched fresh when there is a connection, so a new version shows at once.
   Change the number in CACHE when you change an icon or the manifest. */
const CACHE = "pasbygger-v4";
const FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", function (e) {             // remove caches from older versions
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   // Google Sheet calls: not touched

  if (req.mode === "navigate") {                               // the page: newest version first, saved copy when offline
    e.respondWith(fetch(req)
      .then(function (res) {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); }
        return res;
      })
      .catch(() => caches.match("./index.html")));
    return;
  }

  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(function (res) {   // icons, logos and manifest: saved copy first
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
