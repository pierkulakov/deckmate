import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openHeadlessBrowser, type HeadlessPage } from '../tools/layout-capture.ts';
import { browserFixtureUrl } from './browser-fixture.ts';
import { requireBrowser } from './browser-environment.ts';

const browserPath = requireBrowser();
describe.skipIf(!browserPath)('Vision tab chrome (browser)', () => {
  let page: HeadlessPage;
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  async function until(expression: string) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await page.evaluate(expression)) return;
      await delay(25);
    }
    throw new Error('Timed out: ' + expression + '\n' + page.consoleErrors.join('\n'));
  }
  async function open(theme: 'dark' | 'light') {
    await page.send('Page.navigate', { url: `${browserFixtureUrl('vision-chrome')}?theme=${theme}&instance=${Math.random()}` });
    await until(`Boolean(document.querySelector('.vision-canvas .excalidraw')) && document.querySelector('.vision-save-state').textContent === 'Saved'`);
  }
  beforeAll(async () => {
    page = await openHeadlessBrowser({ width: 1440, height: 900, scale: 1 });
  }, 90000);
  afterAll(async () => { await page?.close(); }, 20000);

  it.each(['dark', 'light'] as const)('builds the toolbar and sidebar from the shared surface grammar in the %s theme', async theme => {
    await open(theme);
    expect(await page.evaluate(`document.querySelector('.vision-workspace').className`)).toBe('vision-workspace page-light');
    expect(await page.evaluate(`document.querySelector('.vision-toolbar').className`)).toBe('vision-toolbar page-head');
    const measured = await page.evaluate(`(() => {
      const name = getComputedStyle(document.querySelector('.vision-board-name'));
      const picker = getComputedStyle(document.querySelector('.vision-board-picker'));
      // 2026-11-10: the sidebar is one glass sheet (4px --glass-radius) whose panels are sections split by seams.
      const sheet = getComputedStyle(document.querySelector('.vision-stack.glass-sheet'));
      const sections = [...document.querySelectorAll('.vision-stack > .glass-panel')].map(node => getComputedStyle(node));
      const title = getComputedStyle(document.querySelector('.panel-title'));
      const radiusProbe = document.createElement('i'); document.body.append(radiusProbe);
      radiusProbe.style.borderRadius = 'var(--control-radius)'; const controlRadius = getComputedStyle(radiusProbe).borderRadius;
      radiusProbe.style.borderRadius = 'var(--glass-radius)'; const glassRadius = getComputedStyle(radiusProbe).borderRadius;
      radiusProbe.remove();
      return { name: name.fontSize + '/' + name.fontWeight, nameColor: name.color, picker: picker.borderRadius + '/' + picker.height,
        panel: sheet.borderRadius, sections: sections.map(style => style.borderRadius + '/' + style.borderTopWidth), panelTitle: title.fontSize + '/' + title.fontWeight,
        caption: document.querySelector('.page-caption').textContent.trim(), access: Boolean(document.querySelector('.vision-access')),
        controlRadius, glassRadius };
    })()`);
    // 2026-11-10: the Foil Rule — page title 26/600 (was 26/700), controls 2px --control-radius, glass 4px --glass-radius.
    expect(measured.name).toBe('26px/600');
    expect(measured.picker).toBe(`${measured.controlRadius}/30px`);
    expect(measured.panel).toBe(measured.glassRadius);
    expect(measured.sections[0]).toBe('0px/0px');
    expect(measured.sections.slice(1).every((value: string) => value === '0px/1px')).toBe(true);
    // 2026-11-10: vision panels keep their own 17/600 panel title (client/vision.css overrides the shared 15/600).
    expect(measured.panelTitle).toBe('17px/600');
    expect(measured.caption).toContain('Saved');
    expect(measured.access).toBe(true);
    const control = await page.evaluate(`(() => {
      const button = document.querySelector('.vision-access');
      button.style.transition = 'none';
      const idle = getComputedStyle(button);
      // 2026-11-10: the Foil Rule — a resting control shows the quiet --control-line (full --button-line only on hover).
      const edgeProbe = document.createElement('span'); edgeProbe.style.border = '1px solid var(--control-line)'; document.body.append(edgeProbe);
      const expectedEdge = getComputedStyle(edgeProbe).borderTopColor; edgeProbe.remove();
      const radiusProbe = document.createElement('span'); radiusProbe.style.borderRadius = 'var(--control-radius)'; document.body.append(radiusProbe);
      const expectedRadius = getComputedStyle(radiusProbe).borderRadius; radiusProbe.remove();
      const before = { radius: idle.borderRadius, width: parseFloat(idle.borderTopWidth), edge: idle.borderTopColor,
        expectedEdge, expectedRadius, face: idle.backgroundColor };
      button.setAttribute('aria-pressed', 'true');
      const pressed = getComputedStyle(button).backgroundColor;
      // 2026-11-10: the chosen state is --mark over --mark-tint, never a filled --violet-fill pill.
      const probe = document.createElement('span'); probe.style.backgroundColor = 'var(--mark-tint)'; document.body.append(probe);
      const expectedPressed = getComputedStyle(probe).backgroundColor; probe.remove(); button.removeAttribute('aria-pressed');
      return { ...before, pressed, expectedPressed };
    })()`);
    // 2026-11-10: the Foil Rule — the control is a 2px --control-radius rectangle (was 4px), compared against the token.
    expect(control.radius).toBe(control.expectedRadius);
    expect(control.width).toBeGreaterThan(0);
    expect(control.edge).toBe(control.expectedEdge);
    expect(control.face).toBe('rgba(0, 0, 0, 0)');
    expect(control.pressed).toBe(control.expectedPressed);
    expect(measured.nameColor).toBe(theme === 'dark' ? 'rgb(237, 238, 242)' : 'rgb(47, 36, 64)');
    // The one creating action sits beside the name with its label at desktop width (it collapses to 30px on phones).
    expect(await page.evaluate(`(() => { const mint = document.querySelector('.vision-new-board'); const r = mint.getBoundingClientRect();
      const label = mint.querySelector('span').getBoundingClientRect();
      return Math.round(r.height) + ':' + Math.round(r.width) + ':' + Math.round(label.width); })()`))
      .toMatch(/^30:1[0-9]{2}:[1-9][0-9]+$/);
  });

  it('explains empty panels through the shared EmptyState and counts linked cards', async () => {
    await open('dark');
    expect(await page.evaluate(`document.querySelectorAll('.vision-panel .ui-empty[role=status]').length`)).toBe(1);
    expect(await page.evaluate(`document.querySelector('.vision-panel .ui-empty').textContent`))
      .toBe('There are no references in text nodes yet.');
    expect(await page.evaluate(`document.querySelector('.vision-linked-list button')?.textContent ?? ''`)).toContain('One');
    expect(await page.evaluate(`document.querySelector('.vision-panel .panel-count').textContent`)).toBe('1');
  });

  it('keeps 375px free of horizontal scroll with the collapsed creating action', async () => {
    await open('dark');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: false });
    await delay(300);
    const phone = await page.evaluate(`(() => {
      const doc = document.documentElement;
      const clipped = [...document.querySelectorAll('.vision-toolbar *, .vision-links *')].filter(el => {
        const r = el.getBoundingClientRect(); return r.width && r.right > doc.clientWidth + 0.5; }).length;
      const name = getComputedStyle(document.querySelector('.vision-board-name'));
      const mint = document.querySelector('.vision-new-board').getBoundingClientRect();
      return { overflow: doc.scrollWidth - doc.clientWidth, clipped, name: name.fontSize,
        mint: Math.round(mint.width) + 'x' + Math.round(mint.height) };
    })()`);
    expect(phone.overflow).toBe(0);
    expect(phone.clipped).toBe(0);
    expect(phone.name).toBe('22px');
    expect(phone.mint).toBe('30x30');
  });
});
