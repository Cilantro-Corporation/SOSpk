/* SOSpk — almacenamiento de provincias (sin conexión) y preferencias */
(function (root) {
  'use strict';

  var CFG = root.KM_CONFIG;
  var CACHE = 'kmes-provincias';
  var MAX_BYTES = 12 * 1024 * 1024;
  var hasCache = typeof caches !== 'undefined' && root.isSecureContext !== false;

  function cacheKey(code) { return new URL('kmes-prov/' + code + '.json', root.location.href).href; }

  function readText(res) {
    if (!res || !res.ok) throw new Error('HTTP ' + (res ? res.status : '?'));
    var len = +res.headers.get('content-length');
    if (len && len > MAX_BYTES) throw new Error('archivo demasiado grande');
    return res.text().then(function (t) {
      if (t.length > MAX_BYTES) throw new Error('archivo demasiado grande');
      return t;
    });
  }

  function parseProvince(text, code) {
    var d = JSON.parse(text);
    if (!root.KMCore.validProvince(d, code)) throw new Error('datos no válidos');
    return d;
  }

  function fetchJson(url) {
    return fetch(url, { credentials: 'omit', cache: 'no-cache', redirect: 'follow' }).then(readText).then(function (t) {
      return { text: t };
    });
  }

  // Busca la provincia: 1) guardada en el móvil, 2) archivo de la propia app/web, 3) web pública
  function getProvince(code, version) {
    if (!/^[A-Z]{1,2}$/.test(code)) return Promise.reject(new Error('código no válido'));
    var cached = null;
    var fromCache = !hasCache ? Promise.resolve(null) : caches.open(CACHE).then(function (c) {
      return c.match(cacheKey(code));
    }).then(function (res) {
      return res ? res.text() : null;
    }).then(function (t) {
      if (!t) return null;
      try { cached = parseProvince(t, code); } catch (e) { cached = null; }
      return cached && (!version || cached.v === version) ? cached : null;
    }).catch(function () { return null; });

    return fromCache.then(function (hit) {
      if (hit) return hit;
      var local = 'data/prov/' + code + '.json';
      var remote = CFG.remoteBase + 'data/prov/' + code + '.json';
      var sameOrigin = new URL(CFG.remoteBase).origin === root.location.origin;
      function load(url) { return fetchJson(url).then(function (r) { return { d: parseProvince(r.text, code), text: r.text }; }); }
      function fresh(x) { return !version || x.d.v === version; }
      // APK: si la copia incluida en la app es más antigua que el índice, se pide la de la web
      return load(local).then(function (x) {
        if (fresh(x) || sameOrigin) return x;
        return load(remote).then(function (y) { return fresh(y) || y.d.v > x.d.v ? y : x; }, function () { return x; });
      }, function (e) {
        if (sameOrigin) throw e;
        return load(remote);
      }).then(function (x) {
        if (cached && cached.v > x.d.v) return cached; // nunca se sustituye lo guardado por algo más antiguo
        if (hasCache) {
          caches.open(CACHE).then(function (c) {
            return c.put(cacheKey(code), new Response(x.text, { headers: { 'Content-Type': 'application/json' } }));
          }).catch(function () { /* sin espacio: se usará en memoria */ });
        }
        return x.d;
      }).catch(function (e) {
        if (cached) return cached; // versión antigua guardada: mejor que nada sin conexión
        throw e;
      });
    });
  }

  function removeProvince(code) {
    if (!hasCache) return Promise.resolve();
    return caches.open(CACHE).then(function (c) { return c.delete(cacheKey(code)); }).catch(function () { /* */ });
  }

  function storedProvinces() {
    if (!hasCache) return Promise.resolve([]);
    return caches.open(CACHE).then(function (c) { return c.keys(); }).then(function (keys) {
      return keys.map(function (k) { var m = /kmes-prov\/([A-Z]{1,2})\.json$/.exec(k.url); return m && m[1]; }).filter(Boolean);
    }).catch(function () { return []; });
  }

  // ---- Topónimos: municipios de España, lugares de cada provincia y parajes (descarga opcional) ----
  // kind: 'municipios' (code '') | 'lugares' | 'parajes'. Primero lo guardado (si es de esa versión), luego la app
  // o la web. Sin conexión vale lo guardado aunque sea antiguo.
  function placesKey(kind, code) { return new URL('kmes-' + kind + '/' + (code || 'es') + '.json', root.location.href).href; }
  function placesPath(kind, code) { return kind === 'municipios' ? 'data/municipios.json' : 'data/' + kind + '/' + code + '.json'; }
  function parsePlaces(text, kind, code) {
    var d = JSON.parse(text);
    var ok = kind === 'municipios' ? root.KMCore.validMunicipios(d) : kind === 'camaras' ? root.KMCore.validCamaras(d, code) : root.KMCore.validPlaces(d, code);
    if (!ok) throw new Error('datos no válidos');
    return d;
  }
  function getPlaces(kind, code, version) {
    if (!/^(municipios|lugares|parajes|camaras)$/.test(kind) || (kind !== 'municipios' && !/^[A-Z]{1,2}$/.test(code))) return Promise.reject(new Error('no válido'));
    var cached = null;
    var fromCache = !hasCache ? Promise.resolve(null) : caches.open(CACHE).then(function (c) { return c.match(placesKey(kind, code)); })
      .then(function (res) { return res ? res.text() : null; })
      .then(function (t) {
        if (!t) return null;
        try { cached = parsePlaces(t, kind, code); } catch (e) { cached = null; }
        return cached && (!version || String(cached.v) === String(version)) ? cached : null;
      }).catch(function () { return null; });
    return fromCache.then(function (hit) {
      if (hit) return hit;
      var sameOrigin = new URL(CFG.remoteBase).origin === root.location.origin;
      function load(url) { return fetchJson(url).then(function (r) { return { d: parsePlaces(r.text, kind, code), text: r.text }; }); }
      return load(placesPath(kind, code)).then(function (x) {
        if (sameOrigin || !version || String(x.d.v) === String(version)) return x;
        return load(CFG.remoteBase + placesPath(kind, code)).catch(function () { return x; });
      }, function (e) {
        if (sameOrigin) throw e;
        return load(CFG.remoteBase + placesPath(kind, code));
      }).then(function (x) {
        if (cached && cached.v > x.d.v) return cached;
        if (hasCache) caches.open(CACHE).then(function (c) {
          return c.put(placesKey(kind, code), new Response(x.text, { headers: { 'Content-Type': 'application/json' } }));
        }).catch(function () { /* sin espacio */ });
        return x.d;
      }).catch(function (e) {
        if (cached) return cached;
        throw e;
      });
    });
  }
  function removePlaces(kind, code) {
    if (!hasCache) return Promise.resolve();
    return caches.open(CACHE).then(function (c) { return c.delete(placesKey(kind, code)); }).catch(function () { /* */ });
  }

  // ---- Índice y límites más nuevos que los incluidos en la app (APK), guardados para usarlos sin conexión ----
  function dataKey(name) { return new URL('kmes-data/' + name + '.json', root.location.href).href; }
  function storedData() {
    if (!hasCache) return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) {
      return Promise.all(['index', 'borders'].map(function (n) {
        return c.match(dataKey(n)).then(function (r) { return r ? r.text() : null; });
      }));
    }).then(function (t) {
      return t[0] && t[1] ? { index: JSON.parse(t[0]), borders: JSON.parse(t[1]) } : null;
    }).catch(function () { return null; });
  }
  function storeData(index, borders) {
    if (!hasCache) return Promise.resolve();
    return caches.open(CACHE).then(function (c) {
      var put = function (n, v) { return c.put(dataKey(n), new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } })); };
      return Promise.all([put('index', index), put('borders', borders)]);
    }).catch(function () { /* */ });
  }

  // ---- Preferencias (localStorage, siempre validadas al leer) ----
  function readJSON(k, fallback) {
    try { var v = JSON.parse(root.localStorage.getItem('kmes.' + k)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function writeJSON(k, v) {
    try { root.localStorage.setItem('kmes.' + k, JSON.stringify(v)); } catch (e) { /* modo privado */ }
  }

  root.KMStore = {
    getProvince: getProvince,
    removeProvince: removeProvince,
    storedProvinces: storedProvinces,
    getPlaces: getPlaces,
    removePlaces: removePlaces,
    storedData: storedData,
    storeData: storeData,
    readJSON: readJSON,
    writeJSON: writeJSON,
    loadJSON: function (path) {
      return fetch(path, { credentials: 'omit', cache: 'no-cache' }).then(readText).then(JSON.parse);
    },
  };
})(window);
