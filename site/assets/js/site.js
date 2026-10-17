// Foyer · site vitrine : thème, captures clair/sombre, onglets de l'aperçu, bouton « Copier ».
(function () {
  var root = document.documentElement;
  var media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  var effective = function () { return root.dataset.theme || (media && media.matches ? 'dark' : 'light'); };
  var shotScheme = effective();

  // Every capture with data-shot follows the chosen scheme (except data-fixed ones).
  function applyShots() {
    document.querySelectorAll('img[data-shot]:not([data-fixed])').forEach(function (img) {
      var src = 'assets/screens/' + img.dataset.shot + '-' + shotScheme + '.webp';
      if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    });
    document.querySelectorAll('.seg [data-scheme]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.scheme === shotScheme));
    });
  }

  // Theme button: light <-> dark for the whole site, remembered on this device.
  var themeBtn = document.querySelector('.theme-btn');
  if (themeBtn) themeBtn.addEventListener('click', function () {
    var next = effective() === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('foyer-site-theme', next); } catch (e) { /* navigation privée */ }
    shotScheme = next;
    applyShots();
  });
  if (media && media.addEventListener) media.addEventListener('change', function () {
    if (!root.dataset.theme) { shotScheme = effective(); applyShots(); }
  });

  // Gallery: scheme switch, independent from the site theme.
  document.querySelectorAll('.seg [data-scheme]').forEach(function (b) {
    b.addEventListener('click', function () { shotScheme = b.dataset.scheme; applyShots(); });
  });

  // Gallery tabs (arrow keys move between tabs, as in the ARIA tabs pattern).
  var tabs = Array.prototype.slice.call(document.querySelectorAll('.tabs [role="tab"]'));
  var img = document.getElementById('panel-img');
  var cap = document.getElementById('panel-caption');
  var panel = document.getElementById('panel');
  function select(tab, focus) {
    tabs.forEach(function (t) { var on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    panel.setAttribute('aria-labelledby', tab.id);
    img.classList.add('fade');
    img.dataset.shot = tab.dataset.shot;
    img.alt = tab.dataset.caption;
    cap.textContent = tab.dataset.caption;
    applyShots();
    img.addEventListener('load', function done() { img.classList.remove('fade'); img.removeEventListener('load', done); });
    setTimeout(function () { img.classList.remove('fade'); }, 400);
    if (focus) tab.focus();
  }
  tabs.forEach(function (t, i) {
    t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1;
    t.addEventListener('click', function () { select(t); });
    t.addEventListener('keydown', function (e) {
      var k = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (k) { e.preventDefault(); select(tabs[(i + k + tabs.length) % tabs.length], true); }
    });
  });
  if (img && tabs[0]) img.alt = tabs[0].dataset.caption;

  // Copy buttons.
  document.querySelectorAll('.copy[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var el = document.querySelector(b.dataset.copy);
      if (!el || !navigator.clipboard) return;
      navigator.clipboard.writeText(el.textContent.trim()).then(function () {
        b.textContent = 'Copié';
        setTimeout(function () { b.textContent = 'Copier'; }, 1600);
      });
    });
  });

  // Preload the other scheme's gallery shots once the page is idle, so switching is instant.
  window.addEventListener('load', function () {
    setTimeout(function () {
      ['light', 'dark'].forEach(function (s) {
        tabs.forEach(function (t) { var p = new Image(); p.src = 'assets/screens/' + t.dataset.shot + '-' + s + '.webp'; });
      });
    }, 1500);
  });

  applyShots();
})();
