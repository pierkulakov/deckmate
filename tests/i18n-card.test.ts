import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
vi.stubGlobal('window', { dispatchEvent: vi.fn(), location: { origin: 'http://localhost' } });
vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });

const { setLang } = await import('../client/i18n.ts');
const { formatEditorSelection } = await import('../client/editor-formatting.ts');
const { formatAttachmentDate, formatAttachmentSize, validateAttachmentFile } = await import('../client/attachments.ts');
const { getEditorOptions } = await import('../client/editor-commands.ts');
const { QuickSettingsList } = await import('../client/components/QuickSettingsList.tsx');

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

  it('translates commands and member kinds while retaining English command search', () => {
    const trigger = { kind: 'command', start: 0, end: 1, query: '' } as const;
    expect(getEditorOptions(trigger, catalog).find(option => option.id === 'heading-1')?.label).toBe('Heading 1');
    setLang('ru');
    const options = getEditorOptions(trigger, catalog);
    expect(options.find(option => option.id === 'heading-1')?.label).toBe('Заголовок 1');
    expect(options.find(option => option.id === 'emoji')?.label).toBe('Эмодзи');
    expect(getEditorOptions({ ...trigger, query: 'heading' }, catalog)[0].label).toBe('Заголовок 1');
    const members = { cards: [], decks: [], members: [{ id: 'one', label: 'One', aliases: [], kind: 'human' }, { id: 'two', label: 'Two', aliases: [], kind: 'agent' }] } as never;
    expect(getEditorOptions({ kind: 'member', start: 0, end: 1, query: '' }, members).map(option => option.detail)).toEqual(['Человек', 'Агент']);
  });

  it('localizes the quick settings heading, current marker and keyboard hint', () => {
    const render = (title: string) => renderToStaticMarkup(createElement(QuickSettingsList, {
      title, choices: [{ key: '', label: 'None' }], current: '', disabled: false, tabs: true, onChoose: () => {},
    }));
    expect(render('Owner')).toContain('Choose Owner');
    setLang('ru');
    const russian = render('Исполнитель');
    expect(russian).toContain('Выбрать: Исполнитель');
    expect(russian).toContain('текущее');
    expect(russian).toContain('подтвердить');
    expect(russian).not.toContain('Use ');
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
