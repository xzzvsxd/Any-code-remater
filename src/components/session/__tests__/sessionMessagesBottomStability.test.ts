import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/session/SessionMessages.tsx', 'utf8');

describe('session messages bottom stability', () => {
  test('observed scroll content wraps the processing indicator and errors', () => {
    expect(source).toContain('data-session-scroll-content');
    expect(source.indexOf('data-session-scroll-content')).toBeLessThan(source.indexOf('<CliProcessingIndicator'));
    expect(source.indexOf('<CliProcessingIndicator')).toBeLessThan(source.indexOf('{error &&'));
  });
});
