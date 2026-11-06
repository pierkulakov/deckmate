import { useLang } from '../i18n.ts';
import { stateLabel } from '../locales/common.ts';

export const statusClass = (status: string) => ({ discussing: 'discuss', 'in-iteration': 'iteration', started: 'working',
  review: 'review', done: 'accepted', 'not-started': 'planned', 'wont-do': 'cancelled' } as Record<string, string>)[status] ?? 'planned';

export function StatusBadge({ state }: { state: string }) {
  const lang = useLang();
  return <span className={`status-badge status-${statusClass(state)}`}><span className="status-dot" />{stateLabel(state, lang)}</span>;
}
