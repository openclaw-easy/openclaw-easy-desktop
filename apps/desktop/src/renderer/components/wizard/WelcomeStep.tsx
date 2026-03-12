import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <Zap className="h-16 w-16 text-blue-600" />
        </div>
        <CardTitle className="text-3xl">{t('onboarding.welcomeTitle')}</CardTitle>
        <CardDescription className="text-lg mt-4">
          {t('onboarding.welcomeSubtitle')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center space-y-4">
          <p className="text-gray-600 dark:text-gray-400">
            {t('onboarding.setupIn5Minutes')}
          </p>
          <p className="text-gray-600 dark:text-gray-400">
            {t('onboarding.wizardGuide')}
          </p>
          <ul className="text-left max-w-md mx-auto space-y-2">
            <li className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span>{t('onboarding.choosingPlan')}</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span>{t('onboarding.settingUpAI')}</span>
            </li>
            <li className="flex items-center space-x-2">
              <span className="text-green-500">✓</span>
              <span>{t('onboarding.connectingChannels')}</span>
            </li>
          </ul>
        </div>
        <div className="flex justify-center">
          <Button onClick={onNext} size="lg" className="px-8">
            {t('onboarding.letsGetStarted')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}