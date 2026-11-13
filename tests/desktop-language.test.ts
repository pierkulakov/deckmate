import { afterEach, describe, expect, it, vi } from 'vitest';

async function languageStore(options: { language?: string; saved?: string; legacy?: string; blocked?: boolean; shell?: boolean; start?: boolean } = {}) {
  vi.resetModules();
  const events = new Map<string, (event: unknown) => void>();
  const document = { documentElement: { lang: '', getAttribute: () => options.start ? options.language : null }, cookie: '' };
  const storage = {
    getItem: vi.fn((key: string) => {
      if (options.blocked) throw new Error('SecurityError');
      return (key === 'deckmate-language' ? options.saved : options.legacy) ?? null;
    }),
    setItem: vi.fn(), removeItem: vi.fn(),
  };
  const setLanguage = vi.fn(async () => ({ ok: true } as { ok: boolean; code?: string }));
  const dispatchEvent = vi.fn();
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('window', {
    deckmateBoard: options.shell ? { language: options.language, setLanguage } : undefined,
    deckmateDesktop: options.start ? { setLanguage } : undefined,
    dispatchEvent,
    addEventListener: (name: string, listener: (event: unknown) => void) => events.set(name, listener),
  });
  const store = await import('../client/i18n.ts');
  return { store, document, storage, setLanguage, dispatchEvent, events };
}

afterEach(() => vi.unstubAllGlobals());

describe('desktop language handoff', () => {
  it.each(['en', 'ru'])('starts in shell language %s before fetching data, even with stale or inaccessible storage', async language => {
    for (const blocked of [false, true]) {
      const app = await languageStore({ shell: true, language, saved: language === 'en' ? 'ru' : 'en', blocked });
      expect(app.store.currentLang()).toBe(language);
      expect(app.document.documentElement.lang).toBe(language);
      expect(app.document.cookie).toContain(`deckmate-lang=${language};`);
      expect(app.storage.getItem).not.toHaveBeenCalled();
      expect(app.setLanguage).not.toHaveBeenCalled();
    }
  });

  it('updates React and request cookies once for a shell change without another write', async () => {
    const app = await languageStore({ shell: true, language: 'en', saved: 'en' });
    for (const language of ['ru', 'ru', 'invalid', null]) {
      app.events.get('deckmate:display')!({ detail: { language } });
    }
    expect(app.store.currentLang()).toBe('ru');
    expect(app.document.documentElement.lang).toBe('ru');
    expect(app.document.cookie).toContain('deckmate-lang=ru;');
    expect(app.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(app.setLanguage).not.toHaveBeenCalled();
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps browser defaults, legacy choices and local persistence', async () => {
    expect((await languageStore()).store.currentLang()).toBe('en');
    expect((await languageStore({ blocked: true })).store.currentLang()).toBe('en');
    const app = await languageStore({ legacy: 'ru' });
    expect(app.store.currentLang()).toBe('ru');
    app.store.setLang('en');
    expect(app.storage.setItem).toHaveBeenLastCalledWith('deckmate-language', 'en');
    expect(app.document.cookie).toContain('deckmate-lang=en;');
    expect(app.events.has('deckmate:display')).toBe(false);
  });
  it('uses shell HTML language on the start entry and saves through its bridge before applying', async () => {
    const app = await languageStore({ start: true, language: 'ru', saved: 'en' });
    expect(app.store.currentLang()).toBe('ru');
    expect(app.storage.getItem).not.toHaveBeenCalled();
    app.setLanguage.mockResolvedValueOnce({ ok: false, code: 'save-failed' });
    expect(await app.store.changeLanguage('en')).toEqual({ ok: false, code: 'save-failed' });
    expect(app.store.currentLang()).toBe('ru');
    await app.store.changeLanguage('en');
    expect(app.setLanguage).toHaveBeenLastCalledWith('en');
    expect(app.store.currentLang()).toBe('en');
    expect(app.storage.setItem).not.toHaveBeenCalled();
  });
});
