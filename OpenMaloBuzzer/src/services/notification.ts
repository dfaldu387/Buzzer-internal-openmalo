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
    if (type === EventType.ACTION_PRESS && detail.pressAction) {
      const buzzId = detail.notification?.data?.buzz_id as string;
      const actionId = detail.pressAction.id;
      if (buzzId && ['ack', 'five_min', 'busy'].includes(actionId)) {
        onResponse(buzzId, actionId);
        notifee.cancelNotification(buzzId);
      }
    }
    if (type === EventType.PRESS && detail.notification?.data) {
      const data = detail.notification.data;
      if (data.type === 'voice_message' && onOpenVoiceMail) {
        onOpenVoiceMail();
      } else if (data.buzz_id) {
        onOpen(data as unknown as BuzzPayload);
      }
    }
  });
};
