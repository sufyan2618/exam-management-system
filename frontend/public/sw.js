const prefix = "exam-shell-";
const cacheName = prefix + new URL(self.location.href).search;
const shell = "/index.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const response = await fetch(shell, { cache: "no-store" });
    if (!response.ok) throw new Error("Application shell is unavailable");
    const markup = await response.clone().text();
    const assets = [...markup.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)]
      .map((match) => match[1]);
    await cache.addAll([...new Set(assets)]);
    await cache.put(shell, response);
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && !url.pathname.startsWith("/api/") && !url.pathname.includes(".")) {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(cacheName);
      return await cache.match(shell) ?? Response.error();
    }));
  } else if (url.pathname.startsWith("/assets/") && ["script", "style", "font", "image"].includes(request.destination)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && !response.redirected) await cache.put(request, response.clone());
      return response;
    })());
  }
});
