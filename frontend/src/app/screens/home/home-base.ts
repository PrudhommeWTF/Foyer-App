import { Directive, computed, inject } from '@angular/core';
import { FoyerStore } from '../../core/foyer.store';
import { ActivityEntry, relTime } from '../../core/activity';
import { EventItem, TaskList } from '../../core/models';
import { parseDay } from '../../core/helpers';
import { splitMealKey } from '../../core/meals';

/**
 * Ce que l'accueil mobile (carrousel) et l'accueil bureau (le point du jour)
 * partagent : le salut, les départs proches, et les petites mises en forme du
 * fil et de l'agenda.
 */
@Directive()
export abstract class HomeBase {
  readonly store = inject(FoyerStore);

  readonly hello = computed(() => { const n = this.store.me()?.name; return n ? 'Bonjour ' + n : 'Bonjour'; });

  /** Le lendemain, pour l'aperçu des repas. */
  readonly tomorrowStr = computed(() => this.store.addDays(this.store.todayStr(), 1));

  /**
   * Les départs proches : une liste de préparation dans sa fenêtre de rappel
   * (J-N à J-0) où il reste des affaires à préparer. La ligne d'accueil s'efface
   * dès que tout est prêt ou le départ passé.
   */
  readonly prepAlerts = computed<{ list: TaskList; days: number; remaining: number }[]>(() => {
    const d = this.store.seenData();
    if (!d) return [];
    const today = parseDay(this.store.todayStr());
    const out: { list: TaskList; days: number; remaining: number }[] = [];
    for (const l of this.store.visibleTaskLists()) {
      if (l.kind !== 'preparation' || !l.departure) continue;
      const days = Math.round((parseDay(l.departure).getTime() - today.getTime()) / 86_400_000);
      if (days < 0 || days > (l.remindDaysBefore ?? 3)) continue;
      const remaining = (d.tasks || []).filter((t) => t.listId === l.id && !t.done).length;
      if (remaining > 0) out.push({ list: l, days, remaining });
    }
    return out.sort((a, b) => a.days - b.days);
  });
  openPrep(id: string): void { this.store.go('taches'); this.store.patch({ activeList: id }); }

  ini(id: string | null): string { return (id && (this.store.seenData()?.members || []).find((m) => m.id === id)?.ini) || '?'; }
  col(id: string | null): string { return id ? this.store.memberColor(id) : '#8A7E74'; }
  /** Initiales d'un auteur hors foyer, civilité ôtée : « Mme MAZARS B. » donne « MB ». */
  authorIni(name: string): string {
    const w = name.split(/\s+/).filter((x) => x && !/^(M|Mme|Mlle|MM|Mmes|Mr|Mrs)\.?$/i.test(x));
    return w.slice(0, 2).map((x) => x[0]).join('').toUpperCase() || 'ED';
  }
  nm(id: string | null): string { return (id && this.store.memberName(id)) || 'Quelqu’un'; }
  rel(iso: string): string { return relTime(iso, Date.now()); }

  /** Clic sur le nom d'une entrée du fil : ouvre la fiche de l'élément concerné. */
  openActivity(a: ActivityEntry): void {
    if (a.kind === 'task') this.store.openItem('task', a.ref);
    else if (a.kind === 'event') this.store.openItem('event', a.ref);
    else if (a.kind === 'recipe') this.store.openItem('recipe', a.ref);
    else if (a.kind === 'meal') { const { dateStr, slot } = splitMealKey(a.ref); this.store.openMeal(dateStr, slot); }
    else this.store.openShoppingList(a.ref);
  }

  evColor(ev: EventItem): string { return ev.who.length ? this.store.memberColor(ev.who[0]) : '#E56B4E'; }

  /** Un événement sans heure occupe la journée : il s'affiche en pastille, sans horaire. */
  isAllDay(ev: EventItem): boolean { return !!ev.allDay || !ev.time || ev.time === '—'; }
}
