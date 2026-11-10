import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WarmupQueue, WarmupTask } from '../client/first-screen-warmup.ts';
import { warmInterfaceFonts, warmVisibleImages } from '../client/warmup-assets.ts';

afterEach(() => vi.unstubAllGlobals());
function collection() {
  const tasks: WarmupTask[] = [];
  const queue = { add: (task: WarmupTask) => { tasks.push(task); } } as unknown as WarmupQueue;
  return { queue, tasks };
}

describe('idle interface assets', () => {
  it('loads all UI font faces, including the Cyrillic subsets and editor before section chunks', async () => {
    const { queue, tasks } = collection(); const load = vi.fn(async () => []);
    vi.stubGlobal('document', { fonts: { load } }); warmInterfaceFonts(queue);
    for (const task of tasks) await task.run(new AbortController().signal);
    expect(tasks).toHaveLength(9); expect(tasks.every(task => task.priority === 0)).toBe(true);
    expect(load).toHaveBeenCalledWith('500 14px "Geist Mono"', '0123456789');
    expect(load).toHaveBeenCalledWith('400 14px "Roboto Mono Variable"', 'Markdown Карточка');
    expect(load).toHaveBeenCalledWith('700 14px "Source Sans 3"', 'Deckmate Карточка');
  });

  it('decodes visible and nearby same-origin images once, without requesting distant or external assets', async () => {
    const { queue, tasks } = collection();
    const image = (src: string, top: number) => ({ src, currentSrc: '', decoding: 'auto', isConnected: true,
      decode: vi.fn(async () => {}), getBoundingClientRect: () => ({ width: 165, height: 225, top, bottom: top + 225 }) });
    const first = image('http://127.0.0.1:4317/cover.webp', 100);
    const duplicate = image(first.src, 300); const nearby = image('http://127.0.0.1:4317/near.webp', 900);
    const distant = image('http://127.0.0.1:4317/far.webp', 3000); const external = image('https://example.com/image.webp', 100);
    vi.stubGlobal('document', { images: [first, duplicate, nearby, distant, external] });
    vi.stubGlobal('location', new URL('http://127.0.0.1:4317/')); vi.stubGlobal('innerHeight', 800);
    warmVisibleImages(queue); expect(tasks).toHaveLength(2);
    for (const task of tasks) await task.run(new AbortController().signal);
    expect(first.decode).toHaveBeenCalledOnce(); expect(first.decoding).toBe('async'); expect(nearby.decode).toHaveBeenCalledOnce();
    for (const skipped of [duplicate, distant, external]) expect(skipped.decode).not.toHaveBeenCalled();
  });

  it('does not decode an aborted or removed image', async () => {
    const { queue, tasks } = collection(); const decode = vi.fn();
    const image = { src: 'http://127.0.0.1:4317/cover.webp', currentSrc: '', isConnected: true, decode,
      getBoundingClientRect: () => ({ width: 165, height: 225, top: 0, bottom: 225 }) };
    vi.stubGlobal('document', { images: [image] }); vi.stubGlobal('location', new URL('http://127.0.0.1:4317/')); vi.stubGlobal('innerHeight', 800);
    warmVisibleImages(queue); const controller = new AbortController(); controller.abort();
    await tasks[0].run(controller.signal); image.isConnected = false; await tasks[0].run(new AbortController().signal);
    expect(decode).not.toHaveBeenCalled();
  });
});
