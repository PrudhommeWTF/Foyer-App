import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { SidebarComponent } from './sidebar';
import { TopbarComponent } from './topbar';
import { TabbarComponent } from './tabbar';
import { NotificationsComponent } from './notifications';
import { GenerateModal } from './generate-modal';
import { RepairModal } from './repair-modal';
import { FamilyModalComponent } from './family-modal';
import { SearchModalComponent } from './search-modal';
import { HomeScreen } from '../screens/home/home';
import { CalendarScreen } from '../screens/calendar';
import { CoursesScreen } from '../screens/courses';
import { TachesScreen } from '../screens/taches/taches';
import { MessagesScreen } from '../screens/messages';
import { ContactsScreen } from '../screens/contacts';
import { DocumentsScreen } from '../screens/documents';
import { FinancesScreen } from '../screens/finances/finances';
import { RepasScreen } from '../screens/repas';
import { RecettesScreen } from '../screens/recettes';
import { PlanningScreen } from '../screens/planning';
import { SettingsScreen } from '../screens/settings/settings';

@Component({
  selector: 'app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SidebarComponent, TopbarComponent, TabbarComponent, NotificationsComponent,
    FamilyModalComponent, SearchModalComponent, GenerateModal, RepairModal,
    HomeScreen, CalendarScreen, CoursesScreen, TachesScreen, MessagesScreen, ContactsScreen,
    DocumentsScreen, FinancesScreen, RepasScreen, RecettesScreen, PlanningScreen, SettingsScreen,
  ],
  template: `
    <div class="shell" [class.narrow]="store.narrow()">
      @if (!store.narrow() && store.data()) { <app-sidebar /> }
      <div class="main">
        @if (store.data()) { <app-topbar /> }
        <div class="content fscroll" [class.mobile-pad]="store.narrow()">
          <!--
            Ce qui est montré vient du dernier document gardé, faute de réseau au
            démarrage. Le dire, avec sa date : une application qui s'ouvre sans
            réseau doit annoncer qu'elle montre le passé, sinon elle ment.
          -->
          @if (store.staleNotice(); as avis) {
            <div class="stale">{{ avis }}</div>
          }
          <!--
            Sans document du foyer (serveur injoignable au démarrage), toutes les
            destinations mènent à l'accueil : c'est le seul écran conçu pour dire
            qu'il ne peut pas charger, et proposer de réessayer. Le reste du
            châssis se tait plutôt que d'afficher une famille vide.
          -->
          @if (!store.data()) { <screen-home /> }
          @else { @switch (store.ui().screen) {
            @case ('home') { <screen-home /> }
            @case ('calendar') { <screen-calendar /> }
            @case ('courses') { <screen-courses /> }
            @case ('taches') { <screen-taches /> }
            @case ('messages') { <screen-messages /> }
            @case ('contacts') { <screen-contacts /> }
            @case ('documents') { <screen-documents /> }
            @case ('finances') { <screen-finances /> }
            @case ('repas') { <screen-repas /> }
            @case ('recettes') { <screen-recettes /> }
            @case ('planning') { <screen-planning /> }
            @case ('settings') { <screen-settings /> }
            @default { <screen-home /> }
          } }
        </div>
      </div>
      @if (store.narrow() && store.data()) { <app-tabbar /> }
    </div>

    @if (store.ui().genOpen) { <app-generate-modal /> }
    @if (store.ui().repairOpen) { <app-repair-modal /> }
    @if (store.ui().notifOpen) { <app-notifications /> }
    @if (store.ui().searchOpen) { <app-search-modal /> }
    <app-family-modal />
  `,
  styles: [`
    :host { display: block; }
    .shell { display: flex; width: 100%; min-height: 100vh; background: var(--bg); overflow: hidden; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; }
    .stale {
      display: flex; align-items: center; gap: 9px; margin-bottom: 18px;
      padding: 10px 14px; border-radius: 12px; background: #FCE9E3; color: #C6492F;
      font-size: 12.5px; font-weight: 700;
    }
    .content { flex: 1; overflow-y: auto; padding: 28px 40px; }
    .content.mobile-pad { padding: 20px 16px 90px; }
    @media (max-width: 860px) { .content { padding: 20px 16px 90px; } }
  `],
})
export class ShellComponent implements AfterViewInit, OnDestroy {
  store = inject(FoyerStore);
  private host = inject(ElementRef<HTMLElement>);
  private ro?: ResizeObserver;

  ngAfterViewInit(): void {
    const measure = (w: number) => this.store.narrow.set(w < 860);
    const el = this.host.nativeElement as HTMLElement;
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver((entries) => measure(entries[0].contentRect.width));
      this.ro.observe(el);
    }
    measure(el.clientWidth || window.innerWidth);
  }
  ngOnDestroy(): void { this.ro?.disconnect(); }
}
