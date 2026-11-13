import { useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { defineText, useText } from './i18n.ts';
import { ReservedText } from './ReservedText.tsx';
import { changeTheme, useTheme } from './theme-preference.ts';
import type { DesktopFailure, ThemePreference } from './desktop-bridge.ts';
import './theme-toggle.css';

const text = defineText({ light: 'Light theme', dark: 'Dark theme', system: 'System theme', theme: 'Theme' },
  { light: 'Светлая тема', dark: 'Тёмная тема', system: 'Системная тема', theme: 'Тема' });
const choices = ['light', 'dark', 'system'] as const;
const icons = { light: Sun, dark: Moon, system: Monitor };

export interface ThemeToggleProps {
  variant?: 'icon' | 'menu';
  onChange?: (theme: ThemePreference) => void;
  onError?: (failure: DesktopFailure) => void;
}

export function ThemeToggle({ variant = 'icon', onChange, onError = console.error }: ThemeToggleProps) {
  const t = useText(text);
  const { theme, dark } = useTheme();
  const [pending, setPending] = useState(false);
  const [open, setOpen] = useState(false);
  const locked = useRef(false);
  const key = dark ? 'light' : 'dark';
  const Icon = icons[key];
  async function select(next: ThemePreference) {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      const result = await changeTheme(next);
      if (result.ok) onChange?.(next);
      else onError(result);
    } catch (error) { onError({ ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined }); }
    finally { locked.current = false; setPending(false); }
  }
  return <DropdownMenu.Root modal={false} open={open} onOpenChange={setOpen}>
    <DropdownMenu.Trigger type="button" className={variant === 'icon' ? 'ui-button button-ghost button-size-icon' : undefined}
      aria-label={t.theme} title={t[theme]} disabled={pending}>
      <Icon size={variant === 'icon' ? 17 : 18} aria-hidden="true" />
      {variant === 'menu' && <span><ReservedText values={{ en: text.en[key], ru: text.ru[key] }} /></span>}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content className="theme-toggle-menu" align="end" sideOffset={6} collisionPadding={16}
      onEscapeKeyDown={event => { event.preventDefault(); event.stopPropagation(); setOpen(false); }}>
      <DropdownMenu.RadioGroup value={theme} onValueChange={next => void select(next as ThemePreference)}>
        {choices.map(choice => {
          const ChoiceIcon = icons[choice];
          return <DropdownMenu.RadioItem className="theme-toggle-choice" value={choice} key={choice} disabled={pending}>
            <ChoiceIcon size={15} aria-hidden="true" /><ReservedText values={{ en: text.en[choice], ru: text.ru[choice] }} />
            <DropdownMenu.ItemIndicator className="theme-toggle-check"><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator>
          </DropdownMenu.RadioItem>;
        })}
      </DropdownMenu.RadioGroup>
    </DropdownMenu.Content>
  </DropdownMenu.Root>;
}
