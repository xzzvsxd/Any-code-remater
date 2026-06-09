type CryptoLike = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  randomUUID?: () => string;
};

const getCrypto = (): CryptoLike | undefined => {
  const candidate = (globalThis as typeof globalThis & { crypto?: CryptoLike }).crypto;
  return candidate && typeof candidate === "object" ? candidate : undefined;
};

const bytesToUuidV4 = (bytes: Uint8Array): string => {
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
};

const fallbackRandomBytes = (): Uint8Array => {
  const bytes = new Uint8Array(16);
  const cryptoObject = getCrypto();

  if (typeof cryptoObject?.getRandomValues === "function") {
    try {
      return cryptoObject.getRandomValues(bytes);
    } catch {
      // Fall through to Math.random fallback below.
    }
  }

  let seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  for (let index = 0; index < bytes.length; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    bytes[index] = seed & 0xff;
  }
  return bytes;
};

export const safeRandomUUID = (): string => {
  const cryptoObject = getCrypto();

  if (typeof cryptoObject?.randomUUID === "function") {
    try {
      return cryptoObject.randomUUID();
    } catch {
      // Fall through to the local UUID v4 implementation.
    }
  }

  return bytesToUuidV4(fallbackRandomBytes());
};

export const createBrowserSafeId = (prefix: string): string => {
  return `${prefix}-${safeRandomUUID()}`;
};

const installObjectHasOwn = () => {
  const objectConstructor = Object as typeof Object & {
    hasOwn?: (object: unknown, property: PropertyKey) => boolean;
  };

  if (typeof objectConstructor.hasOwn === "function") return;

  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value(object: unknown, property: PropertyKey) {
      if (object === null || object === undefined) {
        throw new TypeError("Cannot convert undefined or null to object");
      }
      return Object.prototype.hasOwnProperty.call(Object(object), property);
    },
  });
};

const installArrayAt = () => {
  const arrayPrototype = Array.prototype as unknown as {
    at?: (index: number) => unknown;
  };

  if (typeof arrayPrototype.at === "function") return;

  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value(this: ArrayLike<unknown>, index: number) {
      if (this === null || this === undefined) {
        throw new TypeError("Array.prototype.at called on null or undefined");
      }

      const object = Object(this) as ArrayLike<unknown>;
      const length = Math.min(
        Math.max(Number(object.length) || 0, 0),
        Number.MAX_SAFE_INTEGER
      );
      const integerIndex = Number.isFinite(index) ? Math.trunc(index) : 0;
      const resolvedIndex = integerIndex >= 0 ? integerIndex : length + integerIndex;

      if (resolvedIndex < 0 || resolvedIndex >= length) {
        return undefined;
      }
      return object[resolvedIndex];
    },
  });
};

const installStructuredClone = () => {
  const globalObject = globalThis as typeof globalThis & {
    structuredClone?: <T>(value: T) => T;
  };

  if (typeof globalObject.structuredClone === "function") return;

  const cloneValue = <T>(value: T, seen = new WeakMap<object, unknown>()): T => {
    if (value === null || typeof value !== "object") {
      return value;
    }

    if (value instanceof Date) {
      return new Date(value.getTime()) as T;
    }

    if (value instanceof RegExp) {
      return new RegExp(value.source, value.flags) as T;
    }

    if (seen.has(value as object)) {
      return seen.get(value as object) as T;
    }

    if (Array.isArray(value)) {
      const output: unknown[] = [];
      seen.set(value, output);
      for (const item of value) {
        output.push(cloneValue(item, seen));
      }
      return output as T;
    }

    if (value instanceof Map) {
      const output = new Map();
      seen.set(value, output);
      for (const [key, mapValue] of value) {
        output.set(cloneValue(key, seen), cloneValue(mapValue, seen));
      }
      return output as T;
    }

    if (value instanceof Set) {
      const output = new Set();
      seen.set(value, output);
      for (const item of value) {
        output.add(cloneValue(item, seen));
      }
      return output as T;
    }

    const output: Record<PropertyKey, unknown> = {};
    seen.set(value as object, output);
    for (const key of Reflect.ownKeys(value as object)) {
      output[key] = cloneValue((value as Record<PropertyKey, unknown>)[key], seen);
    }
    return output as T;
  };

  Object.defineProperty(globalThis, "structuredClone", {
    configurable: true,
    writable: true,
    value<T>(value: T): T {
      return cloneValue(value);
    },
  });
};

const installCryptoRandomUUID = () => {
  const cryptoObject = getCrypto();
  if (!cryptoObject || typeof cryptoObject.randomUUID === "function") return;

  try {
    Object.defineProperty(cryptoObject, "randomUUID", {
      configurable: true,
      writable: true,
      value: safeRandomUUID,
    });
  } catch {
    // Some WebKit builds expose a non-extensible Crypto object. Direct callers use
    // safeRandomUUID; this best-effort polyfill is only for third-party packages.
  }
};

export const installBrowserCompatibilityPolyfills = (): void => {
  installObjectHasOwn();
  installArrayAt();
  installStructuredClone();
  installCryptoRandomUUID();
};
