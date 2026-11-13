import type { HeadlessPage } from '../../tools/headless-browser.ts';

export interface MotionFrame {
  time: number;
  box: number[] | null;
  progress: number | null;
  running: boolean;
  fontsReady: boolean;
}
export interface MotionSample {
  frames: MotionFrame[];
  longFrames: number[];
  longTasks: number[];
  resources: string[];
}

export async function untilMotionReady(page: HeadlessPage, expression: string) {
  await page.evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + 15000;
    function check() {
      if (${expression}) return resolve(true);
      if (performance.now() > deadline) return reject(Error(${JSON.stringify(expression)}));
      requestAnimationFrame(check);
    }
    check();
  })`);
}

// 2026-11-13: sample in the page's rAF, not CDP round trips, including the first painted frame and the live handoff.
export async function sampleMotion(page: HeadlessPage, selector: string, action: string, duration = 800): Promise<MotionSample> {
  return page.evaluate(`new Promise((resolve, reject) => {
    const start = performance.now(), frames = [], longFrames = [], longTasks = [];
    const observers = [];
    let painted = false, actionFinished = false;
    for (const [type, entries] of [['long-animation-frame', longFrames], ['longtask', longTasks]]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      const observer = new PerformanceObserver(list => entries.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({type}); observers.push([observer, entries]);
    }
    function sample(time) {
      const element = ${JSON.stringify(selector)}.split(' || ').map(selector => document.querySelector(selector)).find(Boolean);
      const box = element?.getBoundingClientRect();
      painted ||= Boolean(box?.width && box.height);
      let animation;
      for (let target = element; target && !animation; target = target.parentElement) {
        animation = target.getAnimations().find(a => a.effect.getComputedTiming().iterations !== Infinity);
      }
      frames.push({time: time - start, box: box?.width && box.height ? [box.x, box.y, box.width, box.height] : null,
        progress: animation?.effect.getComputedTiming().progress ?? null,
        running: animation?.playState === 'running', fontsReady: document.fonts.status === 'loaded'});
      if (time - start < ${duration} || (time - start < 5000 && (!painted || !actionFinished || document.getAnimations().some(a =>
        (a.playState === 'running' || a.playState === 'paused') && a.effect.getComputedTiming().iterations !== Infinity)))) return requestAnimationFrame(sample);
      for (const [observer, entries] of observers) { entries.push(...observer.takeRecords().map(entry => entry.duration)); observer.disconnect(); }
      resolve({frames, longFrames, longTasks, resources: performance.getEntriesByType('resource').filter(r => r.startTime >= start).map(r => r.name)});
    }
    requestAnimationFrame(time => {
      sample(time);
      try { Promise.resolve((() => { ${action} })()).then(() => { actionFinished = true; }, reject); }
      catch (error) { reject(error); }
    });
  })`);
}

export function motionMetrics(sample: MotionSample) {
  const painted = sample.frames.filter(frame => frame.box);
  return {
    firstBox: painted[0]?.box,
    lastBox: painted.at(-1)?.box,
    firstPaintMs: painted[0]?.time ?? null,
    maxFrameMs: Math.max(0, ...sample.frames.slice(1).map((frame, index) => frame.time - sample.frames[index].time)),
    activeMaxFrameMs: Math.max(0, ...sample.frames.slice(1).flatMap((frame, index) => {
      const previous = sample.frames[index];
      return previous.running && previous.progress !== null && previous.progress >= 0 && previous.progress < 1
        ? [frame.time - previous.time] : [];
    })),
    maxLongFrameMs: Math.max(0, ...sample.longFrames),
    maxLongTaskMs: Math.max(0, ...sample.longTasks),
    frames: painted.length,
  };
}

// 2026-11-13: compare equivalent animation progress, not frame indices; CPU throttling changes the sampling cadence.
export function replayPathError(first: MotionSample, repeat: MotionSample): number {
  const reference = repeat.frames.filter(frame => frame.box && frame.progress !== null);
  const landing = repeat.frames.findLast(frame => frame.box)?.box;
  if (!landing || !first.frames.some(frame => frame.box)) return Infinity;
  if (!reference.length) {
    // 2026-11-13: instant layout switches have two legitimate boxes, not an interpolated path to the last box.
    const boxes = (sample: MotionSample) => sample.frames.flatMap(frame => frame.box ? [frame.box] : []);
    const distance = (from: number[][], to: number[][]) => Math.max(...from.map(box => Math.min(...to.map(other =>
      Math.max(...box.map((value, axis) => Math.abs(value - other[axis])))))));
    const a = boxes(first), b = boxes(repeat);
    return Math.max(distance(a, b), distance(b, a));
  }
  let error = 0;
  for (const frame of first.frames) {
    if (!frame.box || frame.progress === null) continue;
    const before = reference.findLast(candidate => candidate.progress! <= frame.progress!);
    const after = reference.find(candidate => candidate.progress! >= frame.progress!);
    if (!before || !after) continue;
    const span = after.progress! - before.progress!;
    const fraction = span ? (frame.progress - before.progress!) / span : 0;
    for (let axis = 0; axis < 4; axis++) {
      const expected = before.box![axis] + (after.box![axis] - before.box![axis]) * fraction;
      error = Math.max(error, Math.abs(frame.box[axis] - expected));
    }
  }
  return error;
}
