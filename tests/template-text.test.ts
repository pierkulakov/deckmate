import { describe, expect, it } from 'vitest';
import { templateText } from '../src/template-text.ts';

const template = {
  title: 'Bug fix',
  description: 'Reproduce and fix the bug.',
  locales: { ru: { title: 'Исправление бага' } },
};

describe('template picker text', () => {
  it('uses English for the English interface and when no locale is available', () => {
    expect(templateText(template, 'en')).toEqual({ title: 'Bug fix', description: 'Reproduce and fix the bug.' });
    expect(templateText({ title: template.title, description: template.description }, 'ru'))
      .toEqual({ title: 'Bug fix', description: 'Reproduce and fix the bug.' });
  });

  it('falls back to English field by field', () => {
    expect(templateText(template, 'ru')).toEqual({ title: 'Исправление бага', description: 'Reproduce and fix the bug.' });
    expect(templateText({ ...template, locales: { ru: { description: 'Воспроизведите и исправьте баг.' } } }, 'ru'))
      .toEqual({ title: 'Bug fix', description: 'Воспроизведите и исправьте баг.' });
  });
});
