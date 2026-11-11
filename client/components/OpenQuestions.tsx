import { readStoredValue } from '../storage.ts';
import { storedMemberId } from '../current-member.ts';
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertCircle, Check, ListChecks, LoaderCircle, Send, UserRound, X } from 'lucide-react';
import { deckAcceptsCard, type CatalogCard, type CatalogOpenQuestion, type CatalogView } from '../../src/catalog-contracts.ts';
import { resolveReference, shortReference } from '../../src/references.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { Button } from './ui/button.tsx';
import { defineText, textNow, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import type { Root, RootContent } from 'mdast';
import { openQuestionsOf } from '../../src/open-questions.ts';
import { parseEditorMarkdown } from '../editor-checklists.ts';
import { Markdown } from './Markdown.tsx';
import '../open-questions.css';

const text = defineText({
  linkNotConfirmed: 'The task link is not confirmed in the updated card. Check the catalog message and retry with the same taskCardId.',
  choosePersonDeck: 'Choose a person and a deck that accepts Task.',
  otherTask: 'The item already references another task that is not in the catalog. Fix the link in Markdown first.',
  notConfirmed: 'Action not confirmed. Check the catalog message; retrying uses the same task.',
  saveUnconfirmed: 'Could not confirm the save. Retry: the task ID is preserved.',
  answerRequired: 'Enter an answer — it will become an item in the “Resolved” section.',
  noAuthor: 'The project registry has no person whose name can record the decision.',
  chooseAuthor: 'Choose a person to record the decision',
  actingAs: 'Acting as',
  answerNotSaved: 'Answer not recorded. Check the catalog message and that the question is current; the answer text is preserved.',
  recordUnconfirmed: 'Could not confirm the entry. The answer text is preserved; try again.',
  section: (count: number) => `Open · ${count}`,
  open: 'Open',
  emptyQuestion: 'Empty question — text is required in Markdown.',
  openTask: (title: string) => `Open task: ${title}`,
  decision: 'Decision',
  toHand: 'To Hand',
  answer: 'Answer',
  answerLabel: 'Answer to question',
  answerPlaceholder: 'Decision for the “Resolved” section…',
  answerHint: (author: string | null) => `Enter / Ctrl+Enter — record · Esc — cancel${author ? ` · author: ${author}` : ''}`,
  cancel: 'Cancel',
  saving: 'Saving…',
  record: 'Record',
  readOnly: 'This source is read-only. Open the test copy from the source menu in the top bar — questions and answers are saved there.',
  raiseTitle: 'To Hand…',
  closeRaise: 'Close “To Hand” window',
  member: 'Member',
  noPeople: 'No people in the registry',
  deck: 'Deck',
  noDecks: 'No decks for Task',
  taskDeck: 'Task',
  mixedDeck: 'Mixed',
  raiseNote: 'A Task called “Decision” will be created: the selected person becomes its owner, the task appears in their Hand, and the link appears in the question item.',
  retryId: 'Retry ID is preserved',
  retryAction: 'Retry',
}, {
  linkNotConfirmed: 'Ссылка на задачу не подтверждена в обновлённой карточке. Проверьте сообщение каталога и повторите с тем же taskCardId.',
  choosePersonDeck: 'Выберите человека и колоду, принимающую Task.',
  otherTask: 'В пункте уже указана другая задача, которой нет в каталоге. Сначала исправьте ссылку в Markdown.',
  notConfirmed: 'Действие не подтверждено. Проверьте сообщение каталога; повтор использует ту же задачу.',
  saveUnconfirmed: 'Не удалось подтвердить сохранение. Повторите: идентификатор задачи сохранён.',
  answerRequired: 'Введите ответ — он станет пунктом раздела «Решено».',
  noAuthor: 'В реестре проекта нет человека, от имени которого можно записать решение.',
  chooseAuthor: 'Выберите человека для записи решения',
  actingAs: 'От имени',
  answerNotSaved: 'Ответ не записан. Проверьте сообщение каталога и актуальность вопроса; текст ответа сохранён.',
  recordUnconfirmed: 'Не удалось подтвердить запись. Текст ответа сохранён; повторите действие.',
  section: (count: number) => `Открыто · ${count}`,
  open: 'Открыто',
  emptyQuestion: 'Пустой вопрос — нужен текст в Markdown.',
  openTask: (title: string) => `Открыть задачу: ${title}`,
  decision: 'Решение',
  toHand: 'В Hand',
  answer: 'Ответить',
  answerLabel: 'Ответ на вопрос',
  answerPlaceholder: 'Решение для раздела «Решено»…',
  answerHint: (author: string | null) => `Enter / Ctrl+Enter — записать · Esc — отмена${author ? ` · автор: ${author}` : ''}`,
  cancel: 'Отмена',
  saving: 'Сохраняем…',
  record: 'Записать',
  readOnly: 'Источник открыт только для чтения. Откройте тестовую копию через меню источника в верхней полосе — вопросы и ответы сохраняются туда.',
  raiseTitle: 'В Hand…',
  closeRaise: 'Закрыть окно «В Hand»',
  member: 'Участник',
  noPeople: 'Нет людей в реестре',
  deck: 'Колода',
  noDecks: 'Нет колод для Task',
  taskDeck: 'Task',
  mixedDeck: 'Mixed',
  raiseNote: 'Создастся Task «Решение»: исполнитель — выбранный человек, задача появится в его Hand, а ссылка — в пункте вопроса.',
  retryId: 'ID повтора сохраняется',
  retryAction: 'Повторить',
});

const decisionDeckStorageKey = 'deckmate-open-question-deck';

interface RaiseDraft {
  questionIndex: number;
  questionText: string;
  taskCardId: string;
  memberId: string;
  deckId: string;
}

interface AnswerDraft {
  memberId: string;
  questionIndex: number;
  questionText: string;
  answer: string;
}

interface OpenQuestionsProps {
  card: CatalogCard;
  catalog: CatalogView;
  writable: boolean;
  disabled: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>;
  onSelect: (card: CatalogCard) => void;
  onActiveChange: (active: boolean) => void;
  source?: 'live' | 'sandbox';
}

// 2026-11-11: move recognized items in the presentation tree only; original offsets keep unrelated checkboxes writable.
export function questionReadingTree(tree: Root): Root {
  const questions = openQuestionsOf(tree).questions;
  if (!questions) return tree;
  const starts = new Set(questions.map(question => question.start));
  const children = tree.children.flatMap<RootContent>(node => {
    if (node.type !== 'list') return [node];
    const remaining = node.children.filter(item => !starts.has(item.position?.start.offset ?? -1));
    return remaining.length ? [{ ...node, children: remaining }] : [];
  });
  const heading = children.findIndex(node => node.type === 'heading' && openQuestionsOf({ type: 'root', children: [node] }).questions !== null);
  const next = children[heading + 1];
  if (heading >= 0 && (!next || (next.type === 'heading' && next.depth <= 2))) children.splice(heading, 1);
  return { ...tree, children };
}

function decisionDecks(catalog: CatalogView) {
  return catalog.decks.filter(deck => deckAcceptsCard(deck.kind, 'task'));
}

function initialDecisionDeck(catalog: CatalogView): string {
  const available = decisionDecks(catalog);
  try {
    const stored = readStoredValue(localStorage, decisionDeckStorageKey);
    if (stored && available.some(deck => deck.id === stored)) return stored;
  } catch { /* Private browsing must not block deck selection in the current window. */ }
  const productionSpaceIds = new Set(catalog.spaces
    .filter(space => space.kind === 'tasks' || space.title.trim().toLocaleLowerCase('ru') === 'production')
    .map(space => space.id));
  return (available.find(deck => deck.kind === 'task' && productionSpaceIds.has(deck.spaceId))
    ?? available.find(deck => deck.kind === 'task') ?? available[0])?.id ?? '';
}

function taskForReference(catalog: CatalogView, reference: string | null): CatalogCard | null {
  if (!reference) return null;
  try { return resolveReference(catalog.cards, 'c', reference); }
  catch { return null; }
}

export function OpenQuestions({ card, catalog, writable, disabled, onEdit, onSelect, onActiveChange, source = 'sandbox' }: OpenQuestionsProps) {
  const t = useText(text);
  const [raiseDraft, setRaiseDraft] = useState<RaiseDraft | null>(null);
  const [raiseSaving, setRaiseSaving] = useState(false);
  const [raiseChecking, setRaiseChecking] = useState(false);
  const [raiseError, setRaiseError] = useState('');
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [answerError, setAnswerError] = useState('');
  const raiseInFlight = useRef(false);
  const answerInFlight = useRef(false);
  const answerField = useRef<HTMLTextAreaElement>(null);
  const memberField = useRef<HTMLSelectElement>(null);
  const questions = card.kind === 'doc' ? card.openQuestions : null;
  const humans = (catalog.members ?? []).filter(member => member.kind === 'human');
  const availableDecks = decisionDecks(catalog);
  const locked = disabled || raiseSaving || answerSaving;
  const active = Boolean(answerDraft || raiseDraft) || raiseSaving || raiseChecking || answerSaving;
  const [expanded, setExpanded] = useState(true);
  const { parsed, items } = useMemo(() => {
    const tree = parseEditorMarkdown(card.markdown);
    return { parsed: openQuestionsOf(tree).questions, items: tree.children.flatMap(node => node.type === 'list' ? node.children : []) };
  }, [card.markdown]);

  useEffect(() => {
    onActiveChange(active);
    return () => onActiveChange(false);
  }, [active, onActiveChange]);

  useEffect(() => {
    if (answerDraft) moveFocus(answerField.current);
  }, [answerDraft?.questionIndex, answerDraft?.questionText]);

  // A 200 response can still describe a partially saved raise-decision. The refreshed projection is the verdict:
  // close only when the new task reference is present; otherwise keep the same id for a safe retry.
  useEffect(() => {
    if (!raiseDraft || !raiseChecking) return;
    const question = card.openQuestions?.[raiseDraft.questionIndex];
    const expectedReference = shortReference('c', raiseDraft.taskCardId);
    if (question?.text === raiseDraft.questionText && question.taskRef === expectedReference) {
      setRaiseDraft(null);
      setRaiseChecking(false);
      setRaiseError('');
      return;
    }
    const partialWarning = catalog.warnings.find(warning => warning.includes('Действие выполнено частично'));
    setRaiseError(partialWarning ?? textNow(text).linkNotConfirmed);
    setRaiseChecking(false);
  }, [card.openQuestions, catalog.warnings, raiseChecking, raiseDraft]);

  if (!questions || (!questions.length && !card.openQuestionWarnings?.length)) return null;

  function openRaise(question: CatalogOpenQuestion, questionIndex: number) {
    if (locked || !writable) return;
    const linkedTask = taskForReference(catalog, question.taskRef);
    setAnswerDraft(null);
    setAnswerError('');
    setRaiseError('');
    setRaiseChecking(false);
    setRaiseDraft({
      questionIndex,
      questionText: question.text,
      taskCardId: linkedTask?.id ?? 'card:' + crypto.randomUUID(),
      memberId: humans[0]?.id ?? '',
      deckId: initialDecisionDeck(catalog),
    });
  }

  function closeRaise() {
    if (raiseSaving || raiseInFlight.current) return;
    setRaiseDraft(null);
    setRaiseChecking(false);
  }

  function changeRaise(changes: Partial<Pick<RaiseDraft, 'memberId' | 'deckId'>>) {
    setRaiseDraft(current => current ? { ...current, ...changes } : null);
    setRaiseError('');
    if (changes.deckId) {
      try { localStorage.setItem(decisionDeckStorageKey, changes.deckId); }
      catch { /* The choice remains active until the window closes, even without localStorage. */ }
    }
  }

  async function saveRaise() {
    if (!raiseDraft || raiseInFlight.current || locked || raiseChecking || !writable) return;
    if (!raiseDraft.memberId || !raiseDraft.deckId) {
      setRaiseError(t.choosePersonDeck);
      return;
    }
    const question = card.openQuestions?.[raiseDraft.questionIndex];
    if (question?.taskRef && question.taskRef !== shortReference('c', raiseDraft.taskCardId)) {
      setRaiseError(t.otherTask);
      return;
    }
    raiseInFlight.current = true;
    setRaiseSaving(true);
    setRaiseError('');
    let saved = false;
    try {
      saved = await onEdit({ action: 'raise-decision', cardId: card.id, sourceHash: card.sourceHash,
        questionIndex: raiseDraft.questionIndex, questionText: raiseDraft.questionText,
        taskCardId: raiseDraft.taskCardId, deckId: raiseDraft.deckId, memberId: raiseDraft.memberId });
      if (!saved) setRaiseError(t.notConfirmed);
    } catch {
      setRaiseError(t.saveUnconfirmed);
    } finally {
      raiseInFlight.current = false;
      setRaiseSaving(false);
    }
    if (saved) setRaiseChecking(true);
  }

  function openAnswer(question: CatalogOpenQuestion, questionIndex: number) {
    if (locked || !writable) return;
    setRaiseDraft(null);
    setRaiseError('');
    setAnswerError('');
    const author = humans.find(member => member.id === storedMemberId());
    setAnswerDraft({ questionIndex, questionText: question.text, answer: '', memberId: author?.id ?? '' });
  }

  function cancelAnswer() {
    if (answerSaving || answerInFlight.current) return;
    setAnswerDraft(null);
    setAnswerError('');
  }

  async function saveAnswer() {
    if (!answerDraft || answerInFlight.current || locked || !writable) return;
    const answer = answerDraft.answer.trim();
    if (!answer) { setAnswerError(t.answerRequired); return; }
    const author = humans.find(member => member.id === answerDraft.memberId);
    if (!author) { setAnswerError(humans.length ? t.chooseAuthor : t.noAuthor); return; }
    answerInFlight.current = true;
    setAnswerSaving(true);
    setAnswerError('');
    try {
      const saved = await onEdit({ action: 'record-decision', cardId: card.id, sourceHash: card.sourceHash,
        questionIndex: answerDraft.questionIndex, questionText: answerDraft.questionText, answer, memberId: author.id });
      if (saved) setAnswerDraft(null);
      else setAnswerError(t.answerNotSaved);
    } catch {
      setAnswerError(t.recordUnconfirmed);
    } finally {
      answerInFlight.current = false;
      setAnswerSaving(false);
    }
  }

  function answerKeys(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelAnswer();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      // Enter and Ctrl+Enter save a single-line decision; Shift+Enter inserts a draft line break.
      event.preventDefault();
      void saveAnswer();
    }
  }

  const raiseQuestion = raiseDraft ? card.openQuestions?.[raiseDraft.questionIndex] : undefined;
  const raiseReferenceConflict = Boolean(raiseDraft && raiseQuestion?.taskRef
    && raiseQuestion.taskRef !== shortReference('c', raiseDraft.taskCardId));

  return <section className="open-questions" aria-label={t.section(questions.length)}>
    <button type="button" className="open-questions-heading" aria-expanded={expanded || active} disabled={active} onClick={() => setExpanded(value => !value)}><span>{t.open}</span><span className="open-questions-count">{questions.length}</span></button>
    {(card.openQuestionWarnings?.length ?? 0) > 0 && <ul className="open-question-warnings">
      {card.openQuestionWarnings!.map((warning, warningIndex) => <li key={warningIndex}><AlertCircle size={13} aria-hidden="true" /><span>{warning}</span></li>)}
    </ul>}
    <div hidden={!expanded && !active}>
    {questions.length > 0 && <ul className="open-questions-list">
      {questions.map((question, questionIndex) => {
        const task = taskForReference(catalog, question.taskRef);
        const item = items.find(item => item.position?.start.offset === parsed?.[questionIndex]?.start);
        const answering = answerDraft?.questionIndex === questionIndex && answerDraft.questionText === question.text;
        return <li className="open-question" key={questionIndex}>
          <div className="open-question-row">
            <div className="open-question-text">{item
              ? <Markdown tree={{ type: 'root', children: [{ type: 'list', ordered: false, spread: false, children: [item] }] }} rawMarkdown={card.markdown} projectTags={catalog.projectTags} source={source} path={card.path} members={catalog.members} cards={catalog.cards} onOpenCard={onSelect} />
              : question.text || t.emptyQuestion}</div>
            <div className="open-question-actions">
              {task && <Button type="button" variant="ghost" size="sm" className="open-question-task" disabled={locked}
                title={task.title} aria-label={t.openTask(task.title)} onClick={() => onSelect(task)}><ListChecks size={14} /><span>{t.decision}</span></Button>}
              {writable && <><Button type="button" variant="ghost" size="sm" disabled={locked} onClick={() => openRaise(question, questionIndex)}><UserRound size={14} />{t.toHand}</Button>
                <Button type="button" variant="ghost" size="sm" disabled={locked} aria-expanded={answering} onClick={() => openAnswer(question, questionIndex)}>{t.answer}</Button></>}
            </div>
          </div>
          {answering && answerDraft && <div className="open-question-answer">
            <label><span>{t.actingAs}</span><select value={answerDraft.memberId} disabled={locked} aria-label={t.actingAs}
              onChange={event => {
                const memberId = event.target.value;
                setAnswerDraft(current => current ? { ...current, memberId } : null);
                setAnswerError('');
              }}>
              <option value="">—</option>
              {humans.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
            </select></label>
            {!answerDraft.memberId && <p style={{ overflowWrap: 'anywhere' }}>{humans.length ? t.chooseAuthor : t.noAuthor}</p>}
            <label><span className="visually-hidden">{t.answerLabel}</span><textarea ref={answerField} value={answerDraft.answer} rows={3} maxLength={200000}
              placeholder={t.answerPlaceholder} disabled={locked} onChange={event => {
                const answer = event.target.value;
                setAnswerDraft(current => current ? { ...current, answer } : null);
                setAnswerError('');
              }} onKeyDown={answerKeys} /></label>
            {answerError && <p className="open-question-error" role="alert">{answerError}</p>}
            <div className="open-question-answer-footer"><span>{t.answerHint(humans.find(member => member.id === answerDraft.memberId)?.label ?? null)}</span>
              <Button type="button" variant="ghost" size="sm" disabled={answerSaving} onClick={cancelAnswer}>{t.cancel}</Button>
              <Button type="button" size="sm" disabled={locked || !answerDraft.answer.trim() || !humans.some(member => member.id === answerDraft.memberId)} onClick={() => void saveAnswer()}>
                {answerSaving ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{answerSaving ? t.saving : t.record}
              </Button>
            </div>
          </div>}
        </li>;
      })}
    </ul>}
    {!writable && <p className="open-questions-readonly">{t.readOnly}</p>}
    </div>

    {raiseDraft && <Dialog.Root open onOpenChange={open => { if (!open) closeRaise(); }}><Dialog.Portal>
      <Dialog.Overlay className="open-questions-overlay" />
      <Dialog.Content className="open-questions-dialog" aria-busy={raiseSaving || raiseChecking}
        onOpenAutoFocus={event => { event.preventDefault(); moveFocus(memberField.current); }}
        onEscapeKeyDown={event => { if (raiseSaving || raiseChecking) event.preventDefault(); }}
        onPointerDownOutside={event => { if (raiseSaving || raiseChecking) event.preventDefault(); }}>
        <header className="open-questions-dialog-heading"><Dialog.Title>{t.raiseTitle}</Dialog.Title>
          <Button type="button" variant="ghost" size="icon" disabled={raiseSaving || raiseChecking} aria-label={t.closeRaise} onClick={closeRaise}><X size={16} /></Button>
        </header>
        <Dialog.Description className="open-questions-dialog-question">{raiseDraft.questionText}</Dialog.Description>
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void saveRaise(); }}>
          <div className="open-questions-dialog-fields">
            <label><span>{t.member}</span><select ref={memberField} value={raiseDraft.memberId} disabled={locked || raiseChecking}
              onChange={event => changeRaise({ memberId: event.target.value })}>
              {humans.length === 0 && <option value="">{t.noPeople}</option>}
              {humans.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
            </select></label>
            <label><span>{t.deck}</span><select value={raiseDraft.deckId} disabled={locked || raiseChecking}
              onChange={event => changeRaise({ deckId: event.target.value })}>
              {availableDecks.length === 0 && <option value="">{t.noDecks}</option>}
              {availableDecks.map(deck => <option key={deck.id} value={deck.id}>{deck.title} · {deck.kind === 'task' ? t.taskDeck : t.mixedDeck}</option>)}
            </select></label>
          </div>
          <p className="open-questions-dialog-note">{t.raiseNote}</p>
          {raiseReferenceConflict && <p className="open-question-error" role="alert">{t.otherTask}</p>}
          {raiseError && <p className="open-question-error" role="alert">{raiseError}</p>}
          <footer className="open-questions-dialog-footer"><span>{t.retryId}</span>
            <Button type="button" variant="ghost" size="sm" disabled={raiseSaving || raiseChecking} onClick={closeRaise}>{t.cancel}</Button>
            <Button type="submit" size="sm" disabled={locked || raiseChecking || !raiseDraft.memberId || !raiseDraft.deckId || raiseReferenceConflict}>
              {raiseSaving || raiseChecking ? <LoaderCircle size={13} className="spin" /> : <Send size={13} />}{raiseError ? t.retryAction : t.toHand}
            </Button>
          </footer>
        </form>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>}
  </section>;
}
