import { useEffect, useRef, useState } from 'react';
import type { CatalogAction } from '../useCatalog.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import type { SliceStatus } from '../../src/workspace-contracts.ts';
import { lessonMaxLength } from '../../src/journey-lessons.ts';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import '../journey-return.css';

const text = defineText({
  returnGroup: 'Return from Review',
  why: 'What needs changing? (required)',
  placeholder: 'Briefly describe the changes',
  lessonAvailable: 'The line goes to the step’s Lessons section and its next Tasks',
  lessonUnavailable: 'This card’s step is no longer in the Journey',
  addLesson: 'Add to step lessons',
  cancel: 'Cancel',
  return: 'Return',
}, {
  returnGroup: 'Возврат с приёмки',
  why: 'Что нужно исправить? (обязательно)',
  placeholder: 'Кратко опишите исправления',
  lessonAvailable: 'Строка уйдёт в раздел «Грабли» шага и попадёт в его следующие Task',
  lessonUnavailable: 'Шага этой карточки больше нет в Journey',
  addLesson: 'Добавить в грабли шага',
  cancel: 'Отмена',
  return: 'Вернуть',
});

// 2026-11-10: feedback is required for ordinary Tasks too; Journey lessons remain a separate, optional write.

export interface ReviewReturnAnswer { reason: string; addLesson: boolean }

export function isReviewReturn(card: CatalogCard, state: SliceStatus): boolean {
  return card.kind === 'task' && card.state === 'review' && state !== 'review' && state !== 'done';
}

/** Target step for this card's pitfalls; null means the Journey or step was removed. */
function lessonTarget(card: CatalogCard, catalog: CatalogView) {
  const journey = card.journey && catalog.journeys?.find(candidate => candidate.id === card.journey!.journeyId);
  return journey && journey.steps.some(step => step.id === card.journey!.stepId) ? journey : null;
}

/** Build the step-pitfall action; null means no reason, no checkbox or no target step. */
export function journeyLessonAction(card: CatalogCard, catalog: CatalogView, answer: ReviewReturnAnswer): CatalogAction | null {
  const journey = lessonTarget(card, catalog);
  if (!answer.reason || !answer.addLesson || !journey || !card.journey) return null;
  return { action: 'add-journey-step-lesson', journeyId: journey.id, journeyHash: journey.fileHash, stepId: card.journey.stepId, cardId: card.id, text: answer.reason };
}

export function ReviewReturnPrompt({ card, catalog, busy, blocked = false, error, onAnswer, onCancel }: {
  card: CatalogCard; catalog: CatalogView; busy: boolean; blocked?: boolean; error?: string; onAnswer: (answer: ReviewReturnAnswer) => void; onCancel: () => void;
}) {
  const [reason, setReason] = useState('');
  const reasonInput = useRef<HTMLInputElement>(null);
  const t = useText(text);
  const [addLesson, setAddLesson] = useState(true);
  const lessonAvailable = lessonTarget(card, catalog) !== null;
  const normalizedReason = reason.replace(/\s+/gu, ' ').trim();
  const validReason = Boolean(normalizedReason) && normalizedReason.length <= lessonMaxLength;
  const confirm = () => { if (!busy && !blocked && validReason) onAnswer({ reason: normalizedReason, addLesson: addLesson && lessonAvailable }); };
  useEffect(() => {
    // 2026-11-10: a failed save must not leave keyboard focus on the document behind the disabled form.
    if (!busy && error) moveFocus(reasonInput.current, { preventScroll: true });
  }, [busy, error]);
  return <div className="journey-return" role="group" aria-label={t.returnGroup}>
    {error && <p role="alert">{error}</p>}
    <label className="journey-return-reason"><span>{t.why}</span>
      <input ref={reasonInput} className="control-field" autoFocus required value={reason} maxLength={lessonMaxLength} disabled={busy} placeholder={t.placeholder}
        onChange={event => setReason(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); confirm(); }
        }} /></label>
    {card.journey && <label className="journey-return-lesson" title={lessonAvailable ? t.lessonAvailable : t.lessonUnavailable}>
      <input type="checkbox" checked={addLesson && lessonAvailable} disabled={busy || !lessonAvailable} onChange={event => setAddLesson(event.target.checked)} />
      <span>{t.addLesson}</span>
    </label>}
    <div className="journey-return-actions">
      <Button type="button" variant="ghost" size="sm" disabled={busy} title="Esc" onClick={onCancel}>{t.cancel}</Button>
      <Button type="button" variant="outline" size="sm" disabled={busy || blocked || !validReason} title="Enter" onClick={confirm}>{t.return}</Button>
    </div>
  </div>;
}
