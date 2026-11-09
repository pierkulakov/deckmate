import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseTemplateLocales } from '../src/template-locales.ts';

// 2026-11-09: the Russian picker shows every bundled template in Russian; a new template without `locales.ru`
// would silently fall back to English, so the bundle is checked here.
const assets = path.resolve(import.meta.dirname, '..', 'assets');
const files = [
  ...readdirSync(path.join(assets, 'journey-templates'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => path.join('journey-templates', entry.name, 'index.md')),
  ...readdirSync(path.join(assets, 'project-templates')).filter(name => name.endsWith('.md'))
    .map(name => path.join('project-templates', name)),
];

describe('bundled template locales', () => {
  it.each(files)('%s has a Russian title and description', file => {
    const header = /^---\r?\n([\s\S]*?)^---/mu.exec(readFileSync(path.join(assets, file), 'utf8'));
    const metadata = parse(header![1]!) as Record<string, unknown>;
    const ru = parseTemplateLocales(metadata.locales)?.ru;
    expect(ru?.title, 'locales.ru.title').toBeTruthy();
    expect(ru?.description, 'locales.ru.description').toBeTruthy();
  });
});
