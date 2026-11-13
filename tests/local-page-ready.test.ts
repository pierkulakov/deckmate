import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

const source = readFileSync(new URL('../client/desktop/page-ready.js', import.meta.url), 'utf8');

it('reveals one completed frame only after fonts and visible CSS images settle, including decode failures', async () => {
  let fontsReady!: () => void;
  let imageReady!: () => void;
  const fonts = new Promise<void>(resolve => { fontsReady = resolve; });
  const image = new Promise<void>(resolve => { imageReady = resolve; });
  const decoded: string[] = [];
  const marks: string[] = [];
  let hidden = false;
  const window: { prepareDeckmatePage?: () => Promise<void>; deckmatePageReady?: Promise<boolean> } = {};
  runInNewContext(source, {
    window,
    document: {
      documentElement: { setAttribute() { hidden = true; }, removeAttribute() { hidden = false; } },
      body: { getBoundingClientRect() {} }, fonts: [{ status: 'loading', loaded: fonts }],
      querySelectorAll: () => ['a', 'a', 'broken', 'hidden'].map(src => ({ src, getClientRects: () => src === 'hidden' ? [] : [{}] })),
    },
    getComputedStyle: (element: { src: string }) => ({ backgroundImage: `url("${element.src}")` }),
    Image: class {
      src = '';
      decode() { decoded.push(this.src); return this.src === 'broken' ? Promise.reject(new Error('decode')) : image; }
    },
    performance: { mark: (name: string) => marks.push(name) },
  });
  expect(hidden).toBe(true);
  const ready = window.prepareDeckmatePage!();
  expect(window.prepareDeckmatePage!()).toBe(ready);
  expect(decoded).toEqual(['a', 'broken']);
  fontsReady();
  await Promise.resolve();
  expect(hidden).toBe(true);
  imageReady();
  await new Promise(resolve => setImmediate(resolve));
  expect(hidden).toBe(false);
  await ready;
  expect(await window.deckmatePageReady).toBe(true);
  expect(marks).toEqual(['deckmate-local-page-prepared']);
});
