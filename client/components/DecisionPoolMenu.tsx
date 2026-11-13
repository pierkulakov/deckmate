import { useMemo } from 'react';
import { CircleDashed } from 'lucide-react';
import type { WorkspaceSnapshot } from '../../src/workspace-contracts.ts';
import { defineText, formatNumber, useLang, useText } from '../i18n.ts';
import { pendingDecisions } from '../question-model.ts';
import { useCatalog } from '../useCatalog.ts';

const text = defineText({ title: 'To apply', count: (count: string) => `Decisions to apply: ${count}` }, { title: 'К внесению', count: (count: string) => `Решений к внесению: ${count}` });

export function DecisionCount({ snapshot, refreshKey, trigger = false }: { snapshot: WorkspaceSnapshot; refreshKey: number; trigger?: boolean }) {
  const { catalog } = useCatalog(snapshot, refreshKey);
  const lang = useLang();
  const t = useText(text);
  const count = useMemo(() => catalog ? pendingDecisions(catalog).length : 0, [catalog]);
  if (trigger) return <span className={count > 0 ? 'mission-control-trigger-count' : 'visually-hidden'} id="mission-control-pending-count">
    {count > 0 && <span aria-hidden="true">{formatNumber(count, 0, lang)}</span>}{catalog && <span className="visually-hidden">{t.count(formatNumber(count, 0, lang))}</span>}
  </span>;
  return count > 0 ? <span className="mission-control-count page-number">{formatNumber(count, 0, lang)}</span> : null;
}

export function DecisionPoolMenu({ snapshot, refreshKey, disabled, current, onPrepare, onOpen }: {
  snapshot: WorkspaceSnapshot | null; refreshKey: number; disabled: boolean; current: boolean;
  onPrepare: () => void; onOpen: () => void;
}) {
  const t = useText(text);
  return <button type="button" className="decision-pool-menu-item" disabled={disabled} aria-current={current ? 'page' : undefined}
    onPointerEnter={onPrepare} onFocus={onPrepare} onClick={onOpen}>
    <CircleDashed size={18} aria-hidden="true" /><span>{t.title}</span>
    {snapshot && <DecisionCount snapshot={snapshot} refreshKey={refreshKey} />}
  </button>;
}
