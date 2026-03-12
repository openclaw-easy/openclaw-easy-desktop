import { useEffect, useState, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ColorTheme } from '../dashboard/types';

interface CliOnboardingWizardProps {
  onComplete: () => void;
  onCancel?: () => void;
  colors: ColorTheme;
}

export function CliOnboardingWizard({
  onComplete,
  onCancel,
  colors
}: CliOnboardingWizardProps) {
  const { t } = useTranslation();
  const [showTerminal, setShowTerminal] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isWaitingForOutput, setIsWaitingForOutput] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const terminalIdRef = useRef<string | null>(null);
  const hasStartedRef = useRef<boolean>(false);
  const listenerCleanupRef = useRef<(() => void) | null>(null);

  // Initialize xterm terminal
  useEffect(() => {
    if (showTerminal && terminalRef.current && !xtermRef.current) {
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#ffffff'
        }
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(terminalRef.current);
      fitAddon.fit();

      xtermRef.current = term;
      fitAddonRef.current = fitAddon;

      // Handle terminal input
      term.onData((data) => {
        if (terminalIdRef.current) {
          window.electronAPI.writeToTerminal(terminalIdRef.current, data);
        }
      });

      // Handle window resize
      const handleResize = () => {
        if (fitAddonRef.current) {
          fitAddonRef.current.fit();
          if (terminalIdRef.current && xtermRef.current) {
            window.electronAPI.resizeTerminal(
              terminalIdRef.current,
              xtermRef.current.cols,
              xtermRef.current.rows
            );
          }
        }
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        term.dispose();
      };
    }
  }, [showTerminal]);

  // Cleanup terminal process and listeners on unmount
  useEffect(() => {
    return () => {
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;
      if (terminalIdRef.current) {
        console.log('[CliOnboardingWizard] Cleaning up terminal process:', terminalIdRef.current);
        window.electronAPI.killTerminal(terminalIdRef.current);
      }
    };
  }, []);

  // Start the onboarding process
  const startOnboarding = async () => {
    setShowTerminal(true);
    setIsRunning(true);
    setError(null);
    setIsWaitingForOutput(true);

    // Wait for terminal to be initialized
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Clean up any existing listeners from a previous run (e.g. retry after error)
      listenerCleanupRef.current?.();
      listenerCleanupRef.current = null;

      // Use createOpenclawTerminal — main process resolves the embedded openclaw path
      // via __dirname, so this always hits our bundled instance, never a global install
      const result = await window.electronAPI.createOpenclawTerminal(['onboard']);
      terminalIdRef.current = result.terminalId;

      console.log('[CliOnboardingWizard] Terminal created:', result);

      // Listen for terminal output
      const removeDataListener = window.electronAPI.onTerminalData((terminalId, data) => {
        if (terminalId === terminalIdRef.current && xtermRef.current) {
          xtermRef.current.write(data);
          // Hide loading spinner on first output
          setIsWaitingForOutput(false);
        }
      });

      // Listen for terminal exit
      const removeExitListener = window.electronAPI.onTerminalExit((terminalId, exitCode) => {
        if (terminalId === terminalIdRef.current) {
          console.log('[CliOnboardingWizard] Terminal exited:', exitCode);
          setIsRunning(false);
          if (exitCode === 0) {
            setIsComplete(true);
          } else {
            setError(`Process exited with code ${exitCode}`);
          }
          // Self-clean listeners on exit
          listenerCleanupRef.current = null;
          removeDataListener();
          removeExitListener();
        }
      });

      // Store cleanup so the unmount effect can call it
      listenerCleanupRef.current = () => {
        removeDataListener();
        removeExitListener();
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('[CliOnboardingWizard] Failed to create terminal:', err);
      setError(errorMessage);
      setIsRunning(false);
      if (xtermRef.current) {
        xtermRef.current.write(`\r\n❌ Error: ${errorMessage}\r\n`);
      }
    }
  };

  // Handle button click to start onboarding
  const handleStartOnboarding = () => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      startOnboarding();
    }
  };

  // Show start button before terminal initializes
  if (!showTerminal) {
    return (
      <div className="h-full flex items-start justify-center pt-[15vh]" style={{ backgroundColor: colors.bg.primary }}>
        <div className="text-center space-y-6">
          <Rocket className="h-14 w-14 mx-auto mb-4" style={{ color: colors.text.muted }} />
          <h2 className="text-2xl font-bold" style={{ color: colors.text.header }}>
            {t('onboarding.title')}
          </h2>
          <p className="max-w-md" style={{ color: colors.text.muted }}>
            {t('onboarding.subtitle')}
          </p>
          <div className="flex justify-center pt-4">
            <Button
              onClick={handleStartOnboarding}
              size="lg"
              className="px-8 py-3 text-lg"
              style={{
                backgroundColor: colors.accent.green,
                color: '#FFFFFF',
              }}
            >
              {t('onboarding.letsGetStarted')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Terminal screen
  return (
    <div className="h-screen flex flex-col p-0" style={{ backgroundColor: colors.bg.primary }}>
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Interactive Terminal - Full Height */}
        <div
          ref={terminalRef}
          className="flex-1 min-h-0"
          style={{
            backgroundColor: '#1e1e1e',
            padding: '8px'
          }}
        />

        {/* Loading Spinner Overlay */}
        {isWaitingForOutput && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: '#1e1e1e' }}>
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
              <p className="text-sm text-gray-400">Starting OpenClaw onboarding...</p>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <Card className="mb-6 border-red-200 dark:border-red-800 flex-shrink-0">
            <CardContent className="pt-6">
              <div className="flex items-start space-x-3">
                <div className="text-red-500 text-xl">⚠️</div>
                <div>
                  <h3 className="font-semibold text-red-700 dark:text-red-400 mb-1">
                    Setup Error
                  </h3>
                  <p className="text-red-600 dark:text-red-300 text-sm">
                    {error}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Buttons */}
        <div className="flex-shrink-0 border-t border-gray-200 dark:border-gray-700 p-4 mt-6">
          <div className="flex justify-between items-center">
            {onCancel && (
              <Button onClick={onCancel} variant="outline">
                Cancel
              </Button>
            )}

            <div className="flex space-x-2 ml-auto">
              {isComplete && (
                <Button
                  onClick={onComplete}
                  size="lg"
                  className="px-8 py-3 text-lg bg-green-600 hover:bg-green-700"
                >
                  Done ✅
                </Button>
              )}

              {error && !isRunning && (
                <Button
                  onClick={() => {
                    setError(null);
                    setShowTerminal(false);
                    setTimeout(() => startOnboarding(), 100);
                  }}
                  size="lg"
                  className="px-8 py-3 text-lg"
                >
                  Retry 🔄
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
