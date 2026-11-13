// 2026-11-10: reuse the real Deck/API fixture so editor cancellation and preview closing keep their actual owners.
import './hero-return.tsx';
import { createRoot } from 'react-dom/client';
import { LevelBadge } from '../../client/components/LevelBadge.tsx';
import { GlobalSearch } from '../../client/components/GlobalSearch.tsx';

// 2026-11-13: the real header layer must compete with Deck's capture listener, including during lazy help loading.
const header = document.createElement('div');
header.style.cssText = 'position:fixed;right:8px;top:8px;z-index:100;display:flex';
const search = document.createElement('div');
search.className = 'global-topbar';
search.style.cssText = 'display:flex;position:relative;width:auto;height:auto;padding:0;border:0';
header.append(search);
const slot = document.createElement('div');
slot.id = 'topbar-shortcuts';
header.append(slot);
const badge = document.createElement('div');
header.append(badge);
document.body.append(header);
const fetchFixture = window.fetch;
window.fetch = (input, init) => String(input).startsWith('/api/onboarding-facts')
  ? Promise.resolve(Response.json({ agentSkill: false })) : fetchFixture(input, init);
createRoot(badge).render(<LevelBadge snapshot={{ projectName: 'Hero return', source: 'sandbox', writable: true,
  editMode: 'direct', iteration: { number: 1, goal: '', start: '' } }} refreshKey={0} onNavigate={() => {}} />);
createRoot(search).render(<GlobalSearch snapshot={{ projectName: 'Hero return', source: 'sandbox', writable: true,
  editMode: 'direct', iteration: { number: 1, goal: '', start: '' } }} refreshKey={0} onOpenCard={() => {}} onOpenDeck={() => {}} />);
