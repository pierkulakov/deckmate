import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react';
import type { Root } from 'mdast';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, BookOpen, Code2, FileText, LoaderCircle, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { markdownParser } from '../../src/markdown-model.ts';
import { failureMessage } from '../failure-message.ts';
import { Markdown } from './Markdown.tsx';
import { Button } from './ui/button.tsx';
import { defineText, textNow, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { catalogStore } from '../catalog-store.ts';
import { formatShortcut } from '../shortcut-format.ts';
import '../document-preview.css';

const copy = defineText({
  readFailed: (status: number) => `Could not read the document (HTTP ${status}).`,
  unavailable: 'Document unavailable.',
  opening: 'Opening document…',
  unavailableTitle: 'Document unavailable',
  retry: 'Retry',
  missingAnchor: 'The linked section was not found. The whole document is open.',
  empty: 'The document has no text.',
  back: 'Back to previous document',
  backShort: 'Back',
  document: 'Document',
  markdownPreview: 'Markdown preview',
  restorePane: 'Restore side panel',
  expand: 'Expand document',
  sidePane: 'Side panel',
  fullWindow: 'Full window',
  close: 'Close document',
  closeShortcut: (key: string) => `Close · ${key}`,
  view: 'Document view',
  source: 'Source',
  original: 'Original',
  sandbox: 'Test copy',
  readOnly: 'Read-only',
  reread: 'Reload document',
  refresh: 'Refresh',
}, {
  readFailed: (status: number) => `Не удалось прочитать документ (HTTP ${status}).`,
  unavailable: 'Документ недоступен.',
  opening: 'Открываем документ…',
  unavailableTitle: 'Документ недоступен',
  retry: 'Повторить',
  missingAnchor: 'Раздел по этой ссылке не найден. Документ открыт целиком.',
  empty: 'В документе нет текста.',
  back: 'Назад к предыдущему документу',
  backShort: 'Назад',
  document: 'Документ',
  markdownPreview: 'Просмотр Markdown',
  restorePane: 'Вернуть боковую панель',
  expand: 'Развернуть документ',
  sidePane: 'Боковая панель',
  fullWindow: 'На всё окно',
  close: 'Закрыть документ',
  closeShortcut: (key: string) => `Закрыть · ${key}`,
  view: 'Вид документа',
  source: 'Исходник',
  original: 'Оригинал',
  sandbox: 'Тестовая копия',
  readOnly: 'Только чтение',
  reread: 'Перечитать документ',
  refresh: 'Обновить',
});

interface DocumentLocation { path: string; source: DataSource; hash: string; scrollTop: number }
interface DocumentResult { key: string; text: string; error: string | null }
const documentKey = (location: DocumentLocation) => location.source + ':' + location.path;

function DocumentMarkdown({ tree, markdown, location }: { tree: Root; markdown: string; location: DocumentLocation }) {
  // 2026-11-05: reuse the viewed source's catalog; opening a document never starts another catalog request.
  const store = catalogStore(location.source);
  const { catalog } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <Markdown tree={tree} rawMarkdown={markdown} source={location.source} path={location.path}
    projectTags={catalog?.projectTags} cards={catalog?.cards} members={catalog?.members} />;
}

function markdownLocation(anchor: HTMLAnchorElement): DocumentLocation | null {
  try {
    const url = new URL(anchor.href, window.location.href);
    const path = url.searchParams.get('path');
    const source = url.searchParams.get('source');
    if (url.origin !== window.location.origin || url.pathname !== '/api/file'
      || (source !== 'sandbox' && source !== 'live') || !path || !/\.md$/iu.test(path)
      || /[\u0000-\u001f\u007f]/u.test(path) || url.username || url.password) return null;
    return { path, source, hash: url.hash, scrollTop: 0 };
  } catch { return null; }
}

function headingSlug(text: string): string {
  return text.trim().toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/gu, '-');
}

function findHeading(container: HTMLElement, hash: string): HTMLElement | undefined {
  let requested: string;
  try { requested = decodeURIComponent(hash.slice(1)).toLocaleLowerCase('ru'); }
  catch { return undefined; }
  const occurrences = new Map<string, number>();
  return Array.from(container.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')).find(heading => {
    const text = heading.textContent ?? '';
    const slug = headingSlug(text);
    const count = occurrences.get(slug) ?? 0;
    occurrences.set(slug, count + 1);
    const uniqueSlug = count ? slug + '-' + count : slug;
    const section = /^\s*(\d+(?:\.\d+)*[a-z]?)(?:\s|[.—:-]|$)/iu.exec(text)?.[1].toLocaleLowerCase('ru');
    return heading.id === requested || uniqueSlug === requested
      || (section !== undefined && (section === requested || section.replaceAll('.', '-') === requested));
  });
}

export function DocumentPreviewProvider({ children }: { children: ReactNode }) {
  const t = useText(copy);
  const [history, setHistory] = useState<DocumentLocation[]>([]);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [missingAnchor, setMissingAnchor] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const current = history.at(-1);
  const key = current ? documentKey(current) : '';
  const source = current?.source;
  const path = current?.path;
  const loading = Boolean(current) && result?.key !== key;
  const text = result?.key === key && !result.error ? result.text : '';
  const tree = useMemo(() => markdownParser.parse(text), [text]);

  useEffect(() => {
    if (!source || !path) return;
    const controller = new AbortController();
    const requestGeneration = ++generation.current;
    const requestedKey = source + ':' + path;
    setResult(null);
    const query = new URLSearchParams({ source, path });
    async function read() {
      try {
        // 2026-11-03: rebuild a local read-only endpoint; never fetch a URL supplied by document content.
        const response = await fetch('/api/file?' + query.toString(), {
          method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) {
          let message = textNow(copy).readFailed(response.status);
          try {
            const body: unknown = await response.json();
            if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') message = body.message;
          } catch { /* A missing file may have an empty response (2026-11-03). */ }
          throw new Error(message);
        }
        const markdown = await response.text();
        if (!controller.signal.aborted && requestGeneration === generation.current) {
          setResult({ key: requestedKey, text: markdown, error: null });
        }
      } catch (failure) {
        if (!controller.signal.aborted && requestGeneration === generation.current) {
          setResult({ key: requestedKey, text: '', error: failureMessage(failure, textNow(copy).unavailable) });
        }
      }
    }
    void read();
    return () => { controller.abort(); };
  }, [source, path, retry]);

  useLayoutEffect(() => {
    const body = viewport.current;
    if (!body || !current || loading || result?.error) { setMissingAnchor(false); return; }
    const heading = !raw && current.hash ? findHeading(body, current.hash) : undefined;
    setMissingAnchor(Boolean(current.hash && !raw && !heading));
    const top = heading && current.scrollTop === 0
      ? body.scrollTop + heading.getBoundingClientRect().top - body.getBoundingClientRect().top - 24
      : current.scrollTop;
    body.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [current, text, raw, loading, result?.error]);

  function navigate(next: DocumentLocation, anchor: HTMLAnchorElement) {
    if (!current) {
      opener.current = anchor;
      setRaw(false);
      setExpanded(false);
    }
    const scrollTop = viewport.current?.scrollTop ?? 0;
    setHistory(previous => {
      const last = previous.at(-1);
      if (last && documentKey(last) === documentKey(next) && last.hash === next.hash) return [...previous.slice(0, -1), next];
      return [...previous.map((entry, index) => index === previous.length - 1 ? { ...entry, scrollTop } : entry), next];
    });
  }

  function captureLink(event: MouseEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href') ?? '';
    // Local heading jumps stay inside the panel, leaving the app URL and its draft untouched.
    const next = current && viewport.current?.contains(anchor) && href.startsWith('#')
      ? { ...current, hash: href, scrollTop: 0 } : markdownLocation(anchor);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    navigate(next, anchor);
  }

  function renderBody() {
    if (loading) return <div className="document-preview-state" role="status"><LoaderCircle size={24} className="spin" /><p>{t.opening}</p></div>;
    if (result?.error) return <div className="document-preview-state document-preview-error" role="alert">
      <FileText size={28} /><h3>{t.unavailableTitle}</h3><p>{result.error}</p>
      <Button type="button" variant="outline" onClick={() => setRetry(value => value + 1)}><RefreshCw size={14} />{t.retry}</Button>
    </div>;
    if (raw) return <pre className="document-preview-raw"><code>{text}</code></pre>;
    return <>
      {missingAnchor && <p className="document-preview-anchor-note" role="status">{t.missingAnchor}</p>}
      <article className="document-preview-article">
        {current && <DocumentMarkdown tree={tree} markdown={text} location={current} />}
        {!text && <p className="document-preview-empty">{t.empty}</p>}
      </article>
    </>;
  }

  function close() {
    generation.current += 1;
    setHistory([]);
    setResult(null);
  }

  return <div className="document-preview-provider" onClickCapture={captureLink}>
    {children}
    <Dialog.Root open={Boolean(current)} onOpenChange={open => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="document-preview-overlay" />
        <Dialog.Content className={'document-preview-pane dialog-panel' + (expanded ? ' is-expanded' : '')}
          onOpenAutoFocus={event => { event.preventDefault(); moveFocus(title.current); }}
          onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) moveFocus(opener.current); }}>
          <header className="document-preview-header dialog-head">
            <div className="document-preview-navigation">
              <Button type="button" size="icon" variant="ghost" disabled={history.length < 2}
                onClick={() => setHistory(previous => previous.slice(0, -1))} aria-label={t.back} title={t.backShort}><ArrowLeft size={17} /></Button>
              <span className="document-preview-file-icon"><FileText size={18} /></span>
              <div className="document-preview-heading">
                <Dialog.Title className="dialog-title" ref={title} tabIndex={-1} title={current?.path}>{current?.path.split(/[\\/]/u).at(-1) ?? t.document}</Dialog.Title>
                <Dialog.Description title={current?.path}>{current?.path ?? t.markdownPreview}</Dialog.Description>
              </div>
            </div>
            <div className="document-preview-actions">
              <Button type="button" size="icon" variant="ghost" onClick={() => setExpanded(value => !value)}
                aria-label={expanded ? t.restorePane : t.expand} title={expanded ? t.sidePane : t.fullWindow}>
                {expanded ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </Button>
              <Dialog.Close asChild><Button type="button" size="icon" variant="ghost" aria-label={t.close} title={t.closeShortcut(formatShortcut({ key: 'Escape' }).display)}><X size={18} /></Button></Dialog.Close>
            </div>
          </header>
          <div className="document-preview-toolbar">
            <div className="document-preview-mode control-segmented" role="group" aria-label={t.view}>
              <button type="button" className="control" aria-pressed={!raw} onClick={() => setRaw(false)}><BookOpen size={14} />{t.document}</button>
              <button type="button" className="control" aria-pressed={raw} onClick={() => setRaw(true)}><Code2 size={14} />{t.source}</button>
            </div>
            <span className="document-preview-source">{current?.source === 'live' ? t.original : t.sandbox}<span>{t.readOnly}</span></span>
            <Button type="button" size="icon" variant="ghost" disabled={loading} aria-label={t.reread} title={t.refresh} onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} /></Button>
          </div>
          <div className="document-preview-body dialog-body" ref={viewport} aria-busy={loading} data-document-preview-body>
            {renderBody()}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
