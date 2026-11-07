import { defineText, serverText } from './i18n.ts';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { environmentValue } from './environment.ts';
import type { DataSource, EditMode } from '../src/workspace-contracts.ts';

const messages = defineText({
  missingData: "Missing DECKMATE_DATA: use --data <folder> or set DECKMATE_DATA to a folder with Markdown.",
  invalidPort: "DECKMATE_PORT / --port must be an integer from 1024 to 65535.",
  invalidHost: "DECKMATE_HOST must be 127.0.0.1 or 0.0.0.0 (Docker).",
  separateCopy: "DECKMATE_WRITE must be a separate copy outside the live project.",
  sandboxBranch: "Writing is only allowed on deckmate/sandbox (or an existing freetion/sandbox).",
  outsideProject: "The path is outside the project.",
  readOnly: "This project is open in read-only mode. Restart without --read-only or DECKMATE_READ_ONLY=1 to edit it.",
  originalReadOnly: "The original source is read-only. Open the test copy to edit it.",
}, {
  missingData: "Не задан DECKMATE_DATA: укажите --data <папка> или задайте DECKMATE_DATA — папку с Markdown.",
  invalidPort: "DECKMATE_PORT / --port должен быть целым числом от 1024 до 65535.",
  invalidHost: "DECKMATE_HOST должен быть 127.0.0.1 или 0.0.0.0 (Docker).",
  separateCopy: "DECKMATE_WRITE должен быть отдельной копией вне живого проекта.",
  sandboxBranch: "Запись разрешена только в deckmate/sandbox (или существующей freetion/sandbox).",
  outsideProject: "Путь за пределами проекта.",
  readOnly: "Проект открыт только для чтения. Для правки перезапустите его без --read-only или DECKMATE_READ_ONLY=1.",
  originalReadOnly: "Оригинал открыт только для чтения. Для правки откройте тестовую копию.",
});


const executeFile = promisify(execFile);
export interface ServerConfig {
  editMode: EditMode;
  dataRoot: string;
  writeRoot: string | null;
  projectName: string;
  port: number;
  host?: '127.0.0.1' | '0.0.0.0';
  python: string;
}

/**
 * `readOnly` is the --read-only flag of `deckmate project` (2026-11-05). It is not written into DECKMATE_READ_ONLY: a new
 * DECKMATE_* variable would switch off a legacy FREETION_DATA/FREETION_WRITE pair and turn a sandbox into direct edits.
 */
export async function loadConfig(options: { readOnly?: boolean } = {}): Promise<ServerConfig> {
  const data = environmentValue('DATA');
  const write = environmentValue('WRITE');
  if (!data) {
    throw new Error(serverText(messages).missingData);
  }
  const dataRoot = await realpath(data);
  let editMode: EditMode = 'direct';
  let writeRoot: string | null = dataRoot;
  if (options.readOnly || environmentValue('READ_ONLY') === '1') {
    editMode = 'read-only';
    writeRoot = null;
  } else if (write) {
    editMode = 'sandbox';
    writeRoot = await realpath(write);
    const relative = path.relative(dataRoot, writeRoot);
    if (!relative || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      throw new Error(serverText(messages).separateCopy);
    }
    await assertSandboxBranch(writeRoot);
  }
  const port = Number(environmentValue('PORT') ?? 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(serverText(messages).invalidPort);
  const host = environmentValue('HOST') ?? '127.0.0.1';
  if (host !== '127.0.0.1' && host !== '0.0.0.0') throw new Error(serverText(messages).invalidHost);
  return { editMode, dataRoot, writeRoot, port, host, projectName: environmentValue('PROJECT_NAME') ?? path.basename(dataRoot),
    python: environmentValue('PYTHON') ?? 'python' };
}

export class WriteAccessError extends Error {
  readonly status = 403;
}

/** 2026-11-05: all server mutations share this policy; direct editing needs no git repository. */
export async function assertWritable(config: ServerConfig, source: DataSource = 'sandbox'): Promise<string> {
  if (config.editMode === 'read-only' || !config.writeRoot) throw new WriteAccessError(serverText(messages).readOnly);
  if (source !== 'sandbox') throw new WriteAccessError(serverText(messages).originalReadOnly);
  if (config.editMode === 'sandbox') {
    try { await assertSandboxBranch(config.writeRoot); }
    catch { throw new WriteAccessError(serverText(messages).sandboxBranch); }
  }
  return config.writeRoot;
}

export async function assertSandboxBranch(root: string): Promise<void> {
  const branch = await executeFile('git', ['-C', root, 'branch', '--show-current'], { windowsHide: true });
  if (!['deckmate/sandbox', 'freetion/sandbox'].includes(branch.stdout.trim())) throw new Error(serverText(messages).sandboxBranch);
}

export async function containedFile(root: string, relative: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  const resolved = await realpath(path.resolve(resolvedRoot, relative));
  const within = path.relative(resolvedRoot, resolved);
  // 2026-11-06: a code lets HTTP handlers answer 404 instead of 500 when a request path escapes the root.
  if (!within || within.startsWith('..') || path.isAbsolute(within)) {
    throw Object.assign(new Error(serverText(messages).outsideProject), { code: 'OUTSIDE_PROJECT' });
  }
  return resolved;
}
