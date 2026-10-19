/* km. España — lector de coordenadas en varios formatos (sin red: nunca visita los enlaces) */
(function (root) {
  'use strict';

  function valid(lat, lon) {
    return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  }
  function out(lat, lon, format) {
    lat = Math.round(lat * 1e6) / 1e6; lon = Math.round(lon * 1e6) / 1e6;
    return valid(lat, lon) ? { lat: lat, lon: lon, format: format } : null;
  }

  // Enlaces de Google Maps, Apple Maps, WhatsApp, geo:
  function fromUrl(s) {
    var t = s;
    try { t = decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { /* se usa tal cual */ }
    var m = /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(t);
    if (m) return out(+m[1], +m[2], 'Google Maps');
    m = /[?&](?:q|query|ll|sll|daddr|destination|center|coordinate|saddr|loc)=(?:loc:)?\s*(-?\d{1,3}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/i.exec(t);
    if (m) return out(+m[1], +m[2], /apple\.com/i.test(t) ? 'Apple Maps' : 'enlace de mapa');
    m = /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/.exec(t);
    if (m) return out(+m[1], +m[2], 'Google Maps');
    m = /geo:(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/i.exec(t);
    if (m) return out(+m[1], +m[2], 'geo');
    m = /\/maps\/(?:place|search|dir)\/[^@]*?(-?\d{1,3}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(t);
    if (m) return out(+m[1], +m[2], 'Google Maps');
    return null;
  }

  function isShortLink(s) {
    return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs)\//i.test(s.trim());
  }

  // Texto: decimal, grados-minutos(-segundos), con o sin N/S/E/O/W
  function fromText(s, commaDecimal) {
    // Las marcas de grados/minutos/segundos se sustituyen por d/m/s en minúscula (no confundir con S = sur)
    var t = s.toUpperCase()
      .replace(/\bLAT(ITUD)?\b|\bLON(GITUD)?\b|\bLNG\b/g, ' ')
      .replace(/[º°˚]/g, ' d ')
      .replace(/[′’'`´]{2}|″|"|”/g, ' s ')
      .replace(/[′’'`´]/g, ' m ');
    if (commaDecimal) t = t.replace(/(\d),(\d)/g, '$1.$2');
    t = t.replace(/[,;/]/g, ' ');
    // Letras permitidas: N S E W O (oeste) y las marcas d m s
    var tokens = t.match(/-?\d+(?:\.\d+)?|[A-Za-z]+/g);
    if (!tokens) return null;
    var nums = [], hemis = [], seq = [];
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (/^-?\d/.test(tk)) { nums.push(+tk); seq.push({ n: +tk, raw: tk }); }
      else if (/^[NSEWO]$/.test(tk)) { hemis.push(tk); seq.push({ h: tk }); }
      else if (/^[dms]$/.test(tk)) { seq.push({ unit: tk }); }
      else return null; // otras letras: no es una coordenada
    }
    if (hemis.length !== 0 && hemis.length !== 2) return null;
    if (nums.length !== 2 && nums.length !== 4 && nums.length !== 6) return null;

    var groups;
    if (hemis.length === 2) {
      var prefix = seq[0].h != null;
      groups = [];
      var cur = null;
      seq.forEach(function (x) {
        if (x.h != null) {
          if (prefix) { cur = { h: x.h, v: [] }; groups.push(cur); }
          else { if (cur) { cur.h = x.h; cur = null; } }
        } else if (x.n != null) {
          if (prefix) { if (cur) cur.v.push(x); }
          else { if (!cur) { cur = { h: null, v: [] }; groups.push(cur); } cur.v.push(x); }
        }
      });
      if (groups.length !== 2 || groups.some(function (g) { return !g.h || !g.v.length || g.v.length > 3; })) return null;
    } else {
      var half = nums.length / 2;
      var all = seq.filter(function (x) { return x.n != null; });
      groups = [{ h: null, v: all.slice(0, half) }, { h: null, v: all.slice(half) }];
      // Sin hemisferio y sin símbolos de grado, exigimos decimales (para no confundir con "A 2 44")
      if (half === 1 && !/\./.test(all[0].raw + all[1].raw)) return null;
    }

    function toDeg(g) {
      var v = g.v.map(function (x) { return x.n; });
      var neg = v[0] < 0 || g.h === 'S' || g.h === 'W' || g.h === 'O';
      var d = Math.abs(v[0]), mi = v[1] || 0, se = v[2] || 0;
      if (mi < 0 || mi >= 60 || se < 0 || se >= 60) return NaN;
      if (v.length > 1 && d % 1 !== 0) return NaN;
      if (v.length > 2 && mi % 1 !== 0) return NaN;
      var r = d + mi / 60 + se / 3600;
      return neg ? -r : r;
    }
    var a = toDeg(groups[0]), b = toDeg(groups[1]);
    if (!isFinite(a) || !isFinite(b)) return null;
    var latFirst = true;
    if (groups[0].h && /[EWO]/.test(groups[0].h)) latFirst = false;
    if (groups[0].h && groups[1].h && (/[NS]/.test(groups[0].h) === /[NS]/.test(groups[1].h))) return null;
    var lat = latFirst ? a : b, lon = latFirst ? b : a;
    var fmt = nums.length === 6 ? 'grados, minutos y segundos' : nums.length === 4 ? 'grados y minutos' : 'decimal';
    return out(lat, lon, fmt);
  }

  // Devuelve {lat, lon, format} | {short: true} | null
  function parse(input) {
    var s = String(input == null ? '' : input).trim();
    if (!s || s.length > 2000) return null;
    if (/^https?:\/\//i.test(s) || /\b(maps\.google|google\.[a-z.]+\/maps|maps\.apple\.com|wa\.me|geo:)/i.test(s)) {
      var u = fromUrl(s);
      if (u) return u;
      if (isShortLink(s)) return { short: true };
      return null;
    }
    if (s.length > 80) return null;
    var hasDot = /\d\.\d/.test(s);
    return (!hasDot && fromText(s, true)) || fromText(s, false);
  }

  // Texto para copiar: se pega tal cual en el buscador de Google Maps y lleva al punto ("40.629420, -3.148750")
  function forMaps(lat, lon) { return lat.toFixed(6) + ', ' + lon.toFixed(6); }

  root.KMCoords = { parse: parse, isShortLink: isShortLink, forMaps: forMaps };
})(typeof window !== 'undefined' ? window : globalThis);
