// Référentiel d'articles : ce que l'on achète, par opposition à ce qui est écrit
// dans une recette.
//
// Une recette dit « 60 g de beurre fondu », « 100 g de chocolat NESTLÉ DESSERT
// Noir » et « 3 poignées d'emmental râpé ». Une liste de courses veut du beurre,
// du chocolat et de l'emmental, rangés au bon rayon, additionnés entre recettes.
// Le référentiel fait ce pont.
//
// Deux étages, et c'est le point de conception important :
//
//   1. **Une base intégrée au code**, ci-dessous. Elle n'est pas copiée dans
//      l'état du foyer : elle s'améliore à chaque version sans migration, et
//      elle ne pèse rien dans le document JSON.
//   2. **Les articles du foyer** (`state.articles`), qui n'existent que pour ce
//      que la base ne connaît pas ou nomme mal. Ils gagnent toujours contre la
//      base : une correction faite à la main ne doit jamais être défaite par une
//      mise à jour.
//
// Le rayon d'un article est un **type** (`legumes`, `viande`, …), pas un
// identifiant de rayon : le foyer renomme et réordonne ses rayons librement,
// et un article doit continuer d'atterrir au bon endroit après un renommage.

import { Rayon } from './models';

/** Les 14 allergènes à déclaration obligatoire (règlement INCO 1169/2011). */
export const ALLERGENES = {
  gluten: 'Gluten',
  crustaces: 'Crustacés',
  oeuf: 'Œufs',
  poisson: 'Poisson',
  arachide: 'Arachides',
  soja: 'Soja',
  lait: 'Lait',
  fruitsCoque: 'Fruits à coque',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
} as const;

export type Allergene = keyof typeof ALLERGENES;

/** Ordre de parcours d'un magasin, et libellé des rayons types. */
export const RAYONS: { key: Rayon; name: string }[] = [
  { key: 'legumes', name: 'Fruits & légumes' },
  { key: 'viande', name: 'Boucherie' },
  { key: 'frais', name: 'Frais' },
  { key: 'surgele', name: 'Surgelés' },
  { key: 'boulangerie', name: 'Boulangerie' },
  { key: 'epicerie', name: 'Épicerie' },
  { key: 'boisson', name: 'Boissons' },
  { key: 'entretien', name: 'Entretien & maison' },
];

/**
 * Repli quand le foyer n'a pas de rayon du type voulu : les quatre rayons créés
 * à l'installation sont « Fruits & légumes », « Frais », « Épicerie » et
 * « À trier ». Une boucherie va donc au frais tant qu'aucun rayon boucherie
 * n'existe, plutôt qu'à trier.
 */
export const RAYON_REPLI: Record<Rayon, Rayon> = {
  legumes: 'legumes', viande: 'frais', frais: 'frais', surgele: 'frais',
  boulangerie: 'epicerie', epicerie: 'epicerie', boisson: 'epicerie', entretien: 'epicerie',
};

export interface BaseArticle {
  key: string;
  name: string;
  syn: string[];
  rayon: Rayon;
  /** Vrai pour ce qu'un foyer a en permanence : proposé, mais exclu par défaut. */
  pantry?: boolean;
  allerg?: Allergene[];
}

// Format d'une ligne : nom affiché | synonymes séparés par « ; » | rayon | options
// Options : « placard » (denrée de fond de placard), « a:gluten+lait » (allergènes).
//
// Les pluriels réguliers sont ajoutés automatiquement : inutile d'écrire
// « carottes » à côté de « carotte ». N'écrire en synonyme que ce qu'une
// recette dit vraiment et que la troncature ne retrouverait pas seule.
const TABLE = `
# Fruits & légumes
oignon|oignon rouge;oignon jaune;oignon blanc|legumes
échalote||legumes
ail|gousse d'ail;ail en poudre|legumes
carotte||legumes
navet||legumes
courgette||legumes
aubergine||legumes
potiron|potimarron;courge|legumes
chou vert|chou;choux vert;choux|legumes
chou-fleur|choux-fleur|legumes
brocoli||legumes
poireau||legumes
céleri|céleri branche;céleri rave|legumes|a:celeri
poivron|poivron rouge;poivron vert;poivron jaune|legumes
tomate|tomate grappe;tomate cerise;tomate bien mûre|legumes
concombre||legumes
salade|laitue;batavia;jeunes pousses;mâche;roquette;sucrine|legumes
endive||legumes
épinard||legumes
haricot vert||legumes
petits pois|petit pois|legumes
champignon|champignon de Paris|legumes
pomme de terre|patate|legumes
patate douce||legumes
betterave||legumes
radis||legumes
fenouil||legumes
artichaut||legumes
avocat||legumes
citron|citron jaune|legumes
citron vert|lime|legumes
orange||legumes
clémentine|mandarine|legumes
pamplemousse||legumes
pomme||legumes
poire||legumes
banane||legumes
fraise||legumes
framboise||legumes
myrtille||legumes
mûre||legumes
cerise||legumes
abricot||legumes
pêche|nectarine|legumes
prune||legumes
raisin||legumes
figue|figue fraîche|legumes
melon||legumes
pastèque||legumes
kiwi||legumes
mangue||legumes
ananas||legumes
persil|persil plat;persil frisé|legumes
coriandre||legumes
basilic||legumes
menthe||legumes
ciboulette||legumes
thym||legumes
romarin||legumes
laurier|feuille de laurier|legumes
aneth||legumes
estragon||legumes
gingembre frais|gingembre|legumes

# Boucherie
poulet|filet de poulet;blanc de poulet;escalope de poulet;cuisse de poulet;poulet entier|viande
dinde|filet de dinde;escalope de dinde|viande
boeuf|steak;bifteck;boeuf bourguignon;rôti de boeuf|viande
viande hachée|steak haché;boeuf haché|viande
veau||viande
agneau|gigot|viande
porc|rôti de porc;côte de porc;filet mignon|viande
chair à saucisse||viande
saucisse|chipolata;saucisse de Toulouse|viande
merguez|merguez végétale|viande
lardon|lardon fumé;lardon nature|viande
jambon|jambon blanc;jambon cru;tranche de jambon|viande
chorizo||viande
canard|magret de canard|viande
poisson|filet de poisson|viande|a:poisson
saumon|pavé de saumon;saumon fumé|viande|a:poisson
cabillaud|dos de cabillaud|viande|a:poisson
crevette|gambas|viande|a:crustaces
moule||viande|a:mollusques

# Frais
lait|lait entier;lait demi-écrémé;lait écrémé|frais|a:lait
crème fraîche|crème épaisse;crème fraîche épaisse|frais|a:lait
crème liquide|crème entière;crème liquide entière|frais|a:lait
beurre|beurre doux;beurre demi-sel;beurre tendre;beurre mou|frais|a:lait
oeuf|œuf;jaune d'oeuf;jaune d'œuf;blanc d'oeuf;blanc d'œuf;oeuf entier|frais|a:oeuf
yaourt|yaourt nature;yaourt grec|frais|a:lait
fromage blanc|faisselle|frais|a:lait
gruyère|gruyère râpé|frais|a:lait
emmental|emmental râpé;fromage râpé|frais|a:lait
parmesan|parmesan râpé|frais|a:lait
mozzarella|burrata|frais|a:lait
cheddar||frais|a:lait
comté|beaufort;gruyère de comté|frais|a:lait
chèvre|bûche de chèvre;fromage de chèvre|frais|a:lait
feta||frais|a:lait
ricotta||frais|a:lait
mascarpone||frais|a:lait
raclette|fromage à raclette|frais|a:lait
toastinette|fromage en tranche;fromage pour croque|frais|a:lait
pâte brisée|pâte sablée|frais|a:gluten+lait
pâte feuilletée||frais|a:gluten+lait
pâte à pizza||frais|a:gluten
tortilla|galette de blé;wrap;grande galette|frais|a:gluten
lait de soja|yaourt au soja;boisson au soja|frais|a:soja
tofu|émincé végétal;émincé 100% végétal|frais|a:soja

# Boulangerie
pain|baguette;pain de campagne|boulangerie|a:gluten
pain de mie||boulangerie|a:gluten+lait
pain pour hamburger|pain à burger;pain burger;buns|boulangerie|a:gluten
brioche||boulangerie|a:gluten+lait+oeuf
biscotte||boulangerie|a:gluten

# Surgelés
glace|crème glacée;sorbet|surgele|a:lait
légumes surgelés|poêlée de légumes|surgele
frites||surgele

# Épicerie
farine|farine de blé;farine complète;farine T55;farine T45|epicerie|a:gluten
sucre|sucre en poudre;sucre semoule;sucre blanc|epicerie
sucre roux|cassonade;vergeoise;sucre de canne|epicerie
sucre glace||epicerie
sucre vanillé|sucre vanilliné|epicerie
levure chimique|levure|epicerie
levure de boulanger||epicerie
bicarbonate|bicarbonate de soude|epicerie
maïzena|fécule de maïs;fécule|epicerie
sel|gros sel;fleur de sel;sel fin|epicerie|placard
poivre|poivre du moulin;poivre noir|epicerie|placard
huile|huile de tournesol;huile neutre;huile de colza|epicerie|placard
huile d'olive||epicerie|placard
vinaigre|vinaigre balsamique;vinaigre de vin;vinaigre de cidre|epicerie|placard
moutarde|moutarde de Dijon;moutarde à l'ancienne|epicerie|placard|a:moutarde
mayonnaise||epicerie|a:oeuf+moutarde
ketchup||epicerie|placard
sauce soja|sauce de soja|epicerie|placard|a:soja+gluten
riz|riz basmati;riz long;riz rond;riz arborio|epicerie
pâtes|spaghetti;penne;tagliatelle;macaroni;coquillette|epicerie|a:gluten
couscous|semoule;semoule de couscous;couscous de blé;couscous de blé dur|epicerie|a:gluten
lentille||epicerie
pois chiche||epicerie
haricot rouge||epicerie
maïs|maïs en conserve;maïs doux|epicerie
thon|thon au naturel;thon en boîte|epicerie|a:poisson
sardine||epicerie|a:poisson
coulis de tomate|purée de tomate;sauce tomate;passata|epicerie
concentré de tomate||epicerie
tomate pelée|tomate concassée|epicerie
bouillon|bouillon de volaille;bouillon de légumes;cube de bouillon|epicerie|a:celeri
lait de coco|crème de coco|epicerie
chocolat|chocolat noir;chocolat pâtissier;chocolat dessert;chocolat NESTLÉ DESSERT|epicerie|a:lait+soja
chocolat blanc||epicerie|a:lait+soja
chocolat au lait||epicerie|a:lait+soja
pépites de chocolat||epicerie|a:lait+soja
cacao|cacao en poudre;chocolat en poudre|epicerie
poudre d'amandes|amande en poudre;poudre d'amande|epicerie|a:fruitsCoque
poudre de noisette|noisette en poudre|epicerie|a:fruitsCoque
amande|amande effilée|epicerie|a:fruitsCoque
noisette||epicerie|a:fruitsCoque
noix||epicerie|a:fruitsCoque
noix de cajou||epicerie|a:fruitsCoque
pistache|pâte de pistache|epicerie|a:fruitsCoque
cacahuète|arachide|epicerie|a:arachide
raisin sec||epicerie
miel||epicerie
confiture|confiture d'abricot;confiture de fraise;gelée|epicerie
pâte à tartiner||epicerie|a:lait+fruitsCoque+soja
compote||epicerie
eau de fleur d'oranger||epicerie|placard
extrait de vanille|vanille;gousse de vanille;sucre vanille|epicerie|placard
cannelle||epicerie|placard
muscade|noix de muscade|epicerie|placard
cumin||epicerie|placard
paprika|paprika fumé|epicerie|placard
curry||epicerie|placard
curcuma||epicerie|placard
gingembre en poudre||epicerie|placard
piment|piment d'Espelette;piment de Cayenne;harissa|epicerie|placard
herbes de Provence|herbe de Provence|epicerie|placard
condiment|condiments;assaisonnement|epicerie|placard
quatre-épices|ras el hanout;épices|epicerie|placard
chapelure||epicerie|a:gluten
olive|olive noire;olive verte|epicerie
cornichon||epicerie
câpre||epicerie
biscuit|petit-beurre;spéculoos;sablé|epicerie|a:gluten+lait
flocon d'avoine|avoine|epicerie|a:gluten
café||epicerie|placard
thé|infusion|epicerie|placard

# Boissons
eau|eau du robinet;eau plate|boisson|placard
vin blanc||boisson|a:sulfites
vin rouge||boisson|a:sulfites
bière||boisson|a:gluten
jus de fruit|jus d'orange;jus de pomme|boisson
`;

const norm = (s: string): string =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘]/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Pluriels réguliers du français, pour ne pas écrire deux fois chaque entrée. */
const plural = (s: string): string[] => {
  const out = new Set<string>();
  const w = s.split(' ');
  const last = w[w.length - 1];
  if (/[sxz]$/.test(last)) return [];
  const p = /(eau|eu)$/.test(last) ? last + 'x' : /al$/.test(last) ? last.slice(0, -2) + 'aux' : last + 's';
  out.add([...w.slice(0, -1), p].join(' '));
  // « pommes de terre », « blancs d'oeuf » : le pluriel porte sur le premier mot.
  if (w.length > 1 && /^(de|du|des|d'|a|au|aux|en|pour)\b/.test(w[1])) {
    const f = w[0];
    if (!/[sxz]$/.test(f)) out.add([/(eau|eu)$/.test(f) ? f + 'x' : f + 's', ...w.slice(1)].join(' '));
  }
  return [...out];
};

export const BASE_ARTICLES: BaseArticle[] = TABLE.split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((line) => {
    const [name, syn, rayon, ...flags] = line.split('|');
    const a: BaseArticle = {
      key: norm(name).replace(/ /g, '-'),
      name: name.trim(),
      syn: (syn || '').split(';').map((s) => s.trim()).filter(Boolean),
      rayon: (rayon || 'epicerie').trim() as Rayon,
    };
    for (const f of flags) {
      if (f.trim() === 'placard') a.pantry = true;
      if (f.startsWith('a:')) a.allerg = f.slice(2).split('+').map((x) => x.trim()) as Allergene[];
    }
    return a;
  });

/** Index de recherche : toutes les formes connues d'un article pointent sur sa clé. */
export const BASE_INDEX: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const put = (form: string, key: string): void => { const n = norm(form); if (n && !m.has(n)) m.set(n, key); };
  for (const a of BASE_ARTICLES) {
    for (const form of [a.name, ...a.syn]) {
      put(form, a.key);
      for (const p of plural(norm(form))) put(p, a.key);
    }
  }
  return m;
})();

export const BASE_BY_KEY: Map<string, BaseArticle> = new Map(BASE_ARTICLES.map((a) => [a.key, a]));

export { norm as normaliseName };
