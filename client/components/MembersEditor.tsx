// One registry holds humans and agents under the local sandbox/live trust model, without permission roles.
// The configure-members action replaces the whole list in the catalog YAML with one request.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, Trash2, UserPlus, X } from 'lucide-react';
import type { CatalogMember, CatalogView } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { catalogStore, withCatalogFormHash } from '../catalog-store.ts';
import { EmptyState } from './EmptyState.tsx';
import { ErrorState } from './ErrorState.tsx';
import { LoadingState } from './LoadingState.tsx';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { Button } from './ui/button.tsx';
import { moveFocus } from '../focus.ts';
import '../surface.css';
import '../members-editor.css';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { emitSignal } from '../onboarding/signals.ts';
import { prepareEntrance } from '../prepared-motion.ts';
import { useSelectEscapeGuard } from '../select-escape.ts';

const text = defineText({
  registryLimit: 'The registry is limited to one hundred members.',
  invalidId: (id: string) => `ID “${id || 'empty'}” must use Latin letters, digits and hyphens, up to 80 characters, starting with a letter or digit.`,
  duplicateId: (id: string) => `ID “${id}” is duplicated.`, missingName: (id: string) => `Member ${id} has no name.`,
  longName: (label: string) => `Name “${label}” exceeds 80 characters.`, aliasesLimit: (label: string) => `${label} has more than thirty aliases.`,
  longAlias: (alias: string) => `Alias “${alias}” exceeds 80 characters.`, duplicateName: (value: string) => `Name “${value}” matches two members — keep it for one.`,
  heading: 'Members', description: 'Project people and agents: name, kind and aliases. The registry supports Owner, Hand and open decisions.',
  close: 'Close members', readOnly: 'This source is read-only. Switch to the test copy in the top bar to save the registry there.',
  readOnlyProject: 'This project is read-only. Editing the member registry is unavailable.',
  conflict: 'The registry changed in the files.', projectChanged: 'The project or source changed while this draft was open.', warning: 'Saving needs checking',
  review: 'Your draft is kept below. Re-read to replace it with the file version before editing again.',
  reread: 'Re-read and replace draft', rereading: 'Re-reading…',
  loading: 'Opening catalog…', empty: 'The registry is empty. Add people and agents to enable Owner selection, Hands and decision acceptance.',
  emptyTitle: 'No members yet', emptyReadOnly: 'Members appear here once the project has them.',
  name: 'Name', namePlaceholder: 'Alex or GLM', memberName: (id: string) => 'Member name ' + id,
  newId: 'New member ID', immutableId: 'IDs cannot change: Hands and cards reference them', kind: 'Kind', memberKind: (id: string) => 'Member kind ' + id,
  human: 'Human', agent: 'Agent', aliases: 'Aliases', aliasesPlaceholder: 'comma-separated', memberAliases: (id: string) => 'Member aliases ' + id,
  remove: (name: string) => 'Remove member ' + name, add: 'Add member', checkRegistry: 'Check the registry:', unsaved: ' · unsaved changes',
  moreErrors: (count: string) => `${count} more errors`,
  cancel: 'Cancel', closeDraft: 'Close', discard: 'Discard changes', save: 'Save',
}, {
  registryLimit: 'Реестр ограничен ста участниками.',
  invalidId: (id: string) => `ID «${id || 'пусто'}» — латиница, цифры и дефис, до 80 знаков, с буквы или цифры.`,
  duplicateId: (id: string) => `ID «${id}» повторяется.`, missingName: (id: string) => `У участника ${id} нет имени.`,
  longName: (label: string) => `Имя «${label}» длиннее 80 знаков.`, aliasesLimit: (label: string) => `У ${label} больше тридцати псевдонимов.`,
  longAlias: (alias: string) => `Псевдоним «${alias}» длиннее 80 знаков.`, duplicateName: (value: string) => `Имя «${value}» подходит двум участникам — оставьте одно.`,
  heading: 'Участники', description: 'Люди и агенты проекта: имя, вид и псевдонимы. Реестр нужен для выбора исполнителя, Hand и ответов на открытые вопросы.',
  close: 'Закрыть участников', readOnly: 'Источник открыт только для чтения. Переключитесь на тестовую копию в верхней полосе — реестр сохраняется туда.',
  readOnlyProject: 'Проект открыт только для чтения. Изменение реестра участников недоступно.',
  conflict: 'Реестр изменился в файлах.', projectChanged: 'Проект или источник изменился, пока был открыт черновик.', warning: 'Сохранение требует проверки',
  review: 'Черновик сохранён ниже. Перечитайте реестр, чтобы заменить черновик версией из файла перед дальнейшей правкой.',
  reread: 'Перечитать и заменить черновик', rereading: 'Перечитываем…',
  loading: 'Открываем каталог…', empty: 'Реестр пуст. Добавьте людей и агентов — появятся выбор исполнителя, Hand и приём решений.',
  emptyTitle: 'Участников пока нет', emptyReadOnly: 'Участники появятся здесь, когда они будут в проекте.',
  name: 'Имя', namePlaceholder: 'Анна или GLM', memberName: (id: string) => 'Имя участника ' + id,
  newId: 'ID нового участника', immutableId: 'ID неизменяем: на него ссылаются Hand и карточки', kind: 'Вид', memberKind: (id: string) => 'Вид участника ' + id,
  human: 'Человек', agent: 'Агент', aliases: 'Псевдонимы', aliasesPlaceholder: 'через запятую', memberAliases: (id: string) => 'Псевдонимы участника ' + id,
  remove: (name: string) => 'Удалить участника ' + name, add: 'Добавить участника', checkRegistry: 'Проверьте реестр:', unsaved: ' · есть несохранённые правки',
  moreErrors: (count: string) => `Ещё ошибок: ${count}`,
  cancel: 'Отмена', closeDraft: 'Закрыть', discard: 'Отменить изменения', save: 'Сохранить',
});

const idPattern = /^[a-z0-9][a-z0-9-]{0,79}$/u;
// Technical IDs use Latin letters; transliterate Russian names to keep IDs readable.
const translit: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };

function slugify(label: string): string {
  const slug = label.trim().toLocaleLowerCase('ru-RU').split('').map(char => translit[char] ?? char).join('')
    .replace(/[^a-z0-9-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
  return slug || 'member';
}

function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let number = 2; number < 100; number += 1) {
    const candidate = `${base.slice(0, 77)}-${number}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 66)}-${crypto.randomUUID().slice(0, 8)}`;
}

interface MemberDraft {
  key: string;
  id: string;
  /** Editing the ID disables name-based slug updates, since unexpected ID changes would break hand links. */
  idEdited: boolean;
  label: string;
  kind: 'agent' | 'human';
  aliases: string;
  isNew: boolean;
}

function toDraft(members: readonly CatalogMember[]): MemberDraft[] {
  return members.map(member => ({ key: member.id, id: member.id, idEdited: true, label: member.label,
    kind: member.kind, aliases: member.aliases.join(', '), isNew: false }));
}

function parseAliases(text: string): string[] {
  return [...new Set(text.split(',').map(alias => alias.trim()).filter(Boolean))];
}

type MemberField = 'name' | 'id' | 'aliases';
interface MemberIssue { key?: string; field?: MemberField; message: string }

function validate(draft: readonly MemberDraft[]): MemberIssue[] {
  const t = textNow(text);
  const errors: MemberIssue[] = [];
  if (draft.length > 100) errors.push({ message: t.registryLimit });
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const row of draft) {
    const add = (field: MemberField, message: string) => errors.push({ key: row.key, field, message });
    if (!idPattern.test(row.id)) add('id', t.invalidId(row.id));
    if (ids.has(row.id)) add('id', t.duplicateId(row.id));
    ids.add(row.id);
    const label = row.label.trim();
    if (!label) add('name', t.missingName(row.id));
    if (label.length > 80) add('name', t.longName(label));
    const aliases = parseAliases(row.aliases);
    if (aliases.length > 30) add('aliases', t.aliasesLimit(label || row.id));
    for (const alias of aliases) if (alias.length > 80) add('aliases', t.longAlias(alias));
    // Match validateMembers in server/catalog.ts: duplicate names make Owner references ambiguous.
    const values: Array<{ value: string; field: MemberField }> = [
      { value: label, field: 'name' }, ...aliases.map(value => ({ value, field: 'aliases' as const })),
    ];
    for (const { value, field } of values.filter(entry => entry.value)) {
      const key = value.toLocaleLowerCase('ru-RU');
      const previous = names.get(key);
      if (previous !== undefined && previous !== row.id) add(field, t.duplicateName(value));
      names.set(key, row.id);
    }
  }
  return errors;
}

function FieldIssues({ id, issues }: { id: string; issues: readonly MemberIssue[] }) {
  if (issues.length === 0) return null;
  return <span id={id} className="members-editor-field-errors">{issues.map((issue, index) => <span key={index}>{issue.message}</span>)}</span>;
}

export function MembersEditor({ snapshot, refreshKey, open, onOpenChange, onCloseAutoFocus }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  useSelectEscapeGuard();
  const t = useText(text);
  const lang = useLang();
  const idPrefix = useId();
  const catalog = useCatalog(snapshot, refreshKey);
  const store = catalogStore(snapshot.source);
  const [baseline, setBaseline] = useState<CatalogView | null>(null);
  const [draftSource, setDraftSource] = useState(snapshot.source);
  const [draft, setDraft] = useState<MemberDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reading, setReading] = useState(false);
  const [conflicted, setConflicted] = useState(false);
  const [outcome, setOutcome] = useState<{ error: string | null; warning: string | null } | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const addedMember = useRef<string | null>(null);
  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const busy = catalog.pending || saving || reading;
  const changed = dirty && baseline !== null && catalog.catalog !== null
    && (baseline.rootIdentity !== catalog.catalog.rootIdentity || baseline.manifestHash !== catalog.catalog.manifestHash);
  const projectChanged = dirty && (draftSource !== snapshot.source
    || Boolean(baseline && catalog.catalog && baseline.rootIdentity !== catalog.catalog.rootIdentity));
  const conflict = conflicted || projectChanged || (changed && !saving && !outcome?.warning);
  const needsReview = conflict || Boolean(outcome?.warning);
  let noticeTitle = t.warning;
  if (projectChanged) noticeTitle = t.projectChanged;
  else if (conflict) noticeTitle = t.conflict;

  // 2026-11-10: the roster and its hash share a baseline; a watcher refresh must never rebase a dirty form.
  useEffect(() => {
    if (!dirty && catalog.catalog) {
      setBaseline(catalog.catalog);
      setDraft(toDraft(catalog.catalog.members ?? []));
      setDraftSource(snapshot.source);
    }
  }, [catalog.catalog, dirty, snapshot.source]);
  useEffect(() => { if (conflict) setConflicted(true); }, [conflict]);
  // 2026-11-10: disabled fields can lose focus during a request; recovery must leave the person in this form.
  useLayoutEffect(() => {
    if (busy || !restoreFocus.current) return;
    const previous = restoreFocus.current;
    restoreFocus.current = null;
    if (document.activeElement !== document.body && document.activeElement !== previous) return;
    if (previous.isConnected) moveFocus(previous, { preventScroll: true });
    else moveFocus(body.current, { preventScroll: true });
  }, [busy]);
  useLayoutEffect(() => {
    if (!addedMember.current) return;
    const field = document.getElementById(`${idPrefix}-${addedMember.current}-name`);
    if (field) { addedMember.current = null; moveFocus(field); }
  }, [draft, idPrefix]);
  // 2026-11-05: the editor stays mounted (App.tsx); the open prop turning true is the person opening the registry.
  useEffect(() => { if (open) emitSignal({ type: 'panel-opened', panel: 'members' }); }, [open]);

  const errors = validate(draft);
  const errorsByField = new Map<string, MemberIssue[]>();
  if (dirty) for (const issue of errors) {
    if (!issue.key || !issue.field) continue;
    const key = `${issue.key}:${issue.field}`;
    errorsByField.set(key, [...(errorsByField.get(key) ?? []), issue]);
  }
  const fieldId = (key: string, field: MemberField) => `${idPrefix}-${key}-${field}`;
  const issuesFor = (key: string, field: MemberField) => errorsByField.get(`${key}:${field}`) ?? [];
  const previewMembers: CatalogMember[] = draft.map(row => ({ id: row.id, label: row.label.trim() || row.id,
    kind: row.kind, aliases: parseAliases(row.aliases) }));

  function addMember() {
    if (!baseline || busy || draft.length >= 100) return;
    const id = uniqueSlug('member', new Set(draft.map(row => row.id)));
    const key = 'new-' + crypto.randomUUID();
    addedMember.current = key;
    setDraft(rows => [...rows, { key, id, idEdited: false, label: '', kind: 'human', aliases: '', isNew: true }]);
    setDirty(true);
  }

  function updateRow(key: string, patch: Partial<MemberDraft>) {
    setDraft(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
    setDirty(true);
  }

  function updateLabel(key: string, label: string) {
    setDraft(rows => rows.map(row => {
      if (row.key !== key) return row;
      const next = { ...row, label };
      if (row.isNew && !row.idEdited) next.id = uniqueSlug(slugify(label), new Set(rows.filter(other => other.key !== key).map(other => other.id)));
      return next;
    }));
    setDirty(true);
  }

  function removeRow(key: string) {
    setDraft(rows => rows.filter(row => row.key !== key));
    setDirty(true);
  }

  async function save() {
    if (!canWrite || busy || inFlight.current || !dirty || errors.length || !baseline || needsReview) return;
    const latest = store.getSnapshot().catalog;
    if (!latest || latest.rootIdentity !== baseline.rootIdentity || latest.manifestHash !== baseline.manifestHash) { setConflicted(true); return; }
    const members: CatalogMember[] = draft.map(row => ({ id: row.id, label: row.label.trim(), kind: row.kind, aliases: parseAliases(row.aliases) }));
    inFlight.current = true;
    restoreFocus.current = document.activeElement as HTMLElement;
    setSaving(true);
    try {
      const saved = await catalog.edit(withCatalogFormHash({ action: 'configure-members', members }, baseline.manifestHash));
      // 2026-11-10: capture this operation's outcome before a later refresh or another consumer changes the store.
      const result = store.getSnapshot();
      setOutcome({ error: result.error, warning: result.warning });
      if (saved && !result.warning && !result.error) { setDirty(false); onOpenChange(false); }
    } finally { inFlight.current = false; setSaving(false); }
  }

  async function reread() {
    if (busy || inFlight.current) return;
    inFlight.current = true;
    restoreFocus.current = document.activeElement as HTMLElement;
    setReading(true);
    try {
      await catalog.refresh();
      const result = store.getSnapshot();
      setReadError(result.error);
      if (result.error || !result.catalog) return;
      setBaseline(result.catalog);
      setDraft(toDraft(result.catalog.members ?? []));
      setDraftSource(snapshot.source);
      setDirty(false);
      setConflicted(false);
      setOutcome(null);
    } finally { inFlight.current = false; setReading(false); }
  }

  function discard() {
    if (busy || !catalog.catalog) return;
    moveFocus(body.current, { preventScroll: true });
    setBaseline(catalog.catalog);
    setDraft(toDraft(catalog.catalog.members ?? []));
    setDraftSource(snapshot.source);
    setDirty(false);
    setConflicted(false);
    setOutcome(null);
    setReadError(null);
  }

  return <Dialog.Root open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><Dialog.Portal>
    <Dialog.Overlay ref={prepareEntrance} className="dialog-overlay" />
    {/* 2026-11-10: the frame, head, body and foot come from the shared dialog grammar in surface.css. */}
    <Dialog.Content ref={prepareEntrance} className="members-editor dialog-panel" aria-busy={busy} onCloseAutoFocus={onCloseAutoFocus}>
      <header className="members-editor-header dialog-head">
        <div className="members-editor-heading">
          <Dialog.Title className="dialog-title">{t.heading}</Dialog.Title>
          <Dialog.Description className="members-editor-description">{t.description}</Dialog.Description>
        </div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" className="members-editor-close" disabled={busy} aria-label={t.close}><X size={17} /></Button></Dialog.Close>
      </header>
      <div ref={body} className="members-editor-body dialog-body" tabIndex={-1}>
        <ErrorState variant="inline" message={readError || (!outcome && !conflict ? catalog.error : null)} pending={busy}
          onRetry={readError ? reread : catalog.refresh} />
        <ErrorState variant="inline" message={!needsReview ? outcome?.error ?? null : null} pending={busy} onRetry={save} />
        {needsReview && <div className={`members-editor-notice ${conflict ? 'members-editor-conflict' : 'members-editor-warning'}`} role={conflict ? 'alert' : 'status'}>
          <p><strong>{noticeTitle}</strong></p>
          {(outcome?.warning || outcome?.error) && <p>{outcome.warning || outcome.error}</p>}
          <p>{t.review}</p>
          <Button variant="outline" size="sm" aria-disabled={busy} onClick={() => void reread()}>
            {reading && <LoaderCircle size={14} className="spin" />}{reading ? t.rereading : t.reread}
          </Button>
        </div>}
        {!canWrite && <p className="members-editor-note">{snapshot.editMode === 'sandbox' && snapshot.source === 'live' ? t.readOnly : t.readOnlyProject}</p>}
        {!catalog.catalog && catalog.loading && !catalog.error && <LoadingState message={t.loading} />}
        {catalog.catalog && draft.length === 0 && <EmptyState variant="first-run" art="team" title={t.emptyTitle} message={canWrite ? t.empty : t.emptyReadOnly} />}
        {draft.length > 0 && <ul className="members-editor-list">
          {draft.map(row => <li key={row.key} className="members-editor-row">
            <CardOwnerAvatar owner={row.label.trim() || null} members={previewMembers} />
            <label className="members-editor-field members-editor-name"><span>{t.name}</span>
              <input id={fieldId(row.key, 'name')} className="control-field" value={row.label} maxLength={80} placeholder={t.namePlaceholder} disabled={!canWrite || busy}
                aria-label={t.memberName(row.id)} aria-invalid={issuesFor(row.key, 'name').length > 0}
                aria-describedby={issuesFor(row.key, 'name').length ? `${fieldId(row.key, 'name')}-errors` : undefined}
                onChange={event => updateLabel(row.key, event.target.value)} />
              <FieldIssues id={`${fieldId(row.key, 'name')}-errors`} issues={issuesFor(row.key, 'name')} /></label>
            {row.isNew
              ? <label className="members-editor-field members-editor-id"><span>ID</span>
                <input id={fieldId(row.key, 'id')} className="control-field" value={row.id} maxLength={80} disabled={!canWrite || busy} aria-label={t.newId}
                  aria-invalid={issuesFor(row.key, 'id').length > 0} aria-describedby={issuesFor(row.key, 'id').length ? `${fieldId(row.key, 'id')}-errors` : undefined}
                  onChange={event => updateRow(row.key, { id: event.target.value, idEdited: true })} />
                <FieldIssues id={`${fieldId(row.key, 'id')}-errors`} issues={issuesFor(row.key, 'id')} /></label>
              : <span id={fieldId(row.key, 'id')} tabIndex={-1} className="members-editor-id-static" title={t.immutableId}><span>ID</span> {row.id}</span>}
            <label className="members-editor-field members-editor-kind"><span>{t.kind}</span>
              <select className="control-field" value={row.kind} disabled={!canWrite || busy} aria-label={t.memberKind(row.id)}
                onChange={event => updateRow(row.key, { kind: event.target.value as 'agent' | 'human' })}>
                <option value="human">{t.human}</option>
                <option value="agent">{t.agent}</option>
              </select></label>
            <label className="members-editor-field members-editor-aliases"><span>{t.aliases}</span>
              <input id={fieldId(row.key, 'aliases')} className="control-field" value={row.aliases} placeholder={t.aliasesPlaceholder} disabled={!canWrite || busy}
                aria-label={t.memberAliases(row.id)} aria-invalid={issuesFor(row.key, 'aliases').length > 0}
                aria-describedby={issuesFor(row.key, 'aliases').length ? `${fieldId(row.key, 'aliases')}-errors` : undefined}
                onChange={event => updateRow(row.key, { aliases: event.target.value })} />
              <FieldIssues id={`${fieldId(row.key, 'aliases')}-errors`} issues={issuesFor(row.key, 'aliases')} /></label>
            <Button variant="ghost" size="icon" className="members-editor-remove"
              aria-label={t.remove(row.label.trim() || row.id)} disabled={!canWrite || busy}
              onClick={() => removeRow(row.key)}><Trash2 size={15} /></Button>
          </li>)}
        </ul>}
        {canWrite && <Button variant="outline" size="sm" className="members-editor-add" disabled={busy || !baseline || draft.length >= 100} onClick={addMember}>
          <UserPlus size={15} />{t.add}
        </Button>}
        {dirty && errors.length > 0 && <div className="members-editor-errors" role="alert">
          <p>{t.checkRegistry}</p>
          <ul>{errors.slice(0, 6).map((error, index) => <li key={index}>{error.key && error.field
            ? <button type="button" onClick={() => moveFocus(document.getElementById(fieldId(error.key!, error.field!)))}>{error.message}</button>
            : error.message}</li>)}</ul>
          {errors.length > 6 && <p>{t.moreErrors(new Intl.NumberFormat(locale(lang)).format(errors.length - 6))}</p>}
        </div>}
      </div>
      <footer className="members-editor-footer dialog-foot">
        {/* The counter is the gallery's number grammar: Geist Mono tabular digits beside a muted caption. */}
        <span className="members-editor-hint"><span className="page-number">{new Intl.NumberFormat(locale(lang)).format(draft.length)} / 100</span>{dirty ? t.unsaved : ''}</span>
        {dirty && <Button variant="ghost" size="sm" className="members-editor-discard" disabled={busy || !catalog.catalog} onClick={discard}>{t.discard}</Button>}
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>{dirty ? t.closeDraft : t.cancel}</Button>
        <Button size="sm" disabled={!canWrite || !baseline || !dirty || errors.length > 0} aria-disabled={busy || needsReview} onClick={() => void save()}>
          {saving && <LoaderCircle size={14} className="spin" />}{t.save}
        </Button>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
