import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** An error that chooses the process exit code; `agents run` exits with 2 for a missing --lens (2026-11-05). */
export interface ExitCodeError extends Error { exitCode?: number }

/** 2026-11-05: a command error is one line without a stack trace, as bin/deckmate.mjs prints it. */
export function reportCliError(error: unknown, prefix = ''): void {
  console.error(prefix + (error instanceof Error ? error.message : String(error)));
  const code = (error as ExitCodeError | null)?.exitCode;
  process.exitCode = Number.isInteger(code) ? code : 1;
}

/** An npm script runs the module itself; `deckmate <subcommand>` imports the module and calls the same function. */
export function runAsScript(moduleUrl: string, main: () => Promise<number | void>): void {
  if (!process.argv[1] || moduleUrl !== pathToFileURL(path.resolve(process.argv[1])).href) return;
  main().then(code => { if (code) process.exitCode = code; }, error => reportCliError(error));
}
