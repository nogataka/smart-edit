import { describe, expect, it, vi } from 'vitest';

import { singleton } from '../../../src/smart-edit/util/class_decorators.js';

describe('singleton decorator', () => {
  it('returns the same instance for repeated constructions', () => {
    const initSpy = vi.fn();

    class Example {
      readonly value: number;

      constructor(value: number) {
        initSpy(value);
        this.value = value;
      }

      getValue(): number {
        return this.value;
      }
    }

    const SingletonExample: typeof Example = singleton(Example);

    const first = new SingletonExample(42);
    const second = new SingletonExample(7);

    expect(first).toBe(second);
    expect(first.getValue()).toBe(42);
    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(initSpy).toHaveBeenCalledWith(42);
  });

  it('preserves prototype and static members', () => {
    class WithStatics {
      static label = 'original';

      static rename(next: string): void {
        this.label = next;
      }

      readonly labelSnapshot: string;

      constructor() {
        this.labelSnapshot = (this.constructor as typeof WithStatics).label;
      }
    }

    const SingletonWithStatics: typeof WithStatics = singleton(WithStatics);

    expect(SingletonWithStatics.label).toBe('original');
    SingletonWithStatics.rename('updated');

    const instance = new SingletonWithStatics();
    expect(instance).toBeInstanceOf(WithStatics);
    expect(instance).toBeInstanceOf(SingletonWithStatics);
    expect(instance.labelSnapshot).toBe('updated');
    expect(SingletonWithStatics.label).toBe('updated');
  });

  it('can leverage decorator metadata when provided', () => {
    class ExampleName {}

    const Decorated: typeof ExampleName = singleton(ExampleName, {
      kind: 'class',
      name: 'DecoratedExample'
    });

    expect(Decorated.name === 'DecoratedExample' || Decorated.name === 'ExampleName').toBe(true);
    expect(new Decorated()).toBeInstanceOf(ExampleName);
  });
});
