import { planningBodySchema } from './planning-schema.ts';
import { defineText, serverLang, serverText } from './i18n.ts';
import Fastify, { type FastifyReply } from 'fastify';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { packagePath } from './package-path.ts';
import { Repository, RepositoryError } from './repository.ts';
import { assertWritable, containedFile, WriteAccessError } from './config.ts';
import { listProjectTemplates, planProjectTemplate, ProjectTemplateNotFoundError } from './project-templates.ts';
import type { ServerConfig } from './config.ts';
import { applyAttachmentEdit, attachmentEditActions, InvalidAttachmentIdError, readCardAttachments, type AttachmentEditAction } from './attachments.ts';
import { watchProjectFiles } from './file-events.ts';
import { CatalogError, CatalogService } from './catalog-service.ts';
import { Boards } from './boards.ts';
import { importCards } from './catalog-import.ts';
import type { BoardScene } from '../src/board-contracts.ts';
import type { CatalogEdit, CatalogImportEdit, CatalogQuery, CatalogView } from '../src/catalog-contracts.ts';
import type { DataSource } from '../src/workspace-contracts.ts';
import { resolveReference } from '../src/references.ts';
import { summarizeCatalog } from './catalog-summary.ts';
import { readJourneyMetrics } from './journey-metrics.ts';
import { readProjectPulse } from './project-pulse.ts';
import { readCardContent, CardContentError } from './card-content.ts';
import { NotificationService } from './notifications.ts';
import { cardStates, cardStateWords } from '../src/format-vocabulary.ts';
import type { NotificationDismissRequest, NotificationWatchRequest } from '../src/notification-contracts.ts';
import { memberIdPattern } from '../src/members.ts';
import type { PlanningEdit } from '../src/planning-files.ts';
import { applyPlanningEdit } from './planning-files.ts';
import { needsPlanningObservation, recordPlanningObservation } from './planning-history.ts';
import { maintainRecurringRuns, runScheduleDue } from './run-lifecycle.ts';
import { readRuns } from './runs.ts';
import { registerRequestLang } from './i18n.ts';
import { readProjectCatalog } from './catalog.ts';
import { buildBrief, readFileLines } from './agent-brief.ts';
import { readAgentChanges } from './agent-changes.ts';
import { readOnboardingFacts } from './onboarding-facts.ts';

const messages = defineText({
  attachmentsChanged: "Attachments changed in the files. Refresh the panel and try again.",
  attachmentsPartSaved: "The attachment change was partially saved.",
  attachmentFailed: "Could not save the attachment.",
  invalidHost: "Invalid server address.",
  invalidOrigin: "Requests from another site are not allowed.",
  reload: "The page is out of date. Reload Deckmate before saving.",
  modelChanged: "The editor changed the block structure. Saving was cancelled; use Markdown mode.",
  incomplete: "Incomplete request.",
  actionFailed: "Could not complete the action.",
  boardMissing: "Board not found.",
  pipelineMissing: "Pipeline not found.",
  cardMissing: "Card not found.",
  planFailed: "Could not save the plan.",
  planChanged: "The plan changed in the files. Check the updated data and save again.",
  planSaved: "The plan was saved, but the updated catalog could not be loaded. Try again to verify the result.",
  journeyMissing: "Journey not found.",
  summaryFailed: "Could not build the summary.",
  contentStrings: "The card title and text must be strings.",
  importFailed: "Could not import CSV.",
  importChanged: "The source changed in the files. Refresh the catalog and import again.",
  pageMissing: "Page not found. Run npm run build.",
}, {
  attachmentsChanged: "Вложения изменились в файлах. Обновите панель и повторите действие.",
  attachmentsPartSaved: "Часть изменения вложений сохранена.",
  attachmentFailed: "Не удалось сохранить вложение.",
  invalidHost: "Недопустимый адрес сервера.",
  invalidOrigin: "Запрос с другого сайта запрещён.",
  reload: "Страница устарела. Перезагрузите Deckmate перед сохранением.",
  modelChanged: "Редактор изменил структуру блока. Сохранение отменено; используйте режим Markdown.",
  incomplete: "Неполный запрос.",
  actionFailed: "Не удалось выполнить действие.",
  boardMissing: "Доска не найдена.",
  pipelineMissing: "Pipeline не найден.",
  cardMissing: "Карточка не найдена.",
  planFailed: "Не удалось сохранить план.",
  planChanged: "План изменился в файлах. Проверьте обновлённые данные и повторите сохранение.",
  planSaved: "План сохранён, но обновлённый каталог не получен. Повторите действие для сверки результата.",
  journeyMissing: "Journey не найден.",
  summaryFailed: "Не удалось собрать сводку.",
  contentStrings: "Название и текст карточки должны быть строками.",
  importFailed: "Не удалось импортировать CSV.",
  importChanged: "Источник изменился в файлах. Обновите каталог и повторите импорт.",
  pageMissing: "Страница не найдена. Выполните npm run build.",
});


const clientRoot = packagePath('dist', 'client');
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.pdf': 'application/pdf',
  '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
// 2026-11-07: Vision's /r/ embeds need same-origin frames; foreign sites and opaque sandbox origins remain blocked.
const framingHeaders = { 'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN' };

/** 2026-11-06: a request path must be one clean relative path; everything else answers 404 before any filesystem call. */
function servableRequestPath(value: unknown): value is string {
  return typeof value === 'string' && !/[\u0000-\u001f\u007f\\]/u.test(value) && !path.isAbsolute(value)
    && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** 2026-11-05: attachments use the same write policy as the catalog and their own module queue. */
async function runAttachmentEdit(catalog: CatalogService, config: ServerConfig, edit: AttachmentEditAction & { source: DataSource }): Promise<CatalogView> {
  const root = await assertWritable(config, edit.source);
  try {
    await applyAttachmentEdit(root, edit);
  } catch (error) {
    if (error instanceof Error && error.message === 'ATTACHMENTS_CONFLICT') throw new CatalogError(409, serverText(messages).attachmentsChanged);
    if (error && typeof error === 'object' && 'saved' in error && error.saved === true) {
      throw new CatalogError(503, error instanceof Error ? error.message : serverText(messages).attachmentsPartSaved, true);
    }
    throw new CatalogError(422, error instanceof Error ? error.message : serverText(messages).attachmentFailed);
  }
  return catalog.get('sandbox');
}

export async function createApp(config: ServerConfig) {
  const app = Fastify({ logger: false, bodyLimit: 512 * 1024,
    // 2026-11-07: malformed URLs bypass request hooks but still need the same-origin framing policy.
    frameworkErrors: (error, _request, reply: FastifyReply) => { reply.headers(framingHeaders).send(error); },
  });
  // First hook: every later hook and handler answers in the client's interface language.
  registerRequestLang(app);
  const repository = new Repository(config);
  const catalog = new CatalogService(config);
  let observedPlanningView: CatalogView | null = null;
  // 2026-11-05: burndown numbers change only through writes, so only a successful POST makes a planning point due.
  // 2026-11-07: GET /api/catalog may still write (carry Runs, auto-archive) as catalog housekeeping; that is not a planning edit.
  let observationDue = false;
  let historyWrite: Promise<void> | null = null;
  const boards = new Boards(config);
  const notifications = new NotificationService(config, catalog);
  // 2026-11-04: who acts — the member chosen in the client or an agent's own registry ID; no header = an unknown API caller.
  const actorOf = (value: string | string[] | undefined): string | null => typeof value === 'string' && memberIdPattern.test(value) ? value : null;
  await repository.initialize();
  const token = randomBytes(32).toString('hex');
  // 2026-11-07: on IPv6 stacks the browser reaches the loopback as [::1], so the Host/Origin guard accepts it too.
  const allowedHosts = new Set([`127.0.0.1:${config.port}`, `localhost:${config.port}`, `[::1]:${config.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map(host => `http://${host}`));
  const sockets = new WebSocketServer({ noServer: true });

  app.addHook('onRequest', async (request, reply) => {
    reply.headers(framingHeaders);
    if (!allowedHosts.has(request.headers.host ?? '')) return reply.code(403).send({ message: serverText(messages).invalidHost });
    if (request.headers.origin && !allowedOrigins.has(request.headers.origin)) return reply.code(403).send({ message: serverText(messages).invalidOrigin });
    if (request.method !== 'GET' && request.method !== 'HEAD' && request.headers['x-deckmate-token'] !== token) {
      return reply.code(403).send({ message: serverText(messages).reload });
    }
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WriteAccessError) return reply.code(error.status).send({ code: 'READ_ONLY', message: error.message });
    if (error instanceof CatalogError) return reply.code(error.status).send({ code: 'CATALOG', message: error.message, saved: error.saved });
    if (error instanceof RepositoryError) return reply.code(error.status).send(error.detail);
    if (error instanceof Error && error.message.includes('Block model changed')) {
      return reply.code(422).send({ code: 'MODEL', message: serverText(messages).modelChanged });
    }
    const details = error as { validation?: unknown; message?: string; statusCode?: number };
    // 2026-11-06: Fastify's own limits (413 body too large, 415 media type) keep their status instead of turning into 500.
    const frameworkStatus = typeof details.statusCode === 'number' && details.statusCode >= 400 ? details.statusCode : 500;
    // 2026-11-07: an unexpected 500 may carry absolute fs paths or other internals in its message,
    // so the client gets the generic text and the original error stays in the server log.
    if (!details.validation && frameworkStatus === 500) {
      app.log.error(error);
      return reply.code(500).send({ code: 'SERVER', message: serverText(messages).actionFailed });
    }
    return reply.code(details.validation ? 400 : frameworkStatus).send({ code: 'SERVER', message: details.validation ? serverText(messages).incomplete : (details.message ?? serverText(messages).actionFailed) });
  });

  app.get('/api/health', async () => ({ app: 'Deckmate', version: '0.1.0', pid: process.pid }));
  app.get<{ Params: { ref: string }; Querystring: { source?: DataSource } }>('/r/:ref', async (request, reply) => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    const reference = request.params.ref;
    if (reference.startsWith('v-')) {
      const board = resolveReference(await boards.list(source), 'v', reference, serverLang());
      if (!board) return reply.code(404).send({ message: serverText(messages).boardMissing });
      return reply.redirect(`/?view=vision&catalogSource=${source}&board=${board.id}`);
    }
    const view = await catalog.get(source);
    if (reference.startsWith('p-')) {
      const pipeline = resolveReference(view.journeys ?? [], 'p', reference, serverLang());
      if (!pipeline) return reply.code(404).send({ message: serverText(messages).pipelineMissing });
      return reply.redirect(`/?view=deck&catalogSource=${source}&deck=${encodeURIComponent(pipeline.deckId)}&journey=${pipeline.id}`);
    }
    const card = resolveReference(view.cards, 'c', reference, serverLang());
    if (!card) return reply.code(404).send({ message: serverText(messages).cardMissing });
    return reply.redirect(`/?view=deck&catalogSource=${source}&scope=all&card=${encodeURIComponent(card.id)}`);
  });
  app.get<{ Querystring: { source?: DataSource } }>('/api/snapshot', async request => ({
    ...await repository.snapshot(request.query.source === 'live' ? 'live' : 'sandbox'), token,
  }));
  app.get<{ Querystring: { source?: DataSource } }>('/api/catalog', async request => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    const view = await catalog.get(source);
    if (source === 'sandbox') observedPlanningView = view;
    return view;
  });
  app.get('/api/onboarding-facts', async () => readOnboardingFacts([config.writeRoot, config.dataRoot]));
  app.get('/api/project-templates', async () => listProjectTemplates());
  app.get<{ Params: { id: string }; Querystring: { source?: DataSource } }>('/api/project-templates/:id/plan', async (request, reply) => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    try {
      return await planProjectTemplate(await catalog.get(source), request.params.id);
    } catch (error) {
      if (error instanceof ProjectTemplateNotFoundError) return reply.code(404).send({ message: error.message });
      throw error;
    }
  });
  // 2026-11-05: planning has its own schema and shares the catalog's mutation queue.
  app.post<{ Body: PlanningEdit & { source: 'sandbox' } }>('/api/planning', { schema: { body: planningBodySchema } }, async (request, reply) => {
    const root = await assertWritable(config, request.body.source);
    let mutationSaved = false;
    try {
      const outcome = await catalog.recordMutation(request.body.action, async () => {
        await applyPlanningEdit(root, request.body);
        return {};
      }, actorOf(request.headers['x-deckmate-actor']));
      mutationSaved = true;
      const view = await catalog.get('sandbox');
      return { ...view, warnings: [...view.warnings, ...outcome.warnings ?? []] };
    } catch (error) {
      if (error instanceof WriteAccessError) throw error;
      const message = error instanceof Error ? error.message : serverText(messages).planFailed;
      const saved = mutationSaved || Boolean(error && typeof error === 'object' && 'saved' in error && error.saved);
      if (saved) catalog.invalidate('sandbox');
      if (/CONFLICT/u.test(message) && !saved) return reply.code(409).send({ message: serverText(messages).planChanged });
      return reply.code(saved ? 503 : 422).send({ message: mutationSaved ? serverText(messages).planSaved : message, saved });
    }
  });
  app.get<{ Querystring: { source?: DataSource; deckId: string; limit?: number; cursor?: string } }>('/api/activity', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['deckId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, deckId: { type: 'string', minLength: 1, maxLength: 80 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string', pattern: '^\\d{8}T\\d{9}Z-[0-9a-f-]{36}\\.md$' },
    },
  } } }, async request => catalog.activity(request.query.source === 'live' ? 'live' : 'sandbox', request.query.deckId, request.query.limit, request.query.cursor));
  // Card history uses pages of at most 20 events (2026-11-04).
  app.get<{ Querystring: { source?: DataSource; cardId: string; limit?: number; cursor?: string } }>('/api/card-activity', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['cardId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, cardId: { type: 'string', minLength: 1, maxLength: 1000 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, cursor: { type: 'string', pattern: '^\\d{8}T\\d{9}Z-[0-9a-f-]{36}\\.md$' },
    },
  } } }, async request => catalog.cardActivity(request.query.source === 'live' ? 'live' : 'sandbox', request.query.cardId, request.query.limit, request.query.cursor));
  // Journey step metrics only read cards and structured journal transitions (2026-11-04).
  app.get<{ Querystring: { source?: DataSource; journeyId: string } }>('/api/journey-metrics', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['journeyId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, journeyId: { type: 'string', pattern: '^[0-9a-f-]{36}$' },
    },
  } } }, async (request, reply) => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    const metrics = await readJourneyMetrics(catalog.root(source), await catalog.get(source), request.query.journeyId);
    return metrics ?? reply.code(404).send({ code: 'CATALOG', message: serverText(messages).journeyMissing });
  });
  // 2026-11-06: the Decks home pulse reads the same cached view as /api/catalog plus the journal; it never writes.
  app.get<{ Querystring: { source?: DataSource } }>('/api/project-pulse', { schema: { querystring: {
    type: 'object', additionalProperties: false, properties: { source: { type: 'string', enum: ['live', 'sandbox'] } },
  } } }, async request => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    return readProjectPulse(catalog.root(source), await catalog.get(source));
  });
  // Per-member notification stacks persist dismissals in the project's notification registry.
  app.get<{ Querystring: { source?: DataSource; member?: string } }>('/api/notifications', { schema: { querystring: {
    type: 'object', additionalProperties: false, properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, member: { type: 'string', maxLength: 80 },
    },
  } } }, async request => notifications.read(request.query.source === 'live' ? 'live' : 'sandbox', request.query.member));
  app.post<{ Body: NotificationDismissRequest }>('/api/notifications/dismiss', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['source', 'memberId', 'at'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, memberId: { type: 'string', pattern: memberIdPattern.source },
      cardId: { type: 'string', minLength: 1, maxLength: 1000 }, stack: { type: 'string', enum: ['owned', 'watching'] },
      at: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' },
    }, oneOf: [{ required: ['cardId'] }, { required: ['stack'] }],
  } } }, async request => notifications.dismiss(request.body));
  app.post<{ Body: NotificationWatchRequest }>('/api/notifications/watch', { schema: { body: {
    type: 'object', additionalProperties: false, required: ['source', 'memberId', 'cardId', 'watching', 'watchHash'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, memberId: { type: 'string', pattern: memberIdPattern.source },
      cardId: { type: 'string', minLength: 1, maxLength: 1000 }, watching: { type: 'boolean' },
      watchHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    },
  } } }, async request => notifications.watch(request.body));
  app.get<{ Querystring: { source?: DataSource; track?: string; limit?: string } }>('/api/summary', async request => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    try { return { source, ...summarizeCatalog(await catalog.get(source), request.query.track, Number(request.query.limit ?? 5)) }; }
    catch (error) { throw new CatalogError(422, error instanceof Error ? error.message : serverText(messages).summaryFailed); }
  });
  // 2026-11-05: agent context reads fresh primary files without triggering catalog housekeeping.
  app.get<{ Querystring: { source?: DataSource; cardId: string; budget?: number } }>('/api/brief', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['cardId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, cardId: { type: 'string', minLength: 1, maxLength: 1000 },
      budget: { type: 'integer', minimum: 1 },
    },
  } } }, async (request, reply) => {
    const root = catalog.root(request.query.source === 'live' ? 'live' : 'sandbox');
    const view = await readProjectCatalog(root);
    const card = resolveReference(view.cards, 'c', request.query.cardId, serverLang());
    if (!card) return reply.code(404).send({ message: serverText(messages).cardMissing });
    try { return await buildBrief(view, root, card, { budget: request.query.budget }); }
    catch (error) {
      if (error instanceof RangeError) throw new CatalogError(422, error.message);
      throw error;
    }
  });
  app.get<{ Querystring: { source?: DataSource; cardId: string; since: string } }>('/api/changes', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['cardId', 'since'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, cardId: { type: 'string', minLength: 1, maxLength: 1000 },
      since: { type: 'string', minLength: 1, maxLength: 100 },
    },
  } } }, async (request, reply) => {
    const root = catalog.root(request.query.source === 'live' ? 'live' : 'sandbox');
    const view = await readProjectCatalog(root);
    const card = resolveReference(view.cards, 'c', request.query.cardId, serverLang());
    if (!card) return reply.code(404).send({ message: serverText(messages).cardMissing });
    try { return await readAgentChanges(root, card, request.query.since); }
    catch (error) {
      if (error instanceof RangeError) throw new CatalogError(422, error.message);
      throw error;
    }
  });
  app.get<{ Querystring: { source?: DataSource; cardId: string } }>('/api/card-content', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['cardId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] },
      cardId: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  } } }, async (request, reply) => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    try { return await readCardContent(catalog.root(source), request.query.cardId); }
    catch (error) {
      if (error instanceof CardContentError) return reply.code(error.status).send({ code: 'CONTENT', message: error.message });
      throw error;
    }
  });
  app.get<{ Querystring: { source?: DataSource } }>('/api/boards', async request => boards.list(request.query.source === 'live' ? 'live' : 'sandbox'));
  app.get<{ Params: { id: string }; Querystring: { source?: DataSource } }>('/api/boards/:id', async request => boards.read(request.query.source === 'live' ? 'live' : 'sandbox', request.params.id));
  app.post<{ Body: { source: DataSource; id?: string; title: string; hash: string; scene: BoardScene } }>('/api/boards', { bodyLimit: 21 * 1024 * 1024, schema: { body: {
    type: 'object', additionalProperties: false, required: ['source', 'title', 'hash', 'scene'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, id: { type: 'string', maxLength: 36 },
      title: { type: 'string', minLength: 1, maxLength: 120 }, hash: { type: 'string', maxLength: 64 }, scene: { type: 'object', additionalProperties: true },
    },
  } } }, async request => boards.save(request.body.source, request.body));
  app.get<{ Querystring: CatalogQuery & { source?: DataSource; fields?: 'brief' } }>('/api/cards', { schema: { querystring: {
    type: 'object', additionalProperties: false, properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] }, text: { type: 'string', maxLength: 1000 },
      deckId: { type: 'string', maxLength: 100 }, trackId: { type: 'string', maxLength: 100 },
      kind: { type: 'string', enum: ['task', 'hero', 'doc'] }, state: { type: 'string', maxLength: 100 },
      owner: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 1000 },
      fields: { type: 'string', enum: ['brief'] },
    },
  } } }, async request => {
    const source = request.query.source === 'live' ? 'live' : 'sandbox';
    if (request.query.fields !== 'brief') return catalog.search(source, request.query);
    const contextCatalog = new CatalogService({ ...config, editMode: 'read-only' }, ':memory:');
    try {
      const cards = await contextCatalog.search(source, request.query, { hits: true });
      return cards.map(({ markdown, ...card }) => card);
    } finally { await contextCatalog.close(); }
  });
  const catalogRequirements: Record<CatalogEdit['action'], string[]> = {
    'bulk-edit-cards': ['cards', 'optionsHash', 'change'],
    'set-card-state': ['cardId', 'sourceHash', 'state'],
    'set-card-properties': ['cardId', 'sourceHash', 'owner', 'effort', 'priority'],
    'set-card-parent': ['cardId', 'sourceHash', 'expectedParentId', 'parentId', 'parentSourceHash'],
    'reorder-subcards': ['cardId', 'sourceHash', 'cardIds'],
    'configure-members': ['members'],
    'save-project-tag': ['tagsHash', 'tag'],
    'raise-decision': ['cardId', 'sourceHash', 'questionIndex', 'questionText', 'taskCardId', 'deckId', 'memberId'],
    'record-decision': ['cardId', 'sourceHash', 'questionIndex', 'questionText', 'answer', 'memberId'],
    'set-card-links': ['cardId', 'deckId', 'trackIds', 'sourceHash'],
    'bulk-assign-deck': ['cards', 'deckId'], 'bulk-add-track': ['cards', 'trackId'],
    'create-space': ['title'], 'create-deck': ['title', 'spaceId', 'kind', 'icon', 'color', 'description'],
    'update-space': ['spaceId', 'title', 'kind', 'icon'],
    'update-deck': ['deckId', 'title', 'icon', 'color', 'description', 'style', 'cover', 'coverPosition'],
    'set-deck-kind': ['deckId', 'kind'],
    'upload-cover': ['deckId', 'dataUrl'],
    'move-deck': ['deckId', 'spaceId', 'beforeDeckId'],
    'set-deck-watchers': ['deckId', 'watcherIds'],
    'set-deck-pile': ['deckId', 'piled'],
    'set-deck-guardians': ['deckId', 'guardianIds'],
    'set-deck-automation': ['deckId', 'autoTag', 'autoTagKeep', 'templateMarkdown', 'templateOwner', 'templateEffort', 'templatePriority'],
    'set-deck-default-order': ['deckId', 'defaultOrder'],
    'delete-deck': ['deckId'],
    'create-journey': ['deckId', 'title', 'steps'],
    'apply-journey': ['cardId', 'journeyId', 'journeyHash', 'stepIds', 'deckAssignments', 'sourceHash'],
    'update-journey': ['journeyId', 'journeyHash', 'title', 'description', 'zones', 'steps'],
    'import-journey-template': ['deckId', 'templateId', 'templateSource', 'templateHash', 'mode', 'journeyId', 'journeyHash', 'roleMapping'],
    'save-journey-template': ['journeyId', 'journeyHash', 'title', 'description', 'category', 'tags'],
    'add-journey-step-lesson': ['journeyId', 'journeyHash', 'stepId', 'cardId', 'text'],
    'create-track': ['title', 'description'], 'assign-deck': ['cardId', 'deckId'], 'set-tracks': ['cardId', 'trackIds'],
    'upload-attachment': ['cardId', 'attachmentsHash', 'dataUrl'],
    'remove-attachment': ['cardId', 'attachmentsHash', 'file'],
    'set-card-cover': ['cardId', 'attachmentsHash', 'coverFile', 'coverPosition', 'coverTitleMode', 'coverBlur'],
    'update-card-content': ['cardId', 'title', 'markdown', 'sourceHash'],
    'add-card-report': ['cardId', 'markdown', 'sourceHash'],
    // Apply the starter project template through the project-template module (2026-11-05).
    'apply-project-template': ['templateId', 'templateHash', 'samples'],
    'create-card': ['cardId', 'kind', 'title', 'markdown', 'deckId', 'trackIds', 'parentId', 'owner', 'effort', 'priority'],
    // Manual order, Zones, and the default Inbox Deck (2026-11-04).
    'set-deck-zones': ['deckId', 'zones'],
    'move-cards-in-deck': ['deckId', 'cards', 'zoneId', 'beforeCardId'],
    'set-inbox-deck': ['deckId'],
    'set-card-dependencies': ['cardId', 'sourceHash', 'dependsOn'],
    'reorder-hand': ['memberId', 'cards'],
  };
  // Card titles allow up to 1,000 characters; catalog entity names use a shorter limit.
  const shortTitleActions = ['create-space', 'update-space', 'create-deck', 'update-deck', 'create-track', 'create-journey', 'update-journey', 'save-journey-template'];
  // 2026-11-04: a 10 MB attachment becomes about 13.4 MB in base64, requiring a 16 MB request limit.
  app.post<{ Body: CatalogEdit & { source: DataSource } }>('/api/catalog', { bodyLimit: 16 * 1024 * 1024,
    preValidation: async (request, reply) => {
      const body = request.body;
      if (body && (body.action === 'create-card' || body.action === 'update-card-content')
        && (typeof body.title !== 'string' || typeof body.markdown !== 'string')) {
        return reply.code(400).send({ code: 'CONTENT', message: serverText(messages).contentStrings });
      }
      if (body?.action === 'add-card-report' && typeof body.markdown !== 'string') {
        return reply.code(400).send({ code: 'CONTENT', message: serverText(messages).contentStrings });
      }
    }, schema: { body: {
    type: 'object', additionalProperties: false, required: ['action', 'manifestHash', 'source'], properties: {
      action: { type: 'string', enum: Object.keys(catalogRequirements) }, manifestHash: { type: 'string', maxLength: 64 },
      optionsHash: { type: 'string', pattern: '^(?:[0-9a-f]{64})?$' },
      tagsHash: { type: 'string', pattern: '^(?:[0-9a-f]{64})?$' },
      tag: { type: 'object', additionalProperties: false, required: ['name', 'color'], properties: {
        name: { type: 'string', minLength: 1, maxLength: 80 }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        emoji: { type: ['string', 'null'], minLength: 1, maxLength: 16 },
        iconSvg: { type: 'string', minLength: 1, maxLength: 16384 },
        cardId: { type: ['string', 'null'], maxLength: 1000 },
      } },
      change: { type: 'object', required: ['kind'], additionalProperties: true, properties: { kind: { type: 'string', enum: ['properties', 'state', 'parent', 'create-parent', 'promote-parent', 'options', 'hand', 'tags', 'convert', 'duplicate', 'track'] } } },
      members: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['id', 'label', 'kind', 'aliases'], properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' }, label: { type: 'string', minLength: 1, maxLength: 80 },
        kind: { type: 'string', enum: ['agent', 'human'] }, aliases: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
      } } },
      cards: { type: 'array', minItems: 1, maxItems: 1000, uniqueItems: true, items: { type: 'object', additionalProperties: false, required: ['cardId', 'sourceHash'], properties: {
        cardId: { type: 'string', minLength: 1, maxLength: 1000 }, sourceHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
        expectedParentId: { type: ['string', 'null'], minLength: 1, maxLength: 1000 },
      } } },
      trackId: { type: 'string', minLength: 1, maxLength: 80 },
      // 2026-11-04: explicit properties prevent AJV from stripping open-question fields from the request.
      questionIndex: { type: 'integer', minimum: 0, maximum: 999 },
      questionText: { type: 'string', minLength: 1, maxLength: 2000 },
      taskCardId: { type: 'string', minLength: 1, maxLength: 1000 },
      memberId: { type: 'string', minLength: 1, maxLength: 80 },
      answer: { type: 'string', minLength: 1, maxLength: 2000 },
      cardIds: { type: 'array', maxItems: 1000, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 1000 } },
      sourceHash: { type: 'string', minLength: 64, maxLength: 64 },
      source: { type: 'string', enum: ['live', 'sandbox'] }, title: { type: 'string', minLength: 1, maxLength: 1000, pattern: '^[^\\r\\n]+$' },
      markdown: { type: 'string', maxLength: 200000 },
      effort: { type: ['number', 'null'], minimum: 0 },
      state: { type: 'string', enum: cardStates.flatMap(cardStateWords) },
      priority: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
      owner: { type: ['string', 'null'], maxLength: 200 },
      parentId: { type: ['string', 'null'], maxLength: 1000 },
      expectedParentId: { type: ['string', 'null'], maxLength: 1000 },
      parentSourceHash: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
      spaceId: { type: 'string', maxLength: 80 }, kind: { type: 'string', enum: ['asset', 'task', 'knowledge', 'mixed', 'gdd', 'tasks', 'qa', 'custom', 'hero', 'doc'] },
      icon: { type: 'string', maxLength: 32 }, color: { type: 'string', pattern: '^#[a-fA-F0-9]{6}$' },
      description: { type: 'string', maxLength: 2000 }, cardId: { type: 'string', maxLength: 1000 },
      deckId: { type: ['string', 'null'], maxLength: 80 },
      beforeDeckId: { type: ['string', 'null'], maxLength: 80 },
      zoneId: { type: ['string', 'null'], pattern: '^[a-z0-9][a-z0-9-]{0,59}$' },
      beforeCardId: { type: ['string', 'null'], maxLength: 1000 },
      // Deck actions: watching, guardians, automation, deletion, and guardian approval (2026-11-04).
      watcherIds: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' } },
      guardianIds: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' } },
      autoTag: { type: ['string', 'null'], maxLength: 80 },
      autoTagKeep: { type: 'boolean' },
      // 2026-11-06: set-deck-pile moves a deck to the pile at the end of its space (true) or back to the shelf (false).
      piled: { type: 'boolean' },
      templateMarkdown: { type: ['string', 'null'], maxLength: 50000 },
      templateOwner: { type: ['string', 'null'], maxLength: 120 },
      templateEffort: { type: ['number', 'null'], minimum: 0 },
      templatePriority: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
      defaultOrder: { type: ['string', 'null'], maxLength: 200, pattern: '^[a-zA-Z0-9=&.,%]*$' },
      acceptedBy: { type: ['string', 'null'], maxLength: 120 },
      // Journey return reasons and step lessons are single lines of up to 500 characters (2026-11-04).
      returnReason: { type: ['string', 'null'], maxLength: 500, pattern: '^[^\\r\\n]*$' },
      stepId: { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$' },
      text: { type: 'string', minLength: 1, maxLength: 500, pattern: '^[^\\r\\n]+$' },
      style: { type: 'string', enum: ['symbol', 'artwork', 'minimal'] },
      cover: { type: ['string', 'null'], maxLength: 1000 },
      coverPosition: { type: 'number', minimum: 0, maximum: 100 },
      // 2026-11-04: attachments allow 10 MB per file (about 13.4 MB base64); deck covers use the limit below.
      dataUrl: { type: 'string', maxLength: 14 * 1024 * 1024 },
      // Attachment actions are handled by server/attachments.ts (2026-11-04).
      attachmentsHash: { type: 'string', pattern: '^(?:[0-9a-f]{64})?$' },
      fileName: { type: ['string', 'null'], maxLength: 200 },
      addedBy: { type: ['string', 'null'], maxLength: 80 },
      file: { type: 'string', minLength: 1, maxLength: 300 },
      coverFile: { type: ['string', 'null'], minLength: 1, maxLength: 300 },
      coverTitleMode: { type: 'string', enum: ['light', 'dark'] },
      coverBlur: { type: 'boolean' },
      journeyId: { type: ['string', 'null'], maxLength: 100 }, journeyHash: { type: ['string', 'null'], pattern: '^[0-9a-f]{64}$' },
      templateId: { type: 'string', minLength: 1, maxLength: 60, pattern: '^[a-z0-9][a-z0-9-]{0,59}$' },
      templateSource: { type: 'string', enum: ['bundled', 'project'] },
      templateHash: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      samples: { type: 'boolean' },
      mode: { type: 'string', enum: ['add', 'replace'] },
      roleMapping: { type: 'object', maxProperties: 20, additionalProperties: { type: 'object', additionalProperties: false, properties: {
        deckId: { type: 'string', minLength: 1, maxLength: 80 },
        createDeck: { type: 'object', additionalProperties: false, required: ['title', 'spaceId'], properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 }, spaceId: { type: 'string', minLength: 1, maxLength: 80 } } } },
        oneOf: [{ required: ['deckId'] }, { required: ['createDeck'] }] } },
      category: { type: 'string', minLength: 1, maxLength: 60 },
      tags: { type: 'array', maxItems: 20, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 40 } },
      zones: { type: 'array', maxItems: 20, items: { type: 'object', additionalProperties: false, required: ['id', 'title'], properties: {
        id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,59}$' }, title: { type: 'string', minLength: 1, maxLength: 120 } } } },
      stepIds: { type: 'array', minItems: 1, maxItems: 30, uniqueItems: true, items: { type: 'string', maxLength: 80 } },
      deckAssignments: { type: 'object', maxProperties: 30, additionalProperties: { type: 'string', maxLength: 80 } },
      steps: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false,
        required: ['id', 'title', 'markdown', 'deckId', 'owner', 'dependsOn'], properties: {
          id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' }, title: { type: 'string', minLength: 1, maxLength: 200 },
          markdown: { type: 'string', maxLength: 50000 }, deckId: { type: 'string', maxLength: 80 },
          owner: { type: ['string', 'null'], maxLength: 200 },
          dependsOn: { type: 'array', maxItems: 30, uniqueItems: true, items: { type: 'string', maxLength: 80 } },
          effort: { type: ['number', 'null'], minimum: 0 },
          priority: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
          zoneId: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,59}$' },
        },
      } },
      trackIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', maxLength: 80 } },
      // set-card-dependencies replaces the full list of dependency IDs (2026-11-04).
      dependsOn: { type: 'array', maxItems: 200, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 1000 } },
    },
    allOf: [
      ...Object.entries(catalogRequirements).map(([action, required]) => ({
        if: { properties: { action: { const: action } } }, then: { required },
      })),
      { if: { properties: { action: { enum: shortTitleActions } }, required: ['action'] },
        then: { type: 'object', properties: { title: { type: 'string', maxLength: 120 } } } },
      // Only an import creating a new Journey may use null journeyId/journeyHash.
      { if: { properties: { action: { enum: ['apply-journey', 'update-journey', 'save-journey-template', 'add-journey-step-lesson'] } }, required: ['action'] },
        then: { properties: { journeyId: { type: 'string' }, journeyHash: { type: 'string' } } } },
      { if: { properties: { action: { const: 'set-deck-kind' } }, required: ['action'] },
        then: { properties: { kind: { type: 'string', enum: ['asset', 'task', 'knowledge', 'mixed'] } } } },
      // Deck covers allow 5 MB (7 MB base64); server/attachments.ts validates attachments.
      { if: { properties: { action: { const: 'upload-cover' } }, required: ['action'] },
        then: { properties: { dataUrl: { type: 'string', maxLength: 7 * 1024 * 1024 } } } },
    ],
  } } }, async request => {
    // 2026-11-04: attachment actions share the /api/catalog contract and delegate to server/attachments.ts.
    if (attachmentEditActions.has(request.body.action)) {
      // Use the request actor as the uploader; addedBy is a fallback for API calls without an actor.
      const attachmentEdit = request.body as AttachmentEditAction & { source: DataSource };
      const actor = actorOf(request.headers['x-deckmate-actor']);
      return runAttachmentEdit(catalog, config, attachmentEdit.action === 'upload-attachment' && actor ? { ...attachmentEdit, addedBy: actor } : attachmentEdit);
    }
    return catalog.edit(request.body, request.body.source, actorOf(request.headers['x-deckmate-actor']));
  });
  // CSV import has its own endpoint: 10 MB of CSV expands into JSON beyond the catalog request limit.
  // Writes share the recordMutation queue and activity journal.
  app.post<{ Body: CatalogImportEdit }>('/api/catalog-import', { bodyLimit: 24 * 1024 * 1024, schema: { body: {
    type: 'object', additionalProperties: false, required: ['source', 'manifestHash', 'optionsHash', 'deckId', 'cards'], properties: {
      source: { type: 'string', enum: ['sandbox'] }, manifestHash: { type: 'string', maxLength: 64 },
      optionsHash: { type: 'string', pattern: '^(?:[0-9a-f]{64})?$' }, deckId: { type: 'string', minLength: 1, maxLength: 80 },
      cards: { type: 'array', minItems: 1, maxItems: 5000, items: { type: 'object', additionalProperties: false,
        required: ['cardId', 'kind', 'title', 'markdown', 'owner', 'effort', 'priority', 'state', 'tags'], properties: {
          cardId: { type: ['string', 'null'], maxLength: 1000 },
          kind: { type: 'string', enum: ['task', 'hero', 'doc'] },
          title: { type: 'string', minLength: 1, maxLength: 1000 },
          markdown: { type: 'string', maxLength: 200000 },
          owner: { type: ['string', 'null'], maxLength: 200 },
          effort: { type: ['number', 'null'], minimum: 0 },
          priority: { type: ['string', 'null'], enum: ['high', 'medium', 'low', null] },
          state: { type: ['string', 'null'], maxLength: 40 },
          tags: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 80 } },
        } } },
    },
  } } }, async (request, reply) => {
    const root = await assertWritable(config, request.body.source);
    try {
      // Keep import warnings separately because recordMutation replaces warnings if journaling fails.
      let importWarnings: string[] = [];
      const result = await catalog.recordMutation('import-cards', async () => {
        const outcome = await importCards(root, request.body);
        importWarnings = outcome.warnings;
        return outcome;
      }, actorOf(request.headers['x-deckmate-actor']));
      const journalWarnings = (result.warnings ?? []).filter(message => !importWarnings.includes(message));
      return { ...result, warnings: [...importWarnings, ...journalWarnings] };
    } catch (error) {
      if (error instanceof WriteAccessError) throw error;
      const message = error instanceof Error ? error.message : serverText(messages).importFailed;
      if (['CATALOG_CONFLICT', 'CARD_CONFLICT', 'CARD_OPTIONS_CONFLICT'].includes(message)) {
        return reply.code(409).send({ code: 'CATALOG', message: serverText(messages).importChanged });
      }
      return reply.code(422).send({ code: 'IMPORT', message });
    }
  });
  app.get<{ Querystring: { source?: DataSource; cardId: string } }>('/api/attachments', { schema: { querystring: {
    type: 'object', additionalProperties: false, required: ['cardId'], properties: {
      source: { type: 'string', enum: ['live', 'sandbox'] },
      cardId: { type: 'string', minLength: 1, maxLength: 1000 },
    },
  } } }, async (request, reply) => {
    try { return await readCardAttachments(catalog.root(request.query.source === 'live' ? 'live' : 'sandbox'), request.query.cardId); }
    catch (error) {
      // 2026-11-06: an identifier that cannot name an attachment directory answers 400, not a server error.
      if (error instanceof InvalidAttachmentIdError) return reply.code(400).send({ code: 'CONTENT', message: error.message });
      throw error;
    }
  });
  app.get<{ Querystring: { path: string; source?: DataSource; from?: string; to?: string } }>('/api/file', async (request, reply) => {
    const relative = request.query.path ?? '';
    // 2026-11-06: traversal segments, absolute paths, NUL bytes and repeated query values are refused here;
    // containedFile below still covers symlinks and junctions that reach outside the project root.
    if (!servableRequestPath(relative)) return reply.code(404).send();
    const extension = path.extname(relative).toLowerCase();
    if (!['.md', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif', '.pdf'].includes(extension)) return reply.code(404).send();
    if (!/^(features|docs|tasks|cards)\//u.test(relative)) return reply.code(404).send();
    let filename: string;
    try { filename = await containedFile(repository.root(request.query.source === 'live' ? 'live' : 'sandbox'), relative); }
    catch (error) {
      // 2026-11-04: deleted attachments and missing files return 404 instead of a server error.
      // 2026-11-06: a symlink or junction escaping the project root is also an unservable path, not a server error.
      if (['ENOENT', 'OUTSIDE_PROJECT'].includes((error as NodeJS.ErrnoException).code ?? '')) return reply.code(404).send();
      throw error;
    }
    reply.header('Content-Security-Policy', `default-src 'none'; sandbox; ${framingHeaders['Content-Security-Policy']}`);
    if (request.query.from !== undefined || request.query.to !== undefined) {
      if (extension !== '.md' || !/^[1-9]\d*$/u.test(request.query.from ?? '') || !/^[1-9]\d*$/u.test(request.query.to ?? '')) {
        throw new CatalogError(422, 'from/to require a Markdown file and an inclusive line range starting at 1.');
      }
      try {
        const range = await readFileLines(repository.root(request.query.source === 'live' ? 'live' : 'sandbox'), relative,
          Number(request.query.from), Number(request.query.to));
        reply.type('text/plain; charset=utf-8');
        return Buffer.from(range.markdown, 'utf8');
      } catch (error) {
        if (error instanceof RangeError || (error as NodeJS.ErrnoException).code === 'INVALID_MARKDOWN_PATH') throw new CatalogError(422, (error as Error).message);
        throw error;
      }
    }
    reply.type(extension === '.md' ? 'text/plain; charset=utf-8' : types[extension]);
    return readFile(filename).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reply.code(404).send();
      throw error;
    });
  });
  app.post('/api/shutdown', async (_request, reply) => {
    await reply.send({ closed: true });
    setTimeout(() => { void app.close(); }, 100);
  });
  app.get('/*', async (request, reply) => {
    try {
      // A malformed escape (/%E0%A4%A) is a missing page, not a server error (security audit 2026-11-05, finding 6).
      const requested = decodeURIComponent(request.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
      const relative = path.extname(requested) ? requested : 'index.html';
      const filename = await containedFile(clientRoot, relative);
      reply.type(types[path.extname(filename)] ?? 'application/octet-stream');
      return await readFile(filename);
    } catch { return reply.code(404).send(serverText(messages).pageMissing); }
  });

  app.server.on('upgrade', (request, socket, head) => {
    let url: URL;
    try { url = new URL(request.url ?? '/', 'http://127.0.0.1'); }
    catch { socket.destroy(); return; }
    if (url.pathname !== '/api/events' || !allowedHosts.has(request.headers.host ?? '')
      || (request.headers.origin && !allowedOrigins.has(request.headers.origin)) || url.searchParams.get('token') !== token) {
      socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, client => sockets.emit('connection', client, request));
  });
  const broadcast = (source: DataSource, relativePath: string) => {
    catalog.invalidate(source, relativePath);
    const message = JSON.stringify({ type: 'changed', source, relativePath, detectedAt: Date.now() });
    for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
  };
  const watchFailed = (source: DataSource) => {
    catalog.watchFailed(source);
    const message = JSON.stringify({ type: 'watcher-error', source });
    for (const client of sockets.clients) if (client.readyState === WebSocket.OPEN) client.send(message);
  };
  // 2026-11-05: direct mode has one root and one event source, so each file change is delivered once.
  const projectSource: DataSource = config.editMode === 'direct' ? 'sandbox' : 'live';
  const watchers = [watchProjectFiles(config.dataRoot, relative => broadcast(projectSource, relative), () => watchFailed(projectSource))];
  if (config.editMode === 'sandbox' && config.writeRoot) {
    watchers.push(watchProjectFiles(config.writeRoot, relative => broadcast('sandbox', relative), () => watchFailed('sandbox')));
  }
  await Promise.all(watchers.map(watcher => watcher.ready));
  // 2026-11-05: GET only supplies an observed view. Daily machine history is a separate queued job;
  // it never edits Run/Milestone registries and never scans a project that has not been opened.
  const historyTimer = setInterval(() => {
    if (!observationDue || historyWrite || config.editMode === 'read-only' || !config.writeRoot || !observedPlanningView) return;
    const view = observedPlanningView;
    if (!needsPlanningObservation(view)) return;
    historyWrite = catalog.recordMutation('observe-planning', async () => {
      const root = await assertWritable(config);
      await recordPlanningObservation(root, view);
      if (observedPlanningView === view) { observedPlanningView = null; observationDue = false; }
      return {};
    }).then(() => {}).catch(error => {
      if (observedPlanningView === view) observedPlanningView = null;
      app.log.warn({ err: error }, 'Planning observation was not saved.');
    })
      .finally(() => { historyWrite = null; });
  }, 60_000);
  historyTimer.unref();
  // 2026-11-05: scheduled Runs advance on their own: every minute the server reads the small Run
  // registry and, only when a period has ended or the upcoming count is short, finishes, carries and replenishes through the
  // write queue, so the activity log names the move. A blocked carry (no current period yet) or a failure waits ten minutes.
  let runScheduleWrite: Promise<void> | null = null;
  let runScheduleRetryAt = 0;
  const advanceRunSchedules = () => {
    if (runScheduleWrite || config.editMode === 'read-only' || !config.writeRoot || Date.now() < runScheduleRetryAt) return;
    runScheduleWrite = (async () => {
      const source = await readRuns(config.writeRoot!);
      if (source.warnings.length || !runScheduleDue(source)) return;
      const outcome = await catalog.recordMutation('advance-runs', async () => maintainRecurringRuns(await assertWritable(config)));
      if (outcome.blocked) { runScheduleRetryAt = Date.now() + 600_000; console.warn(`Deckmate: ${outcome.blocked}`); }
    })().catch(error => {
      runScheduleRetryAt = Date.now() + 600_000;
      console.warn(`Deckmate: scheduled Runs were not advanced, retrying in 10 minutes: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { runScheduleWrite = null; });
  };
  const runScheduleTimer = setInterval(advanceRunSchedules, 60_000);
  runScheduleTimer.unref();
  app.addHook('onResponse', async (request, reply) => {
    if (request.method === 'POST' && reply.statusCode < 400 && /^\/api\/(catalog|planning)(\?|$)/u.test(request.url)) observationDue = true;
  });
  // 2026-11-05: upgraded browser sockets must close before Fastify waits for the HTTP server.
  app.addHook('preClose', async () => {
    clearInterval(historyTimer);
    clearInterval(runScheduleTimer);
    await historyWrite;
    await runScheduleWrite;
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve, reject) => sockets.close(error => error ? reject(error) : resolve()));
  });
  app.addHook('onClose', async () => {
    await Promise.all(watchers.map(watcher => watcher.close()));
    await catalog.close();
    await boards.close();
  });
  return app;
}
