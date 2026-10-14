// La recette, telle qu'elle se déclare à la fiche d'élément. Sa suppression se
// confirme : c'est une perte lourde (ingrédients, étapes, photo), sans retour.
import type { FoyerStore } from '../../core/foyer.store';
import { ITEM_KINDS, ItemKind } from '../../core/items';
import { Recipe } from '../../core/models';
import { RecipeView } from './recipe-view';
import { RecipeForm } from './recipe-form';

export const RECIPE_ITEM: ItemKind<Recipe, FoyerStore> = {
  meta: ITEM_KINDS.recipe,
  load: (s, id) => s.data()?.recipes.find((r) => r.id === id) ?? null,
  title: (r) => r.name,
  view: RecipeView,
  form: RecipeForm,
  remove: (s, r, _ctx, scope) => {
    if (!scope) {
      return { kind: 'ask', question: 'Supprimer « ' + r.name + ' » du carnet ? C’est définitif.', choices: [{ scope: 'all', label: 'Supprimer', danger: true }] };
    }
    s.deleteRecipe(r.id);
    return { kind: 'done' };
  },
  actions: (s, r) => [{ label: 'Copier', icon: 'copy', run: () => s.copyRecipeText(r) }],
  openIn: (s) => s.go('recettes'),
  fingerprint: (r) => JSON.stringify(r),
};
