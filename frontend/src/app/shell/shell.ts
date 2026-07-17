import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject } from '@angular/core';
import { FoyerStore } from '../core/foyer.store';
import { SidebarComponent } from './sidebar';
import { TopbarComponent } from './topbar';
import { TabbarComponent } from './tabbar';
import { NotificationsComponent } from './notifications';
import { FamilyModalComponent } from './family-modal';
import { ProfileModalComponent } from './profile-modal';
import { ToastComponent } from './toast';
import { HomeScreen } from '../screens/home';
import { CalendarScreen } from '../screens/calendar';
import { CoursesScreen } from '../screens/courses';
import { TachesScreen } from '../screens/taches';
import { MessagesScreen } from '../screens/messages';
import { ContactsScreen } from '../screens/contacts';
import { DocumentsScreen } from '../screens/documents';
import { BudgetScreen } from '../screens/budget';
import { RepasScreen } from '../screens/repas';
import { RecettesScreen } from '../screens/recettes';
import { PlanningScreen } from '../screens/planning';
import { SettingsScreen } from '../screens/settings';

@Component({
  selector: 'app-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SidebarComponent, TopbarComponent, TabbarComponent, NotificationsComponent,
    FamilyModalComponent, ProfileModalComponent, ToastComponent,
    HomeScreen, CalendarScreen, CoursesScreen, TachesScreen, MessagesScreen, ContactsScreen,
    DocumentsScreen, BudgetScreen, RepasScreen, RecettesScreen, PlanningScreen, SettingsScreen,
  ],
  template: `
    <div class="shell" [class.narrow]="store.narrow()">
      @if (!store.narrow()) { <app-sidebar /> }
      <div class="main">
        <app-topbar />
        <div class="content fscroll" [class.mobile-pad]="store.narrow()">
          @switch (store.ui().screen) {
            @case ('home') { <screen-home /> }
            @case ('calendar') { <screen-calendar /> }
            @case ('courses') { <screen-courses /> }
            @case ('taches') { <screen-taches /> }
            @case ('messages') { <screen-messages /> }
            @case ('contacts') { <screen-contacts /> }
            @case ('documents') { <screen-documents /> }
            @case ('budget') { <screen-budget /> }
            @case ('repas') { <screen-repas /> }
            @case ('recettes') { <screen-recettes /> }
            @case ('planning') { <screen-planning /> }
            @case ('settings') { <screen-settings /> }
            @default { <screen-home /> }
          }
        </div>
      </div>
      @if (store.narrow()) { <app-tabbar /> }
    </div>

    @if (store.ui().notifOpen) { <app-notifications /> }
    <app-family-modal />
    <app-profile-modal />
    <app-toast />
  `,
  styles: [`
    :host { display: block; }
    .shell { display: flex; width: 100%; min-height: 100vh; background: var(--bg); overflow: hidden; }
    .main { flex: 1; display: flex; flex-direction: column; min-width: 0; height: 100vh; }
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
