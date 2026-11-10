/* SOSpk — configuración */
window.KM_CONFIG = Object.freeze({
  version: '1.2.29',
  // Donde se publican los datos de cada provincia (la app Android descarga de aquí las que no lleva dentro)
  remoteBase: 'https://cilantro-corporation.github.io/SOSpk/',
  // Provincias cargadas la primera vez
  defaultProvinces: ['GU'],
  // Provincias que van incluidas dentro de la app Android
  bundledProvinces: ['GU'],
  // PRO: apagado (enforced: false) hasta que estén las compras de Google Play; ver docs/premium/PLAN.md
  premium: Object.freeze({ enforced: false, priceMonth: '0,99 €', priceYear: '9,99 €', trialDays: 10, checkoutUrl: '', licenciaPublica: 'OmiQ_joeKskmXsJgmnCr7-aiAOt2IulGdgR1fOTb4uQ', licenciaApi: 'https://sospk.app/', testers: true, freeFavs: 5, maxFavs: 50, freeColors: 5, freeIcons: 5 }),
});
