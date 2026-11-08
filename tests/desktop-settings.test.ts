import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  mkdir, mkdtemp, readFile as readFileAsync, readdir, rm, unlink, writeFile as writeFileAsync,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const mainSource = readFileSync(new URL('../desktop/main.js', import.meta.url), 'utf8');

function mainDeclarations<T>(names: string[], context: Record<string, unknown> = {}) {
  const declarations = names.map(name => {
    const declaration = mainSource.match(new RegExp(`^(?:(?:async )?function ${name}\\([^]*?^\\}|const ${name} = [^\\n]+;)`, 'm'))?.[0];
    if (!declaration) throw new Error(`Missing main-process declaration: ${name}`);
    return declaration;
  });
  const sandbox: Record<string, unknown> = { URL, path, ...context };
  const api = runInNewContext(`${declarations.join('\n')}\n({ ${names.join(', ')} })`, sandbox) as T;
  return { api, sandbox };
}

type StoredSettings = {
  lastProject: string | null;
  recent: Array<{ path: string; name: string; lastOpened: string | null }>;
  language: string | null;
};

describe('desktop settings validation', () => {
  it('normalizes recent entries, removes duplicates and limits the loaded list', async () => {
    const maxRecent = 10;
    const firstPath = path.resolve('Recent First');
    const secondPath = path.resolve('Recent Second');
    const duplicatePath = process.platform === 'win32' ? firstPath.toUpperCase() : firstPath;
    const validDate = '2026-11-08T12:00:00.000Z';
    const extraPaths = Array.from({ length: maxRecent + 2 }, (_, index) => path.resolve(`Extra ${index}`));
    const payload = {
      lastProject: 'relative/project',
      recent: [
        { path: firstPath, lastOpened: 'yesterday' },
        { path: duplicatePath, name: 'Stale duplicate', lastOpened: validDate },
        { path: 'relative/project', name: 'Relative', lastOpened: validDate },
        { path: 42, name: 'Not a path', lastOpened: validDate },
        null,
        { path: secondPath, name: 5, lastOpened: validDate },
        ...extraPaths.map((folder, index) => ({ path: folder, name: `Extra ${index}`, lastOpened: validDate })),
      ],
      language: 'en',
    };
    const { api, sandbox } = mainDeclarations<{ loadSettings: () => Promise<void> }>([
      'defaultSettings', 'settingsFile', 'validBounds', 'samePath', 'normalizeRecent',
      'clampZoom', 'localeLanguage', 'loadSettings',
    ], {
      settings: null,
      readFile: async () => JSON.stringify(payload),
      app: { getPath: () => os.tmpdir(), getLocale: () => 'en-US' },
      MAX_RECENT: maxRecent,
      LANGUAGES: new Set(['en', 'ru']),
      ZOOM_MIN: 0.5,
      ZOOM_MAX: 2,
      ZOOM_STEP: 0.1,
    });

    await api.loadSettings();

    const loaded = sandbox.settings as StoredSettings;
    expect(loaded.lastProject).toBeNull();
    expect(loaded.recent).toHaveLength(maxRecent);
    expect(loaded.recent[0]).toEqual({ path: firstPath, name: path.basename(firstPath), lastOpened: null });
    expect(loaded.recent[1]).toEqual({ path: secondPath, name: path.basename(secondPath), lastOpened: validDate });
    expect(loaded.recent.slice(2).map(entry => entry.path)).toEqual(extraPaths.slice(0, maxRecent - 2));
    expect(loaded.recent[2].name).toBe('Extra 0');
    expect(loaded.recent.some(entry => entry.name === 'Stale duplicate')).toBe(false);
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

describe('desktop settings atomic writes', () => {
  it('keeps valid JSON and the latest version across 220 interleaved async and sync saves', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'deckmate-settings-'));
    const file = path.join(directory, 'desktop.json');
    const log = vi.fn(async () => {});
    let delay: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
    try {
      const { api, sandbox } = mainDeclarations<{
        saveSettings: () => Promise<void>;
        saveSettingsSync: () => void;
      }>(['settingsFile', 'settingsText', 'settingsTempFile', 'saveSettings', 'saveSettingsSync'], {
        settings: { version: 0, padding: 'seed' },
        saveQueue: Promise.resolve(),
        settingsGeneration: 0,
        settingsTempCounter: 0,
        process,
        app: { getPath: () => directory },
        mkdir,
        writeFile: async (target: string, text: string) => {
          const pending = delay;
          delay = null;
          if (pending) {
            pending.started.resolve();
            await pending.release.promise;
          }
          await writeFileAsync(target, text);
        },
        unlink,
        mkdirSync,
        writeFileSync,
        renameSync,
        unlinkSync,
        log,
      });
      const readVersion = async () => {
        const parsed = JSON.parse(await readFileAsync(file, 'utf8')) as { version: number };
        return parsed.version;
      };
      const delayedSave = () => {
        const started = deferred();
        const release = deferred();
        delay = { started, release };
        const pending = api.saveSettings();
        return { started, release, pending };
      };

      api.saveSettingsSync();
      expect(await readVersion()).toBe(0);
      for (let index = 0; index < 220; index += 1) {
        const first = index * 2 + 1;
        const latest = first + 1;
        if (index % 2 === 0) {
          sandbox.settings = { version: first, padding: 'a'.repeat(1000 + index) };
          api.saveSettingsSync();
          expect(await readVersion()).toBe(first);
          sandbox.settings = { version: latest, padding: 'b'.repeat(4000 + index) };
          const save = delayedSave();
          await save.started.promise;
          expect(await readVersion()).toBe(first);
          save.release.resolve();
          await save.pending;
        } else {
          sandbox.settings = { version: first, padding: 'c'.repeat(4000 + index) };
          const save = delayedSave();
          await save.started.promise;
          expect(await readVersion()).toBe(first - 1);
          sandbox.settings = { version: latest, padding: 'd'.repeat(1000 + index) };
          api.saveSettingsSync();
          expect(await readVersion()).toBe(latest);
          save.release.resolve();
          await save.pending;
        }
        expect(await readVersion()).toBe(latest);
      }

      expect(log).not.toHaveBeenCalled();
      const temporaryFiles = (await readdir(directory)).filter(name => name.startsWith('desktop.json.tmp-'));
      expect(temporaryFiles).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

type OpenProject = (folder: string, trusted?: boolean) => Promise<{ ok: boolean; code?: string; message?: string }>;

function openProjectHarness() {
  const folder = path.resolve('Race Project');
  const started = { child: { kill: vi.fn() }, path: folder, url: 'http://127.0.0.1:3141/' };
  const mainWindow = {
    isDestroyed: () => false,
    setTitle: vi.fn(),
    loadURL: vi.fn(async () => {}),
  };
  const saveSettings = vi.fn(async () => {});
  const { api, sandbox } = mainDeclarations<{ openProject: OpenProject }>([
    'fail', 'ok', 'windowAlive', 'openProject', 'loadBoard',
  ], {
    mainWindow,
    launchCounter: 0,
    server: null,
    isDirectory: async () => true,
    stopServer: async () => {},
    sendStatus: () => {},
    startServer: async () => started,
    watchServerExit: () => {},
    rememberProject: () => {},
    buildMenu: () => {},
    saveSettings,
    showLauncher: async () => {},
  });
  return { api, sandbox, folder, mainWindow, saveSettings };
}

describe('open project after settings save', () => {
  it('returns superseded without touching a window closed during saveSettings', async () => {
    const harness = openProjectHarness();
    harness.saveSettings.mockImplementation(async () => { harness.sandbox.mainWindow = null; });

    const result = await harness.api.openProject(harness.folder, true);

    expect(result).toEqual({ ok: false, code: 'superseded', message: 'Another action replaced this launch.' });
    expect(harness.mainWindow.setTitle).not.toHaveBeenCalled();
    expect(harness.mainWindow.loadURL).not.toHaveBeenCalled();
  });

  it('returns superseded without loading the board when another launch wins during saveSettings', async () => {
    const harness = openProjectHarness();
    harness.saveSettings.mockImplementation(async () => {
      harness.sandbox.launchCounter = (harness.sandbox.launchCounter as number) + 1;
    });

    const result = await harness.api.openProject(harness.folder, true);

    expect(result).toMatchObject({ ok: false, code: 'superseded' });
    expect(harness.mainWindow.setTitle).not.toHaveBeenCalled();
    expect(harness.mainWindow.loadURL).not.toHaveBeenCalled();
  });
});
