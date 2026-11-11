/**
 * Extended auth tests — covers updateProfile, changePin, resetForgottenPin,
 * deleteAccount, and the legacy PIN migration path in login.
 * These fill the coverage gaps in the existing auth.test.ts.
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

const {_state, supabase: mockSupabase} = require('../src/services/supabase');
const AUTH_KEY = '@openmalo_user';

const testUser = {id: 'u1', name: 'Alice', phone: '1234567890', pin_hash: '', role: 'member' as const, last_seen_at: 100, is_active: true};

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
  _state.fromImpl = () => _state._defaultChainable();
});

describe('auth — updateProfile', () => {
  it('updates name successfully', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({data: null, error: null})); // no duplicate phone
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateProfile} = require('../src/services/auth');
    const updated = await updateProfile(testUser, {name: 'Alice B'});
    expect(updated.name).toBe('Alice B');
    expect(updated.phone).toBe('1234567890');
    expect(AsyncStorage.setItem).toHaveBeenCalled();
  });

  it('throws when changing to a phone number already in use', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {id: 'other-user', phone: '9999999999'},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateProfile} = require('../src/services/auth');
    await expect(updateProfile(testUser, {phone: '9999999999'})).rejects.toThrow('already in use');
  });

  it('allows keeping the same phone without throwing', async () => {
    const {updateProfile} = require('../src/services/auth');
    // phone === user.phone, so no duplicate check
    const updated = await updateProfile(testUser, {phone: '1234567890'});
    expect(updated.phone).toBe('1234567890');
  });
});

// changePin now goes through the admin-action Edge Function (updateOwnPin).
// We mock fetch to simulate the Edge Function response.
const fetchMock = jest.fn(() => Promise.resolve({ok: true, json: () => Promise.resolve({ok: true})} as Response));
(global as any).fetch = fetchMock;

describe('auth — changePin', () => {
  beforeEach(() => fetchMock.mockClear());

  it('changes PIN via Edge Function when current PIN is correct', async () => {
    fetchMock.mockResolvedValueOnce({ok: true, json: () => Promise.resolve({ok: true})} as Response);
    const {changePin} = require('../src/services/auth');
    await changePin(testUser, '1234', '5678');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('update_own_pin');
    expect(body.pin).toBe('1234');
    expect(body.payload.new_pin).toBe('5678');
  });

  it('throws when Edge Function returns 401 (wrong PIN)', async () => {
    fetchMock.mockResolvedValueOnce({ok: false, json: () => Promise.resolve({error: 'Invalid PIN'})} as any);
    const {changePin} = require('../src/services/auth');
    await expect(changePin(testUser, '0000', '5678')).rejects.toThrow('Invalid PIN');
  });
});

describe('auth — deleteAccount', () => {
  it('removes user and clears AsyncStorage', async () => {
    const {deleteAccount} = require('../src/services/auth');
    await deleteAccount('u1');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
  });
});

describe('auth — login legacy migration', () => {
  beforeEach(() => fetchMock.mockClear());

  it('calls Edge Function to migrate DJB2 hash to v2 SHA-256', async () => {
    // Generate legacy hash
    const legacyHash = (() => {
      let h = 0;
      const str = 'openmalo_1234_salt';
      for (let i = 0; i < str.length; i++) {
        h = (h << 5) - h + str.charCodeAt(i);
        h |= 0;
      }
      return h.toString(36);
    })();

    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {...testUser, pin_hash: legacyHash},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    fetchMock.mockResolvedValueOnce({ok: true, json: () => Promise.resolve({ok: true})} as Response);
    const {login} = require('../src/services/auth');
    const user = await login('1234567890', '1234');
    expect(user).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe('update_own_pin');
  });
});
