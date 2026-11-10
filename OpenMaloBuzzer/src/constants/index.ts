export const MAX_REASONS = 8;
export const MAX_NOTE_LENGTH = 40;
export const REBUZZ_TIMEOUT_MS = 60000;
export const NO_RESPONSE_TIMEOUT_MS = 120000;
export const PRESENCE_TIMEOUT_MS = 30000; // 30 seconds
// Maximum age of a buzz that the 5-second foreground poll will pick up.
// Kept moderate because this poll runs frequently while the app is open.
export const MISSED_BUZZ_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Maximum age of a buzz that the one-time safety-net check on app open
// will recover. Set to 0 (unlimited) — any unanswered buzz is shown
// regardless of age, because the alternative is silently dropping it
// and the sender never knowing the receiver didn't see it.
// The IncomingBuzzScreen shows "Sent X ago" for stale buzzes so the
// receiver knows it's old, and skips the loud alarm.
export const RECOVERY_BUZZ_WINDOW_MS = 0; // 0 = no time limit

// Buzzes older than this play a gentle alert (vibrate only) instead of
// the full loud alarm, since the sender's request is no longer urgent.
export const STALE_BUZZ_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export const NOTIFICATION_CHANNEL_ID = 'openmalo_buzz';
export const NOTIFICATION_CHANNEL_NAME = 'OpenMalo Buzz';

export const VOICEMAIL_CHANNEL_ID = 'openmalo_voicemail';
export const VOICEMAIL_CHANNEL_NAME = 'Voice Messages';

export const COLLECTIONS = {
  USERS: 'users',
  BUZZES: 'buzzes',
  USER_TOKENS: 'user_tokens',
  REASONS: 'reasons',
  SETTINGS: 'settings',
  GROUPS: 'groups',
  CALL_LOGS: 'call_logs',
  VOICE_MAILS: 'voice_mails',
} as const;
