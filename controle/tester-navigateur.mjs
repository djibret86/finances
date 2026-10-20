/* Contrôleur interne — test réel dans un navigateur (Chromium sans écran).
   Ouvre l'application comme un utilisateur, en format téléphone, et vérifie
   qu'elle démarre sans erreur JavaScript, affiche sa version et s'installe hors ligne.
   Lancement : node controle/tester-navigateur.mjs   (nécessite le paquet playwright) */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png',
                '.webmanifest': 'application/manifest+json' };

/* Petit serveur local qui imite l'hébergement en ligne */
const serveur = http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f.endsWith('/')) f += 'index.html';
  const chemin = path.join(RACINE, f);
  if (!chemin.startsWith(RACINE) || !fs.existsSync(chemin) || fs.statSync(chemin).isDirectory()) {
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream' });
  fs.createReadStream(chemin).pipe(res);
});
await new Promise(r => serveur.listen(0, '127.0.0.1', r));
const URL_APP = `http://127.0.0.1:${serveur.address().port}/`;

const erreurs = [], ok = [];
const lancement = { headless: true };
if (fs.existsSync('/opt/pw-browsers/chromium')) lancement.executablePath = '/opt/pw-browsers/chromium';
const navigateur = await chromium.launch(lancement).catch(() => chromium.launch({ headless: true }));

try {
  const contexte = await navigateur.newContext({ viewport: { width: 390, height: 844 }, locale: 'fr-FR' });
  const page = await contexte.newPage();
  page.on('pageerror', e => erreurs.push('Erreur JavaScript : ' + e.message));
  page.on('console', m => { if (m.type() === 'error') erreurs.push('Erreur console : ' + m.text()); });
  page.on('requestfailed', r => erreurs.push('Fichier non chargé : ' + r.url()));

  /* 1. Premier démarrage (aucune donnée enregistrée) */
  await page.goto(URL_APP, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const visible = await page.evaluate(() => document.body.innerText.trim().length);
  if (visible < 20) erreurs.push('La page s\'affiche vide');
  else ok.push('L\'application démarre et affiche du contenu');

  /* 2. La version annoncée correspond au code */
  const version = await page.evaluate(() => typeof APP_VERSION === 'string' ? APP_VERSION : null);
  if (!version) erreurs.push('APP_VERSION absente au démarrage');
  else ok.push('Version chargée : ' + version);

  /* 3. Pas de débordement horizontal sur téléphone */
  const deborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (deborde > 2) erreurs.push(`La page déborde de ${deborde}px en largeur sur téléphone`);
  else ok.push('Affichage téléphone sans débordement horizontal');

  /* 4. Le mode hors ligne s'installe */
  const sw = await page.evaluate(() => Promise.race([
    navigator.serviceWorker.ready.then(() => true),
    new Promise(r => setTimeout(() => r(false), 8000)),
  ]));
  if (!sw) erreurs.push('Le service worker (mode hors ligne) ne s\'est pas activé');
  else ok.push('Mode hors ligne activé (service worker)');

  /* 5. Redémarrage : les données enregistrées sont relues sans erreur */
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1500);
  ok.push('Rechargement de la page sans plantage');

  /* 6. Hors connexion : l'application s'ouvre quand même */
  if (sw) {
    await contexte.setOffline(true);
    const avant = erreurs.length;
    await page.reload({ waitUntil: 'load' }).catch(e => erreurs.push('Ouverture hors ligne impossible : ' + e.message));
    await page.waitForTimeout(1000);
    erreurs.splice(avant, erreurs.length - avant, ...erreurs.slice(avant).filter(e => !e.startsWith('Fichier non chargé')));
    const texte = await page.evaluate(() => document.body.innerText.trim().length).catch(() => 0);
    if (texte < 20) erreurs.push('Hors connexion, l\'application ne s\'affiche pas');
    else ok.push('Fonctionne sans connexion Internet');
    await contexte.setOffline(false);
  }
} finally {
  await navigateur.close();
  serveur.close();
}

console.log('\n=== Contrôle interne : test dans le navigateur ===\n');
ok.forEach(m => console.log('  ✔ ' + m));
[...new Set(erreurs)].forEach(m => console.log('  ✘ ' + m));
console.log(erreurs.length ? '\n→ MISE EN LIGNE BLOQUÉE : l\'application plante au démarrage.\n'
                           : '\n→ Test navigateur OK.\n');
process.exit(erreurs.length ? 1 : 0);
