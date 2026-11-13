/* SOSpk — configuración */
window.KM_CONFIG = Object.freeze({
  version: '1.2.35',
  // Donde se publican los datos de cada provincia (la app Android descarga de aquí las que no lleva dentro)
  remoteBase: 'https://cilantro-corporation.github.io/SOSpk/',
  // Provincias cargadas la primera vez
  defaultProvinces: ['GU'],
  // Provincias que van incluidas dentro de la app Android
  bundledProvinces: ['GU'],
  // Página de información y ayuda que abre la app instalada (Configuración › Créditos). Vacía = no se muestra. Activada el 10/11/2026 (mientras sospk.app tenga contraseña, la pide el navegador)
  infoUrl: 'https://sospk.app/info/',
  // Mapas sin conexión, nivel «Muy alto» (zoom 15, ~1 GB por provincia grande). APAGADO hasta que el CNIG autorice el uso (consulta enviada el 10/11/2026); poner true para activarlo (y restaurar los textos: ver docs/premium/TRACKS-Y-MAPAS.md)
  mapMuyAlto: false,
  // Clave pública con la que se comprueba la firma de los datos (data/manifest.json, lo crea tools/firmar-datos.mjs). Vacía = sin comprobar
  datosPublica: 'k0TvGAVQnwjJfvpzhx9JGwmLaJ9A8q9FsVBMMyMjjM4',
  // PRO: apagado (enforced: false) hasta que estén las compras de Google Play; ver docs/premium/PLAN.md
  premium: Object.freeze({ enforced: false, priceMonth: '0,99 €', priceYear: '9,99 €', trialDays: 10, checkoutUrl: '', portalUrl: '',licenciaPublica: 'OmiQ_joeKskmXsJgmnCr7-aiAOt2IulGdgR1fOTb4uQ', licenciaApi: 'https://sospk.app/', testers: true, devTap: false, freeZones: 1, freeTracks: 1, freeFavs: 5, maxFavs: 50, freeColors: 5, freeIcons: 5 }),
});
