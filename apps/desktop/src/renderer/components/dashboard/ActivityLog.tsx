import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { ScrollArea } from "../ui/scroll-area";
import { Terminal } from "lucide-react";

interface ActivityLogProps {
  logs: string[];
}

export function ActivityLog({ logs }: ActivityLogProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Terminal className="h-5 w-5" />
          <span>Activity Log</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-48 w-full rounded-md bg-gray-900 p-3">
          <div className="space-y-1">
            {logs.length > 0 ? (
              logs.map((log, index) => (
                <div key={index} className="text-xs font-mono text-gray-300">
                  {log}
                </div>
              ))
            ) : (
              <div className="text-xs font-mono text-gray-500">
                No activity yet. Start OpenClaw to see logs.
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}