import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();

// 2026-11-10: the Foil Rule (DESIGN.md Controls) avoids glass capsules, blinking hover transitions and focus rings after mouse use.
// Real input over CDP:
// a hover is a pointer move, a click is a press and release, Tab is a key event.
describe.skipIf(!browserPath)('hairline controls and keyboard-only focus (browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }

  async function open(theme: 'dark' | 'light' = 'dark') {
    await page.send('Page.navigate', { url: browserFixtureUrl('controls') + '?instance=' + Math.random() });
    await until('Boolean(window.controlsTest)');
    await page.evaluate(`controlsTest.render(${JSON.stringify({ theme })})`);
    await until(`Boolean(document.querySelector('#close'))`);
    await page.evaluate('document.fonts.ready');
  }

  async function center(selector: string) {
    return page.evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as Promise<{ x: number; y: number }>;
  }

  async function hover(selector: string) {
    const point = await center(selector);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0 });
  }

  async function click(selector: string) {
    const point = await center(selector);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0 });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await delay(50);
  }

  async function press(key: 'Tab' | 'Enter' | 'Escape', shift = false) {
    const codes = { Tab: 9, Enter: 13, Escape: 27 };
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    }
    await delay(50);
  }

  /** The focused element, whether it shows the keyboard ring, and how many rings or field edges mark it. */
  function focusState() {
    return page.evaluate(`(() => {
      const el = document.activeElement;
      const ringed = [...document.querySelectorAll('*')].filter(node => { const s = getComputedStyle(node); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0; });
      const s = getComputedStyle(el);
      return { id: el.id, visible: el.matches(':focus-visible'), rings: ringed.map(node => node.id || node.tagName),
        outline: [s.outlineStyle, s.outlineWidth, s.outlineOffset] };
    })()`) as Promise<{ id: string; visible: boolean; rings: string[]; outline: string[] }>;
  }

  function styleOf(selector: string) {
    return page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const probe = document.createElement('div');
      document.body.append(probe);
      const token = name => { probe.style.color = name; return getComputedStyle(probe).color; };
      const s = getComputedStyle(el);
      const result = { radius: s.borderTopLeftRadius, borderWidth: parseFloat(s.borderTopWidth), borderStyle: s.borderTopStyle,
        borderColor: s.borderTopColor, face: s.backgroundColor, image: s.backgroundImage, ink: s.color, weight: s.fontWeight,
        shadow: s.boxShadow, line: token('var(--control-line)'), hover: token('var(--hover)'), fill: token('var(--violet-fill)'),
        mark: token('var(--mark)'), markTint: token('var(--mark-tint)'),
        fillInk: token('var(--violet-fill-ink)'), focus: token('var(--focus)'), fieldLine: token('var(--control-field-line)'),
        field: token('var(--control-field)'), danger: token('var(--danger)') };
      probe.remove();
      return result;
    })()`) as Promise<Record<string, any>>;
  }

  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 900, height: 700, scale: 1 });
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it('draws every control as a 2px hairline rectangle with a flat face, in both themes (the Foil Rule)', async () => {
    for (const theme of ['dark', 'light'] as const) {
      await open(theme);
      for (const selector of ['#outline', '#button-outline']) {
        const style = await styleOf(selector);
        expect(style.radius).toBe('2px');
        expect(style.borderStyle).toBe('solid');
        expect(style.borderWidth).toBeGreaterThan(0);
        expect(style.borderWidth).toBeLessThanOrEqual(1);
        expect(style.borderColor).toBe(style.line);
        expect(style.face).toBe('rgba(0, 0, 0, 0)');
        expect(style.image).toBe('none');
        expect(style.weight).toBe('500');
      }
      const pressed = await styleOf('#pressed');
      // Chosen is the mark — its hairline and label over its tint — never a filled pill.
      expect([pressed.face, pressed.ink, pressed.borderColor, pressed.radius]).toEqual([pressed.markTint, pressed.mark, pressed.mark, '2px']);
      const ghost = await styleOf('#ghost');
      expect([ghost.borderColor, ghost.face, ghost.radius]).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)', '2px']);
      const danger = await styleOf('#danger');
      expect(danger.ink).toBe(danger.danger);
      await delay(200);
    const field = await styleOf('#search');
      expect([field.radius, field.borderColor, field.face, field.image]).toEqual(['2px', field.fieldLine, field.field, 'none']);
      const select = await styleOf('#select');
      expect([select.radius, select.borderColor]).toEqual(['2px', select.fieldLine]);
      const segmented = await styleOf('#segmented');
      expect([segmented.radius, segmented.borderColor]).toEqual(['2px', segmented.line]);
      const chosen = await styleOf('#segmented [aria-checked="true"]');
      expect([chosen.face, chosen.ink]).toEqual([chosen.markTint, chosen.mark]);
      const tab = await styleOf('#tab-due');
      expect([tab.radius, tab.face, tab.weight]).toEqual(['0px', 'rgba(0, 0, 0, 0)', '600']);
      expect(tab.shadow).toContain('inset');
      expect(tab.shadow).toContain('-2px');
      for (const selector of ['#mint', '#button-default']) expect((await styleOf(selector)).radius).toBe('2px');
      // Creating is a mint line round a mint label, with no face.
      expect((await styleOf('#mint')).face).toBe('rgba(0, 0, 0, 0)');
      // No capsule and no glass face anywhere in the gallery.
      const shapes = await page.evaluate(`[...document.querySelectorAll('button, input, select, label')].map(el => {
        const s = getComputedStyle(el); return [el.id || el.tagName, parseFloat(s.borderTopLeftRadius), s.backgroundImage]; })`) as [string, number, string][];
      for (const [id, radius, image] of shapes) {
        expect(radius, id).toBeLessThanOrEqual(2);
        expect(image, id).toBe('none');
      }
    }
  });

  it('eases the hover in flat colours only, so it never blinks', async () => {
    await open('dark');
    await hover('#first');
    await delay(200);
    // Sample every frame from just before the pointer arrives until the transition has settled.
    const start = await page.evaluate(`(() => { window.__frames = []; const el = document.querySelector('#button-outline');
      const loop = () => { const s = getComputedStyle(el); window.__frames.push([s.backgroundColor, s.backgroundImage]);
        if (window.__frames.length < 40) requestAnimationFrame(loop); };
      requestAnimationFrame(loop); return true; })()`);
    expect(start).toBe(true);
    await hover('#button-outline');
    await until('window.__frames.length >= 40');
    const frames = await page.evaluate('window.__frames') as [string, string][];
    const style = await styleOf('#button-outline');
    expect(frames.every(([, image]) => image === 'none')).toBe(true);
    const alpha = (color: string) => { const match = color.match(/rgba?\(([^)]+)\)/); const parts = match ? match[1].split(',').map(Number) : [0, 0, 0, 0]; return parts.length === 4 ? parts[3] : 1; };
    const alphas = frames.map(([color]) => alpha(color));
    // From transparent to the hover fill without a frame that drops back.
    for (let index = 1; index < alphas.length; index += 1) expect(alphas[index]).toBeGreaterThanOrEqual(alphas[index - 1]);
    expect(frames.at(-1)![0]).toBe(style.hover);
    // A disabled control ignores the pointer.
    await hover('#button-disabled');
    await delay(200);
    expect((await styleOf('#button-disabled')).face).toBe('rgba(0, 0, 0, 0)');
  });

  it('shows no ring after a click, a tap or a focus moved by script after either', async () => {
    await open('dark');
    await click('#outline');
    expect(await focusState()).toMatchObject({ id: 'outline', visible: false, rings: [] });
    await click('#pressed');
    expect(await focusState()).toMatchObject({ id: 'pressed', visible: false, rings: [] });
    // × returns focus to the opener by script: still no ring.
    await click('#close');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: false, rings: [] });
    // The keyboard first rings a control; a click on an area that keeps focus then moves it by script — no ring.
    await page.evaluate(`document.querySelector('#first').focus()`);
    await press('Tab');
    expect((await focusState()).visible).toBe(true);
    await click('#surface');
    expect(await focusState()).toMatchObject({ id: 'target', visible: false, rings: [] });
    // A click into a search box marks its edge, never a ring round it.
    await click('#search-input');
    await delay(200);
    const field = await styleOf('#search');
    expect(await focusState()).toMatchObject({ id: 'search-input', rings: [] });
    expect(field.borderColor).toBe(field.focus);
    // A tap behaves like a click.
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const point = await center('#close');
    await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await delay(100);
    expect(await focusState()).toMatchObject({ id: 'opener', visible: false, rings: [] });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  });

  it('gives keyboard focus exactly one indicator: the 2px ring 2px off, or a field’s own edge', async () => {
    await open('light');
    await page.evaluate(`document.querySelector('#first').focus()`);
    await press('Tab');
    let state = await focusState();
    expect(state).toMatchObject({ id: 'outline', visible: true, rings: ['outline'] });
    expect(state.outline).toEqual(['solid', '2px', '2px']);
    // A pressed control reached by keyboard keeps the ring: the fill says what is chosen, the ring where the keyboard is.
    await press('Tab');
    expect(await focusState()).toMatchObject({ id: 'pressed', visible: true, rings: ['pressed'] });
    // Enter on × returns focus by script, and now the keyboard is in use, so the opener rings.
    await page.evaluate(`document.querySelector('#target').focus()`);
    await press('Tab');
    expect((await focusState()).id).toBe('close');
    await press('Enter');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: true, rings: ['opener'] });
    // After a click, Escape handled on window still counts as the keyboard: the opener rings.
    await click('#outline');
    expect((await focusState()).visible).toBe(false);
    await press('Escape');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: true, rings: ['opener'] });
    // A text field is marked by its edge and the caret only.
    await page.evaluate(`document.querySelector('#button-disabled').previousElementSibling.focus()`);
    await press('Tab');
    state = await focusState();
    expect(state).toMatchObject({ id: 'search-input', rings: [] });
    await delay(200);
    const field = await styleOf('#search');
    expect(field.borderColor).toBe(field.focus);
    expect(field.shadow).toContain('inset');
    // Tabs: the selected tab carries its underline and, under the keyboard, the ring.
    await page.evaluate(`document.querySelector('#segmented [aria-checked="false"]').focus()`);
    await press('Tab');
    expect(await focusState()).toMatchObject({ id: 'tab-due', visible: true, rings: ['tab-due'] });
  });
});
