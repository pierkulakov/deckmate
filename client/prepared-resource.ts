export interface PreparedResource<Value> {
  load: () => Promise<Value>;
  ready: () => boolean;
}

export function preparedResource<Value>(loader: () => Promise<Value>): PreparedResource<Value> {
  let request: Promise<Value> | undefined;
  let ready = false;
  return {
    load: () => {
      request ??= loader().then(value => { ready = true; return value; });
      return request;
    },
    ready: () => ready,
  };
}

// 2026-11-12: intent preloads must leave failures to the foreground error boundary.
export function preload(resource: PreparedResource<unknown>): void {
  void resource.load().catch(() => {});
}

// 2026-11-10: keep the old screen interactive until import evaluation and CSS installation finish.
// A later navigation wins even when an older chunk arrives last; failed imports still reach React's boundary.
export function preparedNavigation() {
  let generation = 0;
  return {
    run(resource: PreparedResource<unknown>, commit: () => void) {
      const current = ++generation;
      if (resource.ready()) { commit(); return; }
      const finish = () => { if (generation === current) commit(); };
      void resource.load().then(finish, finish);
    },
    cancel() { generation += 1; },
  };
}
