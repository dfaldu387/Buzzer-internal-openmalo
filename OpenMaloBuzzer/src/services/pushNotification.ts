import {SUPABASE_URL, SUPABASE_ANON_KEY} from '@env';
import {supabase} from './supabase';

export const sendBuzzPush = async (
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
      .from('user_tokens').select('fcm_token,fcm_token_stale').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken) return;
    // Skip sending to known-stale tokens — the buzz is already in the
    // buzzes table so the receiver's polling fallback will pick it up
    // when they next open the app.
    if (tokenData.fcm_token_stale) return;

    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
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
    // If the Edge Function reports the token is invalid, mark it stale
    // so the sender-side UI can show a warning in the future.
    // Check regardless of HTTP status — edge function returns structured
    // error for stale tokens, but also handle raw FCM v1 errors as fallback.
    try {
      const body = await res.json();
      const code = body?.error?.code;
      const fcmV1Code = body?.error?.details?.find?.(
        (d: any) => d?.['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
      )?.errorCode;
      if (code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          fcmV1Code === 'UNREGISTERED' || fcmV1Code === 'INVALID_ARGUMENT') {
        await supabase.from('user_tokens')
          .update({fcm_token_stale: true})
          .eq('user_id', toUserId);
      }
    } catch {}
  } catch (e: any) {
    console.warn('sendBuzzPush failed:', e?.message || e);
  }
};

export const sendBuzzCancelledPush = async (
  toUserId: string,
  buzzId: string,
  fromUserName: string,
) => {
  try {
    const {data: tokenData} = await supabase
      .from('user_tokens').select('fcm_token,fcm_token_stale').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken || tokenData.fcm_token_stale) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
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
      .from('user_tokens').select('fcm_token,fcm_token_stale').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken || tokenData.fcm_token_stale) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
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
      .from('user_tokens').select('fcm_token,fcm_token_stale').eq('user_id', toUserId).maybeSingle();
    const fcmToken = tokenData?.fcm_token;
    if (!fcmToken || tokenData.fcm_token_stale) return;

    await fetch(`${SUPABASE_URL}/functions/v1/send-notification`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fcm_token: fcmToken,
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
