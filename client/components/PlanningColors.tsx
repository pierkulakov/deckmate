import { Check } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import '../planning-popover.css';

const text = defineText({
  color: (value: string) => `Color ${value}`,
  customColor: 'Custom color',
}, {
  color: (value: string) => `Цвет ${value}`,
  customColor: 'Свой цвет',
});

/**
 * Milestone and Run colors (2026-11-05): the values of Deckmate's own light-theme tokens --card-highlight, --accent, --plum,
 * --danger, --champagne, --kind-task-ink and --muted. Data keeps a plain hex, so the swatches are fixed values, not live tokens.
 */
export const planningColors = ['#2b9e7f', '#7443a6', '#9c6acf', '#b64267', '#cb973c', '#1d4873', '#6b587b'] as const;

/** Swatch row with a custom picker at the end, so a color saved outside the palette stays visible and editable. */
export function PlanningColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const t = useText(text);
  const current = value.toLowerCase();
  const custom = !planningColors.some(color => color === current);
  return <div className="planning-colors" role="group" aria-label={label}>
    {planningColors.map(color => <button type="button" key={color} className="planning-color-swatch" aria-label={t.color(color)} aria-pressed={current === color} onClick={() => onChange(color)}>
      <span style={{ backgroundColor: color }}>{current === color && <Check size={11} strokeWidth={3} aria-hidden="true" />}</span>
    </button>)}
    <label className={`planning-color-swatch planning-color-custom${custom ? ' is-selected' : ''}`} title={t.customColor}>
      <span className="visually-hidden">{t.customColor}</span>
      <input type="color" value={/^#[\da-f]{6}$/iu.test(value) ? value : planningColors[0]} onChange={event => onChange(event.target.value)} />
    </label>
  </div>;
}
