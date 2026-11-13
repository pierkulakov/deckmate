import { useCallback, useRef, useState } from 'react';
import { FolderOpen, LoaderCircle } from 'lucide-react';
import type { DesktopBoardBridge, DesktopFailure } from './desktop-bridge.ts';
import { defineText, useText } from './i18n.ts';
export { compactPath } from './project-path.ts';
export { ProjectTile } from './ProjectTile.tsx';

const text = defineText({
  openAnotherFolder: 'Open start screen',
  switchFailed: 'Could not switch the project.',
  startFailed: 'Could not open the start screen. Try again.',
}, {
  openAnotherFolder: 'Открыть стартовый экран',
  switchFailed: 'Не удалось переключить проект.',
  startFailed: 'Не удалось открыть стартовый экран. Попробуйте ещё раз.',
});

/** 2026-11-13: retain diagnostics separately from translated errors; successful navigation replaces the document. */
export async function attemptSwitch(board: DesktopBoardBridge, path: string): Promise<DesktopFailure | null> {
  try {
    const result = await board.switchProject(path);
    return result.ok ? null : result;
  } catch (error) {
    return { ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined };
  }
}

/** 2026-11-13: a successful navigation keeps its spinner until the shell replaces the page. */
export function useProjectNavigation(board: DesktopBoardBridge | undefined) {
  const [switching, setSwitching] = useState<string | null>(null);
  const [openingStart, setOpeningStart] = useState(false);
  const [failure, setFailure] = useState<{ kind: 'switch' | 'start'; result: DesktopFailure; path?: string } | null>(null);
  const locked = useRef(false);
  const clearFailure = useCallback(() => setFailure(null), []);
  const switchTo = async (path: string) => {
    if (!board || locked.current) return null;
    locked.current = true;
    setSwitching(path);
    setFailure(null);
    const result = await attemptSwitch(board, path);
    if (result) {
      locked.current = false;
      setSwitching(null);
      if (!['cancelled', 'superseded', 'closed'].includes(result.code)) setFailure({ kind: 'switch', result, path });
    }
    return result;
  };
  const openStart = async () => {
    if (!board || locked.current) return;
    locked.current = true;
    setOpeningStart(true);
    setFailure(null);
    let failure: DesktopFailure;
    try {
      const result = await board.showStartScreen();
      if (result.ok) return;
      failure = result;
    } catch (error) { failure = { ok: false, code: 'unknown', message: error instanceof Error ? error.message : undefined }; }
    locked.current = false;
    setOpeningStart(false);
    if (!['cancelled', 'superseded', 'closed'].includes(failure.code)) setFailure({ kind: 'start', result: failure });
  };
  const key = failure?.kind === 'start' ? 'startFailed' : 'switchFailed';
  const retry = () => { if (failure?.path) void switchTo(failure.path); else void openStart(); };
  return { switching, openingStart, busy: switching !== null || openingStart, failure: failure?.result ?? null,
    fallback: { en: text.en[key], ru: text.ru[key] }, retry, clearFailure, switchTo, openStart };
}

export function OpenStartScreen({ disabled, busy, onOpen }: { disabled: boolean; busy: boolean; onOpen: () => void }) {
  const t = useText(text);
  return <button type="button" className="mission-control-recent-open" disabled={disabled} aria-busy={busy} onClick={onOpen}>
    {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <FolderOpen size={14} aria-hidden="true" />}{t.openAnotherFolder}
  </button>;
}
