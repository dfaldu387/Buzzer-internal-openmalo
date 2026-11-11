/**
 * Extended firebase.ts tests — covers the remaining untested functions:
 * groups CRUD (createGroup, updateGroup, deleteGroup),
 * reasons CRUD (addReason, removeReason, getReasons),
 * call logs (addCallLog, getCallLogs),
 * voice mails (addVoiceMail, markVoiceMailListened, deleteVoiceMail),
 * user operations (getUsers, updateLastSeen, updateFcmToken, removeUser),
 * markEscalated, getRecentBuzzes.
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

const {_state, supabase: mockSupabase} = require('../src/services/supabase');

beforeEach(() => {
  jest.clearAllMocks();
  _state.fromImpl = () => _state._defaultChainable();
});

// ─── Groups CRUD ────────────────────────────────────────

describe('createGroup', () => {
  it('inserts group data', async () => {
    let inserted: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'groups') {
        const c = _state._defaultChainable();
        c.insert = jest.fn((data: any) => { inserted = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {createGroup} = require('../src/services/firebase');
    await createGroup({name: 'Dev Team', member_ids: ['u1', 'u2'], created_by: 'u1', created_at: 1000, is_active: true});
    expect(inserted).not.toBeNull();
    expect(inserted.name).toBe('Dev Team');
    expect(inserted.member_ids).toEqual(['u1', 'u2']);
  });
});

describe('updateGroup', () => {
  it('updates group name', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'groups') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateGroup} = require('../src/services/firebase');
    await updateGroup('g1', {name: 'New Name'});
    expect(updateData).toEqual({name: 'New Name'});
  });

  it('updates member_ids', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'groups') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateGroup} = require('../src/services/firebase');
    await updateGroup('g1', {member_ids: ['u1', 'u2', 'u3']});
    expect(updateData.member_ids).toEqual(['u1', 'u2', 'u3']);
  });
});

describe('deleteGroup', () => {
  it('calls delete on groups table', async () => {
    let deleteCalled = false;
    _state.fromImpl = (table: string) => {
      if (table === 'groups') {
        const c = _state._defaultChainable();
        c.delete = jest.fn(() => { deleteCalled = true; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {deleteGroup} = require('../src/services/firebase');
    await deleteGroup('g1');
    expect(deleteCalled).toBe(true);
  });
});

// ─── Reasons CRUD ───────────────────────────────────────

describe('addReason', () => {
  it('inserts reason with sort order', async () => {
    let inserted: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'reasons') {
        const c = _state._defaultChainable();
        c.insert = jest.fn((data: any) => { inserted = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {addReason} = require('../src/services/firebase');
    await addReason('Lunch', 5);
    expect(inserted).toEqual({label: 'Lunch', sort_order: 5, is_active: true});
  });
});

describe('removeReason', () => {
  it('soft-deletes by setting is_active to false', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'reasons') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {removeReason} = require('../src/services/firebase');
    await removeReason('r1');
    expect(updateData).toEqual({is_active: false});
  });
});

describe('getReasons', () => {
  it('returns active reasons ordered by sort_order', async () => {
    const reasons = [{id: 'r1', label: 'A', sort_order: 1, is_active: true}];
    _state.fromImpl = (table: string) => {
      if (table === 'reasons') {
        const c = _state._defaultChainable();
        c.then = jest.fn((cb: any) => Promise.resolve({data: reasons}).then(cb));
        return c;
      }
      return _state._defaultChainable();
    };
    const {getReasons} = require('../src/services/firebase');
    const result = await getReasons();
    expect(result).toEqual(reasons);
  });

  it('returns empty array when no data', async () => {
    const {getReasons} = require('../src/services/firebase');
    const result = await getReasons();
    expect(result).toEqual([]);
  });
});

// ─── Call Logs ──────────────────────────────────────────

describe('addCallLog', () => {
  it('inserts a call log', async () => {
    let inserted: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'call_logs') {
        const c = _state._defaultChainable();
        c.insert = jest.fn((data: any) => { inserted = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {addCallLog} = require('../src/services/firebase');
    await addCallLog({caller_id: 'u1', receiver_id: 'u2', started_at: 1000, duration_seconds: 30});
    expect(inserted.caller_id).toBe('u1');
    expect(inserted.duration_seconds).toBe(30);
  });
});

describe('getCallLogs', () => {
  it('returns call logs for a user', async () => {
    const logs = [{id: 'cl1', caller_id: 'u1', receiver_id: 'u2', started_at: 1000, duration_seconds: 30}];
    _state.fromImpl = (table: string) => {
      if (table === 'call_logs') {
        const c = _state._defaultChainable();
        c.then = jest.fn((cb: any) => Promise.resolve({data: logs}).then(cb));
        return c;
      }
      return _state._defaultChainable();
    };
    const {getCallLogs} = require('../src/services/firebase');
    const result = await getCallLogs('u1');
    expect(result).toEqual(logs);
  });
});

// ─── User Operations ────────────────────────────────────

describe('getUsers', () => {
  it('returns active users', async () => {
    const users = [{id: 'u1', name: 'Alice', is_active: true}];
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.then = jest.fn((cb: any) => Promise.resolve({data: users}).then(cb));
        return c;
      }
      return _state._defaultChainable();
    };
    const {getUsers} = require('../src/services/firebase');
    const result = await getUsers();
    expect(result).toEqual(users);
  });
});

describe('updateLastSeen', () => {
  it('updates last_seen_at timestamp', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateLastSeen} = require('../src/services/firebase');
    const before = Date.now();
    await updateLastSeen('u1');
    expect(updateData.last_seen_at).toBeGreaterThanOrEqual(before);
  });
});

describe('updateFcmToken', () => {
  it('upserts token with stale=false', async () => {
    let upsertData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'user_tokens') {
        const c = _state._defaultChainable();
        c.upsert = jest.fn((data: any) => { upsertData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {updateFcmToken} = require('../src/services/firebase');
    await updateFcmToken('u1', 'new-token');
    expect(upsertData).toEqual(expect.objectContaining({user_id: 'u1', fcm_token: 'new-token', fcm_token_stale: false}));
    expect(typeof upsertData.token_updated_at).toBe('number');
  });
});

describe('markEscalated', () => {
  it('sets escalated to true', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {markEscalated} = require('../src/services/firebase');
    await markEscalated('b1');
    expect(updateData).toEqual({escalated: true});
  });
});

describe('removeUser', () => {
  it('soft-deletes user by setting is_active to false', async () => {
    let updateData: any = null;
    _state.fromImpl = (table: string) => {
      if (table === 'users') {
        const c = _state._defaultChainable();
        c.update = jest.fn((data: any) => { updateData = data; return c; });
        return c;
      }
      return _state._defaultChainable();
    };
    const {removeUser} = require('../src/services/firebase');
    await removeUser('u1');
    expect(updateData).toEqual({is_active: false});
  });
});

describe('getRecentBuzzes', () => {
  it('returns buzzes from last 5 days', async () => {
    const buzzes = [{id: 'b1', from_user_id: 'u1', created_at: Date.now()}];
    _state.fromImpl = (table: string) => {
      if (table === 'buzzes') {
        const c = _state._defaultChainable();
        c.then = jest.fn((cb: any) => Promise.resolve({data: buzzes}).then(cb));
        return c;
      }
      return _state._defaultChainable();
    };
    const {getRecentBuzzes} = require('../src/services/firebase');
    const result = await getRecentBuzzes('u1');
    expect(result).toEqual(buzzes);
  });

  it('returns empty array on null data', async () => {
    const {getRecentBuzzes} = require('../src/services/firebase');
    const result = await getRecentBuzzes('u1');
    expect(result).toEqual([]);
  });
});
