import { useState } from 'react';
import { WelcomeStep } from './WelcomeStep';
import { ApiKeyStep } from './ApiKeyStep';
import { ChannelSetupStep } from './ChannelSetupStep';
import { CompleteStep } from './CompleteStep';
import { Progress } from '../ui/progress';
import { useConfigStore } from '../../stores/configStore';

type WizardStep =
  | 'welcome'
  | 'api-key'
  | 'channel-setup'
  | 'complete';

interface SetupWizardProps {
  onComplete: () => void;
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<WizardStep>('welcome');
  const selectedTier = 'free'; // Always use free tier (BYOK)
  const { config, saveConfig } = useConfigStore();

  const steps: WizardStep[] = [
    'welcome',
    'api-key',
    'channel-setup',
    'complete',
  ];

  const currentStepIndex = steps.indexOf(currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const handleNext = () => {
    const nextIndex = currentStepIndex + 1;
    if (nextIndex < steps.length) {
      setCurrentStep(steps[nextIndex]);
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    if (prevIndex >= 0) {
      setCurrentStep(steps[prevIndex]);
    }
  };

  const handleComplete = async () => {
    // Save the configuration
    if (config) {
      await saveConfig(config);
    }
    onComplete();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-900 dark:to-gray-800">
      <div className="container mx-auto py-12 px-4">
        <div className="mb-8">
          <Progress value={progress} className="w-full max-w-2xl mx-auto" />
        </div>

        <div className="max-w-2xl mx-auto">
          {currentStep === 'welcome' && (
            <WelcomeStep onNext={handleNext} />
          )}

          {currentStep === 'api-key' && (
            <ApiKeyStep
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'channel-setup' && (
            <ChannelSetupStep
              onNext={handleNext}
              onBack={handleBack}
            />
          )}

          {currentStep === 'complete' && (
            <CompleteStep
              onComplete={handleComplete}
              onBack={handleBack}
            />
          )}
        </div>
      </div>
    </div>
  );
}