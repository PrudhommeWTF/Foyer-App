// Atelier (Foyer): replaces the loader of the tutorial pictures, which imported
// one bundle of images per language. The challenges of the Atelier (index.jsx)
// are in French only and carry their own picture: it is used as it is.
const loadImageData = () => Promise.resolve();
const translateImage = image => image;
const translateVideo = id => id;

export {
    loadImageData,
    translateImage,
    translateVideo
};
