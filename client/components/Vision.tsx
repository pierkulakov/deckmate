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
import { CardTags, TagTitlePrefix } from './CardTags.tsx';
import { shortReference } from '../../src/references.ts';
import { CatalogReferenceLink } from './JourneyPanel.tsx';
import VisionCardNode, { visionCardSize, visionCardViewOf, visionCardViewOptions } from './VisionCardNode.tsx';
import VisionSmartNode, { visionSmartSize } from './VisionSmartNode.tsx';
import '../vision.css';

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
  notResponding: 'Deckmate is not responding. Check that it is running, then try again.',
  notSavedOffline: 'Not saved: Deckmate is not responding. Check that it is running, then try again.',
  copyTitle: (title: string) => `${title} — copy`.slice(0, 120),
  noDecksForSmart: 'The project has no decks for Smart Node.',
  youtubeError: 'Video nodes support YouTube links (https://youtube.com/… or https://youtu.be/…).',
  saveBeforeCard: 'Save or discard the board edits before opening the card.',
  board: 'Vision board',
  boardAccess: 'Board access',
  schemeTitle: 'Board title',
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
  smartNode: 'Smart Node',
  smartDescription: (done: string) => `A “${done} / total” bar for a deck; recalculated on every catalog update.`,
  widgetDeck: 'Widget deck',
  widgetState: 'Widget state filter',
  allStates: 'All states',
  noDecks: 'No decks',
  widget: 'Widget',
  youtubeTitle: 'YouTube video',
  youtubeDescription: 'A YouTube link creates a video node; pasting a link directly onto the board works the same way.',
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
}, {
  newScheme: 'Новая схема',
  agent: 'агент',
  human: 'человек',
  editable: 'Можно править',
  readonly: 'Только чтение',
  locked: 'Заблокировано',
  editableHint: 'Каждый с доступом может править (по умолчанию).',
  readonlyHint: 'Правка закрыта; переключить обратно можно здесь.',
  lockedHint: 'Правка закрыта для всех; снять — только правкой файла доски.',
  openFailed: 'Не удалось открыть полотно.',
  loadingBoard: 'Открываем полотно…',
  saveFailed: 'Не удалось сохранить полотно.',
  notResponding: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  notSavedOffline: 'Не сохранено: Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
  copyTitle: (title: string) => `${title} — копия`.slice(0, 120),
  noDecksForSmart: 'В проекте нет колод для Smart Node.',
  youtubeError: 'Video-узлы поддерживают ссылки YouTube (https://youtube.com/… или https://youtu.be/…).',
  saveBeforeCard: 'Сохраните или отмените правки схемы перед открытием карточки.',
  board: 'Доска Vision',
  boardAccess: 'Доступ к доске',
  schemeTitle: 'Название схемы',
  dirty: 'Есть изменения',
  saved: 'Сохранено',
  newBoard: 'Новое полотно',
  save: 'Сохранить',
  copy: 'Копия',
  discard: 'Отменить правки',
  stale: 'Файл доски обновлён извне. Ваш рисунок сохранён в редакторе.',
  loadNewVersion: 'Загрузить новую версию',
  openedAs: (access: string) => `Доска открыта как ${access}. Правка недоступна.`,
  switchEditable: ' Переключите доступ в Editable через меню «…».',
  cardsOnBoard: 'Карточки на схеме',
  cardLinksDescription: 'Ссылки ведут к исходным карточкам. Стрелки на полотне показывают связи вашей схемы.',
  findCard: 'Найти карточку…',
  findCardForBoard: 'Найти карточку для схемы',
  noMatches: 'Совпадений нет.',
  noCards: 'В проекте пока нет карточек.',
  cardNotFound: 'Карточка не найдена',
  emptyLinked: 'Найдите карточку и нажмите +, чтобы добавить её на полотно.',
  smartNode: 'Smart Node',
  smartDescription: (done: string) => `Полоса «${done} / всего» по колоде; пересчитывается при каждом обновлении каталога.`,
  widgetDeck: 'Колода виджета',
  widgetState: 'Статус-фильтр виджета',
  allStates: 'Все состояния',
  noDecks: 'Нет колод',
  widget: 'Виджет',
  youtubeTitle: 'Видео YouTube',
  youtubeDescription: 'Ссылка YouTube создаёт video-узел; вставка ссылки прямо на полотно работает так же.',
  youtubeLink: 'Ссылка YouTube',
  add: 'Добавить',
  selected: 'Выделено',
  view: 'Вид',
  nodes: (count: number) => `(${new Intl.NumberFormat(locale('ru')).format(count)} узлов)`,
  cardNodeView: 'Вид карточного узла',
  mixed: 'Разные',
  imageCaption: 'Подпись изображения',
  ok: 'ОК',
  captionNote: 'Подпись — текст под картинкой, двигается вместе с ней. Текст меняют двойным кликом на полотне.',
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
});

const emptyScene: BoardScene = { type: 'excalidraw', version: 2, elements: [], appState: {}, files: {} };
// Vision has no shortcuts of its own: the overview lists the app-wide ones, as in Hand.
const visionShortcutScreens: readonly ShortcutScreen[] = ['app'];
function sceneSignature(scene: BoardScene): string {
  return JSON.stringify({ elements: scene.elements, files: scene.files, background: scene.appState.viewBackgroundColor, gridSize: scene.appState.gridSize });
}
type Props = { snapshot: WorkspaceSnapshot; refreshKey: number; dark: boolean; onEditing: (value: boolean) => void; onOpenCard: (id: string) => void };

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
const youTubeLink = /^(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//iu;
const lastBoardKey = (source: string) => `deckmate-vision-board-${source}`;
/** 2026-11-06: the board a fresh Vision mount will open (URL request first, then the last opened one), or null for a new board.
 * Knowing it before the first paint lets the canvas wait for that board instead of mounting an empty one and replacing it. */
function boardToRestore(source: string): { id: string; silent: boolean } | null {
  const requested = new URLSearchParams(location.search).get('board');
  if (requested) return { id: requested, silent: false };
  const last = readStoredValue(localStorage, lastBoardKey(source));
  return last ? { id: last, silent: true } : null;
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
  const { catalog, error: catalogError } = useCatalog(snapshot, refreshKey);
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [title, setTitle] = useState(() => textNow(text).newScheme);
  const [initialData, setInitialData] = useState<ExcalidrawProps['initialData']>(null);
  const [canvasKey, setCanvasKey] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(() => boardToRestore(snapshot.source) !== null);
  const [query, setQuery] = useState('');
  const [linkedIds, setLinkedIds] = useState<string[]>([]);
  const [selectionKey, setSelectionKey] = useState('');
  const [smartDeckId, setSmartDeckId] = useState('');
  const [smartState, setSmartState] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [captionDraft, setCaptionDraft] = useState('');
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const draftId = useRef<string>(crypto.randomUUID());
  const scene = useRef(emptyScene);
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
  const editable = snapshot.writable && !accessBlocked;
  // 2026-11-06: while the remembered board is read, the toolbar agrees with the loading state: no «New board» title and no Save
  // that would write an empty board in its place.
  const opening = restoring && !initialData;

  useEffect(() => { onEditing(editing); return () => onEditing(false); }, [editing, onEditing]);
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

  function display(next: BoardDocument | null, mountCanvas = true, keepError = false) {
    const restored = restore((next?.scene ?? emptyScene) as unknown as Parameters<typeof restore>[0], null, null);
    const serialized = serializeAsJSON(restored.elements, restored.appState, restored.files, 'local');
    scene.current = JSON.parse(serialized) as BoardScene;
    baseline.current = sceneSignature(scene.current);
    baselineTitle.current = next?.title ?? textNow(text).newScheme;
    currentTitle.current = baselineTitle.current;
    titleEdited.current = false;
    setDocument(next); setTitle(next?.title ?? textNow(text).newScheme);
    draftId.current = next?.id ?? crypto.randomUUID();
    setLinkedIds(next?.linkedCardIds ?? []); setDirty(false); if (!keepError) setError(null);
    boardCardIds.current = new Set(next?.linkedCardIds ?? []);
    // A pending restore keeps the canvas unmounted so the loading state shows instead of an empty board.
    setInitialData(mountCanvas ? { ...restored, scrollToContent: true } : null); setCanvasKey(value => value + 1);
  }

  async function refreshList() {
    const requested = snapshot.source;
    try {
      const result = await responseJson<BoardSummary[]>(await fetch(`/api/boards?source=${requested}`));
      if (source.current === requested) setBoards(result);
    } catch (failure) { if (source.current === requested) setError(failureText(failure, textNow(text).notResponding, textNow(text).openFailed)); }
  }

  useEffect(() => {
    // The Vision tab returns to the last opened board; an empty board mounts only when there is nothing to restore.
    const wanted = boardToRestore(snapshot.source);
    display(null, !wanted); setBoards([]); setSelectionKey(''); setRestoring(wanted !== null);
    void (async () => {
      await refreshList();
      if (!wanted) return;
      const opened = await open(wanted.id, wanted.silent);
      // The board could not be read: fall back to an empty one, keeping the error the failed open reported.
      if (!opened && source.current === snapshot.source) display(null, true, true);
      setRestoring(false);
    })();
  }, [snapshot.source]);
  useEffect(() => { void refreshList(); }, [refreshKey]);

  async function open(id: string, silent = false): Promise<boolean> {
    if (editing) return false;
    const requested = snapshot.source;
    setPending(true);
    try {
      const result = await responseJson<BoardDocument>(await fetch(`/api/boards/${id}?source=${requested}`));
      if (source.current !== requested) return false;
      display(result); localStorage.setItem(lastBoardKey(requested), id); return true;
    }
    catch (failure) {
      if (silent) localStorage.removeItem(lastBoardKey(requested));
      else if (source.current === requested) setError(failureText(failure, textNow(text).notResponding, textNow(text).openFailed));
      return false;
    }
    finally { setPending(false); }
  }

  async function save(copy = false, accessOverride?: BoardAccess) {
    const token = (snapshot as WorkspaceSnapshot & { token?: string }).token;
    if (!token || !snapshot.writable || pending) return;
    setPending(true); setError(null);
    // The access state travels inside the scene appState; the editor never emits it, so inject it on every save.
    const access = accessOverride ?? (copy ? 'editable' : document?.access ?? 'editable');
    const payloadScene: BoardScene = { ...scene.current, appState: { ...scene.current.appState, [BOARD_ACCESS_KEY]: access } };
    try {
      const result = await responseJson<BoardDocument>(await fetch('/api/boards', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-deckmate-token': token },
        body: JSON.stringify({ source: snapshot.source, id: copy ? crypto.randomUUID() : document?.id ?? draftId.current,
          title: copy ? t.copyTitle(title) : title, hash: copy ? '' : document?.hash ?? '', scene: payloadScene }),
      }));
      setDocument(result); setTitle(result.title); setDirty(false);
      baseline.current = sceneSignature(scene.current);
      baselineTitle.current = result.title;
      currentTitle.current = result.title;
      localStorage.setItem(lastBoardKey(source.current), result.id);
      await refreshList();
    } catch (failure) { setError(failureText(failure, t.notSavedOffline, t.saveFailed)); }
    finally { setPending(false); }
  }

  const onChange: ExcalidrawProps['onChange'] = (elements, appState, files) => {
    const serialized = serializeAsJSON(elements, appState, files, 'local');
    scene.current = JSON.parse(serialized) as BoardScene;
    setDirty(sceneSignature(scene.current) !== baseline.current || currentTitle.current !== baselineTitle.current);
    const ids = [...new Set(elements.filter(element => !element.isDeleted).map(boardCardIdOf).filter((id): id is string => id !== null))];
    for (const id of ids) if (!boardCardIds.current.has(id)) emitSignal({ type: 'vision-card-added', cardId: id });
    boardCardIds.current = new Set(ids);
    setLinkedIds(previous => previous.join('\n') === ids.join('\n') ? previous : ids);
    const selection = Object.keys(appState.selectedElementIds).sort().join('\n');
    setSelectionKey(previous => previous === selection ? previous : selection);
  };

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
    if (!deckId) { setError(t.noDecksForSmart); return; }
    const queryValue: BoardSmartQuery = { deckId, state: smartState || null };
    const { x, y } = viewportAnchor();
    addElement(embeddableElement({ x, y, ...visionSmartSize,
      link: `deckmate://smart/${deckId}`, customData: { deckmateSmart: queryValue } }));
  }

  function addVideoNode() {
    const link = videoUrl.trim();
    if (!youTubeLink.test(link)) { setError(t.youtubeError); return; }
    const { x, y } = viewportAnchor();
    addElement(embeddableElement({ x, y, width: 560, height: 315, link, customData: { deckmateVideo: link } }));
    setVideoUrl('');
  }

  function openCardFromBoard(cardId: string) {
    if (editing) setError(t.saveBeforeCard);
    else onOpenCard(cardId);
  }

  const renderEmbeddable = useCallback<NonNullable<ExcalidrawProps['renderEmbeddable']>>((element: ExcalidrawEmbeddableElement, appState: AppState) => {
    const cardId = boardCardIdOf(element);
    const smartQuery = boardCustomValue(element.customData, 'Smart');
    const active = appState.activeEmbeddable?.element?.id === element.id && appState.activeEmbeddable?.state === 'active';
    if (cardId !== null) {
      const card = catalog?.cards.find(candidate => candidate.id === cardId);
      return <VisionCardNode card={card} cardId={cardId} view={visionCardViewOf(boardCustomValue(element.customData, 'CardView'))}
        catalog={catalog} interactive={active} onOpen={openCardFromBoard} />;
    }
    if (isSmartQuery(smartQuery)) return <VisionSmartNode query={smartQuery} catalog={catalog} />;
    return null; // YouTube links keep the stock Excalidraw iframe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, editing, onOpenCard, t]);

  // Allow only our own embeddables and YouTube links to render.
  const validateEmbeddable = useCallback((link: string) => link.startsWith('/r/') || isBoardProtocolLink(link) || youTubeLink.test(link), []);

  const selectedElements = useMemo<SceneElement[]>(() => {
    if (!selectionKey) return [];
    const wanted = new Set(selectionKey.split('\n'));
    return scene.current.elements.filter(element => wanted.has(element.id as string) && !(element as SceneElement).isDeleted) as SceneElement[];
  }, [selectionKey, dirty, document]);
  const selectedCardNodes = selectedElements.filter(element => element.type === 'embeddable' && boardCardIdOf(element));
  const selectedImages = selectedElements.filter(element => element.type === 'image');
  const selectedImage = selectedImages.length === 1 ? selectedImages[0] : null;
  const captionElement = useMemo(() => {
    if (!selectedImage) return null;
    return scene.current.elements.find(element => {
      const candidate = element as SceneElement;
      return !candidate.isDeleted && candidate.type === 'text' && boardCustomValue(candidate.customData, 'CaptionFor') === selectedImage.id;
    }) as (SceneElement & { text?: string }) | null;
  }, [selectedImage, selectionKey, dirty]);
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
  const textRefs = useMemo(() => textReferences(scene.current, catalog, lang), [catalog, dirty, document, lang]);
  const smartStates = boardColumns.filter(column => column.id !== 'inbox');
  const commonCardView = selectedCardNodes.length
    ? (new Set(selectedCardNodes.map(node => visionCardViewOf(boardCustomValue(node.customData, 'CardView'))))).size === 1
      ? visionCardViewOf(boardCustomValue(selectedCardNodes[0].customData, 'CardView')) : ''
    : '';
  return <section className="vision-workspace">
    <header className="vision-toolbar">
      <select aria-label={t.board} value={document?.id ?? ''} disabled={editing || opening} onChange={event => { if (event.target.value) void open(event.target.value); else display(null); }}>
        <option value="">{opening ? t.loadingBoard : t.newScheme}</option>{boards.map(board => <option key={board.id} value={board.id}>{board.title}</option>)}
      </select>
      {document && <DropdownMenu.Root>
        <DropdownMenu.Trigger className="ui-button button-ghost button-size-sm vision-access" aria-label={t.boardAccess} disabled={!snapshot.writable || pending || document.access === 'locked'}>
          <MoreHorizontal size={14} /><span className={`vision-access-state${document.access === 'locked' ? ' is-locked' : ''}`}>{accessTitle(document.access, lang)}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="dropdown" align="start" sideOffset={6}>
          <DropdownMenu.Label className="dropdown-label">{t.boardAccess}</DropdownMenu.Label>
          {boardAccesses.map(access => <DropdownMenu.Item key={access} className="dropdown-item" onSelect={() => { if (document.access !== access) void save(false, access); }}>
            {accessTitle(access, lang)}{document.access === access && <Check size={14} className="menu-check" />}
          </DropdownMenu.Item>)}
          <DropdownMenu.Label className="dropdown-label">{accessHint(document.access, lang)}</DropdownMenu.Label>
        </DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>}
      <input aria-label={t.schemeTitle} value={opening ? '' : title} maxLength={120} disabled={!editable || pending || opening} onChange={event => { titleEdited.current = true; currentTitle.current = event.target.value; setTitle(event.target.value); setDirty(sceneSignature(scene.current) !== baseline.current || event.target.value !== baselineTitle.current); }} />
      <span className="vision-save-state">{dirty ? t.dirty : document ? t.saved : opening ? '' : t.newBoard}</span>
      {document && <CatalogReferenceLink kind="v" id={document.id} source={snapshot.source} />}
      <Button size="sm" disabled={!editable || pending || opening || !title.trim()} onClick={() => void save()}><Save size={14} />{t.save}</Button>
      <Button size="sm" variant="outline" disabled={!editable || pending || opening || !title.trim()} onClick={() => void save(true)}>{t.copy}</Button>
      <Button size="sm" variant="ghost" disabled={pending || !dirty} onClick={() => display(document)}>{t.discard}</Button>
    </header>
    {(error || catalogError) && <div className="error-banner" role="alert">{error ?? catalogError}</div>}
    {stale && <div className="notice">{t.stale} <button disabled={editing} onClick={() => void open(document.id)}>{t.loadNewVersion}</button></div>}
    {accessBlocked && <div className="notice">{t.openedAs(accessTitle(document!.access, lang))}{document!.access === 'readonly' && t.switchEditable}</div>}
    <div className="vision-body"><div className="vision-canvas">
      {opening && <div className="loading-state vision-loading" role="status" aria-live="polite"><LoaderCircle className="spin" size={22} /><p>{t.loadingBoard}</p></div>}
      {initialData && <Excalidraw key={`${snapshot.source}-${canvasKey}`} initialData={initialData} excalidrawAPI={instance => { api.current = instance; }}
        theme={dark ? 'dark' : 'light'} langCode={lang === 'ru' ? 'ru-RU' : 'en-US'} viewModeEnabled={!snapshot.writable || pending || accessBlocked} onChange={onChange}
        validateEmbeddable={validateEmbeddable} renderEmbeddable={renderEmbeddable}
        onLinkOpen={(element, event) => {
          const cardId = boardCardIdOf(element);
          const link = typeof element.link === 'string' ? element.link : '';
          if (isBoardProtocolLink(link)) { event.preventDefault(); return; }
          if (typeof cardId === 'string') { event.preventDefault(); openCardFromBoard(cardId); }
        }} UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }} />}
    </div><aside className="vision-links">
      <h2><Link2 size={16} />{t.cardsOnBoard}</h2><p>{t.cardLinksDescription}</p>
      <label className="vision-search"><Search size={15} /><input placeholder={t.findCard} aria-label={t.findCardForBoard} value={query} onChange={event => setQuery(event.target.value)} /></label>
      {/* 2026-11-06: an empty project explains itself instead of reporting a failed search. */}
      {query && <div className="vision-results">{results.map(card => <button key={card.id} disabled={!editable || pending} onClick={() => addCard(card)}><Plus size={13} /><span title={card.title}><TagTitlePrefix tags={card.tags} definitions={catalog?.projectTags} />{card.title}<small>{kindLabel(card.kind, lang)} · ${shortReference('c', card.id)}</small><CardTags tags={card.tags} definitions={catalog?.projectTags} compact /></span></button>)}{!results.length && <p>{catalog?.cards.length ? t.noMatches : t.noCards}</p>}</div>}
      <div className="vision-linked-list">{linkedIds.map(id => { const card = catalog?.cards.find(candidate => candidate.id === id); return <button key={id} disabled={editing || !card} onClick={() => onOpenCard(id)}><span title={card?.title}><TagTitlePrefix tags={card?.tags} definitions={catalog?.projectTags} />{card?.title ?? t.cardNotFound}<small>{card?.state ? stateLabel(card.state, lang) : card ? kindLabel(card.kind, lang) : id}</small><CardTags tags={card?.tags} definitions={catalog?.projectTags} compact /></span><ArrowUpRight size={14} /></button>; })}</div>
      {!linkedIds.length && <p className="vision-empty">{t.emptyLinked}</p>}

      <div className="vision-tools">
        <h3><Gauge size={14} />{t.smartNode}</h3>
        <p>{t.smartDescription(stateLabel(SMART_DONE_STATE, lang).toLocaleLowerCase(locale(lang)))}</p>
        <div className="vision-tool-row">
          <select aria-label={t.widgetDeck} value={smartDeckId} disabled={!editable || pending} onChange={event => setSmartDeckId(event.target.value)}>
            {catalog?.decks.map(deck => <option key={deck.id} value={deck.id}>{deck.title}</option>) ?? <option value="">{t.noDecks}</option>}
          </select>
          <select aria-label={t.widgetState} value={smartState} disabled={!editable || pending} onChange={event => setSmartState(event.target.value)}>
            <option value="">{t.allStates}</option>
            {smartStates.map(column => <option key={column.id} value={column.id}>{stateLabel(column.id, lang)}</option>)}
          </select>
          <Button size="sm" disabled={!editable || pending || !catalog?.decks.length} onClick={addSmartNode}><Plus size={13} />{t.widget}</Button>
        </div>
      </div>

      <div className="vision-tools">
        <h3><Clapperboard size={14} />{t.youtubeTitle}</h3>
        <p>{t.youtubeDescription}</p>
        <div className="vision-tool-row">
          <input placeholder="https://youtube.com/watch?v=…" aria-label={t.youtubeLink} value={videoUrl} disabled={!editable || pending} onChange={event => setVideoUrl(event.target.value)} />
          <Button size="sm" disabled={!editable || pending || !videoUrl.trim()} onClick={addVideoNode}><Plus size={13} />{t.add}</Button>
        </div>
      </div>

      {(selectedCardNodes.length > 0 || selectedImage) && <div className="vision-selected">
        <h3>{t.selected}</h3>
        {selectedCardNodes.length > 0 && <div className="vision-selected-row">
          <span>{t.view} {selectedCardNodes.length > 1 ? t.nodes(selectedCardNodes.length) : ''}:</span>
          <select aria-label={t.cardNodeView} value={commonCardView} disabled={!editable || pending} onChange={event => switchCardView(event.target.value)}>
            {!commonCardView && <option value="">{t.mixed}</option>}
            {visionCardViewOptions.map(option => <option key={option.id} value={option.id}>{option.title}</option>)}
          </select>
        </div>}
        {selectedImage && <div className="vision-selected-row">
          <PencilLine size={13} />
          <input placeholder={t.imageCaption} aria-label={t.imageCaption} value={captionDraft} disabled={!editable || pending} onChange={event => setCaptionDraft(event.target.value)} />
          <Button size="sm" variant="outline" disabled={!editable || pending || !captionDraft.trim()} onClick={applyImageCaption}>{t.ok}</Button>
        </div>}
        {selectedImage && <p className="vision-ref-note">{t.captionNote}</p>}
      </div>}

      <div className="vision-text-refs">
        <h3><Type size={14} />{t.textRefs}</h3>
        <p className="vision-ref-note">{t.textRefCard}<code>$c-…</code>{t.textRefCardTail}<code>{t.textRefDeckToken}</code>{t.textRefDeckTail}<code>{t.textRefMemberToken}</code>{t.textRefMemberTail}</p>
        {textRefs.map(ref => ref.kind === 'card' && ref.cardId
          ? <button key={ref.token} className="vision-ref-row" onClick={() => openCardFromBoard(ref.cardId!)}>
              <span className="vision-ref-kind">$</span><span title={ref.title ?? undefined}>{ref.title ?? t.cardNotFound}<small>{ref.token}</small></span><ArrowUpRight size={13} />
            </button>
          : <span key={ref.token} className="vision-ref-row"><span className="vision-ref-kind">{ref.kind === 'deck' ? '$$' : '@'}</span>
              <span title={ref.title ?? undefined}>{ref.title ?? (ref.kind === 'deck' ? t.deckNotFound : t.memberNotFound)}<small>{ref.token}</small></span></span>)}
        {!textRefs.length && <p className="vision-ref-note">{t.noTextRefs}</p>}
      </div>
    </aside></div>
    <ShortcutsHelp screens={visionShortcutScreens} writable={snapshot.writable && snapshot.source === 'sandbox'} />
  </section>;
}
