# Gestionnaire Financier (PWA)

Application en un seul fichier (`index.html`) + service worker (`sw.js`), publiée sur GitHub Pages.

## Avant toute mise en ligne
1. Incrémenter la version aux DEUX endroits : `APP_VERSION` dans `index.html` et `CACHE` dans `sw.js`.
2. Lancer le contrôleur interne et ne publier que s'il est entièrement vert :
   - `node controle/verifier.mjs --base origin/main`
   - `cd controle && npm ci && node tester-navigateur.mjs`
3. Sur GitHub, le workflow « Contrôle et mise en ligne » refait ces contrôles et bloque la publication en cas d'erreur.
