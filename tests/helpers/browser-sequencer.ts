import path from 'node:path';
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { balanceBrowserFiles } from './browser-shards.ts';

export default class BrowserSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]) {
    const browser = files.filter(file => file.project.name === 'browser');
    const other = files.filter(file => file.project.name !== 'browser');
    const { index, count } = this.ctx.config.shard!;
    const relative = (file: TestSpecification) => path.relative(this.ctx.config.root, file.moduleId).replaceAll('\\', '/');
    const selected = new Set(balanceBrowserFiles(browser.map(relative), count)[index - 1].files);
    return [...await super.shard(other), ...browser.filter(file => selected.has(relative(file)))];
  }
}
