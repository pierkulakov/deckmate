import { afterEach, expect, it, vi } from 'vitest';
import { runCli } from '../server/cli.ts';
import { runMcpServer } from '../server/mcp.ts';
import { environmentValue } from '../server/environment.ts';

const fixture = vi.hoisted(() => ({ text: '' }));
vi.mock('../server/mcp.ts', () => ({ runMcpServer: vi.fn(async () => 0) }));
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn((...args: Parameters<typeof actual.readFile>) => {
    if (String(args[0]).endsWith('.env.local')) return Promise.resolve(fixture.text);
    return actual.readFile(...args);
  }) };
});

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('loads only MCP project/member defaults from local dotenv and preserves existing environment', async () => {
  const local = {
    DECKMATE_DATA: 'local project', DECKMATE_MEMBER: 'local-agent', DECKMATE_WRITE: 'untrusted-worktree',
    DECKMATE_PYTHON: 'untrusted-python', DECKMATE_COORDINATION: 'untrusted-locks', DECKMATE_READ_ONLY: '0',
    DECKMATE_PORT: '9999', FREETION_WRITE: 'legacy-worktree', NODE_OPTIONS: '--import=untrusted.mjs',
  };
  fixture.text = Object.entries(local).map(([key, value]) => `${key}="${value}"`).join('\n');
  for (const key of Object.keys(local)) vi.stubEnv(key, undefined);
  await runCli(['mcp', '--check']);
  expect(process.env.DECKMATE_DATA).toBe('local project');
  expect(process.env.DECKMATE_MEMBER).toBe('local-agent');
  for (const key of Object.keys(local).slice(2)) expect(process.env[key], key).toBeUndefined();
  vi.stubEnv('DECKMATE_DATA', 'shell-project');
  vi.stubEnv('DECKMATE_MEMBER', 'shell-agent');
  vi.stubEnv('DECKMATE_PYTHON', 'shell-python');
  await runCli(['mcp', '--member', 'flag-agent']);
  expect(process.env.DECKMATE_DATA).toBe('shell-project');
  expect(process.env.DECKMATE_MEMBER).toBe('shell-agent');
  expect(process.env.DECKMATE_PYTHON).toBe('shell-python');
  expect(runMcpServer).toHaveBeenLastCalledWith(['--member', 'flag-agent']);
});

it('preserves the inherited legacy write policy before local MCP defaults select the new namespace', async () => {
  for (const key of Object.keys(process.env)) if (/^(DECKMATE|FREETION)_/u.test(key)) vi.stubEnv(key, undefined);
  vi.stubEnv('FREETION_DATA', 'legacy-project');
  vi.stubEnv('FREETION_READ_ONLY', '1');
  vi.stubEnv('FREETION_WRITE', 'legacy-sandbox');
  fixture.text = 'DECKMATE_MEMBER=local-agent\nDECKMATE_DATA=untrusted-project\n';
  await runCli(['mcp', '--check']);
  expect(environmentValue('READ_ONLY')).toBe('1');
  expect(environmentValue('WRITE')).toBe('legacy-sandbox');
  expect(environmentValue('DATA')).toBe('legacy-project');
});

it('does not adopt the legacy sandbox when MCP explicitly opens a different project', async () => {
  for (const key of Object.keys(process.env)) if (/^(DECKMATE|FREETION)_/u.test(key)) vi.stubEnv(key, undefined);
  vi.stubEnv('FREETION_DATA', 'legacy-project');
  vi.stubEnv('FREETION_WRITE', 'legacy-sandbox');
  fixture.text = 'DECKMATE_MEMBER=local-agent\n';
  await runCli(['mcp', '--data=other-project', '--check']);
  expect(process.env.DECKMATE_WRITE).toBeUndefined();
  expect(environmentValue('WRITE')).toBeUndefined();
  expect(runMcpServer).toHaveBeenLastCalledWith(['--data=other-project', '--check']);
});
