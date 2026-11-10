import { lazy, startTransition, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { preparedNavigation, preparedResource } from '../../client/prepared-resource.ts';
import { browserWarmupEnvironment, WarmupQueue } from '../../client/first-screen-warmup.ts';
import '../../client/motion.css';
import { warmMount } from '../../client/warmup-mount.tsx';

let release!: () => void;
const pending = new Promise<void>(resolve => { release = resolve; });
const resource = preparedResource(async () => { await pending; return import('./first-use-screen.tsx'); });
const Screen = lazy(resource.load);
const gate = preparedNavigation();
const queue = new WarmupQueue(browserWarmupEnvironment());
const commits: string[] = [];
const root = createRoot(document.getElementById('root')!);
let warmController: AbortController;
let mounting = Promise.resolve();

function Fixture() {
  useEffect(() => () => warmController?.abort(), []);
  const [open, setOpen] = useState(false);
  const [clicks, setClicks] = useState(0);
  return <>
    <button id="open" onClick={() => gate.run(resource, () => {
      commits.push(getComputedStyle(document.documentElement).getPropertyValue('--first-use-installed').trim());
      startTransition(() => setOpen(true));
    })}>Open</button>
    <Suspense fallback={<div id="fallback">Loading</div>}>
      {open ? <Screen /> : <button id="old-screen" onClick={() => setClicks(value => value + 1)}>Old screen {clicks}</button>}
    </Suspense>
  </>;
}

Object.assign(window, { firstUse: {
  release, commits, cancel: gate.cancel, ready: resource.ready,
  warm: () => queue.add({ key: 'screen', priority: 0, run: resource.load }),
  mount: () => {
    warmController = new AbortController();
    mounting = warmMount(<input autoFocus aria-label="Warm control" />, warmController.signal);
  },
  mounted: () => mounting,
  abortMount: () => warmController.abort(),
  unmount: () => root.unmount(),
} });
root.render(<Fixture />);
