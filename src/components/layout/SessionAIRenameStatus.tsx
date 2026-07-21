import React from 'react';
import { Wand2 } from 'lucide-react';
import { useTranslation } from '@/hooks/useTranslation';

export const SessionAIRenameStatus: React.FC = () => {
  const { t } = useTranslation();

  return (
    <span
      className="flex min-w-0 flex-1 items-center gap-1.5 text-[11px] leading-relaxed"
      aria-live="polite"
      aria-busy="true"
    >
      <Wand2
        aria-hidden="true"
        className="ai-rename-spinner h-3.5 w-3.5 flex-shrink-0 text-primary"
      />
      <span className="ai-rename-shimmer-text truncate font-medium">
        {t('workbench.ctx.aiRenaming')}
      </span>
    </span>
  );
};
