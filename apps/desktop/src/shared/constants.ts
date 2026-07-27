/**
 * Default gateway port for OpenClaw.
 * Used as a fallback when no port is configured in openclaw.json.
 */
export const DEFAULT_GATEWAY_PORT = 18789

/**
 * ClawHub skill registry base URL. Used by SkillsManager for direct API
 * access (search) and as the `registry` field written into each installed
 * skill's `.clawhub/origin.json`. Backend handlers use the same host;
 * see `skills-cache.ts` / `skills-download.ts`.
 */
export const CLAWHUB_BASE_URL = 'https://clawhub.ai'

/**
 * Per-message character cap on chat input. A UX guard that stops the user
 * from typing a wall of text and only finding out it's too long after they
 * hit Send; the model provider enforces its own limits on the wire.
 */
export const MAX_CHAT_MESSAGE_LENGTH = 3000

/**
 * Threshold (chars remaining) at which the UI starts showing the
 * character counter to warn the user they're approaching the cap.
 * Below this, the counter is hidden to keep the input UI quiet.
 */
export const CHAT_MESSAGE_COUNTER_THRESHOLD = 200
