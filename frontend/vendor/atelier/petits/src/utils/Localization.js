import IO from '../tablet/IO';

// Atelier: Foyer is in French only. The original picked one of 22 languages from
// a cookie or from the browser, and formatted messages with intl-messageformat;
// the messages only use simple {NAME} placeholders, replaced by format() below.
const LOCALE = 'fr';

function format (message, values) {
    return message.replace(/\{(\w+)\}/g, function (all, key) {
        return (values && key in values) ? values[key] : all;
    });
}

let currentLocale;
let localizationMessages = {};

// Configuration
const sampleKeyPrefix = 'key_';

export default class Localization {
    static get currentLocale () {
        return currentLocale;
    }

    // Load the messages. Call this when the app is initialized
    static includeLocales (localizationRoot, whenDone) {
        currentLocale = LOCALE;
        IO.requestFromServer(localizationRoot + 'localizations/' + LOCALE + '.json', (result) => {
            localizationMessages = JSON.parse(result);
            whenDone();
        });
    }

    // Translate a particular message given the message key and info
    static localize (key, formatting) {
        if (key in localizationMessages) {
            return format(localizationMessages[key], formatting);
        }
        return 'String missing: ' + key;
    }

    static localizeSampleName (key) {
        var name = Localization.localizeOptional('SAMPLE_' + key);
        // If the localized name is still started with 'SAMPLE_',
        // it is not a preset name.
        if (name.startsWith('SAMPLE_')) {
            return key;
        }
        return name;
    }

    // Translate a particular message given the message key and info;
    // if key not found, assume it's just a raw text string without a translation,
    // and return that
    static localizeOptional (keyOrRawText, formatting) {
        if (keyOrRawText in localizationMessages) {
            return format(localizationMessages[keyOrRawText], formatting);
        }
        return keyOrRawText;
    }

    // For sample projects, some fields (sprite names, text on stage, and text in say blocks)
    // may have a special prefix to indicate that it should be replaced with a localized value.
    // E.g., we might have some text on the stage that says "Touch me" in English. This gets translated.
    static isSampleLocalizedKey (str) {
        return str.slice(0, sampleKeyPrefix.length) == sampleKeyPrefix;
    }
}
