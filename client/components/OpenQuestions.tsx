import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import { AlertCircle, ArrowUpRight, CircleCheck, CircleDashed, MessageCircle, MessageCircleQuestion, MessageSquareReply } from 'lucide-react';
import type { ListItem, Root, RootContent } from 'mdast';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { isCardSectionBoundary, isDecisionTaskLink, openQuestionsOf } from '../../src/open-questions.ts';
import { shortReference } from '../../src/references.ts';
import { markerWords } from '../../src/format-vocabulary.ts';
import { storedMemberId } from '../current-member.ts';
import { parseEditorMarkdown } from '../editor-checklists.ts';
import { markdownText } from '../card-word-count.ts';
import { defineText, useLang, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { copyText } from '../clipboard.ts';
import { formatShortcut, primaryModifierPressed, shortcutAria } from '../shortcut-format.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { decisionsOf, questionsOf, targetDetails, type Decision, type Question } from '../question-model.ts';
import { Button } from './ui/button.tsx';
import { CardOwnerAvatar } from './CardOwnerAvatar.tsx';
import { Markdown } from './Markdown.tsx';
import '../card-value-hint.css';
import '../open-questions.css';

const text = defineText({
  panel: 'Questions and decisions', open: 'Open', decisions: 'Decisions', answer: 'Answer', discuss: 'Copy question ID', ask: 'Ask a question…',
  noQuestions: 'No open questions.', emptyQuestion: 'Empty question', thisCard: 'this card',
  copied: 'Question ID copied. Paste it into a chat.', copyFailed: 'Could not copy. Select the question ID and copy it manually.', copyReference: 'Question ID to copy',
  answerLabel: 'Answer to question', answerPlaceholder: 'Decision…', questionLabel: 'Question', questionPlaceholder: 'Your question…',
  member: 'To', nobody: 'No one', target: 'Where to apply', searchCards: 'Search cards', section: 'Section (optional)',
  noResults: 'No matching cards.', author: 'By', chooseAuthor: 'Choose a person', noAuthor: 'The project registry has no person who can record the decision.',
  addressedTo: (name: string) => `Question addressed to ${name}; check the answer author below.`,
  sectionHint: 'Use the section identifier, for example working-notes for “Working notes”. Leave empty to target the whole card.',
  pendingHint: 'After editing the target, confirm the change separately through the CLI or with an agent. The agent is not started automatically.',
  appliedOn: (date: string) => `Applied: ${date}`,
  cancel: 'Cancel', save: 'Save', send: 'Ask', saving: 'Saving…',
  answerRequired: 'Enter an answer.', questionRequired: 'Enter a question.',
  notSaved: 'Not saved. Check the catalog message and try again; your text is preserved.',
  stale: 'The card changed. Review your draft before using the current version.', useCurrent: 'Use current version',
  changedQuestion: 'The question changed. Copy your answer before closing this form.',
  readOnly: 'This source is read-only.', toApply: 'to apply', applied: 'applied',
  shortcut: (save: string, escape: string) => `${save} — save · ${escape} — cancel`,
}, {
  panel: 'Вопросы и решения', open: 'Открытые', decisions: 'Решения', answer: 'Ответить', discuss: 'Скопировать ID вопроса', ask: 'Задать вопрос…',
  noQuestions: 'Нет открытых вопросов.', emptyQuestion: 'Пустой вопрос', thisCard: 'эта карточка',
  copied: 'ID вопроса скопирован. Вставьте его в чат.', copyFailed: 'Не удалось скопировать. Выделите ID вопроса и скопируйте вручную.', copyReference: 'ID вопроса для копирования',
  answerLabel: 'Ответ на вопрос', answerPlaceholder: 'Решение…', questionLabel: 'Вопрос', questionPlaceholder: 'Ваш вопрос…',
  member: 'Кому', nobody: 'Никому', target: 'Куда внести', searchCards: 'Поиск карточки', section: 'Раздел (необязательно)',
  noResults: 'Карточки не найдены.', author: 'От имени:', chooseAuthor: 'Выберите человека', noAuthor: 'В реестре проекта нет человека для записи решения.',
  addressedTo: (name: string) => `Вопрос адресован ${name}; проверьте автора ответа ниже.`,
  sectionHint: 'Укажите идентификатор раздела, например working-notes для «Working notes». Без него цель — вся карточка.',
  pendingHint: 'После изменения цели подтвердите внесение отдельно через CLI или с помощью агента. Агент автоматически не запускается.',
  appliedOn: (date: string) => `Внесено: ${date}`,
  cancel: 'Отмена', save: 'Записать', send: 'Спросить', saving: 'Записываю…',
  answerRequired: 'Введите ответ.', questionRequired: 'Введите вопрос.',
  notSaved: 'Не сохранено. Проверьте сообщение каталога и повторите; текст сохранён.',
  stale: 'Карточка изменилась. Проверьте черновик перед использованием актуальной версии.', useCurrent: 'Использовать актуальную версию',
  changedQuestion: 'Вопрос изменился. Скопируйте ответ перед закрытием формы.',
  readOnly: 'Источник открыт только для чтения.', toApply: 'к внесению', applied: 'внесено',
  shortcut: (save: string, escape: string) => `${save} — записать · ${escape} — отмена`,
});

interface AnswerDraft { questionIndex: number; question: Question; answer: string; memberId: string; sourceHash: string }
interface AskDraft { text: string; assignee: string; targetId: string; section: string; search: string; sourceHash: string }
interface Props {
  id?: string; card: CatalogCard; catalog: CatalogView; writable: boolean; disabled: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>; onSelect: (card: CatalogCard) => void;
  onActiveChange: (active: boolean) => void; source?: 'live' | 'sandbox';
}

function matchesAnswerQuestion(draft: AnswerDraft, questions: readonly Question[]): boolean {
  const question = questions[draft.questionIndex];
  return Boolean(question && question.text === draft.question.text
    && (question.assignee ?? null) === (draft.question.assignee ?? null)
    && (question.target ?? null) === (draft.question.target ?? null));
}

// Move only the presentation nodes; source offsets remain usable for unrelated checkboxes.
export function questionReadingTree(tree: Root): Root {
  const questions = openQuestionsOf(tree).questions;
  if (!questions) return tree;
  const starts = new Set(questions.map(question => question.start));
  const resolved = new Set(resolvedNodes(tree));
  const children = tree.children.filter(node => !resolved.has(node)).flatMap<RootContent>(node => {
    if (node.type !== 'list') return [node];
    const remaining = node.children.filter(item => !starts.has(item.position?.start.offset ?? -1));
    return remaining.length ? [{ ...node, children: remaining }] : [];
  });
  const heading = children.findIndex(node => node.type === 'heading' && openQuestionsOf({ type: 'root', children: [node] }).questions !== null);
  const next = children[heading + 1];
  if (heading >= 0 && (!next || (next.type === 'heading' && next.depth <= 2))) children.splice(heading, 1);
  return { ...tree, children };
}

function resolvedNodes(tree: Root): RootContent[] {
  if (openQuestionsOf(tree).questions === null) return [];
  const titles = markerWords('decided').map(title => title.toLocaleLowerCase());
  const start = tree.children.findIndex(node => node.type === 'heading' && node.depth === 2 && titles.includes(markdownText(node).trim().toLocaleLowerCase()));
  if (start < 0) return [];
  let end = start + 1;
  while (end < tree.children.length && !isCardSectionBoundary(tree.children[end])) end++;
  return tree.children.slice(start, end);
}

function withoutTaskLink(item: ListItem): RootContent[] {
  return item.children.map(child => {
    if (child.type !== 'paragraph') return child;
    const children = child.children.filter(node => !(node.type === 'link' && isDecisionTaskLink(node.url)));
    const last = children[children.length - 1];
    if (last?.type === 'text') children[children.length - 1] = { ...last, value: last.value.replace(/\s*[—–-]\s*$/u, '') };
    return { ...child, children };
  }) as RootContent[];
}

export function DecisionStatus({ decision, card, catalog, source, onSelect, disabled = false }: {
  decision: Decision; card: CatalogCard; catalog: CatalogView; source: 'live' | 'sandbox'; onSelect: (card: CatalogCard) => void; disabled?: boolean;
}) {
  const t = useText(text);
  const lang = useLang();
  if (!decision.applied) return <span className="decision-status is-pending"><CircleDashed size={14} aria-hidden="true" />{t.toApply}</span>;
  const target = targetDetails(decision.target, card, catalog, lang);
  if (target.isCurrent || !target.reference) return <span className="decision-status"><CircleCheck size={14} aria-hidden="true" />{t.applied}</span>;
  return <a className="decision-status decision-applied" href={targetHref(target, source)} title={target.label} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
    onMouseDown={event => { if (disabled) event.preventDefault(); }}
    onClick={event => openTarget(event, target, onSelect, disabled)}><CircleCheck size={14} aria-hidden="true" />{t.applied}</a>;
}

function decodeSection(section: string) { try { return decodeURIComponent(section); } catch { return section; } }

type Target = ReturnType<typeof targetDetails>;

function targetHref(target: Target, source: 'live' | 'sandbox') {
  const fragment = target.section ? '#' + encodeURIComponent(decodeSection(target.section)) : '';
  return `/r/${target.reference}?source=${source}${fragment}`;
}

function openTarget(event: MouseEvent<HTMLAnchorElement>, target: Target, onSelect: (card: CatalogCard) => void, disabled: boolean) {
  if (disabled) { event.preventDefault(); return; }
  if (target.card && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onSelect(target.card); }
}

function QuestionTarget({ target, source, onSelect, disabled }: {
  target: Target; source: 'live' | 'sandbox'; onSelect: (card: CatalogCard) => void; disabled: boolean;
}) {
  if (target.isCurrent) return null;
  if (!target.reference) return <span className="open-question-target">{target.caption}</span>;
  return <a className="open-question-target" href={targetHref(target, source)} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : undefined}
    onMouseDown={event => { if (disabled) event.preventDefault(); }}
    onClick={event => openTarget(event, target, onSelect, disabled)}><span>{target.caption}</span><ArrowUpRight size={12} aria-hidden="true" /></a>;
}

export function OpenQuestions({ id, card, catalog, writable, disabled, onEdit, onSelect, onActiveChange, source = 'sandbox' }: Props) {
  const t = useText(text);
  const lang = useLang();
  const sectionHintId = useId();
  const [answerDraft, setAnswerDraft] = useState<AnswerDraft | null>(null);
  const [askDraft, setAskDraft] = useState<AskDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copyFeedback, setCopyFeedback] = useState<{ index: number; questionText: string; message: string; reference?: string } | null>(null);
  const inFlight = useRef(false);
  const copySequence = useRef(0);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const field = useRef<HTMLTextAreaElement>(null);
  const container = useRef<HTMLElement>(null);
  const returnFocus = useRef<{ questionIndex?: number } | null>(null);
  const questions = questionsOf(card);
  const currentQuestions = useRef(questions);
  currentQuestions.current = questions;
  const visibleCopyFeedback = copyFeedback && questions[copyFeedback.index]?.text === copyFeedback.questionText ? copyFeedback : null;
  const decisions = useMemo(() => decisionsOf(card), [card]);
  const humans = (catalog.members ?? []).filter(member => member.kind === 'human');
  const locked = disabled || saving;
  const active = Boolean(answerDraft || askDraft || saving);
  const answerVisible = Boolean(answerDraft && matchesAnswerQuestion(answerDraft, questions));
  const tree = useMemo(() => parseEditorMarkdown(card.markdown), [card.markdown]);
  const parsed = useMemo(() => openQuestionsOf(tree).questions, [tree]);
  const items = useMemo(() => tree.children.flatMap(node => node.type === 'list' ? node.children : []), [tree]);
  const shortcut = { key: 'Enter', modifiers: ['primary'] } as const;
  useEffect(() => { onActiveChange(active); return () => onActiveChange(false); }, [active, onActiveChange]);
  useEffect(() => {
    setCopyFeedback(null);
    return () => { copySequence.current++; clearTimeout(copyTimer.current); };
  }, [card.id]);
  useEffect(() => { if (answerDraft || askDraft) moveFocus(field.current); }, [Boolean(answerDraft), Boolean(askDraft), answerVisible]);
  useEffect(() => {
    if (active || !returnFocus.current) return;
    const index = returnFocus.current.questionIndex;
    const button = index === undefined ? container.current?.querySelector<HTMLButtonElement>('.open-question-ask-action')
      : container.current?.querySelectorAll<HTMLButtonElement>('.open-question-answer-action')[index];
    returnFocus.current = null;
    moveFocus(button ?? container.current?.querySelector<HTMLButtonElement>('.open-question-ask-action'));
  }, [active]);

  function closeDraft() {
    if (inFlight.current) return;
    returnFocus.current = answerDraft ? { questionIndex: answerDraft.questionIndex } : {};
    setAnswerDraft(null); setAskDraft(null); setError('');
  }
  function clearCopyFeedback() {
    copySequence.current++;
    clearTimeout(copyTimer.current);
    setCopyFeedback(null);
  }
  function openAnswer(question: Question, index: number) {
    if (locked || !writable) return;
    const author = humans.find(member => member.id === storedMemberId());
    setAnswerDraft({ questionIndex: index, question: { ...question }, answer: '', memberId: author?.id ?? '', sourceHash: card.sourceHash });
    setError(''); clearCopyFeedback();
  }
  async function copyQuestion(index: number) {
    const sequence = ++copySequence.current;
    const questionText = questions[index]?.text;
    if (questionText === undefined) return;
    clearTimeout(copyTimer.current);
    setCopyFeedback(null);
    const reference = `${shortReference('c', card.id)}#${index + 1}`;
    const copied = await copyText(reference);
    if (sequence !== copySequence.current || currentQuestions.current[index]?.text !== questionText) return;
    if (copied) {
      setCopyFeedback({ index, questionText, message: t.copied });
      copyTimer.current = setTimeout(() => setCopyFeedback(null), 1500);
    } else setCopyFeedback({ index, questionText, message: t.copyFailed, reference });
  }
  async function submit() {
    if (inFlight.current || locked || !writable) return;
    if (answerDraft && !answerDraft.answer.trim()) { setError(t.answerRequired); return; }
    if (askDraft && !askDraft.text.trim()) { setError(t.questionRequired); return; }
    if (answerDraft && !humans.some(member => member.id === answerDraft.memberId)) { setError(t.noAuthor); return; }
    if (answerDraft && !answerVisible) { setError(t.changedQuestion); return; }
    const draft = answerDraft ?? askDraft;
    if (!draft || draft.sourceHash !== card.sourceHash) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      let action: CatalogAction;
      if (answerDraft) action = { action: 'record-decision', cardId: card.id, sourceHash: answerDraft.sourceHash,
        questionIndex: answerDraft.questionIndex, questionText: answerDraft.question.text, answer: answerDraft.answer.trim(), memberId: answerDraft.memberId };
      else if (askDraft) {
        const section = askDraft.section.trim();
        const target = askDraft.targetId !== card.id || section ? shortReference('c', askDraft.targetId) + (section ? '#' + encodeURIComponent(section) : '') : undefined;
        action = { action: 'ask-question', cardId: card.id, sourceHash: askDraft.sourceHash, text: askDraft.text.trim(), assignee: askDraft.assignee || null, ...(target ? { target } : {}) };
      } else return;
      if (await onEdit(action)) { returnFocus.current = {}; setAnswerDraft(null); setAskDraft(null); }
      else setError(t.notSaved);
    } catch { setError(t.notSaved); }
    finally { inFlight.current = false; setSaving(false); }
  }
  function keys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDraft(); }
    else if (event.key === 'Enter' && primaryModifierPressed(event)) { event.preventDefault(); void submit(); }
  }
  const draft = answerDraft ?? askDraft;
  const sameQuestion = !answerDraft || answerVisible;
  const stale = Boolean(draft && (draft.sourceHash !== card.sourceHash || !sameQuestion));
  const answerAuthor = answerDraft && humans.find(member => member.id === answerDraft.memberId);
  const answerAssigneeId = answerDraft?.question.assignee;
  const answerAssignee = answerAssigneeId && (catalog.members?.find(member => member.id === answerAssigneeId)?.label ?? answerAssigneeId);
  const submitLabel = answerDraft ? t.save : t.send;
  const matchingCards = askDraft ? catalog.cards.filter(candidate => !candidate.deleted && !candidate.archived
    && candidate.title.toLocaleLowerCase().includes(askDraft.search.trim().toLocaleLowerCase())) : [];

  const formFooter = <>
    {stale && !saving && <p className="open-question-error" role="alert">{sameQuestion ? t.stale : t.changedQuestion}</p>}
    {error && <p className="open-question-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{error}</p>}
    <div className="open-question-answer-footer" data-saving={saving || undefined}>
      {answerDraft && humans.length === 0 && <p className="open-question-author">{t.noAuthor}</p>}
      {answerDraft && humans.length === 1 && answerAuthor && <p className="open-question-author">{t.author}<span>{answerAuthor.label}</span></p>}
      {answerDraft && humans.length > 0 && (humans.length > 1 || !answerAuthor) && <label className="open-question-author">{t.author}<select className="control-field" value={answerDraft.memberId} disabled={locked} onChange={event => setAnswerDraft({ ...answerDraft, memberId: event.target.value })}>
        {!answerAuthor && <option value={answerDraft.memberId} disabled>{t.chooseAuthor}</option>}
        {humans.map(member => <option key={member.id} value={member.id}>{member.label}</option>)}
      </select></label>}
      <span className="open-question-answer-buttons"><Button type="button" variant="ghost" size="sm" disabled={saving} onClick={closeDraft}>{t.cancel}</Button>
        {stale && !saving ? <Button type="button" size="sm" disabled={!sameQuestion} onClick={() => {
          setAnswerDraft(value => value && matchesAnswerQuestion(value, questions) ? { ...value, sourceHash: card.sourceHash } : value);
          setAskDraft(value => value && { ...value, sourceHash: card.sourceHash }); setError('');
        }}>{t.useCurrent}</Button> : <Button type="submit" size="sm" disabled={locked || (answerDraft ? !answerDraft.answer.trim() || !answerAuthor : !askDraft?.text.trim())}
          aria-busy={saving || undefined} aria-keyshortcuts={shortcutAria(shortcut)} title={t.shortcut(formatShortcut(shortcut).display, formatShortcut({ key: 'Escape' }).display)}>
          {saving ? t.saving : submitLabel}</Button>}
      </span>
    </div>
    <span className="visually-hidden" role="status">{saving ? t.saving : ''}</span>
  </>;
  const answerForm = answerDraft && <form className="open-question-answer" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(); }} onKeyDown={keys}>
    <label className="open-question-field"><span className="visually-hidden">{t.answerLabel}</span><textarea ref={field} className="control-field" value={answerDraft.answer} rows={3} maxLength={200000} placeholder={t.answerPlaceholder} disabled={locked} onChange={event => { setAnswerDraft({ ...answerDraft, answer: event.target.value }); setError(''); }} /></label>
    {answerAssignee && <p className="open-question-hint">{t.addressedTo(answerAssignee)}</p>}
    {formFooter}
  </form>;

  return <section ref={container} id={id} className="open-questions" aria-label={t.panel}>
    {(card.openQuestionWarnings?.length ?? 0) > 0 && <ul className="open-question-warnings">{card.openQuestionWarnings!.map((warning, index) => <li key={index}><AlertCircle size={13} aria-hidden="true" />{warning}</li>)}</ul>}
    <h3 className="questions-section-title">{t.open} <span className="page-number">{questions.length}</span></h3>
    {questions.length === 0 ? <p className="open-questions-empty">{t.noQuestions}</p> : <Tooltip.Provider><ul className="open-questions-list">{questions.map((question, index) => {
      const item = items.find(candidate => candidate.position?.start.offset === parsed?.[index]?.start);
      const answering = answerVisible && answerDraft?.questionIndex === index;
      const target = targetDetails(question.target, card, catalog, lang);
      const assignee = question.assignee && ((catalog.members ?? []).find(member => member.id === question.assignee)?.label ?? question.assignee);
      return <li className="open-question" key={index}>
        <div className="open-question-row"><div className="open-question-text">{item && !question.assignee && !question.target
          ? <Markdown tree={{ type: 'root', children: withoutTaskLink(item) }} rawMarkdown={card.markdown} projectTags={catalog.projectTags} source={source} path={card.path} members={catalog.members} cards={catalog.cards} onOpenCard={onSelect} />
          : question.text || t.emptyQuestion}</div>
          {(assignee || !target.isCurrent) && <div className="open-question-meta">
            {assignee && <span className="open-question-assignee"><CardOwnerAvatar owner={question.assignee ?? null} members={catalog.members ?? []} />@{assignee}</span>}
            <QuestionTarget target={target} source={source} onSelect={onSelect} disabled={locked || active} />
          </div>}
          {visibleCopyFeedback?.index === index && visibleCopyFeedback.reference && <label className="open-question-field open-question-copy-reference"><span>{t.copyFailed}</span><input className="control-field" aria-label={t.copyReference} readOnly value={visibleCopyFeedback.reference} onFocus={event => event.currentTarget.select()} /></label>}
          {!active && <div className="open-question-actions">{writable && <Button type="button" variant="ghost" size="sm" className="open-question-answer-action" disabled={locked} onClick={() => openAnswer(question, index)}><MessageSquareReply size={16} aria-hidden="true" />{t.answer}</Button>}
            <Tooltip.Root open={visibleCopyFeedback?.index === index}><Tooltip.Trigger asChild>
              <Button type="button" variant="ghost" size="sm" className="open-question-discuss-action" disabled={disabled} onClick={() => void copyQuestion(index)}><MessageCircle size={16} aria-hidden="true" />{t.discuss}</Button>
            </Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="card-value-tooltip open-question-feedback" side="top" sideOffset={6} collisionPadding={8}
              onEscapeKeyDown={clearCopyFeedback}>{visibleCopyFeedback?.message}</Tooltip.Content></Tooltip.Portal></Tooltip.Root></div>}
        </div>
        {answering && answerForm}
      </li>;
    })}</ul></Tooltip.Provider>}
    {answerDraft && !answerVisible && <div className="open-question-orphan"><p className="open-question-text">{answerDraft.question.text}</p>{answerForm}</div>}
    <span className="visually-hidden" aria-live="polite" aria-atomic="true">{visibleCopyFeedback?.message ?? ''}</span>
    {decisions.length > 0 && <section className="open-questions-resolved"><h3 className="questions-section-title">{t.decisions} <span className="page-number">{decisions.length}</span></h3>{decisions.some(decision => !decision.applied) && <p className="open-question-hint pending-hint">{t.pendingHint}</p>}<ul className="resolved-list">{decisions.map((decision, index) => <li className="resolved-item" key={decision.index ?? index}>
      {decision.question && <p className="resolved-question">{decision.question} →</p>}
      <div className="resolved-decision"><Markdown tree={decision.nodes ? { type: 'root', children: decision.nodes } : parseEditorMarkdown(decision.answer)} rawMarkdown={decision.nodes ? card.markdown : decision.answer} source={source} path={card.path} members={catalog.members} cards={catalog.cards} onOpenCard={onSelect} /></div>
      <QuestionTarget target={targetDetails(decision.target, card, catalog, lang)} source={source} onSelect={onSelect} disabled={locked || active} />
      <div className="resolved-attribution">{(decision.by || decision.date) && <span>{[decision.by, decision.date].filter(Boolean).join(' · ')}</span>}<DecisionStatus decision={decision} card={card} catalog={catalog} source={source} onSelect={onSelect} disabled={locked || active} />{decision.applied && <span>{t.appliedOn(decision.applied)}</span>}</div>
    </li>)}</ul></section>}
    {!writable && <p className="open-questions-readonly">{t.readOnly}</p>}
    {writable && !active && <Button type="button" variant="ghost" size="sm" className="open-question-ask-action" disabled={locked} onClick={() => {
      setError(''); clearCopyFeedback(); setAskDraft({ text: '', assignee: '', targetId: card.id, section: '', search: '', sourceHash: card.sourceHash });
    }}><MessageCircleQuestion size={16} aria-hidden="true" />{t.ask}</Button>}
    {askDraft && <form className="open-question-ask" onSubmit={(event: FormEvent) => { event.preventDefault(); void submit(); }} onKeyDown={keys}>
      <label className="open-question-field"><span>{t.questionLabel}</span><textarea ref={field} className="control-field" value={askDraft.text} rows={3} maxLength={200000} placeholder={t.questionPlaceholder} disabled={locked} onChange={event => setAskDraft({ ...askDraft, text: event.target.value })} /></label>
      <label className="open-question-field"><span>{t.member}</span><select className="control-field" value={askDraft.assignee} disabled={locked} onChange={event => setAskDraft({ ...askDraft, assignee: event.target.value })}><option value="">{t.nobody}</option>{(catalog.members ?? []).map(member => <option key={member.id} value={member.id}>@{member.label}</option>)}</select></label>
      <label className="open-question-field"><span>{t.searchCards}</span><input type="search" className="control-field" value={askDraft.search} disabled={locked} onChange={event => setAskDraft({ ...askDraft, search: event.target.value })} /></label>
      <label className="open-question-field"><span>{t.target}</span><select className="control-field" value={askDraft.targetId} disabled={locked} onChange={event => setAskDraft({ ...askDraft, targetId: event.target.value })}>
        <option value={card.id}>{t.thisCard}</option>{matchingCards.filter(candidate => candidate.id !== card.id).map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.title}</option>)}
        {askDraft.targetId !== card.id && !matchingCards.some(candidate => candidate.id === askDraft.targetId) && <option value={askDraft.targetId}>{catalog.cards.find(candidate => candidate.id === askDraft.targetId)?.title ?? askDraft.targetId}</option>}
      </select></label>
      {askDraft.search && matchingCards.length === 0 && <p className="open-questions-empty">{t.noResults}</p>}
      <label className="open-question-field"><span>{t.section}</span><input className="control-field" value={askDraft.section} disabled={locked} aria-describedby={sectionHintId} onChange={event => setAskDraft({ ...askDraft, section: event.target.value })} /><span id={sectionHintId} className="open-question-hint">{t.sectionHint}</span></label>
      {formFooter}
    </form>}
  </section>;
}
