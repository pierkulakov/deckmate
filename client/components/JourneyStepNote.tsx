import { Check, ChevronDown, LockKeyhole } from 'lucide-react';
import type { CatalogCard, CatalogJourneyStep, CatalogMember } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { defineText, useLang, useText } from '../i18n.ts';
import { journeyTrackModels } from './JourneyTrack.tsx';
import { JourneyTrackMenu } from './JourneyTrackMenu.tsx';

const text = defineText({
  stepOf: (step: number, total: number) => `Step ${step} of ${total}`,
}, {
  stepOf: (step: number, total: number) => `Шаг ${step} из ${total}`,
});

/**
 * A Sub Card's own Journey step as a quiet footer note: its mini-card, position in the run, the Journey it
 * belongs to and the step menu, all from the same models the Hero's track renders. Non-step cards render nothing.
 */
export function JourneyStepNote({ card, cards, steps, title, version, description, cardsById, members, disabled = false, onOpen, onOpenJourney, source, journeyPath }: {
  card: CatalogCard; cards: CatalogCard[]; steps: CatalogJourneyStep[]; title: string; version: number;
  description?: string; cardsById: ReadonlyMap<string, CatalogCard>; members?: CatalogMember[];
  disabled?: boolean; onOpen?: (card: CatalogCard) => void; onOpenJourney?: () => void;
  /** With the Journey's index path, the note offers the step instruction the hidden "Journey step:" link led to. */
  source?: DataSource; journeyPath?: string;
}) {
  const t = useText(text);
  const lang = useLang();
  // Radix owns the trigger's data-state (open/closed), so the step state lives in data-step-state for the CSS.
  if (!card.journey) return null;
  const { models } = journeyTrackModels(cards, steps, cardsById, lang);
  const index = models.findIndex(model => model.card.id === card.id);
  if (index < 0) return null;
  const model = models[index];
  const stepOf = t.stepOf(index + 1, models.length);
  const fullTitle = `${title} v${version} · ${stepOf} · ${model.title} · ${model.stateLabel}`;
  // 2026-11-09: the step file sits beside the Journey's index.md (as in JourneyPanel); the link opens in DocumentPreview.
  const instructionPath = journeyPath && /(^|\/)index\.md$/u.test(journeyPath)
    ? journeyPath.replace(/index\.md$/u, `steps/${card.journey.stepId}.md`) : undefined;
  const instructionHref = source && instructionPath ? `/api/file?source=${source}&path=${encodeURIComponent(instructionPath)}` : undefined;
  return <div className="journey-step-note">
    <JourneyTrackMenu title={title} version={version} description={description} members={members} steps={models}
      disabled={disabled} onOpen={onOpen} onOpenJourney={onOpenJourney} instructionHref={instructionHref}>
      <button type="button" className="journey-step-note-button" data-step-state={model.state}
        data-next={model.next || undefined} aria-haspopup="menu" title={fullTitle} disabled={disabled}>
        <span className="journey-track-face" aria-hidden="true">
          {model.state === 'accepted' && <Check size={9} strokeWidth={3.2} />}
          {model.state === 'blocked' && <LockKeyhole size={9} />}
          {model.state !== 'accepted' && model.state !== 'blocked' && index + 1}
        </span>
        <span className="journey-step-note-text">{stepOf} · <strong>{model.title}</strong> · {title}{' '}
          <span className="journey-step-note-version">v{version}</span></span>
        <ChevronDown size={12} className="journey-step-note-chevron" aria-hidden="true" />
      </button>
    </JourneyTrackMenu>
  </div>;
}
