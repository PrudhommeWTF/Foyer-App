import {preprocessAndLoadCss} from '../utils/lib';
import Localization from '../utils/Localization';
import OS from '../tablet/OS';
import IO from '../tablet/IO';
import MediaLib from '../tablet/MediaLib';

import {editorMain} from './editor';

// Atelier: the original bundle also served the splash screen, the lobby, the
// getting-started video and the in-app help pages. Only the editor is kept: the
// project library is a Foyer screen, and the help is rewritten later.

function loadSettings (settingsRoot, whenDone) {
    IO.requestFromServer(settingsRoot + 'settings.json', (result) => {
        window.Settings = JSON.parse(result);
        whenDone();
    });
}

// App-wide entry-point
window.onload = () => {
    let root = './';

    preprocessAndLoadCss('css', 'css/font.css');
    preprocessAndLoadCss('css', 'css/base.css');
    preprocessAndLoadCss('css', 'css/editor.css');
    preprocessAndLoadCss('css', 'css/editorleftpanel.css');
    preprocessAndLoadCss('css', 'css/editorstage.css');
    preprocessAndLoadCss('css', 'css/editormodal.css');
    preprocessAndLoadCss('css', 'css/librarymodal.css');
    preprocessAndLoadCss('css', 'css/paintlook.css');

    // Start up sequence
    // Load settings from JSON
    loadSettings(root, () => {
        // Load locale strings from JSON
        Localization.includeLocales(root, () => {
            // Load Media Lib from JSON
            MediaLib.loadMediaLib(root, () => {
                OS.waitForInterface(editorMain);
            });
        });
    });
};
