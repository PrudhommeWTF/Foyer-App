import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { ModalComponent } from '../../shared/modal';

/** One block of the 'Petits codeurs' level: its picture in the editor, and what it does. */
interface Bloc { icon: string; text: string; }
interface Famille { name: string; color: string; blocs: Bloc[]; }

/**
 * The blocks of the 'Petits codeurs' level, in the order of the editor. Their
 * pictures are the ones the editor shows (served with it, next to the page).
 */
const FAMILLES: Famille[] = [
  { name: 'Pour démarrer', color: '#F7CC3B', blocs: [
    { icon: 'greenFlag', text: 'Démarre quand on touche le drapeau vert.' },
    { icon: 'OnTouch', text: 'Démarre quand on touche le personnage.' },
    { icon: 'Bump', text: 'Démarre quand un autre personnage le touche.' },
    { icon: 'LetterGet_Orange', text: 'Démarre quand il reçoit un message de cette couleur.' },
    { icon: 'LetterSend_Orange', text: 'Envoie un message de cette couleur aux autres personnages.' },
  ] },
  { name: 'Pour bouger', color: '#4A90D9', blocs: [
    { icon: 'Foward', text: 'Avance vers la droite du nombre de pas écrit dessous.' },
    { icon: 'Back', text: 'Recule vers la gauche.' },
    { icon: 'Up', text: 'Monte.' },
    { icon: 'Down', text: 'Descend.' },
    { icon: 'Right', text: 'Tourne vers la droite.' },
    { icon: 'Left', text: 'Tourne vers la gauche.' },
    { icon: 'Hop', text: 'Saute.' },
    { icon: 'Home', text: 'Revient à sa place de départ.' },
  ] },
  { name: 'Pour changer d’allure', color: '#C56BC9', blocs: [
    { icon: 'Say', text: 'Dit le texte écrit dessous, dans une bulle.' },
    { icon: 'Grow', text: 'Grandit.' },
    { icon: 'Shrink', text: 'Rétrécit.' },
    { icon: 'Reset', text: 'Reprend sa taille de départ.' },
    { icon: 'Disappear', text: 'Disparaît.' },
    { icon: 'Appear', text: 'Réapparaît.' },
  ] },
  { name: 'Pour faire du bruit', color: '#3FAE5C', blocs: [
    { icon: 'Speaker', text: 'Joue le son « pop ».' },
    { icon: 'Microphone', text: 'Enregistre ta voix, puis la joue. Le micro apparaît si un parent l’a autorisé.' },
  ] },
  { name: 'Pour décider du rythme', color: '#F29A2E', blocs: [
    { icon: 'Wait', text: 'Attend un moment avant de continuer.' },
    { icon: 'Stop', text: 'Arrête tout ce que fait le personnage.' },
    { icon: 'speed1', text: 'Change sa vitesse : lent, normal ou rapide.' },
    { icon: 'Repeat', text: 'Refait plusieurs fois les blocs placés dedans.' },
  ] },
  { name: 'Pour finir', color: '#E24B4B', blocs: [
    { icon: 'Forever', text: 'Recommence tout le script, sans jamais s’arrêter.' },
  ] },
];

/** L'aide de l'Atelier code : comment on s'y prend, et ce que fait chaque bloc des petits. */
@Component({
  selector: 'atelier-aide',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent],
  template: `
    <f-modal title="Aide de l’Atelier code" [maxWidth]="640" [tall]="true" (close)="close.emit()">
      <div class="aide">
        <h3>Petits codeurs</h3>
        <ol>
          <li>Choisis un personnage (le bouton +, à gauche) et un décor (l’image, en haut).</li>
          <li>Touche un bouton de couleur, en bas : ses blocs apparaissent à côté.</li>
          <li>Fais glisser un bloc dans la zone du bas, puis accroche les suivants à sa droite, comme un train.</li>
          <li>Touche le drapeau vert pour lancer l’histoire. Pour enlever un bloc, fais-le glisser hors de la zone.</li>
          <li>Le pinceau, à côté du personnage, ouvre l’éditeur de dessin : formes, couleurs, et l’appareil photo pour remplir une forme.</li>
        </ol>
        @for (f of familles; track f.name) {
          <div class="fam" [style.border-left-color]="f.color">{{ f.name }}</div>
          <div class="blocs">
            @for (b of f.blocs; track b.icon) {
              <div class="bloc"><span class="ic" [style.background]="f.color"><img [src]="icon(b.icon)" alt="" /></span><span>{{ b.text }}</span></div>
            }
          </div>
        }
        <h3>Grands codeurs</h3>
        <ol>
          <li>Les blocs sont écrits, rangés par couleur à gauche : mouvement, apparence, son, événements, contrôle, capteurs, opérateurs, variables.</li>
          <li>Fais glisser un bloc au milieu et emboîte les suivants dessous. Un script commence par un bloc jaune « quand… ».</li>
          <li>Touche un bloc pour voir tout de suite ce qu’il fait ; le drapeau vert lance tous les scripts, le rond rouge les arrête.</li>
          <li>En bas à droite : ajouter un personnage ou un décor de la bibliothèque. Les onglets Costumes et Sons, en haut, servent à dessiner et à enregistrer.</li>
          <li>Le menu Fichier enregistre le projet dans un fichier, ou en ouvre un.</li>
        </ol>
        <h3>À savoir</h3>
        <ul>
          <li>Tout s’enregistre tout seul. La maison, en haut, ramène à Foyer.</li>
          <li>Un projet supprimé n’est pas perdu : un parent peut le retrouver pendant quelque temps.</li>
          <li>Sans réseau, le projet ouvert continue de marcher et s’enregistre au retour du réseau.</li>
        </ul>
      </div>
    </f-modal>
  `,
  styles: [`
    .aide { font-size: 14px; font-weight: 600; color: var(--ink2); line-height: 1.5; }
    h3 { margin: 18px 0 8px; font-family: var(--font-display); font-size: 17px; font-weight: 800; color: var(--ink); }
    h3:first-child { margin-top: 0; }
    ol, ul { margin: 0 0 6px; padding-left: 22px; }
    li { margin: 4px 0; }
    .fam { margin: 14px 0 8px; padding-left: 10px; border-left: 5px solid; font-weight: 800; color: var(--ink); }
    .blocs { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 8px; }
    .bloc { display: flex; align-items: center; gap: 10px; }
    .ic { flex: none; width: 44px; height: 44px; border-radius: 10px; display: flex; align-items: center; justify-content: center; }
    .ic img { width: 32px; height: 32px; object-fit: contain; }
  `],
})
export class AtelierAide {
  readonly close = output<void>();
  readonly familles = FAMILLES;
  /** The pictures of the blocks are shipped with the editor, next to its page. */
  icon(name: string): string { return new URL(`atelier/petits/assets/blockicons/${name}.svg`, document.baseURI).href; }
}
