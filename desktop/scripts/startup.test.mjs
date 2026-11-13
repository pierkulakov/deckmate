import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { tileColor, tileInitials } from '../../client/project-tile.ts';

const script = readFileSync(new URL('../src-tauri/src/board-startup.js', import.meta.url), 'utf8');
const splash = readFileSync(new URL('../../client/desktop/startup.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/u, '');

test('splash reads inert shell data and preserves project text without parsing markup or URL parameters', async () => {
  for (const language of ['en', 'ru']) {
    const project = 'Проект "<>&\'';
    const nodes = new Map(['project-name', 'opening-label', 'return-to-start', 'project-tile'].map(id => [id, {
      textContent: '', title: '', hidden: true, dataset: {}, style: { setProperty() {} },
    }]));
    const documentElement = { lang: '', dataset: { shellLang: language, shellProject: project, shellOpening: 'Opening', shellReturn: 'Return' } };
    const timers = [];
    let prepared;
    runInNewContext(splash, {
      tileColor, tileInitials,
      document: { documentElement, getElementById: id => nodes.get(id) },
      location: { search: '?project=wrong&language=invalid&opening=wrong&return=wrong' },
      window: { prepareDeckmatePage: () => new Promise(resolve => { prepared = resolve; }) },
      setTimeout: (callback, delay) => timers.push({ callback, delay }),
    });
    assert.equal(documentElement.lang, language);
    assert.equal(nodes.get('project-name').textContent, project);
    assert.equal(nodes.get('project-name').title, project);
    assert.equal(nodes.get('project-tile').dataset.initials, tileInitials(project));
    assert.equal(nodes.get('opening-label').textContent, 'Opening');
    assert.equal(nodes.get('return-to-start').textContent, 'Return');
    assert.equal(timers.length, 0);
    prepared();
    await Promise.resolve();
    assert.equal(timers[0].delay, 4000);
    timers[0].callback();
    assert.equal(nodes.get('return-to-start').hidden, false);
  }
});

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
    querySelector: selector => selector === '.first-screen' ? { dataset: { state: loading ? 'loading' : 'ready' } } : shell,
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
