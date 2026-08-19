// Flux ICS : personne ne relit ce fichier, seulement des agendas qui refusent en
// silence ce qu'ils ne comprennent pas. D'où ces tests.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildIcs } from '../src/ics';
import { Deadline } from '../src/finances/contracts';
import { EMPTY_STATE } from '../src/seed';
import type { HouseholdState } from '../src/seed';

const state = (over: Partial<HouseholdState> = {}): HouseholdState =>
  ({ ...structuredClone(EMPTY_STATE), familyName: 'Foyer Dupont', ...over }) as HouseholdState;

const deadline = (over: Partial<Deadline> = {}): Deadline => ({
  contractId: 7, contractName: 'Assurance habitation', provider: 'AXA',
  kind: 'preavis', date: '2026-09-15', daysAway: 27, assetId: null, memberIds: [], ...over,
});

/** Unfold nothing, just split: the builder must already emit CRLF. */
const lines = (ics: string): string[] => ics.split('\r\n');

describe('flux ICS', () => {
  it('respecte l’ossature attendue et termine ses lignes en CRLF', () => {
    const ics = buildIcs(state());
    assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'));
    assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
    assert.ok(lines(ics).includes('VERSION:2.0'));
    assert.ok(!ics.includes('\n\n'), 'aucune ligne vide, un agenda peut s’y perdre');
  });

  it('échappe ce qui casserait le format, plutôt que de l’émettre tel quel', () => {
    const ics = buildIcs(state({ familyName: 'Dupont; Martin, et Cie' }));
    // Point-virgule et virgule sont des séparateurs en ICS : ils doivent sortir échappés.
    assert.ok(ics.includes('X-WR-CALNAME:Dupont\\; Martin\\, et Cie'));
  });

  it('rend chaque échéance en journée entière, avec un lendemain pour fin', () => {
    const ics = buildIcs(state(), [deadline({ kind: 'renouvellement', date: '2026-09-15' })]);
    const l = lines(ics);
    assert.ok(l.includes('DTSTART;VALUE=DATE:20260915'));
    assert.ok(l.includes('DTEND;VALUE=DATE:20260916'), 'une journée entière se termine le lendemain');
    assert.ok(l.includes('SUMMARY:Reconduction tacite : Assurance habitation'));
  });

  it('donne un identifiant stable par contrat et par type, pour que l’agenda déplace au lieu d’empiler', () => {
    const sept = buildIcs(state(), [deadline({ date: '2026-09-15' })]);
    const octobre = buildIcs(state(), [deadline({ date: '2027-09-15' })]);
    assert.ok(sept.includes('UID:fin-preavis-7@foyer'));
    assert.ok(octobre.includes('UID:fin-preavis-7@foyer'), 'même UID malgré la reconduction');
    assert.ok(!octobre.includes('20260915'));
  });

  it('ne réveille personne sauf pour la date limite de résiliation', () => {
    const preavis = buildIcs(state(), [deadline({ kind: 'preavis' })]);
    assert.ok(preavis.includes('BEGIN:VALARM'));
    assert.ok(preavis.includes('TRIGGER:-P7D'));

    for (const kind of ['renouvellement', 'fin'] as const) {
      assert.ok(!buildIcs(state(), [deadline({ kind })]).includes('VALARM'), `${kind} n’a pas à sonner`);
    }
  });

  it('mêle événements du foyer et échéances dans le même calendrier', () => {
    const withEvent = state({
      events: [{ id: 'e1', date: '2026-09-01', time: '18:30', title: 'Réunion école', who: '', recur: 'none' }],
    } as Partial<HouseholdState>);
    const ics = buildIcs(withEvent, [deadline()]);
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
    assert.ok(ics.includes('SUMMARY:Réunion école'));
    assert.ok(ics.includes('SUMMARY:Dernier jour pour résilier : Assurance habitation'));
  });

  it('sans échéance, le flux reste exactement celui d’avant', () => {
    const withEvent = state({
      events: [{ id: 'e1', date: '2026-09-01', time: '', title: 'Vacances', who: '', recur: 'none' }],
    } as Partial<HouseholdState>);
    assert.equal((buildIcs(withEvent).match(/BEGIN:VEVENT/g) || []).length, 1);
    assert.ok(!buildIcs(withEvent).includes('fin-preavis'));
  });
});
