import type { FastifyInstance } from 'fastify';
import { defineText, serverText } from './i18n.ts';
import type { createProjectTemplateList, ProjectTemplateOptions } from './project-templates.ts';

const messages = defineText({
  rateLimited: 'Too many template requests. Try again shortly.',
}, {
  rateLimited: 'Слишком много запросов шаблонов. Повторите попытку чуть позже.',
});

const windowMs = 60_000;
const requestsPerWindow = 120;

export function registerProjectTemplatesRoute(app: FastifyInstance, options: ProjectTemplateOptions = {}): void {
  let windowStarted = 0;
  let requests = 0;
  let list: Promise<ReturnType<typeof createProjectTemplateList>> | undefined;
  app.get('/api/project-templates', {
    onRequest: async (_request, reply) => {
      // 2026-11-13: one local-server budget covers GET and HEAD across connections, languages and forwarded headers.
      const now = performance.now();
      if (requests === 0 || now - windowStarted >= windowMs) { windowStarted = now; requests = 0; }
      if (requests >= requestsPerWindow) {
        return reply.code(429).header('Retry-After', Math.ceil((windowMs - (now - windowStarted)) / 1000))
          .send({ message: serverText(messages).rateLimited });
      }
      requests += 1;
    },
  }, async () => {
    // 2026-11-13: defer the template/catalog imports until an admitted request needs the list.
    list ??= import('./project-templates.ts').then(module => module.createProjectTemplateList(options));
    return (await list)();
  });
}
