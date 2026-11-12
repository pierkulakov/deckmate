import { describe, expect, it } from 'vitest';
import type { Root } from 'mdast';
import { markerWords } from '../src/format-vocabulary.ts';
import { markdownParser } from '../src/markdown-model.ts';
import { appendSectionLine, applyDecision, assignQuestion, catalogDecisionOf, catalogQuestionOf, decisionAnswerText, openQuestionsOf, parseCardQuestions, parseOpenQuestions, recordDecision, resolvedDecisionsOf } from '../src/open-questions.ts';
import { hasMatchingQuestion, isPendingDecision } from '../src/catalog-contracts.ts';
import { shortReference } from '../src/references.ts';
import { legacyDecisionLink } from './helpers/legacy-decision.ts';

// 2026-11-05 write path: a new decided section is written in the project's format language, and an existing
// section under either language's marker is reused instead of adding a second one.
const question = 'Сколько воды нужно ростку?';
const answer = 'Стакан каждый вечер';

it('distinguishes the addressee and answer target from a legacy decision Task link', () => {
  const markdown = '## Open questions\n\n- Which **FPS**? @pier → [Camera](/r/c-0123456789#камера) — [Decision](/r/c-9876543210)\n';
  expect(parseOpenQuestions(markdown).questions?.[0]).toMatchObject({
    text: 'Which FPS?', assignee: 'pier', target: 'c-0123456789#камера', taskRef: 'c-9876543210',
  });
});

it('records an explicit target as pending while marker-free decisions are already applied', () => {
  const markdown = '## Open questions\n\n- Which build? @pier → [Rules](/r/c-0123456789)\n';
  const saved = recordDecision(markdown, 0, 'Which build?', 'Stable', 'Pier', '2026-11-12', 'en', 'en');
  expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({
    question: 'Which build?', target: 'c-0123456789', applied: null, answer: 'Stable',
  });
  expect(resolvedDecisionsOf(markdownParser.parse('## Decided\n- Legacy — Pier, 2026-11-01\n'))[0])
    .toMatchObject({ target: null, applied: '2026-11-01' });
});

it('projects the complete shared decision metadata without Markdown nodes or parser offsets', () => {
  const markdown = '## Open questions\n- Which **build**? @human → [Rules](/r/c-0123456789#rules)\n';
  const parsed = parseCardQuestions(markdown);
  expect(parsed.questions?.map(catalogQuestionOf)).toEqual([{ text: 'Which build?', taskRef: null, assignee: 'human', target: 'c-0123456789#rules' }]);
  const saved = recordDecision(markdown, 0, 'Which build?', 'Stable', 'Human', '2026-11-12', 'en', 'en', undefined, 'Agent');
  const pending = parseCardQuestions(saved).decisions.map(catalogDecisionOf);
  expect(pending).toEqual([{ index: 0, question: 'Which build?', answer: 'Stable', by: 'Human', recordedBy: 'Agent', assignee: 'human',
    date: '2026-11-12', target: 'c-0123456789#rules', applied: null }]);
  expect(pending.filter(isPendingDecision)).toHaveLength(1);
  expect(parseCardQuestions(applyDecision(saved, 0, 'Stable', '2026-11-12')).decisions.map(catalogDecisionOf).filter(isPendingDecision)).toEqual([]);
  const legacy = parseCardQuestions('## Decided\n- Undated answer\n- Saved — Human, 2026-11-01\n').decisions.map(catalogDecisionOf);
  expect(legacy.map(decision => decision.applied)).toEqual(['', '2026-11-01']);
  expect(legacy.filter(isPendingDecision)).toEqual([]);
  expect(legacy[0]).not.toHaveProperty('assignee');
  expect(legacy[0]).not.toHaveProperty('recordedBy');
});

it('uses the same retry identity for parsed and projected questions and answers', () => {
  const ref = 'c-0123456789';
  const markdown = '## Open questions\n- Which build? @human\n';
  const parsed = parseCardQuestions(markdown);
  const expected = { text: 'Which build?', assignee: 'human', target: ref };
  expect(hasMatchingQuestion(parsed.questions!, [], expected, ref)).toBe(true);
  const saved = recordDecision(markdown, 0, expected.text, 'Stable', 'Human', '2026-11-12', 'en', 'en');
  const decisions = parseCardQuestions(saved).decisions;
  expect(hasMatchingQuestion([], decisions, expected, ref)).toBe(true);
  expect(hasMatchingQuestion([], decisions.map(catalogDecisionOf), expected, ref)).toBe(true);
  expect(hasMatchingQuestion(parsed.questions!, decisions, { ...expected, target: ref + '#rules' }, ref)).toBe(false);
  expect(hasMatchingQuestion(parsed.questions!, decisions, { ...expected, assignee: null }, ref)).toBe(false);
  expect(hasMatchingQuestion(parsed.questions!, decisions, { ...expected, text: 'Another build?' }, ref)).toBe(false);
});

it.each(['Ask @pier about FPS?', 'Why `@pier`', 'Why [@pier](https://example.com)', 'Contact a@pier'])('does not infer an addressee from content: %s', text => {
  expect(parseOpenQuestions(`## Open questions\n- ${text}\n`).questions?.[0]).toMatchObject({ assignee: null, target: null });
});

it('retains ordinary card links as question content instead of accepting those cards as legacy Tasks', () => {
  const markdown = '## Open questions\n- Does [camera](/r/c-0123456789#камера) work? @pier\n';
  expect(parseOpenQuestions(markdown).questions?.[0]).toMatchObject({ text: 'Does camera work?', assignee: 'pier', target: null, taskRef: null });
  const saved = recordDecision(markdown, 0, 'Does camera work?', 'Yes', 'Pier', '2026-11-12');
  expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({ question: 'Does camera work?', taskRef: null, target: null, applied: null });
  expect(saved).toContain('[camera](/r/c-0123456789#камера)');
});

it.each(['\n', '\r\n', '\r'])('assigns and clears only the metadata suffix with %j', eol => {
  const original = `\uFEFF#### Открыто${eol}${eol}- Which **camera**?   → [Rules](/r/c-0123456789#камера)${eol}  - Option.  ${eol}`;
  const assigned = assignQuestion(original, 0, 'Which camera?', 'pier');
  expect(assigned).toBe(original.replace('?   →', '? @pier   →'));
  expect(assignQuestion(assigned, 0, 'Which camera?', 'builder')).toBe(assigned.replace('@pier', '@builder'));
  expect(assignQuestion(assigned, 0, 'Which camera?', null)).toBe(original);
  expect(assignQuestion(assigned, 0, 'Which camera?', 'pier')).toBe(assigned);
  const bold = '## Open questions\n- Which **camera**\n';
  expect(assignQuestion(bold, 0, 'Which camera', 'pier')).toBe(bold.replace('**camera**', '**camera** @pier'));
  const legacy = bold.replace('**camera**', '**camera** — [Decision](/r/c-0123456789)');
  expect(assignQuestion(legacy, 0, 'Which camera', 'pier')).toBe(legacy.replace('**camera**', '**camera** @pier'));
});

it('applies one exact marker, keeps undecorated legacy entries applied, and parses decided-only cards', () => {
  const markdown = '\uFEFF#### Решено\r\n\r\n- Which? <!-- deckmate:decision --> → Answer — Pier, 2026-11-11 <!-- deckmate:pending -->\r\n'
    + '- Legacy answer\r\n\r\n#### Notes\nKeep final bytes.  ';
  const saved = applyDecision(markdown, 0, 'Answer', '2026-11-12');
  expect(saved).toBe(markdown.replace('<!-- deckmate:pending -->', '<!-- deckmate:applied 2026-11-12 -->'));
  expect(applyDecision(saved, 0, 'Answer', '2026-11-13')).toBe(saved);
  expect(applyDecision(markdown, 1, 'Legacy answer', '2026-11-12')).toBe(markdown);
  expect(() => applyDecision(markdown, 0, 'Changed', '2026-11-12')).toThrow();
  const parsed = parseCardQuestions(saved);
  expect(parsed.questions).toBeNull();
  expect(parsed.decisions.map(decision => decision.applied)).toEqual(['2026-11-12', '']);
});

describe('recorded decision section', () => {
  it('creates the section above Open questions in the project format language', () => {
    const doc = `# Полив ростка\n\nПравило полива.\n\n## Открыто\n\n- ${question}\n`;
    const english = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'en');
    expect(english).toBe(`# Полив ростка\n\nПравило полива.\n\n## Decided\n\n- ${question} <!-- deckmate:decision --> → ${answer} — Ася, 2026-11-06 <!-- deckmate:pending -->\n\n## Открыто\n\n`);
    const russian = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'ru');
    expect(russian).toContain(`## Решено\n\n- ${question} <!-- deckmate:decision --> → ${answer} — Ася, 2026-11-06`);
    expect(russian).not.toContain('## Decided');
    expect(parseOpenQuestions(russian).questions).toEqual([]);
  });

  it('appends to an existing Решено section instead of creating a second one', () => {
    const doc = `# Полив ростка\n\n## Решено\n\n- Полив вечером — Ася, 2026-11-01\n\n## Открыто\n\n- ${question}\n`;
    const result = recordDecision(doc, 0, question, answer, 'Ася', '2026-11-06', 'ru', 'en');
    expect(result).toBe(`# Полив ростка\n\n## Решено\n\n- Полив вечером — Ася, 2026-11-01\n- ${question} <!-- deckmate:decision --> → ${answer} — Ася, 2026-11-06 <!-- deckmate:pending -->\n\n## Открыто\n\n`);
  });

  it('keeps the BOM at the beginning when Open questions is the first section', () => {
    const markdown = `\uFEFF## Open questions\r\n\r\n- ${question}\r\n`;
    expect(recordDecision(markdown, 0, question, answer, 'Ася', '2026-11-11', 'en', 'en'))
      .toBe(`\uFEFF## Decided\r\n\r\n- ${question} <!-- deckmate:decision --> → ${answer} — Ася, 2026-11-11 <!-- deckmate:pending -->\r\n\r\n## Open questions\r\n\r\n`);
  });
});

describe('resolved decision grammar', () => {
  it.each(['Decided', 'Решено'])('keeps legacy answers intact in %s, including arrows and rich Markdown', title => {
    const markdown = `## ${title}\n\n- A → B — keep (both) and [the link](https://example.com) — Pier, 2026-11-12\n- Undated rule.\n`;
    const entries = resolvedDecisionsOf(markdownParser.parse(markdown));
    expect(entries[0]).toMatchObject({ question: null, taskRef: null, answer: 'A → B — keep (both) and the link', author: 'Pier', date: '2026-11-12' });
    expect(entries[1]).toMatchObject({ question: null, answer: 'Undated rule.', author: null, date: null });
    expect(JSON.stringify(entries[0].nodes)).toContain('https://example.com');
  });

  it.each([
    { format: 'en' as const, title: 'Open questions', question: 'Which **FPS** → 30 — 60 – 120 (low-end)? [Guide](https://example.com/fps_(low))', answer: '60 → 120 — not yet; [budget](https://example.com/budget_(low))' },
    { format: 'ru' as const, title: 'Открыто', question: 'Какой **FPS** → 30 — 60 – 120 (ноутбук)? [Правило](https://example.com/fps_(low))', answer: '60 → 120 — позже; [бюджет](https://example.com/budget_(low))' },
  ])('round-trips the question, symbols, links and decision Task in $format', ({ format, title, question, answer }) => {
    const taskRef = 'c-0123456789';
    const markdown = `## ${title}\n\n- [ ] ${question} — [Decision](/r/${taskRef})\n  - Option\n`;
    const expected = parseOpenQuestions(markdown).questions![0];
    const saved = recordDecision(markdown, 0, expected.text, answer, 'Pier', '2026-11-12', format, format);
    const tree = markdownParser.parse(saved);
    const snapshot = JSON.stringify(tree);
    const entry = resolvedDecisionsOf(tree)[0];
    expect(entry).toMatchObject({ question: expected.text, taskRef, author: 'Pier', date: '2026-11-12' });
    expect(entry.answer).toBe(format === 'en' ? '60 → 120 — not yet; budget' : '60 → 120 — позже; бюджет');
    expect(saved).toContain(question);
    expect(saved).toContain(`— [Decision](/r/${taskRef}) <!-- deckmate:decision --> →`);
    expect(JSON.stringify(entry.nodes)).toContain('https://example.com/budget_(low)');
    expect(JSON.stringify(tree)).toBe(snapshot);
    expect(parseOpenQuestions(saved).questions).toEqual([]);
    expect(saved).toContain('  - Option');
  });

  it.each(['`<!-- deckmate:decision -->`', '&lt;!-- deckmate:decision -->', '<!-- deckmate:decision -->', '<!-- deckmate:pending -->', '<!-- deckmate:applied 2026-11-12 -->'])('does not confuse marker content %s with the separator', marker => {
    const markdown = `## Open questions\n\n- Why ${marker} → \\[x\\] &amp; (y)?\n`;
    const expected = parseOpenQuestions(markdown).questions![0].text;
    const saved = recordDecision(markdown, 0, expected, `Keep ${marker} → (x) — unchanged`, 'Pier', '2026-11-12', 'en', 'en');
    expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({ question: expected,
      answer: decisionAnswerText(`Keep ${marker} → (x) — unchanged`), author: 'Pier', applied: null });
  });

  it('ends resolved items before reports and ignores lists outside the decided section', () => {
    const markdown = '## Notes\n\n- Not a decision — Pier, 2026-11-12\n\n## Decided\n\n- Saved — Pier, 2026-11-12\n\n#### Report 2026-11-12 · Pier\n\n- Not a decision\n';
    expect(resolvedDecisionsOf(markdownParser.parse(markdown)).map(entry => entry.answer)).toEqual(['Saved']);
  });

  it.each([
    ['How does ` work?', 'Use `ticks` safely'],
    ['Why *this?', 'Keep * emphasis off'],
    ['Why [that?', 'Keep ](https://example.com) literal'],
    ['Why <span', 'data> is text'],
  ])('keeps unmatched Markdown in the question from swallowing the separator: %s', (question, answer) => {
    const markdown = `## Open questions\n\n- ${question}\n`;
    const expected = parseOpenQuestions(markdown).questions![0].text;
    const saved = recordDecision(markdown, 0, expected, answer, 'Pier', '2026-11-12', 'en', 'en');
    expect(resolvedDecisionsOf(markdownParser.parse(saved))[0]).toMatchObject({ question: expected,
      answer: decisionAnswerText(answer), author: 'Pier', date: '2026-11-12' });
  });
});

for (const eol of ['\n', '\r\n', '\r']) for (const bom of ['', '\uFEFF']) {
  it(`preserves surrounding bytes when recording questions, including legacy links (EOL=${JSON.stringify(eol)}, BOM=${!!bom})`, () => {
    const prefix = bom + ['# Правило  ', '', 'Сохранить 👣.  ', '', ''].join(eol);
    const open = ['## Open questions', '', '- First?', '  - Option A  ', '- Second?', '', '## Notes', 'Keep the final line  '].join(eol);
    const markdown = prefix + open;
    const expected = prefix + ['## Decided', '', '- First? <!-- deckmate:decision --> → Answer — Ася, 2026-11-11 <!-- deckmate:pending -->', '  - Option A  ', '', '## Open questions', '', '- Second?', '', '## Notes', 'Keep the final line  '].join(eol);
    expect(Buffer.from(recordDecision(markdown, 0, 'First?', 'Answer', 'Ася', '2026-11-11', 'en', 'en'))).toEqual(Buffer.from(expected));
    const taskId = 'card:11111111-1111-4111-8111-111111111111';
    const link = legacyDecisionLink(taskId);
    const linked = markdown.replace('- First?', '- First?' + link);
    expect(parseOpenQuestions(linked).questions?.[0].taskRef).toBe(shortReference('c', taskId));
    expect(recordDecision(linked, 0, 'First?', 'Answer', 'Ася', '2026-11-11', 'en', 'en'))
      .toBe(expected.replace('- First?', '- First?' + link));
    expect(appendSectionLine(markdown, markdownParser.parse(markdown), markerWords('openQuestions'), '- Third?' + eol))
      .toBe(markdown.replace('- Second?' + eol, '- Second?' + eol + '- Third?' + eol));
  });
}

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
    '    ## Открыто', '\t## Open questions', '## `Open` questions', '#### Open questions', '###### Открыто', '### 1.0 Slice (started)', 'Open  ', 'questions', '# Заголовок', 'Текст правила.', ''];
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
      if (markdown.startsWith('\uFEFF')) expected.questions = expected.questions?.map(question => ({ ...question, start: question.start + 1, end: question.end + 1 })) ?? null;
      if (expected.questions) sections += 1;
      expect(parseOpenQuestions(markdown, 'en'), JSON.stringify(markdown)).toEqual(expected);
    }
    // The generator must exercise both branches, or the comparison proves nothing.
    expect(sections).toBeGreaterThan(300);
  });
});
