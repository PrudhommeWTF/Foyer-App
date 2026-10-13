// Le seul point d'entrée du client ÉcoleDirecte pour le reste de Foyer.
export { EdClient, EdSession, encodeCredential } from './client';
export type { EdConfig, EdExchange, LoginOutcome, Trusted } from './client';
export type { EdAccountInfo, EdStudentInfo } from './accounts';
export { EdError } from './errors';
export type { EdErrorKind } from './errors';
