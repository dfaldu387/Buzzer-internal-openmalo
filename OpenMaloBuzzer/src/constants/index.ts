export const MAX_REASONS = 8;
export const MAX_NOTE_LENGTH = 40;
export const REBUZZ_TIMEOUT_MS = 60000;
export const NO_RESPONSE_TIMEOUT_MS = 120000;
export const PRESENCE_TIMEOUT_MS = 30000; // 30 seconds
// Maximum age of a buzz that will still trigger the alarm screen when
// the user opens the app. Set high so buzzes sent while the app was
// inactive (e.g., stale FCM token on iOS) are not silently missed.
export const MISSED_BUZZ_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

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
