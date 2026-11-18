/* eslint-disable max-classes-per-file */
/* eslint-disable class-methods-use-this */

import { CACHE_PROPERTY_KEY, STORE_GLUE_PROPERTY_KEY } from './contants';
import { Action, Store } from './decorators';
import StoreGlue from './StoreGlue';
import {
  areEqual, getOwnPropertyDescriptor, getPrototypeOf,
} from './utils';

function glueOf(store: object): StoreGlue {
  return Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
}

describe('areEqual strictness', () => {
  it.each([
    ['null and undefined', { a: null }, { a: undefined }],
    ['0 and empty string', { a: 0 }, { a: '' }],
    ['0 and string 0', { a: 0 }, { a: '0' }],
    ['1 and string 1', { a: 1 }, { a: '1' }],
    ['false and 0', { a: false }, { a: 0 }],
    ['false and string false', { a: false }, { a: 'false' }],
    ['NaN and string NaN', { a: NaN }, { a: 'NaN' }],
    ['array and string', { a: [1] }, { a: '1' }],
  ])('treats %s as different', (_name, a, b) => {
    expect(areEqual(a, b)).toBe(false);
    expect(areEqual(b, a)).toBe(false);
  });

  it('treats equal references as equal', () => {
    const list: number[] = [];

    expect(areEqual({ a: list }, { a: list })).toBe(true);
  });

  it('treats equal but separate objects as different', () => {
    expect(areEqual({ a: [] }, { a: [] })).toBe(false);
  });

  it('sees an extra key whose value is undefined on the left', () => {
    expect(areEqual({ a: 1, b: undefined }, { a: 1 })).toBe(false);
  });

  it('sees an extra key whose value is undefined on the right', () => {
    expect(areEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  });

  it('sees a key that exists only on one side with an undefined value', () => {
    expect(areEqual({ a: undefined }, {})).toBe(false);
    expect(areEqual({}, { a: undefined })).toBe(false);
  });

  it('treats two empty objects as equal', () => {
    expect(areEqual({}, {})).toBe(true);
  });

  it('compares symbol keys too', () => {
    const key = Symbol('key');

    expect(areEqual({ [key]: 1 }, { [key]: 1 })).toBe(true);
    expect(areEqual({ [key]: 1 }, { [key]: 2 })).toBe(false);
    expect(areEqual({ [key]: 1 }, {})).toBe(false);
  });
});

describe('error messages', () => {
  it('names the missing prototype', () => {
    expect(() => getPrototypeOf(Object.create(null)))
      .toThrow('Cannot find prototype');
  });

  it('names the missing property', () => {
    expect(() => getOwnPropertyDescriptor({}, 'missing'))
      .toThrow('Property Not Found: missing');
  });

  it('names a missing symbol property', () => {
    expect(() => getOwnPropertyDescriptor({}, Symbol('lost')))
      .toThrow('Property Not Found: Symbol(lost)');
  });

  it('throws Error instances', () => {
    expect(() => getPrototypeOf(Object.create(null))).toThrow(Error);
    expect(() => getOwnPropertyDescriptor({}, 'a')).toThrow(Error);
  });
});

describe('initial snapshot of StoreGlue', () => {
  class Holder {
    a = 1;
  }

  class Empty {}

  it('is an empty object right after construction', () => {
    const glue = new StoreGlue(new Holder());

    expect(glue.getSnapshot()).toEqual({});
    expect(Object.keys(glue.getSnapshot())).toHaveLength(0);
  });

  it('is replaced by the first update', () => {
    const store = new Holder();
    const glue = new StoreGlue(store);
    const listener = jest.fn();
    glue.subscribe(listener);

    glue.update(store);

    expect(glue.getSnapshot()).toEqual({ a: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not notify for an object with no properties', () => {
    const store = new Empty();
    const glue = new StoreGlue(store);
    const listener = jest.fn();
    glue.subscribe(listener);

    glue.update(store);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('getter cache on the snapshot', () => {
  @Store()
  class Plain {
    count = 0;

    @Action()
    inc() {
      this.count += 1;
    }
  }

  @Store()
  class WithGetter {
    count = 0;

    get double() {
      return this.count * 2;
    }
  }

  it('does not attach a cache to a snapshot of a store without getters', () => {
    const store = new Plain();
    store.inc();

    expect(Reflect.has(glueOf(store).getSnapshot(), CACHE_PROPERTY_KEY))
      .toBe(false);
  });

  it('attaches a cache to a snapshot of a store with getters', () => {
    const store = new WithGetter();

    expect(Reflect.has(glueOf(store).getSnapshot(), CACHE_PROPERTY_KEY))
      .toBe(true);
  });

  it('does not copy the cache or the glue into the snapshot keys', () => {
    const store = new WithGetter();

    expect(Object.keys(glueOf(store).getSnapshot())).toEqual(['count']);
    expect(Reflect.ownKeys(glueOf(store).getSnapshot())).toEqual(['count']);
  });
});
