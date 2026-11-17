/**
 * Tests for notification.ts — channel creation, cancel, and foreground event listeners.
 * Covers the notifee integration layer: channel setup, buzz response actions,
 * notification tap routing (buzz vs. voice_message), and cancel.
 */

jest.mock('../src/services/supabase', () => ({
  supabase: {from: jest.fn(() => ({select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis()})), channel: jest.fn(() => ({on: jest.fn().mockReturnThis(), subscribe: jest.fn()})), removeChannel: jest.fn()},
  VOICE_MAIL_BUCKET: 'voice-mails',
  uploadVoiceMail: jest.fn(),
}));
jest.mock('@env', () => ({SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key'}));
jest.mock('react-native-url-polyfill/auto', () => {});

import notifee from '@notifee/react-native';
import {AndroidImportance, AndroidVisibility, EventType} from '@notifee/react-native';
import {createNotificationChannel, cancelBuzzNotification, setupNotificationListeners} from '../src/services/notification';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('createNotificationChannel', () => {
  it('creates voicemail channel with correct settings', async () => {
    await createNotificationChannel();
    expect(notifee.createChannel).toHaveBeenCalledTimes(1);
    expect(notifee.createChannel).toHaveBeenCalledWith(expect.objectContaining({
      id: 'buzzer_voicemail',
      name: 'Voice Messages',
      importance: AndroidImportance.HIGH,
      visibility: AndroidVisibility.PUBLIC,
      sound: 'default',
      vibration: true,
    }));
  });

  it('does NOT create the buzz channel (native-only)', async () => {
    await createNotificationChannel();
    const calls = (notifee.createChannel as jest.Mock).mock.calls;
    const channelIds = calls.map((c: any[]) => c[0].id);
    expect(channelIds).not.toContain('buzzer_alerts');
    expect(channelIds).not.toContain('buzzer_alerts_visual');
  });
});

describe('cancelBuzzNotification', () => {
  it('cancels by buzz ID', async () => {
    await cancelBuzzNotification('buzz-123');
    expect(notifee.cancelNotification).toHaveBeenCalledWith('buzz-123');
  });
});

describe('setupNotificationListeners', () => {
  let capturedHandler: ((event: any) => void) | null = null;

  beforeEach(() => {
    capturedHandler = null;
    (notifee.onForegroundEvent as jest.Mock).mockImplementation((handler: any) => {
      capturedHandler = handler;
      return jest.fn(); // unsubscribe
    });
  });

  it('returns an unsubscribe function', () => {
    const unsub = setupNotificationListeners(jest.fn(), jest.fn());
    expect(typeof unsub).toBe('function');
  });

  it('calls onResponse when user taps ack action', () => {
    const onResponse = jest.fn();
    const onOpen = jest.fn();
    setupNotificationListeners(onResponse, onOpen);
    expect(capturedHandler).not.toBeNull();

    capturedHandler!({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'ack'},
        notification: {data: {buzz_id: 'b-1'}},
      },
    });

    expect(onResponse).toHaveBeenCalledWith('b-1', 'ack');
    expect(notifee.cancelNotification).toHaveBeenCalledWith('b-1');
  });

  it('calls onResponse for five_min action', () => {
    const onResponse = jest.fn();
    setupNotificationListeners(onResponse, jest.fn());

    capturedHandler!({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'five_min'},
        notification: {data: {buzz_id: 'b-2'}},
      },
    });

    expect(onResponse).toHaveBeenCalledWith('b-2', 'five_min');
  });

  it('calls onResponse for busy action', () => {
    const onResponse = jest.fn();
    setupNotificationListeners(onResponse, jest.fn());

    capturedHandler!({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'busy'},
        notification: {data: {buzz_id: 'b-3'}},
      },
    });

    expect(onResponse).toHaveBeenCalledWith('b-3', 'busy');
  });

  it('ignores unknown action IDs', () => {
    const onResponse = jest.fn();
    setupNotificationListeners(onResponse, jest.fn());

    capturedHandler!({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'unknown_action'},
        notification: {data: {buzz_id: 'b-4'}},
      },
    });

    expect(onResponse).not.toHaveBeenCalled();
  });

  it('ignores actions without buzz_id', () => {
    const onResponse = jest.fn();
    setupNotificationListeners(onResponse, jest.fn());

    capturedHandler!({
      type: EventType.ACTION_PRESS,
      detail: {
        pressAction: {id: 'ack'},
        notification: {data: {}},
      },
    });

    expect(onResponse).not.toHaveBeenCalled();
  });

  it('calls onOpen when user taps a buzz notification body', () => {
    const onOpen = jest.fn();
    setupNotificationListeners(jest.fn(), onOpen);

    capturedHandler!({
      type: EventType.PRESS,
      detail: {
        notification: {
          data: {buzz_id: 'b-5', from_user_id: 's1', from_user_name: 'Alice', reason: 'Call me', note: null},
        },
      },
    });

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({buzz_id: 'b-5'}));
  });

  it('calls onOpenVoiceMail when user taps a voice message notification', () => {
    const onOpenVoiceMail = jest.fn();
    setupNotificationListeners(jest.fn(), jest.fn(), onOpenVoiceMail);

    capturedHandler!({
      type: EventType.PRESS,
      detail: {
        notification: {data: {type: 'voice_message'}},
      },
    });

    expect(onOpenVoiceMail).toHaveBeenCalledTimes(1);
  });

  it('does not crash if onOpenVoiceMail is not provided', () => {
    setupNotificationListeners(jest.fn(), jest.fn()); // no voicemail handler

    expect(() => {
      capturedHandler!({
        type: EventType.PRESS,
        detail: {
          notification: {data: {type: 'voice_message'}},
        },
      });
    }).not.toThrow();
  });
});
