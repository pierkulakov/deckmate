import { moveFocus } from '../focus.ts';
import { useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronLeft, ChevronRight, FolderOpen, Layers, LoaderCircle, Plus, Search, Triangle, X } from 'lucide-react';
import type { CatalogDeck, CatalogJourney, CatalogJourneyStep, CatalogJourneyTemplate, CatalogJourneyTemplateStep, CatalogJourneyZone, CatalogView, JourneyRoleTarget } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { JourneyMiniCard, JourneyWaves } from './JourneyMiniCard.tsx';
import { JourneyStepPanel } from './JourneyStepPanel.tsx';
import { Button } from './ui/button.tsx';
import { TagBadge } from './CardTags.tsx';
import { defineText, formatNumber, locale, textNow, useLang, useText, type Lang } from '../i18n.ts';
import { templateText } from '../../src/template-text.ts';
import { failureMessage } from '../failure-message.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { JourneyOperationBadge, JourneyOperationNotice } from './JourneyOperationNotice.tsx';
import { EmptyState } from './EmptyState.tsx';
import { ConfirmStrip } from './ConfirmStrip.tsx';
import '../journey-catalog.css';

const text = defineText({
  count: (count: number) => formatNumber(count, 3, 'en'),
  by: 'by ',
  templates: 'Journey templates',
  search: 'Search',
  categories: 'Categories',
  lastUpdated: 'last updated on ',
  createDeck: 'Create new Deck',
  mappingDescription: 'By default new decks will be created. Pick existing decks to override.',
  mapping: 'Deck mapping',
  creatingDecks: (count: number) => `${formatNumber(count, 3, 'en')} new ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'deck will' : 'decks will'} be created`,
  existingDecks: 'Using existing Decks',
  replaceSteps: (count: number) => `Replace with ${formatNumber(count, 3, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'}`,
  addSteps: (count: number) => `Add ${formatNumber(count, 3, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'}`,
  saveAsTemplate: 'Save as template',
  defaultZone: 'Default steps',
  project: 'Project',
  templateNavigation: 'Template navigation',
  templateSearch: 'Search Journey templates',
  templateCategories: 'Template categories',
  showAll: 'Show all templates',
  noTemplatesFound: 'No templates found',
  emptyCatalog: 'The catalog has no templates',
  noTemplatesDescription: 'Change the query or choose another category.',
  emptyCatalogDescription: 'Save a Journey as a template to use it in other decks.',
  importUnconfirmed: 'The server did not confirm the template import. The mapping is preserved. Check the Journey and decks before trying again.',
  importFailed: 'Could not import the template.',
  checkImport: 'The mapping is preserved. Check the Journey and decks before trying again.',
  roleUnavailable: 'Role unavailable',
  roleDecks: 'Decks for template roles',
  deckForRole: (role: string) => `Deck for role ${role}`,
  invalidMapping: 'A new deck needs a project space, and the selected deck must be Task or Mixed.',
  replaceTitle: 'The deck Journey’s steps will be replaced by the template steps',
  replaceConfirmation: (title: string, oldSteps: number, oldZones: number, newSteps: number, newZones: number, decks: number) => `Replace steps in “${title}”? Removed: ${formatNumber(oldSteps, 3, 'en')} steps and ${formatNumber(oldZones, 3, 'en')} zones. Added: ${formatNumber(newSteps, 3, 'en')} steps and ${formatNumber(newZones, 3, 'en')} zones. New decks: ${formatNumber(decks, 3, 'en')}. Existing Sub Cards will not change.`,
  back: 'Go back',
  backToJourney: 'Back to Journey',
  backToTemplates: 'Back to templates',
  confirmReplace: 'Replace steps',
  saveUnconfirmed: 'The server did not confirm the template save. The fields are preserved; try again.',
  saveFailed: 'Could not save the template. The fields are preserved.',
  closeSave: 'Close template save',
  saveDescription: 'Save the Journey steps in the project catalog for reuse.',
  title: 'Title',
  description: 'Description',
  category: 'Category',
  categoryPlaceholder: 'Choose or enter a new one',
  tags: 'Tags',
  tagsPlaceholder: 'Comma-separated: 3D, Production',
  cancel: 'Cancel',
  saveTemplate: 'Save template',
}, {
  count: (count: number) => formatNumber(count, 3, 'ru'),
  by: 'от ',
  templates: 'Шаблоны Journey',
  search: 'Поиск',
  categories: 'Категории',
  lastUpdated: 'обновлён ',
  createDeck: 'Создать новую колоду',
  mappingDescription: 'По умолчанию создаются новые колоды. Выберите существующие, чтобы переопределить.',
  mapping: 'Сопоставление колод',
  creatingDecks: (count: number) => {
    const rule = new Intl.PluralRules(locale('ru')).select(count);
    const noun = { one: 'колода', few: 'колоды', many: 'колод', zero: 'колод', two: 'колоды', other: 'колоды' }[rule]!;
    const phrase = { one: 'Будет создана', few: 'Будут созданы', many: 'Будет создано', zero: 'Будет создано', two: 'Будут созданы', other: 'Будет создано' }[rule]!;
    return `${phrase} ${formatNumber(count, 3, 'ru')} ${noun}`;
  },
  existingDecks: 'Используются существующие колоды',
  replaceSteps: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', zero: 'шагов', two: 'шага', other: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Заменить на ${formatNumber(count, 3, 'ru')} ${noun}`;
  },
  addSteps: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', zero: 'шагов', two: 'шага', other: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Добавить ${formatNumber(count, 3, 'ru')} ${noun}`;
  },
  saveAsTemplate: 'Сохранить как шаблон',
  defaultZone: 'Основные шаги',
  project: 'Проект',
  templateNavigation: 'Навигация по шаблонам',
  templateSearch: 'Поиск шаблонов Journey',
  templateCategories: 'Категории шаблонов',
  showAll: 'Показать все шаблоны',
  noTemplatesFound: 'Шаблоны не найдены',
  emptyCatalog: 'В каталоге нет шаблонов',
  noTemplatesDescription: 'Измените запрос или выберите другую категорию.',
  emptyCatalogDescription: 'Сохраните Journey как шаблон, чтобы использовать его в других колодах.',
  importUnconfirmed: 'Сервер не подтвердил импорт шаблона. Сопоставление колод сохранено. Перед повтором проверьте Journey и колоды.',
  importFailed: 'Не удалось импортировать шаблон.',
  checkImport: 'Сопоставление сохранено. Перед повтором проверьте Journey и колоды.',
  roleUnavailable: 'Роль недоступна',
  roleDecks: 'Колоды для ролей шаблона',
  deckForRole: (role: string) => `Колода для роли ${role}`,
  invalidMapping: 'Для новой колоды нужно пространство проекта, а выбранная колода должна быть Task или Mixed.',
  replaceTitle: 'Шаги Journey колоды заменятся шагами шаблона',
  replaceConfirmation: (title: string, oldSteps: number, oldZones: number, newSteps: number, newZones: number, decks: number) => `Заменить шаги Journey «${title}»? Будет удалено шагов: ${formatNumber(oldSteps, 3, 'ru')}, зон: ${formatNumber(oldZones, 3, 'ru')}; добавлено шагов: ${formatNumber(newSteps, 3, 'ru')}, зон: ${formatNumber(newZones, 3, 'ru')}. Будет создано колод: ${formatNumber(decks, 3, 'ru')}. Существующие Sub Cards не изменятся.`,
  back: 'Вернуться',
  backToJourney: 'Назад к Journey',
  backToTemplates: 'Назад к шаблонам',
  confirmReplace: 'Заменить шаги',
  saveUnconfirmed: 'Сервер не подтвердил сохранение шаблона. Заполненные поля сохранены; повторите действие.',
  saveFailed: 'Не удалось сохранить шаблон. Заполненные поля сохранены.',
  closeSave: 'Закрыть сохранение шаблона',
  saveDescription: 'Сохраните шаги Journey в каталоге проекта для повторного использования.',
  title: 'Название',
  description: 'Описание',
  category: 'Категория',
  categoryPlaceholder: 'Выберите или введите новую',
  tags: 'Теги',
  tagsPlaceholder: 'Через запятую: 3D, Production',
  cancel: 'Отмена',
  saveTemplate: 'Сохранить шаблон',
});

type ImportTemplate = (template: CatalogJourneyTemplate, mode: 'add' | 'replace', roleMapping: Record<string, JourneyRoleTarget>) => Promise<boolean>;

function templateKey(template: CatalogJourneyTemplate) {
  return template.source + ':' + template.id;
}

// 2026-11-04: the template step opens the shared step sheet, which speaks CatalogJourneyStep. This conversion is
// presentation only: the template step has no deck or owner — the sheet shows the role instead via targetLabel.
function catalogStepView(step: CatalogJourneyTemplateStep): CatalogJourneyStep {
  return { id: step.id, title: step.title, markdown: step.markdown, owner: null, deckId: '', dependsOn: [...step.dependsOn], effort: step.effort ?? null, priority: step.priority ?? null, zoneId: step.zoneId ?? 'default' };
}

function templateZones(template: CatalogJourneyTemplate): CatalogJourneyZone[] {
  const zones = [...template.zones];
  for (const step of template.steps) {
    const id = step.zoneId ?? 'default';
    if (!zones.some(zone => zone.id === id)) zones.push({ id, title: id === 'default' ? textNow(text).defaultZone : id });
  }
  return zones;
}

function TemplateTags({ tags }: { tags: string[] }) {
  return <span className="journey-catalog-tags">{tags.map(tag => <TagBadge key={tag} name={tag} compact />)}</span>;
}

function TemplateAuthor({ author }: { author: string }) {
  const t = useText(text);
  return <span className="journey-catalog-author">{t.by}<b>{author}</b></span>;
}

// Categories include every template label (category and tags), most used first.
function templateLabels(template: CatalogJourneyTemplate): string[] {
  return [...new Set([template.category, ...template.tags].map(label => label.trim()).filter(Boolean))];
}

function updatedLabel(value: string, lang: Lang) {
  const date = new Date(value + 'T00:00:00');
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale(lang), { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function TemplateTile({ template, onSelect }: { template: CatalogJourneyTemplate; onSelect: () => void }) {
  const t = useText(text);
  const localized = templateText(template, useLang());
  return <button type="button" className="journey-catalog-tile" data-template-key={templateKey(template)} onClick={onSelect}>
    <span className="journey-catalog-preview" aria-hidden="true">
      {template.steps.slice(0, 3).map(step => <JourneyMiniCard key={step.id} title={step.title} effort={step.effort} priority={step.priority} />)}
      {template.source === 'project' && <span className="journey-catalog-badge"><FolderOpen size={11} />{t.project}</span>}
      <span className="journey-catalog-step-count page-number">{t.count(template.steps.length)}</span>
    </span>
    <span className="journey-catalog-tile-body">
      <strong>{localized.title}</strong>
      <span className="journey-catalog-tile-description">{localized.description}</span>
      <TemplateTags tags={template.tags} />
      <TemplateAuthor author={template.author} />
    </span>
  </button>;
}

export function JourneyCatalog({ catalog, deck, journey, disabled, source = 'sandbox', onEdit, onOperationBusyChange, onImport, onBack, backRef }: {
  catalog: CatalogView;
  deck: CatalogDeck;
  journey: CatalogJourney | null;
  disabled: boolean;
  source?: DataSource;
  onEdit?: (action: CatalogAction) => Promise<boolean>;
  onOperationBusyChange?: (busy: boolean) => void;
  onImport: ImportTemplate;
  onBack: () => void;
  backRef?: RefObject<(() => void) | null>;
}) {
  const templates = catalog.journeyTemplates ?? [];
  const t = useText(text);
  const lang = useLang();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const results = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const returningTo = useRef<string | null>(null);
  const selected = templates.find(template => templateKey(template) === selectedKey);
  const selectedText = selected && templateText(selected, lang);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const template of templates) for (const label of templateLabels(template)) counts.set(label, (counts.get(label) ?? 0) + 1);
    return [...counts].sort(([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName));
  }, [templates]);
  const query = search.trim().toLocaleLowerCase();
  const matching = templates.filter(template => {
    const localized = templateText(template, lang);
    return (!category || templateLabels(template).includes(category))
      && (!query || [template.title, template.description, localized.title, localized.description, template.category, template.author, ...template.tags]
        .join(' ').toLocaleLowerCase().includes(query));
  });
  function backToTemplates() {
    returningTo.current = selectedKey;
    setSelectedKey(null);
  }
  useLayoutEffect(() => {
    if (selectedKey || !returningTo.current) return;
    const key = returningTo.current;
    returningTo.current = null;
    const opener = [...(results.current?.querySelectorAll<HTMLButtonElement>('.journey-catalog-tile') ?? [])].find(button => button.dataset.templateKey === key);
    moveFocus(opener ?? searchInput.current);
  }, [selectedKey]);
  useLayoutEffect(() => {
    if (!backRef) return;
    backRef.current = () => { if (!importing) { if (selectedKey) backToTemplates(); else onBack(); } };
    return () => { backRef.current = null; };
  }, [backRef, selectedKey, importing, onBack]);

  return <section className="journey-catalog" aria-label={t.templates}>
    <header className="journey-catalog-header">
      <nav className="journey-catalog-breadcrumbs" aria-label={t.templateNavigation}>
        <button type="button" className="control control-ghost" disabled={importing} aria-label={selected ? t.backToTemplates : t.backToJourney} onClick={selected ? backToTemplates : onBack}><ChevronLeft size={14} aria-hidden="true" />{selected ? t.templates : <><span className="journey-deck-icon" aria-hidden="true"><Layers size={11} /></span><span title={deck.title}>{deck.title}</span></>}</button>
        <ChevronRight size={14} aria-hidden="true" />
        <span aria-current="page" title={selectedText?.title ?? t.templates}>{selectedText?.title ?? t.templates}</span>
      </nav>
      {journey && <JourneyOperationBadge journey={journey} />}
      {!selected && <label className="journey-catalog-search control-field"><input ref={searchInput} aria-label={t.templateSearch} type="search" value={search} placeholder={t.search} onChange={event => setSearch(event.target.value)} /><Search size={14} aria-hidden="true" /></label>}
    </header>
    {journey && <JourneyOperationNotice key={journey.id} journey={journey} catalog={catalog} source={source} writable={source === 'sandbox'} disabled={disabled || importing} onEdit={onEdit} onBusyChange={onOperationBusyChange} />}
    {selected ? <JourneyTemplateDetail key={templateKey(selected)} catalog={catalog} deck={deck} journey={journey} template={selected} disabled={disabled} source={source} onImport={onImport} onBusyChange={setImporting} /> : <div className="journey-catalog-browser">
      <aside className="journey-catalog-categories" aria-label={t.templateCategories}>
        <h3 className="panel-title">{t.categories}</h3>
        {categories.map(([name, count]) => <button key={name} type="button" className="control control-ghost" aria-pressed={category === name} title={category === name ? t.showAll : undefined} onClick={() => setCategory(previous => previous === name ? '' : name)}><span>{name}</span><span className="panel-count">{t.count(count)}</span></button>)}
      </aside>
      <div ref={results} className="journey-catalog-results">
        {matching.length > 0 && <div className="journey-catalog-grid">{matching.map(template => <TemplateTile key={templateKey(template)} template={template} onSelect={() => setSelectedKey(templateKey(template))} />)}</div>}
        {matching.length === 0 && templates.length > 0 && <EmptyState variant="filtered" className="journey-catalog-empty" art="no-results" title={t.noTemplatesFound} message={t.noTemplatesDescription} onReset={() => { setSearch(''); setCategory(''); }} />}
        {templates.length === 0 && <EmptyState variant="first-run" className="journey-catalog-empty" art="journey" title={t.emptyCatalog} message={t.emptyCatalogDescription} />}
      </div>
    </div>}
  </section>;
}

function JourneyTemplateDetail({ catalog, deck, journey, template, disabled, source, onImport, onBusyChange }: {
  catalog: CatalogView; deck: CatalogDeck; journey: CatalogJourney | null; template: CatalogJourneyTemplate;
  disabled: boolean; source: DataSource; onImport: ImportTemplate; onBusyChange: (busy: boolean) => void;
}) {
  const targets = catalog.decks.filter(target => target.kind === 'task' || target.kind === 'mixed');
  const t = useText(text);
  const lang = useLang();
  const localized = templateText(template, lang);
  // A role without a chosen deck creates a deck named after the role in the Journey deck's space.
  const space = catalog.spaces.some(candidate => candidate.id === deck.spaceId) ? deck.spaceId : catalog.spaces[0]?.id ?? '';
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mappingOpen, setMappingOpen] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<'add' | 'replace' | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);
  const mappingId = useId();
  const savingRef = useRef(false);
  const busy = disabled || saving !== null || !!journey?.pendingOperation;
  const zones = templateZones(template);
  const inspected = template.steps.find(step => step.id === inspectedId);
  const viewSteps = useMemo(() => template.steps.map(catalogStepView), [template]);
  const inspectedView = inspected && viewSteps.find(step => step.id === inspected.id);
  // 2026-11-04: project templates live in the data project, so relative links resolve for real; bundled templates
  // ship with Deckmate and must not pose as data files.
  const inspectedPath = template.source === 'project' && inspectedId ? 'tasks/journey-templates/' + template.id + '/steps/' + inspectedId + '.md' : undefined;
  const roleMapping: Record<string, JourneyRoleTarget> = Object.fromEntries(template.roles.map(role => {
    const deckId = mapping[role.id];
    return [role.id, deckId ? { deckId } : { createDeck: { title: role.title.trim(), spaceId: space } }];
  }));
  const newDeckCount = Object.values(roleMapping).filter(target => 'createDeck' in target).length;
  const mappingValid = Object.values(roleMapping).every(target => 'deckId' in target ? targets.some(candidate => candidate.id === target.deckId) : Boolean(target.createDeck.title && target.createDeck.spaceId));
  const stepCount = template.steps.length;
  const oldZoneCount = journey ? new Set([...(journey.zones ?? []).map(zone => zone.id), ...journey.steps.map(step => step.zoneId ?? 'default')]).size : 0;
  const confirmationKey = journey ? JSON.stringify([journey.fileHash, template.fileHash, roleMapping]) : '';

  async function importTemplate(mode: 'add' | 'replace') {
    if (busy || savingRef.current || !mappingValid || stepCount === 0 || (mode === 'replace' && !journey)) return;
    savingRef.current = true;
    setSaving(mode);
    onBusyChange(true);
    setError('');
    try {
      const saved = await onImport(template, mode, roleMapping);
      if (!saved) setError(t.importUnconfirmed);
    } catch (failure) {
      setError(`${failureMessage(failure, t.importFailed)} ${t.checkImport}`);
    } finally {
      savingRef.current = false;
      setSaving(null);
      onBusyChange(false);
    }
  }

  return <div className="journey-catalog-detail" aria-busy={saving !== null}>
    <div className="journey-catalog-detail-scroll">
      <header className="journey-catalog-detail-heading">
        <div><h2>{localized.title}</h2><TemplateTags tags={template.tags} />{template.source === 'project' && <span className="journey-catalog-badge"><FolderOpen size={11} />{t.project}</span>}</div>
        <p><TemplateAuthor author={template.author} /><span>{t.lastUpdated}<time dateTime={template.updated}>{updatedLabel(template.updated, lang)}</time></span></p>
      </header>
      <p className="journey-catalog-description">{localized.description}</p>
      {zones.map(zone => <section key={zone.id} className="journey-catalog-zone" aria-label={zone.title}>
        <h3><Triangle size={14} aria-hidden="true" />{zone.title}</h3>
        <div className="journey-catalog-zone-cards"><JourneyWaves />{template.steps.filter(step => (step.zoneId ?? 'default') === zone.id).map(step => <JourneyMiniCard key={step.id} title={step.title} effort={step.effort} priority={step.priority} selected={inspectedId === step.id} onClick={() => setInspectedId(previous => previous === step.id ? null : step.id)} />)}</div>
      </section>)}
      {/* Template steps use the same 521px side panel as editor steps.
          The panel is read-only: onChange/onRemove are no-ops because catalog templates cannot be edited here.
          Filters and Deck Mapping stay in this component, so closing the panel preserves the selection. */}
      {inspected && inspectedView && <JourneyStepPanel
        key={inspected.id}
        step={inspectedView}
        steps={viewSteps}
        catalog={catalog}
        source={source}
        path={inspectedPath}
        disabled={false}
        readOnly
        targetLabel={template.roles.find(role => role.id === inspected.roleId)?.title ?? t.roleUnavailable}
        onChange={() => {}}
        onClose={() => setInspectedId(null)}
        onRemove={() => {}} />}
    </div>
    <footer className="journey-catalog-import">
      <div className="journey-catalog-import-details">
        {mappingOpen && <fieldset className="journey-catalog-mapping" id={mappingId} disabled={busy}>
          <legend className="visually-hidden">{t.roleDecks}</legend>
          <div className="journey-catalog-roles" role="region" aria-label={t.roleDecks} tabIndex={template.roles.length ? 0 : undefined}>{template.roles.map(role => {
            const deckId = mapping[role.id] ?? '';
            return <label className="journey-catalog-role" key={role.id}><span>{role.title}</span>
              <span className="journey-catalog-role-select control-field">{!deckId && <Plus size={14} aria-hidden="true" />}
                <select aria-label={t.deckForRole(role.title)} value={deckId} onChange={event => { setMapping(previous => ({ ...previous, [role.id]: event.target.value })); setConfirmReplace(null); setError(''); }}>
                  <option value="">{t.createDeck}</option>
                  {targets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}
                </select><ChevronDown size={14} aria-hidden="true" /></span>
            </label>;
          })}</div>
          <p>{t.mappingDescription}</p>
        </fieldset>}
        {error && <p className="journey-catalog-error" role="alert">{error}</p>}
        {!mappingValid && <p className="journey-catalog-error" role="alert">{t.invalidMapping}</p>}
        {journey && confirmReplace === confirmationKey && !busy && <ConfirmStrip
          question={t.replaceConfirmation(journey.title, journey.steps.length, oldZoneCount, stepCount, zones.length, newDeckCount)}
          keepLabel={t.back} confirmLabel={t.confirmReplace} danger onKeep={() => setConfirmReplace(null)}
          onEscape={() => setConfirmReplace(null)} onConfirm={() => { setConfirmReplace(null); void importTemplate('replace'); }} />}
      </div>
      <div className="journey-catalog-import-actions">
        <button type="button" className="journey-catalog-mapping-toggle control" aria-expanded={mappingOpen} aria-controls={mappingId} onClick={() => setMappingOpen(previous => !previous)}>{t.mapping}<ChevronDown size={14} /></button>
        <span>{newDeckCount ? t.creatingDecks(newDeckCount) : t.existingDecks}</span>
        {journey && <button type="button" className="journey-catalog-replace control control-ghost" disabled={busy || !mappingValid || !stepCount} title={t.replaceTitle} onClick={() => setConfirmReplace(confirmationKey)}>{saving === 'replace' && <LoaderCircle size={14} className="spin" />}{t.replaceSteps(stepCount)}</button>}
        <button type="button" className="journey-catalog-add action-mint" disabled={busy || !mappingValid || !stepCount} onClick={() => void importTemplate('add')}>{saving === 'add' && <LoaderCircle size={14} className="spin" />}{t.addSteps(stepCount)}</button>
      </div>
    </footer>
  </div>;
}

export function JourneySaveTemplateDialog({ journey, categories, disabled, onSave, onClose }: {
  journey: CatalogJourney;
  categories: string[];
  disabled: boolean;
  onSave: (metadata: { title: string; description: string; category: string; tags: string[] }) => Promise<boolean>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(journey.title);
  const t = useText(text);
  const [description, setDescription] = useState(journey.description ?? '');
  const [category, setCategory] = useState(categories.find(value => value.trim()) ?? '');
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const savingRef = useRef(false);
  const returnFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const categoriesId = useId();
  const busy = disabled || saving;

  async function save() {
    if (busy || savingRef.current || !title.trim() || !category.trim()) return;
    savingRef.current = true;
    setSaving(true);
    setError('');
    try {
      const saved = await onSave({ title: title.trim(), description: description.trim(), category: category.trim(), tags: [...new Set(tags.split(',').map(tag => tag.trim()).filter(Boolean))] });
      if (saved) onClose();
      else setError(t.saveUnconfirmed);
    } catch (failure) {
      setError(failureMessage(failure, t.saveFailed));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <Dialog.Root open onOpenChange={open => { if (!open && !busy && !savingRef.current) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="journey-catalog-save-overlay" />
    <Dialog.Content className="journey-catalog-save-dialog dialog-panel" aria-busy={saving}
      onCloseAutoFocus={event => { event.preventDefault(); moveFocus(returnFocus.current); }}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !savingRef.current) onClose(); }}
      onPointerDownOutside={event => event.preventDefault()}>
      <header className="dialog-head"><Dialog.Title className="dialog-title">{t.saveAsTemplate}</Dialog.Title><Button type="button" variant="ghost" size="icon" disabled={busy} onClick={onClose} aria-label={t.closeSave}><X size={17} /></Button></header>
      <Dialog.Description className="dialog-body">{t.saveDescription}</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className="dialog-body" disabled={busy}>
          <label><span>{t.title}</span><input className="control-field" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required autoFocus /></label>
          <label><span>{t.description}</span><textarea className="control-field" value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={2000} /></label>
          <label><span>{t.category}</span><input className="control-field" value={category} onChange={event => setCategory(event.target.value)} list={categoriesId} maxLength={120} placeholder={t.categoryPlaceholder} required /><datalist id={categoriesId}>{[...new Set(categories)].filter(name => name.trim()).map(name => <option key={name} value={name} />)}</datalist></label>
          <label><span>{t.tags}</span><input className="control-field" value={tags} onChange={event => setTags(event.target.value)} placeholder={t.tagsPlaceholder} maxLength={1000} /></label>
        </fieldset>
        {error && <p className="journey-catalog-error" role="alert">{error}</p>}
        <footer className="dialog-foot"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t.cancel}</Button><Button type="submit" className="action-mint" disabled={busy || !title.trim() || !category.trim()}>{saving && <LoaderCircle size={14} className="spin" />}{t.saveTemplate}</Button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
