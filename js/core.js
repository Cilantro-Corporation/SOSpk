/* km. España — núcleo de cálculo (sin dependencias, usable en navegador y en Node para tests) */
(function (root) {
  'use strict';

  var R = 6371008.8;
  var RAD = Math.PI / 180;
  var TYPE_ORDER = { A: 0, N: 1, R: 2, P: 3 };
  var CARDINAL = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  // Carreteras provinciales / de diputación o locales (solo para el color y la forma en el mapa):
  // - prefijos que siempre son de diputación o locales (GU, CU, TO, AB, CR, BA, CC, HU, TE, ZP, DSA, PP, VP, BV, GIV...)
  // - "X-P-" / "X-V-" / "X-L-" (AV-P-675, CU-V-5014, HU-V-2021, ZA-L-...)
  // - prefijo de provincia + 4 cifras (SE-3200, LE-5711, CV-4115...); con 3 cifras son autonómicas (AV-500, CA-131, AC-552...)
  var PROV_ANY = /^(AB|CR|CU|CUV|GU|TO|BA|CC|HU|TE|Z|ZP|DSA|PP|VP|DP|EP|CP|JA|JV|BV|BP|GIV|GIP|LV|TV|TP|CHE|DESC|SC|HF|HFO)-/;
  var PROV_PV = /^[A-Z]{1,3}-[PVL]-/;
  var PROV_LONG = /^(AL|CA|CO|GR|H|J|MA|SE|AV|BU|LE|P|SA|SG|SO|VA|ZA|AC|LU|OU|PO|B|GI|L|T|LP|CV|BI)-\d{4}/;
  // Dos cifras con prefijo que no es estatal (M-40, SE-30, CM-41, AS-17, GC-15...): suelen ser autovías, pero no siempre
  var SHORT_LOCAL = /^(?!(A|AP|R|E)-)[A-Z]{1,3}-\d{1,2}$/;

  function key(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');
  }
  // A: autovía / autopista · N: nacional · R: autonómica · P: provincial o local
  function isLocal(name) { return PROV_PV.test(name) || PROV_ANY.test(name) || PROV_LONG.test(name); }
  function roadType(name) {
    if (/^N-/.test(name)) return 'N';
    if (/^AP-/.test(name) || /^[A-Z]{1,3}-\d{1,2}$/.test(name)) return 'A';
    return isLocal(name) ? 'P' : 'R';
  }

  // "44,3" | "44.3" | "44+300" | "km 44" -> 44.3 ; NaN si no es válido
  function parseKm(input) {
    var s = String(input == null ? '' : input).trim().replace(/\s+/g, '').replace(/^(km|pk)/i, '');
    if (!s || s.length > 12) return NaN;
    var m = /^(\d{1,4})\+(\d{1,3})$/.exec(s);
    if (m) return +m[1] + +m[2] / 1000;
    if (!/^\d{1,4}([.,]\d{1,3})?$/.test(s)) return NaN;
    var v = parseFloat(s.replace(',', '.'));
    return v >= 0 && v <= 2000 ? Math.round(v * 1000) / 1000 : NaN;
  }
  function formatKm(km) { return String(Math.round(km * 1000) / 1000).replace('.', ','); }
  function formatDist(m) {
    if (m < 1000) return Math.round(m) + ' m';
    return (Math.round(m / 100) / 10).toString().replace('.', ',') + ' km';
  }
  function cardinal(deg) { return CARDINAL[Math.round((((deg % 360) + 360) % 360) / 45) % 8]; }
  function naturalCompare(a, b) { return a.localeCompare(b, 'es', { numeric: true }); }
  function distance(a, b) {
    var x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD);
    var y = (b[0] - a[0]) * RAD;
    return Math.sqrt(x * x + y * y) * R;
  }

  // ---------- Validación de un archivo de provincia descargado ----------
  function validProvince(d, code) {
    if (!d || typeof d !== 'object' || d.code !== code || !d.roads || typeof d.roads !== 'object' || !Array.isArray(d.segs)) return false;
    var names = Object.keys(d.roads);
    if (names.length > 20000 || d.segs.length > 500000) return false;
    for (var i = 0; i < names.length; i++) {
      var r = d.roads[names[i]];
      if (!/^[A-Z0-9-]{3,16}$/.test(names[i]) || !r || !Array.isArray(r.p) || typeof r.h !== 'number') return false;
      for (var j = 0; j < r.p.length; j++) {
        var row = r.p[j];
        if (!Array.isArray(row) || row.length !== 6) return false;
        for (var k = 0; k < 6; k++) if (typeof row[k] !== 'number' || !isFinite(row[k])) return false;
        for (var s = 3; s < 6; s++) {
          if (row[s] >= d.segs.length || row[s] < -1) return false;
          if (row[s] >= 0 && (!Array.isArray(d.segs[row[s]]) || j + d.segs[row[s]][0] >= r.p.length)) return false;
        }
      }
    }
    for (var q = 0; q < d.segs.length; q++) {
      var sg = d.segs[q];
      if (sg.length < 5 || sg.length % 2 !== 1 || sg[0] < 1) return false;
    }
    return true;
  }

  // ---------- Validación del índice y los límites descargados de la web (APK: datos más nuevos) ----------
  function validIndex(x) {
    if (!x || typeof x !== 'object' || typeof x.v !== 'string' || !/^\d{8,12}$/.test(x.v) || !Array.isArray(x.provs) || !x.roads || typeof x.roads !== 'object') return false;
    if (x.provs.length < 1 || x.provs.length > 60) return false;
    var codes = {};
    for (var i = 0; i < x.provs.length; i++) {
      var p = x.provs[i];
      if (!p || typeof p.code !== 'string' || !/^[A-Z]{1,2}$/.test(p.code) || typeof p.name !== 'string' || p.name.length > 40 ||
        typeof p.community !== 'string' || p.community.length > 40 || typeof p.size !== 'number' || !Array.isArray(p.bbox) || p.bbox.length !== 4) return false;
      for (var b = 0; b < 4; b++) if (typeof p.bbox[b] !== 'number' || !isFinite(p.bbox[b])) return false;
      codes[p.code] = 1;
    }
    var names = Object.keys(x.roads);
    if (names.length > 60000) return false;
    for (var n = 0; n < names.length; n++) {
      var list = x.roads[names[n]];
      if (!/^[A-Z0-9-]{3,16}$/.test(names[n]) || !Array.isArray(list)) return false;
      for (var e = 0; e < list.length; e++) {
        var en = list[e];
        if (!Array.isArray(en) || en.length < 3 || (en.length - 1) % 2 || !codes[en[0]]) return false;
        for (var k = 1; k < en.length; k++) if (typeof en[k] !== 'number' || !isFinite(en[k])) return false;
      }
    }
    return true;
  }
  function validBorders(x) {
    if (!x || typeof x !== 'object' || typeof x.v !== 'string' || !Array.isArray(x.arcs) || !Array.isArray(x.provs) || x.arcs.length !== x.provs.length) return false;
    if (x.arcs.length > 20000) return false;
    for (var i = 0; i < x.arcs.length; i++) {
      var a = x.arcs[i];
      if (!Array.isArray(a) || a.length < 4 || a.length % 2 || typeof x.provs[i] !== 'string' || !/^[A-Z]{1,2}(\|[A-Z]{1,2})*$/.test(x.provs[i])) return false;
      for (var k = 0; k < a.length; k++) if (typeof a[k] !== 'number' || !isFinite(a[k])) return false;
    }
    return true;
  }
  // ¿La versión a ("1.10") es mayor que b ("1.9")?
  function newerVersion(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var d = (parseInt(x[i], 10) || 0) - (parseInt(y[i], 10) || 0);
      if (d) return d > 0;
    }
    return false;
  }

  // index: {provs:[{code,name,community,bbox}], roads:{name:[[prov, a1,b1, a2,b2...], ...]}}
  // provData: {XX: datosProvincia}
  function create(index, provData) {
    var allNames = Object.keys(index.roads).sort(function (a, b) {
      var ta = TYPE_ORDER[roadType(a)], tb = TYPE_ORDER[roadType(b)];
      return ta !== tb ? ta - tb : naturalCompare(a, b);
    });
    var rank = {};
    allNames.forEach(function (n, i) { rank[n] = i; });
    var byKey = {};
    allNames.forEach(function (n) { byKey[key(n)] = n; });
    var provName = {};
    index.provs.forEach(function (p) { provName[p.code] = p.name; });

    // Partes cargadas por carretera: [{prov, h, rows, segs, cache}]
    var parts = {};
    var loaded = Object.keys(provData || {});
    loaded.forEach(function (code) {
      var d = provData[code];
      Object.keys(d.roads).forEach(function (name) {
        if (!parts[name]) parts[name] = [];
        parts[name].push({ prov: code, h: d.roads[name].h, rows: d.roads[name].p, segs: d.segs, cache: {} });
      });
    });

    function seg(part, i) {
      if (part.cache[i]) return part.cache[i];
      var s = part.segs[i];
      var pts = [], lat = 0, lon = 0;
      for (var k = 1; k + 1 < s.length; k += 2) {
        lat = k === 1 ? s[k] : lat + s[k];
        lon = k === 1 ? s[k + 1] : lon + s[k + 1];
        pts.push([lat / 1e5, lon / 1e5]);
      }
      var cum = [0];
      for (var j = 1; j < pts.length; j++) cum.push(cum[j - 1] + distance(pts[j - 1], pts[j]));
      return (part.cache[i] = { jump: s[0], pts: pts, cum: cum, total: cum[cum.length - 1] });
    }
    function along(sg, frac) {
      frac = Math.max(0, Math.min(1, frac));
      var target = frac * sg.total, pts = sg.pts, cum = sg.cum;
      for (var k = 1; k < pts.length; k++) {
        if (target <= cum[k] || k === pts.length - 1) {
          var l = cum[k] - cum[k - 1];
          var t = l > 0 ? Math.max(0, Math.min(1, (target - cum[k - 1]) / l)) : 0;
          return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t];
        }
      }
      return pts[pts.length - 1].slice();
    }

    // ---- Información de una carretera ----
    function provRanges(name) {
      return (index.roads[name] || []).map(function (e) {
        var r = [];
        for (var i = 1; i + 1 < e.length; i += 2) r.push([e[i], e[i + 1]]);
        return { prov: e[0], name: provName[e[0]] || e[0], ranges: r, loaded: loaded.indexOf(e[0]) >= 0 };
      }).sort(function (a, b) { return a.ranges[0][0] - b.ranges[0][0]; });
    }
    var infoCache = {};
    function roadInfo(name) {
      if (!index.roads[name]) return null;
      if (infoCache[name]) return infoCache[name];
      var pr = provRanges(name);
      var mine = pr.filter(function (p) { return p.loaded; });
      // Horquilla de km: solo la de las provincias cargadas si la carretera pasa por alguna
      var all = [];
      (mine.length ? mine : pr).forEach(function (p) { all = all.concat(p.ranges); });
      all.sort(function (a, b) { return a[0] - b[0]; });
      var ps = parts[name] || [];
      var dual = 0, rows = 0, best = null;
      ps.forEach(function (part) {
        part.rows.forEach(function (row) { if (row[4] >= 0 && row[5] >= 0) dual++; });
        rows += part.rows.length;
        if (!best || part.rows.length > best.rows.length) best = part;
      });
      var type = roadType(name);
      // "AS-15", "TE-20", "GC-15"...: con datos cargados, si casi no tiene doble calzada no es una autovía
      if (type === 'A' && SHORT_LOCAL.test(name) && ps.length && dual < Math.max(3, rows * 0.4)) type = isLocal(name) ? 'P' : 'R';
      return (infoCache[name] = {
        name: name,
        type: type,
        heading: best ? best.h : 0,
        min: all.length ? all[0][0] : 0,
        max: all.reduce(function (m, r) { return Math.max(m, r[1]); }, 0),
        provs: pr,
        mine: mine,
        loaded: ps.length > 0,
        dual: dual >= 3,
      });
    }

    function resolveRoad(input) { return byKey[key(input)] || null; }

    function suggest(input, limit) {
      limit = limit || 15;
      var k = key(input);
      var pool = allNames;
      if (!k) {
        // Sin texto: primero las carreteras de las provincias cargadas
        return allNames.filter(function (n) { return parts[n]; }).slice(0, limit);
      }
      var digits = /^\d+$/.test(k);
      var hits = pool.filter(function (n) {
        var nk = key(n);
        if (nk.indexOf(k) === 0) return true;
        return digits && nk.replace(/^[A-Z]+/, '').indexOf(k) === 0;
      });
      hits.sort(function (a, b) {
        var ea = key(a) === k ? 0 : 1, eb = key(b) === k ? 0 : 1;
        if (ea !== eb) return ea - eb;
        var la = parts[a] ? 0 : 1, lb = parts[b] ? 0 : 1; // primero las cargadas
        if (la !== lb) return la - lb;
        var ka = key(a).length, kb = key(b).length;
        if (ka !== kb) return ka - kb;
        return rank[a] - rank[b];
      });
      return hits.slice(0, limit);
    }

    function parseQuery(input) {
      var s = String(input || '').trim().slice(0, 60);
      var m = /^(.*?)[\s]+(?:km|pk)?\s*(\d{1,4}(?:[.,+]\d{1,3})?)$/i.exec(s);
      if (m) {
        var road = resolveRoad(m[1]);
        if (road) return { road: road, km: parseKm(m[2]) };
      }
      return { road: resolveRoad(s), km: NaN };
    }

    // Provincias (cargadas o no) en las que la carretera tiene ese km
    function provincesForKm(name, km) {
      return provRanges(name).filter(function (p) {
        return p.ranges.some(function (r) { return km >= r[0] - 0.001 && km <= r[1] + 0.001; });
      });
    }

    // ---- Localizar un km ---- dir: 0 eje, 1 km creciente, -1 km decreciente
    function locate(name, km, dir) {
      var ps = parts[name];
      if (!ps || !isFinite(km)) return [];
      dir = dir === 1 || dir === -1 ? dir : 0;
      var found = [];
      function add(ll, extra) {
        for (var i = 0; i < found.length; i++) if (distance(found[i].ll, ll) < 150) return;
        found.push({ ll: ll, extra: extra });
      }
      ps.forEach(function (part) {
        var rows = part.rows;
        rows.forEach(function (row, i) {
          if (row[0] !== km) return;
          var ll = [row[1] / 1e5, row[2] / 1e5], on = false;
          if (dir === 1) {
            if (row[4] >= 0) { ll = seg(part, row[4]).pts[0].slice(); on = true; }
            else rows.forEach(function (o, j) {
              if (!on && o[4] >= 0 && j + seg(part, o[4]).jump === i) { var p = seg(part, o[4]).pts; ll = p[p.length - 1].slice(); on = true; }
            });
          } else if (dir === -1) {
            if (row[5] >= 0) { var pb = seg(part, row[5]).pts; ll = pb[pb.length - 1].slice(); on = true; }
            else rows.forEach(function (o, j) {
              if (!on && o[5] >= 0 && j + seg(part, o[5]).jump === i) { ll = seg(part, o[5]).pts[0].slice(); on = true; }
            });
          }
          add(ll, { exact: true, from: km, to: km, carriageway: on, prov: part.prov });
        });
        rows.forEach(function (row, i) {
          if (row[3] < 0) return;
          var u = seg(part, row[3]);
          var a = row[0], b = rows[i + u.jump][0];
          if (!(a < km && km < b)) return;
          var f = (km - a) / (b - a);
          if (dir === 1 && row[4] >= 0) add(along(seg(part, row[4]), f), { exact: false, from: a, to: b, carriageway: true, prov: part.prov });
          else if (dir === -1 && row[5] >= 0) add(along(seg(part, row[5]), 1 - f), { exact: false, from: a, to: b, carriageway: true, prov: part.prov });
          else add(along(u, f), { exact: false, from: a, to: b, carriageway: false, prov: part.prov });
        });
      });
      return found.map(function (f) {
        return { road: name, km: km, dir: dir, lat: f.ll[0], lon: f.ll[1], exact: f.extra.exact, from: f.extra.from, to: f.extra.to, carriageway: f.extra.carriageway, prov: f.extra.prov };
      });
    }

    // ---- Rejilla espacial para "PK más cercano" ----
    var CELL = 0.1;
    var grid = null;
    function buildGrid() {
      grid = {};
      Object.keys(parts).forEach(function (name) {
        parts[name].forEach(function (part) {
          part.rows.forEach(function (row, i) {
            var k = Math.floor(row[1] / 1e5 / CELL) + ':' + Math.floor(row[2] / 1e5 / CELL);
            (grid[k] || (grid[k] = [])).push([name, part, i]);
          });
        });
      });
    }
    function nearest(lat, lon, maxDist, limit) {
      if (!grid) buildGrid();
      maxDist = maxDist || 3000;
      limit = limit || 3;
      var cosLat = Math.cos(lat * RAD);
      var px = lon * RAD * R * cosLat, py = lat * RAD * R;
      var best = {};
      var cla = Math.floor(lat / CELL), clo = Math.floor(lon / CELL);
      for (var a = cla - 1; a <= cla + 1; a++) for (var b = clo - 1; b <= clo + 1; b++) {
        (grid[a + ':' + b] || []).forEach(function (e) {
          var name = e[0], part = e[1], i = e[2], row = part.rows[i], cand = null;
          if (row[3] < 0) {
            var ll = [row[1] / 1e5, row[2] / 1e5];
            cand = { d: distance([lat, lon], ll), km: row[0], lat: ll[0], lon: ll[1] };
          } else {
            var u = seg(part, row[3]);
            var ka = row[0], kb = part.rows[i + u.jump][0], pts = u.pts;
            for (var k = 1; k < pts.length; k++) {
              var ax = pts[k - 1][1] * RAD * R * cosLat, ay = pts[k - 1][0] * RAD * R;
              var bx = pts[k][1] * RAD * R * cosLat, by = pts[k][0] * RAD * R;
              var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
              var t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
              var d = Math.sqrt(Math.pow(px - ax - t * dx, 2) + Math.pow(py - ay - t * dy, 2));
              if (!cand || d < cand.d) {
                var walked = u.cum[k - 1] + t * (u.cum[k] - u.cum[k - 1]);
                var frac = u.total > 0 ? walked / u.total : 0;
                cand = { d: d, km: Math.round((ka + (kb - ka) * frac) * 1000) / 1000,
                  lat: pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * t, lon: pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * t };
              }
            }
          }
          if (cand && cand.d <= maxDist && (!best[name] || cand.d < best[name].d)) best[name] = cand;
        });
      }
      return Object.keys(best).map(function (n) {
        var c = best[n];
        return { road: n, km: c.km, d: c.d, lat: c.lat, lon: c.lon };
      }).sort(function (x, y) { return x.d - y.d; }).slice(0, limit);
    }

    // ---- Para pintar ----
    // Cada PK con su tipo de carretera y "end" si es el primero o el último de un tramo de la carretera en esa provincia
    var markerList = null;
    function markers() {
      if (markerList) return markerList;
      var seen = {};
      markerList = [];
      Object.keys(parts).forEach(function (n) {
        var t = roadInfo(n).type;
        parts[n].forEach(function (part) {
          var ends = {};
          (index.roads[n] || []).forEach(function (e) {
            if (e[0] === part.prov) for (var i = 1; i + 1 < e.length; i += 2) { ends[e[i]] = 1; ends[e[i + 1]] = 1; }
          });
          part.rows.forEach(function (row) {
            var k = n + '|' + row[0] + '|' + Math.round(row[1] / 50) + '|' + Math.round(row[2] / 50);
            var end = !!ends[row[0]];
            if (seen[k] != null) { if (end) markerList[seen[k]].end = true; return; }
            seen[k] = markerList.length;
            markerList.push({ road: n, type: t, km: row[0], lat: row[1] / 1e5, lon: row[2] / 1e5, end: end });
          });
        });
      });
      return markerList;
    }
    function lines(name) {
      var out = [];
      (parts[name] || []).forEach(function (part) {
        part.rows.forEach(function (row) { if (row[3] >= 0) out.push(seg(part, row[3]).pts); });
      });
      return out;
    }

    return {
      names: allNames,
      loaded: loaded,
      roadInfo: roadInfo,
      resolveRoad: resolveRoad,
      suggest: suggest,
      parseQuery: parseQuery,
      provincesForKm: provincesForKm,
      locate: locate,
      nearest: nearest,
      markers: markers,
      lines: lines,
      distance: distance,
      provName: function (c) { return provName[c] || c; },
      typeOf: function (n) { var inf = roadInfo(n); return inf ? inf.type : roadType(n); },
    };
  }

  // ---------- Límites provinciales ----------
  // borders: {arcs:[[lat*1e4, lon*1e4, deltas...]], provs:["GU", "CU|GU", ...]}
  function createBorders(borders) {
    var arcs = borders.arcs.map(function (f) {
      var pts = [], la = 0, lo = 0;
      for (var i = 0; i + 1 < f.length; i += 2) {
        la = i ? la + f[i] : f[i]; lo = i ? lo + f[i + 1] : f[i + 1];
        pts.push([la / 1e4, lo / 1e4]);
      }
      return pts;
    });
    var arcProvs = borders.provs.map(function (s) { return String(s).split('|'); });
    var byProv = {};
    arcProvs.forEach(function (ps, i) {
      ps.forEach(function (p) { (byProv[p] || (byProv[p] = [])).push(i); });
    });
    var bbox = {};
    Object.keys(byProv).forEach(function (p) {
      var b = [90, 180, -90, -180];
      byProv[p].forEach(function (i) {
        arcs[i].forEach(function (q) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); });
      });
      bbox[p] = b;
    });

    function inProv(code, lat, lon) {
      var b = bbox[code];
      if (!b || lat < b[0] || lat > b[2] || lon < b[1] || lon > b[3]) return false;
      var inside = false;
      byProv[code].forEach(function (i) {
        var pts = arcs[i];
        for (var k = 1; k < pts.length; k++) {
          var a = pts[k - 1], c = pts[k];
          if ((a[0] > lat) !== (c[0] > lat) && lon < ((c[1] - a[1]) * (lat - a[0])) / (c[0] - a[0]) + a[1]) inside = !inside;
        }
      });
      return inside;
    }
    function provinceAt(lat, lon) {
      var codes = Object.keys(byProv);
      for (var i = 0; i < codes.length; i++) if (inProv(codes[i], lat, lon)) return codes[i];
      return null;
    }
    // Contorno de un conjunto de provincias: exterior (tramos con exactamente una provincia del conjunto)
    // e interior (límites entre dos provincias del conjunto, para dibujarlos finos)
    function outline(codes) {
      var set = {};
      codes.forEach(function (c) { set[c] = 1; });
      var lines = [], inner = [];
      arcProvs.forEach(function (ps, i) {
        var n = 0;
        ps.forEach(function (p) { if (set[p]) n++; });
        if (n === 1) lines.push(arcs[i]);
        else if (n > 1 && n === ps.length) inner.push(arcs[i]);
      });
      return { lines: lines, inner: inner, rings: chain(lines) };
    }
    // Une tramos por sus extremos en anillos cerrados (para oscurecer el exterior)
    function chain(lines) {
      var k = function (p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); };
      var ends = {};
      lines.forEach(function (l, i) {
        [k(l[0]), k(l[l.length - 1])].forEach(function (e) { (ends[e] || (ends[e] = [])).push(i); });
      });
      var used = {}, rings = [];
      lines.forEach(function (l0, i0) {
        if (used[i0]) return;
        used[i0] = 1;
        var ring = l0.slice();
        for (var guard = 0; guard < 5000; guard++) {
          var endK = k(ring[ring.length - 1]);
          if (endK === k(ring[0]) && ring.length > 3) break;
          var nxt = (ends[endK] || []).filter(function (j) { return !used[j]; })[0];
          if (nxt == null) { ring = null; break; }
          used[nxt] = 1;
          var l = lines[nxt];
          ring = ring.concat(k(l[0]) === endK ? l.slice(1) : l.slice(0, -1).reverse());
        }
        if (ring && ring.length > 3) rings.push(ring);
      });
      return rings;
    }
    return { provinceAt: provinceAt, outline: outline, bbox: function (c) { return bbox[c]; } };
  }

  root.KMCore = {
    create: create,
    createBorders: createBorders,
    validProvince: validProvince,
    validIndex: validIndex,
    validBorders: validBorders,
    newerVersion: newerVersion,
    key: key,
    roadType: roadType,
    parseKm: parseKm,
    formatKm: formatKm,
    formatDist: formatDist,
    cardinal: cardinal,
    distance: distance,
  };
})(typeof window !== 'undefined' ? window : globalThis);
