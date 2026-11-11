//////////////////////////////////////////////////
//  Web bridge (Atelier, written for Foyer)
//
//  Third bridge next to the original iOS.js and Android.js, which it replaces:
//  everything the editor asked from the native application is done here, in the
//  browser.
//
//  This first version keeps projects, assets and media IN MEMORY: nothing
//  survives a reload. The storage moves to the Foyer API (/api/atelier/*) in the
//  next step, behind the same function names. Recording and camera come later;
//  until then getsettings() declares them unavailable, so the editor does not
//  show their buttons, and the functions below throw if something calls them.
//////////////////////////////////////////////////

const projects = [];
const assets = {usershapes: [], userbkgs: []};
const media = {}; // file name -> base64 content
let nextId = 1;

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

// Not a cryptographic digest: it only names a file kept in memory. The server
// computes the real fingerprint once media are stored by Foyer.
function digest (str) {
    var h1 = 0xdeadbeef;
    var h2 = 0x41c6ce57;
    var h3 = 0x9e3779b9;
    var h4 = 0x85ebca6b;
    for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 2654435761);
        h2 = Math.imul(h2 ^ c, 1597334677);
        h3 = Math.imul(h3 ^ c, 2246822507);
        h4 = Math.imul(h4 ^ c, 3266489909);
    }
    return [h1, h2, h3, h4].map(function (h) {
        return ((h ^ (h >>> 15)) >>> 0).toString(16).padStart(8, '0');
    }).join('');
}

function soundUrl (dir, name) {
    // 'HTML5/' was the root of the application bundle on the tablet
    return dir.replace('HTML5/', '') + name;
}

function base64ToBuffer (b64) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
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
        later(fcn, JSON.stringify(projects.filter(function (p) {
            return p.id == id;
        })));
    }

    static projectCreate (obj, fcn) {
        var id = String(nextId++);
        projects.push({
            id: id, name: obj.name, version: obj.version, json: obj.json, thumbnail: obj.thumbnail,
            mtime: Date.now().toString()
        });
        later(fcn, id);
    }

    static projectSave (obj, fcn) {
        projects.forEach(function (p) {
            if (p.id == obj.id) {
                p.name = obj.name;
                p.version = obj.version;
                p.json = obj.json;
                p.thumbnail = obj.thumbnail;
                p.mtime = Date.now().toString();
            }
        });
        later(fcn, 'ok');
    }

    static projectRename (id, name, fcn) {
        projects.forEach(function (p) {
            if (p.id == id) {
                p.name = name;
                p.mtime = Date.now().toString();
            }
        });
        later(fcn, 'ok');
    }

    static projectList (fcn) {
        later(fcn, JSON.stringify(projects.map(function (p) {
            return {id: p.id, name: p.name, thumbnail: p.thumbnail};
        })));
    }

    // The child's own characters and backgrounds, most recent first

    static assetList (kind, fcn) {
        later(fcn, JSON.stringify(assets[kind].slice().reverse()));
    }

    static assetFind (kind, field, value, fcn) {
        later(fcn, JSON.stringify(assets[kind].filter(function (a) {
            return a[field] == value;
        }).reverse()));
    }

    static assetAdd (kind, record, fcn) {
        var row = Object.assign({id: String(nextId++)}, record);
        assets[kind].push(row);
        later(fcn, row.id);
    }

    static assetRemove (kind, id, fcn) {
        assets[kind] = assets[kind].filter(function (a) {
            return a.id != id;
        });
        later(fcn, 'ok');
    }

    // Media files

    static cleanassets (ft, fcn) {
        later(fcn);
    }

    // "<documents path>,<0 when files are reachable by URL>,<recording>,<camera>"
    static getsettings (fcn) {
        later(fcn, ',1,NO,NO');
    }

    static getmedia (file, fcn) {
        later(fcn, media[file] || '');
    }

    static setmedia (str, ext, fcn) {
        var name = digest(str) + '.' + ext;
        media[name] = str;
        later(fcn, name);
    }

    static setmedianame (str, name, ext, fcn) {
        media[name + '.' + ext] = str;
        later(fcn, name + '.' + ext);
    }

    static getmd5 (str, fcn) {
        later(fcn, digest(str));
    }

    static remove (name, fcn) {
        delete media[name];
        later(fcn, 'ok');
    }

    // Copies a library file next to the child's own files, under 'name'
    static duplicateAsset (path, name, fcn) {
        fetch(path).then(function (response) {
            return response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)));
        }).then(function (data) {
            var bytes = new Uint8Array(data);
            var bin = '';
            for (var i = 0; i < bytes.length; i++) {
                bin += String.fromCharCode(bytes[i]);
            }
            media[name] = btoa(bin);
            later(fcn, name);
        }).catch(function () {
            later(fcn, 'error');
        });
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
        var source = (dir == 'Documents') ?
            Promise.resolve(media[name] ? base64ToBuffer(media[name]) : Promise.reject(new Error('missing'))) :
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
