import { expect, it, vi } from 'vitest';
import { failureMessage } from '../client/failure-message.ts';
import { setLang } from '../client/i18n.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

it('explains a stopped server without hiding server errors or changing fallbacks', () => {
  setLang('en');
  expect(failureMessage(new TypeError('Failed to fetch'), 'Could not save.')).toBe('Deckmate is not responding. Check that it is running, then try again.');
  expect(failureMessage(new Error('Save rejected.'), 'Could not save.')).toBe('Save rejected.');
  expect(failureMessage({ message: 'Invalid response.' }, 'Could not save.')).toBe('Invalid response.');
  expect(failureMessage(null, 'Could not save.')).toBe('Could not save.');
  setLang('ru');
  expect(failureMessage(new TypeError('Failed to fetch'), 'Не удалось сохранить.')).toBe('Deckmate не отвечает. Проверьте, что он запущен, и повторите.');
});
