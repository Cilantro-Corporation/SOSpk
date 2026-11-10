/* SOSpk — capa «Tracks» (GPX, KML, KMZ, TCX y GeoJSON en modo local; la versión Básica admite 1 track y PRO hasta 500).
   Cada persona carga sus propios archivos en su dispositivo: se leen aquí, se guardan solo en el almacén del navegador/móvil
   (IndexedDB) y no se envían a ningún sitio. Sin red, sin librerías. Solo lectura: no se exporta nada.
   Las funciones puras (lector, simplificación, recorte) se prueban con tools/test-tracks.mjs. */
(function (root) {
  'use strict';

  var MAX_BYTES = 15 * 1048576, MAX_PTS = 200000, MAX_TRACKS = 500, MAX_DRAW = 5000, MAX_BUDGET = 30000, MAX_WPT = 2000, MAX_DEPTH = 40;
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

  // ---------- Otros formatos: KML, TCX, GeoJSON y KMZ ----------
  // Todos devuelven lo mismo que parseGPX ({ tracks: [{ n, segs }], wpts, points } o { error }) y se reconocen por su CONTENIDO, no por la extensión.
  var FMT = { kml: 'KML', tcx: 'TCX' };
  // Recorrido de un XML (sin DOM ni entidades): mismas protecciones que parseGPX. h = { root, open, close, text }; devuelve un código de error o null
  function xmlScan(text, h) {
    if (typeof text !== 'string' || !text.length) return 'empty';
    if (text.length > MAX_BYTES) return 'big';
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) return 'doctype';
    var re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w.:-]*)((?:[^<>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
    var stack = [], pos = 0, m, err, top, local, parent;
    while (pos < text.length) {
      re.lastIndex = pos;
      m = re.exec(text);
      if (!m || m.index !== pos) return 'bad';
      pos = re.lastIndex;
      err = null;
      if (m[3] !== undefined) {
        if (m[2]) {
          top = stack.pop();
          if (!top || top.r !== m[3]) return 'bad';
          err = h.close(top.l, stack.length ? stack[stack.length - 1].l : '', stack);
        } else {
          if (stack.length >= MAX_DEPTH) return 'bad';
          local = m[3].replace(/^.*:/, '').toLowerCase();
          parent = stack.length ? stack[stack.length - 1].l : '';
          if (!stack.length) { err = h.root(local); if (err) return err; }
          stack.push({ r: m[3], l: local });
          err = h.open(local, m[4], parent, stack);
          if (!err && m[5]) { stack.pop(); err = h.close(local, parent, stack); }
        }
        if (err) return err;
      } else if (m[1] !== undefined) { if (h.text) h.text(m[1], stack); }              // CDATA: tal cual
      else if (m[6] !== undefined) { if (h.text) h.text(decode(m[0]), stack); }        // texto: con sus entidades resueltas
    }
    return stack.length ? 'bad' : null;
  }
  function xmlError(code, fmt) {
    return { error: code === 'empty' ? 'El archivo está vacío.' : code === 'big' ? 'El archivo es demasiado grande (máximo 15 MB).' : code === 'doctype' ? 'El archivo contiene declaraciones no permitidas.'
      : code === 'many' ? 'El archivo tiene demasiados puntos (máximo 200.000).' : code === 'noroot' ? 'El archivo no es un ' + fmt + ' (falta la etiqueta principal).' : 'El archivo no es un ' + fmt + ' válido (XML mal formado).' };
  }
  function hasAnc(st, name) { for (var i = 0; i < st.length; i++) if (st[i].l === name) return true; return false; }
  // «lon,lat[,alt] lon,lat…» (KML). Los espacios alrededor de las comas se toleran
  function kmlCoords(s) {
    var out = [], parts = s.replace(/\s*,\s*/g, ',').trim().split(/\s+/), i, c, lat, lon;
    for (i = 0; i < parts.length; i++) {
      c = parts[i].split(',');
      if (c.length < 2) continue;
      lon = num(c[0]); lat = num(c[1]);
      if (validLL(lat, lon)) out.push([lat, lon]);
    }
    return out;
  }
  function finish(tracks, wpts, total) {
    if (!tracks.length && !wpts.length) return { error: 'El archivo no tiene tracks, rutas ni puntos válidos.' };
    return { tracks: tracks, wpts: wpts, points: total };
  }

  function parseKML(text) {
    var tracks = [], wpts = [], total = 0, pm = null, gx = null, cap = '', buf = '';
    var code = xmlScan(text, {
      root: function (l) { return l === 'kml' ? null : 'noroot'; },
      open: function (l, at, parent) {
        if (l === 'placemark') pm = { n: '', segs: [], pt: null };
        else if (l === 'coordinates' || l === 'coord') { cap = l; buf = ''; }
        else if (l === 'name' && parent === 'placemark') { cap = 'name'; buf = ''; }
        else if (l === 'track' && pm) gx = [];
        return null;
      },
      text: function (s) { if (cap) buf += s; },
      close: function (l, parent, st) {
        if (l === 'coordinates' && cap === 'coordinates') {
          cap = '';
          var pts = kmlCoords(buf);
          total += pts.length;
          if (total > MAX_PTS) return 'many';
          if (pm) {
            if (parent === 'linestring' || (parent === 'linearring' && hasAnc(st, 'outerboundaryis'))) { if (pts.length > 1) pm.segs.push(pts); }
            else if (parent === 'point' && pts.length) pm.pt = pts[0];
          }
        } else if (l === 'coord' && cap === 'coord') {
          cap = '';
          var c = buf.trim().split(/\s+/), lon = num(c[0] || ''), lat = num(c[1] || '');
          if (gx && validLL(lat, lon)) { gx.push([lat, lon]); if (++total > MAX_PTS) return 'many'; }
        } else if (l === 'track' && gx) {
          if (gx.length > 1 && pm) pm.segs.push(gx);
          gx = null;
        } else if (l === 'name' && cap === 'name') {
          cap = '';
          if (pm) pm.n = cleanName(buf);
        } else if (l === 'placemark' && pm) {
          if (pm.segs.length) tracks.push({ n: pm.n, segs: pm.segs });
          else if (pm.pt && wpts.length < MAX_WPT) wpts.push({ n: pm.n, lat: +pm.pt[0].toFixed(6), lon: +pm.pt[1].toFixed(6) });
          pm = null; gx = null;
        }
        return null;
      },
    });
    return code ? xmlError(code, FMT.kml) : finish(tracks, wpts, total);
  }

  function parseTCX(text) {
    var tracks = [], wpts = [], total = 0, cur = null, seg = null, tp = null, cp = null, cap = '', buf = '';
    var code = xmlScan(text, {
      root: function (l) { return l === 'trainingcenterdatabase' ? null : 'noroot'; },
      open: function (l, at, parent) {
        if (l === 'activity' || l === 'course') cur = { n: '', segs: [] };
        else if (l === 'track' && cur) seg = [];
        else if (l === 'trackpoint') tp = { la: NaN, lo: NaN };
        else if (l === 'coursepoint') cp = { n: '', la: NaN, lo: NaN };
        else if (l === 'latitudedegrees' || l === 'longitudedegrees') { cap = l; buf = ''; }
        else if (l === 'name' && (parent === 'course' || parent === 'coursepoint')) { cap = 'name'; buf = ''; }
        return null;
      },
      text: function (s) { if (cap) buf += s; },
      close: function (l, parent) {
        var t = tp || cp;
        if ((l === 'latitudedegrees' || l === 'longitudedegrees') && cap === l) {
          cap = '';
          if (t) { if (l === 'latitudedegrees') t.la = num(buf); else t.lo = num(buf); }
        } else if (l === 'name' && cap === 'name') {
          cap = '';
          if (parent === 'coursepoint' && cp) cp.n = cleanName(buf); else if (parent === 'course' && cur) cur.n = cleanName(buf);
        } else if (l === 'trackpoint' && tp) {
          if (seg && validLL(tp.la, tp.lo)) { seg.push([tp.la, tp.lo]); if (++total > MAX_PTS) return 'many'; }
          tp = null;
        } else if (l === 'coursepoint' && cp) {
          if (validLL(cp.la, cp.lo) && wpts.length < MAX_WPT) wpts.push({ n: cp.n, lat: +cp.la.toFixed(6), lon: +cp.lo.toFixed(6) });
          cp = null;
        } else if (l === 'track' && seg) {
          if (seg.length > 1 && cur) cur.segs.push(seg);
          seg = null;
        } else if ((l === 'activity' || l === 'course') && cur) {
          if (cur.segs.length) tracks.push(cur);
          cur = null;
        }
        return null;
      },
    });
    return code ? xmlError(code, FMT.tcx) : finish(tracks, wpts, total);
  }

  function parseGeoJSON(text) {
    if (typeof text !== 'string' || !text.length) return { error: 'El archivo está vacío.' };
    if (text.length > MAX_BYTES) return { error: 'El archivo es demasiado grande (máximo 15 MB).' };
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    var j, tracks = [], wpts = [], total = 0, over = false;
    try { j = JSON.parse(text); } catch (e) { return { error: 'El archivo no es un GeoJSON válido.' }; }
    function pos(c) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
      return validLL(c[1], c[0]) ? [c[1], c[0]] : null;
    }
    function line(arr) {
      var out = [], i, p;
      if (!Array.isArray(arr)) return out;
      for (i = 0; i < arr.length; i++) { p = pos(arr[i]); if (p) { out.push(p); if (++total > MAX_PTS) { over = true; return out; } } }
      return out;
    }
    function nameOf(props) {
      var v = props && typeof props === 'object' ? (props.name !== undefined ? props.name : props.Name !== undefined ? props.Name : props.title) : '';
      return typeof v === 'string' || typeof v === 'number' ? cleanName(String(v)) : '';
    }
    function addTrack(n, segs) { segs = segs.filter(function (s) { return s.length > 1; }); if (segs.length) tracks.push({ n: n, segs: segs }); }
    function addPoint(n, c) { var p = pos(c); if (p && wpts.length < MAX_WPT) wpts.push({ n: n, lat: +p[0].toFixed(6), lon: +p[1].toFixed(6) }); }
    function geom(g, n, depth) {
      var i;
      if (!g || typeof g !== 'object' || depth > 4 || over) return;
      switch (g.type) {
        case 'LineString': addTrack(n, [line(g.coordinates)]); break;
        case 'MultiLineString': if (Array.isArray(g.coordinates)) addTrack(n, g.coordinates.map(line)); break;
        case 'Polygon': if (Array.isArray(g.coordinates)) addTrack(n, [line(g.coordinates[0])]); break;
        case 'MultiPolygon': if (Array.isArray(g.coordinates)) addTrack(n, g.coordinates.map(function (pg) { return Array.isArray(pg) ? line(pg[0]) : []; })); break;
        case 'Point': addPoint(n, g.coordinates); break;
        case 'MultiPoint': if (Array.isArray(g.coordinates)) for (i = 0; i < g.coordinates.length; i++) addPoint(n, g.coordinates[i]); break;
        case 'GeometryCollection': if (Array.isArray(g.geometries)) for (i = 0; i < g.geometries.length; i++) geom(g.geometries[i], n, depth + 1); break;
      }
    }
    if (!j || typeof j !== 'object') return { error: 'El archivo no es un GeoJSON válido.' };
    if (j.type === 'FeatureCollection' && Array.isArray(j.features)) j.features.slice(0, 5000).forEach(function (f) { if (f && f.type === 'Feature') geom(f.geometry, nameOf(f.properties), 0); });
    else if (j.type === 'Feature') geom(j.geometry, nameOf(j.properties), 0);
    else if (typeof j.type === 'string') geom(j, '', 0);
    else return { error: 'El archivo no es un GeoJSON válido.' };
    if (over) return { error: 'El archivo tiene demasiados puntos (máximo 200.000).' };
    return finish(tracks, wpts, total);
  }

  // KMZ = un ZIP con un KML dentro. Se abre aquí mismo, con los límites de siempre contra archivos comprimidos enormes
  function u16(b, o) { return b[o] | (b[o + 1] << 8); }
  function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function ascii(b, o, n) { var s = '', i; for (i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; }
  function zipKml(b) {
    var i, min = Math.max(0, b.length - 65557);
    for (i = b.length - 22; i >= min; i--) if (u32(b, i) === 0x06054b50) break;
    if (i < min) return null;
    var n = u16(b, i + 10), off = u32(b, i + 16), best = null, k, nl, el, cl, name, e;
    if (n === 0xFFFF || n > 5000 || off >= b.length) return null;
    for (k = 0; k < n; k++) {
      if (off + 46 > b.length || u32(b, off) !== 0x02014b50) return null;
      nl = u16(b, off + 28); el = u16(b, off + 30); cl = u16(b, off + 32);
      name = ascii(b, off + 46, Math.min(nl, 300));
      e = { name: name, flag: u16(b, off + 8), method: u16(b, off + 10), csize: u32(b, off + 20), usize: u32(b, off + 24), lo: u32(b, off + 42) };
      if (/\.kml$/i.test(name) && (!best || /(^|\/)doc\.kml$/i.test(name))) best = e;
      off += 46 + nl + el + cl;
    }
    return best;
  }
  function unzipKml(b) {
    return new Promise(function (resolve, reject) {
      var e = zipKml(b);
      if (!e) { reject(new Error('El archivo comprimido no contiene un KML.')); return; }
      if (e.flag & 1) { reject(new Error('El KMZ está protegido con contraseña.')); return; }
      if (e.usize > MAX_BYTES) { reject(new Error('El KML del interior es demasiado grande (máximo 15 MB).')); return; }
      if (e.lo + 30 > b.length || u32(b, e.lo) !== 0x04034b50) { reject(new Error('El KMZ está dañado.')); return; }
      var start = e.lo + 30 + u16(b, e.lo + 26) + u16(b, e.lo + 28), data = b.subarray(start, start + e.csize);
      if (data.length !== e.csize) { reject(new Error('El KMZ está dañado.')); return; }
      if (e.method === 0) { resolve(data); return; }
      if (e.method !== 8) { reject(new Error('El KMZ usa una compresión no admitida.')); return; }
      if (typeof root.DecompressionStream !== 'function' || typeof root.Blob !== 'function') { reject(new Error('Este dispositivo no puede abrir archivos KMZ: expórtalo como KML.')); return; }
      var rd, parts = [], got = 0;
      try { rd = new root.Blob([data]).stream().pipeThrough(new root.DecompressionStream('deflate-raw')).getReader(); } catch (x) { reject(new Error('Este dispositivo no puede abrir archivos KMZ: expórtalo como KML.')); return; }
      (function pump() {
        rd.read().then(function (r) {
          if (r.done) {
            var out = new Uint8Array(got), p = 0;
            parts.forEach(function (c) { out.set(c, p); p += c.length; });
            resolve(out);
            return;
          }
          got += r.value.length;
          if (got > MAX_BYTES) { rd.cancel(); reject(new Error('El KML del interior es demasiado grande (máximo 15 MB).')); return; }
          parts.push(r.value);
          pump();
        }, function () { reject(new Error('El KMZ está dañado.')); });
      })();
    });
  }

  // Reconocer el formato por el contenido y leerlo
  function detect(text) {
    var s = String(text).replace(/^﻿/, '').replace(/^\s+/, '').slice(0, 4000), m, l;
    if (s.charAt(0) === '{' || s.charAt(0) === '[') return 'geojson';
    m = /<(?![?!])\/?([A-Za-z_][\w.:-]*)/.exec(s);
    l = m ? m[1].replace(/^.*:/, '').toLowerCase() : '';
    return l === 'gpx' ? 'gpx' : l === 'kml' ? 'kml' : l === 'trainingcenterdatabase' ? 'tcx' : '';
  }
  function parseText(text) {
    if (typeof text !== 'string' || !text.length) return { error: 'El archivo está vacío.' };
    var f = detect(text);
    if (f === 'gpx') return parseGPX(text);
    if (f === 'kml') return parseKML(text);
    if (f === 'tcx') return parseTCX(text);
    if (f === 'geojson') return parseGeoJSON(text);
    return { error: 'Formato no reconocido: usa GPX, KML, KMZ, TCX o GeoJSON.' };
  }
  function decodeBytes(u8) {
    var s;
    try { s = new root.TextDecoder('utf-8').decode(u8); } catch (e) { return ascii(u8, 0, u8.length); }
    var m = /^\s*<\?xml[^>]*encoding\s*=\s*["']([\w-]+)["']/i.exec(s.slice(0, 200));
    if (m && !/^utf-?8$/i.test(m[1])) { try { s = new root.TextDecoder(m[1]).decode(u8); } catch (e2) { /* se queda en UTF-8 */ } }
    return s;
  }
  // Lo que se le da al leer un archivo (ArrayBuffer o bytes): promesa de { tracks, wpts, points } o { error }
  function parseBytes(buf) {
    return new Promise(function (resolve) {
      try {
        var u8 = buf && buf.BYTES_PER_ELEMENT ? buf : new Uint8Array(buf);
        if (u8.length > MAX_BYTES) { resolve({ error: 'El archivo es demasiado grande (máximo 15 MB).' }); return; }
        if (u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4B && u8[2] === 0x03 && u8[3] === 0x04) {
          unzipKml(u8).then(function (k) { resolve(parseText(decodeBytes(k))); }, function (e) { resolve({ error: e && e.message ? e.message : 'No se pudo abrir el archivo comprimido.' }); });
          return;
        }
        resolve(parseText(decodeBytes(u8)));
      } catch (e) { resolve({ error: 'No se pudo leer el archivo.' }); }
    });
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
  function levelForZoom(z) { return z >= 17 ? 0 : z >= 14 ? 1 : z >= 11 ? 2 : 3; }

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
        len: Math.round(trackLength(t.segs)), np: np, lv: lv, im: 0, wp: i === 0 ? parsed.wpts : [], bb: bboxOf(t.segs, i === 0 ? parsed.wpts : []), t: t0 + i });
    });
    if (!out.length) out.push({ id: id(), n: base, col: COLORS[startIndex % COLORS.length], vis: true, len: 0, np: 0, lv: [[], [], []], im: 0, wp: parsed.wpts, bb: bboxOf([], parsed.wpts), t: t0 });
    return out;
  }
  function validRec(r) {
    return r && typeof r.id === 'string' && r.id.length < 80 && typeof r.n === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.col) && Array.isArray(r.lv) && r.lv.length === 3 && Array.isArray(r.bb) && r.bb.length === 4 && r.bb.every(isFinite);
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

  // ---------- Capa en el mapa y gestión ----------
  // Pensada para muchos tracks (p. ej. una búsqueda con decenas de equipos): solo se dibuja lo que toca la vista, con el nivel de detalle
  // que cabe en un presupuesto de puntos, y la lista y el filtro viven en Configuración.
  function lvAt(r, i) {
    if (i < 3) return r.lv[i] || [];
    return r._l3 || (r._l3 = (r.lv[2] || []).map(function (s) { return simplify(s, 250); })); // vista general: ~250 m
  }
  function countAt(r, i) { var n = 0; lvAt(r, i).forEach(function (s) { n += s.length; }); return n; }
  function touches(bb, b) { return bb[2] >= b[0] && bb[0] <= b[2] && bb[3] >= b[1] && bb[1] <= b[3]; }
  function okColor(c) { return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c); }

  function create(o) {
    var map = o.map, L = o.L, toast = o.toast || function () {}, onChange = o.onChange || function () {}, onRemove = o.onRemove || function () {}, onManage = o.onManage || function () {};
    // o.tip(layer, texto, registro): opcional, deja a la app poner el cartel con la foto en miniatura
    var recs = [], db = null, persist = false, shown = false, timer = 0, busy = false;
    var layer = L.layerGroup().addTo(map), canvas = L.canvas({ padding: 0.4 });
    // Tope de tracks que se pueden tener ahora (la versión Básica admite 1; la app lo decide con o.cap) y aviso previo a importar (o.canAdd)
    function capNow() { var c = o.cap ? +o.cap() : MAX_TRACKS; return Math.max(0, Math.min(MAX_TRACKS, isFinite(c) ? c : MAX_TRACKS)); }
    function capLabel() { return o.capText ? o.capText() : String(MAX_TRACKS); }

    function put(r) { return db ? idbDo(db, 'readwrite', function (s) { return s.put(r); }).catch(function () { persist = false; }) : Promise.resolve(); }
    function del(id) { return db ? idbDo(db, 'readwrite', function (s) { return s.delete(id); }).catch(function () { /* */ }) : Promise.resolve(); }
    function byId(id) { return recs.filter(function (r) { return r.id === id; })[0] || null; }

    function tip(text) { var d = document.createElement('span'); d.textContent = text; return d; }
    function draw() {
      layer.clearLayers();
      if (!shown || !recs.length) return;
      var z = map.getZoom(), bnd = map.getBounds().pad(0.3), b = [bnd.getSouth(), bnd.getWest(), bnd.getNorth(), bnd.getEast()];
      var vis = recs.filter(function (r) { return r.vis && r.bb[0] <= r.bb[2] && touches(r.bb, b); });
      if (!vis.length) return;
      // Nivel de detalle por zoom; si hay demasiados puntos a la vista, uno más grueso, y como último recurso, muestreo
      var lvl = levelForZoom(z), total = 0;
      for (;;) {
        total = 0;
        vis.forEach(function (r) { total += countAt(r, lvl); });
        if (total <= MAX_BUDGET || lvl >= 3) break;
        lvl++;
      }
      var cap = Math.max(60, Math.min(MAX_DRAW, Math.floor(MAX_BUDGET / vis.length))), few = vis.length <= 60;
      vis.forEach(function (r) {
        var segs = lvAt(r, lvl), runs = [], first = null, last = null;
        segs.forEach(function (s) {
          if (s.length) { if (!first) first = s[0]; last = s[s.length - 1]; }
          clip(s, b, cap).forEach(function (run) { runs.push(run); });
        });
        if (runs.length) {
          L.polyline(runs, { renderer: canvas, color: '#0B0B0B', weight: 6.5, opacity: 0.85, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
          L.polyline(runs, { renderer: canvas, color: okColor(r.col) ? r.col : '#FF3B30', weight: 3.5, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(layer);
        }
        function mark(p, fill, label) {
          if (!p || p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) return;
          var cm = L.circleMarker(p, { renderer: canvas, radius: 6.5, color: '#0B0B0B', weight: 2, fillColor: fill, fillOpacity: 1 });
          // Con foto, el cartel del inicio y del fin la enseña en pequeño junto al nombre (lo resuelve la app)
          if (o.tip) o.tip(cm, label + ': ' + r.n, r); else cm.bindTooltip(tip(label + ': ' + r.n), { direction: 'top' });
          cm.addTo(layer);
        }
        if (few || z >= 12) { mark(first, '#00C853', 'Inicio'); mark(last, '#FF3B30', 'Fin'); }
        if (z >= 13) (r.wp || []).forEach(function (w) {
          if (w.lat < b[0] || w.lat > b[2] || w.lon < b[1] || w.lon > b[3]) return;
          var m = L.circleMarker([w.lat, w.lon], { renderer: canvas, radius: 4.5, color: '#0B0B0B', weight: 1.5, fillColor: okColor(r.col) ? r.col : '#FF3B30', fillOpacity: 1 }).addTo(layer);
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

    function fit(r) {
      if (r && r.bb[0] <= r.bb[2]) map.fitBounds([[r.bb[0], r.bb[1]], [r.bb[2], r.bb[3]]], { maxZoom: 16, animate: false, padding: [30, 30] });
    }
    // Varios archivos a la vez: se leen de uno en uno para no bloquear el móvil
    function importFiles(files) {
      if (busy || !files || !files.length) return;
      var list = Array.prototype.slice.call(files), done = 0, added = 0, bad = 0, skipped = 0, lastRec = null, firstMsg = '';
      busy = true;
      (function next() {
        var file = list.shift();
        if (!file) {
          busy = false; shown = true; draw(); onChange();
          if (lastRec && added === 1) fit(lastRec);
          toast((added ? added + (added === 1 ? ' track importado' : ' tracks importados') : 'No se importó ningún track') + (bad ? ' · ' + bad + (bad === 1 ? ' archivo no válido' : ' archivos no válidos') + (added === 0 && firstMsg ? ': ' + firstMsg : '') : '') + (skipped ? ' · ' + skipped + ' no caben (máximo ' + capLabel() + ')' : '') + (persist ? '' : ' · no se guardarán al cerrar la app'), 4500);
          return;
        }
        done++;
        if (file.size > MAX_BYTES) { bad++; firstMsg = firstMsg || 'más de 15 MB'; next(); return; }
        if (recs.length >= capNow()) { skipped++; next(); return; }
        toast('Leyendo ' + done + ' de ' + (done + list.length) + ': ' + cleanName(file.name) + '…', 6000);
        var rd = new FileReader();
        rd.onerror = function () { bad++; next(); };
        rd.onload = function () {
          setTimeout(function () {
            // GPX, KML, KMZ, TCX o GeoJSON: se reconoce por el contenido
            parseBytes(rd.result).then(function (res) {
              if (res.error) { bad++; firstMsg = firstMsg || res.error.replace(/\.$/, ''); next(); return; }
              var recsNew = toRecords(res, file.name, recs.length), room = Math.max(0, capNow() - recs.length);
              skipped += Math.max(0, recsNew.length - room);
              recsNew = recsNew.slice(0, room);
              recs = recs.concat(recsNew);
              added += recsNew.length;
              lastRec = recsNew[0] || lastRec;
              Promise.all(recsNew.map(put)).then(next);
            });
          }, 20);
        };
        rd.readAsArrayBuffer(file);
      })();
    }

    var input = null;
    function pick() {
      if (o.canAdd && o.canAdd() === false) return; // en la versión Básica con el tope alcanzado, la app enseña el aviso de PRO
      if (!input) {
        input = document.createElement('input');
        input.type = 'file'; input.multiple = true; input.hidden = true;
        input.accept = '.gpx,.kml,.kmz,.tcx,.geojson,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,application/vnd.garmin.tcx+xml,application/geo+json,application/json,application/xml,text/xml,application/octet-stream';
        input.addEventListener('change', function () { var fs = input.files ? Array.prototype.slice.call(input.files) : []; input.value = ''; importFiles(fs); });
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
    // Resumen para el panel de capas (la lista completa y la edición están en Configuración)
    function panel() {
      var box = h('div', { class: 'trk-panel' }), nVis = recs.filter(function (r) { return r.vis; }).length;
      box.appendChild(h('button', { type: 'button', class: 'trk-imp', text: '＋ Importar tracks (puedes elegir varios)', onclick: pick }));
      if (!recs.length) box.appendChild(h('p', { class: 'trk-help', text: 'Carga archivos GPX, KML, KMZ, TCX o GeoJSON de tu móvil. Se quedan solo en este dispositivo.' }));
      else {
        box.appendChild(h('p', { class: 'trk-help', text: recs.length + (recs.length === 1 ? ' track' : ' tracks') + ' · ' + nVis + ' a la vista' + (persist ? '' : ' · no se guardarán al cerrar la app') }));
        box.appendChild(h('div', { class: 'trk-btns' }, [
          h('button', { type: 'button', class: 'subchip', text: 'Mostrar todos', onclick: function () { setAllVisible(true); } }),
          h('button', { type: 'button', class: 'subchip', text: 'Ocultar todos', onclick: function () { setAllVisible(false); } }),
          h('button', { type: 'button', class: 'subchip on', text: 'Lista y edición', onclick: onManage }),
        ]));
      }
      return box;
    }

    function setAllVisible(v) { recs.forEach(function (r) { if (r.vis !== v) { r.vis = v; put(r); } }); draw(); onChange(); }
    function update(id, patch) {
      var r = byId(id); if (!r) return null;
      if (typeof patch.n === 'string') r.n = cleanName(patch.n) || r.n;
      if (okColor(patch.col)) { r.col = patch.col; }
      if (typeof patch.vis === 'boolean') r.vis = patch.vis;
      if (patch.im === 0 || patch.im === 1) r.im = patch.im;
      put(r); draw(); onChange();
      return r;
    }
    function remove(id) {
      var r = byId(id); if (!r) return;
      recs = recs.filter(function (x) { return x.id !== id; });
      del(id); onRemove(id); draw(); onChange();
    }
    function removeAll() {
      var ids = recs.map(function (x) { return x.id; });
      recs = []; ids.forEach(function (id) { del(id); onRemove(id); }); draw(); onChange();
    }

    load();
    return {
      render: function (on) { shown = !!on; draw(); },
      panel: panel,
      pick: pick,
      count: function () { return recs.length; },
      note: function () { return recs.length ? recs.length + (recs.length === 1 ? ' track' : ' tracks') : 'Sin tracks'; },
      persisted: function () { return persist; },
      list: function () { return recs.map(function (r) { return { id: r.id, n: r.n, col: r.col, vis: r.vis, len: r.len, np: r.np, wp: (r.wp || []).length, im: r.im ? 1 : 0, bb: r.bb }; }); },
      update: update, remove: remove, removeAll: removeAll, setAllVisible: setAllVisible,
      goTo: function (id) { fit(byId(id)); },
    };
  }

  root.KMTracks = {
    parseGPX: parseGPX, parseKML: parseKML, parseTCX: parseTCX, parseGeoJSON: parseGeoJSON, parseText: parseText, parseBytes: parseBytes, detect: detect, simplify: simplify, levelsOf: levelsOf, levelForZoom: levelForZoom, clip: clip, trackLength: trackLength, toRecords: toRecords, validRec: validRec,
    create: create, LIMITS: { bytes: MAX_BYTES, points: MAX_PTS, tracks: MAX_TRACKS, draw: MAX_DRAW, budget: MAX_BUDGET },
  };
})(typeof window !== 'undefined' ? window : this);
