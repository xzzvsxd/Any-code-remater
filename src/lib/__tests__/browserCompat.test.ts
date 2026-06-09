import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installBrowserCompatibilityPolyfills,
  safeRandomUUID,
} from "@/lib/browserCompat";

describe("safeRandomUUID", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses native crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "native-uuid",
    });

    expect(safeRandomUUID()).toBe("native-uuid");
  });

  it("falls back without throwing when crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.set([
          0x00, 0x11, 0x22, 0x33,
          0x44, 0x55, 0x66, 0x77,
          0x88, 0x99, 0xaa, 0xbb,
          0xcc, 0xdd, 0xee, 0xff,
        ]);
        return bytes;
      },
    });

    expect(() => safeRandomUUID()).not.toThrow();
    expect(safeRandomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });
});

describe("installBrowserCompatibilityPolyfills", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("installs a structuredClone fallback that handles undefined", () => {
    vi.stubGlobal("structuredClone", undefined);

    installBrowserCompatibilityPolyfills();

    expect(globalThis.structuredClone(undefined)).toBeUndefined();
  });

  it("installs a structuredClone fallback that preserves common object shapes", () => {
    vi.stubGlobal("structuredClone", undefined);

    installBrowserCompatibilityPolyfills();

    const original: {
      createdAt: Date;
      values: Map<string, Set<number>>;
      nested: { ok: boolean };
      self?: unknown;
    } = {
      createdAt: new Date("2026-06-09T00:00:00.000Z"),
      values: new Map([["items", new Set([1, 2, 3])]]),
      nested: { ok: true },
    };
    original.self = original;

    const cloned = globalThis.structuredClone(original);

    expect(cloned).not.toBe(original);
    expect(cloned.createdAt).toBeInstanceOf(Date);
    expect(cloned.createdAt.toISOString()).toBe("2026-06-09T00:00:00.000Z");
    expect(cloned.values.get("items")).toBeInstanceOf(Set);
    expect([...cloned.values.get("items")!]).toEqual([1, 2, 3]);
    expect(cloned.nested).toEqual({ ok: true });
    expect(cloned.nested).not.toBe(original.nested);
    expect(cloned.self).toBe(cloned);
  });
});
