import { useState, useCallback, useEffect, useRef } from 'react';

export interface ChannelInfo {
  id: string;
  name: string;
  type: 'text';
  icon: any;
  status?: 'connected' | 'pending' | 'disconnected';
}

export interface SetupChannel {
  name: string;
  icon: string;
  desc: string;
  status: 'available' | 'coming_soon';
  difficulty: 'Easy' | 'Medium' | 'Hard';
  setupSteps: string[];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Operation timed out')), ms)
    ),
  ])
}

export const useChannelManager = () => {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [channels, setChannels] = useState({
    whatsapp: { id: 'whatsapp', name: 'whatsapp', type: 'text' as const, status: 'disconnected' as const },
    telegram: { id: 'telegram', name: 'telegram', type: 'text' as const, status: 'disconnected' as const },
    discord: { id: 'discord', name: 'discord', type: 'text' as const, status: 'disconnected' as const },
    slack: { id: 'slack', name: 'slack', type: 'text' as const, status: 'disconnected' as const },
    feishu: { id: 'feishu', name: 'feishu', type: 'text' as const, status: 'disconnected' as const },
    line: { id: 'line', name: 'line', type: 'text' as const, status: 'disconnected' as const },
  });

  const [setupChannels] = useState<SetupChannel[]>([
    {
      name: 'WhatsApp',
      icon: '📱',
      desc: 'Connect via QR code scan',
      status: 'available',
      difficulty: 'Easy',
      setupSteps: [
        'Open WhatsApp Web on your phone',
        'Scan the QR code below',
        'Wait for connection confirmation'
      ]
    },
    {
      name: 'Telegram',
      icon: '✈️',
      desc: 'Create a bot with @BotFather',
      status: 'available',
      difficulty: 'Medium',
      setupSteps: [
        'Open Telegram and find @BotFather',
        'Send /newbot command',
        'Follow instructions to create your bot',
        'Copy the bot token',
        'Paste token below and save'
      ]
    },
    {
      name: 'Discord',
      icon: '🎮',
      desc: 'Set up bot with developer portal',
      status: 'available',
      difficulty: 'Medium',
      setupSteps: [
        'Go to Discord Developer Portal',
        'Create new application',
        'Add bot to application',
        'Copy bot token',
        'Invite bot to your server'
      ]
    },
    {
      name: 'Slack',
      icon: '💬',
      desc: 'Connect via Bot & App tokens',
      status: 'available',
      difficulty: 'Medium',
      setupSteps: [
        'Go to api.slack.com/apps and create a new app',
        'Enable Socket Mode and create an App-level token (xapp-...)',
        'Add bot scopes and install app to your workspace',
        'Copy the Bot Token (xoxb-...) and App Token (xapp-...)',
        'Paste both tokens below and connect',
      ]
    }
  ]);

  const [activeSetup, setActiveSetup] = useState<string | null>(null);
  const [setupStep, setSetupStep] = useState(0);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrLoadingTimedOut, setQrLoadingTimedOut] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [isConnecting, setIsConnecting] = useState<Record<string, boolean>>({});
  const [isDisconnecting, setIsDisconnecting] = useState<Record<string, boolean>>({});
  const qrTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionPollingRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for WhatsApp connection status when QR code is displayed
  useEffect(() => {
    // Only poll when we have a QR code displayed and it's not an error/timeout/already connected state
    // QR code can be either ASCII art (contains █ or ▄) or a URL
    const isValidQR = qrCode && (
      qrCode.includes('█') ||
      qrCode.includes('▄') ||
      qrCode.startsWith('http')
    );

    const isErrorState = qrCode && (
      qrCode.includes('ERROR') ||
      qrCode.includes('FAILED') ||
      qrCode === 'ALREADY_CONNECTED' ||
      qrCode === 'SUCCESS' ||
      qrCode === 'QR_TIMEOUT'
    );

    if (isValidQR && !isErrorState && activeSetup === 'WhatsApp') {

      // Clear any existing polling interval
      if (connectionPollingRef.current) {
        clearInterval(connectionPollingRef.current);
      }


      // Check connection status every 2 seconds
      connectionPollingRef.current = setInterval(async () => {
        try {
          if (window.electronAPI?.checkWhatsAppStatus) {
            const statusResult = await window.electronAPI.checkWhatsAppStatus();

            if (statusResult.connected) {

              // Update channel status
              setChannels(prev => ({
                ...prev,
                whatsapp: { ...prev.whatsapp, status: 'connected' }
              }));

              // Close the modal and clean up
              setQrCode('SUCCESS');

              // Clear the polling interval
              if (connectionPollingRef.current) {
                clearInterval(connectionPollingRef.current);
                connectionPollingRef.current = null;
              }

              // Clear the timeout
              if (qrTimeoutRef.current) {
                clearTimeout(qrTimeoutRef.current);
                qrTimeoutRef.current = null;
              }

              // Close modal after a short delay to show success
              setTimeout(() => {
                setActiveSetup(null);
                setQrCode(null);
                setSetupStep(0);
                setQrLoadingTimedOut(false);
              }, 1500);
              return; // Stop checking once connected
            }
          }
        } catch (error) {
          // Silent error handling for connection polling
        }
      }, 2000);
    }

    // Cleanup function
    return () => {
      if (connectionPollingRef.current) {
        clearInterval(connectionPollingRef.current);
        connectionPollingRef.current = null;
      }
    };
  }, [qrCode, activeSetup]);

  // Check initial connection status for all channels on load
  useEffect(() => {
    const checkInitialStatus = async () => {
      // Run all checks in parallel for fast startup
      const [whatsappResult, telegramResult, discordResult, slackResult, feishuResult, lineResult] = await Promise.allSettled([
        window.electronAPI?.checkWhatsAppStatus ? withTimeout(window.electronAPI.checkWhatsAppStatus(), 10000) : Promise.reject(),
        window.electronAPI?.checkTelegramStatus ? withTimeout(window.electronAPI.checkTelegramStatus(), 10000) : Promise.reject(),
        window.electronAPI?.checkDiscordStatus ? withTimeout(window.electronAPI.checkDiscordStatus(), 10000) : Promise.reject(),
        window.electronAPI?.checkSlackStatus ? withTimeout(window.electronAPI.checkSlackStatus(), 10000) : Promise.reject(),
        window.electronAPI?.checkFeishuStatus ? withTimeout(window.electronAPI.checkFeishuStatus(), 10000) : Promise.reject(),
        window.electronAPI?.checkLineStatus ? withTimeout(window.electronAPI.checkLineStatus(), 10000) : Promise.reject(),
      ]);

      setChannels(prev => ({
        ...prev,
        whatsapp: {
          ...prev.whatsapp,
          status: whatsappResult.status === 'fulfilled' && whatsappResult.value?.connected
            ? 'connected' : 'disconnected'
        },
        telegram: {
          ...prev.telegram,
          status: telegramResult.status === 'fulfilled' && telegramResult.value?.connected
            ? 'connected' : 'disconnected'
        },
        discord: {
          ...prev.discord,
          status: discordResult.status === 'fulfilled' && discordResult.value?.connected
            ? 'connected' : 'disconnected'
        },
        slack: {
          ...prev.slack,
          status: slackResult.status === 'fulfilled' && slackResult.value?.connected
            ? 'connected' : 'disconnected'
        },
        feishu: {
          ...prev.feishu,
          status: feishuResult.status === 'fulfilled' && feishuResult.value?.connected
            ? 'connected' : 'disconnected'
        },
        line: {
          ...prev.line,
          status: lineResult.status === 'fulfilled' && lineResult.value?.connected
            ? 'connected' : 'disconnected'
        },
      }));
    };

    checkInitialStatus();
  }, []); // Run once on mount

  const startWhatsAppSetup = useCallback(async () => {
    setActiveSetup('WhatsApp');
    setSetupStep(0);
    setQrLoadingTimedOut(false);
    setQrCode(null);
    setIsCheckingStatus(true);

    // First check if WhatsApp is already connected
    try {
      if (window.electronAPI?.checkWhatsAppStatus) {
        const statusResult = await window.electronAPI.checkWhatsAppStatus();

        if (statusResult.connected) {
          setQrCode('ALREADY_CONNECTED');
          setIsCheckingStatus(false);
          return;
        }
      }

      setIsCheckingStatus(false);

      // Set a 1 minute timeout for QR generation
      qrTimeoutRef.current = setTimeout(() => {
        if (!qrCode) {
          setQrLoadingTimedOut(true);
          setQrCode('QR_TIMEOUT');
        }
      }, 60000);

      // Generate QR code for WhatsApp using real OpenClaw
    } catch (statusError) {
      setIsCheckingStatus(false);
    }

    try {
      if (window.electronAPI?.startWhatsAppSetup) {
        const qrResult = await window.electronAPI.startWhatsAppSetup();

        if (qrResult && !qrResult.includes('QR_GENERATION_FAILED') && !qrResult.includes('QR_ERROR')) {
          // Check if it's ASCII QR code (contains block characters)
          if (qrResult.includes('█') || qrResult.includes('▄')) {
            // Display ASCII QR code directly in a code block
            setQrCode(qrResult);
          } else {
            // Fallback for other formats
            setQrCode(qrResult);
          }
        } else {
          setQrCode('QR_GENERATION_FAILED');
        }

        // Clear timeout on successful QR generation
        if (qrTimeoutRef.current && qrResult && !qrResult.includes('QR_GENERATION_FAILED')) {
          clearTimeout(qrTimeoutRef.current);
          qrTimeoutRef.current = null;
        }
      } else {
        // Mock QR code for demo
        setQrCode('https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=WhatsApp-Demo-Connection-' + Date.now());
      }
    } catch (error) {
      setQrCode('QR_ERROR: ' + (error instanceof Error ? error.message : String(error)));
    }
  }, []);

  const startTelegramSetup = useCallback(() => {
    setActiveSetup('Telegram');
    setSetupStep(0);
  }, []);

  const startDiscordSetup = useCallback(() => {
    setActiveSetup('Discord');
    setSetupStep(0);
  }, []);

  const startSlackSetup = useCallback(() => {
    setActiveSetup('Slack');
    setSetupStep(0);
  }, []);

  const startFeishuSetup = useCallback(() => {
    setActiveSetup('Feishu');
    setSetupStep(0);
  }, []);

  const startLineSetup = useCallback(() => {
    setActiveSetup('Line');
    setSetupStep(0);
  }, []);

  const connectTelegramBot = useCallback(async (token: string) => {
    setIsConnecting(prev => ({ ...prev, telegram: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.connectTelegram) {
        const success = await withTimeout(window.electronAPI.connectTelegram(token), 15000);
        if (success) {
          setChannels(prev => ({
            ...prev,
            telegram: { ...prev.telegram, status: 'connected' }
          }));
          setActiveSetup(null);
          return true;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      console.error('Failed to connect Telegram:', error);
      setConnectionError(msg);
      return false;
    } finally {
      setIsConnecting(prev => ({ ...prev, telegram: false }));
    }
  }, []);

  const connectDiscordBot = useCallback(async (token: string, serverId: string) => {
    setIsConnecting(prev => ({ ...prev, discord: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.connectDiscord) {
        const success = await withTimeout(window.electronAPI.connectDiscord(token, serverId), 15000);
        if (success) {
          setChannels(prev => ({
            ...prev,
            discord: { ...prev.discord, status: 'connected' }
          }));
          setActiveSetup(null);
          return true;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      console.error('Failed to connect Discord:', error);
      setConnectionError(msg);
      return false;
    } finally {
      setIsConnecting(prev => ({ ...prev, discord: false }));
    }
  }, []);

  const connectSlackBot = useCallback(async (botToken: string, appToken: string) => {
    setIsConnecting(prev => ({ ...prev, slack: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.connectSlack) {
        const result = await withTimeout(window.electronAPI.connectSlack(botToken, appToken), 15000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            slack: { ...prev.slack, status: 'connected' }
          }));
          setActiveSetup(null);
          return true;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      console.error('Failed to connect Slack:', error);
      setConnectionError(msg);
      return false;
    } finally {
      setIsConnecting(prev => ({ ...prev, slack: false }));
    }
  }, []);

  const connectFeishuBot = useCallback(async (appId: string, appSecret: string, botName: string) => {
    setIsConnecting(prev => ({ ...prev, feishu: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.connectFeishu) {
        const result = await withTimeout(window.electronAPI.connectFeishu(appId, appSecret, botName || undefined), 15000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            feishu: { ...prev.feishu, status: 'connected' }
          }));
          setActiveSetup(null);
          return true;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      console.error('Failed to connect Feishu:', error);
      setConnectionError(msg);
      return false;
    } finally {
      setIsConnecting(prev => ({ ...prev, feishu: false }));
    }
  }, []);

  const connectLineBot = useCallback(async (channelAccessToken: string, channelSecret: string) => {
    setIsConnecting(prev => ({ ...prev, line: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.connectLine) {
        const result = await withTimeout(window.electronAPI.connectLine(channelAccessToken, channelSecret), 15000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            line: { ...prev.line, status: 'connected' }
          }));
          setActiveSetup(null);
          return true;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      console.error('Failed to connect LINE:', error);
      setConnectionError(msg);
      return false;
    } finally {
      setIsConnecting(prev => ({ ...prev, line: false }));
    }
  }, []);

  const cancelSetup = useCallback(() => {
    setActiveSetup(null);
    setSetupStep(0);
    setQrCode(null);
    setQrLoadingTimedOut(false);
    if (qrTimeoutRef.current) {
      clearTimeout(qrTimeoutRef.current);
      qrTimeoutRef.current = null;
    }
    // Also clear connection polling
    if (connectionPollingRef.current) {
      clearInterval(connectionPollingRef.current);
      connectionPollingRef.current = null;
    }
  }, []);

  const nextStep = useCallback(() => {
    setSetupStep(prev => prev + 1);
  }, []);

  const prevStep = useCallback(() => {
    setSetupStep(prev => Math.max(0, prev - 1));
  }, []);

  const disconnectWhatsApp = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, whatsapp: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectWhatsApp) {
        const result = await withTimeout(window.electronAPI.disconnectWhatsApp(), 10000);

        if (result.success) {
          // Update channels state to show disconnected
          setChannels(prev => ({
            ...prev,
            whatsapp: { ...prev.whatsapp, status: 'disconnected' }
          }));

          // Close the modal and reset QR state
          setActiveSetup(null);
          setQrCode(null);
          setIsCheckingStatus(false);
          setQrLoadingTimedOut(false);

          return true;
        } else {
          return false;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, whatsapp: false }));
    }
  }, []);

  const disconnectTelegram = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, telegram: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectTelegram) {
        const result = await withTimeout(window.electronAPI.disconnectTelegram(), 10000);

        if (result.success) {
          // Update channels state to show disconnected
          setChannels(prev => ({
            ...prev,
            telegram: { ...prev.telegram, status: 'disconnected' }
          }));

          return true;
        } else {
          return false;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, telegram: false }));
    }
  }, []);

  const disconnectDiscord = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, discord: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectDiscord) {
        const result = await withTimeout(window.electronAPI.disconnectDiscord(), 10000);

        if (result.success) {
          // Update channels state to show disconnected
          setChannels(prev => ({
            ...prev,
            discord: { ...prev.discord, status: 'disconnected' }
          }));

          return true;
        } else {
          return false;
        }
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, discord: false }));
    }
  }, []);

  const disconnectSlack = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, slack: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectSlack) {
        const result = await withTimeout(window.electronAPI.disconnectSlack(), 10000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            slack: { ...prev.slack, status: 'disconnected' }
          }));
          return true;
        }
        return false;
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, slack: false }));
    }
  }, []);

  const disconnectFeishu = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, feishu: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectFeishu) {
        const result = await withTimeout(window.electronAPI.disconnectFeishu(), 10000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            feishu: { ...prev.feishu, status: 'disconnected' }
          }));
          return true;
        }
        return false;
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, feishu: false }));
    }
  }, []);

  const disconnectLine = useCallback(async () => {
    setIsDisconnecting(prev => ({ ...prev, line: true }));
    setConnectionError(null);
    try {
      if (window.electronAPI?.disconnectLine) {
        const result = await withTimeout(window.electronAPI.disconnectLine(), 10000);
        if (result.success) {
          setChannels(prev => ({
            ...prev,
            line: { ...prev.line, status: 'disconnected' }
          }));
          return true;
        }
        return false;
      }
      return false;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      setConnectionError(msg);
      return false;
    } finally {
      setIsDisconnecting(prev => ({ ...prev, line: false }));
    }
  }, []);

  // Listen for WhatsApp connection status changes
  useEffect(() => {
    if (!window.electronAPI?.onWhatsAppStatusChange) {return;}

    const cleanup = window.electronAPI.onWhatsAppStatusChange((status: 'connected' | 'disconnected' | 'error') => {

      if (status === 'connected') {
        // Update channel status
        setChannels(prev => ({
          ...prev,
          whatsapp: { ...prev.whatsapp, status: 'connected' }
        }));

        // If setup modal is open, close it after a brief success message
        if (activeSetup === 'WhatsApp') {
          setQrCode('SUCCESS');
          setTimeout(() => {
            setActiveSetup(null);
            setSetupStep(0);
            setQrCode(null);
            setQrLoadingTimedOut(false);
          }, 2000);
        }
      } else if (status === 'error') {
        // Handle connection error
        if (activeSetup === 'WhatsApp') {
          setQrCode('CONNECTION_ERROR');
        }
      }
    });

    return cleanup;
  }, [activeSetup]);

  // Listen for Slack connection status changes
  useEffect(() => {
    if (!window.electronAPI?.onSlackStatusChange) {return;}

    const cleanup = window.electronAPI.onSlackStatusChange((status) => {
      if (status === 'connected') {
        setChannels(prev => ({
          ...prev,
          slack: { ...prev.slack, status: 'connected' }
        }));
        if (activeSetup === 'Slack') {
          setTimeout(() => {
            setActiveSetup(null);
            setSetupStep(0);
          }, 1500);
        }
      } else if (status === 'disconnected') {
        setChannels(prev => ({
          ...prev,
          slack: { ...prev.slack, status: 'disconnected' }
        }));
      }
    });

    return cleanup;
  }, [activeSetup]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (qrTimeoutRef.current) {
        clearTimeout(qrTimeoutRef.current);
      }
    };
  }, []);

  return {
    channels,
    connectionError,
    setupChannels,
    activeSetup,
    setupStep,
    qrCode,
    qrLoadingTimedOut,
    isCheckingStatus,
    isConnecting,
    isDisconnecting,
    startWhatsAppSetup,
    startTelegramSetup,
    startDiscordSetup,
    startSlackSetup,
    startFeishuSetup,
    startLineSetup,
    connectTelegramBot,
    connectDiscordBot,
    connectSlackBot,
    connectFeishuBot,
    connectLineBot,
    disconnectWhatsApp,
    disconnectTelegram,
    disconnectDiscord,
    disconnectSlack,
    disconnectFeishu,
    disconnectLine,
    cancelSetup,
    nextStep,
    prevStep
  };
};