import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { AlertCircle, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../stores/configStore';

interface ApiKeyStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ApiKeyStep({ onNext, onBack }: ApiKeyStepProps) {
  const { t } = useTranslation();
  const [provider, setProvider] = useState<'anthropic' | 'openai'>('anthropic');
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState('');
  const { updateConfig } = useConfigStore();

  const handleValidate = async () => {
    setIsValidating(true);
    setError('');

    try {
      const isValid = await window.electronAPI.validateApiKey(provider, apiKey);

      if (isValid) {
        updateConfig({
          apiProvider: provider,
          apiKey,
          subscriptionTier: 'free',
        });
        onNext();
      } else {
        setError(t('onboarding.invalidApiKey'));
      }
    } catch (err) {
      setError(t('onboarding.failedValidateKey'));
    } finally {
      setIsValidating(false);
    }
  };

  const handleSkip = () => {
    // Skip API key setup - user can configure it later in Dashboard settings
    updateConfig({
      apiProvider: 'anthropic', // Default to Anthropic
      apiKey: '', // Empty API key
      subscriptionTier: 'free',
    });
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('onboarding.connectAIProvider')}</CardTitle>
        <CardDescription>
          {t('onboarding.connectOrSkip')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <Label>{t('onboarding.selectProvider')}</Label>
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => setProvider('anthropic')}
              className={`p-4 rounded-lg border-2 transition-colors ${
                provider === 'anthropic'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <h4 className="font-bold">Anthropic</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Claude</p>
            </button>
            <button
              onClick={() => setProvider('openai')}
              className={`p-4 rounded-lg border-2 transition-colors ${
                provider === 'openai'
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-700'
              }`}
            >
              <h4 className="font-bold">OpenAI</h4>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">GPT-4</p>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key">{t('onboarding.apiKey')}</Label>
          <Input
            id="api-key"
            type="password"
            placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'sk-...'}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>

        {error && (
          <div className="flex items-center space-x-2 text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg space-y-2">
          <p className="text-sm font-semibold">{t('onboarding.noApiKey')}</p>
          <div className="space-y-1">
            {provider === 'anthropic' ? (
              <a
                href="https://console.anthropic.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
              >
                <span>Get one at console.anthropic.com</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <a
                href="https://platform.openai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center space-x-1"
              >
                <span>Get one at platform.openai.com</span>
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('onboarding.upgradeToProIncluded')}
            </p>
          </div>
        </div>

        <div className="flex justify-between">
          <Button onClick={onBack} variant="outline">
            {t('common.back')}
          </Button>
          <div className="flex space-x-2">
            <Button onClick={handleSkip} variant="outline">
              {t('onboarding.skipForNow')}
            </Button>
            <Button
              onClick={handleValidate}
              disabled={!apiKey || isValidating}
            >
              {isValidating ? t('onboarding.validating') : t('onboarding.testAndContinue')}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}