import {Platform} from 'react-native';
import notifee, {
  EventType,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';
import {NOTIFICATION_CHANNEL_ID, VOICEMAIL_CHANNEL_ID, VOICEMAIL_CHANNEL_NAME} from '../constants';

export const setupBackgroundHandler = () => {
  // Handle notification actions in background
  notifee.onBackgroundEvent(async ({type, detail}) => {
    if (type === EventType.ACTION_PRESS && detail.pressAction) {
      const buzzId = detail.notification?.data?.buzz_id as string;
      const actionId = detail.pressAction.id;
      if (buzzId && ['ack', 'five_min', 'busy'].includes(actionId)) {
        let responded = false;
        try {
          const {respondToBuzz} = require('./firebase');
          await respondToBuzz(buzzId, actionId as any);
          responded = true;
        } catch (err) {
          console.warn('Background respond error:', err);
          // Retry once after a short delay
          try {
            const {respondToBuzz} = require('./firebase');
            await respondToBuzz(buzzId, actionId as any);
            responded = true;
          } catch (retryErr) {
            console.warn('Background respond retry also failed:', retryErr);
          }
        }
        if (responded) {
          await notifee.cancelNotification(buzzId);
        }
      }
    }
  });

  // Handle FCM background/killed messages
  try {
    const {getMessaging, setBackgroundMessageHandler} =
      require('@react-native-firebase/messaging');
    const messaging = getMessaging();
    setBackgroundMessageHandler(messaging, async (remoteMessage: any) => {
      const data = remoteMessage.data;
      if (!data) return;

      if (data.type === 'buzz') {
        console.log(`[T5] FCM background handler received buzz ${data.buzz_id} at ${Date.now()}`);
        // On iOS, the APNs notification from the edge function already
        // displays with alert, sound, and action buttons (via category).
        // Do NOT cancel or replace it — notifee.displayNotification from
        // a background handler is unreliable on iOS and was causing the
        // notification to disappear silently.
        if (Platform.OS === 'ios') {
          console.log(`[T5] iOS bg handler: letting APNs notification stand for buzz ${data.buzz_id}`);
          return;
        }

        // Android: deliver directly to BuzzerService (starts it if dead)
        // This gives full alarm: max volume, silent/DND override, vibration
        const tryShowBuzz = async (): Promise<boolean> => {
          try {
            const {NativeModules} = require('react-native');
            const started = await NativeModules.BuzzerService?.showBuzz?.(
              data.buzz_id,
              data.from_user_id || '',
              data.from_user_name || 'User',
              data.reason || '',
              data.note || null,
              data.sound_id || 'buzz_alarm',
            );
            return !!started;
          } catch {
            return false;
          }
        };

        // Try once, retry after a short delay if it fails (Android 12+ bg restrictions)
        let started = await tryShowBuzz();
        if (!started) {
          await new Promise<void>(r => setTimeout(r, 300));
          started = await tryShowBuzz();
        }
        if (started) return; // Service handled it with full alarm

        // Service couldn't start (OS blocked it) — show notifee notification as fallback
        const senderName = data.from_user_name || 'User';

        // Use sender-selected sound from FCM data
        const buzzSoundName = data.sound_id || 'buzz_alarm';

        // Create a notifee-managed buzz channel for the fallback path.
        // This is separate from the native BuzzerService.createBuzzChannel()
        // which uses USAGE_ALARM. Notifee cannot set USAGE_ALARM, but it CAN
        // play the alarm sound file on a HIGH importance channel. Using the
        // native channel ID here would cause notifee to overwrite the native
        // USAGE_ALARM settings with USAGE_NOTIFICATION, breaking DND bypass
        // for the native path. A dedicated fallback channel avoids this.
        // Android locks channel settings after creation (Android 8+).
        // Use a per-sound channel ID so changing sound preference takes effect.
        const FALLBACK_CHANNEL_ID = `openmalo_buzz_fallback_${buzzSoundName}`;
        await notifee.createChannel({
          id: FALLBACK_CHANNEL_ID,
          name: `Buzzer Alerts (${buzzSoundName.replace('buzz_alarm', 'Sound').replace('_', ' ')})`,
          importance: AndroidImportance.HIGH,
          sound: buzzSoundName,
          vibration: true,
          vibrationPattern: [0, 500, 200, 500, 200, 500],
        });

        await notifee.displayNotification({
          id: data.buzz_id,
          title: `Buzz from ${senderName}`,
          body: data.reason + (data.note && data.note !== 'null' ? ` — ${data.note}` : ''),
          android: {
            channelId: FALLBACK_CHANNEL_ID,
            importance: AndroidImportance.HIGH,
            sound: buzzSoundName,
            fullScreenAction: {
              id: 'incoming-buzz',
              launchActivity: 'default',
            },
            pressAction: {id: 'default'},
            actions: [
              {title: 'Ack', pressAction: {id: 'ack'}},
              {title: '5 min', pressAction: {id: 'five_min'}},
              {title: 'Busy', pressAction: {id: 'busy'}},
            ],
            ongoing: true,
            autoCancel: false,
          },
          data: data as any,
        });
      }

      if (data.type === 'voice_message') {
        await notifee.createChannel({
          id: VOICEMAIL_CHANNEL_ID,
          name: VOICEMAIL_CHANNEL_NAME,
          importance: AndroidImportance.HIGH,
          visibility: AndroidVisibility.PUBLIC,
          sound: 'default',
          vibration: true,
        });

        const fromName = data.from_user_name || 'User';
        const duration = data.duration || '0';

        await notifee.displayNotification({
          title: `Voice message from ${fromName}`,
          body: `${duration}s voice message`,
          android: {
            channelId: VOICEMAIL_CHANNEL_ID,
            importance: AndroidImportance.HIGH,
            sound: 'default',
            pressAction: {id: 'open_voice_mail'},
            autoCancel: true,
          },
          ios: {
            sound: 'default',
            interruptionLevel: 'timeSensitive',
          },
          data: {type: 'voice_message'},
        });
      }

      if (data.type === 'buzz_cancelled') {
        // On iOS, the buzz_cancelled APNs notification from the edge function
        // replaces the original buzz notification via apns-collapse-id.
        // No need to cancel or create notifications here.
        if (Platform.OS === 'ios') return;

        const cancellerName = data.from_user_name || 'User';
        // Stop the native BuzzerService alarm (MediaPlayer + Vibrator).
        // Without this, the native alarm keeps playing until the next poll
        // cycle (up to 10s) detects the cancellation on the server.
        try {
          const {NativeModules} = require('react-native');
          NativeModules.BuzzerService?.stopAlarm?.();
        } catch {}
        await notifee.cancelNotification(data.buzz_id);
        await notifee.displayNotification({
          title: 'Buzz cancelled',
          body: `${cancellerName} cancelled the buzz`,
          android: {
            channelId: NOTIFICATION_CHANNEL_ID,
            importance: AndroidImportance.DEFAULT,
            autoCancel: true,
            timeoutAfter: 10000,
            pressAction: {id: 'default'},
          },
        });
      }
    });
  } catch (err) {
    console.warn('FCM background handler setup error:', err);
  }
};
