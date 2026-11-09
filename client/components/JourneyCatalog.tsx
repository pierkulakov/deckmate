import { useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, FolderOpen, Layers, LoaderCircle, Plus, Search, Triangle, X } from 'lucide-react';
import type { CatalogDeck, CatalogJourney, CatalogJourneyStep, CatalogJourneyTemplate, CatalogJourneyTemplateStep, CatalogJourneyZone, CatalogView, JourneyRoleTarget } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { JourneyMiniCard, JourneyWaves } from './JourneyMiniCard.tsx';
import { JourneyStepPanel } from './JourneyStepPanel.tsx';
import { Button } from './ui/button.tsx';
import { TagBadge } from './CardTags.tsx';
import { defineText, locale, textNow, useLang, useText, type Lang } from '../i18n.ts';
import { templateText } from '../../src/template-text.ts';
import '../journey-catalog.css';

function numberValue(value: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang)).format(value);
}

const text = defineText({
  count: (count: number) => numberValue(count, 'en'),
  by: 'by ',
  templates: 'Journey templates',
  search: 'Search',
  categories: 'Categories',
  lastUpdated: 'last updated on ',
  createDeck: 'Create new Deck',
  mappingDescription: 'By default new decks will be created. Pick existing decks to override.',
  mapping: 'Deck mapping',
  creatingDecks: (count: number) => `Creating ${numberValue(count, 'en')} new ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'Deck' : 'Decks'}`,
  existingDecks: 'Using existing Decks',
  replaceSteps: (count: number) => `Replace with ${numberValue(count, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'}`,
  addSteps: (count: number) => `Add ${numberValue(count, 'en')} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'step' : 'steps'}`,
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
  resetSearch: 'Reset search',
  importUnconfirmed: 'The server did not confirm the template import. The deck mapping is preserved; check the data and try again.',
  importFailed: 'Could not import the template. The deck mapping is preserved.',
  roleUnavailable: 'Role unavailable',
  roleDecks: 'Decks for template roles',
  deckForRole: (role: string) => `Deck for role ${role}`,
  invalidMapping: 'A new deck needs a project space, and the selected deck must be Task or Mixed.',
  replaceTitle: 'The deck Journey’s steps will be replaced by the template steps',
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
  count: (count: number) => numberValue(count, 'ru'),
  by: 'от ',
  templates: 'Шаблоны Journey',
  search: 'Поиск',
  categories: 'Категории',
  lastUpdated: 'обновлён ',
  createDeck: 'Создать новую колоду',
  mappingDescription: 'По умолчанию создаются новые колоды. Выберите существующие, чтобы переопределить.',
  mapping: 'Сопоставление колод',
  creatingDecks: (count: number) => {
    const noun = { one: 'новая колода', few: 'новые колоды', many: 'новых колод', zero: 'новых колод', two: 'новые колоды', other: 'новые колоды' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Создаём ${numberValue(count, 'ru')} ${noun}`;
  },
  existingDecks: 'Используются существующие колоды',
  replaceSteps: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', zero: 'шагов', two: 'шага', other: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Заменить на ${numberValue(count, 'ru')} ${noun}`;
  },
  addSteps: (count: number) => {
    const noun = { one: 'шаг', few: 'шага', many: 'шагов', zero: 'шагов', two: 'шага', other: 'шага' }[new Intl.PluralRules(locale('ru')).select(count)]!;
    return `Добавить ${numberValue(count, 'ru')} ${noun}`;
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
  resetSearch: 'Сбросить поиск',
  importUnconfirmed: 'Сервер не подтвердил импорт шаблона. Сопоставление колод сохранено в форме; проверьте данные и повторите действие.',
  importFailed: 'Не удалось импортировать шаблон. Сопоставление колод сохранено в форме.',
  roleUnavailable: 'Роль недоступна',
  roleDecks: 'Колоды для ролей шаблона',
  deckForRole: (role: string) => `Колода для роли ${role}`,
  invalidMapping: 'Для новой колоды нужно пространство проекта, а выбранная колода должна быть Task или Mixed.',
  replaceTitle: 'Шаги Journey колоды заменятся шагами шаблона',
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

function failureMessage(failure: unknown, fallback: string) {
  if (failure instanceof Error) return failure.message;
  if (failure && typeof failure === 'object' && 'message' in failure) return String(failure.message);
  return fallback;
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
  return <button type="button" className="journey-catalog-tile" onClick={onSelect}>
    <span className="journey-catalog-preview" aria-hidden="true">
      {template.steps.slice(0, 3).map(step => <JourneyMiniCard key={step.id} title={step.title} effort={step.effort} priority={step.priority} />)}
      {template.source === 'project' && <span className="journey-catalog-badge"><FolderOpen size={11} />{t.project}</span>}
      <span className="journey-catalog-step-count">{t.count(template.steps.length)}</span>
    </span>
    <span className="journey-catalog-tile-body">
      <strong>{localized.title}</strong>
      <span className="journey-catalog-tile-description">{localized.description}</span>
      <TemplateTags tags={template.tags} />
      <TemplateAuthor author={template.author} />
    </span>
  </button>;
}

export function JourneyCatalog({ catalog, deck, journey, disabled, source = 'sandbox', onImport, onBack }: {
  catalog: CatalogView;
  deck: CatalogDeck;
  journey: CatalogJourney | null;
  disabled: boolean;
  source?: DataSource;
  onImport: ImportTemplate;
  onBack: () => void;
}) {
  const templates = catalog.journeyTemplates ?? [];
  const t = useText(text);
  const lang = useLang();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
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

  return <section className="journey-catalog" aria-label={t.templates}>
    <header className="journey-catalog-header">
      <nav className="journey-catalog-breadcrumbs" aria-label={t.templateNavigation}>
        {/* 2026-11-06: crumbs truncate with an ellipsis; the title attribute keeps the full name one hover away. */}
        <button type="button" disabled={importing} title={deck.title} onClick={onBack}><span className="journey-deck-icon" aria-hidden="true"><Layers size={11} /></span><span>{deck.title}</span></button>
        <ChevronRight size={14} aria-hidden="true" />
        <button type="button" disabled={importing} aria-current={selected ? undefined : 'page'} onClick={() => setSelectedKey(null)}>{t.templates}</button>
        {selected && selectedText && <><ChevronRight size={14} aria-hidden="true" /><span aria-current="page" title={selectedText.title}>{selectedText.title}</span></>}
      </nav>
      {!selected && <label className="journey-catalog-search"><input aria-label={t.templateSearch} type="search" value={search} placeholder={t.search} onChange={event => setSearch(event.target.value)} /><Search size={14} aria-hidden="true" /></label>}
    </header>
    {selected ? <JourneyTemplateDetail key={templateKey(selected)} catalog={catalog} deck={deck} journey={journey} template={selected} disabled={disabled} source={source} onImport={onImport} onBusyChange={setImporting} /> : <div className="journey-catalog-browser">
      <aside className="journey-catalog-categories" aria-label={t.templateCategories}>
        <h3>{t.categories}</h3>
        {categories.map(([name, count]) => <button key={name} type="button" aria-pressed={category === name} title={category === name ? t.showAll : undefined} onClick={() => setCategory(previous => previous === name ? '' : name)}><span>{name}</span><span>{t.count(count)}</span></button>)}
      </aside>
      <div className="journey-catalog-results">
        {matching.length > 0 ? <div className="journey-catalog-grid">{matching.map(template => <TemplateTile key={templateKey(template)} template={template} onSelect={() => setSelectedKey(templateKey(template))} />)}</div> : <div className="journey-catalog-empty" role="status">
          <Layers size={30} aria-hidden="true" />
          <h3>{templates.length ? t.noTemplatesFound : t.emptyCatalog}</h3>
          <p>{templates.length ? t.noTemplatesDescription : t.emptyCatalogDescription}</p>
          {templates.length > 0 && <Button type="button" variant="outline" onClick={() => { setSearch(''); setCategory(''); }}>{t.resetSearch}</Button>}
        </div>}
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
  const mappingId = useId();
  const savingRef = useRef(false);
  const busy = disabled || saving !== null;
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
      setError(failureMessage(failure, t.importFailed));
    } finally {
      savingRef.current = false;
      setSaving(null);
      onBusyChange(false);
    }
  }

  return <div className="journey-catalog-detail" aria-busy={saving !== null}>
    <div className="journey-catalog-detail-scroll">
      <header className="journey-catalog-detail-heading">
        <div><h2>{localized.title}</h2><TemplateTags tags={template.tags} />{template.source === 'project' && <span className="journey-catalog-badge is-inline"><FolderOpen size={11} />{t.project}</span>}</div>
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
      {mappingOpen && <fieldset className="journey-catalog-mapping" id={mappingId} disabled={busy}>
        <legend className="visually-hidden">{t.roleDecks}</legend>
        <div className="journey-catalog-roles">{template.roles.map(role => {
          const deckId = mapping[role.id] ?? '';
          return <label className="journey-catalog-role" key={role.id}><span>{role.title}</span>
            <span className={'journey-catalog-role-select' + (deckId ? ' is-existing' : '')}>{!deckId && <Plus size={14} aria-hidden="true" />}
              <select aria-label={t.deckForRole(role.title)} value={deckId} onChange={event => { setMapping(previous => ({ ...previous, [role.id]: event.target.value })); setError(''); }}>
                <option value="">{t.createDeck}</option>
                {targets.map(target => <option key={target.id} value={target.id}>{target.title}</option>)}
              </select><ChevronDown size={14} aria-hidden="true" /></span>
          </label>;
        })}</div>
        <p>{t.mappingDescription}</p>
      </fieldset>}
      {error && <p className="journey-catalog-error" role="alert">{error}</p>}
      {!mappingValid && <p className="journey-catalog-error" role="alert">{t.invalidMapping}</p>}
      <div className="journey-catalog-import-actions">
        <button type="button" className="journey-catalog-mapping-toggle" aria-expanded={mappingOpen} aria-controls={mappingId} onClick={() => setMappingOpen(previous => !previous)}>{t.mapping}<ChevronDown size={14} /></button>
        <span>{newDeckCount ? t.creatingDecks(newDeckCount) : t.existingDecks}</span>
        {journey && <button type="button" className="journey-catalog-replace" disabled={busy || !mappingValid || !stepCount} title={t.replaceTitle} onClick={() => void importTemplate('replace')}>{saving === 'replace' && <LoaderCircle size={14} className="spin" />}{t.replaceSteps(stepCount)}</button>}
        <button type="button" className="journey-catalog-add" disabled={busy || !mappingValid || !stepCount} onClick={() => void importTemplate('add')}>{saving === 'add' && <LoaderCircle size={14} className="spin" />}{t.addSteps(stepCount)}</button>
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
    <Dialog.Content className="journey-catalog-save-dialog" aria-busy={saving}
      onCloseAutoFocus={event => { event.preventDefault(); returnFocus.current?.focus(); }}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); if (!busy && !savingRef.current) onClose(); }}
      onPointerDownOutside={event => event.preventDefault()}>
      <header><Dialog.Title>{t.saveAsTemplate}</Dialog.Title><Button type="button" variant="ghost" size="icon" disabled={busy} onClick={onClose} aria-label={t.closeSave}><X size={17} /></Button></header>
      <Dialog.Description>{t.saveDescription}</Dialog.Description>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset disabled={busy}>
          <label><span>{t.title}</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={120} required autoFocus /></label>
          <label><span>{t.description}</span><textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} maxLength={2000} /></label>
          <label><span>{t.category}</span><input value={category} onChange={event => setCategory(event.target.value)} list={categoriesId} maxLength={120} placeholder={t.categoryPlaceholder} required /><datalist id={categoriesId}>{[...new Set(categories)].filter(name => name.trim()).map(name => <option key={name} value={name} />)}</datalist></label>
          <label><span>{t.tags}</span><input value={tags} onChange={event => setTags(event.target.value)} placeholder={t.tagsPlaceholder} maxLength={1000} /></label>
        </fieldset>
        {error && <p className="journey-catalog-error" role="alert">{error}</p>}
        <footer><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>{t.cancel}</Button><Button type="submit" disabled={busy || !title.trim() || !category.trim()}>{saving && <LoaderCircle size={14} className="spin" />}{t.saveTemplate}</Button></footer>
      </form>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
