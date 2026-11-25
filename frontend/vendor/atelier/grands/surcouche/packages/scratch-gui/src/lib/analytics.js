// Atelier (Foyer): replaces the analytics module of the editor, which queued
// usage events for Google Tag Manager. The Atelier reports nothing to anyone:
// the events are dropped here, and no tag manager is ever loaded.
const analytics = {
    event: () => {}
};

export default analytics;
