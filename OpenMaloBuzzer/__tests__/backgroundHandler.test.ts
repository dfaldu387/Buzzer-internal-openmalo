/**
 * Tests for the FCM background handler — covers buzz, voice_message,
 * buzz_cancelled types, and the native-service fallback logic.
 */

jest.mock('../src/services/supabase', () => ({
  supabase: {from: jest.fn(() => ({select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn(() => Promise.resolve({data: null}))})), channel: jest.fn(() => ({on: jest.fn().mockReturnThis(), subscribe: jest.fn()})), removeChannel: jest.fn()},
  VOICE_MAIL_BUCKET: 'voice-mails',
  uploadVoiceMail: jest.fn(),
}));
jest.mock('@env', () => ({SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key'}));
jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  setBackgroundMessageHandler: jest.fn(),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  requestPermission: jest.fn(() => Promise.resolve(1)),
  getToken: jest.fn(() => Promise.resolve('mock-token')),
  onTokenRefresh: jest.fn(() => jest.fn()),
}));
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: jest.fn(() => Promise.resolve()),
    cancelNotification: jest.fn(() => Promise.resolve()),
    cancelAllNotifications: jest.fn(() => Promise.resolve()),
    createChannel: jest.fn(() => Promise.resolve()),
    onBackgroundEvent: jest.fn(),
    onForegroundEvent: jest.fn(() => jest.fn()),
    setNotificationCategories: jest.fn(() => Promise.resolve()),
  },
  EventType: {ACTION_PRESS: 1, PRESS: 4},
  AndroidImportance: {HIGH: 4, DEFAULT: 3},
  AndroidVisibility: {PUBLIC: 1},
}));

import {setupBackgroundHandler} from '../src/services/backgroundHandler';
const {setBackgroundMessageHandler} = require('@react-native-firebase/messaging');

let bgHandler: ((msg: any) => Promise<void>) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  bgHandler = null;
  (setBackgroundMessageHandler as jest.Mock).mockImplementation((_m: any, h: any) => { bgHandler = h; });
  setupBackgroundHandler();
});

describe('background handler — buzz type (iOS)', () => {
  it('lets APNs notification stand on iOS (no notifee replacement)', async () => {
    await bgHandler!({data: {type: 'buzz', buzz_id: 'b1', from_user_id: 's1', from_user_name: 'Alice', reason: 'Call me', note: 'Room 4'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
    expect(notifee.cancelAllNotifications).not.toHaveBeenCalled();
  });
});

describe('background handler — buzz type (Android)', () => {
  beforeEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'android');
  });
  afterEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'ios');
  });

  it('shows notifee notification as fallback', async () => {
    await bgHandler!({data: {type: 'buzz', buzz_id: 'b1', from_user_id: 's1', from_user_name: 'Alice', reason: 'Call me', note: 'Room 4'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).toHaveBeenCalledWith(expect.objectContaining({
      id: 'b1',
      title: 'Buzz from Alice',
      body: expect.stringContaining('Call me'),
    }));
  });

  it('includes note in body with dash separator', async () => {
    await bgHandler!({data: {type: 'buzz', buzz_id: 'b2', from_user_id: 's1', from_user_name: 'Bob', reason: 'Meeting', note: 'Room 5'}});
    const notifee = require('@notifee/react-native').default;
    const body = notifee.displayNotification.mock.calls[0][0].body;
    expect(body).toBe('Meeting — Room 5');
  });

  it('excludes note when null', async () => {
    await bgHandler!({data: {type: 'buzz', buzz_id: 'b3', from_user_id: 's1', from_user_name: 'Eve', reason: 'Urgent', note: 'null'}});
    const notifee = require('@notifee/react-native').default;
    const body = notifee.displayNotification.mock.calls[0][0].body;
    expect(body).toBe('Urgent');
  });

  it('defaults sender name to "User"', async () => {
    await bgHandler!({data: {type: 'buzz', buzz_id: 'b4', from_user_id: 's1', reason: 'Test'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification.mock.calls[0][0].title).toBe('Buzz from User');
  });
});

describe('background handler — voice_message type', () => {
  it('creates voicemail channel and shows notification', async () => {
    await bgHandler!({data: {type: 'voice_message', from_user_name: 'Alice', duration: '15'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.createChannel).toHaveBeenCalled();
    expect(notifee.displayNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Voice message from Alice',
      body: '15s voice message',
    }));
  });

  it('defaults duration to 0', async () => {
    await bgHandler!({data: {type: 'voice_message', from_user_name: 'Bob'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification.mock.calls[0][0].body).toBe('0s voice message');
  });
});

describe('background handler — buzz_cancelled type (iOS)', () => {
  it('returns early on iOS (APNs collapse-id handles replacement)', async () => {
    await bgHandler!({data: {type: 'buzz_cancelled', buzz_id: 'bc1', from_user_name: 'Alice'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.cancelNotification).not.toHaveBeenCalled();
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });
});

describe('background handler — buzz_cancelled type (Android)', () => {
  beforeEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'android');
  });
  afterEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'ios');
  });

  it('cancels buzz notification and shows cancellation notice', async () => {
    await bgHandler!({data: {type: 'buzz_cancelled', buzz_id: 'bc1', from_user_name: 'Alice'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.cancelNotification).toHaveBeenCalledWith('bc1');
    expect(notifee.displayNotification).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Buzz cancelled',
      body: 'Alice cancelled the buzz',
    }));
  });
});

describe('background handler — edge cases', () => {
  it('ignores null data', async () => {
    await bgHandler!({data: null});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('ignores undefined data', async () => {
    await bgHandler!({});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });

  it('ignores unknown message types', async () => {
    await bgHandler!({data: {type: 'unknown_type'}});
    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).not.toHaveBeenCalled();
  });
});
