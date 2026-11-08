import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, FileText, LockKeyhole, Route } from 'lucide-react';
import type { ReactNode } from 'react';
import type { CatalogCard, CatalogMember } from '../../src/catalog-contracts.ts';
import type { SubCardVisualState } from '../sub-card-state.ts';
import { defineText, useText } from '../i18n.ts';
import { CardOwnerAvatar, memberForOwner } from './CardOwnerAvatar.tsx';

export const journeyTrackText = defineText({
  progress: 'Journey progress',
  acceptedWord: 'accepted',
  countOf: (accepted: number, total: number) => `${accepted} of ${total}`,
  next: 'Next:',
  allAccepted: 'All steps accepted',
  waitingOn: 'Waiting on:',
  stepsLabel: 'Journey steps',
  after: (names: string) => `after ${names}`,
  waiting: (name: string) => `Waiting: ${name}`,
  noOwner: 'No owner',
  openJourney: 'Open Journey',
  openInstruction: 'Open step instruction',
  openMenu: (title: string) => `${title}: steps`,
}, {
  progress: 'Исполнение Journey',
  acceptedWord: 'принято',
  countOf: (accepted: number, total: number) => `${accepted} из ${total}`,
  next: 'Далее:',
  allAccepted: 'Все шаги приняты',
  waitingOn: 'Ждёт:',
  stepsLabel: 'Шаги Journey',
  after: (names: string) => `после ${names}`,
  waiting: (name: string) => `Ждёт: ${name}`,
  noOwner: 'Без исполнителя',
  openJourney: 'Открыть Journey',
  openInstruction: 'Открыть инструкцию шага',
  openMenu: (title: string) => `${title}: шаги`,
});

export interface JourneyTrackStepModel {
  card: CatalogCard;
  state: SubCardVisualState;
  description: string;
  next: boolean;
  title: string;
  owner: string | null;
  dependencies: string[];
  stateLabel: string;
}

// The trigger is the caller's own button (the Hero's title or a Sub Card's step note), so each surface keeps its look.
export function JourneyTrackMenu({ children, title, version, description, members = [], steps, disabled, onOpen, onOpenJourney, instructionHref }: {
  children: ReactNode;
  /** The current step's instruction file, offered where the menu belongs to one Sub Card. */
  instructionHref?: string;
  title: string;
  version: number;
  description?: string;
  members?: CatalogMember[];
  steps: JourneyTrackStepModel[];
  disabled: boolean;
  onOpen?: (card: CatalogCard) => void;
  onOpenJourney?: () => void;
}) {
  const t = useText(journeyTrackText);
  const accepted = steps.filter(step => step.state === 'accepted').length;
  return <DropdownMenu.Root modal={false}>
    <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      {/* The instruction link opens DocumentPreview, a dialog that takes focus: the menu then closes without pulling it back. */}
      <DropdownMenu.Content className="journey-track-menu" align="start" sideOffset={6} collisionPadding={12} aria-label={t.stepsLabel}
        onCloseAutoFocus={event => { if (document.activeElement?.closest('[role="dialog"]')) event.preventDefault(); }}>
        <DropdownMenu.Label className="journey-track-menu-header">
          <div className="journey-track-menu-title">
            <Route size={15} aria-hidden="true" />
            <span className="journey-track-menu-title-text" title={title}>{title}</span>
            <span className="journey-track-menu-version">v{version}</span>
          </div>
          {description && <p className="journey-track-menu-description">{description}</p>}
          <div className="journey-track-menu-summary">
            <span className="journey-track-menu-count" aria-hidden="true"><strong>{accepted}/{steps.length}</strong> {t.acceptedWord}</span>
            <span className="visually-hidden">{t.countOf(accepted, steps.length)} {t.acceptedWord}</span>
            <span className="journey-track-menu-progress" aria-hidden="true">
              {steps.map(step => <span key={step.card.id} className={step.state === 'accepted' ? 'is-accepted' : undefined} />)}
            </span>
          </div>
        </DropdownMenu.Label>
        <div className="journey-track-menu-steps">
          {steps.map((step, index) => {
            const member = memberForOwner(step.owner, members);
            const owner = member?.label ?? (step.owner?.trim() ? step.owner : t.noOwner);
            const after = step.dependencies.length ? t.after(step.dependencies.join(', ')) : '';
            const fullTitle = `${index + 1}. ${step.title} · ${owner}${after ? ` · ${after}` : ''} · ${step.stateLabel}`;
            return <DropdownMenu.Item key={step.card.id} className="journey-track-menu-step" data-state={step.state}
              data-next={step.next || undefined} title={fullTitle} onSelect={() => onOpen?.(step.card)}>
              <span className="journey-track-face" aria-hidden="true">
                {step.state === 'accepted' && <Check size={11} strokeWidth={3.2} />}
                {step.state === 'blocked' && <LockKeyhole size={11} />}
                {step.state !== 'accepted' && step.state !== 'blocked' && index + 1}
              </span>
              <span className="journey-track-menu-step-text">
                <span className="journey-track-menu-step-name">{index + 1}. {step.title}</span>
                <span className="journey-track-menu-step-meta">
                  <CardOwnerAvatar owner={step.owner} members={members} />
                  <span>{owner}</span>{after && <span> · {after}</span>}
                </span>
              </span>
              <span className="journey-track-menu-step-state" data-state={step.state}>{step.stateLabel}</span>
            </DropdownMenu.Item>;
          })}
        </div>
        {(onOpenJourney || instructionHref) && <div className="journey-track-menu-footer">
          {/* 2026-11-09: a plain /api/file link, so the app's DocumentPreview opens the step file like any Markdown link. */}
          {instructionHref && <DropdownMenu.Item asChild className="journey-track-menu-open journey-track-menu-instruction">
            <a href={instructionHref}><FileText size={14} aria-hidden="true" /><span>{t.openInstruction}</span></a>
          </DropdownMenu.Item>}
          {onOpenJourney && <DropdownMenu.Item className="journey-track-menu-open" onSelect={onOpenJourney}>
            <Route size={14} aria-hidden="true" /><span>{t.openJourney}</span>
          </DropdownMenu.Item>}
        </div>}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
