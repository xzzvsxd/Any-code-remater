import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CliProcessingIndicator } from '../CliProcessingIndicator';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

describe('CliProcessingIndicator', () => {
  it('shows explicit initialization state while waiting for a cancellable session id', () => {
    render(
      <CliProcessingIndicator
        isProcessing
        engineName="Claude"
        canCancel={false}
        statusLabel="Claude 正在初始化会话"
        statusHint="正在启动进程并等待 system:init，会话 ID 建立后即可安全取消。"
      />
    );

    expect(screen.getByText(/Claude 正在初始化会话/)).toBeInTheDocument();
    expect(screen.getByText(/等待 system:init/)).toBeInTheDocument();
  });
});
