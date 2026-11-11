import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../client/components/ui/button.tsx';
import { EmptyState } from '../../client/components/EmptyState.tsx';
import { Plus } from 'lucide-react';
import { moveFocus } from '../../client/focus.ts';
import '../../client/styles.css';
import '../../client/surface.css';
import '../../client/components/states.css';
import '../../client/workspace.css';
import '../../client/vision.css';
import '../../client/shortcuts-help.css';

// 2026-11-10: one of every hairline control (DESIGN.md «Controls») and the focus moves the app makes by script, rendered
// for real and driven with CDP input by controls.test.ts: shape, states, hover without a blink, and the focus ring only
// for the keyboard.
const root = createRoot(document.getElementById('root')!);

function Gallery() {
  const [pressed, setPressed] = useState(true);
  const [tab, setTab] = useState('due');
  const [segment, setSegment] = useState('cards');
  const [touchActions, setTouchActions] = useState<string[]>([]);
  const opener = useRef<HTMLButtonElement>(null);
  const target = useRef<HTMLButtonElement>(null);
  return <main style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12, padding: 24 }}>
    <button type="button" id="first">First</button>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" id="outline" className="control">Archive</button>
      <button type="button" id="pressed" className="control" aria-pressed={pressed} onClick={() => setPressed(on => !on)}>My cards</button>
      <button type="button" id="ghost" className="control control-ghost" aria-label="Close">×</button>
      <button type="button" id="danger" className="control destructive">Delete</button>
      <button type="button" id="mint" className="action-mint"><span>Journey</span></button>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <Button id="button-outline" variant="outline" aria-pressed={false}>5 Sub Cards</Button>
      <Button id="button-ghost" variant="ghost">Cancel</Button>
      <Button id="button-default">Save</Button>
      <Button id="button-disabled" variant="outline" disabled>Later</Button>
    </div>
    <label id="search" className="control-field" style={{ display: 'flex', alignItems: 'center', width: 260, padding: '0 8px' }}>
      <input id="search-input" aria-label="Search" placeholder="Search" style={{ flex: 1, border: 0, background: 'transparent', color: 'inherit', outline: 'none' }} />
    </label>
    <select id="select" className="control-field" aria-label="Owner"><option>Maya</option><option>Glm</option></select>
    <div id="segmented" className="control-segmented" role="radiogroup" aria-label="View">
      {['cards', 'table'].map(value => <button key={value} type="button" role="radio" aria-checked={segment === value} onClick={() => setSegment(value)}>{value}</button>)}
    </div>
    <div className="control-tabs" role="tablist" aria-label="Sections">
      {['due', 'runs'].map(value => <button key={value} id={'tab-' + value} type="button" role="tab" className="control-tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} onClick={() => setTab(value)}>{value}</button>)}
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button type="button" id="opener" ref={opener} className="control">Open panel</button>
      <button type="button" id="target" ref={target} className="control">Panel</button>
      {/* Closing a panel returns focus to its opener, as the app does after × or Escape. */}
      <button type="button" id="close" className="control control-ghost" aria-label="Close panel" onClick={() => moveFocus(opener.current)}>×</button>
    </div>
    {/* A click on an area that keeps focus where it was (a card face, a canvas) and then moves it by script. */}
    <div id="surface" style={{ width: 200, height: 40, background: 'var(--ground)' }} onClick={() => moveFocus(target.current)}>surface</div>
    <div id="hover-segmented" className="control-segmented" role="radiogroup" aria-label="Hover test">
      <button id="segment-a" type="button" role="radio" aria-checked="false">One</button>
      <button id="segment-b" type="button" role="radio" aria-checked="false">Two</button>
    </div>
    <div role="menu" style={{ display: 'flex', gap: 8 }}>
      <div id="menu-a" role="menuitem" className="control">One</div>
      <div id="menu-b" role="menuitem" className="control">Two</div>
    </div>
    <div className="ui-error"><Button id="busy-retry" variant="outline">Retry</Button></div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button id="button-small" size="sm">Small action</Button>
      <Button id="button-icon" size="icon" aria-label="Add"><Plus size={16} /></Button>
      <Button id="button-danger" className="destructive">Delete</Button>
      <span id="quiet-count" className="page-number">128</span>
    </div>
    <EmptyState variant="quiet" message="No entries in this nested list." />
    <EmptyState variant="filtered" art="no-results" title="No matching cards" onReset={() => {}} />
    <div id="touch-tools" data-actions={touchActions.join(',')} style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', maxWidth: '100%' }}>
      {['one', 'two', 'three'].map(id => <button key={id} id={'touch-' + id} type="button" className="control" aria-label={id} onClick={() => setTouchActions(actions => [...actions, id])}><Plus size={16} /></button>)}
      {['four', 'five', 'six'].map(id => <Button key={id} id={'touch-' + id} size="icon" aria-label={id} onClick={() => setTouchActions(actions => [...actions, id])}><Plus size={16} /></Button>)}
    </div>
    <button id="long-control" type="button" className="control">СброситьОченьДлинныйПоисковыйЗапросИВсеВыбранныеФильтрыБезПотериДанных</button>
    <div className="vision-links">
      <div className="vision-tools">
        <label className="vision-search control-field"><input id="vision-search-input" placeholder="Find a card" /></label>
        <div className="vision-tool-row"><input id="vision-url" className="control-field" placeholder="https://youtube.com/watch?v=…" /></div>
        <select id="vision-select" className="control-field" aria-label="Widget deck"><option>Production</option></select>
      </div>
    </div>
    <input id="ordinary-input" className="control-field" placeholder="Name" />
    <textarea id="ordinary-textarea" className="control-field" placeholder="Description" />
    <label className="control-field"><textarea id="nested-textarea" placeholder="Notes" /></label>
    <div className="space-preset-form"><p id="space-help" className="catalog-form-help">Help for creating a space.</p></div>
    <footer id="license-help" className="shortcuts-panel-foot">License and source</footer>
  </main>;
}

function render(options: { theme?: 'light' | 'dark' } = {}) {
  document.documentElement.classList.toggle('dark', options.theme !== 'light');
  document.body.style.background = 'var(--canvas)';
  document.body.style.color = 'var(--ink)';
  root.render(<Gallery key={Math.random()} />);
}

// Escape returns focus to the opener from a window capture listener, the earliest place an app can handle a key; the
// ring must still follow this keyboard input, not the click before it.
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') moveFocus(document.querySelector<HTMLElement>('#opener'));
}, true);

declare global { interface Window { controlsTest: { render: typeof render } } }
window.controlsTest = { render };
