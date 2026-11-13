import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { launcherReadmeFrame } from '../tools/launcher-capture.ts';

const channels = (hex: string) => hex.slice(1).match(/../gu)!.map(value => parseInt(value, 16) / 255);
function contrast(first: string | number[], second: string | number[]) {
  const luminance = (color: string | number[]) => (typeof color === 'string' ? channels(color) : color)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const a = luminance(first); const b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

describe('desktop frontend build', () => {
  let directory: string;
  const modules = new Set<string>();
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'deckmate-desktop-build-'));
    await build({ configFile: path.resolve('desktop.vite.config.ts'), logLevel: 'error',
      define: { 'process.env.NODE_ENV': JSON.stringify('production') },
      plugins: [{ name: 'start-import-graph', generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') for (const id of Object.keys(chunk.modules)) modules.add(id);
      } }],
      build: { outDir: directory, emptyOutDir: false } });
  }, 30000);
  afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

  it.each(['index.html', 'startup.html', 'whats-new.html'])('ships %s with local assets and its original CSP', async entry => {
    const html = await readFile(path.join(directory, entry), 'utf8');
    const original = await readFile(path.join('client/desktop', entry), 'utf8');
    const policy = (value: string) => value.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/u)?.[1];
    expect(policy(html)).toBe(policy(original));
    expect(html).not.toMatch(/<link rel="stylesheet" crossorigin\b/u);
    const scripts = (value: string) => [...value.matchAll(/<script\b[^>]*>/gu)].map(match => match[0].replace(/\s+/gu, ' '));
    const classic = (value: string) => scripts(value).filter(script => !script.includes('type="module"'));
    expect(classic(html)).toEqual(classic(original));
    expect(html).not.toMatch(/<script(?![^>]*src=)[^>]*>/u);
    if (entry !== 'whats-new.html') expect(scripts(html).find(script => script.includes('type="module"'))).toContain('src="./assets/');
    expect(html.indexOf('src="theme.js"')).toBeLessThan(html.indexOf('rel="stylesheet"'));
    const assets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/gu)].map(match => match[1]);
    for (const asset of assets) {
      expect(asset).not.toMatch(/^(?:https?:|data:|\/)|\.\./u);
      expect((await stat(path.join(directory, asset))).size, asset).toBeGreaterThan(0);
    }
    for (const subset of ['latin', 'cyrillic']) {
      const preload = assets.find(asset => asset.includes(`SourceSans3-${subset}-wght-`));
      expect(preload).toBeDefined();
      expect(await readFile(path.join(directory, preload!))).toEqual(await readFile(`assets/fonts/source-sans-3/SourceSans3-${subset}-wght.woff2`));
    }
    const styles = await Promise.all(assets.filter(asset => asset.endsWith('.css')).map(async asset => {
      const css = await readFile(path.join(directory, asset), 'utf8');
      for (const [, url] of css.matchAll(/url\(["']?([^"')]+)["']?\)/gu)) {
        expect((await stat(path.resolve(directory, path.dirname(asset), url))).size, url).toBeGreaterThan(0);
      }
      return css;
    }));
    expect(styles.join('\n')).toContain('--canvas:');
  });

  it('preserves synchronous shared scripts and the static launcher skeleton', async () => {
    for (const name of ['theme.js', 'focus.js']) expect(await readFile(path.join(directory, name))).toEqual(await readFile(path.join('client', name)));
    for (const name of ['page-ready.js', 'whats-new.js']) {
      expect(await readFile(path.join(directory, name))).toEqual(await readFile(path.join('client/desktop', name)));
    }
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    expect(html).toContain('id="launcher" aria-busy="true"');
    expect(html).toContain('<h1 class="wordmark">Deckmate</h1>');
    expect(await readFile('client/desktop/start.tsx', 'utf8')).toContain('flushSync(');
  });

  it('keeps readable body, controls, focus and illustrated cover faces in both themes', async () => {
    const tokens = await readFile('client/tokens.css', 'utf8');
    const css = await readFile('client/desktop/start.css', 'utf8');
    for (const dark of [false, true]) {
      const values = new Map<string, string>();
      for (const selector of dark ? [':root', ':root.dark'] : [':root']) {
        for (const block of tokens.matchAll(/(:root(?:\.dark)?)\s*\{([^}]*)\}/gu)) {
          if (block[1] !== selector) continue;
          for (const [, role, value] of block[2].matchAll(/--([\w-]+):\s*(#[\da-f]{6});/gu)) values.set(role, value);
        }
      }
      for (const foreground of ['ink', 'muted']) for (const background of ['canvas', 'ground', 'surface']) {
        expect(contrast(values.get(foreground)!, values.get(background)!)).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(values.get('violet-fill-ink')!, values.get('violet-fill')!)).toBeGreaterThanOrEqual(4.5);
      const error = channels(values.get('danger')!).map((value, index) => value * .9 + channels(values.get('ink')!)[index] * .1);
      expect(contrast(error, values.get('ground')!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(values.get('focus')!, values.get('canvas')!)).toBeGreaterThanOrEqual(3);
    }
    const covers = [...css.matchAll(/--cover-c-dark: (#[\da-f]+); --cover-c-light: (#[\da-f]+)/gu)];
    expect(covers).toHaveLength(2);
    for (const [, dark, light] of covers) {
      expect(contrast('#edeef2', dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrast('#2f2440', light)).toBeGreaterThanOrEqual(4.5);
    }
    expect(css).toContain('color-mix(in srgb, var(--danger) 90%, var(--ink))');
  });

  it('reserves diagnostic height and captures the README with room for the covers', async () => {
    const css = await readFile('client/desktop/start.css', 'utf8');
    expect(css).toMatch(/\.bar\s*\{[^}]*height:\s*96px/u);
    expect(css).toMatch(/\.status-copy\s*\{[^}]*max-height:\s*87px;\s*overflow:\s*auto/u);
    for (const theme of ['dark', 'light'] as const) {
      const frame = launcherReadmeFrame(theme);
      expect(frame).toMatchObject({ theme, lang: 'en', size: [1280, 820], covers: 'visible' });
      expect(frame.size[1] / (frame.zoom ?? 1)).toBeGreaterThan(680);
    }
    expect(launcherReadmeFrame().theme).toBe('dark');
  });

  it('excludes board data, styles and dev fixtures from the emitted import graph and every shipped text asset', async () => {
    expect([...modules].some(id => id.endsWith('/StartScreen.tsx'))).toBe(true);
    expect([...modules].some(id => id.endsWith('/ProjectList.tsx'))).toBe(true);
    for (const id of modules) {
      expect(id).not.toMatch(/[/\\](?:App|useWorkspace|catalog-store|start-mock)\.[jt]sx?$/u);
      if (id.includes('/client/') && /\.[jt]sx?$/u.test(id)) expect(await readFile(id, 'utf8')).not.toMatch(/fetch\s*\(\s*['"]\/api/u);
    }
    for (const file of await readdir(directory, { recursive: true })) {
      if (!/\.(?:js|css|html)$/u.test(file)) continue;
      expect((await readFile(path.join(directory, file), 'utf8')).match(/\bscenario\b|\/api\/snapshot|\.catalog-spaces/u), file).toBeNull();
    }
  });

  it('builds the embedded frontend before Rust in CI and release, with no development origin', async () => {
    const config = JSON.parse(await readFile('desktop/src-tauri/tauri.conf.json', 'utf8'));
    expect(config.build.frontendDist).toBe('../dist');
    expect(config.build.devUrl).toBeUndefined();
    expect(config.build.beforeDevCommand).toContain('build:desktop -- --watch');
    for (const [file, job] of [['ci.yml', 'desktop-shell'], ['release.yml', 'desktop']]) {
      const workflow = parse(await readFile(path.join('.github/workflows', file), 'utf8'));
      const commands: string[] = workflow.jobs[job].steps.map((step: { run?: string }) => step.run ?? '');
      const frontend = commands.indexOf('npm run build:desktop');
      expect(frontend).toBeGreaterThanOrEqual(0);
      expect(frontend).toBeLessThan(commands.findIndex(command => /cargo (?:clippy|test|build)|tauri\.js build/u.test(command)));
    }
    const manifest = JSON.parse(await readFile('package.json', 'utf8'));
    expect(manifest.files).not.toContain('desktop/');
    expect(manifest.files).not.toContain('desktop/dist/');
  });
});
