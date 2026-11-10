/* SOSpk — licencia PRO firmada (sin cuentas).
   Una licencia es un texto  SOSPK1.<payload en base64url>.<firma Ed25519 en base64url>  que el servidor firma al cobrar
   (Stripe) y que la app comprueba SIN conexión con la clave pública de config.js. Ver docs/premium/COBROS-Y-LICENCIAS.md.
   Aquí solo hay funciones puras (se prueban con tools/test-licencia.mjs). Necesita vendor/nacl/nacl-fast.min.js (tweetnacl).
   Todavía NO está conectada a isPremium(): se enchufa cuando se decidan los canales de cobro. */
(function (root) {
  'use strict';

  var PREFIX = 'SOSPK1';
  var PLANES = { mes: 1, anio: 1, org: 1 };
  var ALF = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64uToBytes(s) {
    s = String(s).replace(/=+$/, '');
    if (/[^A-Za-z0-9\-_]/.test(s) || s.length % 4 === 1) return null;
    var out = [], bits = 0, acc = 0;
    for (var i = 0; i < s.length; i++) {
      acc = (acc << 6) | ALF.indexOf(s.charAt(i)); bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return new Uint8Array(out);
  }

  function asciiBytes(s) {
    var b = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255;
    return b;
  }

  function utf8ToString(bytes) {
    var s = '', i = 0, c, c2, c3, c4, cp;
    while (i < bytes.length) {
      c = bytes[i++];
      if (c < 128) s += String.fromCharCode(c);
      else if (c >= 194 && c < 224) { c2 = bytes[i++]; s += String.fromCharCode(((c & 31) << 6) | (c2 & 63)); }
      else if (c >= 224 && c < 240) { c2 = bytes[i++]; c3 = bytes[i++]; s += String.fromCharCode(((c & 15) << 12) | ((c2 & 63) << 6) | (c3 & 63)); }
      else if (c >= 240 && c < 245) {
        c2 = bytes[i++]; c3 = bytes[i++]; c4 = bytes[i++];
        cp = ((c & 7) << 18) | ((c2 & 63) << 12) | ((c3 & 63) << 6) | (c4 & 63); cp -= 0x10000;
        s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
      } else return null;
    }
    return s;
  }

  // Acepta la licencia pegada tal cual, partida en líneas o dentro de un enlace (…#licencia=SOSPK1.…).
  // Devuelve los candidatos: primero el texto como viene (por si va seguido de más palabras) y luego sin espacios (por si se partió en líneas).
  var RE = /SOSPK1\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/;
  function candidates(text) {
    if (typeof text !== 'string') return [];
    var out = [], a = text.match(RE), b = text.replace(/\s+/g, '').match(RE);
    if (a) out.push(a[0]);
    if (b && (!a || b[0] !== a[0])) out.push(b[0]);
    return out;
  }
  function extract(text) { var c = candidates(text); return c.length ? c[0] : null; }

  /* verify(texto, clavePublicaB64u, ahoraEnSegundos, idsRevocados) -> { ok, reason, plan, id, exp, org, seats, daysLeft }
     reason: 'formato' | 'version' | 'firma' | 'plan' | 'caducada' | 'revocada' | 'reloj' | 'sinclave' */
  function verify(text, pubKey, now, revoked) {
    var c = candidates(text), r = { ok: false, reason: 'formato' };
    for (var i = 0; i < c.length; i++) {
      r = verifyOne(c[i], pubKey, now, revoked);
      if (r.ok) r.token = c[i];                                                 // la licencia tal cual vale: es la que se guarda
      if (r.ok || (r.reason !== 'formato' && r.reason !== 'firma')) return r;  // si falla por formato o firma se prueba el otro candidato
    }
    return r;
  }

  function verifyOne(lic, pubKey, now, revoked) {
    var nacl = root.nacl;
    if (!nacl || !nacl.sign || !nacl.sign.detached || !nacl.sign.detached.verify) return { ok: false, reason: 'sinclave' };
    var parts = lic.split('.');
    var pub = b64uToBytes(pubKey || ''), sig = b64uToBytes(parts[2]), pay = b64uToBytes(parts[1]);
    if (!pub || pub.length !== 32) return { ok: false, reason: 'sinclave' };
    if (!sig || sig.length !== 64 || !pay) return { ok: false, reason: 'formato' };
    var good;
    try { good = nacl.sign.detached.verify(asciiBytes(PREFIX + '.' + parts[1]), sig, pub); } catch (e) { good = false; }
    if (!good) return { ok: false, reason: 'firma' };
    var p;
    try { p = JSON.parse(utf8ToString(pay)); } catch (e2) { return { ok: false, reason: 'formato' }; }
    if (!p || typeof p !== 'object') return { ok: false, reason: 'formato' };
    if (p.v !== 1) return { ok: false, reason: 'version' };
    if (!PLANES[p.plan] || typeof p.id !== 'string' || !p.id || typeof p.iat !== 'number' || typeof p.exp !== 'number') return { ok: false, reason: 'formato' };
    var r = { plan: p.plan, id: p.id, exp: p.exp, org: typeof p.org === 'string' ? p.org : '', seats: typeof p.seats === 'number' ? p.seats : 0 };
    now = typeof now === 'number' ? now : Math.floor(Date.now() / 1000);
    if (p.iat > now + 2 * 86400) { r.ok = false; r.reason = 'reloj'; return r; }  // el móvil tiene la fecha muy atrasada
    if (revoked && revoked.indexOf && revoked.indexOf(p.id) >= 0) { r.ok = false; r.reason = 'revocada'; return r; }
    if (p.exp <= now) { r.ok = false; r.reason = 'caducada'; return r; }
    r.ok = true; r.reason = ''; r.daysLeft = Math.ceil((p.exp - now) / 86400);
    return r;
  }

  root.KMLic = { verify: verify, extract: extract, PREFIX: PREFIX };
})(typeof window !== 'undefined' ? window : this);
