import ScratchJr from '../editor/ScratchJr';
import OS from '../tablet/OS';
import IO from '../tablet/IO';
import Web from '../tablet/Web';
import Camera from '../painteditor/Camera';
import Record from '../editor/ui/Record';
import Localization from '../utils/Localization';
import {getUrlVars} from '../utils/lib';

export function editorMain () {
    OS.getsettings(doNext);
    function doNext (str) {
        var list = str.split(',');
        OS.path = list[1] == '0' ? list[0] + '/' : undefined;
        if (list.length > 2) {
            Record.available = list[2] == 'YES' ? true : false;
        }
        if (list.length > 3) {
            Camera.available = list[3] == 'YES' ? true : false;
        }
        Web.start(openProject);
    }

    // Atelier: the lobby used to create the project before opening the editor.
    // Opened without a known project, the editor now starts a new one itself.
    // Atelier: 'vue=plein' opens a project to be watched, not edited (a phone, where
    // the editor cannot be used): presentation mode as soon as the project is
    // there, and the button that would leave it goes back to Foyer instead.
    function present () {
        var wait = window.setInterval(function () {
            var full = document.getElementById('full');
            if (!full || ScratchJr.onHold || !ScratchJr.stage || !ScratchJr.stage.currentPage) {
                return;
            }
            window.clearInterval(wait);
            ScratchJr.enterFullScreen({preventDefault: function () {}, stopPropagation: function () {}});
            var back = function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.location.href = '../../';
            };
            full.ontouchstart = back;
            full.onmousedown = back;
            full.onclick = back;
            full.setAttribute('aria-label', 'Revenir à Foyer');
        }, 200);
    }

    function openProject () {
        var version = window.Settings.scratchJrVersion;
        var id = getUrlVars().pmd5;
        if (!id) {
            createProject();
            return;
        }
        OS.projectGet(id, function (str) {
            if (JSON.parse(str).length > 0) {
                ScratchJr.appinit(version);
                if (getUrlVars().vue == 'plein') {
                    present();
                }
            } else {
                createProject();
            }
        });
        function createProject () {
            IO.createProject({
                name: Localization.localize('NEW_PROJECT_PREFIX') + ' 1',
                version: version
            }, function (newId) {
                window.history.replaceState(null, '', '?pmd5=' + newId + '&mode=edit');
                ScratchJr.appinit(version);
            });
        }
    }
}
