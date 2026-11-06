import { useId, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Activity, AlarmClock, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Award, Axe,
  Banknote, Bell, Book, Bookmark, Box, Boxes, Briefcase, Brush, Bug, Calendar,
  Camera, Car, Check, CircleCheck, Clock, Cloud, Code, Compass, Copy, Cpu,
  Crown, Database, Droplet, Eye, File, FileText, Flag, Flame, Folder, Gamepad2,
  Gauge, Gem, Gift, Globe, Hammer, Heart, Hourglass, Image, ImagePlus, Inbox,
  Key, Layers, Lightbulb, Link, ListChecks, LoaderCircle, Lock, Map as MapIcon, MapPin, Medal,
  Megaphone, MessageCircle, Mic, Monitor, Moon, Music, Package, Paintbrush, Palette, Paperclip,
  Pencil, Play, Plug, Plus, Printer, Puzzle, Rocket, Route, Save, Scale,
  Scissors, Search, Send, Server, Settings, Shield, ShoppingBag, ShoppingCart, Shuffle, Skull,
  SlidersHorizontal, Smartphone, Snowflake, Sparkles, Speaker, Square, Star, Stethoscope, Sun, Swords,
  Table, Tag, Tags, Target, Terminal, ThumbsUp, Timer, Trash2, TreePine, Trophy,
  Truck, Umbrella, Upload, User, Users, Video, Volume2, Wrench, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { collectProjectTags, defaultTagColor, maxTagIconLength, sanitizeTagSvg, tagDecoration, validTagName, validateProjectTag, type ProjectTag, type TagDecoration } from '../../src/project-tags.ts';
import type { CatalogAction } from '../useCatalog.ts';
import { tagEmojis } from '../tag-emoji.ts';
import { Button } from './ui/button.tsx';
import { CardTags, TagBadge, TagColorIndicator } from './CardTags.tsx';
import { defineText, textNow, useText } from '../i18n.ts';

const text = defineText({
  squareSvg: 'The SVG must be square: viewBox width and height must match.',
  findTag: 'Find a tag', tagPlaceholder: 'Find a tag…', projectTags: 'Project tags', configureTag: (name: string) => 'Configure tag: ' + name,
  colorAndIcon: 'Decoration', noTags: 'No tags match this search.', firstTags: 'Showing the first 100 tags. Refine your search.',
  tagNotSaved: 'The tag was not saved. Check the catalog message and try again.', svgLimit: 'Choose an SVG up to 16 KB.',
  svgReadFailed: 'Could not read the SVG.', svgPrepareFailed: 'Could not prepare the SVG icon.', checkProperties: 'Check the tag properties.',
  tagExists: 'This tag already exists. Select it in the list to configure it.', appearanceSaved: 'Tag appearance saved.',
  tagCreated: 'Tag created. Select it in the list to add it to the card.', appearanceNotSaved: 'Appearance was not saved. Check the current version and try again.',
  configureTags: 'Configure tags', configure: 'Configure tag', newTag: 'New tag', cardTags: 'Card tags',
  description: 'Decoration and the tag card are shared across all cards in the project.', close: 'Close tags', allTags: 'All tags', name: 'Name',
  nameHelp: 'The name is kept so existing assignments stay in place.', tagColor: 'Tag color', color: (color: string) => 'Color ' + color,
  customColor: 'Custom tag color', icon: 'Icon', iconType: 'Icon type', emoji: 'Emoji', icons: 'Icons', customSvg: 'Custom SVG',
  decoration: 'Decoration', decorationNone: 'None', decorationColor: 'Color', iconColor: 'Icon color',
  decorationHelp: 'Cards with this tag get the chosen decoration: a color dot, or an emoji or icon before the title.',
  pickEmoji: 'Choose an emoji.', pickIcon: 'Choose an icon or upload an SVG.',
  findEmoji: 'Find emoji', emojiPlaceholder: 'Find emoji: star…', emojiName: (emoji: string) => 'Emoji ' + emoji, noEmoji: 'No emoji match this search.',
  findIcon: 'Find an icon', iconPlaceholder: 'Find an icon by name…', lucideIcons: 'Lucide icons', iconName: (name: string) => 'Icon ' + name,
  noIcons: 'No icons match this search.', uploadSvg: 'Upload a square SVG',
  svgHelp: 'Up to 16 KB. The viewBox width and height must match. Simple vector shapes without scripts, styles or external links.',
  tagCard: 'Tag card', cardPlaceholder: 'Find a catalog card…', removeCard: 'Remove card', projectCards: 'Project cards', noCards: 'No cards match this search.',
  cardHelp: 'The card describes the tag in the catalog, for example a faction in a “Factions” deck; each tag has one card.',
  preview: 'Preview', tag: 'Tag', conflict: 'Tags changed in the files. Your draft is kept.', useCurrent: 'Use current version', cancel: 'Cancel', save: 'Save', create: 'Create tag',
}, {
  squareSvg: 'SVG должен быть квадратным: ширина и высота viewBox должны совпадать.',
  findTag: 'Найти тег', tagPlaceholder: 'Найти тег…', projectTags: 'Теги проекта', configureTag: (name: string) => 'Настроить тег: ' + name,
  colorAndIcon: 'Оформление', noTags: 'Тегов по этому запросу нет.', firstTags: 'Показаны первые 100 тегов. Уточните поиск.',
  tagNotSaved: 'Тег не сохранён. Проверьте сообщение каталога и повторите действие.', svgLimit: 'Выберите SVG до 16 КБ.',
  svgReadFailed: 'Не удалось прочитать SVG.', svgPrepareFailed: 'Не удалось подготовить SVG-иконку.', checkProperties: 'Проверьте свойства тега.',
  tagExists: 'Такой тег уже существует. Выберите его в списке для настройки.', appearanceSaved: 'Оформление тега сохранено.',
  tagCreated: 'Тег создан. Выберите его в списке, чтобы добавить к карте.', appearanceNotSaved: 'Оформление не сохранено. Проверьте актуальную версию и повторите.',
  configureTags: 'Настроить теги', configure: 'Настроить тег', newTag: 'Новый тег', cardTags: 'Теги карточки',
  description: 'Оформление и карта тега общие для всех карт проекта.', close: 'Закрыть теги', allTags: 'Все теги', name: 'Название',
  nameHelp: 'Название сохраняется, чтобы существующие назначения оставались на месте.', tagColor: 'Цвет тега', color: (color: string) => 'Цвет ' + color,
  customColor: 'Свой цвет тега', icon: 'Значок', iconType: 'Тип значка', emoji: 'Emoji', icons: 'Иконки', customSvg: 'Свой SVG',
  decoration: 'Оформление', decorationNone: 'Нет', decorationColor: 'Цвет', iconColor: 'Цвет значка',
  decorationHelp: 'Карты с этим тегом получают выбранное оформление: цветную точку, emoji или значок перед названием.',
  pickEmoji: 'Выберите emoji.', pickIcon: 'Выберите иконку или загрузите SVG.',
  findEmoji: 'Найти emoji', emojiPlaceholder: 'Найти emoji: star или звезда…', emojiName: (emoji: string) => 'Emoji ' + emoji, noEmoji: 'Emoji по этому запросу нет.',
  findIcon: 'Найти иконку', iconPlaceholder: 'Найти иконку по имени…', lucideIcons: 'Иконки Lucide', iconName: (name: string) => 'Иконка ' + name,
  noIcons: 'Иконок по этому запросу нет.', uploadSvg: 'Загрузить квадратный SVG',
  svgHelp: 'До 16 КБ. Ширина и высота viewBox должны совпадать. Простые векторные фигуры без скриптов, стилей и внешних ссылок.',
  tagCard: 'Карта тега', cardPlaceholder: 'Найти карту каталога…', removeCard: 'Снять карту', projectCards: 'Карты проекта', noCards: 'Карт по этому запросу нет.',
  cardHelp: 'Карта описывает тег в каталоге, например сторону в колоде «Фракции»; у тега она одна.',
  preview: 'Предпросмотр', tag: 'Тег', conflict: 'Теги изменились в файлах. Черновик сохранён.', useCurrent: 'Использовать актуальную версию', cancel: 'Отмена', save: 'Сохранить', create: 'Создать тег',
});

type TagFeedbackKey = 'squareSvg' | 'tagNotSaved' | 'svgLimit' | 'svgReadFailed' | 'svgPrepareFailed' | 'checkProperties'
  | 'tagExists' | 'appearanceSaved' | 'tagCreated' | 'appearanceNotSaved' | 'pickEmoji' | 'pickIcon';
type TagFeedback = { key: TagFeedbackKey } | { message: string };

class TagSvgShapeError extends Error {}

function tagFailure(error: unknown, fallback: TagFeedbackKey): TagFeedback {
  if (error instanceof TagSvgShapeError) return { key: 'squareSvg' };
  return error instanceof Error ? { message: error.message } : { key: fallback };
}

const tagIcons = [
  ['Activity', Activity], ['Alarm Clock', AlarmClock], ['Archive', Archive], ['Arrow Down', ArrowDown], ['Arrow Left', ArrowLeft],
  ['Arrow Right', ArrowRight], ['Arrow Up', ArrowUp], ['Award', Award], ['Axe', Axe], ['Banknote', Banknote],
  ['Bell', Bell], ['Book', Book], ['Bookmark', Bookmark], ['Box', Box], ['Boxes', Boxes],
  ['Briefcase', Briefcase], ['Brush', Brush], ['Bug', Bug], ['Calendar', Calendar], ['Camera', Camera],
  ['Car', Car], ['Check', Check], ['Circle Check', CircleCheck], ['Clock', Clock], ['Cloud', Cloud],
  ['Code', Code], ['Compass', Compass], ['Copy', Copy], ['Cpu', Cpu], ['Crown', Crown],
  ['Database', Database], ['Droplet', Droplet], ['Eye', Eye], ['File', File], ['File Text', FileText],
  ['Flag', Flag], ['Flame', Flame], ['Folder', Folder], ['Gamepad 2', Gamepad2], ['Gauge', Gauge],
  ['Gem', Gem], ['Gift', Gift], ['Globe', Globe], ['Hammer', Hammer], ['Heart', Heart],
  ['Hourglass', Hourglass], ['Image', Image], ['Image Plus', ImagePlus], ['Inbox', Inbox], ['Key', Key],
  ['Layers', Layers], ['Lightbulb', Lightbulb], ['Link', Link], ['List Checks', ListChecks], ['Loader Circle', LoaderCircle],
  ['Lock', Lock], ['Map', MapIcon], ['Map Pin', MapPin], ['Medal', Medal], ['Megaphone', Megaphone],
  ['Message Circle', MessageCircle], ['Mic', Mic], ['Monitor', Monitor], ['Moon', Moon], ['Music', Music],
  ['Package', Package], ['Paintbrush', Paintbrush], ['Palette', Palette], ['Paperclip', Paperclip], ['Pencil', Pencil],
  ['Play', Play], ['Plug', Plug], ['Plus', Plus], ['Printer', Printer], ['Puzzle', Puzzle],
  ['Rocket', Rocket], ['Route', Route], ['Save', Save], ['Scale', Scale], ['Scissors', Scissors],
  ['Search', Search], ['Send', Send], ['Server', Server], ['Settings', Settings], ['Shield', Shield],
  ['Shopping Bag', ShoppingBag], ['Shopping Cart', ShoppingCart], ['Shuffle', Shuffle], ['Skull', Skull], ['Sliders Horizontal', SlidersHorizontal],
  ['Smartphone', Smartphone], ['Snowflake', Snowflake], ['Sparkles', Sparkles], ['Speaker', Speaker], ['Square', Square],
  ['Star', Star], ['Stethoscope', Stethoscope], ['Sun', Sun], ['Swords', Swords], ['Table', Table],
  ['Tag', Tag], ['Tags', Tags], ['Target', Target], ['Terminal', Terminal], ['Thumbs Up', ThumbsUp],
  ['Timer', Timer], ['Trash 2', Trash2], ['Tree Pine', TreePine], ['Trophy', Trophy], ['Truck', Truck],
  ['Umbrella', Umbrella], ['Upload', Upload], ['User', User], ['Users', Users], ['Video', Video],
  ['Volume 2', Volume2], ['Wrench', Wrench], ['X', X], ['Zap', Zap],
] as const;

type IconTab = 'icons' | 'svg';

function squareTagSvg(value: string) {
  const iconSvg = sanitizeTagSvg(value);
  const viewBox = /\bviewBox="([^"]+)"/u.exec(iconSvg);
  const parts = viewBox?.[1].trim().split(/[\s,]+/u).map(Number);
  if (!parts || parts.length !== 4 || parts[2] !== parts[3]) throw new TagSvgShapeError(textNow(text).squareSvg);
  return iconSvg;
}

function lucideTagSvg(Icon: LucideIcon) {
  const markup = renderToStaticMarkup(<Icon size={24} strokeWidth={2} />);
  // The sanitizer accepts geometry only; React/Lucide presentation attributes are not needed in the stored file.
  return squareTagSvg(markup.replace(/\s(?:class|aria-hidden)="[^"]*"/gu, ''));
}

export function TagSelectionList({ tags, definitions = [], selected, query, onQueryChange, onToggle, onConfigure, disabled = false }: {
  tags: ProjectTag[]; definitions?: readonly ProjectTag[]; selected: readonly string[]; query: string; onQueryChange: (value: string) => void;
  onToggle: (name: string) => void; onConfigure?: (tag: ProjectTag) => void; disabled?: boolean;
}) {
  const t = useText(text);
  const definitionsByName = new Map(definitions.map(tag => [tag.name, tag]));
  const matching = tags.filter(tag => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="tag-selection">
    <label className="tag-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t.findTag}</span><input type="search" autoFocus value={query} disabled={disabled} onChange={event => onQueryChange(event.target.value)} placeholder={t.tagPlaceholder} /></label>
    <div className="tag-choice-list" role="group" aria-label={t.allTags}>
      {matching.slice(0, 100).map(tag => <div className="tag-choice-row" key={tag.name}>
        <button type="button" className="tag-choice" role="checkbox" aria-checked={selected.includes(tag.name)} disabled={disabled} onClick={() => onToggle(tag.name)}>
          <span className="tag-choice-check" aria-hidden="true" /><TagBadge name={tag.name} definition={definitionsByName.get(tag.name)} />
        </button>
        {onConfigure && <button type="button" className="tag-configure" disabled={disabled} aria-label={t.configureTag(tag.name)} title={t.colorAndIcon} onClick={() => onConfigure(tag)}><Pencil size={13} /></button>}
      </div>)}
      {!matching.length && <p className="tag-empty">{t.noTags}</p>}
    </div>
    {matching.length > 100 && <p className="tag-help">{t.firstTags}</p>}
  </div>;
}

interface TagDraft extends ProjectTag { hash: string; existing: boolean }
const colors = ['#687e9c', '#cc5c65', '#c27d38', '#8c8d39', '#3b9573', '#3c8caa', '#677bc5', '#a56bad'];
const dotColors = colors.filter(color => color !== defaultTagColor);
const decorations: readonly TagDecoration[] = ['none', 'color', 'emoji', 'icon'];

export function TagPicker({ card, catalog, disabled, onEdit, onOpenChange, onOpenCard }: {
  card: CatalogCard; catalog: CatalogView; disabled: boolean;
  onEdit: (action: CatalogAction) => Promise<boolean>; onOpenChange?: (open: boolean) => void;
  onOpenCard?: (cardId: string) => void;
}) {
  const t = useText(text);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cardQuery, setCardQuery] = useState('');
  const [emojiQuery, setEmojiQuery] = useState('');
  const [iconQuery, setIconQuery] = useState('');
  const [iconTab, setIconTab] = useState<IconTab>('icons');
  const [decoration, setDecoration] = useState<TagDecoration>('none');
  const [selectedIconName, setSelectedIconName] = useState('');
  const [draft, setDraft] = useState<TagDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<TagFeedback | null>(null);
  const inFlight = useRef(false);
  const inputId = useId();
  const cardInputId = useId();
  const iconPanelId = useId();
  const tags = useMemo(() => collectProjectTags(catalog.cards, catalog.projectTags), [catalog.cards, catalog.projectTags]);
  const cardsById = useMemo(() => new Map(catalog.cards.map(item => [item.id, item])), [catalog.cards]);
  const current = catalog.cards.find(item => item.id === card.id) ?? card;
  const conflict = Boolean(draft && draft.hash !== (catalog.tagsHash ?? ''));
  const unavailable = disabled || busy;
  const cardMatches = useMemo(() => {
    const needle = cardQuery.trim().toLocaleLowerCase('ru');
    if (!needle) return [];
    return catalog.cards.filter(item => !item.deleted && !item.archived && item.title.toLocaleLowerCase('ru').includes(needle)).slice(0, 8);
  }, [cardQuery, catalog.cards]);
  const linkedCard = draft?.cardId ? cardsById.get(draft.cardId) : undefined;
  const matchingEmojis = tagEmojis.filter(item => item.keywords.toLocaleLowerCase('ru').includes(emojiQuery.trim().toLocaleLowerCase('ru')));
  const matchingIcons = tagIcons.filter(([name]) => name.toLocaleLowerCase().includes(iconQuery.trim().toLocaleLowerCase()));
  function changeOpen(next: boolean) {
    if (inFlight.current || busy || (!open && disabled)) return;
    setOpen(next); onOpenChange?.(next); setDraft(null); setMessage(null); setCardQuery('');
    if (next) setQuery('');
  }
  function configure(tag?: ProjectTag) {
    setDraft({ name: tag?.name ?? query.trim(), color: tag?.color ?? defaultTagColor,
      ...(tag?.emoji ? { emoji: tag.emoji } : {}), ...(tag?.iconSvg ? { iconSvg: tag.iconSvg } : {}), ...(tag?.cardId ? { cardId: tag.cardId } : {}),
      hash: catalog.tagsHash ?? '', existing: Boolean(tag) });
    setDecoration(tag ? tagDecoration(tag) : 'none');
    setIconTab(tag?.iconSvg ? 'svg' : 'icons');
    setSelectedIconName('');
    setEmojiQuery(''); setIconQuery(''); setCardQuery(''); setMessage(null);
  }
  async function toggle(name: string) {
    if (unavailable || inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const saved = await onEdit({ action: 'bulk-edit-cards', manifestHash: catalog.manifestHash, optionsHash: catalog.optionsHash ?? '',
        cards: [{ cardId: current.id, sourceHash: current.sourceHash }],
        change: { kind: 'tags', tags: [name], mode: current.tags?.includes(name) ? 'remove' : 'add' } });
      if (!saved) setMessage({ key: 'tagNotSaved' });
    } finally { inFlight.current = false; setBusy(false); }
  }
  async function chooseIcon(file?: File) {
    if (!file || unavailable || !draft) return;
    if (file.size > maxTagIconLength) { setMessage({ key: 'svgLimit' }); return; }
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      const iconSvg = squareTagSvg(await file.text());
      setDraft(current => current ? { ...current, iconSvg, emoji: undefined } : current);
      setSelectedIconName('');
    } catch (error) { setMessage(tagFailure(error, 'svgReadFailed')); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function chooseLucideIcon(name: string, Icon: LucideIcon) {
    if (!draft || unavailable) return;
    try {
      const iconSvg = lucideTagSvg(Icon);
      setDraft({ ...draft, iconSvg, emoji: undefined }); setSelectedIconName(name); setMessage(null);
    } catch (error) { setMessage(tagFailure(error, 'svgPrepareFailed')); }
  }
  function chooseDecoration(next: TagDecoration) {
    if (!draft || unavailable || next === decoration) return;
    setDecoration(next); setMessage(null);
    if (next !== 'icon') setSelectedIconName('');
    // Keep one decoration at a time: switching clears the previous decoration's stored value.
    if (next === 'none') setDraft({ ...draft, color: defaultTagColor, emoji: undefined, iconSvg: undefined });
    else if (next === 'color') setDraft({ ...draft, color: draft.color === defaultTagColor ? dotColors[0] : draft.color, emoji: undefined, iconSvg: undefined });
    else if (next === 'emoji') setDraft({ ...draft, color: defaultTagColor, iconSvg: undefined });
    else { setDraft({ ...draft, emoji: undefined }); setIconTab(draft.iconSvg ? 'svg' : 'icons'); }
  }
  async function saveDefinition() {
    if (!draft || unavailable || conflict || inFlight.current) return;
    if (decoration === 'emoji' && !draft.emoji) { setMessage({ key: 'pickEmoji' }); return; }
    if (decoration === 'icon' && !draft.iconSvg) { setMessage({ key: 'pickIcon' }); return; }
    let tag: ProjectTag;
    try { tag = validateProjectTag({ name: draft.name.trim(), color: draft.color,
      ...(draft.emoji ? { emoji: draft.emoji } : {}), ...(draft.iconSvg ? { iconSvg: draft.iconSvg } : {}), ...(draft.cardId ? { cardId: draft.cardId } : {}) }); }
    catch (error) { setMessage(tagFailure(error, 'checkProperties')); return; }
    if (!draft.existing && tags.some(item => item.name === tag.name)) { setMessage({ key: 'tagExists' }); return; }
    inFlight.current = true; setBusy(true); setMessage(null);
    try {
      if (await onEdit({ action: 'save-project-tag', tag, tagsHash: draft.hash })) {
        setDraft(null); setQuery(tag.name); setMessage({ key: draft.existing ? 'appearanceSaved' : 'tagCreated' });
      } else setMessage({ key: 'appearanceNotSaved' });
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="card-tag-control">
    <CardTags tags={current.tags} definitions={catalog.projectTags} cardsById={cardsById} onOpenCard={onOpenCard} />
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Trigger asChild><Button type="button" variant="ghost" size="sm" className="card-tag-open" disabled={disabled} title={t.configureTags}><Tags size={14} />{t.configureTags}</Button></Dialog.Trigger>
      <Dialog.Portal><Dialog.Overlay className="card-journey-overlay" /><Dialog.Content className="tag-picker-dialog" aria-busy={busy}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy || draft) event.preventDefault(); }}>
        <header className="tag-picker-heading"><div><Dialog.Title>{draft ? (draft.existing ? t.configure : t.newTag) : t.cardTags}</Dialog.Title><Dialog.Description>{draft ? t.description : current.title}</Dialog.Description></div>
          <Button type="button" variant="ghost" size="icon" disabled={busy} aria-label={t.close} onClick={() => changeOpen(false)}><X size={17} /></Button></header>
        {draft ? <form className="tag-editor" onSubmit={event => { event.preventDefault(); void saveDefinition(); }}>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setDraft(null); setMessage(null); }}><ArrowLeft size={14} />{t.allTags}</Button>
          <fieldset disabled={unavailable}>
            <label>{t.name}<input value={draft.name} maxLength={80} readOnly={draft.existing} onChange={event => setDraft({ ...draft, name: event.target.value })} required autoFocus={!draft.existing} /></label>
            {draft.existing && <p className="tag-help">{t.nameHelp}</p>}
            <section className="tag-icon-editor" aria-label={t.decoration}>
              <div className="tag-icon-heading"><span>{t.decoration}</span></div>
              <div className="tag-icon-tabs tag-decoration-choices" role="radiogroup" aria-label={t.decoration}>
                {decorations.map(choice => <button type="button" role="radio" aria-checked={decoration === choice} className="tag-icon-tab" key={choice} tabIndex={decoration === choice ? 0 : -1} onClick={() => chooseDecoration(choice)}
                  onKeyDown={event => {
                    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
                    const index = event.key === 'Home' ? 0 : event.key === 'End' ? decorations.length - 1 : step === undefined ? -1 : (decorations.indexOf(choice) + step + decorations.length) % decorations.length;
                    if (index < 0) return;
                    event.preventDefault(); chooseDecoration(decorations[index]);
                    (event.currentTarget.parentElement?.children[index] as HTMLElement | undefined)?.focus();
                  }}>{{ none: t.decorationNone, color: t.decorationColor, emoji: t.emoji, icon: t.icon }[choice]}</button>)}
              </div>
              <p className="tag-help">{t.decorationHelp}</p>
              {(decoration === 'color' || decoration === 'icon') && <div className="tag-colors" role="group" aria-label={decoration === 'icon' ? t.iconColor : t.tagColor}>{(decoration === 'icon' ? colors : dotColors).map(color => <button type="button" key={color} className="tag-color-swatch" aria-label={t.color(color)} aria-pressed={draft.color.toLowerCase() === color} style={{ backgroundColor: color }} onClick={() => setDraft({ ...draft, color })}>{draft.color.toLowerCase() === color && <Check size={14} />}</button>)}<label className="tag-custom-color"><span className="visually-hidden">{t.customColor}</span><input type="color" value={draft.color} onChange={event => setDraft({ ...draft, color: event.target.value })} /></label></div>}
              {decoration === 'emoji' && <div className="tag-icon-panel">
                <label className="tag-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t.findEmoji}</span><input type="search" value={emojiQuery} onChange={event => setEmojiQuery(event.target.value)} placeholder={t.emojiPlaceholder} /></label>
                <div className="tag-symbol-grid" role="group" aria-label={t.emoji}>
                  {matchingEmojis.map(item => <button type="button" className="tag-symbol-choice" key={item.emoji} aria-label={t.emojiName(item.emoji)} aria-pressed={draft.emoji === item.emoji} title={item.keywords} onClick={() => { setDraft({ ...draft, emoji: item.emoji, iconSvg: undefined }); setMessage(null); }}>{item.emoji}</button>)}
                </div>
                {!matchingEmojis.length && <p className="tag-empty">{t.noEmoji}</p>}
              </div>}
              {decoration === 'icon' && <>
                <div className="tag-icon-tabs" role="tablist" aria-label={t.iconType}>
                  {([['icons', t.icons], ['svg', t.customSvg]] as const).map(([tab, label]) => <button type="button" role="tab" id={iconPanelId + '-' + tab} aria-controls={iconPanelId + '-panel'} aria-selected={iconTab === tab} className="tag-icon-tab" key={tab} onClick={() => { setIconTab(tab); setMessage(null); }}>{label}</button>)}
                </div>
                <div className="tag-icon-panel" role="tabpanel" id={iconPanelId + '-panel'} aria-labelledby={iconPanelId + '-' + iconTab}>
                  {iconTab === 'icons' && <>
                    <label className="tag-search"><Search size={15} aria-hidden="true" /><span className="visually-hidden">{t.findIcon}</span><input type="search" value={iconQuery} onChange={event => setIconQuery(event.target.value)} placeholder={t.iconPlaceholder} /></label>
                    <div className="tag-symbol-grid" role="group" aria-label={t.lucideIcons}>
                      {matchingIcons.map(([name, Icon]) => <button type="button" className="tag-symbol-choice" key={name} aria-label={t.iconName(name)} aria-pressed={Boolean(draft.iconSvg) && selectedIconName === name} title={name} onClick={() => chooseLucideIcon(name, Icon)}><Icon size={20} /></button>)}
                    </div>
                    {!matchingIcons.length && <p className="tag-empty">{t.noIcons}</p>}
                  </>}
                  {iconTab === 'svg' && <>
                    <div className="tag-icon-upload"><label htmlFor={inputId}><ImagePlus size={15} />{t.uploadSvg}</label><input id={inputId} type="file" accept="image/svg+xml,.svg" onChange={event => { void chooseIcon(event.target.files?.[0]); event.target.value = ''; }} /></div>
                    <p className="tag-help">{t.svgHelp}</p>
                  </>}
                </div>
              </>}
            </section>
            <div className="tag-card-link">
              <label htmlFor={cardInputId}><Search size={15} />{t.tagCard}</label>
              <input id={cardInputId} type="search" value={cardQuery} placeholder={t.cardPlaceholder} disabled={unavailable}
                onChange={event => setCardQuery(event.target.value)} />
              {linkedCard && <div className="tag-card-selected"><span className="tag-card-selected-title">{linkedCard.title}</span><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft({ ...draft, cardId: undefined })}>{t.removeCard}</Button></div>}
              {cardMatches.length > 0 && <div className="tag-card-results" role="listbox" aria-label={t.projectCards}>
                {cardMatches.map(item => <button type="button" key={item.id} role="option" aria-selected={draft.cardId === item.id} className="tag-card-result" disabled={busy}
                  onClick={() => { setDraft({ ...draft, cardId: item.id }); setCardQuery(''); }}>
                  <span>{item.version && <small>{item.version} </small>}{item.title}</span>{draft.cardId === item.id && <Check size={13} />}
                </button>)}
              </div>}
              {cardQuery.trim() && cardMatches.length === 0 && <p className="tag-empty">{t.noCards}</p>}
              <p className="tag-help">{t.cardHelp}</p>
            </div>
            <div className="tag-preview"><span>{t.preview}</span><CardTags tags={[draft.name || t.tag]} definitions={[{ name: draft.name || t.tag, color: draft.color, emoji: draft.emoji, iconSvg: draft.iconSvg }]} /><TagColorIndicator tags={[draft.name || t.tag]} definitions={[{ name: draft.name || t.tag, color: draft.color, emoji: draft.emoji, iconSvg: draft.iconSvg }]} /></div>
          </fieldset>
          {conflict && <div className="tag-conflict" role="alert">{t.conflict}<Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDraft({ ...draft, hash: catalog.tagsHash ?? '' })}>{t.useCurrent}</Button></div>}
          <footer className="tag-editor-actions"><Button type="button" variant="ghost" disabled={busy} onClick={() => setDraft(null)}>{t.cancel}</Button><Button type="submit" disabled={unavailable || conflict || !validTagName(draft.name.trim())}>{busy && <LoaderCircle size={14} className="spin" />}{draft.existing ? t.save : t.create}</Button></footer>
        </form> : <><TagSelectionList tags={tags} definitions={catalog.projectTags} selected={current.tags ?? []} query={query} onQueryChange={setQuery} onToggle={name => void toggle(name)} onConfigure={configure} disabled={unavailable} />
          <Button type="button" variant="ghost" size="sm" className="tag-create" disabled={unavailable} onClick={() => configure()}><Plus size={15} />{t.create}{validTagName(query.trim()) && !tags.some(tag => tag.name === query.trim()) ? ' «' + query.trim() + '»' : ''}</Button>
        </>}
        {message && <p className="tag-feedback" role="status">{'key' in message ? t[message.key] : message.message}</p>}
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </div>;
}
