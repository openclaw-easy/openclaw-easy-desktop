import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { CheckCircle, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface CompleteStepProps {
  onComplete: () => void;
  onBack: () => void;
}

export function CompleteStep({ onComplete, onBack }: CompleteStepProps) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <CheckCircle className="h-16 w-16 text-green-500" />
        </div>
        <CardTitle className="text-3xl">{t('onboarding.setupComplete')}</CardTitle>
        <CardDescription className="text-lg mt-4">
          {t('onboarding.assistantReady')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-lg space-y-4">
          <div className="flex items-center space-x-2">
            <Rocket className="h-6 w-6 text-green-600" />
            <h3 className="font-semibold text-lg">{t('onboarding.whatsNext')}</h3>
          </div>
          <ul className="space-y-2 text-sm">
            <li className="flex items-start space-x-2">
              <span className="text-green-600">1.</span>
              <span>{t('onboarding.openMessagingApp')}</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600">2.</span>
              <span>{t('onboarding.sendMessage')}</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600">3.</span>
              <span>{t('onboarding.startChattingAI')}</span>
            </li>
          </ul>
        </div>

        <div className="space-y-4">
          <h4 className="font-semibold">{t('onboarding.tryCommands')}</h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <code className="bg-gray-100 dark:bg-gray-800 p-2 rounded">
              "Hello, introduce yourself"
            </code>
            <code className="bg-gray-100 dark:bg-gray-800 p-2 rounded">
              "What can you help me with?"
            </code>
            <code className="bg-gray-100 dark:bg-gray-800 p-2 rounded">
              "Summarize this article..."
            </code>
            <code className="bg-gray-100 dark:bg-gray-800 p-2 rounded">
              "Remind me to..."
            </code>
          </div>
        </div>

        <div className="flex justify-between">
          <Button onClick={onBack} variant="outline">
            {t('common.back')}
          </Button>
          <Button onClick={onComplete} size="lg" className="px-8">
            {t('onboarding.openDashboard')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}