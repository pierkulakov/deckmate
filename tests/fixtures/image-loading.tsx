import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DeckCoverTile } from '../../client/components/Deck.tsx';
import { Markdown } from '../../client/components/Markdown.tsx';
import { AttachmentsPanel } from '../../client/components/AttachmentsPanel.tsx';
import { VirtualCardGrid } from '../../client/components/VirtualCardGrid.tsx';
import { DecodedImage } from '../../client/components/DecodedImage.tsx';
import { TagTitlePrefix } from '../../client/components/CardTags.tsx';
import { CardOwnerAvatar } from '../../client/components/CardOwnerAvatar.tsx';
import { markdownParser } from '../../src/markdown-model.ts';
import type { CatalogCard, CatalogView } from '../../src/catalog-contracts.ts';
import { setLang } from '../../client/i18n.ts';
import '../../client/styles.css';
import '../../client/motion.css';

const root = createRoot(document.getElementById('root')!);
setLang('en');
const card: CatalogCard = { id: 'card:image', kind: 'task', title: 'Image', path: 'cards/image.md', version: null,
  state: 'not-started', owner: 'Maya', markdown: '', sourceHash: '', range: null, deckId: null, trackIds: [], parentId: null };
const catalog: CatalogView = { rootIdentity: 'images', documents: [], cards: [card], spaces: [], decks: [], tracks: [],
  warnings: [], formatLanguage: 'en', manifestHash: '', configured: true, indexedAt: '', members: [] };
const cards = Array.from({ length: 300 }, (_, index) => ({ ...card, id: `card:${index}` }));
const files = ['wide', 'portrait', 'missing'].map(name => ({ file: `tasks/${name}.webp`, name, kind: 'image', mime: 'image/webp', bytes: 100, addedAt: '', addedBy: null }));
const fetchOriginal = window.fetch.bind(window);
window.fetch = (input, init) => String(input).startsWith('/api/attachments')
  ? Promise.resolve(Response.json({ hash: '', files, warnings: [] })) : fetchOriginal(input, init);

const decode = HTMLImageElement.prototype.decode;
const waiting: { src: string; resolve: () => void }[] = [];
let holdDecode = false;
// 2026-11-13: separate completed transport from completed decoding to catch progressive or undecoded reveals.
HTMLImageElement.prototype.decode = async function () {
  await decode.call(this);
  if (holdDecode) await new Promise<void>(resolve => waiting.push({ src: this.src, resolve }));
};

let revision = 0;
const api = {
  holdDecode() { holdDecode = true; },
  releaseDecode(source?: string) {
    if (!source) holdDecode = false;
    for (const entry of [...waiting]) if (!source || entry.src.includes(source)) {
      waiting.splice(waiting.indexOf(entry), 1);
      entry.resolve();
    }
  },
  waitingFor(source: string) { return waiting.some(entry => entry.src.includes(source)); },
  render(mode: string, theme = 'light') {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const key = ++revision;
    let content = null;
    if (mode === 'gallery') content = <div className="deck-gallery"><div className="catalog-deck-grid">{Array.from({ length: 5 }, (_, index) => <DeckCoverTile key={index}
      deck={{ id: String(index), title: `Deck ${index}`, kind: 'task', spaceId: 'space', description: '', color: '#607d98', icon: 'box', style: 'artwork', cover: `tasks/cover-${index}.webp` }}
      counts={{ open: 3, accepted: 1, tasks: 4, review: 0 }} source="sandbox" disabled={false} writable={false} inbox={false}
      canOpen={() => true} onOpen={() => {}} onSettings={() => {}} />)}</div></div>;
    if (mode === 'attachments') content = <div style={{ width: 'min(100%, 600px)', padding: 16 }}>
      <Markdown tree={markdownParser.parse('![Wide](../tasks/wide.webp)\n\nAfter wide.\n\n![Portrait](../tasks/portrait.webp)\n\n![Missing](../tasks/missing.webp)\n\nAfter missing.')} source="sandbox" path={card.path} />
      <AttachmentsPanel card={card} catalog={catalog} writable={false} onEdit={async () => true} />
    </div>;
    if (mode === 'virtual') content = <main className="workspace-main" style={{ height: 500, overflow: 'auto' }}><VirtualCardGrid cards={cards} enabled pinnedIds={[]}>
      {card => <div className="deck-card" data-card-id={card.id}>
        <span className="deck-thumb"><DecodedImage src="/api/file?path=tasks%2Fvirtual.webp" alt="" /></span>
        <TagTitlePrefix tags={['art']} definitions={[{ name: 'art', color: '#607d98', iconSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0H16V16H0Z"/></svg>' }]} />
        <CardOwnerAvatar owner="Maya" members={[]} />
      </div>}
    </VirtualCardGrid></main>;
    if (mode.startsWith('source:')) content = <span className="markdown-image"><DecodedImage src={'/api/file?path=tasks%2F' + mode.slice(7) + '.webp'} alt="Changing image" /></span>;
    flushSync(() => root.render(<div key={mode.startsWith('source:') ? 'source' : key}>{content}</div>));
  },
};
Object.assign(window, { imageTest: api });
