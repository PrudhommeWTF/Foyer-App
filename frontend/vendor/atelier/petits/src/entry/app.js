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

// Atelier: shows 'turn the screen' while the device is held upright. Returns true
// when the page was loaded upright, in which case nothing else must start.
function turnScreen () {
    var upright = function () {
        return window.innerHeight > window.innerWidth;
    };
    var loadedUpright = upright();
    var veil = document.createElement('div');
    var s = veil.style;
    s.position = 'fixed'; s.left = '0'; s.top = '0'; s.width = '100%'; s.height = '100%'; s.zIndex = '100000';
    s.background = '#F5F2F7'; s.color = '#1F3B4D'; s.font = '26px Roboto, sans-serif'; s.textAlign = 'center';
    s.alignItems = 'center'; s.justifyContent = 'center'; s.padding = '24px'; s.boxSizing = 'border-box';
    veil.setAttribute('role', 'alert');
    veil.textContent = /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 ? 'Tourne l’iPad' : 'Tourne l’écran';
    document.body.appendChild(veil);
    var update = function () {
        if (loadedUpright && !upright()) {
            window.location.reload();
            return;
        }
        veil.style.display = upright() ? 'flex' : 'none';
    };
    window.addEventListener('resize', update);
    update();
    return loadedUpright;
}

// App-wide entry-point
window.onload = () => {
    let root = './';

    // Atelier: the editor is laid out once, for a landscape screen, from the size of
    // the window when the page loads. Held upright, the device only shows a message;
    // turned, the page reloads to take its real size.
    if (turnScreen()) {
        return;
    }

    // Atelier: the style sheets are fetched one after the other (see lib.js), in
    // the original order, before anything is drawn.
    var sheets = ['font', 'base', 'editor', 'editorleftpanel', 'editorstage', 'editormodal', 'librarymodal', 'paintlook'];
    sheets.reduce(function (chain, name) {
        return chain.then(function () {
            return preprocessAndLoadCss('css', 'css/' + name + '.css');
        });
    }, Promise.resolve()).then(function () {
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
    });
};
