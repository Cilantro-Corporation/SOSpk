/* SOSpk — interfaz */
(function () {
  'use strict';

  // No se permite abrir la app incrustada dentro de otra web (evita engaños tipo "clickjacking")
  if (window.top !== window.self) {
    document.body.textContent = 'Abre SOSpk directamente en el navegador.';
    return;
  }

  var CFG = window.KM_CONFIG, K = window.KMCore, KC = window.KMCoords, S = window.KMStore;
  var $ = function (id) { return document.getElementById(id); };

  var ua = navigator.userAgent || '';
  var IS_IOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var IS_APPLE = IS_IOS || /Macintosh/.test(ua);
  var IS_NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  // ---------- Utilidades DOM (nunca innerHTML con datos) ----------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  var toastTimer;
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, ms || 2400);
  }
  function fmtLL(lat, lon, d) { return lat.toFixed(d || 5) + ', ' + lon.toFixed(d || 5); }

  // ---------- Estado ----------
  var index = null, borders = null, C = null;
  var provData = {};      // provincias cargadas
  var provState = {};     // code -> 'ok' | 'loading' | 'error'
  var selected = [];      // provincias elegidas por el usuario
  var provByCode = {};

  function saveSelected() { S.writeJSON('provs', selected); }
  function readSelected() {
    var v = S.readJSON('provs', null);
    if (!Array.isArray(v)) v = CFG.defaultProvinces.slice();
    return v.filter(function (c, i) { return typeof c === 'string' && provByCode[c] && v.indexOf(c) === i; });
  }

  // ---------- Premium (marco preparado; apagado hasta que estén las compras de Google Play) ----------
  // Con PRE.enforced = false y sin modo de pruebas, la app se comporta como siempre: nada bloqueado y sin botón «Capas».
  // El modo de pruebas (siete toques en la versión, en Configuración) activa el marco para poder probar lo gratis y lo
  // Premium. Cuando haya compras reales, simPremium se sustituye por el estado de la suscripción y se quita el modo de pruebas.
  var PRE = CFG.premium;
  var TESTERS = PRE.testers === true; // versión para probadores: casilla visible para probar Premium
  var devMode = TESTERS || S.readJSON('dev', false) === true;
  var simPremium = S.readJSON('prem', false) === true;
  function framework() { return !!(PRE.enforced || devMode); }
  function isPremium() { return !framework() || simPremium; }
  var premiumReason = '';
  function showPremium(reason) {
    premiumReason = reason || '';
    $('layersPop').hidden = true;
    renderPremium();
    $('premiumPanel').hidden = false;
  }
  function renderPremium() {
    var r = $('premReason');
    r.textContent = premiumReason;
    r.hidden = !premiumReason;
    var on = isPremium();
    $('premiumGo').textContent = on ? (devMode ? 'Premium de prueba activo: desactivar' : 'Ya eres Premium') : devMode ? 'Activar Premium de prueba' : 'Probar ' + PRE.trialDays + ' días gratis';
    $('premiumGo').classList.toggle('on', on);
    $('premPrice').textContent = PRE.priceYear + ' al año · o ' + PRE.priceMonth + ' al mes · ' + PRE.trialDays + ' días de prueba gratis';
  }
  $('premiumGo').addEventListener('click', function () {
    if (devMode) { simPremium = !simPremium; S.writeJSON('prem', simPremium); premiumChanged(); renderPremium(); toast(simPremium ? 'Premium de prueba activado' : 'Premium de prueba desactivado'); return; }
    if (PRE.checkoutUrl) { openLink(PRE.checkoutUrl); return; }
    toast('La suscripción estará disponible en Google Play');
  });
  $('testPrem').addEventListener('change', function () { simPremium = $('testPrem').checked; S.writeJSON('prem', simPremium); premiumChanged(); renderPremium(); toast(simPremium ? 'Premium de prueba activado' : 'Premium de prueba desactivado'); });
  $('whatGo').addEventListener('click', function () { $('settings').hidden = true; showPremium(''); });
  $('premiumClose').addEventListener('click', function () { $('premiumPanel').hidden = true; });
  // Al cambiar de plan se vuelve a pintar lo que depende de él
  function premiumChanged() {
    applyPremiumUi();
    renderSettingsList();
    renderFavMarkers();
    if (!$('favEdit').hidden && editing) editFav(editing); // el editor de favoritos abierto muestra lo nuevo
    if (isPremium()) selected.forEach(function (c) { if (provData[c]) loadProvincePlaces(c); });
    renderZonas(); applyLayers(); renderLayers();
    if (document.activeElement === roadInput) renderSuggest();
  }
  function applyPremiumUi() {
    var fw = framework();
    $('btnLayers').hidden = !fw;
    $('whatPrem').hidden = !fw;
    $('legendPrem').hidden = !fw;
    $('creditsPrem').hidden = !fw;
    $('planName').textContent = isPremium() ? 'Premium' : 'Gratis';
    $('devRow').hidden = !devMode || TESTERS;
    $('testRow').hidden = !TESTERS;
    $('testPrem').checked = simPremium;
    if (!fw) $('layersPop').hidden = true;
  }
  $('btnLayers').addEventListener('click', function () {
    var pop = $('layersPop');
    if (!pop.hidden) { pop.hidden = true; return; }
    renderLayers();
    pop.hidden = false;
  });
  $('layersClose').addEventListener('click', function () { $('layersPop').hidden = true; });
  $('planBtn').addEventListener('click', function () { $('settings').hidden = true; showPremium(''); });
  $('devOff').addEventListener('click', function () { devMode = false; S.writeJSON('dev', false); simPremium = false; S.writeJSON('prem', false); premiumChanged(); toast('Modo de pruebas desactivado'); });
  // Siete toques seguidos en la versión: modo de pruebas
  (function () {
    var taps = 0, timer = null;
    $('appVersion').addEventListener('click', function () {
      taps++;
      clearTimeout(timer);
      timer = setTimeout(function () { taps = 0; }, 3000);
      if (taps >= 7 && !TESTERS) { taps = 0; devMode = !devMode; S.writeJSON('dev', devMode); if (!devMode) { simPremium = false; S.writeJSON('prem', false); } premiumChanged(); toast(devMode ? 'Modo de pruebas activado' : 'Modo de pruebas desactivado'); }
    });
  })();

  // ---------- Mapa ----------
  var map = L.map('map', { zoomControl: false, minZoom: 5, maxZoom: 19, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    maxBounds: [[25, -22], [46, 8]] });
  map.attributionControl.setPrefix(false); // sin la bandera ni «Leaflet»; se mantiene la atribución de los datos
  var WMTS = 'https://www.ign.es/wmts/{svc}?service=WMTS&request=GetTile&version=1.0.0&layer={layer}&style=default&tilematrixset=GoogleMapsCompatible&format={fmt}&tilematrix={z}&tilerow={y}&tilecol={x}';
  var ATTR = '© <a href="https://www.ign.es" target="_blank" rel="noopener noreferrer">IGN</a> · PK: IGN, CartoCiudad · trazado © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OSM</a>';
  var baseMap = L.tileLayer(WMTS, { svc: 'ign-base', layer: 'IGNBaseTodo', fmt: 'image/png', maxNativeZoom: 17, maxZoom: 19, attribution: ATTR });
  var ortho = L.layerGroup([
    L.tileLayer(WMTS, { svc: 'pnoa-ma', layer: 'OI.OrthoimageCoverage', fmt: 'image/jpeg', maxNativeZoom: 19, maxZoom: 19, attribution: ATTR + ' · PNOA' }),
    L.tileLayer(WMTS, { svc: 'ign-base', layer: 'IGNBaseOrto', fmt: 'image/png', maxNativeZoom: 17, maxZoom: 19 }),
  ]);
  var satellite = S.readJSON('sat', false) === true;
  function applyLayer() {
    if (satellite) { map.removeLayer(baseMap); ortho.addTo(map); } else { map.removeLayer(ortho); baseMap.addTo(map); }
    $('btnLayer').classList.toggle('on', satellite);
  }
  applyLayer();
  if (window.matchMedia('(min-width: 760px)').matches) L.control.zoom({ position: 'topright' }).addTo(map);
  map.setView([40.2, -3.7], 6, { animate: false });

  // La tarjeta (buscador + ficha) puede estar arriba o, en el móvil, movida abajo: el mapa útil es el espacio libre
  function lowCard() { return !window.matchMedia('(min-width: 760px)').matches && document.querySelector('.top').getBoundingClientRect().top > window.innerHeight / 2; }
  function topOffset() { return lowCard() ? 0 : document.querySelector('.top').getBoundingClientRect().bottom; }
  // Altura real de la cabecera (cambia con la línea de tramos, sugerencias o avisos): coloca avisos, paneles y zoom
  function syncTop() { document.documentElement.style.setProperty('--top-h', Math.round(topOffset()) + 'px'); }
  if (window.ResizeObserver) new ResizeObserver(function () { applyPos(); }).observe(document.querySelector('.top'));
  syncTop();
  function bottomOffset() { return lowCard() ? window.innerHeight - document.querySelector('.top').getBoundingClientRect().top : 0; }
  // En tablet y PC los paneles flotan a la izquierda, uno debajo del otro: el mapa útil queda a su derecha
  var DESK = window.matchMedia('(min-width: 760px)');
  function panelRight() {
    if (!DESK.matches) return 0;
    var r = document.querySelector('.top').getBoundingClientRect();
    return r.left + r.width / 2 < window.innerWidth / 2 ? r.right : 0; // si se ha llevado a la derecha, no se compensa
  }

  // ---------- Tarjeta flotante: una sola caja (buscador + ficha) que se mueve ----------
  // Se mueve manteniendo pulsada una parte negra de la caja y arrastrando (ratón: pulsar y arrastrar; táctil: mantener
  // medio segundo). En el móvil solo sube y baja; en tablet y PC se coloca donde quieras. Recuerda su sitio.
  // Doble clic en una parte negra: vuelve a su sitio.
  var pos = S.readJSON('card', {});
  if (!pos || typeof pos !== 'object') pos = {};
  function validPos(p) { return Array.isArray(p) && p.length === 2 && isFinite(p[0]) && isFinite(p[1]); }
  function clampX(x, n) { return Math.round(Math.max(0, Math.min(window.innerWidth - (n.offsetWidth || 400), x))); }
  function clampY(y, n) { return Math.round(Math.max(0, Math.min(window.innerHeight - (n.offsetHeight || 60), y))); }
  function applyPos() {
    var top = document.querySelector('.top'), p = DESK.matches ? pos.d : pos.m;
    if (DESK.matches && validPos(p)) { top.style.left = clampX(p[0], top) + 'px'; top.style.top = clampY(p[1], top) + 'px'; }
    else if (!DESK.matches && typeof p === 'number' && isFinite(p)) { top.style.left = ''; top.style.top = clampY(p, top) + 'px'; }
    else { top.style.left = top.style.top = ''; }
    document.documentElement.style.setProperty('--top-x', (DESK.matches ? Math.round(top.getBoundingClientRect().left) : 0) + 'px');
    syncTop();
  }
  (function () {
    var node = document.querySelector('.top'), start = null, timer = null, active = false, armed = false;
    var SKIP = 'button, input, a, select, textarea, label, .chip, .nl';
    function ok(e) { return !(e.target.closest && e.target.closest(SKIP)); }
    function cancel() { clearTimeout(timer); timer = null; }
    function move(cx, cy) {
      var y = clampY(cy - start[1], node);
      if (DESK.matches) { pos.d = [clampX(cx - start[0], node), y]; } else { pos.m = y; }
      applyPos();
    }
    function begin(cx, cy) {
      var r = node.getBoundingClientRect();
      start = [cx - r.left, cy - r.top];
      active = true;
      node.classList.add('dragging');
    }
    function end() {
      cancel();
      node.classList.remove('armed');
      if (active) { active = false; node.classList.remove('dragging'); S.writeJSON('card', pos); renderMarkers(); }
      armed = false; start = null;
    }
    // Ratón
    node.addEventListener('mousedown', function (e) {
      if (e.button !== 0 || !ok(e)) return;
      var r = node.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY;
      start = [x0 - r.left, y0 - r.top]; armed = true;
      function mm(ev) {
        if (!active && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) > 4) begin(x0, y0);
        if (active) { move(ev.clientX, ev.clientY); ev.preventDefault(); }
      }
      function mu() { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); end(); }
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
    // Táctil: mantener pulsado medio segundo sin mover el dedo y luego arrastrar
    node.addEventListener('touchstart', function (e) {
      cancel();
      if (e.touches.length !== 1 || !ok(e)) return;
      var t = e.touches[0], x0 = t.clientX, y0 = t.clientY;
      timer = setTimeout(function () {
        armed = true; begin(x0, y0); node.classList.add('armed');
      }, 450);
      node._t0 = [x0, y0];
    }, { passive: true });
    node.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!active) {
        if (node._t0 && t && Math.abs(t.clientX - node._t0[0]) + Math.abs(t.clientY - node._t0[1]) > 8) cancel();
        return;
      }
      move(t.clientX, t.clientY);
      e.preventDefault();
    }, { passive: false });
    node.addEventListener('touchend', end, { passive: true });
    node.addEventListener('touchcancel', end, { passive: true });
    node.addEventListener('dblclick', function (e) {
      if (!ok(e)) return;
      delete pos.d; delete pos.m; S.writeJSON('card', pos); applyPos(); renderMarkers();
    });
  })();
  if (DESK.addEventListener) DESK.addEventListener('change', applyPos); else if (DESK.addListener) DESK.addListener(applyPos);
  window.addEventListener('resize', applyPos);
  applyPos();
  function fitBounds(b) {
    if (!b) return;
    map.invalidateSize();
    map.fitBounds(b, { paddingTopLeft: [8 + panelRight(), DESK.matches ? 8 : topOffset() + 8], paddingBottomRight: [8, 8 + (DESK.matches ? 0 : bottomOffset())], animate: false, maxZoom: 13 });
  }
  function focusPoint(lat, lon, zoom) {
    var z = zoom == null ? Math.max(map.getZoom(), 15) : zoom;
    var size = map.getSize();
    var shift = DESK.matches ? [-panelRight() / 2, 0] : [0, size.y / 2 - (topOffset() + size.y - bottomOffset()) / 2];
    var pt = map.project([lat, lon], z).add(shift);
    map.setView(map.unproject(pt, z), z, { animate: true });
  }

  // Contorno lima de las provincias cargadas (unidas si son contiguas) y oscurecido exterior
  var outlineLayer = L.layerGroup().addTo(map);
  var accent = '#C6F400'; // color de la app (Apariencia): contorno de las provincias
  function drawOutline() {
    outlineLayer.clearLayers();
    var codes = Object.keys(provData);
    if (!borders || !codes.length) return;
    var o = borders.outline(codes);
    if (o.rings.length) {
      L.polygon([[[85, -180], [85, 180], [-85, 180], [-85, -180]]].concat(o.rings), {
        stroke: false, fillColor: '#0B0B0B', fillOpacity: 0.26, interactive: false,
      }).addTo(outlineLayer);
    }
    // Límite entre provincias contiguas descargadas: línea fina; el contorno exterior común, grueso
    // (la misma línea que el contorno, más fina, con su trazo oscuro debajo para que se vea sobre cualquier mapa)
    if (o.inner.length) {
      L.polyline(o.inner, { color: '#0B0B0B', weight: 3.5, opacity: 0.45, interactive: false }).addTo(outlineLayer);
      L.polyline(o.inner, { color: accent, weight: 1.5, opacity: 1, interactive: false }).addTo(outlineLayer);
    }
    L.polyline(o.lines, { color: '#0B0B0B', weight: 6, opacity: 0.45, interactive: false }).addTo(outlineLayer);
    L.polyline(o.lines, { color: accent, weight: 3, opacity: 1, interactive: false }).addTo(outlineLayer);
  }
  function loadedBounds() {
    var b = null;
    Object.keys(provData).forEach(function (c) {
      var bb = borders && borders.bbox(c);
      if (!bb) return;
      var lb = L.latLngBounds([bb[0], bb[1]], [bb[2], bb[3]]);
      b = b ? b.extend(lb) : lb;
    });
    return b;
  }

  // ---------- PK sobre el mapa ----------
  // Se eligen por prioridad y se pintan solo los que caben sin taparse (rejilla de huecos ocupados en pantalla):
  // carretera elegida > entrada/salida de autovías y nacionales > sus km intermedios > entrada/salida de
  // autonómicas > sus intermedios > entrada/salida de provinciales/locales > sus intermedios. Al acercar caben más.
  var pkLayer = L.layerGroup().addTo(map);
  var markerCache = {}, mGrid = {}, allMarkers = [], farList = [], byRoadIdx = {}, roadWeight = {};
  var hlRoad = null;
  var MCELL = 0.05, MAX_PK = 350;
  function dropMarkers() {
    Object.keys(markerCache).forEach(function (i) { pkLayer.removeLayer(markerCache[i].mk); });
    markerCache = {};
  }
  function indexMarkers() {
    dropMarkers();
    mGrid = {}; farList = []; byRoadIdx = {}; roadWeight = {};
    allMarkers = C ? C.markers() : [];
    allMarkers.forEach(function (m, i) {
      var k = Math.floor(m.lat / MCELL) + ':' + Math.floor(m.lon / MCELL);
      (mGrid[k] || (mGrid[k] = [])).push(i);
      (byRoadIdx[m.road] || (byRoadIdx[m.road] = [])).push(i);
      // De lejos solo pueden salir entradas/salidas y km redondos de autovías y nacionales
      if (m.end || ((m.type === 'A' || m.type === 'N') && m.km % 10 === 0)) farList.push(i);
    });
    // A igual prioridad, antes autovías que nacionales y las carreteras más largas en tus provincias
    Object.keys(byRoadIdx).forEach(function (n) {
      var inf = C.roadInfo(n), km = 0;
      if (inf) inf.mine.forEach(function (p) { p.ranges.forEach(function (r) { km += r[1] - r[0]; }); });
      roadWeight[n] = (inf && inf.type === 'A' ? 0 : inf && inf.type === 'N' ? 1 : 2) * 100000 - km;
    });
  }
  // Cada cuántos km se ven los intermedios según el zoom (0: ninguno)
  function stepMain(z) { return z >= 12 ? 1 : z >= 10.5 ? 5 : z >= 9 ? 10 : z >= 8 ? 20 : 50; }
  function stepOther(z) { return z >= 13 ? 1 : z >= 11.5 ? 5 : z >= 10.5 ? 10 : 0; }
  function stepSel(z) { return z >= 12 ? 1 : z >= 10.5 ? 5 : z >= 9 ? 10 : z >= 7.5 ? 20 : 50; }
  function every(km, st) { return st > 0 && km % st === 0; }
  // Menor = más importante; -1 = no toca a este zoom
  function priority(m, z) {
    if (m.road === hlRoad) return m.end || every(m.km, stepSel(z)) ? 0 : -1;
    if (m.type === 'A' || m.type === 'N') return m.end ? 1 : every(m.km, stepMain(z)) ? 2 : -1;
    if (m.type === 'R') return m.end ? (z >= 8.5 ? 3 : -1) : every(m.km, stepOther(z)) ? 4 : -1;
    return m.end ? (z >= 9.5 ? 5 : -1) : every(m.km, stepOther(z)) ? 6 : -1;
  }
  function roundness(km) { return km % 50 === 0 ? 0 : km % 20 === 0 ? 1 : km % 10 === 0 ? 2 : km % 5 === 0 ? 3 : 4; }
  // Cartel grande con el nombre solo al principio y al final de autovías, autopistas y nacionales; el resto, solo el km
  function bigSign(m) { return m.end && (m.type === 'A' || m.type === 'N'); }
  function labelOf(m) { return bigSign(m) ? m.road + '·' + K.formatKm(m.km) : K.formatKm(m.km); }
  function screenRect(sel) {
    var n = document.querySelector(sel);
    if (!n || n.hidden) return null;
    var r = n.getBoundingClientRect();
    return [r.left, r.top, r.right, r.bottom];
  }
  function overlaps(a, b) { return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]; }

  function renderMarkers() {
    if (!C) return;
    var z = map.getZoom(), size = map.getSize(), b = map.getBounds().pad(0.1);
    var cand = [], seen = {};
    function consider(i) {
      if (seen[i]) return;
      seen[i] = 1;
      var m = allMarkers[i];
      if (!b.contains([m.lat, m.lon])) return;
      var p = priority(m, z);
      if (p >= 0) cand.push([p, roadWeight[m.road] || 0, roundness(m.km), i]);
    }
    var la0 = Math.floor(b.getSouth() / MCELL), la1 = Math.floor(b.getNorth() / MCELL);
    var lo0 = Math.floor(b.getWest() / MCELL), lo1 = Math.floor(b.getEast() / MCELL);
    if (z >= 10.5 && (la1 - la0 + 1) * (lo1 - lo0 + 1) < 8000) {
      for (var a = la0; a <= la1; a++) for (var c = lo0; c <= lo1; c++) (mGrid[a + ':' + c] || []).forEach(consider);
    } else {
      farList.forEach(consider);
      if (hlRoad) (byRoadIdx[hlRoad] || []).forEach(consider);
    }
    cand.sort(function (x, y) { return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });

    // Antisolape: huecos ocupados en una rejilla de pantalla; la cabecera y la ficha tapan el mapa
    var CPX = 32, occ = {}, want = {}, n = 0;
    var blocked = [screenRect('.top'), screenRect('#sheet'), screenRect('.map-ctrls')].filter(Boolean);
    (favSpots || []).forEach(function (p) { // las estrellas de favoritos no se tapan
      var q = map.latLngToContainerPoint(p);
      blocked.push([q.x - 14, q.y - 14, q.x + 14, q.y + 14]);
    });
    function free(r) {
      for (var x = Math.floor(r[0] / CPX); x <= Math.floor(r[2] / CPX); x++) for (var y = Math.floor(r[1] / CPX); y <= Math.floor(r[3] / CPX); y++) {
        var list = occ[x + ':' + y];
        if (list) for (var k = 0; k < list.length; k++) if (overlaps(r, list[k])) return false;
      }
      return true;
    }
    function take(r) {
      for (var x = Math.floor(r[0] / CPX); x <= Math.floor(r[2] / CPX); x++) for (var y = Math.floor(r[1] / CPX); y <= Math.floor(r[3] / CPX); y++) {
        (occ[x + ':' + y] || (occ[x + ':' + y] = [])).push(r);
      }
    }
    // Al acercar se pierde de qué carretera es cada número: desde zoom 11 cada carretera visible lleva su nombre en
    // al menos un PK (el más importante que quepa), cada 10 km desde zoom 12,5 y en todos desde zoom 14.
    var named = {};
    function place(m, label, big) {
      var pt = map.latLngToContainerPoint([m.lat, m.lon]);
      var w = label.length * (big ? 7.4 : 6.6) + (m.type === 'R' ? 16 : 10), h = m.type === 'A' ? (big ? 27 : 23) : (big ? 22 : 19);
      var r = [pt.x - w / 2 - 6, pt.y - h / 2 - 5, pt.x + w / 2 + 6, pt.y + h / 2 + 5];
      if (r[0] < 0 || r[2] > size.x || r[1] < 0 || r[3] > size.y) return false; // solo etiquetas enteras
      if (blocked.some(function (br) { return overlaps(r, br); }) || !free(r)) return false;
      take(r);
      return true;
    }
    for (var j = 0; j < cand.length && n < MAX_PK; j++) {
      var m = allMarkers[cand[j][3]], big = bigSign(m), label = labelOf(m), full = m.road + '·' + K.formatKm(m.km);
      var wantName = !big && z >= 11 && (!named[m.road] || z >= 14 || (z >= 12.5 && m.km % 10 === 0));
      if (wantName && place(m, full, false)) label = full;
      else if (!place(m, label, big)) continue;
      if (label === full) named[m.road] = true;
      want[cand[j][3]] = { label: label, prio: cand[j][0] };
      n++;
    }

    Object.keys(markerCache).forEach(function (i) {
      var mc = markerCache[i];
      if (!want[i] || want[i].label !== mc.label || mc.hl !== (allMarkers[i].road === hlRoad)) { pkLayer.removeLayer(mc.mk); delete markerCache[i]; }
    });
    Object.keys(want).forEach(function (i) {
      if (markerCache[i]) return;
      var m = allMarkers[i], hl = m.road === hlRoad;
      var outer = document.createElement('span'), shape = document.createElement('span');
      outer.className = 'pk pk-' + m.type + (bigSign(m) ? ' big' : '') + (hl ? ' hl' : '');
      outer.title = m.road + ' km ' + K.formatKm(m.km);
      shape.className = 'pk-s';
      shape.textContent = want[i].label;
      outer.appendChild(shape);
      var mk = L.marker([m.lat, m.lon], { icon: L.divIcon({ className: 'pk-icon', html: outer, iconSize: null }), keyboard: false,
        riseOnHover: true, zIndexOffset: (7 - want[i].prio) * 100 });
      mk.on('click', function () {
        var d = m.road === selectedRoad ? dir : 0;
        var res = C.locate(m.road, m.km, d).sort(function (x, y) {
          return K.distance([x.lat, x.lon], [m.lat, m.lon]) - K.distance([y.lat, y.lon], [m.lat, m.lon]);
        });
        if (res.length) showResult(res, true);
      });
      markerCache[i] = { mk: mk.addTo(pkLayer), label: want[i].label, hl: hl };
    });
  }
  map.on('moveend', renderMarkers);

  // La carretera marcada se pinta con el color de sus PK (el lima queda solo para los límites de provincia)
  var TYPE_COLOR = { A: '#2F6BFF', N: '#FF4B3E', R: '#17A04A', P: '#F2D600' };
  var roadLine = L.layerGroup().addTo(map);
  function highlightRoad(name) {
    hlRoad = name;
    roadLine.clearLayers();
    if (name && C) {
      C.lines(name).forEach(function (pts) {
        L.polyline(pts, { color: '#0B0B0B', weight: 8, opacity: 0.5, interactive: false }).addTo(roadLine);
        L.polyline(pts, { color: TYPE_COLOR[C.typeOf(name)] || '#8F8F8F', weight: 4, opacity: 0.95, interactive: false }).addTo(roadLine);
      });
    }
    dropMarkers();
    renderMarkers();
  }

  var targetMarker = null;
  function setTarget(lat, lon) {
    if (targetMarker) map.removeLayer(targetMarker);
    targetMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: 'pk-icon', html: '<span class="target"></span>', iconSize: [30, 30], iconAnchor: [15, 34] }),
      interactive: false, zIndexOffset: 1000, keyboard: false,
    }).addTo(map);
  }

  // ---------- Carga de provincias ----------
  function rebuild() {
    C = K.create(index, provData);
    infoCacheReset();
    indexMarkers();
    drawOutline();
    renderFavMarkers();
    if (selectedRoad) highlightRoad(selectedRoad); else renderMarkers();
    renderSettingsList();
  }
  function infoCacheReset() { /* C nuevo => cachés nuevas */ }

  function loadProvince(code, quiet) {
    if (provData[code]) return Promise.resolve(true);
    provState[code] = 'loading';
    renderSettingsList();
    return S.getProvince(code, index.v).then(function (d) {
      provData[code] = d;
      provState[code] = 'ok';
      loadProvincePlaces(code);
      return true;
    }).catch(function () {
      provState[code] = 'error';
      if (!quiet) toast('No se pudo descargar ' + provByCode[code].name + (navigator.onLine ? '' : ' (sin conexión)'), 3500);
      renderSettingsList();
      return false;
    });
  }
  function addProvince(code, opts) {
    opts = opts || {};
    if (selected.indexOf(code) < 0) { selected.push(code); saveSelected(); }
    if (!opts.quiet) toast('Descargando ' + provByCode[code].name + '…', 8000);
    return loadProvince(code).then(function (ok) {
      if (ok) {
        rebuild();
        if (!opts.quiet) toast(provByCode[code].name + ' lista' + (opts.suffix || ''));
      }
      return ok;
    });
  }
  function removeProvince(code) {
    selected = selected.filter(function (c) { return c !== code; });
    saveSelected();
    delete provData[code];
    delete provState[code];
    S.removeProvince(code);
    dropProvincePlaces(code);
    rebuild();
  }
  function downloadButton(code, then) {
    return el('button', {
      type: 'button', class: 'dl', text: 'Descargar ' + provByCode[code].name,
      onclick: function () { addProvince(code).then(function (ok) { if (ok && then) then(); }); },
    });
  }

  // ---------- Topónimos: municipios, pueblos y parajes (Nomenclátor Geográfico Básico del IGN) ----------
  // Los municipios de toda España se cargan al empezar a escribir; los pueblos de cada provincia se descargan con
  // ella; los parajes son una descarga opcional por provincia (Configuración › Provincias).
  var placesMeta = null, placesMetaP = null, placeLists = {};
  var parajesOn = (function () {
    var v = S.readJSON('parajes', []);
    return Array.isArray(v) ? v.filter(function (c, i) { return typeof c === 'string' && /^[A-Z]{1,2}$/.test(c) && v.indexOf(c) === i; }) : [];
  })();
  function metaOk(m) { return !!m && /^\d{8,12}$/.test(String(m.v)) && !!m.sizes && typeof m.sizes === 'object' ? m : null; }
  function loadPlacesMeta() {
    if (placesMetaP) return placesMetaP;
    var local = S.loadJSON('data/lugares.json').then(metaOk, function () { return null; });
    // APK: la web puede tener topónimos más nuevos que los incluidos en la app
    var remote = IS_NATIVE ? S.loadJSON(CFG.remoteBase + 'data/lugares.json').then(metaOk, function () { return null; }) : Promise.resolve(null);
    placesMetaP = Promise.all([local, remote]).then(function (r) {
      placesMeta = r[1] && (!r[0] || r[1].v > r[0].v) ? r[1] : r[0];
      return placesMeta;
    });
    placesMetaP.then(function (m) { if (!m) placesMetaP = null; }); // sin conexión: se reintenta más tarde
    return placesMetaP;
  }
  var placePending = {};
  function loadPlaces(kind, code) {
    var id = kind + ':' + (code || '');
    if (placeLists[id]) return Promise.resolve(placeLists[id]);
    if (placePending[id]) return placePending[id];
    var p = placePending[id] = loadPlacesMeta().then(function (m) {
      if (m && kind !== 'municipios' && !m.sizes[code]) throw new Error('sin datos');
      return S.getPlaces(kind, code, m && m.v);
    }).then(function (d) {
      placeLists[id] = K.placeEntries(d, kind);
      return placeLists[id];
    });
    p.then(function () { delete placePending[id]; }, function () { delete placePending[id]; });
    return p;
  }
  // Pueblos de las provincias elegidas y sus parajes (si se pidieron); sin aviso si falla (no es imprescindible)
  function loadProvincePlaces(code) {
    if (!isPremium()) return Promise.resolve(); // municipios, pueblos y parajes son Premium: en gratis ni se descargan
    var jobs = [loadPlaces('lugares', code).catch(function () { return null; })];
    if (parajesOn.indexOf(code) >= 0) jobs.push(loadPlaces('parajes', code).catch(function () { return null; }));
    return Promise.all(jobs).then(function () { if (document.activeElement === roadInput) renderSuggest(); });
  }
  function dropProvincePlaces(code) {
    delete placeLists['lugares:' + code];
    delete placeLists['parajes:' + code];
    S.removePlaces('lugares', code);
    S.removePlaces('parajes', code);
    setParajes(code, false);
  }
  function setParajes(code, on) {
    parajesOn = parajesOn.filter(function (c) { return c !== code; });
    if (on) parajesOn.push(code);
    S.writeJSON('parajes', parajesOn);
    if (typeof syncPackage === 'function') { syncPackage(); renderCams(); loadAvisos(false); }
  }
  var parajesState = {}; // code -> 'loading' | 'error'
  function toggleParajes(code) {
    if (!isPremium()) { showPremium('Los parajes son una función Premium.'); return; }
    if (parajesOn.indexOf(code) >= 0) {
      setParajes(code, false);
      delete placeLists['parajes:' + code];
      S.removePlaces('parajes', code);
      toast('Parajes de ' + provByCode[code].name + ' borrados');
      renderSettingsList();
      return;
    }
    parajesState[code] = 'loading';
    renderSettingsList();
    loadPlaces('parajes', code).then(function (list) {
      delete parajesState[code];
      setParajes(code, true);
      toast(list.length.toLocaleString('es-ES') + ' parajes de ' + provByCode[code].name + ' listos para buscar');
      renderSettingsList();
    }, function () {
      parajesState[code] = 'error';
      toast('No se pudieron descargar los parajes' + (navigator.onLine ? '' : ' (sin conexión)'));
      renderSettingsList();
    });
  }
  // Sugerencias solo de las provincias descargadas (los municipios de fuera solo se usan para avisar)
  function placeHits(q) {
    if (!isPremium()) return [];
    var lists = Object.keys(placeLists).map(function (k) {
      return k === 'municipios:' ? placeLists[k].filter(function (e) { return provData[e.prov]; }) : placeLists[k];
    });
    // Nombres repetidos (varios «Camino de…»): como mucho dos de cada tipo
    var seenN = {};
    return K.searchPlaces(lists, q, 40).filter(function (p) {
      var k = p.n + '|' + p.t;
      seenN[k] = (seenN[k] || 0) + 1;
      return seenN[k] <= 2;
    }).slice(0, 8);
  }
  // Nombre completo de un municipio de una provincia no descargada: se avisa y se ofrece descargarla (como con los PK)
  function outsidePlace(q) {
    var k = K.key(q);
    if (k.length < 3 || !placeLists['municipios:'] || placeHits(q).some(function (p) { return K.key(p.n) === k; })) return null;
    return K.searchPlaces([placeLists['municipios:']], q, 8).filter(function (p) { return !provData[p.prov] && provByCode[p.prov] && K.key(p.n) === k; })[0] || null;
  }
  function warnOutside(p) {
    setInfo([
      el('span', null, [el('b', { text: p.n }), ' está en ', el('b', { text: provByCode[p.prov].name }), ', una zona que no tienes descargada.']),
      downloadButton(p.prov, function () { pickPlace(p); }),
    ], true);
  }
  function placeSub(p) {
    var prov = provByCode[p.prov] ? provByCode[p.prov].name : '';
    return p.rank === 2 ? p.t : p.rank === 0 ? prov : p.t === 'Entidad singular' || p.t === 'Núcleos de población' ? 'Pueblo · ' + prov : p.t + ' · ' + prov;
  }
  function placeChip(p) {
    return el('button', { type: 'button', class: 'chip place' + (p.rank === 2 ? ' paraje' : ''), role: 'option', onclick: function () { pickPlace(p); } }, [
      el('span', { class: 'pin', text: p.rank === 2 ? '⛰️' : '📍' }),
      el('span', { text: p.n }),
      el('small', { text: placeSub(p) }),
    ]);
  }
  function pickPlace(p) {
    roadInput.value = p.n;
    kmInput.value = '';
    selectedRoad = null; dir = 0;
    renderDir(); highlightRoad(null);
    suggestBox.hidden = true;
    $('clearRoad').hidden = false;
    roadInput.blur();
    setInfo(null);
    showCoord(p.lat, p.lon, p.rank === 0 ? joinDot(['Municipio', placeSub(p)]) : placeSub(p) || p.t, false, p.n);
  }

  // ---------- Buscador ----------
  var roadInput = $('road'), kmInput = $('km'), suggestBox = $('suggest'), info = $('info'), dirBtn = $('dirBtn');
  var selectedRoad = null, dir = 0;

  function setInfo(nodes, isErr) {
    clear(info);
    if (!nodes) { info.hidden = true; return; }
    // El texto va junto en un bloque; los botones de descarga, aparte
    var msg = null;
    (Array.isArray(nodes) ? nodes : [nodes]).forEach(function (n) {
      if (n == null) return;
      if (n.nodeType === 1 && (n.tagName === 'BUTTON' || n.classList.contains('seg'))) { info.appendChild(n); msg = null; return; }
      if (!msg) { msg = el('span'); info.appendChild(msg); }
      msg.appendChild(typeof n === 'string' ? document.createTextNode(n) : n);
    });
    info.classList.toggle('err', !!isErr);
    info.hidden = false;
  }
  function rangeText(rs) { return rs.map(function (r) { return r[0] === r[1] ? String(r[0]) : r[0] + '–' + r[1]; }).join(', '); }
  // Solo los tramos de las provincias descargadas (de las demás solo se avisa al buscar un km concreto)
  function roadInfoLine(name) {
    var inf = C.roadInfo(name);
    if (!inf) return null;
    if (!inf.mine.length) return [el('span', null, ['La ', el('b', { text: name }), ' no pasa por tus provincias. Escribe un km para saber dónde está.'])];
    var list = inf.mine.slice(0, 5);
    var out = list.map(function (p) {
      return el('span', { class: 'seg' }, [el('b', { text: p.name }), ' km ' + rangeText(p.ranges)]);
    });
    if (inf.mine.length > list.length) out.push(el('span', { class: 'seg off', text: '+ ' + (inf.mine.length - list.length) + ' de tus provincias' }));
    return out;
  }

  function chip(name) {
    var inf = C.roadInfo(name);
    return el('button', {
      type: 'button', class: 'chip' + (inf.loaded ? '' : ' off'), role: 'option',
      onclick: function () { pickRoad(name, true); },
    }, [
      el('span', { class: 'dot ty-' + inf.type }),
      el('span', { text: name }),
      el('small', { text: inf.min === inf.max ? 'km ' + inf.min : 'km ' + inf.min + '–' + inf.max }),
    ]);
  }

  function renderSuggest() {
    var val = roadInput.value;
    $('clearRoad').hidden = !val;
    clear(suggestBox);
    if (!C || looksLikeCoords(val)) { suggestBox.hidden = true; return; }
    var list = C.suggest(val, 20);
    if (selectedRoad && C.resolveRoad(val) === selectedRoad) list = list.filter(function (n) { return n !== selectedRoad; }).slice(0, 8);
    // Municipios, pueblos y parajes en la misma casilla: con letras solas van primero; con números, las carreteras
    var allowed = isPremium();
    var places = allowed && /[A-Za-zÀ-ÿ]{2}/.test(val) && !selectedRoad ? placeHits(val) : [];
    if (allowed && /[A-Za-zÀ-ÿ]{2}/.test(val) && !placeLists['municipios:']) loadPlaces('municipios').then(function () { roadInput.dispatchEvent(new Event('input')); }, function () { /* sin conexión */ });
    var chips = list.map(chip), pchips = places.map(placeChip);
    (/\d/.test(val) ? chips.concat(pchips) : pchips.concat(chips)).forEach(function (n) { suggestBox.appendChild(n); });
    // En gratis, una sola sugerencia con candado cuando no hay carreteras que coincidan
    if (!allowed && !selectedRoad && !list.length && /[A-Za-zÀ-ÿ]{3}/.test(val)) {
      suggestBox.appendChild(el('button', { type: 'button', class: 'chip lockchip', role: 'option', onclick: function () { showPremium('Buscar municipios, pueblos y parajes es una función Premium.'); } }, [
        el('span', { class: 'pin', text: '🔒' }), el('span', { text: 'Municipios y parajes' }), el('small', { text: 'Premium' }),
      ]));
    }
    suggestBox.hidden = !suggestBox.firstChild || document.activeElement !== roadInput;
  }
  function looksLikeCoords(v) { return /^\s*(https?:|geo:|[NSEWO]?\s*-?\d{1,3}[.,°º ]\d)/i.test(v) && !C.resolveRoad(v) && !C.parseQuery(v).road; }

  function renderDir() {
    var inf = selectedRoad && C && C.roadInfo(selectedRoad);
    var show = !!(inf && inf.dual);
    dirBtn.hidden = !show;
    if (!show) { dir = 0; return; }
    var up = K.cardinal(inf.heading), down = K.cardinal(inf.heading + 180);
    dirBtn.textContent = dir === 1 ? '↑ ' + up : dir === -1 ? '↓ ' + down : '⇅';
    dirBtn.classList.toggle('set', dir !== 0);
    dirBtn.setAttribute('aria-label', dir === 1 ? 'Sentido km creciente, hacia ' + up : dir === -1 ? 'Sentido km decreciente, hacia ' + down : 'Ambos sentidos');
  }

  function pickRoad(name, focusKm) {
    selectedRoad = name;
    roadInput.value = name;
    dir = 0;
    renderDir();
    highlightRoad(name);
    suggestBox.hidden = true;
    $('clearRoad').hidden = false;
    setInfo(roadInfoLine(name));
    if (focusKm) kmInput.focus();
  }

  roadInput.addEventListener('input', function () {
    if (!C) return;
    var r = C.resolveRoad(roadInput.value) || C.parseQuery(roadInput.value).road;
    if (r !== selectedRoad) { selectedRoad = r; dir = 0; renderDir(); highlightRoad(r); }
    renderSuggest();
    var out = !selectedRoad && !/\d/.test(roadInput.value) && outsidePlace(roadInput.value);
    if (selectedRoad) setInfo(roadInfoLine(selectedRoad));
    else if (out) warnOutside(out);
    else setInfo(null);
  });
  // Nombres largos (municipios, parajes): la letra de la casilla se reduce poco a poco hasta 14 px; a partir de ahí el
  // texto se desplaza como siempre. En iPhone, mientras se escribe, nunca baja de 16 px (por debajo, Safari hace zoom).
  var fitCtx = document.createElement('canvas').getContext('2d');
  function fitRoad() {
    var cs = getComputedStyle(roadInput), text = roadInput.value.toUpperCase();
    var max = 18, min = IS_IOS && document.activeElement === roadInput ? 16 : 14, size = max;
    var avail = roadInput.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 4;
    if (text && avail > 0) {
      fitCtx.font = '700 ' + max + 'px ' + cs.fontFamily;
      var w = fitCtx.measureText(text).width + text.length * 0.5;
      if (w > avail) size = Math.max(min, Math.floor((max * avail / w) * 2) / 2);
    }
    roadInput.style.fontSize = size === max ? '' : size + 'px';
  }
  // También cuando la app cambia el texto (al elegir un lugar, un favorito, un PK del mapa…)
  (function () {
    var desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (!desc || !desc.set) return;
    Object.defineProperty(roadInput, 'value', { configurable: true,
      get: function () { return desc.get.call(this); },
      set: function (v) { desc.set.call(this, v); fitRoad(); } });
  })();
  roadInput.addEventListener('input', fitRoad);
  // Antes de que el iPhone decida si hace zoom al tocar la casilla
  roadInput.addEventListener('pointerdown', function () { if (IS_IOS && parseFloat(roadInput.style.fontSize) < 16) roadInput.style.fontSize = '16px'; });
  roadInput.addEventListener('blur', function () { setTimeout(fitRoad, 0); });
  window.addEventListener('resize', fitRoad);
  roadInput.addEventListener('focus', function () {
    fitRoad();
    renderSuggest();
  });
  roadInput.addEventListener('blur', function () { setTimeout(function () { if (document.activeElement !== roadInput) suggestBox.hidden = true; }, 200); });
  roadInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    var q = C.parseQuery(roadInput.value);
    if (q.road && isFinite(q.km)) { pickRoad(q.road, false); kmInput.value = K.formatKm(q.km); search(); return; }
    if (q.road) { pickRoad(q.road, true); return; }
    if (KC.parse(roadInput.value)) { search(); return; }
    var first = C.suggest(roadInput.value, 1)[0];
    var place = /\d/.test(roadInput.value) ? null : placeHits(roadInput.value)[0];
    var out = place || first ? null : outsidePlace(roadInput.value);
    if (out) warnOutside(out);
    else if (place && (!first || C.resolveRoad(roadInput.value) !== first)) pickPlace(place);
    else if (first) pickRoad(first, true);
  });
  $('clearRoad').addEventListener('click', function () {
    roadInput.value = ''; kmInput.value = ''; selectedRoad = null; dir = 0;
    renderDir(); highlightRoad(null); setInfo(null); closeSheet();
    roadInput.focus();
  });
  dirBtn.addEventListener('click', function () {
    dir = dir === 0 ? 1 : dir === 1 ? -1 : 0;
    renderDir();
    if (current && current.road === selectedRoad && kmInput.value.trim()) search();
  });
  $('searchForm').addEventListener('submit', function (e) { e.preventDefault(); search(); });

  function search() {
    if (!C) return;
    var raw = roadInput.value.trim();
    var q = C.parseQuery(raw);
    var road = selectedRoad || q.road;
    // ¿Coordenadas o enlace?
    if (!road) {
      var co = KC.parse(raw);
      if (co) { searchCoords(co); return; }
      road = C.suggest(raw, 1)[0];
      var place = /\d/.test(raw) ? null : placeHits(raw)[0];
      if (place && !C.resolveRoad(raw)) { pickPlace(place); return; }
      var out = !road && !/\d/.test(raw) ? outsidePlace(raw) : null;
      if (out) { warnOutside(out); return; }
    }
    var km = K.parseKm(kmInput.value);
    if (!isFinite(km) && q.road && isFinite(q.km)) { km = q.km; road = q.road; }
    if (!road) { setInfo('No encuentro esa carretera, lugar ni coordenadas.', true); roadInput.focus(); return; }
    if (road !== selectedRoad) pickRoad(road, false);
    var inf = C.roadInfo(road);
    if (!kmInput.value.trim()) {
      setInfo(roadInfoLine(road));
      kmInput.focus();
      var ls = C.lines(road);
      if (ls.length) fitBounds(L.latLngBounds([].concat.apply([], ls)));
      return;
    }
    if (!isFinite(km)) { setInfo('Km no válido. Ejemplos: 44 · 44,3 · 44+300', true); kmInput.focus(); return; }
    var res = C.locate(road, km, dir);
    if (!res.length) {
      var where = C.provincesForKm(road, km);
      var missing = where.filter(function (p) { return !p.loaded; });
      if (missing.length) {
        setInfo([
          el('span', null, ['La ', el('b', { text: road }), ' km ' + K.formatKm(km) + ' está en ', el('b', { text: missing.map(function (p) { return p.name; }).join(' / ') }), ', fuera de tus provincias.']),
          downloadButton(missing[0].prov, search),
        ], true);
      } else {
        var mineHere = where.filter(function (p) { return p.loaded; });
        var tramos = inf.mine.length ? ' Tramos en tus provincias: ' + inf.mine.map(function (p) { return p.name + ' ' + rangeText(p.ranges); }).join(' · ') : '';
        setInfo([el('span', null, mineHere.length ?
          ['No hay hitos cerca del km ' + K.formatKm(km) + ' de la ', el('b', { text: road }), ' en ' + mineHere.map(function (p) { return p.name; }).join(' / ') + '.' + tramos] :
          ['El km ' + K.formatKm(km) + ' de la ', el('b', { text: road }), ' no existe.' + tramos])], true);
      }
      return;
    }
    setInfo(roadInfoLine(road));
    roadInput.blur(); kmInput.blur();
    showResult(res, false);
  }

  function searchCoords(co) {
    if (co.short) { resolveShortLink(roadInput.value.trim()); return; }
    roadInput.blur();
    showCoord(co.lat, co.lon, co.format);
  }

  // Enlaces cortos de Google (maps.app.goo.gl): no llevan coordenadas. En la app Android se resuelven
  // con una petición nativa solo a ese dominio; en la web se pide el enlace completo.
  function resolveShortLink(url) {
    var http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (!IS_NATIVE || !http || !/^https:\/\/maps\.app\.goo\.gl\/[A-Za-z0-9_-]{4,40}$/.test(url)) {
      setInfo('Los enlaces cortos de Google Maps no incluyen las coordenadas. Ábrelo, pulsa «Compartir → Copiar» en el punto o copia las coordenadas y pégalas aquí.', true);
      return;
    }
    toast('Leyendo el enlace…');
    http.get({ url: url, responseType: 'text', connectTimeout: 8000, readTimeout: 8000 }).then(function (r) {
      var finalUrl = String(r && r.url || '');
      var host = '';
      try { host = new URL(finalUrl).hostname; } catch (e) { /* */ }
      var co = /(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$/.test(host) ? KC.parse(finalUrl) : null;
      if (co && !co.short) showCoord(co.lat, co.lon, 'Google Maps');
      else setInfo('No he podido leer las coordenadas de ese enlace. Copia las coordenadas y pégalas aquí.', true);
    }).catch(function () { setInfo('Sin conexión para leer el enlace corto. Pega las coordenadas directamente.', true); });
  }

  // ---------- Ficha de resultado ----------
  var current = null, alternatives = [], altIdx = 0;

  function navLinks(lat, lon) {
    var ll = lat.toFixed(6) + ',' + lon.toFixed(6);
    return {
      google: 'https://www.google.com/maps/dir/?api=1&destination=' + ll + '&travelmode=driving',
      apple: 'https://maps.apple.com/?daddr=' + ll + '&dirflg=d',
      view: 'https://www.google.com/maps/search/?api=1&query=' + ll,
    };
  }
  function dirLabel(r) {
    if (!r.dir) return '';
    var inf = C.roadInfo(r.road);
    return (r.dir === 1 ? '↑ ' + K.cardinal(inf.heading) : '↓ ' + K.cardinal(inf.heading + 180));
  }
  function label(r) {
    if (r.me && r.near[0]) return r.near[0].road + ' km ' + K.formatKm(round1(r.near[0].km)) + ' ≈ (mi ubicación)';
    if (r.place) return r.place + ' · ' + fmtLL(r.lat, r.lon);
    if (r.coord) return fmtLL(r.lat, r.lon);
    return r.road + ' km ' + K.formatKm(r.km) + (r.exact ? '' : ' ≈') + (r.dir ? ' (' + dirLabel(r) + ')' : '');
  }

  function showResult(list, fromMap) {
    if (!list || !list.length) return;
    alternatives = list; altIdx = 0;
    if (fromMap && list[0].road !== selectedRoad) {
      selectedRoad = list[0].road; roadInput.value = selectedRoad; dir = list[0].dir || 0;
      renderDir(); highlightRoad(selectedRoad); setInfo(roadInfoLine(selectedRoad)); suggestBox.hidden = true;
      $('clearRoad').hidden = false;
    }
    if (fromMap) kmInput.value = K.formatKm(list[0].km);
    renderResult();
    addRecent(current);
    // El mismo km en varios sitios: se ven todos en el mapa (con su número) para elegir el que se busca
    if (list.length > 1 && !fromMap) {
      fitBounds(L.latLngBounds(list.map(function (a) { return [a.lat, a.lon]; })).pad(0.3));
      toast('Este km aparece en ' + list.length + ' sitios: pulsa en el mapa el que buscas', 4000);
    }
  }

  // Un punto (pulsado en el mapa, coordenadas, favorito o mi ubicación): sus 3 PK más cercanos van en la misma ficha
  function coordResult(lat, lon, format, isMe, acc) {
    return { coord: true, me: !!isMe, lat: lat, lon: lon, format: format, acc: acc, near: C ? C.nearest(lat, lon, 3000, 3) : [] };
  }
  // place: nombre del municipio, pueblo, paraje o favorito (se muestra en grande en lugar de las coordenadas)
  function showCoord(lat, lon, format, fromTap, place) {
    alternatives = [coordResult(lat, lon, format)]; altIdx = 0;
    if (place) alternatives[0].place = place;
    if (!fromTap) setInfo(null);
    renderResult(fromTap);
    if (!fromTap) addRecent(current); // al pulsar el mapa no se llena «Recientes» ni se mueve el mapa
  }
  // Tras descargar la provincia del punto, se recalculan sus PK cercanos
  function refreshCoord() {
    if (!current || !current.coord) return;
    current.near = C.nearest(current.lat, current.lon, 3000, 3);
    renderResult(true);
  }

  // Distancia en línea recta y rumbo desde mi última posición (si es de hace menos de 10 minutos)
  var me = null, locked = false, lockedAt = 0;
  function fromMe(lat, lon) {
    if (!me || Date.now() - me.t > 600000) return '';
    var d = K.distance([me.lat, me.lon], [lat, lon]);
    return d < 30 ? '' : 'a ' + K.formatDist(d) + ' de ti (' + K.cardinal(K.bearing([me.lat, me.lon], [lat, lon])) + ')';
  }
  function round1(km) { return Math.round(km * 10) / 10; }
  function hhmm(t) { var d = new Date(t); return d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function joinDot(parts) { return parts.filter(Boolean).join(' · '); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function openNear(n) {
    var km = round1(n.km), loc = C.locate(n.road, km, 0);
    showResult(loc.length ? loc : [{ road: n.road, km: km, dir: 0, lat: n.lat, lon: n.lon, exact: false }], true);
  }
  function renderNear(r) {
    var box = $('nearList'), msg = $('sheetMsg');
    clear(box); clear(msg);
    box.hidden = msg.hidden = true;
    if (!r.coord) return;
    var list = r.me && r.near.length ? r.near.slice(1) : r.near;
    if (r.me && r.near.length) box.appendChild(el('div', { class: 'nl-ll', text: '📍 ' + fmtLL(r.lat, r.lon) }));
    list.forEach(function (n) {
      box.appendChild(el('button', { type: 'button', class: 'nl', title: 'Ver este PK', onclick: function () { openNear(n); } }, [
        el('span', { class: 'dot ty-' + C.typeOf(n.road) }), el('b', { text: n.road }), ' km ' + K.formatKm(round1(n.km)) + ' ≈',
        el('span', { class: 'nl-d', text: 'a ' + K.formatDist(n.d) }),
      ]));
    });
    var cc = camChip(r.lat, r.lon);
    if (cc) box.appendChild(cc);
    box.hidden = !box.firstChild;
    var prov = borders && borders.provinceAt(r.lat, r.lon);
    if (prov && !provData[prov]) {
      msg.appendChild(el('span', { text: (r.me ? 'Estás en ' : 'Este punto está en ') + provByCode[prov].name + ', que no está descargada.' }));
      msg.appendChild(downloadButton(prov, refreshCoord));
    } else if (!prov) msg.textContent = 'Fuera de España: no hay PK, pero puedes ir hasta allí.';
    else if (!r.near.length) msg.textContent = 'No hay ninguna carretera con PK a menos de 3 km.';
    msg.hidden = !msg.firstChild;
  }

  function renderResult(keepView) {
    var r = current = alternatives[altIdx];
    var rr = $('resRoad'), km = $('resKm'), sub = $('resSub'), n0 = r.coord && r.near[0];
    clear(km); clear(sub);
    var bigMe = !!(r.me && n0);
    km.classList.toggle('is-coord', !!r.coord && !bigMe && !r.place);
    $('resLock').hidden = !bigMe;
    $('resLock').classList.toggle('on', bigMe && locked);
    $('resLock').setAttribute('aria-pressed', bigMe && locked ? 'true' : 'false');
    $('sheet').classList.toggle('locked', bigMe && locked);
    if (bigMe) {
      // Mi ubicación: el PK más cercano en grande (con «Bloquear» queda fijo para dar el aviso circulando)
      rr.textContent = n0.road;
      rr.className = 'res-road ty-' + C.typeOf(n0.road);
      km.appendChild(document.createTextNode('km ' + K.formatKm(round1(n0.km))));
      km.appendChild(el('span', { class: 'approx', text: '≈' }));
      sub.textContent = joinDot([locked ? '🔒 Bloqueado a las ' + hhmm(lockedAt) : 'Tu ubicación', 'a ' + K.formatDist(n0.d), r.acc ? 'GPS ±' + Math.round(r.acc) + ' m' : '']);
    } else if (r.place) {
      rr.textContent = '📍';
      rr.className = 'res-road coord';
      km.textContent = r.place;
      sub.textContent = joinDot([r.format, fmtLL(r.lat, r.lon), fromMe(r.lat, r.lon)]);
    } else if (r.coord) {
      rr.textContent = r.me ? '🧭' : '📍';
      rr.className = 'res-road coord';
      km.textContent = fmtLL(r.lat, r.lon);
      sub.textContent = joinDot([cap(r.me ? 'tu ubicación' : r.format), r.me && r.acc ? 'GPS ±' + Math.round(r.acc) + ' m' : '', r.me ? '' : fromMe(r.lat, r.lon)]);
    } else {
      rr.textContent = r.road;
      rr.className = 'res-road ty-' + C.typeOf(r.road);
      km.appendChild(document.createTextNode('km ' + K.formatKm(r.km)));
      if (!r.exact) km.appendChild(el('span', { class: 'approx', text: '≈', title: 'Posición calculada entre hitos' }));
      sub.textContent = joinDot([fmtLL(r.lat, r.lon), r.dir ? dirLabel(r) : '', fromMe(r.lat, r.lon)]);
    }
    renderNear(r);
    var alt = $('altBtn');
    alt.hidden = alternatives.length < 2;
    if (alternatives.length > 1) alt.textContent = 'Este km aparece en ' + alternatives.length + ' sitios · ver otro (' + (altIdx + 1) + '/' + alternatives.length + ')';

    var links = navLinks(r.lat, r.lon);
    $('navGoogle').href = links.google;
    $('navApple').href = links.apple;
    $('navApple').hidden = !IS_APPLE;
    $('acts').classList.toggle('no-apple', !IS_APPLE);
    $('actWhats').href = 'https://wa.me/?text=' + encodeURIComponent(label(r) + '\n' + links.view);
    renderFav();

    var sheet = $('sheet');
    sheet.hidden = false;
    document.body.classList.add('sheet-open');
    if (r.me) { if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; } } else setTarget(r.lat, r.lon);
    drawAlternatives();
    if (!keepView) focusPoint(r.lat, r.lon, Math.max(map.getZoom(), 16));
    if (!r.me) try {
      history.replaceState(null, '', '#' + (r.coord ? '@' + r.lat.toFixed(6) + ',' + r.lon.toFixed(6) : encodeURIComponent(r.road) + '/' + r.km + (r.dir ? '/' + r.dir : '')));
    } catch (e) { /* */ }
  }
  $('altBtn').addEventListener('click', function () { altIdx = (altIdx + 1) % alternatives.length; renderResult(); });

  var altLayer = L.layerGroup().addTo(map);
  function drawAlternatives() {
    altLayer.clearLayers();
    if (alternatives.length < 2) return;
    alternatives.forEach(function (a, i) {
      if (i === altIdx) return;
      var pin = el('span', { class: 'altpin', text: String(i + 1), title: 'Otro sitio con este km (' + (i + 1) + '/' + alternatives.length + ')' });
      L.marker([a.lat, a.lon], { icon: L.divIcon({ className: 'pk-icon', html: pin, iconSize: null }), keyboard: false, zIndexOffset: 1500 })
        .on('click', function () { altIdx = i; renderResult(); }).addTo(altLayer);
    });
  }
  function closeSheet() {
    $('sheet').hidden = true;
    document.body.classList.remove('sheet-open');
    if (targetMarker) { map.removeLayer(targetMarker); targetMarker = null; }
    altLayer.clearLayers();
    current = null; locked = false;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* */ }
    renderMarkers(); // donde estaba la ficha vuelven a caber PK
  }
  $('sheetClose').addEventListener('click', closeSheet);

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = el('textarea', { readonly: '' });
      ta.style.position = 'fixed'; ta.style.top = '-100px'; ta.style.opacity = '0';
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }
  $('actCopy').addEventListener('click', function () {
    if (!current) return;
    var text = KC.forMaps(current.lat, current.lon); // se pega tal cual en Google Maps
    copyText(text).then(function () { toast('Coordenadas copiadas: ' + text); }, function () { toast('No se pudo copiar'); });
  });

  // ---------- Favoritos y recientes ----------
  // Los favoritos pueden llevar nombre (n), color (col) e icono (ic); se guardan solo en este dispositivo
  var FAV_COLORS = ['#C6F400', '#FF4B3E', '#FF9F1C', '#F2D600', '#17A04A', '#2F6BFF', '#A259FF', '#F2F2F2'];
  var FAV_ICONS = [['⛰️', 'Montaña'], ['🌲', 'Bosque'], ['💧', 'Fuente'], ['🏕️', 'Campamento'], ['🌾', 'Campo'],
    ['🚗', 'Coche'], ['🚚', 'Camión'], ['🚑', 'Ambulancia'], ['🚒', 'Bomberos'],
    ['🏠', 'Casa'], ['🏭', 'Nave o fábrica'], ['⛪', 'Iglesia o ermita'], ['🏰', 'Castillo'], ['⛽', 'Gasolinera']];
  var ICON_OK = FAV_ICONS.map(function (x) { return x[0]; });
  function compact(r) {
    if (!r.coord) return { road: r.road, km: r.km, dir: r.dir || 0 };
    var o = { c: 1, lat: +r.lat.toFixed(6), lon: +r.lon.toFixed(6) };
    if (r.place) o.n = r.place.slice(0, 40);
    return o;
  }
  function validItem(x) {
    if (!x || typeof x !== 'object') return false;
    if (x.c === 1) return typeof x.lat === 'number' && typeof x.lon === 'number' && Math.abs(x.lat) <= 90 && Math.abs(x.lon) <= 180;
    return typeof x.road === 'string' && /^[A-Z0-9-]{3,16}$/.test(x.road) && typeof x.km === 'number' && isFinite(x.km) && x.km >= 0 && x.km <= 2000 && (x.dir === 0 || x.dir === 1 || x.dir === -1);
  }
  // Solo se conservan campos conocidos con valores permitidos (lo guardado podría estar manipulado)
  function cleanItem(x) {
    var o = x.c === 1 ? { c: 1, lat: x.lat, lon: x.lon } : { road: x.road, km: x.km, dir: x.dir };
    if (typeof x.n === 'string' && x.n.trim()) o.n = x.n.trim().slice(0, 40);
    if (FAV_COLORS.indexOf(x.col) >= 0) o.col = x.col;
    if (ICON_OK.indexOf(x.ic) >= 0) o.ic = x.ic;
    return o;
  }
  function itemKey(x) { return x.c ? 'c|' + x.lat + '|' + x.lon : x.road + '|' + x.km + '|' + x.dir; }
  function readList(k) { var v = S.readJSON(k, []); return Array.isArray(v) ? v.filter(validItem).slice(0, 50).map(cleanItem) : []; }
  function addRecent(r) {
    var item = compact(r);
    var list = readList('rec').filter(function (x) { return itemKey(x) !== itemKey(item); });
    list.unshift(item);
    S.writeJSON('rec', list.slice(0, 20));
  }
  function favOf(item) { var k = itemKey(item); return readList('fav').filter(function (x) { return itemKey(x) === k; })[0] || null; }
  function isFavItem(item) { return !!favOf(item); }
  function isFav(r) { return isFavItem(compact(r)); }
  function itemTitle(x) { return x.c ? fmtLL(x.lat, x.lon) : x.road + ' km ' + K.formatKm(x.km); }
  function renderFav() {
    var f = current && favOf(compact(current));
    $('resFav').classList.toggle('on', !!f);
    $('resFav').setAttribute('aria-pressed', f ? 'true' : 'false');
    $('resFav').setAttribute('aria-label', f ? 'Editar favorito' : 'Guardar en favoritos');
    var sub = $('resSub'), old = sub.querySelector('.fav-n');
    if (old) sub.removeChild(old);
    if (f && f.n && f.n !== current.place) sub.insertBefore(el('b', { class: 'fav-n', text: (f.ic || '★') + ' ' + f.n + ' · ' }), sub.firstChild);
  }
  function favsChanged() {
    if (current) renderFav();
    renderFavMarkers();
    renderMarkers();
    if (!$('favPanel').hidden) renderList();
  }
  function saveFav(item) {
    var k = itemKey(item), list = readList('fav'), i = -1;
    list.forEach(function (x, j) { if (itemKey(x) === k) i = j; });
    if (i >= 0) list[i] = cleanItem(item); else list.unshift(cleanItem(item));
    S.writeJSON('fav', list.slice(0, 50));
    favsChanged();
  }
  function removeFav(item) {
    var k = itemKey(item);
    S.writeJSON('fav', readList('fav').filter(function (x) { return itemKey(x) !== k; }));
    favsChanged();
  }
  // La estrella guarda el favorito y abre su edición (nombre, color, icono); si ya lo es, abre la edición
  function toggleFav(item) {
    var f = favOf(item);
    if (!f) {
      var nFav = readList('fav').length;
      if (!isPremium() && nFav >= PRE.freeFavs) { showPremium('Con la versión gratuita puedes guardar ' + PRE.freeFavs + ' favoritos.'); return; }
      if (nFav >= PRE.maxFavs) { toast('Máximo ' + PRE.maxFavs + ' favoritos'); return; }
      saveFav(item); toast('Guardado en favoritos'); f = favOf(item);
    }
    editFav(f);
  }
  $('resFav').addEventListener('click', function () { if (current) toggleFav(compact(current)); });

  // Editor de favorito
  var editing = null;
  function editFav(x) {
    editing = cleanItem(x);
    var box = $('favEditBody');
    clear(box);
    box.appendChild(el('div', { class: 'fe-where', text: itemTitle(editing) }));
    var name = el('input', { class: 'fe-name', id: 'favName', type: 'text', maxlength: '40', placeholder: 'Nombre (opcional)', 'aria-label': 'Nombre del favorito', spellcheck: 'false', enterkeyhint: 'done' });
    name.value = editing.n || '';
    name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('favSave').click(); } });
    box.appendChild(name);
    box.appendChild(el('div', { class: 'fe-t', text: 'Color' }));
    var cols = el('div', { class: 'fe-cols', role: 'radiogroup', 'aria-label': 'Color' });
    FAV_COLORS.forEach(function (c, i) {
      var lock = !isPremium() && i >= PRE.freeColors;
      var b = el('button', { type: 'button', class: 'fe-col' + (lock ? ' lock' : ''), role: 'radio', 'aria-label': 'Color ' + (i + 1) + (lock ? ' (Premium)' : ''),
        onclick: function () { if (lock) { showPremium('Más colores es una función Premium.'); return; } editing.col = c; mark(); } });
      b.style.background = c;
      b.dataset.v = c;
      cols.appendChild(b);
    });
    box.appendChild(cols);
    box.appendChild(el('div', { class: 'fe-t', text: 'Icono' }));
    var ics = el('div', { class: 'fe-ics', role: 'radiogroup', 'aria-label': 'Icono' });
    [['', 'Estrella']].concat(FAV_ICONS).forEach(function (ic, i) {
      var lock = !isPremium() && i > PRE.freeIcons;
      var b = el('button', { type: 'button', class: 'fe-ic' + (lock ? ' lock' : ''), role: 'radio', title: ic[1], 'aria-label': ic[1] + (lock ? ' (Premium)' : ''), text: ic[0] || '★',
        onclick: function () { if (lock) { showPremium('Más iconos es una función Premium.'); return; } if (ic[0]) editing.ic = ic[0]; else delete editing.ic; mark(); } });
      b.dataset.v = ic[0];
      ics.appendChild(b);
    });
    box.appendChild(ics);
    function mark() {
      var col = editing.col || FAV_COLORS[0];
      Array.prototype.forEach.call(cols.children, function (b) { var on = b.dataset.v === col; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      Array.prototype.forEach.call(ics.children, function (b) {
        var on = b.dataset.v === (editing.ic || '');
        b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.style.borderColor = on ? col : '';
      });
    }
    mark();
    $('favEdit').hidden = false;
  }
  function closeEdit() { $('favEdit').hidden = true; editing = null; }
  $('favEditClose').addEventListener('click', closeEdit);
  $('favSave').addEventListener('click', function () {
    if (!editing) return;
    var n = $('favName').value.trim();
    if (n) editing.n = n; else delete editing.n;
    saveFav(editing);
    closeEdit();
    toast('Favorito guardado');
  });
  $('favDel').addEventListener('click', function () {
    if (!editing) return;
    removeFav(editing);
    closeEdit();
    toast('Quitado de favoritos');
  });

  // Favoritos fijos en el mapa (con su icono y color): siempre a la vista como referencia; al pulsarlos se abren
  var favLayer = L.layerGroup().addTo(map), favSpots = [];
  function favPosition(x) {
    if (x.c) return [x.lat, x.lon];
    var r = C && C.locate(x.road, x.km, x.dir || 0)[0];
    return r ? [r.lat, r.lon] : null;
  }
  function favPin(x) {
    var col = x.col || FAV_COLORS[0];
    var pin = el('span', { class: x.ic ? 'favpin ic' : 'favpin', text: x.ic || '★' });
    if (x.ic) pin.style.borderColor = col; else pin.style.color = col;
    pin.title = (x.n ? x.n + ' · ' : 'Favorito · ') + itemTitle(x);
    return pin;
  }
  function renderFavMarkers() {
    favLayer.clearLayers();
    favSpots = [];
    readList('fav').forEach(function (x) {
      var p = favPosition(x);
      if (!p) return;
      var mk = L.marker(p, { icon: L.divIcon({ className: 'pk-icon', html: favPin(x), iconSize: null }), keyboard: false, zIndexOffset: 2000 });
      mk.on('click', function () { openItem(x); });
      mk.addTo(favLayer);
      favSpots.push(p);
    });
  }

  var tab = 'fav';
  function renderList() {
    var list = readList(tab), ul = $('list');
    clear(ul);
    if (!list.length) {
      ul.appendChild(el('li', { class: 'empty', text: tab === 'fav' ? 'Aún no tienes favoritos. Pulsa la estrella de un resultado o de cualquier punto del mapa: puedes ponerle nombre, color e icono, y queda fijo en el mapa.' : 'Aquí aparecerán tus últimas búsquedas.' }));
      return;
    }
    list.forEach(function (x) {
      var lead = tab === 'fav' ? favPin(x) : x.c ? null : el('span', { class: 'dot ty-' + (C ? C.typeOf(x.road) : K.roadType(x.road)) });
      if (tab === 'fav') lead.className += ' in-list';
      ul.appendChild(el('li', null, [
        el('button', { type: 'button', class: 'open', onclick: function () { openItem(x); } }, [
          lead,
          el('span', { class: 'open-t' }, [
            el('b', { text: x.n || (x.c ? '📍 ' : '') + itemTitle(x) }),
            x.n ? el('span', { text: itemTitle(x) }) : x.dir ? el('span', { text: x.dir === 1 ? 'km ↑' : 'km ↓' }) : null,
          ]),
        ]),
        tab === 'fav' ? el('button', { type: 'button', class: 'del', 'aria-label': 'Editar', title: 'Editar', text: '✎', onclick: function () { editFav(x); } }) : null,
        el('button', { type: 'button', class: 'del', 'aria-label': 'Quitar', title: 'Quitar', text: '×', onclick: function () {
          S.writeJSON(tab, readList(tab).filter(function (y) { return itemKey(y) !== itemKey(x); }));
          renderList(); if (current) renderFav();
          if (tab === 'fav') { renderFavMarkers(); renderMarkers(); }
        } }),
      ]));
    });
  }
  function openItem(x) {
    $('favPanel').hidden = true;
    if (x.c) {
      roadInput.value = x.n || fmtLL(x.lat, x.lon, 6); kmInput.value = ''; selectedRoad = null; renderDir(); highlightRoad(null);
      showCoord(x.lat, x.lon, tab === 'fav' && isFavItem(x) ? 'favorito' : 'búsqueda reciente', false, x.n);
      return;
    }
    pickRoad(x.road, false);
    dir = C.roadInfo(x.road) && C.roadInfo(x.road).dual ? x.dir : 0; renderDir();
    kmInput.value = K.formatKm(x.km);
    search();
  }
  $('btnFav').addEventListener('click', function () {
    var p = $('favPanel'); $('settings').hidden = true;
    p.hidden = !p.hidden; if (!p.hidden) renderList();
  });
  $('favClose').addEventListener('click', function () { $('favPanel').hidden = true; });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      tab = b.dataset.tab;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (o) { o.classList.toggle('active', o === b); });
      renderList();
    });
  });

  // ---------- Configuración ----------
  var stored = [];
  function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
  var pinnedProvs = [];
  function renderSettingsList() {
    if (!index || $('settings').hidden) return;
    var box = $('provList'), f = K.key($('provFilter').value);
    clear(box);
    // Tus provincias, fijas arriba para marcarlas o desmarcarlas sin buscarlas (al desmarcar no se mueven hasta
    // que se vuelve a abrir la configuración)
    selected.forEach(function (c) { if (pinnedProvs.indexOf(c) < 0) pinnedProvs.push(c); });
    var mine = index.provs.filter(function (p) { return pinnedProvs.indexOf(p.code) >= 0; });
    var rest = index.provs.filter(function (p) { return pinnedProvs.indexOf(p.code) < 0; });
    var lastComm = null;
    mine.map(function (p) { return [p, 'Tus provincias']; }).concat(rest.map(function (p) { return [p, p.community]; })).forEach(function (pair) {
      var p = pair[0];
      if (f && K.key(p.name + ' ' + p.community).indexOf(f) < 0) return;
      if (pair[1] !== lastComm) { lastComm = pair[1]; box.appendChild(el('div', { class: 'comm' + (pair[1] === 'Tus provincias' ? ' mine' : ''), text: pair[1] })); }
      var on = selected.indexOf(p.code) >= 0;
      var st = provState[p.code];
      var status = st === 'loading' ? ['Descargando…', ''] : st === 'error' ? ['Error · reintentar', 'err'] :
        provData[p.code] ? ['✓ ' + fmtSize(p.size), 'ok'] : [fmtSize(p.size), ''];
      var cb = el('input', { type: 'checkbox', 'aria-label': p.name });
      cb.checked = on;
      cb.addEventListener('change', function () {
        if (cb.checked) addProvince(p.code);
        else removeProvince(p.code);
      });
      box.appendChild(el('label', { class: 'prov' }, [cb, el('span', { class: 'pn', text: p.name }), el('span', { class: 'ps ' + status[1], text: status[0] })]));
      // Parajes de la provincia: descarga opcional (para buscarlos por su nombre)
      var psize = on && placesMeta && placesMeta.sizes[p.code] && placesMeta.sizes[p.code][1];
      if (on && !isPremium()) {
        box.appendChild(el('div', { class: 'prov-par' }, [
          el('span', { class: 'pp-t', text: '⛰️ Parajes, cerros, fuentes, ermitas…' }),
          el('button', { type: 'button', class: 'pp-b', text: '🔒 Premium', onclick: function () { showPremium('Los parajes son una función Premium.'); } }),
        ]));
      } else if (psize) {
        var pon = parajesOn.indexOf(p.code) >= 0, pst = parajesState[p.code];
        box.appendChild(el('div', { class: 'prov-par' }, [
          el('span', { class: 'pp-t', text: '⛰️ Parajes, cerros, fuentes, ermitas…' }),
          el('button', { type: 'button', class: 'pp-b pp-par' + (pon ? ' on' : '') + (pst === 'error' ? ' err' : ''), 'aria-label': (pon ? 'Borrar' : 'Descargar') + ' parajes de ' + p.name,
            text: pst === 'loading' ? 'Descargando…' : pon ? '✓ ' + fmtSize(psize) + ' · Borrar' : (pst === 'error' ? 'Reintentar ' : 'Descargar ') + fmtSize(psize),
            onclick: function () { toggleParajes(p.code); } }),
        ]));
      }
      if (on && framework()) {
        var nc = camCount(p.code), inc = parajesOn.indexOf(p.code) >= 0 && isPremium();
        box.appendChild(el('div', { class: 'prov-inc' + (inc ? ' on' : '') }, [
          el('span', { text: '📷 Cámaras viales' + (nc ? ' (' + nc + ' en ' + p.name + ')' : '') + ' · ⛈️ Avisos meteorológicos · 🔥 Incendios activos' }),
          el('small', { text: inc ? 'Incluido con los parajes de esta provincia' : 'Se activan al descargar los parajes (Premium)' }),
        ]));
      }
    });
    var total = selected.reduce(function (s, c) { return s + (provByCode[c] ? provByCode[c].size : 0); }, 0);
    $('provCount').textContent = selected.length + ' elegidas · ' + fmtSize(total) +
      (selected.length ? ' · ' + selected.map(function (c) { return provByCode[c].name; }).join(', ') : '');
  }
  function renderConn() {
    var on = navigator.onLine !== false;
    $('conn').textContent = on ? 'Con conexión: puedes descargar provincias.' : 'Sin conexión: puedes usar las provincias ya descargadas.';
    $('conn').classList.toggle('off', !on);
  }
  window.addEventListener('online', renderConn);
  window.addEventListener('offline', renderConn);
  $('btnSettings').addEventListener('click', function () {
    var p = $('settings'); $('favPanel').hidden = true;
    p.hidden = !p.hidden;
    if (!p.hidden) { pinnedProvs = selected.slice(); renderConn(); renderSettingsList(); loadPlacesMeta().then(renderSettingsList); }
  });
  $('settingsClose').addEventListener('click', function () { $('settings').hidden = true; });
  $('provFilter').addEventListener('input', renderSettingsList);
  var autoProv = S.readJSON('auto', true) !== false;
  $('optAuto').checked = autoProv;
  $('optAuto').addEventListener('change', function () { autoProv = $('optAuto').checked; S.writeJSON('auto', autoProv); });
  $('appVersion').textContent = 'versión ' + CFG.version;
  applyPremiumUi();
  // En el APK el enlace de descarga no existe (lo quita tools/prepare-android.mjs)
  if ($('apkLink')) $('apkLink').hidden = IS_NATIVE || IS_IOS;

  // ---------- Apariencia: tamaño de las cajas, tamaño de letra y color de la app (los 8 de los favoritos) ----------
  var LOOK_SIZES = [['s', 'Pequeño', 0.9], ['m', 'Normal', 1], ['l', 'Grande', 1.15]];
  var FONT_SIZES = [['s', 'Pequeña', 0.9], ['m', 'Normal', 1], ['l', 'Grande', 1.15], ['xl', 'Muy grande', 1.3]];
  var look = S.readJSON('look', {});
  if (!look || typeof look !== 'object') look = {};
  function lookVal(list, k) { return (list.filter(function (x) { return x[0] === k; })[0] || list[1])[2]; }
  function dim(hex) { // el mismo color algo más oscuro (botones pulsados)
    var n = parseInt(hex.slice(1), 16);
    return '#' + [16, 8, 0].map(function (s) { return ('0' + Math.round(((n >> s) & 255) * 0.82).toString(16)).slice(-2); }).join('');
  }
  function applyLook() {
    var acc = FAV_COLORS.indexOf(look.acc) >= 0 ? look.acc : FAV_COLORS[0], st = document.documentElement.style;
    accent = acc;
    st.setProperty('--lime', acc);
    st.setProperty('--lime-dim', dim(acc));
    st.setProperty('--box', String(lookVal(LOOK_SIZES, look.box)));
    st.setProperty('--fs', String(lookVal(FONT_SIZES, look.font)));
    drawOutline();
    syncTop();
    fitRoad();
    renderLook();
  }
  function segs(box, list, key) {
    clear(box);
    list.forEach(function (x) {
      var on = (look[key] || 'm') === x[0];
      box.appendChild(el('button', { type: 'button', class: 'segbtn' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', text: x[1],
        onclick: function () { look[key] = x[0]; S.writeJSON('look', look); applyLook(); } }));
    });
  }
  function renderLook() {
    segs($('lookBox'), LOOK_SIZES, 'box');
    segs($('lookFont'), FONT_SIZES, 'font');
    var box = $('lookColor');
    clear(box);
    FAV_COLORS.forEach(function (c, i) {
      var on = accent === c;
      var b = el('button', { type: 'button', class: 'fe-col' + (on ? ' on' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': 'Color ' + (i + 1),
        onclick: function () { look.acc = c; S.writeJSON('look', look); applyLook(); } });
      b.style.background = c;
      box.appendChild(b);
    });
  }
  applyLook();

  // ---------- Capas Premium: cámaras, avisos meteorológicos, incendios activos y zonas ----------
  // SOSpk solo facilita el buscador y el enlace: no copia ni muestra imágenes ni datos ajenos. Todo viene en el «paquete» de la provincia
  // (el mismo que los parajes): solo las provincias con parajes descargados tienen cámaras, avisos e incendios.
  var layerOn = S.readJSON('capas', {});
  if (!layerOn || typeof layerOn !== 'object') layerOn = {};
  function lyrOn(k) { return isPremium() && layerOn[k] === true; }
  function pkgProvs() { return selected.filter(function (c) { return parajesOn.indexOf(c) >= 0; }); }
  function provName(c) { return provByCode[c] ? provByCode[c].name : c; }
  function openLink(url) {
    var a = el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' });
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  function two(n) { return ('0' + n).slice(-2); }
  function fmtWhen(t) { var d = new Date(t); return two(d.getDate()) + '/' + two(d.getMonth() + 1) + ' ' + two(d.getHours()) + ':' + two(d.getMinutes()); }

  // --- Cámaras de tráfico: un icono que abre el enlace de la cámara ---
  var camMeta = null, camMetaP = null, camLists = {}, camPending = {};
  var camLayer = L.layerGroup().addTo(map);
  function loadCamMeta() {
    if (camMetaP) return camMetaP;
    var ok = function (m) { return m && /^\d{8,12}$/.test(String(m.v)) && m.sizes && typeof m.sizes === 'object' ? m : null; };
    var local = S.loadJSON('data/camaras.json').then(ok, function () { return null; });
    var remote = IS_NATIVE ? S.loadJSON(CFG.remoteBase + 'data/camaras.json').then(ok, function () { return null; }) : Promise.resolve(null);
    camMetaP = Promise.all([local, remote]).then(function (r) { camMeta = r[1] && (!r[0] || r[1].v > r[0].v) ? r[1] : r[0]; return camMeta; });
    camMetaP.then(function (m) { if (!m) camMetaP = null; });
    return camMetaP;
  }
  function camCount(code) { return camMeta && camMeta.sizes[code] ? camMeta.sizes[code][0] : 0; }
  function loadCams(code) {
    if (camLists[code]) return Promise.resolve(camLists[code]);
    if (camPending[code]) return camPending[code];
    var p = camPending[code] = loadCamMeta().then(function (m) {
      if (m && !m.sizes[code]) throw new Error('sin cámaras');
      return S.getPlaces('camaras', code, m && m.v);
    }).then(function (d) { camLists[code] = K.camaraEntries(d); return camLists[code]; });
    p.then(function () { delete camPending[code]; renderCams(); }, function () { delete camPending[code]; });
    return p;
  }
  function dropCams(code) { delete camLists[code]; S.removePlaces('camaras', code); renderCams(); }
  function allCams() {
    var out = [];
    pkgProvs().forEach(function (c) { (camLists[c] || []).forEach(function (x) { out.push(x); }); });
    return out;
  }
  var camHint = false;
  var pkgKey = '';
  function syncPackage() {
    var k = pkgProvs().join(',') + '|' + isPremium();
    if (k === pkgKey) return;
    pkgKey = k;
    Object.keys(camLists).forEach(function (c) { if (pkgProvs().indexOf(c) < 0) dropCams(c); });
    applyFire();
    renderAlert();
  }
  function renderCams() {
    camLayer.clearLayers();
    syncPackage();
    if (!lyrOn('cam')) return;
    pkgProvs().forEach(function (c) { if (!camLists[c]) loadCams(c); });
    var z = map.getZoom();
    if (z < 9) { if (!camHint && allCams().length) { camHint = true; toast('Acerca el mapa para ver las cámaras'); } return; }
    var b = map.getBounds().pad(0.1), ctr = map.getCenter(), vis = [];
    allCams().forEach(function (c) { if (b.contains([c.lat, c.lon])) vis.push(c); });
    vis.sort(function (x, y) { return K.distance([ctr.lat, ctr.lng], [x.lat, x.lon]) - K.distance([ctr.lat, ctr.lng], [y.lat, y.lon]); });
    var grid = {}, n = 0;
    for (var i = 0; i < vis.length && n < 400; i++) {
      var c = vis[i], pt = map.latLngToContainerPoint([c.lat, c.lon]), k = Math.floor(pt.x / 32) + ':' + Math.floor(pt.y / 32);
      if (grid[k]) continue;
      grid[k] = 1;
      addCamMarker(c);
      n++;
    }
  }
  function addCamMarker(c) {
    var pin = el('span', { class: 'campin', text: '📷', title: 'Abrir la cámara: ' + c.name });
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'pk-icon', html: pin, iconSize: null }), keyboard: false, zIndexOffset: 600 })
      .on('click', function () { openLink(c.url); }).addTo(camLayer);
  }
  map.on('moveend', renderCams);
  // Cámara más cercana a un punto, para la ficha
  function camChip(lat, lon) {
    if (!lyrOn('cam')) return null;
    var best = K.nearestCamara(allCams(), lat, lon, 3000);
    if (!best) return null;
    return el('button', { type: 'button', class: 'nl cam', title: 'Abrir la cámara: ' + best.cam.name, onclick: function () { openLink(best.cam.url); } }, [
      el('span', { text: '📷' }), el('b', { text: 'Cámara' }), el('span', { class: 'nl-d', text: 'a ' + K.formatDist(best.d) + ' · abrir' }),
    ]);
  }

  // --- Incendios activos: focos de calor de hoy (EFFIS, Copernicus), solo sobre las provincias con paquete ---
  var fireLayer = null;
  function pkgBounds() {
    var b = null;
    pkgProvs().forEach(function (c) {
      var bb = borders && borders.bbox(c);
      if (!bb) return;
      var lb = L.latLngBounds([bb[0], bb[1]], [bb[2], bb[3]]);
      b = b ? b.extend(lb) : lb;
    });
    return b;
  }
  function applyFire() {
    if (fireLayer) { map.removeLayer(fireLayer); fireLayer = null; }
    if (!lyrOn('inc')) return;
    var b = pkgBounds();
    if (!b) return;
    fireLayer = L.tileLayer.wms('https://maps.effis.emergency.copernicus.eu/gwis?', { layers: 'all.hs.today', format: 'image/png', transparent: true, version: '1.1.1',
      bounds: b.pad(0.05), opacity: 0.95, zIndex: 320, attribution: 'Incendios: EFFIS (Copernicus)' }).addTo(map);
  }

  // --- Avisos meteorológicos vigentes (AEMET vía Meteoalarm): icono de alerta con el tipo y el enlace a la fuente ---
  var AVISOS_URL = 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-spain';
  var avisos = [], avisosState = 'idle', avisosAt = 0;
  function liveFetch(url) {
    var http = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp;
    if (IS_NATIVE && http) return http.get({ url: url, responseType: 'text', connectTimeout: 10000, readTimeout: 20000 }).then(function (r) { return typeof r.data === 'string' ? r.data : String(r.data); });
    // En local (pruebas) el servidor de pruebas hace de intermediario; en la web real no hay (el servicio no admite lecturas desde páginas)
    var local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
    return fetch(local ? '/__proxy?u=' + encodeURIComponent(url) : url, { credentials: 'omit', cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }
  function myAvisos() {
    var mine = pkgProvs();
    return avisos.filter(function (a) { return a.prov && mine.indexOf(a.prov) >= 0; }).sort(function (x, y) { return y.rank - x.rank || x.onset - y.onset; });
  }
  function loadAvisos(force) {
    if (!lyrOn('avi')) { renderAlert(); return; }
    if (!force && avisosState === 'ok' && Date.now() - avisosAt < 600000) { renderAlert(); return; }
    if (avisosState === 'loading') return;
    avisosState = 'loading';
    renderAlert();
    liveFetch(AVISOS_URL).then(function (t) { avisos = K.parseAvisos(t, Date.now()); avisosState = 'ok'; avisosAt = Date.now(); renderAlert(); renderLayers(); })
      .catch(function () { avisosState = 'error'; renderAlert(); renderLayers(); });
  }
  var LVCOL = { yellow: '#F2D600', orange: '#FF9F1C', red: '#FF4B3E' };
  function renderAlert() {
    var chip = $('alertChip');
    clear(chip);
    if (!lyrOn('avi') || avisosState === 'idle' || avisosState === 'loading') { chip.hidden = true; return; }
    if (avisosState === 'error') {
      chip.hidden = false; chip.className = 'alertchip off';
      chip.appendChild(el('span', { class: 'al-i', text: '⚠️' }));
      chip.appendChild(el('span', { class: 'al-t', text: navigator.onLine === false ? 'Sin conexión: avisos no disponibles' : 'Avisos no disponibles ahora' }));
      return;
    }
    var list = myAvisos();
    if (!list.length) { chip.hidden = true; return; }
    var top = list[0], types = [];
    list.forEach(function (a) { if (types.indexOf(a.tipo) < 0) types.push(a.tipo); });
    chip.hidden = false; chip.className = 'alertchip';
    chip.style.setProperty('--al', LVCOL[top.level]);
    chip.appendChild(el('span', { class: 'al-i', text: '⚠️' }));
    chip.appendChild(el('span', { class: 'al-t' }, [el('b', { text: 'Aviso ' + top.nivel.toLowerCase() }), ' · ' + types.slice(0, 2).join(', ') + (types.length > 2 ? '…' : '') + (list.length > 1 ? ' (' + list.length + ')' : '')]));
  }
  $('alertChip').addEventListener('click', function () { if (avisosState === 'error') { loadAvisos(true); return; } renderAlertList(); $('alertPanel').hidden = false; });
  $('alertClose').addEventListener('click', function () { $('alertPanel').hidden = true; });
  function renderAlertList() {
    var box = $('alertList');
    clear(box);
    var list = myAvisos();
    if (!list.length) box.appendChild(el('p', { class: 'set-help', text: 'No hay avisos vigentes en tus provincias.' }));
    list.forEach(function (a) {
      var pill = el('span', { class: 'al-pill', text: a.nivel });
      pill.style.background = LVCOL[a.level];
      box.appendChild(el('div', { class: 'al-item' }, [
        el('div', { class: 'al-row' }, [pill, el('b', { text: a.tipo })]),
        el('div', { class: 'al-sub', text: (a.zone || '') + ' · ' + provName(a.prov) }),
        el('div', { class: 'al-sub', text: 'Vigente hasta el ' + fmtWhen(a.expires) }),
        el('a', { class: 'al-link', href: a.link, target: '_blank', rel: 'noopener noreferrer', text: 'Ver el aviso en la fuente' }),
      ]));
    });
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && lyrOn('avi')) loadAvisos(false); });
  setInterval(function () { if (lyrOn('avi') && document.visibilityState === 'visible') loadAvisos(true); }, 600000);

  // --- Zonas y sectores: dibujar punto a punto; si se cierra es un sector (perímetro y área), si no, una ruta ---
  var ZMAX = 30;
  function validZona(z) {
    if (!z || typeof z !== 'object' || typeof z.id !== 'string' || z.id.length > 24 || !Array.isArray(z.pts) || z.pts.length < 2 || z.pts.length > 300) return false;
    for (var i = 0; i < z.pts.length; i++) { var p = z.pts[i]; if (!Array.isArray(p) || !isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return false; }
    return true;
  }
  function cleanZona(z) {
    return { id: z.id, n: typeof z.n === 'string' ? z.n.trim().slice(0, 40) : '', closed: z.closed === true && z.pts.length >= 3, pts: z.pts.map(function (p) { return [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)]; }),
      col: FAV_COLORS.indexOf(z.col) >= 0 ? z.col : FAV_COLORS[0], fil: FAV_COLORS.indexOf(z.fil) >= 0 ? z.fil : FAV_COLORS[0] };
  }
  function readZonas() { var v = S.readJSON('zonas', []); return Array.isArray(v) ? v.filter(validZona).slice(0, ZMAX).map(cleanZona) : []; }
  function writeZonas(list) { S.writeJSON('zonas', list.slice(0, ZMAX)); }
  var zonesLayer = L.layerGroup().addTo(map);
  function zonaInfo(z) {
    var per = K.pathLength(z.pts, z.closed);
    return z.closed ? 'Perímetro ' + K.formatLength(per) + ' · Área ' + K.formatArea(K.polygonArea(z.pts)) : 'Longitud ' + K.formatLength(per);
  }
  function renderZonas() {
    zonesLayer.clearLayers();
    if (!isPremium()) return;
    readZonas().forEach(function (z) {
      var shape = z.closed
        ? L.polygon(z.pts, { color: z.col, weight: 2.5, opacity: 0.95, fillColor: z.fil, fillOpacity: 0.1, interactive: false })
        : L.polyline(z.pts, { color: z.col, weight: 3.5, opacity: 0.95, interactive: false });
      shape.addTo(zonesLayer);
      if (z.n) shape.bindTooltip(z.n, { permanent: true, direction: 'center', className: 'zone-label', interactive: false });
    });
  }
  var drawing = null, drawLayer = L.layerGroup().addTo(map);
  function startDraw() {
    $('zonesPanel').hidden = true;
    closeSheet();
    drawing = { pts: [] };
    $('drawBar').hidden = false;
    document.body.classList.add('drawing');
    renderDraw();
  }
  function endDraw() {
    drawing = null;
    drawLayer.clearLayers();
    $('drawBar').hidden = true;
    document.body.classList.remove('drawing');
  }
  function renderDraw() {
    drawLayer.clearLayers();
    var pts = drawing.pts, n = pts.length;
    if (n > 1) L.polyline(pts, { color: '#C6F400', weight: 3, dashArray: '6 6', interactive: false }).addTo(drawLayer);
    if (n > 2) L.polygon(pts, { color: '#C6F400', weight: 0, fillColor: '#C6F400', fillOpacity: 0.1, interactive: false }).addTo(drawLayer);
    pts.forEach(function (p, i) { L.circleMarker(p, { radius: i === 0 ? 7 : 5, color: '#0B0B0B', weight: 2, fillColor: '#C6F400', fillOpacity: 1, interactive: false }).addTo(drawLayer); });
    var info = n ? n + (n === 1 ? ' punto' : ' puntos') + (n > 1 ? ' · ' + K.formatLength(K.pathLength(pts, false)) : '') + (n > 2 ? ' · cerrada: ' + K.formatLength(K.pathLength(pts, true)) + ', ' + K.formatArea(K.polygonArea(pts)) : '') : 'Toca el mapa para añadir puntos';
    $('drawInfo').textContent = info;
    $('drawClose').disabled = n < 3;
    $('drawRoute').disabled = n < 2;
    $('drawUndo').disabled = n < 1;
  }
  function addDrawPoint(ll) { drawing.pts.push([+ll.lat.toFixed(6), +ll.lng.toFixed(6)]); renderDraw(); }
  $('drawUndo').addEventListener('click', function () { if (drawing && drawing.pts.length) { drawing.pts.pop(); renderDraw(); } });
  $('drawCancel').addEventListener('click', endDraw);
  function finishDraw(closed) {
    if (!drawing) return;
    var list = readZonas();
    if (list.length >= ZMAX) { toast('Máximo ' + ZMAX + ' zonas: borra alguna'); return; }
    var z = cleanZona({ id: Date.now().toString(36), n: '', closed: closed, pts: drawing.pts, col: FAV_COLORS[0], fil: FAV_COLORS[0] });
    z.n = (closed ? 'Zona ' : 'Ruta ') + (list.length + 1);
    list.push(z);
    writeZonas(list);
    endDraw();
    renderZonas();
    editZona(z.id);
  }
  $('drawClose').addEventListener('click', function () { finishDraw(true); });
  $('drawRoute').addEventListener('click', function () { finishDraw(false); });
  // Lista de zonas
  function openZonas() {
    $('layersPop').hidden = true;
    renderZonasList();
    $('zonesPanel').hidden = false;
  }
  function renderZonasList() {
    var box = $('zonesList'), list = readZonas();
    clear(box);
    if (!list.length) box.appendChild(el('p', { class: 'set-help', text: 'Aún no tienes zonas. Pulsa «Nueva zona», toca el mapa punto a punto y ciérrala sobre el primer punto para obtener un sector con perímetro y área.' }));
    list.forEach(function (z) {
      var dot = el('span', { class: 'zl-dot' });
      dot.style.background = z.closed ? z.fil : z.col; dot.style.borderColor = z.col;
      box.appendChild(el('div', { class: 'zl' }, [
        el('button', { type: 'button', class: 'zl-open', onclick: function () { $('zonesPanel').hidden = true; map.fitBounds(L.latLngBounds(z.pts).pad(0.3), { animate: false, maxZoom: 16 }); } }, [
          dot, el('span', { class: 'zl-t' }, [el('b', { text: z.n || (z.closed ? 'Zona' : 'Ruta') }), el('small', { text: zonaInfo(z) })]),
        ]),
        el('button', { type: 'button', class: 'del', 'aria-label': 'Editar', title: 'Editar', text: '✎', onclick: function () { $('zonesPanel').hidden = true; editZona(z.id); } }),
      ]));
    });
  }
  $('zonesClose').addEventListener('click', function () { $('zonesPanel').hidden = true; });
  $('zonesNew').addEventListener('click', startDraw);
  // Editor de zona: nombre, color del contorno y color del interior (muy tenue)
  var editingZ = null;
  function editZona(id) {
    var z = readZonas().filter(function (x) { return x.id === id; })[0];
    if (!z) return;
    editingZ = z;
    var box = $('zoneEditBody');
    clear(box);
    box.appendChild(el('div', { class: 'fe-where', text: zonaInfo(z) }));
    var name = el('input', { class: 'fe-name', id: 'zoneName', type: 'text', maxlength: '40', placeholder: 'Nombre', 'aria-label': 'Nombre de la zona', spellcheck: 'false' });
    name.value = z.n;
    name.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('zoneSave').click(); } });
    box.appendChild(name);
    function swatches(title, key) {
      box.appendChild(el('div', { class: 'fe-t', text: title }));
      var row = el('div', { class: 'fe-cols', role: 'radiogroup', 'aria-label': title });
      FAV_COLORS.forEach(function (c, i) {
        var b = el('button', { type: 'button', class: 'fe-col', role: 'radio', 'aria-label': 'Color ' + (i + 1), onclick: function () { editingZ[key] = c; mark(); } });
        b.style.background = c; b.dataset.v = c;
        row.appendChild(b);
      });
      box.appendChild(row);
      return row;
    }
    var r1 = z.closed || true ? swatches('Color del contorno', 'col') : null;
    var r2 = z.closed ? swatches('Color del interior (muy tenue)', 'fil') : null;
    function mark() {
      [[r1, 'col'], [r2, 'fil']].forEach(function (pair) {
        if (!pair[0]) return;
        Array.prototype.forEach.call(pair[0].children, function (b) { var on = b.dataset.v === editingZ[pair[1]]; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
      });
    }
    mark();
    $('zoneEdit').hidden = false;
  }
  function closeZoneEdit() { $('zoneEdit').hidden = true; editingZ = null; }
  $('zoneEditClose').addEventListener('click', closeZoneEdit);
  $('zoneSave').addEventListener('click', function () {
    if (!editingZ) return;
    var list = readZonas();
    list.forEach(function (z, i) { if (z.id === editingZ.id) { editingZ.n = $('zoneName').value.trim().slice(0, 40); list[i] = cleanZona(editingZ); } });
    writeZonas(list);
    closeZoneEdit();
    renderZonas();
    toast('Zona guardada');
  });
  $('zoneDel').addEventListener('click', function () {
    if (!editingZ) return;
    var id = editingZ.id;
    writeZonas(readZonas().filter(function (z) { return z.id !== id; }));
    closeZoneEdit();
    renderZonas();
    toast('Zona borrada');
  });

  // --- Panel «Capas» ---
  var LAYERS = [['cam', '📷', 'Cámaras de tráfico'], ['avi', '⛈️', 'Avisos meteorológicos'], ['inc', '🔥', 'Incendios activos'], ['zon', '⬡', 'Zonas y sectores']];
  function layerNote(k) {
    if (k === 'zon') return readZonas().length ? readZonas().length + (readZonas().length === 1 ? ' zona' : ' zonas') : 'Dibujar';
    if (!pkgProvs().length) return 'Descarga los parajes de una provincia';
    if (!layerOn[k]) return 'Apagada';
    if (k === 'cam') return allCams().length + ' cámaras';
    if (k === 'avi') return avisosState === 'error' ? 'Sin conexión' : avisosState === 'loading' ? 'Consultando…' : avisosState === 'ok' ? (myAvisos().length ? myAvisos().length + ' vigentes' : 'Sin avisos vigentes') : '';
    return 'Focos de hoy';
  }
  function renderLayers() {
    var box = $('layersList');
    if (!box) return;
    clear(box);
    LAYERS.forEach(function (l) {
      var prem = isPremium(), on = prem && (l[0] === 'zon' || layerOn[l[0]] === true);
      box.appendChild(el('button', { type: 'button', class: 'lyr' + (prem ? (on ? ' on' : '') : ' lock'), 'aria-label': l[2] + (prem ? (on ? ' (activada)' : ' (apagada)') : ' (Premium)'),
        onclick: function () { toggleLayer(l[0], l[2]); } }, [
        el('span', { class: 'lyr-i', text: l[1] }), el('span', { class: 'lyr-t', text: l[2] }),
        el('span', { class: 'lyr-s', text: prem ? layerNote(l[0]) : '🔒' }),
      ]));
    });
  }
  function toggleLayer(k, title) {
    if (!isPremium()) { showPremium(title + ' es una función Premium.'); return; }
    if (k === 'zon') { openZonas(); return; }
    if (!pkgProvs().length && !layerOn[k]) toast('Descarga los parajes de una provincia en Configuración para activar esta capa');
    layerOn[k] = !layerOn[k];
    S.writeJSON('capas', layerOn);
    applyLayers();
    renderLayers();
  }
  function applyLayers() {
    renderCams();
    applyFire();
    loadAvisos(false);
    renderAlert();
  }

  map.on('moveend', function () { syncPackage(); });
  renderZonas();
  loadCamMeta().then(function () { renderSettingsList(); });
  applyLayers();

  // ---------- Ubicación y PK más cercano (en la misma ficha que cualquier punto) ----------
  var watchId = null, meMarker = null, accCircle = null, firstFix = false, autoAsked = {};
  function showMe() {
    if (!me) return;
    alternatives = [coordResult(me.lat, me.lon, 'tu ubicación', true, me.acc)]; altIdx = 0;
    renderResult(true);
  }
  function stopLocate() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    if (meMarker) { map.removeLayer(meMarker); map.removeLayer(accCircle); meMarker = accCircle = null; }
    $('btnLocate').classList.remove('on');
    if (current && current.me) closeSheet();
    locked = false;
  }
  $('btnLocate').addEventListener('click', function () {
    if (watchId != null) { stopLocate(); return; }
    if (!('geolocation' in navigator)) { toast('Este dispositivo no permite obtener la ubicación'); return; }
    $('btnLocate').classList.add('on');
    firstFix = true;
    toast('Buscando tu ubicación…');
    watchId = navigator.geolocation.watchPosition(function (pos) {
      var lat = pos.coords.latitude, lon = pos.coords.longitude, acc = pos.coords.accuracy;
      me = { lat: lat, lon: lon, acc: acc, t: Date.now() };
      if (!meMarker) {
        accCircle = L.circle([lat, lon], { radius: acc, color: '#1A73E8', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
        meMarker = L.marker([lat, lon], { icon: L.divIcon({ className: 'pk-icon', html: '<span class="me"></span>', iconSize: [18, 18], iconAnchor: [9, 9] }), interactive: false, keyboard: false }).addTo(map);
      } else { meMarker.setLatLng([lat, lon]); accCircle.setLatLng([lat, lon]).setRadius(acc); }
      // Con el PK bloqueado la ficha no cambia; si se está viendo otro resultado, solo se actualiza su distancia
      if (!locked) {
        if (firstFix || (current && current.me)) showMe();
        else if (current) renderResult(true);
      }
      var prov = borders && borders.provinceAt(lat, lon);
      if (prov && !provData[prov] && autoProv && !autoAsked[prov] && provState[prov] !== 'loading') {
        autoAsked[prov] = true;
        addProvince(prov, { suffix: ' (tu ubicación)' }).then(function () { if (current && current.me && !locked) showMe(); });
      }
      if (firstFix) { firstFix = false; focusPoint(lat, lon, 15); }
    }, function (err) {
      stopLocate();
      toast(err.code === 1 ? 'Permiso de ubicación denegado. Actívalo en los ajustes.' : 'No se pudo obtener la ubicación');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  });
  // Bloquear PK: el PK más cercano queda fijo en grande (para dar el aviso aunque se siga circulando)
  $('resLock').addEventListener('click', function () {
    locked = !locked;
    lockedAt = Date.now();
    if (!locked && me) showMe(); else renderResult(true);
    toast(locked ? 'PK bloqueado: no cambiará hasta que lo desbloquees' : 'PK desbloqueado');
  });

  // Mantener pulsado (o clic derecho) igual que pulsar: la ficha del punto (iOS no lanza contextmenu: se detecta a mano)
  var lastPress = 0;
  function pressAt(ll) {
    if (drawing || Date.now() - lastPress < 800 || !C) return;
    lastPress = Date.now();
    showCoord(ll.lat, ll.lng, 'punto marcado', true);
  }
  map.on('contextmenu', function (e) { pressAt(e.latlng); });
  // Pulsar un sitio del mapa: su ficha como si fuera un PK (coordenadas, PK más cercanos, ir con Maps, copiar, favorito)
  map.on('click', function (e) {
    if (drawing) { addDrawPoint(e.latlng); return; }
    if (!C || Date.now() - lastPress < 800) return;
    showCoord(e.latlng.lat, e.latlng.lng, 'punto del mapa', true);
  });
  (function () {
    var timer = null, start = null, box = map.getContainer();
    function cancel() { clearTimeout(timer); timer = null; }
    box.addEventListener('touchstart', function (e) {
      cancel();
      if (e.touches.length !== 1) return;
      start = [e.touches[0].clientX, e.touches[0].clientY];
      timer = setTimeout(function () { var r = box.getBoundingClientRect(); pressAt(map.containerPointToLatLng([start[0] - r.left, start[1] - r.top])); }, 600);
    }, { passive: true });
    box.addEventListener('touchmove', function (e) {
      var t = e.touches[0];
      if (!start || !t || Math.abs(t.clientX - start[0]) > 10 || Math.abs(t.clientY - start[1]) > 10) cancel();
    }, { passive: true });
    box.addEventListener('touchend', cancel, { passive: true });
    box.addEventListener('touchcancel', cancel, { passive: true });
  })();

  $('btnLayer').addEventListener('click', function () { satellite = !satellite; S.writeJSON('sat', satellite); applyLayer(); });

  // ---------- Enlace directo: #A-2/44.3/1  o  #@40.62,-3.15 ----------
  function fromHash() {
    var h = (location.hash || '').slice(1);
    if (!h || h.length > 80) return false;
    var parts;
    try { parts = decodeURIComponent(h).split('/'); } catch (e) { return false; }
    if (parts[0].charAt(0) === '@') {
      var co = KC.parse(parts[0].slice(1));
      if (co && !co.short) { roadInput.value = fmtLL(co.lat, co.lon, 6); showCoord(co.lat, co.lon, 'enlace'); return true; }
      return false;
    }
    var road = C.resolveRoad(parts[0]);
    if (!road) return false;
    pickRoad(road, false);
    var km = K.parseKm(parts[1]);
    if (!isFinite(km)) return true;
    var d = parts[2] === '1' ? 1 : parts[2] === '-1' ? -1 : 0;
    dir = C.roadInfo(road).dual ? d : 0; renderDir();
    kmInput.value = K.formatKm(km);
    search();
    return true;
  }

  // ---------- Arranque ----------
  function validData(d) { return !!d && K.validIndex(d.index) && K.validBorders(d.borders) && d.index.v === d.borders.v; }
  function setIndex(idx, bor) {
    index = idx;
    borders = K.createBorders(bor);
    provByCode = {};
    index.provs.forEach(function (p) { provByCode[p.code] = p; });
    $('dataDate').textContent = 'Datos: ' + String(index.v).replace(/^(\d{4})(\d{2})(\d{2})\d*$/, '$3/$2/$1') + '.';
  }
  // Índice y límites: los de la app o, en el APK, unos más nuevos descargados antes de la web
  function loadBase() {
    var bundled = Promise.all([S.loadJSON('data/index.json'), S.loadJSON('data/borders.json')]).then(function (r) { return { index: r[0], borders: r[1] }; });
    if (!IS_NATIVE) return bundled;
    return Promise.all([bundled, S.storedData()]).then(function (r) {
      return validData(r[1]) && r[1].index.v > r[0].index.v ? r[1] : r[0];
    });
  }
  function init() {
    loadBase().then(function (d) {
      if (!d.index || !Array.isArray(d.index.provs) || !d.index.roads) throw new Error('índice no válido');
      setIndex(d.index, d.borders);
      selected = readSelected();
      C = K.create(index, {});
      return Promise.all(selected.map(function (c) { return loadProvince(c, true); }));
    }).then(function (oks) {
      rebuild();
      var failed = selected.filter(function (c, i) { return !oks[i]; });
      if (failed.length) toast('Sin conexión: no se pudo cargar ' + failed.map(function (c) { return provByCode[c].name; }).join(', '), 4000);
      else announceUpdates();
      if (!fromHash()) fitBounds(loadedBounds());
      checkUpdates();
    }).catch(function () {
      toast('No se pudieron cargar los datos de la app. Comprueba la conexión y vuelve a abrirla.', 8000);
    });
  }

  // ---------- Actualizaciones (todo lo posible, automático) ----------
  // Tras actualizarse la app o los datos, un aviso breve al abrirla
  function announceUpdates() {
    var prevApp = S.readJSON('ver', null), prevData = S.readJSON('datav', null);
    var known = prevApp || S.readJSON('provs', null); // quien ya usaba la 1.0 no tenía guardada la versión
    if (known && prevApp !== CFG.version) toast('Actualizada a la versión ' + CFG.version);
    else if (prevData && prevData !== index.v && selected.length) toast('Datos actualizados');
    S.writeJSON('ver', CFG.version);
    S.writeJSON('datav', index.v);
  }
  // APK: Android no deja instalar un APK sin que la persona lo confirme; se avisa con un toque para descargarlo
  function showUpdate(version) {
    $('updateText').textContent = 'Nueva versión ' + version;
    $('update').hidden = false;
  }
  $('updateClose').addEventListener('click', function () { $('update').hidden = true; });

  // Comprueba version.json (pequeño) al abrir y al volver a la app: app nueva y/o datos nuevos
  var lastCheck = 0, swReg = null;
  function checkUpdates() {
    if (navigator.onLine === false || Date.now() - lastCheck < 10 * 60 * 1000) return;
    lastCheck = Date.now();
    var base = IS_NATIVE ? CFG.remoteBase : '';
    S.loadJSON(base + 'version.json').then(function (v) {
      if (!v || typeof v !== 'object') return null;
      if (typeof v.app === 'string' && /^\d{1,3}(\.\d{1,3}){0,3}$/.test(v.app) && K.newerVersion(v.app, CFG.version)) {
        if (IS_NATIVE) showUpdate(v.app);
        else if (swReg) swReg.update().catch(function () { /* */ });
      }
      if (typeof v.data === 'string' && /^\d{8,12}$/.test(v.data) && v.data > index.v) return refreshData(base);
      return null;
    }).catch(function () { /* sin conexión: se sigue con lo que hay */ });
  }
  // Datos más nuevos en la web: se validan, se usan y las provincias elegidas se renuevan en segundo plano
  function refreshData(base) {
    return S.loadJSON(base + 'data/index.json').then(function (idx) {
      if (!K.validIndex(idx) || !(idx.v > index.v)) return null;
      return S.loadJSON(base + 'data/borders.json').then(function (bor) {
        if (!validData({ index: idx, borders: bor })) return null;
        if (IS_NATIVE) S.storeData(idx, bor);
        var codes = selected.filter(function (c) { return idx.provs.some(function (p) { return p.code === c; }); });
        var next = {};
        return Promise.all(codes.map(function (c) {
          return S.getProvince(c, idx.v).then(function (d) { next[c] = d; }, function () { /* se queda la anterior */ });
        })).then(function () {
          codes.forEach(function (c) { if (!next[c] && provData[c]) next[c] = provData[c]; });
          setIndex(idx, bor);
          provData = next;
          provState = {};
          codes.forEach(function (c) { if (next[c]) provState[c] = 'ok'; });
          if (codes.length !== selected.length) { selected = codes; saveSelected(); }
          rebuild();
          S.writeJSON('datav', index.v);
          toast('Datos actualizados');
        });
      });
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkUpdates();
  });

  init();

  // ---------- PWA ----------
  // La versión nueva del service worker se activa sola; la página se recarga en un momento seguro: al salir de
  // la app o al volver a ella, nunca con una búsqueda a medias, la ficha abierta o la ubicación activa.
  // (en local solo con 127.0.0.1, para poder probarlo; con "localhost" no se instala y no hay caché)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1') && location.hostname !== 'localhost' && !IS_NATIVE) {
    var hadController = !!navigator.serviceWorker.controller, updateReady = false;
    var safeToReload = function () {
      return $('sheet').hidden && $('settings').hidden && $('favPanel').hidden && $('favEdit').hidden && watchId == null &&
        !roadInput.value.trim() && !kmInput.value.trim() && !Object.keys(provState).some(function (c) { return provState[c] === 'loading'; });
    };
    var reloadIfSafe = function () { if (updateReady && safeToReload()) { updateReady = false; location.reload(); } };
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; } // primera instalación: no hay nada que recargar
      updateReady = true;
      if (document.visibilityState === 'hidden') reloadIfSafe();
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && swReg) swReg.update().catch(function () { /* */ });
      reloadIfSafe();
    });
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) { swReg = reg; }).catch(function () { /* */ });
    });
  }
})();
