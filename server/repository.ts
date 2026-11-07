import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { packagePath } from './package-path.ts';
import { promisify } from 'node:util';
import type { ApiFailure, DataSource, WorkspaceSnapshot } from '../src/workspace-contracts.ts';
import { readIteration } from './document.ts';
import { containedFile } from './config.ts';
import type { ServerConfig } from './config.ts';
import { defineText, serverText } from './i18n.ts';

const executeFile = promisify(execFile);

// 2026-11-04: /api/block and /api/status were removed with the Docs tab;
// card edits use /api/catalog (update-card-content, set-card-state). This module retains
// iteration snapshots, the startup board check, and root resolution for /api/file.
export class RepositoryError extends Error {
  status: number;
  detail: ApiFailure;
  constructor(status: number, detail: ApiFailure) { super(detail.message); this.status = status; this.detail = detail; }
}

export class Repository {
  readonly config: ServerConfig;

  constructor(config: ServerConfig) {
    this.config = config;
  }

  root(source: DataSource): string {
    if (source === 'sandbox' && this.config.writeRoot) return this.config.writeRoot;
    return this.config.dataRoot;
  }

  async snapshot(source: DataSource = this.config.writeRoot ? 'sandbox' : 'live'): Promise<WorkspaceSnapshot> {
    let actualSource = source;
    if (this.config.editMode === 'direct') actualSource = 'sandbox';
    if (this.config.editMode === 'read-only') actualSource = 'live';
    let iterations = '';
    try { iterations = await readFile(await containedFile(this.root(actualSource), 'tasks/iterations.md'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    return { projectName: this.config.projectName, source: actualSource, writable: actualSource === 'sandbox',
      editMode: this.config.editMode, iteration: readIteration(iterations) };
  }

  private async board(root: string, check: boolean): Promise<void> {
    const script = await containedFile(root, 'Tools/board.py');
    try {
      const arguments_ = check ? ['-B', script, '--check'] : ['-B', packagePath('tools', 'rebuild-board.py'), root];
      await executeFile(this.config.python, arguments_,
        { cwd: root, windowsHide: true, timeout: 15000, encoding: 'utf8' });
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string };
      throw new RepositoryError(422, { code: 'BOARD', message: serverText(messages).boardFailed(failure.stdout || failure.stderr || serverText(messages).checkPython) });
    }
  }

  async initialize(): Promise<void> {
    if (!this.config.writeRoot) return;
    // 2026-11-05: native-card projects have no legacy board renderer; only projects supplying one need Python.
    try { await containedFile(this.config.writeRoot, 'Tools/board.py'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    await this.board(this.config.writeRoot, true);
  }
}

const messages = defineText({
  boardFailed: (details: string) => `Board check failed. ${details}`,
  checkPython: 'Check Python and Tools/board.py.',
}, {
  boardFailed: (details: string) => `Проверка доски не прошла. ${details}`,
  checkPython: 'Проверьте Python и Tools/board.py.',
});
