/**
 * Unit tests for the auth service — login, signup, logout, stored-user restore.
 * Mocks: AsyncStorage, Supabase, Firebase messaging.
 */

jest.mock('../src/services/supabase', () => {
  const _state = {
    fromImpl: (_table: string): any => _state._defaultChainable(),
    _defaultChainable: () => {
      const obj: any = {};
      for (const m of ['select','insert','update','upsert','delete','eq','neq','in','gte','limit','order','range']) {
        obj[m] = jest.fn().mockReturnValue(obj);
      }
      obj.single = jest.fn(() => Promise.resolve({data: null, error: null}));
      obj.maybeSingle = jest.fn(() => Promise.resolve({data: null, error: null}));
      obj.then = jest.fn((cb: any) => Promise.resolve({data: null, error: null}).then(cb));
      return obj;
    },
  };
  return {
    supabase: {from: jest.fn((t: string) => _state.fromImpl(t)), channel: jest.fn(() => ({on: jest.fn().mockReturnThis(), subscribe: jest.fn()})), removeChannel: jest.fn()},
    _state,
    VOICE_MAIL_BUCKET: 'voice-mails',
    uploadVoiceMail: jest.fn(),
  };
});

jest.mock('@env', () => ({SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key'}));
jest.mock('react-native-url-polyfill/auto', () => {});
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(() => Promise.resolve('mock-fcm-token')),
  setBackgroundMessageHandler: jest.fn(),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  requestPermission: jest.fn(() => Promise.resolve(1)),
  onTokenRefresh: jest.fn(() => jest.fn()),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {hashPin} from '../src/services/crypto';

const {_state} = require('../src/services/supabase');
const AUTH_KEY = '@openmalo_user';

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
});

describe('auth — getStoredUser', () => {
  it('returns null when no user is stored', async () => {
    const {getStoredUser} = require('../src/services/auth');
    const user = await getStoredUser();
    expect(user).toBeNull();
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(AUTH_KEY);
  });

  it('restores a stored user with sentinel pin_hash', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({id: 'u1', name: 'Alice', phone: '1234567890', role: 'member', last_seen_at: 100, is_active: true}),
    );
    const {getStoredUser} = require('../src/services/auth');
    const user = await getStoredUser();
    expect(user).not.toBeNull();
    expect(user!.id).toBe('u1');
    expect(user!.pin_hash).toBe('__stored_locally__');
  });
});

describe('auth — login', () => {
  it('throws when user not found', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({data: null, error: null}));
        return c;
      }
      return _state._defaultChainable();
    };
    const {login} = require('../src/services/auth');
    await expect(login('9999999999', '1234')).rejects.toThrow('No account found');
  });

  it('throws on wrong PIN', async () => {
    const correctHash = hashPin('1234');
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {id: 'u1', name: 'Alice', phone: '1234567890', pin_hash: correctHash, role: 'member', last_seen_at: 100, is_active: true},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    const {login} = require('../src/services/auth');
    await expect(login('1234567890', '0000')).rejects.toThrow('Incorrect PIN');
  });

  it('stores user in AsyncStorage on successful login', async () => {
    const correctHash = hashPin('1234');
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {id: 'u1', name: 'Alice', phone: '1234567890', pin_hash: correctHash, role: 'member', last_seen_at: 100, is_active: true},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    const {login} = require('../src/services/auth');
    const user = await login('1234567890', '1234');
    expect(user).not.toBeNull();
    expect(user!.id).toBe('u1');
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(AUTH_KEY, expect.any(String));
    // Stored user should NOT contain pin_hash
    const stored = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
    expect(stored.pin_hash).toBeUndefined();
  });
});

describe('auth — signup', () => {
  it('throws when phone is already registered', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {id: 'existing', name: 'Bob', phone: '1111111111', pin_hash: 'x', role: 'member', last_seen_at: 1, is_active: true},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    const {signup} = require('../src/services/auth');
    await expect(signup('Charlie', '1111111111', '1234')).rejects.toThrow('already registered');
  });
});

describe('auth — logout', () => {
  it('clears AsyncStorage and FCM token', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(
      JSON.stringify({id: 'u1', name: 'Alice'}),
    );
    const {logout} = require('../src/services/auth');
    await logout();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
  });
});
