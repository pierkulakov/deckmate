import { afterEach, expect, it, vi } from 'vitest';
import { AgentToolError } from '../src/agent-tools.ts';
import { callAgentTool } from '../server/agent-ops.ts';
import { run as create } from '../tools/commands/create.ts';
import { run as update } from '../tools/commands/update.ts';
import type { CommandContext } from '../tools/commands/types.ts';

vi.mock('../server/agent-ops.ts', () => ({ callAgentTool: vi.fn() }));
const exitCode = process.exitCode;
const context: CommandContext = {
  root: 'fixture', source: 'sandbox',
  config: { dataRoot: 'fixture', writeRoot: 'fixture', editMode: 'direct', projectName: 'Test', port: 4317, python: 'python' },
  catalog: { rootIdentity: 'fixture', documents: [], cards: [], spaces: [], decks: [], tracks: [], warnings: [], formatLanguage: 'en', manifestHash: '',
    configured: true, indexedAt: '', members: [{ id: 'explicit', label: 'Explicit', kind: 'agent', aliases: [] }] },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  process.exitCode = exitCode;
});

it.each([create, update])('prints the complete agent failure and exits 1', async run => {
  const failure = new AgentToolError('Saved, but reread failed', 'call brief before retrying', true);
  vi.mocked(callAgentTool).mockRejectedValueOnce(failure);
  const output = vi.spyOn(console, 'log').mockImplementation(() => {});
  await run(context, ['card-or-title'], new Map());
  expect(JSON.parse(output.mock.calls[0][0])).toEqual(failure.toFailure());
  expect(process.exitCode).toBe(1);
});

it.each([create, update])('uses DECKMATE_MEMBER as the default while preserving explicit member', async run => {
  vi.stubEnv('DECKMATE_MEMBER', 'ambient');
  vi.mocked(callAgentTool).mockResolvedValue({} as never);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await run(context, ['card-or-title'], new Map());
  expect(callAgentTool).toHaveBeenLastCalledWith(context, expect.any(String), expect.objectContaining({ member: undefined }),
    { defaultMember: 'ambient', source: 'cli' });
  await run(context, ['card-or-title'], new Map([['member', 'explicit']]));
  expect(callAgentTool).toHaveBeenLastCalledWith(context, expect.any(String), expect.objectContaining({ member: 'explicit' }),
    { defaultMember: 'ambient', source: 'cli' });
});
