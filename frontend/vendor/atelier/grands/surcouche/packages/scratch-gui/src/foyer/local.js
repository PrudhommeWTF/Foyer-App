// Atelier (Foyer): what lets a project go on without network, on this device.
// Everything lives in IndexedDB, per browser.
//
//   projets  the project as last read or saved here; 'attente' when the server
//            does not have this state yet
//   medias   the content of the files of the projects, by name; 'attente' when
//            the file could not be sent yet
//
// Without IndexedDB (private browsing on some browsers) every read finds nothing
// and every write is dropped: the editor then simply needs the network.
const NAME = 'foyer-atelier-grands';
const STORES = {projets: 'id', medias: 'name'};
let opening = null;

const open = () => {
    if (!opening) {
        opening = new Promise(resolve => {
            if (!window.indexedDB) {
                resolve(null);
                return;
            }
            const request = window.indexedDB.open(NAME, 1);
            request.onupgradeneeded = () => Object.keys(STORES).forEach(
                store => request.result.createObjectStore(store, {keyPath: STORES[store]})
            );
            request.onsuccess = () => resolve(request.result);
            request.onerror = request.onblocked = () => resolve(null);
        });
    }
    return opening;
};

const run = (store, mode, action, fallback) => open().then(db => {
    if (!db) return fallback;
    return new Promise(resolve => {
        const request = action(db.transaction(store, mode).objectStore(store));
        request.onsuccess = () => resolve(typeof request.result === 'undefined' ? fallback : request.result);
        request.onerror = () => resolve(fallback);
    });
}).catch(() => fallback);

export default {
    get: (store, key) => run(store, 'readonly', s => s.get(key), null),
    all: store => run(store, 'readonly', s => s.getAll(), []),
    put: (store, value) => run(store, 'readwrite', s => s.put(value), null),
    remove: (store, key) => run(store, 'readwrite', s => s.delete(key), null)
};
