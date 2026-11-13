// 2026-11-11: this process-level check keeps the GUI shell's inherited stdio on the real MCP transport path.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'bin', 'deckmate.mjs');
const exe = path.join(root, 'desktop', 'src-tauri', 'target', 'debug', 'Deckmate.exe');
const directory = mkdtempSync(path.join(tmpdir(), 'deckmate-mcp-shell-'));
const project = path.join(directory, 'demo');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with ${result.status}\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}

async function protocolCheck() {
  const child = spawn(exe, ['mcp', '--data', project], {
    cwd: directory,
    windowsHide: true,
    env: {
      ...process.env,
      DECKMATE_WRITE: '',
      NODE_OPTIONS: '--require deckmate-mcp-smoke-must-not-load',
      OPENSSL_CONF: path.join(directory, 'missing-openssl.cnf'),
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => resolve(code));
  });
  const timeout = setTimeout(() => child.kill(), 60000);
  const input = [
    JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: { name: 'desktop-smoke', version: '1' }, capabilities: {} } }),
    JSON.stringify({ jsonrpc: '2.0', id: 'list', method: 'tools/list' }),
    '',
  ].join('\n');
  child.stdin.end(input);
  const code = await exited;
  clearTimeout(timeout);
  if (code !== 0) throw new Error(`MCP exited with ${code}\n${stdout}\n${stderr}`);
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 2) throw new Error(`Expected two JSON lines, received ${lines.length}\n${stdout}\n${stderr}`);
  const answers = lines.map(line => JSON.parse(line));
  if (answers[0].id !== 'init' || answers[0].result?.serverInfo?.name !== 'deckmate') {
    throw new Error(`Invalid initialize response: ${lines[0]}`);
  }
  if (answers[1].id !== 'list' || !Array.isArray(answers[1].result?.tools) || answers[1].result.tools.length === 0) {
    throw new Error(`Invalid tools/list response: ${lines[1]}`);
  }
  return answers[1].result.tools.length;
}

try {
  if (!existsSync(exe)) throw new Error('Build the debug shell first: cargo build --manifest-path desktop/src-tauri/Cargo.toml');
  if (!existsSync(path.join(root, 'dist', 'server', 'cli.js'))) throw new Error('Build Deckmate first: npm run build');
  run(process.execPath, [cli, 'init', project]);
  const checked = run(exe, ['mcp', '--check', '--data', project], { cwd: directory });
  if (!checked.stdout.includes(project) || !/(?:Tools|Инструменты): \d+/.test(checked.stdout)) {
    throw new Error(`Unexpected mcp --check output\n${checked.stdout}\n${checked.stderr}`);
  }
  console.log(`ok mcp-check — ${checked.stdout.trim().split(/\r?\n/).pop()}`);
  const tools = await protocolCheck();
  console.log(`ok mcp-stdio — initialize and tools/list returned two JSON lines (${tools} tools); stdin EOF exited 0`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
