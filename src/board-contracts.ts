export interface BoardScene {
  type: 'excalidraw';
  version: 2;
  elements: Record<string, unknown>[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
// Vision board access states.
// Stored inside scene.appState.deckmateAccess so the file format and the POST schema stay unchanged.
export type BoardAccess = 'editable' | 'readonly' | 'locked';
export const boardAccesses: BoardAccess[] = ['editable', 'readonly', 'locked'];
export const BOARD_ACCESS_KEY = 'deckmateAccess';

// A Smart Node queries one deck with an optional state filter;
// its progress bar shows accepted cards out of the total.
export interface BoardSmartQuery { deckId: string; state: string | null }

export interface BoardSummary {
  id: string;
  title: string;
  hash: string;
  path: string;
  linkedCardIds: string[];
  updatedAt: string;
  access: BoardAccess;
  warnings?: string[];
}
export interface BoardDocument extends BoardSummary { scene: BoardScene }

/** Reads access from a stored scene; unknown values default to Editable. */
export function boardAccessOf(scene: Pick<BoardScene, 'appState'>): BoardAccess {
  // 2026-11-05: a legacy Locked board must stay locked without rewriting its scene.
  for (const value of [scene.appState[BOARD_ACCESS_KEY], scene.appState.freetionAccess]) {
    if (typeof value === 'string' && boardAccesses.includes(value as BoardAccess)) return value as BoardAccess;
  }
  return 'editable';
}

type BoardCustomField = 'CardId' | 'CardView' | 'Smart' | 'Video' | 'CaptionFor';

/** 2026-11-05: read both scene formats without adding fields to persisted customData. */
export function boardCustomValue(customData: unknown, field: BoardCustomField): unknown {
  if (!customData || typeof customData !== 'object' || Array.isArray(customData)) return undefined;
  const custom = customData as Record<string, unknown>;
  const key = 'deckmate' + field;
  return Object.hasOwn(custom, key) ? custom[key] : custom['freetion' + field];
}

export function boardCardIdOf(element: { readonly customData?: unknown }): string | null {
  const value = boardCustomValue(element.customData, 'CardId');
  return typeof value === 'string' ? value : null;
}

export function isBoardProtocolLink(link: string): boolean {
  return link.startsWith('deckmate://') || link.startsWith('freetion://');
}
