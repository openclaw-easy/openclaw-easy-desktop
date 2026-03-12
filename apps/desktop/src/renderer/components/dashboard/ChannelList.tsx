import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import {
  CheckCircle,
  Hash,
  MessageCircle,
  Plus,
  Send,
  Users,
  XCircle,
} from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

export function ChannelList() {
  const { config } = useConfigStore();

  const channels = [
    {
      id: "whatsapp",
      name: "WhatsApp",
      icon: MessageCircle,
      color: "bg-green-500",
      connected: config?.channels?.whatsapp || false,
    },
    {
      id: "telegram",
      name: "Telegram",
      icon: Send,
      color: "bg-blue-500",
      connected: config?.channels?.telegram || false,
    },
    {
      id: "discord",
      name: "Discord",
      icon: Users,
      color: "bg-indigo-500",
      connected: config?.channels?.discord || false,
    },
    {
      id: "slack",
      name: "Slack",
      icon: Hash,
      color: "bg-purple-500",
      connected: config?.channels?.slack || false,
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Connected Channels</span>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {channels.map((channel) => {
            const Icon = channel.icon;
            return (
              <div
                key={channel.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${channel.color}`}>
                    <Icon className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <p className="font-medium">{channel.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {channel.connected ? "Connected" : "Not connected"}
                    </p>
                  </div>
                </div>
                {channel.connected ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-gray-400" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}