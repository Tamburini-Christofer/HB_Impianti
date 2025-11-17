// Service Worker per HB Termoimpianti PWA
const CACHE_NAME = 'hb-impianti-v1.0';
const urlsToCache = [
  '/Hb_home.html',
  '/app.js',
  '/style.css',
  '/img/logo.ico',
  '/manifest.json',
  // Cache anche le librerie CDN
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.1/css/all.min.css',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
];

// Installazione Service Worker
self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker: Installazione in corso...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('📦 Service Worker: Cache aperta');
        return cache.addAll(urlsToCache);
      })
      .then(() => {
        console.log('✅ Service Worker: Installazione completata');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('❌ Service Worker: Errore installazione:', error);
      })
  );
});

// Attivazione Service Worker
self.addEventListener('activate', (event) => {
  console.log('🚀 Service Worker: Attivazione in corso...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Service Worker: Rimozione cache obsoleta:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('✅ Service Worker: Attivazione completata');
      return self.clients.claim();
    })
  );
});

// Intercettazione richieste di rete
self.addEventListener('fetch', (event) => {
  // Strategia Cache First per risorse statiche
  if (event.request.destination === 'document' || 
      event.request.destination === 'script' || 
      event.request.destination === 'style' || 
      event.request.destination === 'image') {
    
    event.respondWith(
      caches.match(event.request)
        .then((response) => {
          // Restituisci dalla cache se disponibile
          if (response) {
            console.log('📋 Cache hit per:', event.request.url);
            return response;
          }

          // Altrimenti fetch dalla rete e cache
          return fetch(event.request).then((response) => {
            // Controlla se abbiamo una risposta valida
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }

            // Clona la risposta
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
                console.log('💾 Aggiunto alla cache:', event.request.url);
              });

            return response;
          });
        })
        .catch(() => {
          // Fallback per pagine offline
          if (event.request.destination === 'document') {
            return caches.match('/Hb_home.html');
          }
        })
    );
  } else {
    // Per altri tipi di richieste (API, localStorage), passa attraverso
    event.respondWith(fetch(event.request));
  }
});

// Gestione messaggi dall'app principale
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      version: CACHE_NAME,
      timestamp: new Date().toISOString()
    });
  }
});

console.log('🎯 Service Worker HB Termoimpianti caricato!');