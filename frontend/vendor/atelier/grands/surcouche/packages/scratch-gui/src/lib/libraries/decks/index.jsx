// Atelier (Foyer): replaces the tutorial decks of the editor. The originals are
// 1 481 pictures and videos showing the Scratch mascots and site, two of them
// with tracking pixels; none is kept.
//
// In their place: the guided challenges of the Atelier, written for Foyer
// (foyer/defis.json), in text, with Boulon. A step names its blocks between
// brackets, '[mouvement:avancer de 10 pas]', shown in the colour of their family.
import React from 'react';
import defis from '../../../foyer/defis.json';
import boulon from '../../../foyer/boulon.svg';

// The library component still reads these category names to lay out any library
// with categories: they stay.
export const CATEGORIES = {
    gettingStarted: 'gettingStarted',
    basics: 'basics',
    intermediate: 'intermediate',
    prompts: 'prompts'
};

// The colours of the block families, as the palette of the editor shows them
const FAMILIES = {
    mouvement: ['#4C97FF', '#FFFFFF'],
    apparence: ['#9966FF', '#FFFFFF'],
    son: ['#CF63CF', '#FFFFFF'],
    evenements: ['#FFBF00', '#3A2F00'],
    controle: ['#FFAB19', '#3A2A00'],
    capteurs: ['#5CB1D6', '#FFFFFF'],
    operateurs: ['#59C059', '#FFFFFF'],
    variables: ['#FF8C1A', '#FFFFFF']
};

const blockStyle = family => ({
    display: 'inline-block',
    padding: '1px 8px',
    margin: '1px 0',
    borderRadius: '6px',
    fontWeight: 'bold',
    background: (FAMILIES[family] || FAMILIES.mouvement)[0],
    color: (FAMILIES[family] || FAMILIES.mouvement)[1]
});

// 'Prends [mouvement:avancer de 10 pas].' -> text, with the block as a coloured label
const stepTitle = text => text.split(/(\[[a-z]+:[^\]]+\])/).map((part, i) => {
    const block = /^\[([a-z]+):([^\]]+)\]$/.exec(part);
    return block ? (
        <span
            key={i}
            style={blockStyle(block[1])}
        >
            {block[2]}
        </span>
    ) : part;
});

const decks = {};
defis.forEach(defi => {
    decks[defi.id] = {
        name: defi.name,
        tags: [],
        category: CATEGORIES.gettingStarted,
        img: boulon,
        // Boulon shows the way on the first step; the others are text alone
        steps: defi.steps.map((text, i) => ({title: stepTitle(text), image: i === 0 ? boulon : null}))
    };
});

export default decks;
