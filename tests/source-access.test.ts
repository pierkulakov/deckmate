import { afterEach, expect, it, vi } from 'vitest';
import { setLang } from '../client/i18n.ts';
import { readOnlyAccess, readOnlyDescription } from '../client/source-access.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

vi.hoisted(() => {
  vi.stubGlobal('document', { documentElement: { lang: '' }, cookie: '' });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
});
afterEach(() => setLang('en'));

it.each([
  { editMode: 'sandbox', source: 'sandbox', writable: true, description: '', action: null },
  { editMode: 'direct', source: 'sandbox', writable: true, description: '', action: null },
  { editMode: 'sandbox', source: 'live', writable: false, description: 'The original is open for reading only.', action: 'Open test copy →' },
  { editMode: 'sandbox', source: 'sandbox', writable: false, description: 'The original is open for reading only.', action: 'Open test copy →' },
  { editMode: 'direct', source: 'live', writable: false, description: 'This project is open for reading only.', action: null },
  { editMode: 'read-only', source: 'live', writable: false, description: 'This project is open for reading only.', action: null },
  { editMode: 'read-only', source: 'sandbox', writable: false, description: 'This project is open for reading only.', action: null },
] as const)('describes read-only access once for $editMode/$source/writable=$writable', row => {
  const snapshot: WorkspaceSnapshot & { token: string } = { projectName: 'Interface states', token: 'test-token', iteration: { number: 1, goal: '', start: '' },
    editMode: row.editMode, source: row.source, writable: row.writable };
  setLang('en');
  expect(readOnlyAccess(snapshot)).toEqual({ description: row.description, action: row.action });
  expect(readOnlyDescription(snapshot)).toBe(row.description);
  setLang('ru');
  const access = readOnlyAccess(snapshot);
  let expectedRu = '';
  if (row.description === 'The original is open for reading only.') expectedRu = 'Оригинал открыт только для чтения.';
  else if (row.description === 'This project is open for reading only.') expectedRu = 'Проект открыт только для чтения.';
  expect(access.description).toBe(expectedRu);
  expect(access.action).toBe(row.action === null ? null : 'Открыть тестовую копию →');
});
