// Atelier (Foyer): the page of the 'Grands codeurs' level. It mounts the editor
// with what Foyer wants of it: French, no account, no sharing, no community, no
// backpack, no cloud, and a storage that never leaves Foyer (storage.js).
//
//   editor.html?projet=<id>            edits the project
//   editor.html?projet=<id>&vue=plein  only plays it, full screen (phones)
import {EditorState, createStandaloneRoot, setAppElement} from '../index-standalone';
import {autoUpdateProject, getIsShowingWithId} from '../reducers/project-state';
import {FoyerStorage} from './storage';

import styles from './index.css';

// The page is served at <foyer>/atelier/grands/
const FOYER = '../../';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const query = new URLSearchParams(window.location.search);
const projectId = query.get('projet') || '';
const watching = query.get('vue') === 'plein';

const leave = () => {
    window.onbeforeunload = null;
    window.location.href = FOYER;
};

const start = (storage, projet) => {
    const target = document.createElement('div');
    target.className = styles.app;
    document.body.appendChild(target);
    setAppElement(target);

    const state = new EditorState({locale: 'fr'}, () => ({storage}));
    const gui = () => state.store.getState().scratchGui;
    const canSave = storage.canSave && !watching;

    // Saves through the editor, so that what it shows (saving, saved, could not save) stays true
    const save = () => {
        if (canSave && gui().projectChanged && getIsShowingWithId(gui().projectState.loadingState)) {
            state.store.dispatch(autoUpdateProject());
            return true;
        }
        return false;
    };
    storage.onRetry = () => {
        if (!save()) storage.resend();
    };

    // An iPad that goes to sleep or changes application may never come back to this page
    const keep = () => {
        if (canSave && gui().projectChanged) {
            storage.keep(gui().vm);
            save();
        }
    };
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') keep();
    });
    window.addEventListener('pagehide', keep);

    createStandaloneRoot(state, target).render({
        basePath: './',
        projectId: projet.id,
        projectTitle: projet.name,
        onUpdateProjectTitle: name => storage.rename(name),
        onUpdateProjectThumbnail: (id, blob) => storage.saveThumbnail(blob),
        autoSaveIntervalSecs: 30,
        isPlayerOnly: watching,
        isFullScreen: watching,
        canSave,
        canEditTitle: canSave,
        // Load from and save to a file on the device
        canManageFiles: !watching,
        canChangeLanguage: false,
        canChangeColorMode: true,
        canChangeTheme: true,
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
        // Back to Foyer, once what changed is saved or at least kept on the device
        onClickLogo: () => {
            keep();
            storage.pending.catch(() => {}).then(leave);
        }
    });

    // Keeps the page and its files for the next time there is no network (see public/sw.js of Foyer)
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'atelier-precharger',
            base: new URL('./', window.location.href).pathname
        });
    }
};

if (UUID.test(projectId)) {
    const storage = new FoyerStorage();
    storage.open(projectId).then(projet => start(storage, projet), err => {
        window.alert(err.message);
        leave();
    });
} else {
    // The editor only opens on a project of Foyer: the Atelier screen creates it
    leave();
}
