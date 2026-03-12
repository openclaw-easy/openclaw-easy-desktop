import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { MessageCircle, Send, Users, Hash } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useConfigStore } from '../../stores/configStore';

interface ChannelSetupStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ChannelSetupStep({ onNext, onBack }: ChannelSetupStepProps) {
  const { t } = useTranslation();
  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(new Set());
  const { updateConfig } = useConfigStore();

  const channels = [
    {
      id: 'whatsapp',
      name: t('channels.whatsapp'),
      icon: MessageCircle,
      description: t('onboarding.connectViaQR'),
      color: 'bg-green-500',
    },
    {
      id: 'telegram',
      name: t('channels.telegram'),
      icon: Send,
      description: t('onboarding.createBot'),
      color: 'bg-blue-500',
    },
    {
      id: 'discord',
      name: t('channels.discord'),
      icon: Users,
      description: t('onboarding.addToServer'),
      color: 'bg-indigo-500',
    },
    {
      id: 'slack',
      name: t('channels.slack'),
      icon: Hash,
      description: t('onboarding.addToWorkspace'),
      color: 'bg-purple-500',
    },
  ];

  const toggleChannel = (channelId: string) => {
    const newSelection = new Set(selectedChannels);
    if (newSelection.has(channelId)) {
      newSelection.delete(channelId);
    } else {
      newSelection.add(channelId);
    }
    setSelectedChannels(newSelection);
  };

  const handleContinue = () => {
    const channelConfig = {
      whatsapp: selectedChannels.has('whatsapp'),
      telegram: selectedChannels.has('telegram'),
      discord: selectedChannels.has('discord'),
      slack: selectedChannels.has('slack'),
    };
    updateConfig({ channels: channelConfig });
    onNext();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('onboarding.connectMessaging')}</CardTitle>
        <CardDescription>
          {t('onboarding.selectChannelsForAI')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          {channels.map((channel) => {
            const Icon = channel.icon;
            const isSelected = selectedChannels.has(channel.id);

            return (
              <button
                key={channel.id}
                onClick={() => toggleChannel(channel.id)}
                className={`p-4 rounded-lg border-2 transition-all ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${channel.color}`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                  <div className="text-left">
                    <h4 className="font-semibold">{channel.name}</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {channel.description}
                    </p>
                  </div>
                </div>
                {isSelected && (
                  <div className="mt-3 text-sm text-blue-600 dark:text-blue-400">
                    {t('onboarding.selected')}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
          <p className="text-sm">
            <strong>Note:</strong> You can add or remove channels anytime from the dashboard.
            We recommend starting with WhatsApp or Telegram for the best experience.
          </p>
        </div>

        <div className="flex justify-between">
          <Button onClick={onBack} variant="outline">
            {t('common.back')}
          </Button>
          <div className="space-x-2">
            <Button onClick={onNext} variant="outline">
              {t('onboarding.skipForNow')}
            </Button>
            <Button
              onClick={handleContinue}
              disabled={selectedChannels.size === 0}
            >
              Continue with {selectedChannels.size} Channel{selectedChannels.size !== 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}