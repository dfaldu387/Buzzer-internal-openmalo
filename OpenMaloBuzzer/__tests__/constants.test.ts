/**
 * Sanity checks for constants — ensures channel IDs, timeouts, and
 * collection names haven't been accidentally changed.
 */

import {
  MAX_REASONS,
  MAX_NOTE_LENGTH,
  REBUZZ_TIMEOUT_MS,
  NO_RESPONSE_TIMEOUT_MS,
  PRESENCE_TIMEOUT_MS,
  NOTIFICATION_CHANNEL_ID,
  VOICEMAIL_CHANNEL_ID,
  COLLECTIONS,
} from '../src/constants';

describe('constants', () => {
  it('MAX_REASONS is 8', () => expect(MAX_REASONS).toBe(8));
  it('MAX_NOTE_LENGTH is 40', () => expect(MAX_NOTE_LENGTH).toBe(40));
  it('REBUZZ_TIMEOUT_MS is 60 seconds', () => expect(REBUZZ_TIMEOUT_MS).toBe(60000));
  it('NO_RESPONSE_TIMEOUT_MS is 2 minutes', () => expect(NO_RESPONSE_TIMEOUT_MS).toBe(120000));
  it('PRESENCE_TIMEOUT_MS is 30 seconds', () => expect(PRESENCE_TIMEOUT_MS).toBe(30000));

  it('notification channel IDs match BuzzerService native constants', () => {
    expect(NOTIFICATION_CHANNEL_ID).toBe('buzzer_alerts');
    expect(VOICEMAIL_CHANNEL_ID).toBe('buzzer_voicemail');
  });

  it('COLLECTIONS has all required tables', () => {
    expect(COLLECTIONS.USERS).toBe('users');
    expect(COLLECTIONS.BUZZES).toBe('buzzes');
    expect(COLLECTIONS.USER_TOKENS).toBe('user_tokens');
    expect(COLLECTIONS.REASONS).toBe('reasons');
    expect(COLLECTIONS.GROUPS).toBe('groups');
    expect(COLLECTIONS.CALL_LOGS).toBe('call_logs');
    expect(COLLECTIONS.VOICE_MAILS).toBe('voice_mails');
  });
});
