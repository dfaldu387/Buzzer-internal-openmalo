import {Platform} from 'react-native';
import notifee, {
  EventType,
  AndroidImportance,
  AndroidVisibility,
} from '@notifee/react-native';
import {NOTIFICATION_CHANNEL_ID, VOICEMAIL_CHANNEL_ID, VOICEMAIL_CHANNEL_NAME} from '../constants';

export const setupBackgroundHandler = () => {
  // Handle notification taps and actions in background/killed state
  notifee.onBackgroundEvent(async ({type, detail}) => {
    // Handle notification BODY tap from background/killed state.
    // On iOS, Firebase's onNotificationOpenedApp is unreliable for
    // APNs-delivered notifications. Store the buzz data so checkPending
    // can pick it up when the app opens.
    if (type === EventType.PRESS) {
      const notif = detail.notification;
      const nData = notif?.data || (notif as any)?.remote?.data || (notif as any)?.userInfo || {};
      const buzzId = nData.buzz_id as string;
      if (buzzId) {
        try {
          const AsyncStorage = require('@react-native-async-storage/async-storage').default;
          await AsyncStorage.setItem('@openmalo_pending_tap', JSON.stringify({
            buzz_id: buzzId,
            from_user_id: (nData.from_user_id as string) || '',
            from_user_name: (nData.from_user_name as string) || 'User',
            reason: (nData.reason as string) || '',
            note: nData.note && nData.note !== 'null' ? (nData.note as string) : null,
            sound_id: (nData.sound_id as string) || null,
            created_at: Date.now(),
          }));
        } catch {}
      }
    }

    if (type === EventType.ACTION_PRESS && detail.pressAction) {
      // For APNs-delivered notifications on iOS, FCM data may be in
      // different locations depending on how notifee maps the remote
      // notification. Check multiple paths to find buzz_id.
      const notif = detail.notification;
      const buzzId = (
        notif?.data?.buzz_id ||
        (notif as any)?.remote?.data?.buzz_id ||
        (notif as any)?.userInfo?.buzz_id
      ) as string;
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
          // Stop native alarm (Android BuzzerService + iOS BuzzerAlarmModule)
          try {
            const {NativeModules} = require('react-native');
            NativeModules.BuzzerService?.stopAlarm?.();
            NativeModules.BuzzerAlarmModule?.stopAlarm?.();
          } catch {}
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

        // iOS: The edge function sends a notification message (with `notification`
        // field) so the system already displays the APNs notification with
        // action buttons and a one-time sound. But APNs sounds play ONCE and
        // stop — unlike Android's BuzzerService which loops at max volume.
        // Start a native looping alarm via BuzzerAlarmModule to match Android
        // behavior. The "audio" background mode in Info.plist keeps the alarm
        // playing even when the app is backgrounded.
        if (Platform.OS === 'ios') {
          // Do NOT start BuzzerAlarmModule here. The APNs notification is
          // already playing buzz_alarm.wav (29s file) via the system sound
          // path. Starting BuzzerAlarmModule in background would:
          //   1. Interrupt the APNs sound (setActive(true) steals audio focus)
          //   2. Get killed by iOS after ~10-12s (background execution limit)
          // Result: silence after 10-12 seconds instead of 29s APNs sound.
          //
          // The native looping alarm starts only when IncomingBuzzScreen
          // mounts (user taps notification or app is in foreground).
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

        // Service couldn't start (OS blocked it) — show notifee notification with sound.
        const senderName = data.from_user_name || 'User';
        const buzzSoundName = data.sound_id || 'buzz_alarm';

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
        if (Platform.OS === 'ios') {
          const fromName = data.from_user_name || 'User';
          await notifee.displayNotification({
            title: `Voice message from ${fromName}`,
            body: `${data.duration || '0'}s voice message`,
            ios: {
              sound: 'default',
              interruptionLevel: 'timeSensitive',
            },
            data: {type: 'voice_message'},
          });
          return;
        }

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
        if (Platform.OS === 'ios') {
          await notifee.cancelNotification(data.buzz_id);
          // Stop the native looping alarm started by startAlarm()
          try {
            const {NativeModules} = require('react-native');
            NativeModules.BuzzerAlarmModule?.stopAlarm?.();
          } catch {}
          return;
        }

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
