// Atelier (Foyer): the page of the 'Grands codeurs' level. It mounts the editor
// with what Foyer wants of it: French, no account, no sharing, no community, no
// backpack, no cloud, and a storage that never leaves Foyer (storage.js).
import {EditorState, createStandaloneRoot, setAppElement} from '../index-standalone';
import {FoyerStorage} from './storage';

import './index.css';

// The page is served at <foyer>/atelier/grands/
const FOYER = '../../';

const target = document.createElement('div');
target.className = 'foyer-atelier';
document.body.appendChild(target);
setAppElement(target);

const state = new EditorState({locale: 'fr'}, () => ({storage: new FoyerStorage()}));

createStandaloneRoot(state, target).render({
    basePath: './',
    canChangeLanguage: false,
    canChangeColorMode: true,
    canChangeTheme: true,
    canEditTitle: false,
    canManageFiles: false,
    canSave: false,
    canCreateNew: false,
    canCreateCopy: false,
    canRemix: false,
    canShare: false,
    enableCommunity: false,
    backpackVisible: false,
    canUseCloud: false,
    hideTutorialProjects: true,
    // No video service is ever asked for: see the removed tutorial decks
    platform: 'DESKTOP',
    onClickLogo: () => {
        window.location.href = FOYER;
    }
});
