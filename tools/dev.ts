import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type ProcessName = 'server' | 'tsc' | 'vite';
type ManagedProcess = {
  child: ChildProcess;
  closed: Promise<void>;
};

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const typescriptEntry = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const deckmateEntry = path.join(root, 'bin', 'deckmate.mjs');

function prefixedWriter(name: ProcessName, destination: NodeJS.WritableStream) {
  let pending = '';
  return {
    write(chunk: string) {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) destination.write(`[${name}] ${line}\n`);
    },
    end() {
      if (pending) destination.write(`[${name}] ${pending}\n`);
      pending = '';
    },
  };
}

function compileServer(): number {
  const stdout = prefixedWriter('tsc', process.stdout);
  const stderr = prefixedWriter('tsc', process.stderr);
  const result = spawnSync(process.execPath, [typescriptEntry, '-p', 'tsconfig.server.json'], {
    cwd: root, env: process.env, encoding: 'utf8', shell: false, windowsHide: true,
  });
  stdout.write(result.stdout ?? '');
  stderr.write(result.stderr ?? '');
  if (result.error) stderr.write(result.error.message + '\n');
  stdout.end();
  stderr.end();
  return result.status ?? 1;
}

function optionValue(argumentsList: string[], name: string): string | undefined {
  const index = argumentsList.indexOf('--' + name);
  if (index >= 0) return argumentsList[index + 1];
  const prefix = '--' + name + '=';
  return argumentsList.find(argument => argument.startsWith(prefix))?.slice(prefix.length);
}

function stopWindowsTree(child: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    // 2026-11-08: node --watch has a child of its own, so stopping only its parent would leave Deckmate listening.
    const task = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      shell: false, stdio: 'ignore', windowsHide: true,
    });
    task.once('error', () => { child.kill(); resolve(); });
    task.once('close', () => resolve());
  });
}

async function stopProcess(record: ManagedProcess): Promise<void> {
  const { child } = record;
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    if (process.platform === 'win32') await stopWindowsTree(child);
    else {
      // 2026-11-08: the detached child leads its own group, so SIGTERM also reaches node --watch's server process.
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch { if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM'); }
    }
  }
  await record.closed;
}

async function main(): Promise<void> {
  const compileStatus = compileServer();
  if (compileStatus !== 0) {
    process.exitCode = compileStatus;
    return;
  }

  const argumentsList = process.argv.slice(2);
  // 2026-11-09: only Vite needs the port in its environment (for the proxy target). The server gets it as --port, after
  // its CLI has adopted legacy FREETION_* settings; any DECKMATE_* variable there would switch that migration off and
  // could turn a configured sandbox into direct writes to the source project.
  const port = optionValue(argumentsList, 'port');
  const viteEnvironment = port === undefined ? process.env : { ...process.env, DECKMATE_PORT: port };
  const processes: ManagedProcess[] = [];
  let stopping = false;
  let finish = () => {};
  const finished = new Promise<void>(resolve => { finish = resolve; });

  async function shutdown(exitCode: number): Promise<void> {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    await Promise.all(processes.map(stopProcess));
    finish();
  }

  function start(name: ProcessName, nodeArguments: string[], environment: NodeJS.ProcessEnv = process.env): void {
    const child = spawn(process.execPath, nodeArguments, {
      cwd: root, env: environment, shell: false, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['inherit', 'pipe', 'pipe'],
    });
    const stdout = prefixedWriter(name, process.stdout);
    const stderr = prefixedWriter(name, process.stderr);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', stdout.write);
    child.stderr?.on('data', stderr.write);
    let settle = () => {};
    const closed = new Promise<void>(resolve => {
      settle = () => resolve();
    });
    processes.push({ child, closed });
    child.once('error', error => {
      stderr.write(error.message + '\n');
      settle();
      void shutdown(1);
    });
    child.once('close', code => {
      stdout.end();
      stderr.end();
      settle();
      if (!stopping) {
        process.stderr.write(`[dev] ${name} exited; stopping development processes.\n`);
        void shutdown(code ?? 1);
      }
    });
  }

  process.once('SIGINT', () => { void shutdown(0); });
  process.once('SIGTERM', () => { void shutdown(0); });
  start('tsc', [typescriptEntry, '-p', 'tsconfig.server.json', '--watch', '--preserveWatchOutput']);
  start('server', ['--env-file-if-exists=.env.local', '--watch', deckmateEntry, '--no-open', ...argumentsList]);
  // 2026-11-08: Node loads .env.local before Vite evaluates the proxy target; an explicit --port above takes precedence.
  start('vite', ['--env-file-if-exists=.env.local', viteEntry, '--config', 'app.vite.config.ts'], viteEnvironment);
  console.log('Open Deckmate at http://127.0.0.1:4318/');
  await finished;
}

main().catch((error: unknown) => {
  process.stderr.write(`[dev] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
