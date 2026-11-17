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

function notify(store: object, returnValue: unknown) {
  const glue = Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
  const update = () => glue.update(store);
  update();
  if (returnValue instanceof Promise) {
    returnValue.then(update, update);
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
      const returnValue = method.apply(this, args);
      notify(this, returnValue);
      return returnValue;
    };
  };
}
