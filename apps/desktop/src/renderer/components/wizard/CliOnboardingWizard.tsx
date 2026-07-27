import { useEffect, useState, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ColorTheme } from '../dashboard/types';
import { useThemeStore } from '../../stores/themeStore';
import { getXtermTheme } from '../../lib/xtermTheme';

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
  const resolvedTheme = useThemeStore((s) => s.resolved);
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
        fontFamily: '"SF Mono", "Fira Code", "JetBrains Mono", Menlo, Monaco, "Courier New", monospace',
        theme: getXtermTheme(resolvedTheme),
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
        // Null the refs after dispose — otherwise the `!xtermRef.current` guard
        // above stays false on Retry, so no new terminal is created and the
        // onData handler writes into the disposed instance.
        xtermRef.current = null;
        fitAddonRef.current = null;
      };
    }
  }, [showTerminal]);

  // Live-update xterm theme when the app's light/dark mode flips while
  // the terminal is already mounted. xterm exposes `term.options.theme`
  // as a runtime setter — no re-render needed.
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.theme = getXtermTheme(resolvedTheme);
    }
  }, [resolvedTheme]);

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
                backgroundColor: colors.button.primary,
                color: colors.button.primaryFg,
              }}
            >
              {t('onboarding.letsGetStarted')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Match the xterm theme background so the container (visible
  // BEFORE xterm initialises its canvas, ~2s) doesn't flash as a
  // black slab against the rest of the themed UI.
  const xtermBg = resolvedTheme === 'dark' ? '#0a0f1a' : '#fbf6ec';
  const xtermFg = resolvedTheme === 'dark' ? '#e8e4df' : '#2d2b28';

  // Terminal screen
  return (
    <div className="h-screen flex flex-col p-0" style={{ backgroundColor: colors.bg.primary }}>
      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* Interactive Terminal - Full Height */}
        <div
          ref={terminalRef}
          className="flex-1 min-h-0"
          style={{
            backgroundColor: xtermBg,
            padding: '8px',
          }}
        />

        {/* Loading Spinner Overlay */}
        {isWaitingForOutput && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: xtermBg }}>
            <div className="text-center">
              <div
                className="animate-spin rounded-full h-12 w-12 border-b-2 mx-auto mb-4"
                style={{ borderBottomColor: 'rgb(var(--glow-color))' }}
              />
              <p className="text-sm" style={{ color: xtermFg, opacity: 0.7 }}>
                Starting OpenClaw onboarding...
              </p>
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
