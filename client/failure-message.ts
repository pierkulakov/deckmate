import { defineText, textNow } from './i18n.ts';

const text = defineText({
  connectionFailed: 'Deckmate is not responding. Check that it is running, then try again.',
}, {
  connectionFailed: 'Deckmate не отвечает. Проверьте, что он запущен, и повторите.',
});

// 2026-11-06: fetch rejects with a TypeError when the server is gone; server replies keep their own message.
export function failureMessage(failure: unknown, fallback: string): string {
  if (failure instanceof TypeError) return textNow(text).connectionFailed;
  if (failure instanceof Error) return failure.message;
  if (failure && typeof failure === 'object' && 'message' in failure) return String(failure.message);
  return fallback;
}
