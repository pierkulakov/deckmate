import { readFileSync } from 'node:fs';
import { afterAll, expect, it, vi } from 'vitest';
import { failureMessage } from '../client/failure-message.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});
afterAll(() => vi.unstubAllGlobals());

it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])('localizes browser network rejection: %s', message => {
  setLang('ru');
  expect(failureMessage(new TypeError(message), 'Ошибка операции.')).toBe('Deckmate не отвечает. Проверьте, что он запущен, и повторите.');
  setLang('en');
  expect(failureMessage(new TypeError(message), 'Operation failed.')).toBe('Deckmate is not responding. Check that it is running, then try again.');
});

it('keeps server validation and stale-write messages, including non-Error responses', () => {
  setLang('ru');
  expect(failureMessage(new Error('Конфликт версии.'), 'Ошибка операции.')).toBe('Конфликт версии.');
  expect(failureMessage({ message: 'Некорректное сопоставление колод.' }, 'Ошибка операции.')).toBe('Некорректное сопоставление колод.');
  expect(failureMessage(undefined, 'Ошибка операции.')).toBe('Ошибка операции.');
});

it.each(['components/JourneyCatalog.tsx', 'components/Notifications.tsx', 'components/CardPreview.tsx',
  'components/JourneyMetrics.tsx', 'components/DocumentPreview.tsx', 'components/CardFamily.tsx', 'AttachSubCards.tsx'])('%s uses the shared formatter instead of exposing fetch TypeErrors', path => {
  const source = readFileSync(new URL('../client/' + path, import.meta.url), 'utf8');
  expect(source).toMatch(/import \{ failureMessage \} from ['"].*failure-message\.ts['"]/u);
  expect(source).not.toMatch(/function failureMessage\(/u);
  expect(source).toMatch(/failureMessage\((?:failure|error), /u);
});
