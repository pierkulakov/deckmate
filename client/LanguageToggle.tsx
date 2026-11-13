import { useRef, useState } from 'react';
import { Languages } from 'lucide-react';
import { changeLanguage, defineText, useLang, type Lang } from './i18n.ts';
import { ReservedText } from './ReservedText.tsx';
import type { DesktopFailure } from './desktop-bridge.ts';

const text = defineText({ other: 'Русский', language: 'Interface language' }, { other: 'English', language: 'Язык интерфейса' });

export interface LanguageToggleProps {
  className?: string;
  onChange?: (language: Lang) => void;
  onError?: (failure: DesktopFailure) => void;
}

export function LanguageToggle({ className, onChange, onError = console.error }: LanguageToggleProps) {
  const lang = useLang();
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  async function change() {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    const next = lang === 'en' ? 'ru' : 'en';
    try {
      const result = await changeLanguage(next);
      if (result.ok) onChange?.(next);
      else onError(result);
    } catch (error) { onError({ ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined }); }
    finally { locked.current = false; setPending(false); }
  }
  return <button type="button" className={className} disabled={pending} onClick={() => void change()}>
    <Languages size={18} aria-hidden="true" /><span><ReservedText values={{ en: text.en.other, ru: text.ru.other }} />
      <small><ReservedText values={{ en: text.en.language, ru: text.ru.language }} /></small></span>
  </button>;
}
