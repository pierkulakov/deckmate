import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { projectTemplateShelf, storedTemplateShelf } from '../client/components/ProjectTemplates.tsx';

// ProjectTemplates imports client/i18n.ts, which reads document at module level; stub it before the import runs.
vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
});

let values: Record<string, string> = {};

beforeEach(() => {
  values = {};
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', Object.assign(new EventTarget(), { location: { origin: 'http://localhost' } }));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  });
});

afterEach(() => vi.unstubAllGlobals());

/** A catalog that holds only the project profile document card, as the picker sees it. */
function profileCatalog(markdown: string) {
  return { cards: [{ id: 'doc:tasks/deckmate-project.md', markdown }] };
}

describe('remembered template shelf', () => {
  it('reads a stored shelf and rejects anything else', () => {
    values['deckmate:template-shelf'] = 'software';
    expect(storedTemplateShelf()).toBe('software');
    values['deckmate:template-shelf'] = 'games';
    expect(storedTemplateShelf()).toBe('games');
    values['deckmate:template-shelf'] = 'boardgames';
    expect(storedTemplateShelf()).toBeNull();
    delete values['deckmate:template-shelf'];
    expect(storedTemplateShelf()).toBeNull();
  });

  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('full'); }, setItem: () => {}, removeItem: () => {} });
    expect(storedTemplateShelf()).toBeNull();
  });
});

describe('project template shelf of the profile', () => {
  it('is Games while the profile names a genre key', () => {
    expect(projectTemplateShelf(profileCatalog('---\ngenre: rts\n---\n\n# Project profile\n'))).toBe('games');
    expect(projectTemplateShelf(profileCatalog('---\r\nplatform: PC\r\ngenre: platformer\r\n---\r\n'))).toBe('games');
    expect(projectTemplateShelf(profileCatalog(String.fromCharCode(0xfeff) + '---\ngenre: 4x\n---\n'))).toBe('games');
  });

  it('stays unknown without a readable genre key', () => {
    expect(projectTemplateShelf(null)).toBeNull();
    expect(projectTemplateShelf({ cards: [] })).toBeNull();
    expect(projectTemplateShelf({ cards: [{ id: 'doc:tasks/other.md', markdown: '---\ngenre: rts\n---\n' }] })).toBeNull();
    expect(projectTemplateShelf(profileCatalog('# No frontmatter'))).toBeNull();
    expect(projectTemplateShelf(profileCatalog('---\ngenre: null\n---\n'))).toBeNull();
    expect(projectTemplateShelf(profileCatalog("---\ngenre: 'rts'\n---\n"))).toBeNull();
    expect(projectTemplateShelf(profileCatalog('---\ntitle: Research\n---\ngenre: rts\n'))).toBeNull();
  });
});
