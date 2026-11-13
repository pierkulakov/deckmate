import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, TestModule, Vitest } from 'vitest/node';

export default class TestTimingReporter implements Reporter {
  private startedAt = Date.now();
  private queued = new Map<string, number>();
  private modules: object[] = [];
  private context?: Vitest;

  onInit(context: Vitest) { this.context = context; }

  onTestModuleQueued(module: TestModule) {
    this.queued.set(module.id, Date.now());
  }

  onTestModuleEnd(module: TestModule) {
    this.modules.push({ name: module.relativeModuleId.replaceAll('\\', '/'), project: module.project.name,
      queuedAt: this.queued.get(module.id), endedAt: Date.now(), ...module.diagnostic() });
  }

  async onTestRunEnd() {
    const filename = process.env.DECKMATE_TEST_TIMINGS;
    if (!filename) return;
    const fixtures = this.context?.projects.filter(project => project.name === 'browser')
      .map(project => project.getProvidedContext().browserFixtureTiming);
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, JSON.stringify({ startedAt: this.startedAt, endedAt: Date.now(), fixtures, modules: this.modules }, null, 2));
  }
}
