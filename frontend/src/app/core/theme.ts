// Calcul du thème effectif à appliquer, et les couleurs de la barre d'état.
//
// Le choix de thème est une préférence d'appareil (localStorage), à trois
// valeurs : « clair », « sombre », ou « systeme » (suivre le réglage clair/sombre
// de l'appareil, qui peut changer en cours de journée). Cette fonction est pure :
// elle prend le choix et l'état du média, et dit s'il faut le thème sombre. Le
// store l'appelle pour poser la classe `dark` et la couleur de la barre d'état,
// et le petit script de index.html la refait à la main avant le démarrage
// d'Angular pour éviter le flash du mauvais thème.

export type ThemeChoice = 'systeme' | 'clair' | 'sombre';

/** Les couleurs de `<meta name="theme-color">` (barre d'état iPhone, chrome PWA). */
export const THEME_COLOR_LIGHT = '#E56B4E';
export const THEME_COLOR_DARK = '#15191E';

/**
 * Faut-il le thème sombre ? « sombre » toujours, « clair » jamais, « systeme »
 * selon le média de l'appareil (`prefers-color-scheme: dark`). Une valeur
 * inconnue est traitée comme « systeme », pour ne jamais figer l'affichage.
 */
export function effectiveDark(choice: string, prefersDark: boolean): boolean {
  if (choice === 'sombre') return true;
  if (choice === 'clair') return false;
  return prefersDark; // « systeme » et tout le reste
}
