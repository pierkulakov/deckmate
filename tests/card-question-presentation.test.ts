import { afterAll, describe, expect, it, vi } from 'vitest';
import { parseEditorMarkdown, toggleEditorChecklist } from '../client/editor-checklists.ts';
import { openQuestionsOf } from '../src/open-questions.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('localStorage', { getItem: () => null });
});
const { questionReadingTree } = await import('../client/components/OpenQuestions.tsx');
afterAll(() => vi.unstubAllGlobals());

describe('question presentation without changing Markdown', () => {
  it('moves only the recognized list, keeping unknown content, nested options and later sections intact', () => {
    const markdown = 'Intro\n\n## Открыто\n\nContext before the question.\n\n- Which light?\n  - Warm\n  - Cold\n\n```text\nKeep this code\n```\n\n## After\n\n- [ ] Other task\n';
    const original = parseEditorMarkdown(markdown);
    const snapshot = JSON.stringify(original);
    const question = openQuestionsOf(original).questions![0];
    const shown = questionReadingTree(original);
    expect(JSON.stringify(original)).toBe(snapshot);
    expect(JSON.stringify(shown)).not.toContain('Which light?');
    expect(JSON.stringify(shown)).toContain('Context before the question.');
    expect(JSON.stringify(shown)).toContain('Keep this code');
    expect(markdown.slice(question.start, question.end)).toContain('  - Cold');
    const checklist = shown.children.find(node => node.type === 'list')!;
    expect(checklist.type).toBe('list');
    if (checklist.type === 'list') expect(toggleEditorChecklist(markdown, checklist.children[0].position!.start.offset!, true)).toBe(markdown.replace('[ ] Other task', '[x] Other task'));
  });
  it('drops the replaced heading but preserves a second unrecognized questions section', () => {
    const tree = parseEditorMarkdown('## Open questions\n\n- First?\n\n## Open questions\n\n- Second?\n');
    const reading = questionReadingTree(tree);
    expect(JSON.stringify(reading)).not.toContain('First?');
    expect(JSON.stringify(reading)).toContain('Second?');
    expect(reading.children.filter(node => node.type === 'heading')).toHaveLength(1);
    expect(openQuestionsOf(tree).warnings).toHaveLength(1);
  });
  it('uses no space for an empty section, while keeping loose unrecognized text', () => {
    expect(questionReadingTree(parseEditorMarkdown('## Открыто\n')).children).toEqual([]);
    const tree = parseEditorMarkdown('## Открыто\n\nUnrecognized text.\n');
    expect(questionReadingTree(tree)).toEqual(tree);
  });
  it('does not reinterpret report lists as questions', () => {
    const tree = parseEditorMarkdown('## Открыто\n\n- Question?\n\n#### Report 2026-11-11 · Maya\n\n- Keep report\n');
    const reading = questionReadingTree(tree);
    expect(JSON.stringify(reading)).not.toContain('Question?');
    expect(JSON.stringify(reading)).toContain('Keep report');
  });
});
