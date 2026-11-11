import { useEffect, useId, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, X } from 'lucide-react';
import type { CatalogDeck, CatalogMember, CardPriority } from '../../src/catalog-contracts.ts';
import { DeckHeaderHint } from './Deck.tsx';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import { AgentQueueHint } from './AgentQueueHint.tsx';

const text = defineText({
  hint: (tag: string | null | undefined, template: boolean) => 'Deck tags and template. These rules do not start agents' + (tag ? ' · auto-tag “' + tag + '”' : ' · no auto-tag') + (template ? ' · card template set' : ''),
  label: (tag: string | null | undefined) => 'Deck tags and template' + (tag ? ': auto-tag “' + tag + '”' : ''),
  noLaunch: 'These rules do not start agents.',
  invalidEffort: 'Template Effort must be a number greater than or equal to zero.',
  saveFailed: 'Automation was not saved. Check the catalog message and try again.',
  catalogChanged: 'The catalog changed. Your draft is kept. Reload the saved settings before editing again.',
  reload: 'Reload and discard draft', close: 'Close',
  heading: 'Deck tags and template', autoTagging: 'Auto-tagging', deckTag: 'Deck tag', tagPlaceholder: 'tag name',
  keepTag: 'Keep the tag when a card leaves the deck',
  tagNote: 'The tag is added when a card is created or moved into the deck, and removed when it leaves. Turning off auto-tagging does not remove tags from cards.',
  template: 'Template card', content: 'New card content', markdownPlaceholder: 'Markdown template for the new card body',
  owner: 'Owner', effort: 'Effort', priority: 'Priority', high: 'High', medium: 'Medium', low: 'Low',
  templateNote: 'The template fills the empty body and unset properties of new cards in this deck.',
  sandboxOnly: 'This source is read-only.', saving: 'Saving…', save: 'Save',
}, {
  hint: (tag: string | null | undefined, template: boolean) => 'Теги и шаблон колоды. Эти правила не запускают агентов' + (tag ? ' · автотег «' + tag + '»' : ' · автотега нет') + (template ? ' · шаблон карточки задан' : ''),
  label: (tag: string | null | undefined) => 'Теги и шаблон колоды' + (tag ? ': автотег «' + tag + '»' : ''),
  noLaunch: 'Эти правила не запускают агентов.',
  invalidEffort: 'Оценка шаблона — число не меньше нуля.',
  saveFailed: 'Автоматизация не сохранена. Проверьте сообщение каталога и повторите.',
  catalogChanged: 'Каталог изменился. Черновик сохранён. Перечитайте настройки перед дальнейшим редактированием.',
  reload: 'Перечитать и отбросить черновик', close: 'Закрыть',
  heading: 'Теги и шаблон колоды', autoTagging: 'Автотег', deckTag: 'Тег колоды', tagPlaceholder: 'имя тега',
  keepTag: 'Оставлять тег при выносе из колоды',
  tagNote: 'Тег ставится карточкам при создании и переносе в колоду, при выносе снимается. Выключение автотега не снимает тег с карточек.',
  template: 'Шаблон карточки', content: 'Содержимое новых карточек', markdownPlaceholder: 'Markdown-шаблон тела новой карточки',
  owner: 'Исполнитель', effort: 'Оценка', priority: 'Приоритет', high: 'Высокий', medium: 'Средний', low: 'Низкий',
  templateNote: 'Шаблон наполняет пустое тело и незаданные свойства новой карточки этой колоды.',
  sandboxOnly: 'Этот источник доступен только для чтения.', saving: 'Сохраняем…', save: 'Сохранить',
});

export interface DeckAutomationSettings {
  autoTag: string | null;
  autoTagKeep: boolean;
  templateMarkdown: string | null;
  templateOwner: string | null;
  templateEffort: number | null;
  templatePriority: CardPriority | null;
}

export interface DeckAutomationProps {
  draftKey: string;
  deck: CatalogDeck;
  members: CatalogMember[];
  tagNames: string[];
  manifestHash: string;
  pending: boolean;
  writable: boolean;
  onSave: (deckId: string, settings: DeckAutomationSettings, manifestHash: string) => Promise<boolean>;
}

interface AutomationDraft {
  manifestHash: string;
  autoTag: string;
  autoTagKeep: boolean;
  templateMarkdown: string;
  templateOwner: string;
  effortText: string;
  templatePriority: CardPriority | '';
}

// 2026-11-11: closing the actions menu unmounts its form; keep each project's/source's/deck's draft until a confirmed save.
const drafts = new Map<string, AutomationDraft>();
function readSettings(deck: CatalogDeck, manifestHash: string): AutomationDraft {
  return { manifestHash, autoTag: deck.autoTag ?? '', autoTagKeep: Boolean(deck.autoTagKeep),
    templateMarkdown: deck.templateMarkdown ?? '', templateOwner: deck.templateOwner ?? '',
    effortText: deck.templateEffort == null ? '' : String(deck.templateEffort), templatePriority: deck.templatePriority ?? '' };
}

export function DeckAutomation(props: DeckAutomationProps) {
  return <DeckAutomationForm key={props.draftKey} {...props} />;
}

function DeckAutomationForm({ draftKey, deck, members, tagNames, manifestHash, pending, writable, onSave }: DeckAutomationProps) {
  const t = useText(text);
  const tagInputId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<AutomationDraft | null>(() => drafts.get(draftKey) ?? null);
  const values = draft ?? readSettings(deck, manifestHash);
  const { autoTag, autoTagKeep, templateMarkdown, templateOwner, effortText, templatePriority } = values;
  const stale = Boolean(draft && draft.manifestHash !== manifestHash);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'invalidEffort' | 'saveFailed' | null>(null);
  const hint = t.hint(deck.autoTag, Boolean(deck.templateMarkdown));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function updateDraft(next: AutomationDraft) { drafts.set(draftKey, next); setDraft(next); }
  function changeField(change: Partial<AutomationDraft>) { updateDraft({ ...values, ...change }); }
  function reload() { updateDraft(readSettings(deck, manifestHash)); setError(null); }

  function changeOpen(next: boolean) {
    if (saving) return;
    setOpen(next);
    if (next && !draft) reload();
  }

  async function save() {
    if (saving || pending || !writable || stale || !draft) return;
    const effort = effortText.trim() === '' ? null : Number(effortText);
    if (effort !== null && (!Number.isFinite(effort) || effort < 0)) { setError('invalidEffort'); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await onSave(deck.id, {
      autoTag: autoTag.trim() === '' ? null : autoTag.trim(),
      autoTagKeep,
      templateMarkdown: templateMarkdown.trim() === '' ? null : templateMarkdown,
      templateOwner: templateOwner.trim() === '' ? null : templateOwner.trim(),
      templateEffort: effort,
      templatePriority: templatePriority === '' ? null : templatePriority,
      }, draft.manifestHash);
      if (saved && drafts.get(draftKey) === draft) drafts.delete(draftKey);
      if (!mounted.current) return;
      if (saved) { setDraft(null); setOpen(false); }
      else setError('saveFailed');
    } catch { if (mounted.current) setError('saveFailed'); }
    finally { if (mounted.current) setSaving(false); }
  }

  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <DeckHeaderHint label={hint}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" className={'deck-automation-toggle' + (deck.autoTag || deck.templateMarkdown ? ' is-active' : '')}
          disabled={pending && !open} aria-label={t.label(deck.autoTag)}>
          <Bot size={16} />{t.heading}
        </Button>
      </Dialog.Trigger>
    </DeckHeaderHint>
    <Dialog.Portal>
      <Dialog.Overlay className="deck-settings-overlay" />
      <Dialog.Content className="deck-automation-menu dialog-panel" aria-describedby={undefined} aria-busy={saving}
        onOpenAutoFocus={event => { event.preventDefault(); const input = document.getElementById(tagInputId + '-input') as HTMLInputElement | null; if (input && !input.disabled) input.focus(); else document.getElementById(tagInputId + '-close')?.focus(); }}
        onEscapeKeyDown={event => { event.stopPropagation(); if (saving) event.preventDefault(); }}>
        <header className="dialog-head"><Dialog.Title className="dialog-title">{t.heading}</Dialog.Title>
          <Dialog.Close asChild><Button id={tagInputId + '-close'} variant="ghost" size="icon" disabled={saving} aria-label={t.close}><X size={20} /></Button></Dialog.Close></header>
        <div className="dialog-body">
        <Dialog.Description className="deck-settings-note">{t.noLaunch}</Dialog.Description>
        <div className="deck-settings-section">
          <span className="deck-settings-section-title">{t.autoTagging}</span>
          <label className="deck-settings-field">{t.deckTag}
            <input id={tagInputId + '-input'} type="text" list={tagInputId} value={autoTag} maxLength={80} disabled={!writable || saving || pending}
              onChange={event => changeField({ autoTag: event.target.value })} placeholder={t.tagPlaceholder} />
          </label>
          <datalist id={tagInputId}>{tagNames.map(name => <option key={name} value={name} />)}</datalist>
          <label className="deck-settings-check">
            <input type="checkbox" checked={autoTagKeep} disabled={!writable || saving || pending || autoTag.trim() === ''} onChange={event => changeField({ autoTagKeep: event.target.checked })} />
            {t.keepTag}
          </label>
          <p className="deck-settings-note">{t.tagNote}</p>
        </div>
        <div className="deck-settings-section">
          <span className="deck-settings-section-title">{t.template}</span>
          <label className="deck-settings-field">{t.content}
            <textarea rows={5} value={templateMarkdown} maxLength={50000} disabled={!writable || saving || pending}
              onChange={event => changeField({ templateMarkdown: event.target.value })} placeholder={t.markdownPlaceholder} />
          </label>
          <div className="deck-settings-row">
            <label className="deck-settings-field">{t.owner}
              <select value={templateOwner} disabled={!writable || saving || pending} onChange={event => changeField({ templateOwner: event.target.value })}>
                <option value="">—</option>
                {members.map(member => <option key={member.id} value={member.label}>{member.label}</option>)}
              </select>
            </label>
            <label className="deck-settings-field">{t.effort}
              <input type="number" min={0} step="any" value={effortText} disabled={!writable || saving || pending}
                onChange={event => changeField({ effortText: event.target.value })} />
            </label>
            <label className="deck-settings-field">{t.priority}
              <select value={templatePriority} disabled={!writable || saving || pending} onChange={event => changeField({ templatePriority: event.target.value as CardPriority | '' })}>
                <option value="">—</option>
                <option value="high">{t.high}</option>
                <option value="medium">{t.medium}</option>
                <option value="low">{t.low}</option>
              </select>
            </label>
          </div>
          <p className="deck-settings-note">{t.templateNote}</p>
          {members.find(member => member.label === templateOwner)?.kind === 'agent' && <AgentQueueHint />}
        </div>
        {stale && <div className="deck-settings-error" role="alert"><p>{t.catalogChanged}</p><Button className="deck-automation-reload" variant="outline" size="sm" disabled={saving || pending} onClick={reload}>{t.reload}</Button></div>}
        {error && <p className="deck-settings-error" role="alert">{t[error]}</p>}
        {!writable && <p className="deck-settings-note">{t.sandboxOnly}</p>}
        </div>
        <footer className="deck-settings-actions dialog-foot">
          <Button type="button" size="sm" disabled={!writable || saving || pending || stale} onClick={() => void save()}>{saving ? t.saving : t.save}</Button>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
