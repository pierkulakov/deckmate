import { useEffect, useId, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Layers, LoaderCircle, Minus, Plus, RefreshCw, Route, X } from 'lucide-react';
import type { ProjectTemplate, ProjectTemplateCategory, ProjectTemplatePlan, ProjectTemplatePlanItem } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { defineText, useLang, useText } from '../i18n.ts';
import { useCatalog } from '../useCatalog.ts';
import { catalogStore } from '../catalog-store.ts';
import { readStoredValue } from '../storage.ts';
import { failureMessage } from '../failure-message.ts';
import { navigateTabs } from '../tab-navigation.ts';
import { templateText } from '../../src/template-text.ts';
import { Markdown } from './Markdown.tsx';
import { Button } from './ui/button.tsx';
import '../project-templates.css';

const text = defineText({
  title: 'Start from template',
  description: 'Choose a starter to set up your project with decks and Journeys.',
  choose: 'Choose a starter',
  shelves: 'Template shelves',
  games: 'Games',
  software: 'Software',
  shelfEmpty: 'No starters on this shelf yet.',
  close: 'Close template picker',
  loading: 'Loading templates…',
  loadingPlan: 'Preparing your project…',
  loadFailed: 'Could not load templates. Try again.',
  planFailed: 'Could not load the plan. Try again.',
  retry: 'Try again',
  empty: 'No project templates are available in this installation.',
  select: 'Choose a template to see its project structure.',
  plan: 'Your project',
  create: 'Will be created',
  resume: 'Will be completed',
  reuse: 'Already exists',
  skip: 'Skipped',
  space: 'Space',
  deck: 'Deck',
  journey: 'Journey',
  tag: 'Tag',
  sample: 'Example card',
  samples: 'Add example cards',
  samplesHint: 'Hero cards with Journey steps to explore the workflow.',
  additive: 'Existing spaces, decks and tags are kept.',
  readOnly: 'This project is read only. Open an editable project to apply a template.',
  stale: 'The project changed. Refresh the plan before applying.',
  refreshPlan: 'Refresh plan',
  cancel: 'Cancel',
  apply: 'Apply',
  applying: 'Applying…',
  noChanges: 'This structure is already in your project.',
  decks: (count: number) => `${count} ${count === 1 ? 'deck' : 'decks'}`,
  journeys: (count: number) => `${count} ${count === 1 ? 'Journey' : 'Journeys'}`,
}, {
  title: 'Начать с шаблона',
  description: 'Выберите заготовку, чтобы добавить в проект колоды и Journey.',
  choose: 'Выберите заготовку',
  shelves: 'Полки шаблонов',
  games: 'Игры',
  software: 'Софт',
  shelfEmpty: 'На этой полке заготовок пока нет.',
  close: 'Закрыть выбор шаблона',
  loading: 'Загружаем шаблоны…',
  loadingPlan: 'Готовим план проекта…',
  loadFailed: 'Не удалось загрузить шаблоны. Повторите попытку.',
  planFailed: 'Не удалось загрузить план. Повторите попытку.',
  retry: 'Повторить',
  empty: 'В этой установке нет шаблонов проекта.',
  select: 'Выберите шаблон, чтобы увидеть структуру проекта.',
  plan: 'Ваш проект',
  create: 'Создастся',
  resume: 'Достроится',
  reuse: 'Уже есть',
  skip: 'Пропущено',
  space: 'Пространство',
  deck: 'Колода',
  journey: 'Journey',
  tag: 'Тег',
  sample: 'Пример карточки',
  samples: 'Добавить примеры карточек',
  samplesHint: 'Hero-карточки с шагами Journey для знакомства с процессом.',
  additive: 'Существующие пространства, колоды и теги сохраняются.',
  readOnly: 'Проект открыт только для чтения. Для применения шаблона откройте проект с доступом к записи.',
  stale: 'Проект изменился. Обновите план перед применением.',
  refreshPlan: 'Обновить план',
  cancel: 'Отмена',
  apply: 'Применить',
  applying: 'Применяем…',
  noChanges: 'Эта структура уже есть в вашем проекте.',
  decks: (count: number) => `Колоды: ${count}`,
  journeys: (count: number) => `Journey: ${count}`,
});

// 2026-11-05: starters sit on two shelves, Games and Software; the key remembers the last opened one.
const shelfStorageKey = 'deckmate:template-shelf';
const templateShelves: readonly ProjectTemplateCategory[] = ['games', 'software'];

/** The remembered shelf, or null when nothing valid is stored. */
export function storedTemplateShelf(): ProjectTemplateCategory | null {
  try {
    const stored = readStoredValue(localStorage, shelfStorageKey);
    return stored === 'games' || stored === 'software' ? stored : null;
  } catch { return null; }
}

/** The project's own shelf: a profile genre key (tasks/deckmate-project.md) means a game project, so Games opens
 * first; software projects have no profile genre. Null when the shelf is unknown (2026-11-05). */
export function projectTemplateShelf(catalog: { cards: ReadonlyArray<{ id: string; markdown: string }> } | null): ProjectTemplateCategory | null {
  const profile = catalog?.cards.find(card => card.id === 'doc:tasks/deckmate-project.md');
  if (!profile) return null;
  // trimStart drops a BOM the way the template parser does, so the frontmatter still matches.
  const header = /^---\r?\n([\s\S]*?)^---/mu.exec(profile.markdown.trimStart());
  // A real genre key marks a game project; an explicit null or a quoted value leaves the shelf unknown.
  return header && /^genre:[ \t]*(?!null[ \t]*$)[a-z0-9][a-z0-9-]*[ \t]*$/mu.test(header[1]) ? 'games' : null;
}

async function loadJson<Value>(url: string, signal: AbortSignal, fallback: string): Promise<Value> {
  let response: Response;
  let result: unknown;
  try {
    response = await fetch(url, { signal, cache: 'no-store' });
    result = await response.json();
  } catch (failure) {
    throw new Error(failureMessage(failure, fallback));
  }
  if (!response.ok) {
    const message = result && typeof result === 'object' && 'message' in result ? String(result.message) : fallback;
    throw new Error(message);
  }
  return result as Value;
}

function PlanGroup({ status, items }: { status: ProjectTemplatePlanItem['status']; items: ProjectTemplatePlanItem[] }) {
  const t = useText(text);
  const StatusIcon = { create: Plus, resume: RefreshCw, reuse: Check, skip: Minus }[status];
  if (items.length === 0) return null;
  return <section className={`project-template-plan-group is-${status}`}>
    <h4><StatusIcon size={14} aria-hidden="true" />{t[status]}<span>{items.length}</span></h4>
    <ul>{items.map((item, index) => <li key={`${item.kind}:${item.title}:${index}`}>
      <div><span>{item.title}</span><small>{t[item.kind]}</small></div>
      {item.reason && <p>{item.reason}</p>}
    </li>)}</ul>
  </section>;
}

export function ProjectTemplates({ snapshot, refreshKey, onClose, onApplied, testCopy }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  onClose: () => void;
  onApplied: () => void;
  /** 2026-11-05: App's own source switch and texts, so the window stays open on the test copy and the wording lives once. */
  testCopy: { notice: string; action: string; open: () => void };
}) {
  const t = useText(text);
  const lang = useLang();
  const catalog = useCatalog(snapshot, refreshKey);
  const shelfTabsId = useId();
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [samples, setSamples] = useState(false);
  // 2026-11-05: the shelf opens on the project's own shelf; the remembered tab covers projects without a known genre.
  const [rememberedShelf] = useState(storedTemplateShelf);
  const [pickedShelf, setPickedShelf] = useState<ProjectTemplateCategory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [plan, setPlan] = useState<ProjectTemplatePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planError, setPlanError] = useState('');
  const [reload, setReload] = useState(0);
  const [planRevision, setPlanRevision] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState('');
  const selected = templates.find(template => template.id === selectedId);
  const selectedText = selected && templateText(selected, lang);
  const details = useMemo(() => markdownParser.parse(selected?.details ?? ''), [selected?.details]);
  const projectShelf = useMemo(() => projectTemplateShelf(catalog.catalog), [catalog.catalog]);
  const shelf = pickedShelf ?? projectShelf ?? rememberedShelf ?? 'games';
  const shelfTemplates = useMemo(() => templates.filter(template => template.category === shelf), [templates, shelf]);
  const busy = applying || catalog.pending;
  const canWrite = snapshot.writable && snapshot.source === 'sandbox';
  const originalReadOnly = snapshot.editMode === 'sandbox' && snapshot.source === 'live';
  const currentPlan = plan?.templateId === selectedId ? plan : null;
  const stale = Boolean(currentPlan && catalog.catalog && currentPlan.manifestHash !== catalog.catalog.manifestHash);
  const items = currentPlan?.items.filter(item => samples || item.kind !== 'sample') ?? [];
  const changes = items.filter(item => item.status === 'create' || item.status === 'resume').length;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError('');
    void loadJson<ProjectTemplate[]>(`/api/project-templates?source=${snapshot.source}`, controller.signal, t.loadFailed)
      .then(result => {
        if (controller.signal.aborted) return;
        setTemplates(result);
      }).catch(error => {
        if (!controller.signal.aborted) setLoadError(failureMessage(error, t.loadFailed));
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [snapshot.source, lang, reload, t.loadFailed]);

  // The selection follows the shelf: keep the chosen starter while it stays on the shelf, else take the shelf's first.
  useEffect(() => {
    setSelectedId(current => shelfTemplates.some(template => template.id === current) ? current : shelfTemplates[0]?.id ?? '');
  }, [shelfTemplates]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    setPlan(null);
    setPlanError('');
    setPlanning(true);
    void loadJson<ProjectTemplatePlan>(`/api/project-templates/${encodeURIComponent(selectedId)}/plan?source=${snapshot.source}`, controller.signal, t.planFailed)
      .then(result => { if (!controller.signal.aborted) setPlan(result); })
      .catch(error => { if (!controller.signal.aborted) setPlanError(failureMessage(error, t.planFailed)); })
      .finally(() => { if (!controller.signal.aborted) setPlanning(false); });
    return () => controller.abort();
  }, [selectedId, selected?.fileHash, snapshot.source, lang, planRevision, t.planFailed]);

  function chooseShelf(category: ProjectTemplateCategory) {
    if (category === shelf) return;
    setPickedShelf(category);
    try { localStorage.setItem(shelfStorageKey, category); } catch { /* Without localStorage the tab lasts until the picker closes. */ }
  }

  async function apply() {
    if (!currentPlan || !selected || !catalog.catalog || busy || planning || stale || !canWrite || changes === 0) return;
    setApplying(true);
    setApplyMessage('');
    try {
      const saved = await catalog.edit({ action: 'apply-project-template', templateId: selected.id,
        templateHash: currentPlan.templateHash, manifestHash: currentPlan.manifestHash, samples });
      // 2026-11-05: capture only this edit's result; later store updates belong to other catalog consumers.
      const result = catalogStore(snapshot.source).getSnapshot();
      const message = saved ? result.warning : result.error;
      setApplyMessage(message ?? '');
      if (saved && !message) onApplied();
      else {
        setPlan(null);
        setPlanRevision(value => value + 1);
      }
    } finally { setApplying(false); }
  }


  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="project-template-picker" aria-busy={busy}>
      <header className="project-template-header">
        <div className="project-template-heading"><Dialog.Title>{t.title}</Dialog.Title><Dialog.Description>{t.description}</Dialog.Description></div>
        <div className="project-template-shelves" role="tablist" aria-label={t.shelves} onKeyDown={navigateTabs}>
          {templateShelves.map(category => <button type="button" role="tab" key={category}
            id={`${shelfTabsId}-${category}`} aria-controls={`${shelfTabsId}-panel`} tabIndex={shelf === category ? 0 : -1}
            aria-selected={shelf === category} className="project-template-shelf" disabled={busy}
            onClick={() => chooseShelf(category)}>{t[category]}</button>)}
        </div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" className="project-template-close" disabled={busy} aria-label={t.close}><X size={18} /></Button></Dialog.Close>
      </header>
      <div className="project-template-body" role="tabpanel" id={`${shelfTabsId}-panel`} aria-labelledby={`${shelfTabsId}-${shelf}`} tabIndex={0}>
        <section className="project-template-browser" aria-label={t.choose} aria-busy={loading}>
          {loading && <p className="project-template-message" role="status"><LoaderCircle size={17} className="spin" />{t.loading}</p>}
          {loadError && <div className="project-template-error" role="alert"><p>{loadError}</p><Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>{t.retry}</Button></div>}
          {!loading && !loadError && templates.length === 0 && <p className="project-template-message">{t.empty}</p>}
          {!loading && !loadError && templates.length > 0 && shelfTemplates.length === 0 && <p className="project-template-message">{t.shelfEmpty}</p>}
          {!loadError && shelfTemplates.length > 0 && <div className="project-template-grid">{shelfTemplates.map(template => {
            const localized = templateText(template, lang);
            return <button type="button" key={template.id}
              className="project-template-option" aria-pressed={selectedId === template.id} disabled={busy || loading}
              onClick={() => { setSelectedId(template.id); setApplyMessage(''); }}>
              <span className="project-template-option-title"><strong>{localized.title}</strong>{selectedId === template.id && <Check size={17} aria-hidden="true" />}</span>
              <span className="project-template-description">{localized.description}</span>
              <span className="project-template-counts"><span><Layers size={13} aria-hidden="true" />{t.decks(template.decks.length)}</span>
                <span><Route size={13} aria-hidden="true" />{t.journeys(template.decks.filter(deck => deck.journey).length)}</span></span>
            </button>;
          })}</div>}
        </section>
        <aside className="project-template-plan" aria-label={t.plan} aria-busy={planning}>
          {selected && selectedText ? <>
            <h3>{selectedText.title}</h3>
            {selected.details && <div className="project-template-details"><Markdown tree={details} source={snapshot.source} path={`assets/project-templates/${selected.id}.md`} /></div>}
            <p className="project-template-note">{t.additive}</p>
            {planning && <p className="project-template-message" role="status"><LoaderCircle size={16} className="spin" />{t.loadingPlan}</p>}
            {planError && <div className="project-template-error" role="alert"><p>{planError}</p><Button variant="outline" size="sm" onClick={() => setPlanRevision(value => value + 1)}>{t.retry}</Button></div>}
            {currentPlan && !planning && <div className="project-template-plan-items">
              {(['create', 'resume', 'reuse', 'skip'] as const).map(status => <PlanGroup key={status} status={status} items={items.filter(item => item.status === status)} />)}
            </div>}
          </> : !loading && !loadError && shelfTemplates.length > 0 && <p className="project-template-message">{t.select}</p>}
        </aside>
      </div>
      <footer className="project-template-footer">
        {(applyMessage || catalog.error) && <p className="project-template-error" role="alert">{applyMessage || catalog.error}</p>}
        {!canWrite && <div className="project-template-stale">
          <p className="project-template-note">{originalReadOnly ? testCopy.notice : t.readOnly}</p>
          {originalReadOnly && <Button variant="outline" size="sm" onClick={testCopy.open}>{testCopy.action}</Button>}
        </div>}
        {stale && <div className="project-template-stale" role="status"><span>{t.stale}</span><Button variant="outline" size="sm" disabled={busy || planning} onClick={() => { setApplyMessage(''); setPlanRevision(value => value + 1); }}><RefreshCw size={13} />{t.refreshPlan}</Button></div>}
        <div className="project-template-footer-row">
          <label className="project-template-samples"><input type="checkbox" checked={samples} disabled={busy || !selected?.samples.length} onChange={event => setSamples(event.target.checked)} />
            <span><strong>{t.samples}</strong><small>{t.samplesHint}</small></span></label>
          <div className="project-template-actions"><Button variant="ghost" disabled={busy} onClick={onClose}>{t.cancel}</Button>
            <Button disabled={!canWrite || busy || loading || planning || !currentPlan || !catalog.catalog || Boolean(planError) || Boolean(loadError) || stale || changes === 0} onClick={() => void apply()}>
              {applying && <LoaderCircle size={15} className="spin" />}{applying ? t.applying : t.apply}
            </Button></div>
        </div>
        {currentPlan && !planning && changes === 0 && <p className="project-template-note" role="status">{t.noChanges}</p>}
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
