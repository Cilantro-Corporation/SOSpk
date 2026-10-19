/* km. España — service worker: la app funciona sin conexión tras la primera visita.
   Las provincias descargadas las guarda la propia app en la caché "kmes-provincias" (aquí no se tocan).
   Una versión nueva se instala y se activa sola; la app se recarga cuando es seguro (al volver a ella). */
'use strict';
var CACHE = 'kmes-app-v1.1.1';
var KEEP = [CACHE, 'kmes-provincias'];
var SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'js/config.js', 'js/core.js', 'js/coords.js', 'js/store.js', 'js/app.js',
  'data/index.json', 'data/borders.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/fonts/oswald-500.woff2', 'vendor/fonts/oswald-700.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', function (e) {
  // 'reload': archivos recién publicados, no los de la caché HTTP del navegador
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return KEEP.indexOf(k) < 0; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(cache, req) {
  return fetch(req).then(function (res) {
    if (res && res.ok && res.type === 'basic') cache.put(req, res.clone());
    return res;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;        // teselas del mapa: caché normal del navegador
  if (/\/data\/prov\//.test(url.pathname)) return;         // provincias: las gestiona la app
  if (/\/version\.json$/.test(url.pathname)) return;       // comprobación de versión: siempre de la red
  // Índice y límites: primero la red (datos nuevos al momento); sin conexión, la copia guardada
  if (/\/data\/(index|borders)\.json$/.test(url.pathname)) {
    e.respondWith(caches.open(CACHE).then(function (cache) {
      var net = fromNetwork(cache, req).catch(function () { return null; });
      var slow = new Promise(function (resolve) { setTimeout(resolve, 5000); });
      return Promise.race([net, slow]).then(function (res) {
        if (res && res.ok) return res;
        return cache.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || net.then(function (r) { return r || Response.error(); });
        });
      });
    }));
    return;
  }
  e.respondWith(caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fromNetwork(cache, req).catch(function () {
        if (hit) return hit;
        if (req.mode === 'navigate') return cache.match('index.html').then(function (r) { return r || Response.error(); });
        return Response.error();
      });
      return hit || net;
    });
  }));
});
