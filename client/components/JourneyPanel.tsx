import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, Copy, Layers, Link2, LoaderCircle, Plus, Route, UserRound } from 'lucide-react';
import type { CatalogCard, CatalogJourney, CatalogJourneyStep, CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { shortReference } from '../../src/references.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { Markdown } from './Markdown.tsx';
import { journeyStepTitle } from './journey-step-title.ts';
import { Button } from './ui/button.tsx';
import { defineText, locale, useText, type Lang } from '../i18n.ts';
import '../journey-apply.css';
import '../catalog-reference.css';

function numberValue(value: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(value);
}

const text = defineText({
  count: (count: number) => numberValue(count, 'en'),
  agents: 'Agents',
  humans: 'Humans',
  applyJourney: 'Apply Journey',
  startJourney: 'Start Journey',
  heroCards: 'Hero Cards',
  noJourney: 'No Journey yet',
  createJourney: 'Create Journey',
  journey: 'Journey',
  deselectAll: 'Deselect all',
  selectAll: 'Select all',
  defaultSteps: 'Default steps',
  journeySteps: 'Journey steps',
  stepNumber: (number: number) => `Step ${numberValue(number, 'en')}`,
  applied: 'Applied',
  dependencies: (count: number) => `${numberValue(count, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'dependency' : 'dependencies'}`,
  taskCard: 'Task Card',
  chooseDeck: 'Choose Deck',
  stepTitle: (title: string) => `Step: ${title}`,
  selected: 'Selected',
  notSelected: 'Not selected',
  targetDeck: 'Target Deck',
  dependsOn: 'Depends on: ',
  newCards: (count: number, applied: number) => `${numberValue(count, 'en')} new ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'card' : 'cards'}${applied ? ` · ${numberValue(applied, 'en')} already applied` : ''}`,
  createCards: (count: number) => `Create ${numberValue(count, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'Card' : 'Cards'}`,
  cancel: 'Cancel',
  copied: 'Copied',
  copyError: 'Could not copy; the link is available nearby.',
  shortLink: 'Short link',
  copyShortLink: 'Copy short link',
  applyUnconfirmed: 'Creation was not confirmed. Your step selection is preserved; check that the data is current and try again.',
  createFailed: 'Could not create cards. Your step selection is preserved.',
  chooseCards: 'Choose the cards to create for ',
  journeyForDeck: 'A Journey for deck ',
  noJourneyDescription: 'Create a sequence of steps for this deck. The Journey turns them into Sub Cards of your Hero Card.',
  journeyUnavailable: 'Journey unavailable — choose another',
  alreadyAppliedDetails: ' — already created; show details',
  selectStepDetails: ' — select the step and show details',
  showDetails: ' — show details',
  allStepsCreated: 'All steps of this Journey have already been created. No duplicate cards will appear.',
  deckUnavailable: 'Deck unavailable',
  requiredSteps: ' Required steps are selected together.',
  stepInstruction: 'Step instructions',
  validTargets: 'Every selected step needs an existing Task or Mixed Deck. Select a step and set its Target Deck.',
  readOnlySandbox: 'Template preview. Cards can be created in the sandbox.',
}, {
  count: (count: number) => numberValue(count, 'ru'),
  agents: 'Агенты',
  humans: 'Люди',
  applyJourney: 'Применить Journey',
  startJourney: 'Запустить Journey',
  heroCards: 'Hero Cards',
  noJourney: 'Journey ещё нет',
  createJourney: 'Создать Journey',
  journey: 'Journey',
  deselectAll: 'Снять выбор со всех',
  selectAll: 'Выбрать все',
  defaultSteps: 'Основные шаги',
  journeySteps: 'Шаги Journey',
  stepNumber: (number: number) => `Шаг ${numberValue(number, 'ru')}`,
  applied: 'Применено',
  dependencies: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    const noun = { one: 'зависимость', few: 'зависимости', many: 'зависимостей', zero: 'зависимостей', two: 'зависимости', other: 'зависимости' }[rule]!;
    return `${numberValue(count, 'ru')} ${noun}`;
  },
  taskCard: 'Task Card',
  chooseDeck: 'Выбрать колоду',
  stepTitle: (title: string) => `Шаг: ${title}`,
  selected: 'Выбрано',
  notSelected: 'Не выбрано',
  targetDeck: 'Целевая колода',
  dependsOn: 'Зависит от: ',
  newCards: (count: number, applied: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    const noun = { one: 'новая карточка', few: 'новые карточки', many: 'новых карточек', zero: 'новых карточек', two: 'новые карточки', other: 'новые карточки' }[rule]!;
    return `${numberValue(count, 'ru')} ${noun}${applied ? ` · уже применено ${numberValue(applied, 'ru')}` : ''}`;
  },
  createCards: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    const noun = { one: 'карточку', few: 'карточки', many: 'карточек', zero: 'карточек', two: 'карточки', other: 'карточки' }[rule]!;
    return `Создать ${numberValue(count, 'ru')} ${noun}`;
  },
  cancel: 'Отмена',
  copied: 'Скопировано',
  copyError: 'Не удалось скопировать; ссылка доступна рядом.',
  shortLink: 'Короткая ссылка',
  copyShortLink: 'Скопировать короткую ссылку',
  applyUnconfirmed: 'Создание не подтверждено. Выбор шагов сохранён; проверьте актуальность данных и повторите действие.',
  createFailed: 'Не удалось создать карточки. Выбор шагов сохранён.',
  chooseCards: 'Выберите карточки, которые нужно создать для ',
  journeyForDeck: 'Journey для колоды ',
  noJourneyDescription: 'Создайте последовательность шагов для этой колоды. Journey превратит их в Sub Cards вашей Hero Card.',
  journeyUnavailable: 'Journey недоступен — выберите другой',
  alreadyAppliedDetails: ' — уже создана; показать подробности',
  selectStepDetails: ' — выбрать шаг и показать подробности',
  showDetails: ' — показать подробности',
  allStepsCreated: 'Все шаги этого Journey уже созданы. Повторные карточки не появятся.',
  deckUnavailable: 'Колода недоступна',
  requiredSteps: ' Необходимые шаги выбираются вместе.',
  stepInstruction: 'Инструкция шага',
  validTargets: 'Для каждого выбранного шага нужна существующая Task или Mixed Deck. Выберите шаг и укажите целевую колоду.',
  readOnlySandbox: 'Просмотр шаблона. Создать карточки можно в sandbox.',
});

type EditCatalog = (action: CatalogAction) => Promise<boolean>;

function availableTargets(catalog: CatalogView) {
  return catalog.decks.filter(deck => deck.kind === 'task' || deck.kind === 'mixed');
}

export function MemberOptions({ members }: { members: CatalogMember[] }) {
  const t = useText(text);
  const agents = members.filter(member => member.kind === 'agent');
  const humans = members.filter(member => member.kind === 'human');
  return <>{agents.length > 0 && <optgroup label={t.agents}>{agents.map(member => <option key={member.id} value={member.label}>{member.label}</option>)}</optgroup>}{humans.length > 0 && <optgroup label={t.humans}>{humans.map(member => <option key={member.id} value={member.label}>{member.label}</option>)}</optgroup>}</>;
}

export function CatalogReferenceLink({ kind, id, source }: { kind: 'c' | 'p' | 'v'; id: string; source: DataSource }) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'error'>('idle');
  const t = useText(text);
  const reference = shortReference(kind, id);
  const href = `${location.origin}/r/${reference}?source=${source}`;
  useEffect(() => {
    if (copied === 'idle') return;
    const timer = window.setTimeout(() => setCopied('idle'), 3000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  async function copy() {
    try { await navigator.clipboard.writeText(href); setCopied('copied'); }
    catch { setCopied('error'); }
  }
  const feedback = copied === 'copied' ? t.copied : '';
  const message = copied === 'error' ? t.copyError : feedback;
  return <div className="catalog-reference">
    <a href={href} title={t.shortLink} target="_blank" rel="noreferrer">{reference}</a>
    <Button type="button" className="catalog-reference-copy" variant="ghost" size="icon" onClick={() => void copy()} aria-label={t.copyShortLink} title={message || t.copyShortLink}>{copied === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}</Button>
    <span className="catalog-reference-feedback" role="status" aria-live="polite" aria-atomic="true">{message}</span>
  </div>;
}

export { JourneyEditor as JourneyTemplatePanel } from './JourneyEditor.tsx';

function stepSelection(journey: CatalogJourney, requested: Set<string>, applied: Set<string>): Set<string> {
  const selected = new Set<string>();
  function include(id: string) {
    if (selected.has(id) || applied.has(id)) return;
    const step = journey.steps.find(candidate => candidate.id === id);
    if (!step) return;
    selected.add(id);
    for (const dependency of step.dependsOn) include(dependency);
  }
  for (const id of requested) include(id);
  return selected;
}

export function ApplyJourneyPanel({ catalog, card, source, pending, writable, onEdit, onClose, onManageJourney }: { catalog: CatalogView; card: CatalogCard; source: DataSource; pending: boolean; writable: boolean; onEdit: EditCatalog; onClose: () => void; onManageJourney?: () => void }) {
  const journeys = (catalog.journeys ?? []).filter(journey => journey.deckId === card.deckId);
  const t = useText(text);
  const [journeyId, setJourneyId] = useState(journeys[0]?.id ?? '');
  const journey = journeys.find(candidate => candidate.id === journeyId);
  const targets = availableTargets(catalog);
  const applied = new Set(catalog.cards.filter(candidate => candidate.journey && candidate.parentId === card.id && candidate.journey.journeyId === journey?.id && candidate.journey.version === journey?.version).map(candidate => candidate.journey!.stepId));
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(journeys[0]?.steps.filter(step => !applied.has(step.id)).map(step => step.id) ?? []));
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [inspectedId, setInspectedId] = useState(journeys[0]?.steps[0]?.id ?? '');
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  const applyingRef = useRef(false);
  const detailsId = useId();
  const busy = pending || applying;
  const selected = journey ? stepSelection(journey, selectedIds, applied) : new Set<string>();
  const validTargets = journey && [...selected].every(id => targets.some(deck => deck.id === (assignments[id] ?? journey.steps.find(step => step.id === id)?.deckId)));
  const inspected = journey?.steps.find(step => step.id === inspectedId) ?? journey?.steps[0];
  const availableCount = journey?.steps.filter(step => !applied.has(step.id)).length ?? 0;
  const allSelected = availableCount > 0 && selected.size === availableCount;
  const stepTitle = (step: CatalogJourneyStep) => journeyStepTitle(step.title, card.title);

  function chooseJourney(id: string) {
    if (busy) return;
    const next = journeys.find(candidate => candidate.id === id);
    const existing = new Set(catalog.cards.filter(candidate => candidate.journey && candidate.parentId === card.id && candidate.journey.journeyId === id && candidate.journey.version === next?.version).map(candidate => candidate.journey!.stepId));
    setJourneyId(id); setAssignments({}); setSelectedIds(new Set(next?.steps.filter(step => !existing.has(step.id)).map(step => step.id) ?? []));
    setInspectedId(next?.steps[0]?.id ?? ''); setApplyError('');
  }
  function toggleStep(id: string, checked: boolean) {
    if (!journey || busy || !writable || applied.has(id)) return;
    const next = new Set(selected);
    if (checked) next.add(id);
    else {
      next.delete(id);
      let removed = true;
      while (removed) {
        removed = false;
        for (const step of journey.steps) if (next.has(step.id) && step.dependsOn.some(dependency => !next.has(dependency) && !applied.has(dependency))) { next.delete(step.id); removed = true; }
      }
    }
    setSelectedIds(stepSelection(journey, next, applied));
    setApplyError('');
  }
  async function apply() {
    if (!journey || !writable || busy || applyingRef.current || !validTargets || selected.size === 0 || card.kind !== 'hero') return;
    const deckAssignments = Object.fromEntries([...selected].map(id => [id, assignments[id] ?? journey.steps.find(step => step.id === id)!.deckId]));
    applyingRef.current = true; setApplying(true); setApplyError('');
    try {
      if (await onEdit({ action: 'apply-journey', cardId: card.id, journeyId: journey.id, journeyHash: journey.fileHash, stepIds: [...selected], deckAssignments })) onClose();
      else setApplyError(t.applyUnconfirmed);
    } catch { setApplyError(t.createFailed); }
    finally { applyingRef.current = false; setApplying(false); }
  }
  if (card.kind !== 'hero') return null;
  return <section className="journey-apply journey-apply-picker" aria-label={t.applyJourney} aria-busy={busy}>
    <header className="journey-picker-heading"><div><h3>{t.startJourney}</h3><p>{journeys.length ? <>{t.chooseCards}<strong>{card.title}</strong>.</> : <>{t.journeyForDeck}<strong>{catalog.decks.find(deck => deck.id === card.deckId)?.title ?? t.heroCards}</strong>.</>}</p></div></header>
    {journeys.length === 0 ? <div className="journey-picker-empty"><span className="journey-picker-empty-icon"><Route size={25} aria-hidden="true" /></span><h4>{t.noJourney}</h4><p>{t.noJourneyDescription}</p>{writable && onManageJourney && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onManageJourney}><Plus size={14} />{t.createJourney}</Button>}</div> : <>
      <div className="journey-picker-controls"><label className="catalog-field">{t.journey}<select value={journeyId} disabled={busy} onChange={event => chooseJourney(event.target.value)}>{!journey && <option value={journeyId}>{t.journeyUnavailable}</option>}{journeys.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label>
        {writable && journey && <Button type="button" variant="ghost" size="sm" disabled={busy || availableCount === 0} onClick={() => { setSelectedIds(allSelected ? new Set() : new Set(journey.steps.filter(step => !applied.has(step.id)).map(step => step.id))); setApplyError(''); }}>{allSelected ? t.deselectAll : t.selectAll}</Button>}
      </div>
      {journey && <><div className="journey-picker-group-title"><span>{t.defaultSteps}</span><small>{t.count(journey.steps.length)}</small></div>
        <div className="journey-picker-grid" aria-label={t.journeySteps}>{journey.steps.map((step, index) => {
          const alreadyApplied = applied.has(step.id);
          const checked = alreadyApplied || selected.has(step.id);
          const target = catalog.decks.find(deck => deck.id === (assignments[step.id] ?? step.deckId));
          return <button key={step.id} type="button" className={'journey-step-card' + (alreadyApplied ? ' is-applied' : '') + (inspected?.id === step.id ? ' is-inspected' : '')} disabled={busy} aria-pressed={checked} aria-controls={detailsId}
            aria-label={stepTitle(step) + (alreadyApplied ? t.alreadyAppliedDetails : writable ? t.selectStepDetails : t.showDetails)} title={stepTitle(step)}
            onClick={() => { setInspectedId(step.id); toggleStep(step.id, !checked); }}>
            <span className="journey-step-card-top"><span>{t.stepNumber(index + 1)}</span><span className="journey-step-card-check" aria-hidden="true">{checked && <Check size={11} strokeWidth={2.5} />}</span></span>
            <strong>{stepTitle(step)}</strong>
            <span className="journey-step-card-status">{alreadyApplied ? <><Check size={11} />{t.applied}</> : step.dependsOn.length > 0 ? <><Link2 size={11} />{t.dependencies(step.dependsOn.length)}</> : t.taskCard}</span>
            <span className="journey-step-card-deck"><Layers size={12} aria-hidden="true" /><span>{target?.title ?? t.chooseDeck}</span></span>
          </button>;
        })}</div>
        {availableCount === 0 && <p className="journey-picker-note" role="status">{t.allStepsCreated}</p>}
        {inspected && <section id={detailsId} className="journey-picker-details" aria-label={t.stepTitle(stepTitle(inspected))}>
          <header><h4>{stepTitle(inspected)}</h4><span>{applied.has(inspected.id) ? t.applied : selected.has(inspected.id) ? t.selected : t.notSelected}</span></header>
          <div className="journey-picker-step-settings"><label className="catalog-field">{t.targetDeck}<select disabled={busy || !writable || !selected.has(inspected.id)} value={assignments[inspected.id] ?? inspected.deckId} onChange={event => setAssignments(previous => ({ ...previous, [inspected.id]: event.target.value }))}><option value="">{t.chooseDeck}</option>{targets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}{!targets.some(target => target.id === (assignments[inspected.id] ?? inspected.deckId)) && (assignments[inspected.id] ?? inspected.deckId) && <option value={assignments[inspected.id] ?? inspected.deckId} disabled>{t.deckUnavailable}</option>}</select></label>
            {inspected.owner && <span className="journey-picker-owner"><UserRound size={14} aria-hidden="true" />{inspected.owner}</span>}
          </div>
          {inspected.dependsOn.length > 0 && <p className="journey-picker-note"><Link2 size={13} aria-hidden="true" />{t.dependsOn}{inspected.dependsOn.map(id => journey.steps.find(step => step.id === id)).filter((step): step is CatalogJourneyStep => Boolean(step)).map(stepTitle).join(', ')}.{t.requiredSteps}</p>}
          {inspected.markdown && <details className="journey-picker-instruction"><summary>{t.stepInstruction}</summary><JourneyMarkdown markdown={inspected.markdown.replaceAll('%PARENT_TITLE%', card.title)} projectTags={catalog.projectTags} source={source} path={journey.path.replace(/index\.md$/, 'steps/' + inspected.id + '.md')} /></details>}
        </section>}
      </>}
      {!validTargets && selected.size > 0 && <p className="journey-picker-error" role="alert">{t.validTargets}</p>}
      {!writable && <p className="journey-picker-note">{t.readOnlySandbox}</p>}
    </>}
    {applyError && <p className="journey-picker-error" role="alert">{applyError}</p>}
    <footer className="journey-picker-footer"><span role="status">{journey ? t.newCards(selected.size, applied.size) : ''}</span><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t.cancel}</Button>{journey && writable && <Button type="button" disabled={busy || selected.size === 0 || !validTargets} onClick={() => void apply()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />}{t.createCards(selected.size)}</Button>}</footer>
  </section>;
}

function JourneyMarkdown({ markdown, source, path, projectTags }: { markdown: string; source: DataSource; path: string; projectTags?: CatalogView['projectTags'] }) {
  const tree = useMemo(() => markdownParser.parse(markdown), [markdown]);
  return markdown ? <div className="journey-markdown"><Markdown tree={tree} rawMarkdown={markdown} projectTags={projectTags} source={source} path={path} /></div> : null;
}
