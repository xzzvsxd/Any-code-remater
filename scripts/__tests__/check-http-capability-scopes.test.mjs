import { describe, expect, test } from 'vitest';
import { validateHttpCapabilityScopes } from '../check-http-capability-scopes.mjs';

const baseCapability = (allow) => ({
  permissions: [
    'core:default',
    {
      identifier: 'http:default',
      allow,
    },
  ],
});

describe('validateHttpCapabilityScopes', () => {
  test('accepts object-form broad HTTP and HTTPS provider scopes', () => {
    const failures = validateHttpCapabilityScopes(
      baseCapability([{ url: 'https://*:*' }, { url: 'http://*:*' }]),
    );

    expect(failures).toEqual([]);
  });

  test('rejects URLPattern-hostile IPv6 literal scopes such as issue #187', () => {
    const failures = validateHttpCapabilityScopes(
      baseCapability([{ url: 'https://*:*' }, { url: 'http://[::1]:*' }]),
    );

    expect(failures).toContain(
      'http:default.allow[1].url must not contain bracketed IPv6 literals such as http://[::1]:*; Tauri URLPattern parsing rejects them',
    );
  });

  test('reports the original allow index when malformed entries precede IPv6 scopes', () => {
    const failures = validateHttpCapabilityScopes(
      baseCapability([{}, { url: 'https://*:*' }, { url: 'http://[::1]:*' }]),
    );

    expect(failures).toContain(
      'http:default.allow[2].url must not contain bracketed IPv6 literals such as http://[::1]:*; Tauri URLPattern parsing rejects them',
    );
  });

  test('rejects raw string scopes to keep capability entries unambiguous', () => {
    const failures = validateHttpCapabilityScopes(
      baseCapability(['https://*:*', { url: 'http://*:*' }]),
    );

    expect(failures).toContain(
      'http:default.allow[0] must be an object with a string url field, not a raw string',
    );
  });

  test('requires broad HTTP and HTTPS wildcard scopes for configurable providers', () => {
    const failures = validateHttpCapabilityScopes(
      baseCapability([{ url: 'https://*:*' }, { url: 'http://localhost:*' }]),
    );

    expect(failures).toContain(
      'http:default.allow must include { "url": "http://*:*" } so local/custom HTTP providers are not blocked',
    );
  });
});
