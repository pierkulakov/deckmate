import { listProjectTemplates, planProjectTemplate } from '../../server/project-templates.ts';
import { writeCatalog } from '../../server/cli-write.ts';
import type { CommandContext, CommandOptions } from './types.ts';

export async function run(context: CommandContext, positionals: string[], options: CommandOptions): Promise<void> {
  if (positionals.length > 1) throw new Error('init: specify one template ID.');
  const templateId = positionals[0];
  if (!templateId) {
    if (options.has('samples') || options.has('dry')) throw new Error('init: --samples and --dry require a template ID.');
    const templates = await listProjectTemplates();
    console.log(JSON.stringify(templates.map(template => ({ id: template.id, title: template.title,
      description: template.description, decks: template.decks.length,
      journeys: template.decks.filter(deck => deck.journey).length })), null, 2));
    return;
  }
  const plan = await planProjectTemplate(context.root, templateId);
  const samples = options.has('samples');
  if (options.has('dry')) {
    console.log(JSON.stringify({ source: context.source, ...plan,
      items: plan.items.filter(item => samples || item.kind !== 'sample'), samples }, null, 2));
    return;
  }
  const result = await writeCatalog(context.config, context.source, { action: 'apply-project-template',
    templateId, templateHash: plan.templateHash, manifestHash: plan.manifestHash, samples }, options.get('member') ?? null);
  // 2026-11-05: a partial apply is whatever the plan still has to create or resume; old data-health warnings of the
  // project do not count, and scripts get a nonzero exit code only for the template itself.
  const remaining = (await planProjectTemplate(context.root, templateId)).items
    .filter(item => (samples || item.kind !== 'sample') && (item.status === 'create' || item.status === 'resume'));
  console.log(JSON.stringify({ source: context.source, templateId, samples, ...result, remaining }, null, 2));
  if (remaining.length > 0) process.exitCode = 1;
}
