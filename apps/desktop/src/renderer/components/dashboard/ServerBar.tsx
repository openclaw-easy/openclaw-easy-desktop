import React from 'react';
import { Home, Settings, Bot, MessageSquare, Cpu } from 'lucide-react';

interface ServerConfig {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
}

interface ColorScheme {
  bg: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    active: string;
  };
  text: {
    normal: string;
    muted: string;
    header: string;
    link: string;
    danger: string;
  };
  accent: {
    brand: string;
    green: string;
    yellow: string;
    red: string;
    purple: string;
    indigo: string;
  };
}

interface ServerBarProps {
  colors: ColorScheme;
  servers: ServerConfig[];
  selectedServer: string;
  activeChannel: string;
  setSelectedServer: (server: string) => void;
  setActiveChannel: (channel: string) => void;
  isMac: boolean;
}

export function ServerBar({
  colors,
  servers,
  selectedServer,
  activeChannel,
  setSelectedServer,
  setActiveChannel,
}: ServerBarProps) {
  const isSettingsActive = activeChannel === 'settings';
  return (
    <div
      className="w-[72px] shrink-0 flex flex-col items-center py-3 gap-2"
      style={{ backgroundColor: colors.bg.tertiary }}
    >
      {/* Home/Direct Messages */}
      <button
        onClick={() => {
          setSelectedServer('home');
          setActiveChannel('quick-actions');
        }}
        className="w-12 h-12 rounded-[16px] flex items-center justify-center transition-all hover:scale-110"
        style={{
          backgroundColor:
            selectedServer === 'home'
              ? colors.accent.brand
              : colors.bg.primary,
          color: colors.text.header,
        }}
      >
        <Home className="h-6 w-6" />
      </button>

      <div className="w-8 h-[2px] rounded-full bg-gray-700 mb-2" />

      {/* Server Icons */}
      {servers.map((server) => (
        <div key={server.id} className="relative group">
          <button
            onClick={() => {
              setSelectedServer(server.id);
              // Set default channel for each server
              if (server.id === 'main') {
                setActiveChannel('chat');
              } else if (server.id === 'channels') {
                setActiveChannel('setup');
              } else if (server.id === 'aiconfig') {
                setActiveChannel('aiconfig');
              }
            }}
            className="w-12 h-12 rounded-[16px] flex items-center justify-center transition-all hover:scale-110"
            style={{ backgroundColor: server.color, color: '#ffffff' }}
          >
            {server.icon}
          </button>

          {/* Server name tooltip */}
          <div className="absolute left-full ml-4 px-3 py-2 bg-black rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap">
            <span className="text-white text-sm">{server.name}</span>
            <div className="absolute left-0 top-1/2 -translate-x-1 -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-black" />
          </div>

          {/* Active indicator */}
          <div
            className={`absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 w-1 rounded-r transition-all ${
              selectedServer === server.id
                ? 'h-10'
                : 'h-2 opacity-0 group-hover:opacity-100'
            }`}
            style={{ backgroundColor: colors.text.header }}
          />
        </div>
      ))}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => {
          setSelectedServer('main');
          setActiveChannel('settings');
        }}
        className="w-12 h-12 rounded-[16px] flex items-center justify-center transition-all hover:scale-110"
        style={{
          backgroundColor: isSettingsActive ? colors.accent.brand : colors.bg.primary,
          color: isSettingsActive ? '#ffffff' : colors.text.muted,
        }}
      >
        <Settings className="h-5 w-5" />
      </button>
    </div>
  );
}
