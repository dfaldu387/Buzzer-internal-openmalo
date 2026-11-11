/**
 * Tests for push notification sending — covers all 4 push types:
 * sendBuzzPush, sendBuzzCancelledPush, sendVoiceMailPush, sendEscalationPush.
 * Also covers edge cases: no token, stale token detection, network failure.
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

const fetchMock = jest.fn(() => Promise.resolve({ok: true, json: () => Promise.resolve({})} as Response));
(global as any).fetch = fetchMock;

import {sendBuzzPush, sendBuzzCancelledPush, sendVoiceMailPush, sendEscalationPush} from '../src/services/pushNotification';
const {_state, supabase: mockSupabase} = require('../src/services/supabase');

function withToken(token: string | null, stale = false) {
  _state.fromImpl = (table: string) => {
    if (table === 'user_tokens') {
      const c = _state._defaultChainable();
      c.maybeSingle = jest.fn(() => Promise.resolve({
        data: token ? {fcm_token: token, fcm_token_stale: stale} : null,
        error: null,
      }));
      return c;
    }
    return _state._defaultChainable();
  };
}

beforeEach(() => {
  fetchMock.mockClear();
  mockSupabase.from.mockClear();
  _state.fromImpl = () => _state._defaultChainable();
});

describe('sendBuzzPush', () => {
  it('sends push with correct payload when token exists', async () => {
    withToken('tok-123');
    await sendBuzzPush('receiver-1', 'buzz-1', 'sender-1', 'Alice', 'Call me', 'Room 4');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.fcm_token).toBe('tok-123');
    expect(body.data.type).toBe('buzz');
    expect(body.data.buzz_id).toBe('buzz-1');
    expect(body.data.from_user_name).toBe('Alice');
    expect(body.data.note).toBe('Room 4');
  });

  it('sends empty string for null note', async () => {
    withToken('tok-123');
    await sendBuzzPush('r-1', 'b-1', 's-1', 'A', 'Urgent', null);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.note).toBe('');
  });

  it('skips push when no FCM token', async () => {
    withToken(null);
    const result = await sendBuzzPush('r-1', 'b-1', 's-1', 'A', 'Test', null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe('no_token');
  });

  it('returns token_invalid when fcm_token_stale is true', async () => {
    withToken('tok-stale', true);
    const result = await sendBuzzPush('r-1', 'b-1', 's-1', 'A', 'Test', null);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toBe('token_invalid');
  });

  it('returns failed on network failure', async () => {
    withToken('tok-123');
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    await expect(sendBuzzPush('r-1', 'b-1', 's-1', 'A', 'Test', null)).resolves.toBe('failed');
  });
});

describe('sendBuzzCancelledPush', () => {
  it('sends buzz_cancelled type', async () => {
    withToken('tok-456');
    await sendBuzzCancelledPush('r-1', 'b-1', 'Alice');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.type).toBe('buzz_cancelled');
    expect(body.data.buzz_id).toBe('b-1');
    expect(body.data.from_user_name).toBe('Alice');
  });

  it('skips push when token is stale', async () => {
    withToken('tok-456', true);
    await sendBuzzCancelledPush('r-1', 'b-1', 'Alice');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendVoiceMailPush', () => {
  it('sends voice_message type with duration as string', async () => {
    withToken('tok-789');
    await sendVoiceMailPush('r-1', 'Bob', 15);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.type).toBe('voice_message');
    expect(body.data.duration).toBe('15');
    expect(body.data.from_user_name).toBe('Bob');
  });

  it('skips push when token is stale', async () => {
    withToken('tok-789', true);
    await sendVoiceMailPush('r-1', 'Bob', 15);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('sendEscalationPush', () => {
  it('sends re-buzz with RE-BUZZ prefix', async () => {
    withToken('tok-esc');
    await sendEscalationPush('r-1', 'b-1', 's-1', 'Alice', 'Call me', 'Room 4');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.data.type).toBe('buzz');
    expect(body.data.reason).toBe('RE-BUZZ: Call me');
  });

  it('skips push when token is stale', async () => {
    withToken('tok-esc', true);
    await sendEscalationPush('r-1', 'b-1', 's-1', 'Alice', 'Call me', 'Room 4');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
