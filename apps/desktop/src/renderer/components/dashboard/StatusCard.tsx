import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Activity, Play, Square } from "lucide-react";
import { AppStatus } from "../../hooks/useAppBridge";

interface StatusCardProps {
  status: AppStatus;
  onStart: () => void;
  onStop: () => void;
}

export function StatusCard({ status, onStart, onStop }: StatusCardProps) {
  const formatUptime = (seconds?: number) => {
    if (!seconds) {return "0s";}
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) {return `${days}d ${hours}h`;}
    if (hours > 0) {return `${hours}h ${minutes}m`;}
    return `${minutes}m`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>System Status</span>
          <div className="flex items-center space-x-2">
            <Activity className="h-5 w-5" />
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                status.isRunning ? "bg-green-500 animate-pulse" : "bg-gray-400"
              }`}
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Status</p>
            <p className="text-lg font-semibold">
              {status.isRunning ? (
                <span className="text-green-600">Running</span>
              ) : (
                <span className="text-gray-500">Stopped</span>
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400">Uptime</p>
            <p className="text-lg font-semibold">
              {formatUptime(status.uptime)}
            </p>
          </div>
        </div>

        <div className="flex space-x-2">
          {status.isRunning ? (
            <Button onClick={onStop} variant="destructive" className="w-full">
              <Square className="h-4 w-4 mr-2" />
              Stop OpenClaw
            </Button>
          ) : (
            <Button onClick={onStart} className="w-full">
              <Play className="h-4 w-4 mr-2" />
              Start OpenClaw
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}