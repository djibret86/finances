/* Contrôleur interne — vérifie les CALCULS de l'application.
   Le test navigateur prouve que l'app démarre ; celui-ci prouve qu'elle compte juste :
   lecture des saisies, dates, catégories, totaux, budgets, prévisions.
   L'horloge est figée au mardi 20 octobre 2026 pour que les résultats ne dépendent
   pas du jour où le test tourne.
   Lancement : node controle/tester-calculs.mjs   (nécessite le paquet playwright) */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lancement = { headless: true };
if (fs.existsSync('/opt/pw-browsers/chromium')) lancement.executablePath = '/opt/pw-browsers/chromium';
const navigateur = await chromium.launch(lancement).catch(() => chromium.launch({ headless: true }));

const resultats = [];
const erreursJS = [];
try {
  const contexte = await navigateur.newContext({ locale: 'fr-FR', timezoneId: 'Africa/Abidjan' });
  const page = await contexte.newPage();
  await page.clock.setFixedTime(new Date('2026-10-20T10:00:00Z'));
  page.on('pageerror', e => erreursJS.push(e.message));
  await page.goto(pathToFileURL(path.join(RACINE, 'index.html')).href, { waitUntil: 'load' });
  await page.waitForTimeout(800);

  /* Chaque cas : [nom, valeur obtenue, valeur attendue]. Tout tourne dans la page,
     avec les vraies fonctions de l'application. */
  const cas = await page.evaluate(() => {
    const r = [];
    const ok = (nom, obtenu, attendu) => r.push([nom, obtenu, attendu]);
    const espaces = s => String(s).replace(/[  ]/g, ' ');
    const lire = l => { const p = parseEntryLine(l); return p ? [p.type, p.amount, p.cat, p.date] : null; };

    // --- Lecture des saisies ---
    ok('« Bière -3000 »', lire('Bière -3000'), ['depense', 3000, 'Alcool', '2026-10-20']);
    ok('« Salaire +580000 »', lire('Salaire +580000'), ['gain', 580000, 'Salaire', '2026-10-20']);
    ok('Milliers avec point « Repas 50.000 »', lire('Repas 50.000')[1], 50000);
    ok('Milliers avec espace « Repas 50 000 »', lire('Repas 50 000')[1], 50000);
    ok('Devise « Repas 4000 FCFA »', lire('Repas 4000 FCFA')[1], 4000);
    ok('Calcul « Passion 150x1300 »', lire('Passion 150x1300')[1], 195000);
    ok('Montant d\'abord « -3000 Taxi »', lire('-3000 Taxi')[1], 3000);
    ok('Sans montant : refusé', lire('Bonjour'), null);

    // --- Dates écrites dans la saisie ---
    ok('« hier »', lire('Taxi -2000 hier')[3], '2026-10-19');
    ok('« avant-hier »', lire('Taxi -2000 avant-hier')[3], '2026-10-18');
    ok('« lundi »', lire('Taxi -2000 lundi')[3], '2026-10-19');
    ok('« 12/08 »', lire('Achat -50000 12/08')[3], '2026-08-12');
    ok('« il y a 5 jours »', lire('Repas -4000 il y a 5 jours')[3], '2026-10-15');
    ok('Date impossible 31/02 ignorée', lire('Repas -4000 31/02') === null || lire('Repas -4000 31/02')[3] !== '2026-02-31', true);

    // --- Catégories automatiques ---
    const cat = d => autoCat(d, 'depense');
    ok('Flag → Alcool', cat('Flag x2'), 'Alcool');
    ok('Guinness → Alcool', cat('Guinness'), 'Alcool');
    ok('Vinaigre → Alimentation (pas Alcool)', cat('vinaigre'), 'Alimentation');
    ok('Gingembre → Alimentation', cat('gingembre'), 'Alimentation');
    ok('Taxi → Transport', cat('Taxi'), 'Transport');
    ok('Loyer → Logement', cat('Loyer'), 'Logement');
    ok('Mot inconnu → Autre', cat('zzqx'), 'Autre');

    // --- Répétitions des prévisions ---
    const pp = l => { const p = parsePlannedLine(l); return p ? [p.amount, p.count, p.unit] : null; };
    ok('« x10j »', pp('Chambre -15000 x10j'), [15000, 10, 'jour']);
    ok('« x12m »', pp('Loyer -150000 x12m'), [150000, 12, 'mois']);
    ok('« pendant 10 jours »', pp('Chambre -15000 pendant 10 jours'), [15000, 10, 'jour']);
    ok('Mois suivant', addMonths('2026-10-20', 2), '2026-12-20');
    ok('31 janvier + 1 mois = fin février', addMonths('2026-01-31', 1), '2026-02-28');

    // --- Totaux sur un jeu de données connu ---
    entries = [
      { id: 1, date: '2026-10-20', type: 'gain', cat: 'Salaire', amount: 580000, desc: 'Salaire' },
      { id: 2, date: '2026-10-20', type: 'depense', cat: 'Alcool', amount: 3000, desc: 'Bière' },
      { id: 3, date: '2026-10-05', type: 'depense', cat: 'Logement', amount: 150000, desc: 'Loyer' },
      { id: 4, date: '2026-10-12', type: 'depense', cat: 'Alimentation', amount: 45000, desc: 'Marché' },
      { id: 5, date: '2026-09-30', type: 'depense', cat: 'Alimentation', amount: 9999, desc: 'Marché' }
    ];
    const oct = getEntries({ month: '2026-10' });
    ok('Entrées d\'octobre', oct.length, 4);
    ok('Gains d\'octobre', sumType(oct, 'gain'), 580000);
    ok('Dépenses d\'octobre', sumType(oct, 'depense'), 198000);
    ok('Catégorie principale', catBreakdown(oct, 'depense')[0], ['Logement', 150000]);
    ok('Entrées du jour', getEntries({ date: '2026-10-20' }).length, 2);
    ok('Format court', [fmtShort(198000), fmtShort(1250000), fmtShort(950)], ['198k', '1.3M', '950']);

    // --- Budgets : enveloppe du jour (cas réel de la note du code) ---
    budgets = { Alimentation: 50000 };
    renderLiteBudgetWidget();
    /* 45 000 dépensés avant aujourd'hui sur 50 000, 12 jours restants (20 → 31) :
       5 000 / 12 = 417 F pour aujourd'hui. */
    ok('Enveloppe du jour', espaces(document.getElementById('lite-daily-budget').textContent), '417 F');
    budgets = { Alimentation: 50000, Logement: 120000, Alcool: 3500, Transport: 20000 };
    renderBudgets();
    const etats = Array.from(document.querySelectorAll('#budget-list .budget-row')).map(row =>
      row.querySelector('.budget-name b').textContent + ' : ' + espaces(row.querySelector('.budget-status').textContent));
    ok('États des budgets', etats.sort(), ['Alcool : Attention : 86 % utilisés', 'Alimentation : Attention : 90 % utilisés', 'Logement : Dépassé de 30 000 F', 'Transport : Dans les clous']);
    ok('Budgets sans plafond masqués', document.querySelectorAll('#budget-list .budget-row').length, 4);

    // --- Solde global ---
    ok('Solde global', sumType(entries, 'gain') - sumType(entries, 'depense'), 580000 - 207999);
    return r;
  });
  for (const [nom, obtenu, attendu] of cas) {
    resultats.push({ nom, ok: JSON.stringify(obtenu) === JSON.stringify(attendu), obtenu, attendu });
  }
} finally {
  await navigateur.close();
}

console.log('\n=== Contrôle interne : calculs ===\n');
for (const r of resultats) {
  console.log((r.ok ? '  ✔ ' : '  ✘ ') + r.nom + (r.ok ? '' : ` — obtenu ${JSON.stringify(r.obtenu)}, attendu ${JSON.stringify(r.attendu)}`));
}
erreursJS.forEach(m => console.log('  ✘ Erreur JavaScript : ' + m));
const echecs = resultats.filter(r => !r.ok).length + erreursJS.length;
console.log(`\nRésultat : ${resultats.length - resultats.filter(r => !r.ok).length}/${resultats.length} calculs justes`);
console.log(echecs ? '→ MISE EN LIGNE BLOQUÉE : un calcul est faux.\n' : '→ Calculs OK.\n');
process.exit(echecs ? 1 : 0);
