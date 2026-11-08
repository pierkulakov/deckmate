// Smart Nodes query a deck with an optional state filter and show an accepted/total progress bar.
// Recount on every catalog revision to keep the board current.
import type { BoardSmartQuery } from '../../src/board-contracts.ts';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import { SMART_DONE_STATE, SMART_NODE_CARD_LIMIT, smartNodeData } from '../../src/board-smart.ts';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';

const text = defineText({
  deckMissing: 'Deck not found',
  cappedTitle: (limit: number) => `The query is limited to the first ${new Intl.NumberFormat(locale('en')).format(limit)} ${new Intl.PluralRules(locale('en')).select(limit) === 'one' ? 'card' : 'cards'}`,
  capped: (limit: number) => `first ${new Intl.NumberFormat(locale('en')).format(limit)}`,
}, {
  deckMissing: 'Колода не найдена',
  cappedTitle: (limit: number) => `Запрос ограничен первыми ${new Intl.NumberFormat(locale('ru')).format(limit)} карточками`,
  capped: (limit: number) => `первые ${new Intl.NumberFormat(locale('ru')).format(limit)}`,
});

export const visionSmartSize = { width: 280, height: 120 };

export default function VisionSmartNode({ query, catalog }: { query: BoardSmartQuery; catalog: CatalogView | null }) {
  const t = useText(text);
  const lang = useLang();
  const data = smartNodeData(catalog, query);
  const numbers = new Intl.NumberFormat(locale(lang));
  const progress = `${numbers.format(data.done)}/${numbers.format(data.total)}`;
  const share = data.total ? Math.round((data.done / data.total) * 100) : 0;
  const label = `${data.deckTitle ?? t.deckMissing}${data.stateFilter ? ` · ${stateLabel(data.stateFilter, lang)}` : ''} · ${stateLabel(SMART_DONE_STATE, lang)} ${progress}${data.capped ? '+' : ''}`;
  return <div className="deckmate-vision-smart">
    <div className="deckmate-smart-head">
      <strong className="deckmate-smart-title" title={data.deckTitle ?? t.deckMissing}>{data.deckTitle ?? t.deckMissing}</strong>
      {data.stateFilter && <span className="deckmate-smart-state">{stateLabel(data.stateFilter, lang)}</span>}
    </div>
    <div className="deckmate-smart-bar" role="progressbar" aria-valuemin={0} aria-valuemax={data.total} aria-valuenow={data.done} aria-label={label}>
      <span style={{ width: `${share}%` }} />
    </div>
    <div className="deckmate-smart-caption">
      <span>{stateLabel(SMART_DONE_STATE, lang)} <strong>{progress}</strong></span>
      {data.capped && <span className="deckmate-smart-capped" title={t.cappedTitle(SMART_NODE_CARD_LIMIT)}>{t.capped(SMART_NODE_CARD_LIMIT)}</span>}
    </div>
    <p className="deckmate-smart-label" title={label}>{label}</p>
  </div>;
}
