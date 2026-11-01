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

    // --- Catégories personnalisées ---
    ok('Création « Enfants »', addCustomCat('depense', 'Enfants', '#2E86AB', 'person', 'couches, crèche, lait bébé'), null);
    ok('Rangée avant « Autre »', CATS.depense.slice(-2), ['Enfants', 'Autre']);
    ok('Mot-clé perso → Enfants', autoCat('Couches Pampers', 'depense'), 'Enfants');
    ok('Mot-clé perso prioritaire (« lait bébé » plus long que « lait »)', autoCat('lait bébé', 'depense'), 'Enfants');
    ok('Doublon refusé', addCustomCat('depense', 'alcool', '#2E86AB', 'tag', ''), 'La catégorie « alcool » existe déjà.');
    ok('Apostrophe refusée', addCustomCat('depense', "Fête d'école", '#2E86AB', 'tag', '') !== null, true);
    entries.push({ id: 9, date: '2026-10-20', type: 'depense', cat: 'Enfants', amount: 7000, desc: 'Couches' });
    budgets.Enfants = 20000;
    learnedCats['depense|pampers'] = 'Enfants';
    ok('Renommage', updateCustomCat('depense', 'Enfants', 'Bébé', '#2E86AB', 'person', 'couches'), null);
    ok('Renommage : entrée suivie', entries.filter(e => e.id === 9)[0].cat, 'Bébé');
    ok('Renommage : budget suivi', [budgets.Bebe, budgets['Bébé'], budgets.Enfants], [undefined, 20000, undefined]);
    ok('Renommage : règle apprise suivie', learnedCats['depense|pampers'], 'Bébé');
    ok('Suppression', deleteCustomCat('depense', 'Bébé'), null);
    ok('Suppression : entrée passée en Autre', entries.filter(e => e.id === 9)[0].cat, 'Autre');
    ok('Suppression : budget et règle oubliés', [budgets['Bébé'], learnedCats['depense|pampers']], [undefined, undefined]);
    ok('Suppression : retirée des listes', CATS.depense.indexOf('Bébé'), -1);

    // --- Solde permanent ---
    entries = [
      { id: 1, date: '2026-01-10', type: 'gain', cat: 'Salaire', amount: 100000, desc: 'Salaire' },
      { id: 2, date: '2026-10-20', type: 'depense', cat: 'Logement', amount: 150000, desc: 'Loyer' }
    ];
    ok('Solde permanent négatif possible', soldePermanent(), -50000);
    ok('Sans pointage, le solde affiché = le cumul', soldeActuel(), -50000);
    /* Pointage le 15/10 à 665 000 F : seules les saisies créées APRÈS comptent. */
    checkpoints = [{ date: '2026-10-15', real: 665000, mark: 100, ecart: null, recorded: false }];
    entries.push({ id: 101, date: '2026-10-18', type: 'depense', cat: 'Transport', amount: 5000, desc: 'Taxi' });
    entries.push({ id: 50, date: '2026-10-18', type: 'depense', cat: 'Transport', amount: 9999, desc: 'Saisie d\'avant le pointage' });
    ok('Avec pointage, le solde affiché = argent réel', soldeActuel(), 660000);
    const det = soldeDetail();
    ok('Détail : départ, entrées, dépenses', [det.depart, det.g, det.d, det.pointe], [665000, 0, 5000, true]);
    ok('Détail : mois par mois', det.mois, [{ mois: '2026-10', g: 0, d: 5000 }]);
    ok('Départ + entrées − dépenses = solde affiché', det.depart + det.g - det.d, soldeActuel());
    ok('Filtre « depuis le pointage »', getEntries({ minId: 100, from: '2026-10-15', to: '2026-10-20', type: 'depense' }).map(e => e.id), [101]);
    checkpoints = [];

    // --- Opérations récurrentes ---
    planned = []; recurrents = []; recIgnored = {};
    entries = [
      { id: 11, date: '2026-08-25', type: 'gain', cat: 'Salaire', amount: 580000, desc: 'Salaire' },
      { id: 12, date: '2026-09-25', type: 'gain', cat: 'Salaire', amount: 580000, desc: 'Salaire' },
      { id: 13, date: '2026-10-05', type: 'depense', cat: 'Loisirs', amount: 3500, desc: 'Prime Video' },
      { id: 14, date: '2026-10-12', type: 'depense', cat: 'Alimentation', amount: 2000, desc: 'Pain' },
      { id: 15, date: '2026-10-02', type: 'depense', cat: 'Logement', amount: 15000, desc: 'Jardinier' }
    ];
    const sug = suggestRecurrents();
    const sugNoms = sug.map(x => x.desc).sort();
    ok('Récurrentes détectées (2 mois ou mot typique)', sugNoms, ['Jardinier', 'Prime Video', 'Salaire']);
    ok('Achat ponctuel non proposé', sugNoms.indexOf('Pain'), -1);
    const sal = sug.filter(x => x.desc === 'Salaire')[0];
    ok('Montant et jour proposés', [sal.amount, sal.day, sal.nbMois], [580000, 25, 2]);
    REC_SUG = sug;
    recurrents.push({ id: 900, type: 'gain', cat: 'Salaire', desc: 'Salaire', word: 'salaire', amount: 580000, day: 25, gen: [] });
    recurrents.push({ id: 901, type: 'depense', cat: 'Loisirs', desc: 'Prime Video', word: 'prime', amount: 3500, day: 5, gen: [] });
    ok('Préparation : salaire d\'octobre et de novembre, Prime Video seulement en novembre (déjà payé en octobre)',
      ensureRecurrentPlanned(), 3);
    ok('Dates préparées', planned.map(p => p.desc + ' ' + p.date).sort(),
      ['Prime Video 2026-11-05', 'Salaire 2026-10-25', 'Salaire 2026-11-25']);
    ok('Rien n\'est enregistré sans validation', entries.length, 5);
    ok('Pas de doublon au rendu suivant', ensureRecurrentPlanned(), 0);
    planned = planned.filter(p => p.desc !== 'Salaire' || p.date !== '2026-10-25');
    ok('Prévision supprimée : pas recréée', ensureRecurrentPlanned(), 0);
    ok('31 du mois en novembre → 30', dateDuMois('2026-11', 31), '2026-11-30');
    ok('Suggestion déjà acceptée : plus proposée', suggestRecurrents().map(x => x.desc).sort(), ['Jardinier']);

    ok('Abonnements distincts (Claude ≠ Netflix)',
      [recKey({ type: 'depense', desc: 'Abonnement Claude' }), recKey({ type: 'depense', desc: 'Abonnement Netflix' })],
      ['depense|claude', 'depense|netflix']);

    // --- Comparaison avec un relevé ---
    entries = [
      { id: 1, date: '2026-10-29', type: 'depense', cat: 'Alimentation', amount: 4300, desc: 'Maquis' },
      { id: 2, date: '2026-10-31', type: 'depense', cat: 'Alimentation', amount: 6500, desc: 'Courses' }
    ];
    /* Années écrites en entier : l'horloge du test est au 20/10, un « 28/10 » seul
       serait lu comme le 28/10 de l'an passé (jamais de date future). */
    const rel = compareReleve('Maquis Sandy -4300 28/10/2026\nMaquis Sandy -4300 28/10/2026\nCarrefour -6500 20/10/2026\n' +
      'De Doudou +16000 31/10/2026\nDépôt +20000 27/10/2026\nTransfert vers carte prépayée -6000 31/10/2026\nBonjour');
    ok('Relevé : saisi à 1 jour près, une entrée ne sert qu\'une fois, trop loin = manquant',
      rel.map(r => r.etat), ['saisi', 'manquant', 'manquant', 'manquant', 'interne', 'interne', 'illisible']);
    ok('Relevé : seules les manquantes sont cochées', rel.map(r => r.coche), [false, true, true, true, false, false, false]);
    ok('Relevé : le sens vient du signe', rel[3].p.type, 'gain');
    proNames = { 'fifi': 1 };
    const relPro = compareReleve('De Fifi +12120 20/10/2026\nDe Doudou +16000 31/10/2026');
    ok('Relevé : nom marqué Pro mis de côté, jamais coché', relPro.map(r => r.etat + ':' + r.coche), ['pro:false', 'manquant:true']);
    ok('Nom pro : « De », « À », « Paiement » ignorés', [proKey('De Fifi'), proKey('À Green Shop'), proKey('Paiement SANDY BOISSON')], ['fifi', 'green shop', 'sandy boisson']);
    proNames = {};

    // --- Application dédiée aux finances personnelles ---
    ok('Plus de catégories de l\'entreprise', [CATS.gain.indexOf('Vente'), CATS.depense.indexOf('Matières premières')], [-1, -1]);
    ok('Liqueur achetée = Alcool, plus Matières premières', autoCat('Liqueur', 'depense'), 'Alcool');
    entries = [
      { id: 1, date: '2026-10-10', type: 'gain', cat: 'Vente', amount: 30000, desc: 'Vente liqueur' },
      { id: 2, date: '2026-10-11', type: 'depense', cat: 'Matières premières', amount: 12000, desc: 'Ananas' },
      { id: 3, date: '2026-10-12', type: 'depense', cat: 'Achat', amount: 8000, desc: 'Achat stock bouteilles' },
      { id: 4, date: '2026-10-13', type: 'gain', cat: 'Autre', amount: 4040, desc: 'De Fifi' },
      { id: 5, date: '2026-10-14', type: 'depense', cat: 'Alimentation', amount: 2000, desc: 'Pain' }
    ];
    proNames = { 'fifi': 1 };
    ok('Opérations de l\'entreprise repérées', proCandidates().map(e => e.id), [1, 2, 3, 4]);
    budgets = { 'Matières premières': 50000, Alimentation: 30000 };
    ok('Retrait : seules les cochées partent', retirerPro([1, 2, 4]), 3);
    ok('Retrait : reste perso + la ligne décochée', entries.map(e => e.id), [3, 5]);
    ok('Ligne gardée : plus reproposée', proCandidates().length, 0);
    ok('Retrait : budget de l\'entreprise oublié', Object.keys(budgets), ['Alimentation']);
    proNames = {};

    // --- Notes ---
    ok('Notes valides seulement', sanitizeNotes([{ id: 1, date: '2026-10-20', text: 'Rembourser Koffi' }, { date: 'x', text: 'a' }, { id: 3, date: '2026-10-21', text: '  ' }]).length, 1);
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
