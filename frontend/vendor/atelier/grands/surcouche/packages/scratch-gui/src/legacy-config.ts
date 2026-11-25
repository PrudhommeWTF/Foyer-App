// Atelier (Foyer): replaces the configuration the editor falls back on, whose
// storage talked to the Scratch servers. Parts of the editor (the pictures of
// the libraries, the picking of a character) read their files through this
// configuration whatever storage the page was given: it has to be the storage
// of Foyer, and the very same instance the page uses (foyer/index.jsx).
import {GUIConfig} from './gui-config';
import {FoyerStorage} from './foyer/storage';

export const legacyConfig: GUIConfig = {
    storage: new FoyerStorage()
};
