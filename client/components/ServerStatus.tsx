import * as Tooltip from '@radix-ui/react-tooltip';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { defineText, locale, useLang, useText } from '../i18n.ts';
import { useSaveActivity } from '../save-activity.ts';
import type { ConnectionState } from '../useWorkspace.ts';
import '../server-status.css';

const text = defineText({
  chipLive: 'Live',
  chipSaving: 'Saving…',
  chipSaved: 'Saved',
  chipReconnecting: 'Connecting…',
  chipOffline: 'Offline',
  live: 'Live',
  saving: 'Saving changes…',
  saved: 'Saved',
  reconnecting: 'Reconnecting…',
  offline: 'Server stopped',
  liveDetail: 'Changes in the project folder appear here within a second.',
  savingDetail: 'Writing the edited block into the project file.',
  savedDetail: 'The change is in the project file.',
  reconnectingDetail: 'The server stopped answering for a moment. Deckmate keeps retrying; open cards stay as they are.',
  offlineDetail: 'Changes no longer arrive and edits will not save. Start Deckmate again with npx deckmate.',
  project: 'Project',
  editing: 'Editing',
  lastChange: 'Last change',
  server: 'Server',
  noChangeYet: 'None yet',
  direct: 'In the project folder',
  sandbox: 'Test copy',
  readOnly: 'Read only',
}, {
  chipLive: 'На связи',
  chipSaving: 'Сохраняю…',
  chipSaved: 'Сохранено',
  chipReconnecting: 'Подключаюсь…',
  chipOffline: 'Нет связи',
  live: 'На связи',
  saving: 'Сохраняю изменения…',
  saved: 'Сохранено',
  reconnecting: 'Переподключение…',
  offline: 'Сервер остановлен',
  liveDetail: 'Изменения в папке проекта появляются здесь за секунду.',
  savingDetail: 'Записываю изменённый блок в файл проекта.',
  savedDetail: 'Изменение уже в файле проекта.',
  reconnectingDetail: 'Сервер на миг перестал отвечать. Deckmate переподключается сам, открытые карты остаются как есть.',
  offlineDetail: 'Изменения не приходят, правки не сохранятся. Запустите Deckmate снова: npx deckmate.',
  project: 'Проект',
  editing: 'Правка',
  lastChange: 'Последнее изменение',
  server: 'Сервер',
  noChangeYet: 'Пока нет',
  direct: 'Прямо в папке проекта',
  sandbox: 'Тестовая копия',
  readOnly: 'Только чтение',
});

type ShownState = 'live' | 'saving' | 'saved' | 'reconnecting' | 'offline';
const shownStates: ShownState[] = ['live', 'saving', 'saved', 'reconnecting', 'offline'];
const savedForMs = 1600;

/**
 * Server connection and saving beside the logo (2026-11-05): one chip says Live, Saving…, Saved,
 * Connecting… or Offline. The slot keeps the width of the longest label, so the tabs never move; the pill inside hugs
 * the active label and slides its width, colour and label between states. Details on hover or focus.
 */
export function ServerStatus({ connection, snapshot, updatedAt }: { connection: ConnectionState; snapshot: WorkspaceSnapshot | null; updatedAt: number }) {
  const t = useText(text);
  const lang = useLang();
  const settled = useSettled(connection);
  const { saving, savedAt } = useSaveActivity();
  const recentlySaved = useRecent(savedAt, savedForMs);
  const state: ShownState = settled !== 'live' ? settled : saving ? 'saving' : recentlySaved ? 'saved' : 'live';
  const pinged = usePing(state);
  const labelsRef = useHuggedWidth(state, lang);
  const chip: Record<ShownState, string> = { live: t.chipLive, saving: t.chipSaving, saved: t.chipSaved, reconnecting: t.chipReconnecting, offline: t.chipOffline };
  const title: Record<ShownState, string> = { live: t.live, saving: t.saving, saved: t.saved, reconnecting: t.reconnecting, offline: t.offline };
  const detail: Record<ShownState, string> = { live: t.liveDetail, saving: t.savingDetail, saved: t.savedDetail, reconnecting: t.reconnectingDetail, offline: t.offlineDetail };
  const editing = !snapshot ? '—' : snapshot.editMode === 'direct' ? t.direct : snapshot.editMode === 'sandbox' ? t.sandbox : t.readOnly;
  const lastChange = updatedAt > 0 ? new Intl.DateTimeFormat(locale(lang), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(updatedAt) : t.noChangeYet;
  return <Tooltip.Provider delayDuration={250}><span className="server-status-slot">
    <span className="server-status-sizer" aria-hidden="true"><span className="server-status-dot" /><span className="server-status-stack">
      {shownStates.map(option => <span key={option}>{chip[option]}</span>)}</span></span>
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className={`server-status is-${state}${pinged ? ' is-pinged' : ''}`} tabIndex={0} role="status" aria-label={title[state]}>
          <span className="server-status-dot" aria-hidden="true" />
          <span ref={labelsRef} className="server-status-labels" aria-hidden="true">
            {shownStates.map(option => <span key={option} className={option === state ? 'is-active' : undefined}>{chip[option]}</span>)}
          </span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className={`server-status-card is-${state}`} side="bottom" align="start" sideOffset={8}>
          <p className="server-status-title"><span className="server-status-dot" aria-hidden="true" />{title[state]}</p>
          <p className="server-status-detail">{detail[state]}</p>
          <dl className="server-status-facts">
            <dt>{t.project}</dt><dd title={snapshot?.projectName || undefined}>{snapshot?.projectName || '—'}</dd>
            <dt>{t.editing}</dt><dd>{editing}</dd>
            <dt>{t.lastChange}</dt><dd className="is-number">{lastChange}</dd>
            <dt>{t.server}</dt><dd className="is-number">{location.host}</dd>
          </dl>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  </span></Tooltip.Provider>;
}

/** Sets --label-width to the active label's own width before paint and again once fonts load, so the pill hugs it. */
function useHuggedWidth(state: string, lang: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const measure = useCallback(() => {
    const labels = ref.current;
    const active = labels?.querySelector<HTMLElement>('.is-active');
    if (labels && active) labels.style.setProperty('--label-width', `${active.offsetWidth}px`);
  }, []);
  useLayoutEffect(measure, [measure, state, lang]);
  useEffect(() => { void document.fonts?.ready.then(measure); }, [measure]);
  return ref;
}

/** Live shows at once; another connection state only after 700 ms, so the first connect and a short drop do not flash. */
function useSettled(state: ConnectionState): ConnectionState {
  const [shown, setShown] = useState<ConnectionState>('live');
  useEffect(() => {
    if (state === 'live') { setShown('live'); return; }
    const timer = setTimeout(() => setShown(state), 700);
    return () => clearTimeout(timer);
  }, [state]);
  return shown;
}

/** True while the moment is younger than the duration. Read during render, so Saving… turns into Saved in the same frame. */
function useRecent(moment: number, durationMs: number): boolean {
  const [, expire] = useState(0);
  const left = moment + durationMs - Date.now();
  useEffect(() => {
    if (moment === 0 || left <= 0) return;
    const timer = setTimeout(() => expire(value => value + 1), left);
    return () => clearTimeout(timer);
  }, [moment, left > 0]);
  return moment > 0 && left > 0;
}

/** One soft ring when a save lands or the connection comes back. */
function usePing(state: ShownState): boolean {
  const previous = useRef(state);
  const [pinged, setPinged] = useState(false);
  useEffect(() => {
    const landed = state === 'saved' || (state === 'live' && (previous.current === 'reconnecting' || previous.current === 'offline'));
    previous.current = state;
    if (!landed) return;
    setPinged(true);
    const timer = setTimeout(() => setPinged(false), 900);
    return () => clearTimeout(timer);
  }, [state]);
  return pinged;
}
