import React, { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ColorTheme, LogEntry } from '../types'

interface ActivitySectionProps {
  colors: ColorTheme
  logs: LogEntry[]
}

export const ActivitySection: React.FC<ActivitySectionProps> = ({
  colors,
  logs
}) => {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to top when new logs arrive (since newest are at top)
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const isNearTop = container.scrollTop < 50;

      // Only auto-scroll if user was already near the top or it's the first load
      if (isNearTop || container.scrollTop === 0) {
        container.scrollTop = 0;
      }
    }
  }, [logs]);
  return (
    <div className="p-8 h-full flex flex-col">
      <div
        className="rounded-lg flex-1 flex flex-col"
        style={{ backgroundColor: colors.bg.secondary }}
      >
        <div className="p-6 pb-4 flex-shrink-0">
          <div className="flex items-baseline gap-3">
            <h3
              className="text-lg font-semibold"
              style={{ color: colors.text.header }}
            >
              {t('activity.title')}
            </h3>
            <span className="text-sm" style={{ color: colors.text.muted }}>
              {t('activity.subtitle')}
            </span>
          </div>
        </div>
        <div className="flex-1 px-6 pb-6 min-h-0">
          <div
            className="rounded-lg relative"
            style={{ backgroundColor: colors.bg.primary, height: '100%' }}
          >
            <div ref={scrollContainerRef} className="absolute inset-0 overflow-y-auto px-4 pt-4 pb-6 scroll-smooth">
              <div className="space-y-2">
                {logs.length > 0 ? (
                  logs.slice(-200).toReversed().map((log, i) => {
                    // Handle both string and object log formats from Real-time Event System
                    const logText =
                      typeof log === "string"
                        ? log
                        : log?.message ||
                          log?.fullEntry ||
                          String(log);

                    // Parse log entry to determine type and styling
                    const isError =
                      logText.includes("ERROR") ||
                      logText.includes("❌") ||
                      logText.includes("Error:");
                    const isWarning =
                      logText.includes("WARN") ||
                      logText.includes("⚠️") ||
                      logText.includes("Warning:");
                    const isSuccess =
                      logText.includes("✅") ||
                      logText.includes("SUCCESS") ||
                      logText.includes("successfully");
                    const isMessage =
                      logText.includes("Inbound message") ||
                      logText.includes("Auto-replied");
                    const isDebug =
                      logText.includes("DEBUG") ||
                      logText.includes("🔍");

                    let iconColor = colors.text.muted;
                    let icon = "•";

                    if (isError) {
                      iconColor = "#ef4444"; // red
                      icon = "❌";
                    } else if (isWarning) {
                      iconColor = "#f59e0b"; // amber
                      icon = "⚠️";
                    } else if (isSuccess) {
                      iconColor = colors.accent.green;
                      icon = "✅";
                    } else if (isMessage) {
                      iconColor = colors.accent.brand;
                      icon = "📱";
                    } else if (isDebug) {
                      iconColor = colors.text.muted;
                      icon = "🔍";
                    }

                    return (
                      <div
                        key={i}
                        className="flex items-start space-x-3 py-1"
                      >
                        <span
                          className="text-sm mt-0.5 flex-shrink-0"
                          style={{ color: iconColor }}
                        >
                          {icon}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span
                            className={`text-sm break-all ${isDebug ? "opacity-70" : ""}`}
                            style={{
                              color: isError
                                ? "#fca5a5"
                                : isWarning
                                  ? "#fde68a"
                                  : isSuccess
                                    ? colors.accent.green
                                    : isMessage
                                      ? colors.accent.brand
                                      : colors.text.normal,
                            }}
                          >
                            {logText}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex items-center justify-center h-32">
                    <p
                      className="text-sm"
                      style={{ color: colors.text.muted }}
                    >
                      {t('activity.noActivity')}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}