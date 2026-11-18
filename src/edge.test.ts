/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */

import { STORE_GLUE_PROPERTY_KEY } from './contants';
import { Action, Store } from './decorators';
import StoreGlue from './StoreGlue';
import { areEqual } from './utils';

function glueOf(store: object): StoreGlue {
  return Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
}

const tag = Symbol('tag');

class TrackedPromise<T> extends Promise<T> {}

@Store()
class EdgeStore {
  items: string[] = [];

  count = 0;

  [tag] = 'first';

  @Action()
  changeThenThrow() {
    this.count += 1;
    throw new Error('after change');
  }

  @Action()
  pushInPlace(item: string) {
    this.items.push(item);
  }

  @Action()
  changeTag(value: string) {
    this[tag] = value;
  }

  @Action()
  subclassPromise() {
    this.count += 1;
    return new TrackedPromise<void>((resolve) => { resolve(); });
  }
}

describe('sync exception', () => {
  it('notifies about state changed before the throw', () => {
    const store = new EdgeStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    expect(() => store.changeThenThrow()).toThrow('after change');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('still changes the state before the throw', () => {
    const store = new EdgeStore();

    expect(() => store.changeThenThrow()).toThrow();

    expect(store.count).toBe(1);
  });
});

describe('in-place mutation', () => {
  // Known limitation: snapshot compares references.
  it('is not detected because the array reference is the same', () => {
    const store = new EdgeStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    store.pushInPlace('a');

    expect(store.items).toEqual(['a']);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('symbol keys', () => {
  it('detects changes of symbol keyed fields', () => {
    const store = new EdgeStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    store.changeTag('second');

    expect(listener).toHaveBeenCalledTimes(1);
    expect(glueOf(store).getSnapshot()).toMatchObject({
      'Symbol(tag)': 'second',
    });
  });
});

describe('Promise subclass', () => {
  it('is treated as a promise', async () => {
    const store = new EdgeStore();
    const listener = jest.fn();
    glueOf(store).subscribe(listener);

    await store.subclassPromise();

    expect(store.count).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('areEqual key sets', () => {
  it('is false when the second object has extra keys', () => {
    expect(areEqual({ x: 1 }, { x: 1, y: 2 })).toBe(false);
  });

  it('is false when the first object has extra keys', () => {
    expect(areEqual({ x: 1, y: 2 }, { x: 1 })).toBe(false);
  });

  it('is true for the same keys and values in another order', () => {
    expect(areEqual({ x: 1, y: 2 }, { y: 2, x: 1 })).toBe(true);
  });
});
