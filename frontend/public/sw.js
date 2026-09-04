// Le service worker de Foyer : recevoir les rappels, et servir l'application
// quand le réseau manque.
//
// ---- Les rappels -----------------------------------------------------------
//
// Règle d'Apple à ne jamais enfreindre : un message push reçu doit TOUJOURS
// afficher une notification. Sinon iOS le tient pour un push silencieux et
// révoque l'abonnement, sans le dire à personne. D'où le repli sur un texte
// générique quand le contenu est illisible.
//
// ---- Le cache --------------------------------------------------------------
//
// Il ne garde que la **coquille** : le HTML d'entrée, les fichiers du build et
// les icônes. Jamais `/api/…` : les données du foyer sont l'affaire du store,
// qui les garde de son côté (voir core/offline-doc.ts). Un cache de réponses
// d'API montrerait un foyer figé sans savoir dire de quand il date.
//
// Deux politiques, et le choix de fond est là :
//
//   - **Le HTML d'entrée passe par le réseau d'abord**, le cache ne servant
//     que s'il ne répond pas. C'est ce qui garantit qu'une mise à jour arrive
//     au premier chargement en ligne. L'inverse (cache d'abord) est le piège
//     classique des PWA : l'application se fige sur une version, et
//     l'auto-mise à jour du serveur ne se voit jamais.
//   - **Les fichiers du build sont pris dans le cache d'abord.** Leur nom porte
//     une empreinte du contenu : un nouveau build produit de nouveaux noms, il
//     n'y a donc aucun risque de servir l'ancien code pour le nouveau HTML.
//
// Les polices viennent de Google et ne sont pas mises en cache : hors ligne,
// l'interface se rend avec les polices du système. C'est une différence
// d'allure, pas de fonctionnement.
const CACHE = 'foyer-shell-v1';
/** Au-delà, les fichiers des builds précédents sont élagués, les plus anciens d'abord. */
const MAX_ENTRIES = 60;
const INDEX = new URL('index.html', self.registration.scope).href;

/**
 * La coquille est mise de côté **à l'installation**, sans quoi elle ne le serait
 * qu'au deuxième passage : au premier chargement, le service worker n'est pas
 * encore actif et n'intercepte rien. Quelqu'un qui ouvre l'application une fois
 * puis perd le réseau n'aurait alors rien du tout.
 *
 * Les noms des fichiers du build portent une empreinte et changent à chaque
 * version : on ne peut pas les écrire ici. On lit donc le HTML d'entrée et on
 * prend ce qu'il référence. C'est exact par construction, et ça survit à un
 * changement d'outil de build.
 */
self.addEventListener('install', (event) => event.waitUntil((async () => {
  try {
    const cache = await caches.open(CACHE);
    const reponse = await fetch(INDEX, { cache: 'reload' });
    if (reponse.ok) {
      const html = await reponse.clone().text();
      await cache.put(INDEX, reponse);
      const liens = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      const atteindre = new Set();
      for (const lien of liens) {
        let url;
        try { url = new URL(lien, INDEX); } catch { continue; }
        if (url.origin === self.location.origin && estCoquilleUrl(url)) atteindre.add(url.href);
      }
      // Un par un, pas en bloc : un seul fichier manquant ne doit pas faire
      // échouer tout le préchargement et laisser le cache vide.
      for (const href of atteindre) {
        try {
          const r = await fetch(href, { cache: 'reload' });
          if (r.ok) await cache.put(href, r);
        } catch { /* celui-là se prendra au vol */ }
      }
    }
  } catch { /* pas de réseau à l'installation : le cache se remplira au prochain passage */ }
  await self.skipWaiting();
})()));
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  for (const nom of await caches.keys()) if (nom !== CACHE) await caches.delete(nom);
  await self.clients.claim();
})()));

/** Range une réponse et borne le cache : sans cela, chaque build y laisserait ses fichiers pour toujours. */
async function garder(cle, reponse) {
  const cache = await caches.open(CACHE);
  await cache.put(cle, reponse);
  const cles = await cache.keys();
  for (let i = 0; i < cles.length - MAX_ENTRIES; i++) await cache.delete(cles[i]);
}

/** Cette adresse est-elle un fichier de la coquille ? Jamais l'API. */
function estCoquilleUrl(url) {
  if (url.pathname.includes('/api/')) return false;
  return /\.(?:js|css|png|svg|ico|webmanifest|woff2?)$/.test(url.pathname);
}

/** Cette requête relève-t-elle de la coquille ? Ni l'API, ni ce qui n'est pas à nous. */
function estCoquille(url, request) {
  return request.method === 'GET' && url.origin === self.location.origin && estCoquilleUrl(url);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Le HTML d'entrée : réseau d'abord, pour qu'une mise à jour arrive tout de suite.
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const frais = await fetch(event.request);
        if (frais.ok) await garder(INDEX, frais.clone());
        return frais;
      } catch (e) {
        const garde = await caches.match(INDEX);
        if (garde) return garde;
        throw e;
      }
    })());
    return;
  }

  if (!estCoquille(url, event.request)) return;

  // Les fichiers du build : cache d'abord, leur nom portant leur empreinte.
  event.respondWith((async () => {
    const garde = await caches.match(event.request);
    if (garde) return garde;
    const frais = await fetch(event.request);
    // Une réponse partielle ou opaque n'est pas rejouable : on la sert sans la garder.
    if (frais.ok && frais.type === 'basic') await garder(event.request, frais.clone());
    return frais;
  })());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: 'Foyer', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Foyer';
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || self.registration.scope },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const client of list) { if ('focus' in client) return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
