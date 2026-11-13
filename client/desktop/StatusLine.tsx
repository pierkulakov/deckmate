import { useLayoutEffect, useRef } from 'react';
import type { DesktopFailure } from '../desktop-bridge.ts';
import { desktopErrorText } from '../desktop-errors.ts';
import { defineText, type Lang } from '../i18n.ts';
import { moveFocus } from '../focus.ts';
import { ReservedText } from '../ReservedText.tsx';

const text = defineText({
  idle: 'Choose a project to begin.', details: 'Technical details', retry: 'Try again', chooseFolder: 'Choose folder…',
  starting: (name: string) => `Starting ${name}…`, creating: (name: string) => `Creating ${name}…`, ready: (name: string) => `Opening ${name}…`,
  waitingOpen: 'The local server may take up to 20 seconds. You can open another project instead.',
  waitingCreate: 'Creating the demo may take up to a minute. You can open another project instead.',
  removed: 'Removed from the list. Project files were not deleted.', updated: 'Workspace updated.',
}, {
  idle: 'Выберите проект, чтобы начать.', details: 'Технические подробности', retry: 'Повторить', chooseFolder: 'Выбрать папку…',
  starting: (name: string) => `Запускаем ${name}…`, creating: (name: string) => `Создаём ${name}…`, ready: (name: string) => `Открываем ${name}…`,
  waitingOpen: 'Запуск локального сервера может занять до 20 секунд. Можно открыть другой проект.',
  waitingCreate: 'Создание демо может занять до минуты. Можно открыть другой проект.',
  removed: 'Убрано из списка. Файлы проекта не удалены.', updated: 'Рабочее пространство обновлено.',
});

export type StartStatus = { phase: 'starting' | 'ready'; name: string; creating?: boolean }
  | { phase: 'success'; notice: 'removed' | 'updated' }
  | { phase: 'error'; failure: DesktopFailure; recovery?: { label: 'retry' | 'chooseFolder'; action(): void } } | null;

export function StatusLine({ status }: { status: StartStatus }) {
  const retry = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const failure = status?.phase === 'error' ? status.failure : null;
  const recovery = status?.phase === 'error' ? status.recovery : undefined;
  useLayoutEffect(() => {
    if (!failure?.message && details.current) details.current.open = false;
    if (failure && recovery && document.activeElement === document.body) moveFocus(retry.current);
  }, [status]);
  const label = (lang: Lang) => {
    const t = text[lang];
    if (!status) return t.idle;
    if (status.phase === 'error') return desktopErrorText(status.failure.code, lang);
    if (status.phase === 'success') return t[status.notice];
    if (status.phase === 'ready') return t.ready(status.name);
    if (status.creating) return `${t.creating(status.name)} ${t.waitingCreate}`;
    return `${t.starting(status.name)} ${t.waitingOpen}`;
  };
  return <div className="status" id="status" data-phase={status?.phase}>
    <span className="status-dot" aria-hidden="true" />
    <div className="status-copy">
      <span className="status-text" id="status-text" role="status" aria-live="polite" aria-atomic="true"><ReservedText values={{ en: label('en'), ru: label('ru') }} /></span>
      <details ref={details} id="status-details" hidden={!failure?.message}>
        <summary><ReservedText values={{ en: text.en.details, ru: text.ru.details }} /></summary><pre id="status-technical">{failure?.message ?? ''}</pre>
      </details>
    </div>
    <button ref={retry} type="button" className="link" id="status-retry" hidden={!recovery} onClick={recovery?.action}>
      <ReservedText values={{ en: text.en[recovery?.label ?? 'retry'], ru: text.ru[recovery?.label ?? 'retry'] }} />
    </button>
  </div>;
}
