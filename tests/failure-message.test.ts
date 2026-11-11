import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { failureMessage } from '../client/failure-message.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

afterEach(() => setLang('en'));
afterAll(() => vi.unstubAllGlobals());

it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])('localizes browser network rejection: %s', message => {
  setLang('ru');
  expect(failureMessage(new TypeError(message), 'Ошибка операции.')).toBe('Deckmate не отвечает. Проверьте, что он запущен, и повторите.');
  setLang('en');
  expect(failureMessage(new TypeError(message), 'Operation failed.')).toBe('Deckmate is not responding. Check that it is running, then try again.');
});

it('keeps server validation and stale-write messages, including non-Error responses and fallbacks', () => {
  setLang('en');
  expect(failureMessage(new Error('Save rejected.'), 'Could not save.')).toBe('Save rejected.');
  expect(failureMessage({ message: 'Invalid response.' }, 'Could not save.')).toBe('Invalid response.');
  expect(failureMessage(null, 'Could not save.')).toBe('Could not save.');
  setLang('ru');
  expect(failureMessage(new Error('Конфликт версии.'), 'Ошибка операции.')).toBe('Конфликт версии.');
  expect(failureMessage({ message: 'Некорректное сопоставление колод.' }, 'Ошибка операции.')).toBe('Некорректное сопоставление колод.');
  expect(failureMessage(undefined, 'Ошибка операции.')).toBe('Ошибка операции.');
});
