// 2026-11-05: reuse the UI mutation service offline; a running server owns its write queue.
import { assertWritable, type ServerConfig } from './config.ts';
import { CatalogError, CatalogService, type CatalogBatchEdit } from './catalog-service.ts';
import type { CatalogEdit, CatalogView } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { memberIdPattern } from '../src/members.ts';
import { findRunningServer, removeRunningServer } from './server-discovery.ts';
import { projectRootIdentity } from './project-cache.ts';
import { defineText, serverText } from './i18n.ts';
import { readProjectCatalog } from './catalog.ts';

const messages = defineText({
  invalidMember: 'Invalid member ID.',
  missingToken: 'The server did not return a session token.',
  lostWrite: 'The write response was lost. Check the card before retrying; it may have been saved.',
  invalidWrite: 'The server returned an invalid write response. Check the card before retrying.',
  invalidCatalog: 'The server returned an invalid catalog.',
  invalidResponse: (status: number) => `Invalid server response (${status}).`,
  serverError: (status: number) => `Server error (${status}).`,
}, {
  invalidMember: 'Недопустимый идентификатор участника.',
  missingToken: 'Сервер не вернул токен сессии.',
  lostWrite: 'Ответ на запись потерян. Проверьте карточку перед повтором: она могла сохраниться.',
  invalidWrite: 'Сервер вернул некорректный ответ на запись. Проверьте карточку перед повтором.',
  invalidCatalog: 'Сервер вернул некорректный каталог.',
  invalidResponse: (status: number) => `Некорректный ответ сервера (${status}).`,
  serverError: (status: number) => `Ошибка сервера (${status}).`,
});

export interface CliWriteResult {
  warnings: string[];
  /** `server` — went through POST /api/catalog of a running Deckmate; `files` — written directly. */
  via: 'server' | 'files';
}

export async function writeCatalog(config: ServerConfig, source: DataSource, edit: CatalogEdit, actor: string | null): Promise<CliWriteResult> {
  const root = await assertWritable(config, source);
  assertActor(actor);
  const session = await runningSession(config, source, root);
  if (session) {
    const result = await postCatalog(session, '/api/catalog', { ...edit, source }, actor);
    return { warnings: readWarnings(result), via: 'server' };
  }
  return writeFiles(config, source, edit, actor);
}

interface HttpSession { baseUrl: string; token: string; catalog: ResponseBody }

function assertActor(actor: string | null): void {
  if (actor !== null && !memberIdPattern.test(actor)) throw new CatalogError(422, serverText(messages).invalidMember);
}

async function runningSession(config: ServerConfig, source: DataSource, root: string): Promise<HttpSession | null> {
  const running = await findRunningServer(root);
  const baseUrl = `http://127.0.0.1:${running?.port ?? config.port}`;
  const snapshot = await probeServer(`${baseUrl}/api/snapshot?source=${source}`);
  if (snapshot) {
    const token = snapshot.token;
    if (typeof token !== 'string' || !token) throw new CatalogError(502, serverText(messages).missingToken);
    // 2026-11-05: identical copies can have identical source hashes. A port alone does not identify the project.
    const catalog = await responseBody(await fetch(`${baseUrl}/api/catalog?source=${source}`, {
      signal: AbortSignal.timeout(30000), redirect: 'error',
    }));
    const identity = await projectRootIdentity(root);
    if (catalog.rootIdentity !== identity) {
      if (running) await removeRunningServer(root, running);
      return null;
    }
    return { baseUrl, token, catalog };
  }
  if (running) await removeRunningServer(root, running);
  return null;
}

async function postCatalog(session: HttpSession, route: string, body: ResponseBody, actor: string | null): Promise<ResponseBody> {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-deckmate-token': session.token };
  if (actor !== null) headers['x-deckmate-actor'] = actor;
  let response: Response;
  try {
    response = await fetch(`${session.baseUrl}${route}`, {
      method: 'POST', headers, body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000), redirect: 'error',
    });
  } catch {
    // 2026-11-05: losing a response does not mean the write failed; never replay it against the files.
    throw new CatalogError(503, serverText(messages).lostWrite, true);
  }
  return responseBody(response, true);
}

async function writeFiles(config: ServerConfig, source: DataSource, edit: CatalogEdit, actor: string | null): Promise<CliWriteResult> {
  // 2026-11-12: offline agent writes must not execute the project's board renderer.
  const service = new CatalogService(config, ':memory:', { skipBoardRebuild: true });
  try {
    const result = await service.edit(edit, source, actor);
    // 2026-11-10: the partial-save notice moved to its own field; CLI callers still decide retries from warnings.
    return { warnings: [...result.warnings, ...(result.savedWarning ? [result.savedWarning] : [])], via: 'files' };
  } finally { await service.close(); }
}

export type CliBatchOutcome = ({ ok: true } & CliWriteResult) | { ok: false; error: unknown };

export interface CliCatalogWriter {
  readonly catalog: CatalogView;
  writeBatch(edits: readonly CatalogBatchEdit[], actor: string | null): Promise<CliBatchOutcome[]>;
}

/** 2026-11-12: planning and response heads share the batch snapshot instead of scanning before and after each write. */
export async function withCatalogWriter<Result>(config: ServerConfig, source: DataSource,
  operation: (writer: CliCatalogWriter) => Promise<Result>): Promise<Result> {
  const root = await assertWritable(config, source);
  const session = await runningSession(config, source, root);
  if (session) {
    let catalog = readCatalog(session.catalog);
    return operation({
      get catalog() { return catalog; },
      async writeBatch(edits, actor) {
        assertActor(actor);
        const outcomes: CliBatchOutcome[] = [];
        const prepared: Array<{ position: number; edit: CatalogEdit }> = [];
        for (const [position, build] of edits.entries()) {
          try { prepared.push({ position, edit: build(catalog.manifestHash) }); }
          catch (error) { outcomes[position] = { ok: false, error }; }
        }
        if (!prepared.length) return outcomes;
        const result = await postCatalog(session, '/api/catalog-batch', { source, edits: prepared.map(item => item.edit) }, actor);
        if (!Array.isArray(result.outcomes) || result.outcomes.length !== prepared.length) {
          throw new CatalogError(502, serverText(messages).invalidWrite, true);
        }
        catalog = readCatalog(result.catalog, true);
        for (const [index, value] of result.outcomes.entries()) {
          if (!value || typeof value !== 'object') throw new CatalogError(502, serverText(messages).invalidWrite, true);
          const item = value as ResponseBody;
          if (item.ok === true) outcomes[prepared[index].position] = { ok: true, warnings: readWarnings(item), via: 'server' };
          else if (item.ok === false && typeof item.status === 'number' && typeof item.message === 'string' && typeof item.saved === 'boolean') {
            outcomes[prepared[index].position] = { ok: false, error: new CatalogError(item.status, item.message, item.saved) };
          } else throw new CatalogError(502, serverText(messages).invalidWrite, true);
        }
        return outcomes;
      },
    });
  }
  const service = new CatalogService(config, ':memory:', { skipBoardRebuild: true });
  try {
    // 2026-11-12: planning is optimistic; each write chunk refreshes its own baseline under the lock.
    let catalog = await readProjectCatalog(root);
    return await operation({
      get catalog() { return catalog; },
      async writeBatch(edits, actor) {
        assertActor(actor);
        const result = await service.editBatch(edits, source, actor);
        catalog = result.catalog;
        return result.outcomes.map(outcome => outcome.ok ? { ...outcome, via: 'files' } : outcome);
      },
    });
  } finally { await service.close(); }
}

/** Each item rebases only its manifest revision; source hashes and saved/ambiguous failures remain guarded. */
export async function writeCatalogBatch(config: ServerConfig, source: DataSource, actor: string | null,
  edits: readonly CatalogBatchEdit[]): Promise<CliBatchOutcome[]> {
  return withCatalogWriter(config, source, writer => writer.writeBatch(edits, actor));
}

type ResponseBody = Record<string, unknown>;

function readCatalog(value: unknown, saved = false): CatalogView {
  if (!value || typeof value !== 'object' || !('cards' in value) || !Array.isArray(value.cards)
    || !('decks' in value) || !Array.isArray(value.decks) || !('manifestHash' in value) || typeof value.manifestHash !== 'string') {
    throw new CatalogError(502, serverText(messages).invalidCatalog, saved);
  }
  return value as CatalogView;
}

function readWarnings(body: ResponseBody): string[] {
  if (!Array.isArray(body.warnings) || !body.warnings.every(value => typeof value === 'string')) {
    throw new CatalogError(502, serverText(messages).invalidWrite, true);
  }
  return typeof body.savedWarning === 'string' && body.savedWarning ? [...body.warnings, body.savedWarning] : body.warnings;
}

async function responseBody(response: Response, write = false): Promise<ResponseBody> {
  let body: ResponseBody;
  try {
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response');
    body = value as ResponseBody;
  } catch {
    throw new CatalogError(response.ok ? 502 : response.status, serverText(messages).invalidResponse(response.status), write);
  }
  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : serverText(messages).serverError(response.status);
    throw new CatalogError(response.status, message, body.saved === true);
  }
  return body;
}

async function probeServer(url: string): Promise<ResponseBody | null> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  } catch (error) {
    const cause = (error as { cause?: NodeJS.ErrnoException }).cause;
    // 2026-11-05: only a refused connection proves no server owns this port; timeouts/errors must not bypass it.
    if (cause?.code === 'ECONNREFUSED') return null;
    throw error;
  }
  return responseBody(response);
}
