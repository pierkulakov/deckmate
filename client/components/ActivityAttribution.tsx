import { useEffect, useSyncExternalStore } from 'react';
import type { DeckActivityEvent } from '../../src/activity-contracts.ts';
import type { DataSource } from '../../src/workspace-contracts.ts';
import { catalogStore } from '../catalog-store.ts';
import { defineText, useText } from '../i18n.ts';

const text = defineText({
  unknown: 'Author unknown', human: 'Person', agent: 'Agent', unknownKind: 'Member type unknown',
  reason: (reason: string) => `Requested changes: ${reason}`,
}, {
  unknown: 'Автор неизвестен', human: 'Человек', agent: 'Агент', unknownKind: 'Вид участника неизвестен',
  reason: (reason: string) => `Причина возврата: ${reason}`,
});

export function ActivityAttribution({ event, source, cardId }: { event: DeckActivityEvent; source: DataSource; cardId?: string }) {
  const t = useText(text);
  const store = catalogStore(source);
  const { catalog } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { void store.load(); }, [store]);
  const member = catalog?.members?.find(candidate => candidate.id === event.actorMemberId);
  let author = t.unknown;
  if (member) author = `${member.label} · ${t[member.kind]}`;
  else if (event.actorMemberId) author = `${event.actorMemberId} · ${t.unknownKind}`;
  const reasons = [...new Set((event.transitions ?? [])
    .filter(transition => transition.from === 'review' && transition.to !== 'review' && transition.to !== 'done'
      && (!cardId || transition.cardId === cardId))
    .map(transition => transition.reason?.trim()).filter((reason): reason is string => Boolean(reason)))];
  return <div className="activity-attribution" style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
    <span>{author}</span>
    {reasons.map(reason => <p key={reason}>{t.reason(reason)}</p>)}
  </div>;
}
