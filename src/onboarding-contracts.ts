/** What the onboarding quests learn from the server: facts about the project folder that no catalog edit reports (2026-11-05). */
export interface OnboardingFacts {
  /** The `/deckmate` agent skill is installed in the project (`.claude/skills/deckmate` or `.agents/skills/deckmate`). */
  agentSkill: boolean;
}
