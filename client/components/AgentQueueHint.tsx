import { defineText, useText } from '../i18n.ts';

const text = defineText({
  owner: 'Assigning does not start an agent. Add the card to its Hand to put it in the queue; work begins when the agent is launched separately.',
  hand: 'The card goes into the agent’s queue. Work begins when the agent is launched separately.',
}, {
  owner: 'Назначение не запускает агента. Добавьте карточку в его Hand — она появится в очереди. Агент начнёт работу, когда его запустят отдельно.',
  hand: 'Карточка попадёт в очередь агента. Он начнёт работу, когда его запустят отдельно.',
});

export function AgentQueueHint({ assignment = 'owner' }: { assignment?: 'owner' | 'hand' }) {
  const t = useText(text);
  return <p style={{ margin: 0, padding: 'var(--space-2)', color: 'var(--muted)', fontSize: '13px', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{t[assignment]}</p>;
}
