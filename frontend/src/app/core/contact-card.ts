// Les fiches d'un contact et d'une carte de fidélité, sans Angular : ce que
// le formulaire montre à l'ouverture, ce qu'il enregistre, et s'il change
// quelque chose. Les deux vivent dans le document.
import { CardFormat, Contact, ContactCat, LoyaltyCard } from './models';

export interface ContactFields { name: string; role: string; phone: string; email: string; cat: ContactCat; color: string; urgent: boolean; birthday: string; }
export type ContactData = Omit<Contact, 'id'>;

export function contactFields(c: Contact | null): ContactFields {
  return c
    ? { name: c.name, role: c.role || '', phone: c.phone || '', email: c.email || '', cat: c.cat, color: c.color, urgent: !!c.urgent, birthday: c.birthday || '' }
    : { name: '', role: '', phone: '', email: '', cat: 'Famille', color: '#9B6FA8', urgent: false, birthday: '' };
}
/** Le contact décrit, ou la raison de le refuser (dite telle quelle). */
export function contactData(f: ContactFields): ContactData | string {
  const name = f.name.trim(); if (!name) return 'Donne un nom';
  const phone = f.phone.trim(); if (!phone) return 'Indique un téléphone';
  return { name, role: f.role.trim(), phone, email: f.email.trim(), cat: f.cat, color: f.color, urgent: f.urgent, birthday: f.birthday || null };
}
const contactShape = (c: ContactData): string =>
  JSON.stringify([c.name, c.role || '', c.phone || '', c.email || '', c.cat, c.color, !!c.urgent, c.birthday || '']);
/** Le contact décrit change-t-il le contact enregistré ? */
export function contactChanges(c: Contact, d: ContactData): boolean { return contactShape(c) !== contactShape(d); }

export interface CardFields { name: string; code: string; format: CardFormat; color: string; note: string; logo: string; }
export type CardData = Pick<LoyaltyCard, 'name' | 'code' | 'format' | 'color' | 'note' | 'logo'>;

export function cardFields(c: LoyaltyCard | null, color: string): CardFields {
  return c
    ? { name: c.name, code: c.code, format: c.format, color: c.color, note: c.note || '', logo: c.logo || '' }
    : { name: '', code: '', format: 'qr', color, note: '', logo: '' };
}
export function cardData(f: CardFields): CardData | string {
  const name = f.name.trim(); if (!name) return 'Donne un nom à la carte';
  const code = f.code.trim(); if (!code) return 'Le code est vide : scanne la carte ou saisis-le';
  return { name, code, format: f.format, color: f.color, note: f.note.trim() || undefined, logo: f.logo || undefined };
}
const cardShape = (c: CardData): string => JSON.stringify([c.name, c.code, c.format, c.color, c.note || '', c.logo || '']);
/** La carte décrite change-t-elle la carte enregistrée ? Son usage (compteur) n'entre pas en compte. */
export function cardChanges(c: LoyaltyCard, d: CardData): boolean { return cardShape(c) !== cardShape(d); }
