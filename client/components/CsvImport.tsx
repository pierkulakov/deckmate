import { defineText, formatNumber, locale, textNow, useLang, useText } from '../i18n.ts';
import { kindLabel, priorityLabel, stateLabel } from '../locales/common.ts';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileUp, LoaderCircle, RotateCcw, X } from 'lucide-react';
import { deckAcceptsCard, type CardPriority, type CatalogImportReport, type CatalogImportRow, type CatalogView } from '../../src/catalog-contracts.ts';
import { resolveReference } from '../../src/references.ts';
import { readCardState } from '../../src/format-vocabulary.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { useCatalog } from '../useCatalog.ts';
import { failureMessage } from '../failure-message.ts';
import { Button } from './ui/button.tsx';
import { CardTags } from './CardTags.tsx';
import '../csv-import.css';

const text = defineText({
  reference: "Reference — check for existing cards",
  id: "ID — reused",
  title: "Title",
  kind: "Card type",
  state: "State",
  tags: "Tags",
  content: "Markdown — card content",
  ignored: "skipped",
  titleMissing: "no title: add a Title column or Markdown content",
  titleLong: "title exceeds 1,000 characters",
  contentLong: "content exceeds 200,000 characters",
  ownerLong: "owner exceeds 120 characters",
  taskState: "only Task Cards have a state",
  tagsLimit: "up to 100 tags of 80 characters each",
  existing: "card already in project",
  invalidId: "ID must be card:<uuid> — only new cards can be imported",
  duplicate: "same row appears earlier in the file",
  statusNew: "new",
  statusKnown: "in project",
  statusSkip: "skipped",
  statusError: "error",
  catalogLoading: "Catalog is still loading — select the file again.",
  noHeaders: "The file has no header row.",
  readFailed: "Could not read the file.",
  reload: "Reload the page before importing.",
  changed: "Catalog files changed. Refreshing data — check the preview and click Import again.",
  importFailed: "Could not import CSV.",
  connectionFailed: "Could not connect to Deckmate.",
  heading: "Import CSV",
  description: "Uses the same columns as CSV export. Cards are created in the selected Deck after a preview. Importing the same file again does not create duplicates.",
  close: "Close import",
  readOnly: "This source is read-only. Switch to the test copy in the top bar to import cards there.",
  loading: "Opening catalog…",
  chooseFile: "Choose a CSV file",
  fileInput: "CSV file to import",
  fileHelp: "Up to 10 MB and 5,000 rows; “;” or “,” delimiter, detected from the header. Columns match CSV export (Reference, ID, Title, Type, State, Owner, Effort, Priority, Tags, Markdown); Run, Milestone, Due date, Hero, Tracks, Hand and Deck are not imported.",
  fileColumns: "File columns",
  columns: "Columns",
  unused: "not used",
  deck: "Deck for new cards",
  chooseDeck: "Choose a Deck",
  noDeck: "No Deck accepts these card types",
  deckInvalid: "The selected Deck does not accept every row type.",
  preview: "Row preview",
  type: "Type",
  status: "Status",
  noFile: "no file selected",
  otherFile: "Choose another file",
  import: "Import",
  unknownPriority: (value: string) => `unknown priority “${value}”`,
  invalidEffort: (value: string) => `effort “${value}” is not a number`,
  unknownKind: (value: string) => `unknown type “${value}”`,
  unknownState: (value: string) => `unknown state “${value}”`,
  existingCard: (title: string) => `card already in project: ${title}`,
  ambiguousRef: (reference: string) => `reference ${reference} is ambiguous`,
  fileLarge: (size: string) => `File exceeds 10 MB (${size}).`,
  row: (number: string) => `row ${number}`,
  created: (count: string) => `Created ${count}`,
  report: (unchanged: string, skipped: string) => ` · already present ${unchanged} · skipped ${skipped}`,
  skipsShown: (count: string) => `showing the first 10 of ${count} skipped rows`,
  fileSummary: (name: string, delimiter: string, count: string) => `File “${name}” · delimiter “${delimiter}” · data rows: ${count}`,
  rowLimit: (limit: string) => `The file exceeds ${limit} rows — reduce it or split the import.`,
  column: (index: string) => `column ${index}`,
  // 2026-11-10: the row counters are label + Geist Mono value pairs (client/surface.css .page-number), like the pulse.
  previewCount: (shown: string, total: string) => `first ${shown} of ${total}`,
  countNew: "New",
  countKnown: "in project",
  countSkip: "skipped",
  countError: "errors",
  toWriteLabel: "to write:",
  uiOwner: "Owner",
  uiEffort: "Effort",
  uiPriority: "Priority",
  uiState: "State"
}, {
  reference: "Reference — проверка на существование",
  id: "ID — переиспользуется",
  title: "Название",
  kind: "Тип карточки",
  state: "Состояние",
  tags: "Теги",
  content: "Markdown — текст карточки",
  ignored: "пропускается",
  titleMissing: "нет названия: нужен столбец Title или текст в Markdown",
  titleLong: "название длиннее 1000 символов",
  contentLong: "текст длиннее 200000 символов",
  ownerLong: "имя исполнителя длиннее 120 символов",
  taskState: "состояние есть только у Task",
  tagsLimit: "теги — до 100 штук по 80 символов",
  existing: "карточка уже в проекте",
  invalidId: "ID не вида card:<uuid> — импортируются только новые карточки",
  duplicate: "повтор такой же строки выше в файле",
  statusNew: "новая",
  statusKnown: "есть в проекте",
  statusSkip: "пропуск",
  statusError: "ошибка",
  catalogLoading: "Каталог ещё загружается — повторите выбор файла.",
  noHeaders: "В файле нет строки заголовков.",
  readFailed: "Не удалось прочитать файл.",
  reload: "Перезагрузите страницу перед импортом.",
  changed: "Каталог изменился в файлах. Обновляем данные — проверьте предпросмотр и нажмите «Импортировать» ещё раз.",
  importFailed: "Не удалось импортировать CSV.",
  connectionFailed: "Не удалось связаться с Deckmate.",
  heading: "Импорт CSV",
  description: "Столбцы — как у экспорта CSV. Карточки создаются в выбранной колоде; перед записью — предпросмотр. Повторный импорт того же файла дублей не создаёт.",
  close: "Закрыть импорт",
  readOnly: "Источник открыт только для чтения. Переключитесь на тестовую копию в верхней полосе — импорт сохраняет карточки туда.",
  loading: "Открываем каталог…",
  chooseFile: "Выберите CSV-файл",
  fileInput: "CSV-файл для импорта",
  fileHelp: "До 10 МБ и 5000 строк; разделитель «;» или «,» — определяется по заголовку. Заголовки столбцов — как у экспорта CSV (Reference, ID, Title, Type, State, Owner, Effort, Priority, Tags, Markdown); Run, Milestone, срок, Hero, треки, Hand и колода из файла не переносятся.",
  fileColumns: "Столбцы файла",
  columns: "Столбцы",
  unused: "не используется",
  deck: "Колода для новых карточек",
  chooseDeck: "Выберите колоду",
  noDeck: "Нет колоды под эти типы карточек",
  deckInvalid: "Выбранная колода не принимает все типы строк.",
  preview: "Предпросмотр строк",
  type: "Тип",
  status: "Статус",
  noFile: "файл не выбран",
  otherFile: "Другой файл",
  import: "Импортировать",
  unknownPriority: (value: string) => `неизвестный приоритет «${value}»`,
  invalidEffort: (value: string) => `оценка «${value}» — не число`,
  unknownKind: (value: string) => `неизвестный тип «${value}»`,
  unknownState: (value: string) => `неизвестное состояние «${value}»`,
  existingCard: (title: string) => `карточка уже в проекте: ${title}`,
  ambiguousRef: (reference: string) => `ссылка ${reference} неоднозначна`,
  fileLarge: (size: string) => `Файл больше 10 МБ (${size}).`,
  row: (number: string) => `строка ${number}`,
  created: (count: string) => `Создано ${count}`,
  report: (unchanged: string, skipped: string) => ` · уже были ${unchanged} · пропущено ${skipped}`,
  skipsShown: (count: string) => `показаны первые 10 пропусков из ${count}`,
  fileSummary: (name: string, delimiter: string, count: string) => `Файл «${name}» · разделитель «${delimiter}» · строк данных: ${count}`,
  rowLimit: (limit: string) => `В файле больше ${limit} строк — уменьшите файл или разделите импорт.`,
  column: (index: string) => `столбец ${index}`,
  previewCount: (shown: string, total: string) => `первые ${shown} из ${total}`,
  countNew: "Новых",
  countKnown: "уже в проекте",
  countSkip: "пропусков",
  countError: "ошибок",
  toWriteLabel: "к записи:",
  uiOwner: "Исполнитель",
  uiEffort: "Оценка",
  uiPriority: "Приоритет",
  uiState: "Состояние"
});

// CSV import accepts the same columns as export (src/card-export.ts):
// Reference;ID;Title;Type;State;Deck;Owner;Effort;Priority;Tags;Run;Milestone;Due date;Hero;Tracks;Hand;
// Bookmarked;Archived;Deleted;Source path;Markdown, plus header aliases.
// Cards use the deck selected in the form, ignoring the file's Deck column; mapping and rows are previewed before writing.
// Reimports do not duplicate cards: supplied IDs are reused, and the server derives missing IDs from row contents.

const fileLimitBytes = 10 * 1024 * 1024;
const rowLimit = 5000;
const cardIdPattern = /^card:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Semantic column targets; labels are normalized (lowercase, collapsed spaces). Exact labels of our export win,
// with aliases for common headers such as title/summary, creator/assignee/owner, and estimate/effort.
type FieldId = 'reference' | 'id' | 'title' | 'kind' | 'state' | 'owner' | 'effort' | 'priority' | 'tags' | 'content' | 'ignored';

const headerToField: Record<string, FieldId> = {
  reference: 'reference', ref: 'reference', ссылка: 'reference',
  id: 'id', 'card id': 'id', uuid: 'id',
  title: 'title', summary: 'title', name: 'title', название: 'title', имя: 'title',
  type: 'kind', kind: 'kind', вид: 'kind', тип: 'kind',
  state: 'state', status: 'state', статус: 'state', состояние: 'state',
  owner: 'owner', assignee: 'owner', creator: 'owner', исполнитель: 'owner', автор: 'owner',
  effort: 'effort', estimate: 'effort', оценка: 'effort', цена: 'effort',
  priority: 'priority', p: 'priority', приоритет: 'priority',
  tags: 'tags', tag: 'tags', labels: 'tags', label: 'tags', теги: 'tags', тег: 'tags',
  markdown: 'content', content: 'content', description: 'content', текст: 'content', описание: 'content', содержимое: 'content', детали: 'content',
  deck: 'ignored', колода: 'ignored', run: 'ignored', milestone: 'ignored', 'due date': 'ignored', duedate: 'ignored',
  hero: 'ignored', tracks: 'ignored', hand: 'ignored', bookmarked: 'ignored', archived: 'ignored', deleted: 'ignored',
  'source path': 'ignored', path: 'ignored',
};
const kindNames: Record<string, CatalogImportRow['kind']> = { task: 'task', задача: 'task', hero: 'hero', 'hero card': 'hero',
  doc: 'doc', 'doc card': 'doc', документ: 'doc' };

interface ParsedFile { name: string; delimiter: string; columns: Array<{ header: string; field: FieldId | null }>; rows: MappedRow[]; overLimit: boolean }
type RowStatus = 'new' | 'known' | 'skip' | 'error';
interface MappedRow {
  number: number;
  status: RowStatus;
  reason: () => string;
  title: string;
  kind: CatalogImportRow['kind'];
  markdown: string;
  owner: string | null;
  effort: number | null;
  priority: CardPriority | null;
  state: string | null;
  tags: string[];
  cardId: string | null;
  signature: string;
}

/** RFC 4180: doubled quotes and quoted newlines; discard the trailing empty row. */
function splitCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') { cell += '"'; index += 1; } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

/** Remove the apostrophe that src/card-export.ts adds before formula-like cells. */
const formulaGuard = /^[\s\u0000-\u001f\ufeff]*[=+\-@]/u;
function unguard(text: string): string {
  const value = text.replace(/\r\n|\r/gu, '\n');
  if (value.startsWith("'") && formulaGuard.test(value.slice(1))) return value.slice(1);
  return value;
}

function detectDelimiter(headerLine: string): string {
  let semicolons = 0;
  let commas = 0;
  let quoted = false;
  for (const char of headerLine) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ';') semicolons += 1;
    else if (!quoted && char === ',') commas += 1;
  }
  return semicolons >= commas ? ';' : ',';
}

function parsePriorityCell(cell: string): { priority: CardPriority | null } | { error: () => string } {
  const value = cell.trim().toLocaleLowerCase('ru-RU');
  if (!value || ['none', '-', 'no priority', 'нет'].includes(value)) return { priority: null };
  if (['high', 'critical', 'urgent', 'p0', 'высокий'].includes(value)) return { priority: 'high' };
  if (['medium', 'normal', 'p1', 'средний'].includes(value)) return { priority: 'medium' };
  if (['low', 'minor', 'p2', 'низкий'].includes(value)) return { priority: 'low' };
  return { error: () => textNow(text).unknownPriority(cell.trim()) };
}

function parseEffortCell(cell: string): { effort: number | null } | { error: () => string } {
  const raw = cell.trim().replace(',', '.');
  if (!raw || raw === '-') return { effort: null };
  const effort = Number(raw);
  if (!Number.isFinite(effort) || effort < 0) return { error: () => textNow(text).invalidEffort(cell.trim()) };
  return { effort };
}

function mapRow(values: string[], columns: ReadonlyArray<{ field: FieldId | null }>, number: number, catalog: CatalogView): MappedRow {
  const cell = (field: FieldId): string => {
    const index = columns.findIndex(column => column.field === field);
    return index >= 0 && index < values.length ? unguard(values[index]).trim() : '';
  };
  const markdown = cell('content');
  const titleCell = cell('title');
  // Without Title, use the first nonempty content line while retaining the full content.
  const title = titleCell || markdown.split('\n').find(line => line.trim())?.trim() || '';
  let row: MappedRow = { number, status: 'new', reason: () => '', title, kind: 'task', markdown,
    owner: null, effort: null, priority: null, state: null, tags: [], cardId: null, signature: '' };
  const fail = (reason: () => string): MappedRow => ({ ...row, status: 'error', reason });

  const kindCell = cell('kind').toLocaleLowerCase('ru-RU');
  if (kindCell && !(kindCell in kindNames)) return fail(() => textNow(text).unknownKind(kindCell));
  row = { ...row, kind: kindCell ? kindNames[kindCell] : 'task' };

  if (!title) return fail(() => textNow(text).titleMissing);
  if (title.length > 1000) return fail(() => textNow(text).titleLong);
  if (markdown.length > 200000) return fail(() => textNow(text).contentLong);

  const ownerCell = cell('owner');
  if (ownerCell) {
    if (ownerCell.length > 120) return fail(() => textNow(text).ownerLong);
    row = { ...row, owner: ownerCell };
  }
  const effort = parseEffortCell(cell('effort'));
  if ('error' in effort) return fail(effort.error);
  const priority = parsePriorityCell(cell('priority'));
  if ('error' in priority) return fail(priority.error);
  row = { ...row, effort: effort.effort, priority: priority.priority };

  const stateCell = cell('state');
  if (stateCell && !['-', 'none', 'нет'].includes(stateCell.toLocaleLowerCase('ru-RU'))) {
    const state = readCardState(stateCell);
    if (!state) return fail(() => textNow(text).unknownState(stateCell));
    if (row.kind !== 'task') return fail(() => textNow(text).taskState);
    row = { ...row, state };
  }

  const tagsCell = cell('tags');
  if (tagsCell) {
    const tags = [...new Set(tagsCell.split(',').map(tag => tag.trim()).filter(Boolean))];
    if (tags.length > 100 || tags.some(tag => tag.length > 80)) return fail(() => textNow(text).tagsLimit);
    row = { ...row, tags };
  }

  // References to existing cards are skipped to avoid duplicates; importing does not update existing cards.
  const referenceCell = cell('reference');
  if (referenceCell) {
    try {
      const resolved = resolveReference(catalog.cards, 'c', referenceCell);
      if (resolved) return { ...row, status: 'skip', reason: () => textNow(text).existingCard(resolved.title) };
    } catch { return fail(() => textNow(text).ambiguousRef(referenceCell)); }
  }

  const idCell = cell('id');
  if (idCell) {
    if (cardIdPattern.test(idCell)) {
      // Send native card IDs to the server, which skips existing cards or creates missing ones.
      row = { ...row, cardId: idCell, status: catalog.cards.some(card => card.id === idCell) ? 'known' : row.status };
    } else if (catalog.cards.some(card => card.id === idCell)) return { ...row, status: 'skip', reason: () => textNow(text).existing };
    else return fail(() => textNow(text).invalidId);
  }
  // Match the server's derivedCardId input so identical file rows resolve to one card.
  return { ...row, signature: JSON.stringify([row.kind, title, row.markdown, row.owner, row.effort, row.priority, row.state, row.tags]) };
}

function parseCsvFile(name: string, content: string, catalog: CatalogView): ParsedFile {
  const firstLine = content.split(/\r?\n/u, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const table = splitCsv(content, delimiter);
  const header = table.shift() ?? [];
  const taken = new Set<FieldId>();
  const columns = header.map(rawHeader => {
    const normalized = rawHeader.replace(/\s+/gu, ' ').trim().toLocaleLowerCase('ru-RU');
    if (!Object.hasOwn(headerToField, normalized)) return { header: rawHeader, field: null };
    const field = headerToField[normalized];
    if (field === 'ignored') return { header: rawHeader, field };
    if (taken.has(field)) return { header: rawHeader, field: null }; // The first column for each semantic field wins.
    taken.add(field);
    return { header: rawHeader, field };
  });
  const seenSignatures = new Set<string>();
  const rows: MappedRow[] = [];
  for (const [index, values] of table.entries()) {
    const mapped = mapRow(values, columns, index + 2, catalog);
    if ((mapped.status === 'new' || mapped.status === 'known') && seenSignatures.has(mapped.signature)) {
      rows.push({ ...mapped, status: 'skip', reason: () => textNow(text).duplicate });
      continue;
    }
    seenSignatures.add(mapped.signature);
    rows.push(mapped);
  }
  return { name, delimiter, columns, rows, overLimit: rows.length > rowLimit };
}

export function CsvImport({ snapshot, refreshKey, open, initialDeckId = null, onOpenChange }: {
  snapshot: WorkspaceSnapshot;
  refreshKey: number;
  open: boolean;
  /** Deck whose header opened the import; null lets the user choose in the dialog. */
  initialDeckId?: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useText(text);
  const lang = useLang();
  // 2026-11-10: the shared cached formatter keeps the pulse's number formatting in the preview and counters.
  const amount = (value: number) => formatNumber(value, 20, lang);
  const columnLabels: Record<FieldId, string> = { reference: t.reference, id: t.id,
    title: t.title, kind: t.kind, state: t.state, owner: t.uiOwner, effort: t.uiEffort, priority: t.uiPriority,
    tags: t.tags, content: t.content, ignored: t.ignored };
  const statusTitles: Record<RowStatus, string> = { new: t.statusNew, known: t.statusKnown, skip: t.statusSkip, error: t.statusError };
  const catalog = useCatalog(snapshot, refreshKey);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [parseErrorMessage, setParseError] = useState<string | (() => string)>('');
  const parseError = typeof parseErrorMessage === 'function' ? parseErrorMessage() : parseErrorMessage;
  const [deckId, setDeckId] = useState('');
  useEffect(() => { if (open && initialDeckId) setDeckId(initialDeckId); }, [open, initialDeckId]);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<CatalogImportReport | null>(null);
  const [skippedHere, setSkippedHere] = useState<Array<{ title: string | (() => string); reason: () => string }>>([]);
  const [importErrorMessage, setImportError] = useState<string | (() => string)>('');
  const importError = typeof importErrorMessage === 'function' ? importErrorMessage() : importErrorMessage;
  const fileInput = useRef<HTMLInputElement>(null);
  const canWrite = snapshot.source === 'sandbox' && snapshot.writable;
  const view = catalog.catalog;
  const busy = running || catalog.pending;

  const counts = useMemo(() => {
    const value = { new: 0, known: 0, skip: 0, error: 0 };
    for (const row of parsed?.rows ?? []) value[row.status] += 1;
    return value;
  }, [parsed]);
  const sendable = useMemo(() => parsed?.rows.filter(row => row.status === 'new' || row.status === 'known') ?? [], [parsed]);
  // Offer only decks that accept every card type being sent.
  const compatibleDecks = useMemo(() => {
    if (!view || sendable.length === 0) return view?.decks ?? [];
    const kinds = new Set(sendable.map(row => row.kind));
    return view.decks.filter(deck => [...kinds].every(kind => deckAcceptsCard(deck.kind, kind)));
  }, [view, sendable]);
  const deckInvalid = Boolean(deckId && !compatibleDecks.some(deck => deck.id === deckId));

  function reset() {
    setParsed(null); setParseError(''); setDeckId(initialDeckId ?? ''); setReport(null); setSkippedHere([]); setImportError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  async function readFile(file: File) {
    setReport(null); setSkippedHere([]); setImportError('');
    if (file.size > fileLimitBytes) { setParsed(null); setParseError(() => () => textNow(text).fileLarge(new Intl.NumberFormat(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(file.size / 1024 / 1024))); return; }
    if (!view) { setParseError(() => () => textNow(text).catalogLoading); return; }
    try {
      const content = (await file.text()).replace(/^\uFEFF/u, '');
      const nextParsed = parseCsvFile(file.name, content, view);
      if (nextParsed.columns.length === 0) { setParsed(null); setParseError(() => () => textNow(text).noHeaders); return; }
      setDeckId(initialDeckId ?? ''); setParsed(nextParsed); setParseError('');
    } catch (error) {
      setParsed(null); setParseError(() => error instanceof Error ? error.message : () => textNow(text).readFailed);
    }
  }

  async function runImport() {
    if (!view || !parsed || busy || !deckId || deckInvalid || !canWrite || sendable.length === 0 || parsed.overLimit) return;
    const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
    if (!token) { setImportError(() => () => textNow(text).reload); return; }
    const cards: CatalogImportRow[] = sendable.map(row => ({ cardId: row.cardId, kind: row.kind, title: row.title,
      markdown: row.markdown, owner: row.owner, effort: row.effort, priority: row.priority, state: row.state, tags: row.tags }));
    setRunning(true); setImportError('');
    try {
      const response = await fetch('/api/catalog-import', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token },
        body: JSON.stringify({ source: 'sandbox', manifestHash: view.manifestHash, optionsHash: view.optionsHash ?? '', deckId, cards }) });
      if (response.status === 409) {
        setImportError(() => () => textNow(text).changed);
        void catalog.refresh();
        return;
      }
      const result = await response.json() as CatalogImportReport & { message?: string };
      if (!response.ok) { setImportError(() => result.message ?? (() => textNow(text).importFailed)); return; }
      // Include rows skipped by the client, including existing cards and parse errors, in the final server report.
      setSkippedHere((parsed?.rows ?? []).filter(row => row.status === 'skip' || row.status === 'error')
        .map(row => ({ title: row.title.slice(0, 120) || (() => textNow(text).row(new Intl.NumberFormat(locale()).format(row.number))), reason: row.reason })));
      setReport(result);
      void catalog.refresh();
    } catch (error) {
      setImportError(() => failureMessage(error, textNow(text).connectionFailed));
    } finally { setRunning(false); }
  }

  const previewRows = parsed?.rows.slice(0, 10) ?? [];
  const allSkips = report ? [...report.skipped, ...skippedHere] : [];

  return <Dialog.Root open={open} onOpenChange={next => { if (!next && running) return; onOpenChange(next); }}><Dialog.Portal>
    <Dialog.Overlay className="dialog-overlay" />
    <Dialog.Content className="csv-import dialog-panel" aria-busy={busy}>
      <header className="csv-import-head dialog-head">
        <div className="csv-import-heading">
          <Dialog.Title className="dialog-title">{t.heading}</Dialog.Title>
          <Dialog.Description>{t.description}</Dialog.Description>
        </div>
        <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t.close}><X size={17} /></Button></Dialog.Close>
      </header>
      <div className="csv-import-body">
        {catalog.error && <p className="csv-import-error" role="alert">{catalog.error}</p>}
        {!canWrite && <p className="csv-import-note">{t.readOnly}</p>}
        {canWrite && !view && <p className="csv-import-note" role="status"><LoaderCircle size={12} className="spin" /> {t.loading}</p>}
        {report && <div className="csv-import-report" role="status">
          <p><strong>{t.created(amount(report.created.length))}</strong>{t.report(amount(report.unchanged.length), amount(allSkips.length))}</p>
          {report.warnings.map(warning => <p key={warning} className="csv-import-warning">{warning}</p>)}
          {allSkips.slice(0, 10).map((skip, index) => <p key={index} className="csv-import-skip-line">«{typeof skip.title === 'function' ? skip.title() : skip.title}» — {typeof skip.reason === 'function' ? skip.reason() : skip.reason}</p>)}
          {allSkips.length > 10 && <p className="csv-import-note">{t.skipsShown(amount(allSkips.length))}</p>}
        </div>}
        {!parsed && <div className="csv-import-pick">
          <label className="csv-import-file-label">
            <FileUp size={20} aria-hidden="true" />
            <span>{parseError || t.chooseFile}</span>
            <input ref={fileInput} type="file" accept=".csv,text/csv" aria-label={t.fileInput}
              disabled={!canWrite || busy || !view} onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); }} />
          </label>
          <p className="csv-import-note">{t.fileHelp}</p>
        </div>}
        {parsed && view && <>
          <p className="csv-import-file-line">{t.fileSummary(parsed.name, parsed.delimiter, amount(parsed.rows.length))}</p>
          {parseError && <p className="csv-import-error" role="alert">{parseError}</p>}
          {parsed.overLimit && <p className="csv-import-error" role="alert">{t.rowLimit(amount(rowLimit))}</p>}
          <section className="csv-import-mapping glass-panel" aria-label={t.fileColumns}>
            <div className="panel-head">
              <h3 className="panel-title">{t.columns}</h3>
              <span className="panel-count">{amount(parsed.columns.length)}</span>
            </div>
            <ul>{parsed.columns.map((column, index) => <li key={index}>
              <span className="csv-import-column-name">{column.header || t.column(amount(index + 1))}</span>
              <span className={column.field ? 'csv-import-column-field' : 'csv-import-column-unused'}>
                {column.field ? columnLabels[column.field] : t.unused}
              </span>
            </li>)}</ul>
          </section>
          <label className="csv-import-field">{t.deck}
            <select className="control-field" value={deckId} disabled={busy || compatibleDecks.length === 0} aria-label={t.deck}
              onChange={event => setDeckId(event.target.value)}>
              <option value="">{compatibleDecks.length ? t.chooseDeck : t.noDeck}</option>
              {compatibleDecks.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>)}
            </select>
          </label>
          {deckInvalid && <p className="csv-import-error" role="alert">{t.deckInvalid}</p>}
          <section className="csv-import-preview glass-panel" aria-label={t.preview}>
            <div className="panel-head">
              <h3 className="panel-title">{t.preview}</h3>
              <span className="panel-count">{t.previewCount(amount(previewRows.length), amount(parsed.rows.length))}</span>
            </div>
            <div className="csv-import-table-scroll">
              <table>
                <thead><tr><th>№</th><th>{t.title}</th><th>{t.type}</th><th>{t.uiOwner}</th><th>{t.uiEffort}</th><th>{t.uiPriority}</th><th>{t.uiState}</th><th>{t.tags}</th><th>{t.status}</th></tr></thead>
                <tbody>{previewRows.map(row => <tr key={amount(row.number)} className={`is-${row.status}`}>
                  <td>{amount(row.number)}</td>
                  <td><span className="csv-import-cell-title">{row.title || '—'}</span>{row.reason() && <small>{row.reason()}</small>}</td>
                  <td>{kindLabel(row.kind, lang)}</td>
                  <td>{row.owner ?? '—'}</td>
                  <td>{row.effort == null ? '—' : amount(row.effort)}</td>
                  <td>{row.priority ? priorityLabel(row.priority, lang) : '—'}</td>
                  <td>{row.state ? stateLabel(row.state, lang) : '—'}</td>
                  <td>{row.tags.length ? <CardTags tags={row.tags} definitions={view?.projectTags} compact /> : '—'}</td>
                  <td>{statusTitles[row.status]}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <p className="csv-import-note csv-import-counts">
              {([[t.countNew, counts.new], [t.countKnown, counts.known], [t.countSkip, counts.skip], [t.countError, counts.error]] as const)
                .map(([label, value], index) => <Fragment key={label}>
                  {index > 0 && <span className="dot-separator" aria-hidden="true">·</span>}
                  <span>{label} <span className="page-number">{amount(value)}</span></span>
                </Fragment>)}
            </p>
          </section>
        </>}
        {importError && <p className="csv-import-error" role="alert">{importError}</p>}
      </div>
      <footer className="csv-import-foot dialog-foot">
        <span className="csv-import-hint">{parsed ? <>{t.toWriteLabel} <span className="page-number">{amount(sendable.length)}</span></> : t.noFile}</span>
        <span className="csv-import-actions">
          {parsed && <Button variant="ghost" size="sm" disabled={busy} onClick={reset}><RotateCcw size={13} />{t.otherFile}</Button>}
          <Button variant="ghost" size="sm" className="action-mint" disabled={!canWrite || busy || !view || !parsed || parsed.overLimit || !deckId || deckInvalid || sendable.length === 0}
            onClick={() => void runImport()}>
            {running && <LoaderCircle size={14} className="spin" />}{t.import}
          </Button>
        </span>
      </footer>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
