// Module École, deuxième tranche, ce qui se teste sans base ni réseau : la
// lecture des réponses de données, le nettoyage des énoncés, le titre des
// tâches, « fait » dans les deux sens, et ce que devient la tâche projetée.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseHomeworkDay, parseHomeworkList, parseTimetable } from '../src/ecole/client/data';
import { cleanHtml, homeworkTitle, htmlToText, subjectLabel } from '../src/ecole/html';
import { decideDone, planTask } from '../src/ecole/projection';
import { datee, fixture, jourParis } from './ecole-faux-serveur';

describe('École : lecture du cahier de textes et de l’emploi du temps', () => {
  it('liste : une ligne par devoir, avec sa date de rendu et ses drapeaux', () => {
    const l = parseHomeworkList(datee('cahierdetexte.json').data);
    assert.equal(l.length, 4);
    const maths = l.find((h) => h.edId === 5001)!;
    assert.equal(maths.due, jourParis(1), 'la clé de date est la date de rendu');
    assert.equal(maths.subject, 'MATHEMATIQUES');
    assert.equal(l.find((h) => h.edId === 5002)!.isTest, true);
    assert.equal(l.find((h) => h.edId === 5003)!.done, true);
    assert.deepEqual(parseHomeworkList({ 'pas-une-date': [{ idDevoir: 1 }] }), []);
  });

  it('détail : l’énoncé décodé du base64, le professeur ; une séance sans « à faire » n’est pas un devoir', () => {
    const d = parseHomeworkDay((fixture('cahierdetexte-jour.json') as { data: unknown }).data, '2026-10-15');
    assert.deepEqual(d.map((x) => x.edId), [5001, 5002, 5003, 5004]);
    assert.match(d[0].html, /Exercices 12 et 13/);
    assert.equal(d[0].teacher, 'M. ANONYME');
    assert.equal(d[2].documents, 1);
  });

  it('emploi du temps : heures de Paris, annulé, modifié ; un événement sur deux jours est écarté', () => {
    const l = parseTimetable(datee('emploidutemps.json').data);
    assert.equal(l.length, 6);
    assert.deepEqual([l[0].start, l[0].end, l[0].room], ['08:00', '09:00', 'B12']);
    assert.equal(l.find((x) => x.edId === 9005)!.cancelled, true);
    assert.equal(l.find((x) => x.edId === 9006)!.modified, true);
  });
});

describe('École : énoncés', () => {
  it('nettoyage : script retiré avec son contenu, liens http(s) seuls, attributs retirés', () => {
    const h = cleanHtml('<p style="color:red" onclick="x()">A <a href="https://e.fr/x" onclick="y">lien</a> <a href="javascript:alert(1)">piège</a></p><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="https://e.fr"></iframe>');
    assert.equal(h, '<p>A <a href="https://e.fr/x" target="_blank" rel="noopener noreferrer">lien</a> <a>piège</a></p>');
    assert.equal(cleanHtml('3 < 5 et <b>gras</b>'), '3 &lt; 5 et <b>gras</b>');
  });

  it('texte : entités décodées, listes en tirets, liens écrits en clair', () => {
    assert.equal(htmlToText('<p>Exercices 12 et 13 p.&nbsp;45</p><p>Corrig&eacute; sur <a href="https://exemple.fr/c">le site</a></p>'),
      'Exercices 12 et 13 p. 45\nCorrigé sur le site (https://exemple.fr/c)');
    assert.equal(htmlToText('<ul><li>Lire</li><li>Faire &amp; rendre</li></ul>'), '- Lire\n- Faire & rendre');
  });

  it('titres de tâche : matière puis début de l’énoncé ; « Interro de » / « Interro d’ »', () => {
    assert.equal(subjectLabel('MATHEMATIQUES'), 'Mathematiques');
    assert.equal(homeworkTitle('MATHEMATIQUES', 'Exercices 12 et 13 p. 45\nCorrigé', false), 'Mathematiques : Exercices 12 et 13 p. 45');
    assert.equal(homeworkTitle('ANGLAIS LV1', 'Le prétérit', true), 'Interro d’anglais lv1 : Le prétérit');
    assert.equal(homeworkTitle('MATHEMATIQUES', '', true), 'Interro de mathematiques');
    const long = homeworkTitle('FRANCAIS', 'Lire les chapitres un à quatre du roman et préparer une fiche de lecture complète sur les personnages', false);
    assert.ok(long.length <= 'Francais : '.length + 81 && long.endsWith('…'), long);
  });
});

describe('École : « fait » dans les deux sens', () => {
  it('rien ne bouge : rien ne part', () => {
    assert.deepEqual(decideDone({ ed: false, synced: false, local: false }), { send: null, checkTask: false, synced: false });
  });
  it('coché dans Foyer : envoyé ; décoché dans Foyer : envoyé aussi (geste volontaire)', () => {
    assert.deepEqual(decideDone({ ed: false, synced: false, local: true }), { send: true, checkTask: false, synced: false });
    assert.deepEqual(decideDone({ ed: true, synced: true, local: false }), { send: false, checkTask: false, synced: true });
  });
  it('fait dans ÉcoleDirecte : la tâche se coche ; défait dans ÉcoleDirecte : rien ne se décoche, rien ne repart', () => {
    assert.deepEqual(decideDone({ ed: true, synced: false, local: false }), { send: null, checkTask: true, synced: true });
    assert.deepEqual(decideDone({ ed: false, synced: true, local: true }), { send: null, checkTask: false, synced: true });
    // Stable au passage suivant : pas de bras de fer.
    assert.deepEqual(decideDone({ ed: false, synced: true, local: true }).send, null);
  });
  it('les deux ont bougé : d’accord, c’est le nouvel accord ; en désaccord, Foyer l’emporte', () => {
    assert.deepEqual(decideDone({ ed: true, synced: false, local: true }), { send: null, checkTask: false, synced: true });
    assert.deepEqual(decideDone({ ed: false, synced: true, local: false }), { send: null, checkTask: false, synced: false });
  });
  it('première fois (pas d’accord connu) : ÉcoleDirecte fait foi', () => {
    assert.deepEqual(decideDone({ ed: true, synced: null, local: true }), { send: null, checkTask: false, synced: true });
  });
});

describe('École : la tâche projetée', () => {
  const want = { id: 'ed-devoir-1', listId: 'l', text: 'Maths : ex', note: 'n', who: ['m'], due: '2026-10-15', done: false };
  const today = '2026-10-14', keep = '2026-10-07';
  const h = { taskId: null, taskDroppedAt: null, due: '2026-10-15', archived: false };
  it('créée pour un devoir à venir, jamais pour un devoir passé', () => {
    assert.deepEqual(planTask(h, undefined, want, today, keep), { kind: 'add' });
    assert.deepEqual(planTask({ ...h, due: '2026-10-10' }, undefined, { ...want, due: '2026-10-10' }, today, keep), { kind: 'none' });
  });
  it('mise à jour du titre et de l’échéance, sans toucher à la coche', () => {
    const t = { id: 'ed-devoir-1', listId: 'l', text: 'Maths : ancien', note: 'n', who: ['m'], due: '2026-10-15', done: true };
    assert.deepEqual(planTask({ ...h, taskId: t.id }, t, want, today, keep), { kind: 'edit', fields: { text: 'Maths : ex' } });
    assert.deepEqual(planTask({ ...h, taskId: t.id }, { ...t, text: want.text }, want, today, keep), { kind: 'none' });
  });
  it('supprimée par l’utilisateur : notée, jamais recréée', () => {
    assert.deepEqual(planTask({ ...h, taskId: 'ed-devoir-1' }, undefined, want, today, keep), { kind: 'dropped' });
    assert.deepEqual(planTask({ ...h, taskId: 'ed-devoir-1', taskDroppedAt: '2026-10-13' }, undefined, want, today, keep), { kind: 'none' });
  });
  it('retirée une semaine après le rendu, ou quand le devoir disparaît d’ÉcoleDirecte', () => {
    const t = { id: 'ed-devoir-1', listId: 'l', text: 'x', who: ['m'], due: '2026-10-06', done: true };
    assert.deepEqual(planTask({ ...h, taskId: t.id, due: '2026-10-06' }, t, want, today, keep), { kind: 'remove' });
    assert.deepEqual(planTask({ ...h, taskId: t.id, archived: true }, { ...t, due: '2026-10-15' }, want, today, keep), { kind: 'remove' });
  });
});
