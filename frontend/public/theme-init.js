// Anti-flash du thème : pose la classe `dark` et la couleur de la barre d'état
// AVANT qu'Angular démarre, depuis la préférence d'appareil (localStorage).
// Aucune logique métier : le store reprend ensuite la main.
//
// Fichier à part, chargé sans `defer` ni `async` depuis le <head> : la CSP du
// serveur (`script-src 'self'`) refuse tout script en ligne, il ne s'exécutait donc pas.
(function () {
  try {
    var t = localStorage.getItem('foyer.pref.theme') || 'systeme';
    var dark = t === 'sombre' || (t !== 'clair' && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', dark ? '#15191E' : '#E56B4E');
  } catch (e) { /* mode privé ou pas de localStorage : le store posera le thème */ }
})();
