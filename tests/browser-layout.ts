type Evaluate = (expression: string) => Promise<any>;

export async function waitForLayout(evaluate: Evaluate, selector: string, timeoutMs = 5000): Promise<void> {
  // 2026-11-10: fonts, ResizeObserver work and finite animations must settle before measuring geometry;
  // a fixed sleep both wastes fast frames and samples an unfinished layout under load.
  await evaluate(`new Promise((resolve, reject) => {
    let frame;
    const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('Layout did not settle: ' + ${JSON.stringify(selector)})); }, ${timeoutMs});
    let previous = '', stable = 0;
    function sample() {
      const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const geometry = JSON.stringify(elements.map(element => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height, element.scrollLeft, element.scrollTop, element.scrollWidth, element.scrollHeight];
      }));
      const animating = document.getAnimations().some(animation => animation.playState === 'running'
        && animation.effect?.getComputedTiming().iterations !== Infinity);
      stable = elements.length && document.fonts.status === 'loaded' && !animating && geometry === previous ? stable + 1 : 0;
      previous = geometry;
      if (stable >= 3) { clearTimeout(timer); resolve(); }
      else frame = requestAnimationFrame(sample);
    }
    frame = requestAnimationFrame(sample);
  })`);
}

export async function expectPageStateDuring(evaluate: Evaluate, expression: string, durationMs: number): Promise<void> {
  // 2026-11-10: negative assertions need the whole debounce/reconnect observation window, not an early successful poll.
  await evaluate(`new Promise((resolve, reject) => {
    const deadline = performance.now() + ${durationMs};
    function sample() {
      if (!(${expression})) return reject(new Error('Unexpected browser state: ' + ${JSON.stringify(expression)}));
      if (performance.now() >= deadline) resolve();
      else setTimeout(sample, 20);
    }
    sample();
  })`);
}
