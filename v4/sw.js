const CACHE_NAME = "precificador-v4-20260717-1";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.webmanifest",
  "./icon.svg",
  "./js/app.js",
  "./js/cache.js",
  "./js/domain.js",
  "./js/migration.js",
  "./js/pdf.js",
  "./js/repository.js"
];
const SUPABASE_LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await cache.addAll(APP_ASSETS);
    await cache.add(SUPABASE_LIBRARY).catch(() => undefined);
  }).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("precificador-v4-") && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    throw error;
  }
}

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isApp = url.origin === self.location.origin && url.pathname.includes("/v4/");
  const isSupabaseLibrary = url.href.startsWith(SUPABASE_LIBRARY);
  if (isApp || isSupabaseLibrary) event.respondWith(networkFirst(event.request));
});
