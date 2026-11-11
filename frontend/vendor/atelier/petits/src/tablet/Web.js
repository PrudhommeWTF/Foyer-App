//////////////////////////////////////////////////
//  Web bridge (Atelier, written for Foyer)
//
//  Third bridge next to the original iOS.js and Android.js, which it replaces:
//  everything the editor asked from the native application is done here, in the
//  browser, or asked from the Foyer API (/api/atelier/*) with the session cookie.
//
//  Projects, the child's own characters and backgrounds, and media files live on
//  the server. A copy of what this device has opened is kept in Offline.js, so
//  that a project goes on without network and is sent when it comes back.
//  The server is the only one to name a media file (the fingerprint
//  of the content it has cleaned): the name sent back is the one the editor uses.
//
//  Recording and camera come later; until then getsettings() declares them
//  unavailable, so the editor does not show their buttons, and the functions
//  below throw if something calls them.
//////////////////////////////////////////////////

import Offline from './Offline';

// The page is served at <foyer>/atelier/petits/, the API at <foyer>/api/atelier
const API = '../../api/atelier';
const FOYER = '../../';
const KINDS = {usershapes: 'personnage', userbkgs: 'decor'};

const revisions = {}; // project id -> revision last read from the server
const mediaCache = {}; // file name -> base64 content, as the editor expects it
let unsavedBadge = null;
const conflicts = {}; // project id -> revision the server holds, when it differs from the one this device started from
let owner = null; // id of the member whose project is open: someone else's when an adult looks at a child's work
let member = null; // id of the member of this session, or of the last one seen on this device
const TEMP = /^horsligne-[0-9a-f]+\.(svg|png)$/; // a media file drawn without network
const HINT = 'foyer.atelier.dernier'; // read by the Foyer screen, to offer the last project when offline

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

// The 'not saved' state, visible as long as the last save has not reached the server.
// While it lasts, sending is tried again regularly: the browser's 'online' event
// alone is not reliable enough (it says a network is there, not that Foyer answers).
let retry = null;
function setUnsaved (on) {
    if (on && !retry) {
        retry = setInterval(flush, 15000);
    } else if (!on && retry) {
        clearInterval(retry);
        retry = null;
    }
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

// Sends a media file; the server answers with its name. Without network the file
// is kept on the device under a temporary name, and sent later (see flush).
function upload (b64, ext, fcn) {
    api('POST', '/medias', undefined, bytesOf(b64, ext == 'svg')).then(function (r) {
        if (r.status == 200 || r.status == 201) {
            mediaCache[r.body.name] = b64;
            Offline.put('medias', {name: r.body.name, b64: b64});
            fcn(r.body.name);
        } else {
            notice(r.body.error || 'Ce dessin n’a pas pu être enregistré.', [['D’accord', function () {
                window.location.reload();
            }]]);
        }
    }, function () {
        var name = 'horsligne-' + digest(b64) + digest(ext + b64.length) + '.' + ext;
        mediaCache[name] = b64;
        Promise.all([Offline.put('medias', {name: name, b64: b64}), Offline.put('attente', {name: name, b64: b64, ext: ext})]).then(function () {
            setUnsaved(true);
            fcn(name);
        });
    });
}

// Replaces, in a text, the temporary names of media files by the names the server gave
function resolved (text, aliases) {
    if (!text) {
        return text;
    }
    aliases.forEach(function (a) {
        text = text.split(a.temp).join(a.real);
    });
    return text;
}

// Sends what is waiting: the media files first, then the projects that refer to
// them. Resolves with true when nothing is left to send. Never overwrites: a
// project changed elsewhere in the meantime is left for the child to decide.
let flushing = null;
function flush () {
    if (flushing) {
        return flushing;
    }
    flushing = Offline.all('attente').then(function (pending) {
        return pending.reduce(function (chain, m) {
            return chain.then(function () {
                return api('POST', '/medias', undefined, bytesOf(m.b64, m.ext == 'svg')).then(function (r) {
                    if (r.status != 200 && r.status != 201) {
                        return null; // refused (quota, format): it stays on the device, the project keeps its temporary name
                    }
                    mediaCache[r.body.name] = m.b64;
                    return Promise.all([
                        Offline.put('alias', {temp: m.name, real: r.body.name}),
                        Offline.put('medias', {name: r.body.name, b64: m.b64}),
                        Offline.remove('attente', m.name)
                    ]);
                });
            });
        }, Promise.resolve());
    }).then(function () {
        return Promise.all([Offline.all('projets'), Offline.all('alias')]);
    }).then(function (found) {
        var dirty = found[0].filter(function (p) {
            return p.dirty && p.membre == member;
        });
        return dirty.reduce(function (chain, p) {
            return chain.then(function (clean) {
                var json = resolved(p.json, found[1]);
                var thumbnail = resolved(p.thumbnail, found[1]);
                if (TEMP.test(String(thumbnail && JSON.parse(thumbnail).md5))) {
                    thumbnail = null; // its picture could not be sent: the project is saved without it
                }
                return api('PUT', '/projets/' + encodeURIComponent(p.id), {
                    rev: p.rev, name: p.name, json: json, thumbnail: thumbnail, editorVersion: p.version
                }).then(function (r) {
                    if (r.status == 200) {
                        revisions[p.id] = r.body.projet.rev;
                        return Offline.put('projets', Object.assign({}, p, {json: json, thumbnail: thumbnail, rev: r.body.projet.rev, dirty: false})).then(function () {
                            return clean;
                        });
                    }
                    if (r.status == 409 && r.body.code == 'conflit') {
                        conflicts[p.id] = r.body.projet.rev;
                    }
                    return false;
                });
            });
        }, Promise.resolve(true));
    }).then(function (clean) {
        flushing = null;
        setUnsaved(!clean);
        return clean;
    }, function () {
        flushing = null;
        return false;
    });
    return flushing;
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

    // Who is working, then anything left from a session without network. Called
    // once, before the editor opens a project.
    static start (fcn) {
        api('GET', '/contexte').then(function (r) {
            member = r.body.membre ? r.body.membre.id : null;
            return Offline.put('meta', {k: 'membre', v: member}).then(flush);
        }, function () {
            return Offline.get('meta', 'membre').then(function (m) {
                member = m ? m.v : null;
            });
        }).then(function () {
            fcn();
        });
        // Ask Foyer's service worker to keep the whole Atelier on the device, so that
        // it opens without network next time (see public/sw.js)
        if (navigator.serviceWorker && navigator.serviceWorker.controller && navigator.onLine) {
            navigator.serviceWorker.controller.postMessage({type: 'atelier-precharger', base: new URL('./', window.location.href).pathname});
        }
        // The network is back: send what was waiting, without asking anything of the child
        window.addEventListener('online', function () {
            flush();
        });
    }

    // Projects

    static projectGet (id, fcn) {
        var local = function () {
            return Offline.get('projets', id).then(function (p) {
                return (p && p.membre == member) ? p : null;
            });
        };
        var open = function (p) {
            revisions[p.id] = p.rev;
            try {
                window.localStorage.setItem(HINT, JSON.stringify({membre: member, id: p.id, name: p.name}));
            } catch (e) {
                // no storage: the Foyer screen will simply not offer it offline
            }
            fcn(JSON.stringify([{id: p.id, name: p.name, version: p.version, json: p.json, thumbnail: p.thumbnail, mtime: p.mtime}]));
        };
        Promise.all([local(), api('GET', '/projets/' + encodeURIComponent(id))]).then(function (found) {
            var kept = found[0];
            var r = found[1];
            // What was done here without network, and is still not on the server, comes first
            if (kept && kept.dirty) {
                setUnsaved(true);
                open(kept);
                return;
            }
            if (r.status != 200) {
                fcn('[]');
                return;
            }
            var row = projectRow(r.body.projet);
            var p = Object.assign(row, {rev: r.body.projet.rev, membre: r.body.projet.memberId, dirty: false});
            owner = r.body.projet.memberId;
            if (p.membre != member) {
                open(p); // watched, not kept: the offline copy is for one's own projects
                return;
            }
            Offline.put('projets', p).then(function () {
                open(p);
            });
        }, function () {
            local().then(function (kept) {
                if (kept) {
                    setUnsaved(kept.dirty);
                    open(kept);
                } else {
                    notice('Pas de réseau : ce projet n’a jamais été ouvert sur cet appareil, il ne peut pas s’ouvrir pour l’instant.', [['Revenir à Foyer', leave]]);
                }
            });
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

    // Saves on the device first, then on the server with the revision last read.
    // If another device has saved in between, the server refuses and the child
    // chooses: nothing is ever overwritten silently. Without network the project
    // stays on the device, marked as not saved, and leaves when the network is back.
    static projectSave (obj, fcn) {
        var row = {
            id: obj.id, name: obj.name, version: obj.version, json: obj.json, thumbnail: obj.thumbnail,
            mtime: String(Date.now()), rev: revisions[obj.id], membre: member, dirty: true
        };
        Offline.put('projets', row).then(flush).then(function (clean) {
            if (conflicts[obj.id] === undefined) {
                later(fcn, clean ? 'ok' : 'error');
                return;
            }
            var theirs = conflicts[obj.id];
            delete conflicts[obj.id];
            notice('Ce projet a aussi été modifié sur un autre appareil. Lequel veux-tu garder ?', [
                ['Garder celui-ci', function () {
                    revisions[obj.id] = theirs;
                    Offline.put('projets', Object.assign({}, row, {rev: theirs})).then(flush).then(function () {
                        later(fcn, 'ok');
                    });
                }],
                ['Garder l’autre', function () {
                    Offline.remove('projets', obj.id).then(function () {
                        window.location.reload();
                    });
                }]
            ]);
        });
    }

    static projectRename (id, name, fcn) {
        api('PATCH', '/projets/' + encodeURIComponent(id), {name: name}).then(function () {
            later(fcn, 'ok');
        }, function () {
            // Without network the name leaves with the next save, which carries it
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
        Offline.get('medias', file).then(function (kept) {
            if (kept) {
                mediaCache[file] = kept.b64;
                fcn(kept.b64);
                return;
            }
            // The drawings of a project belong to its owner: say whose, when it is not this session's
            var whose = (owner && owner != member) ? '?membre=' + encodeURIComponent(owner) : '';
            fetch(API + '/medias/' + encodeURIComponent(file) + whose, {credentials: 'same-origin'}).then(function (response) {
                return response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)));
            }).then(function (data) {
                mediaCache[file] = base64Of(data, isSvg(file));
                Offline.put('medias', {name: file, b64: mediaCache[file]});
                fcn(mediaCache[file]);
            }).catch(function () {
                fcn('');
            });
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
        Offline.remove('medias', name);
        Offline.remove('attente', name);
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
