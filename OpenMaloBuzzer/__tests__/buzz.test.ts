/**
 * Buzz delivery tests — four required scenarios:
 *   1. Personal buzz, foreground  (createBuzz → sendBuzzPush)
 *   2. Personal buzz, background  (FCM background handler → native/notifee)
 *   3. Group buzz all, foreground (createGroupBuzz → sendBuzzPush per member)
 *   4. Group buzz all, background (FCM background per member)
 */

// ──────────────────────────────────────────────────────────
// Mocks — factories run at hoist time, so everything must
// be self-contained inside the factory.
// ──────────────────────────────────────────────────────────

jest.mock('../src/services/supabase', () => {
  // Shared state object that tests can mutate via require()
  const _state = {
    fromImpl: (_table: string): any => {
      // Default: return a no-op chainable
      return _state._defaultChainable();
    },
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
  const supabase = {
    from: jest.fn((table: string) => _state.fromImpl(table)),
    channel: jest.fn(() => ({on: jest.fn().mockReturnThis(), subscribe: jest.fn().mockReturnThis()})),
    removeChannel: jest.fn(),
    storage: {from: jest.fn(() => ({upload: jest.fn(), getPublicUrl: jest.fn(() => ({data: {publicUrl: ''}}))}))},
  };
  return {supabase, _state, VOICE_MAIL_BUCKET: 'voice-mails', uploadVoiceMail: jest.fn()};
});

jest.mock('@env', () => ({
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}));
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

const fetchMock = jest.fn(() =>
  Promise.resolve({ok: true, json: () => Promise.resolve({})} as Response),
);
(global as any).fetch = fetchMock;

// ──────────────────────────────────────────────────────────
// Imports
// ──────────────────────────────────────────────────────────
import {createBuzz, createGroupBuzz} from '../src/services/firebase';
import {sendBuzzPush} from '../src/services/pushNotification';
import {setupBackgroundHandler} from '../src/services/backgroundHandler';

// Access the mock state and supabase object via require (not hoisted)
const {supabase: mockSupabase, _state} = require('../src/services/supabase');

/** Builds a chainable query builder resolving to `result`. */
function chainable(result: () => {data: any; error: any} = () => ({data: null, error: null})) {
  const obj: any = {};
  for (const m of ['select','update','upsert','delete','eq','neq','in','gte','limit','order','range']) {
    obj[m] = jest.fn().mockReturnValue(obj);
  }
  obj.insert = jest.fn().mockReturnValue(obj);
  obj.single = jest.fn(() => Promise.resolve(result()));
  obj.maybeSingle = jest.fn(() => Promise.resolve(result()));
  obj.then = jest.fn((cb: any) => Promise.resolve(result()).then(cb));
  return obj;
}

// ──────────────────────────────────────────────────────────
// Reset
// ──────────────────────────────────────────────────────────
beforeEach(() => {
  fetchMock.mockClear();
  mockSupabase.from.mockClear();
  _state.fromImpl = () => _state._defaultChainable();
  require('@notifee/react-native').default.displayNotification.mockClear();
  require('@notifee/react-native').default.cancelNotification.mockClear();
});

// ──────────────────────────────────────────────────────────
// 1. Personal buzz — foreground
// ──────────────────────────────────────────────────────────
describe('Personal buzz — foreground', () => {
  it('creates a buzz in Supabase and sends FCM push to the receiver', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') return chainable(() => ({data: {id: 'buzz-001'}, error: null}));
      if (table === 'user_tokens') return chainable(() => ({data: {fcm_token: 'rcv-token'}, error: null}));
      return _state._defaultChainable();
    };

    const result = await createBuzz({
      from_user_id: 'sender-1', from_user_name: 'Alice', to_user_id: 'receiver-1',
      reason: 'Call me', note: null, created_at: Date.now(),
      responded_at: null, response: 'none', escalated: false,
    });
    expect(result.id).toBe('buzz-001');

    await sendBuzzPush('receiver-1', 'buzz-001', 'sender-1', 'Alice', 'Call me', null);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.fcm_token).toBe('rcv-token');
    expect(body.data).toEqual(expect.objectContaining({
      type: 'buzz', buzz_id: 'buzz-001', from_user_id: 'sender-1',
      from_user_name: 'Alice', reason: 'Call me',
    }));
  });

  it('skips push when the receiver has no FCM token', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'user_tokens') return chainable(() => ({data: null, error: null}));
      return _state._defaultChainable();
    };

    await sendBuzzPush('no-token', 'buzz-002', 'sender-1', 'Alice', 'Call me', null);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marks stale token when FCM reports it invalid', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'user_tokens') return chainable(() => ({data: {fcm_token: 'stale-t'}, error: null}));
      return _state._defaultChainable();
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({error: {code: 'messaging/registration-token-not-registered'}}),
    } as any);

    await sendBuzzPush('stale-user', 'buzz-003', 'sender-1', 'Alice', 'Call me', null);

    const fromCalls = mockSupabase.from.mock.calls.map((c: any[]) => c[0]);
    expect(fromCalls).toContain('user_tokens');
  });
});

// ──────────────────────────────────────────────────────────
// 2. Personal buzz — background
// ──────────────────────────────────────────────────────────
describe('Personal buzz — background', () => {
  let bgHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    // Test Android fallback path (iOS returns early, letting APNs handle it)
    jest.replaceProperty(require('react-native').Platform, 'OS', 'android');
    bgHandler = null;
    const {setBackgroundMessageHandler} = require('@react-native-firebase/messaging');
    (setBackgroundMessageHandler as jest.Mock).mockImplementation((_m: any, h: any) => { bgHandler = h; });
    setupBackgroundHandler();
  });

  afterEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'ios');
  });

  it('shows notifee fallback notification when native service unavailable', async () => {
    await bgHandler!({data: {
      type: 'buzz', buzz_id: 'buzz-bg-001', from_user_id: 'sender-1',
      from_user_name: 'Bob', reason: 'Meeting', note: 'Room 4',
    }});

    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({id: 'buzz-bg-001', title: 'Buzz from Bob', body: expect.stringContaining('Meeting')}),
    );
  });

  it('includes note in notification body', async () => {
    await bgHandler!({data: {
      type: 'buzz', buzz_id: 'bg-note', from_user_id: 's1',
      from_user_name: 'Eve', reason: 'Lunch', note: 'Downstairs',
    }});

    const body = require('@notifee/react-native').default.displayNotification.mock.calls[0][0].body;
    expect(body).toContain('Lunch');
    expect(body).toContain('Downstairs');
  });

  it('ignores messages with no data', async () => {
    await bgHandler!({data: null});
    await bgHandler!({});
    expect(require('@notifee/react-native').default.displayNotification).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────
// 3. Group buzz all — foreground
// ──────────────────────────────────────────────────────────
describe('Group buzz all — foreground', () => {
  it('creates one buzz row per member and sends FCM push to each', async () => {
    const memberIds = ['m-1', 'm-2', 'm-3'];

    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') {
        const c = _state._defaultChainable();
        c.insert = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({data: [{id: 'gb-0'}, {id: 'gb-1'}, {id: 'gb-2'}], error: null}),
        });
        return c;
      }
      if (table === 'user_tokens') return chainable(() => ({data: {fcm_token: 'member-tok'}, error: null}));
      return _state._defaultChainable();
    };

    const results = await createGroupBuzz('s-1', 'Alice', memberIds, 'Standup', null, 'g-1', 'Dev');
    expect(results).toHaveLength(3);

    for (let i = 0; i < memberIds.length; i++) {
      await sendBuzzPush(memberIds[i], results[i].id, 's-1', 'Alice', 'Standup', null);
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (let i = 0; i < 3; i++) {
      const body = JSON.parse(fetchMock.mock.calls[i][1].body);
      expect(body.data.type).toBe('buzz');
      expect(body.data.buzz_id).toBe(`gb-${i}`);
    }
  });

  it('handles empty member list without crashing', async () => {
    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') {
        const c = _state._defaultChainable();
        c.insert = jest.fn().mockReturnValue({
          select: jest.fn().mockResolvedValue({data: [], error: null}),
        });
        return c;
      }
      return _state._defaultChainable();
    };

    const results = await createGroupBuzz('s-1', 'Alice', [], 'Standup', null, 'g-empty', 'Solo');
    expect(results).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('includes note and group info in every buzz row', async () => {
    let insertedRows: any[] = [];
    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') {
        const c = _state._defaultChainable();
        c.insert = jest.fn().mockImplementation((rows: any[]) => {
          insertedRows = rows;
          return {select: jest.fn().mockResolvedValue({data: rows.map((_: any, i: number) => ({id: `gn-${i}`})), error: null})};
        });
        return c;
      }
      return _state._defaultChainable();
    };

    await createGroupBuzz('s-1', 'Alice', ['m-1', 'm-2'], 'Lunch', 'Downstairs', 'g-1', 'Team');

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].note).toBe('Downstairs');
    expect(insertedRows[1].note).toBe('Downstairs');
    expect(insertedRows[0].group_id).toBe('g-1');
    expect(insertedRows[0].group_name).toBe('Team');
  });
});

// ──────────────────────────────────────────────────────────
// 4. Group buzz all — background
// ──────────────────────────────────────────────────────────
describe('Group buzz all — background', () => {
  let bgHandler: ((msg: any) => Promise<void>) | null = null;

  beforeEach(() => {
    // Test Android fallback path (iOS returns early, letting APNs handle it)
    jest.replaceProperty(require('react-native').Platform, 'OS', 'android');
    bgHandler = null;
    const {setBackgroundMessageHandler} = require('@react-native-firebase/messaging');
    (setBackgroundMessageHandler as jest.Mock).mockImplementation((_m: any, h: any) => { bgHandler = h; });
    setupBackgroundHandler();
  });

  afterEach(() => {
    jest.replaceProperty(require('react-native').Platform, 'OS', 'ios');
  });

  it('each member receives their own notifee notification', async () => {
    const buzzIds = ['gb-bg-1', 'gb-bg-2', 'gb-bg-3'];
    for (const id of buzzIds) {
      await bgHandler!({data: {
        type: 'buzz', buzz_id: id, from_user_id: 'sender-1',
        from_user_name: 'Alice', reason: 'Team standup', note: '',
      }});
    }

    const notifee = require('@notifee/react-native').default;
    expect(notifee.displayNotification).toHaveBeenCalledTimes(3);
    const ids = notifee.displayNotification.mock.calls.map((c: any[]) => c[0].id);
    expect(ids).toEqual(buzzIds);
  });

  it('handles buzz_cancelled for a group member', async () => {
    await bgHandler!({data: {
      type: 'buzz_cancelled', buzz_id: 'gb-cancel-1', from_user_name: 'Alice',
    }});

    const notifee = require('@notifee/react-native').default;
    expect(notifee.cancelNotification).toHaveBeenCalledWith('gb-cancel-1');
    expect(notifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({title: 'Buzz cancelled', body: 'Alice cancelled the buzz'}),
    );
  });
});
