// 2026-11-11: the MCP transport for the agent tool contract (src/agent-tools.ts). One JSON-RPC 2.0 message per line
// over standard input/output, so any client that can spawn a process and pipe text can take work from the board;
// stdout carries protocol bytes only, everything diagnostic goes to stderr.
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { agentInstructions, agentToolDefinitions, AgentToolError, type AgentToolDefinition, type AgentToolName } from '../src/agent-tools.ts';
import type { AgentCaller, AgentProject } from './agent-ops.ts';
import { environmentValue } from './environment.ts';
import { defineText, serverText } from './i18n.ts';
import { packagePath } from './package-path.ts';

const messages = defineText({
  help: `Usage: deckmate mcp [--data <folder>] [--member <id>] [--check]

Model Context Protocol server over standard input and output, for AI clients
that take work from the project board. The client sends one JSON-RPC message
per line; after initialize, tools/list names the board tools and tools/call
runs them against the project files.

Options:
  --data <folder>    Project folder; without it DECKMATE_DATA wins, then the nearest folder up from here with a board.
  --member <id>      Default member for tool calls; without it DECKMATE_MEMBER wins.
  --check            Print the project folder, default member, running server and tool list size, then exit.
  -h, --help         Print this help.

Example: deckmate mcp --data ./project --member agent
`,
  usage: 'Usage: deckmate mcp [--data <folder>] [--member <id>] [--check]. See deckmate mcp --help.',
  projectMissing: 'Project: not found.',
  projectHint: 'Pass --data <folder> or set DECKMATE_DATA to the project folder; see deckmate mcp --help.',
  project: (root: string) => `Project folder: ${root}`,
  member: (id: string) => `Default member: ${id}`,
  memberUnset: 'Default member: not set; the agent passes member or DECKMATE_MEMBER',
  serverRunning: (port: number, pid: number) => `Running Deckmate server: port ${port} (pid ${pid})`,
  serverNone: 'Running Deckmate server: none; the project files are written directly',
  serverUnknown: 'Running Deckmate server: unknown',
  tools: (count: number, tokens: number) => `Tools: ${count} (tools/list is about ${tokens} estimated tokens)`,
  rateLimited: 'Tool invocation limit exceeded',
}, {
  help: `Использование: deckmate mcp [--data <папка>] [--member <id>] [--check]

Сервер Model Context Protocol через стандартный ввод-вывод для ИИ-клиентов,
которые берут работу с доски проекта. Клиент отправляет одно JSON-RPC
сообщение на строку; после initialize команда tools/list перечисляет
инструменты доски, а tools/call выполняет их над файлами проекта.

Опции:
  --data <папка>     Папка проекта; без неё сначала действует DECKMATE_DATA, затем ближайшая папка с доской вверх отсюда.
  --member <id>      Участник по умолчанию для вызовов инструментов; без него действует DECKMATE_MEMBER.
  --check            Напечатать папку проекта, участника по умолчанию, запущенный сервер и размер списка инструментов, затем выйти.
  -h, --help         Напечатать эту справку.

Пример: deckmate mcp --data ./project --member agent
`,
  usage: 'Использование: deckmate mcp [--data <папка>] [--member <id>] [--check]. Смотрите deckmate mcp --help.',
  projectMissing: 'Проект: не найден.',
  projectHint: 'Передайте --data <папка> или задайте DECKMATE_DATA с папкой проекта; смотрите deckmate mcp --help.',
  project: (root: string) => `Папка проекта: ${root}`,
  member: (id: string) => `Участник по умолчанию: ${id}`,
  memberUnset: 'Участник по умолчанию: не задан; агент передаёт member или DECKMATE_MEMBER',
  serverRunning: (port: number, pid: number) => `Запущенный сервер Deckmate: порт ${port} (pid ${pid})`,
  serverNone: 'Запущенный сервер Deckmate: нет; файлы проекта пишутся напрямую',
  serverUnknown: 'Запущенный сервер Deckmate: неизвестно',
  tools: (count: number, tokens: number) => `Инструменты: ${count} (tools/list — примерно ${tokens} оценённых токенов)`,
  rateLimited: 'Превышен лимит вызовов инструментов',
});

/** MCP protocol revisions this build speaks, newest first; initialize falls back to the newest. */
export const mcpProtocolVersions = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

// JSON-RPC and MCP fix these strings; they travel to machines, not to people, so they stay untranslated English.
const protocolText = {
  parseError: 'Parse error',
  invalidRequest: 'Invalid Request',
  methodNotFound: 'Method not found',
  invalidParams: 'Invalid params',
} as const;
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const TOOL_LIMIT_EXCEEDED = -32000;
const toolWindowMs = 60_000;
const toolsPerWindow = 60;
const pendingToolLimit = 16;
const inputByteLimit = 1024 * 1024;
type RequestId = string | number;
type ProtocolVersion = typeof mcpProtocolVersions[number];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRequestId = (value: unknown): value is RequestId =>
  typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value));

function validParams(method: string, params: unknown): boolean {
  if (params !== undefined && !isRecord(params)) return false;
  if (isRecord(params) && params['_meta'] !== undefined && !isRecord(params['_meta'])) return false;
  if (isRecord(params) && isRecord(params['_meta']) && params['_meta']['progressToken'] !== undefined
    && !isRequestId(params['_meta']['progressToken'])) return false;
  if (method === 'initialize') {
    return isRecord(params) && typeof params['protocolVersion'] === 'string' && isRecord(params['capabilities'])
      && isRecord(params['clientInfo']) && typeof params['clientInfo']['name'] === 'string'
      && typeof params['clientInfo']['version'] === 'string';
  }
  if (method === 'tools/list') return params === undefined || params['cursor'] === undefined || typeof params['cursor'] === 'string';
  if (method === 'tools/call') {
    return isRecord(params) && typeof params['name'] === 'string'
      && (params['arguments'] === undefined || isRecord(params['arguments']));
  }
  return true;
}

export interface McpCaller { clientName?: string; defaultMember?: string }

export interface McpSessionOptions {
  /** Runs one tool against the project; throws AgentToolError (src/agent-tools.ts) for failures an agent can act on. */
  call: (name: AgentToolName, input: unknown, caller: McpCaller) => Promise<unknown>;
  tools: readonly AgentToolDefinition[];
  instructions: string;
  version: string;
  /** Receives exactly one response line, without the trailing newline. */
  write: (line: string) => void;
  defaultMember?: string;
}

export interface McpSession {
  /** Tool calls run in arrival order; control messages are answered independently. */
  handle: (line: string) => Promise<void>;
  /** Resolves when every enqueued message has been answered. */
  settled: () => Promise<void>;
  rejectOversizedLine: () => void;
}

/** 2026-11-12: discard oversized frames while receiving bytes, including lines that never terminate. */
export async function* readMcpLines(input: AsyncIterable<Buffer>): AsyncGenerator<string | null> {
  const buffer = Buffer.alloc(inputByteLimit);
  let length = 0;
  let discarding = false;
  for await (const chunk of input) {
    let offset = 0;
    while (offset < chunk.length) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline;
      if (!discarding) {
        if (length + end - offset > inputByteLimit) {
          length = 0;
          discarding = true;
          yield null;
        } else {
          chunk.copy(buffer, length, offset, end);
          length += end - offset;
        }
      }
      if (newline < 0) break;
      if (!discarding) yield buffer.toString('utf8', 0, length);
      length = 0;
      discarding = false;
      offset = newline + 1;
    }
  }
  if (length && !discarding) yield buffer.toString('utf8', 0, length);
}

export function createMcpSession(options: McpSessionOptions): McpSession {
  let clientName: string | undefined;
  let protocolVersion: ProtocolVersion = mcpProtocolVersions[0];
  // 2026-11-12: tools observe prior writes, but a waiting write must never block the transport's liveness probe.
  let tail: Promise<void> = Promise.resolve();
  let pendingTools = 0;
  let windowStarted = performance.now();
  let windowCalls = 0;

  const send = (message: Record<string, unknown>) => options.write(JSON.stringify(message));
  function sendError(code: number, message: string, id?: RequestId, data?: unknown): void {
    const response: Record<string, unknown> = { jsonrpc: '2.0', error: { code, message, ...(data === undefined ? {} : { data }) } };
    if (id !== undefined) response['id'] = id;
    else if (protocolVersion !== '2025-11-25') response['id'] = null;
    send(response);
  }

  async function callTool(tool: AgentToolDefinition, input: unknown, id: RequestId, caller: McpCaller): Promise<void> {
    let output: unknown;
    try {
      output = await options.call(tool.name, input, caller);
    } catch (error) {
      // Every tool failure is data for the model, not a protocol error: isError carries the same compact
      // AgentToolFailure shape the operations core defines.
      const failure = error instanceof AgentToolError
        ? error.toFailure()
        : { error: error instanceof Error ? error.message : String(error), next: 'check the arguments against the tool schema and retry' };
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(failure) }], isError: true } });
      return;
    }
    // Compact JSON without structuredContent: MCP clients put both into the context, so a duplicate would double the bill.
    send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(output) }] } });
  }

  function dispatch(method: string, params: Record<string, unknown> | undefined, id: RequestId): Promise<void> | void {
    const respond = (result: unknown) => send({ jsonrpc: '2.0', id, result });
    switch (method) {
      case 'initialize': {
        const requested = params?.['protocolVersion'];
        protocolVersion = mcpProtocolVersions.find(version => version === requested) ?? mcpProtocolVersions[0];
        const clientInfo = params?.['clientInfo'];
        if (isRecord(clientInfo) && typeof clientInfo['name'] === 'string') clientName = clientInfo['name'];
        respond({
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'deckmate', version: options.version },
          instructions: options.instructions,
        });
        return;
      }
      case 'ping':
        respond({});
        return;
      case 'tools/list':
        respond({ tools: options.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) });
        return;
      case 'tools/call': {
        const tool = options.tools.find(candidate => candidate.name === params?.['name']);
        if (!tool) {
          sendError(INVALID_PARAMS, protocolText.invalidParams, id, { tools: options.tools.map(entry => entry.name) });
          return;
        }
        const now = performance.now();
        if (now - windowStarted >= toolWindowMs) { windowStarted = now; windowCalls = 0; }
        if (windowCalls >= toolsPerWindow || pendingTools >= pendingToolLimit) {
          sendError(TOOL_LIMIT_EXCEEDED, serverText(messages).rateLimited, id, { retryAfterMs: Math.ceil(toolWindowMs - (now - windowStarted)) });
          return;
        }
        windowCalls += 1;
        pendingTools += 1;
        const caller = { clientName, defaultMember: options.defaultMember };
        const operation = tail.then(() => callTool(tool, params?.['arguments'] ?? {}, id, caller))
          .finally(() => { pendingTools -= 1; });
        tail = operation.catch(() => {});
        return operation;
      }
      default:
        sendError(METHOD_NOT_FOUND, protocolText.methodNotFound, id);
    }
  }

  async function handle(line: string): Promise<void> {
    if (Buffer.byteLength(line, 'utf8') > inputByteLimit) {
      sendError(INVALID_REQUEST, protocolText.invalidRequest);
      return;
    }
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
    if (!trimmed.trim()) return;
    let message: unknown;
    try {
      message = JSON.parse(trimmed);
    } catch {
      sendError(PARSE_ERROR, protocolText.parseError);
      return;
    }
    const echoed = isRecord(message) && isRequestId(message['id']) ? message['id'] : undefined;
    if (!isRecord(message) || message['jsonrpc'] !== '2.0' || typeof message['method'] !== 'string'
      || ('id' in message && echoed === undefined)) {
      sendError(INVALID_REQUEST, protocolText.invalidRequest, echoed);
      return;
    }
    if (echoed === undefined) return; // notifications (initialized, cancelled, others) never get a response
    if (!validParams(message['method'], message['params'])) {
      sendError(INVALID_PARAMS, protocolText.invalidParams, echoed);
      return;
    }
    return dispatch(message['method'], isRecord(message['params']) ? message['params'] : undefined, echoed);
  }

  return { handle, settled: () => tail, rejectOversizedLine: () => sendError(INVALID_REQUEST, protocolText.invalidRequest) };
}

/** Entry of `deckmate mcp`; --check reports for a person, otherwise the session answers on stdin/stdout. */
export async function runMcpServer(args: string[]): Promise<number | void> {
  const text = serverText(messages);
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { data: { type: 'string' }, member: { type: 'string' }, check: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) { console.log(text.help); return; }
  if (positionals.length) throw new Error(text.usage);

  const defaultMember = values.member ?? environmentValue('MEMBER');
  const metadata = JSON.parse(await readFile(packagePath('package.json'), 'utf8')) as { version: string };
  const projectOptions = { cwd: process.cwd(), data: values.data };
  let opening: Promise<AgentProject> | undefined;
  // 2026-11-12: transport negotiation needs no project imports or I/O; tool calls share one lazy open.
  const openProject = () => opening ??= (async () => {
    const { openAgentProject } = await import('./agent-ops.ts');
    try { return await openAgentProject(projectOptions); }
    catch (error) {
      console.error(`deckmate mcp: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof AgentToolError) throw error;
      throw new AgentToolError('the project did not open', 'run deckmate mcp --check to see why');
    }
  })();

  if (values.check) {
    let project: AgentProject;
    try { project = await openProject(); }
    catch { console.log(text.projectMissing); console.log(text.projectHint); return 1; }
    let serverLine = text.serverUnknown;
    try {
      const { findRunningServer } = await import('./server-discovery.ts');
      const running = await findRunningServer(project.root);
      serverLine = running ? text.serverRunning(running.port, running.pid) : text.serverNone;
    } catch {
      // Server discovery is optional for the check: an unavailable answer prints as "unknown" instead of failing.
    }
    console.log(text.project(project.root));
    console.log(defaultMember ? text.member(defaultMember) : text.memberUnset);
    console.log(serverLine);
    const { estimateTokens } = await import('./agent-brief.ts');
    console.log(text.tools(agentToolDefinitions.length, estimateTokens(JSON.stringify(agentToolDefinitions))));
    return 0;
  }

  const session = createMcpSession({
    call: async (name, input, caller: AgentCaller) => {
      const project = await openProject();
      const { callAgentTool } = await import('./agent-ops.ts');
      return callAgentTool(project, name, input, { ...caller, source: 'mcp' });
    },
    tools: agentToolDefinitions,
    instructions: agentInstructions,
    version: metadata.version,
    write: line => { process.stdout.write(line + '\n'); },
    defaultMember,
  });
  for await (const line of readMcpLines(process.stdin)) {
    if (line === null) { session.rejectOversizedLine(); continue; }
    void session.handle(line).catch(error => console.error(`deckmate mcp: ${error instanceof Error ? error.message : String(error)}`));
  }
  await session.settled();
}
