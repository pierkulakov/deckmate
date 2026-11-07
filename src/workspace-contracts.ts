import type { CardState } from './format-vocabulary.ts';

// 2026-11-04: shared snapshot fields remain after removing the Docs tab,
// slice board, /api/block, and /api/status.

export type SliceStatus = CardState;
// 2026-11-05: 'sandbox' names the writable source, including the project itself in direct mode.
export type DataSource = 'live' | 'sandbox';
export type EditMode = 'direct' | 'sandbox' | 'read-only';

export interface WorkspaceSnapshot {
  projectName: string;
  source: DataSource;
  writable: boolean;
  editMode: EditMode;
  iteration: { number: number; goal: string; start: string };
}

export interface ApiFailure {
  code: string;
  message: string;
}
