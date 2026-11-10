import { useId, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Bot } from 'lucide-react';
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
  heading: 'Deck tags and template', autoTagging: 'Auto-tagging', deckTag: 'Deck tag', tagPlaceholder: 'tag name',
  keepTag: 'Keep the tag when a card leaves the deck',
  tagNote: 'The tag is added when a card is created or moved into the deck, and removed when it leaves. Turning off auto-tagging does not remove tags from cards.',
  template: 'Template card', content: 'New card content', markdownPlaceholder: 'Markdown template for the new card body',
  owner: 'Owner', effort: 'Effort', priority: 'Priority', high: 'High', medium: 'Medium', low: 'Low',
  templateNote: 'The template fills the empty body and unset properties of new cards in this deck.',
  sandboxOnly: 'Automation can only be changed in the test copy.', saving: 'Saving…', save: 'Save',
}, {
  hint: (tag: string | null | undefined, template: boolean) => 'Теги и шаблон колоды. Эти правила не запускают агентов' + (tag ? ' · автотег «' + tag + '»' : ' · автотега нет') + (template ? ' · шаблон карточки задан' : ''),
  label: (tag: string | null | undefined) => 'Теги и шаблон колоды' + (tag ? ': автотег «' + tag + '»' : ''),
  noLaunch: 'Эти правила не запускают агентов.',
  invalidEffort: 'Оценка шаблона — число не меньше нуля.',
  saveFailed: 'Автоматизация не сохранена. Проверьте сообщение каталога и повторите.',
  heading: 'Теги и шаблон колоды', autoTagging: 'Автотег', deckTag: 'Тег колоды', tagPlaceholder: 'имя тега',
  keepTag: 'Оставлять тег при выносе из колоды',
  tagNote: 'Тег ставится карточкам при создании и переносе в колоду, при выносе снимается. Выключение автотега не снимает тег с карточек.',
  template: 'Шаблон карточки', content: 'Содержимое новых карточек', markdownPlaceholder: 'Markdown-шаблон тела новой карточки',
  owner: 'Исполнитель', effort: 'Оценка', priority: 'Приоритет', high: 'Высокий', medium: 'Средний', low: 'Низкий',
  templateNote: 'Шаблон наполняет пустое тело и незаданные свойства новой карточки этой колоды.',
  sandboxOnly: 'Автоматизация меняется только в тестовой копии.', saving: 'Сохраняем…', save: 'Сохранить',
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
  deck: CatalogDeck;
  members: CatalogMember[];
  tagNames: string[];
  manifestHash: string;
  pending: boolean;
  writable: boolean;
  onSave: (deckId: string, settings: DeckAutomationSettings, manifestHash: string) => Promise<boolean>;
}

/** Deck header automation control for auto-tagging and the Template Card. */
export function DeckAutomation({ deck, members, tagNames, manifestHash, pending, writable, onSave }: DeckAutomationProps) {
  const t = useText(text);
  const tagInputId = useId();
  const [open, setOpen] = useState(false);
  const [autoTag, setAutoTag] = useState(deck.autoTag ?? '');
  const [autoTagKeep, setAutoTagKeep] = useState(Boolean(deck.autoTagKeep));
  const [templateMarkdown, setTemplateMarkdown] = useState(deck.templateMarkdown ?? '');
  const [templateOwner, setTemplateOwner] = useState(deck.templateOwner ?? '');
  const [effortText, setEffortText] = useState(deck.templateEffort == null ? '' : String(deck.templateEffort));
  const [templatePriority, setTemplatePriority] = useState<CardPriority | ''>(deck.templatePriority ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<'invalidEffort' | 'saveFailed' | null>(null);
  const hint = t.hint(deck.autoTag, Boolean(deck.templateMarkdown));

  function changeOpen(next: boolean) {
    if (saving) return;
    setOpen(next);
    if (next) {
      setAutoTag(deck.autoTag ?? '');
      setAutoTagKeep(Boolean(deck.autoTagKeep));
      setTemplateMarkdown(deck.templateMarkdown ?? '');
      setTemplateOwner(deck.templateOwner ?? '');
      setEffortText(deck.templateEffort == null ? '' : String(deck.templateEffort));
      setTemplatePriority(deck.templatePriority ?? '');
      setError(null);
    }
  }

  async function save() {
    if (saving || pending || !writable) return;
    const effort = effortText.trim() === '' ? null : Number(effortText);
    if (effort !== null && (!Number.isFinite(effort) || effort < 0)) { setError('invalidEffort'); return; }
    setSaving(true);
    setError(null);
    const saved = await onSave(deck.id, {
      autoTag: autoTag.trim() === '' ? null : autoTag.trim(),
      autoTagKeep,
      templateMarkdown: templateMarkdown.trim() === '' ? null : templateMarkdown,
      templateOwner: templateOwner.trim() === '' ? null : templateOwner.trim(),
      templateEffort: effort,
      templatePriority: templatePriority === '' ? null : templatePriority,
    }, manifestHash);
    setSaving(false);
    if (saved) setOpen(false);
    else setError('saveFailed');
  }

  return <DropdownMenu.Root open={open} onOpenChange={changeOpen}>
    <DeckHeaderHint label={hint}>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className={'deck-automation-toggle' + (deck.autoTag || deck.templateMarkdown ? ' is-active' : '')}
          disabled={pending && !open} aria-label={t.label(deck.autoTag)}>
          <Bot size={14} />
        </Button>
      </DropdownMenu.Trigger>
    </DeckHeaderHint>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="deck-settings-menu deck-automation-menu" align="start" sideOffset={8} collisionPadding={12} aria-busy={saving}>
        <DropdownMenu.Label className="deck-settings-heading">{t.heading}</DropdownMenu.Label>
        <p className="deck-settings-note">{t.noLaunch}</p>
        <div className="deck-settings-section">
          <span className="deck-settings-section-title">{t.autoTagging}</span>
          <label className="deck-settings-field">{t.deckTag}
            <input type="text" list={tagInputId} value={autoTag} maxLength={80} disabled={!writable || saving || pending}
              onChange={event => setAutoTag(event.target.value)} placeholder={t.tagPlaceholder} />
          </label>
          <datalist id={tagInputId}>{tagNames.map(name => <option key={name} value={name} />)}</datalist>
          <label className="deck-settings-check">
            <input type="checkbox" checked={autoTagKeep} disabled={!writable || saving || pending || autoTag.trim() === ''} onChange={event => setAutoTagKeep(event.target.checked)} />
            {t.keepTag}
          </label>
          <p className="deck-settings-note">{t.tagNote}</p>
        </div>
        <div className="deck-settings-section">
          <span className="deck-settings-section-title">{t.template}</span>
          <label className="deck-settings-field">{t.content}
            <textarea rows={5} value={templateMarkdown} maxLength={50000} disabled={!writable || saving || pending}
              onChange={event => setTemplateMarkdown(event.target.value)} placeholder={t.markdownPlaceholder} />
          </label>
          <div className="deck-settings-row">
            <label className="deck-settings-field">{t.owner}
              <select value={templateOwner} disabled={!writable || saving || pending} onChange={event => setTemplateOwner(event.target.value)}>
                <option value="">—</option>
                {members.map(member => <option key={member.id} value={member.label}>{member.label}</option>)}
              </select>
            </label>
            <label className="deck-settings-field">{t.effort}
              <input type="number" min={0} step="any" value={effortText} disabled={!writable || saving || pending}
                onChange={event => setEffortText(event.target.value)} />
            </label>
            <label className="deck-settings-field">{t.priority}
              <select value={templatePriority} disabled={!writable || saving || pending} onChange={event => setTemplatePriority(event.target.value as CardPriority | '')}>
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
        {error && <p className="deck-settings-error" role="alert">{t[error]}</p>}
        {!writable && <p className="deck-settings-note">{t.sandboxOnly}</p>}
        <div className="deck-settings-actions">
          <Button type="button" size="sm" disabled={!writable || saving || pending} onClick={() => void save()}>{saving ? t.saving : t.save}</Button>
        </div>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}
