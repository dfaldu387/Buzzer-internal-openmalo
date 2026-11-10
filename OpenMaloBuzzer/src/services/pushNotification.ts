import {SUPABASE_URL, SUPABASE_ANON_KEY} from '@env';
import {supabase} from './supabase';

// Push delivery result — lets the sender UI show appropriate warnings.
export type PushResult = 'delivered' | 'no_token' | 'token_invalid' | 'failed';

/** Check if a token's UNREGISTERED/INVALID error code is present in the FCM response. */
const isTokenInvalid = (body: any): boolean => {
  const code = body?.error?.code;
  const fcmV1Code = body?.error?.details?.find?.(
    (d: any) => d?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
  )?.errorCode;
  return code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    fcmV1Code === 'UNREGISTERED' || fcmV1Code === 'INVALID_ARGUMENT';
};

export const sendBuzzPush = async (
  toUserId: string,
  buzzId: string,
  fromUserId: string,
  fromUserName: string,
  reason: string,
  note: string | null,
  soundId: string = 'buzz_alarm',
): Promise<PushResult> => {
  try {
    const {data: tokenData} = await supabase
      .from('user_tokens').select('fcm_token,platform').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken) return 'no_token';

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
        platform: tokenData?.platform || null,
        data: {
          type: 'buzz',
          buzz_id: buzzId,
          from_user_id: fromUserId,
          from_user_name: fromUserName,
          reason,
          note: note || '',
          sound_id: soundId,
        },
      }),
    });

    try {
      const body = await res.json();
      if (isTokenInvalid(body)) {
        await supabase.from('user_tokens')
          .update({fcm_token_stale: true})
          .eq('user_id', toUserId);
        return 'token_invalid';
      }
    } catch {}

    return res.ok ? 'delivered' : 'failed';
  } catch (e: any) {
    console.warn('sendBuzzPush failed:', e?.message || e);
    return 'failed';
  }
};

export const sendBuzzCancelledPush = async (
  toUserId: string,
  buzzId: string,
  fromUserName: string,
) => {
  try {
    const {data: tokenData} = await supabase
      .from('user_tokens').select('fcm_token,platform').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
        platform: tokenData?.platform || null,
        data: {
          type: 'buzz_cancelled',
          buzz_id: buzzId,
          from_user_name: fromUserName,
        },
      }),
    });
  } catch (e: any) {
    console.warn('sendBuzzCancelledPush failed:', e?.message || e);
  }
};

export const sendVoiceMailPush = async (
  toUserId: string,
  fromUserName: string,
  duration: number,
) => {
  try {
    const {data: tokenData} = await supabase
      .from('user_tokens').select('fcm_token,platform').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
        platform: tokenData?.platform || null,
        data: {
          type: 'voice_message',
          from_user_name: fromUserName,
          duration: String(duration),
        },
      }),
    });
  } catch (e: any) {
    console.warn('sendVoiceMailPush failed:', e?.message || e);
  }
};

export const sendEscalationPush = async (
  toUserId: string,
  buzzId: string,
  fromUserId: string,
  fromUserName: string,
  reason: string,
  note: string | null,
  soundId: string = 'buzz_alarm',
) => {
  try {
    const {data: tokenData} = await supabase
      .from('user_tokens').select('fcm_token,platform').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
        platform: tokenData?.platform || null,
        data: {
          type: 'buzz',
          buzz_id: buzzId,
          from_user_id: fromUserId,
          from_user_name: fromUserName,
          reason: `RE-BUZZ: ${reason}`,
          note: note || '',
          sound_id: soundId,
        },
      }),
    });
  } catch (e: any) {
    console.warn('sendEscalationPush failed:', e?.message || e);
  }
};
