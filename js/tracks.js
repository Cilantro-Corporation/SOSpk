/* SOSpk — capa PRO «Tracks» (GPX en modo local).
   Cada persona carga sus propios archivos GPX en su dispositivo: se leen aquí, se guardan solo en el almacén del navegador/móvil
   (IndexedDB) y no se envían a ningún sitio. Sin red, sin librerías. Solo lectura: no se exporta nada.
   Las funciones puras (lector, simplificación, recorte) se prueban con tools/test-tracks.mjs. */
(function (root) {
  'use strict';

  var MAX_BYTES = 15 * 1048576, MAX_PTS = 200000, MAX_TRACKS = 20, MAX_DRAW = 5000, MAX_WPT = 2000, MAX_DEPTH = 40;
  var TOLS = [2, 10, 50]; // metros: detalle alto (zoom 17+), medio (14-16) y bajo
  var COLORS = ['#FF3B30', '#00B0FF', '#C6F400', '#FFB020', '#E040FB', '#00E5A0', '#FF7A00', '#FFFFFF'];

  // ---------- Lector de GPX (sin DOM: sin entidades externas y comprobable en Node) ----------
  function num(s) { s = String(s).trim(); return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s) ? parseFloat(s) : NaN; }
  function cleanName(s) { return String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60); }
  function decode(s) {
    return s.replace(/&(amp|lt|gt|quot|apos);|&#(\d{1,6});|&#x([0-9a-fA-F]{1,5});/g, function (m, n, d, h) {
      if (n) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[n];
      var c = d ? parseInt(d, 10) : parseInt(h, 16);
      return c > 31 && c < 65534 ? String.fromCharCode(c) : ' ';
    });
  }
  function attrs(str) {
    var o = {}, re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, m;
    while ((m = re.exec(str))) o[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    return o;
  }
  function validLL(lat, lon) { return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }

  function parseGPX(text) {
    if (typeof text !== 'string' || !text.length) return { error: 'El archivo está vacío.' };
    if (text.length > MAX_BYTES) return { error: 'El archivo es demasiado grande (máximo 15 MB).' };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return { error: 'El archivo contiene declaraciones no permitidas.' };
    var re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    var stack = [], pos = 0, m, total = 0, tracks = [], wpts = [];
    var cur = null, seg = null, w = null, cap = false, buf = '';
    var bad = { error: 'El archivo no es un GPX válido (XML mal formado).' };

    function open(raw, at) {
      var local = raw.replace(/^.*:/, '').toLowerCase(), parent = stack.length ? stack[stack.length - 1].l : '';
      if (!stack.length && local !== 'gpx') return 'nogpx';
      if (stack.length >= MAX_DEPTH) return 'bad';
      stack.push({ r: raw, l: local });
      if (local === 'trk') cur = { n: '', segs: [] };
      else if (local === 'rte') { cur = { n: '', segs: [] }; seg = []; }
      else if (local === 'trkseg') seg = [];
      else if (local === 'trkpt' || local === 'rtept') {
        var a = attrs(at), lat = num(a.lat === undefined ? '' : a.lat), lon = num(a.lon === undefined ? '' : a.lon);
        if (seg && validLL(lat, lon)) { seg.push([lat, lon]); if (++total > MAX_PTS) return 'many'; }
      } else if (local === 'wpt') {
        var b = attrs(at), la = num(b.lat === undefined ? '' : b.lat), lo = num(b.lon === undefined ? '' : b.lon);
        w = { n: '', lat: la, lon: lo, ok: validLL(la, lo) };
      } else if (local === 'name' && (parent === 'trk' || parent === 'rte' || parent === 'wpt')) { cap = true; buf = ''; }
      return null;
    }
    function close(raw) {
      var top = stack.pop();
      if (!top || top.r !== raw) return 'bad';
      var l = top.l, parent = stack.length ? stack[stack.length - 1].l : '';
      if (l === 'name' && cap) {
        cap = false;
        if (parent === 'wpt' && w) w.n = cleanName(buf); else if ((parent === 'trk' || parent === 'rte') && cur) cur.n = cleanName(buf);
      } else if (l === 'trkseg') {
        if (seg && seg.length > 1 && cur) cur.segs.push(seg);
        seg = null;
      } else if (l === 'trk' || l === 'rte') {
        if (l === 'rte' && seg && seg.length > 1) cur.segs.push(seg);
        seg = null;
        if (cur && cur.segs.length) tracks.push(cur);
        cur = null;
      } else if (l === 'wpt') {
        if (w && w.ok && wpts.length < MAX_WPT) wpts.push({ n: w.n, lat: +w.lat.toFixed(6), lon: +w.lon.toFixed(6) });
        w = null;
      }
      return null;
    }

    while (pos < text.length) {
      re.lastIndex = pos;
      m = re.exec(text);
      if (!m || m.index !== pos) return bad;
      pos = re.lastIndex;
      var whole = m[0], err = null;
      if (m[3] !== undefined) {
        if (m[2]) err = close(m[3]);
        else { err = open(m[3], m[4]); if (!err && m[5]) err = close(m[3]); }
        if (err === 'nogpx') return { error: 'El archivo no es un GPX (falta la etiqueta gpx).' };
        if (err === 'many') return { error: 'El archivo tiene demasiados puntos (máximo 200.000).' };
        if (err) return bad;
      } else if (m[1] !== undefined) { if (cap) buf += m[1]; }
      else if (m[6] !== undefined) { if (cap) buf += decode(whole); }
    }
    if (stack.length) return bad;
    if (!tracks.length && !wpts.length) return { error: 'El archivo no tiene tracks, rutas ni puntos válidos.' };
    return { tracks: tracks, wpts: wpts, points: total };
  }

  // ---------- Geometría ----------
  function hav(a, b) {
    var R = 6371008.8, r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
    var s = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function trackLength(segs) {
    var t = 0;
    segs.forEach(function (s) { for (var i = 1; i < s.length; i++) t += hav(s[i - 1], s[i]); });
    return t;
  }
  function bboxOf(segs, wpts) {
    var b = [90, 180, -90, -180];
    function add(la, lo) { if (la < b[0]) b[0] = la; if (lo < b[1]) b[1] = lo; if (la > b[2]) b[2] = la; if (lo > b[3]) b[3] = lo; }
    segs.forEach(function (s) { s.forEach(function (p) { add(p[0], p[1]); }); });
    (wpts || []).forEach(function (p) { add(p.lat, p.lon); });
    return b;
  }
  // Ramer–Douglas–Peucker iterativo (sin recursión) con tolerancia en metros
  function simplify(pts, tol) {
    var n = pts.length;
    if (n < 3) return pts.map(function (p) { return [p[0], p[1]]; });
    var ky = 110540, kx = 111320 * Math.cos(pts[0][0] * Math.PI / 180), xs = new Float64Array(n), ys = new Float64Array(n), keep = new Uint8Array(n), i;
    for (i = 0; i < n; i++) { xs[i] = pts[i][1] * kx; ys[i] = pts[i][0] * ky; }
    keep[0] = keep[n - 1] = 1;
    var st = [0, n - 1];
    while (st.length) {
      var b = st.pop(), a = st.pop();
      if (b <= a + 1) continue;
      var dx = xs[b] - xs[a], dy = ys[b] - ys[a], l2 = dx * dx + dy * dy, md = -1, mi = -1;
      for (i = a + 1; i < b; i++) {
        var px = xs[i] - xs[a], py = ys[i] - ys[a], d;
        if (l2 === 0) d = Math.sqrt(px * px + py * py);
        else { var t = (px * dx + py * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t; var ex = px - t * dx, ey = py - t * dy; d = Math.sqrt(ex * ex + ey * ey); }
        if (d > md) { md = d; mi = i; }
      }
      if (md > tol) { keep[mi] = 1; st.push(a, mi, mi, b); }
    }
    var out = [];
    for (i = 0; i < n; i++) if (keep[i]) out.push([+pts[i][0].toFixed(6), +pts[i][1].toFixed(6)]);
    return out;
  }
  // Tres niveles de detalle por track: [[segmentos a 2 m], [a 10 m], [a 50 m]]
  function levelsOf(segs) { return TOLS.map(function (t) { return segs.map(function (s) { return simplify(s, t); }); }); }
  function levelForZoom(z) { return z >= 17 ? 0 : z >= 14 ? 1 : 2; }

  // Recorta un segmento a la vista (b = [sur, oeste, norte, este]): conserva cada tramo entre dos puntos cuya caja toca la vista; tope de puntos
  function clip(seg, b, cap) {
    var n = seg.length, i, runs = [], run = null, total = 0;
    for (i = 0; i + 1 < n; i++) {
      var p = seg[i], q = seg[i + 1];
      var hit = Math.max(p[0], q[0]) >= b[0] && Math.min(p[0], q[0]) <= b[2] && Math.max(p[1], q[1]) >= b[1] && Math.min(p[1], q[1]) <= b[3];
      if (hit) {
        if (!run) { run = [p]; runs.push(run); total++; }
        run.push(q); total++;
      } else run = null;
    }
    if (total > cap) {
      var step = Math.ceil(total / cap);
      runs = runs.map(function (r) {
        var o = [];
        for (var k = 0; k < r.length; k += step) o.push(r[k]);
        if (o[o.length - 1] !== r[r.length - 1]) o.push(r[r.length - 1]);
        return o;
      });
    }
    return runs.filter(function (r) { return r.length > 1; });
  }
  function fmtLen(m) { return m >= 1000 ? (m / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 }) + ' km' : Math.round(m) + ' m'; }

  // Convierte un GPX leído en registros listos para guardar
  function toRecords(parsed, fileName, startIndex) {
    var base = cleanName(String(fileName || 'Track').replace(/\.[^.]*$/, '')) || 'Track', out = [], k = 0, t0 = Date.now();
    function id() { return t0.toString(36) + '-' + (k++) + Math.floor(Math.random() * 1679616).toString(36); }
    parsed.tracks.forEach(function (t, i) {
      var lv = levelsOf(t.segs), np = 0;
      t.segs.forEach(function (s) { np += s.length; });
      out.push({ id: id(), n: t.n || (parsed.tracks.length > 1 ? base + ' ' + (i + 1) : base), col: COLORS[(startIndex + out.length) % COLORS.length], vis: true,
        len: Math.round(trackLength(t.segs)), np: np, lv: lv, wp: i === 0 ? parsed.wpts : [], bb: bboxOf(t.segs, i === 0 ? parsed.wpts : []), t: t0 + i });
    });
    if (!out.length) out.push({ id: id(), n: base, col: COLORS[startIndex % COLORS.length], vis: true, len: 0, np: 0, lv: [[], [], []], wp: parsed.wpts, bb: bboxOf([], parsed.wpts), t: t0 });
    return out;
  }
  function validRec(r) {
    return r && typeof r.id === 'string' && typeof r.n === 'string' && Array.isArray(r.lv) && r.lv.length === 3 && Array.isArray(r.bb) && r.bb.length === 4 && r.bb.every(isFinite);
  }

  // ---------- Almacén local (IndexedDB, con alternativa en memoria) ----------
  var DB = 'kmes-tracks', ST = 'tracks';
  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!root.indexedDB) { rej(new Error('sin indexedDB')); return; }
      var q;
      try { q = root.indexedDB.open(DB, 1); } catch (e) { rej(e); return; }
      q.onupgradeneeded = function () { q.result.createObjectStore(ST, { keyPath: 'id' }); };
      q.onsuccess = function () { res(q.result); };
      q.onerror = function () { rej(q.error || new Error('idb')); };
      q.onblocked = function () { rej(new Error('bloqueado')); };
    });
  }
  function idbDo(db, mode, fn) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(ST, mode), out = fn(tx.objectStore(ST));
      tx.oncomplete = function () { res(out && out.result !== undefined ? out.result : undefined); };
      tx.onerror = tx.onabort = function () { rej(tx.error || new Error('idb')); };
    });
  }

  // ---------- Capa en el mapa y panel ----------
  function create(o) {
    var map = o.map, L = o.L, toast = o.toast || function () {}, onChange = o.onChange || function () {};
    var recs = [], db = null, persist = false, shown = false, timer = 0, busy = false;
    var layer = L.layerGroup().addTo(map), canvas = L.canvas({ padding: 0.4 });

    function put(r) { return db ? idbDo(db, 'readwrite', function (s) { return s.put(r); }).catch(function () { persist = false; }) : Promise.resolve(); }
    function del(id) { return db ? idbDo(db, 'readwrite', function (s) { return s.delete(id); }).catch(function () { /* */ }) : Promise.resolve(); }

    function tip(text) { var d = document.createElement('span'); d.textContent = text; return d; }
    function draw() {
      layer.clearLayers();
      if (!shown || !recs.length) return;
      var bnd = map.getBounds().pad(0.3), b = [bnd.getSouth(), bnd.getWest(), bnd.getNorth(), bnd.getEast()], lvl = levelForZoom(map.getZoom());
      recs.forEach(function (r) {
        if (!r.vis) return;
        var segs = r.lv[lvl] || [], first = null, last = null;
        segs.forEach(function (s) {
          if (s.length) { if (!first) first = s[0]; last = s[s.length - 1]; }
          clip(s, b, MAX_DRAW).forEach(function (run) {
            L.polyline(run, { renderer: canvas, color: '#0B0B0B', weight: 6.5, opacity: 0.85, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
            L.polyline(run, { renderer: canvas, color: r.col, weight: 3.5, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
          });
        });
        function mark(p, fill, label) {
          if (!p) return;
          L.circleMarker(p, { renderer: canvas, radius: 6.5, color: '#0B0B0B', weight: 2, fillColor: fill, fillOpacity: 1 }).bindTooltip(tip(label + ': ' + r.n), { direction: 'top' }).addTo(layer);
        }
        mark(first, '#00C853', 'Inicio'); mark(last, '#FF3B30', 'Fin');
        (r.wp || []).forEach(function (w) {
          if (w.lat < b[0] || w.lat > b[2] || w.lon < b[1] || w.lon > b[3]) return;
          var m = L.circleMarker([w.lat, w.lon], { renderer: canvas, radius: 4.5, color: '#0B0B0B', weight: 1.5, fillColor: r.col, fillOpacity: 1 }).addTo(layer);
          if (w.n) m.bindTooltip(tip(w.n), { direction: 'top' });
        });
      });
    }
    function schedule() { if (timer) return; timer = setTimeout(function () { timer = 0; draw(); }, 120); }
    map.on('moveend', schedule);

    function load() {
      return idbOpen().then(function (d) {
        db = d; persist = true;
        return idbDo(d, 'readonly', function (s) { return s.getAll(); });
      }).then(function (all) {
        recs = (all || []).filter(validRec).sort(function (a, b) { return a.t - b.t; }).slice(0, MAX_TRACKS);
      }).catch(function () { db = null; persist = false; }).then(function () { draw(); onChange(); });
    }

    function importFile(file) {
      if (busy) return;
      if (!file) return;
      if (file.size > MAX_BYTES) { toast('El archivo es demasiado grande (máximo 15 MB)'); return; }
      if (recs.length >= MAX_TRACKS) { toast('Máximo ' + MAX_TRACKS + ' tracks: borra alguno'); return; }
      busy = true; toast('Leyendo ' + cleanName(file.name) + '…');
      var rd = new FileReader();
      rd.onerror = function () { busy = false; toast('No se pudo leer el archivo'); };
      rd.onload = function () {
        setTimeout(function () {
          var res;
          try { res = parseGPX(String(rd.result)); } catch (e) { res = { error: 'No se pudo leer el archivo.' }; }
          if (res.error) { busy = false; toast(res.error); return; }
          var list = toRecords(res, file.name, recs.length), room = MAX_TRACKS - recs.length, skipped = list.length - room;
          list = list.slice(0, room);
          recs = recs.concat(list);
          Promise.all(list.map(put)).then(function () {
            busy = false; shown = true;
            toast(list.length + (list.length === 1 ? ' track importado' : ' tracks importados') + (skipped > 0 ? ' (' + skipped + ' no caben: máximo ' + MAX_TRACKS + ')' : '') + (persist ? '' : ' · no se guardará al cerrar la app'));
            draw(); onChange();
            var f = list[0];
            if (f && f.bb[0] <= f.bb[2]) map.fitBounds([[f.bb[0], f.bb[1]], [f.bb[2], f.bb[3]]], { maxZoom: 16, animate: false });
          });
        }, 30);
      };
      rd.readAsText(file);
    }

    var input = null;
    function pick() {
      if (!input) {
        input = document.createElement('input');
        input.type = 'file'; input.accept = '.gpx,application/gpx+xml,application/xml,text/xml,application/octet-stream'; input.hidden = true;
        input.addEventListener('change', function () { var f = input.files && input.files[0]; input.value = ''; importFile(f); });
        document.body.appendChild(input);
      }
      input.click();
    }

    function h(tag, a, kids) {
      var e = document.createElement(tag), k;
      for (k in a) { if (k === 'text') e.textContent = a[k]; else if (k === 'onclick') e.addEventListener('click', a[k]); else e.setAttribute(k, a[k]); }
      (kids || []).forEach(function (c) { if (c) e.appendChild(c); });
      return e;
    }
    function panel() {
      var box = h('div', { class: 'trk-panel' });
      box.appendChild(h('button', { type: 'button', class: 'trk-imp', text: '＋ Importar GPX', onclick: pick }));
      if (!recs.length) box.appendChild(h('p', { class: 'trk-help', text: 'Carga un archivo GPX de tu móvil. Se queda solo en este dispositivo.' }));
      recs.forEach(function (r) {
        var dot = h('button', { type: 'button', class: 'trk-dot', 'aria-label': 'Cambiar color', title: 'Cambiar color', onclick: function () {
          r.col = COLORS[(COLORS.indexOf(r.col) + 1) % COLORS.length]; put(r); draw(); onChange();
        } });
        dot.style.background = r.col;
        box.appendChild(h('div', { class: 'trk-row' + (r.vis ? '' : ' off') }, [
          dot,
          h('button', { type: 'button', class: 'trk-go', title: 'Ir al track', onclick: function () {
            var $p = document.getElementById('layersPop'); if ($p) $p.hidden = true;
            if (r.bb[0] <= r.bb[2]) map.fitBounds([[r.bb[0], r.bb[1]], [r.bb[2], r.bb[3]]], { maxZoom: 16, animate: false, padding: [30, 30] });
          } }, [h('b', { text: r.n }), h('small', { text: (r.len ? fmtLen(r.len) + ' · ' : '') + r.np.toLocaleString('es-ES') + ' puntos' + ((r.wp || []).length ? ' · ' + r.wp.length + ' marcas' : '') })]),
          h('button', { type: 'button', class: 'trk-b', 'aria-label': r.vis ? 'Ocultar' : 'Mostrar', title: r.vis ? 'Ocultar' : 'Mostrar', text: r.vis ? '👁' : '—', onclick: function () { r.vis = !r.vis; put(r); draw(); onChange(); } }),
          h('button', { type: 'button', class: 'trk-b', 'aria-label': 'Borrar', title: 'Borrar', text: '🗑', onclick: function () {
            recs = recs.filter(function (x) { return x.id !== r.id; }); del(r.id); draw(); onChange(); toast('Track borrado');
          } }),
        ]));
      });
      if (recs.length > 1) {
        var all = h('button', { type: 'button', class: 'trk-all', text: 'Borrar todos', onclick: function () {
          if (all.dataset.sure !== '1') { all.dataset.sure = '1'; all.textContent = 'Toca otra vez para borrar todos'; setTimeout(function () { all.dataset.sure = ''; all.textContent = 'Borrar todos'; }, 3500); return; }
          var ids = recs.map(function (x) { return x.id; }); recs = []; ids.forEach(del); draw(); onChange(); toast('Tracks borrados');
        } });
        box.appendChild(all);
      }
      if (recs.length && !persist) box.appendChild(h('p', { class: 'trk-help', text: 'Este dispositivo no permite guardarlos: se perderán al cerrar la app.' }));
      return box;
    }

    load();
    return {
      render: function (on) { shown = !!on; draw(); },
      panel: panel,
      count: function () { return recs.length; },
      note: function () { return recs.length ? recs.length + (recs.length === 1 ? ' track' : ' tracks') : 'Sin tracks'; },
    };
  }

  root.KMTracks = {
    parseGPX: parseGPX, simplify: simplify, levelsOf: levelsOf, levelForZoom: levelForZoom, clip: clip, trackLength: trackLength, toRecords: toRecords, validRec: validRec,
    create: create, LIMITS: { bytes: MAX_BYTES, points: MAX_PTS, tracks: MAX_TRACKS, draw: MAX_DRAW },
  };
})(typeof window !== 'undefined' ? window : this);
