import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../client/components/ui/button.tsx';
import { moveFocus } from '../../client/focus.ts';
import '../../client/styles.css';
import '../../client/surface.css';

// 2026-11-10: one of every hairline control (DESIGN.md «Controls») and the focus moves the app makes by script, rendered
// for real and driven with CDP input by controls.test.ts: shape, states, hover without a blink, and the focus ring only
// for the keyboard.
const root = createRoot(document.getElementById('root')!);

function Gallery() {
  const [pressed, setPressed] = useState(true);
  const [tab, setTab] = useState('due');
  const [segment, setSegment] = useState('cards');
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
      <input id="search-input" aria-label="Search" style={{ flex: 1, border: 0, background: 'transparent', color: 'inherit', outline: 'none' }} />
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
