import { defineText, serverText } from './i18n.ts';
import type { WorkspaceSnapshot } from '../src/workspace-contracts.ts';

const messages = defineText({
  noIteration: "No iteration set",
}, {
  noIteration: "Итерация не задана",
});


// 2026-11-04: mechanics-page parsing (buildPage) was removed with the Docs tab.
// Iteration history still supplies Sprint, Timeline, and slice iteration labels.
const datePattern = /\d{4}-\d{2}-\d{2}/u;

export function readIteration(markdown: string): WorkspaceSnapshot['iteration'] {
  const normalized = markdown.replace(/\r\n/gu, '\n');
  const headings = Array.from(normalized.matchAll(/^## Итерация (\d+) — (.+)$/gmu));
  const lastHeading = headings.at(-1);
  if (!lastHeading) return { number: 0, goal: serverText(messages).noIteration, start: '' };

  const followingText = normalized.slice((lastHeading.index ?? 0) + lastHeading[0].length);
  return {
    number: Number(lastHeading[1]),
    goal: lastHeading[2].trim(),
    start: datePattern.exec(followingText)?.[0] ?? '0000-00-00',
  };
}
