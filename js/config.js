/* SOSpk — configuración */
window.KM_CONFIG = Object.freeze({
  version: '1.2.8',
  // Donde se publican los datos de cada provincia (la app Android descarga de aquí las que no lleva dentro)
  remoteBase: 'https://cilantro-corporation.github.io/SOSpk/',
  // Provincias cargadas la primera vez
  defaultProvinces: ['GU'],
  // Provincias que van incluidas dentro de la app Android
  bundledProvinces: ['GU'],
  // Premium: apagado (enforced: false) hasta que estén las compras de Google Play; ver docs/premium/PLAN.md
  // Servicio intermedio de DGT 3.0 (vehículos de emergencia y grúas): vacío hasta que la DGT conceda el acceso
  live: Object.freeze({ relayUrl: '' }),
  premium: Object.freeze({ enforced: false, priceMonth: '0,99 €', priceYear: '4,99 €', trialDays: 10, checkoutUrl: '', testers: true, freeFavs: 5, maxFavs: 50, freeColors: 5, freeIcons: 5 }),
});
