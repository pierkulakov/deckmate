import { useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';
import '../card-value-hint.css';

// 2026-11-10: clipped values need the same full text on keyboard focus as on pointer hover.
export function CardValueHint({ text, measure, children }: { text: string; measure: string; children: ReactElement }) {
  const container = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const value = container.current?.querySelector<HTMLElement>(measure);
    if (!value) return;
    const update = () => setClipped(value.scrollHeight > value.clientHeight + 1 || value.scrollWidth > value.clientWidth + 1);
    const observer = new ResizeObserver(update);
    observer.observe(value);
    update();
    return () => observer.disconnect();
  }, [text, measure]);
  return <span ref={container} className="card-value-hint"><Tooltip.Provider delayDuration={200}><Tooltip.Root open={clipped && open} onOpenChange={setOpen}>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="card-value-tooltip" side="top" sideOffset={6}>{text}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider></span>;
}
