// Service worker : garde le code de l'appli pour un usage sans réseau.
// (Les photos et chants sont stockés séparément par l'appli, cache "oiseaux-media-v1".)
const SHELL = "oiseaux-app-v8";
const FILES = ["./", "index.html", "style.css", "app.js", "quiz.js", "birds.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith("oiseaux-app-") && k !== SHELL).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return; // API Wikimedia : réseau direct
  if (url.pathname.includes("/photos/") || url.pathname.endsWith("/ambiance.mp3")) return; // vos fichiers : gérés par l'appli
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit ||
      fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
        return r;
      }).catch(() => caches.match("index.html")))
  );
});
