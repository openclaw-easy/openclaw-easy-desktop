import React from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare,
  Hash,
  Bot,
  Settings,
  Activity,
  Sparkles,
  ArrowRight,
  CheckCircle,
  ExternalLink,
  Zap
} from 'lucide-react'
import { ColorTheme } from '../types'

interface WelcomeSectionProps {
  colors: ColorTheme
  status: any
  setActiveChannel: (channel: string) => void
  setSelectedServer: (server: string) => void
}

export const WelcomeSection: React.FC<WelcomeSectionProps> = ({
  colors,
  status,
  setActiveChannel,
  setSelectedServer
}) => {
  const { t } = useTranslation()

  const quickStartSteps = [
    {
      title: t('welcome.startAssistant'),
      description: t('welcome.startAssistantDesc'),
      icon: Zap,
      completed: status.isRunning,
      action: () => {
        setSelectedServer("home")
      }
    },
    {
      title: t('welcome.connectChannels'),
      description: t('welcome.connectChannelsDesc'),
      icon: Hash,
      completed: false, // You can add real channel status here
      action: () => {
        setSelectedServer("channels")
        setActiveChannel("whatsapp")
      }
    },
    {
      title: t('welcome.configureModels'),
      description: t('welcome.configureModelsDesc'),
      icon: Bot,
      completed: false, // You can add real model config status here
      action: () => {
        setSelectedServer("aiconfig")
        setActiveChannel("aiconfig")
      }
    },
    {
      title: t('welcome.startChatting'),
      description: t('welcome.startChattingDesc'),
      icon: MessageSquare,
      completed: false,
      action: () => {
        setSelectedServer("main")
        setActiveChannel("assistant")
      }
    }
  ]

  const features = [
    {
      title: t('welcome.multiChannel'),
      description: t('welcome.multiChannelDesc'),
      icon: Hash,
      color: colors.accent.green
    },
    {
      title: t('welcome.localModels'),
      description: t('welcome.localModelsDesc'),
      icon: Bot,
      color: colors.accent.purple
    },
    {
      title: t('welcome.realTimeActivity'),
      description: t('welcome.realTimeActivityDesc'),
      icon: Activity,
      color: colors.accent.yellow
    },
    {
      title: t('welcome.easyConfig'),
      description: t('welcome.easyConfigDesc'),
      icon: Settings,
      color: colors.accent.brand
    }
  ]

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8">
        <div className="mb-8">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div
              className="p-4 rounded-full"
              style={{ backgroundColor: colors.accent.brand + '20' }}
            >
              <Sparkles
                className="h-12 w-12"
                style={{ color: colors.accent.brand }}
              />
            </div>
          </div>
          <h1
            className="text-4xl font-bold mb-4"
            style={{ color: colors.text.header }}
          >
            {t('welcome.heroTitle')} 🎉
          </h1>
          <p
            className="text-xl mb-6 max-w-2xl mx-auto"
            style={{ color: colors.text.muted }}
          >
            {t('welcome.heroText')}
          </p>

          <button
            onClick={() => {
              setSelectedServer("home")
            }}
            className="px-8 py-3 rounded-lg font-semibold transition-colors inline-flex items-center gap-2"
            style={{
              backgroundColor: colors.accent.brand,
              color: "white",
            }}
          >
            <Zap className="h-5 w-5" />
            {t('welcome.goToControl')}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Quick Start Guide */}
        <div
          className="rounded-lg p-6 mb-8"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h2
            className="text-2xl font-bold mb-6 flex items-center gap-2"
            style={{ color: colors.text.header }}
          >
            <CheckCircle className="h-6 w-6" style={{ color: colors.accent.green }} />
            Quick Start Guide
          </h2>

          <div className="space-y-4">
            {quickStartSteps.map((step, index) => (
              <div
                key={index}
                onClick={step.action}
                className="flex items-center gap-4 p-4 rounded-lg transition-colors cursor-pointer hover:scale-[1.02]"
                style={{
                  backgroundColor: colors.bg.tertiary,
                  border: `1px solid ${step.completed ? colors.accent.green : colors.bg.primary}`
                }}
              >
                <div
                  className={`p-2 rounded-full ${step.completed ? 'bg-green-500/20' : ''}`}
                  style={{
                    backgroundColor: step.completed ? 'rgba(34, 197, 94, 0.2)' : colors.bg.primary
                  }}
                >
                  <step.icon
                    className="h-5 w-5"
                    style={{
                      color: step.completed ? colors.accent.green : colors.text.muted
                    }}
                  />
                </div>
                <div className="flex-1">
                  <h3
                    className="font-semibold mb-1"
                    style={{ color: colors.text.header }}
                  >
                    {step.title}
                  </h3>
                  <p
                    className="text-sm"
                    style={{ color: colors.text.muted }}
                  >
                    {step.description}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {step.completed && (
                    <CheckCircle
                      className="h-5 w-5"
                      style={{ color: colors.accent.green }}
                    />
                  )}
                  <ArrowRight
                    className="h-4 w-4"
                    style={{ color: colors.text.muted }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Features Overview */}
        <div className="mb-8">
          <h2
            className="text-2xl font-bold mb-6"
            style={{ color: colors.text.header }}
          >
            What You Can Do
          </h2>

          <div className="grid grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <div
                key={index}
                className="rounded-lg p-6 transition-transform hover:scale-105"
                style={{ backgroundColor: colors.bg.secondary }}
              >
                <feature.icon
                  className="h-8 w-8 mb-4"
                  style={{ color: feature.color }}
                />
                <h3
                  className="text-lg font-semibold mb-2"
                  style={{ color: colors.text.header }}
                >
                  {feature.title}
                </h3>
                <p
                  className="text-sm"
                  style={{ color: colors.text.muted }}
                >
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Help & Resources */}
        <div
          className="rounded-lg p-6"
          style={{ backgroundColor: colors.bg.secondary }}
        >
          <h2
            className="text-xl font-bold mb-4 flex items-center gap-2"
            style={{ color: colors.text.header }}
          >
            <ExternalLink className="h-5 w-5" />
            Help & Resources
          </h2>

          <div className="grid grid-cols-3 gap-4">
            <button
              className="p-4 rounded-lg text-left transition-colors"
              style={{ backgroundColor: colors.bg.tertiary }}
              onClick={() => {
                setSelectedServer("main")
                setActiveChannel("activity")
              }}
            >
              <Activity className="h-5 w-5 mb-2" style={{ color: colors.accent.yellow }} />
              <div className="font-medium mb-1" style={{ color: colors.text.header }}>
                View Activity Log
              </div>
              <div className="text-sm" style={{ color: colors.text.muted }}>
                Monitor system activity
              </div>
            </button>

            <button
              className="p-4 rounded-lg text-left transition-colors"
              style={{ backgroundColor: colors.bg.tertiary }}
              onClick={() => {
                setSelectedServer("aiconfig")
                setActiveChannel("doctor")
              }}
            >
              <Settings className="h-5 w-5 mb-2" style={{ color: colors.accent.purple }} />
              <div className="font-medium mb-1" style={{ color: colors.text.header }}>
                System Doctor
              </div>
              <div className="text-sm" style={{ color: colors.text.muted }}>
                Diagnose and fix issues
              </div>
            </button>

            <button
              className="p-4 rounded-lg text-left transition-colors"
              style={{ backgroundColor: colors.bg.tertiary }}
              onClick={() => {
                setSelectedServer("aiconfig")
                setActiveChannel("skills")
              }}
            >
              <Sparkles className="h-5 w-5 mb-2" style={{ color: colors.accent.brand }} />
              <div className="font-medium mb-1" style={{ color: colors.text.header }}>
                Manage Skills
              </div>
              <div className="text-sm" style={{ color: colors.text.muted }}>
                Add AI capabilities
              </div>
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}