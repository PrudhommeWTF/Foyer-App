// Les fiches contact et carte : ouvrir puis enregistrer sans rien toucher ne change rien.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Contact, LoyaltyCard } from './models';
import { cardChanges, cardData, cardFields, contactChanges, contactData, contactFields } from './contact-card';

const dentiste: Contact = { id: 'c1', name: 'Dr Martin', role: 'Dentiste', phone: '01 02 03 04 05', email: '', cat: 'Santé', color: '#C77DA5', urgent: false };
const carrefour: LoyaltyCard = { id: 'k1', name: 'Carrefour', code: '1234567890128', format: 'ean13', color: '#4E93B8', uses: 3, lastUsedAt: '2026-10-01T10:00:00Z' };

test('contact ouvert puis enregistré tel quel : rien ne change', () => {
  const d = contactData(contactFields(dentiste));
  assert.notEqual(typeof d, 'string');
  assert.equal(contactChanges(dentiste, d as Exclude<typeof d, string>), false);
});

test('contact : un champ vide obligatoire est refusé, un changement se voit', () => {
  assert.equal(contactData({ ...contactFields(dentiste), phone: ' ' }), 'Indique un téléphone');
  assert.equal(contactData({ ...contactFields(null), phone: '06' }), 'Donne un nom');
  const d = contactData({ ...contactFields(dentiste), urgent: true }) as Exclude<ReturnType<typeof contactData>, string>;
  assert.equal(contactChanges(dentiste, d), true);
});

test('carte ouverte puis enregistrée telle quelle : rien ne change, son usage n’y entre pas', () => {
  const d = cardData(cardFields(carrefour, '#E56B4E'));
  assert.notEqual(typeof d, 'string');
  assert.equal(cardChanges(carrefour, d as Exclude<typeof d, string>), false);
  assert.equal(cardData({ ...cardFields(null, '#E56B4E'), name: 'Leclerc' }), 'Le code est vide : scanne la carte ou saisis-le');
});
