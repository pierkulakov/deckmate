import type { CatalogCard } from './catalog-contracts.ts';

type FamilyMember = Pick<CatalogCard, 'kind' | 'state'>;

/** Task Sub Cards that decide whether a Hero is done; work decided against (wont-do) does not count (2026-11-09). */
export function heroCountedTasks<T extends FamilyMember>(children: readonly T[]): T[] {
  return children.filter(child => child.kind === 'task' && child.state !== 'wont-do');
}

/** Only a Hero without counted Task Sub Cards takes a manual done mark; otherwise its children decide (2026-11-09). */
export function heroTakesManualDone(children: readonly FamilyMember[]): boolean {
  return heroCountedTasks(children).length === 0;
}

/**
 * A Hero is done when every counted Task Sub Card is done (2026-11-06); a Hero without them is done
 * by its own manual mark (2026-11-09). `children` are the Hero's active Sub Cards.
 */
export function heroFinished(hero: Pick<CatalogCard, 'state'>, children: readonly FamilyMember[]): boolean {
  const tasks = heroCountedTasks(children);
  return tasks.length ? tasks.every(task => task.state === 'done') : hero.state === 'done';
}
