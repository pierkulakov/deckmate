import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();

// 2026-11-10: the three small dialogs (Members editor, Quick capture, Shortcuts help) must wear the shared dialog
// grammar from client/surface.css, in both themes, without overflow at 375px — the release reads as one product.
describe.skipIf(!browserPath)('small dialogs share the Decks-home dialog grammar (browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const panels = { members: '.members-editor', quick: '.quick-capture-panel', shortcuts: '.shortcuts-panel' } as const;
  type Scene = keyof typeof panels;

  async function until(expression: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }

  async function open(scene: Scene, options: Record<string, unknown> = {}, width = 1280) {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: width === 375 ? 812 : 800, deviceScaleFactor: 1, mobile: false });
    await page.send('Page.navigate', { url: browserFixtureUrl('small-dialogs') + '?instance=' + Math.random() });
    await until('Boolean(window.smallDialogsTest)');
    await page.evaluate(`smallDialogsTest.render(${JSON.stringify(scene)}, ${JSON.stringify(options)})`);
    await page.evaluate('document.fonts.ready');
    if (scene === 'quick') {
      await page.evaluate(`document.querySelector('.quick-capture-trigger').click()`);
      await until(`Boolean(document.querySelector('.quick-capture-panel'))`);
    } else if (scene === 'shortcuts') {
      await page.evaluate(`document.querySelector('.shortcuts-help-trigger').click()`);
      await until(`Boolean(document.querySelector('.shortcuts-panel'))`);
    } else {
      await until(`Boolean(document.querySelector('.members-editor-list'))`);
    }
    // Let the entrance spring finish before measuring boxes.
    await delay(420);
  }

  /** Resolves a CSS custom property to a computed color by probing an element that uses it. */
  function measure(panel: string, expression: string) {
    return page.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(panel)});
      const probe = document.createElement('div');
      document.body.append(probe);
      const token = name => { probe.style.background = name; return getComputedStyle(probe).backgroundColor; };
      const style = getComputedStyle(el);
      const title = el.querySelector('.dialog-title');
      const close = el.querySelector('.dialog-head button');
      const head = el.querySelector('.dialog-head');
      const foot = el.querySelector('.dialog-foot');
      const footChildren = foot ? [...foot.children] : [];
      const footRect = foot?.getBoundingClientRect();
      const lastChild = footChildren.at(-1);
      const lastRect = lastChild?.getBoundingClientRect();
      const result = { radius: style.borderTopLeftRadius, borderWidth: style.borderTopWidth, borderStyle: style.borderTopStyle,
        borderColor: style.borderTopColor, lineToken: token('var(--line)'), surface: style.backgroundColor, surfaceToken: token('var(--surface)'),
        // 2026-11-10: the Foil Rule — dialog corners follow the 4px --glass-radius (was 12px), probed as a computed value.
        radiusToken: (() => { const corner = document.createElement('i'); corner.style.borderRadius = 'var(--glass-radius)';
          document.body.append(corner); const value = getComputedStyle(corner).borderRadius; corner.remove(); return value; })(),
        shadow: style.boxShadow !== 'none',
        title: title ? [getComputedStyle(title).fontSize, getComputedStyle(title).fontWeight, getComputedStyle(title).lineHeight] : null,
        close: close ? [close.getBoundingClientRect().width, close.getBoundingClientRect().height] : null,
        headLine: head ? getComputedStyle(head).borderBottomWidth : null,
        foot: !foot || !footRect || !lastRect ? null : {
          lastIsPrimaryButton: lastChild.tagName === 'BUTTON' && !String(lastChild.className).includes('button-ghost'),
          lastRightOffset: Math.round(footRect.right - lastRect.right),
          firstLeftOffset: Math.round(footChildren[0].getBoundingClientRect().left - footRect.left),
        } };
      ${expression ? `Object.assign(result, ${expression});` : ''}
      probe.remove();
      return result;
    })()`);
  }

  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1280, height: 800, scale: 1 });
  }, 60000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each(['members', 'quick', 'shortcuts'] as const)('%s dialog wears the shared frame in both themes', async scene => {
    for (const theme of ['dark', 'light']) {
      await open(scene, { theme });
      const frame = await measure(panels[scene], '');
      expect(frame.radius).toBe(frame.radiusToken);
      expect(frame.borderWidth).toBe('1px');
      expect(frame.borderStyle).toBe('solid');
      expect(frame.borderColor).toBe(frame.lineToken);
      expect(frame.surface).toBe(frame.surfaceToken);
      expect(frame.shadow).toBe(true);
      // 2026-11-10: the Foil Rule — the dialog title is 18/600 (was 18/700).
      expect(frame.title).toEqual(['18px', '600', '24px']);
      expect(frame.close).toEqual([32, 32]);
      expect(frame.headLine).toBe('1px');
      if (scene !== 'shortcuts') {
        // Actions sit at the end of the footer row, the primary last; the hint keeps the row's start.
        expect(frame.foot.lastIsPrimaryButton).toBe(true);
        expect(Math.abs(frame.foot.lastRightOffset - 16)).toBeLessThanOrEqual(1);
        expect(Math.abs(frame.foot.firstLeftOffset - 16)).toBeLessThanOrEqual(1);
      }
    }
  });

  it.each(['members', 'quick', 'shortcuts'] as const)('%s dialog fits 375px in both themes and languages', async scene => {
    for (const theme of ['dark', 'light']) for (const lang of ['en', 'ru']) {
      await open(scene, { theme, lang }, 375);
      const fit = await page.evaluate(`(() => {
        const el = document.querySelector(${JSON.stringify(panels[scene])});
        const rect = el.getBoundingClientRect();
        return { pageScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panel: [Math.round(rect.left), Math.round(rect.right)],
          panelScroll: el.scrollWidth - el.clientWidth,
          bodyScroll: document.body.scrollWidth - document.body.clientWidth };
      })()`);
      expect(fit.pageScroll).toBeLessThanOrEqual(0);
      expect(fit.bodyScroll).toBeLessThanOrEqual(0);
      expect(fit.panelScroll).toBeLessThanOrEqual(0);
      expect(fit.panel[0]).toBeGreaterThanOrEqual(0);
      expect(fit.panel[1]).toBeLessThanOrEqual(375);
    }
  });

  it('members editor keeps the counter and recessed fields', async () => {
    await open('members');
    const details = await measure(panels.members, `{
      counter: (() => { const n = el.querySelector('.members-editor-hint .page-number'); const s = getComputedStyle(n);
        return [s.fontFamily, s.fontVariantNumeric, /^\\d+ \\/ 100$/.test(n.textContent)]; })(),
      fields: (() => { const input = el.querySelector('.members-editor-field input'); const s = getComputedStyle(input);
        const probe = document.createElement('span'); probe.style.background = 'var(--control-field)'; el.appendChild(probe);
        const well = getComputedStyle(probe).backgroundColor;
        probe.style.borderRadius = 'var(--control-radius)'; const radius = getComputedStyle(probe).borderRadius; probe.remove();
        return [parseFloat(s.borderTopWidth), s.borderTopLeftRadius, s.backgroundImage, s.backgroundColor === well, radius]; })(),
      focusInside: Boolean(document.activeElement?.closest('.members-editor')),
    }`);
    expect(details.counter[0]).toContain('Geist Mono');
    expect(details.counter[1]).toBe('tabular-nums');
    expect(details.counter[2]).toBe(true);
    expect(details.fields[0]).toBeGreaterThan(0);
    // 2026-11-10: the Foil Rule — recessed fields are 2px (--control-radius) rectangles (was 4px), probed as a token.
    expect(details.fields.slice(1)).toEqual([details.fields[4], 'none', true, details.fields[4]]);
    expect(details.focusInside).toBe(true);
  });

  it('quick capture keeps Enter-to-save and shows the saved state with the primary action last', async () => {
    await open('quick', { lang: 'ru' });
    await page.evaluate(`(() => {
      const field = document.querySelector('.quick-capture-input'); field.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'Проверка быстрой записи');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    })()`);
    await until(`Boolean(document.querySelector('.quick-capture-saved'))`);
    expect(await page.evaluate(`smallDialogsTest.actions`)).toEqual([expect.objectContaining({ action: 'create-card', title: 'Проверка быстрой записи' })]);
    const saved = await page.evaluate(`(() => {
      const foot = document.querySelector('.quick-capture-footer');
      const last = foot.lastElementChild;
      return [foot.children.length, last.textContent.trim(), !String(last.className).includes('button-ghost'),
        document.querySelector('.quick-capture-saved-text').textContent.includes('Проверка быстрой записи')];
    })()`);
    expect(saved).toEqual([2, 'Открыть', true, true]);
  });

  it('shortcuts help keeps the scrim overlay, panel sections and the Escape close', async () => {
    await open('shortcuts');
    const details = await measure(panels.shortcuts, `{
      overlay: (() => { const scrim = token('var(--scrim)');
        return getComputedStyle(document.querySelector('.shortcuts-panel-overlay')).backgroundColor === scrim ? scrim : 'mismatch'; })(),
      groups: [...el.querySelectorAll('.shortcuts-panel-group .panel-title')].map(title => {
        const s = getComputedStyle(title); return s.fontSize + '/' + s.fontWeight;
      }),
      labels: el.querySelectorAll('.shortcuts-panel-label').length,
      keycaps: getComputedStyle(el.querySelector('.shortcuts-panel-key')).textTransform,
    }`);
    expect(details.overlay).not.toBe('mismatch');
    expect(details.overlay).not.toBe('rgba(0, 0, 0, 0)');
    // 2026-11-10: the Foil Rule — panel group titles are 15/600 (was 17/600).
    expect(new Set(details.groups)).toEqual(new Set(['15px/600']));
    expect(details.labels).toBeGreaterThan(3);
    expect(details.keycaps).toBe('uppercase');
    for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await until(`!document.querySelector('.shortcuts-panel')`);
  });
});
