import { useState } from 'react';
import type { CatalogAction } from '../useCatalog.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { SliceStatus } from '../../src/workspace-contracts.ts';
import { lessonMaxLength } from '../../src/journey-lessons.ts';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import '../journey-return.css';

const text = defineText({
  returnGroup: 'Return from Review',
  why: 'Why was it returned?',
  placeholder: 'Briefly, optional',
  lessonAvailable: 'The line goes to the step’s Lessons section and its next Tasks',
  lessonUnavailable: 'This card’s step is no longer in the Journey',
  addLesson: 'Add to step lessons',
  withoutReason: 'No reason',
  return: 'Return',
}, {
  returnGroup: 'Возврат с приёмки',
  why: 'Почему вернули?',
  placeholder: 'Коротко, по желанию',
  lessonAvailable: 'Строка уйдёт в раздел «Грабли» шага и попадёт в его следующие Task',
  lessonUnavailable: 'Шага этой карточки больше нет в Journey',
  addLesson: 'Добавить в грабли шага',
  withoutReason: 'Без причины',
  return: 'Вернуть',
});

// When a Journey card leaves review without acceptance, ask for a return reason below the state buttons.
// Enter returns it with a reason; Escape returns it without one. Both change the state.
// The pitfalls checkbox appends the reason to the step's pitfalls for the next agent run.

export interface JourneyReturnAnswer { reason: string; addLesson: boolean }

export function isJourneyReturn(card: CatalogCard, state: SliceStatus): boolean {
  return Boolean(card.journey) && card.state === 'review' && state !== 'review' && state !== 'done';
}

/** Target step for this card's pitfalls; null means the Journey or step was removed. */
function lessonTarget(card: CatalogCard, catalog: CatalogView) {
  const journey = card.journey && catalog.journeys?.find(candidate => candidate.id === card.journey!.journeyId);
  return journey && journey.steps.some(step => step.id === card.journey!.stepId) ? journey : null;
}

/** Build the step-pitfall action; null means no reason, no checkbox or no target step. */
export function journeyLessonAction(card: CatalogCard, catalog: CatalogView, answer: JourneyReturnAnswer): CatalogAction | null {
  const journey = lessonTarget(card, catalog);
  if (!answer.reason || !answer.addLesson || !journey || !card.journey) return null;
  return { action: 'add-journey-step-lesson', journeyId: journey.id, journeyHash: journey.fileHash, stepId: card.journey.stepId, cardId: card.id, text: answer.reason };
}

export function JourneyReturnPrompt({ card, catalog, busy, onAnswer }: {
  card: CatalogCard; catalog: CatalogView; busy: boolean; onAnswer: (answer: JourneyReturnAnswer) => void;
}) {
  const [reason, setReason] = useState('');
  const t = useText(text);
  const [addLesson, setAddLesson] = useState(true);
  const lessonAvailable = lessonTarget(card, catalog) !== null;
  const confirm = () => onAnswer({ reason: reason.replace(/\s+/gu, ' ').trim(), addLesson: addLesson && lessonAvailable });
  const skip = () => onAnswer({ reason: '', addLesson: false });
  return <div className="journey-return" role="group" aria-label={t.returnGroup}>
    <label className="journey-return-reason"><span>{t.why}</span>
      <input autoFocus value={reason} maxLength={lessonMaxLength} disabled={busy} placeholder={t.placeholder}
        onChange={event => setReason(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); confirm(); }
          // Escape skips the reason without closing the card.
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); skip(); }
        }} /></label>
    <label className="journey-return-lesson" title={lessonAvailable ? t.lessonAvailable : t.lessonUnavailable}>
      <input type="checkbox" checked={addLesson && lessonAvailable} disabled={busy || !lessonAvailable} onChange={event => setAddLesson(event.target.checked)} />
      <span>{t.addLesson}</span>
    </label>
    <div className="journey-return-actions">
      <Button type="button" variant="ghost" size="sm" disabled={busy} title="Esc" onClick={skip}>{t.withoutReason}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy} title="Enter" onClick={confirm}>{t.return}</Button>
    </div>
  </div>;
}
