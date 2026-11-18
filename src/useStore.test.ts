/* eslint-disable max-classes-per-file */
/* eslint-disable no-console */

import { renderHook } from '@testing-library/react';

import useStore from './useStore';

import { Action, Store } from './decorators';

const context = describe;

@Store()
class MyStore {
  name = 'Peter';
}

describe('useStore', () => {
  context('with correct store', () => {
    it('returns the store and the state as snapshot', () => {
      const store = new MyStore();

      const { result } = renderHook(() => useStore(store));

      expect(result.current).toEqual([
        { name: 'Peter' },
        store,
      ]);
    });
  });

  context('with incorrect store', () => {
    let consoleError: (...args: unknown[]) => void;

    beforeEach(() => {
      consoleError = console.error;
      console.error = jest.fn();
    });

    afterEach(() => {
      console.error = consoleError;
    });

    it('throws error', () => {
      const store = {};

      expect(() => {
        renderHook(() => useStore(store));
      }).toThrow();
    });
  });
});

describe('useStore types', () => {
  @Store()
  class TypedStore {
    name = 'Peter';

    count = 0;

    @Action()
    rename(name: string) {
      this.name = name;
    }
  }

  // Never called: the checks run in `tsc --noEmit`.
  const typeChecks = (store: TypedStore) => {
    const [snapshot, same] = useStore(store);
    const { name, count }: { name: string; count: number } = snapshot;
    same.rename(name + count);
    // @ts-expect-error actions are not part of the snapshot
    snapshot.rename('x');
    // @ts-expect-error unknown properties are rejected
    snapshot.missing = 1;
    // @ts-expect-error name is a string
    const wrong: number = snapshot.name;
    // @ts-expect-error the store is read-only
    same.name = 'x';
    return wrong;
  };

  it('keeps types of the snapshot and the store', () => {
    expect(typeChecks).toBeInstanceOf(Function);
  });
});
