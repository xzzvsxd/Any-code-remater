import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { CompactLifecycleMessage } from '../CompactLifecycleMessage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('CompactLifecycleMessage', () => {
  test('renders completed native metrics as a full-width timeline divider', () => {
    const html = renderToStaticMarkup(
      <CompactLifecycleMessage
        lifecycle={{
          phase: 'completed',
          trigger: 'auto',
          beforeTokens: 165_132,
          afterTokens: 42_000,
          durationMs: 1_840,
        }}
      />,
    );

    expect(html).toContain('data-compact-lifecycle="completed"');
    expect(html).toContain('165.1K');
    expect(html).toContain('42.0K');
    expect(html).toContain('123.1K');
    expect(html).toContain('75%');
    expect(html).toContain('1.84s');
    expect(html).not.toContain('rounded-lg');
  });

  test('renders running state with reduced-motion animation handling', () => {
    const html = renderToStaticMarkup(
      <CompactLifecycleMessage lifecycle={{ phase: 'running', trigger: 'manual' }} />,
    );

    expect(html).toContain('data-compact-lifecycle="running"');
    expect(html).toContain('animate-spin');
    expect(html).toContain('motion-reduce:animate-none');
  });
});
