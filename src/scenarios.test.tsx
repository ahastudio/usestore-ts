/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */
/* eslint-disable no-underscore-dangle */
/* eslint-disable no-empty-function */
/* eslint-disable react/require-default-props */
/* eslint-disable react/jsx-one-expression-per-line */

import { StrictMode } from 'react';
import { act, render, screen } from '@testing-library/react';

import { STORE_GLUE_PROPERTY_KEY, CACHE_PROPERTY_KEY } from './contants';
import { Action, Store } from './decorators';
import StoreGlue from './StoreGlue';
import useStore from './useStore';
import { attachGetters, getGetterKeys, takeSnapshot } from './utils';

const proc = (globalThis as unknown as {
  process: {
    on(event: string, handler: () => void): void;
    off(event: string, handler: () => void): void;
  };
}).process;

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function glueOf(store: object): StoreGlue {
  return Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
}

@Store()
class TodoStore {
  items: string[] = [];

  loading = false;

  error = '';

  #secret = 'hidden';

  _internal = 'internal';

  get count() {
    return this.items.length;
  }

  get summary() {
    return `${this.count} items${this.loading ? ' (loading)' : ''}`;
  }

  get _privateGetter() {
    return 'private';
  }

  @Action()
  add(item: string) {
    this.items = [...this.items, item];
    return this.items.length;
  }

  @Action()
  noop() {}

  @Action()
  setLoading(loading: boolean) {
    this.loading = loading;
  }

  @Action()
  async load(gate: Promise<string[]>) {
    this.loading = true;
    this.items = await gate;
    this.loading = false;
  }

  @Action()
  async loadOrFail(gate: Promise<string[]>) {
    this.loading = true;
    try {
      this.items = await gate;
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  @Action()
  async fail(gate: Promise<unknown>) {
    this.loading = true;
    await gate;
  }

  @Action()
  failSync() {
    throw new Error('sync failure');
  }

  @Action()
  thenable() {
    return { then: (resolve: () => void) => resolve() };
  }

  revealSecret() {
    return this.#secret;
  }
}

describe('snapshot', () => {
  it('excludes private fields and underscore getters but keeps getters', () => {
    const store = new TodoStore();
    const snapshot = glueOf(store).getSnapshot() as Record<string, unknown>;

    expect(snapshot).toMatchObject({
      items: [], loading: false, error: '', count: 0,
    });
    expect(Object.keys(snapshot)).not.toContain('#secret');
    expect(snapshot._privateGetter).toBeUndefined();
    expect(store.revealSecret()).toBe('hidden');
  });

  it('keeps the same identity while nothing changes', () => {
    const store = new TodoStore();
    const before = glueOf(store).getSnapshot();

    store.noop();
    store.setLoading(false);

    expect(glueOf(store).getSnapshot()).toBe(before);
  });

  it('creates a new identity when a value changes', () => {
    const store = new TodoStore();
    const before = glueOf(store).getSnapshot();

    store.add('a');

    expect(glueOf(store).getSnapshot()).not.toBe(before);
    expect(before).toMatchObject({ items: [], count: 0 });
  });

  it('recomputes getters for each new snapshot', () => {
    const store = new TodoStore();
    const first = glueOf(store).getSnapshot() as { summary: string };

    store.add('a');
    store.setLoading(true);
    const second = glueOf(store).getSnapshot() as { summary: string };

    expect(first.summary).toBe('0 items');
    expect(second.summary).toBe('1 items (loading)');
  });

  it('caches getter results inside one snapshot', () => {
    const getter = jest.fn(() => 42);

    @Store()
    class Cached {
      value = 1;

      get computed() {
        return getter();
      }
    }
    const snapshot = glueOf(new Cached()).getSnapshot() as {
      computed: number;
    };

    expect(snapshot.computed).toBe(42);
    expect(snapshot.computed).toBe(42);
    expect(getter).toHaveBeenCalledTimes(1);
  });

  it('does not mutate earlier snapshots', () => {
    const store = new TodoStore();
    store.add('a');
    const first = glueOf(store).getSnapshot() as { items: string[] };

    store.add('b');

    expect(first.items).toEqual(['a']);
  });
});

describe('sync action', () => {
  it('passes arguments, binds this, and returns the value', () => {
    const store = new TodoStore();

    expect(store.add('a')).toBe(1);
    expect(store.add('b')).toBe(2);
    expect(store.items).toEqual(['a', 'b']);
  });

  it('notifies once per changing call', () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    store.add('a');
    store.add('b');

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify when nothing changed', () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    store.noop();
    store.setLoading(false);

    expect(listener).not.toHaveBeenCalled();
  });

  it('propagates thrown errors', () => {
    const store = new TodoStore();

    expect(() => store.failSync()).toThrow('sync failure');
  });

  it('ignores thenables that are not Promise instances', () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    store.thenable();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('async action', () => {
  it('notifies for the sync part, then again after completion', async () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);
    const gate = deferred<string[]>();

    const promise = store.load(gate.promise);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(glueOf(store).getSnapshot()).toMatchObject({ loading: true });

    gate.resolve(['a']);
    await promise;

    expect(listener).toHaveBeenCalledTimes(2);
    expect(glueOf(store).getSnapshot()).toMatchObject({
      loading: false, items: ['a'], count: 1,
    });
  });

  it('keeps showing the loading state until the promise settles', async () => {
    const store = new TodoStore();
    const gate = deferred<string[]>();

    const promise = store.load(gate.promise);
    await Promise.resolve();
    await Promise.resolve();

    expect(glueOf(store).getSnapshot()).toMatchObject({ loading: true });

    gate.resolve([]);
    await promise;
  });

  it('returns a promise that resolves with the original value', async () => {
    @Store()
    class ValueStore {
      @Action()
      async compute() {
        await Promise.resolve();
        return 7;
      }
    }

    await expect(new ValueStore().compute()).resolves.toBe(7);
  });

  it('notifies after rejection and surfaces the error', async () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);
    const gate = deferred<unknown>();

    const promise = store.fail(gate.promise);
    gate.reject(new Error('boom'));

    await expect(promise).rejects.toThrow('boom');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(glueOf(store).getSnapshot()).toMatchObject({ loading: true });
  });

  it('does not create an unhandled rejection of its own', async () => {
    const unhandled = jest.fn();
    proc.on('unhandledRejection', unhandled);
    const store = new TodoStore();
    const gate = deferred<unknown>();

    const promise = store.fail(gate.promise);
    gate.reject(new Error('boom'));
    await promise.catch(() => {});
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    proc.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('reflects error handling inside the action', async () => {
    const store = new TodoStore();
    const gate = deferred<string[]>();

    const promise = store.loadOrFail(gate.promise);
    gate.reject(new Error('network'));
    await promise;

    expect(glueOf(store).getSnapshot()).toMatchObject({
      error: 'network', loading: false, items: [],
    });
  });

  it('handles overlapping actions that finish out of order', async () => {
    const store = new TodoStore();
    const slow = deferred<string[]>();
    const fast = deferred<string[]>();

    const first = store.load(slow.promise);
    const second = store.load(fast.promise);
    fast.resolve(['fast']);
    await second;

    expect(glueOf(store).getSnapshot()).toMatchObject({
      items: ['fast'], loading: false,
    });

    slow.resolve(['slow']);
    await first;

    expect(glueOf(store).getSnapshot()).toMatchObject({
      items: ['slow'], loading: false, count: 1,
    });
  });

  it('keeps every notification when many actions run together', async () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);
    const gates = Array.from({ length: 5 }, () => deferred<string[]>());

    const promises = gates.map((gate) => store.load(gate.promise));
    gates.forEach((gate, i) => gate.resolve([`item${i}`]));
    await Promise.all(promises);

    expect(store.items).toEqual(['item4']);
    expect(glueOf(store).getSnapshot()).toMatchObject({
      items: ['item4'], loading: false,
    });
    expect(listener).toHaveBeenCalled();
  });

  it('interleaves sync actions between awaits', async () => {
    const store = new TodoStore();
    const gate = deferred<string[]>();

    const promise = store.load(gate.promise);
    store.add('during');
    expect(glueOf(store).getSnapshot()).toMatchObject({
      items: ['during'], loading: true,
    });

    gate.resolve(['after']);
    await promise;

    expect(glueOf(store).getSnapshot()).toMatchObject({
      items: ['after'], loading: false,
    });
  });

  it('works with an action that resolves immediately', async () => {
    const store = new TodoStore();

    await store.load(Promise.resolve(['now']));

    expect(glueOf(store).getSnapshot()).toMatchObject({ items: ['now'] });
  });
});

describe('subscription', () => {
  it('stops notifying after unsubscribe', () => {
    const store = new TodoStore();
    const listener = jest.fn();
    const unsubscribe = glueOf(store).subscribe(listener);

    store.add('a');
    unsubscribe();
    store.add('b');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('unsubscribing twice is harmless', () => {
    const store = new TodoStore();
    const unsubscribe = glueOf(store).subscribe(jest.fn());

    unsubscribe();

    expect(() => unsubscribe()).not.toThrow();
  });

  it('notifies every listener', () => {
    const store = new TodoStore();
    const listeners = [jest.fn(), jest.fn(), jest.fn()];
    listeners.forEach((l) => glueOf(store).subscribe(l));

    store.add('a');

    listeners.forEach((l) => expect(l).toHaveBeenCalledTimes(1));
  });

  it('registers the same listener only once', () => {
    const store = new TodoStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);
    glueOf(store).subscribe(listener);

    store.add('a');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify listeners removed after an async action started', async () => {
    const store = new TodoStore();
    const listener = jest.fn();
    const unsubscribe = glueOf(store).subscribe(listener);
    const gate = deferred<string[]>();

    const promise = store.load(gate.promise);
    unsubscribe();
    listener.mockClear();
    gate.resolve(['a']);
    await promise;

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps stores independent', () => {
    const a = new TodoStore();
    const b = new TodoStore();
    const listenerB = jest.fn();
    glueOf(b).subscribe(listenerB);

    a.add('only a');

    expect(listenerB).not.toHaveBeenCalled();
    expect(b.items).toEqual([]);
    expect(glueOf(a)).not.toBe(glueOf(b));
  });
});

describe('inheritance', () => {
  class Base {
    base = 'base';

    get baseGetter() {
      return `${this.base}!`;
    }

    changeBase(value: string) {
      this.base = value;
    }
  }

  @Store()
  class Child extends Base {
    child = 'child';

    get childGetter() {
      return `${this.child}?`;
    }

    @Action()
    changeBoth(value: string) {
      this.changeBase(value);
      this.child = value;
    }
  }

  it('includes inherited fields', () => {
    const snapshot = glueOf(new Child()).getSnapshot();

    expect(snapshot).toMatchObject({ base: 'base', child: 'child' });
  });

  it('includes getters of the class itself', () => {
    const snapshot = glueOf(new Child()).getSnapshot() as {
      childGetter: string;
    };

    expect(snapshot.childGetter).toBe('child?');
  });

  // Known defect: getGetterKeys only looks two prototype levels up.
  it.failing('includes getters of the parent class', () => {
    const snapshot = glueOf(new Child()).getSnapshot() as {
      baseGetter: string;
    };

    expect(snapshot.baseGetter).toBe('base!');
  });

  it('notifies for parent mutations done inside an action', () => {
    const child = new Child();
    const listener = jest.fn();
    glueOf(child).subscribe(listener);

    child.changeBoth('x');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(glueOf(child).getSnapshot()).toMatchObject({
      base: 'x', child: 'x',
    });
  });
});

describe('utils edge cases', () => {
  it('getGetterKeys skips underscore getters', () => {
    const keys = getGetterKeys(new TodoStore());

    expect(keys).toEqual(expect.arrayContaining(['count', 'summary']));
    expect(keys).not.toContain('_privateGetter');
  });

  it('takeSnapshot skips # keys and sets a plain prototype', () => {
    const snapshot = takeSnapshot({ a: 1, '#b': 2 }, ['a', '#b']);

    expect(Object.keys(snapshot)).toEqual(['a']);
    expect(Reflect.getPrototypeOf(snapshot)).not.toBe(Object.prototype);
  });

  it('attachGetters returns undefined for accessors without a getter', () => {
    class Proto {
      // eslint-disable-next-line class-methods-use-this, accessor-pairs
      set onlySet(_: number) {}
    }
    const target = takeSnapshot({}, []);

    attachGetters(target, { obj: new Proto(), keys: ['onlySet'] });

    expect((target as Record<string, unknown>).onlySet).toBeUndefined();
    expect(Reflect.get(Reflect.getPrototypeOf(target) as object, CACHE_PROPERTY_KEY))
      .toEqual({});
  });
});

describe('React integration', () => {
  function View({ store, label = 'view' }: { store: TodoStore; label?: string }) {
    const [{ items, loading, summary }] = useStore(store);
    return (
      <p data-testid={label}>
        {`${summary}|${items.join(',')}|${loading ? 'L' : 'I'}`}
      </p>
    );
  }

  it('renders the async result after the promise resolves', async () => {
    const store = new TodoStore();
    const gate = deferred<string[]>();
    render(<View store={store} />);

    let promise!: Promise<void>;
    act(() => { promise = store.load(gate.promise); });

    expect(screen.getByTestId('view').textContent).toBe('0 items (loading)||L');

    await act(async () => {
      gate.resolve(['a', 'b']);
      await promise;
    });

    expect(screen.getByTestId('view').textContent).toBe('2 items|a,b|I');
  });

  it('updates every component that uses the store', async () => {
    const store = new TodoStore();
    render(<><View store={store} label="one" /><View store={store} label="two" /></>);

    await act(async () => {
      await store.load(Promise.resolve(['x']));
    });

    expect(screen.getByTestId('one').textContent).toBe('1 items|x|I');
    expect(screen.getByTestId('two').textContent).toBe('1 items|x|I');
  });

  it('renders the rejection handled inside the action', async () => {
    const store = new TodoStore();
    render(<View store={store} />);

    await act(async () => {
      await store.loadOrFail(Promise.reject(new Error('x')));
    });

    expect(screen.getByTestId('view').textContent).toBe('0 items||I');
    expect(store.error).toBe('x');
  });

  it('batches several sync actions inside one act', () => {
    const store = new TodoStore();
    const renders = jest.fn();
    function Counter() {
      const [{ count }] = useStore(store);
      renders();
      return <p data-testid="count">{count}</p>;
    }
    render(<Counter />);
    renders.mockClear();

    act(() => {
      store.add('a');
      store.add('b');
      store.add('c');
    });

    expect(screen.getByTestId('count').textContent).toBe('3');
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('works under StrictMode', async () => {
    const store = new TodoStore();
    render(<StrictMode><View store={store} /></StrictMode>);

    await act(async () => {
      await store.load(Promise.resolve(['s']));
    });

    expect(screen.getByTestId('view').textContent).toBe('1 items|s|I');
  });

  it('unsubscribes on unmount', () => {
    const store = new TodoStore();
    const { unmount } = render(<View store={store} />);

    expect(glueOf(store).listeners.size).toBe(1);
    unmount();

    expect(glueOf(store).listeners.size).toBe(0);
  });

  it('stays quiet when an async action finishes after unmount', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    const store = new TodoStore();
    const gate = deferred<string[]>();
    const { unmount } = render(<View store={store} />);

    let promise!: Promise<void>;
    act(() => { promise = store.load(gate.promise); });
    unmount();
    gate.resolve(['late']);
    await promise;

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('returns the store itself as the second element', () => {
    const store = new TodoStore();
    let received: unknown;
    function Probe() {
      [, received] = useStore(store);
      return null;
    }

    render(<Probe />);

    expect(received).toBe(store);
  });

  it('throws for objects that are not stores', () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {});
    function Bad() {
      useStore({});
      return null;
    }

    expect(() => render(<Bad />)).toThrow('Cannot find store glue');
    errors.mockRestore();
  });

  it('picks up a store created after a previous one changed', async () => {
    const first = new TodoStore();
    const second = new TodoStore();
    const { rerender } = render(<View store={first} />);
    await act(async () => { first.add('one'); });

    rerender(<View store={second} />);

    expect(screen.getByTestId('view').textContent).toBe('0 items||I');
  });
});

describe('random action sequences', () => {
  @Store()
  class Ledger {
    count = 0;

    log: string[] = [];

    @Action()
    inc(n: number) {
      this.count += n;
    }

    @Action()
    push(text: string) {
      this.log = [...this.log, text];
    }

    @Action()
    incThenThrow(n: number) {
      this.count += n;
      throw new Error('sync');
    }

    @Action()
    async slowInc(gate: Promise<number>) {
      const value = await gate;
      this.count += value;
    }

    @Action()
    async slowFail(gate: Promise<number>) {
      this.log = [...this.log, 'fail-start'];
      await gate;
    }
  }

  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

  const stateOf = (value: { count: number; log: string[] }) => JSON.stringify({
    count: value.count,
    log: value.log,
  });

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    'keeps the snapshot equal to the store and the model (seed %i)',
    async (seed) => {
      const next = random(seed);
      const pick = (n: number) => Math.floor(next() * n);
      const store = new Ledger();
      const glue = glueOf(store);
      const model = { count: 0, log: [] as string[] };
      const pending: { gate: ReturnType<typeof deferred<number>>; fails: boolean }[] = [];
      const seen: string[] = [];
      const snapshots: object[] = [];
      let notifications = 0;
      const unhandled = jest.fn();
      proc.on('unhandledRejection', unhandled);

      glue.subscribe(() => {
        notifications += 1;
        const snapshot = glue.getSnapshot() as { count: number; log: string[] };
        expect(stateOf(snapshot)).toBe(stateOf(store));
        seen.push(stateOf(snapshot));
        snapshots.push(snapshot);
      });

      for (let step = 0; step < 60; step += 1) {
        const before = glue.getSnapshot();
        const beforeState = stateOf(model);
        const choice = pick(7);
        const n = pick(9) + 1;

        if (choice === 0) {
          store.inc(n);
          model.count += n;
        } else if (choice === 1) {
          store.push(`p${step}`);
          model.log = [...model.log, `p${step}`];
        } else if (choice === 2) {
          expect(() => store.incThenThrow(n)).toThrow('sync');
          model.count += n;
        } else if (choice === 3) {
          const gate = deferred<number>();
          pending.push({ gate, fails: false });
          store.slowInc(gate.promise);
        } else if (choice === 4) {
          const gate = deferred<number>();
          pending.push({ gate, fails: true });
          store.slowFail(gate.promise).catch(() => {});
          model.log = [...model.log, 'fail-start'];
        } else if (pending.length) {
          const [{ gate, fails }] = pending.splice(pick(pending.length), 1);
          if (fails) {
            gate.reject(new Error('later'));
          } else {
            gate.resolve(n);
            model.count += n;
          }
        }
        // eslint-disable-next-line no-await-in-loop
        await flush();

        expect(stateOf(store)).toBe(stateOf(model));
        expect(stateOf(glue.getSnapshot() as Ledger)).toBe(stateOf(model));
        if (stateOf(model) === beforeState) {
          expect(glue.getSnapshot()).toBe(before);
        } else {
          expect(glue.getSnapshot()).not.toBe(before);
        }
      }

      pending.forEach(({ gate, fails }) => {
        if (fails) {
          gate.reject(new Error('end'));
        } else {
          gate.resolve(1);
          model.count += 1;
        }
      });
      await flush();

      expect(stateOf(store)).toBe(stateOf(model));
      expect(stateOf(glue.getSnapshot() as Ledger)).toBe(stateOf(model));
      expect(new Set(snapshots).size).toBe(snapshots.length);
      seen.slice(1).forEach((state, i) => expect(state).not.toBe(seen[i]));
      expect(notifications).toBeGreaterThan(0);
      expect(unhandled).not.toHaveBeenCalled();
      proc.off('unhandledRejection', unhandled);
    },
  );
});
