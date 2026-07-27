import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { LocalModelManager } from '../LocalModelManager';

interface ModelsSectionProps {
  colors: any;
}

export function ModelsSection({ colors }: ModelsSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      {/* Section header — sits inside the glass card; transparent so the
          card's blur shows through, with a subtle terracotta accent on
          the icon for brand consistency. */}
      <header className="px-8 pt-8 pb-4 flex items-baseline gap-3">
        <span
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg"
          style={{
            background: 'linear-gradient(135deg, rgba(239,75,88,0.20), rgba(0,143,135,0.12))',
            border: '1px solid rgba(239,75,88,0.24)',
          }}
        >
          <Sparkles className="h-4 w-4" style={{ color: colors.accent.brand }} />
        </span>
        <div>
          <h3 className="text-lg font-semibold tracking-tight" style={{ color: colors.text.header }}>
            {t('models.title')}
          </h3>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('models.subtitle')}
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <LocalModelManager colors={colors} />
      </div>
    </div>
  );
}
