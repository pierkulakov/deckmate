// One registry holds humans and agents under the local sandbox/live trust model, without permission roles.
// The configure-members action replaces the whole list in the catalog YAML with one request.
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { LoaderCircle, Trash2, UserPlus, X } from 'lucide-react';
import type { CatalogMember } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { CardOwnerAvatar } from './CardQuickSettings.tsx';
import { Button } from './ui/button.tsx';
import '../members-editor.css';
import { defineText, locale, textNow, useLang, useText } from '../i18n.ts';
import { emitSignal } from '../onboarding/signals.ts';

const text = defineText({
  registryLimit: 'The registry is limited to one hundred members.',
  invalidId: (id: string) => `ID “${id || 'empty'}” must use Latin letters, digits and hyphens, up to 80 characters, starting with a letter or digit.`,
  duplicateId: (id: string) => `ID “${id}” is duplicated.`, missingName: (id: string) => `Member ${id} has no name.`,
  longName: (label: string) => `Name “${label}” exceeds 80 characters.`, aliasesLimit: (label: string) => `${label} has more than thirty aliases.`,
  longAlias: (alias: string) => `Alias “${alias}” exceeds 80 characters.`, duplicateName: (value: string) => `Name “${value}” matches two members — keep it for one.`,
  heading: 'Members', description: 'Project people and agents: name, kind and aliases. The registry supports Owner, Hand and open decisions.',
  close: 'Close members', readOnly: 'This source is read-only. Switch to the test copy in the top bar to save the registry there.',
  loading: 'Opening catalog…', empty: 'The registry is empty. Add people and agents to enable Owner selection, Hands and decision acceptance.',
  name: 'Name', namePlaceholder: 'Alex or GLM', memberName: (id: string) => 'Member name ' + id,
  newId: 'New member ID', immutableId: 'IDs cannot change: Hands and cards reference them', kind: 'Kind', memberKind: (id: string) => 'Member kind ' + id,
  human: 'Human', agent: 'Agent', aliases: 'Aliases', aliasesPlaceholder: 'comma-separated', memberAliases: (id: string) => 'Member aliases ' + id,
  remove: (name: string) => 'Remove member ' + name, add: 'Add member', checkRegistry: 'Check the registry:', unsaved: ' · unsaved changes',
  cancel: 'Cancel', save: 'Save',
}, {
  registryLimit: 'Реестр ограничен ста участниками.',
  invalidId: (id: string) => `ID «${id || 'пусто'}» — латиница, цифры и дефис, до 80 знаков, с буквы или цифры.`,
  duplicateId: (id: string) => `ID «${id}» повторяется.`, missingName: (id: string) => `У участника ${id} нет имени.`,
  longName: (label: string) => `Имя «${label}» длиннее 80 знаков.`, aliasesLimit: (label: string) => `У ${label} больше тридцати псевдонимов.`,
  longAlias: (alias: string) => `Псевдоним «${alias}» длиннее 80 знаков.`, duplicateName: (value: string) => `Имя «${value}» подходит двум участникам — оставьте одно.`,
  heading: 'Участники', description: 'Люди и агенты проекта: имя, вид и псевдонимы. Реестр нужен для Owner, Hand и решений «Открыто».',
  close: 'Закрыть участников', readOnly: 'Источник открыт только для чтения. Переключитесь на тестовую копию в верхней полосе — реестр сохраняется туда.',
  loading: 'Открываем каталог…', empty: 'Реестр пуст. Добавьте людей и агентов — появятся выбор Owner, руки Hand и приём решений.',
  name: 'Имя', namePlaceholder: 'Анна или GLM', memberName: (id: string) => 'Имя участника ' + id,
  newId: 'ID нового участника', immutableId: 'ID неизменяем: на него ссылаются руки и карты', kind: 'Вид', memberKind: (id: string) => 'Вид участника ' + id,
  human: 'Человек', agent: 'Агент', aliases: 'Псевдонимы', aliasesPlaceholder: 'через запятую', memberAliases: (id: string) => 'Псевдонимы участника ' + id,
  remove: (name: string) => 'Удалить участника ' + name, add: 'Добавить участника', checkRegistry: 'Проверьте реестр:', unsaved: ' · есть несохранённые правки',
  cancel: 'Отмена', save: 'Сохранить',
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

function validate(draft: readonly MemberDraft[]): string[] {
  const t = textNow(text);
  const errors: string[] = [];
  if (draft.length > 100) errors.push(t.registryLimit);
  const ids = new Set<string>();
  const names = new Map<string, string>();
  for (const row of draft) {
    if (!idPattern.test(row.id)) errors.push(t.invalidId(row.id));
    if (ids.has(row.id)) errors.push(t.duplicateId(row.id));
    ids.add(row.id);
    const label = row.label.trim();
    if (!label) errors.push(t.missingName(row.id));
    if (label.length > 80) errors.push(t.longName(label));
    const aliases = parseAliases(row.aliases);
    if (aliases.length > 30) errors.push(t.aliasesLimit(label || row.id));
    for (const alias of aliases) if (alias.length > 80) errors.push(t.longAlias(alias));
    // Match validateMembers in server/catalog.ts: duplicate names make Owner references ambiguous.
    for (const value of [label, ...aliases].filter(Boolean)) {
      const key = value.toLocaleLowerCase('ru-RU');
      const previous = names.get(key);
      if (previous !== undefined && previous !== row.id) errors.push(t.duplicateName(value));
      names.set(key, row.id);
    }
  }
  return errors;
}

export function MembersEditor({ snapshot, refreshKey, open, onOpenChange }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  const catalog = useCatalog(snapshot, refreshKey);
  const registry = catalog.catalog?.members ?? null;
  const [draft, setDraft] = useState<MemberDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const busy = catalog.pending || saving;

  // Mirror the file until the user edits; then keep the draft authoritative until saving or closing.
  useEffect(() => { if (!dirty && registry) setDraft(toDraft(registry)); }, [registry, dirty]);
  useEffect(() => { if (!open) setDirty(false); }, [open]);
  // 2026-11-05: the editor stays mounted (App.tsx); the open prop turning true is the person opening the registry.
  useEffect(() => { if (open) emitSignal({ type: 'panel-opened', panel: 'members' }); }, [open]);

  const errors = validate(draft);
  const previewMembers: CatalogMember[] = draft.map(row => ({ id: row.id, label: row.label.trim() || row.id,
    kind: row.kind, aliases: parseAliases(row.aliases) }));

  function addMember() {
    if (draft.length >= 100) return;
    const id = uniqueSlug('member', new Set(draft.map(row => row.id)));
    setDraft(rows => [...rows, { key: 'new-' + crypto.randomUUID(), id, idEdited: false, label: '', kind: 'human', aliases: '', isNew: true }]);
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
    if (!canWrite || busy || errors.length || !catalog.catalog) return;
    const members: CatalogMember[] = draft.map(row => ({ id: row.id, label: row.label.trim(), kind: row.kind, aliases: parseAliases(row.aliases) }));
    setSaving(true);
    try {
      const saved = await catalog.edit({ action: 'configure-members', members });
      if (saved) { setDirty(false); onOpenChange(false); }
    } finally { setSaving(false); }
  }

  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="members-editor" aria-busy={busy}>
      <header className="members-editor-header">
        <div>
          <Dialog.Title>{t.heading}</Dialog.Title>
          <Dialog.Description>{t.description}</Dialog.Description>
        </div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t.close}><X size={17} /></Button></Dialog.Close>
      </header>
      <div className="members-editor-body">
        {catalog.error && <p className="members-editor-error" role="alert">{catalog.error}</p>}
        {!canWrite && <p className="members-editor-note">{t.readOnly}</p>}
        {canWrite && !catalog.catalog && <p className="members-editor-note" role="status"><LoaderCircle size={12} className="spin" /> {t.loading}</p>}
        {catalog.catalog && draft.length === 0 && <p className="members-editor-note">{t.empty}</p>}
        {draft.length > 0 && <ul className="members-editor-list">
          {draft.map(row => <li key={row.key} className="members-editor-row">
            <CardOwnerAvatar owner={row.label.trim() || null} members={previewMembers} />
            <label className="members-editor-field members-editor-name"><span>{t.name}</span>
              <input value={row.label} maxLength={80} placeholder={t.namePlaceholder} disabled={!canWrite || busy}
                aria-label={t.memberName(row.id)} onChange={event => updateLabel(row.key, event.target.value)} /></label>
            {row.isNew
              ? <label className="members-editor-field members-editor-id"><span>ID</span>
                <input value={row.id} maxLength={80} disabled={!canWrite || busy} aria-label={t.newId}
                  onChange={event => updateRow(row.key, { id: event.target.value, idEdited: true })} /></label>
              : <span className="members-editor-id-static" title={t.immutableId}>{row.id}</span>}
            <label className="members-editor-field members-editor-kind"><span>{t.kind}</span>
              <select value={row.kind} disabled={!canWrite || busy} aria-label={t.memberKind(row.id)}
                onChange={event => updateRow(row.key, { kind: event.target.value as 'agent' | 'human' })}>
                <option value="human">{t.human}</option>
                <option value="agent">{t.agent}</option>
              </select></label>
            <label className="members-editor-field members-editor-aliases"><span>{t.aliases}</span>
              <input value={row.aliases} placeholder={t.aliasesPlaceholder} disabled={!canWrite || busy}
                aria-label={t.memberAliases(row.id)} onChange={event => updateRow(row.key, { aliases: event.target.value })} /></label>
            <Button variant="ghost" size="icon" className="members-editor-remove"
              aria-label={t.remove(row.label.trim() || row.id)} disabled={!canWrite || busy}
              onClick={() => removeRow(row.key)}><Trash2 size={15} /></Button>
          </li>)}
        </ul>}
        {canWrite && <Button variant="outline" size="sm" className="members-editor-add" disabled={busy || draft.length >= 100} onClick={addMember}>
          <UserPlus size={15} />{t.add}
        </Button>}
        {dirty && errors.length > 0 && <div className="members-editor-errors" role="alert">
          <p>{t.checkRegistry}</p>
          <ul>{errors.slice(0, 6).map(error => <li key={error}>{error}</li>)}</ul>
        </div>}
      </div>
      <footer className="members-editor-footer">
        <span className="members-editor-hint">{new Intl.NumberFormat(locale(lang)).format(draft.length)} / 100{dirty ? t.unsaved : ''}</span>
        <span className="members-editor-actions">
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpenChange(false)}>{t.cancel}</Button>
          <Button size="sm" disabled={!canWrite || busy || !catalog.catalog || errors.length > 0} onClick={() => void save()}>
            {busy && <LoaderCircle size={14} className="spin" />}{t.save}
          </Button>
        </span>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
