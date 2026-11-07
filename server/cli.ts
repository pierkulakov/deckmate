import { execFile } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, promisify } from 'node:util';
import { adoptLegacyEnvironment, environmentValue } from './environment.ts';
import { packagePath } from './package-path.ts';

const executeFile = promisify(execFile);
const help = `A local Markdown project board for teams of people and AI agents.

Usage: deckmate [--data <folder>] [--port <1024-65535>] [--read-only] [--no-open]
       deckmate init <folder>
       deckmate project <command> [arguments] [--data <folder>] [--read-only] [--source live|sandbox]
       deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>]
       deckmate agents run <workflow> <area> [--project <folder>] [--dry] [--roles research,code]
                       [--lens <file>] [--out <folder>]

Commands:
  (none)   Start the board on port 4317 and open it in your browser.
  init     Create a demo in a new or empty folder; existing files are never replaced.
  project  Agent commands on the project files, no server needed: summary, show, find, map, track,
           brief, changes, hand, step, pipelines, pipeline, boards, board, rebuild,
           init <starter template>, next, ask, report, state, inbox.
  skills   Install the /deckmate agent skill into the project's .claude/skills and .agents/skills
           folders, or compare the installed copies with this version (status).
  agents   Write agent assignments for a skill workflow and start the launchers configured in
           tasks/deckmate-agents.md; --dry writes the assignments and prints the commands only.

Projects are editable in their own folder by default; use git to keep history.
DECKMATE_WRITE selects a separate sandbox worktree; --read-only disables writes.
Without --data, DECKMATE_DATA wins, then the current folder.
skills and agents use --project, then the current folder.
An empty folder offers a demo interactively; scripts should use init explicitly.

Options: --help, --version, --data, --port, --read-only, --no-open
Environment: DECKMATE_DATA, DECKMATE_WRITE, DECKMATE_PORT, DECKMATE_PROJECT_NAME,
             DECKMATE_READ_ONLY=1, DECKMATE_INDEX (cache directory), DECKMATE_HOST (Docker binding).
Loads .env.local from the current folder; existing environment and flags win.
`;

type Subcommand = (args: string[]) => Promise<number | void>;

// 2026-11-05: each subcommand mirrors an npm script of the source tree and calls the same exported function.
const subcommands = new Map<string, Subcommand>([
  ['project', async args => (await import('../tools/project.ts')).projectCli(args)],
  ['skills', async args => (await import('../tools/deckmate-skills.ts')).skillsCli(args)],
  ['agents', async args => (await import('../tools/deckmate-run.ts')).agentsCli(args)],
]);

async function loadLocalEnvironment(): Promise<void> {
  try { loadEnvFile(path.resolve('.env.local')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

async function chooseDataRoot(explicitData: string | undefined): Promise<string> {
  const configured = explicitData ?? environmentValue('DATA');
  if (configured) return path.resolve(configured);
  const current = process.cwd();
  const entries = await readdir(current);
  if (entries.some(entry => !entry.endsWith('.tgz') && entry !== '.env.local')) return current;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('No project found. Run "deckmate init demo", then "deckmate --data demo".');
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try { answer = await prompt.question('Create a demo project in ./deckmate-demo? [y/N] '); }
  finally { prompt.close(); }
  if (!/^(y|yes)$/iu.test(answer.trim())) throw new Error('No files created. Use --data <folder> to open a project.');
  const directory = path.join(current, 'deckmate-demo');
  const { initializeDemo } = await import('./demo.ts');
  await initializeDemo(directory);
  return directory;
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await executeFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process '${url}'`], { windowsHide: true });
    } else {
      const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
      await executeFile(command, [url], { timeout: 10000 });
    }
  } catch {
    console.warn(`Could not open a browser automatically. Open ${url} manually.`);
  }
}

/** Returns a nonzero exit code when a subcommand reports a failure without throwing (`agents run`). */
export async function runCli(args = process.argv.slice(2)): Promise<number | void> {
  const subcommand = subcommands.get(args[0]);
  if (subcommand) {
    if (args[1] === '--help' || args[1] === '-h') { console.log(help); return; }
    await loadLocalEnvironment();
    return subcommand(args.slice(1));
  }
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { data: { type: 'string' }, port: { type: 'string' }, 'read-only': { type: 'boolean' }, 'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
  if (values.help) { console.log(help); return; }
  if (values.version) {
    const metadata = JSON.parse(await readFile(packagePath('package.json'), 'utf8')) as { version: string };
    console.log(metadata.version);
    return;
  }
  if (positionals.length) {
    if (positionals[0] !== 'init') {
      throw new Error(`Unknown command "${positionals[0]}". Commands: init, project, skills, agents; see deckmate --help.`);
    }
    if (positionals.length !== 2 || values.data || values.port || values['read-only'] || values['no-open']) {
      throw new Error('Usage: deckmate init <folder>, or deckmate --data <folder>. See deckmate --help.');
    }
    const directory = path.resolve(positionals[1]);
    const { initializeDemo } = await import('./demo.ts');
    await initializeDemo(directory);
    console.log(`Demo created: ${directory}\nOpen it: deckmate --data "${directory}"`);
    return;
  }
  await loadLocalEnvironment();
  adoptLegacyEnvironment(values.data);
  if (values.port !== undefined) process.env.DECKMATE_PORT = values.port;
  if (values['read-only']) process.env.DECKMATE_READ_ONLY = '1';
  const dataRoot = await chooseDataRoot(values.data);
  if (!(await stat(dataRoot)).isDirectory()) throw new Error('--data must name a directory.');
  process.env.DECKMATE_DATA = dataRoot;
  const { address } = await import('./main.ts');
  if (!values['no-open']) await openBrowser(address);
}
