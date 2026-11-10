import {Platform} from 'react-native';
import notifee, {
  AndroidImportance,
  AndroidVisibility,
  EventType,
  IOSNotificationCategoryAction,
} from '@notifee/react-native';
import {VOICEMAIL_CHANNEL_ID, VOICEMAIL_CHANNEL_NAME} from '../constants';
import {BuzzPayload} from '../types';

export const createNotificationChannel = async () => {
  // Register iOS notification categories at startup so action buttons
  // (Ack, 5 min, Busy) are available on the very first notification.
  // Without this, buttons only appear after the FCM background handler
  // has run at least once.
  if (Platform.OS === 'ios') {
    await notifee.setNotificationCategories([{
      id: 'buzz_actions',
      actions: [
        {id: 'ack', title: 'Ack', foreground: false} as IOSNotificationCategoryAction,
        {id: 'five_min', title: '5 min', foreground: false} as IOSNotificationCategoryAction,
        {id: 'busy', title: 'Busy', destructive: true, foreground: false} as IOSNotificationCategoryAction,
      ],
    }]);
  }
  // The buzz channel (openmalo_buzz) is created ONLY by the native
  // BuzzerService.createBuzzChannel() in Kotlin, which sets USAGE_ALARM
  // audio attributes and bypassDnd=true. Notifee's createChannel API
  // does not support USAGE_ALARM and would overwrite the native channel
  // with USAGE_NOTIFICATION, breaking DND bypass and alarm-stream routing.
  // Do NOT create the buzz channel here.

  await notifee.createChannel({
    id: VOICEMAIL_CHANNEL_ID,
    name: VOICEMAIL_CHANNEL_NAME,
    importance: AndroidImportance.HIGH,
    visibility: AndroidVisibility.PUBLIC,
    sound: 'default',
    vibration: true,
  });
};

export const cancelBuzzNotification = async (buzzId: string) => {
  await notifee.cancelNotification(buzzId);
};

export const setupNotificationListeners = (
  onResponse: (buzzId: string, response: string) => void,
  onOpen: (payload: BuzzPayload) => void,
  onOpenVoiceMail?: () => void,
) => {
  return notifee.onForegroundEvent(({type, detail}) => {
    const notif = detail.notification;
    // For APNs-delivered notifications on iOS, FCM data may be in
    // different locations. Check multiple paths.
    const nData = notif?.data || (notif as any)?.remote?.data || (notif as any)?.userInfo || {};
    if (type === EventType.ACTION_PRESS && detail.pressAction) {
      const buzzId = nData.buzz_id as string;
      const actionId = detail.pressAction.id;
      if (buzzId && ['ack', 'five_min', 'busy'].includes(actionId)) {
        onResponse(buzzId, actionId);
        notifee.cancelNotification(buzzId);
      }
    }
    if (type === EventType.PRESS && nData) {
      if (nData.type === 'voice_message' && onOpenVoiceMail) {
        onOpenVoiceMail();
      } else if (nData.buzz_id) {
        onOpen({
          buzz_id: nData.buzz_id as string,
          from_user_id: (nData.from_user_id as string) || '',
          from_user_name: (nData.from_user_name as string) || 'User',
          reason: (nData.reason as string) || '',
          note: nData.note && nData.note !== 'null' ? (nData.note as string) : null,
          sound_id: (nData.sound_id as string) || null,
          created_at: Date.now(),
        });
      }
    }
  });
};
