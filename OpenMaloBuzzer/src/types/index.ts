export type UserRole = 'owner' | 'manager' | 'member';

export type BuzzResponse = 'ack' | 'five_min' | 'busy' | 'cancelled' | 'dismissed' | 'none';

export interface User {
  id: string;
  name: string;
  phone: string;
  pin_hash: string;
  role: UserRole;
  last_seen_at: number;
  is_active: boolean;
}

export interface Buzz {
  id: string;
  from_user_id: string;
  from_user_name?: string;
  to_user_id: string;
  reason: string;
  note: string | null;
  sound_id?: string | null;
  created_at: number;
  responded_at: number | null;
  response: BuzzResponse;
  escalated: boolean;
  group_id?: string;
  group_name?: string;
}

export interface Reason {
  id: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

export interface Group {
  id: string;
  name: string;
  member_ids: string[];
  created_by: string;
  created_at: number;
  is_active: boolean;
}

export interface CallLog {
  id: string;
  caller_id: string;
  receiver_id: string;
  started_at: number;
  duration_seconds: number;
}

export interface VoiceMail {
  id: string;
  from_user_id: string;
  from_user_name?: string;
  to_user_id: string;
  audio_url: string;
  duration_seconds: number;
  created_at: number;
  listened: boolean;
  deleted?: boolean;
}

export interface BuzzPayload {
  buzz_id: string;
  from_user_id: string;
  from_user_name: string;
  reason: string;
  note: string | null;
  sound_id?: string | null;
}
