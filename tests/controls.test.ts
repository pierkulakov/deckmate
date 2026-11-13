import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl, desktopFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';
import { contrastRatio } from '../client/color-contrast.ts';

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
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, buttons: 0 });
    await page.evaluate(`window.previousControl = document.querySelector('#close'); controlsTest.render(${JSON.stringify({ theme })})`);
    await until(`Boolean(document.querySelector('#close') && document.querySelector('#close') !== window.previousControl)`);
    await page.evaluate('window.scrollTo(0, 0); document.fonts.ready');
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
  }

  async function press(key: 'Tab' | 'Enter' | 'Escape', shift = false) {
    const codes = { Tab: 9, Enter: 13, Escape: 27 };
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined });
    }
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
    await page.send('Page.navigate', { url: browserFixtureUrl('controls') });
    await until('Boolean(window.controlsTest)');
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

  it('keeps shared field placeholders opaque and readable, including Vision search and URL', async () => {
    for (const theme of ['light', 'dark'] as const) {
      await open(theme);
      const fields = await page.evaluate(`(() => {
        const probe = document.createElement('span'); document.body.append(probe);
        probe.style.color = 'var(--muted)'; const muted = getComputedStyle(probe).color;
        const rgb = color => color.match(/\\d+/g).slice(0, 3).map(Number);
        const result = ['#search-input', '#vision-search-input', '#vision-url', '#ordinary-input', '#ordinary-textarea', '#nested-textarea'].map(selector => {
          const input = document.querySelector(selector), field = input.closest('.control-field');
          const placeholder = getComputedStyle(input, '::placeholder'), style = getComputedStyle(field);
          return { selector, color: placeholder.color, opacity: placeholder.opacity, face: rgb(style.backgroundColor) };
        });
        probe.remove(); return { muted, fields: result };
      })()`) as { muted: string; fields: { selector: string; color: string; opacity: string; face: number[] }[] };
      const muted = fields.muted.match(/\d+/g)!.slice(0, 3).map(Number);
      for (const field of fields.fields) {
        expect(field.color, `${theme}: ${field.selector}`).toBe(fields.muted);
        expect(field.opacity, `${theme}: ${field.selector}`).toBe('1');
        expect(contrastRatio(muted, field.face), `${theme}: ${field.selector}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps field edges distinct from the field and surrounding surface in both themes', async () => {
    for (const theme of ['light', 'dark'] as const) {
      await open(theme);
      const colors = await page.evaluate(`(() => {
        const probe = document.createElement('span'); document.body.append(probe);
        const rgb = value => { probe.style.color = value; return getComputedStyle(probe).color.match(/\\d+/g).slice(0, 3).map(Number); };
        const result = { line: rgb('var(--control-field-line)'), ground: rgb('var(--ground)'), surface: rgb('var(--surface)') };
        probe.remove(); return result;
      })()`) as { line: number[]; ground: number[]; surface: number[] };
      for (const face of ['ground', 'surface'] as const) {
        expect(contrastRatio(colors.line, colors[face]), `${theme}: field-line/${face}`).toBeGreaterThanOrEqual(3);
      }
      for (const selector of ['#search', '.vision-search.control-field', '#vision-url', '#vision-select', '#select']) {
        const style = await styleOf(selector);
        expect(style.borderColor, `${theme}: ${selector}`).toBe(style.fieldLine);
        expect(style.face, `${theme}: ${selector}`).toBe(style.field);
      }
      await page.evaluate(`document.querySelector('.vision-search').scrollIntoView({ block: 'center' })`);
      await hover('.vision-search');
      await delay(200);
      const hovered = await styleOf('.vision-search');
      const buttonLine = await page.evaluate(`(() => { const probe = document.createElement('span'); document.body.append(probe); probe.style.color = 'var(--button-line)'; const color = getComputedStyle(probe).color; probe.remove(); return color; })()`);
      expect(hovered.borderColor, `${theme}: Vision search hover`).toBe(buttonLine);
      await click('#vision-search-input');
      await delay(200);
      const focused = await styleOf('.vision-search');
      expect(focused.borderColor, `${theme}: Vision search focus`).toBe(focused.focus);
    }
  });

  it('uses the shared help type scale for space guidance and the license footer', async () => {
    for (const theme of ['light', 'dark'] as const) {
      await open(theme);
      const styles = await page.evaluate(`['#space-help', '#license-help'].map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return [style.fontSize, style.lineHeight];
      })`);
      expect(styles).toEqual([['12px', '16px'], ['12px', '16px']]);
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

  it('clears the previous highlight immediately when moving between controls, segments and menu items', async () => {
    for (const theme of ['dark', 'light'] as const) {
      await open(theme);
      for (const [first, second] of [['#outline', '#ghost'], ['#button-outline', '#button-ghost'],
        ['#segment-a', '#segment-b'], ['#menu-a', '#menu-b']]) {
        await hover('#first');
        await until(`!document.querySelector(${JSON.stringify(first)}).matches(':hover')`);
        const idle = await styleOf(first);
        const geometry = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(first)}); const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return [r.x, r.y, r.width, r.height, s.fontWeight, s.borderTopWidth]; })()`);
        await hover(first);
        await delay(150);
        const hovered = await styleOf(first);
        expect(hovered.face, first).not.toBe(idle.face);
        await hover(second);
        await delay(45);
        const result = await page.evaluate(`(() => { const a = document.querySelector(${JSON.stringify(first)}); const b = document.querySelector(${JSON.stringify(second)}); const x = getComputedStyle(a); const y = getComputedStyle(b); const r = a.getBoundingClientRect(); return { old: x.backgroundColor, next: y.backgroundColor, oldDuration: x.transitionDuration, transition: y.transition, geometry: [r.x, r.y, r.width, r.height, x.fontWeight, x.borderTopWidth] }; })()`);
        expect(result.old, first).toBe(idle.face);
        expect(result.next, second).not.toBe(idle.face);
        expect(result.transition).toContain('0.1s');
        expect(result.transition).not.toMatch(/(?:^|,)\s*all\b/);
        expect(parseFloat(result.oldDuration)).toBe(0);
        expect(result.geometry).toEqual(geometry);
      }
      if (theme === 'light') {
        await hover('#button-default');
        await delay(150);
        expect(Number(await page.evaluate(`getComputedStyle(document.querySelector('#button-default')).opacity`))).toBeLessThan(1);
        await hover('#button-ghost');
        await delay(45);
        expect(Number(await page.evaluate(`getComputedStyle(document.querySelector('#button-default')).opacity`))).toBe(1);
      }
    }
  });

  it('keeps the delayed busy dim without delaying hover or reduced-motion changes', async () => {
    await open();
    for (const [selector, disable] of [['#button-outline', `e.disabled = true`], ['#busy-retry', `e.setAttribute('aria-disabled', 'true')`]]) {
      await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); ${disable}; })()`);
      await delay(100);
      expect(Number(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`))).toBe(1);
      await delay(450);
      expect(Number(await page.evaluate(`getComputedStyle(document.querySelector(${JSON.stringify(selector)})).opacity`))).toBeLessThan(.6);
    }
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    try {
      await hover('#segment-a');
      const duration = await page.evaluate(`getComputedStyle(document.querySelector('#segment-a')).transitionDuration`);
      expect(duration.split(',').every((value: string) => parseFloat(value) === 0)).toBe(true);
    } finally {
      await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    }
  });

  it('keeps text, status badges and keyboard focus readable on both theme surfaces', async () => {
    for (const theme of ['light', 'dark'] as const) {
      await open(theme);
      const pairs = await page.evaluate(`(() => {
        const probe = document.createElement('span'); document.body.append(probe);
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d');
        const token = name => { probe.style.color = 'var(--' + name + ')'; return getComputedStyle(probe).color; };
        const rgb = (color, background = '#fff') => {
          context.clearRect(0, 0, 1, 1); context.fillStyle = background; context.fillRect(0, 0, 1, 1);
          context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
        };
        const pairs = [];
        const add = (name, ink, face, minimum = 4.5, backing = token('canvas')) => pairs.push({ name, ink: rgb(ink), face: rgb(face, backing), minimum });
        for (const surface of ['canvas', 'surface', 'ground', 'sidebar', 'hover', 'edit-bg', 'accent-soft']) {
          for (const ink of ['ink', 'muted', 'accent', 'action-mint-ink', 'danger']) add(ink + '/' + surface, token(ink), token(surface));
          add('focus/' + surface, token('focus'), token(surface), 3);
        }
        for (const ink of ['card-ink', 'card-muted']) add(ink + '/card-face', token(ink), token('card-face'));
        for (const face of ['canvas', 'surface', 'ground']) for (const tint of ['mark-tint', 'mark-tint-strong']) {
          add('mark/' + tint + '/' + face, token('mark'), token(tint), 4.5, token(face));
        }
        for (const name of ['violet', 'danger']) add(name + '-fill', token(name + '-fill-ink'), token(name + '-fill'));
        for (const state of ['planned', 'discuss', 'iteration', 'working', 'review', 'accepted', 'cancelled']) {
          probe.className = 'status-badge status-' + state; probe.style.color = '';
          const style = getComputedStyle(probe);
          add('badge/' + state, style.color, style.backgroundColor);
        }
        probe.remove(); return pairs;
      })()`) as { name: string; ink: number[]; face: number[]; minimum: number }[];
      for (const pair of pairs) expect(contrastRatio(pair.ink, pair.face), `${theme}: ${pair.name}`).toBeGreaterThanOrEqual(pair.minimum);
    }
  });

  it('leaves aria-disabled actions at rest and keeps destructive hover in the danger role', async () => {
    for (const theme of ['light', 'dark'] as const) {
      await open(theme);
      await page.evaluate(`document.querySelector('#busy-retry').setAttribute('aria-disabled', 'true')`);
      const rest = await styleOf('#busy-retry');
      await page.evaluate(`document.querySelector('#busy-retry').scrollIntoView()`);
      await hover('#busy-retry');
      await delay(150);
      const hovered = await styleOf('#busy-retry');
      expect([hovered.face, hovered.ink, hovered.borderColor]).toEqual([rest.face, rest.ink, rest.borderColor]);
      const point = await center('#busy-retry');
      await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1 });
      expect(await page.evaluate(`getComputedStyle(document.querySelector('#busy-retry')).transform`)).toBe('none');
      await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0 });
      await page.evaluate(`document.querySelector('#button-danger').scrollIntoView()`);
      await hover('#button-danger');
      await delay(150);
      const danger = await page.evaluate(`(() => { const e = document.querySelector('#button-danger'), p = document.createElement('i'); document.body.append(p);
        p.style.background = 'color-mix(in srgb, var(--danger-fill) 88%, white)'; const face = getComputedStyle(p).backgroundColor;
        p.style.color = 'var(--danger-fill-ink)'; const ink = getComputedStyle(p).color;
        const s = getComputedStyle(e); p.remove(); return { face:s.backgroundColor, ink:s.color, expectedFace:face, expectedInk:ink }; })()`);
      expect([danger.face, danger.ink]).toEqual([danger.expectedFace, danger.expectedInk]);
    }
  });

  it('grows touch targets in layout without enlarging glyphs or retaining hover', async () => {
    await open('light');
    const glyph = await page.evaluate(`document.querySelector('#button-icon svg').getBoundingClientRect().width`);
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    try {
      expect(await page.evaluate(`matchMedia('(pointer: coarse)').matches`)).toBe(true);
      const targets = await page.evaluate(`['#outline','#button-outline','#button-small','#button-icon','#mint','#close','#tab-due','#segmented button'].map(selector => {
        const e = document.querySelector(selector), r = e.getBoundingClientRect(); return { selector, width:r.width, height:r.height };
      })`) as { selector: string; width: number; height: number }[];
      for (const target of targets) {
        expect(target.width, target.selector).toBeGreaterThanOrEqual(44);
        expect(target.height, target.selector).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(`document.querySelector('#button-icon svg').getBoundingClientRect().width`)).toBe(glyph);
      await page.evaluate(`document.querySelector('#button-default').scrollIntoView()`);
      await hover('#button-default');
      await delay(150);
      expect(Number(await page.evaluate(`getComputedStyle(document.querySelector('#button-default')).opacity`))).toBe(1);
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    }
  });

  it('fits adjacent 44px targets in a narrow toolbar and taps each without activating its neighbour', async () => {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    try {
      for (const theme of ['light', 'dark'] as const) {
        await open(theme);
        const desktop = await page.evaluate(`[...document.querySelectorAll('#touch-tools button')].map(e => e.getBoundingClientRect().width)`);
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
        await page.evaluate(`document.querySelector('#touch-tools').scrollIntoView({block:'center'})`);
        const layout = await page.evaluate(`(() => {
          const tools = document.querySelector('#touch-tools'), bounds = tools.getBoundingClientRect();
          return { right:bounds.right, targets:[...tools.querySelectorAll('button')].map(e => {
            const r=e.getBoundingClientRect(); return {id:e.id,x:r.x,y:r.y,width:r.width,height:r.height,glyph:e.querySelector('svg').getBoundingClientRect().width};
          }) };
        })()`) as { right: number; targets: { id: string; x: number; y: number; width: number; height: number; glyph: number }[] };
        expect(layout.right).toBeLessThanOrEqual(375);
        expect(layout.targets).toHaveLength(6);
        const taps: string[] = [];
        for (const [index, target] of layout.targets.entries()) {
          expect([target.width, target.height, target.glyph], target.id).toEqual([44, 44, 16]);
          expect(target.y).toBe(layout.targets[0].y);
          if (index) expect(target.x - layout.targets[index - 1].x - 44).toBe(8);
          for (const x of [target.x + 2, target.x + target.width - 2]) {
            await page.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: target.y + 22 }] });
            await page.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            taps.push(target.id.slice(6));
            await until(`document.querySelector('#touch-tools').dataset.actions === ${JSON.stringify(taps.join(','))}`);
          }
        }
        const long = await page.evaluate(`(() => { const e=document.querySelector('#long-control'),r=e.getBoundingClientRect(); return {right:r.right,height:r.height,overflow:e.scrollWidth-e.clientWidth}; })()`);
        expect(long.right).toBeLessThanOrEqual(375);
        expect(long.height).toBeGreaterThan(44);
        expect(long.overflow).toBeLessThanOrEqual(1);
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        expect(await page.evaluate(`[...document.querySelectorAll('#touch-tools button')].map(e => e.getBoundingClientRect().width)`)).toEqual(desktop);
      }
    } finally {
      await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
      await page.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    }
  });

  it('keeps inline counts flat and the filtered-state action reachable with long text at 375px', async () => {
    await open('light');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 600, deviceScaleFactor: 1, mobile: false });
    try {
      const state = await page.evaluate(`(() => {
        const count = getComputedStyle(document.querySelector('#quiet-count'));
        const empty = document.querySelector('.ui-empty-filtered');
        empty.querySelector('.ui-button').textContent = 'Сбросить очень длинный поисковый запрос и все выбранные фильтры';
        const button = empty.querySelector('.ui-button'), r = button.getBoundingClientRect(), p = empty.getBoundingClientRect();
        return { count:[count.display,count.backgroundColor,count.boxShadow,count.fontFamily], fits:r.left >= p.left && r.right <= p.right,
          overflow:button.scrollWidth - button.clientWidth, height:r.height, fontSize:getComputedStyle(button).fontSize,
          quiet:document.querySelector('.ui-empty-quiet').querySelector('.empty-art') === null };
      })()`);
      expect(state.count.slice(0, 3)).toEqual(['block', 'rgba(0, 0, 0, 0)', 'none']);
      expect(state.count[3]).toContain('Geist Mono');
      expect(state.fits).toBe(true);
      expect(state.overflow).toBeLessThanOrEqual(1);
      expect(state.height).toBeGreaterThan(30);
      expect(state.fontSize).toBe('13px');
      expect(state.quiet).toBe(true);
    } finally {
      await page.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
    }
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
    await until(`document.activeElement.id === 'opener'`);
    expect(await focusState()).toMatchObject({ id: 'opener', visible: false, rings: [] });
    await page.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  });

  it('marks Tab navigation with one inner edge and keeps Escape restoration quiet', async () => {
    await open('light');
    await page.evaluate(`document.querySelector('#first').focus()`);
    await press('Tab');
    let state = await focusState();
    expect(state).toMatchObject({ id: 'outline', visible: true, rings: ['outline'] });
    expect(state.outline).toEqual(['solid', '2px', '-2px']);
    // 2026-11-13: selection and keyboard position remain distinct without an outside contour.
    await press('Tab');
    expect(await focusState()).toMatchObject({ id: 'pressed', visible: true, rings: ['pressed'] });
    // 2026-11-13: Enter continues the navigation begun with Tab.
    await page.evaluate(`document.querySelector('#target').focus()`);
    await press('Tab');
    expect((await focusState()).id).toBe('close');
    await press('Enter');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: true, rings: ['opener'] });
    // 2026-11-13: Escape is a close shortcut, not a request to begin Tab navigation.
    await click('#outline');
    expect((await focusState()).visible).toBe(false);
    await press('Escape');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: false, rings: [] });
    await press('Tab');
    expect(await focusState()).toMatchObject({ id: 'target', visible: true, rings: ['target'], outline: ['solid', '2px', '-2px'] });
    await press('Escape');
    expect(await focusState()).toMatchObject({ id: 'opener', visible: false, rings: [] });
    // A text field is marked by its edge and the caret only.
    await page.evaluate(`document.querySelector('#button-disabled').previousElementSibling.focus()`);
    await press('Tab');
    state = await focusState();
    expect(state).toMatchObject({ id: 'search-input', rings: [] });
    await delay(200);
    const field = await styleOf('#search');
    expect(field.borderColor).toBe(field.focus);
    expect(field.shadow).toContain('inset');
    // 2026-11-13: the selected tab keeps its underline beside the shared inner edge.
    await page.evaluate(`document.querySelector('#segmented [aria-checked="false"]').focus()`);
    await press('Tab');
    expect(await focusState()).toMatchObject({ id: 'tab-due', visible: true, rings: ['tab-due'] });
  });
});

describe.skipIf(!browserPath)('launcher shared foundation (browser)', () => {
  it.each(['light', 'dark'])('%s: decodes built cover and card artwork from the computed CSS URLs', async theme => {
    const page = await openHeadlessBrowser({ width: 1280, height: 820, scale: 1 });
    try {
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-theme', '${theme}');` });
      await page.send('Page.navigate', { url: desktopFixtureUrl() });
      await page.evaluate(`new Promise(resolve => { function check() {
        if (document.querySelector('#launcher:not([aria-busy])')) resolve(true); else requestAnimationFrame(check);
      } check(); })`);
      const artwork = await page.evaluate(`Promise.all([...document.querySelectorAll('.cover-art, .fan-card')].map(async node => {
        const url = getComputedStyle(node).backgroundImage.slice(5, -2);
        const image = new Image(); image.src = url;
        const loaded = await image.decode().then(() => true, () => false);
        return { url, loaded, width: image.naturalWidth, height: image.naturalHeight };
      }))`) as { url: string; loaded: boolean; width: number; height: number }[];
      expect(artwork).toHaveLength(5);
      for (const image of artwork) {
        expect(image.loaded, image.url).toBe(true);
        expect(image.width, image.url).toBeGreaterThan(0);
        expect(image.height, image.url).toBeGreaterThan(0);
      }
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  });

  it.each(['light', 'dark'])('%s: autofocus, click and Escape are quiet; Tab and Shift+Tab mark the inner edge at 375px', async theme => {
    const page = await openHeadlessBrowser({ width: 375, height: 900, scale: 1 });
    const key = async (key: string, shift = false) => {
      for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key, code: key,
        windowsVirtualKeyCode: key === 'Tab' ? 9 : 27, modifiers: shift ? 8 : 0 });
    };
    const state = () => page.evaluate(`(() => { const el = document.activeElement, s = getComputedStyle(el);
      return { id: el.id, outline: [s.outlineStyle, s.outlineWidth, s.outlineOffset], shadow: s.boxShadow }; })()`);
    try {
      await page.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('deckmate-language', 'ru'); localStorage.setItem('deckmate-theme', '${theme}');` });
      await page.send('Page.navigate', { url: desktopFixtureUrl() });
      await page.evaluate(`new Promise(resolve => { function check() {
        if (document.activeElement?.id === 'open-folder') resolve(true); else requestAnimationFrame(check);
      } check(); })`);
      expect(await page.evaluate('document.documentElement.lang')).toBe('ru');
      expect(await state()).toMatchObject({ id: 'open-folder', shadow: 'none' });
      expect((await state()).outline[0]).toBe('none');
      await key('Tab');
      expect(await state()).toMatchObject({ id: 'create-project', outline: ['solid', '2px', '-2px'] });
      await key('Tab', true);
      expect(await state()).toMatchObject({ id: 'open-folder', outline: ['solid', '2px', '-2px'] });
      const point = await page.evaluate(`(() => { const r = document.querySelector('#create-project').getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 }; })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
      await page.evaluate(`new Promise(resolve => { function check() { if (!document.querySelector('#create-panel').hidden) resolve(true); else requestAnimationFrame(check); } check(); })`);
      expect((await state()).outline[0]).toBe('none');
      await key('Escape');
      expect(await state()).toMatchObject({ id: 'create-project', shadow: 'none' });
      expect((await state()).outline[0]).toBe('none');
      await key('Tab', true);
      expect(await state()).toMatchObject({ id: 'open-folder', outline: ['solid', '2px', '-2px'] });
      expect(page.consoleErrors).toEqual([]);
    } finally { await page.close(); }
  });
});
