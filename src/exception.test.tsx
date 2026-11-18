/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/only-throw-error */
/* eslint-disable prefer-promise-reject-errors */
/* eslint-disable react/jsx-one-expression-per-line */

import {
  act, fireEvent, render, screen,
} from '@testing-library/react';

import { STORE_GLUE_PROPERTY_KEY } from './contants';
import { Action, Store } from './decorators';
import StoreGlue from './StoreGlue';
import useStore from './useStore';

function glueOf(store: object): StoreGlue {
  return Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
}

class CustomError extends Error {
  code = 42;
}

@Store()
class Subject {
  count = 0;

  label = 'initial';

  get doubled() {
    return this.count * 2;
  }

  @Action()
  throwAfterChange() {
    this.count += 1;
    throw new Error('after change');
  }

  @Action()
  throwBeforeChange() {
    throw new Error('before change');
  }

  @Action()
  throwValue(value: unknown) {
    this.count += 1;
    throw value;
  }

  @Action()
  throwCustom() {
    this.count += 1;
    throw new CustomError('custom');
  }

  @Action()
  throwPartial() {
    this.count = 1;
    this.label = 'partial';
    throw new Error('partial');
  }

  @Action()
  add(a: number, b: number) {
    this.count += a + b;
    return this.count;
  }

  @Action()
  async asyncThrow() {
    this.count += 1;
    throw new Error('async');
  }

  @Action()
  returnRejected() {
    this.count += 1;
    return Promise.reject(new Error('rejected'));
  }

  @Action()
  returnThenable(then: () => void) {
    this.count += 1;
    return { then };
  }

  @Action()
  outerCatches() {
    try {
      this.throwAfterChange();
    } catch {
      this.label = 'caught';
    }
  }

  @Action()
  outerPropagates() {
    this.throwAfterChange();
  }
}

function watch(store: Subject) {
  const counts: number[] = [];
  const listener = jest.fn(() => {
    counts.push((glueOf(store).getSnapshot() as { count: number }).count);
  });
  glueOf(store).subscribe(listener);
  return { listener, counts };
}

describe('thrown value', () => {
  it('rethrows the same Error object', () => {
    const store = new Subject();
    const caught: unknown[] = [];

    try {
      store.throwAfterChange();
    } catch (e) {
      caught.push(e);
    }

    expect(caught).toHaveLength(1);
    expect(caught[0]).toBeInstanceOf(Error);
    expect((caught[0] as Error).message).toBe('after change');
  });

  it('keeps the class and fields of a custom error', () => {
    const store = new Subject();
    let caught: unknown;

    try {
      store.throwCustom();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CustomError);
    expect((caught as CustomError).code).toBe(42);
  });

  it.each([
    ['string', 'text'],
    ['number', 7],
    ['zero', 0],
    ['empty string', ''],
    ['null', null],
    ['undefined', undefined],
    ['object', { reason: 'plain' }],
  ])('rethrows a thrown %s as is', (_name, value) => {
    const store = new Subject();
    let caught: unknown = Symbol('not thrown');

    try {
      store.throwValue(value);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBe(value);
  });

  it('notifies even when a falsy value is thrown', () => {
    const store = new Subject();
    const { listener } = watch(store);

    expect(() => store.throwValue(undefined)).toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('update after a synchronous throw', () => {
  it('calls update exactly once', () => {
    const store = new Subject();
    const update = jest.spyOn(glueOf(store), 'update');

    expect(() => store.throwAfterChange()).toThrow('after change');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(store);
  });

  it('notifies listeners once with the changed state', () => {
    const store = new Subject();
    const { listener, counts } = watch(store);

    expect(() => store.throwAfterChange()).toThrow();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(counts).toEqual([1]);
  });

  it('replaces the snapshot with a new object', () => {
    const store = new Subject();
    const before = glueOf(store).getSnapshot();

    expect(() => store.throwAfterChange()).toThrow();

    const after = glueOf(store).getSnapshot();
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ count: 1, label: 'initial' });
  });

  it('recomputes getters in the new snapshot', () => {
    const store = new Subject();

    expect(() => store.throwAfterChange()).toThrow();
    expect(() => store.throwAfterChange()).toThrow();

    expect((glueOf(store).getSnapshot() as Subject).doubled).toBe(4);
  });

  it('reflects every change made before the throw', () => {
    const store = new Subject();

    expect(() => store.throwPartial()).toThrow('partial');

    expect(glueOf(store).getSnapshot()).toMatchObject({
      count: 1,
      label: 'partial',
    });
  });

  it('does not notify when nothing changed before the throw', () => {
    const store = new Subject();
    const before = glueOf(store).getSnapshot();
    const { listener } = watch(store);
    const update = jest.spyOn(glueOf(store), 'update');

    expect(() => store.throwBeforeChange()).toThrow('before change');

    expect(update).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    expect(glueOf(store).getSnapshot()).toBe(before);
  });

  it('notifies once per throw when the action throws repeatedly', () => {
    const store = new Subject();
    const { listener, counts } = watch(store);

    expect(() => store.throwAfterChange()).toThrow();
    expect(() => store.throwAfterChange()).toThrow();
    expect(() => store.throwAfterChange()).toThrow();

    expect(listener).toHaveBeenCalledTimes(3);
    expect(counts).toEqual([1, 2, 3]);
  });

  it('keeps working after a throw', () => {
    const store = new Subject();
    const { counts } = watch(store);

    expect(() => store.throwAfterChange()).toThrow();
    const sum = store.add(2, 3);

    expect(sum).toBe(6);
    expect(counts).toEqual([1, 6]);
  });

  it('skips listeners that unsubscribed before the throw', () => {
    const store = new Subject();
    const listener = jest.fn();
    const unsubscribe = glueOf(store).subscribe(listener);
    unsubscribe();

    expect(() => store.throwAfterChange()).toThrow();

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies every subscriber', () => {
    const store = new Subject();
    const first = watch(store);
    const second = watch(store);

    expect(() => store.throwAfterChange()).toThrow();

    expect(first.listener).toHaveBeenCalledTimes(1);
    expect(second.listener).toHaveBeenCalledTimes(1);
  });

  it('notifies after the state change and not before it', () => {
    const store = new Subject();
    const seen: number[] = [];
    glueOf(store).subscribe(() => seen.push(store.count));

    expect(() => store.throwAfterChange()).toThrow();

    expect(seen).toEqual([1]);
  });
});

describe('normal return is unchanged', () => {
  it('returns the value and passes the arguments', () => {
    const store = new Subject();

    expect(store.add(1, 2)).toBe(3);
    expect(store.add(4, 5)).toBe(12);
  });

  it('calls update once and notifies once', () => {
    const store = new Subject();
    const update = jest.spyOn(glueOf(store), 'update');
    const { listener } = watch(store);

    store.add(1, 1);

    expect(update).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('binds this to the store instance', () => {
    const store = new Subject();

    store.add(1, 0);

    expect(store.count).toBe(1);
  });
});

describe('promise handling next to the throw handling', () => {
  it('does not throw synchronously for an async action that rejects', async () => {
    const store = new Subject();
    let promise: Promise<void> | undefined;

    expect(() => {
      promise = store.asyncThrow();
    }).not.toThrow();

    await expect(promise).rejects.toThrow('async');
  });

  it('notifies once right away and not again at settle because nothing changed', async () => {
    const store = new Subject();
    const { listener } = watch(store);

    const promise = store.asyncThrow();
    expect(listener).toHaveBeenCalledTimes(1);

    await expect(promise).rejects.toThrow('async');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('calls update twice for a rejected promise, once at call and once at settle', async () => {
    const store = new Subject();
    const update = jest.spyOn(glueOf(store), 'update');

    await expect(store.returnRejected()).rejects.toThrow('rejected');

    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not cause an unhandled rejection', async () => {
    const store = new Subject();

    await expect(store.returnRejected()).rejects.toThrow('rejected');
    await Promise.resolve();

    expect(store.count).toBe(1);
  });

  it('does not call then of a thenable that is not a Promise', () => {
    const store = new Subject();
    const then = jest.fn();
    const update = jest.spyOn(glueOf(store), 'update');

    store.returnThenable(then);

    expect(then).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('nested actions', () => {
  it('lets an outer action catch the inner throw and keep going', () => {
    const store = new Subject();
    const { listener, counts } = watch(store);

    expect(() => store.outerCatches()).not.toThrow();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(counts).toEqual([1, 1]);
    expect(glueOf(store).getSnapshot()).toMatchObject({
      count: 1,
      label: 'caught',
    });
  });

  it('propagates the inner error through the outer action', () => {
    const store = new Subject();
    const update = jest.spyOn(glueOf(store), 'update');
    const { listener } = watch(store);

    expect(() => store.outerPropagates()).toThrow('after change');

    expect(update).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('listener that throws', () => {
  it('replaces the original error with the listener error', () => {
    const store = new Subject();
    glueOf(store).subscribe(() => {
      throw new Error('listener failed');
    });

    expect(() => store.throwAfterChange()).toThrow('listener failed');
    expect(store.count).toBe(1);
  });

  it('skips the listeners registered after a throwing one', () => {
    const store = new Subject();
    const later = jest.fn();
    glueOf(store).subscribe(() => {
      throw new Error('listener failed');
    });
    glueOf(store).subscribe(later);

    expect(() => store.throwAfterChange()).toThrow('listener failed');

    expect(later).not.toHaveBeenCalled();
  });

  it('propagates the listener error after a normal return too', () => {
    const store = new Subject();
    glueOf(store).subscribe(() => {
      throw new Error('listener failed');
    });

    expect(() => store.add(1, 1)).toThrow('listener failed');
    expect(store.count).toBe(2);
  });
});

describe('action without a store', () => {
  class Plain {
    count = 0;

    @Action()
    fail() {
      this.count += 1;
      throw new Error('plain');
    }

    @Action()
    succeed() {
      this.count += 1;
    }
  }

  it('fails with a TypeError because there is no glue to update', () => {
    expect(() => new Plain().succeed()).toThrow(TypeError);
  });

  it('lets the missing glue error replace the original error', () => {
    expect(() => new Plain().fail()).toThrow(TypeError);
  });
});

describe('inheritance', () => {
  class Base {
    count = 0;

    @Action()
    fail() {
      this.count += 1;
      throw new Error('base');
    }
  }

  @Store()
  class Child extends Base {}

  it('notifies after an inherited action throws', () => {
    const store = new Child();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    expect(() => store.fail()).toThrow('base');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(glueOf(store).getSnapshot()).toMatchObject({ count: 1 });
  });
});

describe('React integration', () => {
  it('re-renders after a handler catches an action error', () => {
    const store = new Subject();
    const renders = jest.fn();

    function View() {
      const [{ count }] = useStore(store);
      renders();
      return (
        <button
          type="button"
          data-testid="button"
          onClick={() => {
            try {
              store.throwAfterChange();
            } catch {
              // The error is expected.
            }
          }}
        >
          {count}
        </button>
      );
    }

    render(<View />);
    expect(screen.getByTestId('button').textContent).toBe('0');
    renders.mockClear();

    fireEvent.click(screen.getByTestId('button'));

    expect(screen.getByTestId('button').textContent).toBe('1');
    expect(renders).toHaveBeenCalledTimes(1);
  });

  it('re-renders once per throwing click', () => {
    const store = new Subject();

    function View() {
      const [{ count, doubled }] = useStore(store);
      return (
        <p data-testid="text">
          {count}/{doubled}
        </p>
      );
    }

    render(<View />);

    act(() => {
      expect(() => store.throwAfterChange()).toThrow();
      expect(() => store.throwAfterChange()).toThrow();
    });

    expect(screen.getByTestId('text').textContent).toBe('2/4');
  });

  it('does not re-render when the action throws before any change', () => {
    const store = new Subject();
    const renders = jest.fn();

    function View() {
      const [{ count }] = useStore(store);
      renders();
      return <p>{count}</p>;
    }

    render(<View />);
    renders.mockClear();

    act(() => {
      expect(() => store.throwBeforeChange()).toThrow();
    });

    expect(renders).not.toHaveBeenCalled();
  });
});
