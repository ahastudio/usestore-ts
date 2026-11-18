/* eslint-disable no-param-reassign */
/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { STORE_GLUE_PROPERTY_KEY } from './contants';

import StoreGlue from './StoreGlue';

type Klass = { new (...args: any[]): {} };

export function Store() {
  return function decorator<T extends Klass>(klass: T) {
    return class extends klass {
      constructor(...args: any[]) {
        super(...args);
        const glue = new StoreGlue(this);
        Reflect.set(this, STORE_GLUE_PROPERTY_KEY, glue);
        glue.update(this);
      }
    };
  };
}

function updaterOf(store: object) {
  return () => Reflect.get(store, STORE_GLUE_PROPERTY_KEY).update(store);
}

function watch(returnValue: unknown, update: () => void) {
  if (returnValue instanceof Promise) {
    returnValue.then(update, update);
  }
  return returnValue;
}

function notify(store: object, run: () => unknown) {
  try {
    return watch(run(), updaterOf(store));
  } finally {
    updaterOf(store)();
  }
}

export function Action() {
  return (
    target: object,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    const method = descriptor.value;
    descriptor.value = function decorator(...args: unknown[]) {
      return notify(this, () => method.apply(this, args));
    };
  };
}
