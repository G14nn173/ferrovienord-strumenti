/* Service worker: l'app deve funzionare in Val Camonica senza campo.
 * Strategia: cache-first per gli asset, con aggiornamento in sottofondo.
 * Alzare VERSIONE a ogni rilascio per forzare il ricaricamento dei file. */

const VERSIONE = 'bordo-treno-v2';

const ASSET = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './dati/linea-bie.json',
  './icone/icona.svg',
  './icone/icona-192.png',
  './icone/icona-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSIONE)
      .then((c) => c.addAll(ASSET))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(
        chiavi.filter((k) => k !== VERSIONE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then((salvata) => {
      const dalla_rete = fetch(req)
        .then((risposta) => {
          if (risposta && risposta.ok) {
            const copia = risposta.clone();
            caches.open(VERSIONE).then((c) => c.put(req, copia));
          }
          return risposta;
        })
        .catch(() => salvata);

      // offline si parte dalla cache; online si aggiorna comunque in sottofondo
      return salvata || dalla_rete;
    })
  );
});
