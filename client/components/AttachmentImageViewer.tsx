import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft, ChevronRight, Download, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { CardAttachment } from '../../src/catalog-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { attachmentFileUrl } from '../attachments.ts';
import { Button } from './ui/button.tsx';
import { defineText, useText } from '../i18n.ts';
import { moveFocus } from '../focus.ts';

const text = defineText({
  view: (name: string) => `View image ${name}`,
  zoomOut: 'Zoom out',
  zoomIn: 'Zoom in',
  resetZoom: 'Reset zoom',
  download: (name: string) => `Download ${name}`,
  close: 'Close viewer',
  closeShortcut: 'Close (Esc)',
  hint: 'Wheel — zoom · drag — pan · Esc — close',
}, {
  view: (name: string) => `Просмотр изображения ${name}`,
  zoomOut: 'Уменьшить',
  zoomIn: 'Увеличить',
  resetZoom: 'Сбросить масштаб',
  download: (name: string) => `Скачать ${name}`,
  close: 'Закрыть просмотр',
  closeShortcut: 'Закрыть (Esc)',
  hint: 'Колесо — масштаб · перетаскивание — сдвиг · Esc — закрыть',
});

interface AttachmentImageViewerProps {
  images: CardAttachment[];
  index: number;
  source: DataSource;
  /** Arrow direction follows the selected list order. */
  previousLabel: string;
  nextLabel: string;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function clampZoom(value: number): number {
  return Math.min(8, Math.max(1, Math.round(value * 100) / 100));
}

/** Image viewer with zoom, pan, and navigation between the card's images. */
export function AttachmentImageViewer({ images, index, source, previousLabel, nextLabel, onIndexChange, onClose }: AttachmentImageViewerProps) {
  const [{ zoom, offset }, setView] = useState({ zoom: 1, offset: { x: 0, y: 0 } });
  const t = useText(text);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ pointerX: number; pointerY: number; offsetX: number; offsetY: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const image = images[index];
  const first = index === 0;
  const last = index === images.length - 1;

  useEffect(() => { reset(); }, [image?.file]);
  useEffect(() => {
    if (zoom === 1) endPan();
  }, [zoom]);

  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    // Wheel zoom needs a non-passive listener to prevent the page from scrolling.
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  function changeZoom(factor: number) {
    setView(previous => {
      const zoom = clampZoom(previous.zoom * factor);
      // 2026-11-11: zoom and offset change together so a fitted image is never painted off-centre.
      return { zoom, offset: zoom === 1 ? { x: 0, y: 0 } : previous.offset };
    });
  }

  function reset() { setView({ zoom: 1, offset: { x: 0, y: 0 } }); endPan(); }

  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (zoom === 1 || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = { pointerX: event.clientX, pointerY: event.clientY, offsetX: offset.x, offsetY: offset.y };
    setDragging(true);
  }

  function movePan(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStart.current;
    if (!start || zoom === 1) return;
    const offset = { x: start.offsetX + event.clientX - start.pointerX, y: start.offsetY + event.clientY - start.pointerY };
    setView(previous => ({ ...previous, offset }));
  }

  function endPan() { dragStart.current = null; setDragging(false); }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'ArrowLeft' && !first) onIndexChange(index - 1);
    if (event.key === 'ArrowRight' && !last) onIndexChange(index + 1);
  }

  if (!image) return null;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="attachment-viewer-overlay" />
      <Dialog.Content className="attachment-viewer" aria-describedby={undefined} onKeyDown={onKeyDown}
        onCloseAutoFocus={event => { event.preventDefault(); if (opener.current?.isConnected) moveFocus(opener.current); }}>
        <Dialog.Title className="visually-hidden">{t.view(image.name)}</Dialog.Title>
        <header className="attachment-viewer-bar">
          <div className="attachment-viewer-name"><strong title={image.name}>{image.name}</strong><span>{index + 1} / {images.length}</span></div>
          <div className="attachment-viewer-tools">
            <Button type="button" variant="ghost" size="icon" aria-label={t.zoomOut} title={t.zoomOut} disabled={zoom <= 1} onClick={() => changeZoom(1 / 1.25)}><ZoomOut size={17} /></Button>
            <span className="attachment-viewer-zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="ghost" size="icon" aria-label={t.zoomIn} title={t.zoomIn} disabled={zoom >= 8} onClick={() => changeZoom(1.25)}><ZoomIn size={17} /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label={t.resetZoom} title={t.resetZoom} disabled={zoom === 1 && offset.x === 0 && offset.y === 0} onClick={reset}><Maximize size={17} /></Button>
            <a className="ui-button button-ghost button-size-icon" href={attachmentFileUrl(source, image.file)} download={image.name} aria-label={t.download(image.name)} title={t.download(image.name)}><Download size={17} /></a>
            <Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t.close} title={t.closeShortcut}><X size={19} /></Button></Dialog.Close>
          </div>
        </header>
        <div ref={stage} className="attachment-viewer-stage">
          <div className={'attachment-viewer-pan' + (dragging ? ' is-dragging' : '')}
            onPointerDown={startPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan} onLostPointerCapture={endPan} onDoubleClick={reset}>
            <img src={attachmentFileUrl(source, image.file)} alt={image.name} draggable={false}
              style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} />
          </div>
          {!first && <Button type="button" variant="ghost" size="icon" className="attachment-viewer-arrow attachment-viewer-previous" aria-label={previousLabel} title={previousLabel} onClick={() => onIndexChange(index - 1)}><ChevronLeft size={26} /></Button>}
          {!last && <Button type="button" variant="ghost" size="icon" className="attachment-viewer-arrow attachment-viewer-next" aria-label={nextLabel} title={nextLabel} onClick={() => onIndexChange(index + 1)}><ChevronRight size={26} /></Button>}
        </div>
        <footer className="attachment-viewer-hint">{t.hint}</footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
