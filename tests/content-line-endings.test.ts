import { afterEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readCardContent, updateCardContent } from '../server/card-content.ts';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.each(['\n', '\r\n', '\r'])('reads and edits a legacy Doc with %j while preserving every other byte', async eol => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-content-eol-'));
  roots.push(root);
  await mkdir(path.join(root, 'docs'));
  const filename = path.join(root, 'docs/правило 👣.md');
  const prefix = '\uFEFF---\r\ncustom: keep  \r\n---\r\n';
  const body = ['Первый абзац.  ', '', '## Notes', 'Last line  '].join(eol);
  const original = prefix + '# Правило ###  ' + eol + body;
  await writeFile(filename, original);
  const cardId = 'doc:docs/правило 👣.md';
  const content = await readCardContent(root, cardId);
  expect(content.title).toBe('Правило');
  expect(content.markdown).toBe(body);
  await updateCardContent(root, { action: 'update-card-content', ...content, title: 'Новое правило', manifestHash: '' });
  expect(await readFile(filename)).toEqual(Buffer.from(original.replace('# Правило', '# Новое правило')));
});

for (const endings of [['\r', '\r', '\r'], ['\r\n', '\r\n', '\r\n'], ['\n', '\n', '\n'],
  ['\r\n', '\n', '\r'], ['\r', '\r\n', '\n']]) {
  for (const bom of ['', '\uFEFF']) for (const spaces of ['', '  ']) {
    it(`changes only body text (EOL=${JSON.stringify(endings)}, BOM=${!!bom}, spaces=${!!spaces})`, async () => {
      const root = await mkdtemp(path.join(tmpdir(), 'deckmate-content-eol-'));
      roots.push(root);
      await mkdir(path.join(root, 'docs'));
      const filename = path.join(root, 'docs/rule.md');
      const original = bom + '# Rule' + endings[0] + 'Keep before.' + spaces + endings[1]
        + 'Old body.' + spaces + endings[2] + '## Notes' + endings[0] + 'Keep 👣.' + spaces;
      await writeFile(filename, original);
      const content = await readCardContent(root, 'doc:docs/rule.md');
      await updateCardContent(root, { action: 'update-card-content', ...content,
        markdown: content.markdown.replace('Old', 'New'), manifestHash: '' });
      expect(await readFile(filename)).toEqual(Buffer.from(original.replace('Old', 'New')));
    });
  }
}

it.each(['\r', '\r\n', '\n'])('uses %j for newly inserted body lines without splitting a CRLF', async eol => {
  const root = await mkdtemp(path.join(tmpdir(), 'deckmate-content-eol-'));
  roots.push(root);
  await mkdir(path.join(root, 'docs'));
  const filename = path.join(root, 'docs/rule.md');
  await writeFile(filename, '# Rule' + eol + 'Old' + eol + 'Keep');
  const content = await readCardContent(root, 'doc:docs/rule.md');
  await updateCardContent(root, { action: 'update-card-content', ...content,
    markdown: 'New\nAdded\nKeep', manifestHash: '' });
  expect(await readFile(filename, 'utf8')).toBe('# Rule' + eol + 'New' + eol + 'Added' + eol + 'Keep');
});
