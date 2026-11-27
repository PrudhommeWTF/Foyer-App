// Atelier (Foyer): the storage of the editor, in place of the one that talks to
// the Scratch servers (lib/legacy-storage.ts). Projects and their files live in
// Foyer (/api/atelier), under the session of whoever is logged in; no address
// outside Foyer appears here, and none may.
//
// What it guarantees:
//   - a save never overwrites the work of another device: the server refuses a
//     stale version, and the child is asked which one to keep;
//   - without network nothing is lost: the project and its new files are kept
//     on the device (local.js) and sent when the network is back.
import {ScratchStorage} from '@scratch/scratch-storage';
import defaultProject from '../lib/default-project';
import sprites from '../lib/libraries/sprites.json';
import backdrops from '../lib/libraries/backdrops.json';
import sounds from '../lib/libraries/sounds.json';
import local from './local';

// The page is served at <foyer>/atelier/grands/. The addresses are made absolute
// here: the editor fetches files from a worker, which would resolve a relative
// address against its own script, not against the page.
const FOYER = new URL('../../', document.baseURI).href;
const API = `${FOYER}api/atelier`;
const LIBRARY = new URL('bibliotheque/', document.baseURI).href;
const RETRY_MS = 15000;

// The files of the library shipped with the page (bibliotheque/), by name: everything
// else a project names belongs to its owner and is read from the Foyer API
const LIBRARY_FILES = new Set();
[...sprites, ...backdrops, ...sounds].forEach(entry => [entry, ...(entry.costumes || []), ...(entry.sounds || [])].forEach(
    file => file.md5ext && LIBRARY_FILES.add(file.md5ext)
));

/** A request that reached the server and was refused, with what it said. */
class Refused extends Error {
    constructor (status, body) {
        super((body && body.error) || `Erreur ${status}`);
        this.status = status;
        this.body = body || {};
    }
}

/** Calls the Atelier API. Rejects with Refused, or with the network error. */
const call = (method, path, body, raw) => {
    const options = {method, credentials: 'same-origin', headers: {}};
    if (raw) {
        options.headers['Content-Type'] = 'application/octet-stream';
        options.body = raw;
    } else if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(response => {
        if (response.status === 401) {
            // The session is over: back to Foyer, which asks to log in
            window.onbeforeunload = null;
            window.location.href = FOYER;
            return new Promise(() => {});
        }
        return response.json().catch(() => ({})).then(json => {
            if (!response.ok) throw new Refused(response.status, json);
            return json;
        });
    });
};

/** The storage the editor reads from: projects and files of Foyer first. */
class Magasin extends ScratchStorage {
    constructor (foyer) {
        super();
        this.foyer = foyer;
    }

    load (assetType, assetId, dataFormat) {
        if (assetType === this.AssetType.Project) {
            const json = assetId === '0' ? null : this.foyer.projet && this.foyer.projet.json;
            // A project never saved yet opens on the default one
            if (!json) return super.load(assetType, '0', dataFormat);
            return Promise.resolve(this.createAsset(assetType, dataFormat, new TextEncoder().encode(json), assetId, false));
        }
        const name = `${assetId}.${dataFormat}`;
        return super.load(assetType, assetId, dataFormat)
            .catch(() => null)
            .then(asset => {
                if (asset) {
                    // Kept on the device, to open the project again without network. Not the
                    // library: the service worker of Foyer keeps each of its files once fetched.
                    if (!this.builtinHelper.get(assetId) && !this.foyer.library.has(name)) {
                        local.put('medias', {name, data: asset.data, attente: false});
                    }
                    return asset;
                }
                return local.get('medias', name).then(kept => (
                    kept ? this.createAsset(assetType, dataFormat, new Uint8Array(kept.data), assetId, false) : null
                ));
            });
    }

    // Called for each file drawn, recorded or imported since the last save
    store (assetType, dataFormat, data, assetId) {
        return this.foyer.sendFile(`${assetId}.${dataFormat}`, data).then(() => ({status: 'ok', id: assetId}));
    }
}

export class FoyerStorage {
    constructor () {
        this.scratchStorage = new Magasin(this);
        // The project being edited: {id, rev, name, json, owner}
        this.projet = null;
        // Whether whoever is logged in may change this project
        this.canSave = false;
        this.pending = Promise.resolve();
        // Whether a save of the editor failed for lack of network and was not made up for yet
        this.unsent = false;
        this.told = new Set();
        this.cacheDefaultProject();
        const {AssetType} = this.scratchStorage;
        this.scratchStorage.addWebStore(
            [AssetType.ImageVector, AssetType.ImageBitmap, AssetType.Sound],
            asset => this.fileUrl(`${asset.assetId}.${asset.dataFormat}`)
        );
    }

    // The default project is rebuilt when the language is known: its names are translated
    setTranslatorFunction (translator) {
        this.translator = translator;
        this.cacheDefaultProject();
    }

    cacheDefaultProject () {
        const storage = this.scratchStorage;
        this.library = new Set(LIBRARY_FILES);
        defaultProject(this.translator).forEach(asset => {
            this.library.add(`${asset.id}.${storage.DataFormat[asset.dataFormat]}`);
            storage.builtinHelper._store(
                storage.AssetType[asset.assetType],
                storage.DataFormat[asset.dataFormat],
                asset.data,
                asset.id
            );
        });
    }

    getLibraryAssetUrl (assetId, dataFormat) {
        return `${LIBRARY}${assetId}.${dataFormat}`;
    }

    /** Where a file is read: the library shipped with the page, or the files of the owner of the project. */
    fileUrl (name) {
        if (this.library.has(name)) return LIBRARY + name;
        const whose = this.projet && !this.canSave ? `?membre=${encodeURIComponent(this.projet.owner)}` : '';
        return `${API}/medias/${name}${whose}`;
    }

    /**
     * Reads the project before the editor starts. Resolves with the project, or
     * rejects with a sentence for whoever is in front of the screen.
     */
    open (id) {
        const fromServer = Promise.all([call('GET', `/projets/${id}`), call('GET', '/contexte')]);
        return Promise.all([fromServer.then(r => r, e => e), local.get('projets', id)]).then(([answer, kept]) => {
            if (answer instanceof Refused) {
                throw new Error(answer.status === 404 || answer.status === 410 ?
                    'Ce projet n’existe plus.' : answer.message);
            }
            if (answer instanceof Error) {
                // No network: the copy of this device, if there is one
                if (!kept) throw new Error('Pas de réseau, et ce projet n’a jamais été ouvert sur cet appareil.');
                this.projet = {id, rev: kept.rev, name: kept.name, json: kept.json, owner: kept.owner};
                this.canSave = true;
                this.retryLater();
                return this.projet;
            }
            const [{projet: p}, contexte] = answer;
            if (p.level !== 'grands') throw new Error('Ce projet s’ouvre avec l’autre atelier.');
            this.projet = {id, rev: p.rev, name: p.name, json: p.json, owner: p.memberId};
            // The thumbnail the next one will replace
            this.thumbnail = p.thumbnail && p.thumbnail.md5;
            this.canSave = p.memberId === contexte.membre.id && !p.archivedAt;
            // Whether the household lets the Atelier record sounds (read by containers/sound-tab.jsx)
            this.micro = contexte.micro !== false;
            // And the camera, for the video sensing extension (read by containers/extension-library.jsx)
            this.camera = contexte.camera !== false;
            if (this.canSave && kept && kept.attente) {
                // Work done here without network. If another device saved meanwhile, one of the two has to go.
                const mine = kept.rev === p.rev || window.confirm(
                    'Ce projet a été modifié sur un autre appareil pendant que celui-ci n’avait pas de réseau.\n\n' +
                    'OK : garder la version de cet appareil.\nAnnuler : prendre celle de l’autre appareil.'
                );
                if (mine) {
                    this.projet.json = kept.json;
                    this.projet.name = kept.name;
                    this.resend();
                } else local.put('projets', {...this.projet, attente: false});
            } else if (this.canSave) local.put('projets', {...this.projet, attente: false});
            if (this.canSave) {
                // Read by the Atelier screen of Foyer when the list of projects cannot load
                try {
                    localStorage.setItem('foyer.atelier.dernier', JSON.stringify({membre: p.memberId, id, name: p.name, level: 'grands'}));
                } catch (e) { /* no localStorage: the screen simply has nothing to offer offline */ }
            }
            return this.projet;
        });
    }

    /** Sends one file. Without network it is kept on the device and counted as sent: sendPending() takes over. */
    sendFile (name, data) {
        return call('POST', '/medias?nom=recu', null, data).then(answer => {
            // The server names the file from what it received: a different name means a different file
            if (answer.name !== name) throw new Error(`Atelier : fichier ${name} reçu sous un autre nom.`);
            local.put('medias', {name, data, attente: false});
        }, err => {
            if (err instanceof Refused) {
                this.tell(err.message);
                throw err;
            }
            return local.put('medias', {name, data, attente: true});
        });
    }

    /** Sends the files kept while there was no network. Rejects while one cannot go. */
    sendPending () {
        return local.all('medias').then(all => all.filter(m => m.attente).reduce(
            (chain, m) => chain.then(() => call('POST', '/medias?nom=recu', null, m.data))
                .then(() => local.put('medias', {...m, attente: false})),
            Promise.resolve()
        ));
    }

    /** Sends one state of the project. A stale version is settled with the child, never silently. */
    put (name, json) {
        const {id} = this.projet;
        return call('PUT', `/projets/${id}`, {rev: this.projet.rev, name, json}).catch(err => {
            if (!(err instanceof Refused) || err.status !== 409 || err.body.code !== 'conflit') throw err;
            const mine = window.confirm(
                'Ce projet a été modifié sur un autre appareil.\n\n' +
                'OK : garder ce que tu vois ici.\nAnnuler : prendre la version de l’autre appareil.'
            );
            if (!mine) {
                return local.remove('projets', id).then(() => {
                    window.onbeforeunload = null;
                    window.location.reload();
                    return new Promise(() => {});
                });
            }
            this.projet.rev = err.body.projet.rev;
            return call('PUT', `/projets/${id}`, {rev: this.projet.rev, name, json});
        }).then(answer => {
            this.unsent = false;
            this.projet.rev = answer.projet.rev;
            this.projet.json = json;
            return local.put('projets', {...this.projet, name, attente: false});
        });
    }

    // Called by the editor: every 30 seconds while the project changes, and from its menu
    saveProject (projectId, vmState) {
        const json = typeof vmState === 'string' ? vmState : JSON.stringify(vmState);
        const name = this.projet.name;
        this.pending = this.pending.catch(() => {}).then(() => this.sendPending().then(() => this.put(name, json))
            .catch(err => {
                if (err instanceof Refused) {
                    this.tell(err.message);
                    throw err;
                }
                // No network: the work stays on the device until it can go
                this.unsent = true;
                this.retryLater();
                return local.put('projets', {...this.projet, name, json, attente: true}).then(() => {
                    throw err;
                });
            }));
        return this.pending.then(() => ({id: projectId}));
    }

    /** Keeps the current state on the device at once: the page may be closed before the network answers. */
    keep (vm) {
        if (!this.canSave) return;
        vm.assets.filter(asset => !asset.clean).forEach(
            asset => local.put('medias', {name: `${asset.assetId}.${asset.dataFormat}`, data: asset.data, attente: true})
        );
        local.put('projets', {...this.projet, json: vm.toJSON(), attente: true});
    }

    /** Sends what this device kept and the server does not have, outside of the editor's own save. */
    resend () {
        this.pending = this.pending.catch(() => {}).then(() => local.get('projets', this.projet.id)).then(kept => {
            if (!kept || !kept.attente) return null;
            return this.sendPending().then(() => this.put(kept.name, kept.json));
        }).catch(err => {
            if (!(err instanceof Refused)) this.retryLater();
        });
        return this.pending;
    }

    /** While something waits on the device, try again regularly: the 'online' event alone is not reliable. */
    retryLater () {
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.onRetry) this.onRetry();
        }, RETRY_MS);
    }

    saveThumbnail (blob) {
        const old = this.thumbnail;
        return call('POST', '/medias', null, blob)
            .then(({name}) => call('PATCH', `/projets/${this.projet.id}`, {thumbnail: JSON.stringify({pagecount: 1, md5: name})})
                .then(() => {
                    this.thumbnail = name;
                    // The server only removes what nothing refers to any more
                    if (old && old !== name) return call('DELETE', `/medias/${old}`);
                    return null;
                }))
            .catch(() => { /* a thumbnail is a comfort: the next save sends another */ });
    }

    rename (name) {
        this.projet.name = name;
        // Without network the name travels with the next save
        return call('PATCH', `/projets/${this.projet.id}`, {name}).catch(() => {});
    }

    /** Says once why the server refused (no room left, file too big): the editor only knows that saving failed. */
    tell (message) {
        if (this.told.has(message)) return;
        this.told.add(message);
        window.alert(message);
    }
}
