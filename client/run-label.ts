import type { RunRecord } from '../src/catalog-contracts.ts';
import { defineText, locale, textNow, type Lang } from './i18n.ts';
import { localIsoDate } from '../src/catalog-hand.ts';

const text = defineText({
  run: (number: string) => `Run ${number}`,
}, {
  run: (number: string) => `Run ${number}`,
});

/** A configured goal is the generated label; a legacy goal remains separate descriptive text (2026-11-05). */
export function runLabel(run: RunRecord, lang?: Lang): string {
  if (run.configurationId) return run.goal;
  const labels = lang ? text[lang] : textNow(text);
  return labels.run(new Intl.NumberFormat(locale(lang)).format(run.number));
}

/** Pickers and groupings: a legacy Run keeps its goal beside the number, as before 2026-11-05. */
export function runChoiceLabel(run: RunRecord, lang?: Lang): string {
  const label = runLabel(run, lang);
  return !run.configurationId && run.goal ? label + ' · ' + run.goal : label;
}

/** All pickers put current/upcoming choices first and recent history before older history (2026-11-05). */
export function orderedRunChoices(runs: readonly RunRecord[], today = localIsoDate()): RunRecord[] {
  const isPast = (run: RunRecord) => Boolean(run.finishedAt) || run.end < today;
  return [...runs].sort((first, second) => {
    const firstPast = isPast(first);
    const secondPast = isPast(second);
    if (firstPast !== secondPast) return firstPast ? 1 : -1;
    const dates = firstPast ? second.start.localeCompare(first.start) : first.start.localeCompare(second.start);
    return dates || first.number - second.number || first.id.localeCompare(second.id);
  });
}
