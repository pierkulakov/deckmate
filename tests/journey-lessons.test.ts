import { describe, expect, it } from 'vitest';
import { appendJourneyLesson } from '../src/journey-lessons.ts';
import { shortReference } from '../src/references.ts';

// 2026-11-05 write path: a new lessons section is written in the project's format language, and an existing
// section under either language's marker is reused instead of adding a second one.
const cardId = 'card:ca1d0000-0000-4000-8000-000000000001';
const ref = shortReference('c', cardId);
const lesson = 'Звук ломает атмосферу сильнее графики';

describe('Journey lessons section', () => {
  it('creates the section at the end of the step in the project format language', () => {
    const step = 'Пройти уровень без урона.\n';
    const english = appendJourneyLesson(step, lesson, 'Ася', '2026-11-06', cardId, 'ru', 'en');
    expect(english).toBe(`Пройти уровень без урона.\n\n## Lessons\n\n- ${lesson} — Ася, 2026-11-06 ($${ref})\n`);
    const russian = appendJourneyLesson(step, lesson, 'Ася', '2026-11-06', cardId, 'ru', 'ru');
    expect(russian).toContain(`## Грабли\n\n- ${lesson} — Ася, 2026-11-06 ($${ref})`);
    expect(russian).not.toContain('## Lessons');
  });

  it('appends to an existing Грабли section instead of creating a second one', () => {
    const step = `Пройти уровень без урона.\n\n## Грабли\n\n- Прежние грабли — Ася, 2026-11-01\n`;
    const result = appendJourneyLesson(step, lesson, 'Ася', '2026-11-06', cardId, 'ru', 'en');
    expect(result).toBe(`Пройти уровень без урона.\n\n## Грабли\n\n- Прежние грабли — Ася, 2026-11-01\n- ${lesson} — Ася, 2026-11-06 ($${ref})\n`);
  });
});
