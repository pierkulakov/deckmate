import { defineText, serverText } from './i18n.ts';

const messages = defineText({
  journey: (written: string, directory: string, reason: string) => `Journey partly saved. Written: ${written || 'none'}; retry with the current catalog to finish saving in ${directory}. ${reason}`,
  template: (written: string, directory: string, reason: string) => `Template partly saved. Written: ${written}; check ${directory} and retry. ${reason}`,
}, {
  journey: (written: string, directory: string, reason: string) => `Сохранение Journey завершено не полностью. Записаны: ${written || 'нет'}; повтор с актуальным каталогом достроит остальное в ${directory}. ${reason}`,
  template: (written: string, directory: string, reason: string) => `Сохранение шаблона завершено не полностью. Записаны: ${written}; проверьте ${directory} и повторите. ${reason}`,
});

export function throwJourneyPublicationError(error: unknown, written: readonly string[], directory: string,
  subject: 'journey' | 'template'): never {
  // 2026-11-10: a file can land before its writer returns, so an incoming saved flag also confirms partial publication.
  if (written.length === 0 && !(error as { saved?: boolean } | null | undefined)?.saved) throw error;
  const reason = error instanceof Error ? error.message : String(error);
  throw Object.assign(new Error(serverText(messages)[subject](written.join(', '), directory, reason)), { saved: true });
}
