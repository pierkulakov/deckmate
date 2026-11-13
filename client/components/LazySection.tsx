import { Component, Suspense, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { useScrollportFitHeight } from '../scrollport-fit.ts';
import { InitialLoadingStarted, LoadingState } from './LoadingState.tsx';
import { Button } from './ui/button.tsx';
import './lazy-section.css';

const text = defineText({
  failed: 'This section could not be opened',
  description: 'Check the connection, then reload the interface to try again.',
  reload: 'Reload interface', close: 'Close',
}, {
  failed: 'Не удалось открыть раздел',
  description: 'Проверьте соединение и обновите интерфейс, чтобы повторить загрузку.',
  reload: 'Обновить интерфейс', close: 'Закрыть',
});

type Props = { children: ReactNode; mode?: 'page' | 'panel' | 'dialog'; active?: boolean; resetKey?: string; onClose?: () => void; onFailure?: () => void };

const fitPanel = (element: HTMLElement) => element;
function PanelFrame({ children }: { children: ReactNode }) {
  const frame = useScrollportFitHeight(fitPanel, '--lazy-section-height');
  return <section ref={frame} className="lazy-section-panel">{children}</section>;
}

function SectionLoading({ mode, active }: Pick<Props, 'mode' | 'active'>) {
  if (mode === 'panel') return <PanelFrame><LoadingState active={active} /></PanelFrame>;
  return <LoadingState active={active} className={`lazy-section-${mode}`} />;
}

function SectionFailure({ mode, onClose }: Pick<Props, 'mode' | 'onClose'>) {
  const t = useText(text);
  const message = <div className="empty-state lazy-section-error" role="alert">
    <h2 className="panel-title">{t.failed}</h2><p>{t.description}</p>
    {/* 2026-11-13: React and the module map cache rejected imports; reloading also gets the current asset manifest. */}
    <Button onClick={() => location.reload()}>{t.reload}</Button>
    {onClose && mode !== 'dialog' && <Button variant="ghost" onClick={onClose}>{t.close}</Button>}
  </div>;
  if (mode === 'panel') return <PanelFrame>{message}</PanelFrame>;
  if (mode !== 'dialog') return <div className={`lazy-section-${mode}`}>{message}</div>;
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose?.(); }}><Dialog.Portal>
    <Dialog.Overlay className="lazy-section-scrim" />
    <Dialog.Content className="lazy-section-dialog-error dialog-panel" aria-describedby={undefined}>
      <header className="dialog-head"><Dialog.Title className="dialog-title">{t.failed}</Dialog.Title>
        <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label={t.close}><X size={17} /></Button></Dialog.Close>
      </header><div className="dialog-body">{message}</div>
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

// 2026-11-13: a failed optional panel must not replace the surrounding workspace or another open editor.
export class LazySection extends Component<Props, { failed: boolean; resetKey?: string }> {
  state = { failed: false, resetKey: this.props.resetKey };
  private startedAt = performance.now();
  static getDerivedStateFromError() { return { failed: true }; }
  // 2026-11-13: a failed workspace screen still ends the first-screen cover, so the failure message is visible.
  componentDidCatch() { this.props.onFailure?.(); }
  static getDerivedStateFromProps(props: Props, state: { resetKey?: string }) {
    return props.resetKey !== state.resetKey ? { failed: false, resetKey: props.resetKey } : null;
  }
  render() {
    const { children, mode = 'page', active = true, onClose } = this.props;
    if (this.state.failed && !active) return null;
    if (this.state.failed) return <SectionFailure mode={mode} onClose={onClose} />;
    return <InitialLoadingStarted.Provider value={mode === 'page' ? this.startedAt : undefined}>
      <Suspense fallback={<SectionLoading active={active} mode={mode} />}>{children}</Suspense>
    </InitialLoadingStarted.Provider>;
  }
}
