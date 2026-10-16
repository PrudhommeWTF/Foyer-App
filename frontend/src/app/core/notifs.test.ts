// L'état lu des notifications doit survivre à un rejeu après conflit : si A lit
// n1 pendant que B lit n2, le résultat est {n1, n2}, pas l'un qui écrase l'autre.
// On vérifie la fusion pure, puis le rejeu réel par `rebase`.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mergeReadNotifs } from './notifs';
import { rebase, Mutation } from './state-sync';
import { HouseholdState } from './models';

test('mergeReadNotifs fait l’union et n’élague qu’au-delà du vivant', () => {
  const live = new Set(['n1', 'n2', 'n3']);
  assert.deepEqual(mergeReadNotifs(['n1'], ['n2'], live).sort(), ['n1', 'n2']);
  // Un identifiant plus vivant (notification d'hier) est écarté.
  assert.deepEqual(mergeReadNotifs(['n1', 'vieux'], ['n2'], live).sort(), ['n1', 'n2']);
  // Idempotent : relire n'ajoute rien.
  assert.deepEqual(mergeReadNotifs(['n1', 'n2'], ['n2'], live).sort(), ['n1', 'n2']);
});

test('rejeu après conflit : A lit n1, B lit n2, résultat {n1, n2}', () => {
  const live = new Set(['n1', 'n2']);
  const me = 'm1';
  // La mutation telle que saveRead la pose : l'union est calculée DANS la closure,
  // sur l'état où elle s'applique (ici la version serveur rejouée).
  const lireN1: Mutation = (d) => {
    const m = d.members.find((x) => x.id === me);
    if (m) m.readNotifs = mergeReadNotifs(m.readNotifs || [], ['n1'], live);
  };
  // La version serveur porte déjà la lecture de B (n2) : c'est le conflit.
  const serveur = { members: [{ id: 'm1', name: 'Thomas', readNotifs: ['n2'] }] } as unknown as HouseholdState;
  const rep = rebase(serveur, [lireN1]);
  const m = rep.state.members.find((x) => x.id === me)!;
  assert.deepEqual([...m.readNotifs!].sort(), ['n1', 'n2'], 'les deux lectures survivent');
  assert.equal(rep.dropped, 0);
});

test('remplacer au lieu de fusionner perdrait la lecture de l’autre (régression)', () => {
  const me = 'm1';
  // L'ancienne forme : un instantané figé {n1} qui écrase.
  const ecrase: Mutation = (d) => { const m = d.members.find((x) => x.id === me); if (m) m.readNotifs = ['n1']; };
  const serveur = { members: [{ id: 'm1', name: 'Thomas', readNotifs: ['n2'] }] } as unknown as HouseholdState;
  const m = rebase(serveur, [ecrase]).state.members.find((x) => x.id === me)!;
  assert.deepEqual(m.readNotifs, ['n1'], 'preuve du bug : n2 serait perdu sans la fusion');
});
