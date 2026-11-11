import { readStoredValue } from '../storage.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CaptureUpdateAction, Excalidraw, convertToExcalidrawElements, restore, serializeAsJSON } from '@excalidraw/excalidraw';
import type { AppState, ExcalidrawImperativeAPI, ExcalidrawProps } from '@excalidraw/excalidraw/types';
import type { ExcalidrawEmbeddableElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { ArrowUpRight, Check, Clapperboard, Gauge, Link2, MoreHorizontal, PencilLine, LoaderCircle, Plus, Save, Search, Type } from 'lucide-react';
import { BOARD_ACCESS_KEY, boardAccesses, boardCardIdOf, boardCustomValue, isBoardProtocolLink } from '../../src/board-contracts.ts';
import type { BoardAccess, BoardDocument, BoardScene, BoardSmartQuery, BoardSummary } from '../../src/board-contracts.ts';
import type { CatalogCard } from '../../src/catalog-contracts.ts';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { boardColumns } from '../../src/catalog-contracts.ts';
import { SMART_DONE_STATE } from '../../src/board-smart.ts';
import { defineText, locale, textNow, useLang, useText, type Lang } from '../i18n.ts';
import { kindLabel, stateLabel } from '../locales/common.ts';
import { useCatalog } from '../useCatalog.ts';
import { emitSignal } from '../onboarding/signals.ts';
import type { ShortcutScreen } from '../keyboard-shortcuts.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { Button } from './ui/button.tsx';
import { CardTagSummary } from './CardTags.tsx';
import { CardFaceStatus, cardFaceStatus } from './CardIndicators.tsx';
import { buildCatalogLookups } from '../catalog-lookups.ts';
import { EmptyState } from './EmptyState.tsx';
import { shortReference } from '../../src/references.ts';
import { CatalogReferenceLink } from './JourneyPanel.tsx';
import VisionCardNode, { visionCardSize, visionCardViewOf, visionCardViewOptions } from './VisionCardNode.tsx';
import VisionSmartNode, { visionSmartSize } from './VisionSmartNode.tsx';
import { fitVisionContent, fitVisionOnOpen, resetVisionZoom } from '../vision-viewport.ts';
import { desktopBoard } from '../desktop-bridge.ts';
import { deferredVisionScene, sanitizeVisionScene, visionSceneSignature } from '../vision-scene.ts';
import { BoardSceneSafetyError, boardImageMimeTypes, boardSafetyText, boardVideoAddress, isSafeBoardEmbed, isSafeBoardImage, isSafeBoardLink, maximumBoardBytes, maximumBoardImageBytes, sanitizeBoardScene, type BoardSafetyIssue } from '../../src/board-scene-safety.ts';
import '../vision.css';
import { warmMount } from '../warmup-mount.tsx';

const text = defineText({
  newScheme: 'New board',
  agent: 'agent',
  human: 'person',
  editable: 'Editable',
  readonly: 'Read only',
  locked: 'Locked',
  editableHint: 'Anyone with access can edit (default).',
  readonlyHint: 'Editing is disabled; you can switch back here.',
  lockedHint: 'Editing is disabled for everyone; only editing the board file can unlock it.',
  openFailed: 'Could not open the board.',
  loadingBoard: 'Opening board…',
  saveFailed: 'Could not save the board.',
  retry: 'Retry',
  restoreFailed: 'Could not restore the board. It has not been replaced with an empty board.',
  notResponding: 'Deckmate is not responding. Check that it is running, then try again.',
  notSavedOffline: 'Not saved: Deckmate is not responding. Check that it is running, then try again.',
  copyTitle: (title: string) => `${title} — copy`.slice(0, 120),
  noDecksForSmart: 'The project has no decks for Smart Node.',
  youtubeError: 'Video nodes support YouTube links (https://youtube.com/… or https://youtu.be/…).',
  saveBeforeCard: 'Save or discard the board edits before opening the card.',
  board: 'Vision board',
  boardAccess: 'Board access',
  schemeTitle: 'Board title',
  overview: 'Overview',
  actualSize: 'Zoom to 100%',
  toSelection: 'To selection',
  viewport: 'Board navigation',
  dirty: 'Unsaved changes',
  saved: 'Saved',
  newBoard: 'New board',
  save: 'Save',
  copy: 'Copy',
  discard: 'Discard changes',
  stale: 'The board file was updated externally. Your drawing is preserved in the editor.',
  loadNewVersion: 'Load new version',
  openedAs: (access: string) => `The board is open as ${access}. Editing is unavailable.`,
  switchEditable: ' Switch access to Editable through the “…” menu.',
  cardsOnBoard: 'Cards on the board',
  cardLinksDescription: 'Links open the source cards. Arrows on the board show connections in your diagram.',
  findCard: 'Find a card…',
  findCardForBoard: 'Find a card for the board',
  noMatches: 'No matches.',
  noCards: 'The project has no cards yet.',
  cardNotFound: 'Card not found',
  emptyLinked: 'Find a card and click + to add it to the board.',
  emptyLinkedReadOnly: 'No cards are linked to this board yet.',
  smartNode: 'Smart Node',
  smartDescription: (done: string) => `A “${done} / total” bar for a deck; recalculated on every catalog update.`,
  widgetDeck: 'Widget deck',
  widgetState: 'Widget state filter',
  allStates: 'All states',
  noDecks: 'No decks',
  widget: 'Widget',
  youtubeTitle: 'YouTube video',
  youtubeDescription: 'A YouTube link creates a video node; pasting a link directly onto the board works the same way.',
  desktopVideo: 'Videos do not play in the app. Add the video as a link and open it in your browser.',
  addVideoLink: 'Add as link',
  openInBrowser: 'Open in browser',
  youtubeLink: 'YouTube link',
  add: 'Add',
  selected: 'Selected',
  view: 'View',
  nodes: (count: number) => `(${new Intl.NumberFormat(locale('en')).format(count)} ${new Intl.PluralRules(locale('en')).select(count) === 'one' ? 'node' : 'nodes'})`,
  cardNodeView: 'Card node view',
  mixed: 'Mixed',
  imageCaption: 'Image caption',
  ok: 'OK',
  captionNote: 'The caption is text below the image and moves with it. Double-click the text on the board to edit it.',
  textRefs: 'References in text',
  textRefCard: 'Type ',
  textRefCardTail: ' in text nodes — card, ',
  textRefDeckToken: '$$Name',
  textRefDeckTail: ' — deck, ',
  textRefMemberToken: '@name',
  textRefMemberTail: ' — member.',
  deckNotFound: 'Deck not found',
  memberNotFound: 'Member not found',
  noTextRefs: 'There are no references in text nodes yet.',
  importFailed: 'Could not import the drawing. Use an Excalidraw scene, library, PNG, JPEG or WebP image.',
}, {
  newScheme: 'Новая доска',
  agent: 'агент',
  human: 'человек',
  editable: 'Можно править',
  readonly: 'Только чтение',
  locked: 'Заблокировано',
  editableHint: 'Каждый с доступом может править (по умолчанию).',
  readonlyHint: 'Правка закрыта; переключить обратно можно здесь.',
  lockedHint: 'Правка закрыта для всех; снять — только правкой файла доски.',
  openFailed: 'Не удалось открыть доску.',
  loadingBoard: 'Открываем доску…',
  saveFailed: 'Не удалось сохранить доску.',
  retry: 'Повторить',
  restoreFailed: 'Не удалось восстановить доску. Она не заменена пустой доской.',
  notResponding: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  notSavedOffline: 'Не сохранено: Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  copyTitle: (title: string) => `${title} — копия`.slice(0, 120),
  noDecksForSmart: 'В проекте нет колод для умного узла.',
  youtubeError: 'Видеоузлы поддерживают ссылки YouTube (https://youtube.com/… или https://youtu.be/…).',
  saveBeforeCard: 'Сохраните или отмените правки доски перед открытием карточки.',
  board: 'Доска Vision',
  boardAccess: 'Доступ к доске',
  schemeTitle: 'Название доски',
  overview: 'Обзор',
  actualSize: 'Масштаб 100%',
  toSelection: 'К выбранному',
  viewport: 'Навигация по доске',
  dirty: 'Есть изменения',
  saved: 'Сохранено',
  newBoard: 'Новая доска',
  save: 'Сохранить',
  copy: 'Копия',
  discard: 'Отменить правки',
  stale: 'Файл доски обновлён извне. Ваш рисунок сохранён в редакторе.',
  loadNewVersion: 'Загрузить новую версию',
  openedAs: (access: string) => `Доска открыта как ${access}. Правка недоступна.`,
  switchEditable: ' Выберите доступ «Можно править» через меню «…».',
  cardsOnBoard: 'Карточки на доске',
  cardLinksDescription: 'Ссылки ведут к исходным карточкам. Стрелки на доске показывают связи.',
  findCard: 'Найти карточку…',
  findCardForBoard: 'Найти карточку для доски',
  noMatches: 'Совпадений нет.',
  noCards: 'В проекте пока нет карточек.',
  cardNotFound: 'Карточка не найдена',
  emptyLinked: 'Найдите карточку и нажмите +, чтобы добавить её на доску.',
  emptyLinkedReadOnly: 'К этой доске пока не привязаны карточки.',
  smartNode: 'Умный узел',
  smartDescription: (done: string) => `Полоса «${done} / всего» по колоде; пересчитывается при каждом обновлении каталога.`,
  widgetDeck: 'Колода виджета',
  widgetState: 'Статус-фильтр виджета',
  allStates: 'Все состояния',
  noDecks: 'Нет колод',
  widget: 'Виджет',
  youtubeTitle: 'Видео YouTube',
  youtubeDescription: 'Ссылка YouTube создаёт видеоузел; вставка ссылки прямо на доску работает так же.',
  desktopVideo: 'В приложении видео не проигрывается. Добавьте его как ссылку и откройте в браузере.',
  addVideoLink: 'Добавить как ссылку',
  openInBrowser: 'Открыть в браузере',
  youtubeLink: 'Ссылка YouTube',
  add: 'Добавить',
  selected: 'Выделено',
  view: 'Вид',
  nodes: (count: number) => `(${new Intl.NumberFormat(locale('ru')).format(count)} узлов)`,
  cardNodeView: 'Вид карточного узла',
  mixed: 'Разные',
  imageCaption: 'Подпись изображения',
  ok: 'ОК',
  captionNote: 'Подпись — текст под картинкой, двигается вместе с ней. Текст меняют двойным кликом на доске.',
  textRefs: 'Ссылки в тексте',
  textRefCard: 'Печатайте в текстовых узлах ',
  textRefCardTail: ' — карточка, ',
  textRefDeckToken: '$$Название',
  textRefDeckTail: ' — колода, ',
  textRefMemberToken: '@имя',
  textRefMemberTail: ' — участник.',
  deckNotFound: 'Колода не найдена',
  memberNotFound: 'Участник не найден',
  noTextRefs: 'Ссылок в текстовых узлах пока нет.',
  importFailed: 'Не удалось импортировать рисунок. Используйте сцену Excalidraw, библиотеку, PNG, JPEG или WebP.',
});

const emptyScene: BoardScene = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} };
function VisionCanvasWarmup() {
  const lang = useLang();
  // 2026-11-11: the canvas writes a regional tag to html.lang; only the app store owns the interface language.
  return <Excalidraw initialData={{ elements: [] }} langCode={locale(lang)}
    theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'} viewModeEnabled
    UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />;
}
export async function warmVisionCanvas(signal: AbortSignal) {
  await warmMount(<VisionCanvasWarmup />, signal);
  if (signal.aborted) return;
  // 2026-11-10: Assistant belongs to Excalidraw's CSS, so the app font warmup cannot load it before this chunk installs it.
  for (const weight of [400, 500, 600, 700]) {
    if (signal.aborted) return;
    await document.fonts.load(`${weight} 14px Assistant`);
  }
}
// Vision has no shortcuts of its own: the overview lists the app-wide ones, as in Hand.
const visionShortcutScreens: readonly ShortcutScreen[] = ['app'];
type Props = { snapshot: WorkspaceSnapshot; refreshKey: number; dark: boolean; onEditing: (value: boolean) => void; onOpenCard: (id: string) => void };
type BoardRetry = { kind: 'list' } | { kind: 'open'; id: string; recovering: boolean } | { kind: 'save'; copy: boolean; accessOverride?: BoardAccess };
type BoardError = { message: string; retry: BoardRetry | null };

/** A fully-formed embeddable element: updateScene does not run restore, so every base field is explicit. */
function embeddableElement(seed: { x: number; y: number; width: number; height: number; link: string; customData: Record<string, unknown> }): Record<string, unknown> {
  const skeleton = { type: 'embeddable', ...seed, angle: 0,
    strokeColor: 'transparent', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 0, strokeStyle: 'solid',
    roughness: 0, opacity: 100, roundness: null, index: null, isDeleted: false, groupIds: [], frameId: null,
    boundElements: null, locked: false, updated: Date.now(),
    seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31) };
  const [element] = convertToExcalidrawElements([skeleton as unknown as NonNullable<Parameters<typeof convertToExcalidrawElements>[0]>[number]]);
  return element as unknown as Record<string, unknown>;
}

function isSmartQuery(value: unknown): value is BoardSmartQuery {
  return Boolean(value) && typeof value === 'object' && typeof (value as BoardSmartQuery).deckId === 'string'
    && ((value as BoardSmartQuery).state === null || typeof (value as BoardSmartQuery).state === 'string');
}

type SceneElement = Record<string, unknown> & { id: string; isDeleted?: boolean; type?: string; customData?: Record<string, unknown> };

// Text-node references: $c-… = card, $$Title = deck, @name = member.
type TextRef = { token: string; kind: 'card' | 'deck' | 'member'; title: string | null; cardId: string | null };
function textReferences(scene: BoardScene, catalog: ReturnType<typeof useCatalog>['catalog'], lang: Lang): TextRef[] {
  const found: TextRef[] = [];
  const seen = new Set<string>();
  const push = (ref: TextRef) => { if (!seen.has(ref.token)) { seen.add(ref.token); found.push(ref); } };
  for (const raw of scene.elements) {
    const element = raw as SceneElement;
    if (element.isDeleted || element.type !== 'text') continue;
    const nodeText = typeof element.text === 'string' ? element.text : '';
    if (!nodeText) continue;
    for (const match of nodeText.matchAll(/(?<!\$)\$c-[a-z0-9]+/gu)) {
      const token = match[0];
      const card = catalog?.cards.find(candidate => shortReference('c', candidate.id) === token);
      push({ token, kind: 'card', title: card?.title ?? null, cardId: card?.id ?? null });
    }
    for (const match of nodeText.matchAll(/\$\$([^\s]+)/gu)) {
      const token = match[1];
      const deck = catalog?.decks.find(candidate => candidate.title.toLocaleLowerCase() === token.toLocaleLowerCase());
      push({ token: `$$${token}`, kind: 'deck', title: deck?.title ?? null, cardId: null });
    }
    for (const match of nodeText.matchAll(/@([A-Za-zА-Яа-яЁё0-9_-]+)/gu)) {
      const token = match[1];
      const member = catalog?.members?.find(candidate => candidate.label.toLocaleLowerCase() === token.toLocaleLowerCase()
        || candidate.aliases.some(alias => alias.toLocaleLowerCase() === token.toLocaleLowerCase()));
      push({ token: `@${token}`, kind: 'member', title: member ? `${member.label} (${member.kind === 'agent' ? text[lang].agent : text[lang].human})` : null, cardId: null });
    }
  }
  return found;
}

function accessTitle(access: BoardAccess, lang: Lang): string {
  return { editable: text[lang].editable, readonly: text[lang].readonly, locked: text[lang].locked }[access];
}
function accessHint(access: BoardAccess, lang: Lang): string {
  return { editable: text[lang].editableHint, readonly: text[lang].readonlyHint, locked: text[lang].lockedHint }[access];
}
/** 2026-11-10: the quiet caption under the board name reports the editing state as one plain word. */
function boardSaveStateText(dirty: boolean, opened: BoardDocument | null, opening: boolean, states: { dirty: string; saved: string; newBoard: string }): string {
  if (opening) return '';
  if (dirty) return states.dirty;
  if (opened) return states.saved;
  return states.newBoard;
}
const lastBoardKey = (source: string) => `deckmate-vision-board-${source}`;
/** 2026-11-06: the board a fresh Vision mount will open (URL request first, then the last opened one), or null for a new board.
 * Knowing it before the first paint lets the canvas wait for that board instead of mounting an empty one and replacing it. */
function boardToRestore(source: string): { id: string } | null {
  const requested = new URLSearchParams(location.search).get('board');
  if (requested) return { id: requested };
  const last = readStoredValue(localStorage, lastBoardKey(source));
  return last ? { id: last } : null;
}

/** 2026-11-06: errors read as sentences, not «TypeError: Failed to fetch»: a server reply keeps its message, a stopped server
 * (fetch rejects with a TypeError) reads as Deckmate not responding. */
function failureText(failure: unknown, offline: string, fallback: string): string {
  if (failure instanceof TypeError) return offline;
  if (failure instanceof Error) return failure.message;
  return fallback;
}

async function responseJson<T>(response: Response): Promise<T> {
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? textNow(text).openFailed);
  return result as T;
}

export default function Vision({ snapshot, refreshKey, dark, onEditing, onOpenCard }: Props) {
  const t = useText(text);
  const lang = useLang();
  const desktop = Boolean(desktopBoard());
  const { catalog, error: catalogError, refresh: refreshCatalog } = useCatalog(snapshot, refreshKey);
  const lookups = useMemo(() => buildCatalogLookups(catalog?.cards ?? []), [catalog]);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [title, setTitle] = useState(() => textNow(text).newScheme);
  const [initialData, setInitialData] = useState<ExcalidrawProps['initialData']>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [sceneRevision, setSceneRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [boardError, setBoardError] = useState<BoardError | null>(null);
  const error = boardError?.message ?? null;
  const retryAction = boardError?.retry ?? null;
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [restoring, setRestoring] = useState(() => boardToRestore(snapshot.source) !== null);
  const [query, setQuery] = useState('');
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [selectionKey, setSelectionKey] = useState('');
  const [smartDeckId, setSmartDeckId] = useState('');
  const [smartState, setSmartState] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoError, setVideoError] = useState<string | null>(null);
  const [captionDraft, setCaptionDraft] = useState('');
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const fitOnOpen = useRef(true);
  const draftId = useRef<string>(crypto.randomUUID());
  const scene = useRef(emptyScene);
  const deferredScene = useMemo(() => deferredVisionScene(({ elements, appState, files }) => {
    scene.current = JSON.parse(serializeAsJSON(elements as never, appState as never, files as never, 'local')) as BoardScene;
  }), []);
  // 2026-11-05: quests count cards newly placed on the board; a ref, not the linkedIds state, so rapid canvas
  // changes diff against the latest set and loading another board resets the baseline without counting as additions.
  const boardCardIds = useRef<Set<string>>(new Set());
  const baseline = useRef('');
  const baselineTitle = useRef(textNow(text).newScheme);
  const currentTitle = useRef(title);
  const titleEdited = useRef(false);
  const previousLang = useRef(lang);
  currentTitle.current = title;
  const source = useRef(snapshot.source);
  source.current = snapshot.source;
  const editing = dirty || pending;
  const accessBlocked = document ? document.access !== 'editable' : false;
  // Read Only and Locked disable canvas editing while keeping the access menu available.
  const editable = snapshot.writable && !accessBlocked && !restoring && !restoreFailed;
  // 2026-11-10: in read-only the sidebar states facts instead of inviting actions the mode cannot take.
  const readOnly = !snapshot.writable || accessBlocked;
  // 2026-11-06: while the remembered board is read, the toolbar agrees with the loading state: no «New board» title and no Save
  // that would write an empty board in its place.
  const opening = (restoring || restoreFailed) && !initialData;
  const boardChoiceTitle = restoreFailed ? t.openFailed : t.newScheme;

  useEffect(() => { deferredScene.flush(); onEditing(editing); return () => onEditing(false); }, [editing, onEditing, deferredScene]);
  useEffect(() => {
    // 2026-11-10: unloading or leaving Vision can precede the debounce, including in a background window.
    if (typeof window === 'undefined') return () => deferredScene.flush();
    const flush = () => deferredScene.flush();
    window.addEventListener('beforeunload', flush, true);
    window.addEventListener('pagehide', flush);
    return () => {
      flush();
      window.removeEventListener('beforeunload', flush, true);
      window.removeEventListener('pagehide', flush);
    };
  }, [deferredScene]);
  useEffect(() => {
    if (previousLang.current === lang) return;
    const previousDefault = text[previousLang.current].newScheme;
    if (!document && !titleEdited.current && title === previousDefault) {
      const nextDefault = text[lang].newScheme;
      setTitle(nextDefault);
      currentTitle.current = nextDefault;
      if (baselineTitle.current === previousDefault) baselineTitle.current = nextDefault;
    }
    previousLang.current = lang;
  }, [lang, document, title]);

  function reportError(message: string | null, retry: BoardRetry | null = null) {
    setBoardError(message ? { message, retry } : null);
  }

  function reportListError(message: string | null) {
    // 2026-11-10: background list refreshes must not erase the failed board's restore/save retry target.
    setBoardError(previous => {
      if (previous && previous.retry?.kind !== 'list') return previous;
      return message ? { message, retry: { kind: 'list' } } : null;
    });
  }

  function display(next: BoardDocument | null, mountCanvas = true) {
    fitOnOpen.current = true;
    const safe = sanitizeVisionScene(next?.scene ?? emptyScene);
    setWarnings([...new Set([...(next?.warnings ?? []), ...safe.issues.map(issue => boardSafetyText[lang][issue])])]);
    const restored = restore(safe.scene as unknown as Parameters<typeof restore>[0], null, null);
    const serialized = serializeAsJSON(restored.elements, restored.appState, restored.files, 'local');
    scene.current = JSON.parse(serialized) as BoardScene;
    setSceneRevision(value => value + 1);
    deferredScene.reset(restored as unknown as Parameters<typeof visionSceneSignature>[0]);
    baseline.current = deferredScene.signature;
    baselineTitle.current = next?.title ?? textNow(text).newScheme;
    currentTitle.current = baselineTitle.current;
    titleEdited.current = false;
    setDocument(next); setTitle(next?.title ?? textNow(text).newScheme);
    draftId.current = next?.id ?? crypto.randomUUID();
    setLinkedIds(next?.linkedCardIds ?? []); setDirty(false); reportError(null); setRestoreFailed(false);
    boardCardIds.current = new Set(next?.linkedCardIds ?? []);
    // A pending restore keeps the canvas unmounted so the loading state shows instead of an empty board.
    setInitialData(mountCanvas ? { ...restored, scrollToContent: true } : null); setCanvasKey(value => value + 1);
  }

  async function refreshList() {
    const requested = snapshot.source;
    reportListError(null);
    try {
      const result = await responseJson<BoardSummary[]>(await fetch(`/api/boards?source=${requested}`));
      if (source.current === requested) setBoards(result);
    } catch (failure) { if (source.current === requested) reportListError(failureText(failure, textNow(text).notResponding, textNow(text).openFailed)); }
  }

  useEffect(() => {
    // The Vision tab returns to the last opened board; an empty board mounts only when there is nothing to restore.
    const wanted = boardToRestore(snapshot.source);
    display(null, !wanted); setBoards([]); setSelectionKey(''); setRestoring(wanted !== null);
    void (async () => {
      await refreshList();
      if (!wanted || source.current !== snapshot.source) return;
      // 2026-11-10: a failed restore must keep its retry target, not mount a writable empty replacement.
      await open(wanted.id, true);
    })();
  }, [snapshot.source]);
  useEffect(() => { void refreshList(); }, [refreshKey]);

  async function open(id: string, recovering = false): Promise<boolean> {
    if (hasUnsavedChanges() || pending) return false;
    const requested = snapshot.source;
    setPending(true); reportError(null);
    if (recovering) setRestoring(true);
    try {
      const result = await responseJson<BoardDocument>(await fetch(`/api/boards/${id}?source=${requested}`));
      if (source.current !== requested) return false;
      display(result); localStorage.setItem(lastBoardKey(requested), id); return true;
    }
    catch (failure) {
      if (source.current === requested) {
        const message = failureText(failure, textNow(text).notResponding, textNow(text).openFailed);
        reportError(recovering ? `${textNow(text).restoreFailed} ${message}` : message, { kind: 'open', id, recovering });
        if (recovering) setRestoreFailed(true);
      }
      return false;
    }
    finally { if (source.current === requested) { setPending(false); if (recovering) setRestoring(false); } }
  }

  async function save(copy = false, accessOverride?: BoardAccess) {
    deferredScene.flush();
    const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
    if (!token || !snapshot.writable || pending || opening) return;
    setPending(true); reportError(null);
    // The access state travels inside the scene appState; the editor never emits it, so inject it on every save.
    const access = accessOverride ?? (copy ? 'editable' : document?.access ?? 'editable');
    const payloadScene: BoardScene = { ...scene.current, appState: { ...scene.current.appState, [BOARD_ACCESS_KEY]: access } };
    const savedSignature = deferredScene.signature;
    try {
      const result = await responseJson<BoardDocument>(await fetch('/api/boards', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token },
        body: JSON.stringify({ source: snapshot.source, id: copy ? crypto.randomUUID() : document?.id ?? draftId.current,
          title: copy ? t.copyTitle(title) : title, hash: copy ? '' : document?.hash ?? '', scene: payloadScene }),
      }));
      deferredScene.flush();
      setDocument(result); setTitle(result.title);
      baseline.current = savedSignature;
      baselineTitle.current = result.title;
      currentTitle.current = result.title;
      setDirty(hasUnsavedChanges());
      localStorage.setItem(lastBoardKey(source.current), result.id);
      await refreshList();
    } catch (failure) { reportError(failureText(failure, t.notSavedOffline, t.saveFailed), { kind: 'save', copy, accessOverride }); }
    finally { setPending(false); }
  }

  function retryBoard() {
    if (!retryAction || pending) return;
    if (retryAction.kind === 'list') void refreshList();
    else if (retryAction.kind === 'open') void open(retryAction.id, retryAction.recovering);
    else void save(retryAction.copy, retryAction.accessOverride);
  }

  const onChange: ExcalidrawProps['onChange'] = (elements, appState, files) => {
    if (fitOnOpen.current && api.current) fitOnOpen.current = !fitVisionOnOpen(api.current);
    if (deferredScene.update({ elements, appState, files } as unknown as Parameters<typeof visionSceneSignature>[0])) {
      // 2026-11-10: panels need the live elements immediately, but disk-format serialization can wait for the batch.
      scene.current = { ...scene.current, elements: elements as unknown as BoardScene['elements'], appState: appState as unknown as BoardScene['appState'], files };
      setSceneRevision(value => value + 1);
      setDirty(deferredScene.signature !== baseline.current || currentTitle.current !== baselineTitle.current);
      const ids = [...new Set(elements.filter(element => !element.isDeleted).map(boardCardIdOf).filter((id): id is string => id !== null))];
      for (const id of ids) if (!boardCardIds.current.has(id)) emitSignal({ type: 'vision-card-added', cardId: id });
      boardCardIds.current = new Set(ids);
      setLinkedIds(previous => previous.join('\n') === ids.join('\n') ? previous : ids);
    }
    const selection = Object.keys(appState.selectedElementIds).sort().join('\n');
    setSelectionKey(previous => previous === selection ? previous : selection);
  };

  function hasUnsavedChanges(): boolean {
    deferredScene.flush();
    return deferredScene.signature !== baseline.current || currentTitle.current !== baselineTitle.current;
  }

  function viewportAnchor(): { x: number; y: number } {
    if (!api.current) return { x: 100, y: 100 };
    const state = api.current.getAppState();
    const cascade = (api.current.getSceneElements().length % 5) * 24;
    return { x: -state.scrollX + (100 + cascade) / state.zoom.value, y: -state.scrollY + (100 + cascade) / state.zoom.value };
  }

  // 2026-11-06: edits made from the side panel (card, widget, video, card view, caption) enter the undo stack at once, like
  // canvas edits; the default EVENTUALLY folded them into the next canvas action, so Undo skipped them and later undid them with it.
  function commitScene(elements: NonNullable<Parameters<ExcalidrawImperativeAPI['updateScene']>[0]['elements']>) {
    api.current?.updateScene({ elements, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
  }

  function addElement(element: Record<string, unknown>) {
    if (!api.current || !editable || pending) return;
    commitScene([...api.current.getSceneElements(), element as never]);
    api.current.scrollToContent([element as never]);
  }

  function addCard(card: CatalogCard) {
    const { x, y } = viewportAnchor();
    addElement(embeddableElement({ x, y, ...visionCardSize.mini,
      link: `/r/${shortReference('c', card.id)}?source=${snapshot.source}`,
      customData: { deckmateCardId: card.id, deckmateCardView: 'mini' } }));
  }

  function addSmartNode() {
    const deckId = smartDeckId || catalog?.decks[0]?.id;
    if (!deckId) return;
    const queryValue: BoardSmartQuery = { deckId, state: smartState || null };
    const { x, y } = viewportAnchor();
    addElement(embeddableElement({ x, y, ...visionSmartSize,
      link: `deckmate://smart/${deckId}`, customData: { deckmateSmart: queryValue } }));
  }

  function addVideoNode() {
    const link = boardVideoAddress(videoUrl.trim());
    if (!link) { setVideoError(t.youtubeError); return; }
    setVideoError(null);
    const { x, y } = viewportAnchor();
    addElement(embeddableElement({ x, y, width: 560, height: 315, link, customData: { deckmateVideo: link } }));
    setVideoUrl('');
  }

  function openCardFromBoard(cardId: string) {
    if (hasUnsavedChanges() || pending) reportError(t.saveBeforeCard);
    else onOpenCard(cardId);
  }

  const renderEmbeddable = useCallback<NonNullable<ExcalidrawProps['renderEmbeddable']>>((element: ExcalidrawEmbeddableElement, appState: AppState) => {
    const cardId = boardCardIdOf(element);
    const smartQuery = boardCustomValue(element.customData, 'Smart');
    const active = appState.activeEmbeddable?.element?.id === element.id && appState.activeEmbeddable?.state === 'active';
    if (cardId !== null) {
      const card = catalog?.cards.find(candidate => candidate.id === cardId);
      return <VisionCardNode card={card} cardId={cardId} view={visionCardViewOf(boardCustomValue(element.customData, 'CardView'))}
        catalog={catalog} lookups={lookups} interactive={active} onOpen={openCardFromBoard} />;
    }
    if (isSmartQuery(smartQuery)) return <VisionSmartNode query={smartQuery} catalog={catalog} />;
    const video = boardCustomValue(element.customData, 'Video');
    const link = typeof element.link === 'string' ? element.link : '';
    if (desktop && (typeof video === 'string' || boardVideoAddress(link))) {
      const address = boardVideoAddress(link);
      return <div className="deckmate-vision-video">
        <Clapperboard size={24} aria-hidden="true" />
        <strong>{t.youtubeTitle}</strong><p>{t.desktopVideo}</p>
        <span className="vision-video-address">{link || String(video)}</span>
        {address && <a className="ui-button button-outline button-size-sm" href={address} target="_blank" rel="noreferrer">{t.openInBrowser}<ArrowUpRight size={14} /></a>}
      </div>;
    }
    if (boardVideoAddress(link) && isSafeBoardEmbed(link)) return null;
    // 2026-11-10: an internal link without a matching project node must never fall back to a same-origin iframe.
    return <div />;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, lookups, editing, onOpenCard, t, desktop]);

  // Allow only our own embeddables and YouTube links to render.
  const validateEmbeddable = useCallback(isSafeBoardEmbed, []);

  function reportSafety(issues: BoardSafetyIssue[]) {
    if (issues.length) setWarnings(previous => [...new Set([...previous, ...issues.map(issue => boardSafetyText[lang][issue])])]);
  }
  function importFailure(failure: unknown) {
    reportError(failure instanceof BoardSceneSafetyError ? boardSafetyText[lang][failure.code] : t.importFailed);
  }
  const onPaste: NonNullable<ExcalidrawProps['onPaste']> = data => {
    if (!data.elements) return true;
    try {
      const elements = data.programmaticAPI ? convertToExcalidrawElements(data.elements as never) : data.elements;
      const safe = sanitizeVisionScene({ elements: elements as unknown as Record<string, unknown>[], appState: {}, files: data.files ?? {} });
      reportSafety(safe.issues);
      data.elements = safe.scene.elements as never;
      data.files = safe.scene.files as never;
      data.programmaticAPI = false;
      return safe.scene.elements.length > 0;
    } catch (failure) { importFailure(failure); return false; }
  };
  const onDuplicate: NonNullable<ExcalidrawProps['onDuplicate']> = (elements, previous) => {
    try {
      const safe = sanitizeVisionScene({ elements: elements as unknown as Record<string, unknown>[], appState: {}, files: {} });
      reportSafety(safe.issues);
      return safe.scene.elements as never;
    } catch (failure) { importFailure(failure); return [...previous]; }
  };

  async function importDrawing(file: File) {
    if (!api.current || !editable || pending) return;
    try {
      if (file.size > maximumBoardBytes) throw new BoardSceneSafetyError('limit');
      if (/\.(?:excalidraw|json|excalidrawlib)$/iu.test(file.name)) {
        const input = JSON.parse(await file.text());
        if (input.type === 'excalidrawlib') {
          const items = input.libraryItems ?? input.library;
          if (!Array.isArray(items)) throw new BoardSceneSafetyError('invalid');
          // 2026-11-10: sanitize the complete library in one pass so per-item limits cannot multiply.
          const all = items.flatMap((item: { elements?: unknown[] } | unknown[]) => Array.isArray(item) ? item : item.elements ?? []);
          const safe = sanitizeBoardScene({ type: 'excalidraw', version: 2, elements: all, appState: {}, files: {} });
          reportSafety(safe.issues);
          const kept = new Map(safe.scene.elements.map(element => [element.id, element]));
          await api.current.updateLibrary({ libraryItems: items.map((item: { elements: Record<string, unknown>[] } | Record<string, unknown>[]) => {
            const elements = Array.isArray(item) ? item : item.elements;
            return { ...(Array.isArray(item) ? {} : item), elements: elements.map(element => kept.get(element.id)).filter(Boolean) };
          }) as never, merge: true, openLibraryMenu: true });
          return;
        }
        importScene(input);
        return;
      }
      // 2026-11-10: never decode PNG metadata as a scene: the native drop loader bypasses UIOptions.loadScene.
      if (!boardImageMimeTypes.includes(file.type) || file.size > maximumBoardImageBytes) throw new Error();
      const dataURL = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      if (!isSafeBoardImage({ mimeType: file.type, dataURL })) throw new Error();
      const image = new Image(); image.src = dataURL; await image.decode();
      const fileId = crypto.randomUUID();
      api.current.addFiles([{ id: fileId, mimeType: file.type, dataURL, created: Date.now() }] as never);
      const { x, y } = viewportAnchor();
      const elements = convertToExcalidrawElements([{ type: 'image', fileId, x, y, width: image.naturalWidth, height: image.naturalHeight, status: 'saved' } as never]);
      commitScene([...api.current.getSceneElements(), ...elements]);
    } catch (failure) { importFailure(failure); }
  }
  function importScene(input: unknown) {
    const safe = sanitizeBoardScene(input);
    reportSafety(safe.issues);
    const restored = restore(safe.scene as unknown as Parameters<typeof restore>[0], null, null);
    api.current?.addFiles(Object.values(restored.files));
    api.current?.updateScene({ elements: restored.elements, appState: safe.scene.appState as unknown as AppState, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.current?.scrollToContent();
  }

  const selectedElements = useMemo<SceneElement[]>(() => {
    if (!selectionKey) return [];
    const wanted = new Set(selectionKey.split('\n'));
    return scene.current.elements.filter(element => wanted.has(element.id as string) && !(element as SceneElement).isDeleted) as SceneElement[];
  }, [selectionKey, sceneRevision, document]);
  const selectedCardNodes = selectedElements.filter(element => element.type === 'embeddable' && boardCardIdOf(element));
  const selectedImages = selectedElements.filter(element => element.type === 'image');
  const selectedImage = selectedImages.length === 1 ? selectedImages[0] : null;
  const captionElement = useMemo(() => {
    if (!selectedImage) return null;
    return scene.current.elements.find(element => {
      const candidate = element as SceneElement;
      return !candidate.isDeleted && candidate.type === 'text' && boardCustomValue(candidate.customData, 'CaptionFor') === selectedImage.id;
    }) as (SceneElement & { text?: string }) | null;
  }, [selectedImage, selectionKey, sceneRevision]);
  useEffect(() => { setCaptionDraft(typeof captionElement?.text === 'string' ? captionElement.text : ''); }, [captionElement]);

  function switchCardView(view: string) {
    if (!api.current || !editable || pending) return;
    const size = visionCardSize[visionCardViewOf(view)];
    commitScene(api.current.getSceneElements().map(element => {
      const cardId = boardCardIdOf(element);
      if (!cardId || !selectedCardNodes.some(node => node.id === element.id)) return element;
      return { ...element, width: size.width, height: size.height, version: element.version + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        customData: { ...(element as SceneElement).customData, deckmateCardView: view } };
    }));
  }

  // Captions are small text elements grouped with their images.
  // Text itself is edited natively on the canvas afterwards; the panel creates, positions and groups.
  function applyImageCaption() {
    if (!api.current || !selectedImage || !editable || pending) return;
    const image = selectedImage as SceneElement & { x: number; y: number; width: number; height: number; groupIds: string[] };
    const text = captionDraft.trim();
    if (!text) return;
    const groupId = `deckmate-caption-${crypto.randomUUID().slice(0, 8)}`;
    if (captionElement) {
      commitScene(api.current.getSceneElements().map(element => element.id === captionElement.id
        ? { ...element, x: image.x, y: image.y + image.height + 8, text, originalText: text, version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }
        : element));
      return;
    }
    const caption = convertToExcalidrawElements([{ type: 'text', text, x: image.x, y: image.y + image.height + 8,
      fontSize: 14, fontFamily: 2, groupIds: [groupId], customData: { deckmateCaptionFor: image.id } }]);
    commitScene(api.current.getSceneElements().map(element => element.id === image.id
      ? { ...element, groupIds: [...(image.groupIds ?? []), groupId], version: element.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }
      : element).concat(caption as never));
  }

  const results = query.trim() ? catalog?.cards.filter(card => `${card.title} ${card.path}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 16) ?? [] : [];
  const stale = document && boards.some(board => board.id === document.id && board.hash !== document.hash);
  const textRefs = useMemo(() => textReferences(scene.current, catalog, lang), [catalog, sceneRevision, document, lang]);
  const smartStates = boardColumns.filter(column => column.id !== 'inbox');
  const commonCardView = selectedCardNodes.length
    ? (new Set(selectedCardNodes.map(node => visionCardViewOf(boardCustomValue(node.customData, 'CardView'))))).size === 1
      ? visionCardViewOf(boardCustomValue(selectedCardNodes[0].customData, 'CardView')) : ''
    : '';
  const saveStateText = boardSaveStateText(dirty, document, opening, t);
  return <section className="vision-workspace page-light">
    {/* 2026-11-10: the toolbar is the tab's page head (surface.css): the board name is the 26/700 title with the save
        state and reference as its quiet caption, «New board» is the one creating action, the picker and actions sit right. */}
    <header className="vision-toolbar page-head">
      <div className="page-head-main">
        <div className="page-title-block">
          <div className="vision-title-field">
            <input className="page-title vision-board-name" aria-label={t.schemeTitle} aria-describedby="vision-board-full-title" title={opening ? undefined : title} value={opening ? '' : title} maxLength={120} disabled={!editable || pending || opening} onChange={event => { titleEdited.current = true; currentTitle.current = event.target.value; setTitle(event.target.value); setDirty(hasUnsavedChanges()); }} />
            <span className="vision-title-full" id="vision-board-full-title" role="tooltip">{opening ? '' : title}</span>
          </div>
          <div className="page-caption"><span className="vision-save-state">{saveStateText}</span>
            {document && <CatalogReferenceLink kind="v" id={document.id} source={snapshot.source} />}
          </div>
        </div>
        <button type="button" className="action-mint vision-new-board" disabled={editing || opening} onClick={() => display(null)}><Plus size={15} aria-hidden="true" /><span>{t.newBoard}</span></button>
      </div>
      <div className="page-tools">
        <select className="control-field vision-board-picker" aria-label={t.board} value={document?.id ?? ''} disabled={editing || opening} onChange={event => { if (event.target.value) void open(event.target.value); else display(null); }}>
          <option value="">{restoring ? t.loadingBoard : boardChoiceTitle}</option>{boards.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
        </select>
        {document && <DropdownMenu.Root>
          <DropdownMenu.Trigger className="control vision-access" aria-label={t.boardAccess} disabled={!snapshot.writable || pending || document.access === 'locked'}>
            <MoreHorizontal size={14} /><span className={`vision-access-state${document.access === 'locked' ? ' is-locked' : ''}`}>{accessTitle(document.access, lang)}</span>
          </DropdownMenu.Trigger>
          {/* 2026-11-10: the access menu shares the dialog frame (dialog-panel): the 12px corners, hairline and app shadow. */}
          <DropdownMenu.Portal><DropdownMenu.Content className="dropdown dialog-panel" align="start" sideOffset={6}>
            <DropdownMenu.Label className="dropdown-label">{t.boardAccess}</DropdownMenu.Label>
            {boardAccesses.map(access => <DropdownMenu.Item key={access} className="dropdown-item" onSelect={() => { if (document.access !== access) void save(false, access); }}>
              {accessTitle(access, lang)}{document.access === access && <Check size={14} className="menu-check" />}
            </DropdownMenu.Item>)}
            <DropdownMenu.Label className="dropdown-label">{accessHint(document.access, lang)}</DropdownMenu.Label>
          </DropdownMenu.Content></DropdownMenu.Portal>
        </DropdownMenu.Root>}
        <span className="vision-toolbar-actions">
          <Button size="sm" disabled={!editable || pending || opening || !title.trim()} onClick={() => void save()}><Save size={14} />{t.save}</Button>
          <Button size="sm" variant="outline" disabled={!editable || pending || opening || !title.trim()} onClick={() => void save(true)}>{t.copy}</Button>
          <Button size="sm" variant="ghost" disabled={pending || !dirty} onClick={() => display(document)}>{t.discard}</Button>
        </span>
      </div>
    </header>
    {error && <div className="error-banner vision-error" role="alert"><span>{error}</span>
      {retryAction && <Button size="sm" variant="outline" disabled={pending} onClick={retryBoard}>{t.retry}</Button>}
      {restoreFailed && <Button size="sm" variant="ghost" disabled={pending} onClick={() => display(null)}>{t.newBoard}</Button>}
    </div>}
    {catalogError && <div className="catalog-error vision-error" role="alert"><span>{catalogError}</span><Button size="sm" variant="outline" onClick={() => void refreshCatalog()}>{t.retry}</Button></div>}
    {warnings.map(warning => <div className="notice" role="status" key={warning}>{warning}</div>)}
    {stale && <div className="notice">{t.stale} <button disabled={editing} onClick={() => void open(document.id)}>{t.loadNewVersion}</button></div>}
    {accessBlocked && <div className="notice">{t.openedAs(accessTitle(document!.access, lang))}{document!.access === 'readonly' && t.switchEditable}</div>}
    <div className="vision-body"><div className="vision-board">
      <div className="vision-viewport-tools" role="group" aria-label={t.viewport}>
        <Button size="sm" variant="ghost" data-vision-viewport="overview" disabled={!initialData} onClick={() => { if (api.current) fitVisionContent(api.current); }}>{t.overview}</Button>
        <Button size="sm" variant="ghost" data-vision-viewport="actual" aria-label={t.actualSize} disabled={!initialData} onClick={() => { if (api.current) resetVisionZoom(api.current); }}>100%</Button>
        <Button size="sm" variant="ghost" data-vision-viewport="selection" disabled={!selectedElements.length} onClick={() => { if (api.current) fitVisionContent(api.current, true); }}>{t.toSelection}</Button>
      </div>
      <div className="vision-canvas"
      onDropCapture={event => {
        const file = event.dataTransfer.files[0];
        if (!file) return;
        event.preventDefault(); event.stopPropagation();
        void importDrawing(file);
      }}
      onPasteCapture={event => {
        const data = event.clipboardData;
        const file = data.files[0];
        // 2026-11-10: rich HTML/image paste runs before Excalidraw's onPaste hook; do not let it import SVG or remote images.
        if ((file && (!boardImageMimeTypes.includes(file.type) || file.size > maximumBoardImageBytes))
          || (!file && (data.getData('text/plain').trimStart().startsWith('<svg')
            || /<(?:img|svg|iframe|object)\b/iu.test(data.getData('text/html'))))) {
          event.preventDefault(); event.stopPropagation(); reportSafety(['files']);
        }
      }}>
      {restoring && !initialData && <div className="loading-state vision-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} /><p>{t.loadingBoard}</p></div>}
      {initialData && <Excalidraw key={`${snapshot.source}-${canvasKey}`} initialData={initialData} excalidrawAPI={instance => { api.current = instance; }}
        theme={dark ? 'dark' : 'light'} langCode={locale(lang)} viewModeEnabled={!snapshot.writable || pending || accessBlocked} onChange={onChange}
        validateEmbeddable={validateEmbeddable} renderEmbeddable={renderEmbeddable} aiEnabled={false}
        onPaste={onPaste} onDuplicate={onDuplicate}
        onLinkOpen={(element, event) => {
          const cardId = boardCardIdOf(element);
          const link = typeof element.link === 'string' ? element.link : '';
          if (!isSafeBoardLink(link)) { event.preventDefault(); return; }
          if (isBoardProtocolLink(link)) { event.preventDefault(); return; }
          if (typeof cardId === 'string') { event.preventDefault(); openCardFromBoard(cardId); }
        }} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />}
    </div></div><aside className="vision-links">
      {/* 2026-11-10: the sidebar is a stack of glass panels over the tab's page light (surface.css), like the home's spaces. */}
      <div className="glass-sheet vision-stack">
        <section className="glass-panel vision-panel">
          <div className="panel-head"><h2 className="panel-title"><Link2 size={16} aria-hidden="true" />{t.cardsOnBoard}</h2><span className="panel-count">{linkedIds.length}</span></div>
          <p className="vision-note">{t.cardLinksDescription}</p>
          <label className="vision-search control-field"><Search size={15} aria-hidden="true" /><input placeholder={t.findCard} aria-label={t.findCardForBoard} value={query} onChange={event => setQuery(event.target.value)} /></label>
          {/* 2026-11-10: no matches is a filtered state with a reset; an empty project is a quiet fact, not a failed search. */}
          {query && <div className="vision-results">{results.map(card => <button key={card.id} disabled={!editable || pending} onClick={() => addCard(card)}><Plus size={13} /><span title={card.title}>{card.title}<small>{kindLabel(card.kind, lang)} · ${shortReference('c', card.id)}</small><CardFaceStatus status={cardFaceStatus(card, lookups, lang)} /><CardTagSummary tags={card.tags} definitions={catalog?.projectTags} /></span></button>)}{!results.length && (catalog?.cards.length
            ? <EmptyState variant="filtered" message={t.noMatches} onReset={() => setQuery('')} />
            : <EmptyState variant="quiet" message={t.noCards} />)}</div>}
          <div className="vision-linked-list">{linkedIds.map(id => { const card = lookups.cardById.get(id); return <button key={id} disabled={editing || !card} onClick={() => onOpenCard(id)}><span title={card?.title}>{card?.title ?? t.cardNotFound}<small>{card ? kindLabel(card.kind, lang) : id}</small>{card && <CardFaceStatus status={cardFaceStatus(card, lookups, lang)} />}<CardTagSummary tags={card?.tags} definitions={catalog?.projectTags} /></span><ArrowUpRight size={14} /></button>; })}</div>
          {!linkedIds.length && <EmptyState variant="quiet" message={readOnly ? t.emptyLinkedReadOnly : t.emptyLinked} />}
        </section>

        <section className="glass-panel vision-panel vision-tools">
          <div className="panel-head"><h3 className="panel-title"><Gauge size={14} aria-hidden="true" />{t.smartNode}</h3></div>
          <p className="vision-note">{t.smartDescription(stateLabel(SMART_DONE_STATE, lang).toLocaleLowerCase(locale(lang)))}</p>
          <div className="vision-tool-row vision-smart-controls">
            <select className="control-field" aria-label={t.widgetDeck} value={smartDeckId} disabled={!editable || pending} onChange={event => setSmartDeckId(event.target.value)}>
              {catalog?.decks.length ? catalog.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>) : <option value="">{t.noDecks}</option>}
            </select>
            <select className="control-field" aria-label={t.widgetState} value={smartState} disabled={!editable || pending} onChange={event => setSmartState(event.target.value)}>
              <option value="">{t.allStates}</option>
              {smartStates.map(column => <option key={column.id} value={column.id}>{stateLabel(column.id, lang)}</option>)}
            </select>
            <Button size="sm" disabled={!editable || pending || !catalog?.decks.length} onClick={addSmartNode}><Plus size={13} />{t.widget}</Button>
          </div>
          {/* 2026-11-10: no decks is a fact, not a failure: a quiet note like the other hints, no alert before any attempt. */}
          {catalog && !catalog.decks.length && <p className="vision-note">{t.noDecksForSmart}</p>}
        </section>

        <section className="glass-panel vision-panel vision-tools">
          <div className="panel-head"><h3 className="panel-title"><Clapperboard size={14} aria-hidden="true" />{t.youtubeTitle}</h3></div>
          <p className="vision-note">{desktop ? t.desktopVideo : t.youtubeDescription}</p>
          <div className="vision-tool-row">
            <input className="control-field" placeholder="https://youtube.com/watch?v=…" aria-label={t.youtubeLink} aria-invalid={Boolean(videoError)} aria-describedby={videoError ? 'vision-video-error' : undefined} value={videoUrl} disabled={!editable || pending} onChange={event => { setVideoUrl(event.target.value); setVideoError(null); }} />
            <Button size="sm" disabled={!editable || pending || !videoUrl.trim()} onClick={addVideoNode}><Plus size={13} />{desktop ? t.addVideoLink : t.add}</Button>
          </div>
          {videoError && <p className="inline-error" id="vision-video-error" role="alert">{videoError}</p>}
        </section>

        {(selectedCardNodes.length > 0 || selectedImage) && <section className="glass-panel vision-panel vision-selected">
          <div className="panel-head"><h3 className="panel-title">{t.selected}</h3>{selectedCardNodes.length > 1 && <span className="panel-count">{t.nodes(selectedCardNodes.length)}</span>}</div>
          {selectedCardNodes.length > 0 && <div className="vision-selected-row">
            <span>{t.view}:</span>
            <select className="control-field" aria-label={t.cardNodeView} value={commonCardView} disabled={!editable || pending} onChange={event => switchCardView(event.target.value)}>
              {!commonCardView && <option value="">{t.mixed}</option>}
              {visionCardViewOptions.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
            </select>
          </div>}
          {selectedImage && <div className="vision-selected-row">
            <PencilLine size={13} />
            <input className="control-field" placeholder={t.imageCaption} aria-label={t.imageCaption} value={captionDraft} disabled={!editable || pending} onChange={event => setCaptionDraft(event.target.value)} />
            <Button size="sm" variant="outline" disabled={!editable || pending || !captionDraft.trim()} onClick={applyImageCaption}>{t.ok}</Button>
          </div>}
          {selectedImage && <p className="vision-ref-note">{t.captionNote}</p>}
        </section>}

        <section className="glass-panel vision-panel vision-text-refs">
          <div className="panel-head"><h3 className="panel-title"><Type size={14} aria-hidden="true" />{t.textRefs}</h3><span className="panel-count">{textRefs.length}</span></div>
          <p className="vision-ref-note">{t.textRefCard}<code>$c-…</code>{t.textRefCardTail}<code>{t.textRefDeckToken}</code>{t.textRefDeckTail}<code>{t.textRefMemberToken}</code>{t.textRefMemberTail}</p>
          {textRefs.map(ref => ref.kind === 'card' && ref.cardId
            ? <button key={ref.token} className="vision-ref-row" onClick={() => openCardFromBoard(ref.cardId!)}>
                <span className="vision-ref-kind">$</span><span title={ref.title ?? undefined}>{ref.title ?? t.cardNotFound}<small>{ref.token}</small></span><ArrowUpRight size={13} />
              </button>
            : <span key={ref.token} className="vision-ref-row"><span className="vision-ref-kind">{ref.kind === 'deck' ? '$$' : '@'}</span>
                <span title={ref.title ?? undefined}>{ref.title ?? (ref.kind === 'deck' ? t.deckNotFound : t.memberNotFound)}<small>{ref.token}</small></span></span>)}
          {!textRefs.length && <EmptyState variant="quiet" message={t.noTextRefs} />}
        </section>
      </div>
    </aside></div>
    <ShortcutsHelp screens={visionShortcutScreens} writable={snapshot.writable && snapshot.source === 'sandbox'} vision />
  </section>;
}
