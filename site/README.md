# Site vitrine de Foyer

Site statique publié sur GitHub Pages par `.github/workflows/pages.yml` à chaque
modification de ce dossier sur `main`. Aucun build, aucune dépendance, aucune
ressource externe : HTML, CSS, un peu de JavaScript, les polices de l'application.

```
site/
  index.html             la page
  assets/css/site.css    styles (tokens du design system, thème clair et « Ardoise »)
  assets/js/site.js      thème, captures clair/sombre, onglets, bouton Copier
  assets/fonts/          Bricolage Grotesque, Nunito, Caveat (OFL, voir LICENSE.txt)
  assets/img/            logo, icône, image de partage (og-image.png, 1200×630)
  assets/screens/        captures WebP, nommées <écran>-<light|dark>.webp
  tools/capture.mjs      régénère les captures depuis une instance de démo
```

## Voir en local

```bash
cd site && python3 -m http.server 8123   # puis http://localhost:8123
```

## Refaire les captures

Après un changement d'interface, sur une instance **vierge** (dossier de données
temporaire) qui sert le frontend compilé :

```bash
cd frontend && npm run build && cd ..
cd backend && npm run build && cd ..
FOYER_DATA_DIR=$(mktemp -d) FOYER_JWT_SECRET=demo-secret-demo-secret \
  FOYER_STATIC_DIR=frontend/dist/frontend/browser node backend/dist/server.js &
npm i --no-save playwright && npx playwright install chromium   # si Playwright n'est pas déjà là
node site/tools/capture.mjs        # FOYER_URL=http://127.0.0.1:8099 par défaut
```

Le script crée la « Famille Martin » (fictive), avec des dates relatives au jour
même, puis écrit 20 captures WebP (bureau 1600 px, téléphone 720 px, clair et
sombre). Les noms de fichiers ne changent pas : la page n'a pas à être retouchée.

## Adresse

Par défaut : `https://prudhommewtf.github.io/Foyer-App/`. Avec un domaine
personnalisé, mettre à jour l'URL absolue de `og:image` dans `index.html`.
