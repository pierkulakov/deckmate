// Server side of the interface language (2026-11-05): every request carries the client's choice in a cookie; messages
// built while serving it — errors, notification and journal lines — read it from the request's async context.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { FastifyInstance } from 'fastify';
import { defaultLang, langCookie, parseLang, type Lang } from '../src/i18n.ts';

export { defineText, type Lang } from '../src/i18n.ts';

const requestLang = new AsyncLocalStorage<Lang>();

function langFromCookie(cookie: string | undefined): Lang {
  const match = cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(langCookie + '='));
  return parseLang(match?.slice(langCookie.length + 1));
}

/** Language of the request being served; outside a request (start-up, file watchers, CLI) — English. */
export function serverLang(): Lang {
  return requestLang.getStore() ?? defaultLang;
}

/** A module's strings in the language of the request being served. */
export function serverText<T>(text: Record<Lang, T>): T {
  return text[serverLang()];
}

/** Runs every request inside its language; the same pattern as @fastify/request-context, without the dependency. */
export function registerRequestLang(app: FastifyInstance): void {
  app.addHook('onRequest', (request, _reply, done) => {
    requestLang.run(langFromCookie(request.headers.cookie), done);
  });
}
