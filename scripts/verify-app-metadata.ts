import assert from 'node:assert/strict';
import {
  getCopyrightYear,
  getReleaseApiUrl,
  getReleaseUrl,
  normalizeVersionTag,
} from '../src/lib/appMetadata.js';
import { getDisplayUpdateNotes, isPlaceholderUpdateNotes } from '../src/lib/updateReleaseNotes.js';

assert.equal(getCopyrightYear(new Date('2026-05-31T00:00:00Z')), 2026, 'copyright year should follow current year');
assert.equal(getCopyrightYear(new Date('2030-01-01T00:00:00Z')), 2030, 'copyright year should not be hard-coded');
assert.equal(normalizeVersionTag('5.28.11'), 'v5.28.11', 'plain versions should become release tags');
assert.equal(normalizeVersionTag('v5.28.11'), 'v5.28.11', 'existing release tags should be preserved');
assert.equal(
  getReleaseUrl('5.28.11'),
  'https://github.com/xzzvsxd/Any-code-remater/releases/tag/v5.28.11',
  'manual download should point to this fork release page',
);
assert.equal(
  getReleaseApiUrl('v5.28.11'),
  'https://api.github.com/repos/xzzvsxd/Any-code-remater/releases/tags/v5.28.11',
  'release note fetch should target the matching GitHub release API endpoint',
);

assert.equal(
  isPlaceholderUpdateNotes('See the full changelog at https://github.com/xzzvsxd/Any-code-remater/releases/tag/v5.28.11'),
  true,
  'latest.json changelog links are placeholders, not real release logs',
);
assert.equal(
  getDisplayUpdateNotes({
    updaterNotes: 'See the full changelog at https://github.com/xzzvsxd/Any-code-remater/releases/tag/v5.28.11',
    releaseNotes: '## ????\n\n- ?????????',
  }),
  '## ????\n\n- ?????????',
  'release body should replace latest.json placeholder notes',
);
assert.equal(
  getDisplayUpdateNotes({ updaterNotes: '', releaseNotes: null }),
  '?????????????????? Release ???',
  'update dialog should always have a visible notes fallback',
);

console.log('app metadata verification passed');
