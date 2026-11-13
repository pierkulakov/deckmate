import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { agentInstructions, agentToolDefinitions } from '../src/agent-tools.ts';
import { layoutRules, layoutRulesMarkdown, layoutToolHint } from '../src/layout-rules.ts';
import { estimateTokens } from '../server/agent-brief.ts';
import { assembleAgentRules } from '../tools/deckmate-skills.ts';

it('keeps the installed layout Markdown identical to the single shared source', async () => {
  const markdown = await readFile('skills/deckmate/layout-rules.md', 'utf8');
  expect(markdown).toBe(layoutRulesMarkdown());
  expect(layoutRules).toHaveLength(10);
  for (const rule of layoutRules) {
    expect(rule).not.toMatch(/[\r\n]/u);
    expect(markdown.split(rule)).toHaveLength(2);
  }
});

it('keeps the assembled AGENTS.md block within 700 estimated tokens', async () => {
  const rules = assembleAgentRules(await readFile('skills/deckmate/project-rules.md'),
    await readFile('skills/deckmate/layout-rules.md'));
  const block = `<!-- deckmate:agent-rules:start -->\n${rules.toString('utf8')}<!-- deckmate:agent-rules:end -->\n`;
  const tokens = estimateTokens(block);
  console.log(`Assembled AGENTS.md rules block: ${tokens} estimated tokens (budget 700).`);
  expect(rules.toString('utf8')).toBe(`${await readFile('skills/deckmate/project-rules.md', 'utf8')}\n${layoutRulesMarkdown()}`);
  expect(tokens).toBeLessThanOrEqual(700);
});

it('carries the layout hint in create_cards and one initialize instruction line', () => {
  expect(agentToolDefinitions.find(tool => tool.name === 'create_cards')?.description).toContain(layoutToolHint);
  expect(agentToolDefinitions.find(tool => tool.name === 'organize')?.inputSchema).toMatchObject({
    type: 'object', properties: { about: { type: 'string' } },
  });
  expect(agentInstructions).toContain(`Layout: ${layoutToolHint}; organize checks placement.`);
  expect(agentInstructions).not.toMatch(/[\r\n]/u);
});
