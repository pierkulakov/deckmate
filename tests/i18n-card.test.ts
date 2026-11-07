import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { origin: 'http://localhost' } });
vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });

const { setLang } = await import('../client/i18n.ts');
const { formatEditorSelection } = await import('../client/editor-formatting.ts');
const { formatAttachmentDate, formatAttachmentSize, validateAttachmentFile } = await import('../client/attachments.ts');
const { getEditorOptions } = await import('../client/editor-commands.ts');

const catalog = { cards: [], decks: [], members: [] } as never;

beforeEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

describe('card interface language', () => {
  it('uses the selected language for an inserted link placeholder', () => {
    expect(formatEditorSelection('', { start: 0, end: 0 }, 'link').value).toBe('[text](https://)');
    setLang('ru');
    expect(formatEditorSelection('', { start: 0, end: 0 }, 'link').value).toBe('[текст](https://)');
  });

  it('translates command details and inserted link text', () => {
    const trigger = { kind: 'command', start: 0, end: 1, query: 'link' } as const;
    expect(getEditorOptions(trigger, catalog)[0]).toMatchObject({ detail: '[text](url)', insert: '[text](https://)', selection: [1, 5] });
    setLang('ru');
    expect(getEditorOptions(trigger, catalog)[0]).toMatchObject({ detail: '[текст](url)', insert: '[текст](https://)', selection: [1, 6] });
  });

  it('formats attachment sizes and dates with the selected locale', () => {
    expect(formatAttachmentSize(512)).toBe('512 B');
    expect(formatAttachmentSize(1536)).toBe('2 KB');
    expect(formatAttachmentSize(1024 * 1024 * 1.5)).toBe('1.5 MB');
    const at = '2020-02-03T12:00:00Z';
    const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
    expect(formatAttachmentDate(at)).toBe(new Date(at).toLocaleDateString('en-US', options));
    setLang('ru');
    expect(formatAttachmentSize(512)).toBe('512 Б');
    expect(formatAttachmentSize(1536)).toBe('2 КБ');
    expect(formatAttachmentSize(1024 * 1024 * 1.5)).toBe('1,5 МБ');
    expect(formatAttachmentDate(at)).toBe(new Date(at).toLocaleDateString('ru-RU', options));
  });

  it('translates attachment validation errors', () => {
    const empty = new File([], 'empty.png', { type: 'image/png' });
    expect(validateAttachmentFile(empty)).toBe('“empty.png”: the file is empty.');
    setLang('ru');
    expect(validateAttachmentFile(empty)).toBe('«empty.png»: файл пустой.');
  });
});
