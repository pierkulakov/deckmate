import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import { markerWords } from '../src/format-vocabulary.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { appendSectionLine, openQuestionsOf, parseOpenQuestions, recordDecision } from '../src/open-questions.ts';

// 2026-11-05 write path: a new decided section is written in the project's format language, and an existing
// section under either language's marker is reused instead of adding a second one.
const question = 'Сколько воды нужно ростку?';
const answer = 'Стакан каждый вечер';

describe('recorded decision section', () => {
  it('creates the section above Open questions in the project format language', () => {
    const doc = `# Полив ростка\n\nПравило полива.\n\n## Открыто\n\n- ${question}\n`;
    const english = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'en');
    expect(english).toBe(`# Полив ростка\n\nПравило полива.\n\n## Decided\n\n- ${answer} — Ася, 2026-11-06\n\n## Открыто\n\n`);
    const russian = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'ru');
    expect(russian).toContain(`## Решено\n\n- ${answer} — Ася, 2026-11-06`);
    expect(russian).not.toContain('## Decided');
    expect(russian).not.toContain(question);
  });

  it('appends to an existing Решено section instead of creating a second one', () => {
    const doc = `# Полив ростка\n\n## Решено\n\n- Полив вечером — Ася, 2026-11-01\n\n## Открыто\n\n- ${question}\n`;
    const result = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'en');
    expect(result).toBe(`# Полив ростка\n\n## Решено\n\n- Полив вечером — Ася, 2026-11-01\n- ${answer} — Ася, 2026-11-06\n\n## Открыто\n\n`);
  });
});

// 2026-11-06: a question asked on a card without a rule Doc ends its body, so a later `report` lands right after the
// section; the report's lists are not questions, and the next question goes above the report.
describe('open questions before a card report', () => {
  const card = '# Scene check\n\n## Open questions\n\n- Which scenes count as broken?\n\n'
    + '#### Report 2026-11-06 · codex\n\n- Checked: 3/3.\n\n##### Not checked\n- none.\n';

  it('ends the section at the report heading', () => {
    expect(parseOpenQuestions(card).questions?.map(item => item.text)).toEqual(['Which scenes count as broken?']);
  });

  it('appends a new question to the section, not inside the report', () => {
    const result = appendSectionLine(card, markdownParser.parse(card) as Root, markerWords('openQuestions'), '- Which build?\n');
    expect(result).toBe(card.replace('broken?\n', 'broken?\n- Which build?\n'));
    expect(parseOpenQuestions(result!).questions?.map(item => item.text)).toEqual(['Which scenes count as broken?', 'Which build?']);
  });
});

// 2026-11-06: Docs without an open-questions heading skip the Markdown parse; the shortcut must never hide a
// section, a warning or a position the full grammar reports. Random documents mix real headings with near misses.
describe('open-questions shortcut', () => {
  const fragments = ['## Открыто', '## Open questions', '##  OPEN QUESTIONS ##', 'Открыто', '---', '-', '  ---  ',
    '## От*кр*ыто', '## От![x](y)крыто', '## [Откр](/r/x)ыто', '## &#1054;ткрыто', '## Open&#32;questions', 'От\\', 'крыто',
    '- вопрос — [задача](/r/c-0123456789)', '- Open item', '  - вариант', '> ## Открыто', '```', '## Решено', '### Открыто',
    '    ## Открыто', '\t## Open questions', '## `Open` questions', 'Open  ', 'questions', '# Заголовок', 'Текст правила.', ''];
  const breaks = ['\n', '\r\n', '\r', '\n\n'];
  let seed = 20261106;
  const random = (limit: number) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) % limit;
  };
  it('agrees with the full grammar on random documents', () => {
    let sections = 0;
    for (let round = 0; round < 3000; round++) {
      const parts = Array.from({ length: 1 + random(12) }, () => fragments[random(fragments.length)]);
      const markdown = (random(5) === 0 ? '\uFEFF' : '') + parts.map(part => part + breaks[random(breaks.length)]).join('');
      const expected = openQuestionsOf(markdownParser.parse(markdown), 'en');
      if (expected.questions) sections += 1;
      expect(parseOpenQuestions(markdown, 'en'), JSON.stringify(markdown)).toEqual(expected);
    }
    // The generator must exercise both branches, or the comparison proves nothing.
    expect(sections).toBeGreaterThan(300);
  });
});
