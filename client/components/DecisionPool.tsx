import { useMemo } from 'react';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { defineText, formatNumber, useLang, useText } from '../i18n.ts';
import { pendingDecisions, targetDetails } from '../question-model.ts';
import { useCatalog } from '../useCatalog.ts';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import '../decision-pool.css';

const text = defineText({
  title: 'Decisions to apply', loading: 'Loading decisions…', empty: 'No decisions to apply',
  emptyDescription: 'Answers waiting to be applied appear here.',
  pendingHint: 'Apply the answer to its target, then confirm it separately through the CLI or with an agent. The agent is not started automatically.',
  question: 'Question', noQuestion: 'Question not recorded', noDeck: 'No deck',
  answeredBy: (name: string) => `Answered by ${name}`, unknownAuthor: 'Author not recorded', unknownDate: 'Date not recorded',
}, {
  title: 'Решения к внесению', loading: 'Загружаем решения…', empty: 'Нет решений к внесению',
  emptyDescription: 'Здесь появляются ответы, которые ещё нужно внести.',
  pendingHint: 'Внесите ответ в указанную цель, затем подтвердите внесение отдельно через CLI или с помощью агента. Агент автоматически не запускается.',
  question: 'Вопрос', noQuestion: 'Вопрос не указан', noDeck: 'Без колоды',
  answeredBy: (name: string) => `Ответ: ${name}`, unknownAuthor: 'Автор не указан', unknownDate: 'Дата не указана',
});

export function DecisionPoolView({ snapshot, refreshKey, onOpen }: {
  snapshot: WorkspaceSnapshot; refreshKey: number; onOpen: (cardId: string) => void;
}) {
  const { catalog, error, refresh } = useCatalog(snapshot, refreshKey);
  const t = useText(text);
  return <section className="decision-pool-view page-light">
    <header className="page-head"><div className="page-head-main"><div className="page-title-block"><h1 className="page-title">{t.title}</h1></div></div></header>
    {error && <ErrorState message={error} onRetry={refresh} />}
    {!catalog && !error && <LoadingState message={t.loading} />}
    {catalog && <DecisionPool catalog={catalog} onOpen={onOpen} />}
  </section>;
}

export function DecisionPool({ catalog, onOpen }: { catalog: CatalogView; onOpen: (cardId: string) => void }) {
  const t = useText(text);
  const lang = useLang();
  const entries = useMemo(() => pendingDecisions(catalog), [catalog]);
  const groups = useMemo(() => {
    const byCard = new Map<string, typeof entries>();
    for (const entry of entries) {
      const group = byCard.get(entry.card.id) ?? [];
      group.push(entry);
      byCard.set(entry.card.id, group);
    }
    return [...byCard.values()];
  }, [entries]);

  if (!entries.length) return <div className="glass-panel"><EmptyState variant="first-run" art="sorted" title={t.empty} message={t.emptyDescription} /></div>;
  return <><p className="decision-pool-hint">{t.pendingHint}</p><div className="decision-pool glass-panel">
    {groups.map(group => {
      const card = group[0].card;
      const deck = catalog.decks.find(item => item.id === card.deckId);
      return <section className="decision-pool-group" key={card.id} aria-label={card.title}>
        <header className="panel-head"><h2 className="panel-title">{card.title}</h2><span className="page-number">{formatNumber(group.length, 0, lang)}</span><span className="panel-count">{deck?.title ?? t.noDeck}</span></header>
        <ul>{group.map(({ decision }, index) => {
          const target = targetDetails(decision.target, card, catalog, lang);
          const author = catalog.members?.find(member => member.id === decision.by)?.label ?? decision.by;
          return <li key={`${decision.index ?? index}`}><button type="button" onClick={() => onOpen(card.id)}>
            <span className="decision-pool-answer">{decision.answer}</span>
            <span className="decision-pool-question">{decision.question ? `${t.question}: ${decision.question}` : t.noQuestion}</span>
            <span className="decision-pool-meta">{!target.isCurrent && <span>{target.caption}</span>}<span>{author ? t.answeredBy(author) : t.unknownAuthor}</span><span>{decision.date ?? t.unknownDate}</span></span>
          </button></li>;
        })}</ul>
      </section>;
    })}
  </div></>;
}
