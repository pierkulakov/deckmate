import type { DataSource } from '../src/workspace-contracts.ts';

export interface WorkspaceFileChange { source: DataSource; relativePath?: string }
const listeners = new Set<(change: WorkspaceFileChange) => void>();

// 2026-11-09: file-specific consumers share useWorkspace's authenticated socket, including reconnects.
export function subscribeWorkspaceFiles(listener: (change: WorkspaceFileChange) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function publishWorkspaceFileChange(change: WorkspaceFileChange): void {
  for (const listener of listeners) listener(change);
}
