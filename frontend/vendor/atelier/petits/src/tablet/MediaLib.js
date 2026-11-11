import IO from './IO';
import Localization from '../utils/Localization';

let path;
let samples;
let backgrounds;
let sprites;
let legacySprites;
let sounds;
let keys = {};
let version = 0;

export default class MediaLib {
    static get path () {
        return path;
    }

    static get samples () {
        return samples;
    }

    static get sprites () {
        return sprites;
    }

    static get backgrounds () {
        return backgrounds;
    }

    static get sounds () {
        return sounds;
    }

    static get keys () {
        return keys;
    }

    static get version () {
        return version;
    }

    static loadMediaLib (root, whenDone) {
        IO.requestFromServer(root + 'media.json', (result) => {
            let parsedResult = JSON.parse(result);
            path = parsedResult.path;
            samples = parsedResult.samples;
            sprites = parsedResult.sprites;
            legacySprites = parsedResult.legacySprites || [];
            backgrounds = parsedResult.backgrounds;
            sounds = parsedResult.sounds;

            if (parsedResult.assetLibraryVersion) {
                version = parsedResult.assetLibraryVersion;
            }

            MediaLib.localizeMediaNames();
            MediaLib.loadFamilyLibrary(function () {
                MediaLib.generateKeys();
                whenDone();
            });
        });
    }

    // Atelier: the drawings a family has added on its own server (served by the
    // Foyer API, not shipped with the editor) come first in the library. Without
    // network, or with nothing added, the shipped library stands alone.
    static loadFamilyLibrary (whenDone) {
        var dir = '../../api/atelier/bibliotheque/fichiers/';
        fetch('../../api/atelier/bibliotheque', {credentials: 'same-origin'}).then(function (response) {
            return response.ok ? response.json() : {};
        }).then(function (json) {
            var mark = function (entry) {
                entry.dir = dir;
                return entry;
            };
            sprites = (json.sprites || []).map(mark).concat(sprites);
            backgrounds = (json.backgrounds || []).map(mark).concat(backgrounds);
            whenDone();
        }).catch(function () {
            whenDone();
        });
    }

    // Atelier: where a library file is served. The original had a single folder.
    static url (md5) {
        return ((keys[md5] && keys[md5].dir) || path) + md5;
    }

    // Atelier: the library catalogue already carries French names. A name is only
    // looked up in the messages when the entry has a key there (the few elements
    // that came with the editor); otherwise the catalogue name is kept.
    static localizeMediaNames () {
        var named = function (prefix, entry) {
            var key = prefix + entry.md5;
            var found = Localization.localizeOptional(key);
            return (found == key) ? entry.name : found;
        };
        // Localize names of sprites
        for (let i = 0; i < sprites.length; i++) {
            sprites[i].name = named('CHARACTER_', sprites[i]);
        }

        // Localize names of backgrounds
        for (let i = 0; i < backgrounds.length; i++) {
            backgrounds[i].name = named('BACKGROUND_', backgrounds[i]);
        }

        // Localize names of legacy sprites
        for (let i = 0; i < legacySprites.length; i++) {
            legacySprites[i].name = Localization.localize('CHARACTER_' + legacySprites[i].md5);
        }
    }

    static generateKeys () {
        for (let i = 0; i < backgrounds.length; i++) {
            var bg = backgrounds[i];
            keys[bg.md5] = {width: bg.width, height: bg.height, name: bg.name, dir: bg.dir};
        }

        for (let i = 0; i < sprites.length; i++) {
            var spr = sprites[i];
            keys[spr.md5] = {width: spr.width, height: spr.height, name: spr.name, dir: spr.dir};
        }

        // when we change sprites (or remove them) the old ones still need to be in keys
        // for projects that were created before the change
        for (let i = 0; i < legacySprites.length; i++) {
            var legacySpr = legacySprites[i];
            keys[legacySpr.md5] = {width: legacySpr.width, height: legacySpr.height, name: legacySpr.name};
        }
    }
}
