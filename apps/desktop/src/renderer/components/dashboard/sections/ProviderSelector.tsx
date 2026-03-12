import React from 'react'
import { useTranslation } from 'react-i18next'
import { HardDrive, Check } from 'lucide-react'
import { useProviderStore, AIProvider } from '../../../stores/providerStore'

interface ColorScheme {
  bg: {
    primary: string
    secondary: string
    tertiary: string
    hover: string
  }
  text: {
    normal: string
    muted: string
    header: string
  }
  accent: {
    brand: string
    purple: string
  }
}

interface ProviderSelectorProps {
  colors: ColorScheme
  onAuthRequired: () => void
}

export function ProviderSelector({ colors }: ProviderSelectorProps) {
  const { t } = useTranslation()
  const { selectedProvider, setProvider } = useProviderStore()

  const providers: Array<{
    id: AIProvider
    name: string
    description: string
    icon: React.ReactNode
  }> = [
    {
      id: 'local',
      name: t('aiProvider.localOpenClaw', 'Local OpenClaw'),
      description: t('aiProvider.localOpenClawDesc', 'Use your own API keys with local OpenClaw server'),
      icon: <HardDrive className="h-5 w-5" />,
    },
  ]

  return (
    <div className="space-y-3">
      {providers.map((provider) => {
        const isSelected = selectedProvider === provider.id

        return (
          <button
            key={provider.id}
            onClick={() => setProvider(provider.id)}
            className={`w-full p-4 rounded-lg border-2 transition-all ${
              isSelected ? 'ring-2' : ''
            } cursor-pointer`}
            style={{
              backgroundColor: isSelected ? colors.bg.tertiary : colors.bg.secondary,
              borderColor: isSelected ? colors.accent.brand : 'transparent',
              ...(isSelected && { boxShadow: `0 0 0 2px ${colors.accent.brand}20` }),
            }}
          >
            <div className="flex items-start space-x-3">
              <div
                className="p-2 rounded"
                style={{
                  backgroundColor: colors.bg.primary,
                  color: isSelected ? colors.accent.brand : colors.text.muted,
                }}
              >
                {provider.icon}
              </div>

              <div className="flex-1 text-left">
                <div className="flex items-center space-x-2 mb-1">
                  <h5 className="font-semibold" style={{ color: colors.text.header }}>
                    {provider.name}
                  </h5>
                  {isSelected && (
                    <Check
                      className="h-4 w-4"
                      style={{ color: colors.accent.brand }}
                    />
                  )}
                </div>
                <p className="text-sm" style={{ color: colors.text.muted }}>
                  {provider.description}
                </p>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
