import type { MilestoneRecord, RunRecord, RunConfiguration, RunCarryOver } from './catalog-contracts.ts';

export const runsPath = 'tasks/deckmate-runs.md';
export const milestonesPath = 'tasks/deckmate-milestones.md';
export const planningHistoryPath = 'tasks/deckmate-planning-history.md';

/** Timeline writes use captured file revisions, 2026-11-05. */
export type PlanningEdit =
  | { action: 'update-run'; run: RunRecord; runsHash: string }
  | { action: 'save-run-configuration'; configuration: RunConfiguration; runsHash: string }
  | { action: 'finish-run'; runId: string; carryOver: RunCarryOver; runsHash: string; optionsHash: string }
  | { action: 'delete-run'; runId: string; runsHash: string; optionsHash: string }
  | { action: 'resume-runs'; configurationId: string; runsHash: string }
  | { action: 'create-milestone'; milestone: MilestoneRecord; milestonesHash: string }
  | { action: 'update-milestone'; milestone: MilestoneRecord; milestonesHash: string }
  | { action: 'delete-milestone'; milestoneId: string; milestonesHash: string; optionsHash: string; manifestHash: string }
  | { action: 'pin-milestone'; milestoneId: string | null; milestonesHash: string; manifestHash: string };
