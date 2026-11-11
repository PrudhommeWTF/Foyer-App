//////////////////////////////////////////////////
//  Offline store (Atelier, written for Foyer)
//
//  What lets a project go on without network: the last known state of each
//  project opened on this device, the media files it needed, and what could not
//  be sent yet. Everything lives in IndexedDB, on the device, per browser.
//
//  Stores:
//    projets  the project as last read or saved here; 'dirty' when the server
//             does not have this state yet. 'membre' says whose project it is.
//    medias   the content of media files, by name
//    attente  media files drawn without network, waiting to be sent, under a
//             temporary name
//    alias    temporary name -> name given by the server once sent
//    meta     small values (the member last seen on this device)
//
//  Without IndexedDB (private browsing on some browsers) every read finds
//  nothing and every write is dropped: the editor then simply needs the network.
//////////////////////////////////////////////////

const NAME = 'foyer-atelier';
const STORES = {projets: 'id', medias: 'name', attente: 'name', alias: 'temp', meta: 'k'};
let opening = null;

function open () {
    if (!opening) {
        opening = new Promise(function (resolve) {
            if (!window.indexedDB) {
                resolve(null);
                return;
            }
            var request = window.indexedDB.open(NAME, 1);
            request.onupgradeneeded = function () {
                Object.keys(STORES).forEach(function (store) {
                    request.result.createObjectStore(store, {keyPath: STORES[store]});
                });
            };
            request.onsuccess = function () {
                resolve(request.result);
            };
            request.onerror = request.onblocked = function () {
                resolve(null);
            };
        });
    }
    return opening;
}

function run (store, mode, action, fallback) {
    return open().then(function (db) {
        if (!db) {
            return fallback;
        }
        return new Promise(function (resolve) {
            var request = action(db.transaction(store, mode).objectStore(store));
            request.onsuccess = function () {
                resolve(request.result === undefined ? fallback : request.result);
            };
            request.onerror = function () {
                resolve(fallback);
            };
        });
    }).catch(function () {
        return fallback;
    });
}

export default class Offline {
    static get (store, key) {
        return run(store, 'readonly', function (s) {
            return s.get(key);
        }, null);
    }

    static all (store) {
        return run(store, 'readonly', function (s) {
            return s.getAll();
        }, []);
    }

    static put (store, value) {
        return run(store, 'readwrite', function (s) {
            return s.put(value);
        }, null);
    }

    static remove (store, key) {
        return run(store, 'readwrite', function (s) {
            return s.delete(key);
        }, null);
    }
}
