import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { EmptyState } from './EmptyState.tsx';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import '../deck-picker.css';
import { usePreparedEntrance } from '../prepared-motion.ts';

const text = defineText(
  { searchLabel: (title: string) => `Search ${title}`, choose: (title: string) => `Choose ${title}`,
    current: 'current', beforeKeys: 'Use ', beforeEnter: ' to navigate, ', afterEnter: ' to ', confirm: 'confirm' },
  { searchLabel: (title: string) => `Поиск: ${title}`, choose: (title: string) => `Выбрать: ${title}`,
    current: 'текущее', beforeKeys: '', beforeEnter: ' — выбор, ', afterEnter: ' — ', confirm: 'подтвердить' });

export interface QuickSettingsChoice {
  key: string;
  label: string;
  search?: string;
  icon?: ReactNode;
  detail?: ReactNode;
  group?: { key: string; label: string };
}

/** 2026-11-05: one search, list and keyboard path for all six properties and the New Card deck picker. */
export function QuickSettingsList({ title, choices, current, disabled, searchDisabled = disabled, titleAs: Title = 'h3', tabs = false, onChoose }: {
  title: string; choices: QuickSettingsChoice[]; current: string; disabled: boolean;
  titleAs?: ElementType; tabs?: boolean; searchDisabled?: boolean; onChoose: (key: string) => void;
}) {
  const [query, setQuery] = useState('');
  const t = useText(text);
  const lang = useLang();
  const languageTag = locale(lang);
  const [active, setActive] = useState(current);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const id = useId();
  const filtered = choices.filter(choice => [choice.label, choice.search, choice.group?.label].join(' ').toLocaleLowerCase(languageTag).includes(query.trim().toLocaleLowerCase(languageTag)));
  const activeIndex = filtered.findIndex(choice => choice.key === active);
  const optionId = (index: number) => id + '-option-' + index;

  useLayoutEffect(() => {
    const box = list.current;
    // 2026-11-10: no matches must not resize a populated picker and move its search caret.
    // An initially empty selector still measures its reset action; populated lists keep their scrollport.
    if (!box || query && choices.length) return;
    // 2026-11-09: filtering must not move the search caret when the popover opens above its anchor.
    box.style.height = '';
    box.style.height = `${Math.min(box.scrollHeight, parseFloat(getComputedStyle(box).maxHeight))}px`;
  }, [choices, query, filtered.length]);

  useEffect(() => { moveFocus(search.current, { preventScroll: true }); }, []);
  useEffect(() => {
    // 2026-11-05: scroll only this list; scrollIntoView also moves the card behind the popover.
    const box = list.current;
    const row = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!box || !row) return;
    const heading = row.parentElement?.querySelector<HTMLElement>('.deck-choice-space')?.offsetHeight ?? 0;
    if (row.offsetTop - heading < box.scrollTop) box.scrollTop = row.offsetTop - heading;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
  }, [active, query]);

  function choose(key: string | undefined) { if (key !== undefined && !disabled) onChoose(key); }
  const groups: { key: string; label?: string; choices: QuickSettingsChoice[] }[] = [];
  for (const choice of filtered) {
    const key = choice.group?.key ?? '';
    if (groups.at(-1)?.key !== key) groups.push({ key, label: choice.group?.label, choices: [] });
    groups.at(-1)!.choices.push(choice);
  }

  return <div className="deck-choice" onKeyDown={event => {
    if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); event.stopPropagation();
      if (!filtered.length || disabled) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive(filtered[activeIndex < 0 ? 0 : (activeIndex + step + filtered.length) % filtered.length].key);
    } else if (event.key === 'Enter' && event.target === search.current) {
      event.preventDefault(); event.stopPropagation(); choose(filtered[activeIndex]?.key);
    }
  }}>
    <div className="deck-choice-body">
      <Title className="deck-choice-title">{t.choose(title)}</Title>
      <input ref={search} className="deck-choice-search" type="search" role="combobox" aria-expanded="true" aria-controls={id + '-list'} aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined} aria-label={t.searchLabel(title)}
        value={query} disabled={searchDisabled} data-autofocus onChange={event => {
          const text = event.target.value;
          setQuery(text);
          const first = choices.find(choice => [choice.label, choice.search, choice.group?.label].join(' ').toLocaleLowerCase(languageTag).includes(text.trim().toLocaleLowerCase(languageTag)));
          setActive(first?.key ?? '');
        }} />
      <div ref={list} id={id + '-list'} className="deck-choice-list" role="listbox" aria-label={title}>
        {groups.map(group => <div key={group.key} role={group.label ? 'group' : undefined} aria-label={group.label} className="deck-choice-group">
          {group.label && <div className="deck-choice-space"><span title={group.label}>{group.label}</span></div>}
          {group.choices.map(choice => {
            const index = filtered.indexOf(choice);
            return <div key={choice.key} id={optionId(index)} role="option" aria-selected={choice.key === current} aria-disabled={disabled || undefined}
              data-active={choice.key === active} data-current={choice.key === current} className="deck-choice-option"
              onPointerMove={() => { if (!disabled) setActive(choice.key); }} onMouseDown={event => event.preventDefault()} onClick={() => choose(choice.key)}>
              {choice.icon}<span className="deck-choice-name" title={choice.label}>{choice.label}</span>{choice.detail}
              {choice.key === current && <span className="deck-choice-current">{t.current}</span>}
            </div>;
          })}
        </div>)}
        {!filtered.length && (query.trim()
          ? <EmptyState variant="filtered" onReset={() => { setQuery(''); setActive(current); moveFocus(search.current); }} />
          : <EmptyState />)}
      </div>
    </div>
    <p className="deck-choice-hint">{t.beforeKeys}{tabs && <kbd>←</kbd>}<kbd>↑</kbd><kbd>↓</kbd>{tabs && <kbd>→</kbd>}{t.beforeEnter}<kbd>Enter</kbd>{t.afterEnter}<button type="button" className="deck-choice-confirm" disabled={disabled || activeIndex < 0} onClick={() => choose(filtered[activeIndex]?.key)}>{t.confirm}</button>.</p>
  </div>;
}

export function QuickSettingsPopover({ anchor, busy = false, onClose, children }: {
  anchor: HTMLElement | null; busy?: boolean; onClose: () => void; children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const attachContent = usePreparedEntrance(content);
  const outside = useRef(false);
  const [place, setPlace] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (!anchor) return;
    const expanded = anchor.getAttribute('aria-expanded');
    anchor.setAttribute('aria-expanded', 'true');
    return () => {
      if (expanded === null) anchor.removeAttribute('aria-expanded');
      else anchor.setAttribute('aria-expanded', 'false');
    };
  }, [anchor]);
  useLayoutEffect(() => {
    function measure() {
      const bounds = anchor?.getBoundingClientRect();
      const width = Math.min(340, innerWidth - 16);
      const left = Math.max(8, Math.min((bounds?.left ?? innerWidth / 2) - 16, innerWidth - width - 8));
      // 2026-11-09: shortcuts can open a property whose medallion is below the phone viewport.
      const bottom = Math.max(8, Math.min(bounds?.bottom ?? 64, innerHeight - 8));
      const top = Math.max(8, Math.min(bounds?.top ?? 64, innerHeight - 8));
      const below = innerHeight - bottom - 16;
      const above = top - 16;
      const height = content.current?.scrollHeight ?? 410;
      setPlace(below >= height || below >= above
        ? { top: bottom + 8, left, width, maxHeight: Math.max(100, below) }
        : { bottom: innerHeight - top + 8, left, width, maxHeight: Math.max(100, above) });
    }
    measure();
    const observer = new ResizeObserver(measure);
    if (content.current) observer.observe(content.current);
    addEventListener('resize', measure);
    addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); removeEventListener('resize', measure); removeEventListener('scroll', measure, true); };
  }, [anchor]);

  return <Dialog.Root open modal={false} onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Content ref={attachContent} className="deck-picker-popover" style={place} aria-describedby={undefined} aria-busy={busy}
      onOpenAutoFocus={event => { event.preventDefault(); moveFocus(content.current?.querySelector<HTMLElement>('[data-autofocus]')); }}
      onCloseAutoFocus={event => { event.preventDefault(); if (!outside.current && anchor?.isConnected) moveFocus(anchor, { preventScroll: true }); }}
      onInteractOutside={event => {
        if (busy || (event.target instanceof Node && anchor?.contains(event.target))) event.preventDefault();
        else outside.current = true;
      }}
      onEscapeKeyDown={event => { event.stopPropagation(); if (busy) event.preventDefault(); }}>
      {children}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
