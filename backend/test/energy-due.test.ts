// Quand un relevé de compteur est attendu.
//
// La règle sert une tuile qui réclame un geste : se tromper de sens réclame pour
// rien (et on cesse de lire l'écran) ou ne réclame jamais (et le module ne sert
// à rien). D'où ces tests sur les bornes.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { READING_DUE_DAYS, readingsDue } from '../src/finances/energy';

const TODAY = '2026-09-02';

const contrat = (id: number, over: Partial<{ name: string; provider: string; kind: string; status: string }> = {}) =>
  ({ id, name: 'Électricité', provider: 'EDF', kind: 'energie', status: 'actif', ...over });

/** Une date à N jours avant aujourd'hui. */
const ilYA = (n: number): string => new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86400000).toISOString().slice(0, 10);

const due = (contracts: ReturnType<typeof contrat>[], last: [number, string][] = []) =>
  readingsDue(contracts, new Map(last), TODAY);

describe('readingsDue', () => {
  it('réclame un contrat d’énergie qui n’a jamais été relevé', () => {
    const d = due([contrat(1)]);
    assert.equal(d.length, 1);
    assert.equal(d[0].lastOn, null);
    assert.equal(d[0].daysSince, null, 'jamais relevé n’est pas « en retard de zéro jour »');
  });

  it('ne réclame rien quand le compteur vient d’être relevé', () => {
    assert.deepEqual(due([contrat(1)], [[1, ilYA(3)]]), []);
  });

  it('réclame exactement au seuil déclaré, pas la veille', () => {
    assert.equal(due([contrat(1)], [[1, ilYA(READING_DUE_DAYS - 1)]]).length, 0);
    assert.equal(due([contrat(1)], [[1, ilYA(READING_DUE_DAYS)]]).length, 1);
  });

  it('ignore les contrats qui ne sont pas de l’énergie', () => {
    assert.deepEqual(due([contrat(1, { kind: 'assurance' }), contrat(2, { kind: 'telecom' })]), []);
  });

  it('ignore un contrat résilié : un compteur qu’on n’a plus ne se relève pas', () => {
    assert.deepEqual(due([contrat(1, { status: 'resilie' })]), []);
  });

  it('classe du plus ancien au plus récent, les jamais relevés en tête', () => {
    const d = due(
      [contrat(1, { name: 'Gaz' }), contrat(2, { name: 'Élec' }), contrat(3, { name: 'Eau' })],
      [[1, ilYA(40)], [2, ilYA(90)]],
    );
    assert.deepEqual(d.map((x) => x.name), ['Eau', 'Élec', 'Gaz'],
      'ce qui n’a jamais été relevé passe devant ce qui l’a été il y a longtemps');
  });

  it('compte les jours écoulés, pas les jours de retard', () => {
    assert.equal(due([contrat(1)], [[1, ilYA(45)]])[0].daysSince, 45);
  });
});
