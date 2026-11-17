const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Helper: get FCM token from user_tokens collection
async function getFcmToken(userId) {
  const tokenDoc = await db.collection('user_tokens').doc(userId).get();
  if (!tokenDoc.exists) return null;
  return tokenDoc.data().fcm_token || null;
}

// Trigger: when a new buzz is created, send FCM to receiver
exports.onBuzzCreated = functions.firestore
  .document('buzzes/{buzzId}')
  .onCreate(async (snap, context) => {
    const buzz = snap.data();
    const buzzId = context.params.buzzId;

    const [senderDoc, token] = await Promise.all([
      db.collection('users').doc(buzz.from_user_id).get(),
      getFcmToken(buzz.to_user_id),
    ]);

    if (!token) return;
    const sender = senderDoc.exists ? senderDoc.data() : {name: 'User'};

    const message = {
      token,
      data: {
        type: 'buzz',
        buzz_id: buzzId,
        from_user_id: buzz.from_user_id,
        from_user_name: sender.name,
        reason: buzz.reason,
        note: buzz.note || '',
      },
      android: {
        priority: 'high',
        ttl: 0,
      },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-push-type': 'alert',
        },
        payload: {
          aps: {
            alert: {
              title: `Buzz from ${sender.name}`,
              body: buzz.reason + (buzz.note ? ` — ${buzz.note}` : ''),
            },
            sound: 'buzz_alarm.wav',
            'content-available': 1,
            'mutable-content': 1,
          },
        },
      },
    };

    try {
      await admin.messaging().send(message);
    } catch (err) {
      console.error('FCM send failed:', err);
      // Mark token as stale but don't delete — native service will refresh it
      if (err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered') {
        await db.collection('user_tokens').doc(buzz.to_user_id).update({
          fcm_token_stale: true,
          stale_since: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }
  });

// Trigger: when a buzz is updated (cancelled or escalated)
exports.onBuzzUpdated = functions.firestore
  .document('buzzes/{buzzId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();
    const buzzId = context.params.buzzId;

    // Handle cancellation by sender
    if (before.response === 'none' && after.response === 'cancelled') {
      const token = await getFcmToken(after.to_user_id);
      if (!token) return;

      const senderDoc = await db.collection('users').doc(after.from_user_id).get();
      const senderName = senderDoc.exists ? senderDoc.data().name : 'User';

      try {
        await admin.messaging().send({
          token,
          data: {
            type: 'buzz_cancelled',
            buzz_id: buzzId,
            from_user_name: senderName,
          },
          android: {priority: 'high', ttl: 0},
          apns: {
            headers: {'apns-priority': '10', 'apns-push-type': 'alert'},
            payload: {aps: {'content-available': 1}},
          },
        });
      } catch (err) {
        console.error('FCM cancel send failed:', err);
      }
      return;
    }

    // Handle escalation (re-buzz)
    if (!before.escalated && after.escalated && after.response === 'none') {
      const [senderDoc, token] = await Promise.all([
        db.collection('users').doc(after.from_user_id).get(),
        getFcmToken(after.to_user_id),
      ]);

      if (!token) return;
      const sender = senderDoc.exists ? senderDoc.data() : {name: 'User'};

      try {
        await admin.messaging().send({
          token,
          data: {
            type: 'buzz',
            buzz_id: buzzId,
            from_user_id: after.from_user_id,
            from_user_name: sender.name,
            reason: `RE-BUZZ: ${after.reason}`,
            note: after.note || '',
          },
          android: {priority: 'high', ttl: 0},
          apns: {
            headers: {'apns-priority': '10', 'apns-push-type': 'alert'},
            payload: {
              aps: {
                alert: {
                  title: `RE-BUZZ from ${sender.name}`,
                  body: after.reason + (after.note ? ` — ${after.note}` : ''),
                },
                sound: 'buzz_alarm.wav',
                'content-available': 1,
                'mutable-content': 1,
              },
            },
          },
        });
      } catch (err) {
        console.error('FCM re-buzz send failed:', err);
      }
    }
  });

// Trigger: when a new voice message is created, send FCM to receiver
exports.onVoiceMessageCreated = functions.firestore
  .document('voice_mails/{mailId}')
  .onCreate(async (snap) => {
    const mail = snap.data();

    if (mail.deleted) return;

    const [senderDoc, token] = await Promise.all([
      db.collection('users').doc(mail.from_user_id).get(),
      getFcmToken(mail.to_user_id),
    ]);

    if (!token) return;
    const senderName = senderDoc.exists ? senderDoc.data().name : 'User';
    const duration = mail.duration_seconds || 0;

    try {
      await admin.messaging().send({
        token,
        notification: {
          title: `Voice message from ${senderName}`,
          body: `${duration}s voice message`,
        },
        data: {
          type: 'voice_message',
          from_user_id: mail.from_user_id,
          from_user_name: senderName,
          duration: String(duration),
        },
        android: {
          priority: 'high',
          ttl: 0,
          notification: {
            channelId: 'buzzer_voicemail',
            sound: 'default',
          },
        },
        apns: {
          headers: {'apns-priority': '10', 'apns-push-type': 'alert'},
          payload: {
            aps: {
              alert: {
                title: `Voice message from ${senderName}`,
                body: `${duration}s voice message`,
              },
              sound: 'default',
              'content-available': 1,
              'mutable-content': 1,
            },
          },
        },
      });
    } catch (err) {
      console.error('Voice message FCM failed:', err);
      // Mark token as stale but don't delete — native service will refresh it
      if (err.code === 'messaging/invalid-registration-token' ||
          err.code === 'messaging/registration-token-not-registered') {
        await db.collection('user_tokens').doc(mail.to_user_id).update({
          fcm_token_stale: true,
          stale_since: admin.firestore.FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }
  });
