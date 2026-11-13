import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const script = readFileSync(new URL('../src-tauri/src/board-startup.js', import.meta.url), 'utf8');

function renderer() {
  const frames = [];
  const events = new Map();
  const messages = [];
  const marks = [];
  const timers = new Map();
  let timerId = 0;
  let changed;
  let disconnected = false;
  let loading = true;
  const main = { firstElementChild: {}, querySelector: () => loading ? {} : null };
  const shell = { dataset: { updatedAt: '0' }, querySelector: () => main };
  const document = {
    visibilityState: 'hidden',
    querySelector: () => shell,
    addEventListener: (name, callback) => events.set(name, callback),
    removeEventListener: name => events.delete(name),
  };
  runInNewContext(script, {
    document,
    MutationObserver: class {
      constructor(callback) { changed = callback; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: callback => frames.push(callback),
    performance: { mark: name => marks.push(name) },
    console: { info: message => messages.push(message) },
  });
  return {
    document, shell, frames, marks, messages, events, timers,
    change: () => changed(),
    loaded: () => { loading = false; },
    disconnected: () => disconnected,
  };
}

test('paint waits for a visible data snapshot and loaded catalog, then two frames', () => {
  const page = renderer();
  page.document.visibilityState = 'visible';
  page.events.get('visibilitychange')();
  assert.equal(page.frames.length, 0);
  page.shell.dataset.updatedAt = '100';
  page.change();
  assert.equal(page.frames.length, 0);
  page.loaded();
  page.change();
  assert.equal(page.disconnected(), true);
  assert.equal(page.events.has('visibilitychange'), false);
  assert.equal(page.timers.size, 0);
  assert.deepEqual(page.marks, []);
  page.frames.shift()();
  assert.deepEqual(page.marks, []);
  page.frames.shift()();
  assert.deepEqual(page.marks, ['deckmate-board-data-painted']);
  assert.deepEqual(page.messages, ['deckmate:board-data-painted']);
  page.change();
  assert.equal(page.frames.length, 0);
});

test('a hidden loaded board is not counted until it becomes visible', () => {
  const page = renderer();
  page.shell.dataset.updatedAt = '100';
  page.loaded();
  page.change();
  assert.equal(page.frames.length, 0);
  page.document.visibilityState = 'visible';
  page.events.get('visibilitychange')();
  assert.equal(page.frames.length, 1);
});

test('an unfinished board stops observing on timeout without reporting a paint', () => {
  const page = renderer();
  assert.equal(page.timers.size, 1);
  for (const callback of page.timers.values()) callback();
  assert.equal(page.timers.size, 0);
  assert.equal(page.disconnected(), true);
  assert.equal(page.events.has('visibilitychange'), false);
  page.document.visibilityState = 'visible';
  page.shell.dataset.updatedAt = '100';
  page.loaded();
  page.change();
  assert.equal(page.frames.length, 0);
  assert.deepEqual(page.marks, []);
  assert.deepEqual(page.messages, []);
});
