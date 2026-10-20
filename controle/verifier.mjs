/* Contrôleur interne — vérifie l'application AVANT sa mise en ligne.
   Lancement : node controle/verifier.mjs [--base <ref git>]
   Sans dépendance : fonctionne avec Node seul.
   Code de sortie 1 si au moins une ERREUR (la mise en ligne est alors bloquée). */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const erreurs = [], alertes = [], ok = [];
const erreur = m => erreurs.push(m);
const alerte = m => alertes.push(m);
const reussi = m => ok.push(m);
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const existe = f => fs.existsSync(path.join(RACINE, f));

/* 1. Fichiers indispensables */
const FICHIERS = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const manquants = FICHIERS.filter(f => !existe(f));
if (manquants.length) erreur('Fichiers manquants : ' + manquants.join(', '));
else reussi('Tous les fichiers indispensables sont présents');
if (!existe('index.html') || !existe('sw.js')) { rapport(); }

const html = lire('index.html');
const sw = lire('sw.js');

/* 2. Syntaxe JavaScript : service worker et chaque <script> de la page */
function syntaxe(code, nom) {
  try { new vm.Script(code, { filename: nom }); return true; }
  catch (e) { erreur(`Erreur de syntaxe JavaScript dans ${nom} : ${e.message}`); return false; }
}
let syntaxeOk = syntaxe(sw, 'sw.js');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
scripts.forEach((m, i) => {
  const ligne = html.slice(0, m.index).split('\n').length;
  syntaxeOk = syntaxe(m[1], `index.html (script n°${i + 1}, ligne ${ligne})`) && syntaxeOk;
});
if (syntaxeOk) reussi(`Syntaxe JavaScript correcte (sw.js + ${scripts.length} scripts)`);
if (/\bdebugger\s*;/.test(html + sw)) erreur('Instruction « debugger » oubliée dans le code');

/* 3. Version : sw.js et index.html doivent annoncer la même */
const vSw = (sw.match(/var\s+CACHE\s*=\s*'finances-(v\d+)'/) || [])[1];
const vApp = (html.match(/var\s+APP_VERSION\s*=\s*'(v\d+)'/) || [])[1];
if (!vSw) erreur("Impossible de lire la version dans sw.js (attendu : var CACHE = 'finances-vN')");
if (!vApp) erreur("Impossible de lire APP_VERSION dans index.html (attendu : var APP_VERSION = 'vN')");
if (vSw && vApp) {
  if (vSw !== vApp) erreur(`Versions incohérentes : sw.js = ${vSw}, index.html = ${vApp}`);
  else reussi(`Version cohérente : ${vApp}`);
}

/* 4. La version a-t-elle été augmentée par rapport à la version en ligne ? */
const iBase = process.argv.indexOf('--base');
const base = iBase > -1 ? process.argv[iBase + 1] : null;
if (base && vApp) {
  const git = (...a) => execFileSync('git', a, { cwd: RACINE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  try {
    const avant = (git('show', `${base}:index.html`).match(/var\s+APP_VERSION\s*=\s*'v(\d+)'/) || [])[1];
    const change = git('diff', '--name-only', base, '--', 'index.html', 'sw.js', 'manifest.webmanifest').trim();
    const maintenant = Number(vApp.slice(1));
    if (!avant) alerte(`Version précédente illisible (${base}) : comparaison ignorée`);
    else if (change && maintenant <= Number(avant))
      erreur(`L'application a changé mais la version n'a pas été augmentée (en ligne : v${avant}, ici : ${vApp}). ` +
             'Les téléphones risquent de garder l\'ancienne version en cache.');
    else if (maintenant < Number(avant)) erreur(`Version en recul : v${avant} → ${vApp}`);
    else reussi(change ? `Version augmentée : v${avant} → ${vApp}` : 'Aucun changement de l\'application depuis la version en ligne');
  } catch { alerte(`Référence git « ${base} » introuvable : comparaison de version ignorée`); }
}

/* 5. Le service worker ne doit mettre en cache que des fichiers qui existent */
const assets = ((sw.match(/var\s+ASSETS\s*=\s*\[([^\]]*)\]/) || [])[1] || '')
  .match(/'[^']*'/g)?.map(s => s.slice(1, -1)) || [];
const absents = assets.filter(a => a !== './' && !existe(a.replace(/^\.\//, '')));
if (!assets.length) erreur('Liste ASSETS introuvable dans sw.js');
else if (absents.length) erreur('sw.js met en cache des fichiers inexistants : ' + absents.join(', '));
else reussi(`Les ${assets.length} fichiers mis en cache hors ligne existent`);

/* 6. Manifeste : JSON valide, icônes présentes et de la bonne taille */
function taillePng(f) {
  const b = fs.readFileSync(path.join(RACINE, f));
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}
try {
  const man = JSON.parse(lire('manifest.webmanifest'));
  ['name', 'short_name', 'start_url', 'display', 'icons'].forEach(c => { if (!man[c]) erreur(`Manifeste : champ « ${c} » manquant`); });
  let iconesOk = true;
  (man.icons || []).forEach(ic => {
    if (!existe(ic.src)) { erreur(`Manifeste : icône introuvable ${ic.src}`); iconesOk = false; return; }
    const t = taillePng(ic.src);
    if (!t) { erreur(`${ic.src} n'est pas une image PNG valide`); iconesOk = false; }
    else if (ic.sizes && ic.sizes !== t) { erreur(`${ic.src} mesure ${t} mais le manifeste annonce ${ic.sizes}`); iconesOk = false; }
  });
  if (iconesOk) reussi('Manifeste valide, icônes présentes et aux bonnes dimensions');
} catch (e) { erreur('manifest.webmanifest n\'est pas un JSON valide : ' + e.message); }

/* 7. Structure HTML de base */
const sansScripts = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
const requis = [
  [/^\s*<!DOCTYPE html>/i, 'déclaration <!DOCTYPE html>'],
  [/<html[^>]*\blang=/i, 'attribut lang sur <html>'],
  [/<meta[^>]*charset=/i, 'encodage <meta charset>'],
  [/<meta[^>]*name="viewport"/i, 'balise viewport (affichage mobile)'],
  [/<link[^>]*rel="manifest"/i, 'lien vers le manifeste'],
  [/<\/html>\s*$/i, 'fermeture </html> en fin de fichier'],
];
const absentsHtml = requis.filter(([re]) => !re.test(html)).map(([, n]) => n);
if (absentsHtml.length) erreur('HTML incomplet : ' + absentsHtml.join(', '));
else reussi('Structure HTML de base correcte');

const ids = [...sansScripts.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const doublons = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
if (doublons.length) erreur('Identifiants HTML en double (comportement imprévisible) : ' + doublons.join(', '));
else reussi(`${ids.length} identifiants HTML, aucun doublon`);

/* 8. Ressources externes : l'appli doit fonctionner hors ligne */
const externes = [...sansScripts.matchAll(/<(?:script|link|img)[^>]*(?:src|href)="(https?:\/\/[^"]+)"/gi)].map(m => m[1]);
if (externes.length) alerte('Ressources chargées depuis Internet (ne marcheront pas hors ligne) : ' + externes.join(', '));
else reussi('Aucune ressource externe : l\'application fonctionne hors ligne');

/* 9. Secrets : aucune clé ou mot de passe ne doit être publié */
const SECRETS = [
  [/AKIA[0-9A-Z]{16}/, 'clé AWS'], [/ghp_[A-Za-z0-9]{36}/, 'jeton GitHub'], [/github_pat_[A-Za-z0-9_]{40,}/, 'jeton GitHub'],
  [/sk-[A-Za-z0-9_-]{20,}/, 'clé API (sk-…)'], [/AIza[0-9A-Za-z_-]{35}/, 'clé Google'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'clé privée'], [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'jeton Slack'],
];
const trouves = SECRETS.filter(([re]) => re.test(html + sw + lire('manifest.webmanifest'))).map(([, n]) => n);
if (trouves.length) erreur('Secret possiblement publié : ' + [...new Set(trouves)].join(', '));
else reussi('Aucun secret (clé, jeton, mot de passe) détecté');

/* 10. Poids de la page */
const ko = Math.round(Buffer.byteLength(html) / 1024);
if (ko > 1500) alerte(`index.html pèse ${ko} Ko : chargement lent en données mobiles`);
else reussi(`Poids de index.html : ${ko} Ko`);

rapport();

function rapport() {
  const t = (s, c) => process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s;
  console.log('\n=== Contrôle interne avant mise en ligne ===\n');
  ok.forEach(m => console.log(t('  ✔ ', 32) + m));
  alertes.forEach(m => console.log(t('  ⚠ ', 33) + m));
  erreurs.forEach(m => console.log(t('  ✘ ', 31) + m));
  console.log(`\nRésultat : ${ok.length} réussi(s), ${alertes.length} alerte(s), ${erreurs.length} erreur(s)`);
  console.log(erreurs.length ? t('→ MISE EN LIGNE BLOQUÉE : corrige les erreurs ci-dessus.\n', 31)
                             : t('→ Contrôle statique OK.\n', 32));
  process.exit(erreurs.length ? 1 : 0);
}
