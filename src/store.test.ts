import { STORE_GLUE_PROPERTY_KEY } from './contants';

import { Store, Action } from './decorators';

@Store()
class MyStore {
  firstName = '';

  lastName = '';

  get fullName() {
    return `${this.firstName} ${this.lastName}`;
  }

  @Action()
  changeFirstName(firstName: string) {
    this.firstName = firstName;
  }

  @Action()
  changeLastName(lastName: string) {
    this.lastName = lastName;
  }

  @Action()
  async loadFirstName(firstName: string) {
    await Promise.resolve();
    this.firstName = firstName;
  }

  @Action()
  async failToLoad() {
    await Promise.resolve();
    this.firstName = 'Failed';
    throw new Error('fail');
  }
}

const context = describe;

describe('action', () => {
  const firstName = 'Peter';
  const handleChange = jest.fn();

  let store: MyStore;

  beforeEach(() => {
    jest.clearAllMocks();

    store = new MyStore();

    const glue = Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
    glue.subscribe(handleChange);
  });

  context('with different state', () => {
    it('calls onChange handler', () => {
      store.changeFirstName(firstName);

      expect(store.firstName).toBe(firstName);

      expect(handleChange).toHaveBeenCalled();
    });
  });

  context('with same state', () => {
    it("doesn't calls onChange handler", () => {
      store.changeFirstName('');

      expect(handleChange).not.toHaveBeenCalled();
    });
  });
});

describe('snapshot', () => {
  let store: MyStore;

  beforeEach(() => {
    jest.clearAllMocks();

    store = new MyStore();
    store.changeFirstName('Peter');
    store.changeLastName('Parker');
  });

  function getSnapshot() {
    const glue = Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
    return glue.getSnapshot();
  }

  it('contains properties', () => {
    const snapshot = getSnapshot();

    expect(snapshot).toEqual({
      firstName: 'Peter',
      lastName: 'Parker',
    });
  });

  it('has getters that uses cache', () => {
    const snapshot = getSnapshot();

    expect(snapshot.fullName).toBe('Peter Parker');
  });
});

describe('async action', () => {
  const handleChange = jest.fn();

  let store: MyStore;

  beforeEach(() => {
    jest.clearAllMocks();

    store = new MyStore();

    const glue = Reflect.get(store, STORE_GLUE_PROPERTY_KEY);
    glue.subscribe(handleChange);
  });

  it('notifies listeners after the promise resolves', async () => {
    await store.loadFirstName('Peter');

    expect(handleChange).toHaveBeenCalled();
    expect(Reflect.get(store, STORE_GLUE_PROPERTY_KEY).getSnapshot())
      .toMatchObject({ firstName: 'Peter' });
  });

  it('notifies listeners even if the promise rejects', async () => {
    await expect(store.failToLoad()).rejects.toThrow('fail');

    expect(Reflect.get(store, STORE_GLUE_PROPERTY_KEY).getSnapshot())
      .toMatchObject({ firstName: 'Failed' });
  });
});
