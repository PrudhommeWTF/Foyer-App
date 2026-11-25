// Atelier (Foyer): the storage of the editor, in place of the one that talks to
// the Scratch servers (lib/legacy-storage.ts).
//
// This first version keeps the project IN MEMORY: nothing is saved, nothing
// survives a reload. The library is the few files shipped next to the page
// (bibliotheque/), fetched from Foyer itself. No address outside Foyer appears
// here, and none may: projects and media move to the Foyer API in the next step,
// behind this same class.
import {ScratchStorage} from '@scratch/scratch-storage';
import defaultProject from '../lib/default-project';

const LIBRARY = 'bibliotheque/';

export class FoyerStorage {
    constructor () {
        this.scratchStorage = new ScratchStorage();
        this.cacheDefaultProject();
        const {AssetType} = this.scratchStorage;
        this.scratchStorage.addWebStore(
            [AssetType.ImageVector, AssetType.ImageBitmap, AssetType.Sound],
            asset => `${LIBRARY}${asset.assetId}.${asset.dataFormat}`
        );
    }

    // The default project is rebuilt when the language is known: its names are translated
    setTranslatorFunction (translator) {
        this.translator = translator;
        this.cacheDefaultProject();
    }

    getLibraryAssetUrl (assetId, dataFormat) {
        return `${LIBRARY}${assetId}.${dataFormat}`;
    }

    // Never called: the editor is told it cannot save (canSave: false in index.jsx)
    saveProject () {
        return Promise.reject(new Error('Atelier : enregistrement indisponible dans cette version.'));
    }

    cacheDefaultProject () {
        const storage = this.scratchStorage;
        defaultProject(this.translator).forEach(asset => storage.builtinHelper._store(
            storage.AssetType[asset.assetType],
            storage.DataFormat[asset.dataFormat],
            asset.data,
            asset.id
        ));
    }
}
