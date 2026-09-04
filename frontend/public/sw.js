// Le service worker de Foyer : recevoir les rappels, et rien d'autre.
//
// Il ne met rien en cache : l'application se charge depuis le serveur comme
// avant, et se met à jour comme avant. Son seul rôle est d'afficher une
// notification quand le service push en livre une, et d'ouvrir l'application
// quand on tape dessus.
//
// Règle d'Apple à ne jamais enfreindre : un message push reçu doit TOUJOURS
// afficher une notification. Sinon iOS le tient pour un push silencieux et
// révoque l'abonnement, sans le dire à personne. D'où le repli sur un texte
// générique quand le contenu est illisible.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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
