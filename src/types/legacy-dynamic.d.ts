export {};

declare global {
  /**
   * Legacy dynamic payload escape hatch.
   *
   * This keeps lint output free of scattered inline `any` while making every
   * remaining untyped boundary grep-able as `LegacyAny`. It should only be used
   * for third-party CLI/IPC/widget payloads that still need schema tightening.
   */
  type LegacyAny = any;
}
