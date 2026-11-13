import type { DesktopFailure } from './desktop-bridge.ts';
import { desktopErrorText } from './desktop-errors.ts';
import { defineText, type Lang } from './i18n.ts';
import { ReservedText } from './ReservedText.tsx';
import './project-list.css';

const text = defineText({ retry: 'Try again', choose: 'Choose folder…', details: 'Technical details' },
  { retry: 'Повторить', choose: 'Выбрать папку…', details: 'Технические подробности' });

export interface ProjectListFeedbackProps {
  failure: DesktopFailure | null;
  fallback?: Record<Lang, string>;
  disabled?: boolean;
  onRetry?: () => void;
  onChooseFolder?: () => void;
}

export function ProjectListFeedback({ failure, fallback, disabled, onRetry, onChooseFolder }: ProjectListFeedbackProps) {
  if (!failure) return null;
  const choose = onChooseFolder && ['missing', 'invalid-path', 'not-empty', 'create-failed'].includes(failure.code);
  const retry = choose ? onChooseFolder : onRetry;
  const key = choose ? 'choose' : 'retry';
  return <div className="mission-control-recent-failure" role="alert">
    <ReservedText values={{ en: desktopErrorText(failure.code, 'en', fallback?.en), ru: desktopErrorText(failure.code, 'ru', fallback?.ru) }} />
    {retry && <> <button type="button" className="mission-control-retry" disabled={disabled} onClick={retry}><ReservedText values={{ en: text.en[key], ru: text.ru[key] }} /></button></>}
    {failure.message && <details className="project-list-details"><summary><ReservedText values={{ en: text.en.details, ru: text.ru.details }} /></summary><pre>{failure.message}</pre></details>}
  </div>;
}
