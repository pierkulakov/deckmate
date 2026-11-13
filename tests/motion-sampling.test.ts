import { expect, it } from 'vitest';
import { motionClockError, type MotionClock, type MotionSample } from './helpers/motion-sampling.ts';

function sample(): MotionSample {
  const clock: MotionClock = { id: 0, role: 'target', currentTime: 0, startTime: 100, documentTimeline: true,
    playbackRate: 1, playState: 'running', pending: false, duration: 300, delay: 0, endTime: 300, easing: 'linear', progress: 0 };
  return { longFrames: [], longTasks: [], resources: [], frames: [0, 16.7, 83.4, 200, 350].map(time => ({
    time, timelineTime: 100 + time, box: [0, 0, 100, 100], running: time < 300, fontsReady: true, progress: Math.min(time / 300, 1),
    clocks: [{ ...clock, currentTime: Math.min(time, 300), playState: time < 300 ? 'running' : 'finished' }],
  })) };
}

it('accepts missed host frames when local animation time advances on the same document clock', () => {
  expect(motionClockError(sample())).toBeLessThan(.01);
});

it('detects a seek and a restart even when the restarted animation agrees with its new origin', () => {
  const seek = sample();
  seek.frames[2].clocks[0].currentTime! += 16;
  expect(motionClockError(seek)).toBeCloseTo(16);
  const restart = sample();
  restart.frames[2].clocks[0].startTime! += 16;
  restart.frames[2].clocks[0].currentTime! -= 16;
  expect(motionClockError(restart)).toBeCloseTo(16);
});

it('detects a companion released on another clock and motion during preparation', () => {
  const shifted = sample();
  for (const frame of shifted.frames) frame.clocks.push({ ...frame.clocks[0], id: 1, role: 'clip',
    startTime: 90, currentTime: Math.min(frame.time + 10, 300) });
  expect(motionClockError(shifted)).toBeCloseTo(10);
  const preparing = sample();
  preparing.frames[0].clocks[0] = { ...preparing.frames[0].clocks[0], playState: 'paused', startTime: null, currentTime: 5 };
  expect(motionClockError(preparing)).toBeCloseTo(5);
});

it('retains the shared origin after travel disappears and rejects a reveal held past its release', () => {
  const delayed = sample();
  const reveal = { ...delayed.frames[0].clocks[0], id: 1, role: 'reveal', duration: 150, delay: 300, endTime: 450 };
  for (const frame of delayed.frames) frame.clocks.push({ ...reveal, currentTime: frame.time });
  delayed.frames[4].clocks = [{ ...reveal, startTime: 110, currentTime: 340 }];
  expect(motionClockError(delayed)).toBeCloseTo(10);
  const paused = sample();
  paused.frames[2].clocks.push({ ...reveal, playState: 'paused', currentTime: 0, startTime: null });
  expect(motionClockError(paused)).toBeCloseTo(83.4);
});
