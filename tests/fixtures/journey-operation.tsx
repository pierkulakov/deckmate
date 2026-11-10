import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CatalogView } from '../../src/catalog-contracts.ts';
import type { CatalogAction } from '../../client/useCatalog.ts';
import { ApplyJourneyPanel } from '../../client/components/JourneyPanel.tsx';
import { JourneyEditor } from '../../client/components/JourneyEditor.tsx';
import { JourneyCatalog } from '../../client/components/JourneyCatalog.tsx';
import { setLang, type Lang } from '../../client/i18n.ts';
import '../../client/styles.css';

const root = createRoot(document.getElementById('root')!);
const fixture = {
  actions: [] as CatalogAction[], reads: 0, fresh: null as CatalogView | null, failure: null as unknown,
  render(catalog: CatalogView, mode = 'apply', lang: Lang = 'ru') {
    fixture.actions = []; fixture.reads = 0; fixture.fresh = catalog; fixture.failure = null;
    setLang(lang);
    root.render(<View key={++revision} initial={catalog} mode={mode} />);
  },
};
let revision = 0;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (String(input).startsWith('/api/catalog?')) {
    fixture.reads++;
    return new Response(JSON.stringify(fixture.fresh), { headers: { 'Content-Type': 'application/json' } });
  }
  if (String(input).startsWith('/api/journey-metrics')) return new Response(JSON.stringify({ steps: [] }));
  return originalFetch(input, init);
};
function View({ initial, mode }: { initial: CatalogView; mode: string }) {
  const [catalog, setCatalog] = useState(initial);
  async function edit(action: CatalogAction) {
    fixture.actions.push(action);
    setCatalog(fixture.fresh!);
    if (fixture.failure) throw fixture.failure;
    return true;
  }
  const deck = catalog.decks[0];
  if (mode === 'editor') return <JourneyEditor catalog={catalog} deck={deck} source="sandbox" writable pending={false} onEdit={edit} onClose={() => {}} />;
  if (mode === 'catalog') return <JourneyCatalog catalog={catalog} deck={deck} journey={catalog.journeys![0]} disabled={false} onEdit={edit} onImport={async () => true} onBack={() => {}} />;
  return <ApplyJourneyPanel catalog={catalog} card={catalog.cards[0]} source="sandbox" pending={false} writable onEdit={edit} onClose={() => {}} />;
}
Object.assign(window, { journeyOperationTest: fixture });
