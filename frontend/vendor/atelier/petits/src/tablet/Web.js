//////////////////////////////////////////////////
//  Web bridge (Atelier, written for Foyer)
//
//  Third bridge next to the original iOS.js and Android.js, which it replaces:
//  everything the editor asked from the native application is done here, in the
//  browser, or asked from the Foyer API (/api/atelier/*) with the session cookie.
//
//  Projects, the child's own characters and backgrounds, and media files live on
//  the server. The server is the only one to name a media file (the fingerprint
//  of the content it has cleaned): the name sent back is the one the editor uses.
//
//  Recording and camera come later; until then getsettings() declares them
//  unavailable, so the editor does not show their buttons, and the functions
//  below throw if something calls them.
//////////////////////////////////////////////////

// The page is served at <foyer>/atelier/petits/, the API at <foyer>/api/atelier
const API = '../../api/atelier';
const FOYER = '../../';
const KINDS = {usershapes: 'personnage', userbkgs: 'decor'};

const revisions = {}; // project id -> revision last read from the server
const mediaCache = {}; // file name -> base64 content, as the editor expects it
let unsavedBadge = null;

// Sounds
let audio = null;
const buffers = {}; // name -> Promise of AudioBuffer
const playing = {}; // name -> AudioBufferSourceNode
let onSoundDone = function () {};

// Callbacks are always asynchronous, as they were with the native bridges.
function later (fcn, value) {
    if (fcn) {
        setTimeout(function () {
            fcn(value);
        }, 0);
    }
}

// Not a cryptographic digest: it only builds a temporary file name, which the
// server replaces by the real fingerprint.
function digest (str) {
    var h1 = 0xdeadbeef;
    var h2 = 0x41c6ce57;
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
    }
    return [h1, h2].map(function (h) {
        return ((h ^ (h >>> 15)) >>> 0).toString(16).padStart(8, '0');
    }).join('');
}

// One request to the Foyer API. Resolves with {status, body}; rejects only when
// the server could not be reached. A closed session sends back to Foyer, which
// shows its login screen.
function api (method, path, body, raw) {
    var options = {method: method, credentials: 'same-origin', headers: {}};
    if (raw) {
        options.headers['Content-Type'] = 'application/octet-stream';
        options.body = raw;
    } else if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(function (response) {
        if (response.status == 401) {
            window.location.href = FOYER;
            return new Promise(function () {});
        }
        return response.json().catch(function () {
            return {};
        }).then(function (json) {
            return {status: response.status, body: json};
        });
    });
}

// A message for the child, over the editor. buttons: [[label, action], ...]
function notice (text, buttons) {
    var shade = document.createElement('div');
    var s = shade.style;
    s.position = 'fixed'; s.left = '0'; s.top = '0'; s.width = '100%'; s.height = '100%';
    s.background = 'rgba(0, 0, 0, 0.45)'; s.zIndex = '99999';
    s.display = 'flex'; s.alignItems = 'center'; s.justifyContent = 'center';
    var box = document.createElement('div');
    box.setAttribute('role', 'alertdialog');
    s = box.style;
    s.background = '#FFFFFF'; s.borderRadius = '18px'; s.padding = '28px'; s.maxWidth = '520px';
    s.font = '22px Roboto, sans-serif'; s.color = '#1F3B4D'; s.textAlign = 'center'; s.lineHeight = '1.35';
    var p = document.createElement('p');
    p.textContent = text;
    p.style.margin = '0 0 22px 0';
    box.appendChild(p);
    buttons.forEach(function (b) {
        var button = document.createElement('button');
        button.textContent = b[0];
        var bs = button.style;
        bs.font = 'inherit'; bs.margin = '6px'; bs.padding = '14px 22px'; bs.minHeight = '56px';
        bs.border = '0'; bs.borderRadius = '14px'; bs.background = '#28A5DA'; bs.color = '#FFFFFF';
        button.onclick = function () {
            document.body.removeChild(shade);
            b[1]();
        };
        box.appendChild(button);
    });
    shade.appendChild(box);
    document.body.appendChild(shade);
    box.querySelector('button').focus();
}

// The 'not saved' state, visible as long as the last save has not reached the server
function setUnsaved (on) {
    if (on && !unsavedBadge) {
        unsavedBadge = document.createElement('div');
        unsavedBadge.textContent = 'Non enregistré';
        unsavedBadge.setAttribute('role', 'status');
        var s = unsavedBadge.style;
        s.position = 'fixed'; s.left = '50%'; s.top = '6px'; s.transform = 'translateX(-50%)'; s.zIndex = '99998';
        s.background = '#D62222'; s.color = '#FFFFFF'; s.font = '16px Roboto, sans-serif';
        s.padding = '6px 14px'; s.borderRadius = '14px'; s.pointerEvents = 'none';
        document.body.appendChild(unsavedBadge);
    } else if (!on && unsavedBadge) {
        document.body.removeChild(unsavedBadge);
        unsavedBadge = null;
    }
}

function leave () {
    window.location.href = FOYER;
}

// The editor hands a string as base64 of its character codes (btoa). Files are
// kept in UTF-8 on the server: these two convert in each direction.
function bytesOf (b64, isText) {
    var bin = atob(b64);
    if (isText) {
        return new TextEncoder().encode(bin);
    }
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes;
}

function base64Of (buffer, isText) {
    var bin = '';
    if (isText) {
        bin = new TextDecoder().decode(buffer);
    } else {
        var bytes = new Uint8Array(buffer);
        for (var i = 0; i < bytes.length; i++) {
            bin += String.fromCharCode(bytes[i]);
        }
    }
    try {
        return btoa(bin);
    } catch (e) {
        // A character outside Latin-1: the editor could not have written it
        return btoa(unescape(encodeURIComponent(bin)));
    }
}

function isSvg (name) {
    return /\.svg$/.test(name);
}

// Sends a media file; the server answers with its name
function upload (b64, ext, fcn) {
    api('POST', '/medias', undefined, bytesOf(b64, ext == 'svg')).then(function (r) {
        if (r.status == 200 || r.status == 201) {
            mediaCache[r.body.name] = b64;
            fcn(r.body.name);
        } else {
            notice(r.body.error || 'Ce dessin n’a pas pu être enregistré.', [['D’accord', function () {
                window.location.reload();
            }]]);
        }
    }, function () {
        notice('Pas de réseau : ce dessin n’a pas pu être enregistré. Réessaie dans un moment.', [['D’accord', function () {
            window.location.reload();
        }]]);
    });
}

// The row of a project, in the shape the editor parses
function projectRow (p) {
    return {
        id: p.id, name: p.name, version: p.editorVersion, json: p.json,
        thumbnail: p.thumbnail ? JSON.stringify(p.thumbnail) : null, mtime: String(Date.parse(p.updatedAt))
    };
}

function soundUrl (dir, name) {
    // 'HTML5/' was the root of the application bundle on the tablet
    return dir.replace('HTML5/', '') + name;
}

// A browser keeps the audio context suspended until a gesture of the user, and
// only the END of a touch counts as one (Safari on iPad is the strictest). The
// editor reacts when the finger goes down, so the context is also resumed here,
// at the end of every gesture, until it runs.
function unlockAudio () {
    var resume = function () {
        if (audio.state == 'suspended') {
            audio.resume();
        } else if (audio.state == 'running') {
            ['touchend', 'mouseup', 'click'].forEach(function (type) {
                window.removeEventListener(type, resume, true);
            });
        }
    };
    ['touchend', 'mouseup', 'click'].forEach(function (type) {
        window.addEventListener(type, resume, true);
    });
}

function notYet (what) {
    throw new Error('Atelier: ' + what + ' is not available in this version');
}

export default class Web {
    static set onSoundDone (fcn) {
        onSoundDone = fcn;
    }

    // Projects

    static projectGet (id, fcn) {
        api('GET', '/projets/' + encodeURIComponent(id)).then(function (r) {
            if (r.status != 200) {
                fcn('[]');
                return;
            }
            revisions[r.body.projet.id] = r.body.projet.rev;
            fcn(JSON.stringify([projectRow(r.body.projet)]));
        }, function () {
            notice('Pas de réseau : ce projet ne peut pas s’ouvrir pour l’instant.', [['Revenir à Foyer', leave]]);
        });
    }

    static projectCreate (obj, fcn) {
        api('POST', '/projets', {name: obj.name, level: 'petits'}).then(function (r) {
            if (r.status != 201) {
                notice(r.body.error || 'Ce projet n’a pas pu être créé.', [['Revenir à Foyer', leave]]);
                return;
            }
            revisions[r.body.projet.id] = r.body.projet.rev;
            fcn(r.body.projet.id);
        }, function () {
            notice('Pas de réseau : impossible de créer un projet pour l’instant.', [['Revenir à Foyer', leave]]);
        });
    }

    // Saves with the revision last read. If another device has saved in between,
    // the server refuses and the child chooses: nothing is ever overwritten silently.
    static projectSave (obj, fcn) {
        var send = function () {
            return api('PUT', '/projets/' + encodeURIComponent(obj.id), {
                rev: revisions[obj.id], name: obj.name, json: obj.json, thumbnail: obj.thumbnail, editorVersion: obj.version
            });
        };
        var done = function (r) {
            if (r.status == 200) {
                revisions[obj.id] = r.body.projet.rev;
                setUnsaved(false);
                later(fcn, 'ok');
            } else if (r.status == 409 && r.body.code == 'conflit') {
                notice('Ce projet a aussi été modifié sur un autre appareil. Lequel veux-tu garder ?', [
                    ['Garder celui-ci', function () {
                        revisions[obj.id] = r.body.projet.rev;
                        send().then(done, failed);
                    }],
                    ['Garder l’autre', function () {
                        window.location.reload();
                    }]
                ]);
            } else {
                setUnsaved(true);
                notice(r.body.error || 'Ce projet n’a pas pu être enregistré.', [['D’accord', function () {
                    later(fcn, 'error');
                }]]);
            }
        };
        // No network: the editor goes on, the badge stays, the next save tries again
        var failed = function () {
            setUnsaved(true);
            later(fcn, 'error');
        };
        send().then(done, failed);
    }

    static projectRename (id, name, fcn) {
        api('PATCH', '/projets/' + encodeURIComponent(id), {name: name}).then(function () {
            later(fcn, 'ok');
        }, function () {
            setUnsaved(true);
            later(fcn, 'error');
        });
    }

    static projectList (fcn) {
        api('GET', '/projets').then(function (r) {
            fcn(JSON.stringify((r.body.projets || []).map(projectRow)));
        }, function () {
            fcn('[]');
        });
    }

    // The child's own characters ('usershapes') and backgrounds ('userbkgs'), most recent first

    static assetList (kind, fcn) {
        api('GET', '/elements?kind=' + KINDS[kind]).then(function (r) {
            fcn(JSON.stringify(r.body.elements || []));
        }, function () {
            fcn('[]');
        });
    }

    static assetFind (kind, field, value, fcn) {
        Web.assetList(kind, function (str) {
            fcn(JSON.stringify(JSON.parse(str).filter(function (a) {
                return a[field] == value;
            })));
        });
    }

    static assetAdd (kind, record, fcn) {
        api('POST', '/elements', Object.assign({kind: KINDS[kind]}, record)).then(function (r) {
            later(fcn, r.body.element ? String(r.body.element.id) : 'error');
        }, function () {
            later(fcn, 'error');
        });
    }

    static assetRemove (kind, id, fcn) {
        api('DELETE', '/elements/' + encodeURIComponent(id)).then(function () {
            later(fcn, 'ok');
        }, function () {
            later(fcn, 'error');
        });
    }

    // Media files

    // The server does the housekeeping
    static cleanassets (ft, fcn) {
        later(fcn);
    }

    // "<documents path>,<0 when files are reachable by URL>,<recording>,<camera>"
    static getsettings (fcn) {
        later(fcn, ',1,NO,NO');
    }

    static getmedia (file, fcn) {
        if (mediaCache[file] !== undefined) {
            later(fcn, mediaCache[file]);
            return;
        }
        fetch(API + '/medias/' + encodeURIComponent(file), {credentials: 'same-origin'}).then(function (response) {
            return response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)));
        }).then(function (data) {
            mediaCache[file] = base64Of(data, isSvg(file));
            fcn(mediaCache[file]);
        }).catch(function () {
            fcn('');
        });
    }

    static setmedia (str, ext, fcn) {
        upload(str, ext, fcn);
    }

    // The name asked for is ignored: the server names the file, and the editor
    // uses the name it gets back.
    static setmedianame (str, name, ext, fcn) {
        upload(str, ext, fcn || function () {});
    }

    static getmd5 (str, fcn) {
        later(fcn, digest(str));
    }

    // A request, not an order: the server only removes what nothing refers to any more
    static remove (name, fcn) {
        delete mediaCache[name];
        api('DELETE', '/medias/' + encodeURIComponent(name)).then(function () {
            later(fcn, 'ok');
        }, function () {
            later(fcn, 'error');
        });
    }

    // The original copied a library file next to the child's files, in case an
    // update of the application removed it. The library is served by Foyer with
    // the editor and found by its name: there is nothing to copy.
    static duplicateAsset (path, name, fcn) {
        later(fcn, name);
    }

    // Sounds, through Web Audio (see unlockAudio above for the gesture rule).

    static registerSound (dir, name, fcn) {
        if (!audio) {
            var AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) {
                later(fcn, 'error');
                return;
            }
            audio = new AudioContextClass();
            unlockAudio();
        }
        // 'Documents' was the folder of recorded sounds: none exists before the recording step
        var source = (dir == 'Documents') ?
            Promise.reject(new Error('missing')) :
            fetch(soundUrl(dir, name)).then(function (response) {
                return response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)));
            });
        buffers[name] = source.then(function (data) {
            return new Promise(function (resolve, reject) {
                audio.decodeAudioData(data, resolve, reject);
            });
        });
        buffers[name].then(function () {
            later(fcn, name);
        }, function () {
            delete buffers[name];
            later(fcn, 'error');
        });
    }

    static playSound (name, fcn) {
        if (!buffers[name]) {
            onSoundDone(name);
            later(fcn, 'error');
            return;
        }
        buffers[name].then(function (buffer) {
            Web.stopSound(name);
            if (audio.state == 'suspended') {
                audio.resume();
            }
            var node = audio.createBufferSource();
            node.buffer = buffer;
            node.connect(audio.destination);
            node.onended = function () {
                if (playing[name] === node) {
                    delete playing[name];
                    onSoundDone(name);
                }
            };
            playing[name] = node;
            node.start();
            later(fcn, name);
        });
    }

    static stopSound (name, fcn) {
        var node = playing[name];
        if (node) {
            delete playing[name];
            node.onended = null;
            node.stop();
        }
        later(fcn, name);
    }

    // Recording and camera: not in this version (see the header)

    static sndrecord () {
        notYet('recording');
    }

    static recordstop () {
        notYet('recording');
    }

    static volume () {
        notYet('recording');
    }

    static startplay () {
        notYet('recording');
    }

    static stopplay () {
        notYet('recording');
    }

    static recorddisappear () {
        notYet('recording');
    }

    static askpermission () {
        notYet('recording');
    }

    static hascamera () {
        return '0';
    }

    static startfeed () {
        notYet('the camera');
    }

    // Called each time the paint editor closes, feed or not: nothing to stop yet.
    static stopfeed (fcn) {
        later(fcn);
    }

    static choosecamera () {
        notYet('the camera');
    }

    static captureimage () {
        notYet('the camera');
    }
}
