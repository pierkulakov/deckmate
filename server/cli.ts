import { execFile } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs, promisify } from 'node:util';
import { adoptLegacyEnvironment, environmentValue } from './environment.ts';
import { defineText, serverText } from './i18n.ts';
import { packagePath } from './package-path.ts';

const executeFile = promisify(execFile);

// 2026-11-09: subcommands answer --help/-h themselves, so every entry prints the help of the command it names.
const messages = defineText({
  help: `A local Markdown project board for teams of people and AI agents.

Usage: deckmate [--data <folder>] [--port <1024-65535>] [--read-only] [--no-open]
       deckmate init <folder>
       deckmate project <command> [arguments] [--data <folder>] [--read-only] [--source live|sandbox]
       deckmate skills <install|status> [--project <folder>] [--from <Deckmate folder>] [--force]
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

Run deckmate <command> --help (or deckmate project <command> --help) for a command's options and an example.

Projects are editable in their own folder by default; use git to keep history.
DECKMATE_WRITE selects a separate sandbox worktree; --read-only disables writes.
Without --data, DECKMATE_DATA wins, then the current folder.
skills and agents use --project, then the current folder.
An empty folder offers a demo interactively; scripts should use init explicitly.
skills install replaces copies with local changes only with --force.

Options: --help, --version, --data, --port, --read-only, --no-open
Environment: DECKMATE_DATA, DECKMATE_WRITE, DECKMATE_PORT, DECKMATE_PROJECT_NAME,
             DECKMATE_READ_ONLY=1, DECKMATE_INDEX (cache directory), DECKMATE_HOST (Docker binding).
Loads .env.local from the current folder; existing environment and flags win.
`,
  unknownCommand: (command: string) => `Unknown command "${command}". Commands: init, project, skills, agents; see deckmate --help.`,
  initUsage: 'Usage: deckmate init <folder>, or deckmate --data <folder>. See deckmate --help.',
}, {
  help: `Локальная доска проекта поверх Markdown для команд из людей и ИИ-агентов.

Использование: deckmate [--data <папка>] [--port <1024-65535>] [--read-only] [--no-open]
               deckmate init <папка>
               deckmate project <команда> [аргументы] [--data <папка>] [--read-only] [--source live|sandbox]
               deckmate skills <install|status> [--project <папка>] [--from <папка Deckmate>] [--force]
               deckmate agents run <workflow> <area> [--project <папка>] [--dry] [--roles research,code]
                               [--lens <файл>] [--out <папка>]

Команды:
  (нет)    Запустить доску на порту 4317 и открыть её в браузере.
  init     Создать демо-проект в новой или пустой папке; существующие файлы не заменяются.
  project  Команды агента поверх файлов проекта, без сервера: summary, show, find, map, track,
           brief, changes, hand, step, pipelines, pipeline, boards, board, rebuild,
           init <шаблон>, next, ask, report, state, inbox.
  skills   Установить скилл /deckmate в папки .claude/skills и .agents/skills проекта
           или сравнить установленные копии с этой версией (status).
  agents   Записать задания агента для сценария скилла и запустить лаунчеры из
           tasks/deckmate-agents.md; --dry записывает задания и печатает команды без запуска.

Запустите deckmate <команда> --help (или deckmate project <команда> --help) для опций и примера команды.

Проекты по умолчанию редактируются в собственной папке; историю храните в git.
DECKMATE_WRITE выбирает отдельный песочный ворктри; --read-only отключает запись.
Без --data сначала действует DECKMATE_DATA, затем текущая папка.
skills и agents используют --project, затем текущую папку.
Для пустой папки демо предлагается интерактивно; скрипты должны вызывать init явно.
skills install заменяет копии с локальными правками только с --force.

Опции: --help, --version, --data, --port, --read-only, --no-open
Переменные: DECKMATE_DATA, DECKMATE_WRITE, DECKMATE_PORT, DECKMATE_PROJECT_NAME,
            DECKMATE_READ_ONLY=1, DECKMATE_INDEX (папка кэша), DECKMATE_HOST (привязка в Docker).
Загружает .env.local из текущей папки; существующее окружение и флаги важнее.
`,
  unknownCommand: (command: string) => `Неизвестная команда "${command}". Команды: init, project, skills, agents; смотрите deckmate --help.`,
  initUsage: 'Использование: deckmate init <папка> или deckmate --data <папка>. Смотрите deckmate --help.',
});

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
  const text = serverText(messages);
  const subcommand = subcommands.get(args[0]);
  if (subcommand) {
    await loadLocalEnvironment();
    return subcommand(args.slice(1));
  }
  const { values, positionals } = parseArgs({
    args, allowPositionals: true,
    options: { data: { type: 'string' }, port: { type: 'string' }, 'read-only': { type: 'boolean' }, 'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
  });
  if (values.help) { console.log(text.help); return; }
  if (values.version) {
    const metadata = JSON.parse(await readFile(packagePath('package.json'), 'utf8')) as { version: string };
    console.log(metadata.version);
    return;
  }
  if (positionals.length) {
    if (positionals[0] !== 'init') {
      throw new Error(text.unknownCommand(positionals[0]));
    }
    if (positionals.length !== 2 || values.data || values.port || values['read-only'] || values['no-open']) {
      throw new Error(text.initUsage);
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
