import React from 'react';
import { ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
  icon: any;
  status?: string;
  category?: string;
}

interface ServerConfig {
  id: string;
  name: string;
  icon: string;
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

interface ChannelSidebarProps {
  colors: ColorScheme;
  selectedServer: string;
  activeChannel: string;
  channels: {
    [key: string]: ChannelInfo[];
  };
  servers: ServerConfig[];
  setActiveChannel: (channel: string) => void;
}

function ChannelButton({ channel, activeChannel, setActiveChannel, colors }: {
  channel: ChannelInfo;
  activeChannel: string;
  setActiveChannel: (id: string) => void;
  colors: ColorScheme;
}) {
  const isActive = activeChannel === channel.id;
  return (
    <button
      key={channel.id}
      onClick={() => setActiveChannel(channel.id)}
      className={`w-full px-2 py-1 mb-0.5 rounded flex items-center justify-between group transition-colors ${
        isActive ? 'bg-gray-600/40' : 'hover:bg-gray-600/20'
      }`}
    >
      <div className="flex items-center space-x-2">
        <channel.icon
          className="h-5 w-5"
          style={{ color: isActive ? colors.text.normal : colors.text.muted }}
        />
        <span
          className="text-sm"
          style={{ color: isActive ? colors.text.normal : colors.text.muted }}
        >
          {channel.name}
        </span>
      </div>
      {channel.status && (
        <div
          className={`h-2 w-2 rounded-full ${
            channel.status === 'connected'
              ? 'bg-green-500'
              : channel.status === 'pending'
                ? 'bg-yellow-500'
                : 'bg-gray-500'
          }`}
        />
      )}
    </button>
  );
}

function renderChannels(
  list: ChannelInfo[],
  activeChannel: string,
  setActiveChannel: (id: string) => void,
  colors: ColorScheme,
) {
  const hasCategories = list.some((c) => c.category);
  if (!hasCategories) {
    return list.map((channel) => (
      <ChannelButton
        key={channel.id}
        channel={channel}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
        colors={colors}
      />
    ));
  }

  // Render items in list order, showing a category header when it changes
  let lastCat = '';
  const elements: React.ReactNode[] = [];
  for (const channel of list) {
    const cat = channel.category || '';
    if (cat && cat !== lastCat) {
      elements.push(
        <div key={`cat-${cat}-${elements.length}`} className="mb-1 mt-3 first:mt-0">
          <p
            className="px-2 mb-1 text-xs font-semibold tracking-wider uppercase"
            style={{ color: colors.text.muted, opacity: 0.6 }}
          >
            {cat}
          </p>
        </div>
      );
      lastCat = cat;
    }
    elements.push(
      <ChannelButton
        key={channel.id}
        channel={channel}
        activeChannel={activeChannel}
        setActiveChannel={setActiveChannel}
        colors={colors}
      />
    );
  }
  return <>{elements}</>;
}

export function ChannelSidebar({
  colors,
  selectedServer,
  activeChannel,
  channels,
  servers,
  setActiveChannel,
}: ChannelSidebarProps) {
  const { t } = useTranslation();
  return (
    <div
      className="w-60 shrink-0 flex flex-col"
      style={{ backgroundColor: colors.bg.secondary }}
    >
      {/* Server Header */}
      <div
        className="h-12 px-4 flex items-center justify-between shadow-sm cursor-pointer hover:bg-gray-700/20"
        style={{ borderBottom: `1px solid ${colors.bg.tertiary}` }}
      >
        <h2 className="font-bold" style={{ color: colors.text.header }}>
          {servers.find((s) => s.id === selectedServer)?.name || t('nav.dashboard')}
        </h2>
        <ChevronDown
          className="h-4 w-4"
          style={{ color: colors.text.muted }}
        />
      </div>

      {/* Channel List */}
      <div className="flex-1 overflow-y-auto py-3">
        <div className="px-2">
          {renderChannels(channels[selectedServer] || [], activeChannel, setActiveChannel, colors)}
        </div>
      </div>
    </div>
  );
}
