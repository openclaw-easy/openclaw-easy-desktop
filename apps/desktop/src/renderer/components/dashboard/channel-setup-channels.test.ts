import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  QR_LOGIN_CHANNELS,
  SETUP_CHANNELS,
  TOKEN_SETUP_CHANNELS,
  isHandledSetupChannel,
  isQrLoginChannel,
} from './channel-setup-channels';

/**
 * Regression cover for the empty-setup-modal bug: Weixin was fully wired
 * through the main process, preload, IPC and useChannelManager, but
 * ChannelSetupModals had no body for `activeSetup === 'Weixin'`, so starting
 * setup opened a titled modal with nothing in it and the generated QR was
 * never shown.
 */
describe('channel setup vocabulary', () => {
  it('treats Weixin as a QR-login channel', () => {
    expect(isQrLoginChannel('Weixin')).toBe(true);
    expect(isQrLoginChannel('WhatsApp')).toBe(true);
    expect(isQrLoginChannel('Telegram')).toBe(false);
    expect(isQrLoginChannel(null)).toBe(false);
  });

  it('handles every label it declares, and nothing else', () => {
    for (const channel of SETUP_CHANNELS) {
      expect(isHandledSetupChannel(channel)).toBe(true);
    }
    expect(isHandledSetupChannel('WeCom')).toBe(false);
    expect(isHandledSetupChannel(null)).toBe(false);
  });

  it('keeps the QR and token families disjoint', () => {
    const overlap = QR_LOGIN_CHANNELS.filter((c) =>
      (TOKEN_SETUP_CHANNELS as readonly string[]).includes(c),
    );
    expect(overlap).toEqual([]);
  });

  /**
   * The hook is the only writer of `activeSetup`. If it learns a label the
   * vocabulary does not know, the modal falls through to the "unsupported"
   * body — so assert the two stay in step. Source-level because the hook is a
   * React hook and the suite runs without a DOM.
   */
  it('covers every label useChannelManager can set', () => {
    const hook = readFileSync(
      join(__dirname, '../../hooks/useChannelManager.ts'),
      'utf-8',
    );
    const labels = [...hook.matchAll(/setActiveSetup\('([^']+)'\)/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(
        isHandledSetupChannel(label),
        `useChannelManager opens setup for "${label}" but ChannelSetupModals has no body for it`,
      ).toBe(true);
    }
  });

  /**
   * Each token channel needs its own `activeSetup === '<Name>'` branch in the
   * modal; the QR channels share QrLoginPanel via isQrLoginChannel.
   */
  it('has a render branch in ChannelSetupModals for every token channel', () => {
    const modal = readFileSync(join(__dirname, 'ChannelSetupModals.tsx'), 'utf-8');
    for (const channel of TOKEN_SETUP_CHANNELS) {
      expect(
        modal.includes(`activeSetup === '${channel}'`),
        `ChannelSetupModals has no body for "${channel}"`,
      ).toBe(true);
    }
    expect(modal).toContain('isQrLoginChannel(activeSetup)');
  });
});
