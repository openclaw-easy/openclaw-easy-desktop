import * as React from 'react'

/**
 * Messaging-channel brand marks. Inline SVG so we ship zero extra assets
 * and the icons can scale cleanly. Each mark is rendered on its
 * channel's brand color tile (rounded-square, like an iOS app icon)
 * so a row of channels reads as recognizable badges rather than a
 * row of emoji.
 *
 * Sizing matches the AI provider icons in `provider-icons.tsx` — default
 * 36px since these appear as the leading element on a row card. Pass
 * `size` to scale.
 */

interface IconProps {
  size?: number
  className?: string
}

function IconShell({
  size = 36,
  bg,
  children,
  label,
  className,
}: {
  size: number
  bg: string
  children: React.ReactNode
  label: string
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
    >
      <rect width="100" height="100" rx="22" fill={bg} />
      {children}
    </svg>
  )
}

/** Telegram — paper plane on Telegram's #229ED9 blue. */
export function TelegramIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#229ED9" label="Telegram" className={className}>
      <path
        d="M22 49.5 78 27c2.6-1 4.7.7 4 3.4l-9 43.4c-.7 3.2-2.5 4-5.1 2.5L52 65l-7 6.7c-.8.8-1.5 1.5-3 1.5l1.1-15.4 28.5-25.8c1.2-1.1-.3-1.7-2-.6L33.6 47.6 21 43.5c-2.7-.9-2.7-2.7.5-4Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** WhatsApp — speech bubble + handset on the brand #25D366 green. */
export function WhatsAppIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#25D366" label="WhatsApp" className={className}>
      <path
        d="M50 17a33 33 0 0 0-28.4 49.7L18 83l16.7-3.5A33 33 0 1 0 50 17Zm0 60a27 27 0 0 1-13.7-3.7l-1-.6-9.9 2 2.1-9.6-.7-1A27 27 0 1 1 50 77Zm15.5-19.7c-.8-.4-5-2.4-5.7-2.7-.8-.3-1.4-.4-1.9.4-.6.8-2.2 2.7-2.7 3.3-.5.5-1 .6-1.8.2-.8-.4-3.5-1.3-6.6-4.2a25 25 0 0 1-4.7-5.8c-.5-.8 0-1.3.4-1.7.4-.4.8-1 1.3-1.5l.7-1c.3-.4.4-.8.6-1.4.2-.6.1-1 0-1.5-.2-.4-1.8-4.4-2.5-6-.7-1.6-1.4-1.4-1.9-1.4h-1.6c-.6 0-1.5.2-2.3 1-.8.9-3 3-3 7.3 0 4.3 3.1 8.4 3.5 9 .4.5 6 9.2 14.7 12.9 2 .9 3.7 1.4 5 1.8 2.1.7 4 .6 5.5.4 1.7-.3 5-2 5.7-4 .7-1.9.7-3.6.5-4-.2-.4-.8-.6-1.6-1Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** Discord — wordmark glyph on the brand #5865F2 indigo. */
export function DiscordIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#5865F2" label="Discord" className={className}>
      <path
        d="M75 32.5a48 48 0 0 0-12-3.7l-.5 1a45 45 0 0 0-13 0l-.5-1a48 48 0 0 0-12 3.7C29 44 26.7 55.3 27.8 66.4a48.7 48.7 0 0 0 14.5 7.4l3.2-4.5a31 31 0 0 1-5-2.4l1.2-1A34 34 0 0 0 50 70a34 34 0 0 0 8.3-4l1.2 1a31 31 0 0 1-5 2.3l3.2 4.6a48.6 48.6 0 0 0 14.5-7.4c1.4-12.9-2.3-24.1-7.2-34Zm-25.6 27c-2.9 0-5.2-2.7-5.2-6 0-3.3 2.3-6 5.2-6 3 0 5.2 2.7 5.2 6 0 3.3-2.3 6-5.2 6Zm19.2 0c-2.9 0-5.2-2.7-5.2-6 0-3.3 2.3-6 5.2-6s5.2 2.7 5.2 6c0 3.3-2.3 6-5.2 6Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** Slack — the four-color hash. Brand spec colors. */
export function SlackIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#FFFFFF" label="Slack" className={className}>
      <path d="M37 56.6a5.6 5.6 0 1 1-5.6-5.6H37v5.6Zm2.8 0a5.6 5.6 0 0 1 11.2 0v14a5.6 5.6 0 0 1-11.2 0v-14Z" fill="#E01E5A" />
      <path d="M45.4 34a5.6 5.6 0 1 1 5.6-5.6V34h-5.6Zm0 2.8a5.6 5.6 0 0 1 0 11.2h-14a5.6 5.6 0 1 1 0-11.2h14Z" fill="#36C5F0" />
      <path d="M68 39.8a5.6 5.6 0 1 1 5.6 5.6H68v-5.6Zm-2.8 0a5.6 5.6 0 0 1-11.2 0v-14a5.6 5.6 0 1 1 11.2 0v14Z" fill="#2EB67D" />
      <path d="M59.6 62.4a5.6 5.6 0 1 1-5.6 5.6v-5.6h5.6Zm0-2.8a5.6 5.6 0 0 1 0-11.2h14a5.6 5.6 0 1 1 0 11.2h-14Z" fill="#ECB22E" />
    </IconShell>
  )
}

/** Feishu / Lark — the soaring kite mark on the brand teal. */
export function FeishuIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#00B1B0" label="Feishu" className={className}>
      <path
        d="M30 30c4 0 14 2 22 8s14 16 18 32c-12-3-22-9-30-17s-13-17-10-23Zm5 32c4 0 11 2 17 7s10 13 12 23c-9-2-17-7-23-13s-9-13-6-17Zm38-2c2 8 2 16 0 24-7-3-12-8-13-15s4-9 13-9Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** LINE — capital "L" on the LINE green. */
export function LineIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#06C755" label="LINE" className={className}>
      <path
        d="M50 22c-19 0-34 12-34 27 0 13 11 24 26 27l-1 8c-.2 1 .8 1.6 1.6 1.1l9.5-6.4c-.6-.1.7 0 0 0a36 36 0 0 0 31-29c0-15-15-27-33-27ZM37 56h-7c-.6 0-1-.4-1-1v-13c0-.6.4-1 1-1s1 .4 1 1v12h6c.6 0 1 .4 1 1s-.4 1-1 1Zm6-1c0 .6-.4 1-1 1s-1-.4-1-1V42c0-.6.4-1 1-1s1 .4 1 1v13Zm15 0c0 .4-.3.8-.7 1-.4.1-.9 0-1.1-.3l-7.4-9.7v9c0 .6-.4 1-1 1s-1-.4-1-1V42c0-.4.3-.8.7-1 .4-.1.9 0 1.1.3l7.4 9.7v-9c0-.6.4-1 1-1s1 .4 1 1v13Zm14-12h-7v3h6c.6 0 1 .4 1 1s-.4 1-1 1h-6v3h7c.6 0 1 .4 1 1s-.4 1-1 1h-8c-.6 0-1-.4-1-1V42c0-.6.4-1 1-1h8c.6 0 1 .4 1 1s-.4 1-1 1Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** Weixin / WeChat — the twin speech bubbles on WeChat green. */
export function WeixinIcon({ size = 36, className }: IconProps) {
  return (
    <IconShell size={size} bg="#07C160" label="Weixin" className={className}>
      <path
        d="M41 24c-14 0-25 9-25 20 0 6 3 11 9 15l-2 8 9-5c3 1 6 1 9 1h2a17 17 0 0 1-1-6c0-12 12-21 26-21h2c-3-7-14-12-29-12Zm-8 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm17 0a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z"
        fill="#fff"
      />
      <path
        d="M84 57c0-9-9-16-20-16s-20 7-20 16 9 16 20 16c2 0 5 0 7-1l7 4-2-6c5-3 8-8 8-13Zm-26-3a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Zm13 0a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z"
        fill="#fff"
      />
    </IconShell>
  )
}

/** Lookup helper — returns the icon component for a known channel id, or null. */
export function getChannelIcon(channelKey: string): React.ComponentType<IconProps> | null {
  switch (channelKey) {
    case 'telegram':
      return TelegramIcon
    case 'whatsapp':
      return WhatsAppIcon
    case 'discord':
      return DiscordIcon
    case 'slack':
      return SlackIcon
    case 'feishu':
      return FeishuIcon
    case 'line':
      return LineIcon
    case 'weixin':
      return WeixinIcon
    default:
      return null
  }
}
