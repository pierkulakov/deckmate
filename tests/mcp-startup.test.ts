import { afterEach, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import { runMcpServer } from '../server/mcp.ts';

const project = vi.hoisted(() => ({ imports: 0, open: vi.fn(), call: vi.fn(async () => ({ cards: [] })) }));
vi.mock('../server/agent-ops.ts', () => {
  project.imports += 1;
  return { openAgentProject: project.open, callAgentTool: project.call };
});

afterEach(() => vi.restoreAllMocks());

it('negotiates without importing project operations and answers ping while the first tool is opening the project', async () => {
  const input = new PassThrough();
  const lines: Array<{ id: string; result?: unknown }> = [];
  vi.spyOn(process, 'stdin', 'get').mockReturnValue(input as unknown as typeof process.stdin);
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => {
    lines.push(JSON.parse(String(chunk)));
    return true;
  });
  let release!: () => void;
  project.open.mockImplementation(() => new Promise(resolve => { release = () => resolve({ root: 'project' }); }));
  const running = runMcpServer(['--data', 'project']);
  const send = (id: string, method: string, params?: unknown) => input.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  try {
    send('init', 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'startup', version: '1' } });
    send('list', 'tools/list');
    await vi.waitFor(() => expect(lines.map(line => line.id)).toEqual(['init', 'list']));
    expect(project.imports).toBe(0);
    send('search', 'tools/call', { name: 'search', arguments: {} });
    send('ping', 'ping');
    await vi.waitFor(() => expect(project.open).toHaveBeenCalledTimes(1));
    expect(lines.map(line => line.id)).toEqual(['init', 'list', 'ping']);
    send('again', 'tools/call', { name: 'search', arguments: {} });
    release();
    input.end();
    await running;
    expect(project.open).toHaveBeenCalledTimes(1);
    expect(project.call).toHaveBeenCalledTimes(2);
    expect(project.call).toHaveBeenLastCalledWith({ root: 'project' }, 'search', {}, expect.objectContaining({ source: 'mcp', clientName: 'startup' }));
    expect(lines.map(line => line.id)).toEqual(['init', 'list', 'ping', 'search', 'again']);
  } finally {
    release?.();
    input.end();
    await running;
  }
});
