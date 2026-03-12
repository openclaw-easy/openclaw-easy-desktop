import { useCallback, useEffect, useRef, useState } from 'react';

export interface AppStatus {
  isRunning: boolean;
  port?: number;
  uptime?: number;
  version?: string;
}

export function useAppBridge() {
  const [status, setStatus] = useState<AppStatus>({ isRunning: false });
  const [logs, setLogs] = useState<string[]>([]);
  const [isPollingEnabled, setIsPollingEnabled] = useState(true);

  // Exposed as state (consumed by components)
  const [isAutoRestarting, setIsAutoRestarting] = useState(false);

  // Internal tracking — refs to avoid stale closures in setInterval callback.
  // These are never read by external components, so no need for state.
  const lastKnownRunningRef = useRef(false);
  const autoRestartAttemptsRef = useRef(0);
  const autoRestartDisabledRef = useRef(false);
  const lastAutoRestartTimeRef = useRef(0);
  const lastActionTimeRef = useRef<{ start?: number; stop?: number }>({});
  const isAutoRestartingRef = useRef(false);

  useEffect(() => {
    // Check initial status
    window.electronAPI.getStatus().then(setStatus);

    // Load initial logs
    const loadLogs = async () => {
      try {
        if (window.electronAPI.getOpenClawLogs) {
          const initialLogs = await window.electronAPI.getOpenClawLogs();
          if (Array.isArray(initialLogs)) {
            setLogs(initialLogs.slice(-100));
          }
        }
      } catch (error) {
        console.error('Failed to load initial logs:', error);
      }
    };
    loadLogs();

    // Poll for status updates every 15 seconds with auto-restart on unexpected shutdown
    const statusInterval = setInterval(async () => {
      try {
        const newStatus = await window.electronAPI.getStatus();
        setStatus((prev) => {
          if (newStatus.isRunning !== prev.isRunning) {
            console.log('📊 [useAppBridge] Status update:', newStatus);
          }
          return newStatus;
        });

        const now = Date.now();
        const lastManualStop = lastActionTimeRef.current.stop || 0;
        const wasManualStop = now - lastManualStop < 10000;
        const timeSinceLastAutoRestart = now - lastAutoRestartTimeRef.current;
        const autoRestartCooldownMs = 5000;
        const maxAutoRestartAttempts = 3;

        // Reset retry counter if gateway has been running successfully for 30+ seconds
        if (newStatus.isRunning && autoRestartAttemptsRef.current > 0 && timeSinceLastAutoRestart > 30000) {
          console.log('🔄 [useAppBridge] Gateway stable, resetting auto-restart counter');
          autoRestartAttemptsRef.current = 0;
          autoRestartDisabledRef.current = false;
        }

        if (
          lastKnownRunningRef.current &&
          !newStatus.isRunning &&
          !isAutoRestartingRef.current &&
          !wasManualStop &&
          !autoRestartDisabledRef.current &&
          timeSinceLastAutoRestart > autoRestartCooldownMs
        ) {
          if (autoRestartAttemptsRef.current >= maxAutoRestartAttempts) {
            console.error(
              `❌ [useAppBridge] Gateway auto-restart disabled after ${maxAutoRestartAttempts} failed attempts. Please check logs and manually restart.`
            );
            autoRestartDisabledRef.current = true;
          } else {
            const attemptNum = autoRestartAttemptsRef.current + 1;
            console.warn(
              `⚠️ [useAppBridge] Gateway stopped unexpectedly - auto-restarting (attempt ${attemptNum}/${maxAutoRestartAttempts})...`
            );
            isAutoRestartingRef.current = true;
            setIsAutoRestarting(true);
            lastAutoRestartTimeRef.current = now;
            autoRestartAttemptsRef.current = attemptNum;

            try {
              await window.electronAPI.startOpenClaw();
              console.log(`✅ [useAppBridge] Gateway auto-restart attempt ${attemptNum} initiated`);
            } catch (error) {
              console.error(`❌ [useAppBridge] Gateway auto-restart attempt ${attemptNum} failed:`, error);
            } finally {
              isAutoRestartingRef.current = false;
              setIsAutoRestarting(false);
            }
          }
        }

        // Track running state for next iteration
        lastKnownRunningRef.current = newStatus.isRunning;
      } catch (error) {
        console.error('Failed to get status:', error);
      }
    }, 15000);

    // Only poll for logs if real-time updates aren't working
    const logInterval = setInterval(async () => {
      if (!isPollingEnabled) {return;}

      try {
        if (window.electronAPI.getOpenClawLogs) {
          const newLogs = await window.electronAPI.getOpenClawLogs();
          if (Array.isArray(newLogs)) {
            setLogs(prev => {
              const hasSignificantChange = newLogs.length !== prev.length ||
                (newLogs.length > 0 && prev.length > 0 &&
                 newLogs[newLogs.length - 1] !== prev[prev.length - 1]);

              if (hasSignificantChange) {
                return newLogs.slice(-100);
              }
              return prev;
            });
          }
        }
      } catch (error) {
        console.error('Failed to get logs:', error);
      }
    }, 10000);

    // Subscribe to real-time status updates from the process manager.
    // The IPC event carries a ProcessEvent ({ status, timestamp, previousStatus }),
    // not an AppStatus — convert so the rest of the hook sees a consistent shape.
    const unsubscribeStatus = window.electronAPI.onStatusUpdate((event: any) => {
      const isRunning = event?.status === 'running' || event?.isRunning === true;
      setStatus((prev) => ({ ...prev, isRunning }));
      // Also update the running ref immediately so auto-restart logic stays fresh
      lastKnownRunningRef.current = isRunning;
    });

    // Subscribe to log updates - disable polling when real-time works
    const unsubscribeLogs = window.electronAPI.onLogUpdate((log) => {
      setIsPollingEnabled(false);
      setLogs((prev) => [...prev, log].slice(-100));
    });

    return () => {
      clearInterval(statusInterval);
      clearInterval(logInterval);
      unsubscribeStatus();
      unsubscribeLogs();
    };
  }, [isPollingEnabled]);

  const startOpenClaw = useCallback(async () => {
    console.log('🔵 [useAppBridge] startOpenClaw called');
    const now = Date.now();
    const lastStart = lastActionTimeRef.current.start || 0;
    const cooldownMs = 5000;

    if (now - lastStart < cooldownMs) {
      console.log(`⏱️ [useAppBridge] Start action rate limited. Please wait ${Math.ceil((cooldownMs - (now - lastStart)) / 1000)} more seconds.`);
      return;
    }

    console.log('🔵 [useAppBridge] Cooldown passed, setting action time');
    lastActionTimeRef.current.start = now;

    // Reset auto-restart state on manual start
    autoRestartAttemptsRef.current = 0;
    autoRestartDisabledRef.current = false;
    console.log('🔄 [useAppBridge] Reset auto-restart state for manual start');

    try {
      console.log('🔵 [useAppBridge] Calling window.electronAPI.startOpenClaw()...');
      await window.electronAPI.startOpenClaw();
      console.log('✅ [useAppBridge] window.electronAPI.startOpenClaw() completed');
    } catch (error) {
      console.error('❌ [useAppBridge] Failed to start OpenClaw:', error);
    }
  }, []);

  const stopOpenClaw = useCallback(async () => {
    const now = Date.now();
    const lastStop = lastActionTimeRef.current.stop || 0;
    const cooldownMs = 3000;

    if (now - lastStop < cooldownMs) {
      console.log(`Stop action rate limited. Please wait ${Math.ceil((cooldownMs - (now - lastStop)) / 1000)} more seconds.`);
      return;
    }

    lastActionTimeRef.current.stop = now;

    try {
      await window.electronAPI.stopOpenClaw();
    } catch (error) {
      console.error('Failed to stop OpenClaw:', error);
    }
  }, []);

  return {
    status,
    logs,
    startOpenClaw,
    stopOpenClaw,
    isAutoRestarting,
    autoRestartDisabled: autoRestartDisabledRef.current,
    autoRestartAttempts: autoRestartAttemptsRef.current,
  };
}
