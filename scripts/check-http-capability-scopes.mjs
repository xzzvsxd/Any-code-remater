import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const defaultCapabilityPath = resolve(repoRoot, 'src-tauri/capabilities/default.json');

const BRACKETED_IPV6_IN_HTTP_URL = /^https?:\/\/\[[^\]]+\]/i;
const REQUIRED_PROVIDER_SCOPES = ['https://*:*', 'http://*:*'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function findHttpDefaultPermission(capabilityConfig) {
  const permissions = capabilityConfig?.permissions;
  if (!Array.isArray(permissions)) {
    return undefined;
  }

  return permissions.find(
    (permission) =>
      isPlainObject(permission) && permission.identifier === 'http:default',
  );
}

export function validateHttpCapabilityScopes(capabilityConfig) {
  const failures = [];
  const httpDefault = findHttpDefaultPermission(capabilityConfig);

  if (!httpDefault) {
    return ['capabilities/default.json must define the http:default permission used by @tauri-apps/plugin-http'];
  }

  if (!Array.isArray(httpDefault.allow)) {
    return ['http:default.allow must be an array of { url } scope objects'];
  }

  const scopeUrls = [];

  httpDefault.allow.forEach((entry, index) => {
    if (typeof entry === 'string') {
      failures.push(
        `http:default.allow[${index}] must be an object with a string url field, not a raw string`,
      );
      scopeUrls.push({ index, url: entry });
      return;
    }

    if (!isPlainObject(entry) || typeof entry.url !== 'string') {
      failures.push(
        `http:default.allow[${index}] must be an object with a string url field`,
      );
      return;
    }

    scopeUrls.push({ index, url: entry.url });
  });

  scopeUrls.forEach(({ index, url }) => {
    if (BRACKETED_IPV6_IN_HTTP_URL.test(url)) {
      failures.push(
        `http:default.allow[${index}].url must not contain bracketed IPv6 literals such as http://[::1]:*; Tauri URLPattern parsing rejects them`,
      );
    }
  });

  const urls = scopeUrls.map(({ url }) => url);

  for (const requiredScope of REQUIRED_PROVIDER_SCOPES) {
    if (!urls.includes(requiredScope)) {
      failures.push(
        `http:default.allow must include { "url": "${requiredScope}" } so ${requiredScope.startsWith('http://') ? 'local/custom HTTP providers' : 'HTTPS providers'} are not blocked`,
      );
    }
  }

  return failures;
}

function main() {
  const capabilityConfig = JSON.parse(readFileSync(defaultCapabilityPath, 'utf8'));
  const failures = validateHttpCapabilityScopes(capabilityConfig);

  if (failures.length > 0) {
    console.error('[check-http-capability-scopes] failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('[check-http-capability-scopes] ok');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
