import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({
  useEffect: (effect: () => void) => effect(),
  useEffectEvent: (callback: unknown) => callback,
}));

import { useEscapeToClose } from '../client/useEscapeToClose.ts';

class FakeSelect extends EventTarget {
  multiple = false;
  size = 0;
}

class FakeDocument extends EventTarget {
  layerOpen = false;
  querySelector() { return this.layerOpen ? {} : null; }
}

function key(target: EventTarget, options: { isComposing?: boolean; prevented?: boolean } = {}) {
  const event = new Event('keydown', { cancelable: true });
  Object.assign(event, { key: 'Escape', isComposing: Boolean(options.isComposing), repeat: false });
  if (options.prevented) event.preventDefault();
  target.dispatchEvent(event);
  return event;
}

describe('inline panel Escape', () => {
  let document: FakeDocument;
  let focus: ReturnType<typeof vi.fn<() => void>>;
  let close: ReturnType<typeof vi.fn<() => void>>;
  beforeEach(() => {
    document = new FakeDocument();
    focus = vi.fn();
    close = vi.fn();
    vi.stubGlobal('document', document);
    vi.stubGlobal('HTMLSelectElement', FakeSelect);
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => callback());
    useEscapeToClose(true, close, { current: { isConnected: true, focus } as unknown as HTMLElement });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('closes and restores focus to the opener', () => {
    expect(key(document).defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it('does not close during composition or when the event was consumed', () => {
    key(document, { isComposing: true });
    key(document, { prevented: true });
    expect(close).not.toHaveBeenCalled();
  });

  it('leaves an open nested menu or dialog to handle Escape first', () => {
    document.layerOpen = true;
    key(document);
    expect(close).not.toHaveBeenCalled();
    document.layerOpen = false;
    key(document);
    expect(close).toHaveBeenCalledOnce();
  });

  it('leaves an open native select to handle the first Escape', () => {
    const select = new FakeSelect();
    const pointer = new Event('pointerdown');
    Object.defineProperty(pointer, 'target', { value: select });
    document.dispatchEvent(pointer);
    key(document);
    expect(close).not.toHaveBeenCalled();
    key(document);
    expect(close).toHaveBeenCalledOnce();
  });
});
