import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { defineText, parseLang } from '../../src/i18n.ts';
import { missingBrowserReason, requireBrowser } from '../browser-environment.ts';
import { buildBrowserFixtures } from './browser-fixtures.ts';

const text = defineText({
  usage: 'Usage: npm run test:fast -- [--out <directory>] [--lang en|ru]',
  duration: (seconds: string, build: string) => `Duration ${seconds} s (one fixture build: ${build} s)`,
  job: (name: string, seconds: string, code: number) => `Duration ${name}: ${seconds} s, exit ${code}`,
  tests: (passed: number, skipped: number, failed: number) => `Tests ${passed} passed | ${skipped} skipped | ${failed} failed`,
  report: (filename: string) => `Report and per-job logs: ${filename}`,
  failedLog: (name: string, filename: string) => `FAIL ${name}; full log: ${filename}`,
  skipped: (count: number) => `Warning: Browser tests skipped: ${count} — ${missingBrowserReason}.`,
  cancelled: 'Test run interrupted.',
  runnerFailed: 'Browser shard runner failed.',
}, {
  usage: 'Запуск: npm run test:fast -- [--out <каталог>] [--lang en|ru]',
  duration: (seconds: string, build: string) => `Duration ${seconds} с (одна сборка фикстур: ${build} с)`,
  job: (name: string, seconds: string, code: number) => `Duration ${name}: ${seconds} с, код ${code}`,
  tests: (passed: number, skipped: number, failed: number) => `Tests ${passed} passed | ${skipped} skipped | ${failed} failed`,
  report: (filename: string) => `Отчёт и логи: ${filename}`,
  failedLog: (name: string, filename: string) => `FAIL ${name}; полный лог: ${filename}`,
  skipped: (count: number) => `Warning: Пропущено браузерных тестов: ${count} — ${missingBrowserReason}.`,
  cancelled: 'Прогон тестов прерван.',
  runnerFailed: 'Ошибка запуска браузерных шардов.',
});

interface TestCounts {
  numPassedTests: number;
  numPendingTests: number;
  numFailedTests: number;
}

interface TestReport extends TestCounts {
  startTime: number;
  testResults: { name: string; message: string; assertionResults: {
    fullName: string; status: string; failureMessages: string[];
  }[] }[];
}

async function main() {
  const args = process.argv.slice(2);
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--out', '--lang'].includes(args[index]) || !args[index + 1]) throw new Error(text.en.usage);
    options.set(args[index], args[index + 1]);
  }
  const t = text[parseLang(options.get('--lang'))];
  const output = path.resolve(options.get('--out') ?? path.join('.deckmate', 'test-fast', `${Date.now()}-${process.pid}`));
  await mkdir(output, { recursive: true });
  const startedAt = Date.now();
  const children = new Set<ChildProcess>();
  const cancellations: Promise<unknown>[] = [];
  let interrupted = false;
  const stop = () => {
    interrupted = true;
    for (const child of children) {
      if (!child.pid) continue;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true });
        cancellations.push(new Promise(resolve => { killer.once('error', resolve); killer.once('close', resolve); }));
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
    }
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const vitest = path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs');
  let built: Awaited<ReturnType<typeof buildBrowserFixtures>> | undefined;

  async function run(name: string, project: string, extraArgs: string[] = []) {
    if (interrupted) throw new Error(t.cancelled);
    const startedAt = Date.now();
    const logFile = path.join(output, `${name}.log`);
    const jsonFile = path.join(output, `${name}.json`);
    const log = createWriteStream(logFile);
    const logFinished = finished(log);
    logFinished.catch(() => stop());
    const child = spawn(process.execPath, [vitest, 'run', '--root', '.', '--project', project, ...extraArgs,
      '--reporter=default', '--reporter=json', '--reporter=./tests/browser-skip-reporter.ts',
      '--reporter=./tests/helpers/test-timing-reporter.ts', `--outputFile.json=${jsonFile}`,
      `--fsModuleCachePath=${path.join(output, name, 'transforms')}`], {
      cwd: process.cwd(), windowsHide: true, detached: process.platform !== 'win32',
      env: { ...process.env, FORCE_COLOR: '0', DECKMATE_TEST_FIXTURE_BUILD: built?.directory,
        DECKMATE_TEST_CACHE_DIR: path.join(output, name, 'vite'),
        DECKMATE_TEST_TIMINGS: path.join(output, `${name}.timings.json`) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    child.stdout!.pipe(log, { end: false });
    child.stderr!.pipe(log, { end: false });
    child.once('error', error => log.write(`${error.stack}\n`));
    const exitCode = await new Promise<number>(resolve => child.once('close', code => resolve(code ?? 1)));
    children.delete(child);
    log.end();
    await logFinished;
    let tests: TestCounts | undefined;
    let report: TestReport | undefined;
    try {
      report = JSON.parse(await readFile(jsonFile, 'utf8')) as TestReport;
      // 2026-11-12: a reused output directory must not turn an old report into successful coverage after startup failure.
      if (report.startTime >= startedAt) tests = {
        numPassedTests: report.numPassedTests, numPendingTests: report.numPendingTests, numFailedTests: report.numFailedTests,
      };
    } catch { /* 2026-11-12: startup failures still need their original log when no JSON report exists. */ }
    const elapsedMs = Date.now() - startedAt;
    console.info(t.job(name, (elapsedMs / 1000).toFixed(2), exitCode));
    const contents = await readFile(logFile, 'utf8');
    if (exitCode) {
      console.error(t.failedLog(name, logFile));
      const failures = tests && report?.testResults.flatMap(file => [
        ...(file.message ? [`${file.name}: ${file.message}`] : []),
        ...file.assertionResults.filter(test => test.status === 'failed').map(test =>
          `${path.relative(process.cwd(), file.name)} > ${test.fullName}\n${test.failureMessages.map(message => message.split('\n').slice(0, 2).join('\n')).join('\n')}`),
      ]);
      // 2026-11-12: print every failed case concisely; full stacks and startup-only errors stay available in the job log.
      console.error(failures?.length ? failures.join('\n\n') : contents);
    }
    else for (const line of contents.split('\n')) {
      if (/warn/iu.test(line) && !line.includes('Warning: Browser tests skipped:')) console.warn(line);
    }
    return { name, startedAt, endedAt: Date.now(), elapsedMs, exitCode, logFile, jsonFile, tests };
  }

  try {
    const browserAvailable = Boolean(requireBrowser());
    // 2026-11-12: overlapping renderers need headroom for filesystem/process-heavy unit cases; the serial command keeps four.
    const results = await Promise.allSettled([
      run('unit', 'unit', ['--maxWorkers=2']),
      (async () => {
        if (browserAvailable) built = await buildBrowserFixtures();
        const shards = await Promise.allSettled([1, 2, 3].map(index => run(`browser-${index}`, 'browser', [`--shard=${index}/3`])));
        const errors = shards.flatMap(shard => shard.status === 'rejected' ? [shard.reason] : []);
        if (errors.length) throw new AggregateError(errors, t.runnerFailed);
        return shards.flatMap(shard => shard.status === 'fulfilled' ? [shard.value] : []);
      })(),
    ]);
    const jobs = results.flatMap(result => result.status === 'fulfilled' ? [result.value].flat() : []);
    for (const result of results) if (result.status === 'rejected') console.error(result.reason);
    const buildMs = built?.durationMs ?? 0;
    await built?.close();
    built = undefined;
    const report = { startedAt, endedAt: Date.now(), elapsedMs: Date.now() - startedAt, buildMs, jobs };
    const filename = path.join(output, 'summary.json');
    await writeFile(filename, JSON.stringify(report, null, 2));
    console.info(t.tests(jobs.reduce((sum, job) => sum + (job.tests?.numPassedTests ?? 0), 0),
      jobs.reduce((sum, job) => sum + (job.tests?.numPendingTests ?? 0), 0),
      jobs.reduce((sum, job) => sum + (job.tests?.numFailedTests ?? 0), 0)));
    if (!browserAvailable) console.warn(t.skipped(jobs.filter(job => job.name.startsWith('browser-'))
      .reduce((sum, job) => sum + (job.tests?.numPendingTests ?? 0), 0)));
    console.info(t.duration((report.elapsedMs / 1000).toFixed(2), (report.buildMs / 1000).toFixed(2)));
    console.info(t.report(filename));
    if (interrupted || jobs.length !== 4 || jobs.some(job => job.exitCode !== 0 || !job.tests)) process.exitCode = 1;
  } finally {
    if (children.size) stop();
    await Promise.all(cancellations);
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    // 2026-11-12: all previews must exit before their shared immutable output is removed.
    await built?.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
