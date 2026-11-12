// Atelier (Foyer): replaces the loader of the tutorial pictures, which imported
// one bundle of images per language. There is no tutorial deck any more (see
// index.jsx), so there is nothing to load or translate.
const loadImageData = () => Promise.resolve();
const translateImage = () => {};
const translateVideo = id => id;

export {
    loadImageData,
    translateImage,
    translateVideo
};
