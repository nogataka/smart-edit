type ClassConstructor<T extends object = object> = abstract new (...args: unknown[]) => T;

interface DecoratorContextLike {
  kind?: string;
  name?: string | symbol;
}

export function singleton<T extends ClassConstructor>(
  constructor: T,
  context?: DecoratorContextLike
): T {
  return wrapAsSingleton(constructor, context);
}

function wrapAsSingleton<T extends ClassConstructor>(
  constructor: T,
  context?: DecoratorContextLike
): T {
  let instance: InstanceType<T> | undefined;

  let proxy: T;

  const handler: ProxyHandler<T> = {
    construct(target, args, newTarget) {
      if (instance && (newTarget === proxy || newTarget === target)) {
        return instance;
      }

      const actualTarget = newTarget === proxy ? target : newTarget;
      instance = Reflect.construct(target, args, actualTarget) as InstanceType<T>;
      return instance;
    },
    apply(target, thisArg, args) {
      instance ??= Reflect.construct(target, args, target) as InstanceType<T>;
      return instance;
    }
  };

  proxy = new Proxy(constructor, handler);

  const desiredName =
    typeof context?.name === 'string' && context.kind === 'class'
      ? context.name
      : constructor.name;

  if (desiredName && desiredName !== proxy.name) {
    try {
      Object.defineProperty(proxy, 'name', {
        value: desiredName,
        configurable: true
      });
    } catch {
      // プロキシ化したコンストラクタでは name を再定義できない場合があるが、機能に影響はないため無視する
    }
  }

  return proxy;
}
