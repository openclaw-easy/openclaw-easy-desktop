import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Progress } from "../ui/progress";
import { MessageSquare, TrendingUp, Zap } from "lucide-react";
import { useConfigStore } from "../../stores/configStore";

export function UsageStats() {
  const { config } = useConfigStore();

  // Mock data for demonstration
  const stats = {
    messagestoday: 127,
    tokensUsed: 245000,
    tokensLimit: 500000,
    estimatedCost: 2.45,
  };

  const tokenPercentage = (stats.tokensUsed / stats.tokensLimit) * 100;
  const isManaged = config?.apiProvider === "managed";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <TrendingUp className="h-5 w-5" />
          <span>Usage Stats</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <MessageSquare className="h-4 w-4 text-gray-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Messages Today
              </p>
            </div>
            <p className="text-2xl font-bold">{stats.messagestoday}</p>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <Zap className="h-4 w-4 text-gray-500" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Est. Cost
              </p>
            </div>
            <p className="text-2xl font-bold">
              {isManaged ? "Included" : `$${stats.estimatedCost.toFixed(2)}`}
            </p>
          </div>
        </div>

        {isManaged && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Token Usage</span>
              <span>
                {(stats.tokensUsed / 1000).toFixed(0)}K /{" "}
                {(stats.tokensLimit / 1000).toFixed(0)}K
              </span>
            </div>
            <Progress value={tokenPercentage} className="h-2" />
            <p className="text-xs text-gray-500">
              {(100 - tokenPercentage).toFixed(0)}% remaining this month
            </p>
          </div>
        )}

        <div className="pt-2 border-t">
          <div className="flex justify-between text-sm">
            <span className="text-gray-600 dark:text-gray-400">Plan</span>
            <span className="font-semibold capitalize">
              {config?.subscriptionTier || "Free"}
            </span>
          </div>
          {config?.subscriptionTier !== "free" && (
            <div className="flex justify-between text-sm mt-1">
              <span className="text-gray-600 dark:text-gray-400">Renewal</span>
              <span>Mar 2, 2026</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}