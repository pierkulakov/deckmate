import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { OnboardingFacts } from '../src/onboarding-contracts.ts';

// The same destinations `deckmate skills install` writes to (tools/deckmate-skills.ts).
const skillFiles = ['.claude/skills/deckmate/SKILL.md', '.agents/skills/deckmate/SKILL.md'];

async function isFile(file: string): Promise<boolean> {
  try { return (await stat(file)).isFile(); } catch { return false; }
}

/** Facts for onboarding quests; reads a few paths and never fails — a missing folder is simply «not yet». */
export async function readOnboardingFacts(roots: readonly (string | null)[]): Promise<OnboardingFacts> {
  const folders = [...new Set(roots.filter((root): root is string => Boolean(root)))];
  const checks = folders.flatMap(root => skillFiles.map(file => isFile(path.join(root, file))));
  return { agentSkill: (await Promise.all(checks)).some(Boolean) };
}
