import { expect, it } from 'vitest';
import { resolveMember } from '../src/members.ts';
import type { CatalogMember } from '../src/catalog-contracts.ts';

const members: CatalogMember[] = [
  { id: 'glm', label: 'GLM', kind: 'agent', aliases: [] },
  { id: 'kimi', label: 'Kimi', kind: 'agent', aliases: [] },
  { id: 'pavel', label: 'Павел', kind: 'human', aliases: ['Паша'] },
  { id: 'opus', label: 'Opus', kind: 'agent', aliases: [] },
];
it('recognizes explicit leading participants without treating notes or generic agent brands as models', () => {
  expect(resolveMember('GLM по ТЗ, приём — Claude', members)).toBe('GLM');
  expect(resolveMember(' kimi · около 1 ч ', members)).toBe('Kimi');
  expect(resolveMember('Паша — приёмка', members)).toBe('Павел');
  for (const value of ['в main 13da, GLM', ', после итерации 1', 'Claude, ревью', 'Codex по слову Павла', 'GLM-C', null]) {
    expect(resolveMember(value, members), value ?? 'null').toBe(null);
  }
  expect(resolveMember('GLM', [])).toBe(null);
});
