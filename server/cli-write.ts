// 2026-11-05: reuse the UI mutation service offline; a running server owns its write queue.
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { assertWritable, type ServerConfig } from './config.ts';
import { CatalogError, CatalogService } from './catalog-service.ts';
import type { CatalogEdit } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { memberIdPattern } from '../src/members.ts';

export interface CliWriteResult {
  warnings: string[];
  /** `server` — went through POST /api/catalog of a running Deckmate; `files` — written directly. */
  via: 'server' | 'files';
}

export async function writeCatalog(config: ServerConfig, source: DataSource, edit: CatalogEdit, actor: string | null): Promise<CliWriteResult> {
  const root = await assertWritable(config, source);
  if (actor !== null && !memberIdPattern.test(actor)) throw new CatalogError(422, 'Invalid member ID.');
  const baseUrl = `http://127.0.0.1:${config.port}`;
  const snapshot = await probeServer(`${baseUrl}/api/snapshot?source=${source}`);
  if (snapshot) {
    const token = snapshot.token;
    if (typeof token !== 'string' || !token) throw new CatalogError(502, 'The server did not return a session token.');
    // 2026-11-05: identical copies can have identical source hashes. A port alone does not identify the project.
    const catalog = await responseBody(await fetch(`${baseUrl}/api/catalog?source=${source}`, {
      signal: AbortSignal.timeout(30000), redirect: 'error',
    }));
    const identity = createHash('sha256').update(await realpath(root)).digest('hex');
    if (catalog.rootIdentity !== identity) throw new CatalogError(409, 'The server on this port has a different project open.');
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-deckmate-token': token };
    if (actor !== null) headers['x-deckmate-actor'] = actor;
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/api/catalog`, {
        method: 'POST', headers, body: JSON.stringify({ ...edit, source }),
        signal: AbortSignal.timeout(60000), redirect: 'error',
      });
    } catch {
      // 2026-11-05: losing a response does not mean the write failed; never replay it against the files.
      throw new CatalogError(503, 'The write response was lost. Check the card before retrying; it may have been saved.', true);
    }
    const result = await responseBody(response, true);
    return { warnings: readWarnings(result), via: 'server' };
  }
  const service = new CatalogService(config, ':memory:');
  try {
    const result = await service.edit(edit, source, actor);
    // 2026-11-10: the partial-save notice moved to its own field; CLI callers still decide retries from warnings.
    return { warnings: [...result.warnings, ...(result.savedWarning ? [result.savedWarning] : [])], via: 'files' };
  } finally { await service.close(); }
}

type ResponseBody = Record<string, unknown>;

function readWarnings(body: ResponseBody): string[] {
  if (!Array.isArray(body.warnings) || !body.warnings.every(value => typeof value === 'string')) {
    throw new CatalogError(502, 'The server returned an invalid write response. Check the card before retrying.', true);
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
    throw new CatalogError(response.ok ? 502 : response.status, `Invalid server response (${response.status}).`, write);
  }
  if (!response.ok) {
    const message = typeof body.message === 'string' ? body.message : `Server error (${response.status}).`;
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
