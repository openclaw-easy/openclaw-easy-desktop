import React from 'react';
import { useTranslation } from 'react-i18next';
import { LocalModelManager } from '../LocalModelManager';

interface ModelsSectionProps {
  colors: any;
}

export function ModelsSection({ colors }: ModelsSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col h-full">
      <div className="p-8 pb-4">
        <div className="flex items-baseline gap-2">
          <h3 className="text-lg font-bold" style={{ color: colors.text.header }}>
            {t('models.title')}
          </h3>
          <p className="text-sm" style={{ color: colors.text.muted }}>
            {t('models.subtitle')}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-8">
        <LocalModelManager colors={colors} />
      </div>
    </div>
  );
}
