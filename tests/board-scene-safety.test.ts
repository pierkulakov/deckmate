import { expect, it } from 'vitest';
import { boardVideoAddress, isSafeBoardEmbed, isSafeBoardLink, maximumBoardBytes, sanitizeBoardScene } from '../src/board-scene-safety.ts';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhVEAAAAASUVORK5CYII=';
const scene = (elements: Record<string, unknown>[] = [], files = {}, appState = {}) => ({ type: 'excalidraw', version: 2, elements, files, appState });

it('drops generated HTML, magic frames and unknown future types, including deleted nodes; never mutates input', () => {
  const input = scene([
    { id: 'html', type: 'iframe', customData: { generationData: { status: 'done', html: '<script>fetch("https://evil.test")</script>' } } },
    { id: 'deleted-html', type: 'iframe', isDeleted: true },
    { id: 'magic', type: 'magicframe' }, { id: 'future', type: 'future-active-element' },
    { id: 'safe', type: 'rectangle', customData: { generationData: { status: 'done', html: '<script />' }, deckmateCardId: 'card:one', opaque: 42 } },
  ]);
  const original = JSON.stringify(input);
  const safe = sanitizeBoardScene(input);
  expect(safe.scene.elements).toEqual([{ id: 'safe', type: 'rectangle', customData: { deckmateCardId: 'card:one', opaque: 42 } }]);
  expect(safe.issues).toEqual(['html', 'unsupported', 'generation']);
  expect(JSON.stringify(input)).toBe(original);
  for (const type of ['iframe', 'magicframe', 'future-active-element']) {
    expect(() => sanitizeBoardScene(scene([{ id: 'bad', type }]), 'write')).toThrow('rejected');
  }
});

it('preserves reviewed drawing types and flat nested groups/frames while removing references to generated children', () => {
  const types = ['rectangle', 'diamond', 'ellipse', 'line', 'arrow', 'freedraw', 'text', 'image', 'frame'];
  const elements = types.map(type => ({ id: type, type }));
  const input = scene([...elements,
    { id: 'nested-frame', type: 'frame', frameId: 'frame', groupIds: ['inner', 'outer'], boundElements: [{ id: 'html', type: 'text' }, { id: 'text', type: 'text' }] },
    { id: 'html', type: 'iframe', frameId: 'nested-frame', groupIds: ['inner', 'outer'] },
    { id: 'survivor', type: 'arrow', frameId: 'html', startBinding: { elementId: 'html' }, endBinding: { elementId: 'rectangle' } },
  ]);
  const safe = sanitizeBoardScene(input).scene;
  expect(safe.elements.slice(0, types.length)).toEqual(elements);
  expect(safe.elements.at(-2)).toMatchObject({ frameId: 'frame', groupIds: ['inner', 'outer'], boundElements: [{ id: 'text', type: 'text' }] });
  expect(safe.elements.at(-1)).toMatchObject({ frameId: null, startBinding: null, endBinding: { elementId: 'rectangle' } });
  expect(safe.elements.some(element => element.type === 'iframe')).toBe(false);
});

it.each(['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script/>', 'vbscript:msgbox(1)', 'file:///C:/secret', '//evil.test/path', '/\\evil.test/path', 'https://user:pass@evil.test', 'blob:https://evil.test/id'])('removes dangerous links: %s', link => {
  expect(isSafeBoardLink(link)).toBe(false);
  expect(sanitizeBoardScene(scene([{ id: 'a', type: 'text', link }])).scene.elements[0].link).toBeNull();
});
it.each(['https://example.test/path', 'http://example.test', 'mailto:hello@example.test', '/r/c-abc?source=sandbox', '/?view=deck&card=card:abc', 'deckmate://card/abc', 'freetion://smart/deck', '#element=abc'])('preserves non-executable links: %s', link => {
  expect(isSafeBoardLink(link)).toBe(true);
});

it.each(['http://youtube.com/watch?v=example', 'https://youtube.com.evil.test/watch?v=example', 'https://youtube.com:443@evil.test/watch?v=example', 'https://youtube.com/watch?v=example@evil.test', 'https://evil.test/?youtube.com/watch?v=example', 'https://youtube.com/redirect?url=https://x.com/a/status/123', 'javascript:alert(1)', '/r/../../api/snapshot', 'deckmate://arbitrary/abc'])('does not accept an unsafe or unreviewed embed: %s', link => {
  expect(isSafeBoardEmbed(link)).toBe(false);
  expect(sanitizeBoardScene(scene([{ id: 'a', type: 'embeddable', link }])).scene.elements).toEqual([]);
});
it('keeps project/video embeds and canonicalizes shorthand and provider-confusing queries', () => {
  for (const link of ['/r/c-abc?source=live', 'deckmate://card/abc', 'freetion://smart/production', 'https://youtube.com/watch?v=example', 'https://youtu.be/example']) {
    expect(isSafeBoardEmbed(link)).toBe(true);
    expect(sanitizeBoardScene(scene([{ id: 'a', type: 'embeddable', link }])).scene.elements[0].link).toBe(link);
  }
  expect(boardVideoAddress('youtu.be/example')).toBe('https://youtu.be/example');
  const link = 'https://m.youtube.com/watch?v=example&url=https://x.com/a/status/123#https://reddit.com/r/a/comments/123/title';
  expect(isSafeBoardEmbed(link)).toBe(false);
  expect(sanitizeBoardScene(scene([{ id: 'a', type: 'embeddable', link }])).scene.elements[0].link).toBe('https://www.youtube.com/watch?v=example');
});

it('filters SVG, HTML, remote and MIME-confused files and allows only bounded inline raster data', () => {
  const good = { mimeType: 'image/png', dataURL: `data:image/png;base64,${png}` };
  const input = scene([], {
    good,
    svg: { mimeType: 'image/svg+xml', dataURL: 'data:image/svg+xml,<svg onload="alert(1)"/>' },
    html: { mimeType: 'text/html', dataURL: 'data:text/html,<script />' },
    mismatch: { mimeType: 'image/png', dataURL: 'data:text/html;base64,PHNjcmlwdCAvPg==' },
    remote: { mimeType: 'image/png', dataURL: 'https://evil.test/image.png' },
    huge: { mimeType: 'image/png', dataURL: 'data:image/png;base64,' + 'a'.repeat(7 * 1024 * 1024) },
  });
  expect(sanitizeBoardScene(input).scene.files).toEqual({ good });
  expect(sanitizeBoardScene(input).issues).toContain('files');
});

it('only restores board appearance, grid and access, never editor tools, dialogs, collaborators or AI state', () => {
  const state = { viewBackgroundColor: '#ffffff', gridSize: 20, gridStep: 5, gridModeEnabled: true, deckmateAccess: 'locked', freetionAccess: 'readonly' };
  expect(sanitizeBoardScene(scene([], {}, { ...state, zoom: { value: 1e9 }, viewModeEnabled: false, activeTool: { type: 'magicframe' }, openDialog: { name: 'generate' }, openSidebar: { name: 'library' }, collaborators: {}, activeEmbeddable: { element: { type: 'iframe' } } })).scene.appState).toEqual(state);
});

it('bounds raw scene bytes, element counts, geometry, text, groups and total drawing points', () => {
  expect(() => sanitizeBoardScene(scene(Array.from({ length: 5001 }, (_, id) => ({ id: String(id), type: 'text' }))))).toThrow('limit');
  expect(() => sanitizeBoardScene({ ...scene(), opaque: 'я'.repeat(maximumBoardBytes / 2) })).toThrow('limit');
  for (const extra of [{ width: Infinity }, { x: 1e20 }, { text: 'x'.repeat(100001) }, { groupIds: Array(101).fill('group') }, { points: [[Infinity, 0]] }, { points: Array(100001).fill([0, 0]) }]) {
    expect(() => sanitizeBoardScene(scene([{ id: 'a', type: 'freedraw', ...extra }]))).toThrow('limit');
  }
  expect(() => sanitizeBoardScene(scene([{ id: 'a', type: 'line', points: Array(60000).fill([0, 0]) }, { id: 'b', type: 'line', points: Array(60000).fill([0, 0]) }]))).toThrow('limit');
});
