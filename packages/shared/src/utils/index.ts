// Utility functions

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const formatTokenCount = (tokens: number): string => {
  if (tokens < 1000) {return tokens.toString();}
  if (tokens < 1000000) {return `${(tokens / 1000).toFixed(1)}K`;}
  return `${(tokens / 1000000).toFixed(1)}M`;
};

export const calculateCost = (tokens: number, model: string): number => {
  // Cost per 1M tokens (blended input/output)
  const costs: Record<string, number> = {
    'claude-3-5-sonnet': 8,
    'claude-3-opus': 40,
    'claude-3-haiku': 0.7,
  };

  const costPer1M = costs[model] || costs['claude-3-5-sonnet'];
  return (tokens / 1000000) * costPer1M;
};

export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

export const generateSubscriptionToken = (userId: string, tier: string): string => {
  // This would be implemented properly with JWT in the backend
  return `mbe_${tier}_${userId}_${Date.now()}`;
};

export const isValidTelegramBotToken = (token: string): boolean => {
  // Telegram bot tokens follow format: 123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
  const telegramTokenRegex = /^\d+:[A-Za-z0-9_-]+$/;
  return telegramTokenRegex.test(token);
};

export const isValidDiscordBotToken = (token: string): boolean => {
  // Discord bot tokens are typically 59+ characters
  return token.length >= 59;
};

export const formatUptime = (seconds: number): string => {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {return `${days}d ${hours}h`;}
  if (hours > 0) {return `${hours}h ${minutes}m`;}
  return `${minutes}m`;
};