export interface WarmupTask {
  key: string;
  priority: number;
  motionOnly?: boolean;
  run: (signal: AbortSignal) => void | Promise<unknown>;
}

export const warmupInputAbort = 'warmup-input';

export interface WarmupEnvironment {
  allowed: () => boolean;
  reducedMotion: () => boolean;
  inputPending: () => boolean;
  idle: (callback: (remaining: number) => void) => () => void;
  delay: (callback: () => void, ms: number) => () => void;
  subscribe: (interrupt: () => void) => () => void;
}

// 2026-11-10: imports evaluate code and install their CSS, unlike a fetch/modulepreload alone.
// One task per idle turn keeps unrelated first-use work out of the same frame.
export class WarmupQueue {
  private tasks = new Map<string, WarmupTask>();
  private completed = new Set<string>();
  private active: { task: WarmupTask; controller: AbortController } | null = null;
  private cancelIdle: (() => void) | undefined;
  private cancelDelay: (() => void) | undefined;
  private unsubscribe: () => void;
  private disposed = false;

  constructor(private environment: WarmupEnvironment) {
    this.unsubscribe = environment.subscribe(() => this.interrupt());
  }

  add(task: WarmupTask): () => void {
    if (this.disposed || this.completed.has(task.key) || this.tasks.has(task.key)) return () => {};
    this.tasks.set(task.key, task);
    this.schedule();
    return () => {
      if (this.tasks.get(task.key) !== task) return;
      this.tasks.delete(task.key);
      if (this.active?.task === task) this.active.controller.abort();
    };
  }

  private interrupt() {
    if (this.disposed || !this.tasks.size) return;
    this.cancelIdle?.();
    this.cancelIdle = undefined;
    this.cancelDelay?.();
    this.active?.controller.abort(warmupInputAbort);
    // 2026-11-10: queued work survives input, but the next gesture gets a quiet interval of its own.
    this.cancelDelay = this.environment.delay(() => {
      this.cancelDelay = undefined;
      this.schedule();
    }, 600);
  }

  private schedule() {
    if (this.disposed || this.active || this.cancelIdle || this.cancelDelay || !this.tasks.size || !this.environment.allowed()) return;
    this.cancelIdle = this.environment.idle(remaining => {
      this.cancelIdle = undefined;
      if (!this.environment.allowed()) return;
      if (remaining < 8 || this.environment.inputPending()) { this.interrupt(); return; }
      const task = [...this.tasks.values()].sort((a, b) => a.priority - b.priority)[0];
      if (!task) return;
      if (task.motionOnly && this.environment.reducedMotion()) {
        this.tasks.delete(task.key);
        this.completed.add(task.key);
        this.schedule();
        return;
      }
      const controller = new AbortController();
      this.active = { task, controller };
      void this.run(task, controller);
    });
  }

  private async run(task: WarmupTask, controller: AbortController) {
    try { await task.run(controller.signal); }
    catch { /* 2026-11-10: speculative failures must not replace the foreground error/retry path. */ }
    finally {
      if (!controller.signal.aborted && this.tasks.get(task.key) === task) {
        this.tasks.delete(task.key);
        this.completed.add(task.key);
      }
      this.active = null;
      this.schedule();
    }
  }

  dispose() {
    this.disposed = true;
    this.cancelIdle?.();
    this.cancelDelay?.();
    this.active?.controller.abort();
    this.tasks.clear();
    this.unsubscribe();
  }
}

type Connection = EventTarget & { saveData?: boolean };

export function browserWarmupEnvironment(): WarmupEnvironment {
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  const scheduling = (navigator as Navigator & { scheduling?: { isInputPending: () => boolean } }).scheduling;
  return {
    allowed: () => !document.hidden && !connection?.saveData,
    reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    // 2026-11-10: protect foreground entrances, not passive status toasts whose hold period can starve startup warmup.
    inputPending: () => Boolean(scheduling?.isInputPending()) || document.getAnimations().some(animation => {
      if (animation.playState !== 'running' && animation.playState !== 'paused') return false;
      if (animation.effect?.getComputedTiming().iterations === Infinity) return false;
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (target && target instanceof Element && target.closest('[role="status"]')) return false;
      return true;
    }),
    idle: callback => {
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(deadline => callback(deadline.timeRemaining()));
        return () => window.cancelIdleCallback(id);
      }
      const id = window.setTimeout(() => callback(8), 100);
      return () => clearTimeout(id);
    },
    delay: (callback, ms) => {
      const id = window.setTimeout(callback, ms);
      return () => clearTimeout(id);
    },
    subscribe: interrupt => {
      const inputEvents = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input', 'touchstart'];
      for (const name of inputEvents) window.addEventListener(name, interrupt, { capture: true, passive: true });
      document.addEventListener('visibilitychange', interrupt);
      connection?.addEventListener('change', interrupt);
      return () => {
        for (const name of inputEvents) window.removeEventListener(name, interrupt, true);
        document.removeEventListener('visibilitychange', interrupt);
        connection?.removeEventListener('change', interrupt);
      };
    },
  };
}

// 2026-11-10: neither snapshot arrival nor the shell spinner is the first useful screen.
export function afterFirstScreen(start: () => void): () => void {
  let frame = 0;
  let timer = 0;
  let started = false;
  const observer = new MutationObserver(check);
  function check() {
    if (started || !document.querySelector('.catalog-spaces, .catalog-results, .hand-panel, .timeline-canvas, .excalidraw, .ui-empty-first-run')) return;
    started = true;
    observer.disconnect();
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => { timer = window.setTimeout(start, 400); });
    });
  }
  observer.observe(document.body, { childList: true, subtree: true });
  check();
  return () => { observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timer); };
}
