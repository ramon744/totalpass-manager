const CACHE_NAME = "totalpass-v2";
const STATIC_ASSETS = ["/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.json" ||
    /\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Nunca cacheia dados dinâmicos: APIs, navegações e payloads RSC do Next.
  // Garante que os dados estejam sempre frescos (sem servir versões antigas).
  const isRsc =
    request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
  const isApi = url.pathname.startsWith("/api");
  const isDocument = request.mode === "navigate";

  if (isApi || isDocument || isRsc) {
    event.respondWith(fetch(request));
    return;
  }

  // Cache-first apenas para assets estáticos versionados.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        return (
          cached ||
          fetch(request).then((response) => {
            if (!response || response.status !== 200 || response.type !== "basic") {
              return response;
            }
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
            return response;
          })
        );
      })
    );
    return;
  }

  // Demais GETs: rede direto.
  event.respondWith(fetch(request));
});
