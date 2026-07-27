/**
 * The `activeSetup` vocabulary shared by useChannelManager (which sets it) and
 * ChannelSetupModals (which renders a body for it).
 *
 * These two sides drifted once already: Weixin was wired end-to-end through the
 * main process, preload, IPC and the hook, but ChannelSetupModals only had a
 * body for `activeSetup === 'WhatsApp'`. Starting Weixin setup therefore opened
 * a titled modal with an empty body — the QR was generated and stored in state,
 * but nothing rendered it, which looked exactly like "QR generation failed".
 *
 * Keeping the vocabulary here (with `isHandledSetupChannel` as the coverage
 * check) means a new channel that forgets its render branch fails a unit test
 * instead of shipping a blank modal.
 */

/** Channels that authenticate by scanning a QR. */
export const QR_LOGIN_CHANNELS = ['WhatsApp', 'Weixin'] as const;

/** Channels that authenticate by pasting credentials into a form. */
export const TOKEN_SETUP_CHANNELS = ['Telegram', 'Discord', 'Slack', 'Feishu', 'Line'] as const;

export type QrLoginChannel = (typeof QR_LOGIN_CHANNELS)[number];
export type TokenSetupChannel = (typeof TOKEN_SETUP_CHANNELS)[number];
export type SetupChannel = QrLoginChannel | TokenSetupChannel;

/** Every label `setActiveSetup` may be given. */
export const SETUP_CHANNELS: readonly SetupChannel[] = [
  ...QR_LOGIN_CHANNELS,
  ...TOKEN_SETUP_CHANNELS,
];

export function isQrLoginChannel(value: string | null): value is QrLoginChannel {
  return QR_LOGIN_CHANNELS.includes(value as QrLoginChannel);
}

/**
 * True when ChannelSetupModals has a body for this label. A `false` here is
 * what produces the empty-modal failure mode, so the modal renders an explicit
 * error rather than nothing.
 */
export function isHandledSetupChannel(value: string | null): value is SetupChannel {
  return SETUP_CHANNELS.includes(value as SetupChannel);
}
