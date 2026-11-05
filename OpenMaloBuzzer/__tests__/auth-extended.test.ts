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

describe('auth — changePin', () => {
  it('changes PIN when current PIN is correct', async () => {
    const currentHash = hashPin('1234');
    let updatedHash = '';
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {...testUser, pin_hash: currentHash},
          error: null,
        }));
        c.update = jest.fn((data: any) => { updatedHash = data.pin_hash; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {changePin} = require('../src/services/auth');
    await changePin(testUser, '1234', '5678');
    expect(updatedHash).toMatch(/^v2:/);
  });

  it('throws when current PIN is wrong', async () => {
    const currentHash = hashPin('1234');
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {...testUser, pin_hash: currentHash},
          error: null,
        }));
        return c;
      }
      return _state._defaultChainable();
    };
    const {changePin} = require('../src/services/auth');
    await expect(changePin(testUser, '0000', '5678')).rejects.toThrow('Current PIN is incorrect');
  });

  it('throws when user not found', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({data: null, error: null}));
        return c;
      }
      return _state._defaultChainable();
    };
    const {changePin} = require('../src/services/auth');
    await expect(changePin(testUser, '1234', '5678')).rejects.toThrow('User not found');
  });
});

describe('auth — resetForgottenPin', () => {
  it('resets PIN for an existing user', async () => {
    let resetCalled = false;
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {...testUser, pin_hash: 'old-hash'},
          error: null,
        }));
        c.update = jest.fn(() => { resetCalled = true; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {resetForgottenPin} = require('../src/services/auth');
    await resetForgottenPin('1234567890', '9999');
    expect(resetCalled).toBe(true);
  });

  it('throws when phone not found', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({data: null, error: null}));
        return c;
      }
      return _state._defaultChainable();
    };
    const {resetForgottenPin} = require('../src/services/auth');
    await expect(resetForgottenPin('0000000000', '1234')).rejects.toThrow('No account found');
  });
});

describe('auth — deleteAccount', () => {
  it('removes user and clears AsyncStorage', async () => {
    const {deleteAccount} = require('../src/services/auth');
    await deleteAccount('u1');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(AUTH_KEY);
    expect(mockSupabase.from).toHaveBeenCalledWith('user_tokens');
  });
});

describe('auth — login legacy migration', () => {
  it('migrates DJB2 hash to v2 SHA-256 on successful login', async () => {
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

    let resetPinCalled = false;
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.maybeSingle = jest.fn(() => Promise.resolve({
          data: {...testUser, pin_hash: legacyHash},
          error: null,
        }));
        c.update = jest.fn(() => { resetPinCalled = true; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {login} = require('../src/services/auth');
    const user = await login('1234567890', '1234');
    expect(user).not.toBeNull();
    expect(resetPinCalled).toBe(true); // migration happened
  });
});
