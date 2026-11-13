import { useRef, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { defineText, useText } from '../i18n.ts';
import { Button } from './ui/button.tsx';
import './watcher-warning.css';

const text = defineText({
  stopped: 'Automatic file watching has stopped. Refresh data manually or restart Deckmate to restore automatic updates.',
  refresh: 'Refresh data',
}, {
  stopped: 'Автоматическое наблюдение за файлами остановилось. Обновляйте данные вручную или перезапустите Deckmate, чтобы восстановить автоматические обновления.',
  refresh: 'Обновить данные',
});

export function WatcherWarning({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const t = useText(text);
  const inFlight = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    try { await onRefresh(); }
    finally { inFlight.current = false; setRefreshing(false); }
  }
  return <div className="watcher-warning" role="status">
    <TriangleAlert size={18} aria-hidden="true" />
    <span>{t.stopped}</span>
    <Button type="button" variant="outline" size="sm" aria-disabled={refreshing} onClick={() => void refresh()}>{t.refresh}</Button>
  </div>;
}
