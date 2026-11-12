import { expect, it, afterEach, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createMcpSession, readMcpLines, type McpCaller, type McpSession } from '../server/mcp.ts';
import { agentInstructions, agentToolDefinitions, AgentToolError } from '../src/agent-tools.ts';
import { initializeDemo } from '../server/demo.ts';
import { readProjectCatalog } from '../server/catalog.ts';
import { tempProjects } from './helpers/temp-projects.ts';
import { withProjectWriteLock } from '../server/write-lock.ts';

// 2026-11-11: the session logic is checked without processes through a fake `call`; the process test drives the real
// CLI entry over piped stdin and expects only JSON lines on stdout.
const version = '2026.11.11-test';
const temps = tempProjects('deckmate-mcp-');
const children: Array<{ child: ChildProcess; closed: Promise<number | null> }> = [];

interface FakeCall {
  calls: Array<{ name: string; input: unknown; caller: McpCaller }>;
  impl: (name: string, input: unknown) => unknown;
}

function makeSession(fake: FakeCall, defaultMember?: string): { session: McpSession; lines: string[] } {
  const lines: string[] = [];
  const session = createMcpSession({
    call: async (name, input, caller) => {
      fake.calls.push({ name, input, caller });
      return fake.impl(name, input);
    },
    tools: agentToolDefinitions,
    instructions: agentInstructions,
    version,
    write: line => lines.push(line),
    defaultMember,
  });
  return { session, lines };
}

async function request(session: McpSession, lines: string[], message: unknown): Promise<Record<string, unknown>> {
  await session.handle(JSON.stringify(message));
  expect(lines.length).toBeGreaterThan(0);
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

const okFake = (): FakeCall => ({ calls: [], impl: (name, input) => ({ ok: true, name, input }) });

afterEach(async () => {
  vi.restoreAllMocks();
  for (const { child, closed } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  }
  await temps.removeAll();
});

it('negotiates a supported protocol version and names the server, tools capability and instructions', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test-client', version: '1' }, capabilities: {} },
  });
  expect(response['error']).toBeUndefined();
  const result = response['result'] as Record<string, unknown>;
  expect(result['protocolVersion']).toBe('2025-06-18');
  expect(result['capabilities']).toEqual({ tools: { listChanged: false } });
  expect(result['serverInfo']).toEqual({ name: 'deckmate', version });
  expect(result['instructions']).toBe(agentInstructions);
  expect(lines).toHaveLength(1);
});

it('answers an unsupported protocol version with the newest supported one', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-01-01', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  expect((response['result'] as Record<string, unknown>)['protocolVersion']).toBe('2025-11-25');
});

it('lists exactly the agent tool definitions', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  expect(response['error']).toBeUndefined();
  expect(response['result']).toEqual({
    tools: agentToolDefinitions.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  });
});

it('answers ping with an empty result', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, { jsonrpc: '2.0', id: 3, method: 'ping' });
  expect(response['result']).toEqual({});
});

it('returns a tool result as one compact JSON text without structuredContent', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'search', arguments: { query: 'fx' } },
  });
  expect(response['error']).toBeUndefined();
  const result = response['result'] as Record<string, unknown>;
  expect(result['structuredContent']).toBeUndefined();
  expect(result['isError']).toBeUndefined();
  const content = result['content'] as Array<Record<string, unknown>>;
  expect(content).toEqual([{ type: 'text', text: JSON.stringify({ ok: true, name: 'search', input: { query: 'fx' } }) }]);
  expect((content[0]['text'] as string).includes('\n')).toBe(false);
});

it('reports an AgentToolError as isError with the failure shape from toFailure', async () => {
  const fake: FakeCall = {
    calls: [],
    impl: () => { throw new AgentToolError('card not found', 'pass a card ID or c-ref from search'); },
  };
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'brief', arguments: { ref: 'c-0000000000' } },
  });
  const result = response['result'] as Record<string, unknown>;
  expect(result['isError']).toBe(true);
  const content = result['content'] as Array<Record<string, unknown>>;
  expect(content[0]['text']).toBe(JSON.stringify({ error: 'card not found', next: 'pass a card ID or c-ref from search' }));
});

it('reports any other tool error as isError with a schema hint as the next step', async () => {
  const fake: FakeCall = { calls: [], impl: () => { throw new Error('boom'); } };
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'next', arguments: {} },
  });
  const result = response['result'] as Record<string, unknown>;
  expect(result['isError']).toBe(true);
  const content = result['content'] as Array<Record<string, unknown>>;
  expect(content[0]['text']).toBe(JSON.stringify({ error: 'boom', next: 'check the arguments against the tool schema and retry' }));
});

it('answers an unknown tool with a protocol error without invoking the operations core', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, {
    jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'delete_everything', arguments: {} },
  });
  expect(response['result']).toBeUndefined();
  expect(response['error']).toMatchObject({ code: -32602 });
  expect(fake.calls).toEqual([]);
});

it('rejects an unknown method, broken JSON and bad params with the protocol errors', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const unknown = await request(session, lines, { jsonrpc: '2.0', id: 8, method: 'resources/list' });
  expect(unknown['error']).toEqual({ code: -32601, message: 'Method not found' });
  await session.handle('{not json');
  const parse = JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
  expect(parse['error']).toEqual({ code: -32700, message: 'Parse error' });
  expect(parse).not.toHaveProperty('id');
  const badParams = await request(session, lines, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { arguments: {} } });
  expect(badParams['error']).toEqual({ code: -32602, message: 'Invalid params' });
});

it('rejects oversized lines before JSON parsing and continues the session', async () => {
  const { session, lines } = makeSession(okFake());
  for (const line of ['{'.repeat(1024 * 1024 + 1), JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', padding: 'я'.repeat(524_288) })]) {
    await session.handle(line);
    expect(JSON.parse(lines.at(-1)!)).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' } });
  }
  const response = await request(session, lines, { jsonrpc: '2.0', id: 'still-alive', method: 'ping' });
  expect(response).toEqual({ jsonrpc: '2.0', id: 'still-alive', result: {} });
});

it('never answers notifications', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  await session.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  await session.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));
  await session.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/whatever' }));
  await session.settled();
  expect(lines).toEqual([]);
});

it('keeps the response order of two pipelined tool calls', async () => {
  const fake: FakeCall = {
    calls: [],
    impl: (name) => new Promise(resolve => setTimeout(() => resolve({ name }), name === 'next' ? 30 : 1)),
  };
  const { session, lines } = makeSession(fake);
  const first = session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'first', method: 'tools/call', params: { name: 'next', arguments: {} } }));
  const second = session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'second', method: 'tools/call', params: { name: 'search', arguments: {} } }));
  await Promise.all([first, second]);
  expect(lines).toHaveLength(2);
  const answers = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  expect(answers.map(answer => answer['id'])).toEqual(['first', 'second']);
  expect(answers.map(answer => (answer['result'] as Record<string, unknown>)['content'])).toEqual([
    [{ type: 'text', text: JSON.stringify({ name: 'next' }) }],
    [{ type: 'text', text: JSON.stringify({ name: 'search' }) }],
  ]);
});

it('passes the client name and the default member to every tool call', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake, 'glm');
  await request(session, lines, {
    jsonrpc: '2.0', id: 10, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'claude-code', version: '1' } },
  });
  await request(session, lines, { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'next', arguments: {} } });
  expect(fake.calls).toEqual([{ name: 'next', input: {}, caller: { clientName: 'claude-code', defaultMember: 'glm' } }]);
});

it('serves stdio after an oversized line, confines report files and exits 0 when stdin closes', async () => {
  const directory = await temps.create();
  const project = path.join(directory, 'project');
  await mkdir(project);
  await initializeDemo(project);
  const catalog = await readProjectCatalog(project);
  const outside = path.join(directory, 'private-report.txt');
  await writeFile(outside, 'Private text outside the project.');
  await writeFile(path.join(directory, '.env.local'), [
    `DECKMATE_DATA="${project.split(path.sep).join('/')}"`,
    `DECKMATE_MEMBER=${catalog.members!.find(member => member.kind === 'agent')!.id}`,
    'DECKMATE_WRITE=missing-untrusted-worktree', 'DECKMATE_PYTHON=untrusted-python',
    'DECKMATE_COORDINATION=untrusted-coordination',
  ].join('\n'));
  // The entry file mirrors bin/deckmate.mjs: the same argv semantics as a real process.
  const launcher = new URL('../server/cli.ts', import.meta.url).href;
  const entry = path.join(directory, 'cli.mjs');
  await writeFile(entry, `const { runCli } = await import(${JSON.stringify(launcher)}); const code = await runCli(); if (code) process.exitCode = code;`);
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'stdio-test', version: '1' } } }),
    '{'.repeat(1024 * 1024 + 1),
    JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }),
    JSON.stringify({ jsonrpc: '2.0', id: 'report', method: 'tools/call', params: { name: 'report', arguments: {
      ref: catalog.cards.find(card => card.kind === 'task')!.id, file: outside,
    } } }),
    '',
  ].join('\n');
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '' };
  for (const key of Object.keys(env)) if (/^(?:DECKMATE|FREETION)_/u.test(key)) delete env[key];
  const child = spawn(process.execPath, [entry, 'mcp'], { cwd: directory, windowsHide: true, env });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  children.push({ child, closed });
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error; });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  child.stdin.end(input);
  const code = await closed;
  if (spawnError) throw spawnError;
  // stderr carries diagnostics only (for example why the project did not open); stdout must stay pure protocol.
  void stderr;
  expect(code).toBe(0);
  const lines = stdout.split('\n').filter(line => line.length > 0);
  expect(lines.length).toBe(4);
  const answers = lines.map(line => JSON.parse(line) as Record<string, unknown>);
  expect(answers[0]['id']).toBe('init');
  expect((answers[0]['result'] as Record<string, unknown>)['serverInfo']).toMatchObject({ name: 'deckmate' });
  expect(answers[1]['error']).toMatchObject({ code: -32600 });
  expect(answers[2]['id']).toBe('list');
  expect(answers[2]['result']).toEqual({
    tools: agentToolDefinitions.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
  });
  expect(answers[3]['id']).toBe('report');
  expect(answers[3]['result']).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('pass the report as text, or save it inside the project') }] });
  expect(lines[3]).not.toContain('Private text outside the project.');
}, 60000);

it.each([null, true, [], {}, 1.5, Infinity])('rejects invalid request id %j before executing a tool', async id => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const line = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search' } });
  await session.handle(id === Infinity ? line.replace('"id":null', '"id":1e400') : line);
  expect(JSON.parse(lines.at(-1)!)).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' } });
  expect(fake.calls).toEqual([]);
});

it.each([0, '', -1, 'строка'])('echoes valid request id %j', async id => {
  const { session, lines } = makeSession(okFake());
  expect(await request(session, lines, { jsonrpc: '2.0', id, method: 'ping' })).toEqual({ jsonrpc: '2.0', id, result: {} });
});

const initializeParams = { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

it.each([
  undefined, {}, { ...initializeParams, protocolVersion: 1 }, { ...initializeParams, capabilities: undefined },
  { ...initializeParams, capabilities: [] }, { ...initializeParams, clientInfo: 1 },
  { ...initializeParams, clientInfo: { name: 'test' } }, { ...initializeParams, clientInfo: { name: 1, version: '1' } },
])('rejects incomplete initialize params %j', async params => {
  const { session, lines } = makeSession(okFake());
  const response = await request(session, lines, { jsonrpc: '2.0', id: 1, method: 'initialize', params });
  expect(response).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } });
});

it.each([
  ['ping', 123], ['ping', []], ['tools/list', null], ['tools/list', []], ['tools/list', { cursor: 123 }],
  ['tools/list', { _meta: 1 }], ['tools/call', { name: 'search', _meta: 1 }],
  ['ping', { _meta: { progressToken: null } }], ['tools/list', { _meta: { progressToken: true } }],
  ['tools/call', { name: 'search', arguments: null }], ['initialize', { ...initializeParams, _meta: [] }],
])('rejects invalid %s params %j', async (method, params) => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const response = await request(session, lines, { jsonrpc: '2.0', id: 1, method, params });
  expect(response['error']).toEqual({ code: -32602, message: 'Invalid params' });
  expect(fake.calls).toEqual([]);
});

it('allows protocol extensions, object metadata, cursors and omitted tool arguments', async () => {
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  const messages = [
    { method: 'initialize', params: { ...initializeParams, extension: true, capabilities: { custom: {} }, _meta: { custom: 1 } } },
    { method: 'ping', params: { extension: true, _meta: {} } },
    { method: 'tools/list', params: { cursor: '', _meta: {} } },
    { method: 'tools/call', params: { name: 'search', _meta: { progressToken: 0 }, extension: true } },
  ];
  for (const [id, message] of messages.entries()) {
    expect(await request(session, lines, { jsonrpc: '2.0', id, ...message })).not.toHaveProperty('error');
  }
  expect(fake.calls).toHaveLength(1);
  expect(fake.calls[0].input).toEqual({});
});

it.each(['2025-11-25', '2025-06-18'])('formats unknown error ids for negotiated %s and preserves known ids', async protocolVersion => {
  const { session, lines } = makeSession(okFake());
  await request(session, lines, { jsonrpc: '2.0', id: 'init', method: 'initialize', params: { ...initializeParams, protocolVersion } });
  for (const invalid of ['{not json', 'null', '42', '[]', '{}', '{"jsonrpc":"2.0","id":true,"method":"ping"}', '{'.repeat(1024 * 1024 + 1)]) {
    await session.handle(invalid);
    const response = JSON.parse(lines.at(-1)!);
    expect(response.error).toBeDefined();
    if (protocolVersion === '2025-11-25') expect(response).not.toHaveProperty('id');
    else expect(response.id).toBeNull();
  }
  expect(await request(session, lines, { jsonrpc: 'wrong', id: 0, method: 'ping' }))
    .toEqual({ jsonrpc: '2.0', id: 0, error: { code: -32600, message: 'Invalid Request' } });
});

it('answers ping and notifications independently of a pending tool, while keeping tools sequential', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const fake: FakeCall = { calls: [], impl: async () => { await blocked; return {}; } };
  const { session, lines } = makeSession(fake);
  const first = session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'slow', method: 'tools/call', params: { name: 'search' } }));
  const second = session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'next', method: 'tools/call', params: { name: 'next' } }));
  const ping = session.handle(JSON.stringify({ jsonrpc: '2.0', id: 'ping', method: 'ping' }));
  try {
    await vi.waitFor(() => expect(lines.map(line => JSON.parse(line).id)).toEqual(['ping']), { timeout: 500 });
    await session.handle(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'slow' } }));
    expect(fake.calls).toHaveLength(1);
  } finally { release(); }
  await Promise.all([first, second, ping, session.settled()]);
  expect(lines.map(line => JSON.parse(line).id)).toEqual(['ping', 'slow', 'next']);
});

it('rate limits tool admissions per minute without affecting ping, and reopens the next window', async () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const fake = okFake();
  const { session, lines } = makeSession(fake);
  for (let id = 0; id < 60; id += 1) {
    expect(await request(session, lines, { jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search' } })).not.toHaveProperty('error');
  }
  const limited = await request(session, lines, { jsonrpc: '2.0', id: 'limited', method: 'tools/call', params: { name: 'search' } });
  expect(limited['error']).toMatchObject({ code: -32000, data: { retryAfterMs: 60_000 } });
  expect(fake.calls).toHaveLength(60);
  expect(await request(session, lines, { jsonrpc: '2.0', id: 'ping', method: 'ping' })).toHaveProperty('result');
  clock.mockReturnValue(60_000);
  expect(await request(session, lines, { jsonrpc: '2.0', id: 'later', method: 'tools/call', params: { name: 'search' } })).not.toHaveProperty('error');
  expect(fake.calls).toHaveLength(61);
});

it('bounds the pending tool queue and settles every admitted request at EOF', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const fake: FakeCall = { calls: [], impl: async () => { await blocked; return {}; } };
  const { session, lines } = makeSession(fake);
  const requests = Array.from({ length: 17 }, (_, id) => session.handle(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'search' } })));
  try {
    await vi.waitFor(() => expect(lines.map(line => JSON.parse(line))).toEqual([
      expect.objectContaining({ id: 16, error: expect.objectContaining({ code: -32000 }) }),
    ]), { timeout: 500 });
    expect(fake.calls).toHaveLength(1);
  } finally { release(); }
  await session.settled();
  await Promise.all(requests);
  expect(fake.calls).toHaveLength(16);
  expect(lines).toHaveLength(17);
});

it('reads stdio ping while a real tool waits for the project write lock', async () => {
  const directory = await temps.create();
  const project = path.join(directory, 'project');
  await mkdir(project);
  await initializeDemo(project);
  const entry = path.join(directory, 'cli.mjs');
  await writeFile(entry, `const { runCli } = await import(${JSON.stringify(new URL('../server/cli.ts', import.meta.url).href)}); await runCli();`);
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '' };
  for (const key of Object.keys(env)) if (/^(?:DECKMATE|FREETION)_/u.test(key)) delete env[key];
  env.DECKMATE_COORDINATION = path.join(directory, 'coordination');
  vi.stubEnv('DECKMATE_COORDINATION', env.DECKMATE_COORDINATION);
  const child = spawn(process.execPath, [entry, 'mcp', '--data', project], { cwd: directory, windowsHide: true, env });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  children.push({ child, closed });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  const answers = () => stdout.split('\n').filter(Boolean).map(line => JSON.parse(line));
  try {
    await withProjectWriteLock(project, async () => {
      child.stdin.write([
        JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: initializeParams }),
        JSON.stringify({ jsonrpc: '2.0', id: 'write', method: 'tools/call', params: { name: 'create_cards', arguments: { cards: [{ title: 'Ping regression' }] } } }),
        JSON.stringify({ jsonrpc: '2.0', id: 'ping', method: 'ping' }), '',
      ].join('\n'));
      await vi.waitFor(() => expect(answers().map(answer => answer.id)).toContain('ping'), { timeout: 5000 });
      expect(answers().map(answer => answer.id)).not.toContain('write');
    });
    child.stdin.end();
    expect(await closed).toBe(0);
    expect(answers().map(answer => answer.id)).toEqual(['init', 'ping', 'write']);
  } finally { vi.unstubAllEnvs(); }
}, 60000);

it('rejects an oversized unterminated stdio line before EOF and recovers at the next newline', async () => {
  const directory = await temps.create();
  const entry = path.join(directory, 'cli.mjs');
  await writeFile(entry, `const { runCli } = await import(${JSON.stringify(new URL('../server/cli.ts', import.meta.url).href)}); await runCli();`);
  const child = spawn(process.execPath, [entry, 'mcp', '--data', directory], { cwd: directory, windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: '' } });
  const closed = new Promise<number | null>(resolve => child.once('close', resolve));
  children.push({ child, closed });
  let stdout = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stdin.write('я'.repeat(524_289));
  await vi.waitFor(() => expect(stdout).toContain('"code":-32600'), { timeout: 3000 });
  child.stdin.end('\n' + JSON.stringify({ jsonrpc: '2.0', id: 'alive', method: 'ping' }) + '\n');
  expect(await closed).toBe(0);
  expect(stdout.trim().split('\n').map(line => JSON.parse(line))).toEqual([
    { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request' } },
    { jsonrpc: '2.0', id: 'alive', result: {} },
  ]);
}, 10000);

it('bounds streamed frames by bytes, preserves split UTF-8 and accepts a final line at EOF', async () => {
  const exact = 'я'.repeat(524_288);
  const bytes = Buffer.from(exact + '\n' + 'x'.repeat(1024 * 1024 + 1) + '\r\nПривет\r\nfinal');
  async function* chunks() {
    yield bytes.subarray(0, 1);
    yield bytes.subarray(1, 17);
    yield bytes.subarray(17);
  }
  const lines: Array<string | null> = [];
  for await (const line of readMcpLines(chunks())) lines.push(line);
  expect(lines.map(line => line?.length ?? null)).toEqual([524_288, null, 7, 5]);
  expect(lines[0] === exact).toBe(true);
  expect(lines.slice(1)).toEqual([null, 'Привет\r', 'final']);
});
