import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Check, ChevronDown, LockKeyhole, Route } from 'lucide-react';
import type { CatalogCard, CatalogJourneyStep, CatalogMember } from '../../src/catalog-contracts.ts';
import { openDependencies } from '../../src/dependency-contracts.ts';
import { subCardStateLabel, subCardVisualState } from '../sub-card-state.ts';
import { useLang, useText, type Lang } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { journeyStepTitle } from './journey-step-title.ts';
import { JourneyTrackMenu, journeyTrackText, type JourneyTrackStepModel } from './JourneyTrackMenu.tsx';

/**
 * The run's step models: one row mini-card, menu item and step note all read from this single computation.
 * Also returns the run's counters so callers never re-derive them from the models.
 */
export function journeyTrackModels(cards: CatalogCard[], steps: CatalogJourneyStep[], cardsById: ReadonlyMap<string, CatalogCard>, lang: Lang): {
  models: JourneyTrackStepModel[]; nextIndex: number; accepted: number;
} {
  const t = journeyTrackText[lang];
  const ordered = orderJourneySteps(cards, steps);
  const states = ordered.map(card => subCardVisualState(card, cardsById));
  const accepted = states.filter(state => state === 'accepted').length;
  const nextIndex = states.findIndex(state => state !== 'accepted' && state !== 'blocked');
  const stepsById = new Map(steps.map(step => [step.id, step]));
  const cardsByStep = new Map(ordered.map(card => [card.journey?.stepId ?? '', card]));
  const titleForCard = (card: CatalogCard) => journeyStepTitle(stepsById.get(card.journey?.stepId ?? '')?.title ?? '', '', card.title);
  const models: JourneyTrackStepModel[] = ordered.map((card, index) => {
    const template = stepsById.get(card.journey?.stepId ?? '');
    const waiting = states[index] === 'blocked' ? openDependencies(card.dependsOn, cardsById) : [];
    const description = waiting.length
      ? `${subCardStateLabel(states[index], lang)} (${t.waitingOn.toLocaleLowerCase(lang)} ${waiting.map(dependency => dependency.title).join(', ')})`
      : subCardStateLabel(states[index], lang);
    const dependencies = (template?.dependsOn ?? []).map(id => {
      const dependency = stepsById.get(id);
      return dependency ? journeyStepTitle(dependency.title, '', cardsByStep.get(id)?.title ?? dependency.title) : id;
    });
    const stateLabel = waiting.length ? t.waiting(titleForCard(waiting[0])) : subCardStateLabel(states[index], lang);
    return {
      card, state: states[index], description, next: index === nextIndex,
      title: titleForCard(card), owner: card.owner ?? template?.owner ?? null, dependencies, stateLabel,
    };
  });
  return { models, nextIndex, accepted };
}

/** Steps run in the Journey definition's order; cards without a matching step keep their family order at the end. */
export function orderJourneySteps(cards: readonly CatalogCard[], steps: readonly CatalogJourneyStep[]): CatalogCard[] {
  if (!steps.length) return [...cards];
  const byStep = new Map(cards.map(card => [card.journey?.stepId ?? '', card]));
  const ordered: CatalogCard[] = [];
  for (const step of steps) {
    const card = byStep.get(step.id);
    if (card && !ordered.includes(card)) ordered.push(card);
  }
  for (const card of cards) if (!ordered.includes(card)) ordered.push(card);
  return ordered;
}

const navigationKeys = new Set(['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * One mini-card that owns its tooltip state, so moving the pointer along the row re-renders only the cards it enters
 * and leaves; Radix closes the previous tip itself when another opens (2026-11-08).
 */
const JourneyTrackStep = memo(function JourneyTrackStep({ step, index, tabStop, disabled, mayOpen, register, onFocus, onKeyDown, onOpen }: {
  step: JourneyTrackStepModel; index: number; tabStop: boolean; disabled: boolean;
  mayOpen: (index: number) => boolean; register: (index: number, button: HTMLButtonElement | null) => void;
  onFocus: (cardId: string) => void; onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void;
  onOpen?: (card: CatalogCard) => void;
}) {
  const [tip, setTip] = useState(false);
  return <li className="journey-track-step">
    <Tooltip.Root open={!disabled && tip} onOpenChange={open => { if (!open || mayOpen(index)) setTip(open); }}><Tooltip.Trigger asChild>
      <button type="button" className="journey-track-open" data-state={step.state} data-next={step.next || undefined}
        data-journey-card-id={step.card.id}
        ref={button => register(index, button)} disabled={disabled}
        tabIndex={!disabled && tabStop ? 0 : -1} aria-label={`${index + 1}. ${step.card.title} — ${step.description}`}
        onFocus={() => onFocus(step.card.id)} onKeyDown={event => onKeyDown(event, index)} onClick={() => onOpen?.(step.card)}>
        <span className="journey-track-face" aria-hidden="true">
          {step.state === 'accepted' && <Check size={11} strokeWidth={3.2} />}
          {step.state === 'blocked' && <LockKeyhole size={11} />}
          {step.state !== 'accepted' && step.state !== 'blocked' && index + 1}
        </span>
      </button>
    </Tooltip.Trigger><Tooltip.Portal>
      <Tooltip.Content className="card-properties-info-tip journey-track-tip" side="top" sideOffset={6}>
        <strong>{index + 1}. {step.card.title}</strong><span>{step.description}</span>
      </Tooltip.Content>
    </Tooltip.Portal></Tooltip.Root>
  </li>;
});

/** One Tab stop per run; leaving the row returns its entry point to the next available step. */
function JourneyTrackList({ steps, label, disabled, onOpen }: {
  steps: JourneyTrackStepModel[]; label: string; disabled: boolean; onOpen?: (card: CatalogCard) => void;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const navigating = useRef(false);
  // 2026-11-08: Radix opens a tooltip on any focus a pointer did not cause — focus restored after a Sub Card closes,
  // the Esc return to the Hero. A tip opens only for the hovered card, or for a focus that the navigation key itself
  // moved: the flag lives for the key's own task only, so a later restored focus never counts as keyboard navigation.
  useEffect(() => {
    const note = (event: globalThis.KeyboardEvent) => {
      if (!navigationKeys.has(event.key)) return;
      navigating.current = true;
      setTimeout(() => { navigating.current = false; }, 0);
    };
    document.addEventListener('keydown', note, true);
    return () => document.removeEventListener('keydown', note, true);
  }, []);
  const mayOpen = useCallback((index: number) => {
    const button = buttons.current[index];
    if (!button || disabled) return false;
    return button.matches(':hover') || (document.activeElement === button && navigating.current);
  }, [disabled]);
  const register = useCallback((index: number, button: HTMLButtonElement | null) => { buttons.current[index] = button; }, []);
  const count = steps.length;
  const moveTrackFocus = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let target = index;
    if (event.key === 'ArrowRight') target = Math.min(count - 1, index + 1);
    else if (event.key === 'ArrowLeft') target = Math.max(0, index - 1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = count - 1;
    else return;
    event.preventDefault();
    moveFocus(buttons.current[target]);
  }, [count]);
  const entry = steps.find(step => step.next) ?? steps.find(step => step.state === 'blocked') ?? steps.at(-1);
  const tabStop = steps.find(step => step.card.id === focusedId) ?? entry;
  return <ol className="journey-track" aria-label={label} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null);
  }}>
    {steps.map((step, index) => <JourneyTrackStep key={step.card.id} step={step} index={index} tabStop={step === tabStop} disabled={disabled}
      mayOpen={mayOpen} register={register} onFocus={setFocusedId} onKeyDown={moveTrackFocus} onOpen={onOpen} />)}
  </ol>;
}

/** Journey execution on a Hero preview: the template with an accepted counter and the run's step track. */
export function JourneyTrack({ title, version, description, members, cards, steps, cardsById, disabled = false, onOpen, onOpenJourney }: {
  title: string; version: number; description?: string; members?: CatalogMember[];
  cards: CatalogCard[]; steps: CatalogJourneyStep[];
  cardsById: ReadonlyMap<string, CatalogCard>; disabled?: boolean; onOpen?: (card: CatalogCard) => void;
  onOpenJourney?: () => void;
}) {
  const t = useText(journeyTrackText);
  const lang = useLang();
  const { models, accepted } = journeyTrackModels(cards, steps, cardsById, lang);
  if (!models.length) return null;
  const allAccepted = accepted === models.length;
  const next = models.find(model => model.next);
  const nextTitle = next && next.title;
  const blocked = models.find(model => model.state === 'blocked');
  const waitingTitle = blocked && (openDependencies(blocked.card.dependsOn, cardsById)[0]?.title ?? blocked.card.dependsOn?.[0] ?? blocked.card.title);
  const instanceId = models[0]?.card.journey?.instanceId ?? '';
  // 2026-11-08: a soft plate with two rows — the Journey (menu), version and counter; then the run with Next.
  return <section className="card-preview-journey-progress" aria-label={t.progress}>
      <header className="journey-track-header">
        <JourneyTrackMenu title={title} version={version} description={description} members={members} steps={models}
          disabled={disabled} onOpen={onOpen} onOpenJourney={onOpenJourney}>
          <button type="button" className="journey-track-title-button" aria-haspopup="menu" aria-label={t.openMenu(title)}
            title={title} disabled={disabled}>
            <Route size={13} aria-hidden="true" />
            <span className="journey-track-title">{title}</span>
            <ChevronDown size={12} className="journey-track-title-chevron" aria-hidden="true" />
          </button>
        </JourneyTrackMenu>
        <span className="journey-track-version">v{version}</span>
        <p className={'journey-track-count' + (allAccepted ? ' is-done' : '')}>
          <span aria-hidden="true">{accepted}/{models.length}</span>
          <span className="visually-hidden">{t.countOf(accepted, models.length)} {t.acceptedWord}</span>
        </p>
      </header>
    <div className="journey-track-run">
      {/* 2026-11-08: the tooltip holds no controls, so it closes the moment the pointer leaves its card; a hoverable
          tooltip kept a grace area over the neighbouring cards and showed card 2's tip while card 1 was hovered. */}
      <Tooltip.Provider delayDuration={300} disableHoverableContent>
        <JourneyTrackList key={instanceId} steps={models} label={t.progress} disabled={disabled} onOpen={onOpen} />
      </Tooltip.Provider>
      <div className={'journey-track-summary' + (allAccepted ? ' is-done' : '')}>
        {allAccepted && <><Check size={12} aria-hidden="true" /><span>{t.allAccepted}</span></>}
        {!allAccepted && !next && <><LockKeyhole size={12} aria-hidden="true" /><span>{t.waitingOn}</span><strong className="journey-track-wait" title={waitingTitle}>{waitingTitle}</strong></>}
        {next && <><span>{t.next}</span><button type="button" className="journey-track-next" disabled={disabled}
          title={next.card.title} aria-label={next.card.title} onClick={() => onOpen?.(next.card)}>{nextTitle}</button>
          {next.state !== 'planned' && <span className="journey-track-state">· {subCardStateLabel(next.state, lang).toLocaleLowerCase(lang)}</span>}</>}
      </div>
    </div>
  </section>;
}
